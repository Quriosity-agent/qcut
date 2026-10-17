import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSegmentConcatArgs } from "../claude/handlers/claude-export-handler/concat-timing.js";
import {
	buildExportSegmentEncodeArgs,
	buildExportSegmentInputArgs,
	createAudioStreamProbe,
	resolveExportSegmentAudio,
} from "../claude/handlers/claude-export-handler/export-segment-encode.js";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types.js";
import { probeHasAudioStream } from "../ffmpeg/probe.js";

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const ffprobePath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffprobe"
);
const tempDir = path.resolve(__dirname, "../../.tmp/export-audio-drift-test");
const MEASURE_RATE = 48_000;
const FPS = 24;

function run(args: string[]) {
	const result = spawnSync(ffmpegPath, ["-v", "error", ...args], {
		encoding: "utf8",
	});
	expect(result.status, result.stderr).toBe(0);
}

function probe(file: string, args: string[]) {
	return spawnSync(
		ffprobePath,
		["-v", "error", ...args, "-of", "default=noprint_wrappers=1:nokey=1", file],
		{ encoding: "utf8" }
	).stdout.trim();
}

/**
 * Where each click starts, read the way a player hears the file: every
 * decoded sample in a row, whatever the packet timestamps say. With
 * `fromContainerStart`, sound that starts late in its file is first moved
 * to where its timestamps put it (how a player syncs it to the picture).
 */
function decodedClickTimes({
	file,
	fromContainerStart = false,
}: {
	file: string;
	fromContainerStart?: boolean;
}): number[] {
	const result = spawnSync(
		ffmpegPath,
		[
			"-v",
			"error",
			"-i",
			file,
			"-vn",
			...(fromContainerStart ? ["-af", "aresample=async=1:first_pts=0"] : []),
			"-ac",
			"1",
			"-ar",
			String(MEASURE_RATE),
			"-f",
			"f32le",
			"-",
		],
		{ maxBuffer: 256 * 1024 * 1024 }
	);
	expect(result.status, result.stderr?.toString()).toBe(0);
	const bytes = result.stdout as Buffer;
	const samples = new Float32Array(
		bytes.buffer,
		bytes.byteOffset,
		Math.floor(bytes.byteLength / 4)
	);
	const times: number[] = [];
	let quiet = 0;
	for (const [index, sample] of samples.entries()) {
		if (Math.abs(sample) > 0.3) {
			if (quiet > 0.05 * MEASURE_RATE) times.push(index / MEASURE_RATE);
			quiet = 0;
		} else quiet += 1;
	}
	return times;
}

/** A 12 s source with 10 ms tone bursts at `clicks`; its sound may start late. */
function makeSource({
	file,
	clicks,
	sampleRate,
	audioDelay = 0,
}: {
	file: string;
	clicks: number[];
	sampleRate: number;
	audioDelay?: number;
}) {
	const bursts = clicks
		.map((time) => `between(t\\,${time}\\,${time + 0.01})`)
		.join("+");
	run([
		"-y",
		"-f",
		"lavfi",
		"-i",
		`color=c=gray:s=320x180:r=${FPS}:d=12`,
		...(audioDelay > 0 ? ["-itsoffset", String(audioDelay)] : []),
		"-f",
		"lavfi",
		"-i",
		`aevalsrc=0.8*sin(2*PI*1000*t)*(${bursts}):s=${sampleRate}:c=stereo:d=12`,
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-ar",
		String(sampleRate),
		file,
	]);
}

interface Cut {
	sourcePath: string;
	trimStart: number;
	frames: number;
	isImage?: boolean;
	playbackRate?: number;
	/** Timeline seconds after the clip's start where its click must sound. */
	click?: number;
}

/**
 * Encodes `cuts` back to back as the native export does, joins them, and
 * returns the joined file with each click's expected timeline time.
 */
async function exportMainTrack({ cuts, name }: { cuts: Cut[]; name: string }) {
	const hasAudioStream = createAudioStreamProbe({ probe: probeHasAudioStream });
	let startTime = 0;
	const files: string[] = [];
	const expected: number[] = [];
	for (const [index, cut] of cuts.entries()) {
		const segment: ExportSegment = {
			elementId: `${name}-${index}`,
			trackId: "main",
			trackOrder: 0,
			elementOrder: index,
			sourcePath: cut.sourcePath,
			startTime,
			duration: cut.frames / FPS,
			trimStart: cut.trimStart,
			sourceId: cut.sourcePath,
			fitMode: "cover",
			...(cut.isImage ? { isImage: true } : {}),
			...(cut.playbackRate ? { playbackRate: cut.playbackRate } : {}),
		};
		const outputPath = path.join(tempDir, `${name}-${index}.mov`);
		run(
			buildExportSegmentEncodeArgs({
				inputArgs: buildExportSegmentInputArgs({ segment }),
				scaleFilter: "scale=320:180,setsar=1",
				segment,
				settings: { fps: FPS, codec: "libx264", bitrate: "800k" },
				audio: await resolveExportSegmentAudio({ segment, hasAudioStream }),
				outputPath,
			})
		);
		files.push(outputPath);
		if (cut.click !== undefined) expected.push(startTime + cut.click);
		startTime += segment.duration;
	}
	const listPath = path.join(tempDir, `${name}-list.txt`);
	fs.writeFileSync(listPath, files.map((file) => `file '${file}'`).join("\n"));
	const joined = path.join(tempDir, `${name}.mp4`);
	run(
		buildSegmentConcatArgs({
			listPath,
			outputPath: joined,
			audio: { sampleRate: 48_000, channels: 2 },
			audioBitrateKbps: 192,
		})
	);
	const frames = cuts.reduce((sum, cut) => sum + cut.frames, 0);
	return { joined, expected, frames };
}

