// @vitest-environment node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFFmpegPath } from "../ffmpeg/paths.js";
import { buildComposeFinishingArgs } from "../native-pipeline/compose/compose-ffmpeg.js";
import { parseComposeManifest } from "../native-pipeline/compose/compose-manifest.js";

const execFileAsync = promisify(execFile);
const ffmpegPath = getFFmpegPath();
const WIDTH = 640;
const HEIGHT = 360;

async function ffmpeg({ args }: { args: string[] }): Promise<Buffer> {
	const { stdout } = await execFileAsync(
		ffmpegPath,
		["-hide_banner", "-loglevel", "error", ...args],
		{ encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }
	);
	return stdout;
}

/** Bounding box of the red sticker pixels in an RGB frame. */
function redBox({ frame }: { frame: Buffer }) {
	let left = WIDTH;
	let right = -1;
	let top = HEIGHT;
	let bottom = -1;
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			const offset = (y * WIDTH + x) * 3;
			if (frame[offset] > 128 && frame[offset + 1] < 96) {
				left = Math.min(left, x);
				right = Math.max(right, x);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
		}
	}
	return {
		centerX: (left + right + 1) / 2,
		centerY: (top + bottom + 1) / 2,
		width: right - left + 1,
	};
}

describe.skipIf(!existsSync(ffmpegPath))(
	"compose sticker placement in headless renders",
	() => {
		let directory: string;

		beforeAll(async () => {
			directory = await mkdtemp(path.join(os.tmpdir(), "compose-sticker-"));
			await ffmpeg({
				args: [
					"-f",
					"lavfi",
					"-i",
					`color=black:s=${WIDTH}x${HEIGHT}:r=30:d=1`,
					"-f",
					"lavfi",
					"-i",
					"anullsrc=r=48000:cl=stereo",
					"-t",
					"1",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					"-c:a",
					"aac",
					path.join(directory, "base.mp4"),
				],
			});
			await ffmpeg({
				args: [
					"-f",
					"lavfi",
					"-i",
					"color=red:s=100x100",
					"-frames:v",
					"1",
					path.join(directory, "sticker.png"),
				],
			});
		});

		afterAll(async () => {
			await rm(directory, { recursive: true, force: true });
		});

		it("centres the sticker on x/y and sizes it from the canvas short side", async () => {
			const [overlay] = parseComposeManifest({
				value: {
					schemaVersion: 1,
					clips: [{ id: "a", source: "base.mp4" }],
					overlays: [
						{
							type: "sticker",
							source: "sticker.png",
							start: 0,
							duration: 1,
							transform: { x: 0.5, y: -0.5, scale: 0.25 },
						},
					],
				},
			}).overlays;
			const output = path.join(directory, "finished.mp4");
			await ffmpeg({
				args: buildComposeFinishingArgs({
					input: path.join(directory, "base.mp4"),
					output,
					duration: 1,
					canvasWidth: WIDTH,
					canvasHeight: HEIGHT,
					fps: 30,
					overlays: [{ overlay, path: path.join(directory, "sticker.png") }],
					audio: [],
				}),
			});
			const frame = await ffmpeg({
				args: [
					"-ss",
					"0.5",
					"-i",
					output,
					"-frames:v",
					"1",
					"-f",
					"rawvideo",
					"-pix_fmt",
					"rgb24",
					"-",
				],
			});

			const box = redBox({ frame });
			// The editor's placement: centre at 75% across and 25% down, width
			// 25% of the 360 px short side.
			expect(Math.abs(box.centerX - 0.75 * WIDTH)).toBeLessThanOrEqual(2);
			expect(Math.abs(box.centerY - 0.25 * HEIGHT)).toBeLessThanOrEqual(2);
			expect(Math.abs(box.width - 0.25 * HEIGHT)).toBeLessThanOrEqual(3);
		});
	}
);
