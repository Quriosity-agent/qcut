import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameRenderQueue } from "../export-render-queue";
import { loadExportVideo } from "../export-video-load";

function fixture() {
	const video = document.createElement("video");
	Object.defineProperties(video, {
		videoWidth: { configurable: true, value: 1920 },
		videoHeight: { configurable: true, value: 1080 },
	});
	const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
	const load = vi.spyOn(video, "load").mockImplementation(() => {});
	return { video, pause, load };
}

function mockVideoCreation({ videos }: { videos: HTMLVideoElement[] }) {
	const createElement = document.createElement.bind(document);
	return vi.spyOn(document, "createElement").mockImplementation(((
		tagName: string,
		options?: ElementCreationOptions
	) => {
		if (tagName !== "video") return createElement(tagName, options);
		const video = videos.shift();
		if (!video) throw new Error("Unexpected video creation");
		return video;
	}) as typeof document.createElement);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("loadExportVideo", () => {
	it("sets crossOrigin and listeners before starting a synchronously ready source", async () => {
		const { video, pause, load } = fixture();
		mockVideoCreation({ videos: [video] });
		const start = vi.spyOn(video, "src", "set").mockImplementation(() => {
			expect(video.crossOrigin).toBe("anonymous");
			video.dispatchEvent(new Event("loadeddata"));
		});
		const controller = new AbortController();
		await expect(
			loadExportVideo({ url: "blob:ready", signal: controller.signal })
		).resolves.toBe(video);
		controller.abort();
		video.dispatchEvent(new Event("error"));
		expect(start).toHaveBeenCalledWith("blob:ready");
		expect(pause).not.toHaveBeenCalled();
		expect(load).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("rejects a pre-cancelled request without creating media resources", async () => {
		const createVideo = vi.spyOn(document, "createElement");
		const controller = new AbortController();
		controller.abort(new Error("Cancelled"));
		await expect(
			loadExportVideo({ url: "blob:never-open", signal: controller.signal })
		).rejects.toBe(controller.signal.reason);
		expect(createVideo).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("times out a stalled load, releases it, and lets the next queued video load", async () => {
		const stalled = fixture();
		const ready = fixture();
		const createVideo = mockVideoCreation({
			videos: [stalled.video, ready.video],
		});
		const enqueue = createFrameRenderQueue();
		const first = enqueue({
			render: async () => {
				await loadExportVideo({ url: "blob:stalled" });
			},
		}).catch((error: unknown) => error);
		const next = enqueue({
			render: async () => {
				expect(stalled.video.getAttribute("src")).toBeNull();
				expect(stalled.pause).toHaveBeenCalledOnce();
				expect(stalled.load).toHaveBeenCalledOnce();
				const loaded = loadExportVideo({ url: "blob:ready" });
				ready.video.dispatchEvent(new Event("loadeddata"));
				await expect(loaded).resolves.toBe(ready.video);
			},
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(createVideo).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(15_000);
		expect(await first).toEqual(
			new Error("Video load timed out after 15000ms")
		);
		await next;
		expect(createVideo).toHaveBeenCalledTimes(2);
		expect(ready.pause).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		"error",
		"empty-frame",
	])("releases a %s load and ignores subsequent loadeddata events", async (failure) => {
		const { video, pause, load } = fixture();
		mockVideoCreation({ videos: [video] });
		if (failure === "empty-frame") {
			Object.defineProperty(video, "videoWidth", { value: 0 });
		}
		const result = loadExportVideo({ url: "blob:broken" }).catch(
			(error: unknown) => error
		);
		video.dispatchEvent(
			new Event(failure === "error" ? "error" : "loadeddata")
		);
		expect(await result).toEqual(
			new Error(
				failure === "error"
					? "Failed to load video"
					: "Video loaded without a decoded frame"
			)
		);
		video.dispatchEvent(new Event("loadeddata"));
		expect(video.getAttribute("src")).toBeNull();
		expect(pause).toHaveBeenCalledOnce();
		expect(load).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
});
