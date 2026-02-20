import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn((name: string) => {
			if (name === "documents") return "/mock/Documents";
			if (name === "temp") return "/mock/temp";
			return "/mock/unknown";
		}),
		getVersion: vi.fn(() => "0.0.1-test"),
		isPackaged: false,
	},
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
	},
	BrowserWindow: {
		getAllWindows: vi.fn(() => []),
		fromWebContents: vi.fn(() => null),
	},
}));

vi.mock("electron-log", () => ({
	default: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		log: vi.fn(),
	},
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	log: vi.fn(),
}));

const { mockTranscribeMedia, mockAnalyzeFillers, mockDetectScenes } =
	vi.hoisted(() => ({
		mockTranscribeMedia: vi.fn(),
		mockAnalyzeFillers: vi.fn(),
		mockDetectScenes: vi.fn(),
	}));

vi.mock("../claude/claude-transcribe-handler", () => ({
	transcribeMedia: mockTranscribeMedia,
}));

vi.mock("../claude/claude-filler-handler", () => ({
	analyzeFillers: mockAnalyzeFillers,
}));

vi.mock("../claude/claude-scene-handler", () => ({
	detectScenes: mockDetectScenes,
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { suggestCuts } from "../claude/claude-suggest-handler";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const makeTranscriptionResult = () => ({
	words: [
		{ text: "Hello", start: 0.0, end: 0.5, type: "word" as const },
		{ text: " ", start: 0.5, end: 0.6, type: "spacing" as const },
		{ text: "um", start: 0.6, end: 0.9, type: "word" as const },
		{ text: " ", start: 0.9, end: 1.0, type: "spacing" as const },
		{ text: "world", start: 1.0, end: 1.5, type: "word" as const },
		{ text: " ", start: 1.5, end: 3.5, type: "spacing" as const },
		{ text: "thanks", start: 3.5, end: 4.0, type: "word" as const },
	],
	segments: [],
	language: "en",
	duration: 4.0,
});

const makeFillerResult = () => ({
	fillers: [{ word: "um", start: 0.6, end: 0.9, reason: "filler word" }],
	silences: [{ start: 1.5, end: 3.5, duration: 2.0 }],
	totalFillerTime: 0.3,
	totalSilenceTime: 2.0,
});

const makeSceneResult = () => ({
	scenes: [
		{ timestamp: 0, confidence: 1.0, description: "Opening shot" },
		{ timestamp: 5.0, confidence: 0.8, description: "Cut to speaker" },
		{ timestamp: 5.3, confidence: 0.7, description: "Quick insert" },
		{ timestamp: 12.0, confidence: 0.9, description: "Wide shot" },
	],
	totalScenes: 4,
	averageShotDuration: 4.0,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("claude-suggest-handler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockTranscribeMedia.mockResolvedValue(makeTranscriptionResult());
		mockAnalyzeFillers.mockResolvedValue(makeFillerResult());
		mockDetectScenes.mockResolvedValue(makeSceneResult());
	});

	it("rejects missing mediaId", async () => {
		await expect(suggestCuts("proj_1", { mediaId: "" })).rejects.toThrow(
			"Missing 'mediaId'"
		);
	});

	it("returns filler suggestions", async () => {
		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
			includeFillers: true,
			includeSilences: false,
			includeScenes: false,
		});

		const fillerSuggestions = result.suggestions.filter(
			(s) => s.type === "filler"
		);
		expect(fillerSuggestions).toHaveLength(1);
		expect(fillerSuggestions[0].word).toBe("um");
		expect(fillerSuggestions[0].confidence).toBe(0.9);
		expect(result.summary.fillerSuggestions).toBe(1);
	});

	it("returns silence suggestions", async () => {
		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
			includeFillers: false,
			includeSilences: true,
			includeScenes: false,
		});

		const silenceSuggestions = result.suggestions.filter(
			(s) => s.type === "silence"
		);
		expect(silenceSuggestions).toHaveLength(1);
		expect(silenceSuggestions[0].start).toBe(1.5);
		expect(silenceSuggestions[0].end).toBe(3.5);
		expect(result.summary.silenceSuggestions).toBe(1);
	});

	it("returns scene-based suggestions", async () => {
		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
			includeFillers: false,
			includeSilences: false,
			includeScenes: true,
		});

		// Should have scene transitions and pacing suggestions
		const sceneTransitions = result.suggestions.filter(
			(s) => s.type === "scene_transition"
		);
		const pacingSuggestions = result.suggestions.filter(
			(s) => s.type === "pacing"
		);

		// Scene transitions at 5.0, 5.3, 12.0 (not at 0)
		expect(sceneTransitions.length).toBe(3);

		// Short shot from 5.0 to 5.3 (0.3s < 0.5s) should be flagged
		expect(pacingSuggestions.length).toBe(1);
		expect(pacingSuggestions[0].start).toBe(5.0);

		expect(result.scenes).toBeDefined();
		expect(result.scenes!.totalScenes).toBe(4);
	});

	it("suppresses fillers when includeFillers is false", async () => {
		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
			includeFillers: false,
			includeSilences: true,
			includeScenes: false,
		});

		expect(result.suggestions.filter((s) => s.type === "filler")).toHaveLength(
			0
		);
	});

	it("suppresses silences when includeSilences is false", async () => {
		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
			includeFillers: true,
			includeSilences: false,
			includeScenes: false,
		});

		expect(result.suggestions.filter((s) => s.type === "silence")).toHaveLength(
			0
		);
	});

	it("suppresses scenes when includeScenes is false", async () => {
		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
			includeFillers: false,
			includeSilences: false,
			includeScenes: false,
		});

		expect(result.suggestions).toHaveLength(0);
		expect(result.summary.totalSuggestions).toBe(0);
	});

	it("continues when transcription fails but scene detection succeeds", async () => {
		mockTranscribeMedia.mockRejectedValue(new Error("Transcription error"));

		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
			includeFillers: true,
			includeSilences: true,
			includeScenes: true,
		});

		// Should still have scene suggestions
		expect(
			result.suggestions.filter((s) => s.type === "scene_transition").length
		).toBeGreaterThan(0);
		// No filler/silence suggestions since transcription failed
		expect(result.suggestions.filter((s) => s.type === "filler")).toHaveLength(
			0
		);
		expect(result.suggestions.filter((s) => s.type === "silence")).toHaveLength(
			0
		);
	});

	it("continues when scene detection fails but transcription succeeds", async () => {
		mockDetectScenes.mockRejectedValue(new Error("FFmpeg error"));

		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
			includeFillers: true,
			includeSilences: true,
			includeScenes: true,
		});

		// Should still have filler/silence suggestions
		expect(
			result.suggestions.filter((s) => s.type === "filler").length
		).toBeGreaterThan(0);
		// No scene suggestions
		expect(
			result.suggestions.filter((s) => s.type === "scene_transition")
		).toHaveLength(0);
	});

	it("sorts suggestions by start time", async () => {
		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
		});

		for (let i = 1; i < result.suggestions.length; i++) {
			expect(result.suggestions[i].start).toBeGreaterThanOrEqual(
				result.suggestions[i - 1].start
			);
		}
	});

	it("calculates estimated time removed correctly", async () => {
		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
			includeFillers: true,
			includeSilences: true,
			includeScenes: false,
		});

		// Filler: 0.6-0.9 = 0.3s, Silence: 1.5-3.5 = 2.0s → total 2.3s
		expect(result.summary.estimatedTimeRemoved).toBeCloseTo(2.3, 1);
	});

	it("returns empty list for clean video with no issues", async () => {
		mockAnalyzeFillers.mockResolvedValue({
			fillers: [],
			silences: [],
			totalFillerTime: 0,
			totalSilenceTime: 0,
		});
		mockDetectScenes.mockResolvedValue({
			scenes: [{ timestamp: 0, confidence: 1.0 }],
			totalScenes: 1,
			averageShotDuration: 30,
		});

		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
		});

		expect(result.suggestions).toHaveLength(0);
		expect(result.summary.totalSuggestions).toBe(0);
	});

	it("includes transcription metadata when available", async () => {
		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
		});

		expect(result.transcription).toBeDefined();
		expect(result.transcription!.wordCount).toBe(7);
		expect(result.transcription!.duration).toBe(4.0);
	});

	it("includes scene metadata when available", async () => {
		const result = await suggestCuts("proj_1", {
			mediaId: "media_1",
		});

		expect(result.scenes).toBeDefined();
		expect(result.scenes!.totalScenes).toBe(4);
		expect(result.scenes!.averageShotDuration).toBe(4.0);
	});
});
