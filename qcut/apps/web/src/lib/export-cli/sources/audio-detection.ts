/**
 * Audio source detection helper.
 *
 * Shared between export dialog UI and the CLI export pipeline so that
 * "has audio" is determined by the same logic everywhere.
 */

import type { TimelineTrack } from "@/types/timeline";
import type { MediaItem } from "@/stores/media-store-types";

export interface AudioSourceInfo {
	/** Audio elements placed on dedicated audio tracks */
	overlayAudioCount: number;
	/** Videos on media tracks that carry an audio stream */
	embeddedVideoAudioCount: number;
	/** Whether any audio source is present */
	hasAudio: boolean;
}

/**
 * Classify timeline audio candidates by source type.
 *
 * Categories:
 *   - **overlayAudio** – media elements placed on `audio`-type tracks.
 *   - **embeddedVideoAudio** – video media elements on `media`-type tracks
 *     (videos carry an audio stream; images do not).
 *
 * Image items are explicitly excluded so that an image-only timeline
 * does not show a false-positive "Include audio" toggle.
 */
export function detectAudioSources(
	tracks: TimelineTrack[],
	mediaItems: MediaItem[]
): AudioSourceInfo {
	let overlayAudioCount = 0;
	let embeddedVideoAudioCount = 0;

	for (const track of tracks) {
		for (const element of track.elements) {
			if (element.type !== "media") continue;

			if (track.type === "audio") {
				overlayAudioCount++;
			} else if (track.type === "media") {
				const mediaItem = mediaItems.find((m) => m.id === element.mediaId);
				if (mediaItem?.type === "video") {
					embeddedVideoAudioCount++;
				}
			}
		}
	}

	return {
		overlayAudioCount,
		embeddedVideoAudioCount,
		hasAudio: overlayAudioCount > 0 || embeddedVideoAudioCount > 0,
	};
}
