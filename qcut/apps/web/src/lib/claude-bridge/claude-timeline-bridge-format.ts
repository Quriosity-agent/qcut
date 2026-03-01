/**
 * Claude Timeline Bridge — Format / Query Helpers
 * Pure formatting and query utilities for timeline export.
 * Extracted from claude-timeline-bridge-helpers.ts to keep files under 800 lines.
 */

import { useMediaStore } from "@/stores/media/media-store";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import type {
	ClaudeTrack,
	ClaudeElement,
} from "../../../../../electron/types/claude-api";

/**
 * Calculate effective duration with safe trim handling
 */
export function getEffectiveDuration(element: TimelineElement): number {
	const trimStart = element.trimStart ?? 0;
	const trimEnd = element.trimEnd ?? 0;
	const effectiveDuration = element.duration - trimStart - trimEnd;
	return Math.max(0, effectiveDuration);
}

/**
 * Calculate total duration from tracks
 */
export function calculateTimelineDuration(tracks: TimelineTrack[]): number {
	let maxEndTime = 0;
	for (const track of tracks) {
		for (const element of track.elements) {
			const effectiveDuration = getEffectiveDuration(element);
			const endTime = element.startTime + effectiveDuration;
			if (endTime > maxEndTime) {
				maxEndTime = endTime;
			}
		}
	}
	return maxEndTime;
}

/**
 * Find track containing an element
 */
export function findTrackByElementId(
	tracks: TimelineTrack[],
	elementId: string
): TimelineTrack | null {
	return (
		tracks.find((track) => track.elements.some((e) => e.id === elementId)) ||
		null
	);
}

/** Check if element type is a media type (media, video, audio, image). */
export function isClaudeMediaElementType({
	type,
}: {
	type: Partial<ClaudeElement>["type"] | undefined;
}): boolean {
	return (
		type === "media" || type === "video" || type === "audio" || type === "image"
	);
}

/**
 * Format internal tracks for Claude export
 */
export function formatTracksForExport(tracks: TimelineTrack[]): ClaudeTrack[] {
	return tracks.map((track, index) => ({
		id: track.id,
		index,
		name: track.name || `Track ${index + 1}`,
		type: track.type,
		elements: track.elements.map((element) =>
			formatElementForExport(element, index)
		),
	}));
}

/**
 * Format a single element for export
 */
function formatElementForExport(
	element: TimelineElement,
	trackIndex: number
): ClaudeElement {
	const effectiveDuration = getEffectiveDuration(element);

	const baseElement: ClaudeElement = {
		id: element.id,
		trackIndex,
		startTime: element.startTime,
		endTime: element.startTime + effectiveDuration,
		duration: effectiveDuration,
		type: element.type === "markdown" ? "text" : element.type,
	};

	// Add type-specific fields
	switch (element.type) {
		case "media": {
			// Resolve the actual media file name from the store for reliable export matching
			let sourceName = element.name;
			if (element.mediaId) {
				const mediaItem = useMediaStore
					.getState()
					.mediaItems.find((item) => item.id === element.mediaId);
				if (mediaItem?.name) {
					sourceName = mediaItem.name;
				}
			}
			return {
				...baseElement,
				sourceId: element.mediaId,
				sourceName,
			};
		}
		case "text":
			return {
				...baseElement,
				content: element.content,
			};
		case "captions":
			return {
				...baseElement,
				content: element.text,
			};
		case "sticker":
			return {
				...baseElement,
				sourceId: element.stickerId,
			};
		case "remotion":
			return {
				...baseElement,
				sourceId: element.componentId,
			};
		case "markdown":
			return {
				...baseElement,
				content: element.markdownContent,
			};
		default:
			return baseElement;
	}
}
