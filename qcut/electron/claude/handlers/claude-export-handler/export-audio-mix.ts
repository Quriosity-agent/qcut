/**
 * The project mix in a native export, from the timeline snapshot the editor
 * sends: each track's `audio` settings and `muted`, and the project's buses
 * and master (`audioMix`). Settings the snapshot lacks fall back to the
 * neutral defaults, so an older snapshot exports as before.
 *
 * @module electron/claude/handlers/claude-export-handler/export-audio-mix
 */

import { isNeutralAudioMix } from "../../../ffmpeg/audio-mix-graph.js";
import type {
	AudioBusEffects,
	AudioFile,
	AudioMixBus,
	AudioMixConfig,
	AudioTrackMix,
} from "../../../ffmpeg/types.js";
import type { ClaudeTimeline } from "../../../types/claude-api.js";
import type { ExportSegment } from "./types.js";

const MASTER_BUS_ID = "master";

function neutralEffects(): AudioBusEffects {
	return {
		parametricEqualizer: {
			enabled: false,
			lowCutHz: 20,
			highCutHz: 20_000,
			bands: [],
		},
		compressor: {
			enabled: false,
			thresholdDb: -18,
			ratio: 3,
			attackMs: 10,
			releaseMs: 120,
			makeupGainDb: 0,
		},
		limiter: { enabled: false, ceilingDb: -1, releaseMs: 50 },
	};
}

function readBus(
	bus: Partial<AudioMixBus> | undefined,
	id: string
): AudioMixBus {
	return {
		id: bus?.id ?? id,
		name: bus?.name ?? id,
		gainDb: bus?.gainDb ?? 0,
		pan: bus?.pan ?? 0,
		muted: bus?.muted === true,
		solo: bus?.solo === true,
		effects: bus?.effects ?? neutralEffects(),
		...(bus?.automation ? { automation: bus.automation } : {}),
	};
}

/** The trackId every audio input of `track` carries in a native export. */
export function nativeExportTrackId(
	track: { id?: string },
	index: number
): string {
	return track.id ?? `track-${index}`;
}

export function audioMixConfigFromTimeline(
	timeline: ClaudeTimeline
): AudioMixConfig | undefined {
	const tracks: AudioTrackMix[] = timeline.tracks.flatMap((track, index) => {
		if (track.type !== "audio" && track.type !== "media") return [];
		const audio = track.audio;
		return [
			{
				trackId: nativeExportTrackId(track, index),
				muted: track.muted === true || track.hidden === true,
				gainDb: audio?.gainDb ?? 0,
				pan: audio?.pan ?? 0,
				solo: audio?.solo === true,
				busId: audio?.busId ?? MASTER_BUS_ID,
				effects: audio?.effects ?? neutralEffects(),
				...(audio?.automation ? { automation: audio.automation } : {}),
				ducking: audio?.ducking ?? {
					enabled: false,
					sourceTrackIds: [],
					thresholdDb: -30,
					reductionDb: -12,
					attackMs: 80,
					releaseMs: 350,
				},
			},
		];
	});
	const config: AudioMixConfig = {
		master: readBus(timeline.audioMix?.master, MASTER_BUS_ID),
		buses: (timeline.audioMix?.buses ?? []).map((bus) => readBus(bus, bus.id)),
		tracks,
	};
	return isNeutralAudioMix(config) ? undefined : config;
}

/**
 * The base video's own audio, as a clip on the track its picture comes from,
 * so that track's level, pan, bus, solo and ducking apply to it too. The base
 * video is cut from one media lane; its first segment names the track.
 */
export function embeddedAudioMixInput({
	path,
	segments,
}: {
	path: string;
	segments: ExportSegment[];
}): AudioFile | null {
	const trackId = segments[0]?.trackId;
	if (!trackId) return null;
	return { path, trackId, startTime: 0, volume: 1 };
}
