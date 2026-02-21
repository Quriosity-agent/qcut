import { describe, it, expect, vi } from "vitest";
import {
	normalizeTimeValue,
	detectInputType,
	countShotMarkers,
	parseScript,
	generateScriptFromIdea,
	type LLMAdapter,
} from "../script-parser";
import {
	PARSE_SYSTEM_PROMPT,
	CREATIVE_SCRIPT_PROMPT,
	SHOT_GENERATION_SYSTEM_PROMPT,
	STORYBOARD_STRUCTURE_PROMPT,
} from "../system-prompts";

// ==================== Fixtures ====================

const VALID_SCRIPT_DATA = {
	title: "Test Film",
	genre: "drama",
	logline: "A test story about testing",
	language: "en",
	characters: [
		{
			id: "char_1",
			name: "Alice",
			gender: "Female",
			age: "28",
			role: "Protagonist",
			personality: "Determined",
			traits: "Smart",
			skills: "Coding",
			keyActions: "Saves the day",
			appearance: "Tall with dark hair",
			relationships: "Friend of Bob",
			tags: ["protagonist"],
			notes: "",
		},
	],
	episodes: [
		{
			id: "ep_1",
			index: 1,
			title: "Pilot",
			description: "It begins",
			sceneIds: ["scene_1", "scene_2"],
		},
	],
	scenes: [
		{
			id: "scene_1",
			name: "Morning Office",
			location: "Downtown office building",
			time: "白天",
			atmosphere: "Busy and tense",
			visualPrompt: "Modern glass office, morning light streaming in",
			tags: ["office", "modern"],
			notes: "",
		},
		{
			id: "scene_2",
			name: "Night Alley",
			location: "Dark alley in the city",
			time: "深夜",
			atmosphere: "Eerie and quiet",
			visualPrompt:
				"Dimly lit alley with neon signs reflecting on wet pavement",
			tags: ["urban", "night"],
			notes: "",
		},
	],
	storyParagraphs: [
		{ id: 1, text: "Alice walks into the office.", sceneRefId: "scene_1" },
		{ id: 2, text: "She discovers the secret.", sceneRefId: "scene_2" },
	],
};

function makeMockLLM(): LLMAdapter {
	return vi.fn<LLMAdapter>();
}

// ==================== normalizeTimeValue ====================

describe("normalizeTimeValue", () => {
	it("returns 'day' for undefined input", () => {
		expect(normalizeTimeValue(undefined)).toBe("day");
	});

	it("returns 'day' for empty string input", () => {
		expect(normalizeTimeValue("")).toBe("day");
	});

	describe("Chinese time word mappings", () => {
		const chineseMap: Array<[string, string]> = [
			["白天", "day"],
			["日间", "day"],
			["上午", "day"],
			["下午", "day"],
			["夜晚", "night"],
			["夜间", "night"],
			["深夜", "midnight"],
			["半夜", "midnight"],
			["黄昏", "dusk"],
			["日落", "dusk"],
			["催晚", "dusk"],
			["黎明", "dawn"],
			["早晨", "dawn"],
			["清晨", "dawn"],
			["日出", "dawn"],
			["中午", "noon"],
			["正午", "noon"],
		];

		for (const [chinese, expected] of chineseMap) {
			it(`maps "${chinese}" to "${expected}"`, () => {
				expect(normalizeTimeValue(chinese)).toBe(expected);
			});
		}
	});

	describe("English pass-through values", () => {
		const englishValues = ["day", "night", "dawn", "dusk", "noon", "midnight"];

		for (const value of englishValues) {
			it(`passes through "${value}" unchanged`, () => {
				expect(normalizeTimeValue(value)).toBe(value);
			});
		}
	});

	it("returns 'day' for unknown values", () => {
		expect(normalizeTimeValue("unknown_time")).toBe("day");
		expect(normalizeTimeValue("afternoon_tea")).toBe("day");
		expect(normalizeTimeValue("gibberish")).toBe("day");
	});

	it("is case insensitive for English values", () => {
		expect(normalizeTimeValue("DAY")).toBe("day");
		expect(normalizeTimeValue("Night")).toBe("night");
		expect(normalizeTimeValue("DAWN")).toBe("dawn");
		expect(normalizeTimeValue("Dusk")).toBe("dusk");
		expect(normalizeTimeValue("NOON")).toBe("noon");
		expect(normalizeTimeValue("Midnight")).toBe("midnight");
	});

	it("trims whitespace from input", () => {
		expect(normalizeTimeValue("  day  ")).toBe("day");
		expect(normalizeTimeValue("  白天  ")).toBe("day");
	});
});

