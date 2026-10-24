// @vitest-environment node
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createIndependentSequenceFrameRenderer } from "../beauty-lab/beauty-lab-independent-body-video";
import { createIndependentFrameRenderer } from "../beauty-lab/beauty-lab-independent-frames";
import type { BeautyLabIndependentResult } from "../beauty-lab/beauty-lab-independent-contract";

vi.mock("../beauty-lab/beauty-lab-independent-coreml-history", () => ({
	createCoreMLHistoryGuard: () => ({ synchronize: vi.fn(async () => {}) }),
}));

const request = {
	requestId: "coreml",
	width: 1,
	height: 1,
	rgba: new Uint8Array([1, 2, 3, 255]),
	adjustments: {
		enabled: true as const,
		values: { body_adjust_SlimBody: 25 },
		bodyVideoProfile: "swing-coreml-v1" as const,
	},
	sequence: {
		clip: "c".repeat(64),
		frame: 0,
		fps: 24,
		replay: false,
		sourceTimestampSeconds: 1.001,
	},
};
function setup() {
	const result = {
		...request,
		png: new Uint8Array(),
		report: {},
	} as unknown as BeautyLabIndependentResult;
	const provider = { render: vi.fn(async () => result), cancel: vi.fn() };
	const cache = {
		read: vi.fn(async () => null as Uint8Array | null),
		write: vi.fn(async () => {}),
	};
	const resolveCoreML = vi.fn(async () => ({
		engineSha256: "e".repeat(64),
		identitySha256: "i".repeat(64),
		execution: { profile: "swing-coreml-v1" },
	}));
	const options = {
		provider,
		cache,
		resolveCoreML,
		engineSha256: vi.fn(async () => "w".repeat(64)),
		sessionsDirectory: path.join(os.tmpdir(), "coreml-test-missing"),
	};
	return {
		...options,
		frames: createIndependentSequenceFrameRenderer(options),
		result,
		options,
	};
}

describe("explicit CoreML body sequence", () => {
	it("passes decoded source PTS to the graph without quantizing it to timeline FPS", async () => {
		const test = setup();
		await test.frames.render({ request });
		expect(test.provider.render).toHaveBeenCalledWith({
			request: expect.objectContaining({
				sequence: expect.objectContaining({ frame: 0, timestamp: 1.001 }),
			}),
		});
	});
	it("rejects missing source PTS before resource checks or cache reuse", async () => {
		const test = setup();
		const { sourceTimestampSeconds: _timestamp, ...sequence } =
			request.sequence;
		await expect(
			test.frames.render({ request: { ...request, sequence } })
		).rejects.toThrow("source timestamp");
		expect(test.resolveCoreML).not.toHaveBeenCalled();
		expect(test.cache.read).not.toHaveBeenCalled();
	});
	it("does not reuse a cached frame with a different source timestamp", async () => {
		const test = setup();
		test.cache.read.mockResolvedValue(request.rgba);
		await test.frames.render({ request });
		await test.frames.render({
			request: {
				...request,
				sequence: { ...request.sequence, sourceTimestampSeconds: 1.042708 },
			},
		});
		expect(test.cache.read.mock.calls[0]).not.toEqual(
			test.cache.read.mock.calls[1]
		);
	});
	it("validates resources before a cached frame can be read", async () => {
		const test = setup();
		test.cache.read.mockResolvedValue(request.rgba);
		test.resolveCoreML.mockRejectedValue(new Error("model changed"));
		await expect(test.frames.render({ request })).rejects.toThrow(
			"model changed"
		);
		expect(test.cache.read).not.toHaveBeenCalled();
		expect(test.provider.render).not.toHaveBeenCalled();
	});
	it("validates even cache hits and refuses unavailable host implementations", async () => {
		const test = setup();
		test.cache.read.mockResolvedValue(request.rgba);
		expect(await test.frames.render({ request })).toMatchObject({
			cached: true,
		});
		expect(test.resolveCoreML).toHaveBeenCalledOnce();
		const frames = createIndependentSequenceFrameRenderer({
			...test.options,
			resolveCoreML: undefined,
		});
		await expect(frames.render({ request })).rejects.toThrow("unavailable");
	});
	it("passes a deterministic generation which survives reopening", async () => {
		const test = setup();
		await test.frames.render({ request });
		const first = test.provider.render.mock.calls[0]?.[0] as unknown as {
			request: { sequence: Record<string, unknown> };
		};
		expect(first.request.sequence).toMatchObject({
			executionProfile: "swing-coreml-v1",
			executionIdentitySha256: "i".repeat(64),
			executionGeneration: first.request.sequence.session,
		});
		const reopened = createIndependentSequenceFrameRenderer(test.options);
		await reopened.render({ request });
		expect(test.provider.render.mock.calls[1]).toEqual(
			test.provider.render.mock.calls[0]
		);
		expect(test.options.engineSha256).not.toHaveBeenCalled();
	});
	it.each([
		"resources",
		"clip",
		"fps",
		"width",
		"height",
	])("separates session/cache identity after %s changes", async (change) => {
		const test = setup();
		test.cache.read.mockResolvedValue(request.rgba);
		await test.frames.render({ request });
		const edited = structuredClone(request);
		if (change === "resources")
			test.resolveCoreML.mockResolvedValue({
				engineSha256: "f".repeat(64),
				identitySha256: "j".repeat(64),
				execution: { profile: "swing-coreml-v1" },
			});
		if (change === "clip") edited.sequence.clip = "d".repeat(64);
		if (change === "fps") edited.sequence.fps = 30;
		if (change === "width") {
			edited.width = 2;
			edited.rgba = new Uint8Array(8);
		}
		if (change === "height") {
			edited.height = 2;
			edited.rgba = new Uint8Array(8);
		}
		await test.frames.render({ request: edited });
		expect(test.cache.read.mock.calls[0]).not.toEqual(
			test.cache.read.mock.calls[1]
		);
	});
	it("cancels the active provider and never caches its late success", async () => {
		const test = setup();
		let finish!: (value: BeautyLabIndependentResult) => void;
		test.provider.render.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const running = test.frames.render({ request });
		await vi.waitFor(() => expect(test.provider.render).toHaveBeenCalledOnce());
		expect(
			test.frames.cancel({ request: { requestId: request.requestId } })
		).toEqual({ cancelled: true });
		expect(test.provider.cancel).toHaveBeenCalledWith({
			request: { requestId: request.requestId },
		});
		finish(test.result);
		await expect(running).rejects.toThrow("cancelled");
		expect(test.cache.write).not.toHaveBeenCalled();
	});
	it("disposal closes an active CoreML request without discarding its checkpoint folder", async () => {
		const test = setup();
		let finish!: (value: BeautyLabIndependentResult) => void;
		test.provider.render.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const running = test.frames.render({ request });
		await vi.waitFor(() => expect(test.provider.render).toHaveBeenCalledOnce());
		test.frames.dispose();
		expect(test.provider.cancel).toHaveBeenCalledOnce();
		finish(test.result);
		await expect(running).rejects.toThrow("disposed");
		expect(test.cache.write).not.toHaveBeenCalled();
	});
	it("rejects the profile in the still endpoint before its cache lookup", async () => {
		const test = setup();
		const frames = createIndependentFrameRenderer(test.options);
		const { sequence: _sequence, ...still } = request;
		await expect(frames.render({ request: still })).rejects.toThrow(
			"sequence API"
		);
		expect(test.cache.read).not.toHaveBeenCalled();
	});
});
