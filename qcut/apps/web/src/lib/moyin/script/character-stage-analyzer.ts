/**
 * Character Stage Analyzer
 *
 * Analyzes screenplay outlines to identify character stage changes
 * and generate multi-stage variations.
 *
 * Features:
 * 1. Analyze time spans and character growth trajectories
 * 2. Generate stage variations (young, middle-aged, etc.)
 * 3. Each variation includes episode range for automatic shot matching
 *
 * Ported from moyin-creator. Uses callFeatureAPI from llm-adapter.
 */

import type {
	ProjectBackground,
	ScriptCharacter,
	CharacterVariation,
} from "@/types/moyin-script";
import { callFeatureAPI } from "./llm-adapter";

// ==================== Types ====================

export interface CharacterStageAnalysis {
	characterName: string;
	needsMultiStage: boolean;
	reason: string;
	stages: StageVariationData[];
	consistencyElements: {
		facialFeatures: string;
		bodyType: string;
		uniqueMarks: string;
	};
}

export interface StageVariationData {
	name: string;
	episodeRange: [number, number];
	ageDescription: string;
	stageDescription: string;
	visualPromptEn: string;
	visualPromptZh: string;
}

// ==================== Core Functions ====================

/**
 * Analyze characters for multi-stage representation needs
 */
export async function analyzeCharacterStages(
	background: ProjectBackground,
	characters: ScriptCharacter[],
	totalEpisodes: number
): Promise<CharacterStageAnalysis[]> {
	const mainCharacters = characters
		.slice(0, 5)
		.filter((c) => c.role || c.personality || c.appearance);

	if (mainCharacters.length === 0) return [];

	const systemPrompt = `你是专业的影视角色设计顾问，擅长分析角色在长篇剧集中的形象变化。

【判断标准】需要多阶段形象：
1. 时间跨度大（从25岁到50岁）
2. 身份地位变化（从普通人到企业家）
3. 外貌有显著变化
4. 剧集数量多（30集以上的主角通常需要）

【阶段划分原则】
- 每个阶段至少10集
- 阶段之间有明显形象区分
- 保持面部特征等一致性元素

请以JSON格式返回分析结果。`;

	const userPrompt = `【剧本信息】
剧名：《${background.title}》
总集数：${totalEpisodes}集
类型：${background.genre || "未知"}
时代：${background.era || "现代"}

【故事大纲】
${background.outline?.slice(0, 1500) || "无"}

【需要分析的角色】
${mainCharacters
	.map(
		(c) => `
角色：${c.name}
年龄：${c.age || "未知"}
身份：${c.role || "未知"}
外貌：${c.appearance || "未知"}`
	)
	.join("\n")}

返回JSON格式：
{
  "analyses": [
    {
      "characterName": "角色名",
      "needsMultiStage": true,
      "reason": "时间跨度25年...",
      "stages": [
        {
          "name": "青年版",
          "episodeRange": [1, 15],
          "ageDescription": "25岁",
          "stageDescription": "创业初期",
          "visualPromptEn": "25 year old Chinese male...",
          "visualPromptZh": "25岁中国男性..."
        }
      ],
      "consistencyElements": {
        "facialFeatures": "sharp jawline, deep-set eyes",
        "bodyType": "tall, athletic",
        "uniqueMarks": "scar on left wrist"
      }
    }
  ]
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

		const parsed = JSON.parse(cleaned);
		return parsed.analyses || [];
	} catch (error) {
		console.error("[CharacterStageAnalyzer] AI analysis failed:", error);
		return [];
	}
}

/**
 * Convert stage analysis to CharacterVariation format
 */
export function convertStagesToVariations(
	analysis: CharacterStageAnalysis
): Omit<CharacterVariation, "id">[] {
	if (!analysis.needsMultiStage || analysis.stages.length === 0) {
		return [];
	}

	return analysis.stages.map((stage) => ({
		name: stage.name,
		visualPrompt: [
			analysis.consistencyElements.facialFeatures,
			analysis.consistencyElements.bodyType,
			analysis.consistencyElements.uniqueMarks,
			stage.visualPromptEn,
		]
			.filter(Boolean)
			.join(", "),
		visualPromptZh: stage.visualPromptZh,
		isStageVariation: true,
		episodeRange: stage.episodeRange,
		ageDescription: stage.ageDescription,
		stageDescription: stage.stageDescription,
	}));
}

/**
 * Get the appropriate variation for a given episode
 */
export function getVariationForEpisode(
	variations: CharacterVariation[],
	episodeIndex: number
): CharacterVariation | undefined {
	const stageVariations = variations.filter(
		(v) => v.isStageVariation && v.episodeRange
	);

	if (stageVariations.length === 0) return undefined;

	return stageVariations.find((v) => {
		const [start, end] = v.episodeRange!;
		return episodeIndex >= start && episodeIndex <= end;
	});
}

/**
 * Quick detection of multi-stage hints in outline
 */
export function detectMultiStageHints(
	outline: string,
	totalEpisodes: number
): {
	hasTimeSpan: boolean;
	hasAgeChange: boolean;
	suggestMultiStage: boolean;
	hints: string[];
} {
	const hints: string[] = [];

	// Detect time span
	const yearPatterns = [
		/(\d{4})年.*?(\d{4})年/,
		/(\d{4})-(\d{4})/,
		/从(\d{4})到(\d{4})/,
	];
	let hasTimeSpan = false;
	for (const pattern of yearPatterns) {
		const yearMatch = outline.match(pattern);
		if (yearMatch) {
			const span =
				Number.parseInt(yearMatch[2], 10) - Number.parseInt(yearMatch[1], 10);
			if (span >= 5) {
				hasTimeSpan = true;
				hints.push(`时间跨度${span}年（${yearMatch[1]}-${yearMatch[2]}）`);
				break;
			}
		}
	}

	// Detect age changes
	const agePatterns = [
		/(\d+)岁.*?(\d+)岁/,
		/(\d+)-(\d+)岁/,
		/从(\d+)岁到(\d+)岁/,
		/(\d+)到(\d+)岁/,
	];
	let hasAgeChange = false;
	for (const pattern of agePatterns) {
		const ageMatch = outline.match(pattern);
		if (ageMatch) {
			const ageSpan =
				Number.parseInt(ageMatch[2], 10) - Number.parseInt(ageMatch[1], 10);
			if (ageSpan >= 10) {
				hasAgeChange = true;
				hints.push(`年龄跨度${ageMatch[1]}岁到${ageMatch[2]}岁`);
				break;
			}
		}
	}

	// Detect stage keywords
	const stageKeywords = [
		"青年",
		"中年",
		"老年",
		"少年",
		"成年",
		"晚年",
		"初期",
		"后期",
		"前期",
		"末期",
		"年轻",
		"年迈",
		"成长",
		"岁月",
		"年华",
		"创业初",
		"事业巅峰",
		"事业有成",
		"功成名就",
	];
	const foundKeywords = stageKeywords.filter((k) => outline.includes(k));
	if (foundKeywords.length > 0) {
		hints.push(`包含阶段关键词：${foundKeywords.join("、")}`);
	}

	const suggestMultiStage =
		(totalEpisodes >= 20 &&
			(hasTimeSpan || hasAgeChange || foundKeywords.length >= 1)) ||
		totalEpisodes >= 40;

	return { hasTimeSpan, hasAgeChange, suggestMultiStage, hints };
}
