import type {
	AudioMixBusSettings,
	ProjectAudioMixSettings,
	TimelineTrack,
	TimelineTrackAudioSettings,
} from "@/types/timeline";
import { dbToGain } from "./audio-properties";
import {
	MASTER_AUDIO_BUS_ID,
	createDefaultAudioMixBus,
	createDefaultProjectAudioMixSettings,
	createDefaultTrackAudioSettings,
} from "./audio-mix-settings";
import { resolveAudioMixRouting } from "./audio-mix-routing";
import {
	type MixStripNodes,
	type SetMixParameter,
	applyMixStripEffects,
	applyMixStripLevel,
	createMixStripNodes,
} from "./audio-mix-strip";
import {
	type AudioMeterReading,
	calculateAudioMeterReading,
} from "./audio-metering";

interface MeterTap {
	rawAnalyser: AnalyserNode;
	kWeightedAnalyser: AnalyserNode;
	rawSamples: Float32Array<ArrayBuffer>;
	kWeightedSamples: Float32Array<ArrayBuffer>;
	frequencySamples: Uint8Array<ArrayBuffer>;
}

interface ProcessingStrip extends MixStripNodes {
	meter: MeterTap;
	output: AnalyserNode;
}

interface TrackStrip extends ProcessingStrip {
	trackId: string;
	settings: TimelineTrackAudioSettings;
	muted: boolean;
	routedBusId: string;
	duckingReductionDb: number;
}

interface BusStrip extends ProcessingStrip {
	busId: string;
	settings: AudioMixBusSettings;
}

export interface AudioMixMeterSnapshot {
	master: AudioMeterReading;
	tracks: Record<string, AudioMeterReading>;
	buses: Record<string, AudioMeterReading>;
	duckingReductionDb: Record<string, number>;
}

let sharedContext: AudioContext | null = null;
let masterStrip: BusStrip | null = null;
const trackStrips = new Map<string, TrackStrip>();
const busStrips = new Map<string, BusStrip>();

function smooth({
	parameter,
	value,
	context,
	timeConstant = 0.012,
}: {
	parameter: AudioParam;
	value: number;
	context: AudioContext;
	timeConstant?: number;
}) {
	parameter.cancelScheduledValues(context.currentTime);
	parameter.setTargetAtTime(
		value,
		context.currentTime,
		Math.max(0.001, timeConstant)
	);
}

export function getAudioMixContext(): AudioContext | null {
	if (typeof window === "undefined" || !window.AudioContext) return null;
	sharedContext ??= new window.AudioContext({ latencyHint: "interactive" });
	return sharedContext;
}

function createMeterTap({
	context,
	input,
}: {
	context: AudioContext;
	input: AudioNode;
}): MeterTap {
	const rawAnalyser = context.createAnalyser();
	rawAnalyser.fftSize = 2_048;
	rawAnalyser.smoothingTimeConstant = 0.65;
	rawAnalyser.minDecibels = -90;
	rawAnalyser.maxDecibels = -10;
	input.connect(rawAnalyser);

	const kShelf = context.createBiquadFilter();
	kShelf.type = "highshelf";
	kShelf.frequency.value = 1_681.97;
	kShelf.gain.value = 4;
	const kHighpass = context.createBiquadFilter();
	kHighpass.type = "highpass";
	kHighpass.frequency.value = 38.14;
	kHighpass.Q.value = 0.5;
	const kWeightedAnalyser = context.createAnalyser();
	kWeightedAnalyser.fftSize = 2_048;
	kWeightedAnalyser.smoothingTimeConstant = 0.65;
	const silentSink = context.createGain();
	silentSink.gain.value = 0;
	input.connect(kShelf);
	kShelf.connect(kHighpass);
	kHighpass.connect(kWeightedAnalyser);
	kWeightedAnalyser.connect(silentSink);
	silentSink.connect(context.destination);

	return {
		rawAnalyser,
		kWeightedAnalyser,
		rawSamples: createSampleBuffer({ length: rawAnalyser.fftSize }),
		kWeightedSamples: createSampleBuffer({
			length: kWeightedAnalyser.fftSize,
		}),
		frequencySamples: new Uint8Array(
			rawAnalyser.frequencyBinCount
		) as Uint8Array<ArrayBuffer>,
	};
}

function createSampleBuffer({
	length,
}: {
	length: number;
}): Float32Array<ArrayBuffer> {
	return new Float32Array(length) as Float32Array<ArrayBuffer>;
}

