import type {
	AudioBusEffectsSettings,
	AudioMixBusSettings,
	ProjectAudioMixSettings,
	TimelineTrack,
	TimelineTrackAudioSettings,
} from "@/types/timeline";
import {
	MASTER_AUDIO_BUS_ID,
	normalizeProjectAudioMixSettings,
	normalizeTrackAudioSettings,
} from "./audio-mix-settings";
import { hasAutomation } from "./audio-mix-automation";

/**
 * Who is heard and where it goes. The live preview (audio-mix-engine.ts) and
 * the in-browser export (browser-audio-mix-export.ts) both follow these rules,
 * so an export sounds like the editor:
 *
 * - a track is silent when it is muted, when another track is soloed and it
 *   is not, or when a bus is soloed and the track's bus is not;
 * - a track feeds its bus when that bus exists, otherwise the master;
 * - a bus is silent when it is muted, or when another bus is soloed and it is
 *   not.
 */

export interface TrackMixRoute {
	trackId: string;
	settings: TimelineTrackAudioSettings;
	silenced: boolean;
	/** The bus the track feeds: an existing bus, or the master. */
	busId: string;
}

export interface BusMixRoute {
	settings: AudioMixBusSettings;
	silenced: boolean;
}

export interface AudioMixRouting {
	master: AudioMixBusSettings;
	buses: BusMixRoute[];
	tracks: TrackMixRoute[];
}

export function resolveAudioMixRouting({
	tracks,
	audioMix,
}: {
	tracks: TimelineTrack[];
	audioMix?: Partial<ProjectAudioMixSettings>;
}): AudioMixRouting {
	const mix = normalizeProjectAudioMixSettings({ audioMix });
	const anyBusSolo = mix.buses.some((bus) => bus.solo);
	const audioTracks = tracks.filter(
		(track) => track.type === "audio" || track.type === "media"
	);
	const anyTrackSolo = audioTracks.some((track) => track.audio?.solo === true);
	return {
		master: mix.master,
		buses: mix.buses.map((bus) => ({
			settings: bus,
			silenced: bus.muted || (anyBusSolo && !bus.solo),
		})),
		tracks: audioTracks.map((track) => {
			const settings = normalizeTrackAudioSettings({ audio: track.audio });
			const routedBus = mix.buses.find((bus) => bus.id === settings.busId);
			return {
				trackId: track.id,
				settings,
				silenced:
					track.muted === true ||
					(anyTrackSolo && !settings.solo) ||
					(anyBusSolo && routedBus?.solo !== true),
				busId: routedBus?.id ?? MASTER_AUDIO_BUS_ID,
			};
		}),
	};
}

function effectsAreNeutral(effects: AudioBusEffectsSettings): boolean {
	const equalizer = effects.parametricEqualizer;
	const equalizerActive =
		equalizer.enabled &&
		(equalizer.lowCutHz > 20 ||
			equalizer.highCutHz < 20_000 ||
			equalizer.bands.some(
				(band) => band.enabled && (band.type === "notch" || band.gainDb !== 0)
			));
	return (
		!equalizerActive && !effects.compressor.enabled && !effects.limiter.enabled
	);
}

function busIsNeutral(bus: AudioMixBusSettings): boolean {
	return (
		!hasAutomation(bus.automation) &&
		bus.gainDb === 0 &&
		bus.pan === 0 &&
		!bus.muted &&
		!bus.solo &&
		effectsAreNeutral(bus.effects)
	);
}

/**
 * Whether the mix changes nothing: no level, pan, solo, effect, bus or
 * ducking differs from the defaults. Muted tracks do not count; exports leave
 * them out either way.
 */
export function audioMixIsNeutral(routing: AudioMixRouting): boolean {
	return (
		busIsNeutral(routing.master) &&
		routing.buses.every((bus) => busIsNeutral(bus.settings)) &&
		routing.tracks.every(
			({ settings, busId }) =>
				busId === MASTER_AUDIO_BUS_ID &&
				!hasAutomation(settings.automation) &&
				settings.gainDb === 0 &&
				settings.pan === 0 &&
				!settings.solo &&
				!settings.ducking.enabled &&
				effectsAreNeutral(settings.effects)
		)
	);
}
