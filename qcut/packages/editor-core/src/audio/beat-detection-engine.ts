/**
 * Beat detection engine — pure TypeScript, no browser dependencies.
 *
 * Pipeline: onset strength (log-magnitude spectral flux) → tempo from the
 * autocorrelation of that curve, weighted by a tempo prior → beats by
 * dynamic programming along the found period (Ellis 2007) → downbeats as
 * the beat phase with the strongest onsets.
 *
 * The BPM comes from the periodicity of the whole curve, so it does not
 * depend on any peak threshold; `thresholdMultiplier` is kept in the config
 * for compatibility and has no effect on the result.
 *
 * @module @qcut/editor-core/audio/beat-detection-engine
 */

import type {
	Beat,
	BeatDetectionConfig,
	BeatDetectionResult,
	FirstOnsetResult,
	ResolvedBeatDetectionConfig,
} from "./beat-types.js";

const DEFAULT_CONFIG: ResolvedBeatDetectionConfig = {
	windowSize: 1024,
	smoothingFactor: 0.8,
	thresholdMultiplier: 1.5,
	minBeatInterval: 0.2,
	beatsPerMeasure: 4,
};

/** Analysis runs near this rate; higher input rates are decimated. */
const ANALYSIS_RATE = 22050;
const FFT_SIZE = 1024;
const HOP = 256;
/** Tempo search range and the prior that settles half/double ambiguity. */
const MIN_BPM = 50;
const MAX_BPM = 220;
const PRIOR_BPM = 120;
const PRIOR_SIGMA_OCTAVES = 1;
/** How strongly beats are held to the found period (librosa's tightness). */
const TIGHTNESS = 100;
/** The local-mean window (seconds) subtracted from the onset curve. */
const ONSET_MEAN_SECONDS = 0.5;
/**
 * A beat's strength is the strongest onset within this fraction of the beat
 * period around it (a 32nd note), not the one frame the tracker landed on:
 * the chain is laid along the period and may sit a frame off the hit, and a
 * beat the grid carried through a quiet stretch still reads 0.
 */
const STRENGTH_WINDOW_FRACTION = 1 / 16;
/** An attack counts as the clip's first onset once it reaches this share of the loudest. */
const FIRST_ONSET_THRESHOLD = 0.5;

function resolveConfig(
	config?: BeatDetectionConfig
): ResolvedBeatDetectionConfig {
	return { ...DEFAULT_CONFIG, ...config };
}

/** Average groups of `factor` samples: a cheap decimation good enough for onsets. */
function decimate(samples: Float32Array, factor: number): Float32Array {
	if (factor <= 1) return samples;
	const out = new Float32Array(Math.floor(samples.length / factor));
	for (let i = 0; i < out.length; i++) {
		let sum = 0;
		const base = i * factor;
		for (let j = 0; j < factor; j++) sum += samples[base + j];
		out[i] = sum / factor;
	}
	return out;
}

/** In-place iterative radix-2 FFT on interleaved real/imag arrays. */
function fft(re: Float64Array, im: Float64Array): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let size = 2; size <= n; size <<= 1) {
		const angle = (-2 * Math.PI) / size;
		const wRe = Math.cos(angle);
		const wIm = Math.sin(angle);
		for (let start = 0; start < n; start += size) {
			let curRe = 1;
			let curIm = 0;
			const half = size >> 1;
			for (let k = 0; k < half; k++) {
				const a = start + k;
				const b = a + half;
				const tRe = re[b] * curRe - im[b] * curIm;
				const tIm = re[b] * curIm + im[b] * curRe;
				re[b] = re[a] - tRe;
				im[b] = im[a] - tIm;
				re[a] += tRe;
				im[a] += tIm;
				const nextRe = curRe * wRe - curIm * wIm;
				curIm = curRe * wIm + curIm * wRe;
				curRe = nextRe;
			}
		}
	}
}

/**
 * Onset strength per hop: the half-wave rectified rise of the log-magnitude
 * spectrum, with its local mean removed so sustained notes do not count.
 */
