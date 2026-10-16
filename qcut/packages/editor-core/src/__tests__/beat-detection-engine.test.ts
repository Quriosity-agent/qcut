import { describe, it, expect } from "vitest";
import {
	analyzeFromSamples,
	detectFirstOnset,
	resolveConfig,
	DEFAULT_CONFIG,
} from "../audio/beat-detection-engine.js";
import type { BeatDetectionResult } from "../audio/beat-types.js";

/** Generate a click track: silence with periodic impulses at a given BPM */
function generateClickTrack(
	bpm: number,
	durationSec: number,
	sampleRate: number
): Float32Array {
	const totalSamples = Math.floor(durationSec * sampleRate);
	const samples = new Float32Array(totalSamples);
	const samplesPerBeat = Math.floor((60 / bpm) * sampleRate);
	const clickLength = 256; // short impulse

	for (let i = 0; i < totalSamples; i += samplesPerBeat) {
		for (let j = 0; j < clickLength && i + j < totalSamples; j++) {
			// Short sine pulse
			samples[i + j] = Math.sin((2 * Math.PI * 440 * j) / sampleRate) * 0.9;
		}
	}

	return samples;
}

/** Generate silent audio */
function generateSilence(
	durationSec: number,
	sampleRate: number
): Float32Array {
	return new Float32Array(Math.floor(durationSec * sampleRate));
}

describe("resolveConfig", () => {
	it("returns defaults when no config provided", () => {
		const cfg = resolveConfig();
		expect(cfg).toEqual(DEFAULT_CONFIG);
	});

	it("merges partial config with defaults", () => {
		const cfg = resolveConfig({ thresholdMultiplier: 2.0 });
		expect(cfg.thresholdMultiplier).toBe(2.0);
		expect(cfg.windowSize).toBe(DEFAULT_CONFIG.windowSize);
	});
});

describe("analyzeFromSamples", () => {
	const sampleRate = 44100;

	it("returns empty result for silent audio", () => {
		const samples = generateSilence(5, sampleRate);
		const result = analyzeFromSamples(samples, sampleRate);

		expect(result.beats).toHaveLength(0);
		expect(result.bpm).toBe(0);
		expect(result.confidence).toBe(0);
		expect(result.downbeats).toHaveLength(0);
		expect(result.duration).toBeCloseTo(5, 0);
	});

	it("returns empty result for very short clips", () => {
		// Less than 3 windows worth of samples
		const samples = new Float32Array(1024 * 2);
		const result = analyzeFromSamples(samples, sampleRate);

		expect(result.beats).toHaveLength(0);
		expect(result.bpm).toBe(0);
	});

	it("detects beats from a 120 BPM click track", () => {
		const samples = generateClickTrack(120, 10, sampleRate);
		const result = analyzeFromSamples(samples, sampleRate);

		// Should detect beats
		expect(result.beats.length).toBeGreaterThan(0);

		// BPM should be in the ballpark of 120 (allow ±20% due to algorithm precision)
		expect(result.bpm).toBeGreaterThan(90);
		expect(result.bpm).toBeLessThan(150);

		// Should have some confidence
		expect(result.confidence).toBeGreaterThan(0);

		// Duration should be ~10s
		expect(result.duration).toBeCloseTo(10, 0);
	});

	it("marks downbeats correctly (every 4th beat by default)", () => {
		const samples = generateClickTrack(120, 10, sampleRate);
		const result = analyzeFromSamples(samples, sampleRate);

		const downbeatBeats = result.beats.filter((b) => b.isDownbeat);
		const regularBeats = result.beats.filter((b) => !b.isDownbeat);

		// First beat should always be a downbeat
		if (result.beats.length > 0) {
			expect(result.beats[0].isDownbeat).toBe(true);
		}

		// Downbeats array should match filtered beats
		expect(result.downbeats.length).toBe(downbeatBeats.length);
	});

	it("respects custom beatsPerMeasure", () => {
		const samples = generateClickTrack(120, 10, sampleRate);
		const result = analyzeFromSamples(samples, sampleRate, {
			beatsPerMeasure: 3,
		});

		// Every 3rd beat should be a downbeat
		for (const beat of result.beats) {
			expect(beat.isDownbeat).toBe(beat.index % 3 === 0);
		}
	});

	it("beats have sequential indices", () => {
		const samples = generateClickTrack(120, 5, sampleRate);
		const result = analyzeFromSamples(samples, sampleRate);

		for (let i = 0; i < result.beats.length; i++) {
			expect(result.beats[i].index).toBe(i);
		}
	});

	it("beat timestamps are monotonically increasing", () => {
		const samples = generateClickTrack(120, 5, sampleRate);
		const result = analyzeFromSamples(samples, sampleRate);

		for (let i = 1; i < result.beats.length; i++) {
			expect(result.beats[i].timestamp).toBeGreaterThan(
				result.beats[i - 1].timestamp
			);
		}
	});

	it("beat strengths are between 0 and 1", () => {
		const samples = generateClickTrack(120, 5, sampleRate);
		const result = analyzeFromSamples(samples, sampleRate);

		for (const beat of result.beats) {
			expect(beat.strength).toBeGreaterThanOrEqual(0);
			expect(beat.strength).toBeLessThanOrEqual(1);
		}
	});

	it("respects custom thresholdMultiplier", () => {
		const samples = generateClickTrack(120, 5, sampleRate);

		const lowThreshold = analyzeFromSamples(samples, sampleRate, {
			thresholdMultiplier: 0.5,
		});
		const highThreshold = analyzeFromSamples(samples, sampleRate, {
			thresholdMultiplier: 3.0,
		});

		// Lower threshold should detect at least as many beats
		expect(lowThreshold.beats.length).toBeGreaterThanOrEqual(
			highThreshold.beats.length
		);
	});
});

