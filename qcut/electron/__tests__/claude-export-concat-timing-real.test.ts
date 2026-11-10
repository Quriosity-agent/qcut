import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	buildConcatLists,
	buildSegmentConcatArgs,
	concatSpan,
	planConcatSpans,
} from "../claude/handlers/claude-export-handler/concat-timing.js";
import {
	buildExportSegmentEncodeArgs,
	buildExportSegmentInputArgs,
} from "../claude/handlers/claude-export-handler/export-segment-encode.js";
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

/**
 * Where sound starts after each silence (the clicks), counted in decoded
 * samples the way a player plays them, not by packet timestamps.
 */
function clickTimes({ file }: { file: string }): number[] {
	const rate = 48_000;
	const result = spawnSync(
		ffmpegPath,
		[
			"-v",
			"error",
			"-i",
			file,
			"-vn",
			"-ac",
			"1",
			"-ar",
			String(rate),
			"-f",
			"f32le",
			"-",
		],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
	const bytes = result.stdout as unknown as Buffer;
	const samples = new Float32Array(
		bytes.buffer,
		bytes.byteOffset,
		Math.floor(bytes.byteLength / 4)
	);
	const times: number[] = [];
	let quiet = 0;
	for (const [index, sample] of samples.entries()) {
		if (Math.abs(sample) > 0.3) {
			if (quiet > 0.05 * rate) times.push(index / rate);
			quiet = 0;
		} else quiet += 1;
	}
	return times;
}

/** Each frame's mean luma, in presentation order. */
function frameLumas({ file }: { file: string }): number[] {
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
			"frame_tags=lavfi.signalstats.YAVG",
			"-of",
			"csv=p=0",
		],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
	);
	// A keyframe's line ends in an empty side-data field: "235,".
	return result.stdout
		.trim()
		.split("\n")
		.map((line) => Number(line.split(",")[0]));
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
 * and 3.0 s afterwards, and still after a video re-encode pass with the
 * sound copied. (The first file's AAC priming used to move the whole program
 * 21 ms late, and every later clip another priming frame plus padding.)
 */
describe.skipIf(!fs.existsSync(ffmpegPath))(
	"export concat timing (real ffmpeg)",
	() => {
		const sourcePath = path.join(tempDir, "flash-click.mp4");
		const segmentPath = path.join(tempDir, "segment-0000.mov");
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

		it("keeps picture and sound on the timeline through the concat and a re-encode pass", () => {
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
					audio: { kind: "input" },
					outputPath: segmentPath,
				})
			);
			expect(videoStart({ file: segmentPath })).toBe(0);

			const lists = buildConcatLists({
				files: [0, 2].map((from) => ({
					path: segmentPath,
					span: concatSpan({ from, to: from + 2, fps: 30, sampleRate: 48_000 }),
				})),
				fps: 30,
				sampleRate: 48_000,
			});
			const videoListPath = path.join(tempDir, "concat-video-list.txt");
			const audioListPath = path.join(tempDir, "concat-audio-list.txt");
			fs.writeFileSync(videoListPath, lists.video);
			fs.writeFileSync(audioListPath, lists.audio);
			run(
				buildSegmentConcatArgs({
					videoListPath,
					audioListPath,
					outputPath: concatPath,
					audio: { sampleRate: 48_000, channels: 2 },
					audioBitrateKbps: 192,
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

		/**
		 * Six clips 24.4 frames long, as a ripple delete on bar lines leaves
		 * them, alternating white and black with a click at each one's start.
		 * Every clip used to be rounded up to 25 frames on its own, so the
		 * pictures of later clips came 1, 2, 3 frames late while their sound
		 * stayed on the timeline.
		 */
		it("puts every cut on the frame the timeline has it on when clips are not whole frames long", () => {
			const clipSeconds = 61 / 60;
			const sources = ["white", "black"].map((colour) => {
				const file = path.join(tempDir, `${colour}-click.mp4`);
				run([
					"-y",
					"-f",
					"lavfi",
					"-i",
					`color=c=${colour}:s=160x90:r=30:d=2`,
					"-f",
					"lavfi",
					"-i",
					"aevalsrc=0.9*sin(2*PI*1000*t)*between(t\\,0\\,0.01):s=48000:d=2",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					"-c:a",
					"aac",
					"-shortest",
					file,
				]);
				return file;
			});
			const segments: ExportSegment[] = Array.from(
				{ length: 6 },
				(_, index) => ({
					elementId: `clip-${index}`,
					trackId: "main",
					trackOrder: 0,
					elementOrder: index,
					sourcePath: sources[index % 2],
					startTime: index * clipSeconds,
					duration: clipSeconds,
					trimStart: 0,
					sourceId: `clip-${index}`,
					fitMode: "cover",
				})
			);
			const spans = planConcatSpans({
				inputs: segments.map((segment) => ({
					startTime: segment.startTime,
					endTime: segment.startTime + segment.duration,
				})),
				fps: 24,
				sampleRate: 48_000,
			});
			const files = segments.map((segment, index) => {
				const outputPath = path.join(tempDir, `cut-${index}.mov`);
				run(
					buildExportSegmentEncodeArgs({
						inputArgs: buildExportSegmentInputArgs({ segment }),
						scaleFilter: "scale=160:90,setsar=1",
						segment,
						settings: { fps: 24, codec: "libx264", bitrate: "500k" },
						audio: { kind: "input" },
						outputPath,
						span: spans[index],
					})
				);
				return { path: outputPath, span: spans[index] };
			});
			const lists = buildConcatLists({ files, fps: 24, sampleRate: 48_000 });
			const videoListPath = path.join(tempDir, "cuts-video-list.txt");
			const audioListPath = path.join(tempDir, "cuts-audio-list.txt");
			fs.writeFileSync(videoListPath, lists.video);
			fs.writeFileSync(audioListPath, lists.audio);
			const joinedPath = path.join(tempDir, "cuts.mp4");
			run(
				buildSegmentConcatArgs({
					videoListPath,
					audioListPath,
					outputPath: joinedPath,
					audio: { sampleRate: 48_000, channels: 2 },
					audioBitrateKbps: 192,
				})
			);

			const white = frameLumas({ file: joinedPath }).map((luma) => luma > 128);
			const cuts = white.flatMap((isWhite, frame) =>
				frame > 0 && isWhite !== white[frame - 1] ? [frame] : []
			);
			// ceil(24.4 k − 0.024): the frame each clip starts on in the preview.
			expect(cuts).toEqual([25, 49, 74, 98, 122]);
			expect(white).toHaveLength(147);
			// The sound stays on the timeline: each later clip's click is where
			// the clip starts (the first has no silence before it to stand out).
			const clicks = clickTimes({ file: joinedPath });
			expect(clicks).toHaveLength(5);
			for (const [index, click] of clicks.entries()) {
				expect(Math.abs(click - (index + 1) * clipSeconds)).toBeLessThan(0.002);
			}
		}, 120_000);
	}
);
