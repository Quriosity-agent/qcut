import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createCanvasCompositionRenderer,
	type CanvasCompositionPreviewPlan,
} from "../canvas-composition-frame";
import { prepareCanvasPlaybackFrames } from "../canvas-composition-playback-preparation";

vi.mock("../canvas-composition-frame", () => ({
	createCanvasCompositionRenderer: vi.fn(),
}));

function fixture() {
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
		width: 1080,
		height: 1920,
		fps: 30,
	};
	const blobs = new Map<number, Blob>();
	const renderer = {
		render: vi.fn(async ({ frame }: { frame: number }) => {
			const blob = new Blob([`absolute frame ${frame}`], { type: "image/png" });
			blobs.set(frame, blob);
			return {
				frame,
				timeSeconds: frame / plan.fps,
				width: plan.width,
				height: plan.height,
				blob,
				timings: { renderMs: 10, encodeMs: 2 },
			};
		}),
		dispose: vi.fn(async () => {}),
	};
	vi.mocked(createCanvasCompositionRenderer).mockReturnValue(renderer);
	const cache = {
		write: vi.fn(
			async ({ signal }: { frame: number; blob: Blob; signal: AbortSignal }) =>
				signal.throwIfAborted()
		),
	};
	const controller = new AbortController();
	const progress = vi.fn();
	const prepare = ({
		startFrame,
		frames,
	}: {
		startFrame: number;
		frames: number;
	}) =>
		prepareCanvasPlaybackFrames({
			plan,
			startFrame,
			frames,
			cache,
			signal: controller.signal,
			onProgress: progress,
		});
	return { plan, renderer, blobs, cache, controller, progress, prepare };
}

beforeEach(() => vi.resetAllMocks());

describe("absolute frame preparation ranges", () => {
	it("renders and writes only the requested absolute interval while reporting local progress", async () => {
		const { plan, renderer, blobs, cache, progress, prepare } = fixture();
		const metrics = await prepare({ startFrame: 1800, frames: 4 });
		expect(renderer.render.mock.calls.map(([{ frame }]) => frame)).toEqual([
			1800, 1801, 1802, 1803,
		]);
		expect(cache.write.mock.calls.map(([{ frame }]) => frame)).toEqual([
			1800, 1801, 1802, 1803,
		]);
		for (const [{ frame, blob }] of cache.write.mock.calls)
			expect(blob).toBe(blobs.get(frame));
		expect(progress.mock.calls.map(([value]) => value.completed)).toEqual([
			1, 2, 3, 4,
		]);
		expect(createCanvasCompositionRenderer).toHaveBeenCalledWith(
			expect.objectContaining({ plan, maxInFlightFrames: 2 })
		);
		expect(metrics).toMatchObject({ renderMs: 40, encodeMs: 8 });
		expect(renderer.dispose).toHaveBeenCalledOnce();
	});

	it("accepts a one-frame tail without renumbering it to zero", async () => {
		const { renderer, cache, progress, prepare } = fixture();
		await prepare({ startFrame: 1799, frames: 1 });
		expect(renderer.render).toHaveBeenCalledExactlyOnceWith({ frame: 1799 });
		expect(cache.write.mock.calls[0][0].frame).toBe(1799);
		expect(progress.mock.calls[0][0].completed).toBe(1);
	});

	it.each([
		{ startFrame: -1, frames: 1 },
		{ startFrame: 0.5, frames: 1 },
		{ startFrame: Number.MAX_SAFE_INTEGER, frames: 1 },
		{ startFrame: 10, frames: 0 },
	])("rejects invalid ranges before constructing a renderer %o", async (range) => {
		const { prepare, cache } = fixture();
		await expect(prepare(range)).rejects.toThrow(
			"Invalid composition preparation dimensions or capacity"
		);
		expect(createCanvasCompositionRenderer).not.toHaveBeenCalled();
		expect(cache.write).not.toHaveBeenCalled();
	});
});