function onsetStrength(
	samples: Float32Array,
	sampleRate: number
): Float64Array {
	const frames = Math.floor((samples.length - FFT_SIZE) / HOP) + 1;
	if (frames <= 0) return new Float64Array(0);
	const window = new Float64Array(FFT_SIZE);
	for (let i = 0; i < FFT_SIZE; i++) {
		window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
	}
	const bins = FFT_SIZE / 2;
	const re = new Float64Array(FFT_SIZE);
	const im = new Float64Array(FFT_SIZE);
	let previous = new Float64Array(bins);
	let current = new Float64Array(bins);
	const flux = new Float64Array(frames);
	for (let frame = 0; frame < frames; frame++) {
		const offset = frame * HOP;
		for (let i = 0; i < FFT_SIZE; i++) {
			re[i] = samples[offset + i] * window[i];
			im[i] = 0;
		}
		fft(re, im);
		let sum = 0;
		for (let k = 0; k < bins; k++) {
			const magnitude = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
			current[k] = Math.log1p(100 * magnitude);
			const rise = current[k] - previous[k];
			if (rise > 0) sum += rise;
		}
		flux[frame] = frame === 0 ? 0 : sum;
		[previous, current] = [current, previous];
	}
	// Remove the local mean so only rises above the recent level remain.
	const meanWindow = Math.max(
		1,
		Math.round((ONSET_MEAN_SECONDS * sampleRate) / HOP)
	);
	const onset = new Float64Array(frames);
	let running = 0;
	const queue: number[] = [];
	for (let i = 0; i < frames; i++) {
		queue.push(flux[i]);
		running += flux[i];
		if (queue.length > meanWindow) running -= queue.shift() as number;
		const local = running / queue.length;
		onset[i] = Math.max(0, flux[i] - local);
	}
	return onset;
}

/** Normalised autocorrelation of the mean-removed curve at lags [minLag, maxLag]. */
function autocorrelation(
	curve: Float64Array,
	minLag: number,
	maxLag: number
): Float64Array {
	const n = curve.length;
	let mean = 0;
	for (let i = 0; i < n; i++) mean += curve[i];
	mean /= n;
	const centred = new Float64Array(n);
	let energy = 0;
	for (let i = 0; i < n; i++) {
		centred[i] = curve[i] - mean;
		energy += centred[i] * centred[i];
	}
	const acf = new Float64Array(maxLag + 1);
	if (energy <= 0) return acf;
	for (let lag = minLag; lag <= maxLag; lag++) {
		let sum = 0;
		for (let i = 0; i + lag < n; i++) sum += centred[i] * centred[i + lag];
		acf[lag] = sum / energy;
	}
	return acf;
}

function tempoPrior(bpm: number): number {
	const octaves = Math.log2(bpm / PRIOR_BPM) / PRIOR_SIGMA_OCTAVES;
	return Math.exp(-0.5 * octaves * octaves);
}

/**
 * The period (in hops) whose autocorrelation, with its double and half
 * periods and the tempo prior, scores highest; refined between hops. Also
 * how far that peak stands above the autocorrelation around it.
 */
