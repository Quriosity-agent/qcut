import { expandCompoundMediaTracks } from "@/lib/timeline/compound-media";
import { useMediaStore } from "@/stores/media/media-store";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { renderBrowserTimelineAudio } from "./browser-audio-export";
import { type MixLoudness, measureMixLoudness } from "./mix-loudness";

/**
 * Renders the open project's audio exactly as an export would, mix included,
 * and measures it. Null when the timeline has no audio.
 */
export async function measureProjectMixLoudness(): Promise<MixLoudness | null> {
	const project = useProjectStore.getState().activeProject;
	const timeline = useTimelineStore.getState();
	const buffer = await renderBrowserTimelineAudio({
		tracks: expandCompoundMediaTracks({ tracks: timeline.tracks }),
		mediaItems: useMediaStore.getState().mediaItems,
		totalDuration: timeline.getTotalDuration(),
		fps: project?.fps ?? 30,
		audioMix: project?.audioMix,
	});
	if (!buffer) return null;
	return measureMixLoudness({
		channels: Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
			buffer.getChannelData(channel)
		),
		sampleRate: buffer.sampleRate,
	});
}
