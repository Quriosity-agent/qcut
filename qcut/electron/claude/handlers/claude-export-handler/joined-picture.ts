/**
 * The joined picture as the first input of a later pass that draws other
 * files over it (media overlays, text rasters, stickers).
 *
 * Its picture is copied from the segments, so its colour tags change where
 * two clips say different things. FFmpeg then rebuilds the pass's whole
 * filter graph, and every other input loses the frames the old graph had
 * already read: overlays that appeared after the change started 2–5 frames
 * into their own picture, with their last frame held to make up the length.
 * The pixel format and size never change here, so the graph is kept
 * (`-reinit_filter 0`).
 *
 * Every SDR clip is now encoded in one description (source-color.ts), so
 * that no longer happens from one ordinary clip to the next. An HDR clip
 * still keeps its own, and a picture that has both changes where they
 * meet: that is what this is left guarding.
 *
 * A graph that is kept still reads each frame's own tags wherever it converts
 * the picture (a blend mode works in RGB), while it converts back with the
 * tags it was built for. Every frame is therefore described as the first one
 * is: the pass then treats the whole picture as it always treated its start,
 * which is also how the encoder tags the file.
 *
 * @module electron/claude/handlers/claude-export-handler/joined-picture
 */

import { spawn } from "node:child_process";
import { getFFprobePath } from "../../../ffmpeg/paths.js";
import { claudeLog } from "../../utils/logger.js";
import { HANDLER_NAME } from "./types.js";

/** The tags a conversion between YUV and RGB depends on, as ffprobe names them. */
export interface JoinedPictureColor {
	range: string;
	space: string;
}

/** Names `setparams` takes; anything else is passed on as untagged. */
const RANGES = new Set(["tv", "pc"]);
const SPACES = new Set([
	"bt709",
	"fcc",
	"bt470bg",
	"smpte170m",
	"smpte240m",
	"ycgco",
	"bt2020nc",
	"bt2020c",
]);

export function joinedPictureInputArgs({ path }: { path: string }): string[] {
	return ["-reinit_filter", "0", "-i", path];
}

function readFirstStreamColor({
	ffprobePath,
	path,
}: {
	ffprobePath: string;
	path: string;
}): Promise<JoinedPictureColor> {
	return new Promise((resolve, reject) => {
		const ffprobe = spawn(
			ffprobePath,
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=color_range,color_space",
				"-of",
				"json",
				path,
			],
			{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
		);
		let stdout = "";
		const timeoutId = setTimeout(() => {
			ffprobe.kill();
			reject(new Error("ffprobe timed out"));
		}, 10_000);
		ffprobe.stdout?.on("data", (data) => {
			stdout += data.toString();
		});
		ffprobe.on("error", (error) => {
			clearTimeout(timeoutId);
			reject(error);
		});
		ffprobe.on("close", (code) => {
			clearTimeout(timeoutId);
			if (code !== 0) {
				reject(new Error(`ffprobe failed with code ${code}`));
				return;
			}
			try {
				const stream = (
					JSON.parse(stdout) as {
						streams?: Array<{ color_range?: string; color_space?: string }>;
					}
				).streams?.[0];
				resolve({
					range: stream?.color_range ?? "unknown",
					space: stream?.color_space ?? "unknown",
				});
			} catch (error) {
				reject(error);
			}
		});
	});
}

/**
 * The colour tags of the picture's first frames. Undefined when they cannot
 * be read: the pass then reads the picture as it comes, which only differs
 * under a blend mode after a change of tags.
 */
export async function probeJoinedPictureColor({
	path,
}: {
	path: string;
}): Promise<JoinedPictureColor | undefined> {
	try {
		return await readFirstStreamColor({
			ffprobePath: await getFFprobePath(),
			path,
		});
	} catch (error) {
		claudeLog.warn(
			HANDLER_NAME,
			`Could not read the joined picture's colour tags: ${error instanceof Error ? error.message : String(error)}`
		);
		return undefined;
	}
}

/**
 * The filter that describes every frame of the picture as `color`; it
 * changes no pixel.
 */
export function joinedPictureColorFilter({
	color,
}: {
	color: JoinedPictureColor;
}): string {
	const range = RANGES.has(color.range) ? color.range : "unknown";
	const space = SPACES.has(color.space) ? color.space : "unknown";
	return `setparams=range=${range}:colorspace=${space}`;
}
