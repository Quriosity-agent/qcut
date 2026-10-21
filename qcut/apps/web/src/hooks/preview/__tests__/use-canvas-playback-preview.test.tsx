import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CanvasCompositionFrame } from "@/lib/preview/canvas-composition-frame";
import type { CanvasPlaybackCache } from "@/lib/preview/canvas-composition-playback-cache";
import {
	setupPlaybackPreviewTests,
	createCache,
	createRenderer,
	options,
	plan,
	deferred,
	capture,
	resources,
} from "./canvas-playback-preview-fixtures";
import { useCanvasPlaybackPreview } from "../use-canvas-playback-preview";

const stores = setupPlaybackPreviewTests();

describe("effect playback preparation lifecycle", () => {
	it("stores every export-compositor frame before publishing a ready session", async () => {
		const { cache, renderer, writeFrame } = resources();
		const lastWrite = deferred<void>();
		vi.mocked(cache.write).mockImplementationOnce(writeFrame);
		vi.mocked(cache.write).mockImplementationOnce(async (request) => {
			await lastWrite.promise;
			await writeFrame(request);
		});
		createCache.mockResolvedValue(cache);
		createRenderer.mockReturnValue(renderer);
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(cache.write).toHaveBeenCalledTimes(2));
		expect(result.current).toMatchObject({
			status: "preparing",
			completed: 1,
			total: 2,
		});
		expect(result.current.session).toBeUndefined();
		expect(renderer.render.mock.calls.map(([input]) => input.frame)).toEqual([
			0, 1,
		]);
		await act(async () => lastWrite.resolve());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(result.current.session).toMatchObject({ cache, plan, frames: 2 });
		expect(renderer.dispose).toHaveBeenCalledOnce();
		expect(cache.dispose).not.toHaveBeenCalled();
		expect(createRenderer).toHaveBeenCalledWith(
			expect.objectContaining({
				plan,
				backgroundColor: "#123456",
			})
		);
		expect(stores.state.pause).toHaveBeenCalledOnce();
	});

	it("does no work when a project or compatible plan is unavailable", () => {
		const { result, rerender } = renderHook(
			({ enabled, projectId }) =>
				useCanvasPlaybackPreview({ ...options, enabled, projectId }),
			{ initialProps: { enabled: false, projectId: "project-a" } }
		);
		act(() => result.current.prepare());
		expect(result.current.available).toBe(false);
		rerender({ enabled: true, projectId: "" });
		act(() => result.current.prepare());
		expect(createCache).not.toHaveBeenCalled();
		expect(createRenderer).not.toHaveBeenCalled();
	});

	it("suppresses a late in-flight frame after cancellation and releases its resources", async () => {
		const { cache, renderer } = resources();
		const pending = deferred<CanvasCompositionFrame>();
		renderer.render.mockReturnValueOnce(pending.promise);
		createCache.mockResolvedValue(cache);
		createRenderer.mockReturnValue(renderer);
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(renderer.render).toHaveBeenCalledTimes(2));
		const signal = createRenderer.mock.calls[0][0].signal;
		act(() => result.current.cancel());
		expect(signal.aborted).toBe(true);
		expect(result.current.status).toBe("idle");
		await act(async () => pending.resolve(capture({ frame: 0 })));
		await waitFor(() => expect(renderer.dispose).toHaveBeenCalledOnce());
		expect(result.current.session).toBeUndefined();
		expect(result.current.status).toBe("idle");
		expect(renderer.render).toHaveBeenCalledTimes(2);
		expect(cache.dispose).toHaveBeenCalledOnce();
	});

	it("invalidates a ready generation on edit and stops its playback", async () => {
		const { cache, renderer } = resources();
		createCache.mockResolvedValue(cache);
		createRenderer.mockReturnValue(renderer);
		const { result, rerender } = renderHook(
			({ backgroundColor }) =>
				useCanvasPlaybackPreview({ ...options, backgroundColor }),
			{ initialProps: { backgroundColor: "#123456" } }
		);
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		stores.state.isPlaying = true;
		rerender({ backgroundColor: "#654321" });
		expect(result.current.status).toBe("preparing");
		expect(result.current.session).toBeUndefined();
		expect(stores.state.isPlaying).toBe(false);
		await waitFor(() => expect(cache.dispose).toHaveBeenCalledOnce());
		expect(createRenderer.mock.calls[0][0].signal.aborted).toBe(true);
	});

	it.each([
		0, 1, 2, 3, 4,
	])("invalidates when compositor store %i changes and unsubscribes", async (index) => {
		const { result, unmount } = renderHook(() =>
			useCanvasPlaybackPreview(options)
		);
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		act(() => {
			for (const listener of stores.listeners[index])
				listener(
					{
						[[
							"activeEffects",
							"overlayStickers",
							"background",
							"config",
							"annotations",
						][index]]: {},
					},
					{}
				);
		});
		expect(result.current.status).toBe("preparing");
		expect(result.current.session).toBeUndefined();
		unmount();
		expect(stores.listeners.every((listeners) => listeners.size === 0)).toBe(
			true
		);
	});

	it("serializes replacement preparation until the old renderer releases its resources", async () => {
		const first = resources();
		const second = resources();
		const pending = deferred<CanvasCompositionFrame>();
		const disposal = deferred<void>();
		first.renderer.render.mockReturnValueOnce(pending.promise);
		first.renderer.dispose.mockReturnValueOnce(disposal.promise);
		createCache
			.mockResolvedValueOnce(first.cache)
			.mockResolvedValueOnce(second.cache);
		createRenderer
			.mockReturnValueOnce(first.renderer)
			.mockReturnValueOnce(second.renderer);
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(first.renderer.render).toHaveBeenCalledTimes(2));
		const firstGeneration = result.current.generation;
		act(() => result.current.prepare());
		expect(result.current.generation).not.toBe(firstGeneration);
		await act(async () => pending.resolve(capture({ frame: 0 })));
		await waitFor(() => expect(first.renderer.dispose).toHaveBeenCalledOnce());
		expect(createCache).toHaveBeenCalledOnce();
		expect(second.renderer.render).not.toHaveBeenCalled();
		await act(async () => disposal.resolve());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(result.current.session?.cache).toBe(second.cache);
		expect(first.renderer.render).toHaveBeenCalledTimes(2);
		expect(second.renderer.render).toHaveBeenCalledTimes(2);
	});

	it("disposes a cache created after unmount without starting a renderer", async () => {
		const { cache } = resources();
		const pending = deferred<CanvasPlaybackCache>();
		createCache.mockReturnValueOnce(pending.promise);
		const { result, unmount } = renderHook(() =>
			useCanvasPlaybackPreview(options)
		);
		act(() => result.current.prepare());
		await waitFor(() => expect(createCache).toHaveBeenCalledOnce());
		unmount();
		await act(async () => pending.resolve(cache));
		await waitFor(() => expect(cache.dispose).toHaveBeenCalledOnce());
		expect(createRenderer).not.toHaveBeenCalled();
	});

	it("reports render failure and releases both cache and renderer", async () => {
		const { cache, renderer } = resources();
		renderer.render.mockRejectedValueOnce(new Error("render failed"));
		createCache.mockResolvedValue(cache);
		createRenderer.mockReturnValue(renderer);
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("error"));
		expect(result.current.error).toBe("render failed");
		expect(cache.dispose).toHaveBeenCalledOnce();
		expect(renderer.dispose).toHaveBeenCalledOnce();
		expect(result.current.session).toBeUndefined();
	});
	it("does not publish ready until decoder cleanup has finished", async () => {
		const { renderer } = resources();
		const disposal = deferred<void>();
		renderer.dispose.mockReturnValueOnce(disposal.promise);
		createRenderer.mockReturnValue(renderer);
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(renderer.dispose).toHaveBeenCalledOnce());
		expect(result.current.status).toBe("preparing");
		expect(result.current.session).toBeUndefined();
		await act(async () => disposal.resolve());
		await waitFor(() => expect(result.current.status).toBe("ready"));
	});

	it("reports renderer cleanup failure and discards the otherwise complete cache", async () => {
		const { cache, renderer } = resources();
		renderer.dispose.mockRejectedValue(new Error("decoder release failed"));
		createRenderer.mockReturnValue(renderer);
		createCache.mockResolvedValue(cache);
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("error"));
		expect(result.current.error).toBe("decoder release failed");
		expect(result.current.session).toBeUndefined();
		expect(cache.dispose).toHaveBeenCalledOnce();
	});

	it("preserves the render error when cache and renderer cleanup also fail", async () => {
		const { cache, renderer } = resources();
		renderer.render.mockRejectedValueOnce(new Error("primary render failure"));
		renderer.dispose.mockRejectedValue(new Error("decoder cleanup failure"));
		vi.mocked(cache.dispose).mockRejectedValue(
			new Error("disk cleanup failure")
		);
		createRenderer.mockReturnValue(renderer);
		createCache.mockResolvedValue(cache);
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("error"));
		expect(result.current.error).toBe("primary render failure");
		expect(result.current.warning).toBe("disk cleanup failure");
		expect(result.current.session).toBeUndefined();
		expect(renderer.dispose).toHaveBeenCalledOnce();
	});

	it("pauses prepared playback before cancellation removes its frames", async () => {
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		stores.state.isPlaying = true;
		act(() => result.current.cancel());
		expect(stores.state.isPlaying).toBe(false);
		expect(result.current.status).toBe("idle");
		expect(result.current.session).toBeUndefined();
	});

	it("suspension cancels active preparation and suppresses its late completion", async () => {
		const { renderer } = resources();
		const pending = deferred<CanvasCompositionFrame>();
		renderer.render.mockReturnValueOnce(pending.promise);
		createRenderer.mockReturnValue(renderer);
		const { result, rerender } = renderHook(
			({ suspended }) => useCanvasPlaybackPreview({ ...options, suspended }),
			{ initialProps: { suspended: false } }
		);
		act(() => result.current.prepare());
		await waitFor(() => expect(renderer.render).toHaveBeenCalledTimes(2));
		rerender({ suspended: true });
		expect(createRenderer.mock.calls[0][0].signal.aborted).toBe(true);
		expect(result.current.status).toBe("idle");
		await act(async () => pending.resolve(capture({ frame: 0 })));
		await waitFor(() => expect(renderer.dispose).toHaveBeenCalledOnce());
		act(() => result.current.prepare());
		expect(createRenderer).toHaveBeenCalledOnce();
	});

	it("suspension preserves a completed cache for reuse after export", async () => {
		const { cache } = resources();
		createCache.mockResolvedValue(cache);
		const { result, rerender } = renderHook(
			({ suspended }) => useCanvasPlaybackPreview({ ...options, suspended }),
			{ initialProps: { suspended: false } }
		);
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		const session = result.current.session;
		rerender({ suspended: true });
		expect(result.current.session).toBe(session);
		act(() => result.current.prepare());
		expect(createCache).toHaveBeenCalledOnce();
		rerender({ suspended: false });
		expect(result.current.session).toBe(session);
		expect(cache.dispose).not.toHaveBeenCalled();
	});
	it.each([
		{ index: 0, changes: { selectedCategory: "color", selectedEffect: {} } },
		{ index: 1, changes: { selectedStickerId: "a", isDragging: true } },
		{
			index: 2,
			changes: { micGain: 2, micDeviceId: "device", autoZoomConfig: {} },
		},
		{ index: 4, changes: { selectedId: "annotation-a" } },
	])("keeps the cache for selection or recording UI changes in store $index", async ({
		index,
		changes,
	}) => {
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		const session = result.current.session;
		act(() => {
			for (const listener of stores.listeners[index]) listener(changes, {});
		});
		expect(result.current.session).toBe(session);
		expect(result.current.status).toBe("ready");
	});

	it.each([
		{ index: 0, field: "effectChains" },
		...[
			"cursorConfig",
			"cursorTelemetry",
			"showCursorOverlay",
			"zoomRegions",
			"speedRegions",
			"cursorLoopMode",
			"zoomMotionBlur",
		].map((field) => ({ index: 2, field })),
	])("invalidates compositor field $field", async ({ index, field }) => {
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		act(() => {
			for (const listener of stores.listeners[index])
				listener({ [field]: {} }, {});
		});
		expect(result.current.status).toBe("preparing");
	});

	it("invalidates nested effect edits when the store replaces its map", async () => {
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		const before = new Map([["clip", [{ parameters: { brightness: 1 } }]]]);
		const after = new Map(before);
		after.set("clip", [{ parameters: { brightness: 2 } }]);
		act(() => {
			for (const listener of stores.listeners[0])
				listener({ activeEffects: after }, { activeEffects: before });
		});
		expect(result.current.status).toBe("preparing");
	});

	it("blocks play while preparing and releases the guard when ready", async () => {
		const { renderer } = resources();
		const pending = deferred<CanvasCompositionFrame>();
		renderer.render.mockReturnValueOnce(pending.promise);
		createRenderer.mockReturnValue(renderer);
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(renderer.render).toHaveBeenCalledTimes(2));
		await act(async () => {
			stores.state.isPlaying = true;
			window.dispatchEvent(new CustomEvent("playback-play"));
		});
		expect(stores.state.isPlaying).toBe(false);
		await act(async () => pending.resolve(capture({ frame: 0 })));
		await waitFor(() => expect(result.current.status).toBe("ready"));
		await act(async () => {
			stores.state.isPlaying = true;
			window.dispatchEvent(new CustomEvent("playback-play"));
		});
		expect(stores.state.isPlaying).toBe(true);
	});
	it("surfaces cache warnings without failing successful preparation", async () => {
		const { cache } = resources();
		createCache.mockResolvedValue(
			Object.assign(cache, { cleanupWarnings: ["Crash cleanup unavailable"] })
		);
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(result.current.warning).toBe("Crash cleanup unavailable");
		expect(result.current.error).toBeUndefined();
	});

	it("logs old cache cleanup failure without poisoning a replacement generation", async () => {
		const first = resources();
		const second = resources();
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.mocked(first.cache.dispose).mockRejectedValue(
			new Error("old disk cleanup failed")
		);
		createCache
			.mockResolvedValueOnce(first.cache)
			.mockResolvedValueOnce(second.cache);
		createRenderer
			.mockReturnValueOnce(first.renderer)
			.mockReturnValueOnce(second.renderer);
		const { result } = renderHook(() => useCanvasPlaybackPreview(options));
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		act(() => result.current.prepare());
		await waitFor(() =>
			expect(result.current.session?.cache).toBe(second.cache)
		);
		expect(result.current.status).toBe("ready");
		expect(result.current.error).toBeUndefined();
		expect(result.current.warning).toBeUndefined();
		expect(warning).toHaveBeenCalledWith(
			"[effect-playback] Cache cleanup failed:",
			expect.any(Error)
		);
		warning.mockRestore();
	});
});
