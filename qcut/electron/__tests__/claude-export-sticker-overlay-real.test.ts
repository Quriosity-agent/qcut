/**
 * A moving sticker in the native export starts on its own first frame where
 * it appears on the timeline, not wherever its loop had got to since the
 * start of the export.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildStickerOverlayPass } from "../claude/handlers/claude-export-handler/sticker-overlay.js";

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);

function run(args: string[]) {
	const result = spawnSync(ffmpegPath, ["-v", "error", "-y", ...args]);
	expect(result.status, result.stderr?.toString()).toBe(0);
}

/** RGB at the centre of the sticker box, at `time`. */
function stickerPixel({ file, time }: { file: string; time: number }) {
	const frame = spawnSync(ffmpegPath, [
		"-v",
		"error",
		"-ss",
		String(time),
		"-i",
		file,
		"-frames:v",
		"1",
		"-f",
		"rawvideo",
		"-pix_fmt",
		"rgb24",
		"-",
	]).stdout;
	const index = (40 * 160 + 40) * 3;
	return Array.from(frame.subarray(index, index + 3));
}

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"native sticker pass with FFmpeg",
	{ timeout: 60_000 },
	() => {
		it("plays a moving sticker from its first frame at its start", () => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qcut-sticker-start-"));
			try {
				const base = path.join(dir, "base.mp4");
				const sticker = path.join(dir, "sticker.mp4");
				const output = path.join(dir, "out.mp4");
				run([
					"-f",
					"lavfi",
					"-i",
					"color=c=black:s=160x90:r=25:d=3",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					base,
				]);
				// One second of red, then one of blue.
				run([
					"-f",
					"lavfi",
					"-i",
					"color=c=red:s=80x80:r=25:d=1",
					"-f",
					"lavfi",
					"-i",
					"color=c=blue:s=80x80:r=25:d=1",
					"-filter_complex",
					"[0:v][1:v]concat=n=2:v=1:a=0",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					sticker,
				]);
				const pass = buildStickerOverlayPass({
					inputPath: base,
					outputPath: output,
					stickerOverlays: [
						{
							mediaId: "sticker",
							sourcePath: sticker,
							startTime: 1,
							endTime: 2.6,
							x: 0,
							y: 0,
							width: 80,
							height: 80,
							opacity: 1,
							rotation: 0,
						},
					],
					codec: "libx264",
					bitrate: "4000k",
				});
				run(pass.args);
				const [red, , blue] = stickerPixel({ file: output, time: 1.2 });
				expect(red).toBeGreaterThan(200);
				expect(blue).toBeLessThan(60);
				const late = stickerPixel({ file: output, time: 2.3 });
				expect(late[2]).toBeGreaterThan(200);
				expect(
					Math.max(...stickerPixel({ file: output, time: 0.5 }))
				).toBeLessThan(30);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});
	}
);
