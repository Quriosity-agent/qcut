import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import {
	captionsImport,
	partitionCueLanes,
} from "../native-pipeline/editor/editor-handlers-captions.js";

const SRT = `1
00:00:01,000 --> 00:00:03,000
第一句

2
00:00:02,500 --> 00:00:04,000
overlapping second

3
00:00:05,000 --> 00:00:06,000
third
`;

function fakeClient({ existingCaptionTracks = 0, failBatches = false } = {}) {
	const calls: Array<{ method: string; path: string; body: unknown }> = [];
	let trackCounter = 0;
	const client = {
		get: vi.fn(async (requestPath: string) => {
			calls.push({ method: "GET", path: requestPath, body: undefined });
			return {
				tracks: [
					{ id: "main", type: "media" },
					...Array.from({ length: existingCaptionTracks }, (_, i) => ({
						id: `old-cap-${i}`,
						type: "captions",
					})),
				],
			};
		}),
		post: vi.fn(async (requestPath: string, body: unknown) => {
			calls.push({ method: "POST", path: requestPath, body });
			if (requestPath === "/api/claude/transaction/begin") {
				return { transactionId: "tx-1" };
			}
			if (requestPath.startsWith("/api/claude/transaction/")) return {};
			if (failBatches && requestPath.endsWith("/elements/batch")) {
				throw new Error("batch refused");
			}
			if (requestPath.endsWith("/tracks")) {
				trackCounter += 1;
				return { trackId: `cap-${trackCounter}` };
			}
			return { addedCount: (body as { elements: unknown[] }).elements.length };
		}),
		delete: vi.fn(async (requestPath: string, body: unknown) => {
			calls.push({ method: "DELETE", path: requestPath, body });
			return { removed: true };
		}),
	} as unknown as EditorApiClient;
	return { client, calls };
}

function opts(overrides: Partial<CLIRunOptions>): CLIRunOptions {
	return {
		command: "editor:captions:import",
		projectId: "p1",
		outputDir: "./output",
		json: true,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		...overrides,
	} as CLIRunOptions;
}

describe("partitionCueLanes", () => {
	it("gives overlapping cues their own lane and reuses lanes that are free", () => {
		const lanes = partitionCueLanes({
			cues: [
				{ text: "a", startTime: 1, duration: 2, language: "zh" },
				{ text: "b", startTime: 2.5, duration: 1.5, language: "zh" },
				{ text: "c", startTime: 5, duration: 1, language: "zh" },
			],
		});
		expect(lanes.map((lane) => lane.map((cue) => cue.text))).toEqual([
			["a", "c"],
			["b"],
		]);
	});
});

describe("editor captions import", () => {
	let dir: string;
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("imports an SRT onto captions tracks, one per lane, in batches", async () => {
		dir = mkdtempSync(path.join(tmpdir(), "qcut-captions-"));
		const file = path.join(dir, "cues.srt");
		writeFileSync(file, SRT);
		const { client, calls } = fakeClient();
		const result = await captionsImport(client, opts({ file, language: "zh" }));
		expect(result.success).toBe(true);
		expect(result.data).toMatchObject({
			cues: 3,
			added: 3,
			tracks: [
				{ trackId: "cap-1", cues: 2 },
				{ trackId: "cap-2", cues: 1 },
			],
		});
		const trackCreates = calls.filter((call) => call.path.endsWith("/tracks"));
		expect(trackCreates.map((call) => call.body)).toEqual([
			{ type: "captions" },
			{ type: "captions" },
		]);
		const batches = calls.filter((call) =>
			call.path.endsWith("/elements/batch")
		);
		expect(batches).toHaveLength(2);
		expect(batches[0].body).toEqual({
			elements: [
				{
					type: "captions",
					trackId: "cap-1",
					content: "第一句",
					startTime: 1,
					duration: 2,
					language: "zh",
				},
				{
					type: "captions",
					trackId: "cap-1",
					content: "third",
					startTime: 5,
					duration: 1,
					language: "zh",
				},
			],
		});
	});

	it("deletes the existing captions tracks first with --replace", async () => {
		dir = mkdtempSync(path.join(tmpdir(), "qcut-captions-"));
		const file = path.join(dir, "cues.srt");
		writeFileSync(file, SRT);
		const { client, calls } = fakeClient({ existingCaptionTracks: 2 });
		await captionsImport(client, opts({ file, replace: true }));
		const deletes = calls.filter((call) => call.method === "DELETE");
		expect(deletes.map((call) => call.path)).toEqual([
			"/api/claude/timeline/p1/tracks/old-cap-0",
			"/api/claude/timeline/p1/tracks/old-cap-1",
		]);
		expect(deletes[0].body).toEqual({ force: true });
		// The deletes and the batches sit inside one transaction.
		expect(calls[0].path).toBe("/api/claude/transaction/begin");
		expect(calls.at(-1)?.path).toBe("/api/claude/transaction/tx-1/commit");
		const firstDelete = calls.findIndex((call) => call.method === "DELETE");
		expect(firstDelete).toBeGreaterThan(0);
	});

	it("rolls the whole import back when a batch fails", async () => {
		dir = mkdtempSync(path.join(tmpdir(), "qcut-captions-"));
		const file = path.join(dir, "cues.srt");
		writeFileSync(file, SRT);
		const { client, calls } = fakeClient({
			existingCaptionTracks: 1,
			failBatches: true,
		});
		const result = await captionsImport(client, opts({ file, replace: true }));
		expect(result).toMatchObject({
			success: false,
			error: expect.stringContaining("batch refused"),
		});
		expect(result.error).toContain("was rolled back");
		expect(calls.at(-1)).toMatchObject({
			method: "POST",
			path: "/api/claude/transaction/tx-1/rollback",
			body: { reason: expect.stringContaining("batch refused") },
		});
		expect(calls.some((call) => call.path.endsWith("/commit"))).toBe(false);
	});

	it("names a missing file and an empty one", async () => {
		const { client } = fakeClient();
		expect(
			await captionsImport(client, opts({ file: "/nowhere/none.srt" }))
		).toMatchObject({
			success: false,
			error: expect.stringContaining("not found"),
		});
		dir = mkdtempSync(path.join(tmpdir(), "qcut-captions-"));
		const empty = path.join(dir, "empty.srt");
		writeFileSync(empty, "");
		expect(await captionsImport(client, opts({ file: empty }))).toMatchObject({
			success: false,
			error: expect.stringContaining("No cues"),
		});
	});
});
