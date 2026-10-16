import { describe, expect, it } from "vitest";
import { analyzeFromSamples } from "../../packages/editor-core/src/audio/beat-detection-engine.js";
import { analyzeBeatSamples } from "../claude/handlers/claude-beats-handler.js";

/**
 * The main process carries a copy of the editor-core beat engine (its tsc
 * root cannot import the package). This keeps the two in step: the same
 * samples must give the same tempo, beats and downbeats.
 */
function clickTrack(bpm: number, seconds: number, rate: number): Float32Array {
	const samples = new Float32Array(Math.floor(seconds * rate));
	const step = (60 / bpm) * rate;
	for (let t = 0; t < samples.length; t += step) {
		const start = Math.floor(t);
		for (let j = 0; j < 256 && start + j < samples.length; j++) {
			samples[start + j] =
				Math.sin((2 * Math.PI * 440 * j) / rate) * 0.9 * (1 - j / 256);
		}
	}
	return samples;
}

describe("beat engine mirror", () => {
	it("the electron copy matches editor-core on a click track", () => {
		const samples = clickTrack(132, 12, 44100);
		const shared = analyzeFromSamples(samples, 44100);
		const mirrored = analyzeBeatSamples(samples, 44100);
		expect(mirrored.bpm).toBe(shared.bpm);
		expect(mirrored.confidence).toBeCloseTo(shared.confidence, 6);
		expect(mirrored.beats.map((beat) => beat.timestamp)).toEqual(
			shared.beats.map((beat) => beat.timestamp)
		);
		expect(mirrored.downbeats).toEqual(shared.downbeats);
		expect(Math.abs(shared.bpm - 132)).toBeLessThan(1);
	});
});
