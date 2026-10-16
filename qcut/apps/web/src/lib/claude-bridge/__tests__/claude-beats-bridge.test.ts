import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAutoSaveTimer } from "@/stores/timeline/timeline-store-autosave";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { useBeatDetectionStore } from "@/stores/beat-detection-store";
import { type MediaItem, useMediaStore } from "@/stores/media/media-store";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { performBeatsMark, performSnapToBeats } from "../claude-beats-bridge";

/**
 * Beats over the editor API on the real timeline and beat stores: a marked
 * clip's beats land in the store the beat panel reads, and clips snap onto
 * them through the store's own move.
 */

const projectMocks = vi.hoisted(() => ({
	bookmarks: [] as number[],
	toggleBookmark: vi.fn(async (time: number) => {
		projectMocks.bookmarks.push(time);
	}),
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: () => ({
			loadedProjectId: "project-1",
			activeProject: {
				id: "project-1",
				fps: 30,
				bookmarks: projectMocks.bookmarks,
			},
			isBookmarked: (time: number) =>
				projectMocks.bookmarks.some((mark) => Math.abs(mark - time) < 0.001),
			toggleBookmark: projectMocks.toggleBookmark,
		}),
	},
}));
vi.mock("@/lib/debug/debug-config", () => ({
	debugError: vi.fn(),
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
}));

function clip({
	id,
	startTime,
	duration,
	trimStart = 0,
}: {
	id: string;
	startTime: number;
	duration: number;
	trimStart?: number;
}): MediaElement {
	return {
		id,
		name: id,
		type: "media",
		mediaId: `${id}-media`,
		startTime,
		duration,
		trimStart,
		trimEnd: 0,
	};
}

const detection = {
	bpm: 120,
	confidence: 0.9,
	duration: 20,
	beats: [0.5, 1, 1.5, 2, 2.5, 3].map((timestamp, index) => ({
		timestamp,
		strength: 1,
		index,
		isDownbeat: index % 4 === 0,
	})),
	downbeats: [0.5, 2.5],
};

