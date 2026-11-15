import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineTrack } from "@/types/timeline";
import type { StoreGet, StoreSet } from "../timeline-store-operations";

const mocks = vi.hoisted(() => ({
	saveProjectTimeline: vi.fn(),
	markProjectContentChanged: vi.fn(),
}));

vi.mock("@/lib/storage/storage-service", () => ({
	storageService: {
		saveProjectTimeline: mocks.saveProjectTimeline,
	},
}));

vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: () => ({
			activeProject: {
				currentSceneId: "project-scene",
				id: "project-1",
			},
			markProjectContentChanged: mocks.markProjectContentChanged,
		}),
	},
}));

vi.mock("@/stores/timeline/scene-store", () => ({
	useSceneStore: {
		getState: () => ({ currentScene: { id: "stale-scene" } }),
	},
}));

import { createAutoSaveHelpers } from "../timeline-store-autosave";

describe("timeline autosave scene authority", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.saveProjectTimeline.mockResolvedValue(undefined);
		mocks.markProjectContentChanged.mockResolvedValue(undefined);
	});

	it("saves to the scene selected by the active project", async () => {
		const tracks: TimelineTrack[] = [];
		const get = (() => ({
			_tracks: tracks,
			selectedTransition: null,
		})) as unknown as StoreGet;
		const set = vi.fn() as unknown as StoreSet;
		const helpers = createAutoSaveHelpers(get, set);

		await helpers.autoSaveTimeline();

		expect(mocks.saveProjectTimeline).toHaveBeenCalledWith({
			projectId: "project-1",
			sceneId: "project-scene",
			tracks,
		});
	});

	const helpersFor = ({ set }: { set: StoreSet }) =>
		createAutoSaveHelpers(
			(() => ({
				_tracks: [],
				selectedTransition: null,
			})) as unknown as StoreGet,
			set
		);

	/** 问题 3 (2026-11-14): a day of edits left the project's "last modified" alone. */
	it("marks the project changed once the edited timeline is saved", async () => {
		await helpersFor({
			set: vi.fn() as unknown as StoreSet,
		}).autoSaveTimeline();

		expect(mocks.markProjectContentChanged).toHaveBeenCalledTimes(1);
		expect(mocks.markProjectContentChanged).toHaveBeenCalledWith("project-1");
		expect(mocks.saveProjectTimeline.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.markProjectContentChanged.mock.invocationCallOrder[0]
		);
	});

	it("leaves the project's time alone when the timeline could not be saved", async () => {
		mocks.saveProjectTimeline.mockRejectedValueOnce(new Error("disk full"));
		const set = vi.fn();
		await helpersFor({ set: set as unknown as StoreSet }).autoSaveTimeline();

		expect(mocks.markProjectContentChanged).not.toHaveBeenCalled();
		expect(set).toHaveBeenLastCalledWith(
			expect.objectContaining({ autoSaveStatus: "Auto-save failed" })
		);
	});

	it("still reports the timeline saved when the project's time cannot be recorded", async () => {
		mocks.markProjectContentChanged.mockRejectedValueOnce(new Error("nope"));
		const set = vi.fn();
		await helpersFor({ set: set as unknown as StoreSet }).autoSaveTimeline();

		expect(set).toHaveBeenLastCalledWith(
			expect.objectContaining({ autoSaveStatus: "Auto-saved" })
		);
	});
});
