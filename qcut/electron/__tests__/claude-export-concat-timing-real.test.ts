import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	buildConcatCopyArgs,
	probeLeadingAudioTime,
} from "../claude/handlers/claude-export-handler/concat-timing.js";
import { buildExportSegmentInputArgs } from "../claude/handlers/claude-export-handler/export-engine.js";
import { buildExportSegmentEncodeArgs } from "../claude/handlers/claude-export-handler/export-segment-encode.js";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types.js";

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const ffprobePath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffprobe"
);
const tempDir = path.resolve(__dirname, "../../.tmp/export-concat-timing-test");

function run(args: string[]) {
	const result = spawnSync(ffmpegPath, ["-v", "error", ...args], {
		encoding: "utf8",
	});
	expect(result.status, result.stderr).toBe(0);
}

/** Presentation times of frames brighter than mid-grey (the flashes). */
function flashTimes({ file }: { file: string }): number[] {
	const result = spawnSync(
		ffprobePath,
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`movie=${file},signalstats`,
			"-show_entries",
			"frame=pts_time:frame_tags=lavfi.signalstats.YAVG",
			"-of",
			"csv=p=0",
		],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
	);
	return result.stdout
		.trim()
		.split("\n")
		.map((line) => line.split(",").map(Number))
		.filter(([, luma]) => luma > 150)
		.map(([time]) => time);
}

/** Where sound starts after each silence (the clicks). */
function clickTimes({ file }: { file: string }): number[] {
	const result = spawnSync(
		ffmpegPath,
		[
			"-hide_banner",
			"-nostats",
			"-i",
			file,
			"-vn",
			"-af",
			"silencedetect=n=-35dB:d=0.05",
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8" }
	);
	return [...result.stderr.matchAll(/silence_end: ([0-9.]+)/g)].map((match) =>
		Number(match[1])
	);
}

function videoStart({ file }: { file: string }): number {
	const result = spawnSync(
		ffprobePath,
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=start_time",
			"-of",
			"csv=p=0",
			file,
		],
		{ encoding: "utf8" }
	);
	return Number(result.stdout.trim().replace(/,.*$/, ""));
}

/**
 * Two encoded segments, each with a white frame and a click one second in,
 * concatenated the way the export does: picture and sound must sit at 1.0 s
 * and 3.0 s afterwards, not 21 ms late, and still after a video re-encode
 * pass with the sound copied.
 */
describe.skipIf(!fs.existsSync(ffmpegPath))(
	"export concat timing (real ffmpeg)",
	() => {
		const sourcePath = path.join(tempDir, "flash-click.mp4");
		const segmentPath = path.join(tempDir, "segment-0000.mp4");
		const concatPath = path.join(tempDir, "concat.mp4");
		const passPath = path.join(tempDir, "pass.mp4");

		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
			run([
				"-y",
				"-f",
				"lavfi",
				"-i",
				"color=c=black:s=320x180:r=30:d=2,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,30)'",
				"-f",
				"lavfi",
				"-i",
				"aevalsrc=0.9*sin(2*PI*1000*t)*between(t\\,1.0\\,1.01):s=48000:d=2",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				"-c:a",
				"aac",
				"-shortest",
				sourcePath,
			]);
		}, 60_000);

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		it("keeps picture and sound on the timeline through the concat and a re-encode pass", async () => {
			const segment: ExportSegment = {
				elementId: "clip",
				trackId: "main",
				trackOrder: 0,
				elementOrder: 0,
				sourcePath,
				startTime: 0,
				duration: 2,
				trimStart: 0,
				sourceId: "clip",
				fitMode: "cover",
			};
			run(
				buildExportSegmentEncodeArgs({
					inputArgs: buildExportSegmentInputArgs({ segment }),
					scaleFilter: "scale=320:180,setsar=1",
					segment,
					settings: { fps: 30, codec: "libx264", bitrate: "1000k" },
					outputPath: segmentPath,
				})
			);
			expect(videoStart({ file: segmentPath })).toBe(0);

			const lead = await probeLeadingAudioTime({ file: segmentPath });
			// AAC priming: 1024 samples at 48 kHz, kept as an edit list.
			expect(lead).toBeCloseTo(-1024 / 48_000, 4);

			const listPath = path.join(tempDir, "concat-list.txt");
			fs.writeFileSync(
				listPath,
				[segmentPath, segmentPath].map((file) => `file '${file}'`).join("\n")
			);
			run(
				buildConcatCopyArgs({
					listPath,
					outputPath: concatPath,
					leadSeconds: lead,
				})
			);
			expect(videoStart({ file: concatPath })).toBe(0);
			expect(flashTimes({ file: concatPath })).toEqual([1, 3]);
			const concatClicks = clickTimes({ file: concatPath }).slice(0, 2);
			expect(concatClicks).toHaveLength(2);
			expect(Math.abs(concatClicks[0] - 1)).toBeLessThan(0.002);
			expect(Math.abs(concatClicks[1] - 3)).toBeLessThan(0.002);

			// The text, sticker and adjustment passes re-encode the picture and
			// copy the sound; neither may slip against the other.
			run([
				"-y",
				"-i",
				concatPath,
				"-vf",
				"null",
				"-c:v",
				"libx264",
				"-preset",
				"medium",
				"-b:v",
				"1000k",
				"-pix_fmt",
				"yuv420p",
				"-c:a",
				"copy",
				"-movflags",
				"+faststart",
				passPath,
			]);
			expect(videoStart({ file: passPath })).toBe(0);
			expect(flashTimes({ file: passPath })).toEqual([1, 3]);
			const passClicks = clickTimes({ file: passPath }).slice(0, 2);
			expect(Math.abs(passClicks[0] - 1)).toBeLessThan(0.002);
			expect(Math.abs(passClicks[1] - 3)).toBeLessThan(0.002);
		}, 120_000);
	}
);