/** A click track whose every `accentEvery`-th click is louder. */
function generateAccentedClickTrack({
	bpm,
	durationSec,
	sampleRate,
	accentEvery,
	phase = 0,
}: {
	bpm: number;
	durationSec: number;
	sampleRate: number;
	accentEvery: number;
	phase?: number;
}): Float32Array {
	const totalSamples = Math.floor(durationSec * sampleRate);
	const samples = new Float32Array(totalSamples);
	const samplesPerBeat = (60 / bpm) * sampleRate;
	let beat = 0;
	for (let t = 0; t < totalSamples; t += samplesPerBeat, beat += 1) {
		const start = Math.floor(t);
		const gain = (beat + phase) % accentEvery === 0 ? 0.9 : 0.25;
		for (let j = 0; j < 400 && start + j < totalSamples; j++) {
			samples[start + j] =
				Math.sin((2 * Math.PI * 440 * j) / sampleRate) * gain * (1 - j / 400);
		}
	}
	return samples;
}

/** Bursts at irregular times: loud, but with no tempo. */
function generateAperiodicBursts(durationSec: number, sampleRate: number) {
	const samples = new Float32Array(Math.floor(durationSec * sampleRate));
	let seed = 7;
	const random = () => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed / 2147483648;
	};
	let t = 0.1;
	while (t < durationSec - 0.5) {
		const start = Math.floor(t * sampleRate);
		for (let j = 0; j < 400 && start + j < samples.length; j++) {
			samples[start + j] = Math.sin((2 * Math.PI * 330 * j) / sampleRate) * 0.8;
		}
		t += 0.23 + random() * 1.1;
	}
	return samples;
}