// ==================== detectInputType ====================

describe("detectInputType", () => {
	describe("storyboard_script detection", () => {
		it("detects 镜头 markers with square brackets", () => {
			const input =
				"[镜头 1] A wide shot of the city\n[镜头 2] Close-up of character";
			expect(detectInputType(input)).toBe("storyboard_script");
		});

		it("detects 镜头 markers with Chinese brackets", () => {
			const input = "【镜头 1】A wide shot\n【镜头 2】Close-up";
			expect(detectInputType(input)).toBe("storyboard_script");
		});

		it("detects bold 镜头 markers in markdown", () => {
			const input = "**镜头 1** A wide shot\n**镜头 2** Close-up";
			expect(detectInputType(input)).toBe("storyboard_script");
		});
	});

	describe("mv_concept detection", () => {
		it("detects 'MV' keyword", () => {
			expect(detectInputType("This is an MV about summer love")).toBe(
				"mv_concept"
			);
		});

		it("detects 'music video' keyword (case insensitive)", () => {
			expect(detectInputType("A Music Video for the new album")).toBe(
				"mv_concept"
			);
		});

		it("detects 'music video' with flexible spacing", () => {
			expect(detectInputType("A musicvideo concept")).toBe("mv_concept");
		});
	});

	describe("ad_brief detection", () => {
		it("detects 'commercial' keyword", () => {
			expect(detectInputType("A 30-second commercial for energy drinks")).toBe(
				"ad_brief"
			);
		});

		it("detects 'advertisement' keyword", () => {
			expect(detectInputType("Create an advertisement for shoes")).toBe(
				"ad_brief"
			);
		});

		it("detects 'ad brief' keyword", () => {
			expect(detectInputType("This is the ad brief for the campaign")).toBe(
				"ad_brief"
			);
		});
	});

	describe("trailer_script detection", () => {
		it("detects 'trailer' keyword", () => {
			expect(detectInputType("A trailer for the upcoming thriller")).toBe(
				"trailer_script"
			);
		});

		it("detects 'teaser' keyword", () => {
			expect(detectInputType("A teaser for the new season")).toBe(
				"trailer_script"
			);
		});
	});

	describe("short_video detection", () => {
		it("detects 'tiktok' keyword", () => {
			expect(detectInputType("A tiktok about cooking hacks")).toBe(
				"short_video"
			);
		});

		it("detects 'reels' keyword", () => {
			expect(detectInputType("Create a reels video for Instagram")).toBe(
				"short_video"
			);
		});

		it("detects 'shorts' keyword", () => {
			expect(detectInputType("YouTube shorts idea for tech reviews")).toBe(
				"short_video"
			);
		});

		it("detects 'short video' keyword", () => {
			expect(detectInputType("A short video about daily life")).toBe(
				"short_video"
			);
		});
	});

	describe("length-based detection", () => {
		it("detects 'one_liner' for short text (<100 chars, <=3 lines)", () => {
			expect(detectInputType("A love story in a coffee shop")).toBe(
				"one_liner"
			);
		});

		it("detects 'one_liner' for single-line short text", () => {
			expect(detectInputType("Two strangers meet on a train")).toBe(
				"one_liner"
			);
		});

		it("detects 'story_outline' for medium text (<=10 lines)", () => {
			const lines = Array.from(
				{ length: 8 },
				(_, i) => `Line ${i + 1}: Something happens in the story here.`
			);
			expect(detectInputType(lines.join("\n"))).toBe("story_outline");
		});

		it("detects 'detailed_story' for long text (>10 lines)", () => {
			const lines = Array.from(
				{ length: 15 },
				(_, i) => `Line ${i + 1}: A detailed paragraph of the screenplay.`
			);
			expect(detectInputType(lines.join("\n"))).toBe("detailed_story");
		});

		it("classifies 3-line text under 100 chars as 'one_liner'", () => {
			const input = "Line one.\nLine two.\nLine three.";
			expect(detectInputType(input)).toBe("one_liner");
		});

		it("classifies 4-line text as 'story_outline' not 'one_liner'", () => {
			const input = "Line 1.\nLine 2.\nLine 3.\nLine 4.";
			expect(detectInputType(input)).toBe("story_outline");
		});
	});

	it("is case insensitive for keyword detection", () => {
		expect(detectInputType("COMMERCIAL for product")).toBe("ad_brief");
		expect(detectInputType("TRAILER for movie")).toBe("trailer_script");
		expect(detectInputType("TIKTOK dance challenge")).toBe("short_video");
	});
});

