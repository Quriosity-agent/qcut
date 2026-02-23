/**
 * FFmpeg Progress Parsing
 */

import type { FFmpegProgress } from "./types";

/**
 * Extracts progress information from FFmpeg stderr output.
 */
export function parseProgress(output: string): FFmpegProgress | null {
	const frameMatch: RegExpMatchArray | null = output.match(/frame=\s*(\d+)/);
	const timeMatch: RegExpMatchArray | null = output.match(
		/time=(\d+:\d+:\d+\.\d+)/
	);

	if (frameMatch || timeMatch) {
		return {
			frame: frameMatch ? Number.parseInt(frameMatch[1], 10) : null,
			time: timeMatch ? timeMatch[1] : null,
		};
	}
	return null;
}
