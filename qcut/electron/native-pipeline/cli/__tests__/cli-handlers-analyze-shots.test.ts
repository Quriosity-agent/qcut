import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { JianyingShotSplitResult } from "../../../jianying-shot-split-contract.js";
import {
	type AnalyzeShotsDependencies,
	buildAnalyzeShotsBothReport,
	buildAnalyzeShotsReport,
	handleAnalyzeShots,
	resolveAnalyzeShotsEngine,
} from "../cli-handlers-analyze-shots.js";
import { parseCliArgs } from "../cli.js";
import type { CLIRunOptions } from "../cli-runner/types.js";

const RESULT: JianyingShotSplitResult = {
	appVersion: "11.3.0",
	coreUuid: "100726E3-FCB0-31BC-98EE-1B196A1714A3",
	cutFrames: [71, 143],
	cutPoints: [3, 6],
	durationSeconds: 9,
	elapsedMs: 420,
	engine: "bridge",
	fps: 24,
	frameCount: 216,
	height: 180,
	route: "qcut-jianying-shot-split-v1",
	shots: [
		{ endFrame: 71, endTime: 3, index: 0, startFrame: 0, startTime: 0 },
		{ endFrame: 143, endTime: 6, index: 1, startFrame: 72, startTime: 3 },
		{ endFrame: 215, endTime: 9, index: 2, startFrame: 144, startTime: 6 },
	],
	sourcePath: "/videos/clip.mp4",
	width: 320,
};

/** The torch reproduction found the second cut one frame later and an extra one. */
const TORCH_RESULT: JianyingShotSplitResult = {
	...RESULT,
	cutFrames: [71, 144, 200],
	cutPoints: [3, 6.041667, 8.375],
	elapsedMs: 5100,
	engine: "torch",
	route: "qcut-jianying-shot-split-torch-v1",
	scores: [[71, 0.74]],
	shots: [
		{ endFrame: 71, endTime: 3, index: 0, startFrame: 0, startTime: 0 },
		{
			endFrame: 144,
			endTime: 6.041667,
			index: 1,
			startFrame: 72,
			startTime: 3,
		},
		{
			endFrame: 200,
			endTime: 8.375,
			index: 2,
			startFrame: 145,
			startTime: 6.041667,
		},
		{ endFrame: 215, endTime: 9, index: 3, startFrame: 201, startTime: 8.375 },
	],
};

function dependencies({
	calls,
	torchCalls = [],
}: {
	calls: Parameters<AnalyzeShotsDependencies["detect"]>[0][];
	torchCalls?: Parameters<AnalyzeShotsDependencies["detectTorch"]>[0][];
}): AnalyzeShotsDependencies {
	return {
		detect: async (input) => {
			calls.push(input);
			input.onProgress?.({ progress: 50, stage: "decode", status: "half" });
			return { ...RESULT, sourcePath: input.request.sourcePath };
		},
		detectTorch: async (input) => {
			torchCalls.push(input);
			input.onProgress?.({ progress: 30, stage: "decode", status: "torch" });
			return { ...TORCH_RESULT, sourcePath: input.request.sourcePath };
		},
		inspect: async () => ({
			available: false,
			localOnly: true,
			message: "runtime missing",
			offlineReady: false,
			platformSupported: true,
			route: "qcut-jianying-shot-split-v1",
			runtimeRoot: "/runtime",
			torch: {
				available: true,
				message: "torch ready",
				torchVersion: "2.10.0",
			},
		}),
	};
}

function baseOptions(overrides: Partial<CLIRunOptions> = {}): CLIRunOptions {
	return {
		command: "analyze-shots",
		outputDir: tmpdir(),
		saveIntermediates: false,
		json: true,
		verbose: false,
		quiet: true,
		...overrides,
	};
}

