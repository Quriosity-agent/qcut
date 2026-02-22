/**
 * Character Calibrator Enrichment
 *
 * Generates professional visual prompts and 6-layer identity anchors
 * for protagonist and supporting characters.
 *
 * Split from character-calibrator.ts to stay under 800 lines.
 */

import type { ProjectBackground, EpisodeRawScript } from "@/types/moyin-script";
import type { CalibratedCharacter } from "./character-calibrator";
import { callFeatureAPI } from "./llm-adapter";

// ==================== Era Fashion Guidance ====================

function getEraFashionGuidance(background: ProjectBackground): string {
	const startYear = background.storyStartYear;
	const timeline = background.timelineSetting || background.era || "现代";

	if (startYear) {
		if (startYear >= 2020) {
			return `【${startYear}年代服装指导】
- 年轻人：休闲时尚、运动风、潮牌元素
- 中年人：商务休闲、简约现代
- 老年人：舒适休闲`;
		}
		if (startYear >= 2010) {
			return `【${startYear}年代服装指导】
- 年轻人：韩系时尚、小清新风格
- 中年人：商务正装或商务休闲
- 老年人：传统休闲`;
		}
		if (startYear >= 2000) {
			return `【${startYear}年代服装指导】
- 年轻人：千禧年时尚
- 中年人：正式商务装
- 老年人：中山装或简单开衫`;
		}
		if (startYear >= 1990) {
			return `【${startYear}年代服装指导】
请根据该年代的中国实际服装风格设计`;
		}
		return `【${startYear}年代服装指导】
请根据该年代的中国实际服装风格设计`;
	}

	if (timeline.includes("现代") || timeline.includes("当代")) {
		return `【现代服装指导】
请设计符合当代中国的服装风格。`;
	}

	return "";
}

// ==================== Enrichment ====================

/**
 * Enrich key characters with professional visual prompts and identity anchors.
 * Called by calibrateCharacters() as step 3.
 */
export async function enrichCharactersWithVisualPrompts(
	characters: CalibratedCharacter[],
	background: ProjectBackground,
	episodeScripts: EpisodeRawScript[]
): Promise<CalibratedCharacter[]> {
	const keyCharacters = characters.filter(
		(c) => c.importance === "protagonist" || c.importance === "supporting"
	);

	if (keyCharacters.length === 0) return characters;

	const eraFashionGuidance = getEraFashionGuidance(background);

	const systemPrompt = `你是好莱坞顶级角色设计大师。

【剧本信息】
剧名：《${background.title}》
类型：${background.genre || "未知类型"}
时代：${background.era || "现代"}
故事年份：${background.storyStartYear ? `${background.storyStartYear}年` : "未指定"}${background.storyEndYear && background.storyEndYear !== background.storyStartYear ? ` - ${background.storyEndYear}年` : ""}
总集数：${episodeScripts.length}集

${eraFashionGuidance}

【故事大纲】
${background.outline?.slice(0, 1200) || "无"}

【人物小传】
${background.characterBios?.slice(0, 1200) || "无"}

【6层身份锚点】
① 骨相层: faceShape, jawline, cheekbones
② 五官层: eyeShape, eyeDetails, noseShape, lipShape
③ 辨识标记层: uniqueMarks (至少2-3个独特标记)
④ 色彩锚点层: colorAnchors (iris, hair, skin, lips - Hex色值)
⑤ 皮肤纹理层: skinTexture
⑥ 发型锚点层: hairStyle, hairlineDetails

【负面提示词】avoid + styleExclusions

请返回JSON格式（单角色对象，不要数组）：
{
  "name": "角色名",
  "detailedDescription": "中文角色描述（100-200字）",
  "visualPromptEn": "English visual prompt, 40-60 words",
  "visualPromptZh": "中文视觉提示词",
  "clothingStyle": "服装风格",
  "identityAnchors": {
    "faceShape": "...", "jawline": "...", "cheekbones": "...",
    "eyeShape": "...", "eyeDetails": "...", "noseShape": "...", "lipShape": "...",
    "uniqueMarks": ["...", "..."],
    "colorAnchors": { "iris": "#...", "hair": "#...", "skin": "#...", "lips": "#..." },
    "skinTexture": "...", "hairStyle": "...", "hairlineDetails": "..."
  },
  "negativePrompt": {
    "avoid": ["..."],
    "styleExclusions": ["anime", "cartoon", "painting", "sketch"]
  }
}`;

	// Process one character at a time to avoid token overflow
	const designMap = new Map<string, Record<string, unknown>>();

	for (let i = 0; i < keyCharacters.length; i++) {
		const c = keyCharacters[i];

		const userPrompt = `请为以下角色生成专业视觉提示词和6层身份锚点：

${c.name}（${c.importance === "protagonist" ? "主角" : "重要配角"}）
- 身份：${c.role || "未知"}
- 年龄：${c.age || "未知"}
- 性别：${c.gender || "未知"}
- 出场：${c.appearanceCount}次`;

		try {
			const result = await callFeatureAPI(
				"script_analysis",
				systemPrompt,
				userPrompt,
				{ maxTokens: 4096 }
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
			const design = parsed.characters ? parsed.characters[0] : parsed;
			if (design) {
				designMap.set(design.name || c.name, design);
			}
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			console.warn(
				`[enrichCharacters] ${c.name} generation failed (non-blocking):`,
				err.message
			);
		}
	}

	// Merge into character data
	return characters.map((c) => {
		const design = designMap.get(c.name);
		if (!design) return c;

		const anchors = design.identityAnchors as
			| Record<string, unknown>
			| undefined;

		const facialFeatures = anchors
			? [
					anchors.faceShape && `Face: ${anchors.faceShape}`,
					anchors.eyeShape && `Eyes: ${anchors.eyeShape}`,
					anchors.eyeDetails,
					anchors.noseShape && `Nose: ${anchors.noseShape}`,
					anchors.lipShape && `Lips: ${anchors.lipShape}`,
				]
					.filter(Boolean)
					.join(", ")
			: (design.facialFeatures as string | undefined);

		const uniqueMarks = anchors?.uniqueMarks
			? Array.isArray(anchors.uniqueMarks)
				? (anchors.uniqueMarks as string[]).join("; ")
				: String(anchors.uniqueMarks)
			: (design.uniqueMarks as string | undefined);

		return {
			...c,
			role: (design.detailedDescription as string) || c.role,
			visualPromptEn: design.visualPromptEn as string | undefined,
			visualPromptZh: design.visualPromptZh as string | undefined,
			facialFeatures,
			uniqueMarks,
			clothingStyle: design.clothingStyle as string | undefined,
			identityAnchors: anchors as CalibratedCharacter["identityAnchors"],
			negativePrompt:
				design.negativePrompt as CalibratedCharacter["negativePrompt"],
		};
	});
}