// ==================== countShotMarkers ====================

describe("countShotMarkers", () => {
	it("counts 镜头 markers with square brackets", () => {
		const input = "[镜头 1] Wide shot\n[镜头 2] Medium shot\n[镜头 3] Close-up";
		expect(countShotMarkers(input)).toBe(3);
	});

	it("counts 镜头 markers with Chinese brackets", () => {
		const input = "【镜头 1】Wide shot\n【镜头 2】Medium shot";
		expect(countShotMarkers(input)).toBe(2);
	});

	it("counts 场景 markers", () => {
		const input = "场景 1: The office\n场景 2: The park\n场景 3: The hospital";
		expect(countShotMarkers(input)).toBe(3);
	});

	it("returns 0 for text with no markers", () => {
		const input = "A simple story about a person walking through a park.";
		expect(countShotMarkers(input)).toBe(0);
	});

	it("returns the maximum of shot and scene counts", () => {
		const input =
			"[镜头 1] Shot one\n[镜头 2] Shot two\n场景 1: Scene one\n场景 2: Scene two\n场景 3: Scene three";
		// 2 shot markers, 3 scene markers => max is 3
		expect(countShotMarkers(input)).toBe(3);
	});

	it("does not count bold-only 镜头 markers without brackets", () => {
		// countShotMarkers requires bracket syntax [镜头] or 【镜头】
		// Bold markdown **镜头 1** without brackets is NOT counted
		const input = "**镜头 1** Wide\n**镜头 2** Medium";
		expect(countShotMarkers(input)).toBe(0);
	});

	it("counts bold markdown 镜头 markers with brackets", () => {
		const input = "**[镜头 1]** Wide\n**[镜头 2]** Medium";
		expect(countShotMarkers(input)).toBe(2);
	});
});

// ==================== parseScript ====================

describe("parseScript", () => {
	it("calls LLM adapter with the parse system prompt and user text", async () => {
		const mockLLM = makeMockLLM();
		const responseJson = JSON.stringify(VALID_SCRIPT_DATA);
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(responseJson);

		await parseScript("Some raw script text", mockLLM);

		expect(mockLLM).toHaveBeenCalledOnce();
		const [systemPrompt, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>)
			.mock.calls[0] as [string, string, unknown];
		expect(systemPrompt).toBe(PARSE_SYSTEM_PROMPT);
		expect(userPrompt).toBe("Some raw script text");
	});

	it("adds language prefix when language !== 'auto'", async () => {
		const mockLLM = makeMockLLM();
		const responseJson = JSON.stringify(VALID_SCRIPT_DATA);
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(responseJson);

		await parseScript("Script text", mockLLM, { language: "en" });

		const [, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(userPrompt).toContain("[Language: en]");
		expect(userPrompt).toContain("Script text");
	});

	it("does not add language prefix when language is 'auto'", async () => {
		const mockLLM = makeMockLLM();
		const responseJson = JSON.stringify(VALID_SCRIPT_DATA);
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(responseJson);

		await parseScript("Script text", mockLLM, { language: "auto" });

		const [, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(userPrompt).not.toContain("[Language:");
	});

	it("adds scene count prefix when sceneCount is provided", async () => {
		const mockLLM = makeMockLLM();
		const responseJson = JSON.stringify(VALID_SCRIPT_DATA);
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(responseJson);

		await parseScript("Script text", mockLLM, { sceneCount: 5 });

		const [, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(userPrompt).toContain("[Max scenes: 5]");
	});

	it("combines language and sceneCount prefixes when both provided", async () => {
		const mockLLM = makeMockLLM();
		const responseJson = JSON.stringify(VALID_SCRIPT_DATA);
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(responseJson);

		await parseScript("Script text", mockLLM, {
			language: "zh",
			sceneCount: 3,
		});

		const [, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(userPrompt).toContain("[Max scenes: 3]");
		expect(userPrompt).toContain("[Language: zh]");
	});

	it("normalizes time values in parsed scenes", async () => {
		const mockLLM = makeMockLLM();
		const responseJson = JSON.stringify(VALID_SCRIPT_DATA);
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(responseJson);

		const result = await parseScript("Script text", mockLLM);

		// 白天 should become "day", 深夜 should become "midnight"
		expect(result.scenes[0].time).toBe("day");
		expect(result.scenes[1].time).toBe("midnight");
	});

	it("handles markdown-fenced JSON responses", async () => {
		const mockLLM = makeMockLLM();
		const fencedResponse = `\`\`\`json\n${JSON.stringify(VALID_SCRIPT_DATA)}\n\`\`\``;
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(fencedResponse);

		const result = await parseScript("Script text", mockLLM);

		expect(result.title).toBe("Test Film");
		expect(result.scenes).toHaveLength(2);
	});

	it("handles markdown-fenced JSON without language tag", async () => {
		const mockLLM = makeMockLLM();
		const fencedResponse = `\`\`\`\n${JSON.stringify(VALID_SCRIPT_DATA)}\n\`\`\``;
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(fencedResponse);

		const result = await parseScript("Script text", mockLLM);

		expect(result.title).toBe("Test Film");
	});

	it("throws on response with no JSON", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			"Sorry, I cannot process this request."
		);

		await expect(parseScript("Script text", mockLLM)).rejects.toThrow();
	});

	it("throws on invalid JSON response", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			'```json\n{"title": "broken json\n```'
		);

		await expect(parseScript("Script text", mockLLM)).rejects.toThrow();
	});

	it("passes temperature and maxTokens in LLM options", async () => {
		const mockLLM = makeMockLLM();
		const responseJson = JSON.stringify(VALID_SCRIPT_DATA);
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(responseJson);

		await parseScript("Script text", mockLLM);

		const [, , options] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, { temperature: number; maxTokens: number }];
		expect(options.temperature).toBe(0.7);
		expect(options.maxTokens).toBe(4096);
	});
});

