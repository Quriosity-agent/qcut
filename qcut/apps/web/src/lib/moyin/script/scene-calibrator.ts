/**
 * AI Scene Calibrator
 *
 * Uses AI to calibrate scenes extracted from screenplays:
 * 1. Statistics: appearance count, episode numbers
 * 2. AI analysis: art direction, lighting, color palette
 * 3. AI enrichment: visual prompts for AI image generation
 *
 * Important: This function only supplements existing scenes with art design info.
 * It does NOT add, remove, or merge scenes.
 *
 * Ported from moyin-creator. Uses callFeatureAPI from llm-adapter.
 */

import type {
	ScriptScene,
	ProjectBackground,
	EpisodeRawScript,
} from "@/types/moyin-script";
import { callFeatureAPI } from "./llm-adapter";

// ==================== Types ====================

export interface SceneCalibrationResult {
	scenes: CalibratedScene[];
	mergeRecords: SceneMergeRecord[];
	analysisNotes: string;
}

export interface CalibratedScene {
	id: string;
	name: string;
	location: string;
	time: string;
	atmosphere: string;
	importance: "main" | "secondary" | "transition";
	episodeNumbers: number[];
	appearanceCount: number;
	architectureStyle?: string;
	lightingDesign?: string;
	colorPalette?: string;
	keyProps?: string[];
	spatialLayout?: string;
	eraDetails?: string;
	visualPromptEn?: string;
	visualPromptZh?: string;
	nameVariants: string[];
}

export interface SceneMergeRecord {
	finalName: string;
	variants: string[];
	reason: string;
}

interface SceneStats {
	name: string;
	location: string;
	appearanceCount: number;
	episodeNumbers: number[];
	contentSamples: string[];
	characters: string[];
	times: string[];
	actionSamples: string[];
	dialogueSamples: string[];
}

// ==================== Statistics ====================

function extractLocationFromHeader(header: string): string {
	const parts = header.split(/\s+/);
	const locationParts = parts.filter(
		(p) =>
			!p.match(/^\d+-\d+$/) &&
			!p.match(/^(日|夜|晨|暮|黄昏|黎明)$/) &&
			!p.match(/^(内|外|内\/外)$/)
	);
	return locationParts.join(" ") || header;
}

function extractTimeFromHeader(header: string): string {
	const timeMatch = header.match(/(日|夜|晨|暮|黄昏|黎明|清晨|傍晚)/);
	return timeMatch ? timeMatch[1] : "日";
}

function normalizeLocation(location: string): string {
	return cleanLocationString(location)
		.replace(/\s+/g, "")
		.replace(/[\uff08\uff09()]/g, "")
		.toLowerCase();
}

function cleanLocationString(location: string): string {
	if (!location) return "";
	let cleaned = location.replace(/\s*人物[\uff1a:].*/g, "");
	cleaned = cleaned.replace(/\s*角色[\uff1a:].*/g, "");
	cleaned = cleaned.replace(/\s*时间[\uff1a:].*/g, "");
	return cleaned.trim();
}

/**
 * Collect scene statistics from episode scripts
 */