describe("analyze shots CLI", () => {
	it("parses the grouped command and sampling flags", () => {
		const options = parseCliArgs([
			"analyze",
			"shots",
			"-i",
			"clip.mp4",
			"--fps",
			"12",
			"--width",
			"320",
			"--height",
			"180",
			"--output",
			"shots.json",
			"--json",
		]);
		expect(options.command).toBe("analyze-shots");
		expect(options.input).toBe("clip.mp4");
		expect(options.fps).toBe(12);
		expect(options.width).toBe(320);
		expect(options.height).toBe(180);
		expect(options.output).toBe("shots.json");
		expect(parseCliArgs(["analyze", "shots", "--check"]).checkOnly).toBe(true);
		expect(
			parseCliArgs(["analyze", "shots", "-i", "clip.mp4", "--engine", "both"])
				.engine
		).toBe("both");
	});

	it("defaults to the bridge engine and rejects unknown engines", () => {
		expect(resolveAnalyzeShotsEngine({ engine: undefined })).toBe("bridge");
		expect(resolveAnalyzeShotsEngine({ engine: "torch" })).toBe("torch");
		expect(() => resolveAnalyzeShotsEngine({ engine: "coreml" })).toThrow(
			"--engine must be one of bridge, torch, both"
		);
	});

	it("runs only the torch engine with --engine torch", async () => {
		const calls: Parameters<AnalyzeShotsDependencies["detect"]>[0][] = [];
		const torchCalls: Parameters<AnalyzeShotsDependencies["detectTorch"]>[0][] =
			[];
		const result = await handleAnalyzeShots(
			baseOptions({ engine: "torch", input: "/videos/clip.mp4" }),
			() => {},
			new AbortController().signal,
			dependencies({ calls, torchCalls })
		);
		expect(result.success).toBe(true);
		expect(calls).toHaveLength(0);
		expect(torchCalls).toHaveLength(1);
		expect(result.data).toMatchObject({
			engine: "torch",
			route: "qcut-jianying-shot-split-torch-v1",
			cut_frames: [71, 144, 200],
		});
	});

	it("runs both engines and reports the comparison with --engine both", async () => {
		const calls: Parameters<AnalyzeShotsDependencies["detect"]>[0][] = [];
		const torchCalls: Parameters<AnalyzeShotsDependencies["detectTorch"]>[0][] =
			[];
		const progress: string[] = [];
		const result = await handleAnalyzeShots(
			baseOptions({ engine: "both", input: "/videos/clip.mp4" }),
			(update) => progress.push(`${update.percent}:${update.message}`),
			new AbortController().signal,
			dependencies({ calls, torchCalls })
		);
		expect(result.success).toBe(true);
		expect(calls).toHaveLength(1);
		expect(torchCalls).toHaveLength(1);
		expect(progress).toContain("25:[bridge] half");
		expect(result.data).toEqual(
			buildAnalyzeShotsBothReport({
				bridge: { ...RESULT, sourcePath: resolve("/videos/clip.mp4") },
				torch: { ...TORCH_RESULT, sourcePath: resolve("/videos/clip.mp4") },
			})
		);
		expect(result.data).toMatchObject({
			engine: "both",
			cut_frames: [71, 143],
			torch: { engine: "torch", cut_frames: [71, 144, 200] },
			comparison: {
				agreement: 2 / 3,
				matched_count: 2,
				matches: [
					{ bridge_frame: 71, torch_frame: 71, frame_delta: 0 },
					{ bridge_frame: 143, torch_frame: 144, frame_delta: 1 },
				],
				bridge_only_frames: [],
				torch_only_frames: [200],
				max_frame_delta: 1,
				frame_count_matches: true,
				bridge_elapsed_ms: 420,
				torch_elapsed_ms: 5100,
			},
		});
	});

	it("runs detection with an absolute source path and relays progress", async () => {
		const calls: Parameters<AnalyzeShotsDependencies["detect"]>[0][] = [];
		const progress: string[] = [];
		const result = await handleAnalyzeShots(
			baseOptions({ input: "clip.mp4", fps: 12 }),
			(update) => progress.push(`${update.stage}:${update.percent}`),
			new AbortController().signal,
			dependencies({ calls })
		);
		expect(result.success).toBe(true);
		expect(calls[0].request).toEqual({
			fps: 12,
			height: undefined,
			sourcePath: join(process.cwd(), "clip.mp4"),
			width: undefined,
		});
		expect(progress).toEqual(["decode:50"]);
		expect(result.data).toMatchObject({
			route: "qcut-jianying-shot-split-v1",
			cut_count: 2,
			cut_points: [3, 6],
			frame_count: 216,
			shots: [
				{ index: 0, start_frame: 0, end_frame: 71, start_time: 0, end_time: 3 },
				{
					index: 1,
					start_frame: 72,
					end_frame: 143,
					start_time: 3,
					end_time: 6,
				},
				{
					index: 2,
					start_frame: 144,
					end_frame: 215,
					start_time: 6,
					end_time: 9,
				},
			],
		});
		expect(result.outputPath).toBeUndefined();
	});

	it("writes the report to --output and refuses to overwrite without --force", async () => {
		const directory = mkdtempSync(join(tmpdir(), "qcut-analyze-shots-"));
		const outputPath = join(directory, "nested", "shots.json");
		const written = await handleAnalyzeShots(
			baseOptions({ input: "/videos/clip.mp4", output: outputPath }),
			() => {},
			new AbortController().signal,
			dependencies({ calls: [] })
		);
		expect(written.success).toBe(true);
		expect(written.outputPath).toBe(outputPath);
		// The handler resolves --input, which adds a drive letter on Windows.
		expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(
			buildAnalyzeShotsReport({
				result: { ...RESULT, sourcePath: resolve("/videos/clip.mp4") },
			})
		);
		const refused = await handleAnalyzeShots(
			baseOptions({ input: "/videos/clip.mp4", output: outputPath }),
			() => {},
			new AbortController().signal,
			dependencies({ calls: [] })
		);
		expect(refused.success).toBe(false);
		expect(refused.error).toContain("already exists");
		writeFileSync(outputPath, "stale");
		const forced = await handleAnalyzeShots(
			baseOptions({
				force: true,
				input: "/videos/clip.mp4",
				output: outputPath,
			}),
			() => {},
			new AbortController().signal,
			dependencies({ calls: [] })
		);
		expect(forced.success).toBe(true);
		expect(readFileSync(outputPath, "utf8")).not.toBe("stale");
	});

	it("reports runtime status with --check and requires --input otherwise", async () => {
		const status = await handleAnalyzeShots(
			baseOptions({ checkOnly: true }),
			() => {},
			new AbortController().signal,
			dependencies({ calls: [] })
		);
		expect(status.success).toBe(true);
		expect(status.data).toEqual({
			route: "qcut-jianying-shot-split-v1",
			available: false,
			message: "runtime missing",
			platform_supported: true,
			offline_ready: false,
			runtime_root: "/runtime",
			app_version: null,
			core_uuid: null,
			torch_available: true,
			torch_message: "torch ready",
			torch_version: "2.10.0",
		});
		const missing = await handleAnalyzeShots(
			baseOptions(),
			() => {},
			new AbortController().signal,
			dependencies({ calls: [] })
		);
		expect(missing.success).toBe(false);
		expect(missing.error).toContain("--input is required");
	});
});
