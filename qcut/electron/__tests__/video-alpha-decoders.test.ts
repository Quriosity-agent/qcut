/**
 * The editor's CLI export composites video tracks in one FFmpeg graph; a VP9
 * clip with alpha must be decoded by libvpx there, or its clear pixels decode
 * black and cover every track under it.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildFFmpegArgs } from "../ffmpeg-args-builder";
import { videoAlphaFromStream } from "../ffmpeg/video-alpha";
import { withAlphaDecoders } from "../ffmpeg/video-alpha-probe";
import type { VideoSource } from "../ffmpeg/types";

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);

const vp9Alpha = videoAlphaFromStream({
	stream: { codec_name: "vp9", pix_fmt: "yuv420p", tags: { alpha_mode: "1" } },
});

function source(
	pathName: string,
	trackOrder: number,
	extra: Partial<VideoSource> = {}
): VideoSource {
	return {
		elementId: path.basename(pathName),
		trackId: `track-${trackOrder}`,
		trackOrder,
		elementOrder: 0,
		path: pathName,
		startTime: 0,
		duration: 1,
		...extra,
	};
}

describe("withAlphaDecoders", () => {
	it("names libvpx on VP9 alpha sources, probing each file once", async () => {
		const probe = vi.fn(async ({ mediaPath }: { mediaPath: string }) =>
			mediaPath.endsWith(".webm") ? vp9Alpha : null
		);
		const card = source("/m/card.webm", 0);
		const again = source("/m/card.webm", 0, { startTime: 2 });
		const base = source("/m/base.mp4", 1);
		const result = await withAlphaDecoders({
			sources: [card, again, base],
			probe,
		});
		expect(result.map((entry) => entry.decoder)).toEqual([
			"libvpx-vp9",
			"libvpx-vp9",
			undefined,
		]);
		expect(probe).toHaveBeenCalledTimes(2);
	});

	it("keeps FFmpeg's decoder when a file cannot be probed", async () => {
		const card = source("/m/card.webm", 0);
		await expect(
			withAlphaDecoders({
				sources: [card],
				probe: async () => {
					throw new Error("ffprobe failed");
				},
			})
		).resolves.toEqual([card]);
	});
});

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"CLI composite with a VP9 alpha clip",
	{ timeout: 60_000 },
	() => {
		it("names the decoder before the clip's input and keeps its alpha", async () => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qcut-cli-alpha-"));
			try {
				const base = path.join(dir, "base.mp4");
				const card = path.join(dir, "card.webm");
				const output = path.join(dir, "out.mp4");
				for (const args of [
					[
						"-f",
						"lavfi",
						"-i",
						"color=c=red:s=160x90:r=30:d=1",
						"-c:v",
						"libx264",
						"-pix_fmt",
						"yuv420p",
						base,
					],
					[
						"-f",
						"lavfi",
						"-i",
						"color=c=black@0:s=160x90:r=30:d=1,format=rgba,drawbox=x=60:y=30:w=40:h=30:color=white@1:t=fill:replace=1",
						"-c:v",
						"libvpx-vp9",
						"-pix_fmt",
						"yuva420p",
						"-auto-alt-ref",
						"0",
						card,
					],
				]) {
					const made = spawnSync(ffmpegPath, ["-v", "error", "-y", ...args]);
					expect(made.status, made.stderr?.toString()).toBe(0);
				}
				const videoSources = await withAlphaDecoders({
					sources: [source(base, 1), source(card, 0)],
				});
				const args = buildFFmpegArgs({
					inputDir: dir,
					outputFile: output,
					width: 160,
					height: 90,
					fps: 30,
					quality: "high",
					duration: 1,
					videoSources,
				});
				const input = args.indexOf(card);
				expect(args.slice(input - 3, input + 1)).toEqual([
					"-c:v",
					"libvpx-vp9",
					"-i",
					card,
				]);
				const run = spawnSync(ffmpegPath, ["-v", "error", ...args]);
				expect(run.status, run.stderr?.toString()).toBe(0);
				const frame = spawnSync(ffmpegPath, [
					"-v",
					"error",
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
				]).stdout;
				const pixel = (x: number, y: number) =>
					Array.from(frame.subarray((y * 160 + x) * 3, (y * 160 + x) * 3 + 3));
				const [red, green, blue] = pixel(20, 20);
				// The clear part shows the red base, not black.
				expect(red).toBeGreaterThan(200);
				expect(green).toBeLessThan(40);
				expect(blue).toBeLessThan(40);
				expect(Math.min(...pixel(80, 45))).toBeGreaterThan(220);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});
	}
);