export function collectSceneStats(
	episodeScripts: EpisodeRawScript[]
): Map<string, SceneStats> {
	const stats = new Map<string, SceneStats>();

	if (!episodeScripts?.length) return stats;

	for (const ep of episodeScripts) {
		if (!ep?.scenes) continue;
		const epIndex = ep.episodeIndex ?? 0;

		for (const scene of ep.scenes) {
			if (!scene?.sceneHeader) continue;

			const location = extractLocationFromHeader(scene.sceneHeader);
			const key = normalizeLocation(location);

			let stat = stats.get(key);
			if (!stat) {
				stat = {
					name: location,
					location,
					appearanceCount: 0,
					episodeNumbers: [],
					contentSamples: [],
					characters: [],
					times: [],
					actionSamples: [],
					dialogueSamples: [],
				};
				stats.set(key, stat);
			}

			stat.appearanceCount++;
			if (!stat.episodeNumbers.includes(epIndex)) {
				stat.episodeNumbers.push(epIndex);
			}

			if (stat.contentSamples.length < 5) {
				const sample = scene.content?.slice(0, 150) || scene.sceneHeader;
				stat.contentSamples.push(`第${epIndex}集: ${sample}`);
			}

			if (scene.actions?.length && stat.actionSamples.length < 8) {
				for (const action of scene.actions.slice(0, 3)) {
					if (action && stat.actionSamples.length < 8) {
						stat.actionSamples.push(`第${epIndex}集: ${action.slice(0, 100)}`);
					}
				}
			} else if (scene.content && stat.actionSamples.length < 8) {
				stat.actionSamples.push(
					`第${epIndex}集: ${scene.content.slice(0, 200).replace(/\n/g, " ")}`
				);
			}

			if (scene.dialogues && stat.dialogueSamples.length < 5) {
				for (const d of scene.dialogues.slice(0, 2)) {
					if (d && stat.dialogueSamples.length < 5) {
						stat.dialogueSamples.push(`${d.character}: ${d.line.slice(0, 50)}`);
					}
				}
			}

			for (const char of scene.characters || []) {
				if (!stat.characters.includes(char)) {
					stat.characters.push(char);
				}
			}

			const time = extractTimeFromHeader(scene.sceneHeader);
			if (time && !stat.times.includes(time)) {
				stat.times.push(time);
			}
		}
	}

	return stats;
}

// ==================== AI Calibration ====================

/**
 * AI-calibrate scenes (lightweight mode: only supplements art design info)
 */
