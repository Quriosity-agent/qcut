import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	buildConcatLists,
	buildSegmentConcatArgs,
	firstFrameDelay,
	planConcatSpans,
} from "../claude/handlers/claude-export-handler/concat-timing";
import {
	buildExportSegmentEncodeArgs,
	buildExportSegmentInputArgs,
	planSegmentPictureRead,
} from "../claude/handlers/claude-export-handler/export-segment-encode";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types";

/**
 * Which source frame each frame of a segment shows, and where its sound
 * starts, when the clip's in-point lies between two source frames: the
 * right half of a cut made by time, a clip whose edge `timeline snap --to
 * frames` moved, a 30 fps file on a 24 fps timeline.
 *
 * FFmpeg drops the frame on screen at a seek point (it started before it).
 * The segment then began on the next source frame, and when that frame came
 * less than half an output frame late the file was also written one frame
 * longer than its span.
 */

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const tempDir = path.resolve(
	__dirname,
	"../../.tmp/export-segment-in-point-test"
);
const FPS = 24;
const RATE = 48_000;
/** Source second of the one click in each source's sound. */
const CLICK_AT = 2;
/** The colour ramp: frame n is a flat colour that holds n. */
const RAMP = { redBase: 40, cycle: 20, step: 12, redStep: 8 };

/** A source whose frame n shows n, with PCM sound: silence and one click. */
function makeSource({ file, fps }: { file: string; fps: number }): void {
	const geq =
		`geq=r='${RAMP.redBase}+floor(N/${RAMP.cycle})*${RAMP.redStep}'` +
		`:g='mod(N\\,${RAMP.cycle})*${RAMP.step}'` +
		`:b='234-mod(N\\,${RAMP.cycle})*${RAMP.step}'`;
	const made = spawnSync(
		ffmpegPath,
		[
			"-y",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`color=c=black:s=160x90:r=${fps}:d=6,format=rgb24,${geq}`,
			"-f",
			"lavfi",
			"-i",
			`aevalsrc=0.8*sin(2*PI*1000*t)*between(t\\,${CLICK_AT}\\,${CLICK_AT + 0.01}):s=${RATE}:c=stereo:d=6`,
			"-vf",
			"scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
			"-c:v",
			"libx264",
			"-crf",
			"12",
			"-g",
			"48",
			"-c:a",
			"pcm_s16le",
			file,
		],
		{ encoding: "utf8", timeout: 60_000 }
	);
	expect(made.status, made.stderr).toBe(0);
}

