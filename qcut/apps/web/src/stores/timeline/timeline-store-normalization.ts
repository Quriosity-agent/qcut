/**
 * Timeline Store Normalization
 *
 * Pure functions for normalizing timeline elements and tracks on load.
 * Ensures markdown elements have all required defaults.
 *
 * @module stores/timeline-store-normalization
 */

import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import { clampMarkdownDuration } from "@/lib/markdown";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";

export function normalizeMarkdownElement({
	element,
}: {
	element: TimelineElement;
}): TimelineElement {
	if (element.type !== "markdown") {
		return element;
	}

	return {
		...element,
		markdownContent: element.markdownContent ?? "",
		theme: element.theme ?? "dark",
		fontSize: element.fontSize ?? 18,
		fontFamily: element.fontFamily ?? "Arial",
		padding: element.padding ?? 16,
		backgroundColor: element.backgroundColor ?? "rgba(0, 0, 0, 0.85)",
		textColor: element.textColor ?? "#ffffff",
		scrollMode: element.scrollMode ?? "static",
		scrollSpeed: element.scrollSpeed ?? 30,
		x: element.x ?? 0,
		y: element.y ?? 0,
		width: element.width ?? 720,
		height: element.height ?? 420,
		rotation: element.rotation ?? 0,
		opacity: element.opacity ?? 1,
		duration: clampMarkdownDuration({
			duration:
				element.duration ?? TIMELINE_CONSTANTS.MARKDOWN_DEFAULT_DURATION,
		}),
	};
}

export function normalizeLoadedTracks({
	tracks,
}: {
	tracks: TimelineTrack[];
}): TimelineTrack[] {
	return tracks.map((track) => ({
		...track,
		elements: track.elements.map((element) =>
			normalizeMarkdownElement({ element })
		),
	}));
}
