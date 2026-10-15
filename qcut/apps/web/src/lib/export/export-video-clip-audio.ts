import { resolveExportAudioMix } from "@/lib/audio/browser-audio-mix-export";
import type { ProjectAudioMixSettings, TimelineTrack } from "@/types/timeline";

/**
 * Whether an FFmpeg export takes the video clips' own audio as audio inputs.
 *
 * A direct-copy export copies the video stream and, with nothing else to
 * mix, keeps its audio along with it. Once there are audio tracks, or a mix
 * to apply, the audio is built from the inputs alone, so the clips' own
 * audio has to be one of them or it is lost.
 */
export function shouldExportVideoClipAudio({
	optimizationStrategy,
	tracks,
	audioMix,
}: {
	optimizationStrategy?: string;
	tracks: TimelineTrack[];
	audioMix?: ProjectAudioMixSettings;
}): boolean {
	if (optimizationStrategy !== "direct-copy") return true;
	const hasAudioTracks = tracks.some(
		(track) =>
			track.type === "audio" &&
			track.muted !== true &&
			track.elements.some(
				(element) => element.type === "media" && !element.hidden
			)
	);
	return hasAudioTracks || resolveExportAudioMix({ tracks, audioMix }) !== null;
}
