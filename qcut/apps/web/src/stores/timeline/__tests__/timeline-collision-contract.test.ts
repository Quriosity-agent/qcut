import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { clearAutoSaveTimer } from "../timeline-store-autosave";
import { useTimelineStore } from "../timeline-store";

/**
 * QTL-002 collision-engine contract: the same-track no-overlap invariant is
 * enforced inside the store commands, so UI, CLI, and AI callers all get the
 * same semantics. The mode is an explicit parameter: reject (default),
 * insert, overwrite.
 */

const importGate = vi.hoisted(() => ({
	resolvers: [] as Array<() => void>,
}));

vi.mock("@/stores/media/media-store", () => {
	const state = {
		mediaItems: [] as Array<Record<string, unknown>>,
		addMediaItem: async (
			_projectId: string,
			data: { name: string; type: string }
		) => {
			await new Promise<void>((resolve) => {
				importGate.resolvers.push(resolve);
			});
			const id = "replacement-media-item";
			state.mediaItems.push({
				id,
				name: data.name,
				type: data.type,
				duration: 3,
			});
			return id;
		},
	};
	return { useMediaStore: { getState: () => state } };
});

vi.mock("@/stores/media/media-store-loader", () => ({
	getMediaStoreUtils: () => ({
		getFileType: () => "image",
		getImageDimensions: async () => ({ width: 100, height: 100 }),
		generateVideoThumbnail: async () => ({
			thumbnailUrl: "thumb",
			width: 100,
			height: 100,
		}),
		getMediaDuration: async () => 3,
	}),
}));

function mediaElement({
	id,
	startTime,
	duration = 2,
	groupId,
}: {
	id: string;
	startTime: number;
	duration?: number;
	groupId?: string;
}): MediaElement {
	return {
		id,
		name: id,
		type: "media",
		mediaId: `${id}-media`,
		duration,
		startTime,
		trimStart: 0,
		trimEnd: 0,
		...(groupId ? { groupId } : {}),
	};
}

function baseTracks(): TimelineTrack[] {
	return [
		{
			id: "main",
			name: "Main",
			type: "media",
			isMain: true,
			elements: [
				mediaElement({ id: "a", startTime: 0 }),
				mediaElement({ id: "b", startTime: 2 }),
				mediaElement({ id: "c", startTime: 4 }),
			],
		},
		{
			id: "overlay",
			name: "Overlay",
			type: "media",
			elements: [mediaElement({ id: "overlay-a", startTime: 4 })],
		},
	];
}

function setTracks(tracks: TimelineTrack[]) {
	useTimelineStore.setState({
		_tracks: tracks,
		tracks,
		history: [],
		redoStack: [],
		selectedElements: [],
		selectedTransition: null,
		rippleEditingEnabled: false,
	});
}

function mainElements(): Array<[string, number, number]> {
	return (
		useTimelineStore
			.getState()
			.tracks.find((track) => track.id === "main")
			?.elements.map((element) => [
				element.id,
				element.startTime,
				element.duration - element.trimStart - element.trimEnd,
			]) ?? []
	);
}

const newElementData = {
	type: "media" as const,
	mediaId: "new-media",
	name: "new",
	duration: 2,
	trimStart: 0,
	trimEnd: 0,
};

