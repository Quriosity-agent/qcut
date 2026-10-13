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
	frame: number;
	timeSeconds: number;
	width: number;
	height: number;
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
	signal.throwIfAborted();
	if (!Number.isInteger(frame) || frame < 0)
		throw new Error("Invalid preview frame");
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
	try {
		await renderFrame(context, frame / plan.fps);
		signal.throwIfAborted();
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((result) => {
				if (result) resolve(result);
				else reject(new Error("Unable to encode composition preview"));
			}, "image/png");
		});
		signal.throwIfAborted();
		return {
			blob,
			frame,
			timeSeconds: frame / plan.fps,
			width: plan.width,
			height: plan.height,
		};
	} finally {
		for (const video of context.videoCache.values()) {
			video.pause();
			video.removeAttribute("src");
			video.load();
		}
		context.videoCache.clear();
		await sequentialVideo.disposeAll();
		canvas.width = 0;
		canvas.height = 0;
	}
}
