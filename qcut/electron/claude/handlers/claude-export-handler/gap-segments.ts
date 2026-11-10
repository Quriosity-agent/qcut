/**
 * Timeline gaps in a native export.
 *
 * The concat step only knows the clips, so a gap between two of them (or
 * before the first) would be squeezed out: the output ran shorter than the
 * timeline and everything placed by timeline time — text, stickers,
 * adjustment layers, separate audio tracks — landed on the wrong frames. The
 * preview and the renderer engine show black there, so each gap becomes a
 * black, silent clip encoded like the segments and concatenated in place.
 * Transition exports place their segments in time themselves and need none.
 *
 * @module electron/claude/handlers/claude-export-handler/gap-segments
 */

import {
	type ConcatSpan,
	concatSpan,
	spanFileCounts,
} from "./concat-timing.js";
import {
	blackPictureInputArgs,
	segmentAudioFormat,
	segmentPcmAudioArgs,
	silenceInputArgs,
} from "./export-segment-encode.js";
import type { ExportSegment, ResolvedExportSettings } from "./types.js";
import { parseBitrateForKbps } from "./utils.js";

export interface TimelineGap {
	/**
	 * Position (in start order) of the segment the gap precedes; the segment
	 * count for a gap after the last segment.
	 */
	beforeSegment: number;
	startTime: number;
	duration: number;
}

/**
 * Gaps longer than half a frame between `segments` (sorted by start time),
 * measured against the furthest end so far: overlapping lanes leave none.
 * With `timelineEnd`, the picture also runs on in black after the last
 * segment up to it (an overlay that outlasts the clips under it).
 */
export function findTimelineGaps({
	segments,
	fps,
	timelineEnd,
}: {
	segments: ExportSegment[];
	fps: number;
	timelineEnd?: number;
}): TimelineGap[] {
	const minimum = 0.5 / Math.max(1, fps);
	const gaps: TimelineGap[] = [];
	let cursor = 0;
	for (const [index, segment] of segments.entries()) {
		const duration = segment.startTime - cursor;
		if (duration > minimum) {
			gaps.push({ beforeSegment: index, startTime: cursor, duration });
		}
		cursor = Math.max(cursor, segment.startTime + segment.duration);
	}
	if (timelineEnd !== undefined && timelineEnd - cursor > minimum) {
		gaps.push({
			beforeSegment: segments.length,
			startTime: cursor,
			duration: timelineEnd - cursor,
		});
	}
	return gaps;
}

/**
 * The FFmpeg command for one gap: black picture and silence, with the
 * segments' codec, size, rate, pixel format and PCM sound so the concat
 * joins it like any segment, cut to its span like a segment (see
 * export-segment-encode.ts). Written as an intermediate MOV.
 */
export function buildGapSegmentEncodeArgs({
	gap,
	settings,
	outputPath,
	span,
}: {
	gap: TimelineGap;
	settings: Pick<
		ResolvedExportSettings,
		| "width"
		| "height"
		| "fps"
		| "codec"
		| "bitrate"
		| "audioSampleRate"
		| "audioChannels"
	>;
	outputPath: string;
	/** The stretch of the timeline the file fills; the gap's own by default. */
	span?: Pick<ConcatSpan, "frames" | "samples">;
}): string[] {
	const format = segmentAudioFormat({ settings });
	const { frames, samples } = spanFileCounts({
		span:
			span ??
			concatSpan({
				from: gap.startTime,
				to: gap.startTime + gap.duration,
				fps: settings.fps,
				sampleRate: format.sampleRate,
			}),
	});
	return [
		"-y",
		...blackPictureInputArgs({ settings }),
		...silenceInputArgs({ format }),
		"-map",
		"0:v:0",
		"-map",
		"1:a:0",
		"-vf",
		`trim=end_frame=${frames}`,
		"-af",
		`atrim=end_sample=${samples}`,
		"-c:v",
		settings.codec,
		"-preset",
		"medium",
		"-b:v",
		parseBitrateForKbps({ bitrate: settings.bitrate }),
		"-pix_fmt",
		"yuv420p",
		...segmentPcmAudioArgs({ format }),
		outputPath,
	];
}

/** A file the concat joins: a segment or a gap, and where it sits. */
export interface ConcatEntry {
	kind: "segment" | "gap";
	/** Index into the segments or the gaps. */
	index: number;
	startTime: number;
	endTime: number;
}

/** Segments and gaps in timeline order, the order the concat joins them. */
export function orderConcatEntries({
	segments,
	gaps,
}: {
	segments: Array<Pick<ExportSegment, "startTime" | "duration">>;
	gaps: TimelineGap[];
}): ConcatEntry[] {
	const entries: ConcatEntry[] = [];
	const pushGapBefore = (segmentIndex: number) => {
		const index = gaps.findIndex((gap) => gap.beforeSegment === segmentIndex);
		if (index < 0) return;
		const gap = gaps[index];
		entries.push({
			kind: "gap",
			index,
			startTime: gap.startTime,
			endTime: gap.startTime + gap.duration,
		});
	};
	for (const [index, segment] of segments.entries()) {
		pushGapBefore(index);
		entries.push({
			kind: "segment",
			index,
			startTime: segment.startTime,
			endTime: segment.startTime + segment.duration,
		});
	}
	pushGapBefore(segments.length);
	return entries;
}
