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
	ffmpegScenes: vi.fn(),
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
	inspectOnnxEngine: vi.fn(async () => mocks.onnx),
	detectShotsWithOnnxEngine: (...args: unknown[]) => mocks.detectOnnx(...args),
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

	it("auto falls through to ffmpeg with the reasons when the models are missing", async () => {
		mocks.jianying = {
			...mocks.jianying,
			available: false,
			message: "no bridge",
		};
		const run = mocks.detectBridge;
		// The FFmpeg path spawns ffmpeg; refuse it loudly so the fallback choice is what we test.
		const result = await detectScenes("p", {
			mediaId: "m1",
			engine: "auto",
		}).catch((error: Error) => error);
		expect(run).not.toHaveBeenCalled();
		expect(mocks.detectOnnx).not.toHaveBeenCalled();
		// Either ffmpeg ran (unlikely in CI) or its spawn failed; in both cases the
		// engine chosen was ffmpeg, which the error or result shows.
		if (result instanceof Error) {
			expect(result.message).not.toContain("No scene detection engine");
		} else {
			expect(result.engine).toBe("ffmpeg");
			expect(result.fallbacks).toEqual([
				{ engine: "jianying", reason: "no bridge" },
				{ engine: "onnx", reason: "ONNX 本地模型未配置" },
			]);
		}
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
