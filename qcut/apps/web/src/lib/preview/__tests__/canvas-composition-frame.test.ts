import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import {
	DEFAULT_MEDIA_PERSPECTIVE,
	DEFAULT_MEDIA_ENHANCEMENTS,
	DEFAULT_MEDIA_CHROMA_KEY,
} from "@/lib/video/video-properties";
import { DEFAULT_MEDIA_CUSTOM_CUTOUT } from "@/lib/video/media-custom-cutout";
import {
	renderFrame,
	type RenderContext,
} from "@/lib/export/export-engine-renderer";
import { buildExportRenderIndex } from "@/lib/export/export-render-index";
import type { ExportCompositorConfig } from "@/lib/screen-recording/export-compositor";
import { useScreenRecordingEnhancementStore } from "@/stores/screen-recording-store";
import {
	createCanvasCompositionPreviewPlan,
	renderCanvasCompositionFrame,
} from "../canvas-composition-frame";

const mocks = vi.hoisted(() => ({
	disposeAll: vi.fn(async () => {}),
	compositors: [] as Array<{
		config: ExportCompositorConfig;
		renderFrame: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
	}>,
	compositorFailure: false,
}));
vi.mock("@/lib/screen-recording/export-compositor", () => ({
	ScreenRecordingExportCompositor: class {
		declare config: ExportCompositorConfig;
		declare renderFrame: ReturnType<typeof vi.fn>;
		declare destroy: ReturnType<typeof vi.fn>;
		constructor(config: ExportCompositorConfig) {
			const compositor = {
				config,
				renderFrame: vi.fn(() => {
					if (mocks.compositorFailure) throw new Error("Compositor failed");
				}),
				destroy: vi.fn(),
			};
			Object.assign(this, compositor);
			mocks.compositors.push(this);
		}
	},
}));
vi.mock("@/lib/export/export-engine-renderer", () => ({
	renderFrame: vi.fn(async () => {}),
}));
vi.mock("@/lib/export/export-sequential-video-source", () => ({
	SequentialVideoRegistry: class {
		disposeAll = mocks.disposeAll;
	},
}));

function fixture() {
	const mediaItems: MediaItem[] = ["a", "b"].map((id) => ({
		id,
		type: "video",
		name: id,
		url: `blob:${id}`,
		file: new File(["video"], `${id}.mp4`, { type: "video/mp4" }),
	}));
	const tracks: TimelineTrack[] = [
		{
			id: "main",
			name: "Main",
			type: "media",
			elements: mediaItems.map((media, index) => ({
				id: media.id,
				type: "media",
				mediaId: media.id,
				name: media.name,
				startTime: index * 2,
				duration: 2,
				trimStart: 0,
				trimEnd: 0,
			})),
			transitions: [
				{
					id: "seam",
					fromElementId: "a",
					toElementId: "b",
					presetId: "soft-dissolve",
					type: "dissolve",
					engine: "qcut",
					duration: 1,
					easing: "linear",
				},
			],
		},
	];
	return { tracks, mediaItems, width: 1080, height: 1920, fps: 30 };
}

