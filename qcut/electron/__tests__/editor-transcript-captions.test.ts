import { describe, expect, it, vi } from "vitest";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import {
	cuesFromTranscript,
	transcriptToCaptions,
} from "../native-pipeline/editor/editor-transcript-captions.js";

/**
 * N10 (2026-10-28 trailer report): a transcription should become a captions
 * track in one step (`editor transcribe start --to-captions`).
 */

function word(text: string, start: number, end: number, type = "word") {
	return { text, start, end, type };
}

describe("captions from a transcript", () => {
	it("cuts cues at sentence ends and keeps the spaces between words", () => {
		const cues = cuesFromTranscript({
			language: "en",
			transcript: {
				words: [
					word("Round", 61, 61.4),
					word(" ", 61.4, 61.45, "spacing"),
					word("one.", 61.45, 62),
					word(" ", 62, 62.1, "spacing"),
					word("Fight!", 62.1, 62.6),
				],
			},
		});
		expect(cues).toEqual([
			{ text: "Round one.", startTime: 61, duration: 1, language: "en" },
			{
				text: "Fight!",
				startTime: 62.1,
				duration: expect.closeTo(0.5, 5),
				language: "en",
			},
		]);
	});

	it("starts a new cue after a pause and before a cue grows too wide", () => {
		const long = "三年前你是这座城里最能打的人后来你就消失了为什么";
		const words = [...long].map((char, index) =>
			word(char, index * 0.2, index * 0.2 + 0.2)
		);
		const cues = cuesFromTranscript({
			language: "zh",
			transcript: {
				words: [...words, word(" ", 5, 6, "spacing"), word("滚", 6, 6.4)],
			},
		});
		// 21 CJK characters fill the 42 half-width columns of one cue.
		expect(cues.map((cue) => cue.text)).toEqual([
			"三年前你是这座城里最能打的人后来你就消失了",
			"为什么",
			"滚",
		]);
	});

	it("falls back to the segments when there are no words", () => {
		expect(
			cuesFromTranscript({
				language: "zh",
				style: { bgOpacity: 0 },
				transcript: {
					segments: [{ text: " 下车。", start: 162.75, end: 163.5 }],
				},
			})
		).toEqual([
			{
				text: "下车。",
				startTime: 162.75,
				duration: 0.75,
				language: "zh",
				style: { bgOpacity: 0 },
			},
		]);
	});

	it("imports the cues through the captions import, inside a transaction", async () => {
		const calls: Array<{ path: string; body: unknown }> = [];
		const client = {
			post: vi.fn(async (path: string, body: unknown) => {
				calls.push({ path, body });
				if (path === "/api/claude/transaction/begin") {
					return { transactionId: "tx-9" };
				}
				if (path.endsWith("/tracks")) return { trackId: "cap-1" };
				return { addedCount: 1, added: [{ index: 0, success: true }] };
			}),
		} as unknown as EditorApiClient;
		const result = await transcriptToCaptions({
			client,
			opts: {
				command: "editor:transcribe:start",
				projectId: "p1",
				preset: "film",
				outputDir: "./output",
				json: true,
				verbose: false,
				quiet: false,
				saveIntermediates: false,
			} as CLIRunOptions,
			transcript: {
				language: "eng",
				words: [
					word("Get", 1, 1.2),
					word(" ", 1.2, 1.25, "spacing"),
					word("out.", 1.25, 1.6),
				],
			},
		});
		expect(result).toMatchObject({
			success: true,
			data: { cues: 1, added: 1, tracks: [{ trackId: "cap-1", cues: 1 }] },
		});
		const batch = calls.find((call) => call.path.endsWith("/elements/batch"));
		expect(batch?.body).toMatchObject({
			elements: [
				{
					type: "captions",
					trackId: "cap-1",
					content: "Get out.",
					language: "eng",
					style: expect.objectContaining({ bgOpacity: 0 }),
				},
			],
		});
		expect(calls.at(-1)?.path).toBe("/api/claude/transaction/tx-9/commit");
	});
});