function clickErrorsMs({
	file,
	expected,
}: {
	file: string;
	expected: number[];
}) {
	const clicks = decodedClickTimes({ file });
	expect(clicks, `${path.basename(file)} clicks`).toHaveLength(expected.length);
	return clicks.map((time, index) => (time - expected[index]) * 1000);
}

/**
 * The main track's own sound in a native export. Each clip used to carry
 * AAC, whose encoder priming and end padding a stream-copy concat kept: the
 * sound of every clip after the first moved 40–60 ms later per cut, half a
 * second late by the twelfth clip of a real film.
 */
describe.skipIf(!fs.existsSync(ffmpegPath))(
	"native export main-track audio drift (real ffmpeg)",
	() => {
		const CLICKS = [0.5, 1.7, 3.3, 4.9, 6.1, 7.7, 9.3, 10.9];
		const source32k = path.join(tempDir, "clicks-32k.mp4");
		const lateSound = path.join(tempDir, "clicks-late-sound.mp4");
		const silent = path.join(tempDir, "silent.mp4");
		const still = path.join(tempDir, "still.png");

		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
			makeSource({ file: source32k, clicks: CLICKS, sampleRate: 32_000 });
			makeSource({
				file: lateSound,
				clicks: CLICKS,
				sampleRate: 44_100,
				audioDelay: 0.04,
			});
			run([
				"-y",
				"-f",
				"lavfi",
				"-i",
				`color=c=blue:s=320x180:r=${FPS}:d=4`,
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				silent,
			]);
			run([
				"-y",
				"-f",
				"lavfi",
				"-i",
				"color=c=red:s=320x180",
				"-frames:v",
				"1",
				still,
			]);
		}, 60_000);

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		it("keeps every clip's sound on the timeline across eight hard cuts", async () => {
			const trims = [0, 1.5, 3, 4.75, 6, 7.5, 9, 10.5];
			const frames = [30, 21, 36, 25, 18, 27, 23, 24];
			const {
				joined,
				expected,
				frames: total,
			} = await exportMainTrack({
				name: "cuts",
				cuts: trims.map((trimStart, index) => ({
					sourcePath: source32k,
					trimStart,
					frames: frames[index],
					click: CLICKS[index] - trimStart,
				})),
			});
			// The mix pass decodes the joined sound and encodes it again.
			const mixed = path.join(tempDir, "cuts-mixed.mp4");
			run([
				"-y",
				"-i",
				joined,
				"-map",
				"0:v:0",
				"-map",
				"0:a:0",
				"-c:v",
				"copy",
				"-af",
				"volume=1",
				"-c:a",
				"aac",
				mixed,
			]);
			for (const file of [joined, mixed]) {
				const errors = clickErrorsMs({ file, expected });
				console.log(
					path.basename(file),
					"click error (ms)",
					errors.map((e) => e.toFixed(2)).join(" ")
				);
				for (const error of errors) expect(Math.abs(error)).toBeLessThan(1);
			}
			expect(
				Number(
					probe(joined, [
						"-select_streams",
						"v:0",
						"-count_frames",
						"-show_entries",
						"stream=nb_read_frames",
					])
				)
			).toBe(total);
			for (const stream of ["v:0", "a:0"])
				expect(
					Number(
						probe(joined, [
							"-select_streams",
							stream,
							"-show_entries",
							"stream=start_time",
						])
					)
				).toBe(0);
		}, 120_000);

		it("gives pictures and silent clips silence, a sped-up clip its own sound, and late sound its place", async () => {
			// The file stores its 40 ms late start as 39.2 ms (AAC priming
			// rounding); the export must keep whatever the file says.
			const [lateClick] = decodedClickTimes({
				file: lateSound,
				fromContainerStart: true,
			});
			const { joined, expected } = await exportMainTrack({
				name: "mixed",
				cuts: [
					// No sound at all before the first audible clip: the concat
					// takes its streams from this first file.
					{ sourcePath: still, trimStart: 0, frames: 20, isImage: true },
					{ sourcePath: source32k, trimStart: 1.5, frames: 21, click: 0.2 },
					{ sourcePath: silent, trimStart: 0.5, frames: 30 },
					// 1.5×: the click 0.6 s into the read lands 0.4 s in.
					{
						sourcePath: source32k,
						trimStart: 4.3,
						frames: 24,
						playbackRate: 1.5,
						click: 0.4,
					},
					// This file's sound starts 40 ms after its picture.
					{
						sourcePath: lateSound,
						trimStart: 0,
						frames: 30,
						click: lateClick,
					},
					{ sourcePath: source32k, trimStart: 7.5, frames: 27, click: 0.2 },
				],
			});
			const errors = clickErrorsMs({ file: joined, expected });
			console.log(
				"mixed click error (ms)",
				errors.map((e) => e.toFixed(2)).join(" ")
			);
			const [first, spedUp, late, last] = errors;
			for (const error of [first, late, last])
				expect(Math.abs(error)).toBeLessThan(1);
			// atempo stretches in overlapping windows of a few tens of
			// milliseconds, so a transient inside a sped-up clip lands within
			// half a window; nothing of it carries over to the next clip.
			expect(Math.abs(spedUp)).toBeLessThan(25);
		}, 120_000);
	}
);
