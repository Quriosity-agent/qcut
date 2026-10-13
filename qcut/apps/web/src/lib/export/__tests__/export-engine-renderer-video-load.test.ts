import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { MediaElement } from "@/types/timeline";
import { renderVideo, type RenderContext } from "../export-engine-renderer";
import { createFrameRenderQueue } from "../export-render-queue";
import {
	createCanvasCompositionPreviewPlan,
	renderCanvasCompositionFrame,
} from "@/lib/preview/canvas-composition-frame";

const sequential = vi.hoisted(() => ({
	getOrOpen: vi.fn(),
	disposeAll: vi.fn(async () => {}),
}));

vi.mock("../export-sequential-video-source", () => ({
	SequentialVideoRegistry: class {
		getOrOpen = sequential.getOrOpen;
		disposeAll = sequential.disposeAll;
	},
}));

afterEach(() => vi.restoreAllMocks());

describe("export video loading cancellation", () => {
	it("rejects exact preview after source load failure without encoding a ready PNG, then recovers", async () => {
		vi.useFakeTimers();
		sequential.getOrOpen.mockReset().mockResolvedValue(null);
		sequential.disposeAll.mockClear();
		const drawImage = vi.fn();
		function getContext(
			this: HTMLCanvasElement,
			contextId: "2d"
		): CanvasRenderingContext2D | null;
		function getContext(
			this: HTMLCanvasElement,
			contextId: "webgpu"
		): GPUCanvasContext | null;
		function getContext(
			this: HTMLCanvasElement,
			contextId: string
		): CanvasRenderingContext2D | GPUCanvasContext | null {
			if (contextId !== "2d") return null;
			return {
				canvas: this,
				clearRect: vi.fn(),
				fillRect: vi.fn(),
				drawImage,
				fillText: vi.fn(),
				save: vi.fn(),
				restore: vi.fn(),
				translate: vi.fn(),
				rotate: vi.fn(),
				scale: vi.fn(),
				setTransform: vi.fn(),
				beginPath: vi.fn(),
				rect: vi.fn(),
				clip: vi.fn(),
				globalAlpha: 1,
				filter: "none",
			} as unknown as CanvasRenderingContext2D;
		}
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
			getContext
		);
		const toBlob = vi
			.spyOn(HTMLCanvasElement.prototype, "toBlob")
			.mockImplementation((callback) => callback(new Blob(["preview"])));
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
		vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
		vi.spyOn(HTMLMediaElement.prototype, "src", "set").mockImplementation(
			function (this: HTMLMediaElement) {
				this.dispatchEvent(new Event("error"));
			}
		);
		const plan = createCanvasCompositionPreviewPlan({
			width: 2,
			height: 2,
			fps: 30,
			mediaItems: [
				{
					id: "video",
					name: "Source",
					type: "video",
					file: new File(["fixture"], "video.mp4"),
					url: "blob:unreadable",
				},
			],
			tracks: [
				{
					id: "track",
					name: "Video",
					type: "media",
					elements: [
						{
							id: "clip",
							type: "media",
							mediaId: "video",
							name: "Clip",
							startTime: 0,
							duration: 1,
							trimStart: 0,
							trimEnd: 0,
							crop: { left: 0.1, top: 0, right: 0, bottom: 0 },
						},
					],
				},
			],
		});
		if (!plan) throw new Error("Expected eligible preview");
		try {
			const failed = renderCanvasCompositionFrame({
				plan,
				frame: 0,
				signal: new AbortController().signal,
			}).catch((error: unknown) => error);
			await vi.advanceTimersByTimeAsync(1_000);
			expect(await failed).toEqual(new Error("Failed to load video"));
			expect(toBlob).not.toHaveBeenCalled();
			expect(drawImage).not.toHaveBeenCalled();
			expect(sequential.getOrOpen).toHaveBeenCalledTimes(3);
			expect(sequential.disposeAll).toHaveBeenCalledOnce();

			const source = document.createElement("canvas");
			source.width = 2;
			source.height = 2;
			sequential.getOrOpen.mockResolvedValue({
				frameAt: async () => ({
					canvas: source,
					timestamp: 0,
					duration: 1 / 30,
				}),
			});
			await expect(
				renderCanvasCompositionFrame({
					plan,
					frame: 0,
					signal: new AbortController().signal,
				})
			).resolves.toMatchObject({ frame: 0, width: 2, height: 2 });
			expect(toBlob).toHaveBeenCalledOnce();
			expect(drawImage).toHaveBeenCalledOnce();
			expect(sequential.disposeAll).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("stops a stalled HTML load before releasing the queue to the next render", async () => {
		const enqueue = createFrameRenderQueue();
		const controller = new AbortController();
		const cancelled = new Error("Paused preview superseded");
		const video = document.createElement("video");
		const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
		const load = vi.spyOn(video, "load").mockImplementation(() => {});
		const createElement = document.createElement.bind(document);
		const createVideo = vi
			.spyOn(document, "createElement")
			.mockImplementation(((
				tagName: string,
				options?: ElementCreationOptions
			) =>
				tagName === "video"
					? video
					: createElement(tagName, options)) as typeof document.createElement);
		const context = {
			canvas: { width: 1920, height: 1080 },
			videoCache: new Map<string, HTMLVideoElement>(),
			fps: 30,
			signal: controller.signal,
		} as RenderContext;
		const element: MediaElement = {
			id: "clip",
			type: "media",
			mediaId: "video",
			name: "Video",
			startTime: 0,
			duration: 1,
			trimStart: 0,
			trimEnd: 0,
		};
		const item = { id: "video", url: "blob:stalled-video" } as MediaItem;
		const first = enqueue({
			signal: controller.signal,
			render: () => renderVideo(context, element, item, 0),
		}).catch((error: unknown) => error);
		const nextRender = vi.fn(async () => {
			expect(video.getAttribute("src")).toBeNull();
			expect(pause).toHaveBeenCalledOnce();
			expect(load).toHaveBeenCalledOnce();
		});
		const next = enqueue({ render: nextRender });
		try {
			await vi.waitFor(() => expect(createVideo).toHaveBeenCalledWith("video"));
			controller.abort(cancelled);
			await vi.waitFor(() => expect(nextRender).toHaveBeenCalledOnce(), {
				timeout: 1000,
			});
			expect(await first).toBe(cancelled);
			await next;
			expect(context.videoCache.size).toBe(0);
			expect(createVideo).toHaveBeenCalledOnce();
		} finally {
			controller.abort(cancelled);
			video.dispatchEvent(new Event("error"));
			await Promise.allSettled([first, next]);
		}
	});
});
