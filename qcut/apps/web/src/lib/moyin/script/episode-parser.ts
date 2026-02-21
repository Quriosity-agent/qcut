/**
 * Episode Parser — Chinese screenplay rule-based parser.
 * Ported from moyin-creator src/lib/script/episode-parser.ts
 *
 * Parses standard Chinese screenplay format into structured data:
 * - Episode markers: 第X集
 * - Scene headers: **1-1日 内 沪上 张家**
 * - Character lines: 人物：张明、张父
 * - Subtitles: 【字幕：2002年夏】
 * - Action lines: △窗外栀子花绽放...
 * - Dialogue: 张父：（喝酒）我们明明真是太有出息了！
 */

import type {
	EpisodeRawScript,
	SceneRawContent,
	DialogueLine,
	ProjectBackground,
	ScriptData,
	Episode,
	ScriptScene,
	ScriptCharacter,
} from "@/types/moyin-script";

// ==================== Location Cleaning ====================

function cleanLocationString(location: string): string {
	if (!location) return "";
	let cleaned = location.replace(/\s*人物[\uff1a:].*/g, "");
	cleaned = cleaned.replace(/\s*角色[\uff1a:].*/g, "");
	cleaned = cleaned.replace(/\s*时间[\uff1a:].*/g, "");
	return cleaned.trim();
}

// ==================== Full Script Parsing ====================

/**
 * Parse complete screenplay text — extract background info and episodes.
 */
export function parseFullScript(fullText: string): {
	background: ProjectBackground;
	episodes: EpisodeRawScript[];
} {
	const titleMatch = fullText.match(/[《「]([^》」]+)[》」]/);
	const title = titleMatch ? titleMatch[1] : "未命名剧本";

	const outlineMatch = fullText.match(
		/(?:\*{0,2}大纲[：:]?\*{0,2}|【大纲】)([\s\S]*?)(?=(?:\*{0,2}人物小传[：:]|【人物|第[一二三四五六七八九十\d]+集))/i,
	);
	const outline = outlineMatch ? outlineMatch[1].trim() : "";

	const characterBiosMatch = fullText.match(
		/(?:\*{0,2}人物小传[：:]\*{0,2}|【人物小传】)([\s\S]*?)(?=\*{0,2}第[一二三四五六七八九十\d]+集)/i,
	);
	const characterBios = characterBiosMatch
		? characterBiosMatch[1].trim()
		: "";

	const { era, timelineSetting, storyStartYear, storyEndYear } =
		extractTimelineInfo(outline, characterBios);
	const genre = detectGenre(outline, characterBios);
	const worldSetting = extractWorldSetting(outline, characterBios);
	const themes = extractThemes(outline, characterBios);
	const episodes = parseEpisodes(fullText);

	return {
		background: {
			title,
			outline,
			characterBios,
			era,
			timelineSetting,
			storyStartYear,
			storyEndYear,
			genre,
			worldSetting,
			themes,
		},
		episodes,
	};
}

// ==================== Timeline Extraction ====================

