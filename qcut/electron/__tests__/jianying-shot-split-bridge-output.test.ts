// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	parseShotSplitBridgeOutput,
	parseShotSplitProgressLine,
	shotBoundariesFromPredictResult,
} from "../jianying-shot-split/bridge-output.js";

const TRANSCRIPT = [
	"M1 OK  loaded /runtime/Frameworks/libcccreator.dylib",
	"M2 OK   BachAlgorithmSystem=0x1",
	'M3 OK   init(appName="VESDK", second="") -> 0',
	"M4 OK   initGraph(/runtime/Resources/SceneEditDetection/config.json) -> 0",
	"M4c OK  loadModel() -> 0",
	"[execute] first frame -> 0",
	"[progress] fed 240 frames",
	"M5a fed 288 frames (320x180 rgba fmt=0 type=1 fps=24.00) in 157 ms, failures=0",
	"M5b EOF frame -> 0",
	"[result] frame_received: BachObject type=31 payload=0x1",
	"[result] predict_result: vector impl 0x1 begin=0x2 end=0x3 n=3",
	"frame_received: 1 ",
	"predict_result: 71 143 215 ",
	"cut points (frame/fps): 2.958 5.958 8.958 ",
	"",
].join("\n");

describe("shot-split bridge output", () => {
	it("parses the frame count and predict_result from a full transcript", () => {
		expect(parseShotSplitBridgeOutput({ stdout: TRANSCRIPT })).toEqual({
			eofStatus: 0,
			executeFailures: 0,
			frameCount: 288,
			frameReceived: [1],
			predictResult: [71, 143, 215],
		});
	});

	it("treats an empty predict_result line as no cuts", () => {
		const stdout = TRANSCRIPT.replace(
			"predict_result: 71 143 215 ",
			"predict_result: "
		);
		expect(parseShotSplitBridgeOutput({ stdout }).predictResult).toEqual([]);
	});

	it("rejects transcripts with failed milestones, inference failures or no EOF", () => {
		expect(() =>
			parseShotSplitBridgeOutput({
				stdout: "M1 FAIL dlopen: image not found\n",
			})
		).toThrow("初始化失败");
		expect(() =>
			parseShotSplitBridgeOutput({
				stdout: TRANSCRIPT.replace("failures=0", "failures=2"),
			})
		).toThrow("2 帧推理失败");
		expect(() =>
			parseShotSplitBridgeOutput({
				stdout: TRANSCRIPT.replace("M5b EOF frame -> 0\n", ""),
			})
		).toThrow("收尾帧");
		expect(() =>
			parseShotSplitBridgeOutput({
				stdout: TRANSCRIPT.replace("predict_result: 71 143 215 \n", ""),
			})
		).toThrow("predict_result");
		expect(() => parseShotSplitBridgeOutput({ stdout: "" })).toThrow(
			"已处理的帧数"
		);
	});

	it("reads progress heartbeats", () => {
		expect(
			parseShotSplitProgressLine({ line: "[progress] fed 480 frames" })
		).toBe(480);
		expect(
			parseShotSplitProgressLine({ line: "M5a fed 288 frames" })
		).toBeNull();
	});
});

describe("shotBoundariesFromPredictResult", () => {
	it("maps last-frame indices to next-shot start times and shot ranges", () => {
		const boundaries = shotBoundariesFromPredictResult({
			fps: 24,
			frameCount: 288,
			predictResult: [71, 143, 215],
		});
		expect(boundaries.cutFrames).toEqual([71, 143, 215]);
		expect(boundaries.cutPoints).toEqual([3, 6, 9]);
		expect(boundaries.shots).toEqual([
			{ endFrame: 71, endTime: 3, index: 0, startFrame: 0, startTime: 0 },
			{ endFrame: 143, endTime: 6, index: 1, startFrame: 72, startTime: 3 },
			{ endFrame: 215, endTime: 9, index: 2, startFrame: 144, startTime: 6 },
			{ endFrame: 287, endTime: 12, index: 3, startFrame: 216, startTime: 9 },
		]);
	});

	it("drops the end-of-video index, dedupes and sorts", () => {
		const boundaries = shotBoundariesFromPredictResult({
			fps: 12,
			frameCount: 120,
			predictResult: [119, 35, 35, 11],
		});
		expect(boundaries.cutFrames).toEqual([11, 35]);
		expect(boundaries.cutPoints).toEqual([1, 3]);
		expect(boundaries.shots).toHaveLength(3);
	});

	it("returns a single shot when nothing was detected and none for zero frames", () => {
		expect(
			shotBoundariesFromPredictResult({
				fps: 24,
				frameCount: 48,
				predictResult: [],
			}).shots
		).toEqual([
			{ endFrame: 47, endTime: 2, index: 0, startFrame: 0, startTime: 0 },
		]);
		expect(
			shotBoundariesFromPredictResult({
				fps: 24,
				frameCount: 0,
				predictResult: [],
			})
		).toEqual({ cutFrames: [], cutPoints: [], shots: [] });
	});

	it("rejects invalid frame rates and indices", () => {
		expect(() =>
			shotBoundariesFromPredictResult({
				fps: 0,
				frameCount: 10,
				predictResult: [],
			})
		).toThrow("采样帧率无效");
		expect(() =>
			shotBoundariesFromPredictResult({
				fps: 24,
				frameCount: 10,
				predictResult: [-1],
			})
		).toThrow("无效帧索引");
	});
});
