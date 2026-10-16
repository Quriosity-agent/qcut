import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildVideoColorFilter } from "../ffmpeg/color-filter";
import { DEFAULT_VIDEO_COLOR_SETTINGS } from "../ffmpeg/color-settings";
import { DEFAULT_VISUAL } from "../ffmpeg-video-transform";

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const hasFfmpeg = fs.existsSync(ffmpegPath);

/** Grey level after `filter`, measured on a flat frame through yuv420p. */
function gradedGrey({ level, filter }: { level: number; filter: string }) {
	const hex = level.toString(16).padStart(2, "0");
	const result = spawnSync(ffmpegPath, [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`color=c=0x${hex}${hex}${hex}:s=16x16:r=1:d=1,format=yuv420p`,
		"-vf",
		`${filter},scale=1:1:flags=area`,
		"-frames:v",
		"1",
		"-f",
		"rawvideo",
		"-pix_fmt",
		"rgb24",
		"-",
	]);
	expect(result.status, result.stderr?.toString()).toBe(0);
	return result.stdout[0];
}

function filterFor(basic: Partial<typeof DEFAULT_VIDEO_COLOR_SETTINGS.basic>) {
	const color = structuredClone(DEFAULT_VIDEO_COLOR_SETTINGS);
	color.basic = { ...color.basic, enabled: true, ...basic };
	return buildVideoColorFilter({ visual: { ...DEFAULT_VISUAL, color } });
}

/**
 * The preview applies CSS `brightness(f)`, which multiplies every channel; the
 * native grade has to land on the same greys, not subtract a constant that
 * crushes dark frames.
 */
describe.skipIf(!hasFfmpeg)(
	"native basic grade matches the preview (real FFmpeg)",
	() => {
		it("brightness scales grey levels", () => {
			const filter = filterFor({ brightness: -30 });
			for (const level of [64, 128, 192]) {
				expect(
					Math.abs(gradedGrey({ level, filter }) - level * 0.7)
				).toBeLessThanOrEqual(4);
			}
		}, 60_000);

		it("exposure is a gain, and contrast stretches around mid-grey after it", () => {
			const exposure = filterFor({ exposure: -1 });
			expect(
				Math.abs(gradedGrey({ level: 128, filter: exposure }) - 64)
			).toBeLessThanOrEqual(4);
			const contrast = filterFor({ contrast: 50 });
			// CSS contrast(1.5): (0.25 − 0.5)·1.5 + 0.5 = 0.125
			expect(
				Math.abs(gradedGrey({ level: 64, filter: contrast }) - 32)
			).toBeLessThanOrEqual(4);
			expect(
				Math.abs(gradedGrey({ level: 128, filter: contrast }) - 128)
			).toBeLessThanOrEqual(4);
			const both = filterFor({ brightness: -30, contrast: 50 });
			// brightness first, then contrast: (0.5·0.7 − 0.5)·1.5 + 0.5 = 0.275
			expect(
				Math.abs(gradedGrey({ level: 128, filter: both }) - 70)
			).toBeLessThanOrEqual(4);
		}, 60_000);

		it("leaves black and a neutral grade alone", () => {
			expect(
				gradedGrey({ level: 0, filter: filterFor({ brightness: -30 }) })
			).toBeLessThanOrEqual(2);
			expect(gradedGrey({ level: 128, filter: filterFor({}) })).toBe(128);
		}, 60_000);
	}
);
