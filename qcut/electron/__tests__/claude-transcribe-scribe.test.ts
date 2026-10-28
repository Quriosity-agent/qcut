import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => "/tmp", isPackaged: false },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
	safeStorage: { isEncryptionAvailable: () => false },
}));

import {
	buildSegments,
	resolveScribeRoute,
} from "../claude/handlers/claude-transcribe-scribe.js";

/**
 * N10 (2026-10-28 trailer report): `editor:transcribe:start --provider
 * elevenlabs` always went through FAL, used the E2E suite's placeholder
 * `FAL_KEY` (test-fal-api-key-e2e) found in ~/.qcut/.env, and failed with
 * FAL's 401 about its key header, which named neither ElevenLabs nor the
 * placeholder.
 */

const REAL_FAL = "1c0ffee0-0000-4000-8000-000000000000:0123456789abcdef";

describe("Scribe route", () => {
	it("calls ElevenLabs directly when ELEVENLABS_API_KEY is set", async () => {
		await expect(
			resolveScribeRoute({
				keys: { elevenLabsApiKey: "sk_live_abc", falApiKey: REAL_FAL },
				proxyAvailable: true,
			})
		).resolves.toEqual({ kind: "elevenlabs", apiKey: "sk_live_abc" });
	});

	it("uses the signed-in QCut account before a FAL key", async () => {
		await expect(
			resolveScribeRoute({
				keys: { falApiKey: "test-fal-api-key-e2e" },
				proxyAvailable: true,
			})
		).resolves.toEqual({ kind: "qcut-cloud" });
	});

	it("uses a well-formed FAL key last", async () => {
		await expect(
			resolveScribeRoute({
				keys: { falApiKey: REAL_FAL },
				proxyAvailable: false,
			})
		).resolves.toEqual({ kind: "fal", apiKey: REAL_FAL });
	});

	it("never sends the E2E placeholder and says what is missing", async () => {
		const failure = resolveScribeRoute({
			keys: { falApiKey: "test-fal-api-key-e2e" },
			proxyAvailable: false,
		});
		await expect(failure).rejects.toThrow("ELEVENLABS_API_KEY");
		await expect(failure).rejects.toThrow("signed-in QCut account");
		await expect(failure).rejects.toThrow(
			"FAL_KEY looks like a test placeholder"
		);
	});

	it("names a FAL key that is not key_id:key_secret", async () => {
		await expect(
			resolveScribeRoute({
				keys: { falApiKey: "abcdef0123456789" },
				proxyAvailable: false,
			})
		).rejects.toThrow("FAL_KEY is not in FAL's key_id:key_secret form");
	});
});

describe("Scribe segments", () => {
	it("keeps the spaces between words and splits at a long pause", () => {
		const segments = buildSegments([
			{ text: "Round", start: 0, end: 0.4, type: "word" },
			{ text: " ", start: 0.4, end: 0.45, type: "spacing" },
			{ text: "one", start: 0.45, end: 0.8, type: "word" },
			{ text: ".", start: 0.8, end: 0.82, type: "punctuation" },
			{ text: " ", start: 0.82, end: 2, type: "spacing" },
			{ text: "Fight", start: 2, end: 2.5, type: "word" },
		]);
		expect(segments).toEqual([
			{ text: "Round one.", start: 0, end: 0.82 },
			{ text: "Fight", start: 2, end: 2.5 },
		]);
	});
});