// ==================== generateScriptFromIdea ====================

describe("generateScriptFromIdea", () => {
	it("calls LLM adapter with creative prompt for simple ideas", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			"Generated screenplay text"
		);

		await generateScriptFromIdea("A love story in a coffee shop", mockLLM);

		expect(mockLLM).toHaveBeenCalledOnce();
		const [systemPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(systemPrompt).toBe(CREATIVE_SCRIPT_PROMPT);
	});

	it("uses storyboard structure prompt when input has shot markers", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			"Generated screenplay text"
		);

		const input = "[镜头 1] Wide shot of city\n[镜头 2] Close-up of character";
		await generateScriptFromIdea(input, mockLLM);

		const [systemPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(systemPrompt).toBe(
			CREATIVE_SCRIPT_PROMPT + STORYBOARD_STRUCTURE_PROMPT
		);
	});

	it("passes target duration in user prompt", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			"Generated screenplay text"
		);

		await generateScriptFromIdea("A story idea", mockLLM, {
			targetDuration: "120s",
		});

		const [, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(userPrompt).toContain("Target duration: 120s");
	});

	it("uses default target duration of 60s when not provided", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			"Generated screenplay text"
		);

		await generateScriptFromIdea("A story idea", mockLLM);

		const [, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(userPrompt).toContain("Target duration: 60s");
	});

	it("passes style ID in user prompt when provided", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			"Generated screenplay text"
		);

		await generateScriptFromIdea("A story idea", mockLLM, {
			styleId: "noir",
		});

		const [, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(userPrompt).toContain("Visual style: noir");
	});

	it("does not include style line when styleId is not provided", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			"Generated screenplay text"
		);

		await generateScriptFromIdea("A story idea", mockLLM);

		const [, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(userPrompt).not.toContain("Visual style:");
	});

	it("passes scene count in user prompt when provided", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			"Generated screenplay text"
		);

		await generateScriptFromIdea("A story idea", mockLLM, { sceneCount: 5 });

		const [, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(userPrompt).toContain("Scene count: approximately 5");
	});

	it("uses original shot count for scene count when input has markers", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			"Generated screenplay text"
		);

		const input = "[镜头 1] Wide\n[镜头 2] Medium\n[镜头 3] Close";
		await generateScriptFromIdea(input, mockLLM, { sceneCount: 10 });

		const [, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		// Original shot count (3) should override provided sceneCount
		expect(userPrompt).toContain("must have 3");
	});

	it("includes input type in user prompt", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			"Generated screenplay text"
		);

		await generateScriptFromIdea("A love story", mockLLM);

		const [, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(userPrompt).toContain("[Input type] one_liner");
	});

	it("includes the idea content in user prompt", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(
			"Generated screenplay text"
		);

		const idea = "A detective investigates a haunted mansion";
		await generateScriptFromIdea(idea, mockLLM);

		const [, userPrompt] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, unknown];
		expect(userPrompt).toContain(idea);
	});

	it("returns the raw LLM response string", async () => {
		const mockLLM = makeMockLLM();
		const screenplay = "TITLE: Coffee Love\n\nSCENE 1...\n";
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue(screenplay);

		const result = await generateScriptFromIdea("Coffee love story", mockLLM);

		expect(result).toBe(screenplay);
	});

	it("uses higher maxTokens for inputs with many shot markers", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue("screenplay");

		const shots = Array.from(
			{ length: 8 },
			(_, i) => `[镜头 ${i + 1}] Shot description ${i + 1}`
		);
		await generateScriptFromIdea(shots.join("\n"), mockLLM);

		const [, , options] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, { maxTokens: number }];
		expect(options.maxTokens).toBe(8192);
	});

	it("uses standard maxTokens for inputs with few or no shot markers", async () => {
		const mockLLM = makeMockLLM();
		(mockLLM as ReturnType<typeof vi.fn>).mockResolvedValue("screenplay");

		await generateScriptFromIdea("Simple idea", mockLLM);

		const [, , options] = (mockLLM as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, string, { maxTokens: number }];
		expect(options.maxTokens).toBe(4096);
	});
});

