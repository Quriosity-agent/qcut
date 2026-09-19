import { describe, expect, it } from "vitest";
import {
	parseOnnxShotOutput,
	SHOT_ONNX_MODEL_SHA256,
	SHOT_ONNX_PREPROCESSING,
} from "../jianying-shot-split/onnx-output.js";
import { runOnnxProcess } from "../jianying-shot-split/onnx-process.js";

const valid = {
	engine: "onnx",
	artifact_sha256: SHOT_ONNX_MODEL_SHA256,
	preprocessing: SHOT_ONNX_PREPROCESSING,
	frame_count: 10,
	cut_frames: [5],
	scores: [
		[4, 0.1],
		[5, 0.9],
		[6, 0.1],
	],
	onnx_version: "1.30.0",
};

describe("ONNX shot result contract", () => {
	it.each([
		{ fps: 12 },
		{ width: 640 },
		{ height: 360 },
		{ threshold: 0.5 },
	])("rejects request mismatch %j", (override) => {
		expect(() =>
			parseOnnxShotOutput({
				stdout: JSON.stringify({
					...valid,
					fps: 24,
					width: 320,
					height: 180,
					threshold: 0.35,
					...override,
				}),
				expectedSampling: { fps: 24, width: 320, height: 180 },
			})
		).toThrow("does not match request");
	});
	it("accepts complete bounded results", () => {
		expect(
			parseOnnxShotOutput({ stdout: JSON.stringify(valid) })
		).toMatchObject({ cutFrames: [5], frameCount: 10 });
		expect(
			parseOnnxShotOutput({
				stdout: JSON.stringify({
					...valid,
					frame_count: 1,
					cut_frames: [],
					scores: [],
				}),
			}).frameCount
		).toBe(1);
	});
	it.each([
		{ engine: "torch" },
		{ artifact_sha256: "fake" },
		{ preprocessing: "unknown" },
		{ frame_count: 0 },
		{ frame_count: 86401 },
		{ frame_count: 1.5 },
		{ cut_frames: [-1] },
		{ cut_frames: [9] },
		{ cut_frames: [5, 5] },
		{ cut_frames: [6, 5] },
		{ scores: [] },
		{
			scores: [
				[4, null],
				[5, 0.9],
				[6, 0.1],
			],
		},
		{
			scores: [
				[3, 0.1],
				[5, 0.9],
				[6, 0.1],
			],
		},
		{ onnx_version: null },
	])("rejects malformed output %j", (override) => {
		expect(() =>
			parseOnnxShotOutput({ stdout: JSON.stringify({ ...valid, ...override }) })
		).toThrow();
	});
});

describe("ONNX child lifecycle", () => {
	it("runs a real child and parses progress across writes", async () => {
		const progress: number[] = [];
		const stdout = await runOnnxProcess({
			python: process.execPath,
			args: [
				"-e",
				"process.stderr.write('[progress] frames 24\\n');process.stdout.write('done')",
			],
			onFrames: (frames) => progress.push(frames),
		});
		expect(stdout).toBe("done");
		expect(progress).toEqual([24]);
	});
	it("propagates failure without successful-looking partial output", async () => {
		await expect(
			runOnnxProcess({
				python: process.execPath,
				args: ["-e", "console.log('{}');process.exit(3)"],
			})
		).rejects.toThrow("exited (3)");
	});
	it("rejects pre-cancelled work without spawning", async () => {
		await expect(
			runOnnxProcess({
				python: "missing-python",
				args: [],
				signal: AbortSignal.abort(),
			})
		).rejects.toThrow();
	});
	it("cancels running child and settles only after close", async () => {
		const controller = new AbortController();
		const task = runOnnxProcess({
			python: process.execPath,
			args: [
				"-e",
				"console.error('[progress] frames 24');setInterval(()=>{},1000)",
			],
			signal: controller.signal,
			onFrames: () => controller.abort(),
		});
		await expect(task).rejects.toThrow();
	});
	it("times out and stops the child", async () => {
		await expect(
			runOnnxProcess({
				python: process.execPath,
				args: ["-e", "setInterval(()=>{},1000)"],
				timeoutMs: 50,
			})
		).rejects.toThrow("timed out");
	});
	it("fails closed on excess output", async () => {
		await expect(
			runOnnxProcess({
				python: process.execPath,
				args: ["-e", "process.stdout.write('x'.repeat(9*1024*1024))"],
			})
		).rejects.toThrow("exceeded limit");
	});
});
