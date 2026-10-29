import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyPeakDips,
	planPeakDips,
	summarizePeakDips,
} from "../claude/handlers/claude-export-handler/export-audio-peak-dips";

const SAMPLE_RATE = 1000;
let directory = "";
let file = "";

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(tmpdir(), "qcut-peak-dips-"));
	file = path.join(directory, "mix.f32");
	// One second of stereo at 0.5, the right channel inverted.
	const mix = new Float32Array(SAMPLE_RATE * 2);
	for (let frame = 0; frame < SAMPLE_RATE; frame++) {
		mix[frame * 2] = 0.5;
		mix[frame * 2 + 1] = -0.5;
	}
	await fs.writeFile(file, new Uint8Array(mix.buffer));
});

afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

async function readMix(): Promise<Float32Array> {
	const bytes = await fs.readFile(file);
	return new Float32Array(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)
	);
}

/** dB below 0.5 at a frame, on both channels. */
function loweredDb({ mix, frame }: { mix: Float32Array; frame: number }) {
	const left = -20 * Math.log10(mix[frame * 2] / 0.5);
	const right = -20 * Math.log10(-mix[frame * 2 + 1] / 0.5);
	expect(left).toBeCloseTo(right, 9);
	return left;
}

describe("peak dips", () => {
	it("brings blocks over the level down to it and one that went over further", () => {
		const round = (value: number) =>
			Number.isFinite(value) ? Number(value.toFixed(9)) : value;
		const dips = planPeakDips({
			blocks: [
				{ start: 0, end: 0.1, peakDb: -2 },
				{ start: 0.5, end: 0.6, peakDb: -3.3 },
				{ start: 0.7, end: 0.8, peakDb: -1 },
				{ start: 0.9, end: Number.POSITIVE_INFINITY, peakDb: -2.9 },
			],
			targetDb: -3,
			overDb: -1.5,
			extraDb: 0.5,
			padSeconds: 0.05,
		});
		expect(
			dips.map(({ start, end, depthDb }) => ({
				start: round(start),
				end: round(end),
				depthDb: round(depthDb),
			}))
		).toEqual([
			{ start: 0, end: 0.15, depthDb: 1 },
			{ start: 0.65, end: 0.85, depthDb: 2.5 },
			{ start: 0.85, end: Number.POSITIVE_INFINITY, depthDb: 0.1 },
		]);
	});

	it("lowers only the dipped stretch, easing in and out over 20 ms", async () => {
		await applyPeakDips({
			file,
			dips: [{ start: 0.4, end: 0.6, depthDb: 6 }],
			sampleRate: SAMPLE_RATE,
			channels: 2,
		});
		const mix = await readMix();
		for (const frame of [400, 500, 600]) {
			expect(loweredDb({ mix, frame })).toBeCloseTo(6, 6);
		}
		expect(loweredDb({ mix, frame: 390 })).toBeCloseTo(3, 6);
		expect(loweredDb({ mix, frame: 610 })).toBeCloseTo(3, 6);
		for (const frame of [0, 379, 380, 620, 621, 999]) {
			expect(mix[frame * 2]).toBe(0.5);
			expect(mix[frame * 2 + 1]).toBe(-0.5);
		}
	});

	it("keeps the deepest of overlapping dips rather than stacking them", async () => {
		await applyPeakDips({
			file,
			dips: [
				{ start: 0.2, end: 0.5, depthDb: 2 },
				{ start: 0.4, end: 0.7, depthDb: 1 },
			],
			sampleRate: SAMPLE_RATE,
			channels: 2,
		});
		const mix = await readMix();
		expect(loweredDb({ mix, frame: 450 })).toBeCloseTo(2, 6);
		expect(loweredDb({ mix, frame: 600 })).toBeCloseTo(1, 6);
	});

	it("runs a dip without an end to the end of the mix", async () => {
		await applyPeakDips({
			file,
			dips: [{ start: 0.9, end: Number.POSITIVE_INFINITY, depthDb: 1 }],
			sampleRate: SAMPLE_RATE,
			channels: 2,
		});
		const mix = await readMix();
		expect(loweredDb({ mix, frame: 999 })).toBeCloseTo(1, 6);
		expect(mix[870 * 2]).toBe(0.5);
	});

	it("totals how long the mix was lowered and the deepest stretch over every pass", () => {
		expect(
			summarizePeakDips({
				dips: [
					{ start: 0.2, end: 0.5, depthDb: 1.2 },
					{ start: 0.4, end: 0.7, depthDb: 0.4 },
					{ start: 0.2, end: 0.5, depthDb: 0.6 },
					{ start: 2.9, end: Number.POSITIVE_INFINITY, depthDb: 0.3 },
				],
				duration: 3,
			})
		).toEqual({ correctedSeconds: 0.6, maxCorrectionDb: 1.8 });
	});
});
