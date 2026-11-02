import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTimelineAudioFilters } from "../ffmpeg/audio-filter-graph";
import { amixSteps } from "../ffmpeg/audio-mix-graph";
import { getFFmpegPath } from "../ffmpeg/paths";
import type {
	AudioFile,
	AudioMixBus,
	AudioMixConfig,
	AudioTrackMix,
} from "../ffmpeg/types";

/**
 * One project mixes to the same samples every time (N34). FFmpeg decodes each
 * input on its own thread, and two of its filters drop samples depending on
 * which input's frames arrived first: `amix` what it queued from its first
 * input when that input ends, `sidechaingate` what waits for the key when the
 * signal ends. An export's sound could therefore differ near a clip's end.
 */

const ffmpeg = getFFmpegPath();
const workDir = mkdtempSync(path.join(tmpdir(), "qcut-audio-determinism-"));
const SAMPLE_RATE = 48_000;
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function tone(name: string, frequency: number, seconds: number): string {
	const file = path.join(workDir, `${name}.wav`);
	const result = spawnSync(ffmpeg, [
		"-y",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		`sine=frequency=${frequency}:sample_rate=${SAMPLE_RATE}:duration=${seconds}`,
		"-ac",
		"2",
		file,
	]);
	if (result.status !== 0) throw new Error(String(result.stderr));
	return file;
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

const master = (): AudioMixBus => ({
	id: "master",
	name: "Master",
	gainDb: 0,
	pan: 0,
	muted: false,
	solo: false,
	effects: effects(),
});

function track(fields: Partial<AudioTrackMix> & { trackId: string }) {
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
			reductionDb: -20,
			attackMs: 20,
			releaseMs: 50,
		},
		...fields,
	} satisfies AudioTrackMix;
}

function render({
	audioFiles,
	audioMixConfig,
	seconds,
}: {
	audioFiles: AudioFile[];
	audioMixConfig?: AudioMixConfig;
	seconds: number;
}): Buffer {
	const graph = buildTimelineAudioFilters({
		audioFiles,
		audioStartIndex: 0,
		fps: 30,
		audioMixConfig,
	});
	const result = spawnSync(
		ffmpeg,
		[
			"-v",
			"error",
			...audioFiles.flatMap((file) => ["-i", file.path]),
			"-filter_complex",
			graph.filterSteps.join(";"),
			"-map",
			graph.mapAudio as string,
			"-c:a",
			"pcm_f32le",
			"-t",
			String(seconds),
			"-f",
			"f32le",
			"-",
		],
		{ maxBuffer: 256 * 1024 * 1024 }
	);
	if (result.status !== 0) throw new Error(String(result.stderr));
	return result.stdout;
}

function rms(pcm: Buffer, fromSeconds: number, toSeconds: number): number {
	const samples = new Float32Array(
		pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length)
	);
	const from = Math.round(fromSeconds * SAMPLE_RATE) * 2;
	const to = Math.round(toSeconds * SAMPLE_RATE) * 2;
	let sum = 0;
	for (let index = from; index < to; index++) sum += samples[index] ** 2;
	return Math.sqrt(sum / (to - from));
}

/** One render minus another, sample for sample. */
function difference(left: Buffer, right: Buffer): Buffer {
	const a = new Float32Array(
		left.buffer.slice(left.byteOffset, left.byteOffset + left.length)
	);
	const b = new Float32Array(
		right.buffer.slice(right.byteOffset, right.byteOffset + right.length)
	);
	return Buffer.from(a.map((sample, index) => sample - b[index]).buffer);
}

