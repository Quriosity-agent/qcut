import type {
	AudioAutomationPoint,
	AudioMixAutomation,
	ProjectAudioMixSettings,
	TimelineTrack,
} from "@/types/timeline";
import { sampleAutomation } from "./audio-mix-automation";
import { dbToGain } from "./audio-properties";
import {
	MASTER_AUDIO_BUS_ID,
	createDefaultAudioBusEffectsSettings,
} from "./audio-mix-settings";
import {
	type AudioMixRouting,
	type TrackMixRoute,
	audioMixIsNeutral,
	resolveAudioMixRouting,
} from "./audio-mix-routing";
import {
	MIX_STRIP_DYNAMICS_STAGES,
	type MixStripNodes,
	type SetMixParameter,
	applyMixStripEffects,
	applyMixStripLevel,
	createMixStripNodes,
} from "./audio-mix-strip";

/**
 * The mixer in an in-browser export. Every clip feeds its track's strip, each
 * track its bus or the master, each bus the master: the same strips and
 * rules the editor plays through (audio-mix-strip.ts, audio-mix-routing.ts).
 *
 * Each strip's compressor and limiter delay the signal by the same lookahead
 * the clip strips do. A track that goes straight to the master while others
 * pass through a bus is delayed by one strip to match, so every sound stays
 * in time and the caller trims one fixed latency.
 *
 * Ducking in the editor measures each source track's level every animation
 * frame over the last 2048 samples, and while any source is above the
 * threshold glides the target down by the set amount. The export measures
 * the source tracks the same way from a separate render of each, then
 * schedules the same glides on the target.
 */

const DUCKING_WINDOW_FRAMES = 2_048;
const DUCKING_CHECKS_PER_SECOND = 60;

/** The project's mix for an export, or null when it changes nothing. */
export function resolveExportAudioMix({
	tracks,
	audioMix,
}: {
	tracks: TimelineTrack[];
	audioMix?: ProjectAudioMixSettings;
}): AudioMixRouting | null {
	if (!audioMix) return null;
	const routing = resolveAudioMixRouting({ tracks, audioMix });
	return audioMixIsNeutral(routing) ? null : routing;
}

function usesBuses(mix: AudioMixRouting): boolean {
	return mix.tracks.some(
		(track) => !track.silenced && track.busId !== MASTER_AUDIO_BUS_ID
	);
}

/** Lookahead stages the mix adds after the clips: track, bus, master. */
export function exportAudioMixStages(mix: AudioMixRouting): number {
	return MIX_STRIP_DYNAMICS_STAGES * (usesBuses(mix) ? 3 : 2);
}

/** Tracks whose level some audible track ducks under. */
export function duckingSourceTrackIds(mix: AudioMixRouting): string[] {
	const audible = new Set(
		mix.tracks.filter((track) => !track.silenced).map((track) => track.trackId)
	);
	const sources = new Set<string>();
	for (const track of mix.tracks) {
		if (track.silenced || !track.settings.ducking.enabled) continue;
		for (const sourceTrackId of track.settings.ducking.sourceTrackIds) {
			if (audible.has(sourceTrackId) && sourceTrackId !== track.trackId) {
				sources.add(sourceTrackId);
			}
		}
	}
	return [...sources];
}

const setOnce: SetMixParameter = (parameter, value) => {
	parameter.value = value;
};

/**
 * One track's strip on its own, for measuring the track as a ducking source.
 * Returns where its clips go; the strip feeds `context.destination`.
 */
export function connectSourceTrackStrip({
	context,
	mix,
	trackId,
}: {
	context: BaseAudioContext;
	mix: AudioMixRouting;
	trackId: string;
}): AudioNode {
	const route = mix.tracks.find((track) => track.trackId === trackId);
	const strip = createMixStripNodes({ context });
	if (route) applyTrackStrip({ strip, route });
	strip.limiterOutput.connect(context.destination);
	return strip.input;
}

function applyTrackStrip({
	strip,
	route,
}: {
	strip: MixStripNodes;
	route: TrackMixRoute;
}) {
	applyMixStripEffects({
		strip,
		effects: route.settings.effects,
		set: setOnce,
	});
	applyMixStripLevel({
		strip,
		gainDb: route.settings.gainDb,
		pan: route.settings.pan,
		silenced: route.silenced,
		set: setOnce,
	});
}

export interface DuckingSourceLevels {
	levelsDb: Float32Array;
	checkSeconds: number;
}

