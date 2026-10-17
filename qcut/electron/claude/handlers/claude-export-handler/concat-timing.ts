/**
 * Timing of the native export's concat step.
 *
 * The segments and gap clips are intermediate MOVs whose sound is PCM in
 * one rate and layout, so the concat demuxer lays every file's samples
 * straight after the previous file's and nothing is added at a cut. The
 * picture is copied; the sound is encoded to AAC once, here, so the program
 * carries a single encoder priming at its start, kept as an edit list, and
 * picture and sound both start at zero.
 *
 * (Encoding each segment to AAC and copying the packets put a priming frame
 * in front of every clip and kept the padding at the end of each one: the
 * sound of every clip after the first moved 40–60 ms later per cut, and the
 * first file's priming had shifted the whole program as well.)
 *
 * @module electron/claude/handlers/claude-export-handler/concat-timing
 */

import type { SegmentAudioFormat } from "./export-segment-encode.js";

/** The concat of `listPath` into `outputPath`: picture copied, sound encoded once. */
export function buildSegmentConcatArgs({
	listPath,
	outputPath,
	audio,
	audioBitrateKbps,
}: {
	listPath: string;
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
		listPath,
		"-map",
		"0:v:0",
		"-map",
		"0:a:0",
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
