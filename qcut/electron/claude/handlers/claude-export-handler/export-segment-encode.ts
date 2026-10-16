/**
 * The FFmpeg command that renders one timeline segment to an intermediate
 * MP4 before the segments are joined.
 * @module electron/claude/handlers/claude-export-handler/export-segment-encode
 */

import { buildAtempoChain } from "../../../ffmpeg/segment-transform-filter.js";
import type { ExportSegment, ResolvedExportSettings } from "./types.js";
import { parseBitrateForKbps } from "./utils.js";

/**
 * A source whose sound ends a frame before its picture (AAC frames are 21–32
 * ms) used to lose that frame to `-shortest`, and a dozen such clips
 * shortened an export by two frames. Both streams are padded past the
 * segment's length and the output is cut to exactly that length.
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
		`${scaleFilter},tpad=stop_mode=clone:stop_duration=1`,
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
		"-shortest",
		outputPath,
	];
}