// ==================== System Prompts ====================

describe("system prompts", () => {
	it("PARSE_SYSTEM_PROMPT is a non-empty string", () => {
		expect(typeof PARSE_SYSTEM_PROMPT).toBe("string");
		expect(PARSE_SYSTEM_PROMPT.length).toBeGreaterThan(0);
	});

	it("PARSE_SYSTEM_PROMPT contains ScriptData structure hints", () => {
		expect(PARSE_SYSTEM_PROMPT).toContain("title");
		expect(PARSE_SYSTEM_PROMPT).toContain("genre");
		expect(PARSE_SYSTEM_PROMPT).toContain("characters");
		expect(PARSE_SYSTEM_PROMPT).toContain("scenes");
		expect(PARSE_SYSTEM_PROMPT).toContain("episodes");
		expect(PARSE_SYSTEM_PROMPT).toContain("storyParagraphs");
	});

	it("PARSE_SYSTEM_PROMPT requires JSON output", () => {
		expect(PARSE_SYSTEM_PROMPT).toContain("JSON");
	});

	it("CREATIVE_SCRIPT_PROMPT is a non-empty string", () => {
		expect(typeof CREATIVE_SCRIPT_PROMPT).toBe("string");
		expect(CREATIVE_SCRIPT_PROMPT.length).toBeGreaterThan(0);
	});

	it("CREATIVE_SCRIPT_PROMPT mentions screenplay format", () => {
		expect(CREATIVE_SCRIPT_PROMPT).toContain("screenplay");
	});

	it("SHOT_GENERATION_SYSTEM_PROMPT is a non-empty string", () => {
		expect(typeof SHOT_GENERATION_SYSTEM_PROMPT).toBe("string");
		expect(SHOT_GENERATION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
	});

	it("SHOT_GENERATION_SYSTEM_PROMPT contains shot terminology", () => {
		expect(SHOT_GENERATION_SYSTEM_PROMPT).toContain("shotSize");
		expect(SHOT_GENERATION_SYSTEM_PROMPT).toContain("cameraMovement");
		expect(SHOT_GENERATION_SYSTEM_PROMPT).toContain("duration");
	});

	it("STORYBOARD_STRUCTURE_PROMPT is a non-empty string", () => {
		expect(typeof STORYBOARD_STRUCTURE_PROMPT).toBe("string");
		expect(STORYBOARD_STRUCTURE_PROMPT.length).toBeGreaterThan(0);
	});

	it("STORYBOARD_STRUCTURE_PROMPT emphasizes preserving original shots", () => {
		expect(STORYBOARD_STRUCTURE_PROMPT).toContain("Preserve");
		expect(STORYBOARD_STRUCTURE_PROMPT).toContain("original shot");
	});
});