function extractTimelineInfo(
	outline: string,
	characterBios: string,
): {
	era: string;
	timelineSetting?: string;
	storyStartYear?: number;
	storyEndYear?: number;
} {
	const fullText = `${outline}\n${characterBios}`;

	let storyStartYear: number | undefined;
	let storyEndYear: number | undefined;
	let timelineSetting: string | undefined;

	const rangeMatch = fullText.match(
		/(\d{4})\s*[-至到~]\s*(\d{4})\s*年?/,
	);
	if (rangeMatch) {
		storyStartYear = Number.parseInt(rangeMatch[1]);
		storyEndYear = Number.parseInt(rangeMatch[2]);
		timelineSetting = `${storyStartYear}年 - ${storyEndYear}年`;
	} else {
		const singleYearMatch = fullText.match(
			/(\d{4})年([\u4e00-\u9fa5]{0,6})/,
		);
		if (singleYearMatch) {
			storyStartYear = Number.parseInt(singleYearMatch[1]);
			const season = singleYearMatch[2] || "";
			timelineSetting = season
				? `${storyStartYear}年${season}`
				: `${storyStartYear}年`;
		}
	}

	const eraPatterns = [
		/(现代|当代|近代|民国|清末|清朝|明朝|宋朝|唐朝|汉朝|三国|战国|春秋|古代|远古|未来)/,
		/(二十世纪|二十一世纪|20世纪|21世纪|\d{2}年代)/,
	];

	let era = "现代";
	for (const pattern of eraPatterns) {
		const eraMatch = fullText.match(pattern);
		if (eraMatch) {
			era = eraMatch[1];
			break;
		}
	}

	if (storyStartYear) {
		if (storyStartYear >= 2000) era = "现代";
		else if (storyStartYear >= 1949) era = "现代（新中国）";
		else if (storyStartYear >= 1912) era = "民国";
		else if (storyStartYear >= 1840) era = "清末/近代";
	}

	return { era, timelineSetting, storyStartYear, storyEndYear };
}

// ==================== Genre / World / Themes ====================

function detectGenre(outline: string, characterBios: string): string {
	const fullText = `${outline}\n${characterBios}`;
	const genrePatterns: Array<{ keywords: RegExp; genre: string }> = [
		{ keywords: /武侠|江湖|门派|武功|剑|刀法|内力|武林/, genre: "武侠" },
		{ keywords: /仙侠|修仙|灵气|渡劫|飞升|法宝|灵根/, genre: "仙侠" },
		{ keywords: /玄幻|魔法|异世界|龙族|精灵|魔族/, genre: "玄幻" },
		{ keywords: /科幻|太空|星际|机器人|AI|外星|未来世界/, genre: "科幻" },
		{ keywords: /悬疑|谋杀|侦探|推理|凶手|案件|警察/, genre: "悬疑" },
		{ keywords: /恐怖|鬼|灵异|诅咒|闹鬼/, genre: "恐怖" },
		{
			keywords: /商战|创业|公司|股权|融资|上市|商业帝国|企业/,
			genre: "商战",
		},
		{ keywords: /宫斗|后宫|嫔妃|皇上|太后|选秀/, genre: "宫斗" },
		{ keywords: /宅斗|嫡女|庶出|大宅门|内宅/, genre: "宅斗" },
		{ keywords: /谍战|特工|间谍|密码|潜伏|情报/, genre: "谍战" },
		{ keywords: /军旅|军队|战场|部队|军营|战争/, genre: "军旅" },
		{ keywords: /刑侦|刑警|破案|嫌疑人|法医/, genre: "刑侦" },
		{ keywords: /医疗|医院|手术|医生|患者|急诊/, genre: "医疗" },
		{ keywords: /律政|律师|法庭|辩护|诉讼/, genre: "律政" },
		{ keywords: /校园|大学|高中|同学|学校|老师/, genre: "校园" },
		{ keywords: /爱情|恋爱|暗恋|表白|甜蜜|分手/, genre: "爱情" },
		{ keywords: /家庭|父母|兄弟|姐妹|亲情|家族/, genre: "家庭" },
		{ keywords: /喜剧|搞笑|幽默|滑稽/, genre: "喜剧" },
		{ keywords: /历史|朝廷|天子|大臣|变法|改革/, genre: "历史" },
		{ keywords: /农村|乡村|种地|脱贫|振兴/, genre: "乡村" },
	];

	for (const { keywords, genre } of genrePatterns) {
		if (keywords.test(fullText)) return genre;
	}
	return "";
}

function extractWorldSetting(outline: string, characterBios: string): string {
	const fullText = `${outline}\n${characterBios}`;
	const patterns = [
		/(?:世界观|世界设定|背景设定)[：:] *([^\n]{10,200})/,
		/(?:故事发生在|故事背景[：:是]) *([^\n]{10,200})/,
		/(?:设定[：:]) *([^\n]{10,200})/,
	];
	for (const pattern of patterns) {
		const match = fullText.match(pattern);
		if (match) return match[1].trim();
	}
	return "";
}

