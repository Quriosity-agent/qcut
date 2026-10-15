/**
 * CLI-safe video probing via ffprobe.
 *
 * Standalone Node.js utility (no Electron dependencies).
 * Used by subtitle-export to get video resolution for ASS PlayRes.
 *
 * @module electron/native-pipeline/subtitle/probe-video
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface VideoInfo {
	width: number;
	height: number;
	duration: number;
	/** Frames per second, when the stream states a usable rate. */
	fps?: number;
}

/** "24000/1001" → 23.976; "0/0" and garbage → undefined. */
function parseFrameRate(value: unknown): number | undefined {
	if (typeof value !== "string") return;
	const [numerator, denominator = "1"] = value.split("/");
	const rate = Number(numerator) / Number(denominator);
	return Number.isFinite(rate) && rate > 0
		? Number(rate.toFixed(3))
		: undefined;
}

/** Resolve ffprobe binary path. */
async function resolveFFprobePath(): Promise<string> {
	try {
		const { getFFprobePath } = await import("../../ffmpeg/paths.js");
		return getFFprobePath();
	} catch {
		return "ffprobe";
	}
}

/** Probe a video file for resolution, duration and frame rate. */
export async function probeVideoInfo(videoPath: string): Promise<VideoInfo> {
	const ffprobe = await resolveFFprobePath();
	const { stdout } = await execFileAsync(ffprobe, [
		"-v",
		"quiet",
		"-print_format",
		"json",
		"-show_streams",
		"-show_format",
		videoPath,
	]);

	const data = JSON.parse(stdout);
	const videoStream = data.streams?.find(
		(s: { codec_type: string }) => s.codec_type === "video"
	);

	if (!videoStream) {
		throw new Error(`No video stream found in ${videoPath}`);
	}

	const width = parseInt(videoStream.width, 10) || 1920;
	const height = parseInt(videoStream.height, 10) || 1080;
	const duration = parseFloat(
		data.format?.duration || videoStream.duration || "0"
	);

	const fps =
		parseFrameRate(videoStream.avg_frame_rate) ??
		parseFrameRate(videoStream.r_frame_rate);

	return { width, height, duration, ...(fps ? { fps } : {}) };
}
