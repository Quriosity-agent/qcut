import type { MediaItem } from "@/stores/media/media-store-types";
import type { TimelineTrack } from "@/types/timeline";

/** Sort keys offered by the media library toolbar, in menu order. */
export const MEDIA_LIBRARY_SORT_KEYS = [
	"importTime",
	"createdTime",
	"name",
	"type",
	"duration",
] as const;

export type MediaLibrarySort = (typeof MEDIA_LIBRARY_SORT_KEYS)[number];
export type MediaLibrarySortDirection = "asc" | "desc";

/**
 * Sorts a copy of the library. `items` must be in store order, which is the
 * order media was imported: "importTime" sorts by that position because media
 * items carry no import timestamp. "createdTime" uses the source file's
 * modification time, the closest thing to a creation date the browser
 * exposes. Ties fall back to the name so the order is stable across renders.
 */
export function sortMediaLibraryItems({
	items,
	sortBy,
	direction = "asc",
}: {
	items: MediaItem[];
	sortBy: MediaLibrarySort;
	direction?: MediaLibrarySortDirection;
}): MediaItem[] {
	const importOrder = new Map(items.map((item, index) => [item.id, index]));
	const sign = direction === "asc" ? 1 : -1;
	const byName = (left: MediaItem, right: MediaItem) =>
		left.name.localeCompare(right.name);
	const compare = (left: MediaItem, right: MediaItem): number => {
		switch (sortBy) {
			case "importTime":
				return (
					(importOrder.get(left.id) ?? 0) - (importOrder.get(right.id) ?? 0)
				);
			case "createdTime":
				return (left.file.lastModified ?? 0) - (right.file.lastModified ?? 0);
			case "duration":
				return (left.duration ?? 0) - (right.duration ?? 0);
			case "type":
				return left.type.localeCompare(right.type);
			default:
				return byName(left, right);
		}
	};
	return [...items].sort(
		(left, right) => sign * compare(left, right) || byName(left, right)
	);
}

export function getMediaUsageCounts({
	tracks,
}: {
	tracks: TimelineTrack[];
}): Map<string, number> {
	const counts = new Map<string, number>();
	for (const track of tracks) {
		for (const element of track.elements) {
			if (element.type !== "media" && element.type !== "sticker") continue;
			counts.set(element.mediaId, (counts.get(element.mediaId) ?? 0) + 1);
		}
	}
	return counts;
}

/** Formats a duration as mm:ss, or h:mm:ss past an hour, for clip badges. */
export function formatMediaDuration(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	const clock = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
	return hours > 0 ? `${hours}:${clock}` : clock;
}

/**
 * Splits a file name so its tail (extension plus a few characters) stays
 * visible while CSS truncates the head: a middle ellipsis without measuring
 * text. Short names are returned whole so they never gain an ellipsis.
 */
export function splitMediaNameForEllipsis(
	name: string,
	tailLength = 8
): { head: string; tail: string } {
	const characters = Array.from(name);
	if (characters.length <= tailLength + 4) return { head: name, tail: "" };
	return {
		head: characters.slice(0, -tailLength).join(""),
		tail: characters.slice(-tailLength).join(""),
	};
}
