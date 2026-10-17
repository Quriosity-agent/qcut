import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	jianying: {
		available: true,
		message: "ready",
		route: "qcut-jianying-shot-split-v1",
	},
	onnx: { available: false, message: "ONNX 本地模型未配置" },
	detectBridge: vi.fn(),
	detectOnnx: vi.fn(),
	inspectOnnx: vi.fn(),
	spawn: vi.fn(),
}));

vi.mock("electron", () => ({
	app: { getPath: vi.fn(() => "/tmp"), isPackaged: false },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
vi.mock("electron-log", () => ({
	default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../jianying-shot-split/runtime.js", () => ({
	inspectJianyingShotSplit: vi.fn(async () => mocks.jianying),
	detectShotsWithJianyingRuntime: (...args: unknown[]) =>
		mocks.detectBridge(...args),
}));
vi.mock("../jianying-shot-split/onnx-engine.js", () => ({
	inspectOnnxEngine: (...args: unknown[]) => {
		mocks.inspectOnnx(...args);
		return Promise.resolve(mocks.onnx);
	},
	detectShotsWithOnnxEngine: (...args: unknown[]) => mocks.detectOnnx(...args),
}));
// FFmpeg scene detection spawns ffmpeg; a process that closes cleanly with no
// output stands in for it, so the fallback choice is what the tests observe.
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	const { EventEmitter } = await import("node:events");
	return {
		...actual,
		spawn: (...args: unknown[]) => {
			mocks.spawn(...args);
			const proc = new EventEmitter() as EventEmitter & {
				kill: () => void;
				stderr: EventEmitter;
			};
			proc.kill = vi.fn();
			proc.stderr = new EventEmitter();
			process.nextTick(() => proc.emit("close", 0));
			return proc;
		},
	};
});
vi.mock("../ffmpeg/utils.js", () => ({
	getFFmpegPath: vi.fn(() => "/usr/bin/ffmpeg"),
}));
vi.mock("../claude/handlers/claude-media-handler.js", () => ({
	getMediaInfo: vi.fn(async () => ({
		id: "m1",
		type: "video",
		path: "/media/clip.mp4",
		name: "clip.mp4",
	})),
	listMediaFiles: vi.fn(async () => [
		{ id: "m1", type: "video", path: "/media/clip.mp4", name: "clip.mp4" },
	]),
}));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, existsSync: () => true, mkdirSync: () => undefined };
});
vi.mock("../api-key-handler.js", () => ({
	getDecryptedApiKeys: vi.fn(async () => ({})),
}));

import {
	detectScenes,
	inspectSceneEngines,
} from "../claude/handlers/claude-scene-handler.js";

/** `auto` runs the most accurate engine that is available and says what it skipped. */
describe("scene engine resolution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.jianying = {
			available: true,
			message: "ready",
			route: "qcut-jianying-shot-split-v1",
		};
		mocks.onnx = { available: false, message: "ONNX 本地模型未配置" };
		mocks.detectBridge.mockResolvedValue({
			engine: "bridge",
			route: "qcut-jianying-shot-split-v1",
			durationSeconds: 30,
			cutFrames: [80, 99],
			cutPoints: [3.333, 4.125],
		});
	});

	it("lists every engine with its availability and auto's pick", async () => {
		const status = await inspectSceneEngines();
		expect(
			status.engines.map((entry) => [entry.engine, entry.available])
		).toEqual([
			["jianying", true],
			["onnx", false],
			["ffmpeg", true],
		]);
		expect(status.preferred).toBe("jianying");
		mocks.jianying = {
			...mocks.jianying,
			available: false,
			message: "no bridge",
		};
		expect((await inspectSceneEngines()).preferred).toBe("ffmpeg");
	});

	it("auto picks the bridge when it is ready and reports a confident cut per shot", async () => {
		const result = await detectScenes("p", { mediaId: "m1" });
		expect(result.engine).toBe("jianying");
		expect(result.requestedEngine).toBe("auto");
		expect(result.fallbacks).toBeUndefined();
		expect(result.scenes.map((scene) => scene.timestamp)).toEqual([
			0, 3.333, 4.125,
		]);
		expect(result.scenes.every((scene) => scene.confidence === 1)).toBe(true);
		expect(mocks.detectBridge).toHaveBeenCalledWith({
			request: { sourcePath: "/media/clip.mp4" },
		});
	});

	it("warns when auto lands on a model engine that cannot use the threshold", async () => {
		const result = await detectScenes("p", { mediaId: "m1", threshold: 0.2 });
		expect(result.engine).toBe("jianying");
		expect(result.warnings).toEqual([
			"threshold 0.2 ignored: the jianying engine has no threshold",
		]);
		const explicit = await detectScenes("p", {
			mediaId: "m1",
			engine: "jianying",
		});
		expect(explicit.warnings).toBeUndefined();
	});

	it("auto falls through to ffmpeg with the reasons when the models are missing", async () => {
		mocks.jianying = {
			...mocks.jianying,
			available: false,
			message: "no bridge",
		};
		const result = await detectScenes("p", { mediaId: "m1", engine: "auto" });
		expect(mocks.detectBridge).not.toHaveBeenCalled();
		expect(mocks.detectOnnx).not.toHaveBeenCalled();
		expect(mocks.spawn).toHaveBeenCalledTimes(1);
		expect(result.engine).toBe("ffmpeg");
		expect(result.requestedEngine).toBe("auto");
		expect(result.fallbacks).toEqual([
			{ engine: "jianying", reason: "no bridge" },
			{ engine: "onnx", reason: "ONNX 本地模型未配置" },
		]);
		expect(result.scenes).toEqual([{ timestamp: 0, confidence: 1 }]);
	});

	it("auto stops probing at the first engine that can run", async () => {
		await detectScenes("p", { mediaId: "m1" });
		// The bridge is ready, so the ONNX check (a Python process) never starts.
		expect(mocks.inspectOnnx).not.toHaveBeenCalled();
	});

	it("refuses unknown engines and a threshold for a model engine", async () => {
		await expect(
			detectScenes("p", { mediaId: "m1", engine: "magic" as never })
		).rejects.toThrow("Invalid scene detection engine");
		await expect(
			detectScenes("p", { mediaId: "m1", engine: "jianying", threshold: 0.3 })
		).rejects.toThrow("threshold is only supported by the FFmpeg scene engine");
	});
});