/**
 * The level (dB RMS of the mono mix, as the editor's meter reads it) at each
 * check: check `k` covers the window that ends `k` checks after `startFrame`.
 */
export function measureDuckingLevels({
	buffer,
	startFrame = 0,
}: {
	buffer: AudioBuffer;
	startFrame?: number;
}): DuckingSourceLevels {
	const hop = Math.max(
		1,
		Math.round(buffer.sampleRate / DUCKING_CHECKS_PER_SECOND)
	);
	const length = Math.max(0, buffer.length - startFrame);
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
		buffer.getChannelData(index)
	);
	const checks = Math.floor(length / hop) + 1;
	const levelsDb = new Float32Array(checks);
	for (let check = 0; check < checks; check += 1) {
		const end = startFrame + Math.min(length, check * hop);
		const start = Math.max(startFrame, end - DUCKING_WINDOW_FRAMES);
		let sumOfSquares = 0;
		for (let frame = start; frame < end; frame += 1) {
			let mono = 0;
			for (const samples of channels) mono += samples[frame];
			mono /= channels.length;
			sumOfSquares += mono * mono;
		}
		const power = sumOfSquares / DUCKING_WINDOW_FRAMES;
		levelsDb[check] = power > 0 ? Math.max(-120, 10 * Math.log10(power)) : -120;
	}
	return { levelsDb, checkSeconds: hop / buffer.sampleRate };
}

/**
 * Glides `duckGain` down while any source is above the threshold and back up
 * when none is, with the attack and release times the editor uses.
 * `offsetSeconds` is how far the strip's duck stage runs behind the timeline.
 */
function scheduleDucking({
	duckGain,
	route,
	sources,
	offsetSeconds,
}: {
	duckGain: AudioParam;
	route: TrackMixRoute;
	sources: Map<string, DuckingSourceLevels>;
	offsetSeconds: number;
}) {
	const ducking = route.settings.ducking;
	const levels = ducking.sourceTrackIds.flatMap((trackId) => {
		const source = sources.get(trackId);
		return source ? [source] : [];
	});
	if (!ducking.enabled || levels.length === 0) return;
	const checkSeconds = levels[0].checkSeconds;
	const checks = Math.max(...levels.map((level) => level.levelsDb.length));
	const duckedGain = dbToGain({ db: Math.min(0, ducking.reductionDb) });
	let ducked = false;
	for (let check = 0; check < checks; check += 1) {
		const loud = levels.some(
			(level) => (level.levelsDb[check] ?? -120) >= ducking.thresholdDb
		);
		if (loud === ducked) continue;
		ducked = loud;
		duckGain.setTargetAtTime(
			ducked ? duckedGain : 1,
			check * checkSeconds + offsetSeconds,
			Math.max(0.001, (ducked ? ducking.attackMs : ducking.releaseMs) / 1_000)
		);
	}
}

function scheduleCurve({
	param,
	points,
	offsetSeconds,
	toValue,
}: {
	param: AudioParam;
	points: AudioAutomationPoint[];
	offsetSeconds: number;
	toValue: (value: number) => number;
}) {
	param.setValueAtTime(toValue(points[0].value), 0);
	for (const point of points) {
		param.linearRampToValueAtTime(
			toValue(point.value),
			point.time + offsetSeconds
		);
	}
}

/**
 * Schedules a strip's level and pan curves. Level is a straight line in dB,
 * so it is sampled finely enough for straight lines in gain to follow it.
 * `offsetSeconds` is how far the strip's level stage runs behind the
 * timeline; a silenced strip keeps its level at zero.
 */
function scheduleStripAutomation({
	strip,
	automation,
	silenced,
	offsetSeconds,
}: {
	strip: MixStripNodes;
	automation?: AudioMixAutomation;
	silenced: boolean;
	offsetSeconds: number;
}) {
	if (automation?.gainDb?.length && !silenced) {
		scheduleCurve({
			param: strip.baseGain.gain,
			points: sampleAutomation({ points: automation.gainDb }),
			offsetSeconds,
			toValue: (db) => dbToGain({ db }),
		});
	}
	if (automation?.pan?.length) {
		scheduleCurve({
			param: strip.panner.pan,
			points: automation.pan,
			offsetSeconds,
			toValue: (pan) => pan,
		});
	}
}

