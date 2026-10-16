/**
 * The FFmpeg command that renders one timeline segment to an intermediate
 * MP4 before the segments are joined.
 * @module electron/claude/handlers/claude-export-handler/export-segment-encode
 */

import { buildAtempoChain } from "../../../ffmpeg/segment-transform-filter.js";
import type { ExportSegment, ResolvedExportSettings } from "./types.js";
import { parseBitrateForKbps } from "./utils.js";

/**
 * Both streams are padded without end (the last frame is cloned, the sound
 * gets silence) and the output `-t` alone cuts the segment to exactly its
 * length, so a source shorter than the segment fills it too. There is no
 * `-shortest`: FFmpeg's sync queue then trims every other stream to the
 * first stream that ends, and the sound ends on an AAC frame boundary (21–32
 * ms), which for a 32 kHz source sits just before the last picture frame —
 * every untrimmed clip lost that frame, nine frames over a twelve-clip film.
 */
export function buildExportSegmentEncodeArgs({
	inputArgs,
	scaleFilter,
	segment,
	settings,
	outputPath,
}: {
	inputArgs: string[];
	scaleFilter: string;
	segment: ExportSegment;
	settings: Pick<ResolvedExportSettings, "fps" | "codec" | "bitrate">;
	outputPath: string;
}): string[] {
	const atempo = segment.isImage
		? null
		: buildAtempoChain({ rate: segment.playbackRate ?? 1 });
	return [
		"-y",
		...inputArgs,
		"-vf",
		`${scaleFilter},tpad=stop_mode=clone:stop=-1`,
		"-r",
		String(settings.fps),
		"-c:v",
		settings.codec,
		"-preset",
		"medium",
		"-b:v",
		parseBitrateForKbps({ bitrate: settings.bitrate }),
		"-pix_fmt",
		"yuv420p",
		...(segment.isImage
			? []
			: [
					"-c:a",
					"aac",
					"-b:a",
					"192k",
					"-af",
					atempo === null ? "apad" : `${atempo},apad`,
				]),
		"-t",
		String(segment.duration),
		outputPath,
	];
}
