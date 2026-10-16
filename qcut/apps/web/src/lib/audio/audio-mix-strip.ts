import type {
	AudioBusEffectsSettings,
	AudioMixAutomation,
} from "@/types/timeline";
import { automationValueAt } from "./audio-mix-automation";
import { dbToGain } from "./audio-properties";

/**
 * The mixer's channel strip, used for every track, bus and the master: low
 * cut, eight EQ bands, high cut, compressor, makeup gain, gain, ducking, pan
 * and limiter. The live preview and the in-browser export build the same
 * strip; the preview glides each parameter to its new value while the export
 * sets it once before rendering, which is the `set` both pass in.
 */

const MAX_MIX_STRIP_EQ_BANDS = 8;

/** Compressor and limiter: each delays the signal by Chromium's lookahead. */
export const MIX_STRIP_DYNAMICS_STAGES = 2;

export interface MixStripNodes {
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
}

export type SetMixParameter = (parameter: AudioParam, value: number) => void;

/** Builds and wires a strip; its output is `limiter`. */
export function createMixStripNodes({
	context,
}: {
	context: BaseAudioContext;
}): MixStripNodes {
	const input = context.createGain();
	const lowCut = context.createBiquadFilter();
	lowCut.type = "highpass";
	const bands = Array.from({ length: MAX_MIX_STRIP_EQ_BANDS }, () =>
		context.createBiquadFilter()
	);
	const highCut = context.createBiquadFilter();
	highCut.type = "lowpass";
	const compressor = context.createDynamicsCompressor();
	const compressorMakeup = context.createGain();
	const baseGain = context.createGain();
	const duckGain = context.createGain();
	const panner = context.createStereoPanner();
	const limiter = context.createDynamicsCompressor();
	limiter.knee.value = 0;
	limiter.ratio.value = 20;
	limiter.attack.value = 0.003;

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

	return {
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
	set(strip.lowCut.frequency, equalizer.enabled ? equalizer.lowCutHz : 20);
	set(
		strip.highCut.frequency,
		equalizer.enabled ? equalizer.highCutHz : 20_000
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
	set(
		strip.compressor.threshold,
		compressor.enabled ? compressor.thresholdDb : 0
	);
	set(strip.compressor.ratio, compressor.enabled ? compressor.ratio : 1);
	set(strip.compressor.attack, compressor.attackMs / 1_000);
	set(strip.compressor.release, compressor.releaseMs / 1_000);
	set(
		strip.compressorMakeup.gain,
		compressor.enabled ? dbToGain({ db: compressor.makeupGainDb }) : 1
	);

	const limiter = effects.limiter;
	set(strip.limiter.threshold, limiter.enabled ? limiter.ceilingDb : 0);
	set(strip.limiter.ratio, limiter.enabled ? 20 : 1);
	set(strip.limiter.release, limiter.releaseMs / 1_000);
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
