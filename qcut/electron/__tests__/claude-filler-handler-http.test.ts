/**
 * Tests for claude-filler-handler.ts (HTTP wrapper)
 * Validates filler word and silence detection via the HTTP handler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn((name: string) => {
			if (name === "documents") return "/mock/Documents";
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

vi.mock("../api-key-handler", () => ({
	getDecryptedApiKeys: vi.fn(async () => ({
		falApiKey: "",
		freesoundApiKey: "",
		geminiApiKey: "",
		openRouterApiKey: "",
		anthropicApiKey: "",
	})),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { analyzeFillers } from "../claude/handlers/claude-filler-handler";

describe("claude-filler-handler (HTTP)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns empty result for empty word list", async () => {
		const result = await analyzeFillers("test-project", {
			words: [],
		});

		expect(result.fillers).toEqual([]);
		expect(result.silences).toEqual([]);
		expect(result.totalFillerTime).toBe(0);
		expect(result.totalSilenceTime).toBe(0);
	});

	it("detects filler words via pattern fallback", async () => {
		const result = await analyzeFillers("test-project", {
			words: [
				{ id: "word-0", text: "um", start: 0, end: 0.2, type: "word" },
				{ id: "word-1", text: "hello", start: 0.3, end: 0.6, type: "word" },
				{ id: "word-2", text: "uh", start: 0.7, end: 0.9, type: "word" },
				{ id: "word-3", text: "world", start: 1.0, end: 1.3, type: "word" },
			],
		});

		expect(result.fillers.length).toBeGreaterThanOrEqual(2);
		const fillerWords = result.fillers.map((f) => f.word);
		expect(fillerWords).toContain("um");
		expect(fillerWords).toContain("uh");
		// Meaningful words should NOT be in fillers
		expect(fillerWords).not.toContain("hello");
		expect(fillerWords).not.toContain("world");
	});

	it("detects silence gaps above threshold", async () => {
		const result = await analyzeFillers("test-project", {
			words: [
				{ id: "word-0", text: "hello", start: 0, end: 0.5, type: "word" },
				{ id: "space-1", text: " ", start: 0.5, end: 3.0, type: "spacing" },
				{ id: "word-2", text: "world", start: 3.0, end: 3.5, type: "word" },
			],
		});

		expect(result.silences.length).toBeGreaterThanOrEqual(1);
		expect(result.silences[0].start).toBe(0.5);
		expect(result.silences[0].end).toBe(3.0);
		expect(result.silences[0].duration).toBe(2.5);
		expect(result.totalSilenceTime).toBeGreaterThan(0);
	});

	it("returns total filler and silence time", async () => {
		const result = await analyzeFillers("test-project", {
			words: [
				{ id: "word-0", text: "um", start: 0, end: 0.3, type: "word" },
				{ id: "space-1", text: " ", start: 0.3, end: 2.5, type: "spacing" },
				{ id: "word-2", text: "er", start: 2.5, end: 2.8, type: "word" },
			],
		});

		expect(result.totalFillerTime).toBeGreaterThan(0);
		expect(result.totalSilenceTime).toBeGreaterThan(0);
	});

	it("uses tri-provider fallback (pattern when no API keys)", async () => {
		// With no API keys configured, should fall back to pattern matching
		const result = await analyzeFillers("test-project", {
			words: [
				{ id: "word-0", text: "hmm", start: 0, end: 0.3, type: "word" },
				{ id: "word-1", text: "good", start: 0.4, end: 0.7, type: "word" },
			],
		});

		// Pattern matcher should detect "hmm" as filler
		expect(result.fillers.length).toBeGreaterThanOrEqual(1);
		expect(result.fillers[0].word).toBe("hmm");
	});
});
