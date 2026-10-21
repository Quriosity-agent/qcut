import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createCanvasCompositionRenderer,
	type CanvasCompositionFrame,
	type CanvasCompositionPreviewPlan,
} from "../canvas-composition-frame";
import {
	CANVAS_PREPARATION_MAX_PIXEL_BYTES,
	prepareCanvasPlaybackFrames,
} from "../canvas-composition-playback-preparation";

vi.mock("../canvas-composition-frame", () => ({
	createCanvasCompositionRenderer: vi.fn(),
}));

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<Value>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function fixture({ width = 1080, height = 1920, frames = 4 } = {}) {
	const plan: CanvasCompositionPreviewPlan = {
		tracks: [],
		mediaItems: [],
		renderIndex: {
			timelineStickerIds: new Set(),
			mediaItemsById: new Map(),
			clipTransitions: {
				canvasTracks: null,
				canvasTransitions: [],
				jianyingTransitions: [],
				unsupported: [],
			},
		},
		width,
		height,
		fps: 30,
	};
	const captures = Array.from({ length: frames }, () =>
		deferred<CanvasCompositionFrame>()
	);
	const renderer = {
		render: vi.fn(({ frame }: { frame: number }) => captures[frame].promise),
		dispose: vi.fn(async () => {}),
	};
	vi.mocked(createCanvasCompositionRenderer).mockReturnValue(renderer);
	const controller = new AbortController();
	const cache = {
		write: vi.fn(
			async ({ signal }: { frame: number; blob: Blob; signal: AbortSignal }) =>
				signal.throwIfAborted()
		),
	};
	const progress = vi.fn();
	const start = () =>
		prepareCanvasPlaybackFrames({
			plan,
			frames,
			cache,
			signal: controller.signal,
			onProgress: progress,
		});
	const finish = ({ frame }: { frame: number }) =>
		captures[frame].resolve({
			frame,
			timeSeconds: frame / plan.fps,
			width,
			height,
			blob: new Blob(["x".repeat(frame + 1)], { type: "image/png" }),
			timings: { renderMs: 10, encodeMs: 5 },
		});
	return { captures, renderer, cache, controller, progress, start, finish };
}

beforeEach(() => vi.resetAllMocks());

describe("bounded composition preparation", () => {
	it("overlaps encoding and writing while retaining only two jobs and committing in frame order", async () => {
		const { renderer, cache, progress, start, finish } = fixture();
		const writing = deferred<void>();
		cache.write.mockReturnValueOnce(writing.promise);
		const preparation = start();
		expect(renderer.render.mock.calls.map(([{ frame }]) => frame)).toEqual([
			0, 1,
		]);
		finish({ frame: 1 });
		await Promise.resolve();
		expect(cache.write).not.toHaveBeenCalled();
		finish({ frame: 0 });
		await vi.waitFor(() => expect(cache.write).toHaveBeenCalledOnce());
		expect(renderer.render).toHaveBeenCalledTimes(2);
		expect(progress).not.toHaveBeenCalled();
		writing.resolve();
		await vi.waitFor(() => expect(renderer.render).toHaveBeenCalledTimes(4));
		finish({ frame: 3 });
		finish({ frame: 2 });
		const metrics = await preparation;
		expect(cache.write.mock.calls.map(([input]) => input.frame)).toEqual([
			0, 1, 2, 3,
		]);
		expect(progress.mock.calls.map(([value]) => value.completed)).toEqual([
			1, 2, 3, 4,
		]);
		expect(metrics).toMatchObject({
			renderMs: 40,
			encodeMs: 20,
			maxInFlightFrames: 2,
			maxReservedPixelBytes: 1080 * 1920 * 4 * 3,
			maxPendingPngBytes: 7,
		});
		expect(renderer.dispose).toHaveBeenCalledOnce();
	});

	it("admits only one 4K job including its output canvas in the pixel reservation", async () => {
		const { renderer, cache, start, finish } = fixture({
			width: 3840,
			height: 2160,
			frames: 2,
		});
		const writing = deferred<void>();
		cache.write.mockReturnValueOnce(writing.promise);
		const preparation = start();
		expect(createCanvasCompositionRenderer).toHaveBeenCalledWith(
			expect.objectContaining({ maxInFlightFrames: 1 })
		);
		expect(renderer.render).toHaveBeenCalledOnce();
		finish({ frame: 0 });
		await vi.waitFor(() => expect(cache.write).toHaveBeenCalledOnce());
		expect(renderer.render).toHaveBeenCalledOnce();
		writing.resolve();
		await vi.waitFor(() => expect(renderer.render).toHaveBeenCalledTimes(2));
		finish({ frame: 1 });
		const metrics = await preparation;
		expect(metrics.maxInFlightFrames).toBe(1);
		expect(metrics.maxReservedPixelBytes).toBe(3840 * 2160 * 4 * 2);
		expect(metrics.maxReservedPixelBytes).toBeLessThanOrEqual(
			CANVAS_PREPARATION_MAX_PIXEL_BYTES
		);
	});

	it("aborts peer work on quota failure, drains its late PNG and never submits a third frame", async () => {
		const { renderer, cache, start, finish } = fixture();
		cache.write.mockRejectedValueOnce(new Error("disk quota"));
		const preparation = start();
		const failed = expect(preparation).rejects.toThrow("disk quota");
		finish({ frame: 0 });
		await vi.waitFor(() =>
			expect(
				vi.mocked(createCanvasCompositionRenderer).mock.calls[0][0].signal
					.aborted
			).toBe(true)
		);
		expect(renderer.dispose).not.toHaveBeenCalled();
		expect(renderer.render).toHaveBeenCalledTimes(2);
		finish({ frame: 1 });
		await failed;
		expect(renderer.dispose).toHaveBeenCalledOnce();
		expect(cache.write).toHaveBeenCalledOnce();
	});

	it("stops immediately on a later frame failure and preserves its error", async () => {
		const { captures, renderer, cache, start, finish } = fixture();
		const preparation = start();
		const failed = expect(preparation).rejects.toThrow("encoder failed");
		captures[1].reject(new Error("encoder failed"));
		await Promise.resolve();
		expect(
			vi.mocked(createCanvasCompositionRenderer).mock.calls[0][0].signal.aborted
		).toBe(true);
		finish({ frame: 0 });
		await failed;
		expect(cache.write).not.toHaveBeenCalled();
		expect(renderer.render).toHaveBeenCalledTimes(2);
		expect(renderer.dispose).toHaveBeenCalledOnce();
	});

	it("drains both in-flight snapshots after cancellation without progress or writes", async () => {
		const { controller, renderer, cache, progress, start, finish } = fixture();
		const preparation = start();
		const aborted = expect(preparation).rejects.toMatchObject({
			name: "AbortError",
		});
		controller.abort();
		finish({ frame: 0 });
		await Promise.resolve();
		expect(renderer.dispose).not.toHaveBeenCalled();
		finish({ frame: 1 });
		await aborted;
		expect(renderer.dispose).toHaveBeenCalledOnce();
		expect(renderer.render).toHaveBeenCalledTimes(2);
		expect(cache.write).not.toHaveBeenCalled();
		expect(progress).not.toHaveBeenCalled();
	});
});
