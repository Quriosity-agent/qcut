/**
 * A media clip drawn as an overlay in the native export: its blend and
 * keyframe fields, its FFmpeg input, and the layer description the
 * compositor draws it from.
 *
 * The layer reuses the editor's FFmpeg layer chain (`buildVideoTimelineLayers`),
 * which fits, transforms and fades each clip on a transparent canvas, so an
 * overlay keeps its own alpha and the clip's opacity scales that alpha.
 *
 * @module electron/claude/handlers/claude-export-handler/media-overlay-source
 */

import type { VideoAlphaInfo } from "../../../ffmpeg/video-alpha.js";
import { alphaDecoderInputArgs } from "../../../ffmpeg/video-alpha.js";
import type { VideoSource, VideoVisual } from "../../../ffmpeg/types.js";
import type { VisualLayerBlendMode } from "../../../ffmpeg/visual-layer-compositor.js";
import { DEFAULT_VISUAL } from "../../../ffmpeg-video-transform.js";
import type { ClaudeElement } from "../../../types/claude-api.js";
import type { ExportSegment } from "./types.js";

const BLEND_MODES = new Set<VisualLayerBlendMode>([
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
]);

/**
 * The element's blend mode and keyframes as the preview applies them: with
 * `blendEnabled` off, the clip draws normally and its opacity keyframes are
 * set aside (its static opacity is dropped in `readElementTransform`).
 */
export function readSegmentBlendFields({
	element,
}: {
	element: Pick<ClaudeElement, "blendMode" | "blendEnabled" | "keyframes">;
}): Pick<ExportSegment, "blendMode" | "keyframes"> {
	const blendOff = element.blendEnabled === false;
	const blendMode =
		!blendOff &&
		element.blendMode !== undefined &&
		BLEND_MODES.has(element.blendMode)
			? element.blendMode
			: undefined;
	const raw = element.keyframes;
	let keyframes: VideoVisual["keyframes"];
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const entries = Object.entries(raw).filter(
			([property, frames]) =>
				Array.isArray(frames) &&
				frames.length > 0 &&
				!(blendOff && property === "opacity")
		);
		if (entries.length > 0)
			keyframes = Object.fromEntries(entries) as VideoVisual["keyframes"];
	}
	return {
		...(blendMode && blendMode !== "normal" ? { blendMode } : {}),
		...(keyframes ? { keyframes } : {}),
	};
}

/**
 * FFmpeg input options for an overlay: a still loops for the clip's length;
 * a video is cut to the clip's source span (seek, then read length × rate)
 * and decoded with its alpha.
 */
export function mediaOverlayInputArgs({
	segment,
	alpha,
}: {
	segment: ExportSegment;
	alpha: VideoAlphaInfo | null;
}): string[] {
	if (segment.isImage) {
		return [
			"-loop",
			"1",
			"-t",
			String(segment.duration),
			"-i",
			segment.sourcePath,
		];
	}
	const rate = segment.playbackRate ?? 1;
	return [
		...alphaDecoderInputArgs({ alpha }),
		...(segment.trimStart > 0 ? ["-ss", String(segment.trimStart)] : []),
		"-t",
		String(segment.duration * rate),
		"-i",
		segment.sourcePath,
	];
}

/**
 * A clip edge less than this after a frame's start counts as on that frame,
 * the rule the preview and the renderer export use (ELEMENT_EDGE_NOISE_SECONDS
 * in export-engine-utils.ts).
 */
const EDGE_NOISE_SECONDS = 0.001;

/**
 * The output frames a clip shows: frame n is on screen while
 * start <= n/fps + 1 ms < start + duration.
 */
export function overlayFrameWindow({
	startTime,
	duration,
	fps,
}: {
	startTime: number;
	duration: number;
	fps: number;
}): { firstFrame: number; frameCount: number } {
	const firstFrame = Math.max(
		0,
		Math.ceil((startTime - EDGE_NOISE_SECONDS) * fps - 1e-9)
	);
	const endFrame = Math.ceil(
		(startTime + duration - EDGE_NOISE_SECONDS) * fps - 1e-9
	);
	return { firstFrame, frameCount: Math.max(0, endFrame - firstFrame) };
}

/**
 * The layer the editor's chain draws for an overlay. The input is already cut
 * to the clip (see `mediaOverlayInputArgs`), so the source starts at 0 and
 * runs for the clip's source span. The layer starts on the clip's first
 * output frame; `fps` is the project rate the element's keyframe frames count
 * in.
 */
export function mediaOverlayVideoSource({
	segment,
	fps,
}: {
	segment: ExportSegment;
	fps: number;
}): VideoSource {
	const rate = segment.isImage ? 1 : (segment.playbackRate ?? 1);
	const transform = segment.transform;
	const { firstFrame } = overlayFrameWindow({
		startTime: segment.startTime,
		duration: segment.duration,
		fps,
	});
	return {
		elementId: segment.elementId,
		trackId: segment.trackId,
		trackOrder: segment.trackOrder,
		elementOrder: segment.elementOrder,
		path: segment.sourcePath,
		startTime: firstFrame / fps,
		duration: segment.duration * rate,
		trimStart: 0,
		trimEnd: 0,
		playbackRate: rate,
		...(segment.frameInterpolation === "blend" ||
		segment.frameInterpolation === "motion-compensated"
			? { frameInterpolation: segment.frameInterpolation }
			: {}),
		visual: {
			...DEFAULT_VISUAL,
			x: transform?.x ?? 0,
			y: transform?.y ?? 0,
			rotation: transform?.rotationDegrees ?? 0,
			scaleX: transform?.scaleX ?? 1,
			scaleY: transform?.scaleY ?? 1,
			opacity: transform?.opacity ?? 1,
			blendMode: segment.blendMode ?? "normal",
			fitMode: segment.fitMode,
			...(segment.color ? { color: segment.color } : {}),
			...(segment.enhancements ? { enhancements: segment.enhancements } : {}),
			keyframes: segment.keyframes,
			keyframeFps: fps,
		},
	};
}
