/**
 * Loudness of a finished mix, the way delivery specs state it (ITU-R
 * BS.1770-4, EBU R 128): integrated loudness with the -70 LUFS absolute and
 * -10 LU relative gates, the loudest momentary (400 ms) and short-term (3 s)
 * loudness, and the true peak from 4x oversampling.
 *
 * Everything streams through the samples once, in 100 ms steps, so a long
 * mix needs no extra copies.
 */

export interface MixLoudness {
	integratedLufs: number;
	maxShortTermLufs: number;
	maxMomentaryLufs: number;
	truePeakDbtp: number;
	samplePeakDb: number;
	durationSeconds: number;
}

const SILENT_LUFS = -70;
const FLOOR_DB = -120;

interface Biquad {
	b0: number;
	b1: number;
	b2: number;
	a1: number;
	a2: number;
}

/** BS.1770's K-weighting (shelf, then high-pass) at any sample rate. */
function kWeighting(sampleRate: number): [Biquad, Biquad] {
	const shelfK = Math.tan((Math.PI * 1_681.974_450_955_533) / sampleRate);
	const shelfQ = 0.707_175_236_955_419_6;
	const vh = 10 ** (3.999_843_853_973_347 / 20);
	const vb = vh ** 0.499_666_774_154_541_6;
	const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;
	const highpassK = Math.tan((Math.PI * 38.135_470_876_024_44) / sampleRate);
	const highpassQ = 0.500_327_037_323_877_3;
	const highpassA0 = 1 + highpassK / highpassQ + highpassK * highpassK;
	return [
		{
			b0: (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
			b1: (2 * (shelfK * shelfK - vh)) / shelfA0,
			b2: (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
			a1: (2 * (shelfK * shelfK - 1)) / shelfA0,
			a2: (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0,
		},
		{
			b0: 1,
			b1: -2,
			b2: 1,
			a1: (2 * (highpassK * highpassK - 1)) / highpassA0,
			a2: (1 - highpassK / highpassQ + highpassK * highpassK) / highpassA0,
		},
	];
}

/** Interpolation filter for 4x true-peak oversampling (windowed sinc). */
const OVERSAMPLING = 4;
const TAPS_PER_PHASE = 12;
const HALF_WINDOW = TAPS_PER_PHASE / 2 - 1;
const TRUE_PEAK_PHASES: number[][] = (() => {
	const length = OVERSAMPLING * TAPS_PER_PHASE;
	const centre = (length - 1) / 2;
	const taps = Array.from({ length }, (_, index) => {
		const x = (index - centre) / OVERSAMPLING;
		const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
		const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * (index + 0.5)) / length);
		return sinc * window;
	});
	return Array.from({ length: OVERSAMPLING }, (_, phase) =>
		Array.from(
			{ length: TAPS_PER_PHASE },
			(_, tap) => taps[tap * OVERSAMPLING + phase]
		)
	);
})();

function toLufs(energy: number): number {
	return energy > 0
		? Math.max(FLOOR_DB, -0.691 + 10 * Math.log10(energy))
		: FLOOR_DB;
}

function toDb(amplitude: number): number {
	return amplitude > 0
		? Math.max(FLOOR_DB, 20 * Math.log10(amplitude))
		: FLOOR_DB;
}

export function measureMixLoudness({
	channels,
	sampleRate,
}: {
	channels: Float32Array[];
	sampleRate: number;
}): MixLoudness {
	const length = Math.min(...channels.map((channel) => channel.length));
	if (channels.length === 0 || length === 0 || sampleRate <= 0) {
		return {
			integratedLufs: FLOOR_DB,
			maxShortTermLufs: FLOOR_DB,
			maxMomentaryLufs: FLOOR_DB,
			truePeakDbtp: FLOOR_DB,
			samplePeakDb: FLOOR_DB,
			durationSeconds: 0,
		};
	}
	const step = Math.max(1, Math.round(sampleRate * 0.1));
	const steps = Math.ceil(length / step);
	// Sum over channels of the K-weighted squares, per 100 ms step.
	const stepEnergy = new Float64Array(steps);
	const [shelf, highpass] = kWeighting(sampleRate);
	let samplePeak = 0;
	let truePeak = 0;
	for (const samples of channels) {
		let x1 = 0;
		let x2 = 0;
		let y1 = 0;
		let y2 = 0;
		let z1 = 0;
		let z2 = 0;
		let w1 = 0;
		let w2 = 0;
		for (let index = 0; index < length; index += 1) {
			const x = samples[index];
			const y =
				shelf.b0 * x +
				shelf.b1 * x1 +
				shelf.b2 * x2 -
				shelf.a1 * y1 -
				shelf.a2 * y2;
			x2 = x1;
			x1 = x;
			y2 = y1;
			y1 = y;
			const z =
				highpass.b0 * y +
				highpass.b1 * w1 +
				highpass.b2 * w2 -
				highpass.a1 * z1 -
				highpass.a2 * z2;
			w2 = w1;
			w1 = y;
			z2 = z1;
			z1 = z;
			stepEnergy[Math.floor(index / step)] += z * z;

			const magnitude = Math.abs(x);
			if (magnitude > samplePeak) samplePeak = magnitude;
			// The points interpolated here sit around the window's middle;
			// where those samples are not within 6 dB of the peak so far, no
			// point between them can beat it.
			const middle = Math.max(
				Math.abs(samples[index - HALF_WINDOW] ?? 0),
				Math.abs(samples[index - HALF_WINDOW - 1] ?? 0)
			);
			if (middle * 2 < truePeak) continue;
			for (const phase of TRUE_PEAK_PHASES) {
				let value = 0;
				for (let tap = 0; tap < TAPS_PER_PHASE; tap += 1) {
					value += phase[tap] * (samples[index - tap] ?? 0);
				}
				if (Math.abs(value) > truePeak) truePeak = Math.abs(value);
			}
		}
	}

	/** Mean energy of the `count` steps ending at `last`. */
	const windowEnergy = (last: number, count: number) => {
		let sum = 0;
		for (let index = last - count + 1; index <= last; index += 1) {
			sum += stepEnergy[index];
		}
		return sum / (count * step);
	};
	const blocks: number[] = [];
	let maxShortTerm = 0;
	for (let last = 0; last < steps; last += 1) {
		if (last >= 3) blocks.push(windowEnergy(last, 4));
		if (last >= 29) {
			maxShortTerm = Math.max(maxShortTerm, windowEnergy(last, 30));
		}
	}
	// Shorter than one block or window: measure what there is.
	if (blocks.length === 0) blocks.push(windowEnergy(steps - 1, steps));
	if (steps < 30) maxShortTerm = windowEnergy(steps - 1, steps);

	const audible = blocks.filter((energy) => toLufs(energy) >= SILENT_LUFS);
	const mean = (values: number[]) =>
		values.reduce((sum, value) => sum + value, 0) / values.length;
	let integrated = FLOOR_DB;
	if (audible.length > 0) {
		const relativeGate = toLufs(mean(audible)) - 10;
		const gated = audible.filter((energy) => toLufs(energy) >= relativeGate);
		integrated = toLufs(mean(gated));
	}
	return {
		integratedLufs: integrated,
		maxShortTermLufs: toLufs(maxShortTerm),
		maxMomentaryLufs: toLufs(Math.max(...blocks)),
		truePeakDbtp: toDb(Math.max(truePeak, samplePeak)),
		samplePeakDb: toDb(samplePeak),
		durationSeconds: length / sampleRate,
	};
}
