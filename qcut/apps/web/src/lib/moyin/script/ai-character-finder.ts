/**
 * AI Character Finder
 *
 * Searches screenplay text for characters by natural language description
 * and generates professional character data via LLM.
 *
 * Features:
 * 1. Parse user input (e.g. "缺第10集的王大哥这个角色")
 * 2. Search scripts for character info
 * 3. AI-generate complete character data with visual prompts
 *
 * Ported from moyin-creator. Uses callFeatureAPI from llm-adapter.
 */

import type {
	ScriptCharacter,
	ProjectBackground,
	EpisodeRawScript,
} from "@/types/moyin-script";
import { callFeatureAPI } from "./llm-adapter";

// ==================== Types ====================

export interface CharacterSearchResult {
	found: boolean;
	name: string;
	confidence: number;
	episodeNumbers: number[];
	contexts: string[];
	character?: ScriptCharacter;
	message: string;
}

// ==================== Core Functions ====================

/**
 * Parse user query to extract character name and episode number
 */
function parseUserQuery(query: string): {
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

	// Pattern: X这个角色/X这个人
	let nameMatch = cleanQuery.match(
		/[「「"']?([^「」""'\s,，。！？]+?)[」」"']?\s*这个[角色人]/
	);
	if (nameMatch) {
		name = nameMatch[1];
	}

	// Pattern: 缺/需要/添加 + name
	if (!name) {
		nameMatch = cleanQuery.match(
			/^[缺需要添加找查想请帮我的]+\s*[「「"']?([^「」""'\s,，。！？这个角色人]{2,8})[」」"']?/
		);
		if (nameMatch) name = nameMatch[1];
	}

	// Pattern: 角色：name
	if (!name) {
		nameMatch = cleanQuery.match(
			/角色[：:名]?\s*[「「"']?([^「」""'\s,，。！？]{2,8})[」」"']?/
		);
		if (nameMatch) name = nameMatch[1];
	}

	// Pattern: direct name (2-8 chars)
	if (!name) {
		const pureQuery = cleanQuery
			.replace(/^[缺需要添加找查想请帮我的]+/g, "")
			.trim();
		if (
			pureQuery.length >= 2 &&
			pureQuery.length <= 8 &&
			/^[\u4e00-\u9fa5A-Za-z]+$/.test(pureQuery)
		) {
			name = pureQuery;
		}
	}

	return { name, episodeNumber };
}

/**
 * Search for a character in the episode scripts
 */
function searchCharacterInScripts(
	name: string,
	episodeScripts: EpisodeRawScript[],
	targetEpisode?: number
): {
	found: boolean;
	episodeNumbers: number[];
	contexts: string[];
	dialogueSamples: string[];
} {
	const episodeNumbers: number[] = [];
	const contexts: string[] = [];
	const dialogueSamples: string[] = [];

	const scriptsToSearch = targetEpisode
		? episodeScripts.filter((ep) => ep.episodeIndex === targetEpisode)
		: episodeScripts;

	for (const ep of scriptsToSearch) {
		if (!ep?.scenes) continue;

		let foundInEpisode = false;

		for (const scene of ep.scenes) {
			if (!scene) continue;

			const hasInCharacters = scene.characters?.some(
				(c) => c === name || c.includes(name) || name.includes(c)
			);

			const relevantDialogues =
				scene.dialogues?.filter(
					(d) =>
						d.character === name ||
						d.character.includes(name) ||
						name.includes(d.character)
				) || [];

			if (hasInCharacters || relevantDialogues.length > 0) {
				if (!foundInEpisode) {
					episodeNumbers.push(ep.episodeIndex);
					foundInEpisode = true;
				}

				// Collect dialogue samples
				for (const d of relevantDialogues.slice(0, 3)) {
					if (dialogueSamples.length < 5) {
						dialogueSamples.push(
							`${d.character}: ${d.line.slice(0, 50)}${d.line.length > 50 ? "..." : ""}`
						);
					}
				}

				// Collect context
				if (contexts.length < 5) {
					const sceneContext = [
						`【${scene.sceneHeader || "场景"}】`,
						scene.characters?.length
							? `人物: ${scene.characters.join(", ")}`
							: "",
						...relevantDialogues
							.slice(0, 2)
							.map((d) => `${d.character}: ${d.line.slice(0, 30)}...`),
					]
						.filter(Boolean)
						.join("\n");
					contexts.push(sceneContext);
				}
			}
		}
	}

	return {
		found: episodeNumbers.length > 0,
		episodeNumbers,
		contexts,
		dialogueSamples,
	};
}

/**
 * Use AI to generate complete character data
 */
async function generateCharacterData(
	name: string,
	background: ProjectBackground,
	contexts: string[],
	dialogueSamples: string[]
): Promise<ScriptCharacter> {
	const systemPrompt = `你是专业的影视角色设计师，擅长从剧本信息中提炼角色特征并生成专业的角色数据。

请根据提供的剧本信息和角色上下文，生成完整的角色数据。

【输出格式】
请返回JSON格式，包含以下字段：
{
  "name": "角色名",
  "gender": "男/女",
  "age": "年龄描述",
  "personality": "性格特点",
  "role": "角色身份/职业",
  "appearance": "外貌特征描述",
  "relationships": "与其他角色的关系",
  "visualPromptEn": "英文视觉提示词",
  "visualPromptZh": "中文视觉提示词",
  "importance": "protagonist/supporting/minor"
}`;

	const userPrompt = `【剧本信息】
剧名：《${background.title}》
类型：${background.genre || "剧情"}
时代：${background.era || "现代"}

【故事大纲】
${background.outline?.slice(0, 1000) || "无"}

【人物小传】
${background.characterBios?.slice(0, 800) || "无"}

【要分析的角色】
${name}

【角色出场上下文】
${contexts.slice(0, 3).join("\n\n")}

【角色对白样本】
${dialogueSamples.join("\n")}

请基于以上信息，生成角色「${name}」的完整数据。`;

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

		return {
			id: `char_${Date.now()}`,
			name: ensureString(parsed.name) || name,
			gender: ensureString(parsed.gender),
			age: ensureString(parsed.age),
			personality: ensureString(parsed.personality),
			role: ensureString(parsed.role),
			appearance: ensureString(parsed.appearance),
			relationships: ensureString(parsed.relationships),
			visualPromptEn: ensureString(parsed.visualPromptEn),
			visualPromptZh: ensureString(parsed.visualPromptZh),
			tags: [parsed.importance || "minor", "AI生成"],
		};
	} catch {
		return { id: `char_${Date.now()}`, name, tags: ["AI生成"] };
	}
}

// ==================== Main Entry ====================

/**
 * Find character by natural language description
 */
export async function findCharacterByDescription(
	userQuery: string,
	background: ProjectBackground,
	episodeScripts: EpisodeRawScript[],
	existingCharacters: ScriptCharacter[]
): Promise<CharacterSearchResult> {
	const { name, episodeNumber } = parseUserQuery(userQuery);

	if (!name) {
		return {
			found: false,
			name: "",
			confidence: 0,
			episodeNumbers: [],
			contexts: [],
			message:
				'无法识别角色名。请用类似"缺第10集的王大哥"或"添加张小宝这个角色"的方式描述。',
		};
	}

	// Check if already exists
	const existing = existingCharacters.find(
		(c) => c.name === name || c.name.includes(name) || name.includes(c.name)
	);

	if (existing) {
		return {
			found: true,
			name: existing.name,
			confidence: 1,
			episodeNumbers: [],
			contexts: [],
			message: `角色「${existing.name}」已存在于角色列表中。`,
			character: existing,
		};
	}

	// Search scripts
	const searchResult = searchCharacterInScripts(
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
				? `在第 ${episodeNumber} 集中未找到角色「${name}」。是否仍要创建这个角色？`
				: `在剧本中未找到角色「${name}」。是否仍要创建这个角色？`,
		};
	}

	// AI-generate complete character data
	const character = await generateCharacterData(
		name,
		background,
		searchResult.contexts,
		searchResult.dialogueSamples
	);

	const confidence = Math.min(
		0.5 +
			searchResult.dialogueSamples.length * 0.1 +
			searchResult.episodeNumbers.length * 0.05,
		1
	);

	return {
		found: true,
		name: character.name,
		confidence,
		episodeNumbers: searchResult.episodeNumbers,
		contexts: searchResult.contexts,
		message: `找到角色「${character.name}」，出现在第 ${searchResult.episodeNumbers.join(", ")} 集。`,
		character,
	};
}

/**
 * Quick search (no AI call) for preview
 */
export function quickSearchCharacter(
	userQuery: string,
	episodeScripts: EpisodeRawScript[],
	existingCharacters: ScriptCharacter[]
): {
	name: string | null;
	found: boolean;
	message: string;
	existingChar?: ScriptCharacter;
} {
	const { name, episodeNumber } = parseUserQuery(userQuery);

	if (!name) {
		return { name: null, found: false, message: "请输入角色名" };
	}

	const existing = existingCharacters.find(
		(c) => c.name === name || c.name.includes(name) || name.includes(c.name)
	);

	if (existing) {
		return {
			name: existing.name,
			found: true,
			message: `角色「${existing.name}」已存在`,
			existingChar: existing,
		};
	}

	const searchResult = searchCharacterInScripts(
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