function createProcessingStrip({
	context,
}: {
	context: AudioContext;
}): ProcessingStrip {
	const nodes = createMixStripNodes({ context });
	const meter = createMeterTap({ context, input: nodes.limiter });
	return { ...nodes, meter, output: meter.rawAnalyser };
}

function smoothly({ context }: { context: AudioContext }): SetMixParameter {
	return (parameter, value) => smooth({ parameter, value, context });
}

function ensureMasterStrip({ context }: { context: AudioContext }): BusStrip {
	if (masterStrip) return masterStrip;
	const settings = createDefaultProjectAudioMixSettings().master;
	const strip = {
		...createProcessingStrip({ context }),
		busId: MASTER_AUDIO_BUS_ID,
		settings,
	};
	strip.output.connect(context.destination);
	masterStrip = strip;
	return strip;
}

function ensureBusStrip({
	context,
	busId,
}: {
	context: AudioContext;
	busId: string;
}): BusStrip {
	const existing = busStrips.get(busId);
	if (existing) return existing;
	const settings = createDefaultAudioMixBus({ id: busId, name: busId });
	const strip = { ...createProcessingStrip({ context }), busId, settings };
	strip.output.connect(ensureMasterStrip({ context }).input);
	busStrips.set(busId, strip);
	return strip;
}

function ensureTrackStrip({
	context,
	trackId,
}: {
	context: AudioContext;
	trackId: string;
}): TrackStrip {
	const existing = trackStrips.get(trackId);
	if (existing) return existing;
	const settings = createDefaultTrackAudioSettings();
	const strip: TrackStrip = {
		...createProcessingStrip({ context }),
		trackId,
		settings,
		muted: false,
		routedBusId: MASTER_AUDIO_BUS_ID,
		duckingReductionDb: 0,
	};
	strip.output.connect(ensureMasterStrip({ context }).input);
	trackStrips.set(trackId, strip);
	return strip;
}

function readStripMeter({
	strip,
}: {
	strip: ProcessingStrip;
}): AudioMeterReading {
	strip.meter.rawAnalyser.getFloatTimeDomainData(strip.meter.rawSamples);
	strip.meter.kWeightedAnalyser.getFloatTimeDomainData(
		strip.meter.kWeightedSamples
	);
	return calculateAudioMeterReading({
		samples: strip.meter.rawSamples,
		kWeightedSamples: strip.meter.kWeightedSamples,
		gainReductionDb: Math.min(
			strip.compressor.reduction,
			strip.limiter.reduction
		),
	});
}

function routeTrack({
	strip,
	busId,
	context,
}: {
	strip: TrackStrip;
	busId: string;
	context: AudioContext;
}) {
	if (strip.routedBusId === busId) return;
	strip.output.disconnect();
	const target =
		busId === MASTER_AUDIO_BUS_ID
			? ensureMasterStrip({ context })
			: ensureBusStrip({ context, busId });
	strip.output.connect(target.input);
	strip.routedBusId = busId;
}

function updateBusStrip({
	strip,
	settings,
	silenced,
	context,
}: {
	strip: BusStrip;
	settings: AudioMixBusSettings;
	silenced: boolean;
	context: AudioContext;
}) {
	const set = smoothly({ context });
	strip.settings = settings;
	applyMixStripEffects({ strip, effects: settings.effects, set });
	applyMixStripLevel({
		strip,
		gainDb: settings.gainDb,
		pan: settings.pan,
		silenced,
		set,
	});
}

export function syncAudioMixEngine({
	tracks,
	audioMix,
}: {
	tracks: TimelineTrack[];
	audioMix?: ProjectAudioMixSettings;
}) {
	const context = getAudioMixContext();
	if (!context) return;
	const routing = resolveAudioMixRouting({ tracks, audioMix });
	updateBusStrip({
		strip: ensureMasterStrip({ context }),
		settings: routing.master,
		silenced: routing.master.muted,
		context,
	});

	const activeBusIds = new Set(routing.buses.map((bus) => bus.settings.id));
	for (const bus of routing.buses) {
		updateBusStrip({
			strip: ensureBusStrip({ context, busId: bus.settings.id }),
			settings: bus.settings,
			silenced: bus.silenced,
			context,
		});
	}
	for (const [busId, strip] of busStrips) {
		if (activeBusIds.has(busId)) continue;
		strip.input.disconnect();
		strip.output.disconnect();
		busStrips.delete(busId);
	}

	const activeTrackIds = new Set(routing.tracks.map((track) => track.trackId));
	const set = smoothly({ context });
	for (const track of routing.tracks) {
		const strip = ensureTrackStrip({ context, trackId: track.trackId });
		strip.settings = track.settings;
		strip.muted = track.silenced;
		applyMixStripEffects({ strip, effects: track.settings.effects, set });
		applyMixStripLevel({
			strip,
			gainDb: track.settings.gainDb,
			pan: track.settings.pan,
			silenced: track.silenced,
			set,
		});
		routeTrack({ strip, busId: track.busId, context });
	}
	for (const [trackId, strip] of trackStrips) {
		if (activeTrackIds.has(trackId)) continue;
		strip.input.disconnect();
		strip.output.disconnect();
		trackStrips.delete(trackId);
	}
}

