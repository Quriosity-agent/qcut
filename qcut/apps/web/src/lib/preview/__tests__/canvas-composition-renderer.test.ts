import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderFrame } from "@/lib/export/export-engine-renderer";
import { buildExportRenderIndex } from "@/lib/export/export-render-index";
import {
	createCanvasCompositionRenderer,
	type CanvasCompositionPreviewPlan,
} from "../canvas-composition-frame";

const mocks = vi.hoisted(() => ({
	disposeAll: vi.fn(async () => {}),
}));
vi.mock("@/lib/export/export-engine-renderer", () => ({
	renderFrame: vi.fn(async () => {}),
}));
vi.mock("@/lib/export/export-sequential-video-source", () => ({
	SequentialVideoRegistry: class {
		disposeAll = mocks.disposeAll;
	},
}));

function plan(): CanvasCompositionPreviewPlan {
	const base = {
		tracks: [],
		mediaItems: [],
		width: 1080,
		height: 1920,
		fps: 30,
	};
	return {
		...base,
		renderIndex: buildExportRenderIndex({
			...base,
			canvasWidth: base.width,
			canvasHeight: base.height,
		}),
	};
}

describe("reusable composition renderer", () => {
	const originalContext = Object.getOwnPropertyDescriptor(
		HTMLCanvasElement.prototype,
		"getContext"
	);
	const originalBlob = Object.getOwnPropertyDescriptor(
		HTMLCanvasElement.prototype,
		"toBlob"
	);
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(renderFrame).mockResolvedValue();
		Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
			configurable: true,
			value: vi.fn(() => ({})),
		});
		Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
			configurable: true,
			value: (callback: BlobCallback) =>
				callback(new Blob(["png"], { type: "image/png" })),
		});
	});
	afterEach(() => {
		if (originalContext)
			Object.defineProperty(
				HTMLCanvasElement.prototype,
				"getContext",
				originalContext
			);
		if (originalBlob)
			Object.defineProperty(
				HTMLCanvasElement.prototype,
				"toBlob",
				originalBlob
			);
	});

	it("reuses the export context and decoder across sequential frames", async () => {
		const renderer = createCanvasCompositionRenderer({
			plan: plan(),
			signal: new AbortController().signal,
		});
		const first = await renderer.render({ frame: 0 });
		const second = await renderer.render({ frame: 1 });
		expect(first.frame).toBe(0);
		expect(second.timeSeconds).toBe(1 / 30);
		const [firstContext] = vi.mocked(renderFrame).mock.calls[0];
		const [secondContext] = vi.mocked(renderFrame).mock.calls[1];
		expect(secondContext).toBe(firstContext);
		expect(firstContext.strictMediaErrors).toBe(true);
		expect(firstContext.isolatedCompositor).toBe(true);
		expect(mocks.disposeAll).not.toHaveBeenCalled();
		await renderer.dispose();
		await renderer.dispose();
		expect(mocks.disposeAll).toHaveBeenCalledOnce();
		expect(firstContext.canvas.width).toBe(0);
		await expect(renderer.render({ frame: 2 })).rejects.toThrow("disposed");
	});

	it("keeps a frame's canvas unchanged until its PNG has encoded", async () => {
		const encoders: BlobCallback[] = [];
		Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
			configurable: true,
			value: (callback: BlobCallback) => encoders.push(callback),
		});
		const renderer = createCanvasCompositionRenderer({
			plan: plan(),
			signal: new AbortController().signal,
		});
		const first = renderer.render({ frame: 0 });
		const second = renderer.render({ frame: 1 });
		await vi.waitFor(() => expect(encoders).toHaveLength(1));
		expect(renderFrame).toHaveBeenCalledOnce();
		encoders[0](new Blob(["first"]));
		await first;
		await vi.waitFor(() => expect(encoders).toHaveLength(2));
		expect(renderFrame).toHaveBeenCalledTimes(2);
		encoders[1](new Blob(["second"]));
		await second;
		await renderer.dispose();
	});

	it("snapshots frames in native order while two PNG encoders complete out of order", async () => {
		const encoders: Array<{ callback: BlobCallback; time: number }> = [];
		let time = -1;
		vi.mocked(renderFrame).mockImplementation(async (_, value) => {
			time = value;
		});
		Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
			configurable: true,
			value: (callback: BlobCallback) => encoders.push({ callback, time }),
		});
		const renderer = createCanvasCompositionRenderer({
			plan: plan(),
			signal: new AbortController().signal,
			maxInFlightFrames: 2,
		});
		const first = renderer.render({ frame: 0 });
		const second = renderer.render({ frame: 1 });
		const third = renderer.render({ frame: 2 });
		await vi.waitFor(() => expect(encoders).toHaveLength(2));
		expect(encoders.map((entry) => entry.time)).toEqual([0, 1 / 30]);
		expect(renderFrame).toHaveBeenCalledTimes(2);
		const secondBlob = new Blob(["second snapshot"]);
		encoders[1].callback(secondBlob);
		expect((await second).blob).toBe(secondBlob);
		await vi.waitFor(() => expect(encoders).toHaveLength(3));
		expect(encoders[2].time).toBe(2 / 30);
		const firstBlob = new Blob(["first snapshot"]);
		encoders[0].callback(firstBlob);
		encoders[2].callback(new Blob(["third snapshot"]));
		expect((await first).blob).toBe(firstBlob);
		await third;
		expect(vi.mocked(renderFrame).mock.calls.map(([, value]) => value)).toEqual(
			[0, 1 / 30, 2 / 30]
		);
		await renderer.dispose();
	});

	it("drains both snapshots on cancellation without rendering queued work", async () => {
		const encoders: BlobCallback[] = [];
		Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
			configurable: true,
			value: (callback: BlobCallback) => encoders.push(callback),
		});
		const controller = new AbortController();
		const renderer = createCanvasCompositionRenderer({
			plan: plan(),
			signal: controller.signal,
			maxInFlightFrames: 2,
		});
		const frames = [0, 1, 2].map((frame) =>
			expect(renderer.render({ frame })).rejects.toMatchObject({
				name: "AbortError",
			})
		);
		await vi.waitFor(() => expect(encoders).toHaveLength(2));
		controller.abort();
		const disposed = renderer.dispose();
		encoders[1](new Blob(["second"]));
		await Promise.resolve();
		expect(mocks.disposeAll).not.toHaveBeenCalled();
		encoders[0](new Blob(["first"]));
		await Promise.all([...frames, disposed]);
		expect(renderFrame).toHaveBeenCalledTimes(2);
		expect(mocks.disposeAll).toHaveBeenCalledOnce();
	});

	it("stops queued inference after an encoder failure and releases the remaining snapshot", async () => {
		const encoders: BlobCallback[] = [];
		Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
			configurable: true,
			value: (callback: BlobCallback) => encoders.push(callback),
		});
		const renderer = createCanvasCompositionRenderer({
			plan: plan(),
			signal: new AbortController().signal,
			maxInFlightFrames: 2,
		});
		const frames = [0, 1, 2].map((frame) =>
			expect(renderer.render({ frame })).rejects.toThrow("encode")
		);
		await vi.waitFor(() => expect(encoders).toHaveLength(2));
		encoders[1](null);
		await Promise.resolve();
		encoders[0](new Blob(["first"]));
		await Promise.all(frames);
		expect(renderFrame).toHaveBeenCalledTimes(2);
		await renderer.dispose();
		expect(mocks.disposeAll).toHaveBeenCalledOnce();
	});

	it("cancels pending frames before they render and drains encoding before disposal", async () => {
		let encode: BlobCallback | undefined;
		Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
			configurable: true,
			value: (callback: BlobCallback) => {
				encode = callback;
			},
		});
		const controller = new AbortController();
		const renderer = createCanvasCompositionRenderer({
			plan: plan(),
			signal: controller.signal,
		});
		const first = renderer.render({ frame: 0 });
		const second = renderer.render({ frame: 1 });
		const firstAborted = expect(first).rejects.toMatchObject({
			name: "AbortError",
		});
		const secondAborted = expect(second).rejects.toMatchObject({
			name: "AbortError",
		});
		await vi.waitFor(() => expect(encode).toBeDefined());
		controller.abort();
		const disposal = renderer.dispose();
		expect(mocks.disposeAll).not.toHaveBeenCalled();
		encode?.(new Blob(["cancelled"]));
		await Promise.all([firstAborted, secondAborted, disposal]);
		expect(renderFrame).toHaveBeenCalledOnce();
		expect(mocks.disposeAll).toHaveBeenCalledOnce();
	});

	it("cleans up after a failed frame without poisoning the disposal promise", async () => {
		const renderer = createCanvasCompositionRenderer({
			plan: plan(),
			signal: new AbortController().signal,
		});
		vi.mocked(renderFrame).mockRejectedValueOnce(new Error("Worker failed"));
		await expect(renderer.render({ frame: 0 })).rejects.toThrow(
			"Worker failed"
		);
		await renderer.dispose();
		expect(mocks.disposeAll).toHaveBeenCalledOnce();
	});

	it("refuses invalid frame indices without entering the export renderer", async () => {
		const renderer = createCanvasCompositionRenderer({
			plan: plan(),
			signal: new AbortController().signal,
		});
		await expect(renderer.render({ frame: -1 })).rejects.toThrow("Invalid");
		await expect(renderer.render({ frame: 0.5 })).rejects.toThrow("Invalid");
		expect(renderFrame).not.toHaveBeenCalled();
		await renderer.dispose();
	});
});
