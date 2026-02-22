/**
 * AI Scene Finder
 *
 * Searches screenplay text for scenes by natural language description
 * and generates professional scene data via LLM.
 *
 * Features:
 * 1. Parse user input (e.g. "缺第5集的张家客厅")
 * 2. Search scripts for scene info
 * 3. AI-generate complete scene data with visual prompts
 *
 * Ported from moyin-creator. Uses callFeatureAPI from llm-adapter.
 */

import type {
	ScriptScene,
	ProjectBackground,
	EpisodeRawScript,
	SceneRawContent,
} from "@/types/moyin-script";
import { callFeatureAPI } from "./llm-adapter";

// ==================== Types ====================

export interface SceneSearchResult {
	found: boolean;
	name: string;
	confidence: number;
	episodeNumbers: number[];
	contexts: string[];
	scene?: ScriptScene;
	message: string;
}

// ==================== Core Functions ====================

/**
 * Parse user query to extract scene name and episode number
 */
function parseSceneQuery(query: string): {
	name: string | null;
	episodeNumber: number | null;
} {
	let name: string | null = null;
	let episodeNumber: number | null = null;

	const episodeMatch = query.match(
		/第\s*(\d+)\s*[集话]|EP\.?\s*(\d+)|episode\s*(\d+)/i
	);
	if (episodeMatch) {
		episodeNumber = Number.parseInt(
			episodeMatch[1] || episodeMatch[2] || episodeMatch[3],
			10
		);
	}

	const cleanQuery = query
		.replace(/第\s*\d+\s*[集话]/g, "")
		.replace(/EP\.?\s*\d+/gi, "")
		.replace(/episode\s*\d+/gi, "")
		.trim();

	// Pattern: X这个场景/地点/背景
	let nameMatch = cleanQuery.match(
		/[「「"']?([^「」""'\s,，。！？]+?)[」」"']?\s*这个[场景地点背景环境]/
	);
	if (nameMatch) name = nameMatch[1];

	// Pattern: 缺/需要/添加 + scene name
	if (!name) {
		nameMatch = cleanQuery.match(
			/^[缺需要添加找查想请帮我的]+\s*[「「"']?([^「」""'\s,，。！？这个场景地点]{2,15})[」」"']?/
		);
		if (nameMatch) name = nameMatch[1];
	}

	// Pattern: 场景：/地点：name
	if (!name) {
		nameMatch = cleanQuery.match(
			/[场景地点背景][：:名]?\s*[「「"']?([^「」""'\s,，。！？]{2,15})[」」"']?/
		);
		if (nameMatch) name = nameMatch[1];
	}

	// Pattern: direct scene name (2-15 chars)
	if (!name) {
		const pureQuery = cleanQuery
			.replace(/^[缺需要添加找查想请帮我的]+/g, "")
			.trim();
		if (
			pureQuery.length >= 2 &&
			pureQuery.length <= 15 &&
			/^[\u4e00-\u9fa5A-Za-z\s]+$/.test(pureQuery)
		) {
			name = pureQuery;
		}
	}

	return { name, episodeNumber };
}

/**
 * Search for a scene in the episode scripts
 */
function searchSceneInScripts(
	name: string,
	episodeScripts: EpisodeRawScript[],
	targetEpisode?: number
): {
	found: boolean;
	episodeNumbers: number[];
	contexts: string[];
	matchedScenes: { episodeIndex: number; scene: SceneRawContent }[];
} {
	const episodeNumbers: number[] = [];
	const contexts: string[] = [];
	const matchedScenes: { episodeIndex: number; scene: SceneRawContent }[] = [];

	const scriptsToSearch = targetEpisode
		? episodeScripts.filter((ep) => ep.episodeIndex === targetEpisode)
		: episodeScripts;

	for (const ep of scriptsToSearch) {
		if (!ep?.scenes) continue;

		for (const scene of ep.scenes) {
			if (!scene) continue;

			const sceneHeader = scene.sceneHeader || "";
			const isMatch =
				sceneHeader.includes(name) ||
				name.includes(sceneHeader.split(/\s+/).slice(-1)[0] || "") ||
				sceneHeader
					.split(/\s+/)
					.some((word) => word.includes(name) || name.includes(word));

			if (isMatch) {
				if (!episodeNumbers.includes(ep.episodeIndex)) {
					episodeNumbers.push(ep.episodeIndex);
				}

				matchedScenes.push({ episodeIndex: ep.episodeIndex, scene });

				if (contexts.length < 5) {
					const sceneContext = [
						`【第${ep.episodeIndex}集 - ${sceneHeader}】`,
						scene.characters?.length
							? `人物: ${scene.characters.join(", ")}`
							: "",
						scene.actions?.slice(0, 2).join("\n") || "",
						scene.dialogues
							?.slice(0, 2)
							.map((d) => `${d.character}: ${d.line.slice(0, 30)}...`)
							.join("\n") || "",
					]
						.filter(Boolean)
						.join("\n");
					contexts.push(sceneContext);
				}
			}
		}
	}

	return {
		found: matchedScenes.length > 0,
		episodeNumbers,
		contexts,
		matchedScenes,
	};
}

/**
 * Use AI to generate complete scene data
 */
async function generateSceneData(
	name: string,
	background: ProjectBackground,
	contexts: string[],
	matchedScenes: { episodeIndex: number; scene: SceneRawContent }[]
): Promise<ScriptScene> {
	const sceneHeaders = matchedScenes
		.map((s) => s.scene.sceneHeader)
		.filter(Boolean);
	const allActions = matchedScenes
		.flatMap((s) => s.scene.actions || [])
		.slice(0, 5);
	const allCharacters = [
		...new Set(matchedScenes.flatMap((s) => s.scene.characters || [])),
	];

	const systemPrompt = `你是专业的影视场景设计师，擅长从剧本信息中提炼场景特征并生成专业的场景数据。

请根据提供的剧本信息和场景上下文，生成完整的场景数据。

【输出格式】
请返回JSON格式：
{
  "name": "场景名称",
  "location": "地点详细描述",
  "time": "时间 (白天/夜晚/黄昏/清晨)",
  "atmosphere": "氛围描述",
  "visualPrompt": "英文视觉提示词",
  "visualPromptZh": "中文视觉描述",
  "tags": ["标签1", "标签2"],
  "notes": "场景备注"
}`;

	const userPrompt = `【剧本信息】
剧名：《${background.title}》
类型：${background.genre || "剧情"}
时代：${background.era || "现代"}

【故事大纲】
${background.outline?.slice(0, 800) || "无"}

【要分析的场景】
${name}

【场景出现的场景头】
${sceneHeaders.slice(0, 5).join("\n")}

【场景内的动作描写】
${allActions.join("\n")}

【场景内出现的人物】
${allCharacters.join(", ")}

【场景上下文】
${contexts.slice(0, 3).join("\n\n")}

请基于以上信息，生成场景「${name}」的完整数据。`;

	try {
		const result = await callFeatureAPI(
			"script_analysis",
			systemPrompt,
			userPrompt
		);

		let cleaned = result
			.replace(/```json\n?/g, "")
			.replace(/```\n?/g, "")
			.trim();
		const jsonStart = cleaned.indexOf("{");
		const jsonEnd = cleaned.lastIndexOf("}");
		if (jsonStart !== -1 && jsonEnd !== -1) {
			cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
		}

		const parsed = JSON.parse(cleaned);

		const ensureString = (val: unknown): string | undefined => {
			if (val === null || val === undefined) return undefined;
			if (typeof val === "string") return val;
			if (Array.isArray(val)) return val.join(", ");
			if (typeof val === "object") {
				return Object.entries(val as Record<string, unknown>)
					.map(([k, v]) => `${k}: ${v}`)
					.join("; ");
			}
			return String(val);
		};

		const ensureTags = (val: unknown): string[] | undefined => {
			if (!val) return undefined;
			if (Array.isArray(val)) return val.map((t) => String(t));
			if (typeof val === "string") {
				return val
					.split(/[,，、]/)
					.map((t) => t.trim())
					.filter(Boolean);
			}
			return undefined;
		};

		return {
			id: `scene_${Date.now()}`,
			name: ensureString(parsed.name) || name,
			location: ensureString(parsed.location) || name,
			time: ensureString(parsed.time) || "白天",
			atmosphere: ensureString(parsed.atmosphere) || "",
			visualPrompt: ensureString(parsed.visualPrompt),
			tags: ensureTags(parsed.tags),
			notes: ensureString(parsed.notes),
		};
	} catch {
		return {
			id: `scene_${Date.now()}`,
			name,
			location: name,
			time: "白天",
			atmosphere: "",
		};
	}
}

// ==================== Main Entry ====================

/**
 * Find scene by natural language description
 */
export async function findSceneByDescription(
	userQuery: string,
	background: ProjectBackground,
	episodeScripts: EpisodeRawScript[],
	existingScenes: ScriptScene[]
): Promise<SceneSearchResult> {
	const { name, episodeNumber } = parseSceneQuery(userQuery);

	if (!name) {
		return {
			found: false,
			name: "",
			confidence: 0,
			episodeNumbers: [],
			contexts: [],
			message:
				'无法识别场景名。请用类似"缺第5集的张家客厅"或"添加医院走廊这个场景"的方式描述。',
		};
	}

	// Check if already exists
	const existing = existingScenes.find(
		(s) =>
			s.name === name ||
			s.location === name ||
			(s.name && (s.name.includes(name) || name.includes(s.name))) ||
			s.location.includes(name) ||
			name.includes(s.location)
	);

	if (existing) {
		return {
			found: true,
			name: existing.name || existing.location,
			confidence: 1,
			episodeNumbers: [],
			contexts: [],
			message: `场景「${existing.name || existing.location}」已存在于场景列表中。`,
			scene: existing,
		};
	}

	// Search scripts
	const searchResult = searchSceneInScripts(
		name,
		episodeScripts,
		episodeNumber || undefined
	);

	if (!searchResult.found) {
		return {
			found: false,
			name,
			confidence: 0.3,
			episodeNumbers: [],
			contexts: [],
			message: episodeNumber
				? `在第 ${episodeNumber} 集中未找到场景「${name}」。是否仍要创建这个场景？`
				: `在剧本中未找到场景「${name}」。是否仍要创建这个场景？`,
		};
	}

	// AI-generate complete scene data
	const scene = await generateSceneData(
		name,
		background,
		searchResult.contexts,
		searchResult.matchedScenes
	);

	const confidence = Math.min(
		0.5 +
			searchResult.matchedScenes.length * 0.1 +
			searchResult.episodeNumbers.length * 0.05,
		1
	);

	return {
		found: true,
		name: scene.name || scene.location,
		confidence,
		episodeNumbers: searchResult.episodeNumbers,
		contexts: searchResult.contexts,
		message: `找到场景「${scene.name || scene.location}」，出现在第 ${searchResult.episodeNumbers.join(", ")} 集。`,
		scene,
	};
}

/**
 * Quick search (no AI call) for preview
 */
export function quickSearchScene(
	userQuery: string,
	episodeScripts: EpisodeRawScript[],
	existingScenes: ScriptScene[]
): {
	name: string | null;
	found: boolean;
	message: string;
	existingScene?: ScriptScene;
} {
	const { name, episodeNumber } = parseSceneQuery(userQuery);

	if (!name) {
		return { name: null, found: false, message: "请输入场景名" };
	}

	const existing = existingScenes.find(
		(s) =>
			s.name === name ||
			s.location === name ||
			(s.name && (s.name.includes(name) || name.includes(s.name))) ||
			s.location.includes(name) ||
			name.includes(s.location)
	);

	if (existing) {
		return {
			name: existing.name || existing.location,
			found: true,
			message: `场景「${existing.name || existing.location}」已存在`,
			existingScene: existing,
		};
	}

	const searchResult = searchSceneInScripts(
		name,
		episodeScripts,
		episodeNumber || undefined
	);

	if (searchResult.found) {
		return {
			name,
			found: true,
			message: `找到「${name}」，出现在第 ${searchResult.episodeNumbers.join(", ")} 集`,
		};
	}

	return { name, found: false, message: `未在剧本中找到「${name}」` };
}
