/**
 * AI Character Calibrator
 *
 * Uses AI to calibrate characters extracted from screenplays:
 * 1. Statistics: appearance count, dialogue count, episode range
 * 2. AI analysis: identify real characters vs non-character words
 * 3. AI merge: combine duplicate characters (王总 = 投资人王总)
 * 4. AI classification: protagonist/supporting/minor/extra
 * 5. AI enrichment: visual prompts and 6-layer identity anchors
 *
 * Ported from moyin-creator. Uses callFeatureAPI from llm-adapter.
 * Visual prompt enrichment is in character-calibrator-enrichment.ts.
 */

import type {
	ScriptCharacter,
	ProjectBackground,
	EpisodeRawScript,
	CharacterIdentityAnchors,
	CharacterNegativePrompt,
} from "@/types/moyin-script";
import { callFeatureAPI } from "./llm-adapter";
import { enrichCharactersWithVisualPrompts } from "./character-calibrator-enrichment";

// ==================== Types ====================

export interface CharacterCalibrationResult {
	characters: CalibratedCharacter[];
	filteredWords: string[];
	mergeRecords: MergeRecord[];
	analysisNotes: string;
}

export interface CalibratedCharacter {
	id: string;
	name: string;
	importance: "protagonist" | "supporting" | "minor" | "extra";
	episodeRange?: [number, number];
	appearanceCount: number;
	role?: string;
	age?: string;
	gender?: string;
	relationships?: string;
	nameVariants: string[];
	visualPromptEn?: string;
	visualPromptZh?: string;
	facialFeatures?: string;
	uniqueMarks?: string;
	clothingStyle?: string;
	identityAnchors?: CharacterIdentityAnchors;
	negativePrompt?: CharacterNegativePrompt;
}

export interface MergeRecord {
	finalName: string;
	variants: string[];
	reason: string;
}

export interface CalibrationOptions {
	previousCharacters?: CalibratedCharacter[];
}

export interface CharacterStats {
	name: string;
	sceneCount: number;
	dialogueCount: number;
	episodes: number[];
	firstEpisode: number;
	lastEpisode: number;
	dialogueSamples: string[];
	sceneSamples: string[];
}

// ==================== Extraction ====================

/**
 * Extract all characters from episode scripts
 */
export function extractAllCharactersFromEpisodes(
	episodeScripts: EpisodeRawScript[]
): ScriptCharacter[] {
	const characterSet = new Set<string>();

	if (!episodeScripts || !Array.isArray(episodeScripts)) return [];

	for (const ep of episodeScripts) {
		if (!ep?.scenes) continue;

		for (const scene of ep.scenes) {
			if (!scene) continue;

			for (const name of scene.characters || []) {
				if (name?.trim()) characterSet.add(name.trim());
			}

			for (const dialogue of scene.dialogues || []) {
				if (dialogue?.character?.trim()) {
					characterSet.add(dialogue.character.trim());
				}
			}
		}
	}

	return Array.from(characterSet).map((name, index) => ({
		id: `char_raw_${index + 1}`,
		name,
	}));
}

// ==================== Statistics ====================

/**
 * Collect appearance statistics for each character
 */
