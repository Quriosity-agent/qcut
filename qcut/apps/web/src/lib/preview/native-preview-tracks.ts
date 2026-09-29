import { getTimelineElementEndTime } from "@/lib/timeline";
import type { TimelineTrack } from "@/types/timeline";

export function selectNativePreviewTracks({
	tracks,
	timelineTime,
	fps,
}: {
	tracks: TimelineTrack[];
	timelineTime: number;
	fps: number;
}): TimelineTrack[] {
	if (!Number.isFinite(timelineTime) || !Number.isFinite(fps) || fps <= 0)
		return tracks;
	return tracks.map((track) => {
		// Export's transition graph needs its source chain, including adjacent clips.
		const keepTransitionChain = (track.transitions?.length ?? 0) > 0;
		return {
			...track,
			// Keep indices: native layers use trackOrder and elementOrder for stacking.
			elements: track.elements.map((element) => {
				if (element.hidden) return element;
				const isActive =
					timelineTime >= element.startTime &&
					timelineTime < getTimelineElementEndTime({ element, fps });
				return !track.hidden && (keepTransitionChain || isActive)
					? element
					: { ...element, hidden: true };
			}),
		};
	});
}