function extractThemes(outline: string, characterBios: string): string[] {
	const fullText = `${outline}\n${characterBios}`;
	const themes: string[] = [];
	const themePatterns: Array<{ keywords: RegExp; theme: string }> = [
		{ keywords: /奋斗|拼搏|逆袭|成长/, theme: "奋斗" },
		{ keywords: /复仇|报仇|雪恨/, theme: "复仇" },
		{ keywords: /爱情|爱恋|真爱|恋爱/, theme: "爱情" },
		{ keywords: /亲情|家庭|家人/, theme: "亲情" },
		{ keywords: /友情|兄弟|义气|忠诚/, theme: "友情" },
		{ keywords: /权力|争斗|权谋|阴谋/, theme: "权谋" },
		{ keywords: /正义|公平|法治|真相/, theme: "正义" },
		{ keywords: /自由|解放|独立/, theme: "自由" },
		{ keywords: /救赎|原谅|和解|忏悔/, theme: "救赎" },
		{ keywords: /背叛|出卖|信任/, theme: "背叛与信任" },
		{ keywords: /命运|宿命|天命/, theme: "命运" },
		{ keywords: /战争|和平|反战/, theme: "战争与和平" },
		{ keywords: /传承|继承|使命/, theme: "传承" },
		{ keywords: /生死|生命|死亡|牺牲/, theme: "生死" },
	];

	for (const { keywords, theme } of themePatterns) {
		if (keywords.test(fullText) && !themes.includes(theme)) {
			themes.push(theme);
		}
	}
	return themes.slice(0, 5);
}

// ==================== Episode & Scene Parsing ====================

/**
 * Parse episode boundaries from text.
 */
export function parseEpisodes(text: string): EpisodeRawScript[] {
	const episodes: EpisodeRawScript[] = [];
	const episodeRegex =
		/\*{0,2}第([\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\d]+)集[\uff1a:]?\s*([^\n\*]*?)\*{0,2}(?=\n|$)/g;
	const matches = [...text.matchAll(episodeRegex)];

	if (matches.length === 0) {
		const scenes = parseScenes(text);
		return [
			{
				episodeIndex: 1,
				title: "第一集",
				rawContent: text,
				scenes,
				shotGenerationStatus: "idle",
			},
		];
	}

	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const episodeIndex = chineseToNumber(match[1]);
		const rawTitle = match[2]
			?.trim()
			.replace(/^\*+|\*+$/g, "")
			.trim() || "";
		const episodeTitle = rawTitle
			? `第${episodeIndex}集：${rawTitle}`
			: `第${episodeIndex}集`;

		const startIndex = match.index! + match[0].length;
		const endIndex =
			i < matches.length - 1 ? matches[i + 1].index! : text.length;
		const rawContent = text.slice(startIndex, endIndex).trim();
		const scenes = parseScenes(rawContent);
		const season = extractSeasonFromScenes(scenes);

		episodes.push({
			episodeIndex,
			title: episodeTitle,
			rawContent,
			scenes,
			shotGenerationStatus: "idle",
			season,
		});
	}
	return episodes;
}

/**
 * Parse scenes within a single episode.
 */
