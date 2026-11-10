import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MediaItem, useMediaStore } from "@/stores/media/media-store";
import { clearAutoSaveTimer } from "@/stores/timeline/timeline-store-autosave";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import {
	performInsertGap,
	performSnapToFrames,
	setupTimeEditHandlers,
} from "../claude-time-edit-bridge";

/**
 * `editing insert-gap` and `timeline snap --to frames` on the real timeline
 * store: what the editor API answers and what the timeline holds afterwards.
 */

vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: () => ({
			loadedProjectId: "project-1",
			activeProject: { id: "project-1", fps: 24 },
		}),
	},
}));
vi.mock("@/lib/debug/debug-config", () => ({
	debugError: vi.fn(),
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
}));

const frames = (count: number) => count / 24;

function clip({
	id,
	start,
	length,
}: {
	id: string;
	/** Timeline start and length, in frames. */
	start: number;
	length: number;
}): MediaElement {
	return {
		id,
		name: id,
		type: "media",
		mediaId: `${id}-media`,
		startTime: frames(start),
		duration: frames(length) + 4,
		trimStart: 2,
		trimEnd: 2,
	};
}

function elements(trackId: string) {
	const track = useTimelineStore
		.getState()
		.tracks.find((candidate) => candidate.id === trackId);
	return (track?.elements ?? []) as MediaElement[];
}

describe("time edits over the editor API", () => {
	beforeEach(() => {
		const tracks: TimelineTrack[] = [
			{
				id: "music",
				name: "Music",
				type: "audio",
				elements: [clip({ id: "song", start: 0.5, length: 200 })],
			},
			{
				id: "cuts",
				name: "Cuts",
				type: "media",
				isMain: true,
				elements: [
					clip({ id: "a", start: 0, length: 24.4 }),
					clip({ id: "b", start: 24.4, length: 23.6 }),
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
		useMediaStore.setState({
			mediaItems: [
				{ id: "song-media", name: "song.mp3", type: "audio" },
				{ id: "a-media", name: "a.mp4", type: "video" },
				{ id: "b-media", name: "b.mp4", type: "video" },
			] as MediaItem[],
		});
	});
	afterEach(() => {
		clearAutoSaveTimer();
		useMediaStore.setState({ mediaItems: [] });
	});

	it("opens empty time on every track and reports what moved", () => {
		const response = performInsertGap({
			request: { projectId: "project-1", time: 0, duration: 5 },
		});
		expect(response).toEqual({
			projectId: "project-1",
			time: 0,
			duration: 5,
			trackIds: ["music", "cuts"],
			movedElements: 3,
			splitElements: 0,
			mixAutomationMoved: false,
		});
		expect(elements("cuts").map((element) => element.startTime)).toEqual([
			5,
			5 + frames(24.4),
		]);
		expect(elements("music")[0].startTime).toBeCloseTo(5 + frames(0.5), 9);
	});

	it("opens it on the named tracks only", () => {
		performInsertGap({
			request: {
				projectId: "project-1",
				time: frames(24.4),
				duration: 2,
				trackIds: ["cuts"],
			},
		});
		expect(elements("cuts").map((element) => element.startTime)).toEqual([
			0,
			2 + frames(24.4),
		]);
		expect(elements("music")[0].startTime).toBeCloseTo(frames(0.5), 9);
	});

	it("refuses another project, a bad span and a missing track", () => {
		expect(() =>
			performInsertGap({
				request: { projectId: "project-2", time: 0, duration: 5 },
			})
		).toThrow("Project project-2 is not open in the editor");
		expect(() =>
			performInsertGap({
				request: { projectId: "project-1", time: 0, duration: 0 },
			})
		).toThrow("duration must be above 0 seconds");
		expect(() =>
			performInsertGap({
				request: {
					projectId: "project-1",
					time: 0,
					duration: 1,
					trackIds: ["titles"],
				},
			})
		).toThrow("Track not found: titles");
		expect(elements("cuts")[0].startTime).toBe(0);
	});

	it("puts the edges of the clips that are seen on whole frames, the cut between them on one frame", () => {
		const response = performSnapToFrames({
			request: { projectId: "project-1" },
		});
		expect(response).toMatchObject({
			projectId: "project-1",
			fps: 24,
			dryRun: false,
			checked: 2,
			skipped: [],
		});
		expect(response.changed.map((change) => change.elementId)).toEqual([
			"a",
			"b",
		]);
		const [a, b] = elements("cuts");
		expect(a.startTime + a.duration - a.trimStart - a.trimEnd).toBeCloseTo(
			frames(24),
			9
		);
		expect(b.startTime).toBeCloseTo(frames(24), 9);
		expect(b.trimStart).toBeCloseTo(2 - frames(0.4), 9);
		// Sound may sit between frames.
		expect(elements("music")[0].startTime).toBeCloseTo(frames(0.5), 9);

		// One undo step puts the cut back.
		useTimelineStore.getState().undo();
		expect(elements("cuts")[1].startTime).toBeCloseTo(frames(24.4), 9);
	});

	it("snaps sound too when asked, and only reports on a dry run", () => {
		const response = performSnapToFrames({
			request: { projectId: "project-1", frameAlign: "all", dryRun: true },
		});
		expect(response.dryRun).toBe(true);
		expect(response.checked).toBe(3);
		expect(response.changed.map((change) => change.elementId)).toEqual([
			"song",
			"a",
			"b",
		]);
		expect(elements("cuts")[1].startTime).toBeCloseTo(frames(24.4), 9);
		expect(elements("music")[0].startTime).toBeCloseTo(frames(0.5), 9);
	});

	it("snaps only the named clips and tracks, and refuses a locked or missing one", () => {
		expect(
			performSnapToFrames({
				request: { projectId: "project-1", trackIds: ["music"] },
			}).checked
		).toBe(0);
		expect(() =>
			performSnapToFrames({
				request: { projectId: "project-1", elementIds: ["nope"] },
			})
		).toThrow("Element not found: nope");
		useTimelineStore.getState().toggleTrackLocked("cuts");
		expect(() =>
			performSnapToFrames({
				request: { projectId: "project-1", trackIds: ["cuts"] },
			})
		).toThrow("Track cuts (Cuts) is locked");
		expect(() =>
			performSnapToFrames({
				request: { projectId: "project-1", elementIds: ["a"] },
			})
		).toThrow("Element a is on a locked track (Cuts)");
		// With nothing named, a locked track is simply left out.
		expect(
			performSnapToFrames({ request: { projectId: "project-1" } }).checked
		).toBe(0);
	});

	it("answers over the bridge with the response or the reason", () => {
		let handler:
			| ((data: { requestId: string; request: unknown }) => void)
			| undefined;
		const send = vi.fn();
		setupTimeEditHandlers({
			claudeAPI: {
				onTimeEdit: (callback) => {
					handler = callback;
				},
				sendTimeEditResponse: send,
			},
		});
		handler?.({
			requestId: "r1",
			request: {
				operation: "insert-gap",
				projectId: "project-1",
				time: 0,
				duration: 1,
			},
		});
		handler?.({
			requestId: "r2",
			request: {
				operation: "insert-gap",
				projectId: "project-1",
				time: -1,
				duration: 1,
			},
		});
		expect(send).toHaveBeenNthCalledWith(1, "r1", {
			ok: true,
			response: expect.objectContaining({ movedElements: 3, duration: 1 }),
		});
		expect(send).toHaveBeenNthCalledWith(2, "r2", {
			ok: false,
			error: "time must be 0 seconds or more",
		});
	});
});
