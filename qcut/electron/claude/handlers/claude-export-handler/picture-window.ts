/**
 * The picture of a range export, drawn for the clips around the range only.
 *
 * A range export is the full export cut to the range, and it used to make
 * the whole film's picture to get there: every overlay, grade and text pass
 * ran over all of it, and a two-second range of a five-minute film took most
 * of the time the film takes. The frames outside the range are thrown away
 * at the end, so the passes now run on a window: the clips and gaps of the
 * joined picture that the range touches. The window starts and ends where a
 * file of the joined picture does, so it is cut by copying, not by encoding
 * again. Each layer keeps its place: its times move back by where the window
 * starts on the timeline, a whole number of frames.
 *
 * The sound is untouched: it is mixed over the whole programme and cut from
 * that, as before, so a limiter or a tail reaching into the range hears what
 * plays before it.
 *
 * A layer that starts before the window has to come out the same as in the
 * full export. Where that is not certain, the window is made to start
 * earlier instead, at that layer's start:
 * - a media overlay is cut at the window's start, its source read from the
 *   matching instant, unless it moves or changes over its length (keyframes,
 *   frame interpolation): then the window starts at the overlay;
 * - an adjustment layer is only moved in time; `between(t, start, end)`
 *   takes a start below zero. One whose grade is keyframed is read against
 *   the picture's clock, so the range is then drawn the old way, full length;
 * - a sticker, a text and a Jianying text start the window: a looping
 *   sticker or an animated text would otherwise begin again at the cut.
 *
 * @module electron/claude/handlers/claude-export-handler/picture-window
 */

import type { ConcatSpan } from "./concat-timing.js";
import type { PictureLayers, TimelineRange } from "./export-range.js";
import type { ConcatEntry } from "./gap-segments.js";
import { outputFrameAt } from "./media-overlay-source.js";
import type { ExportSegment } from "./types.js";

export interface PictureWindow {
	/** Positions in the joined picture's files of the first and last one held. */
	first: number;
	last: number;
	/** The timeline frame the window's first frame is. */
	firstFrame: number;
	/** Where the window starts on the timeline: `firstFrame / fps` seconds. */
	start: number;
	/** The window's length in frames, and in seconds. */
	frames: number;
	duration: number;
}

function hasEntries({ record }: { record: unknown }): boolean {
	if (!record || typeof record !== "object") return false;
	return Object.values(record as Record<string, unknown>).some(
		(value) => Array.isArray(value) && value.length > 0
	);
}

/**
 * Whether an overlay looks the same at an instant whenever it is started
 * from: a still or a plain video, placed and graded once for its length.
 */
export function overlayCanBeCut({
	overlay,
}: {
	overlay: ExportSegment;
}): boolean {
	return !(
		hasEntries({ record: overlay.keyframes }) ||
		(overlay.transform?.xKeyframes?.length ?? 0) > 0 ||
		(overlay.transform?.yKeyframes?.length ?? 0) > 0 ||
		hasEntries({ record: overlay.color?.keyframes }) ||
		overlay.frameInterpolation !== undefined
	);
}

/**
 * The window of the joined picture a range export draws, or undefined when
 * the range is to be drawn the old way: nothing would be saved (the window
 * is the whole picture), or a layer could not be moved in time safely.
 *
 * `layers` are the layers that show in the range. `entries` and `spans` are
 * the joined picture's files in order with their spans on the timeline.
 */
