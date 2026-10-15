import { describe, expect, it } from "vitest";
import { measureMixLoudness } from "../mix-loudness";

const RATE = 48_000;

function sine({
	frequency,
	peakDb,
	seconds,
	phase = 0,
}: {
	frequency: number;
	peakDb: number;
	seconds: number;
	phase?: number;
}): Float32Array {
	const amplitude = 10 ** (peakDb / 20);
	return Float32Array.from(
		{ length: Math.round(seconds * RATE) },
		(_, index) =>
			amplitude * Math.sin((2 * Math.PI * frequency * index) / RATE + phase)
	);
}

describe("mix loudness", () => {
	it("reads a stereo 1 kHz sine at -23 dBFS as -23 LUFS (EBU Tech 3341 case 1)", () => {
		const tone = sine({ frequency: 1_000, peakDb: -23, seconds: 20 });
		const loudness = measureMixLoudness({
			channels: [tone, tone],
			sampleRate: RATE,
		});
		expect(loudness.integratedLufs).toBeCloseTo(-23, 1);
		expect(loudness.maxShortTermLufs).toBeCloseTo(-23, 1);
		expect(loudness.maxMomentaryLufs).toBeCloseTo(-23, 1);
		expect(loudness.durationSeconds).toBe(20);
	});

	it("gates out silence and quiet passages from the integrated loudness", () => {
		// 10 s at -23, 10 s at -36 (13 LU below, under the relative gate), 10 s
		// of silence: only the -23 part counts (EBU Tech 3341 case 3 style).
		const loud = sine({ frequency: 1_000, peakDb: -23, seconds: 10 });
		const quiet = sine({ frequency: 1_000, peakDb: -36, seconds: 10 });
		const programme = new Float32Array(30 * RATE);
		programme.set(loud, 0);
		programme.set(quiet, 10 * RATE);
		const loudness = measureMixLoudness({
			channels: [programme, programme],
			sampleRate: RATE,
		});
		// EBU Tech 3341 allows +-0.1 LU; blocks straddling the step count.
		expect(Math.abs(loudness.integratedLufs + 23)).toBeLessThan(0.1);
	});

	it("finds the true peak between samples that the sample peak misses", () => {
		// fs/4 at 45 degrees: every sample sits at 0.707 of a 0 dBFS wave.
		const tone = sine({
			frequency: RATE / 4,
			peakDb: 0,
			seconds: 1,
			phase: Math.PI / 4,
		});
		const loudness = measureMixLoudness({
			channels: [tone, tone],
			sampleRate: RATE,
		});
		expect(loudness.samplePeakDb).toBeCloseTo(-3.01, 1);
		expect(Math.abs(loudness.truePeakDbtp)).toBeLessThan(0.3);
	});

	it("reports silence as the floor", () => {
		const loudness = measureMixLoudness({
			channels: [new Float32Array(RATE)],
			sampleRate: RATE,
		});
		expect(loudness).toMatchObject({
			integratedLufs: -120,
			truePeakDbtp: -120,
			samplePeakDb: -120,
		});
	});
});