export function parseScenes(episodeText: string): SceneRawContent[] {
	const scenes: SceneRawContent[] = [];
	const sceneHeaderRegex =
		/\*{0,2}(\d+-\d+)\s*(日|夜|晨|暮|黄昏|黎明|清晨|傍晚)\s*(内|外|内\/外)\s+([^\*\n]+)\*{0,2}/g;
	const sceneMatches = [...episodeText.matchAll(sceneHeaderRegex)];

	if (sceneMatches.length === 0) {
		return parseAlternativeSceneFormat(episodeText);
	}

	for (let i = 0; i < sceneMatches.length; i++) {
		const match = sceneMatches[i];
		const sceneNumber = match[1];
		const timeOfDay = match[2];
		const interior = match[3];
		const location = match[4]?.trim() || "未知地点";
		const startIndex = match.index! + match[0].length;
		const endIndex =
			i < sceneMatches.length - 1
				? sceneMatches[i + 1].index!
				: episodeText.length;
		const content = episodeText.slice(startIndex, endIndex).trim();

		scenes.push({
			sceneHeader: `${sceneNumber} ${timeOfDay} ${interior} ${location}`,
			characters: parseCharacterNames(content),
			content,
			dialogues: parseDialogues(content),
			actions: parseActions(content),
			subtitles: parseSubtitles(content),
			weather: detectWeather(content),
			timeOfDay,
		});
	}
	return scenes;
}

function parseAlternativeSceneFormat(text: string): SceneRawContent[] {
	const scenes: SceneRawContent[] = [];
	const altRegex = /(?:场景\s*(\d+)|【场景[：:]?\s*([^\】]+)】)/g;
	const matches = [...text.matchAll(altRegex)];

	if (matches.length > 0) {
		for (let i = 0; i < matches.length; i++) {
			const match = matches[i];
			const startIndex = match.index! + match[0].length;
			const endIndex =
				i < matches.length - 1 ? matches[i + 1].index! : text.length;
			const content = text.slice(startIndex, endIndex).trim();
			scenes.push({
				sceneHeader: match[0].replace(/[【】]/g, ""),
				characters: parseCharacterNames(content),
				content,
				dialogues: parseDialogues(content),
				actions: parseActions(content),
				subtitles: parseSubtitles(content),
			});
		}
	} else {
		scenes.push({
			sceneHeader: "主场景",
			characters: parseCharacterNames(text),
			content: text,
			dialogues: parseDialogues(text),
			actions: parseActions(text),
			subtitles: parseSubtitles(text),
		});
	}
	return scenes;
}

// ==================== Sub-parsers ====================

function detectWeather(content: string): string | undefined {
	if (/暴雨|大雨|倾盆大雨/.test(content)) return "暴雨";
	if (/小雨|细雨|毛毛雨/.test(content)) return "小雨";
	if (/雨|淅沥|润湿/.test(content)) return "雨";
	if (/暴风雪/.test(content)) return "暴雪";
	if (/雪|飘雪|雪花/.test(content)) return "雪";
	if (/大雾|浓雾/.test(content)) return "大雾";
	if (/雾|薄雾|雾气/.test(content)) return "雾";
	if (/狂风|阵风|暴风/.test(content)) return "狂风";
	if (/风|微风|清风/.test(content)) return "微风";
	if (/阴天|乌云/.test(content)) return "阴";
	if (/晴朗|艳阳/.test(content)) return "晴";
	if (/电闪雷鸣|打雷|闪电/.test(content)) return "雷雨";
	return undefined;
}

function extractSeasonFromScenes(
	scenes: SceneRawContent[],
): string | undefined {
	for (const scene of scenes) {
		for (const subtitle of scene.subtitles) {
			const seasonMatch = subtitle.match(
				/(春天?|夏天?|秋天?|冬天?|初春|仲夏|深秋|隆冬|盛夏|暖春|寒冬)/,
			);
			if (seasonMatch) {
				const s = seasonMatch[1];
				if (s.includes("春")) return "春";
				if (s.includes("夏")) return "夏";
				if (s.includes("秋")) return "秋";
				if (s.includes("冬")) return "冬";
			}
		}
	}
	return undefined;
}

function parseCharacterNames(text: string): string[] {
	const characters: Set<string> = new Set();
	const charLineMatch = text.match(/人物[：:]\s*([^\n]+)/);
	if (charLineMatch) {
		for (const c of charLineMatch[1].split(/[、,，]/)) {
			const name = c.trim();
			if (name) characters.add(name);
		}
	}
	const dialogueRegex =
		/^([^：:（\(【\n]{1,10})[：:](?:\s*[（\(][^）\)]+[）\)])?/gm;
	for (const m of text.matchAll(dialogueRegex)) {
		const name = m[1].trim();
		if (name && !name.match(/^[△【字幕旁白VO场景]/)) {
			characters.add(name);
		}
	}
	return Array.from(characters);
}

