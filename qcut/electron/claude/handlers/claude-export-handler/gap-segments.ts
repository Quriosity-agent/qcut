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
 * joins it like any segment. Written as an intermediate MOV.
 */
export function buildGapSegmentEncodeArgs({
	gap,
	settings,
	outputPath,
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
}): string[] {
	return [
		"-y",
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=${settings.width}x${settings.height}:r=${settings.fps}`,
		...silenceInputArgs({ format: segmentAudioFormat({ settings }) }),
		"-map",
		"0:v:0",
		"-map",
		"1:a:0",
		"-t",
		String(gap.duration),
		"-c:v",
		settings.codec,
		"-preset",
		"medium",
		"-b:v",
		parseBitrateForKbps({ bitrate: settings.bitrate }),
		"-pix_fmt",
		"yuv420p",
		...segmentPcmAudioArgs({ format: segmentAudioFormat({ settings }) }),
		outputPath,
	];
}

/** Segment and gap files in timeline order, for the concat list. */
export function orderConcatInputs({
	segmentOutputs,
	gaps,
	gapOutputs,
}: {
	segmentOutputs: string[];
	gaps: TimelineGap[];
	gapOutputs: string[];
}): string[] {
	const inputs: string[] = [];
	const pushGapBefore = (index: number) => {
		const gapIndex = gaps.findIndex((gap) => gap.beforeSegment === index);
		if (gapIndex >= 0 && gapOutputs[gapIndex])
			inputs.push(gapOutputs[gapIndex]);
	};
	for (const [index, output] of segmentOutputs.entries()) {
		pushGapBefore(index);
		inputs.push(output);
	}
	pushGapBefore(segmentOutputs.length);
	return inputs;
}
