import { describe, expect, it } from "vitest";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { TimelineTrack } from "@/types/timeline";
import {
	formatMediaDuration,
	getMediaUsageCounts,
	sortMediaLibraryItems,
	splitMediaNameForEllipsis,
	type MediaLibrarySort,
	type MediaLibrarySortDirection,
} from "../media-library-view";

function media({
	id,
	name,
	type,
	duration,
	lastModified,
}: {
	id: string;
	name: string;
	type: MediaItem["type"];
	duration: number;
	lastModified: number;
}): MediaItem {
	return {
		id,
		name,
		type,
		duration,
		file: new File([id], name, { lastModified }),
	};
}

describe("media library view data", () => {
	// Store order is import order: "b" was imported before "a".
	const items = [
		media({
			id: "b",
			name: "Beta",
			type: "video",
			duration: 4,
			lastModified: 10,
		}),
		media({
			id: "a",
			name: "Alpha",
			type: "audio",
			duration: 8,
			lastModified: 20,
		}),
	];
	const ids = (
		sortBy: MediaLibrarySort,
		direction?: MediaLibrarySortDirection
	) =>
		sortMediaLibraryItems({ items, sortBy, direction }).map((item) => item.id);

	it("sorts by name without mutating the media store order", () => {
		expect(ids("name")).toEqual(["a", "b"]);
		expect(ids("name", "desc")).toEqual(["b", "a"]);
		expect(items.map((item) => item.id)).toEqual(["b", "a"]);
	});

	it("sorts by import order, file time, duration and type in both directions", () => {
		expect(ids("importTime")).toEqual(["b", "a"]);
		expect(ids("importTime", "desc")).toEqual(["a", "b"]);
		expect(ids("createdTime")).toEqual(["b", "a"]);
		expect(ids("createdTime", "desc")).toEqual(["a", "b"]);
		expect(ids("duration")).toEqual(["b", "a"]);
		expect(ids("duration", "desc")).toEqual(["a", "b"]);
		expect(ids("type")).toEqual(["a", "b"]);
		expect(ids("type", "desc")).toEqual(["b", "a"]);
	});

	it("breaks ties by name", () => {
		const twins = [
			media({
				id: "z",
				name: "Zed",
				type: "video",
				duration: 5,
				lastModified: 1,
			}),
			media({
				id: "y",
				name: "Yak",
				type: "video",
				duration: 5,
				lastModified: 1,
			}),
		];
		expect(
			sortMediaLibraryItems({ items: twins, sortBy: "duration" }).map(
				(item) => item.id
			)
		).toEqual(["y", "z"]);
	});

	it("counts every timeline reference to a media item", () => {
		const tracks: TimelineTrack[] = [
			{
				id: "media-track",
				name: "Media",
				type: "media",
				elements: [
					{
						id: "one",
						name: "One",
						type: "media",
						mediaId: "b",
						startTime: 0,
						duration: 1,
						trimStart: 0,
						trimEnd: 0,
					},
					{
						id: "two",
						name: "Two",
						type: "media",
						mediaId: "b",
						startTime: 1,
						duration: 1,
						trimStart: 0,
						trimEnd: 0,
					},
				],
			},
		];

		expect(getMediaUsageCounts({ tracks }).get("b")).toBe(2);
		expect(getMediaUsageCounts({ tracks }).has("a")).toBe(false);
	});

	it("formats durations with two-digit minutes", () => {
		expect(formatMediaDuration(16)).toBe("00:16");
		expect(formatMediaDuration(75.9)).toBe("01:15");
		expect(formatMediaDuration(3661)).toBe("1:01:01");
		expect(formatMediaDuration(-3)).toBe("00:00");
	});

	it("keeps the tail of a long file name for a middle ellipsis", () => {
		expect(splitMediaNameForEllipsis("25_Shot21_一部手机.mp4")).toEqual({
			head: "25_Shot21_",
			tail: "一部手机.mp4",
		});
		expect(splitMediaNameForEllipsis("clip.mp4")).toEqual({
			head: "clip.mp4",
			tail: "",
		});
		expect(splitMediaNameForEllipsis(`${"😀".repeat(13)}.mp4`, 5)).toEqual({
			head: "😀".repeat(12),
			tail: "😀.mp4",
		});
	});
});