function parseDialogues(text: string): DialogueLine[] {
	const dialogues: DialogueLine[] = [];
	const dialogueRegex =
		/^([^：:（\(【\n△]{1,10})[：:]\s*(?:[（\(]([^）\)]+)[）\)])?\s*(.+)$/gm;

	for (const match of text.matchAll(dialogueRegex)) {
		const character = match[1].trim();
		const parenthetical = match[2]?.trim();
		const line = match[3]?.trim();
		if (character && line && !character.match(/^[字幕旁白场景人物]/)) {
			dialogues.push({ character, parenthetical, line });
		}
	}
	return dialogues;
}

function parseActions(text: string): string[] {
	const actions: string[] = [];
	for (const m of text.matchAll(/^△(.+)$/gm)) {
		const action = m[1].trim();
		if (action) actions.push(action);
	}
	return actions;
}

function parseSubtitles(text: string): string[] {
	const subtitles: string[] = [];
	for (const m of text.matchAll(/【([^】]+)】/g)) {
		subtitles.push(m[1]);
	}
	return subtitles;
}

// ==================== Chinese Number Conversion ====================

function chineseToNumber(chinese: string): number {
	if (/^\d+$/.test(chinese)) return Number.parseInt(chinese, 10);

	const chineseNums: Record<string, number> = {
		零: 0, 一: 1, 二: 2, 三: 3, 四: 4,
		五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
		十: 10, 百: 100, 千: 1000,
	};

	let result = 0;
	let temp = 0;
	for (const char of chinese) {
		const num = chineseNums[char];
		if (num === undefined) continue;
		if (num >= 10) {
			if (temp === 0) temp = 1;
			result += temp * num;
			temp = 0;
		} else {
			temp = num;
		}
	}
	result += temp;
	return result || 1;
}

// ==================== Character Bio Parsing ====================

/**
 * Parse character bios section into structured characters.
 */
export function parseCharacterBios(bios: string): ScriptCharacter[] {
	const characters: ScriptCharacter[] = [];
	const charRegex =
		/([^：:\n，,]+?)(?:[（\(](\d+岁?)[）\)])?[：:]\s*([^\n]+(?:\n(?![^：:\n]+[：:])[^\n]+)*)/g;

	let index = 1;
	for (const match of bios.matchAll(charRegex)) {
		const name = match[1].trim();
		const age = match[2]?.replace("岁", "") || "";
		const description = match[3].trim();
		if (name.length > 10 || name.match(/^[第一二三四五六七八九十\d]/))
			continue;

		characters.push({
			id: `char_${index}`,
			name,
			age,
			role: description,
			personality: extractPersonality(description),
			traits: extractTraits(description),
		});
		index++;
	}
	return characters;
}

function extractPersonality(description: string): string {
	const keywords = ["性格", "为人", "品性", "脾气"];
	for (const keyword of keywords) {
		const match = description.match(new RegExp(`${keyword}[^，。,\\.]+`));
		if (match) return match[0];
	}
	return "";
}

function extractTraits(description: string): string {
	const traits: string[] = [];
	const patterns = [
		/聪[明慧]/,
		/坚[韧强]/,
		/勤[劳奋]/,
		/憨厚/,
		/老实/,
		/吃苦耐劳/,
		/脚踏实地/,
		/感恩/,
	];
	for (const pattern of patterns) {
		const match = description.match(pattern);
		if (match) traits.push(match[0]);
	}
	return traits.join("、");
}

// ==================== Conversion to ScriptData ====================

/**
 * Convert parsed screenplay into QCut's ScriptData format.
 */