function estimateTempo(
	onset: Float64Array,
	hopsPerSecond: number
): { periodHops: number; confidence: number } {
	const minLag = Math.max(1, Math.floor((60 / MAX_BPM) * hopsPerSecond));
	const maxLag = Math.min(
		Math.ceil((60 / MIN_BPM) * hopsPerSecond),
		Math.floor(onset.length / 2)
	);
	if (maxLag <= minLag) return { periodHops: 0, confidence: 0 };
	const acf = autocorrelation(onset, minLag, maxLag);
	let bestLag = 0;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (let lag = minLag; lag <= maxLag; lag++) {
		const bpm = (60 * hopsPerSecond) / lag;
		const score = tempoPrior(bpm) * acf[lag];
		if (score > bestScore) {
			bestScore = score;
			bestLag = lag;
		}
	}
	if (bestLag === 0 || acf[bestLag] <= 0)
		return { periodHops: 0, confidence: 0 };
	// Parabolic refinement between neighbouring lags.
	const left = acf[bestLag - 1] ?? acf[bestLag];
	const right = acf[bestLag + 1] ?? acf[bestLag];
	const denominator = left - 2 * acf[bestLag] + right;
	const shift =
		denominator === 0
			? 0
			: Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / denominator));
	let background = 0;
	let count = 0;
	for (let lag = minLag; lag <= maxLag; lag++) {
		background += Math.abs(acf[lag]);
		count++;
	}
	background /= Math.max(1, count);
	const ratio = background > 0 ? acf[bestLag] / background : 0;
	// How periodic the onsets are: the autocorrelation coefficient at the
	// beat period (0.4 and above counts as fully periodic; a click track is
	// near 1, a sparse orchestral piece 0.1–0.2), discounted when the peak
	// barely stands above the surrounding lags.
	const periodicity = Math.max(0, Math.min(1, acf[bestLag] / 0.4));
	const prominence = Math.max(0, Math.min(1, (ratio - 1) / 4));
	return { periodHops: bestLag + shift, confidence: periodicity * prominence };
}

/** The strongest onset within `window` frames of `frame`. */
function peakAround(
	onset: Float64Array,
	frame: number,
	window: number
): number {
	let peak = 0;
	const last = Math.min(onset.length - 1, frame + window);
	for (let i = Math.max(0, frame - window); i <= last; i++) {
		if (onset[i] > peak) peak = onset[i];
	}
	return peak;
}

/**
 * Beat frames along `period`: dynamic programming that rewards onset
 * strength and penalises deviation from the period (Ellis 2007), then a
 * backtrace from the best-scoring end.
 */
function trackBeats(onset: Float64Array, period: number): number[] {
	const n = onset.length;
	if (n === 0 || period < 2) return [];
	let maxOnset = 0;
	for (let i = 0; i < n; i++) if (onset[i] > maxOnset) maxOnset = onset[i];
	if (maxOnset <= 0) return [];
	const minStep = Math.max(1, Math.round(period / 2));
	const maxStep = Math.round(period * 2);
	const penalty = new Float64Array(maxStep + 1);
	for (let step = minStep; step <= maxStep; step++) {
		const ratio = Math.log(step / period);
		penalty[step] = -TIGHTNESS * ratio * ratio;
	}
	const score = new Float64Array(n);
	const previous = new Int32Array(n).fill(-1);
	for (let i = 0; i < n; i++) {
		let best = 0;
		let bestFrom = -1;
		for (let step = minStep; step <= maxStep && step <= i; step++) {
			const candidate = score[i - step] + penalty[step];
			if (candidate > best) {
				best = candidate;
				bestFrom = i - step;
			}
		}
		score[i] = onset[i] / maxOnset + best;
		previous[i] = bestFrom;
	}
	// Start the backtrace from the strongest score in the last period, so a
	// trailing silence does not pull the chain to the very end.
	let end = n - 1;
	for (let i = Math.max(0, n - Math.round(period)); i < n; i++) {
		if (score[i] > score[end]) end = i;
	}
	const beats: number[] = [];
	for (let i = end; i >= 0; i = previous[i]) {
		beats.push(i);
		if (previous[i] < 0) break;
	}
	beats.reverse();
	// Drop leading and trailing beats that fall on near-silence: the chain
	// bridges gaps only to keep the period.
	const floor = 0.05;
	while (beats.length > 0 && onset[beats[0]] / maxOnset < floor) beats.shift();
	while (
		beats.length > 0 &&
		onset[beats[beats.length - 1]] / maxOnset < floor
	) {
		beats.pop();
	}
	return beats;
}

/**
 * Analyze raw PCM audio samples and detect beats.
 *
 * @param samples - Mono audio samples as Float32Array (values between -1 and 1)
 * @param sampleRate - Sample rate in Hz (e.g. 44100)
 * @param config - Optional configuration overrides
 * @returns Beat detection result with BPM, confidence, beats, and downbeats
 */