describe("timeline collision contract", () => {
	beforeEach(() => setTracks(baseTracks()));
	afterEach(() => clearAutoSaveTimer());

	describe("addElementToTrack", () => {
		it("rejects an overlapping add by default", () => {
			const result = useTimelineStore
				.getState()
				.addElementToTrack("main", { ...newElementData, startTime: 3 });
			expect(result).toBeNull();
			expect(mainElements()).toEqual([
				["a", 0, 2],
				["b", 2, 2],
				["c", 4, 2],
			]);
			expect(useTimelineStore.getState().history).toHaveLength(0);
		});

		it("still adds into free space by default", () => {
			const result = useTimelineStore
				.getState()
				.addElementToTrack("main", { ...newElementData, startTime: 6 });
			expect(result).not.toBeNull();
			expect(useTimelineStore.getState().history).toHaveLength(1);
		});

		it("insert mode splits the occupant and shifts downstream", () => {
			const result = useTimelineStore
				.getState()
				.addElementToTrack(
					"main",
					{ ...newElementData, startTime: 3 },
					{ collision: "insert" }
				);
			expect(result).not.toBeNull();

			const elements =
				useTimelineStore.getState().tracks.find((track) => track.id === "main")
					?.elements ?? [];
			const spans = elements
				.map((element) => ({
					id: element.id,
					start: element.startTime,
					end:
						element.startTime +
						element.duration -
						element.trimStart -
						element.trimEnd,
				}))
				.sort((left, right) => left.start - right.start);

			expect(spans.map((span) => [span.start, span.end])).toEqual([
				[0, 2],
				[2, 3],
				[3, 5],
				[5, 6],
				[6, 8],
			]);
			// The overlay track is untouched — insert is a same-track command.
			expect(
				useTimelineStore
					.getState()
					.tracks.find((track) => track.id === "overlay")
					?.elements.map((element) => element.startTime)
			).toEqual([4]);
			expect(useTimelineStore.getState().history).toHaveLength(1);
		});

		it("overwrite mode clears the range and keeps downstream positions", () => {
			const result = useTimelineStore
				.getState()
				.addElementToTrack(
					"main",
					{ ...newElementData, startTime: 3 },
					{ collision: "overwrite" }
				);
			expect(result).not.toBeNull();

			const spans = (
				useTimelineStore.getState().tracks.find((track) => track.id === "main")
					?.elements ?? []
			)
				.map((element) => ({
					id: element.id,
					start: element.startTime,
					end:
						element.startTime +
						element.duration -
						element.trimStart -
						element.trimEnd,
				}))
				.sort((left, right) => left.start - right.start);

			expect(spans.map((span) => [span.start, span.end])).toEqual([
				[0, 2],
				[2, 3],
				[3, 5],
				[5, 6],
			]);
			expect(useTimelineStore.getState().history).toHaveLength(1);
		});
	});

	describe("moves", () => {
		it("moveElementToTrack rejects a colliding lane change", () => {
			useTimelineStore.getState().moveElementToTrack("main", "overlay", "c");
			expect(mainElements().map(([id]) => id)).toContain("c");
			expect(
				useTimelineStore
					.getState()
					.tracks.find((track) => track.id === "overlay")?.elements
			).toHaveLength(1);
			expect(useTimelineStore.getState().history).toHaveLength(0);
		});

		it("moveElementToTrack succeeds into free space", () => {
			useTimelineStore.getState().moveElementToTrack("main", "overlay", "a");
			expect(
				useTimelineStore
					.getState()
					.tracks.find((track) => track.id === "overlay")
					?.elements.map((element) => element.id)
					.sort()
			).toEqual(["a", "overlay-a"]);
		});

		it("updateElementStartTime rejects a colliding slide", () => {
			useTimelineStore.getState().updateElementStartTime("main", "a", 3);
			expect(mainElements()).toEqual([
				["a", 0, 2],
				["b", 2, 2],
				["c", 4, 2],
			]);
			expect(useTimelineStore.getState().history).toHaveLength(0);
		});

		it("updateElementStartTime rejects a group move that would overlap", () => {
			const tracks = baseTracks();
			tracks[0].elements = [
				mediaElement({ id: "a", startTime: 0, groupId: "g" }),
				mediaElement({ id: "blocker", startTime: 4 }),
			];
			tracks[1].elements = [
				mediaElement({ id: "overlay-a", startTime: 0, groupId: "g" }),
			];
			setTracks(tracks);

			useTimelineStore.getState().updateElementStartTime("main", "a", 4);

			expect(mainElements()).toEqual([
				["a", 0, 2],
				["blocker", 4, 2],
			]);
			expect(useTimelineStore.getState().history).toHaveLength(0);
		});
	});

	describe("seams computed in floating point", () => {
		// The clips from the report: clip six ends at 100.20833 + 17.041667,
		// which is 117.24999700000001 in floating point, and clip eight starts
		// exactly one clip-seven later.
		function reportedTracks(): TimelineTrack[] {
			return [
				{
					id: "main",
					name: "Main",
					type: "media",
					isMain: true,
					elements: [
						mediaElement({
							id: "six",
							startTime: 100.20833,
							duration: 17.041667,
						}),
						mediaElement({
							id: "eight",
							startTime: 133.291664,
							duration: 4,
						}),
						mediaElement({ id: "seven", startTime: 240, duration: 16.041667 }),
					],
				},
				{
					id: "overlay",
					name: "Overlay",
					type: "media",
					elements: [
						mediaElement({
							id: "lane-mate",
							startTime: 100.20833,
							duration: 17.041667,
						}),
					],
				},
			];
		}

		it("adds a clip that starts where the previous one ends", () => {
			setTracks(reportedTracks());
			const result = useTimelineStore.getState().addElementToTrack("main", {
				...newElementData,
				startTime: 117.249997,
				duration: 16.041667,
			});
			expect(result).not.toBeNull();
		});

		it("adds at a 0.1 + 0.2 seam", () => {
			setTracks([
				{
					id: "main",
					name: "Main",
					type: "media",
					isMain: true,
					elements: [mediaElement({ id: "a", startTime: 0.1, duration: 0.2 })],
				},
			]);
			const result = useTimelineStore
				.getState()
				.addElementToTrack("main", { ...newElementData, startTime: 0.3 });
			expect(result).not.toBeNull();
		});

		it("slides a clip into a gap of exactly its length", () => {
			setTracks(reportedTracks());
			useTimelineStore
				.getState()
				.updateElementStartTime("main", "seven", 117.249997);
			expect(mainElements().find(([id]) => id === "seven")?.[1]).toBe(
				117.249997
			);
			expect(useTimelineStore.getState().history).toHaveLength(1);
		});

		it("moves a clip onto a lane where it meets its neighbour", () => {
			const tracks = reportedTracks();
			tracks[0].elements = tracks[0].elements.map((element) =>
				element.id === "seven" ? { ...element, startTime: 117.249997 } : element
			);
			setTracks(tracks);
			useTimelineStore
				.getState()
				.moveElementToTrack("main", "overlay", "seven");
			expect(
				useTimelineStore
					.getState()
					.tracks.find((track) => track.id === "overlay")
					?.elements.map((element) => element.id)
					.sort()
			).toEqual(["lane-mate", "seven"]);
		});

		it("adds to the lane findOrCreateTrack picked for the span", () => {
			setTracks(reportedTracks());
			const span = { startTime: 117.249997, duration: 16.041667 };
			const trackId = useTimelineStore
				.getState()
				.findOrCreateTrack("media", span);
			expect(trackId).toBe("main");
			const result = useTimelineStore.getState().addElementToTrack(trackId, {
				...newElementData,
				...span,
			});
			expect(result).not.toBeNull();
		});

		it("still rejects an overlap of one frame", () => {
			setTracks(reportedTracks());
			const result = useTimelineStore.getState().addElementToTrack("main", {
				...newElementData,
				startTime: 117.249997 - 1 / 30,
				duration: 2,
			});
			expect(result).toBeNull();
		});
	});

	describe("refusal reasons", () => {
		it("tells the caller which clip blocks an add and where it fits", () => {
			const onRejected = vi.fn();
			const result = useTimelineStore
				.getState()
				.addElementToTrack(
					"main",
					{ ...newElementData, startTime: 3 },
					{ onRejected }
				);
			expect(result).toBeNull();
			expect(onRejected).toHaveBeenCalledWith(
				'3s–5s on track "Main" overlaps "b" (2s–4s). A track plays one element at a time; the next free start for this 2s clip is 6s.'
			);
		});

		it("says the track is locked rather than occupied", () => {
			const tracks = baseTracks();
			tracks[0].locked = true;
			setTracks(tracks);
			const onRejected = vi.fn();
			useTimelineStore
				.getState()
				.addElementToTrack(
					"main",
					{ ...newElementData, startTime: 6 },
					{ onRejected }
				);
			expect(onRejected).toHaveBeenCalledWith('Track "Main" is locked');
		});

		it("reports every other reason an add is refused", () => {
			const cases = [
				{
					trackId: "missing",
					element: { ...newElementData, startTime: 6 },
					reason: "Track not found: missing",
				},
				{
					trackId: "main",
					element: { ...newElementData, mediaId: "", startTime: 6 },
					reason: "Media element must have mediaId",
				},
			];
			for (const { trackId, element, reason } of cases) {
				const onRejected = vi.fn();
				const result = useTimelineStore
					.getState()
					.addElementToTrack(trackId, element, { onRejected });
				expect(result).toBeNull();
				expect(onRejected).toHaveBeenCalledWith(reason);
			}

			setTracks([
				...baseTracks(),
				{ id: "text", name: "Text", type: "text", elements: [] },
				{ id: "notes", name: "Notes", type: "markdown", elements: [] },
			]);
			const textRefusal = vi.fn();
			useTimelineStore.getState().addElementToTrack(
				"text",
				{
					type: "text",
					name: "Title",
					content: "",
					startTime: 0,
					duration: 2,
					trimStart: 0,
					trimEnd: 0,
				} as never,
				{ onRejected: textRefusal }
			);
			expect(textRefusal).toHaveBeenCalledWith(
				"Text element must have content"
			);

			const markdownRefusal = vi.fn();
			useTimelineStore.getState().addElementToTrack(
				"notes",
				{
					type: "markdown",
					name: "Notes",
					startTime: 0,
					duration: 2,
					trimStart: 0,
					trimEnd: 0,
				} as never,
				{ onRejected: markdownRefusal }
			);
			expect(markdownRefusal).toHaveBeenCalledWith(
				"Markdown element must have markdownContent"
			);

			const wrongLane = vi.fn();
			useTimelineStore
				.getState()
				.addElementToTrack(
					"text",
					{ ...newElementData, startTime: 0 },
					{ onRejected: wrongLane }
				);
			expect(wrongLane).toHaveBeenCalledOnce();
			expect(useTimelineStore.getState().history).toHaveLength(0);
		});

		it("does not call onRejected for a successful add", () => {
			const onRejected = vi.fn();
			const result = useTimelineStore
				.getState()
				.addElementToTrack(
					"main",
					{ ...newElementData, startTime: 6 },
					{ onRejected }
				);
			expect(result).not.toBeNull();
			expect(onRejected).not.toHaveBeenCalled();
		});

		it("reports whether updateElementStartTime moved the element", () => {
			const store = useTimelineStore.getState();
			expect(store.updateElementStartTime("main", "a", 3)).toBe(false);
			expect(store.updateElementStartTime("main", "c", 6)).toBe(true);
			expect(store.updateElementStartTime("main", "missing", 6)).toBe(false);

			const tracks = baseTracks();
			tracks[0].locked = true;
			setTracks(tracks);
			expect(
				useTimelineStore.getState().updateElementStartTime("main", "c", 6)
			).toBe(false);
		});
	});

	describe("separateAudio stacking", () => {
		it("stacks a new audio lane when the existing one is occupied there", () => {
			const tracks: TimelineTrack[] = [
				{
					id: "main",
					name: "Main",
					type: "media",
					isMain: true,
					elements: [mediaElement({ id: "v", startTime: 0 })],
				},
				{
					id: "audio",
					name: "Audio",
					type: "audio",
					elements: [mediaElement({ id: "song", startTime: 0, duration: 10 })],
				},
			];
			setTracks(tracks);

			const audioElementId = useTimelineStore
				.getState()
				.separateAudio("main", "v");
			expect(audioElementId).not.toBeNull();

			const audioTracks = useTimelineStore
				.getState()
				.tracks.filter((track) => track.type === "audio");
			expect(audioTracks).toHaveLength(2);
			expect(
				audioTracks.find((track) => track.id === "audio")?.elements
			).toHaveLength(1);
		});
	});

	describe("replaceElementMedia concurrency", () => {
		beforeEach(async () => {
			const { useProjectStore } = await import("@/stores/project-store");
			useProjectStore.setState({
				activeProject: {
					id: "project-1",
					name: "P",
					thumbnail: "",
					createdAt: new Date(),
					updatedAt: new Date(),
				} as never,
			});
		});

		afterEach(async () => {
			const { useProjectStore } = await import("@/stores/project-store");
			useProjectStore.setState({ activeProject: null });
		});

		it("preserves edits made while the import was pending", async () => {
			const replacePromise = useTimelineStore
				.getState()
				.replaceElementMedia(
					"main",
					"b",
					new File(["x"], "replacement.png", { type: "image/png" })
				);

			// Wait until the import is parked on the gate, then edit the
			// timeline while the replace is still pending.
			await vi.waitFor(() => {
				expect(importGate.resolvers.length).toBeGreaterThan(0);
			});
			useTimelineStore.getState().updateElementStartTime("main", "c", 6);

			for (const resolve of importGate.resolvers.splice(0)) resolve();
			const result = await replacePromise;

			expect(result).toEqual({ success: true });
			const elements =
				useTimelineStore.getState().tracks.find((track) => track.id === "main")
					?.elements ?? [];
			// The concurrent move survived the async write-back...
			expect(elements.find((element) => element.id === "c")?.startTime).toBe(6);
			// ...and the replacement itself landed, preserving the 2s slot by
			// trimming the 3s source (QTL-012: seams must not move).
			const replaced = elements.find((element) => element.id === "b");
			expect(replaced).toMatchObject({
				mediaId: "replacement-media-item",
				name: "replacement.png",
				duration: 3,
				trimStart: 0,
				trimEnd: 1,
			});
		});

		it("keeps the transition on a replaced clip's seam", async () => {
			const tracks = baseTracks();
			tracks[0].transitions = [
				{
					id: "t1",
					fromElementId: "a",
					toElementId: "b",
					presetId: "dissolve",
					type: "dissolve",
					duration: 0.5,
					easing: "easeInOut",
				},
			];
			setTracks(tracks);

			const replacePromise = useTimelineStore
				.getState()
				.replaceElementMedia(
					"main",
					"b",
					new File(["x"], "replacement.png", { type: "image/png" })
				);
			await vi.waitFor(() => {
				expect(importGate.resolvers.length).toBeGreaterThan(0);
			});
			for (const resolve of importGate.resolvers.splice(0)) resolve();
			const result = await replacePromise;

			expect(result).toEqual({ success: true });
			const main = useTimelineStore
				.getState()
				.tracks.find((track) => track.id === "main");
			expect(main?.transitions).toHaveLength(1);
			expect(
				main?.elements.map((element) => [
					element.id,
					element.startTime,
					element.duration - element.trimStart - element.trimEnd,
				])
			).toEqual([
				["a", 0, 2],
				["b", 2, 2],
				["c", 4, 2],
			]);
		});

		it("rejects replacement media shorter than the clip", async () => {
			const tracks = baseTracks();
			// Stretch b's slot beyond the 3s the mocked import will provide.
			tracks[0].elements = tracks[0].elements.map((element) =>
				element.id === "b"
					? { ...element, duration: 4 }
					: element.id === "c"
						? { ...element, startTime: 6 }
						: element
			);
			setTracks(tracks);
			const before = JSON.parse(
				JSON.stringify(useTimelineStore.getState().tracks)
			);

			const replacePromise = useTimelineStore
				.getState()
				.replaceElementMedia(
					"main",
					"b",
					new File(["x"], "too-short.png", { type: "image/png" })
				);
			await vi.waitFor(() => {
				expect(importGate.resolvers.length).toBeGreaterThan(0);
			});
			for (const resolve of importGate.resolvers.splice(0)) resolve();
			const result = await replacePromise;

			expect(result).toEqual({
				success: false,
				error: "Replacement media is shorter than the clip",
			});
			expect(useTimelineStore.getState().tracks).toEqual(before);
			expect(useTimelineStore.getState().history).toHaveLength(0);
		});
	});
});