export async function calibrateScenes(
	currentScenes: ScriptScene[],
	background: ProjectBackground,
	episodeScripts: EpisodeRawScript[]
): Promise<SceneCalibrationResult> {
	if (!currentScenes?.length) {
		return { scenes: [], mergeRecords: [], analysisNotes: "场景列表为空" };
	}

	const stats = collectSceneStats(episodeScripts);

	// Build scene list for AI
	const sceneListForAI = currentScenes
		.map((scene, i) => {
			const normalizedLoc =
				scene.location?.replace(/\s+/g, "").toLowerCase() || "";
			let sceneStat: SceneStats | undefined;
			for (const [key, stat] of stats) {
				if (
					key.includes(normalizedLoc) ||
					normalizedLoc.includes(key) ||
					stat.name === scene.name ||
					stat.location === scene.location
				) {
					sceneStat = stat;
					break;
				}
			}

			const actionInfo = sceneStat?.actionSamples?.length
				? `\n   动作描写: ${sceneStat.actionSamples.slice(0, 3).join("; ")}`
				: "";
			const dialogueInfo = sceneStat?.dialogueSamples?.length
				? `\n   对白样本: ${sceneStat.dialogueSamples.slice(0, 2).join("; ")}`
				: "";
			const characters =
				sceneStat?.characters?.slice(0, 5).join(", ") || "未知";
			const appearCount = sceneStat?.appearanceCount || 1;
			const episodes = sceneStat?.episodeNumbers?.join(",") || "1";

			return `${i + 1}. [sceneId: ${scene.id}] ${scene.name || scene.location}\n   地点: ${scene.location} [出场${appearCount}次, 集数${episodes}]\n   角色: ${characters}${actionInfo}${dialogueInfo}`;
		})
		.join("\n\n");

	const systemPrompt = `你是专业的影视美术指导，为现有场景补充美术设计信息。

【约束】不新增、不删除、不合并场景。保持原始 sceneId。

为每个场景补充：建筑风格、光影设计、色彩基调、关键道具、空间布局、时代特征、importance (main/secondary/transition)

请以JSON格式返回。`;

	const userPrompt = `【剧本信息】
剧名：《${background.title}》
${background.genre ? `类型：${background.genre}` : ""}
${background.era ? `时代：${background.era}` : ""}
${background.storyStartYear ? `故事年份：${background.storyStartYear}年` : ""}
总集数：${episodeScripts.length}集

【故事大纲】
${background.outline?.slice(0, 1500) || "无"}

【现有场景列表】
${sceneListForAI}

请返回JSON格式：
{
  "scenes": [
    { "sceneId": "原始ID", "name": "...", "location": "...", "importance": "main|secondary|transition", "architectureStyle": "...", "lightingDesign": "...", "colorPalette": "...", "keyProps": ["..."], "spatialLayout": "...", "eraDetails": "...", "atmosphere": "..." }
  ],
  "mergeRecords": [],
  "analysisNotes": "..."
}`;

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

		let parsed: Record<string, unknown> = { scenes: [] };
		try {
			parsed = JSON.parse(cleaned);
		} catch {
			// Try partial extraction
			const partialScenes: Record<string, unknown>[] = [];
			const scenePattern =
				/\{\s*"sceneId"\s*:\s*"([^"]+)"[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
			let match = scenePattern.exec(result);
			while (match !== null) {
				try {
					const sceneObj = JSON.parse(match[0]);
					if (sceneObj.sceneId) partialScenes.push(sceneObj);
				} catch {
					// skip
				}
				match = scenePattern.exec(result);
			}
			if (partialScenes.length > 0) {
				parsed = {
					scenes: partialScenes,
					mergeRecords: [],
					analysisNotes: "部分解析",
				};
			}
		}

		// Build AI result map
		const aiResultMap = new Map<string, Record<string, unknown>>();
		const parsedScenes = parsed.scenes as Array<Record<string, unknown>>;
		for (const s of parsedScenes || []) {
			if (s.sceneId) aiResultMap.set(String(s.sceneId), s);
			if (s.location) aiResultMap.set(normalizeLocation(String(s.location)), s);
			if (s.name) aiResultMap.set(normalizeLocation(String(s.name)), s);
		}

		// Map back to original scenes
		const scenes: CalibratedScene[] = currentScenes.map((orig) => {
			let aiData = aiResultMap.get(orig.id);
			if (!aiData)
				aiData = aiResultMap.get(normalizeLocation(orig.location || ""));
			if (!aiData) aiData = aiResultMap.get(normalizeLocation(orig.name || ""));

			return {
				id: orig.id,
				name: orig.name || orig.location,
				location: orig.location,
				time: orig.time || "day",
				atmosphere: (aiData?.atmosphere as string) || orig.atmosphere || "平静",
				importance: ((aiData?.importance as string) ||
					"secondary") as CalibratedScene["importance"],
				episodeNumbers: [],
				appearanceCount: 1,
				architectureStyle: aiData?.architectureStyle as string | undefined,
				lightingDesign: aiData?.lightingDesign as string | undefined,
				colorPalette: aiData?.colorPalette as string | undefined,
				keyProps: aiData?.keyProps as string[] | undefined,
				spatialLayout: aiData?.spatialLayout as string | undefined,
				eraDetails: aiData?.eraDetails as string | undefined,
				nameVariants: [orig.name || orig.location],
			};
		});

		// Enrich with visual prompts
		const enrichedScenes = await enrichScenesWithVisualPrompts(
			scenes,
			background
		);

		return {
			scenes: enrichedScenes,
			mergeRecords: (parsed.mergeRecords as SceneMergeRecord[]) || [],
			analysisNotes: (parsed.analysisNotes as string) || "",
		};
	} catch (error) {
		console.error("[SceneCalibrator] AI calibration failed:", error);
		// Fallback
		const fallbackScenes: CalibratedScene[] = Array.from(stats.values())
			.sort((a, b) => b.appearanceCount - a.appearanceCount)
			.map((s, i) => ({
				id: `scene_${i + 1}`,
				name: s.name,
				location: s.location,
				time: s.times[0] || "day",
				atmosphere: "平静",
				importance: (s.appearanceCount >= 5
					? "main"
					: s.appearanceCount >= 2
						? "secondary"
						: "transition") as CalibratedScene["importance"],
				episodeNumbers: s.episodeNumbers,
				appearanceCount: s.appearanceCount,
				nameVariants: [s.name],
			}));

		return {
			scenes: fallbackScenes,
			mergeRecords: [],
			analysisNotes: "AI校准失败，返回基于统计的结果",
		};
	}
}

