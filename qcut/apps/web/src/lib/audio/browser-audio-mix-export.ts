import type { ProjectAudioMixSettings, TimelineTrack } from "@/types/timeline";
import { dbToGain } from "./audio-properties";
import { MASTER_AUDIO_BUS_ID } from "./audio-mix-settings";
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
	strip.limiter.connect(context.destination);
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

/**
 * Builds the mix into `context` and returns where each audible track's clips
 * go. Tracks the mix silences get no input: their clips need not be rendered.
 *
 * `lookaheadSeconds` is one dynamics stage's delay and `clipStages` the
 * stages every clip passes before reaching its track.
 */
export function buildExportAudioMix({
	context,
	mix,
	duckingSources,
	lookaheadSeconds,
	clipStages,
}: {
	context: BaseAudioContext;
	mix: AudioMixRouting;
	duckingSources: Map<string, DuckingSourceLevels>;
	lookaheadSeconds: number;
	clipStages: number;
}): Map<string, AudioNode> {
	const master = createMixStripNodes({ context });
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
	master.limiter.connect(context.destination);

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
		strip.limiter.connect(master.input);
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
		const strip = createMixStripNodes({ context });
		applyTrackStrip({ strip, route });
		scheduleDucking({
			duckGain: strip.duckGain.gain,
			route,
			sources: duckingSources,
			offsetSeconds: duckOffsetSeconds,
		});
		const busInput = busInputs.get(route.busId);
		if (busInput) {
			strip.limiter.connect(busInput);
		} else if (alignDirectTracks) {
			const delay = context.createDelay(1);
			delay.delayTime.value = busDelaySeconds;
			strip.limiter.connect(delay);
			delay.connect(master.input);
		} else {
			strip.limiter.connect(master.input);
		}
		trackInputs.set(route.trackId, strip.input);
	}
	return trackInputs;
}
