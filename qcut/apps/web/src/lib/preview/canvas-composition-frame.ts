import { hasMediaPortraitAdjustments } from "@qcut/editor-core";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import {
	DEFAULT_MEDIA_PERSPECTIVE,
	effectiveMediaKeyframes,
	hasMediaEnhancements,
	hasMediaVisualEdits,
	resolveMediaVisualProperties,
} from "@/lib/video/video-properties";
import {
	renderFrame,
	type RenderContext,
} from "@/lib/export/export-engine-renderer";
import {
	buildExportRenderIndex,
	type ExportRenderIndex,
} from "@/lib/export/export-render-index";
import { SequentialVideoRegistry } from "@/lib/export/export-sequential-video-source";
import { COMPOSITION_CANVAS_CONTEXT_SETTINGS } from "@/lib/export/composition-canvas-context";
import { canUseNativePortraitSourceWindow } from "@/lib/portrait/portrait-temporal-policy";
import { createPortraitSourcePreRollReader } from "@/lib/portrait/portrait-source-preroll";
import {
	hasIndependentBodyVideoContentSource,
	independentBodyVideoApplies,
} from "@/lib/portrait/independent-body-video";

export interface CanvasCompositionPreviewPlan {
	tracks: TimelineTrack[];
	mediaItems: MediaItem[];
	renderIndex: ExportRenderIndex;
	width: number;
	height: number;
	fps: number;
}

function hasUnsupportedCanvasVisuals({
	element,
}: {
	element: MediaElement;
}): boolean {
	const visual = resolveMediaVisualProperties(element);
	const hasPerspective = Object.entries(DEFAULT_MEDIA_PERSPECTIVE).some(
		([key, neutral]) =>
			visual.perspective[key as keyof typeof DEFAULT_MEDIA_PERSPECTIVE] !==
			neutral
	);
	const hasPerspectiveKeyframes = Object.entries(
		effectiveMediaKeyframes(element) ?? {}
	).some(
		([property, frames]) =>
			property in DEFAULT_MEDIA_PERSPECTIVE && Boolean(frames?.length)
	);
	return (
		hasPerspective ||
		hasPerspectiveKeyframes ||
		visual.chromaKey.enabled ||
		visual.customCutout.enabled ||
		visual.animationInType !== "none" ||
		visual.animationOutType !== "none" ||
		visual.comboAnimationType !== "none" ||
		hasMediaEnhancements({ enhancements: visual.enhancements }) ||
		(element.frameInterpolation !== undefined &&
			element.frameInterpolation !== "none")
	);
}

export function createCanvasCompositionPreviewPlan({
	tracks,
	mediaItems,
	width,
	height,
	fps,
}: Omit<
	CanvasCompositionPreviewPlan,
	"renderIndex"
>): CanvasCompositionPreviewPlan | null {
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width < 2 ||
		height < 2 ||
		width > 4096 ||
		height > 4096 ||
		width * height > 8_294_400 ||
		!Number.isFinite(fps) ||
		fps <= 0 ||
		fps > 240
	)
		return null;
	const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
	let hasVideo = false;
	let hasEdits = false;
	for (const track of tracks) {
		if (track.hidden || track.type === "audio") continue;
		if (
			track.transitions?.some(
				(transition) => transition.engine === "jianying-local"
			)
		)
			return null;
		for (const element of track.elements) {
			if (element.hidden) continue;
			if (element.type !== "media") return null;
			const media = mediaById.get(element.mediaId);
			if (media?.type === "audio") continue;
			if (media?.type !== "video" || !media.url) return null;
			if (hasUnsupportedCanvasVisuals({ element })) return null;
			const adjustments =
				resolveMediaVisualProperties(element).portraitAdjustments;
			if (
				independentBodyVideoApplies({
					adjustments,
					mediaType: media.type,
					fps,
				}) &&
				!hasIndependentBodyVideoContentSource({ mediaItem: media })
			)
				return null;
			if (
				adjustments?.engine !== "independent" &&
				hasMediaPortraitAdjustments({ adjustments }) &&
				(!canUseNativePortraitSourceWindow({ adjustments }) ||
					!createPortraitSourcePreRollReader({
						source:
							media.file instanceof Blob && media.file.size > 0
								? media.file
								: media.url,
					}))
			)
				return null;
			hasVideo = true;
			hasEdits ||=
				hasMediaVisualEdits(element) ||
				hasMediaPortraitAdjustments({
					adjustments: element.portraitAdjustments,
				});
		}
	}
	if (!hasVideo) return null;
	const snapshotTracks = structuredClone(tracks);
	const snapshotMedia = mediaItems.map((item) => ({ ...item }));
	const renderIndex = buildExportRenderIndex({
		tracks: snapshotTracks,
		mediaItems: snapshotMedia,
		fps,
		canvasWidth: width,
		canvasHeight: height,
	});
	const transitions = renderIndex.clipTransitions;
	if (transitions.jianyingTransitions.length || transitions.unsupported.length)
		return null;
	if (!hasEdits && transitions.canvasTransitions.length === 0) return null;
	return {
		tracks: snapshotTracks,
		mediaItems: snapshotMedia,
		renderIndex,
		width,
		height,
		fps,
	};
}

