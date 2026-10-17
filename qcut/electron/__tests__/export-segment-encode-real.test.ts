import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	buildExportSegmentEncodeArgs,
	buildExportSegmentInputArgs,
} from "../claude/handlers/claude-export-handler/export-segment-encode";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types";

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const ffprobePath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffprobe"
);
const tempDir = path.resolve(
	__dirname,
	"../../.tmp/export-segment-encode-test"
);

function probe({ file, stream }: { file: string; stream: "v" | "a" }): {
	duration: number;
	frames: number;
	codec: string;
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
			"stream=duration,nb_read_frames,codec_name,sample_rate,channels",
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
			codec_name: string;
			sample_rate?: string;
			channels?: number;
		}>;
	};
	const [first] = parsed.streams;
	return {
		duration: Number(first.duration),
		frames: Number(first.nb_read_frames),
		codec: first.codec_name,
		sampleRate: Number(first.sample_rate ?? 0),
		channels: Number(first.channels ?? 0),
	};
}

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"export segment encode (real ffmpeg)",
	() => {
		const sourcePath = path.join(tempDir, "short-audio.mp4");

		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
			// One second of picture at 24 fps whose sound stops 60 ms early, the
			// shape AAC sources on a timeline often have.
			const made = spawnSync(
				ffmpegPath,
				[
					"-y",
					"-f",
					"lavfi",
					"-i",
					"color=c=red:s=64x64:r=24:d=1",
					"-f",
					"lavfi",
					"-i",
					"sine=frequency=440:sample_rate=48000:duration=0.94",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					"-c:a",
					"aac",
					sourcePath,
				],
				{ encoding: "utf8", timeout: 60_000 }
			);
			expect(made.status, made.stderr).toBe(0);
		});

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		function encodeSegment({
			duration,
			name,
		}: {
			duration: number;
			name: string;
		}) {
			const segment: ExportSegment = {
				elementId: "clip-1",
				trackId: "track-1",
				trackOrder: 0,
				elementOrder: 0,
				sourcePath,
				startTime: 0,
				duration,
				trimStart: 0,
				sourceId: "media-1",
				fitMode: "cover",
			};
			const outputPath = path.join(tempDir, name);
			const args = buildExportSegmentEncodeArgs({
				inputArgs: buildExportSegmentInputArgs({ segment }),
				scaleFilter: "scale=64:64",
				segment,
				settings: { fps: 24, codec: "libx264", bitrate: "1M" },
				audio: { kind: "input" },
				outputPath,
			});
			const encoded = spawnSync(ffmpegPath, args, {
				encoding: "utf8",
				timeout: 60_000,
			});
			expect(encoded.status, encoded.stderr).toBe(0);
			return {
				video: probe({ file: outputPath, stream: "v" }),
				audio: probe({ file: outputPath, stream: "a" }),
			};
		}

		it("keeps every frame of a segment whose audio is shorter than its picture", () => {
			const { video, audio } = encodeSegment({
				duration: 1,
				name: "segment.mov",
			});
			expect(video.frames).toBe(24);
			expect(video.duration).toBeCloseTo(1, 2);
			// PCM in the export's format, padded to exactly the segment.
			expect(audio).toMatchObject({
				codec: "pcm_f32le",
				sampleRate: 48_000,
				channels: 2,
			});
			expect(audio.duration).toBeCloseTo(1, 4);
		});

		it("fills a segment longer than its source by holding the last frame", () => {
			const { video, audio } = encodeSegment({
				duration: 1.5,
				name: "segment-long.mov",
			});
			expect(video.frames).toBe(36);
			expect(video.duration).toBeCloseTo(1.5, 2);
			expect(audio.duration).toBeCloseTo(1.5, 4);
		});

		it("keeps the last frame of an untrimmed clip whose 32 kHz sound outlasts its picture", () => {
			// 49 frames at 24 fps is 2.041667 s; 32 kHz AAC frames are 32 ms, so
			// the sound cut at that length ends at 2.016 s, before the last frame.
			// `-shortest` used to let the sync queue drop that frame.
			const source = path.join(tempDir, "source-32k.mp4");
			const made = spawnSync(
				ffmpegPath,
				[
					"-y",
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"testsrc2=s=64x64:r=24",
					"-f",
					"lavfi",
					"-i",
					"sine=frequency=440:sample_rate=32000",
					"-frames:v",
					"49",
					"-t",
					"2.1",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					"-c:a",
					"aac",
					source,
				],
				{ encoding: "utf8", timeout: 60_000 }
			);
			expect(made.status, made.stderr).toBe(0);
			const segment: ExportSegment = {
				elementId: "clip-2",
				trackId: "track-1",
				trackOrder: 0,
				elementOrder: 1,
				sourcePath: source,
				startTime: 0,
				duration: 49 / 24,
				trimStart: 0,
				sourceId: "media-2",
				fitMode: "cover",
			};
			const outputPath = path.join(tempDir, "segment-32k.mov");
			const encoded = spawnSync(
				ffmpegPath,
				buildExportSegmentEncodeArgs({
					inputArgs: buildExportSegmentInputArgs({ segment }),
					scaleFilter: "scale=64:64",
					segment,
					settings: { fps: 24, codec: "libx264", bitrate: "1M" },
					audio: { kind: "input" },
					outputPath,
				}),
				{ encoding: "utf8", timeout: 60_000 }
			);
			expect(encoded.status, encoded.stderr).toBe(0);
			expect(probe({ file: outputPath, stream: "v" }).frames).toBe(49);
			expect(probe({ file: outputPath, stream: "a" }).duration).toBeCloseTo(
				49 / 24,
				4
			);
		});

		it("gives a picture exactly its length of silence in the export's format", () => {
			const still = path.join(tempDir, "still.png");
			const made = spawnSync(
				ffmpegPath,
				[
					"-y",
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=c=green:s=64x64",
					"-frames:v",
					"1",
					still,
				],
				{ encoding: "utf8", timeout: 60_000 }
			);
			expect(made.status, made.stderr).toBe(0);
			const segment: ExportSegment = {
				elementId: "still",
				trackId: "track-1",
				trackOrder: 0,
				elementOrder: 2,
				sourcePath: still,
				startTime: 0,
				duration: 1.25,
				trimStart: 0,
				sourceId: "media-3",
				fitMode: "cover",
				isImage: true,
			};
			const outputPath = path.join(tempDir, "segment-still.mov");
			const encoded = spawnSync(
				ffmpegPath,
				buildExportSegmentEncodeArgs({
					inputArgs: buildExportSegmentInputArgs({ segment }),
					scaleFilter: "scale=64:64",
					segment,
					settings: {
						fps: 24,
						codec: "libx264",
						bitrate: "1M",
						audioSampleRate: 44_100,
						audioChannels: 1,
					},
					audio: null,
					outputPath,
				}),
				{ encoding: "utf8", timeout: 60_000 }
			);
			expect(encoded.status, encoded.stderr).toBe(0);
			expect(probe({ file: outputPath, stream: "v" }).frames).toBe(30);
			expect(probe({ file: outputPath, stream: "a" })).toMatchObject({
				codec: "pcm_f32le",
				sampleRate: 44_100,
				channels: 1,
			});
			expect(probe({ file: outputPath, stream: "a" }).duration).toBeCloseTo(
				1.25,
				4
			);
		});
	}
);
