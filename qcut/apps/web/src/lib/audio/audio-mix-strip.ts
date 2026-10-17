import type {
	AudioBusEffectsSettings,
	AudioMixAutomation,
} from "@/types/timeline";
import { automationValueAt } from "./audio-mix-automation";
import { dbToGain, FLAT_CUTOFF_Q_DB } from "./audio-properties";
import {
	COMPRESSOR_KNEE_DB,
	compressorOutputGain,
	LIMITER_KNEE_DB,
	LIMITER_RATIO,
	limiterOutputGain,
} from "./dynamics-compressor-makeup";

/**
 * The mixer's channel strip, used for every track, bus and the master: low
 * cut, eight EQ bands, high cut, compressor, makeup gain, gain, ducking, pan
 * and limiter, then a gain that divides out the limiter's built-in makeup.
 * The live preview and the in-browser export build the same
 * strip; the preview glides each parameter to its new value while the export
 * sets it once before rendering, which is the `set` both pass in.
 */

const MAX_MIX_STRIP_EQ_BANDS = 8;

/** Compressor and limiter: each delays the signal by Chromium's lookahead. */
export const MIX_STRIP_DYNAMICS_STAGES = 2;

export interface MixStripNodes {
	/** Half the context's sample rate: a lowpass set here passes everything. */
	nyquist: number;
	input: GainNode;
	lowCut: BiquadFilterNode;
	bands: BiquadFilterNode[];
	highCut: BiquadFilterNode;
	compressor: DynamicsCompressorNode;
	compressorMakeup: GainNode;
	baseGain: GainNode;
	duckGain: GainNode;
	panner: StereoPannerNode;
	limiter: DynamicsCompressorNode;
	/** The strip's output: divides out the limiter's built-in makeup gain. */
	limiterOutput: GainNode;
}

export type SetMixParameter = (parameter: AudioParam, value: number) => void;

/** Builds and wires a strip; its output is `limiterOutput`. */
export function createMixStripNodes({
	context,
}: {
	context: BaseAudioContext;
}): MixStripNodes {
	const input = context.createGain();
	const lowCut = context.createBiquadFilter();
	lowCut.type = "highpass";
	lowCut.Q.value = FLAT_CUTOFF_Q_DB;
	const bands = Array.from({ length: MAX_MIX_STRIP_EQ_BANDS }, () =>
		context.createBiquadFilter()
	);
	const highCut = context.createBiquadFilter();
	highCut.type = "lowpass";
	highCut.Q.value = FLAT_CUTOFF_Q_DB;
	const compressor = context.createDynamicsCompressor();
	compressor.knee.value = COMPRESSOR_KNEE_DB;
	const compressorMakeup = context.createGain();
	const baseGain = context.createGain();
	const duckGain = context.createGain();
	const panner = context.createStereoPanner();
	const limiter = context.createDynamicsCompressor();
	limiter.knee.value = LIMITER_KNEE_DB;
	limiter.ratio.value = LIMITER_RATIO;
	limiter.attack.value = 0.003;
	const limiterOutput = context.createGain();

	input.connect(lowCut);
	let previous: AudioNode = lowCut;
	for (const band of bands) {
		previous.connect(band);
		previous = band;
	}
	previous.connect(highCut);
	highCut.connect(compressor);
	compressor.connect(compressorMakeup);
	compressorMakeup.connect(baseGain);
	baseGain.connect(duckGain);
	duckGain.connect(panner);
	panner.connect(limiter);
	limiter.connect(limiterOutput);

	return {
		nyquist: context.sampleRate / 2,
		input,
		lowCut,
		bands,
		highCut,
		compressor,
		compressorMakeup,
		baseGain,
		duckGain,
		panner,
		limiter,
		limiterOutput,
	};
}

/** Applies the strip's EQ, compressor and limiter settings. */
export function applyMixStripEffects({
	strip,
	effects,
	set,
}: {
	strip: MixStripNodes;
	effects: AudioBusEffectsSettings;
	set: SetMixParameter;
}) {
	const equalizer = effects.parametricEqualizer;
	// A highpass at 0 Hz and a lowpass at Nyquist are exact identities, so a
	// cut that is off (or at the ends of its range, as FFmpeg treats it) costs
	// nothing; a filter parked at 20 Hz / 20 kHz would still shape the band.
	set(
		strip.lowCut.frequency,
		equalizer.enabled && equalizer.lowCutHz > 20 ? equalizer.lowCutHz : 0
	);
	set(
		strip.highCut.frequency,
		equalizer.enabled && equalizer.highCutHz < 20_000
			? Math.min(equalizer.highCutHz, strip.nyquist)
			: strip.nyquist
	);
	for (const [index, node] of strip.bands.entries()) {
		const band = equalizer.enabled ? equalizer.bands[index] : undefined;
		if (!band?.enabled) {
			node.type = "peaking";
			set(node.gain, 0);
			continue;
		}
		node.type =
			band.type === "bell"
				? "peaking"
				: band.type === "low-shelf"
					? "lowshelf"
					: band.type === "high-shelf"
						? "highshelf"
						: "notch";
		set(node.frequency, band.frequencyHz);
		set(node.Q, band.q);
		set(node.gain, band.type === "notch" ? 0 : band.gainDb);
	}

	const compressor = effects.compressor;
	const compressorThresholdDb = compressor.enabled ? compressor.thresholdDb : 0;
	const compressorRatio = compressor.enabled ? compressor.ratio : 1;
	set(strip.compressor.threshold, compressorThresholdDb);
	set(strip.compressor.ratio, compressorRatio);
	set(strip.compressor.attack, compressor.attackMs / 1_000);
	set(strip.compressor.release, compressor.releaseMs / 1_000);
	set(
		strip.compressorMakeup.gain,
		compressorOutputGain({
			thresholdDb: compressorThresholdDb,
			ratio: compressorRatio,
			makeupGain: compressor.enabled
				? dbToGain({ db: compressor.makeupGainDb })
				: 1,
		})
	);

	const limiter = effects.limiter;
	const limiterThresholdDb = limiter.enabled ? limiter.ceilingDb : 0;
	const limiterRatio = limiter.enabled ? LIMITER_RATIO : 1;
	set(strip.limiter.threshold, limiterThresholdDb);
	set(strip.limiter.ratio, limiterRatio);
	set(strip.limiter.release, limiter.releaseMs / 1_000);
	set(
		strip.limiterOutput.gain,
		limiterOutputGain({ thresholdDb: limiterThresholdDb, ratio: limiterRatio })
	);
}

/** Applies the strip's gain and pan; a silenced strip passes nothing. */
export function applyMixStripLevel({
	strip,
	gainDb,
	pan,
	silenced,
	set,
}: {
	strip: MixStripNodes;
	gainDb: number;
	pan: number;
	silenced: boolean;
	set: SetMixParameter;
}) {
	set(strip.baseGain.gain, silenced ? 0 : dbToGain({ db: gainDb }));
	set(strip.panner.pan, pan);
}

/** Sets level and pan from the strip's curves at `time`, where it has them. */
export function applyMixStripAutomation({
	strip,
	automation,
	silenced,
	time,
	set,
}: {
	strip: MixStripNodes;
	automation?: AudioMixAutomation;
	silenced: boolean;
	time: number;
	set: SetMixParameter;
}) {
	if (automation?.gainDb?.length) {
		set(
			strip.baseGain.gain,
			silenced
				? 0
				: dbToGain({
						db: automationValueAt({ points: automation.gainDb, time }),
					})
		);
	}
	if (automation?.pan?.length) {
		set(strip.panner.pan, automationValueAt({ points: automation.pan, time }));
	}
}