export function collectCharacterStats(
	characterNames: string[],
	episodeScripts: EpisodeRawScript[]
): Map<string, CharacterStats> {
	const stats = new Map<string, CharacterStats>();

	if (!characterNames?.length || !episodeScripts?.length) return stats;

	for (const name of characterNames) {
		if (!name) continue;
		stats.set(name, {
			name,
			sceneCount: 0,
			dialogueCount: 0,
			episodes: [],
			firstEpisode: Infinity,
			lastEpisode: 0,
			dialogueSamples: [],
			sceneSamples: [],
		});
	}

	for (const ep of episodeScripts) {
		if (!ep?.scenes) continue;
		const epIndex = ep.episodeIndex ?? 0;

		for (const scene of ep.scenes) {
			if (!scene) continue;

			for (const charName of scene.characters || []) {
				if (!charName) continue;
				for (const name of characterNames) {
					if (!name) continue;
					if (
						charName === name ||
						charName.includes(name) ||
						name.includes(charName)
					) {
						const s = stats.get(name);
						if (!s) continue;
						s.sceneCount++;
						if (!s.episodes.includes(epIndex)) s.episodes.push(epIndex);
						s.firstEpisode = Math.min(s.firstEpisode, epIndex);
						s.lastEpisode = Math.max(s.lastEpisode, epIndex);
						if (s.sceneSamples.length < 3) {
							s.sceneSamples.push(
								`第${epIndex}集: ${scene.sceneHeader || "未知场景"}`
							);
						}
					}
				}
			}

			for (const dialogue of scene.dialogues || []) {
				if (!dialogue?.character) continue;
				for (const name of characterNames) {
					if (!name) continue;
					if (
						dialogue.character === name ||
						dialogue.character.includes(name)
					) {
						const s = stats.get(name);
						if (!s) continue;
						s.dialogueCount++;
						if (s.dialogueSamples.length < 3) {
							const line = dialogue.line || "";
							s.dialogueSamples.push(
								`${dialogue.character}: ${line.slice(0, 30)}...`
							);
						}
					}
				}
			}
		}
	}

	// Fix Infinity
	for (const s of stats.values()) {
		if (s.firstEpisode === Infinity) s.firstEpisode = 0;
	}

	return stats;
}

// ==================== AI Calibration ====================

const GROUP_EXTRA_KEYWORDS = [
	"保安",
	"警察",
	"员工",
	"护士",
	"医生",
	"记者",
	"律师",
	"路人",
	"众人",
	"若干",
	"群众",
	"大妈",
];

function isGroupExtra(name: string): boolean {
	return GROUP_EXTRA_KEYWORDS.some(
		(keyword) =>
			name === keyword ||
			name === `${keyword}1` ||
			name === `${keyword}2` ||
			name.startsWith("几名") ||
			name.startsWith("两个") ||
			name.startsWith("若干")
	);
}

/**
 * AI-calibrate character list
 */