/** The source frame each frame of `file` shows, from its mean colour. */
function shownFrames({ file }: { file: string }): number[] {
	const result = spawnSync(
		ffmpegPath,
		[
			"-v",
			"error",
			"-i",
			file,
			"-vf",
			"scale=16:9:flags=area",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
	if (result.status !== 0) throw new Error(result.stderr.toString());
	const frameBytes = 16 * 9 * 3;
	const pixels = frameBytes / 3;
	const frames: number[] = [];
	for (
		let offset = 0;
		offset + frameBytes <= result.stdout.length;
		offset += frameBytes
	) {
		let r = 0;
		let g = 0;
		let b = 0;
		for (let pixel = offset; pixel < offset + frameBytes; pixel += 3) {
			r += result.stdout[pixel];
			g += result.stdout[pixel + 1];
			b += result.stdout[pixel + 2];
		}
		const phase = Math.round((g / pixels + 234 - b / pixels) / (2 * RAMP.step));
		const cycle = Math.round((r / pixels - RAMP.redBase) / RAMP.redStep);
		frames.push(cycle * RAMP.cycle + (phase % RAMP.cycle));
	}
	return frames;
}

/** The sample at which the file's sound first rises above a quarter scale. */
function firstLoudSample({ file }: { file: string }): number {
	const result = spawnSync(
		ffmpegPath,
		["-v", "error", "-i", file, "-vn", "-ac", "1", "-f", "f32le", "-"],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
	if (result.status !== 0) throw new Error(result.stderr.toString());
	const bytes = result.stdout;
	const samples = new Float32Array(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
	);
	return samples.findIndex((sample) => Math.abs(sample) > 0.25);
}

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"a segment whose in-point is between source frames (real ffmpeg)",
	() => {
		const source24 = path.join(tempDir, "ramp-24.mov");
		const source30 = path.join(tempDir, "ramp-30.mov");

		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
			makeSource({ file: source24, fps: 24 });
			makeSource({ file: source30, fps: 30 });
		});

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		function encode({
			name,
			sourcePath = source24,
			trimStart,
			frames,
			firstFrameDelay = 0,
			playbackRate,
		}: {
			name: string;
			sourcePath?: string;
			trimStart: number;
			frames: number;
			firstFrameDelay?: number;
			playbackRate?: number;
		}): { shown: number[]; click: number } {
			const segment: ExportSegment = {
				elementId: "clip-1",
				trackId: "track-1",
				trackOrder: 0,
				elementOrder: 0,
				sourcePath,
				startTime: 0,
				duration: frames / FPS,
				trimStart,
				sourceId: "media-1",
				fitMode: "cover",
				...(playbackRate ? { playbackRate } : {}),
			};
			const read = planSegmentPictureRead({ segment, firstFrameDelay });
			const outputPath = path.join(tempDir, name);
			const encoded = spawnSync(
				ffmpegPath,
				buildExportSegmentEncodeArgs({
					inputArgs: buildExportSegmentInputArgs({ segment, read }),
					scaleFilter: "scale=160:90",
					segment,
					settings: { fps: FPS, codec: "libx264", bitrate: "2M" },
					audio: { kind: "input" },
					outputPath,
					read,
					span: { frames, samples: (frames * RATE) / FPS },
				}),
				{ encoding: "utf8", timeout: 60_000 }
			);
			expect(encoded.status, encoded.stderr).toBe(0);
			return {
				shown: shownFrames({ file: outputPath }),
				click: firstLoudSample({ file: outputPath }),
			};
		}

		const run = (from: number, count: number, step = 1) =>
			Array.from({ length: count }, (_unused, index) => from + index * step);

		it.each([
			{ phase: 0, name: "on a source frame" },
			{ phase: 0.2, name: "a fifth of a frame into one" },
			{ phase: 0.5, name: "half a frame into one" },
			{ phase: 0.8, name: "four fifths of a frame into one" },
		])("starts on the frame on screen at an in-point $name", ({ phase }) => {
			const trimStart = (36 + phase) / FPS;
			const { shown, click } = encode({
				name: `phase-${phase}.mov`,
				trimStart,
				frames: 30,
			});
			// Exactly the span's frames, each the one on screen at its time:
			// frame 36 is still showing until frame 37 starts.
			expect(shown).toEqual(run(36, 30));
			// The sound starts at the in-point itself, to the sample.
			const expected = Math.round((CLICK_AT - trimStart) * RATE);
			expect(Math.abs(click - expected)).toBeLessThanOrEqual(2);
		});

		it("reads from where the clip's first output frame falls when the clip starts between frames", () => {
			// The clip starts 0.6 of a frame before its first output frame, so
			// that frame shows source time 36.5 + 0.6 frames: frame 37.
			const trimStart = 36.5 / FPS;
			const { shown, click } = encode({
				name: "delayed.mov",
				trimStart,
				frames: 30,
				firstFrameDelay: 0.6 / FPS,
			});
			expect(shown).toEqual(run(37, 30));
			// The sound is not delayed with the picture: it is placed by its
			// samples, from the in-point.
			const expected = Math.round((CLICK_AT - trimStart) * RATE);
			expect(Math.abs(click - expected)).toBeLessThanOrEqual(2);
		});

		it("shows a 30 fps source on a 24 fps timeline frame by frame", () => {
			const trimStart = 1.51;
			const { shown } = encode({
				name: "thirty.mov",
				sourcePath: source30,
				trimStart,
				frames: 24,
			});
			// Output frame k is at source time 1.51 + k/24 (+1 ms, the edge
			// rule): the 30 fps frame on screen then.
			const expected = Array.from({ length: 24 }, (_unused, index) =>
				Math.floor((trimStart + index / FPS + 0.001) * 30 + 1e-9)
			);
			expect(shown).toEqual(expected);
		});

		it("keeps the frame rule for a clip played at twice its speed", () => {
			const { shown } = encode({
				name: "double.mov",
				trimStart: 36.5 / FPS,
				frames: 20,
				playbackRate: 2,
			});
			// Output frame k is at source time 36.5 + 2k frames.
			expect(shown).toEqual(run(36, 20, 2));
		});

		/**
		 * Clips cut and joined the way the engine does it: each read from where
		 * its first frame falls, cut to its span, and the picture and the sound
		 * joined from their own lists.
		 */
		function joinClips({
			name,
			clips,
		}: {
			name: string;
			clips: Array<{ startTime: number; endTime: number; trimStart: number }>;
		}): { shown: number[]; click: number } {
			const segments: ExportSegment[] = clips.map((clip, index) => ({
				elementId: `clip-${index}`,
				trackId: "main",
				trackOrder: 0,
				elementOrder: index,
				sourcePath: source24,
				startTime: clip.startTime,
				duration: clip.endTime - clip.startTime,
				trimStart: clip.trimStart,
				sourceId: "media-1",
				fitMode: "cover",
			}));
			const spans = planConcatSpans({
				inputs: clips,
				fps: FPS,
				sampleRate: RATE,
			});
			const files = segments.map((segment, index) => {
				const span = spans[index];
				const read = planSegmentPictureRead({
					segment,
					firstFrameDelay: firstFrameDelay({
						span,
						startTime: segment.startTime,
						fps: FPS,
					}),
				});
				const outputPath = path.join(tempDir, `${name}-${index}.mov`);
				const encoded = spawnSync(
					ffmpegPath,
					buildExportSegmentEncodeArgs({
						inputArgs: buildExportSegmentInputArgs({ segment, read }),
						scaleFilter: "scale=160:90",
						segment,
						settings: { fps: FPS, codec: "libx264", bitrate: "2M" },
						audio: { kind: "input" },
						outputPath,
						span,
						read,
					}),
					{ encoding: "utf8", timeout: 60_000 }
				);
				expect(encoded.status, encoded.stderr).toBe(0);
				return { path: outputPath, span };
			});
			const lists = buildConcatLists({ files, fps: FPS, sampleRate: RATE });
			const videoListPath = path.join(tempDir, `${name}-video-list.txt`);
			const audioListPath = path.join(tempDir, `${name}-audio-list.txt`);
			fs.writeFileSync(videoListPath, lists.video);
			fs.writeFileSync(audioListPath, lists.audio);
			const joinedPath = path.join(tempDir, `${name}.mp4`);
			const joined = spawnSync(
				ffmpegPath,
				[
					"-v",
					"error",
					...buildSegmentConcatArgs({
						videoListPath,
						audioListPath,
						outputPath: joinedPath,
						audio: { sampleRate: RATE, channels: 2 },
						audioBitrateKbps: 192,
					}),
				],
				{ encoding: "utf8", timeout: 60_000 }
			);
			expect(joined.status, joined.stderr).toBe(0);
			return {
				shown: shownFrames({ file: joinedPath }),
				click: firstLoudSample({ file: joinedPath }),
			};
		}

		it("joins a clip split at times between frames into the picture it was", () => {
			// Splits leave every part reading the source at its own timeline
			// time, so the joined picture is the source, frame for frame. The
			// fifth cut is a third of a millisecond past frame 72.
			const cuts = [0, 19.5 / FPS, 1.425333, 2.11, 3.0004, 3.7, 4.5];
			const { shown, click } = joinClips({
				name: "split",
				clips: cuts.slice(0, -1).map((startTime, index) => ({
					startTime,
					endTime: cuts[index + 1],
					trimStart: startTime,
				})),
			});
			expect(shown).toEqual(run(0, 108));
			// The click stays at its second (AAC, so to within a millisecond).
			expect(Math.abs(click - CLICK_AT * RATE)).toBeLessThan(RATE / 1000);
		});

		it("keeps picture and sound together after a ripple delete between frames", () => {
			// Source 1.2–1.7 s is gone: the second clip starts at 1.2 s, between
			// frames 28 and 29, reading the source from 1.7 s.
			const { shown, click } = joinClips({
				name: "ripple",
				clips: [
					{ startTime: 0, endTime: 1.2, trimStart: 0 },
					{ startTime: 1.2, endTime: 2.5, trimStart: 1.7 },
				],
			});
			// Frame 29 is the first at or after 1.2 s; it shows the source half
			// a second on: frame 29 + 12.
			expect(shown).toEqual([...run(0, 29), ...run(41, 31)]);
			expect(Math.abs(click - (CLICK_AT - 0.5) * RATE)).toBeLessThan(
				RATE / 1000
			);
		});

		it("reads from the file's start when the in-point is nearer than the lead", () => {
			const trimStart = 2.4 / FPS;
			const { shown, click } = encode({
				name: "near-start.mov",
				trimStart,
				frames: 60,
			});
			expect(shown).toEqual(run(2, 60));
			const expected = Math.round((CLICK_AT - trimStart) * RATE);
			expect(Math.abs(click - expected)).toBeLessThanOrEqual(2);
		});
	}
);