export function convertToScriptData(
	background: ProjectBackground,
	episodeScripts: EpisodeRawScript[],
): ScriptData {
	const mainCharacters = parseCharacterBios(background.characterBios);
	const additionalCharacters = extractCharactersFromScenes(
		episodeScripts,
		mainCharacters,
	);
	const characters = [...mainCharacters, ...additionalCharacters];
	const episodes: Episode[] = [];
	const scenes: ScriptScene[] = [];
	let sceneIndex = 1;

	for (const ep of episodeScripts) {
		const episodeId = `ep_${ep.episodeIndex}`;
		const sceneIds: string[] = [];

		for (const scene of ep.scenes) {
			const sceneId = `scene_${sceneIndex}`;
			sceneIds.push(sceneId);
			const headerParts = scene.sceneHeader.split(/\s+/);
			const timeOfDay = headerParts[1] || "日";
			const rawLocation =
				headerParts.slice(3).join(" ") ||
				headerParts[headerParts.length - 1] ||
				"未知";
			const location = cleanLocationString(rawLocation);

			scenes.push({
				id: sceneId,
				name: `${ep.episodeIndex}-${sceneIndex} ${location}`,
				location,
				time: normalizeTime(timeOfDay),
				atmosphere: detectAtmosphere(scene.content),
			});
			sceneIndex++;
		}

		episodes.push({
			id: episodeId,
			index: ep.episodeIndex,
			title: ep.title,
			description: ep.rawContent.replace(/\*{1,2}/g, "").slice(0, 100).trim() + "...",
			sceneIds,
		});
	}

	return {
		title: background.title,
		genre: detectGenre(background.outline, background.characterBios),
		logline: extractLogline(background.outline),
		language: "中文",
		characters,
		episodes,
		scenes,
		storyParagraphs: [],
	};
}

// ==================== Helpers ====================

function extractCharactersFromScenes(
	episodeScripts: EpisodeRawScript[],
	existingCharacters: ScriptCharacter[],
): ScriptCharacter[] {
	const existingNames = new Set(existingCharacters.map((c) => c.name));
	const appearanceCount = new Map<string, number>();

	for (const ep of episodeScripts) {
		for (const scene of ep.scenes) {
			for (const charName of scene.characters) {
				const name = charName.trim();
				if (name && name.length >= 1 && name.length <= 6) {
					appearanceCount.set(
						name,
						(appearanceCount.get(name) || 0) + 1,
					);
				}
			}
			for (const dialogue of scene.dialogues) {
				const name = dialogue.character.trim();
				if (name && name.length >= 1 && name.length <= 6) {
					appearanceCount.set(
						name,
						(appearanceCount.get(name) || 0) + 1,
					);
				}
			}
		}
	}

	const sortedNames = [...appearanceCount.entries()]
		.filter(([name]) => !existingNames.has(name))
		.sort((a, b) => b[1] - a[1]);

	let index = existingCharacters.length + 1;
	return sortedNames.map(([name, count]) => ({
		id: `char_${index++}`,
		name,
		role:
			count > 5
				? `重要配角（出场${count}次）`
				: `次要角色（出场${count}次）`,
	}));
}

function normalizeTime(time: string): string {
	const timeMap: Record<string, string> = {
		日: "day",
		夜: "night",
		晨: "dawn",
		暮: "dusk",
		黄昏: "dusk",
		黎明: "dawn",
		清晨: "dawn",
		傍晚: "dusk",
	};
	return timeMap[time] || "day";
}

function detectAtmosphere(content: string): string {
	if (content.match(/紧张|危险|冲突|打斗|怒/)) return "紧张";
	if (content.match(/温馨|幸福|笑|欢/)) return "温馨";
	if (content.match(/悲伤|哭|痛|泪/)) return "悲伤";
	if (content.match(/神秘|阴森|黑暗/)) return "神秘";
	return "平静";
}

function extractLogline(outline: string): string {
	const firstSentence = outline.match(/^[^。！？\n]+[。！？]/);
	return firstSentence ? firstSentence[0] : outline.slice(0, 100);
}
