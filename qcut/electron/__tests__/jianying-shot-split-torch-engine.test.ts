import { describe, expect, it } from "vitest";
import {
	buildTorchDetectorArguments,
	parseTorchDetectorOutput,
	parseTorchProgressLine,
	torchResultFromDetectorOutput,
} from "../jianying-shot-split/torch-engine.js";

describe("torch engine output parsing", () => {
	it("reads the last JSON line the detector prints", () => {
		const output = parseTorchDetectorOutput({
			stdout: [
				"some warning that leaked to stdout",
				JSON.stringify({
					engine: "torch",
					frame_count: 288,
					fps: 24,
					cut_frames: [71, 143, 215],
					cut_points: [3, 6, 9],
					scores: [
						[4, 0.0008],
						[71, 0.7417],
						["bad", 1],
					],
					torch_version: "2.10.0",
					elapsed_ms: 5342,
				}),
			].join("\n"),
		});
		expect(output).toEqual({
			cutFrames: [71, 143, 215],
			elapsedMs: 5342,
			frameCount: 288,
			scores: [
				[4, 0.0008],
				[71, 0.7417],
			],
			torchVersion: "2.10.0",
		});
	});

	it("rejects output without a valid JSON result", () => {
		expect(() => parseTorchDetectorOutput({ stdout: "nothing" })).toThrow(
			"没有返回 JSON"
		);
		expect(() =>
			parseTorchDetectorOutput({
				stdout: '{"engine":"torch","cut_frames":[-1],"frame_count":3}',
			})
		).toThrow("无效的切点");
		expect(() =>
			parseTorchDetectorOutput({
				stdout: '{"engine":"bridge","cut_frames":[],"frame_count":3}',
			})
		).toThrow("无效的切点");
		expect(() =>
			parseTorchDetectorOutput({
				stdout: '{"engine":"torch","cut_frames":[],"frame_count":-2}',
			})
		).toThrow("无效的帧数");
	});

	it("maps progress lines to a 0–1 fraction and a status", () => {
		expect(
			parseTorchProgressLine({ line: "[progress] decoded 288 frames" })
		).toEqual({
			fraction: 0.15,
			status: "已解码 288 帧",
		});
		expect(
			parseTorchProgressLine({ line: "[progress] loading models" })?.fraction
		).toBe(0.2);
		expect(
			parseTorchProgressLine({ line: "[progress] features 64/128" })
		).toEqual({
			fraction: 0.5,
			status: "已提取特征 64/128 帧",
		});
		expect(
			parseTorchProgressLine({ line: "[progress] windows 281/281" })
		).toEqual({
			fraction: 1,
			status: "已评估 281/281 个窗口",
		});
		expect(parseTorchProgressLine({ line: "UserWarning: ..." })).toBeNull();
	});

	it("builds the detector command line and maps cut frames like the bridge", () => {
		const args = buildTorchDetectorArguments({
			ffmpegPath: "/ffmpeg",
			layerTables: { backbone: "/t/bb.tsv", predhead: "/t/ph.tsv" },
			models: { backbone: "/m/bb.bytenn", predhead: "/m/ph.bytenn" },
			sampling: { fps: 12, height: 180, width: 320 },
			scriptPath: "/probe/detect_cuts_torch.py",
			sourcePath: "/clip.mp4",
		});
		expect(args).toEqual([
			"/probe/detect_cuts_torch.py",
			"/m/bb.bytenn",
			"/t/bb.tsv",
			"/m/ph.bytenn",
			"/t/ph.tsv",
			"--video",
			"/clip.mp4",
			"--fps",
			"12",
			"--width",
			"320",
			"--height",
			"180",
			"--ffmpeg",
			"/ffmpeg",
			"--json",
		]);
		const result = torchResultFromDetectorOutput({
			appVersion: "11.3.0",
			coreUuid: "uuid",
			durationSeconds: 12,
			elapsedMs: 6000,
			output: {
				cutFrames: [71, 287],
				elapsedMs: 5000,
				frameCount: 288,
				scores: [],
				torchVersion: "2.10.0",
			},
			sampling: { fps: 24, height: 180, width: 320 },
			sourcePath: "/clip.mp4",
		});
		expect(result.engine).toBe("torch");
		expect(result.route).toBe("qcut-jianying-shot-split-torch-v1");
		// A cut at the final frame is the end of the video, not a boundary.
		expect(result.cutFrames).toEqual([71]);
		expect(result.cutPoints).toEqual([3]);
		expect(result.shots).toHaveLength(2);
	});
});
