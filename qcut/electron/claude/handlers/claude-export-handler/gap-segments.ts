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

import { spawn } from "node:child_process";
import { getFFprobePath } from "../../../ffmpeg/utils.js";
import type { ExportSegment, ResolvedExportSettings } from "./types.js";
import { parseBitrateForKbps } from "./utils.js";

export interface TimelineGap {
	/** Position (in start order) of the segment the gap precedes. */
	beforeSegment: number;
	startTime: number;
	duration: number;
}

/** The sound of the clips around a gap, so silence can be copied alongside. */
export interface GapAudioLayout {
	sampleRate: number;
	channels: number;
}

const DEFAULT_GAP_AUDIO: GapAudioLayout = { sampleRate: 48_000, channels: 2 };

/**
 * Gaps longer than half a frame between `segments` (sorted by start time),
 * measured against the furthest end so far: overlapping lanes leave none.
 */
export function findTimelineGaps({
	segments,
	fps,
}: {
	segments: ExportSegment[];
	fps: number;
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
	return gaps;
}

/**
 * The FFmpeg command for one gap: black picture and silence, with the
 * segments' codec, size, rate and pixel format so the concat can copy it.
 */
export function buildGapSegmentEncodeArgs({
	gap,
	settings,
	audio = DEFAULT_GAP_AUDIO,
	outputPath,
}: {
	gap: TimelineGap;
	settings: Pick<
		ResolvedExportSettings,
		"width" | "height" | "fps" | "codec" | "bitrate"
	>;
	audio?: GapAudioLayout;
	outputPath: string;
}): string[] {
	const layout = audio.channels === 1 ? "mono" : "stereo";
	return [
		"-y",
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=${settings.width}x${settings.height}:r=${settings.fps}`,
		"-f",
		"lavfi",
		"-i",
		`anullsrc=r=${audio.sampleRate}:cl=${layout}`,
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
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-shortest",
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
	for (const [index, output] of segmentOutputs.entries()) {
		const gapIndex = gaps.findIndex((gap) => gap.beforeSegment === index);
		if (gapIndex >= 0 && gapOutputs[gapIndex])
			inputs.push(gapOutputs[gapIndex]);
		inputs.push(output);
	}
	return inputs;
}

/**
 * The sample rate and channel count of the first encoded segment that has
 * sound. Segments keep their source's rate, and AAC packets at another rate
 * in the same copied stream would play at the wrong speed, so the silence
 * takes the same shape; without any sound the default is 48 kHz stereo.
 */
export async function probeGapAudioLayout({
	segmentOutputs,
}: {
	segmentOutputs: string[];
}): Promise<GapAudioLayout> {
	for (const file of segmentOutputs) {
		const layout = await probeAudioLayout({ file });
		if (layout) return layout;
	}
	return DEFAULT_GAP_AUDIO;
}

async function probeAudioLayout({
	file,
}: {
	file: string;
}): Promise<GapAudioLayout | null> {
	const ffprobePath = await getFFprobePath();
	const output = await new Promise<string>((resolve) => {
		const probe = spawn(
			ffprobePath,
			[
				"-v",
				"error",
				"-select_streams",
				"a:0",
				"-show_entries",
				"stream=sample_rate,channels",
				"-of",
				"csv=p=0",
				file,
			],
			{ windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
		);
		let stdout = "";
		probe.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		probe.on("error", () => resolve(""));
		probe.on("close", () => resolve(stdout));
	});
	const [rate, channels] = output.trim().split(",").map(Number);
	if (!Number.isFinite(rate) || rate <= 0) return null;
	return {
		sampleRate: rate,
		channels: Number.isFinite(channels) && channels >= 1 ? channels : 2,
	};
}