export interface CanvasCompositionFrame {
	blob: Blob;
	timings: { renderMs: number; encodeMs: number };
	frame: number;
	timeSeconds: number;
	width: number;
	height: number;
}

export interface CanvasCompositionRenderer {
	render: ({ frame }: { frame: number }) => Promise<CanvasCompositionFrame>;
	dispose: () => Promise<void>;
}

export function createCanvasCompositionRenderer({
	plan,
	backgroundColor,
	signal,
	maxInFlightFrames = 1,
}: {
	plan: CanvasCompositionPreviewPlan;
	backgroundColor?: string;
	signal: AbortSignal;
	maxInFlightFrames?: number;
}): CanvasCompositionRenderer {
	signal.throwIfAborted();
	if (![1, 2].includes(maxInFlightFrames))
		throw new Error("Invalid composition encoding capacity");
	const canvas = document.createElement("canvas");
	canvas.width = plan.width;
	canvas.height = plan.height;
	const ctx = canvas.getContext("2d", {
		...COMPOSITION_CANVAS_CONTEXT_SETTINGS,
		alpha: true,
		desynchronized: false,
	});
	if (!ctx) throw new Error("Unable to create composition preview canvas");
	const sequentialVideo = new SequentialVideoRegistry();
	const context: RenderContext = {
		canvas,
		ctx,
		tracks: plan.tracks,
		mediaItems: plan.mediaItems,
		videoCache: new Map(),
		imageCache: new Map(),
		usedImages: new Set(),
		fps: plan.fps,
		backgroundColor,
		signal,
		strictMediaErrors: true,
		isolatedCompositor: true,
		renderIndex: plan.renderIndex,
		sequentialVideo,
	};
	let tail = Promise.resolve();
	let disposed = false;
	let disposal: Promise<void> | undefined;
	let failure: Error | undefined;
	const encodings = new Set<Promise<void>>();
	function assertActive() {
		signal.throwIfAborted();
		if (disposed) throw new Error("Composition preview renderer disposed");
		if (failure) throw failure;
	}
	function render({
		frame,
	}: {
		frame: number;
	}): Promise<CanvasCompositionFrame> {
		if (!Number.isInteger(frame) || frame < 0)
			return Promise.reject(new Error("Invalid preview frame"));
		const snapshot = tail.then(async () => {
			assertActive();
			if (encodings.size >= maxInFlightFrames) {
				await Promise.race(encodings);
				assertActive();
			}
			const renderStarted = performance.now();
			await renderFrame(context, frame / plan.fps);
			const renderMs = performance.now() - renderStarted;
			assertActive();
			const encodeStarted = performance.now();
			// toBlob copies the bitmap synchronously, before its parallel PNG encoding.
			const encoded = new Promise<Blob>((resolve, reject) => {
				canvas.toBlob((result) => {
					if (result) resolve(result);
					else reject(new Error("Unable to encode composition preview"));
				}, "image/png");
			});
			const capture = encoded.then((blob) => {
				assertActive();
				return {
					blob,
					timings: { renderMs, encodeMs: performance.now() - encodeStarted },
					frame,
					timeSeconds: frame / plan.fps,
					width: plan.width,
					height: plan.height,
				};
			});
			const settled = capture.then(
				() => {},
				(error: unknown) => {
					failure ??= error instanceof Error ? error : new Error(String(error));
				}
			);
			encodings.add(settled);
			void settled.then(() => encodings.delete(settled));
			return { capture };
		});
		tail = snapshot.then(
			() => {},
			(error: unknown) => {
				failure ??= error instanceof Error ? error : new Error(String(error));
			}
		);
		return snapshot.then(({ capture }) => capture);
	}
	function dispose() {
		disposed = true;
		disposal ??= tail.then(async () => {
			await Promise.all(encodings);
			try {
				for (const video of context.videoCache.values()) {
					video.pause();
					video.removeAttribute("src");
					video.load();
				}
			} finally {
				context.videoCache.clear();
				context.imageCache?.clear();
				context.usedImages.clear();
				try {
					await sequentialVideo.disposeAll();
				} finally {
					canvas.width = 0;
					canvas.height = 0;
				}
			}
		});
		return disposal;
	}
	return { render, dispose };
}

export async function renderCanvasCompositionFrame({
	plan,
	frame,
	backgroundColor,
	signal,
}: {
	plan: CanvasCompositionPreviewPlan;
	frame: number;
	backgroundColor?: string;
	signal: AbortSignal;
}): Promise<CanvasCompositionFrame> {
	const renderer = createCanvasCompositionRenderer({
		plan,
		backgroundColor,
		signal,
	});
	try {
		return await renderer.render({ frame });
	} finally {
		await renderer.dispose();
	}
}
