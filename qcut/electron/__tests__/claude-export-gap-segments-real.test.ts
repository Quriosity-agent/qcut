import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSegmentConcatArgs } from "../claude/handlers/claude-export-handler/concat-timing";
import {
	buildExportSegmentEncodeArgs,
	buildExportSegmentInputArgs,
} from "../claude/handlers/claude-export-handler/export-segment-encode";
import {
	buildGapSegmentEncodeArgs,
	findTimelineGaps,
	orderConcatInputs,
} from "../claude/handlers/claude-export-handler/gap-segments";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types";

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const ffprobePath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffprobe"
);
const tempDir = path.resolve(__dirname, "../../.tmp/export-gap-segments-test");

function run(args: string[]) {
	const result = spawnSync(ffmpegPath, ["-v", "error", ...args], {
		encoding: "utf8",
	});
	expect(result.status, result.stderr).toBe(0);
}

function probeStream({ file, stream }: { file: string; stream: "v" | "a" }): {
	duration: number;
	frames: number;
	sampleRate: number;
	channels: number;
} {
	const result = spawnSync(
		ffprobePath,
		[
			"-v",
			"error",
			"-select_streams",
			`${stream}:0`,
			"-count_frames",
			"-show_entries",
			"stream=duration,nb_read_frames,sample_rate,channels",
			"-of",
			"json",
			file,
		],
		{ encoding: "utf8" }
	);
	const parsed = JSON.parse(result.stdout) as {
		streams: Array<{
			duration: string;
			nb_read_frames: string;
			sample_rate?: string;
			channels?: number;
		}>;
	};
	const [first] = parsed.streams;
	return {
		duration: Number(first.duration),
		frames: Number(first.nb_read_frames),
		sampleRate: Number(first.sample_rate ?? 0),
		channels: Number(first.channels ?? 0),
	};
}

/** Mean RGB of the frame at `time`, from a 1×1 downscale. */
function meanRgb({ file, time }: { file: string; time: number }) {
	const result = spawnSync(ffmpegPath, [
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
	]);
	expect(result.status, result.stderr?.toString()).toBe(0);
	const [r, g, b] = result.stdout;
	return { r, g, b };
}

/** Loudness (RMS) of the decoded sound between `from` and `to` seconds. */
function rms({ file, from, to }: { file: string; from: number; to: number }) {
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
	expect(result.status, result.stderr?.toString()).toBe(0);
	const bytes = result.stdout as Buffer;
	const samples = new Float32Array(
		bytes.buffer,
		bytes.byteOffset,
		Math.floor(bytes.byteLength / 4)
	).subarray(Math.round(from * rate), Math.round(to * rate));
	let sum = 0;
	for (const sample of samples) sum += sample * sample;
	return Math.sqrt(sum / Math.max(1, samples.length));
}

/**
 * A clip that starts half a second into the timeline: the gap before it must
 * come out as black and silence in the segments' own PCM format, so the
 * concat keeps the timeline's timing for both picture and sound.
 */
describe.skipIf(!fs.existsSync(ffmpegPath))(
	"export gap segments (real ffmpeg)",
	() => {
		const sourcePath = path.join(tempDir, "red-mono-44k.mp4");
		const segmentPath = path.join(tempDir, "segment-0000.mov");
		const gapPath = path.join(tempDir, "gap-0000.mov");
		const concatPath = path.join(tempDir, "concat.mp4");
		const settings = {
			width: 64,
			height: 64,
			fps: 24,
			codec: "libx264",
			bitrate: "1000k",
		};

		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
			run([
				"-y",
				"-f",
				"lavfi",
				"-i",
				"color=c=red:s=64x64:r=24:d=1",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=440:sample_rate=44100:duration=1",
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

		it("fills the gap with black and silence the clip's sound joins without moving", () => {
			const segment: ExportSegment = {
				elementId: "clip",
				trackId: "main",
				trackOrder: 0,
				elementOrder: 0,
				sourcePath,
				startTime: 0.5,
				duration: 1,
				trimStart: 0,
				sourceId: "clip",
				fitMode: "cover",
			};
			run(
				buildExportSegmentEncodeArgs({
					inputArgs: buildExportSegmentInputArgs({ segment }),
					scaleFilter: "scale=64:64,setsar=1",
					segment,
					settings,
					audio: { kind: "input" },
					outputPath: segmentPath,
				})
			);
			const gaps = findTimelineGaps({ segments: [segment], fps: 24 });
			expect(gaps).toEqual([{ beforeSegment: 0, startTime: 0, duration: 0.5 }]);

			run(
				buildGapSegmentEncodeArgs({
					gap: gaps[0],
					settings,
					outputPath: gapPath,
				})
			);

			const listPath = path.join(tempDir, "concat-list.txt");
			fs.writeFileSync(
				listPath,
				orderConcatInputs({
					segmentOutputs: [segmentPath],
					gaps,
					gapOutputs: [gapPath],
				})
					.map((file) => `file '${file}'`)
					.join("\n")
			);
			run(
				buildSegmentConcatArgs({
					listPath,
					outputPath: concatPath,
					audio: { sampleRate: 48_000, channels: 2 },
					audioBitrateKbps: 192,
				})
			);

			const video = probeStream({ file: concatPath, stream: "v" });
			expect(video.frames).toBe(36);
			expect(Math.abs(video.duration - 1.5)).toBeLessThan(0.05);
			// The 44.1 kHz mono source comes out in the export's format.
			const sound = probeStream({ file: concatPath, stream: "a" });
			expect(sound.sampleRate).toBe(48_000);
			expect(sound.channels).toBe(2);
			expect(Math.abs(sound.duration - 1.5)).toBeLessThan(0.03);
			// Silence in the gap, the clip's tone (FFmpeg's sine is 1/8 full
			// scale: RMS 0.088) from 0.5 s on.
			expect(rms({ file: concatPath, from: 0, to: 0.48 })).toBeLessThan(0.001);
			expect(rms({ file: concatPath, from: 0.52, to: 1.45 })).toBeGreaterThan(
				0.05
			);

			const inGap = meanRgb({ file: concatPath, time: 0.25 });
			expect(Math.max(inGap.r, inGap.g, inGap.b)).toBeLessThan(20);
			const inClip = meanRgb({ file: concatPath, time: 1.0 });
			expect(inClip.r).toBeGreaterThan(200);
			expect(inClip.g).toBeLessThan(40);
		}, 60_000);
	}
);