describe("beats over the editor API", () => {
	beforeEach(() => {
		projectMocks.bookmarks.length = 0;
		projectMocks.toggleBookmark.mockClear();
		useBeatDetectionStore.setState({ cache: new Map(), activeElementId: null });
		const tracks: TimelineTrack[] = [
			{
				id: "music",
				name: "Music",
				type: "audio",
				// The song starts at 10 s on the timeline, trimmed by 0.5 s.
				elements: [
					clip({ id: "song", startTime: 10, duration: 20, trimStart: 0.5 }),
				],
			},
			{
				id: "cuts",
				name: "Cuts",
				type: "media",
				isMain: true,
				elements: [
					clip({ id: "a", startTime: 10.3, duration: 1 }),
					clip({ id: "b", startTime: 11.9, duration: 1 }),
					clip({ id: "far", startTime: 15, duration: 1 }),
				],
			},
		];
		useTimelineStore.setState({
			_tracks: tracks,
			tracks,
			history: [],
			redoStack: [],
			selectedElements: [],
		});
	});
	afterEach(() => {
		clearAutoSaveTimer();
		useMediaStore.setState({ mediaItems: [] });
	});

	it("marks a clip's beats in the beat store and bookmarks the downbeats", async () => {
		const response = await performBeatsMark({
			request: {
				projectId: "project-1",
				elementId: "song",
				result: detection,
				bookmarks: "downbeats",
			},
		});
		expect(useBeatDetectionStore.getState().cache.get("song")).toEqual(
			detection
		);
		expect(useBeatDetectionStore.getState().activeElementId).toBe("song");
		// Source 0.5 s is the clip's trimmed start: timeline 10 s; 2.5 s → 12 s.
		expect(response.beats.map((beat) => beat.timelineTime)).toEqual([
			10, 10.5, 11, 11.5, 12, 12.5,
		]);
		expect(response.onTimeline).toBe(6);
		expect(response.bookmarksAdded).toBe(2);
		expect(projectMocks.bookmarks).toEqual([10, 12]);
	});

	it("snaps clips onto the marked beats and reports the moves", async () => {
		await performBeatsMark({
			request: { projectId: "project-1", elementId: "song", result: detection },
		});
		const response = performSnapToBeats({
			request: { projectId: "project-1", elementIds: ["a", "b", "far"] },
		});
		expect(response.beatsElementId).toBe("song");
		const byId = Object.fromEntries(
			response.results.map((r) => [r.elementId, r])
		);
		expect(byId.a).toMatchObject({
			from: 10.3,
			to: 10.5,
			beat: 10.5,
			applied: true,
		});
		expect(byId.b).toMatchObject({
			from: 11.9,
			to: 12,
			beat: 12,
			applied: true,
		});
		expect(byId.far).toMatchObject({ applied: false, beat: null });
		expect(byId.far.reason).toContain("no beat within 0.5 s");
		expect(response.moved).toBe(2);
		const cuts = useTimelineStore
			.getState()
			.tracks.find((t) => t.id === "cuts");
		expect(cuts?.elements.map((e) => e.startTime)).toEqual([10.5, 12, 15]);
		// One undo step for the whole snap.
		expect(useTimelineStore.getState().history).toHaveLength(1);
	});

	it("dry runs report without moving and refuse when nothing is marked", () => {
		expect(() =>
			performSnapToBeats({
				request: { projectId: "project-1", elementIds: ["a"] },
			})
		).toThrow("No clip has marked beats");
		useBeatDetectionStore.setState({
			cache: new Map([["song", detection]]),
			activeElementId: "song",
		});
		const response = performSnapToBeats({
			request: { projectId: "project-1", elementIds: ["a"], dryRun: true },
		});
		expect(response.results[0]).toMatchObject({ to: 10.5, applied: false });
		expect(
			useTimelineStore.getState().tracks.find((t) => t.id === "cuts")
				?.elements[0].startTime
		).toBe(10.3);
	});

	it("lands visual clips on a whole frame and leaves sound exactly on the beat", () => {
		// Beats at 10.513 and 12.013 on the timeline (song at 10, trimmed 0.5).
		useBeatDetectionStore.setState({
			cache: new Map([
				[
					"song",
					{
						...detection,
						beats: [1.013, 2.513].map((timestamp, index) => ({
							timestamp,
							strength: 1,
							index,
							isDownbeat: index === 0,
						})),
						downbeats: [1.013],
					},
				],
			]),
			activeElementId: "song",
		});
		useMediaStore.setState({
			mediaItems: [{ id: "b-media", type: "audio" }] as unknown as MediaItem[],
		});
		const byDefault = performSnapToBeats({
			request: { projectId: "project-1", elementIds: ["a", "b"], dryRun: true },
		});
		expect(byDefault.frameAlign).toBe("visual");
		const [a, b] = byDefault.results;
		// 10.513 × 30 = 315.39 → frame 315 → 10.5.
		expect(a).toMatchObject({ to: 10.5, beat: 10.513, frameAligned: true });
		expect(b).toMatchObject({ to: 12.013, beat: 12.013, frameAligned: false });
		const all = performSnapToBeats({
			request: {
				projectId: "project-1",
				elementIds: ["b"],
				frameAlign: "all",
				dryRun: true,
			},
		});
		expect(all.results[0]).toMatchObject({ to: 12, frameAligned: true });
		const none = performSnapToBeats({
			request: {
				projectId: "project-1",
				elementIds: ["a"],
				frameAlign: "none",
				dryRun: true,
			},
		});
		expect(none.results[0]).toMatchObject({ to: 10.513, frameAligned: false });
	});

	it("puts a clip's onset on the beat when told where it is", () => {
		useBeatDetectionStore.setState({
			cache: new Map([["song", detection]]),
			activeElementId: "song",
		});
		const response = performSnapToBeats({
			request: {
				projectId: "project-1",
				elementIds: ["a", "b"],
				edge: "onset",
				edgeOffsets: { a: 0.3 },
			},
		});
		expect(response.edge).toBe("onset");
		const [a, b] = response.results;
		// Onset at 10.6 → beat 10.5 → start 10.2.
		expect(a).toMatchObject({
			to: 10.2,
			beat: 10.5,
			offset: 0.3,
			applied: true,
		});
		expect(b).toMatchObject({ applied: false, beat: null });
		expect(b.reason).toBe("no onset was found in the clip");
		expect(
			useTimelineStore
				.getState()
				.tracks.find((t) => t.id === "cuts")
				?.elements.map((e) => e.startTime)
		).toEqual([10.2, 11.9, 15]);
	});
});