export function analyzeFromSamples(
	samples: Float32Array,
	sampleRate: number,
	config?: BeatDetectionConfig
): BeatDetectionResult {
	const cfg = resolveConfig(config);
	const duration = samples.length / sampleRate;
	const empty = { bpm: 0, confidence: 0, beats: [], downbeats: [], duration };
	// Short clips: not enough data for meaningful analysis
	if (samples.length < cfg.windowSize * 3 || sampleRate <= 0) return empty;
	const factor = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));
	const decimated = decimate(samples, factor);
	const rate = sampleRate / factor;
	const onset = onsetStrength(decimated, rate);
	const hopsPerSecond = rate / HOP;
	if (onset.length < 2 * hopsPerSecond) return empty;
	const { periodHops, confidence } = estimateTempo(onset, hopsPerSecond);
	if (periodHops <= 0) return empty;
	const bpm = Math.round(((60 * hopsPerSecond) / periodHops) * 10) / 10;
	const frames = trackBeats(onset, periodHops);
	let maxOnset = 0;
	for (let i = 0; i < onset.length; i++) {
		if (onset[i] > maxOnset) maxOnset = onset[i];
	}
	const strengthWindow = Math.max(
		1,
		Math.round(periodHops * STRENGTH_WINDOW_FRACTION)
	);
	const strengthOf = (frame: number) =>
		maxOnset > 0 ? peakAround(onset, frame, strengthWindow) / maxOnset : 0;
	// Downbeats: the beat phase whose onsets add up to the most.
	const measure = Math.max(1, Math.round(cfg.beatsPerMeasure));
	let downbeatPhase = 0;
	let bestPhaseScore = Number.NEGATIVE_INFINITY;
	for (let phase = 0; phase < measure; phase++) {
		let sum = 0;
		for (let i = phase; i < frames.length; i += measure)
			sum += strengthOf(frames[i]);
		if (sum > bestPhaseScore) {
			bestPhaseScore = sum;
			downbeatPhase = phase;
		}
	}
	const beats: Beat[] = frames.map((frame, index) => ({
		timestamp: Math.round(((frame * HOP) / rate) * 1000) / 1000,
		strength: strengthOf(frame),
		index,
		isDownbeat: index % measure === downbeatPhase,
	}));
	const downbeats = beats.filter((b) => b.isDownbeat).map((b) => b.timestamp);
	return { bpm, confidence, beats, downbeats, duration };
}

/**
 * Where a clip's sound first attacks: the earliest onset at least
 * `threshold` × the clip's strongest, moved to that attack's peak frame. The
 * time follows the beat convention (the analysis frame's start), so an onset
 * and a beat measured this way line up with each other. `time` is null when
 * nothing reaches the threshold (silence, or a clip shorter than a frame).
 */
export function detectFirstOnset(
	samples: Float32Array,
	sampleRate: number,
	{ threshold = FIRST_ONSET_THRESHOLD }: { threshold?: number } = {}
): FirstOnsetResult {
	const duration = sampleRate > 0 ? samples.length / sampleRate : 0;
	const bounded = Math.min(1, Math.max(0.05, threshold));
	const none = { time: null, strength: 0, threshold: bounded, duration };
	if (sampleRate <= 0) return none;
	const factor = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));
	const decimated = decimate(samples, factor);
	if (decimated.length < FFT_SIZE + HOP) return none;
	const rate = sampleRate / factor;
	const onset = onsetStrength(decimated, rate);
	let maxOnset = 0;
	for (let i = 0; i < onset.length; i++) {
		if (onset[i] > maxOnset) maxOnset = onset[i];
	}
	if (maxOnset <= 0) return none;
	const first = onset.findIndex((value) => value >= bounded * maxOnset);
	if (first < 0) return none;
	let peak = first;
	while (peak + 1 < onset.length && onset[peak + 1] > onset[peak]) peak++;
	return {
		time: Math.round(((peak * HOP) / rate) * 1000) / 1000,
		strength: onset[peak] / maxOnset,
		threshold: bounded,
		duration,
	};
}

/** Re-export config resolution for testing */
export { resolveConfig, DEFAULT_CONFIG };