function updateDucking({
	trackReadings,
	context,
}: {
	trackReadings: Record<string, AudioMeterReading>;
	context: AudioContext;
}) {
	for (const strip of trackStrips.values()) {
		const ducking = strip.settings.ducking;
		const shouldDuck =
			ducking.enabled &&
			ducking.sourceTrackIds.some(
				(sourceTrackId) =>
					(trackReadings[sourceTrackId]?.rmsDb ?? -120) >= ducking.thresholdDb
			);
		const reductionDb = shouldDuck ? Math.min(0, ducking.reductionDb) : 0;
		const timeConstant =
			(shouldDuck ? ducking.attackMs : ducking.releaseMs) / 1_000;
		strip.duckingReductionDb = reductionDb;
		smooth({
			parameter: strip.duckGain.gain,
			value: dbToGain({ db: reductionDb }),
			context,
			timeConstant,
		});
	}
}

export function readAudioMixMeters(): AudioMixMeterSnapshot | null {
	const context = getAudioMixContext();
	if (!context || !masterStrip) return null;
	const tracks: Record<string, AudioMeterReading> = {};
	const buses: Record<string, AudioMeterReading> = {};
	const duckingReductionDb: Record<string, number> = {};
	for (const [trackId, strip] of trackStrips) {
		tracks[trackId] = readStripMeter({ strip });
		duckingReductionDb[trackId] = strip.duckingReductionDb;
	}
	for (const [busId, strip] of busStrips) {
		buses[busId] = readStripMeter({ strip });
	}
	updateDucking({ trackReadings: tracks, context });
	return {
		master: readStripMeter({ strip: masterStrip }),
		tracks,
		buses,
		duckingReductionDb,
	};
}

const AUDIO_REACTIVE_BAND_RANGES = {
	bass: [20, 250],
	mid: [250, 4_000],
	treble: [4_000, 16_000],
	full: [20, 16_000],
} as const;

/** Reads normalized live energy from the source track or the project master. */
export function readAudioReactiveLevel({
	driver,
	band,
	trackId,
}: {
	driver: "source" | "timeline";
	band: "bass" | "mid" | "treble" | "full";
	trackId: string;
}): number {
	const context = getAudioMixContext();
	const strip =
		driver === "source" ? trackStrips.get(trackId) : (masterStrip ?? undefined);
	if (!context || !strip) return 0;
	const analyser = strip.meter.rawAnalyser;
	const samples = strip.meter.frequencySamples;
	analyser.getByteFrequencyData(samples);
	const [minimumHz, maximumHz] = AUDIO_REACTIVE_BAND_RANGES[band];
	const hertzPerBin = context.sampleRate / 2 / samples.length;
	const firstBin = Math.max(0, Math.floor(minimumHz / hertzPerBin));
	const lastBin = Math.min(
		samples.length - 1,
		Math.ceil(maximumHz / hertzPerBin)
	);
	let sumOfSquares = 0;
	let count = 0;
	for (let index = firstBin; index <= lastBin; index += 1) {
		const normalized = (samples[index] ?? 0) / 255;
		sumOfSquares += normalized * normalized;
		count += 1;
	}
	return count === 0 ? 0 : Math.min(1, Math.sqrt(sumOfSquares / count));
}

export function getAudioTrackInput({
	trackId,
}: {
	trackId: string;
}): AudioNode | null {
	const context = getAudioMixContext();
	if (!context) return null;
	return ensureTrackStrip({ context, trackId }).input;
}

export async function resumeAudioMixEngine(): Promise<void> {
	const context = getAudioMixContext();
	if (context?.state === "suspended") await context.resume();
}
