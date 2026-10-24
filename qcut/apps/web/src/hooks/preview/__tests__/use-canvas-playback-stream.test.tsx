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

async function advancePreparation({ milliseconds = 0 } = {}) {
	await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
}

function seekWhilePreparing({ time }: { time: number }) {
	act(() => {
		window.dispatchEvent(
			new CustomEvent("playback-seek", { detail: { time } })
		);
	});
}

describe("segmented playback preparation", () => {
	it("debounces rapid edits and prepares only the current rolling window using the latest plan", async () => {
		vi.useFakeTimers();
		stores.state.currentTime = 10;
		const first = resources();
		const next = resources();
		createCache
			.mockResolvedValueOnce(first.cache)
			.mockResolvedValue(next.cache);
		createRenderer
			.mockReturnValueOnce(first.renderer)
			.mockReturnValueOnce(first.renderer)
			.mockReturnValue(next.renderer);
		const { result, rerender } = renderHook(
			({ snapshot, backgroundColor }) =>
				useCanvasPlaybackPreview({
					...options,
					plan: snapshot,
					backgroundColor,
					totalDuration: 120,
				}),
			{ initialProps: { snapshot: plan, backgroundColor: "#123456" } }
		);
		act(() => result.current.prepare());
		await advancePreparation();
		expect(result.current.status).toBe("ready");
		const previous = result.current.session;
		rerender({ snapshot: { ...plan }, backgroundColor: "#111111" });
		expect(result.current.status).toBe("preparing");
		expect(result.current.session).toBeUndefined();
		await advancePreparation({ milliseconds: 100 });
		const latest = { ...plan };
		rerender({ snapshot: latest, backgroundColor: "#222222" });
		seekWhilePreparing({ time: 20 });
		await advancePreparation({ milliseconds: 149 });
		expect(createCache).toHaveBeenCalledOnce();
		await advancePreparation({ milliseconds: 1 });
		expect(result.current.status).toBe("ready");
		expect(result.current.session).not.toBe(previous);
		expect(result.current.session?.plan).toBe(latest);
		expect(createCache).toHaveBeenCalledTimes(2);
		expect(createRenderer).toHaveBeenLastCalledWith(
			expect.objectContaining({ plan: latest, backgroundColor: "#222222" })
		);
		expect(
			next.renderer.render.mock.calls.map(([input]) => input.frame)
		).toEqual(Array.from({ length: 120 }, (_, offset) => 600 + offset));
		expect(result.current.total).toBe(3600);
		expect(result.current.completed).toBe(120);
	});

	it("cancel during an edit debounce clears automatic preparation intent", async () => {
		vi.useFakeTimers();
		const { result, rerender } = renderHook(
			({ backgroundColor }) =>
				useCanvasPlaybackPreview({ ...options, backgroundColor }),
			{ initialProps: { backgroundColor: "#123456" } }
		);
		act(() => result.current.prepare());
		await advancePreparation();
		rerender({ backgroundColor: "#111111" });
		expect(result.current.status).toBe("preparing");
		act(() => result.current.cancel());
		await advancePreparation({ milliseconds: 200 });
		expect(result.current.status).toBe("idle");
		expect(createCache).toHaveBeenCalledOnce();
		rerender({ backgroundColor: "#222222" });
		await advancePreparation({ milliseconds: 200 });
		expect(result.current.status).toBe("idle");
		expect(result.current.session).toBeUndefined();
		expect(createCache).toHaveBeenCalledOnce();
	});

	it("does not carry automatic preparation intent to another project", async () => {
		vi.useFakeTimers();
		const { result, rerender } = renderHook(
			({ projectId }) => useCanvasPlaybackPreview({ ...options, projectId }),
			{ initialProps: { projectId: "project-a" } }
		);
		act(() => result.current.prepare());
		await advancePreparation();
		rerender({ projectId: "project-b" });
		expect(result.current.status).toBe("idle");
		expect(result.current.session).toBeUndefined();
		await advancePreparation({ milliseconds: 200 });
		expect(createCache).toHaveBeenCalledOnce();
		rerender({ projectId: "project-a" });
		await advancePreparation({ milliseconds: 200 });
		expect(result.current.status).toBe("idle");
		expect(createCache).toHaveBeenCalledOnce();
	});

	it("rejects old results after an edit and waits for old decoder cleanup before automatic restart", async () => {
		vi.useFakeTimers();
		const first = resources();
		const next = resources();
		const pending = deferred<CanvasCompositionFrame>();
		const disposal = deferred<void>();
		first.renderer.render.mockReturnValueOnce(pending.promise);
		first.renderer.dispose.mockReturnValueOnce(disposal.promise);
		createCache
			.mockResolvedValueOnce(first.cache)
			.mockResolvedValue(next.cache);
		createRenderer
			.mockReturnValueOnce(first.renderer)
			.mockReturnValue(next.renderer);
		const { result, rerender } = renderHook(
			({ backgroundColor }) =>
				useCanvasPlaybackPreview({ ...options, backgroundColor }),
			{ initialProps: { backgroundColor: "#123456" } }
		);
		act(() => result.current.prepare());
		await advancePreparation();
		rerender({ backgroundColor: "#222222" });
		await advancePreparation({ milliseconds: 150 });
		expect(createCache).toHaveBeenCalledOnce();
		await act(async () => pending.resolve(capture({ frame: 0 })));
		expect(first.renderer.dispose).toHaveBeenCalledOnce();
		expect(first.cache.write).not.toHaveBeenCalled();
		expect(result.current.session).toBeUndefined();
		expect(next.renderer.render).not.toHaveBeenCalled();
		await act(async () => disposal.resolve());
		await advancePreparation();
		expect(result.current.status).toBe("ready");
		expect(result.current.session?.cache).toBe(next.cache);
		expect(next.renderer.render).toHaveBeenCalledTimes(2);
	});

	it("prioritizes a scrubbed target during initial preparation before the store time commits", async () => {
		const first = resources();
		const next = resources();
		const pending = deferred<CanvasCompositionFrame>();
		first.renderer.render.mockReturnValueOnce(pending.promise);
		createCache.mockResolvedValue(first.cache);
		createRenderer
			.mockReturnValueOnce(first.renderer)
			.mockReturnValue(next.renderer);
		const { result } = renderHook(() =>
			useCanvasPlaybackPreview({ ...options, totalDuration: 120 })
		);
		act(() => result.current.prepare());
		await waitFor(() => expect(first.renderer.render).toHaveBeenCalledTimes(2));
		seekWhilePreparing({ time: 20 });
		expect(stores.state.currentTime).toBe(0);
		expect(createRenderer.mock.calls[0][0].signal.aborted).toBe(true);
		expect(next.renderer.render).not.toHaveBeenCalled();
		await act(async () => pending.resolve(capture({ frame: 0 })));
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(next.renderer.render).toHaveBeenNthCalledWith(1, { frame: 600 });
		expect(result.current.window?.targetFrame).toBe(600);
		expect(first.cache.has({ frame: 0 })).toBe(false);
		expect(first.cache.has({ frame: 600 })).toBe(true);
		expect(first.renderer.dispose.mock.invocationCallOrder[0]).toBeLessThan(
			next.renderer.render.mock.invocationCallOrder[0]
		);
	});

	it("publishes the current segment while prefetch waits, suspends it for export and resumes without redoing ready frames", async () => {
		const first = resources();
		const prefetch = resources();
		const resumed = resources();
		const pending = deferred<CanvasCompositionFrame>();
		prefetch.renderer.render.mockReturnValueOnce(pending.promise);
		createCache.mockResolvedValue(first.cache);
		createRenderer
			.mockReturnValueOnce(first.renderer)
			.mockReturnValueOnce(prefetch.renderer)
			.mockReturnValue(resumed.renderer);
		const { result, rerender } = renderHook(
			({ suspended }) =>
				useCanvasPlaybackPreview({ ...options, totalDuration: 120, suspended }),
			{ initialProps: { suspended: false } }
		);
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		await waitFor(() =>
			expect(prefetch.renderer.render).toHaveBeenCalledTimes(2)
		);
		const session = result.current.session;
		expect(result.current.completed).toBe(60);
		expect(result.current.total).toBe(3600);
		expect(first.renderer.render).toHaveBeenCalledTimes(60);
		rerender({ suspended: true });
		expect(result.current.session).toBe(session);
		expect(createRenderer.mock.calls[1][0].signal.aborted).toBe(true);
		await act(async () => pending.resolve(capture({ frame: 60 })));
		await waitFor(() =>
			expect(prefetch.renderer.dispose).toHaveBeenCalledOnce()
		);
		expect(first.cache.dispose).not.toHaveBeenCalled();
		expect(resumed.renderer.render).not.toHaveBeenCalled();
		rerender({ suspended: false });
		await waitFor(() => expect(result.current.completed).toBe(180));
		expect(result.current.session).toBe(session);
		expect(
			resumed.renderer.render.mock.calls.map(([input]) => input.frame)
		).toEqual(Array.from({ length: 120 }, (_, offset) => 60 + offset));
		expect(createCache).toHaveBeenCalledOnce();
	});

	it("blocks play during the edit debounce and suspension cancels that pending intent", async () => {
		vi.useFakeTimers();
		const { result, rerender } = renderHook(
			({ backgroundColor, suspended }) =>
				useCanvasPlaybackPreview({ ...options, backgroundColor, suspended }),
			{ initialProps: { backgroundColor: "#123456", suspended: false } }
		);
		act(() => result.current.prepare());
		await advancePreparation();
		rerender({ backgroundColor: "#222222", suspended: false });
		await act(async () => {
			stores.state.isPlaying = true;
			window.dispatchEvent(new CustomEvent("playback-play"));
		});
		expect(stores.state.isPlaying).toBe(false);
		rerender({ backgroundColor: "#222222", suspended: true });
		expect(result.current.status).toBe("idle");
		rerender({ backgroundColor: "#222222", suspended: false });
		await advancePreparation({ milliseconds: 200 });
		expect(createCache).toHaveBeenCalledOnce();
		expect(result.current.status).toBe("idle");
	});

	it("removes a published session when background prefetch fails and releases its cache once", async () => {
		const first = resources();
		const prefetch = resources();
		const failure = deferred<void>();
		prefetch.renderer.render.mockImplementationOnce(async () => {
			await failure.promise;
			throw new Error("Background native render failed");
		});
		createCache.mockResolvedValue(first.cache);
		createRenderer
			.mockReturnValueOnce(first.renderer)
			.mockReturnValue(prefetch.renderer);
		const { result, unmount } = renderHook(() =>
			useCanvasPlaybackPreview({ ...options, totalDuration: 120 })
		);
		act(() => result.current.prepare());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		await act(async () => failure.resolve());
		await waitFor(() => expect(result.current.status).toBe("error"));
		expect(result.current.error).toBe("Background native render failed");
		expect(result.current.session).toBeUndefined();
		await waitFor(() => expect(first.cache.dispose).toHaveBeenCalledOnce());
		unmount();
		await act(async () => {});
		expect(first.cache.dispose).toHaveBeenCalledOnce();
		expect(prefetch.renderer.dispose).toHaveBeenCalledOnce();
	});

	it("remembers a scrubbed target while cache initialization is still pending", async () => {
		const { cache, renderer } = resources();
		const initialization = deferred<CanvasPlaybackCache>();
		createCache.mockReturnValueOnce(initialization.promise);
		createRenderer.mockReturnValue(renderer);
		const { result } = renderHook(() =>
			useCanvasPlaybackPreview({ ...options, totalDuration: 120 })
		);
		act(() => result.current.prepare());
		await waitFor(() => expect(createCache).toHaveBeenCalledOnce());
		seekWhilePreparing({ time: 20 });
		expect(stores.state.currentTime).toBe(0);
		await act(async () => initialization.resolve(cache));
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(renderer.render).toHaveBeenNthCalledWith(1, { frame: 600 });
		expect(result.current.window?.targetFrame).toBe(600);
		expect(cache.has({ frame: 0 })).toBe(false);
	});

	it("does not carry a pending scrub target into another project's manual preparation", async () => {
		const first = resources();
		const second = resources();
		const initialization = deferred<CanvasPlaybackCache>();
		createCache
			.mockReturnValueOnce(initialization.promise)
			.mockResolvedValue(second.cache);
		createRenderer.mockReturnValue(second.renderer);
		const { result, rerender } = renderHook(
			({ projectId }) =>
				useCanvasPlaybackPreview({ ...options, projectId, totalDuration: 120 }),
			{ initialProps: { projectId: "project-a" } }
		);
		act(() => result.current.prepare());
		await waitFor(() => expect(createCache).toHaveBeenCalledOnce());
		seekWhilePreparing({ time: 20 });
		rerender({ projectId: "project-b" });
		act(() => result.current.prepare());
		await act(async () => initialization.resolve(first.cache));
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(first.cache.dispose).toHaveBeenCalledOnce();
		expect(result.current.session?.cache).toBe(second.cache);
		expect(second.renderer.render).toHaveBeenNthCalledWith(1, { frame: 0 });
		expect(result.current.window?.targetFrame).toBe(0);
	});
});
