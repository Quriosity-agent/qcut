import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeautyLabIndependentFrameRequest } from "@/types/electron";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { SequentialVideoRegistry } from "../export-sequential-video-source";
import { renderFrame, type RenderContext } from "../export-engine-renderer";
import { rethrowIndependentPortraitExportError } from "../export-independent-portrait";
import * as mediaProperties from "@/lib/video/video-properties";

const effects = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/stores/ai/effects-store", () => ({
	useEffectsStore: {
		getState: () => ({
			getElementEffects: () => [{ enabled: true, parameters: {} }],
		}),
	},
}));
vi.mock("@/config/features", () => ({
	get EFFECTS_ENABLED() {
		return effects.enabled;
	},
}));

class FrameData {
	colorSpace = "srgb";
	data: Uint8ClampedArray;
	width: number;
	height: number;
	constructor(data: Uint8ClampedArray, width: number, height: number) {
		this.data = data;
		this.width = width;
		this.height = height;
	}
}

function canvasContext({ canvas }: { canvas: HTMLCanvasElement }) {
	return {
		canvas,
		clearRect: vi.fn(),
		fillRect: vi.fn(),
		drawImage: vi.fn(),
		fillText: vi.fn(),
		putImageData: vi.fn(),
		getImageData: vi.fn(
			(_x: number, _y: number, width: number, height: number) =>
				new ImageData(
					new Uint8ClampedArray(width * height * 4).fill(255),
					width,
					height
				)
		),
		save: vi.fn(),
		restore: vi.fn(),
		translate: vi.fn(),
		rotate: vi.fn(),
		scale: vi.fn(),
		setTransform: vi.fn(),
		globalAlpha: 1,
		filter: "none",
		fillStyle: "",
	} as unknown as CanvasRenderingContext2D;
}

function canvasContextImplementation({
	readbackError,
}: {
	readbackError?: Error;
} = {}) {
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
		const current = canvasContext({ canvas: this });
		if (readbackError) {
			vi.mocked(current.getImageData).mockImplementation(() => {
				throw readbackError;
			});
		}
		return current;
	}
	return getContext;
}

function fixture({
	type,
	signal,
}: {
	type: "image" | "video";
	signal?: AbortSignal;
}) {
	const canvas = document.createElement("canvas");
	canvas.width = 2;
	canvas.height = 2;
	const ctx = canvasContext({ canvas });
	const mediaItem: MediaItem = {
		id: "portrait-source",
		type,
		name: "Portrait",
		url: `blob:portrait-${type}`,
		file: new File(["fixture"], `portrait.${type === "image" ? "png" : "mp4"}`),
	};
	const element: MediaElement = {
		id: "portrait-clip",
		type: "media",
		mediaId: mediaItem.id,
		name: "Portrait",
		startTime: 0,
		duration: 1,
		trimStart: 0,
		trimEnd: 0,
		portraitAdjustments: {
			enabled: true,
			engine: "independent",
			values: { face_adjust_Whiten: 45 },
		},
	};
	const tracks: TimelineTrack[] = [
		{ id: "track", name: "Video", type: "media", elements: [element] },
	];
	const image = {
		width: 2,
		height: 2,
		naturalWidth: 2,
		naturalHeight: 2,
		complete: true,
	} as HTMLImageElement;
	const context: RenderContext = {
		ctx,
		canvas,
		tracks,
		mediaItems: [mediaItem],
		fps: 30,
		signal,
		videoCache: new Map(),
		usedImages: new Set(),
		imageCache: new Map([[mediaItem.url as string, Promise.resolve(image)]]),
		sequentialVideo: {
			getOrOpen: vi.fn(async () => ({
				frameAt: async () => ({ canvas, timestamp: 0, duration: 1 / 30 }),
			})),
			disposeAll: vi.fn(async () => {}),
		} as unknown as SequentialVideoRegistry,
	};
	return { context, ctx };
}

let provider: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;

