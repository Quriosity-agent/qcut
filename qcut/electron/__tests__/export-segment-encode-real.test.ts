import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	buildExportSegmentEncodeArgs,
	buildExportSegmentInputArgs,
} from "../claude/handlers/claude-export-handler/export-segment-encode";
import { segmentAudioFields } from "../claude/handlers/claude-export-handler/timeline-audio-file";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types";
import type { ClaudeElement } from "../types/claude-api";

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

		// N16 (2026-10-28 trailer report): a main-track clip's own volume, mute
		// and volume keyframes did not change the exported sound at all.
		describe("a joined clip's own sound", () => {
			const tone = path.join(tempDir, "tone-2s.mp4");

			/** RMS of the segment's sound between `from` and `to` seconds. */
			function rms({
				file,
				from,
				to,
			}: {
				file: string;
				from: number;
				to: number;
			}): number {
				const decoded = spawnSync(
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
						"48000",
						"-f",
						"f32le",
						"-",
					],
					{ maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }
				);
				expect(decoded.status, decoded.stderr?.toString()).toBe(0);
				const samples = new Float32Array(
					decoded.stdout.buffer,
					decoded.stdout.byteOffset,
					decoded.stdout.byteLength / 4
				);
				let sum = 0;
				let count = 0;
				for (
					let index = Math.round(from * 48_000);
					index < to * 48_000;
					index++
				) {
					sum += samples[index] ** 2;
					count++;
				}
				return Math.sqrt(sum / count);
			}

			function encodeWithAudio({
				audio,
				name,
			}: {
				audio: Record<string, unknown>;
				name: string;
			}): string {
				if (!fs.existsSync(tone)) {
					const made = spawnSync(
						ffmpegPath,
						[
							"-y",
							"-v",
							"error",
							"-f",
							"lavfi",
							"-i",
							"color=c=blue:s=64x64:r=24:d=2",
							"-f",
							"lavfi",
							"-i",
							"sine=frequency=440:sample_rate=48000:duration=2",
							"-c:v",
							"libx264",
							"-pix_fmt",
							"yuv420p",
							"-c:a",
							"aac",
							tone,
						],
						{ encoding: "utf8", timeout: 60_000 }
					);
					expect(made.status, made.stderr).toBe(0);
				}
				const segment: ExportSegment = {
					elementId: "clip-sound",
					trackId: "main",
					trackOrder: 0,
					elementOrder: 0,
					sourcePath: tone,
					startTime: 0,
					duration: 2,
					trimStart: 0,
					sourceId: "media-tone",
					fitMode: "cover",
					...segmentAudioFields({
						element: { id: "clip-sound", audio } as unknown as ClaudeElement,
						duration: 2,
						fps: 24,
					}),
				};
				const outputPath = path.join(tempDir, name);
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
				return outputPath;
			}

			const settings = (overrides: Record<string, unknown>) => ({
				enabled: true,
				volumeDb: 0,
				fadeIn: 0,
				fadeOut: 0,
				panEnabled: false,
				pan: 0,
				loudness: {
					enabled: false,
					targetLufs: -16,
					truePeakDb: -1.5,
					loudnessRange: 11,
				},
				denoise: { enabled: false, amount: 0, noiseFloorDb: -50 },
				voiceEnhance: { enabled: false, clarity: 0, warmth: 0, presence: 0 },
				pitch: { enabled: false, semitones: 0, preserveFormants: true },
				equalizer: {
					enabled: false,
					lowGainDb: 0,
					midGainDb: 0,
					highGainDb: 0,
				},
				compressor: {
					enabled: false,
					thresholdDb: -18,
					ratio: 3,
					attackMs: 10,
					releaseMs: 120,
					makeupGainDb: 0,
				},
				limiter: { enabled: false, ceilingDb: -1, releaseMs: 50 },
				reverb: { enabled: false, mix: 20, roomSize: 40, damping: 50 },
				echo: { enabled: false, mix: 15, delayMs: 220, feedback: 25 },
				telephone: { enabled: false, mix: 100 },
				...overrides,
			});

			// The source tone is 440 Hz at FFmpeg's default 1/8 amplitude: RMS 0.088.
			it("silences a disabled clip", () => {
				const loud = encodeWithAudio({ audio: settings({}), name: "tone.mov" });
				const muted = encodeWithAudio({
					audio: settings({ enabled: false, volumeDb: -60 }),
					name: "tone-muted.mov",
				});
				expect(rms({ file: loud, from: 0.2, to: 1.8 })).toBeGreaterThan(0.05);
				expect(rms({ file: muted, from: 0, to: 2 })).toBeLessThan(1e-4);
			});

			it("mutes only where the volume keyframes say", () => {
				// -60 dB (silence) for the first second (24 frames), then 0 dB.
				const keyed = encodeWithAudio({
					audio: settings({
						keyframes: {
							volumeDb: [
								{ id: "a", frame: 0, value: -60, easing: "linear" },
								{ id: "b", frame: 24, value: -60, easing: "linear" },
								{ id: "c", frame: 25, value: 0, easing: "linear" },
							],
						},
					}),
					name: "tone-keyed.mov",
				});
				expect(rms({ file: keyed, from: 0.05, to: 0.95 })).toBeLessThan(1e-4);
				expect(rms({ file: keyed, from: 1.2, to: 1.9 })).toBeGreaterThan(0.05);
			});
		});
	}
);
