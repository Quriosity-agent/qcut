/**
 * Sticker Timeline Query
 *
 * Provides synchronous lookups for sticker timing from the timeline store.
 * The timeline is the source of truth for WHEN stickers appear.
 * The overlay store is the source of truth for WHERE/HOW they look.
 */

import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { StickerElement } from "@/types/timeline";

export interface StickerTiming {
	startTime: number;
	endTime: number;
}

/**
 * Build a Map of stickerId → timing from all sticker elements in the timeline.
 * Accounts for trimStart/trimEnd when calculating effective timing.
 */
export function getStickerTimingMap(): Map<string, StickerTiming> {
	const timingMap = new Map<string, StickerTiming>();
	const store = useTimelineStore.getState();

	for (const track of store._tracks) {
		if (track.type !== "sticker") continue;

		for (const element of track.elements) {
			if (element.type !== "sticker") continue;

			const stickerEl = element as StickerElement;
			const startTime = stickerEl.startTime + stickerEl.trimStart;
			const endTime =
				stickerEl.startTime + stickerEl.duration - stickerEl.trimEnd;

			timingMap.set(stickerEl.stickerId, { startTime, endTime });
		}
	}

	return timingMap;
}

/**
 * Get timing for a single sticker by its overlay store ID.
 * Returns null if sticker is not on the timeline.
 */
export function getStickerTiming(stickerId: string): StickerTiming | null {
	const store = useTimelineStore.getState();

	for (const track of store._tracks) {
		if (track.type !== "sticker") continue;

		for (const element of track.elements) {
			if (element.type !== "sticker") continue;

			const stickerEl = element as StickerElement;
			if (stickerEl.stickerId === stickerId) {
				return {
					startTime: stickerEl.startTime + stickerEl.trimStart,
					endTime: stickerEl.startTime + stickerEl.duration - stickerEl.trimEnd,
				};
			}
		}
	}

	return null;
}
