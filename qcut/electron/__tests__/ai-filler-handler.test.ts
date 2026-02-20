import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	analyzeFillersWithPriority,
	analyzeWithPatternMatch,
	buildFilterPrompt,
	parseFilterResponse,
} from "../ai-filler-handler";
import { getDecryptedApiKeys } from "../api-key-handler";

vi.mock("../api-key-handler", () => ({
	getDecryptedApiKeys: vi.fn(),
}));

const getDecryptedApiKeysMock = vi.mocked(getDecryptedApiKeys);

describe("ai-filler-handler helpers", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("pattern fallback marks filler words and long silence spacing", () => {
		const result = analyzeWithPatternMatch({
			words: [
				{ id: "word-0", text: "um", start: 0, end: 0.2, type: "word" },
				{ id: "space-1", text: " ", start: 0.2, end: 2.0, type: "spacing" },
				{ id: "word-2", text: "hello", start: 2.0, end: 2.4, type: "word" },
			],
		});

		expect(result.provider).toBe("pattern");
		expect(result.filteredWordIds.map((item) => item.id)).toContain("word-0");
		expect(result.filteredWordIds.map((item) => item.id)).toContain("space-1");
	});

	it("pattern fallback does not remove meaningful words by default", () => {
		const result = analyzeWithPatternMatch({
			words: [
				{ id: "word-0", text: "I", start: 0, end: 0.2, type: "word" },
				{ id: "word-1", text: "like", start: 0.21, end: 0.5, type: "word" },
				{ id: "word-2", text: "cats", start: 0.51, end: 1.0, type: "word" },
			],
		});

		expect(result.filteredWordIds).toEqual([]);
	});

	it("buildFilterPrompt includes sentences and word list sections", () => {
		const prompt = buildFilterPrompt({
			words: [
				{ id: "word-0", text: "hello", start: 0, end: 0.2, type: "word" },
				{ id: "space-1", text: " ", start: 0.2, end: 0.9, type: "spacing" },
				{ id: "word-2", text: "world", start: 0.9, end: 1.2, type: "word" },
			],
			languageCode: "eng",
		});

		expect(prompt).toContain("Language: eng");
		expect(prompt).toContain("## Sentences");
		expect(prompt).toContain("## Words");
		expect(prompt).toContain("word-0|hello|0.00-0.20");
	});

	it("parseFilterResponse handles valid JSON", () => {
		const parsed = parseFilterResponse({
			rawText:
				'[{"id":"word-1","reason":"filler word","scope":"word"},{"id":"word-2","reason":"repeat","scope":"sentence"}]',
		});

		expect(parsed).toHaveLength(2);
		expect(parsed[0]).toEqual({
			id: "word-1",
			reason: "filler word",
			scope: "word",
		});
		expect(parsed[1].scope).toBe("sentence");
	});

	it("parseFilterResponse returns empty list on malformed text", () => {
		const parsed = parseFilterResponse({
			rawText: "not json at all",
		});

		expect(parsed).toEqual([]);
	});

	it("falls back to pattern provider when no API keys are available", async () => {
		getDecryptedApiKeysMock.mockResolvedValue({
			falApiKey: "",
			freesoundApiKey: "",
			geminiApiKey: "",
			openRouterApiKey: "",
			anthropicApiKey: "",
		});

		const result = await analyzeFillersWithPriority({
			request: {
				languageCode: "eng",
				words: [{ id: "word-0", text: "um", start: 0, end: 0.2, type: "word" }],
			},
		});

		expect(result.provider).toBe("pattern");
		expect(result.filteredWordIds.map((item) => item.id)).toEqual(["word-0"]);
	});
});
