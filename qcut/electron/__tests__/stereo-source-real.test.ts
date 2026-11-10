import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	buildExportSegmentEncodeArgs,
	buildExportSegmentInputArgs,
} from "../claude/handlers/claude-export-handler/export-segment-encode";
import type { ExportSegment } from "../claude/handlers/claude-export-handler/types";
import { buildTimelineAudioFilters } from "../ffmpeg/audio-filter-graph";
import { normalizeVideo } from "../ffmpeg/probe";
import { buildComposeNormalizeArgs } from "../native-pipeline/compose/compose-ffmpeg";
import { STEREO_SOURCE_CHAIN } from "../ffmpeg/stereo-source";
import type {
	AudioFile,
	AudioMixBus,
	AudioMixConfig,
	AudioTrackMix,
} from "../ffmpeg/types";

/**
 * A mono source comes out of an FFmpeg export in both channels at the level
 * of the file, as the preview plays it. FFmpeg's own conversion to stereo
 * writes each channel at 1/√2: 3.01 dB under the file.
 */

const ffmpegPath = path.resolve(
	__dirname,
	"../resources/ffmpeg/darwin-arm64/ffmpeg"
);
const tempDir = path.resolve(__dirname, "../../.tmp/stereo-source-test");
/** The level of a sine of amplitude 1/8, in dB. */
const TONE_DB = 20 * Math.log10(0.125 / Math.SQRT2);
const HALF_DB = 20 * Math.log10(0.0625 / Math.SQRT2);

function run(args: string[]): string {
	const result = spawnSync(ffmpegPath, ["-hide_banner", "-nostats", ...args], {
		encoding: "utf8",
	});
	expect(result.status, result.stderr).toBe(0);
	return result.stderr;
}

