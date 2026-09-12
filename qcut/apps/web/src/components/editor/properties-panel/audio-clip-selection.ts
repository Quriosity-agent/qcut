import type { MediaItem } from "@/stores/media/media-store-types";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";

/**
 * Whether a selected clip gets the audio panel. Audio media always does;
 * so does any media clip on an audio lane, because detached audio keeps
 * its video's media item and only the lane says it is audio.
 */
export function isAudioClipSelection({
	element,
	track,
	mediaItem,
}: {
	element: TimelineElement;
	track: TimelineTrack | undefined;
	mediaItem: MediaItem | undefined;
}): boolean {
	if (element.type !== "media") return false;
	return mediaItem?.type === "audio" || track?.type === "audio";
}
