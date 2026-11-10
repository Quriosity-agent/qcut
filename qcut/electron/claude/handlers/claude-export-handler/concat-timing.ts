/**
 * Timing of the native export's concat step.
 *
 * The segments and gap clips are intermediate MOVs whose sound is PCM in
 * one rate and layout. The sound is encoded to AAC once, here, so the program
 * carries a single encoder priming at its start, kept as an edit list, and
 * picture and sound both start at zero.
 *
 * (Encoding each segment to AAC and copying the packets put a priming frame
 * in front of every clip and kept the padding at the end of each one: the
 * sound of every clip after the first moved 40–60 ms later per cut, and the
 * first file's priming had shifted the whole program as well.)
 *
 * Every input fills a span of the timeline in whole output frames and in
 * samples, both counted from the timeline's start, so the spans add up to
 * exactly the timeline. A clip whose length is not a whole number of frames
 * used to be rounded up to whole frames on its own, and the picture of every
 * clip after it moved later by the sum of those remainders while its sound
 * stayed put: eleven such cuts left the end of a trailer 5 frames late.
 *
 * Within one file the picture and the sound then differ by part of a frame,
 * and the concat demuxer would start the next file after the longer of the
 * two. The picture and the sound are therefore joined from two lists of the
 * same files, each giving every file its own stream's length.
 *
 * @module electron/claude/handlers/claude-export-handler/concat-timing
 */

import type { SegmentAudioFormat } from "./export-segment-encode.js";
import { outputFrameAt } from "./media-overlay-source.js";

/** The stretch of the timeline one concat input fills. */
export interface ConcatSpan {
	from: number;
	to: number;
	/** Output frames from `from` to `to`, by the preview's frame rule. */
	frames: number;
	/** Samples from `from` to `to`, both ends rounded on the timeline. */
	samples: number;
}

export function concatSpan({
	from,
	to,
	fps,
	sampleRate,
}: {
	from: number;
	to: number;
	fps: number;
	sampleRate: number;
}): ConcatSpan {
	return {
		from,
		to,
		frames: Math.max(
			0,
			outputFrameAt({ time: to, fps }) - outputFrameAt({ time: from, fps })
		),
		samples: Math.max(
			0,
			Math.round(to * sampleRate) - Math.round(from * sampleRate)
		),
	};
}

/**
 * The span of a file that is placed on the timeline by its start time, not
 * joined to the file before it (a transition export): every frame that starts
 * within its length and all of its samples, as `-t` used to cut it.
 */
export function standaloneSpan({
	startTime,
	endTime,
	fps,
	sampleRate,
}: {
	startTime: number;
	endTime: number;
	fps: number;
	sampleRate: number;
}): ConcatSpan {
	const duration = Math.max(0, endTime - startTime);
	return {
		from: startTime,
		to: endTime,
		frames: Math.ceil(duration * fps - 1e-6),
		samples: Math.round(duration * sampleRate),
	};
}

/**
 * What a file written for `span` holds. It always has a frame and a sample,
 * so it is a file FFmpeg can read even when its span is shorter than either;
 * the concat lists leave out the stream such a span has nothing of.
 */
export function spanFileCounts({
	span,
}: {
	span: Pick<ConcatSpan, "frames" | "samples">;
}): { frames: number; samples: number } {
	return {
		frames: Math.max(1, span.frames),
		samples: Math.max(1, span.samples),
	};
}

/**
 * Spans for inputs joined end to end, in timeline order: each runs from its
 * own start (the first from 0) to the next one's start (the last to its own
 * end), so a hole too short for a gap clip, or a sliver of overlap, is taken
 * up where it is instead of moving everything after it.
 */
export function planConcatSpans({
	inputs,
	fps,
	sampleRate,
}: {
	inputs: Array<{ startTime: number; endTime: number }>;
	fps: number;
	sampleRate: number;
}): ConcatSpan[] {
	return inputs.map((input, index) =>
		concatSpan({
			from: index === 0 ? 0 : input.startTime,
			to:
				index + 1 < inputs.length ? inputs[index + 1].startTime : input.endTime,
			fps,
			sampleRate,
		})
	);
}

/** Microseconds as the concat demuxer reads a `duration` line. */
function formatMicroseconds(microseconds: number): string {
	const whole = Math.floor(microseconds / 1_000_000);
	const fraction = String(microseconds - whole * 1_000_000).padStart(6, "0");
	return `${whole}.${fraction}`;
}

/**
 * A concat list that gives each file the length of one stream, in units of
 * that stream (frames, samples). The demuxer keeps time in microseconds; the
 * lengths are cut from running totals so their rounding never adds up.
 */
function buildConcatList({
	files,
	unitsPerSecond,
}: {
	files: Array<{ path: string; units: number }>;
	unitsPerSecond: number;
}): string {
	let elapsed = 0;
	return files
		.map(({ path, units }) => {
			const escaped = path.replace(/\\/g, "/").replace(/'/g, "'\\''");
			const start = Math.round((elapsed / unitsPerSecond) * 1_000_000);
			elapsed += units;
			const end = Math.round((elapsed / unitsPerSecond) * 1_000_000);
			return `file '${escaped}'\nduration ${formatMicroseconds(end - start)}`;
		})
		.join("\n");
}

/**
 * The picture list and the sound list for `files` (in timeline order, with
 * their spans). A file whose span holds no frame joins the sound only, and
 * one whose span holds no sample the picture only.
 */
export function buildConcatLists({
	files,
	fps,
	sampleRate,
}: {
	files: Array<{ path: string; span: ConcatSpan }>;
	fps: number;
	sampleRate: number;
}): { video: string; audio: string } {
	return {
		video: buildConcatList({
			files: files
				.filter(({ span }) => span.frames > 0)
				.map(({ path, span }) => ({ path, units: span.frames })),
			unitsPerSecond: fps,
		}),
		audio: buildConcatList({
			files: files
				.filter(({ span }) => span.samples > 0)
				.map(({ path, span }) => ({ path, units: span.samples })),
			unitsPerSecond: sampleRate,
		}),
	};
}

/**
 * The concat into `outputPath`: the picture copied from the files of
 * `videoListPath`, the sound encoded once from those of `audioListPath`.
 */
export function buildSegmentConcatArgs({
	videoListPath,
	audioListPath,
	outputPath,
	audio,
	audioBitrateKbps,
}: {
	videoListPath: string;
	audioListPath: string;
	outputPath: string;
	audio: SegmentAudioFormat;
	audioBitrateKbps: number;
}): string[] {
	return [
		"-y",
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		videoListPath,
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		audioListPath,
		"-map",
		"0:v:0",
		"-map",
		"1:a:0",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		"-b:a",
		`${audioBitrateKbps}k`,
		"-ar",
		String(audio.sampleRate),
		"-ac",
		String(audio.channels),
		"-movflags",
		"+faststart",
		outputPath,
	];
}