describe("canvas composition preview", () => {
	let actualRenderer:
		| typeof import("@/lib/export/export-engine-renderer")
		| undefined;
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
		mocks.compositors = [];
		mocks.compositorFailure = false;
		useScreenRecordingEnhancementStore.setState(
			useScreenRecordingEnhancementStore.getInitialState()
		);
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
		actualRenderer?.destroyExportCompositor();
		useScreenRecordingEnhancementStore.setState(
			useScreenRecordingEnhancementStore.getInitialState()
		);
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

	async function setupCompositorRenderer() {
		actualRenderer = await vi.importActual<
			typeof import("@/lib/export/export-engine-renderer")
		>("@/lib/export/export-engine-renderer");
		vi.mocked(renderFrame).mockImplementation(actualRenderer.renderFrame);
		Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
			configurable: true,
			value: vi.fn(() => ({
				clearRect: vi.fn(),
				fillRect: vi.fn(),
				drawImage: vi.fn(),
			})),
		});
		useScreenRecordingEnhancementStore.setState({
			speedRegions: [{ id: "speed", startMs: 0, endMs: 1000, speed: 2 }],
		});
		return actualRenderer;
	}

	function emptyPlan({ width, height }: { width: number; height: number }) {
		const input = { ...fixture(), width, height, tracks: [], mediaItems: [] };
		return {
			...input,
			renderIndex: buildExportRenderIndex({
				...input,
				canvasWidth: width,
				canvasHeight: height,
			}),
		};
	}

	it("uses fresh compositor settings and dimensions for each paused preview", async () => {
		await setupCompositorRenderer();
		await renderCanvasCompositionFrame({
			plan: emptyPlan({ width: 640, height: 360 }),
			frame: 1,
			signal: new AbortController().signal,
		});
		const speedRegions = [{ id: "changed", startMs: 0, endMs: 2000, speed: 3 }];
		useScreenRecordingEnhancementStore.setState({ speedRegions });
		await renderCanvasCompositionFrame({
			plan: emptyPlan({ width: 1080, height: 1920 }),
			frame: 2,
			signal: new AbortController().signal,
		});
		expect(mocks.compositors).toHaveLength(2);
		expect(mocks.compositors[0].config).toMatchObject({
			outputWidth: 640,
			outputHeight: 360,
			speedRegions: [{ id: "speed", speed: 2 }],
		});
		expect(mocks.compositors[1].config).toMatchObject({
			outputWidth: 1080,
			outputHeight: 1920,
			speedRegions,
		});
		for (const compositor of mocks.compositors)
			expect(compositor.destroy).toHaveBeenCalledOnce();
	});

	it("destroys an isolated compositor when its draw fails", async () => {
		await setupCompositorRenderer();
		mocks.compositorFailure = true;
		await expect(
			renderCanvasCompositionFrame({
				plan: emptyPlan({ width: 640, height: 360 }),
				frame: 1,
				signal: new AbortController().signal,
			})
		).rejects.toThrow("Compositor failed");
		expect(mocks.compositors[0].destroy).toHaveBeenCalledOnce();
	});

	it("keeps the export compositor alive across preview rendering and PNG encoding", async () => {
		const renderer = await setupCompositorRenderer();
		const canvas = document.createElement("canvas");
		canvas.width = 1280;
		canvas.height = 720;
		const context: RenderContext = {
			canvas,
			ctx: canvas.getContext("2d")!,
			tracks: [],
			mediaItems: [],
			videoCache: new Map(),
			usedImages: new Set(),
			fps: 30,
		};
		await renderer.renderFrame(context, 1);
		let encode: BlobCallback | undefined;
		Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
			configurable: true,
			value: (callback: BlobCallback) => {
				encode = callback;
			},
		});
		const preview = renderCanvasCompositionFrame({
			plan: emptyPlan({ width: 640, height: 360 }),
			frame: 1,
			signal: new AbortController().signal,
		});
		await vi.waitFor(() => expect(encode).toBeDefined());
		await renderer.renderFrame(context, 2);
		encode?.(new Blob(["preview"]));
		await preview;
		await renderer.renderFrame(context, 3);
		expect(mocks.compositors).toHaveLength(2);
		expect(mocks.compositors[0].renderFrame).toHaveBeenCalledTimes(3);
		expect(mocks.compositors[0].destroy).not.toHaveBeenCalled();
		expect(mocks.compositors[1].renderFrame).toHaveBeenCalledOnce();
		expect(mocks.compositors[1].destroy).toHaveBeenCalledOnce();
	});

	it("uses the export transition index, full resolution, sequential decoder and cancellation signal", async () => {
		const input = fixture();
		const plan = createCanvasCompositionPreviewPlan(input);
		if (!plan) throw new Error("Expected a supported dissolve");
		expect(plan.renderIndex.clipTransitions.canvasTransitions).toHaveLength(1);
		expect(plan.tracks).not.toBe(input.tracks);
		input.tracks[0].elements[0].startTime = 90;
		expect(plan.tracks[0].elements[0].startTime).toBe(0);
		const controller = new AbortController();
		const result = await renderCanvasCompositionFrame({
			plan,
			frame: 60,
			backgroundColor: "#102030",
			signal: controller.signal,
		});
		expect(result).toMatchObject({
			frame: 60,
			timeSeconds: 2,
			width: 1080,
			height: 1920,
		});
		expect(HTMLCanvasElement.prototype.getContext).toHaveBeenNthCalledWith(
			1,
			"2d",
			{
				willReadFrequently: false,
				alpha: true,
				desynchronized: false,
			}
		);
		expect(renderFrame).toHaveBeenCalledWith(
			expect.objectContaining({
				tracks: plan.tracks,
				renderIndex: plan.renderIndex,
				signal: controller.signal,
				fps: 30,
				backgroundColor: "#102030",
				sequentialVideo: expect.objectContaining({
					disposeAll: mocks.disposeAll,
				}),
			}),
			2
		);
		expect(mocks.disposeAll).toHaveBeenCalledOnce();
	});

	it.each([
		"native",
		"independent",
	] as const)("supports %s makeup-only compositions without a transition", (engine) => {
		const input = fixture();
		input.tracks[0].transitions = [];
		const element = input.tracks[0].elements[0];
		if (element.type !== "media") throw new Error("Expected media");
		element.portraitAdjustments = {
			enabled: true,
			engine,
			values: {},
			makeup: { lip: { cardId: "lip-coral-nude", intensity: 35 } },
		};
		expect(createCanvasCompositionPreviewPlan(input)).not.toBeNull();
	});

	it("requires owned source bytes for independent body history without rejecting makeup-only edits", () => {
		const input = fixture();
		const element = input.tracks[0].elements[0];
		if (element.type !== "media") throw new Error("Expected media");
		element.portraitAdjustments = {
			enabled: true,
			engine: "independent",
			values: { body_adjust_SlimBody: 40 },
		};
		expect(createCanvasCompositionPreviewPlan(input)).not.toBeNull();
		input.mediaItems[0].file = new File([], "placeholder.mp4");
		expect(createCanvasCompositionPreviewPlan(input)).toBeNull();
		element.portraitAdjustments.values = {};
		element.portraitAdjustments.makeup = {
			lip: { cardId: "lip-coral-nude", intensity: 35 },
		};
		expect(createCanvasCompositionPreviewPlan(input)).not.toBeNull();
	});

	it("keeps identity-bound native adjustments on their existing preview path", () => {
		const input = fixture();
		const element = input.tracks[0].elements[0];
		if (element.type !== "media") throw new Error("Expected media");
		element.portraitAdjustments = {
			enabled: true,
			engine: "native",
			values: { face_adjust_TotalFace: 25 },
			faceTarget: { mode: "single", faceId: 0 },
		};
		expect(createCanvasCompositionPreviewPlan(input)).toBeNull();
		element.portraitAdjustments.faceTarget = { mode: "all" };
		expect(createCanvasCompositionPreviewPlan(input)).not.toBeNull();
		input.mediaItems[0].file = new File([], "url-placeholder.mp4");
		input.mediaItems[0].url = "https://example.test/portrait.mp4";
		expect(createCanvasCompositionPreviewPlan(input)).toBeNull();
		input.mediaItems[0].url = "app://local-media/portrait.mp4";
		expect(createCanvasCompositionPreviewPlan(input)).not.toBeNull();
		element.portraitAdjustments.faces = [
			{ trackId: 3, values: { face_adjust_TotalFace: 10 } },
		];
		expect(createCanvasCompositionPreviewPlan(input)).toBeNull();
	});

	it("declines images and visible unsupported layers while ignoring audio", () => {
		const input = fixture();
		input.mediaItems.push({
			id: "sound",
			name: "Audio",
			type: "audio",
			file: new File([], "audio.wav"),
			url: "blob:audio",
		});
		input.tracks.push({
			id: "audio",
			name: "Audio",
			type: "audio",
			elements: [
				{
					id: "sound",
					type: "media",
					mediaId: "sound",
					name: "Sound",
					startTime: 0,
					duration: 4,
					trimStart: 0,
					trimEnd: 0,
				},
			],
		});
		expect(createCanvasCompositionPreviewPlan(input)).not.toBeNull();
		input.mediaItems[0].type = "image";
		expect(createCanvasCompositionPreviewPlan(input)).toBeNull();
	});

	it("declines native post-processing transitions and excessive canvas sizes", () => {
		const input = fixture();
		const transition = input.tracks[0].transitions?.[0];
		if (!transition) throw new Error("Expected transition");
		transition.engine = "jianying-local";
		expect(createCanvasCompositionPreviewPlan(input)).toBeNull();
		expect(
			createCanvasCompositionPreviewPlan({
				...fixture(),
				width: 4096,
				height: 4096,
			})
		).toBeNull();
	});

	it.each([
		{
			name: "static perspective",
			overrides: {
				perspective: { ...DEFAULT_MEDIA_PERSPECTIVE, topLeftX: 0.1 },
			},
		},
		{
			name: "future perspective keyframes",
			overrides: {
				keyframes: {
					topLeftX: [{ id: "corner", frame: 30, value: 0.1, easing: "linear" }],
				},
			},
		},
		{
			name: "chroma key",
			overrides: { chromaKey: { ...DEFAULT_MEDIA_CHROMA_KEY, enabled: true } },
		},
		{
			name: "custom cutout",
			overrides: {
				customCutout: {
					...DEFAULT_MEDIA_CUSTOM_CUTOUT,
					enabled: true,
					strokes: [
						{
							id: "stroke",
							frame: 0,
							mode: "background",
							size: 0.1,
							points: [{ x: 0.5, y: 0.5 }],
						},
					],
				},
			},
		},
		{ name: "entrance animation", overrides: { animationInType: "fade" } },
		{ name: "exit animation", overrides: { animationOutType: "slide-left" } },
		{ name: "combo animation", overrides: { comboAnimationType: "pulse" } },
		{
			name: "enhancement",
			overrides: {
				enhancements: { ...DEFAULT_MEDIA_ENHANCEMENTS, denoise: 20 },
			},
		},
		{
			name: "frame interpolation",
			overrides: { frameInterpolation: "motion-compensated" },
		},
	] satisfies Array<{
		name: string;
		overrides: Partial<MediaElement>;
	}>)("preserves the live preview for unsupported $name", ({ overrides }) => {
		const input = fixture();
		const element = input.tracks[0].elements[1];
		if (element.type !== "media") throw new Error("Expected video");
		Object.assign(element, overrides);
		expect(createCanvasCompositionPreviewPlan(input)).toBeNull();
	});

	it("retains crop and transform keyframes with disabled or neutral unsupported controls", () => {
		const input = fixture();
		input.tracks[0].transitions = [];
		const element = input.tracks[0].elements[0];
		if (element.type !== "media") throw new Error("Expected video");
		Object.assign(element, {
			crop: { top: 0.02, right: 0.03, bottom: 0, left: 0.04 },
			perspectiveEnabled: false,
			perspective: { ...DEFAULT_MEDIA_PERSPECTIVE, topLeftX: 0.1 },
			keyframes: {
				topLeftX: [{ id: "corner", frame: 30, value: 0.2, easing: "linear" }],
				scaleX: [{ id: "scale", frame: 30, value: 1.035, easing: "linear" }],
				cropLeft: [{ id: "crop", frame: 30, value: 0.04, easing: "linear" }],
			},
			chromaKey: DEFAULT_MEDIA_CHROMA_KEY,
			customCutout: DEFAULT_MEDIA_CUSTOM_CUTOUT,
			enhancements: DEFAULT_MEDIA_ENHANCEMENTS,
			animationInType: "none",
			animationOutType: "none",
			comboAnimationType: "none",
			frameInterpolation: "none",
		} satisfies Partial<MediaElement>);
		expect(createCanvasCompositionPreviewPlan(input)).not.toBeNull();
	});

	it("releases fallback videos and decoder resources after a renderer failure", async () => {
		const plan = createCanvasCompositionPreviewPlan(fixture());
		if (!plan) throw new Error("Expected plan");
		const video = document.createElement("video");
		const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
		const load = vi.spyOn(video, "load").mockImplementation(() => {});
		video.src = "blob:video";
		vi.mocked(renderFrame).mockImplementationOnce(async (context) => {
			context.videoCache.set("source", video);
			throw new Error("Portrait worker failed");
		});
		await expect(
			renderCanvasCompositionFrame({
				plan,
				frame: 0,
				signal: new AbortController().signal,
			})
		).rejects.toThrow("Portrait worker failed");
		expect(pause).toHaveBeenCalledOnce();
		expect(load).toHaveBeenCalledOnce();
		expect(video.hasAttribute("src")).toBe(false);
		expect(mocks.disposeAll).toHaveBeenCalledOnce();
	});

	it("does not publish a PNG if cancellation arrives during encoding", async () => {
		const plan = createCanvasCompositionPreviewPlan(fixture());
		if (!plan) throw new Error("Expected plan");
		const controller = new AbortController();
		Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
			configurable: true,
			value: (callback: BlobCallback) => {
				controller.abort();
				callback(new Blob(["png"]));
			},
		});
		await expect(
			renderCanvasCompositionFrame({
				plan,
				frame: 0,
				signal: controller.signal,
			})
		).rejects.toMatchObject({ name: "AbortError" });
		expect(mocks.disposeAll).toHaveBeenCalledOnce();
	});
});