export async function calibrateCharacters(
	rawCharacters: ScriptCharacter[],
	background: ProjectBackground,
	episodeScripts: EpisodeRawScript[],
	options?: CalibrationOptions
): Promise<CharacterCalibrationResult> {
	const previousCharacters = options?.previousCharacters;

	// 1. Collect statistics
	const characterNames = rawCharacters.map((c) => c.name);
	const stats = collectCharacterStats(characterNames, episodeScripts);

	// 2. Build character list with stats, sorted by priority
	const charsWithStats = rawCharacters
		.map((c) => {
			const s = stats.get(c.name);
			const isExtra = isGroupExtra(c.name);
			const hasSpecificName =
				(c.name.length >= 2 &&
					c.name.length <= 4 &&
					/[\u4e00-\u9fa5]/.test(c.name)) ||
				/[哥姐董总老小]/.test(c.name) ||
				/^[A-Z][a-z]+$/.test(c.name);

			return {
				name: c.name,
				sceneCount: s?.sceneCount || 0,
				dialogueCount: s?.dialogueCount || 0,
				episodeCount: s?.episodes.length || 0,
				isExtra,
				hasSpecificName,
				priority: isExtra
					? -1000
					: hasSpecificName
						? 1000 + (s?.sceneCount || 0) + (s?.dialogueCount || 0)
						: (s?.sceneCount || 0) + (s?.dialogueCount || 0),
			};
		})
		.sort((a, b) => b.priority - a.priority);

	const maxCharsToSend = 150;
	const charsToProcess = charsWithStats.slice(0, maxCharsToSend);

	const characterListWithStats = charsToProcess
		.map((c, i) => {
			if (c.sceneCount === 0 && c.dialogueCount === 0) {
				return `${i + 1}. ${c.name} [未统计到出场]`;
			}
			return `${i + 1}. ${c.name} [出场${c.sceneCount}场, 对白${c.dialogueCount}条, 集数${c.episodeCount}]`;
		})
		.join("\n");

	// 3. Collect dialogue samples
	const dialogueSamples: string[] = [];
	for (const [name, s] of stats.entries()) {
		if (s.dialogueSamples.length > 0) {
			dialogueSamples.push(`【${name}】`);
			dialogueSamples.push(...s.dialogueSamples);
		}
	}

	let totalSceneCount = 0;
	for (const ep of episodeScripts) {
		if (ep?.scenes) totalSceneCount += ep.scenes.length;
	}
	const coreThreshold = Math.max(Math.floor(totalSceneCount * 0.1), 10);

	const systemPrompt = `你是专业的影视剧本分析师，擅长从剧本数据中识别和校准角色。

【核心目标】宽松保留有名字的角色，严格过滤纯群演和非角色词。

【保留规则】
- 核心主角 (protagonist): 名字明确，贯穿全剧
- 重要配角 (supporting): 有具体名字或固定称呼，出场≥1且有对白
- 次要角色 (minor): 有名字，偶尔出场
- 群演 (extra): 有称呼但出场极少

【过滤规则】只过滤：纯职业词（无姓氏）、数字编号、群体词、非角色词

请以JSON格式返回分析结果。`;

	const userPrompt = `【剧本信息】
剧名：《${background.title}》
${background.genre ? `类型：${background.genre}` : ""}
${background.era ? `时代：${background.era}` : ""}
总集数：${episodeScripts.length}集
总场次数：${totalSceneCount}场
核心主角阈值：出场 ≥ ${coreThreshold} 场

【故事大纲】
${background.outline?.slice(0, 1500) || "无"}

【人物小传】
${background.characterBios?.slice(0, 1000) || "无"}

【待校准角色列表 + 出场统计】（共${rawCharacters.length}个原始提取）
${characterListWithStats}

【角色对白样本】
${dialogueSamples.slice(0, 100).join("\n")}

请返回JSON格式：
{
  "characters": [
    { "name": "...", "importance": "protagonist|supporting|minor|extra", "appearanceCount": 0, "dialogueCount": 0, "episodeSpan": [1, 60], "role": "...", "age": "...", "gender": "...", "relationships": "..." }
  ],
  "filteredWords": ["众人", "保安"],
  "mergeRecords": [{ "finalName": "...", "variants": ["..."], "reason": "..." }],
  "analysisNotes": "..."
}`;

	// Step 1: AI analysis
	let parsed: Record<string, unknown>;
	try {
		const result = await callFeatureAPI(
			"script_analysis",
			systemPrompt,
			userPrompt,
			{ temperature: 0, maxTokens: 16384 }
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

		try {
			parsed = JSON.parse(cleaned);
		} catch (jsonErr) {
			// Try to fix incomplete JSON
			const lastCompleteChar = cleaned.lastIndexOf("},");
			if (lastCompleteChar > 0) {
				const truncated = cleaned.slice(0, lastCompleteChar + 1);
				const fixedJson = `${truncated}],"filteredWords":[],"mergeRecords":[],"analysisNotes":"部分结果"}`;
				parsed = JSON.parse(fixedJson);
			} else {
				throw jsonErr;
			}
		}
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		// Fallback: return stats-based result
		return {
			characters: rawCharacters.map((c, i) => {
				const s = stats.get(c.name);
				return {
					id: c.id || `char_${i + 1}`,
					name: c.name,
					importance: (s && s.sceneCount > 20
						? "supporting"
						: s && s.sceneCount > 5
							? "minor"
							: "extra") as CalibratedCharacter["importance"],
					appearanceCount: s?.sceneCount || 1,
					role: c.role,
					nameVariants: [c.name],
				};
			}),
			filteredWords: [],
			mergeRecords: [],
			analysisNotes: `AI角色分析失败(${err.message})，返回基于统计的结果`,
		};
	}

	// Step 2: Convert to standard format
	const parsedChars = parsed.characters as Array<Record<string, unknown>>;
	const characters: CalibratedCharacter[] = (parsedChars || []).map((c, i) => ({
		id: `char_${i + 1}`,
		name: String(c.name || ""),
		importance: (c.importance || "minor") as CalibratedCharacter["importance"],
		appearanceCount: Number(c.appearanceCount || c.dialogueCount || 1),
		role: c.role as string | undefined,
		age: c.age as string | undefined,
		gender: c.gender as string | undefined,
		relationships: c.relationships as string | undefined,
		nameVariants: (c.nameVariants as string[]) || [String(c.name || "")],
		episodeRange: c.episodeSpan as [number, number] | undefined,
	}));

	// Step 3: Enrich with visual prompts (independent try/catch)
	let enrichedCharacters = characters;
	try {
		enrichedCharacters = await enrichCharactersWithVisualPrompts(
			characters,
			background,
			episodeScripts
		);
	} catch (enrichError) {
		const err =
			enrichError instanceof Error
				? enrichError
				: new Error(String(enrichError));
		console.warn(
			"[CharacterCalibrator] Visual prompt generation failed (non-blocking):",
			err.message
		);
	}

	// Step 4: Merge with previous calibration results
	let finalCharacters = enrichedCharacters;
	if (previousCharacters && previousCharacters.length > 0) {
		const currentNames = new Set(enrichedCharacters.map((c) => c.name));

		const missingCharacters = previousCharacters.filter((pc) => {
			if (currentNames.has(pc.name)) return false;
			return !isGroupExtra(pc.name) && pc.importance !== "extra";
		});

		if (missingCharacters.length > 0) {
			const maxId = Math.max(
				...finalCharacters.map((c) => {
					const match = c.id.match(/char_(\d+)/);
					return match ? Number.parseInt(match[1]) : 0;
				})
			);

			const recoveredChars = missingCharacters.map((c, i) => ({
				...c,
				id: `char_${maxId + i + 1}`,
			}));

			finalCharacters = [...finalCharacters, ...recoveredChars];
		}
	}

	return {
		characters: finalCharacters,
		filteredWords: (parsed.filteredWords as string[]) || [],
		mergeRecords: (parsed.mergeRecords as MergeRecord[]) || [],
		analysisNotes: (parsed.analysisNotes as string) || "",
	};
}

// ==================== Conversion ====================

/**
 * Convert calibrated characters back to ScriptCharacter format
 */
export function convertToScriptCharacters(
	calibrated: CalibratedCharacter[],
	originalCharacters?: ScriptCharacter[]
): ScriptCharacter[] {
	return calibrated.map((c) => {
		const original = originalCharacters?.find((orig) => orig.name === c.name);

		return {
			...original,
			id: c.id,
			name: c.name,
			role: c.role || original?.role,
			age: c.age || original?.age,
			gender: c.gender || original?.gender,
			relationships: c.relationships || original?.relationships,
			visualPromptEn: c.visualPromptEn || original?.visualPromptEn,
			visualPromptZh: c.visualPromptZh || original?.visualPromptZh,
			appearance:
				c.facialFeatures || c.uniqueMarks || c.clothingStyle
					? [c.facialFeatures, c.uniqueMarks, c.clothingStyle]
							.filter(Boolean)
							.join(", ")
					: original?.appearance,
			identityAnchors: c.identityAnchors || original?.identityAnchors,
			negativePrompt: c.negativePrompt || original?.negativePrompt,
			tags: [
				c.importance,
				`出场${c.appearanceCount}次`,
				...(original?.tags || []),
			],
		};
	});
}

/**
 * Sort characters by importance
 */
export function sortByImportance(
	characters: CalibratedCharacter[]
): CalibratedCharacter[] {
	const order = { protagonist: 0, supporting: 1, minor: 2, extra: 3 };
	return [...characters].sort((a, b) => {
		const importanceOrder = order[a.importance] - order[b.importance];
		if (importanceOrder !== 0) return importanceOrder;
		return b.appearanceCount - a.appearanceCount;
	});
}