/**
 * Builds the mix into `context` and returns where each audible track's clips
 * go. Tracks the mix silences get no input: their clips need not be rendered.
 *
 * `lookaheadSeconds` is one dynamics stage's delay and `clipStages` the
 * stages every clip passes before reaching its track.
 *
 * With `stemBusId`, only that bus's tracks are built ("master" for the tracks
 * that feed the master directly), and the master stays neutral: a stem is
 * the bus as it leaves its fader. The master strip is still in the path, so
 * a stem lines up with the full mix sample for sample.
 */
export function buildExportAudioMix({
	context,
	mix,
	duckingSources,
	lookaheadSeconds,
	clipStages,
	stemBusId,
}: {
	context: BaseAudioContext;
	mix: AudioMixRouting;
	duckingSources: Map<string, DuckingSourceLevels>;
	lookaheadSeconds: number;
	clipStages: number;
	stemBusId?: string;
}): Map<string, AudioNode> {
	const master = createMixStripNodes({ context });
	if (stemBusId === undefined) {
		applyMixStripEffects({
			strip: master,
			effects: mix.master.effects,
			set: setOnce,
		});
		applyMixStripLevel({
			strip: master,
			gainDb: mix.master.gainDb,
			pan: mix.master.pan,
			silenced: mix.master.muted,
			set: setOnce,
		});
		// The master's level stage runs behind the clips, the track strip, a
		// bus strip (tracks that skip a bus are delayed to match) and its own
		// compressor. Its fade used to be left out of the in-browser export.
		scheduleStripAutomation({
			strip: master,
			automation: mix.master.automation,
			silenced: mix.master.muted,
			offsetSeconds:
				(clipStages +
					MIX_STRIP_DYNAMICS_STAGES * (usesBuses(mix) ? 2 : 1) +
					1) *
				lookaheadSeconds,
		});
	} else {
		applyMixStripEffects({
			strip: master,
			effects: createDefaultAudioBusEffectsSettings(),
			set: setOnce,
		});
		applyMixStripLevel({
			strip: master,
			gainDb: 0,
			pan: 0,
			silenced: false,
			set: setOnce,
		});
	}
	master.limiterOutput.connect(context.destination);

	const busInputs = new Map<string, AudioNode>();
	for (const bus of mix.buses) {
		const strip = createMixStripNodes({ context });
		applyMixStripEffects({
			strip,
			effects: bus.settings.effects,
			set: setOnce,
		});
		applyMixStripLevel({
			strip,
			gainDb: bus.settings.gainDb,
			pan: bus.settings.pan,
			silenced: bus.silenced,
			set: setOnce,
		});
		// A bus's level stage runs behind the clips, the track strip and its
		// own compressor.
		scheduleStripAutomation({
			strip,
			automation: bus.settings.automation,
			silenced: bus.silenced,
			offsetSeconds:
				(clipStages + MIX_STRIP_DYNAMICS_STAGES + 1) * lookaheadSeconds,
		});
		strip.limiterOutput.connect(master.input);
		busInputs.set(bus.settings.id, strip.input);
	}

	// The compressor sits before the duck stage, so ducking runs behind the
	// timeline by the clip stages plus one.
	const duckOffsetSeconds = (clipStages + 1) * lookaheadSeconds;
	const busDelaySeconds = MIX_STRIP_DYNAMICS_STAGES * lookaheadSeconds;
	const alignDirectTracks = usesBuses(mix);
	const trackInputs = new Map<string, AudioNode>();
	for (const route of mix.tracks) {
		if (route.silenced) continue;
		if (stemBusId !== undefined && route.busId !== stemBusId) continue;
		const strip = createMixStripNodes({ context });
		applyTrackStrip({ strip, route });
		scheduleStripAutomation({
			strip,
			automation: route.settings.automation,
			silenced: false,
			offsetSeconds: duckOffsetSeconds,
		});
		scheduleDucking({
			duckGain: strip.duckGain.gain,
			route,
			sources: duckingSources,
			offsetSeconds: duckOffsetSeconds,
		});
		const busInput = busInputs.get(route.busId);
		if (busInput) {
			strip.limiterOutput.connect(busInput);
		} else if (alignDirectTracks) {
			const delay = context.createDelay(1);
			delay.delayTime.value = busDelaySeconds;
			strip.limiterOutput.connect(delay);
			delay.connect(master.input);
		} else {
			strip.limiterOutput.connect(master.input);
		}
		trackInputs.set(route.trackId, strip.input);
	}
	return trackInputs;
}