export function planPictureWindow({
	range,
	entries,
	spans,
	layers,
	fps,
}: {
	range: TimelineRange;
	entries: ConcatEntry[];
	spans: ConcatSpan[];
	layers: PictureLayers;
	fps: number;
}): PictureWindow | undefined {
	if (
		layers.adjustmentLayers.some((layer) =>
			hasEntries({ record: layer.color?.keyframes })
		)
	) {
		return;
	}
	// The earliest instant a layer needs the picture from.
	let from = range.start;
	for (const overlay of layers.mediaOverlays) {
		if (!overlayCanBeCut({ overlay })) from = Math.min(from, overlay.startTime);
	}
	for (const layer of [
		...layers.stickerOverlays,
		...layers.textOverlays,
		...layers.jianyingTextOverlays,
	]) {
		from = Math.min(from, layer.startTime);
	}

	let first = -1;
	let last = -1;
	for (const [position, span] of spans.entries()) {
		if (span.frames <= 0) continue;
		if (span.to <= from || span.from >= range.end) continue;
		if (first < 0) first = position;
		last = position;
	}
	if (first < 0) return;
	const drawn = spans.filter((span) => span.frames > 0).length;
	const held = spans
		.slice(first, last + 1)
		.filter((span) => span.frames > 0).length;
	if (held === drawn || entries.length !== spans.length) return;

	const firstFrame = outputFrameAt({ time: spans[first].from, fps });
	const frames = spans
		.slice(first, last + 1)
		.reduce((sum, span) => sum + span.frames, 0);
	return {
		first,
		last,
		firstFrame,
		start: firstFrame / fps,
		frames,
		duration: frames / fps,
	};
}

/** The segments whose picture the window holds (positions in `segments`). */
export function segmentsInPictureWindow({
	window,
	entries,
}: {
	window: PictureWindow;
	entries: ConcatEntry[];
}): Set<number> {
	const shown = new Set<number>();
	for (let position = window.first; position <= window.last; position += 1) {
		const entry = entries[position];
		if (entry.kind === "segment") shown.add(entry.index);
	}
	return shown;
}

function moved<T extends { startTime: number; endTime: number }>({
	item,
	by,
}: {
	item: T;
	by: number;
}): T {
	return {
		...item,
		startTime: item.startTime - by,
		endTime: item.endTime - by,
	};
}

/**
 * `layers` as the window's picture has them: every time moved back by where
 * the window starts, and a media overlay that began before it cut there,
 * its source read from the instant that shows at the window's first frame.
 */
export function layersInPictureWindow({
	layers,
	window,
}: {
	layers: PictureLayers;
	window: PictureWindow;
}): PictureLayers {
	return {
		mediaOverlays: layers.mediaOverlays.map((overlay) => {
			const before = window.start - overlay.startTime;
			if (before <= 0) {
				return { ...overlay, startTime: overlay.startTime - window.start };
			}
			const rate = overlay.isImage ? 1 : (overlay.playbackRate ?? 1);
			return {
				...overlay,
				startTime: 0,
				duration: overlay.duration - before,
				trimStart: overlay.isImage
					? overlay.trimStart
					: overlay.trimStart + before * rate,
			};
		}),
		stickerOverlays: layers.stickerOverlays.map((sticker) =>
			moved({ item: sticker, by: window.start })
		),
		textOverlays: layers.textOverlays.map((text) =>
			moved({ item: text, by: window.start })
		),
		jianyingTextOverlays: layers.jianyingTextOverlays.map((text) =>
			moved({ item: text, by: window.start })
		),
		adjustmentLayers: layers.adjustmentLayers.map((layer) =>
			moved({ item: layer, by: window.start })
		),
	};
}

/** The range as the window's picture counts it, from the window's start. */
export function rangeInPictureWindow({
	range,
	window,
}: {
	range: TimelineRange;
	window: PictureWindow;
}): TimelineRange {
	return { start: range.start - window.start, end: range.end - window.start };
}

/** Joins the window's files into its picture, copied, with no sound. */
export function buildPictureWindowConcatArgs({
	videoListPath,
	outputPath,
}: {
	videoListPath: string;
	outputPath: string;
}): string[] {
	return [
		"-y",
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		videoListPath,
		"-map",
		"0:v:0",
		"-c:v",
		"copy",
		"-an",
		"-movflags",
		"+faststart",
		outputPath,
	];
}
