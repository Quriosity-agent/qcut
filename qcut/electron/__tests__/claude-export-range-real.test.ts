import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { executeExportJob } from "../claude/handlers/claude-export-handler/export-engine";
import {
	exportJobs,
	getExportJobStatus,
} from "../claude/handlers/claude-export-handler/job-manager";
import {
	EXPORT_JOB_STATUS,
	type ExportJobInternal,
	type ExportSegment,
	type ResolvedExportSettings,
} from "../claude/handlers/claude-export-handler/types";
import type {
	AudioBusEffects,
	AudioFile,
	AudioMixConfig,
} from "../ffmpeg/types";

vi.mock("electron", () => ({
	app: { getPath: () => tmpdir(), isPackaged: false },
	ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
vi.mock("electron-log", () => ({
	default: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		log: vi.fn(),
	},
}));

/**
 * A range export is the full export cut to the range (2026-11-09: checking
 * 30 s of a 218 s trailer took two full exports). Both are rendered here
 * through the real engine and compared frame by frame and sample by sample
 * over the range, with the master limiter on and with no mix at all.
 */

const ffmpeg = path.resolve(
	__dirname,
	`../resources/ffmpeg/${process.platform}-${process.arch}/ffmpeg`
);
const WIDTH = 320;
const HEIGHT = 180;
const FPS = 24;
const SAMPLE_RATE = 48_000;
const CLIP_SECONDS = 4;
const RANGE = { start: 3, end: 6 };

const settings: ResolvedExportSettings = {
	engine: "native-cli",
	presetId: "custom",
	width: WIDTH,
	height: HEIGHT,
	fps: FPS,
	format: "mp4",
	codec: "libx264",
	bitrate: "8Mbps",
	audioBitrate: 192,
	audioSampleRate: SAMPLE_RATE,
	audioChannels: 2,
};

let directory = "";

function run({ args }: { args: string[] }): Buffer {
	const result = spawnSync(
		ffmpeg,
		["-hide_banner", "-nostdin", "-nostats", "-v", "error", ...args],
		{ timeout: 120_000, windowsHide: true, maxBuffer: 256 * 1024 * 1024 }
	);
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr.toString("utf8"));
	return result.stdout;
}

/**
 * A clip: a moving test picture with a tone, sound kept as PCM. The colour
 * tags are the clip's own: two clips tagged differently make FFmpeg rebuild
 * its filter graph at the cut between them, as footage from two cameras
 * does, which is where a cut that resets the clock lost frames.
 */
function clip({
	name,
	picture,
	colour,
	toneHz,
	gain,
}: {
	name: string;
	picture: string;
	colour: string;
	toneHz: number;
	gain: number;
}): string {
	const file = path.join(directory, `${name}.mov`);
	run({
		args: [
			"-y",
			"-f",
			"lavfi",
			"-i",
			`${picture}=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=${CLIP_SECONDS}`,
			"-f",
			"lavfi",
			"-i",
			`aevalsrc=${gain}*sin(2*PI*${toneHz}*t)|${gain}*sin(2*PI*${toneHz}*t):s=${SAMPLE_RATE}:d=${CLIP_SECONDS}`,
			"-map",
			"0:v:0",
			"-map",
			"1:a:0",
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-pix_fmt",
			"yuv420p",
			"-colorspace",
			colour,
			"-color_primaries",
			colour,
			"-color_trc",
			colour,
			"-c:a",
			"pcm_s16le",
			file,
		],
	});
	return file;
}

/** Every frame of a file as 8-bit grey. */
function greyFrames({ file }: { file: string }): Uint8Array[] {
	const raw = run({
		args: [
			"-i",
			file,
			"-map",
			"0:v:0",
			"-vf",
			`scale=${WIDTH}:${HEIGHT},format=gray`,
			"-f",
			"rawvideo",
			"-",
		],
	});
	const size = WIDTH * HEIGHT;
	const frames: Uint8Array[] = [];
	for (let offset = 0; offset + size <= raw.length; offset += size) {
		frames.push(new Uint8Array(raw.buffer, raw.byteOffset + offset, size));
	}
	return frames;
}

/** The sound of a file as interleaved stereo float samples. */
function samples({ file }: { file: string }): Float32Array {
	const raw = run({
		args: [
			"-i",
			file,
			"-map",
			"0:a:0",
			"-vn",
			"-f",
			"f32le",
			"-ac",
			"2",
			"-ar",
			String(SAMPLE_RATE),
			"-",
		],
	});
	return new Float32Array(
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)
	);
}

