import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildTimelineAudioFilters } from "../ffmpeg/audio-filter-graph";
import { isNeutralAudioMix } from "../ffmpeg/audio-mix-graph";
import { getFFmpegPath } from "../ffmpeg/paths";
import type {
	AudioFile,
	AudioMixBus,
	AudioMixConfig,
	AudioTrackMix,
} from "../ffmpeg/types";

/**
 * The export applies track, bus and master settings the way the preview does.
 * Each case renders sine tones through the real graph with FFmpeg and
 * measures the result.
 */

const ffmpeg = getFFmpegPath();
const workDir = mkdtempSync(path.join(tmpdir(), "qcut-audio-mix-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function run(args: string[]): string {
	const result = spawnSync(ffmpeg, ["-hide_banner", "-nostats", ...args], {
		encoding: "utf8",
	});
	if (result.status !== 0) throw new Error(result.stderr);
	return result.stderr;
}

function tone(name: string, frequency: number, seconds: number): string {
	const file = path.join(workDir, `${name}.wav`);
	run([
		"-y",
		"-f",
		"lavfi",
		"-i",
		`sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`,
		"-ac",
		"2",
		file,
	]);
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

function bus(fields: Partial<AudioMixBus> & { id: string }): AudioMixBus {
	return {
		name: fields.id,
		gainDb: 0,
		pan: 0,
		muted: false,
		solo: false,
		effects: effects(),
		...fields,
	};
}

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

function mix(fields: Partial<AudioMixConfig>): AudioMixConfig {
	return { master: bus({ id: "master" }), buses: [], tracks: [], ...fields };
}

/** Render the timeline audio and return the mean level (dB) of a window. */
function render({
	files,
	config,
	measure = "",
	window,
}: {
	files: AudioFile[];
	config?: AudioMixConfig;
	measure?: string;
	window?: [number, number];
}): number {
	const graph = buildTimelineAudioFilters({
		audioFiles: files,
		audioStartIndex: 0,
		fps: 30,
		audioMixConfig: config,
	});
	const output = path.join(
		workDir,
		`out-${Math.random().toString(36).slice(2)}.wav`
	);
	run([
		"-y",
		...files.flatMap((file) => ["-i", file.path]),
		...(graph.filterSteps.length > 0
			? ["-filter_complex", graph.filterSteps.join(";")]
			: []),
		"-map",
		graph.mapAudio ?? "0:a",
		output,
	]);
	const filters = [
		...(window ? [`atrim=start=${window[0]}:end=${window[1]}`] : []),
		...(measure ? [measure] : []),
		"volumedetect",
	];
	const stats = run([
		"-i",
		output,
		"-af",
		filters.join(","),
		"-f",
		"null",
		"-",
	]);
	const match = stats.match(/mean_volume: (-?[\d.]+|-inf) dB/);
	if (!match) throw new Error(stats);
	return match[1] === "-inf" ? -120 : Number(match[1]);
}

const low = tone("low", 440, 4);
const high = tone("high", 2000, 4);
const burst = tone("burst", 2000, 1);
const file = (trackId: string, pathName: string, startTime = 0): AudioFile => ({
	path: pathName,
	trackId,
	startTime,
	volume: 1,
});

describe("export audio mix", () => {
	it("leaves a neutral mix untouched", () => {
		const config = mix({ tracks: [track({ trackId: "a" })] });
		expect(isNeutralAudioMix(config)).toBe(true);
		expect(
			buildTimelineAudioFilters({
				audioFiles: [file("a", low)],
				audioStartIndex: 0,
				fps: 30,
				audioMixConfig: config,
			})
		).toEqual(
			buildTimelineAudioFilters({
				audioFiles: [file("a", low)],
				audioStartIndex: 0,
				fps: 30,
			})
		);
	});

	it("applies track gain", () => {
		const base = render({ files: [file("a", low)] });
		const quieter = render({
			files: [file("a", low)],
			config: mix({ tracks: [track({ trackId: "a", gainDb: -6 })] }),
		});
		expect(base - quieter).toBeCloseTo(6, 0);
	});

	it("routes a track through its bus and the master", () => {
		const base = render({ files: [file("a", low)] });
		const routed = render({
			files: [file("a", low)],
			config: mix({
				master: bus({ id: "master", gainDb: -2 }),
				buses: [bus({ id: "sfx", gainDb: -4 })],
				tracks: [track({ trackId: "a", busId: "sfx" })],
			}),
		});
		expect(base - routed).toBeCloseTo(6, 0);
	});

	it("silences everything outside a track solo", () => {
		const files = [file("a", low), file("b", high)];
		const lowBand = "bandpass=f=440:width_type=q:w=4";
		const together = render({
			files,
			config: mix({
				tracks: [track({ trackId: "a" }), track({ trackId: "b", gainDb: -1 })],
			}),
			measure: lowBand,
		});
		const soloed = render({
			files,
			config: mix({
				tracks: [track({ trackId: "a" }), track({ trackId: "b", solo: true })],
			}),
			measure: lowBand,
		});
		// What is left in the 440 Hz band is the 2 kHz tone leaking through the
		// measuring filter; the 440 Hz track itself is gone.
		expect(together - soloed).toBeGreaterThan(20);
	});

	it("pans hard right like the preview", () => {
		const left = render({
			files: [file("a", low)],
			config: mix({ tracks: [track({ trackId: "a", pan: 1 })] }),
			measure: "pan=mono|c0=c0",
		});
		const right = render({
			files: [file("a", low)],
			config: mix({ tracks: [track({ trackId: "a", pan: 1 })] }),
			measure: "pan=mono|c0=c1",
		});
		expect(left).toBeLessThan(-60);
		expect(right).toBeGreaterThan(-30);
	});

	it("ducks a track by the set depth only while its source sounds", () => {
		const config = mix({
			tracks: [
				track({
					trackId: "music",
					ducking: {
						enabled: true,
						sourceTrackIds: ["sfx"],
						thresholdDb: -40,
						reductionDb: -12,
						attackMs: 10,
						releaseMs: 50,
					},
				}),
				track({ trackId: "sfx" }),
			],
		});
		const files = [file("music", low), file("sfx", burst, 1.5)];
		const musicBand = "bandpass=f=440:width_type=q:w=4";
		const during = render({
			files,
			config,
			measure: musicBand,
			window: [1.7, 2.3],
		});
		const after = render({
			files,
			config,
			measure: musicBand,
			window: [3, 3.8],
		});
		const before = render({
			files,
			config,
			measure: musicBand,
			window: [0.5, 1.4],
		});
		expect(after - during).toBeCloseTo(12, 0);
		expect(Math.abs(before - after)).toBeLessThan(0.1);
	});
});