describe("the timeline's sums", () => {
	it("pad amix's first input, so that only silence can be dropped", () => {
		expect(amixSteps({ inputs: ["a", "b", "c"], output: "sum" })).toEqual([
			"[a]apad=pad_dur=5[sum_first]",
			"[sum_first][b][c]amix=inputs=3:duration=longest:dropout_transition=0:normalize=0[sum]",
		]);
	});

	it("pad a ducked signal, so the gate lives until the key has caught up", () => {
		const { filterSteps } = buildTimelineAudioFilters({
			audioFiles: [
				{ path: "voice.wav", startTime: 0, volume: 1, trackId: "voice" },
				{ path: "music.wav", startTime: 0, volume: 1, trackId: "music" },
			] as AudioFile[],
			audioStartIndex: 0,
			fps: 30,
			audioMixConfig: {
				master: master(),
				buses: [],
				tracks: [
					track({ trackId: "voice" }),
					track({
						trackId: "music",
						ducking: {
							enabled: true,
							sourceTrackIds: ["voice"],
							thresholdDb: -30,
							reductionDb: -20,
							attackMs: 20,
							releaseMs: 50,
						},
					}),
				],
			},
		});
		const graph = filterSteps.join(";");
		expect(graph).toContain("_wet]apad[");
		expect(graph).toContain("duration=first");
		expect(graph).toMatch(/_dry\]apad=pad_dur=5\[/);
	});
});

describe("a mix rendered with the real FFmpeg", { timeout: 120_000 }, () => {
	const SECONDS = 26;
	let audioFiles: AudioFile[];
	let audioMixConfig: AudioMixConfig;

	beforeAll(() => {
		// Clips of different lengths on several tracks, so inputs end all through
		// the mix; the ducked clip ends while its key is still sounding.
		const clips: AudioFile[] = [];
		for (let index = 0; index < 24; index++) {
			clips.push({
				path: tone(`clip-${index}`, 200 + index * 40, 0.7 + (index % 5) * 0.15),
				startTime: 0.4 + index,
				volume: 1,
				trackId: `sound-${index % 3}`,
				duration: 0.7 + (index % 5) * 0.15,
			} as AudioFile);
		}
		audioFiles = [
			{
				path: tone("voice", 1000, SECONDS),
				startTime: 0,
				volume: 1,
				trackId: "voice",
				duration: SECONDS,
			} as AudioFile,
			{
				path: tone("music", 440, 20),
				startTime: 2,
				volume: 1,
				trackId: "music",
				duration: 20,
			} as AudioFile,
			...clips,
		];
		audioMixConfig = {
			master: master(),
			buses: [],
			tracks: [
				track({ trackId: "voice", gainDb: -12 }),
				track({ trackId: "sound-0" }),
				track({ trackId: "sound-1" }),
				track({ trackId: "sound-2" }),
				track({
					trackId: "music",
					ducking: {
						enabled: true,
						sourceTrackIds: ["voice"],
						thresholdDb: -40,
						reductionDb: -20,
						attackMs: 20,
						releaseMs: 50,
					},
				}),
			],
		};
	});

	it("gives the same samples every time", () => {
		const hashes = new Set<string>();
		let length = 0;
		for (let run = 0; run < 8; run++) {
			const pcm = render({ audioFiles, audioMixConfig, seconds: SECONDS });
			length = pcm.length;
			hashes.add(createHash("sha256").update(pcm).digest("hex"));
		}
		expect(hashes.size).toBe(1);
		expect(length).toBe(SECONDS * SAMPLE_RATE * 2 * 4);
	});

	it("keeps ducking a clip to its very end", () => {
		const voiceAndMusic = render({
			audioFiles: audioFiles.slice(0, 2),
			audioMixConfig,
			seconds: SECONDS,
		});
		const voice = render({
			audioFiles: audioFiles.slice(0, 1),
			audioMixConfig,
			seconds: SECONDS,
		});
		const undisturbed = render({
			audioFiles: [{ ...audioFiles[1], trackId: undefined }],
			seconds: SECONDS,
		});
		// The music's last moments, at 21.85–21.99 s of the 22 s it ends on: -20 dB
		// of the tone, not the tone at full level.
		const ducked = rms(difference(voiceAndMusic, voice), 21.85, 21.99);
		expect(ducked / rms(undisturbed, 21.85, 21.99)).toBeLessThan(0.2);
	});
});