/** Each channel's RMS level in dB, over `window` seconds when given. */
function channelLevels(file: string, window?: [number, number]): number[] {
	const stderr = run([
		...(window ? ["-ss", String(window[0]), "-t", String(window[1])] : []),
		"-i",
		file,
		"-map",
		"0:a:0",
		"-af",
		"astats=measure_perchannel=RMS_level:measure_overall=none",
		"-f",
		"null",
		"-",
	]);
	return [...stderr.matchAll(/RMS level dB:\s*(-?[\d.]+|-inf)/g)].map(
		(match) =>
			match[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(match[1])
	);
}

const effects = (): AudioMixBus["effects"] => ({
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
	limiter: { enabled: false, ceilingDb: -1, releaseMs: 80 },
});

function track(
	fields: Partial<AudioTrackMix> & { trackId: string }
): AudioTrackMix {
	return {
		muted: false,
		gainDb: 0,
		pan: 0,
		solo: false,
		busId: "master",
		effects: effects(),
		ducking: {
			enabled: false,
			sourceTrackIds: [],
			thresholdDb: -30,
			reductionDb: -12,
			attackMs: 20,
			releaseMs: 80,
		},
		...fields,
	};
}

function mix(tracks: AudioTrackMix[]): AudioMixConfig {
	return {
		master: {
			id: "master",
			name: "master",
			gainDb: 0,
			pan: 0,
			muted: false,
			solo: false,
			effects: effects(),
		},
		buses: [],
		tracks,
	};
}

describe.skipIf(!fs.existsSync(ffmpegPath))(
	"a mono source at the level it plays at (real ffmpeg)",
	() => {
		const mono = path.join(tempDir, "mono.wav");
		const stereo = path.join(tempDir, "stereo.wav");
		const surround = path.join(tempDir, "surround.wav");
		const monoClip = path.join(tempDir, "mono-clip.mov");
		const stereoClip = path.join(tempDir, "stereo-clip.mov");

		beforeAll(() => {
			fs.mkdirSync(tempDir, { recursive: true });
			const tone = (expression: string, file: string, layout?: string) =>
				run([
					"-y",
					"-f",
					"lavfi",
					"-i",
					`aevalsrc=${expression}:s=48000:d=2${layout ? `:c=${layout}` : ""}`,
					"-c:a",
					"pcm_s16le",
					file,
				]);
			const sine = (amplitude: number) => `${amplitude}*sin(2*PI*440*t)`;
			tone(sine(0.125), mono);
			// The right channel half as loud, so a swap or a sum would show.
			tone(`${sine(0.125)}|${sine(0.0625)}`, stereo);
			tone(
				[0.125, 0.0625, 0.1, 0.05, 0.08, 0.03].map(sine).join("|"),
				surround,
				"5.1"
			);
			for (const [sound, file] of [
				[mono, monoClip],
				[stereo, stereoClip],
			]) {
				run([
					"-y",
					"-f",
					"lavfi",
					"-i",
					"color=c=black:s=64x64:r=24:d=2",
					"-i",
					sound,
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					"-c:a",
					"copy",
					file,
				]);
			}
		}, 60_000);

		afterAll(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		it("measures FFmpeg's own conversion 3 dB under the file", () => {
			// What every FFmpeg export did to a mono clip.
			const output = path.join(tempDir, "ffmpeg-own.wav");
			run(["-y", "-i", mono, "-ac", "2", "-c:a", "pcm_f32le", output]);
			const [left, right] = channelLevels(output);
			expect(left).toBeCloseTo(TONE_DB - 3.01, 1);
			expect(right).toBeCloseTo(TONE_DB - 3.01, 1);
		});

		it("puts a mono file into both channels at the file's level", () => {
			const output = path.join(tempDir, "mono-out.wav");
			run([
				"-y",
				"-i",
				mono,
				"-af",
				STEREO_SOURCE_CHAIN,
				"-c:a",
				"pcm_f32le",
				output,
			]);
			const levels = channelLevels(output);
			expect(levels).toHaveLength(2);
			expect(levels[0]).toBeCloseTo(TONE_DB, 2);
			expect(levels[1]).toBeCloseTo(TONE_DB, 2);
		});

		it("leaves a stereo file's channels as they are", () => {
			const output = path.join(tempDir, "stereo-out.wav");
			run([
				"-y",
				"-i",
				stereo,
				"-af",
				STEREO_SOURCE_CHAIN,
				"-c:a",
				"pcm_f32le",
				output,
			]);
			const [left, right] = channelLevels(output);
			expect(left).toBeCloseTo(TONE_DB, 2);
			expect(right).toBeCloseTo(HALF_DB, 2);
		});

		it("mixes a wider layout down exactly as FFmpeg does without it", () => {
			const plain = path.join(tempDir, "surround-plain.wav");
			const staged = path.join(tempDir, "surround-staged.wav");
			run(["-y", "-i", surround, "-ac", "2", "-c:a", "pcm_f32le", plain]);
			run([
				"-y",
				"-i",
				surround,
				"-af",
				STEREO_SOURCE_CHAIN,
				"-c:a",
				"pcm_f32le",
				staged,
			]);
			const expected = channelLevels(plain);
			const levels = channelLevels(staged);
			expect(levels).toHaveLength(2);
			expect(levels[0]).toBeCloseTo(expected[0], 3);
			expect(levels[1]).toBeCloseTo(expected[1], 3);
		});

		function encodeSegment({
			sourcePath,
			name,
		}: {
			sourcePath: string;
			name: string;
		}): number[] {
			const segment: ExportSegment = {
				elementId: "clip-1",
				trackId: "track-1",
				trackOrder: 0,
				elementOrder: 0,
				sourcePath,
				startTime: 0,
				duration: 2,
				trimStart: 0,
				sourceId: "media-1",
				fitMode: "cover",
			};
			const outputPath = path.join(tempDir, name);
			run(
				buildExportSegmentEncodeArgs({
					inputArgs: buildExportSegmentInputArgs({ segment }),
					scaleFilter: "scale=64:64",
					segment,
					settings: { fps: 24, codec: "libx264", bitrate: "1M" },
					audio: { kind: "input" },
					outputPath,
				})
			);
			return channelLevels(outputPath);
		}

		it("writes a main-track clip's mono sound at the file's level, and a stereo one as it is", () => {
			const fromMono = encodeSegment({
				sourcePath: monoClip,
				name: "segment-mono.mov",
			});
			expect(fromMono).toHaveLength(2);
			expect(fromMono[0]).toBeCloseTo(TONE_DB, 2);
			expect(fromMono[1]).toBeCloseTo(TONE_DB, 2);
			const fromStereo = encodeSegment({
				sourcePath: stereoClip,
				name: "segment-stereo.mov",
			});
			expect(fromStereo[0]).toBeCloseTo(TONE_DB, 2);
			expect(fromStereo[1]).toBeCloseTo(HALF_DB, 2);
		});

		it("normalises a clip for the Export dialog's FFmpeg export at the file's level", async () => {
			const output = path.join(tempDir, "normalized.mp4");
			await normalizeVideo(monoClip, output, 64, 64, 24, 2);
			// AAC, so to a tenth of a dB.
			const levels = channelLevels(output, [0.5, 1]);
			expect(levels).toHaveLength(2);
			expect(levels[0]).toBeCloseTo(TONE_DB, 1);
			expect(levels[1]).toBeCloseTo(TONE_DB, 1);
		}, 60_000);

		it("normalises a compose clip at the file's level", () => {
			const output = path.join(tempDir, "compose-clip.mp4");
			run([
				"-y",
				...buildComposeNormalizeArgs({
					input: monoClip,
					output,
					trimIn: 0,
					duration: 2,
					width: 64,
					height: 64,
					fps: 24,
					hasAudio: true,
				}),
			]);
			const levels = channelLevels(output, [0.5, 1]);
			expect(levels).toHaveLength(2);
			expect(levels[0]).toBeCloseTo(TONE_DB, 1);
			expect(levels[1]).toBeCloseTo(TONE_DB, 1);
		}, 60_000);

		function renderMix({
			files,
			config,
			name,
			window,
		}: {
			files: AudioFile[];
			config?: AudioMixConfig;
			name: string;
			window?: [number, number];
		}): number[] {
			const graph = buildTimelineAudioFilters({
				audioFiles: files,
				audioStartIndex: 0,
				fps: 24,
				audioMixConfig: config,
			});
			const output = path.join(tempDir, name);
			run([
				"-y",
				...files.flatMap((file) => ["-i", file.path]),
				"-filter_complex",
				graph.filterSteps.join(";"),
				"-map",
				graph.mapAudio as string,
				// What the mix pass asks its encoder for.
				"-ac",
				"2",
				"-c:a",
				"pcm_f32le",
				output,
			]);
			return channelLevels(output, window);
		}

		it("mixes a lone mono clip at the file's level, where it used to meet the encoder as it was", () => {
			const levels = renderMix({
				files: [{ path: mono, startTime: 0, volume: 1 }],
				name: "mix-lone.wav",
			});
			expect(levels[0]).toBeCloseTo(TONE_DB, 2);
			expect(levels[1]).toBeCloseTo(TONE_DB, 2);
		});

		it("keeps a mono and a stereo clip each at its own level in one mix", () => {
			const files: AudioFile[] = [
				{ path: mono, startTime: 0, volume: 1 },
				{ path: stereo, startTime: 3, volume: 1 },
			];
			const first = renderMix({
				files,
				name: "mix-both.wav",
				window: [0.5, 1],
			});
			expect(first[0]).toBeCloseTo(TONE_DB, 2);
			expect(first[1]).toBeCloseTo(TONE_DB, 2);
			const second = channelLevels(
				path.join(tempDir, "mix-both.wav"),
				[3.5, 1]
			);
			expect(second[0]).toBeCloseTo(TONE_DB, 2);
			expect(second[1]).toBeCloseTo(HALF_DB, 2);
		});

		it("pans a mono clip as the preview's panner pans the stereo signal it is given", () => {
			// Hard left, a stereo input's law sums both channels into the left
			// one: twice the level of the file, nothing on the right.
			const levels = renderMix({
				files: [{ path: mono, startTime: 0, volume: 1, trackId: "left" }],
				config: mix([track({ trackId: "left", pan: -1 })]),
				name: "mix-panned.wav",
			});
			expect(levels[0]).toBeCloseTo(TONE_DB + 6.02, 1);
			expect(levels[1]).toBeLessThan(-90);
		});
	}
);