function psnr({ a, b }: { a: Uint8Array; b: Uint8Array }): number {
	let squares = 0;
	for (let index = 0; index < a.length; index += 1) {
		const difference = a[index] - b[index];
		squares += difference * difference;
	}
	const mse = squares / a.length;
	return mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10(255 ** 2 / mse);
}

/** RMS of the difference over the RMS of the reference. */
function relativeError({
	reference,
	candidate,
}: {
	reference: Float32Array;
	candidate: Float32Array;
}): number {
	let differences = 0;
	let energy = 0;
	for (let index = 0; index < reference.length; index += 1) {
		const difference = reference[index] - (candidate[index] ?? 0);
		differences += difference * difference;
		energy += reference[index] * reference[index];
	}
	return Math.sqrt(differences / Math.max(energy, 1e-12));
}

function effects(): AudioBusEffects {
	return {
		parametricEqualizer: {
			enabled: false,
			lowCutHz: 20,
			highCutHz: 20_000,
			bands: [],
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
	};
}

/** Music on its own track and a master limiter that the tones keep busy. */
function limitedMix(): AudioMixConfig {
	const master = effects();
	master.limiter = { enabled: true, ceilingDb: -6, releaseMs: 200 };
	return {
		master: {
			id: "master",
			name: "Master",
			gainDb: 3,
			pan: 0,
			muted: false,
			solo: false,
			effects: master,
		},
		buses: [],
		tracks: [
			{
				trackId: "music",
				busId: "master",
				gainDb: -3,
				pan: 0,
				muted: false,
				solo: false,
				effects: effects(),
				ducking: {
					enabled: false,
					sourceTrackIds: [],
					thresholdDb: -30,
					reductionDb: -12,
					attackMs: 80,
					releaseMs: 350,
				},
			},
		],
	};
}

async function exportTimeline({
	name,
	segments,
	audioFiles,
	audioMixConfig,
	range,
}: {
	name: string;
	segments: ExportSegment[];
	audioFiles: AudioFile[];
	audioMixConfig?: AudioMixConfig;
	range?: { start: number; end: number };
}): Promise<string> {
	const outputPath = path.join(directory, `${name}.mp4`);
	const jobId = `export_${name}`;
	const job: ExportJobInternal = {
		jobId,
		projectId: "range-parity",
		status: EXPORT_JOB_STATUS.queued,
		progress: 0,
		startedAt: Date.now(),
		presetId: "custom",
		engine: "native-cli",
		settings,
		outputPath,
	};
	exportJobs.set(jobId, job);
	await executeExportJob({
		jobId,
		projectId: "range-parity",
		settings,
		outputPath,
		segments,
		audioFiles,
		audioMixConfig,
		projectFps: FPS,
		projectCanvas: { width: WIDTH, height: HEIGHT },
		range,
	});
	const status = getExportJobStatus(jobId);
	expect(status?.error).toBeUndefined();
	expect(status?.status).toBe("completed");
	return outputPath;
}

function expectRangeMatchesFull({
	full,
	range,
}: {
	full: string;
	range: string;
}): void {
	const fullFrames = greyFrames({ file: full });
	const rangeFrames = greyFrames({ file: range });
	const firstFrame = Math.round(RANGE.start * FPS);
	const frameCount = Math.round((RANGE.end - RANGE.start) * FPS);
	expect(fullFrames.length).toBe(2 * CLIP_SECONDS * FPS);
	expect(rangeFrames.length).toBe(frameCount);
	for (const [index, frame] of rangeFrames.entries()) {
		expect(
			psnr({ a: fullFrames[firstFrame + index], b: frame }),
			`frame ${index}`
		).toBeGreaterThan(40);
	}

	const fullSound = samples({ file: full });
	const rangeSound = samples({ file: range });
	const firstSample = RANGE.start * SAMPLE_RATE * 2;
	const sampleCount = (RANGE.end - RANGE.start) * SAMPLE_RATE * 2;
	// AAC pads its last frame; the range's sound is the range's length.
	expect(Math.abs(rangeSound.length - sampleCount)).toBeLessThan(
		0.05 * SAMPLE_RATE * 2
	);
	expect(
		relativeError({
			reference: fullSound.subarray(firstSample, firstSample + sampleCount),
			candidate: rangeSound.subarray(0, sampleCount),
		})
	).toBeLessThan(0.1);
}

describe.skipIf(!existsSync(ffmpeg))(
	"range export parity (real ffmpeg)",
	() => {
		let segments: ExportSegment[] = [];
		let music: AudioFile[] = [];

		beforeAll(() => {
			directory = path.join(tmpdir(), `qcut-range-parity-${process.pid}`);
			rmSync(directory, { recursive: true, force: true });
			mkdirSync(directory, { recursive: true });
			const first = clip({
				name: "first",
				picture: "testsrc2",
				colour: "bt709",
				toneHz: 440,
				gain: 0.25,
			});
			// Moving too, so a picture shifted by a frame cannot pass as equal.
			const second = clip({
				name: "second",
				picture: "testsrc",
				colour: "smpte170m",
				toneHz: 660,
				gain: 0.5,
			});
			const common = {
				trackId: "main",
				trackOrder: 0,
				trimStart: 0,
				isImage: false,
				fitMode: "cover" as const,
			};
			segments = [
				{
					...common,
					elementId: "first",
					elementOrder: 0,
					sourcePath: first,
					sourceId: "first",
					startTime: 0,
					duration: CLIP_SECONDS,
				},
				{
					...common,
					elementId: "second",
					elementOrder: 1,
					sourcePath: second,
					sourceId: "second",
					startTime: CLIP_SECONDS,
					duration: CLIP_SECONDS,
				},
			];
			const tone = path.join(directory, "music.wav");
			run({
				args: [
					"-y",
					"-f",
					"lavfi",
					"-i",
					`aevalsrc=0.3*sin(2*PI*220*t)|0.3*sin(2*PI*220*t):s=${SAMPLE_RATE}:d=${2 * CLIP_SECONDS}`,
					"-c:a",
					"pcm_s16le",
					tone,
				],
			});
			music = [
				{
					elementId: "music",
					trackId: "music",
					path: tone,
					startTime: 0,
					duration: 2 * CLIP_SECONDS,
					volume: 1,
				},
			];
		}, 120_000);

		afterAll(() => {
			// KEEP_RANGE_PARITY=1 leaves the exports for a look with ffprobe.
			if (process.env.KEEP_RANGE_PARITY) return;
			rmSync(directory, { recursive: true, force: true });
		});

		it("matches the full export over the range with the master limiter on", async () => {
			const full = await exportTimeline({
				name: "limited-full",
				segments,
				audioFiles: music,
				audioMixConfig: limitedMix(),
			});
			const range = await exportTimeline({
				name: "limited-range",
				segments,
				audioFiles: music,
				audioMixConfig: limitedMix(),
				range: RANGE,
			});
			expect(getExportJobStatus("export_limited-range")).toMatchObject({
				duration: RANGE.end - RANGE.start,
				range: { startTime: RANGE.start, endTime: RANGE.end },
				audioValidation: { status: "passed" },
			});
			expectRangeMatchesFull({ full, range });
		}, 240_000);

		it("matches the full export over the range with no mix", async () => {
			const full = await exportTimeline({
				name: "plain-full",
				segments,
				audioFiles: [],
			});
			const range = await exportTimeline({
				name: "plain-range",
				segments,
				audioFiles: [],
				range: RANGE,
			});
			expectRangeMatchesFull({ full, range });
		}, 240_000);
	}
);