// ==================== Visual Prompt Enrichment ====================

async function enrichScenesWithVisualPrompts(
	scenes: CalibratedScene[],
	background: ProjectBackground
): Promise<CalibratedScene[]> {
	const keyScenes = scenes.filter(
		(s) => s.importance === "main" || s.importance === "secondary"
	);

	if (keyScenes.length === 0) return scenes;

	const systemPrompt = `你是专业美术指导，为场景生成视觉提示词。

【剧本信息】
剧名：《${background.title}》
类型：${background.genre || "未知"}
时代：${background.era || "未知"}

【故事大纲】
${background.outline?.slice(0, 1000) || "无"}

【任务】为以下场景生成视觉提示词：
${keyScenes
	.map(
		(s, i) =>
			`${i + 1}. ${s.name}
   - 建筑风格：${s.architectureStyle || "未知"}
   - 光影：${s.lightingDesign || "未知"}
   - 色彩：${s.colorPalette || "未知"}
   - 道具：${s.keyProps?.join(", ") || "未知"}
   - 时代：${s.eraDetails || "未知"}`
	)
	.join("\n\n")}

请返回JSON格式：
{
  "scenes": [
    { "name": "场景名", "visualPromptZh": "中文描述", "visualPromptEn": "English prompt" }
  ]
}`;

	try {
		const result = await callFeatureAPI(
			"script_analysis",
			systemPrompt,
			"请为以上场景生成专业视觉提示词"
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
		const designMap = new Map<string, Record<string, unknown>>();
		for (const s of (parsed.scenes as Array<Record<string, unknown>>) || []) {
			designMap.set(String(s.name), s);
		}

		return scenes.map((s) => {
			const design = designMap.get(s.name);
			if (design) {
				return {
					...s,
					visualPromptZh: design.visualPromptZh as string | undefined,
					visualPromptEn: design.visualPromptEn as string | undefined,
				};
			}
			return s;
		});
	} catch {
		return scenes;
	}
}

// ==================== Conversion ====================

/**
 * Convert calibrated scenes back to ScriptScene format
 */
export function convertToScriptScenes(
	calibrated: CalibratedScene[],
	originalScenes?: ScriptScene[]
): ScriptScene[] {
	return calibrated.map((c) => {
		const original = originalScenes?.find(
			(orig) =>
				orig.name === c.name ||
				orig.location === c.location ||
				normalizeLocation(orig.location) === normalizeLocation(c.location)
		);

		const cleanedLocation = cleanLocationString(c.location);

		return {
			...original,
			id: original?.id || c.id,
			name: c.name,
			location: cleanedLocation,
			time: c.time,
			atmosphere: c.atmosphere,
			visualPrompt: c.visualPromptZh,
			visualPromptEn: c.visualPromptEn,
			architectureStyle: c.architectureStyle,
			lightingDesign: c.lightingDesign,
			colorPalette: c.colorPalette,
			keyProps: c.keyProps,
			spatialLayout: c.spatialLayout,
			eraDetails: c.eraDetails,
			episodeNumbers: c.episodeNumbers,
			appearanceCount: c.appearanceCount,
			importance: c.importance,
			tags: [
				c.importance,
				`出场${c.appearanceCount}次`,
				...(c.keyProps || []).slice(0, 3),
			],
		};
	});
}

/**
 * Sort scenes by importance
 */
export function sortByImportance(scenes: CalibratedScene[]): CalibratedScene[] {
	const order = { main: 0, secondary: 1, transition: 2 };
	return [...scenes].sort((a, b) => {
		const importanceOrder = order[a.importance] - order[b.importance];
		if (importanceOrder !== 0) return importanceOrder;
		return b.appearanceCount - a.appearanceCount;
	});
}
