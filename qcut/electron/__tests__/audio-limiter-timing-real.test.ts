import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildAudioEffectTransforms } from "../ffmpeg-audio-effects";
import { buildTimelineAudioFilters } from "../ffmpeg/audio-filter-graph";
import type { AudioSettings } from "../ffmpeg/audio-settings";
import { getFFmpegPath } from "../ffmpeg/paths";
import type { AudioMixBus, AudioTrackMix } from "../ffmpeg/types";

/**
 * FFmpeg's alimiter delays its output by its attack (its lookahead) unless
 * `latency=1`, and scales it so the ceiling reaches full scale unless
 * `level=0`. The export's limiters must do neither: a click below the
 * ceiling comes out on the same sample at the same level, as in the preview.
 */

const ffmpeg = getFFmpegPath();
const workDir = mkdtempSync(path.join(tmpdir(), "qcut-limiter-timing-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

const RATE = 48_000;

function run(args: string[]) {
	const result = spawnSync(
		ffmpeg,
		["-hide_banner", "-nostats", "-loglevel", "error", ...args],
		{ encoding: "utf8" }
	);
	if (result.status !== 0) throw new Error(result.stderr);
}

/** Two seconds of stereo silence with a 1 ms, −6 dBFS click from sample 48 000. */
const click = path.join(workDir, "click.wav");
const clickExpression = `if(between(n,${RATE},${RATE + 47}),0.5*cos(2*PI*1000*t),0)`;
run([
	"-y",
	"-f",
	"lavfi",
	"-i",
	`aevalsrc='${clickExpression}|${clickExpression}':s=${RATE}:d=2`,
	"-c:a",
	"pcm_f32le",
	click,
]);

/**
 * Runs `graph` (reading [0:a] or [0:a:0], ending in [x]) over the click and
 * returns the first channel as samples.
 */
function render(graph: string): Float32Array {
	const output = path.join(
		workDir,
		`out-${Math.random().toString(36).slice(2)}.f32`
	);
	run([
		"-y",
		"-i",
		click,
		"-filter_complex",
		`${graph};[x]pan=mono|c0=c0[out]`,
		"-map",
		"[out]",
		"-ar",
		String(RATE),
		"-f",
		"f32le",
		output,
	]);
	const bytes = readFileSync(output);
	return new Float32Array(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength / Float32Array.BYTES_PER_ELEMENT
	);
}

function onset(samples: Float32Array) {
	return samples.findIndex((value) => Math.abs(value) > 1e-4);
}

function peak(samples: Float32Array) {
	let max = 0;
	for (const value of samples) max = Math.max(max, Math.abs(value));
	return max;
}

const original = render("[0:a]anull[x]");

const limiter = { enabled: true, ceilingDb: -1, releaseMs: 80 };

function effects(): AudioMixBus["effects"] {
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
		limiter,
	};
}

function clipAudio(): AudioSettings {
	return {
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
		equalizer: { enabled: false, lowGainDb: 0, midGainDb: 0, highGainDb: 0 },
		compressor: {
			enabled: false,
			thresholdDb: -18,
			ratio: 3,
			attackMs: 10,
			releaseMs: 120,
			makeupGainDb: 0,
		},
		limiter: { enabled: true, ceilingDb: -1, releaseMs: 50 },
		reverb: { enabled: false, mix: 20, roomSize: 40, damping: 50 },
		echo: { enabled: false, mix: 15, delayMs: 220, feedback: 25 },
		telephone: { enabled: false, mix: 100 },
	};
}

describe("export limiters", () => {
	it("keep the original's timing and level", () => {
		expect(onset(original)).toBe(RATE);
		expect(peak(original)).toBeCloseTo(0.5, 4);
	});

	it("keep sound on its sample and level through the track and master limiters", () => {
		const track: AudioTrackMix = {
			trackId: "a",
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
		};
		const graph = buildTimelineAudioFilters({
			audioFiles: [{ path: click, trackId: "a", startTime: 0, volume: 1 }],
			audioStartIndex: 0,
			fps: 30,
			audioMixConfig: {
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
				tracks: [track],
			},
		});
		expect(graph.filterSteps.join(";").match(/alimiter=/g)).toHaveLength(2);
		const limited = render(
			`${graph.filterSteps.join(";")};${graph.mapAudio}anull[x]`
		);
		expect(onset(limited)).toBe(onset(original));
		expect(peak(limited)).toBeCloseTo(peak(original), 4);
	});

	it("keep a clip on its sample and level through its limiter", () => {
		const transforms = buildAudioEffectTransforms({
			audio: clipAudio(),
			stage: "dynamics",
		});
		expect(transforms.join(",")).toContain("alimiter=");
		const limited = render(`[0:a]${transforms.join(",")}[x]`);
		expect(onset(limited)).toBe(onset(original));
		expect(peak(limited)).toBeCloseTo(peak(original), 4);
	});
});