describe("tempo from periodicity", () => {
	// Above about 165 BPM a track of identical clicks is as well explained by
	// half the tempo, and the prior (centred on 120) picks the slower reading.
	it.each([
		86, 120, 144, 160,
	])("finds %i BPM within a beat per minute, whatever the threshold", (bpm) => {
		const track = generateClickTrack(bpm, 20, 44100);
		const loose = analyzeFromSamples(track, 44100, {
			thresholdMultiplier: 0.7,
		});
		const strict = analyzeFromSamples(track, 44100, {
			thresholdMultiplier: 1.5,
		});
		expect(Math.abs(loose.bpm - bpm)).toBeLessThan(1);
		expect(strict.bpm).toBe(loose.bpm);
		expect(loose.confidence).toBeGreaterThan(0.9);
		// One beat per click, give or take the ends.
		expect(Math.abs(loose.beats.length - (20 * bpm) / 60)).toBeLessThan(3);
	});

	it("puts the downbeats on the accented clicks", () => {
		const result = analyzeFromSamples(
			generateAccentedClickTrack({
				bpm: 120,
				durationSec: 16,
				sampleRate: 44100,
				accentEvery: 4,
				phase: 2,
			}),
			44100
		);
		expect(result.bpm).toBeCloseTo(120, 0);
		// Accents fall every 4 beats starting at beat 2 (t = 1.0 s): the
		// downbeats are those, not simply every 4th detected beat from the start.
		const accentTimes = result.downbeats.map(
			(time) => (((time - 1) % 2) + 2) % 2
		);
		for (const offset of accentTimes) {
			expect(Math.min(offset, 2 - offset)).toBeLessThan(0.08);
		}
		expect(result.downbeats.length).toBeGreaterThan(5);
	});

	it("reports low confidence when there is no tempo to find", () => {
		const result = analyzeFromSamples(
			generateAperiodicBursts(20, 44100),
			44100
		);
		expect(result.confidence).toBeLessThan(0.3);
	});
});

/** Silence with one decaying sine hit at `at` seconds of the given amplitude. */
function hitAt({
	samples,
	at,
	amplitude,
	sampleRate,
}: {
	samples: Float32Array;
	at: number;
	amplitude: number;
	sampleRate: number;
}) {
	const start = Math.floor(at * sampleRate);
	for (let i = 0; i < 2048 && start + i < samples.length; i++) {
		samples[start + i] =
			Math.sin((2 * Math.PI * 880 * i) / sampleRate) *
			amplitude *
			(1 - i / 2048);
	}
}

describe("beat strength", () => {
	it("reads every click of a click track as a strong beat", () => {
		const result = analyzeFromSamples(
			generateClickTrack(120, 10, 44100),
			44100
		);
		expect(result.beats.length).toBeGreaterThan(10);
		for (const beat of result.beats) {
			expect(beat.strength).toBeGreaterThan(0.5);
		}
	});
});

describe("detectFirstOnset", () => {
	it("finds nothing in silence or in a clip shorter than a frame", () => {
		expect(detectFirstOnset(generateSilence(2, 44100), 44100).time).toBeNull();
		expect(detectFirstOnset(new Float32Array(512), 44100).time).toBeNull();
	});

	it("puts the onset where the hit is, at the beat engine's frame resolution", () => {
		const samples = generateSilence(1, 44100);
		hitAt({ samples, at: 0.3, amplitude: 0.9, sampleRate: 44100 });
		const onset = detectFirstOnset(samples, 44100);
		expect(onset.time).not.toBeNull();
		expect(Math.abs((onset.time ?? 0) - 0.3)).toBeLessThan(0.04);
		expect(onset.strength).toBeCloseTo(1, 6);
		expect(onset.threshold).toBe(0.5);
		expect(onset.duration).toBe(1);
	});

	it("skips a quiet pre-roll and takes the first attack that reaches the threshold", () => {
		const samples = generateSilence(1.5, 44100);
		hitAt({ samples, at: 0.1, amplitude: 0.05, sampleRate: 44100 });
		hitAt({ samples, at: 0.8, amplitude: 0.9, sampleRate: 44100 });
		expect(
			Math.abs((detectFirstOnset(samples, 44100).time ?? 0) - 0.8)
		).toBeLessThan(0.04);
		// A low threshold accepts the quiet tick.
		expect(
			Math.abs(
				(detectFirstOnset(samples, 44100, { threshold: 0.1 }).time ?? 0) - 0.1
			)
		).toBeLessThan(0.04);
	});
});
