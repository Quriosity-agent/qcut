import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { JianyingShotSplitResult } from "../../../jianying-shot-split-contract.js";
import {
	type AnalyzeShotsDependencies,
	buildAnalyzeShotsReport,
	handleAnalyzeShots,
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

function dependencies({
	calls,
}: {
	calls: Parameters<AnalyzeShotsDependencies["detect"]>[0][];
}): AnalyzeShotsDependencies {
	return {
		detect: async (input) => {
			calls.push(input);
			input.onProgress?.({ progress: 50, stage: "decode", status: "half" });
			return { ...RESULT, sourcePath: input.request.sourcePath };
		},
		inspect: async () => ({
			available: false,
			localOnly: true,
			message: "runtime missing",
			offlineReady: false,
			platformSupported: true,
			route: "qcut-jianying-shot-split-v1",
			runtimeRoot: "/runtime",
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
