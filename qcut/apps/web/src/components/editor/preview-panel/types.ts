import type { MediaItem } from "@/stores/media-store-types";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";

export interface ActiveElement {
	element: TimelineElement;
	track: TimelineTrack;
	mediaItem: MediaItem | null;
}

export interface PreviewDimensions {
	width: number;
	height: number;
}
