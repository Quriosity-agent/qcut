import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N24 (2026-10-30 trailer report): replacing a clip's media took a delete
 * and an add that lost its trims and audio settings; the editor's own
 * Replace needs a file picked by hand and starts the new media from 0.
 * A `mediaId` patch now swaps the source in place.
 */

const media = vi.hoisted(() => ({
	items: [] as Array<{
		id: string;
		name: string;
		type: "video" | "audio" | "image";
		duration?: number;
	}>,
}));
vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: { getState: () => ({ mediaItems: media.items }) },
	getMediaAspectRatio: vi.fn(() => 16 / 9),
}));
vi.mock("@/lib/storage/storage-service", () => ({
	storageService: {
		saveTimeline: vi.fn(() => Promise.resolve()),
		loadTimeline: vi.fn(() => Promise.resolve(null)),
	},
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: { getState: vi.fn(() => ({ activeProject: null })) },
}));
vi.mock("@/stores/editor/editor-store", () => ({
	useEditorStore: {
		getState: vi.fn(() => ({ currentTime: 0, setCurrentTime: vi.fn() })),
	},
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { applyElementChanges } from "../claude-timeline-bridge-elements";

/** Shot 05 on the timeline: 2–7 s, reading its 10 s source from 3 s to 8 s. */
const shot: MediaElement = {
	id: "shot",
	type: "media",
	name: "05_拳域_01.mp4",
	mediaId: "old",
	startTime: 2,
	duration: 10,
	trimStart: 3,
	trimEnd: 2,
	volume: 0.5,
	audioFadeIn: 0.25,
};

function setTimeline({
	element = shot,
	locked = false,
}: {
	element?: MediaElement;
	locked?: boolean;
} = {}) {
	const tracks: TimelineTrack[] = [
		{
			id: "main",
			name: "主轨道",
			type: "media",
			isMain: true,
			muted: false,
			hidden: false,
			locked,
			elements: [element],
		},
	];
	useTimelineStore.setState({ _tracks: tracks, tracks, history: [] });
}

function clip(): MediaElement {
	return useTimelineStore.getState().tracks[0].elements[0] as MediaElement;
}

function replace(changes: Record<string, unknown>) {
	return applyElementChanges({
		elementId: "shot",
		changes: changes as never,
		pushHistory: true,
	});
}

beforeEach(() => {
	media.items = [
		{ id: "old", name: "05_拳域_01.mp4", type: "video", duration: 10 },
		{ id: "v2", name: "05_拳域_01_v2.mp4", type: "video", duration: 12 },
		{ id: "short", name: "05_short.mp4", type: "video", duration: 7.5 },
		{ id: "still", name: "05_still.png", type: "image" },
	];
	setTimeline();
});

describe("replacing a clip's media", () => {
	it("keeps the clip's place, length, in-point and settings", () => {
		expect(replace({ mediaId: "v2" })).toEqual({ applied: true });
		expect(clip()).toMatchObject({
			mediaId: "v2",
			name: "05_拳域_01_v2.mp4",
			startTime: 2,
			duration: 12,
			trimStart: 3,
			// Still reads up to 8 s, so 4 s of the 12 s file stay unused.
			trimEnd: 4,
			volume: 0.5,
			audioFadeIn: 0.25,
		});
		// One undo step brings the old media back.
		useTimelineStore.getState().undo();
		expect(clip()).toMatchObject({ mediaId: "old", duration: 10, trimEnd: 2 });
	});

	it("refuses media that ends before the clip's out-point", () => {
		const result = replace({ mediaId: "short" });
		expect(result.applied).toBe(false);
		expect(result.error).toBe(
			"05_short.mp4 is 7.500 s long, but the clip reads it from 3.000 s to 8.000 s; pick longer media, read it from an earlier point (trimStart), or shorten the clip first"
		);
		expect(clip()).toEqual(shot);
	});

	it("reads the new media from the in-point it is given", () => {
		expect(replace({ mediaId: "short", trimStart: 0 })).toEqual({
			applied: true,
		});
		expect(clip()).toMatchObject({
			mediaId: "short",
			startTime: 2,
			trimStart: 0,
			trimEnd: 2.5,
		});
	});

	it("uses the measured length while the editor has none for the file", () => {
		media.items.push({ id: "fresh", name: "fresh.mp4", type: "video" });
		expect(replace({ mediaId: "fresh", sourceDuration: 9 })).toEqual({
			applied: true,
		});
		expect(clip()).toMatchObject({ duration: 9, trimStart: 3, trimEnd: 1 });

		setTimeline();
		media.items.push({ id: "unknown", name: "unknown.mp4", type: "video" });
		expect(replace({ mediaId: "unknown" }).error).toBe(
			"The length of unknown.mp4 is not known yet; try again once the editor has read it"
		);
	});

	it("keeps a clip's own name, and puts a still in for the same span", () => {
		setTimeline({ element: { ...shot, name: "主角出场" } });
		replace({ mediaId: "still" });
		expect(clip()).toMatchObject({
			mediaId: "still",
			name: "主角出场",
			startTime: 2,
			duration: 5,
			trimStart: 0,
			trimEnd: 0,
		});
	});

	it("refuses while the clip plays stems made from the old file", () => {
		setTimeline({
			element: {
				...shot,
				audio: {
					separation: {
						enabled: true,
						status: "ready",
						stemMediaIds: { vocals: "old-vocals" },
					},
				} as MediaElement["audio"],
			},
		});
		expect(replace({ mediaId: "v2" }).error).toBe(
			"The clip's audio.separation was made from its current media; turn it off before replacing the media"
		);
		expect(clip().mediaId).toBe("old");
	});

	it("refuses on a locked track, media it does not have, and set timing", () => {
		setTimeline({ locked: true });
		expect(replace({ mediaId: "v2" }).error).toBe('Track "主轨道" is locked');

		setTimeline();
		expect(replace({ mediaId: "missing" }).error).toBe(
			"Media missing is not in the project; import it first"
		);
		expect(replace({ mediaId: "v2", trimEnd: 0, duration: 4 }).error).toBe(
			"Replace the media on its own: duration, trimEnd follow from the new media's length"
		);
		expect(replace({ mediaId: "v2", trimStart: -1 }).error).toBe(
			"trimStart must be a number of seconds, 0 or more"
		);
		media.items.push({
			id: "song",
			name: "score.mp3",
			type: "audio",
			duration: 30,
		});
		expect(replace({ mediaId: "song" }).error).toBe(
			"score.mp3 is audio; this clip's media is a picture, so it takes video or an image"
		);
		expect(clip()).toEqual(shot);
	});
});
