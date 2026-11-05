import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTimelineAudioFilters } from "../ffmpeg/audio-filter-graph";
import { getFFmpegPath } from "../ffmpeg/paths";
import type {
	AudioFile,
	AudioMixBus,
	AudioMixConfig,
	AudioTrackMix,
} from "../ffmpeg/types";

/**
 * One project mixes to the same samples every time (N34). FFmpeg decodes each
 * input on its own thread, and two of its filters behave differently depending
 * on which input's frames arrive first: `sidechaingate` drops what waits for
 * the key when its signal ends, and `amix` can lose its timestamps after its
 * first input ends, which a level or pan curve reads as `t` = NaN.
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

function rms({
	pcm,
	fromSeconds,
	toSeconds,
	channel,
}: {
	pcm: Buffer;
	fromSeconds: number;
	toSeconds: number;
	channel?: 0 | 1;
}): number {
	const samples = new Float32Array(
		pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length)
	);
	const from = Math.round(fromSeconds * SAMPLE_RATE) * 2 + (channel ?? 0);
	const to = Math.round(toSeconds * SAMPLE_RATE) * 2;
	const stride = channel === undefined ? 1 : 2;
	expect(to).toBeLessThanOrEqual(samples.length);
	let sum = 0;
	let count = 0;
	for (let index = from; index < to; index += stride) {
		sum += samples[index] ** 2;
		count++;
	}
	return Math.sqrt(sum / count);
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
	it("take their clock from their sample count", () => {
		const { filterSteps } = buildTimelineAudioFilters({
			audioFiles: [
				{ path: "a.wav", startTime: 0, volume: 1, trackId: "sound" },
				{ path: "b.wav", startTime: 4, volume: 1, trackId: "sound" },
				{ path: "c.wav", startTime: 0, volume: 1, trackId: "music" },
			] as AudioFile[],
			audioStartIndex: 0,
			fps: 30,
			audioMixConfig: {
				master: { ...master(), gainDb: -2 },
				buses: [],
				tracks: [track({ trackId: "sound" }), track({ trackId: "music" })],
			},
		});
		const sums = filterSteps.filter((step) => step.includes("amix="));
		expect(sums).toHaveLength(2);
		for (const sum of sums) {
			expect(sum).toMatch(/normalize=0,asetpts=N\/SR\/TB\[/);
		}
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
			master: {
				...master(),
				// Ends in a ramp: a `t` of NaN falls through to it and plays silent.
				automation: {
					gainDb: [
						{ time: 0, value: 0 },
						{ time: 0.5, value: -1 },
					],
				},
			},
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
		const reference = render({
			audioFiles: [{ ...audioFiles[0], trackId: undefined }],
			seconds: SECONDS,
		});
		const referenceLevel = rms({
			pcm: reference,
			fromSeconds: 25,
			toSeconds: 25.5,
		});
		expect(referenceLevel).toBeGreaterThan(0.01);
		const hashes = new Set<string>();
		let length = 0;
		for (let run = 0; run < 8; run++) {
			const pcm = render({ audioFiles, audioMixConfig, seconds: SECONDS });
			length = pcm.length;
			hashes.add(createHash("sha256").update(pcm).digest("hex"));
			// Only the voice remains: its -12 dB track and -1 dB master must
			// still be audible after every shorter input has ended.
			const lateLevel = rms({ pcm, fromSeconds: 25, toSeconds: 25.5 });
			expect(20 * Math.log10(lateLevel / referenceLevel)).toBeCloseTo(-13, 2);
		}
		expect(hashes.size).toBe(1);
		expect(length).toBe(SECONDS * SAMPLE_RATE * 2 * 4);
	});

	it.each([
		{ stage: "track" },
		{ stage: "bus" },
		{ stage: "master" },
	])("keeps $stage gain and pan on the timeline after a short input ends", ({
		stage,
	}) => {
		const seconds = 5.25;
		const automation = {
			gainDb: [
				{ time: 0, value: -12 },
				{ time: 2, value: -12 },
				{ time: 3, value: -6 },
			],
			pan: [
				{ time: 0, value: -1 },
				{ time: 2, value: -1 },
				{ time: 3, value: 1 },
			],
		};
		const longClip = { ...audioFiles[0], startTime: 1.25, duration: 4 };
		const reference = render({
			audioFiles: [{ ...longClip, trackId: undefined }],
			seconds,
		});
		const referenceLevel = rms({
			pcm: reference,
			fromSeconds: 1.5,
			toSeconds: 1.6,
			channel: 0,
		});
		expect(referenceLevel).toBeGreaterThan(0.01);
		const busId = stage === "bus" ? "group" : "master";
		const tracks =
			stage === "track"
				? [track({ trackId: "sound", automation })]
				: [
						track({ trackId: "short", busId }),
						track({ trackId: "sound", busId }),
					];
		const pcm = render({
			audioFiles: [
				{
					...audioFiles[2],
					startTime: 0,
					trackId: stage === "track" ? "sound" : "short",
				},
				{ ...longClip, trackId: "sound" },
			],
			audioMixConfig: {
				master: stage === "master" ? { ...master(), automation } : master(),
				buses:
					stage === "bus" ? [{ ...master(), id: "group", automation }] : [],
				tracks,
			},
			seconds,
		});
		expect(pcm.length).toBe(seconds * SAMPLE_RATE * 2 * 4);
		expect(rms({ pcm, fromSeconds: 0.9, toSeconds: 1.2 })).toBe(0);
		for (const window of [
			{ fromSeconds: 1.5, toSeconds: 1.6, channel: 0 as const, gainDb: -12 },
			{ fromSeconds: 3.5, toSeconds: 3.6, channel: 1 as const, gainDb: -6 },
		]) {
			const level = rms({ pcm, ...window });
			// The fixture has identical stereo channels; hard pan sums both
			// into the near channel and silences the far channel.
			expect(level / referenceLevel).toBeCloseTo(
				2 * 10 ** (window.gainDb / 20),
				3
			);
			expect(
				rms({ pcm, ...window, channel: window.channel === 0 ? 1 : 0 })
			).toBeLessThan(referenceLevel * 1e-5);
		}
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
		const isolatedMusic = difference(voiceAndMusic, voice);
		for (const fromSeconds of [20.85, 21.85]) {
			const window = { fromSeconds, toSeconds: fromSeconds + 0.14 };
			const referenceLevel = rms({ pcm: undisturbed, ...window });
			expect(referenceLevel).toBeGreaterThan(0.01);
			const duckedLevel = rms({ pcm: isolatedMusic, ...window });
			const gainDb = 20 * Math.log10(duckedLevel / referenceLevel);
			// -20 dB ducking plus the -1 dB master, through the music's final
			// 140 ms as well as its settled body; silence cannot pass this bound.
			expect(gainDb).toBeGreaterThan(-21.5);
			expect(gainDb).toBeLessThan(-20.5);
		}
	});
});