beforeEach(() => {
	effects.enabled = true;
	vi.stubGlobal("ImageData", FrameData);
	provider = vi.fn(async (request: BeautyLabIndependentFrameRequest) => ({
		requestId: request.requestId,
		width: request.width,
		height: request.height,
		rgba: new Uint8Array(request.rgba),
		cached: false,
	}));
	cancel = vi.fn(async () => ({ cancelled: true }));
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: {
			beautyLab: {
				renderIndependentFrame: provider,
				cancelIndependent: cancel,
			},
		},
	});
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
		canvasContextImplementation()
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(window, "electronAPI");
});

describe("independent portrait export failure", () => {
	it("propagates an animated independent failure with generic effects disabled", async () => {
		effects.enabled = false;
		const { context, ctx } = fixture({ type: "video" });
		const element = context.tracks[0].elements[0] as MediaElement;
		element.portraitAdjustments = {
			enabled: true,
			engine: "independent",
			values: { face_adjust_Whiten: 0 },
		};
		const resolveVisual = mediaProperties.resolveMediaKeyframes;
		vi.spyOn(mediaProperties, "resolveMediaKeyframes").mockImplementation(
			(arguments_) => ({
				...resolveVisual(arguments_),
				portraitAdjustments: {
					enabled: true,
					engine: "independent",
					values: { face_adjust_Whiten: 40 },
				},
			})
		);
		provider.mockRejectedValueOnce(new Error("animated frame failed"));
		await expect(renderFrame(context, 0)).rejects.toThrow(
			"animated frame failed"
		);
		expect(provider).toHaveBeenCalledOnce();
		expect(ctx.save).not.toHaveBeenCalled();
		expect(ctx.drawImage).not.toHaveBeenCalled();
	});

	it.each([
		"image",
		"video",
	] as const)("rejects %s processing once and can render after recovery", async (type) => {
		const { context, ctx } = fixture({ type });
		provider.mockRejectedValueOnce(
			new Error("unverified skin segmentation profile")
		);
		await expect(renderFrame(context, 0)).rejects.toThrow("自研美颜的磨皮");
		expect(provider).toHaveBeenCalledOnce();
		expect(ctx.drawImage).not.toHaveBeenCalled();
		expect(ctx.fillText).not.toHaveBeenCalled();
		expect(vi.mocked(ctx.save).mock.calls.length).toBe(
			vi.mocked(ctx.restore).mock.calls.length
		);
		await expect(renderFrame(context, 0)).resolves.toBeUndefined();
		expect(provider).toHaveBeenCalledTimes(2);
		expect(ctx.drawImage).toHaveBeenCalledOnce();
	});

	it("propagates cancellation without retrying or publishing a frame", async () => {
		const controller = new AbortController();
		const { context, ctx } = fixture({
			type: "video",
			signal: controller.signal,
		});
		provider.mockImplementationOnce(async () => {
			controller.abort(new Error("Export cancelled by user"));
			throw new Error("Independent worker killed");
		});
		await expect(renderFrame(context, 0)).rejects.toThrow(
			"Export cancelled by user"
		);
		expect(provider).toHaveBeenCalledOnce();
		expect(cancel).toHaveBeenCalledOnce();
		expect(ctx.drawImage).not.toHaveBeenCalled();
	});

	it("rejects source pixel readback failure instead of drawing the unprocessed original", async () => {
		const { context, ctx } = fixture({ type: "video" });
		vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(
			canvasContextImplementation({
				readbackError: new Error("readback failed"),
			})
		);
		await expect(renderFrame(context, 0)).rejects.toThrow("readback failed");
		expect(provider).not.toHaveBeenCalled();
		expect(ctx.drawImage).not.toHaveBeenCalled();
	});

	it("keeps a resolved independent failure fatal through outer static zero settings", () => {
		let failure: unknown;
		try {
			rethrowIndependentPortraitExportError({
				error: new Error("animated edit failed"),
				adjustments: {
					enabled: true,
					engine: "independent",
					values: { face_adjust_Whiten: 40 },
				},
			});
		} catch (error) {
			failure = error;
		}
		expect(() =>
			rethrowIndependentPortraitExportError({
				error: failure,
				adjustments: {
					enabled: true,
					engine: "independent",
					values: { face_adjust_Whiten: 0 },
				},
			})
		).toThrow("animated edit failed");
	});
});
