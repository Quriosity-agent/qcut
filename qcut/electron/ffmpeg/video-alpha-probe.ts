/**
 * Reads a video file's alpha facts with ffprobe; the rule itself lives in
 * `video-alpha.ts`.
 *
 * @module electron/ffmpeg/video-alpha-probe
 */

import { spawn } from "node:child_process";
import { getFFprobePath } from "./paths.js";
import {
	type ProbedVideoStream,
	type VideoAlphaInfo,
	videoAlphaFromStream,
} from "./video-alpha.js";

/**
 * Probes the first video stream's alpha facts. Null when the file has no
 * video stream; rejects when ffprobe cannot read the file.
 */
export async function probeVideoAlpha({
	mediaPath,
}: {
	mediaPath: string;
}): Promise<VideoAlphaInfo | null> {
	const ffprobePath = await getFFprobePath();
	return new Promise<VideoAlphaInfo | null>((resolve, reject) => {
		const ffprobe = spawn(
			ffprobePath,
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=codec_name,pix_fmt:stream_tags",
				"-of",
				"json",
				mediaPath,
			],
			{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
		);
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (result: {
			error?: Error;
			alpha?: VideoAlphaInfo | null;
		}) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			if (result.error) reject(result.error);
			else resolve(result.alpha ?? null);
		};
		const timeoutId = setTimeout(() => {
			ffprobe.kill();
			finish({ error: new Error(`ffprobe timeout for: ${mediaPath}`) });
		}, 10_000);
		ffprobe.stdout?.on("data", (data) => {
			stdout += data.toString();
		});
		ffprobe.stderr?.on("data", (data) => {
			stderr += data.toString();
		});
		ffprobe.on("close", (code) => {
			if (code !== 0) {
				finish({
					error: new Error(
						`ffprobe failed with code ${code}: ${stderr.trim()}`
					),
				});
				return;
			}
			try {
				const parsed = JSON.parse(stdout) as { streams?: ProbedVideoStream[] };
				const stream = parsed.streams?.[0];
				finish({ alpha: stream ? videoAlphaFromStream({ stream }) : null });
			} catch (error) {
				finish({
					error: new Error(
						`Failed to parse ffprobe output for ${mediaPath}: ${error instanceof Error ? error.message : String(error)}`
					),
				});
			}
		});
		ffprobe.on("error", (error) => {
			finish({ error: new Error(`Failed to spawn ffprobe: ${error.message}`) });
		});
	});
}
