import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { clearAutoSaveTimer } from "../timeline-store-autosave";
import { useTimelineStore } from "../timeline-store";

/**
 * The timeline store's part in a media rename: every clip of the old media
 * id is pointed at the new one. It is not an edit of the clips, so a locked
 * track is repointed too and no undo step is added (undoing would point the
 * clips back at an id the project no longer has).
 */

function clip({ id, mediaId }: { id: string; mediaId: string }): MediaElement {
	return {
		id,
		name: id,
		type: "media",
		mediaId,
		duration: 2,
		startTime: 0,
		trimStart: 0,
		trimEnd: 0,
	};
}

const OLD = "media_b2xkLm1wNA";
const NEW = "media_bmV3Lm1wNA";

function tracks(): TimelineTrack[] {
	return [
		{
			id: "main",
			name: "Main",
			type: "media",
			isMain: true,
			elements: [
				clip({ id: "a", mediaId: OLD }),
				{ ...clip({ id: "b", mediaId: "media_other" }), startTime: 2 },
			],
		},
		{
			id: "locked",
			name: "Locked",
			type: "media",
			locked: true,
			elements: [clip({ id: "c", mediaId: OLD })],
		},
	] as TimelineTrack[];
}

const mediaIds = () =>
	useTimelineStore
		.getState()
		._tracks.flatMap((track) =>
			track.elements.map((element) =>
				element.type === "media" ? element.mediaId : null
			)
		);

describe("the timeline store repoints a renamed media item's clips", () => {
	beforeEach(() => {
		useTimelineStore.getState().restoreTracks(tracks());
		useTimelineStore.setState({ history: [], redoStack: [] });
	});

	afterEach(() => {
		clearAutoSaveTimer();
	});

	it("points every clip of the old id at the new one, locked tracks too, and adds no undo step", () => {
		const changed = useTimelineStore
			.getState()
			.repointMediaReferences({ fromId: OLD, toId: NEW });
		expect(changed).toBe(2);
		expect(mediaIds()).toEqual([NEW, "media_other", NEW]);
		expect(useTimelineStore.getState().history).toEqual([]);
	});

	it("leaves the timeline as it is when no clip plays the old id", () => {
		const before = useTimelineStore.getState()._tracks;
		expect(
			useTimelineStore
				.getState()
				.repointMediaReferences({ fromId: "media_gone", toId: NEW })
		).toBe(0);
		expect(useTimelineStore.getState()._tracks).toBe(before);
	});

	/**
	 * An undo step holds the tracks as they were. Undone after a rename, it
	 * would put the old id back on the timeline, for media the project no
	 * longer has under that id.
	 */
	it("repoints the undo and redo steps, so an undo does not bring the old id back", () => {
		const store = useTimelineStore.getState();
		// One undo step: the first clip is removed.
		store.removeElementFromTrack("main", "a");
		expect(useTimelineStore.getState().history).toHaveLength(1);
		expect(mediaIds()).toEqual(["media_other", OLD]);

		store.repointMediaReferences({ fromId: OLD, toId: NEW });
		useTimelineStore.getState().undo();
		// The removed clip is back, playing the renamed media.
		expect(mediaIds()).toEqual([NEW, "media_other", NEW]);
		useTimelineStore.getState().redo();
		useTimelineStore.getState().undo();
		expect(mediaIds()).toEqual([NEW, "media_other", NEW]);
	});

	it("repoints the steps even when no clip on the timeline plays the id any more", () => {
		const store = useTimelineStore.getState();
		store.removeElementFromTrack("main", "a");
		useTimelineStore.setState((state) => ({
			_tracks: state._tracks.map((track) =>
				track.id === "locked" ? { ...track, elements: [] } : track
			),
		}));
		expect(
			useTimelineStore
				.getState()
				.repointMediaReferences({ fromId: OLD, toId: NEW })
		).toBe(0);
		const [snapshot] = useTimelineStore.getState().history;
		expect(
			snapshot.tracks.flatMap((track) =>
				track.elements.map((element) =>
					element.type === "media" ? element.mediaId : null
				)
			)
		).toEqual([NEW, "media_other", NEW]);
	});

	it("can be taken back by repointing the other way", () => {
		const store = useTimelineStore.getState();
		store.repointMediaReferences({ fromId: OLD, toId: NEW });
		expect(store.repointMediaReferences({ fromId: NEW, toId: OLD })).toBe(2);
		expect(mediaIds()).toEqual([OLD, "media_other", OLD]);
	});
});
