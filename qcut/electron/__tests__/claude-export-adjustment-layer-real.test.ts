import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAdjustmentLayerPass } from "../claude/handlers/claude-export-handler/adjustment-layer-pass.js";
import { DEFAULT_VIDEO_COLOR_SETTINGS } from "../ffmpeg/color-settings.js";

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const tempDir = path.resolve(
	__dirname,
	"../../.tmp/adjustment-layer-export-real-test"
);
const hasFfmpeg = fs.existsSync(ffmpegPath);

/** Mean RGB of the frame at `time`, from a 1×1 downscale. */
function meanRgb({ file, time }: { file: string; time: number }) {
	const result = spawnSync(
		ffmpegPath,
		[
			"-v",
			"error",
			"-ss",
			String(time),
			"-i",
			file,
			"-frames:v",
			"1",
			"-vf",
			"scale=1:1:flags=area",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ maxBuffer: 1024 * 1024 }
	);
	expect(result.status, result.stderr?.toString()).toBe(0);
	const [r, g, b] = result.stdout;
	return { r, g, b };
}

describe.skipIf(!hasFfmpeg)(
	"adjustment layer export pass (real FFmpeg)",
	() => {
		const sourcePath = path.join(tempDir, "flat-blue.mp4");
		const outputPath = path.join(tempDir, "graded.mp4");

		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
			// Three seconds of one saturated blue, so a grade is easy to measure.
			const made = spawnSync(ffmpegPath, [
				"-y",
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"color=c=0x4080c0:s=64x36:r=24:d=3,format=yuv420p",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				sourcePath,
			]);
			expect(made.status, made.stderr?.toString()).toBe(0);
		}, 60_000);

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		it("desaturates only inside the layer's window and leaves the rest untouched", () => {
			const color = structuredClone(DEFAULT_VIDEO_COLOR_SETTINGS);
			color.enabled = true;
			color.basic = { ...color.basic, enabled: true, saturation: -100 };
			const pass = buildAdjustmentLayerPass({
				inputPath: sourcePath,
				outputPath,
				layers: [
					{
						elementId: "adj",
						trackOrder: 0,
						startTime: 1,
						endTime: 2,
						color,
						opacity: 1,
						aboveOverlays: false,
					},
				],
				codec: "libx264",
				bitrate: "2000k",
			});
			expect(pass).not.toBeNull();
			const run = spawnSync(ffmpegPath, ["-v", "error", ...(pass?.args ?? [])]);
			expect(run.status, run.stderr?.toString()).toBe(0);

			const before = meanRgb({ file: sourcePath, time: 0.5 });
			const untouched = meanRgb({ file: outputPath, time: 0.5 });
			const inside = meanRgb({ file: outputPath, time: 1.5 });
			const after = meanRgb({ file: outputPath, time: 2.5 });
			for (const sample of [untouched, after]) {
				expect(Math.abs(sample.r - before.r)).toBeLessThanOrEqual(6);
				expect(Math.abs(sample.g - before.g)).toBeLessThanOrEqual(6);
				expect(Math.abs(sample.b - before.b)).toBeLessThanOrEqual(6);
			}
			// Fully desaturated: the channels collapse onto one grey value.
			expect(Math.abs(inside.r - inside.g)).toBeLessThanOrEqual(6);
			expect(Math.abs(inside.g - inside.b)).toBeLessThanOrEqual(6);
			expect(before.b - before.r).toBeGreaterThan(80);
		}, 60_000);
	}
);
