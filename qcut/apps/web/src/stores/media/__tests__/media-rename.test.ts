import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineTrack } from "@/types/timeline";

const storage = vi.hoisted(() => ({
	saveMediaItem: vi.fn(async (..._args: unknown[]) => undefined),
	deleteMediaItem: vi.fn(async (..._args: unknown[]) => undefined),
	loadTimeline: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
	saveTimeline: vi.fn(async (..._args: unknown[]) => undefined),
}));
const project = vi.hoisted(() => ({
	activeProject: {
		id: "project-1",
		currentSceneId: "scene-main",
		scenes: [{ id: "scene-main" }, { id: "scene-b" }],
	} as { id: string; currentSceneId: string; scenes: Array<{ id: string }> },
	markProjectContentChanged: vi.fn(async (..._args: unknown[]) => new Date()),
}));
const timeline = vi.hoisted(() => ({
	tracks: [] as unknown[],
	saveImmediate: vi.fn(async () => true),
}));
const stickers = vi.hoisted(() => ({
	overlayStickers: new Map<string, { id: string; mediaItemId: string }>(),
	saveToProject: vi.fn(async (..._args: unknown[]) => undefined),
}));
const forgetAlpha = vi.hoisted(() => vi.fn());

vi.mock("@/lib/storage/storage-service", () => ({ storageService: storage }));
vi.mock("@/lib/media/alpha-playback-proxy", () => ({
	forgetMediaAlphaInspection: forgetAlpha,
}));
vi.mock("../../project-store", () => ({
	useProjectStore: { getState: () => project },
}));
vi.mock("../../stickers-overlay-store", () => ({
	useStickersOverlayStore: {
		getState: () => stickers,
		setState: (next: Partial<typeof stickers>) => Object.assign(stickers, next),
	},
}));
vi.mock("../../timeline/timeline-store", async () => {
	const { repointMediaReferences } = await import(
		"../../timeline/media-references"
	);
	return {
		useTimelineStore: {
			getState: () => ({
				saveImmediate: timeline.saveImmediate,
				repointMediaReferences: (ids: { fromId: string; toId: string }) => {
					const result = repointMediaReferences({
						tracks: timeline.tracks as TimelineTrack[],
						...ids,
					});
					timeline.tracks = result.tracks;
					return result.changed;
				},
			}),
		},
	};
});
const mediaState = vi.hoisted(() => ({ mediaItems: [] as unknown[] }));
vi.mock("../media-store", () => ({
	useMediaStore: {
		getState: () => mediaState,
		setState: (
			update: (state: typeof mediaState) => Partial<typeof mediaState>
		) => Object.assign(mediaState, update(mediaState)),
	},
}));

import { resetMediaPersistenceQueue } from "../media-persistence-queue";
import { renameProjectMedia } from "../media-rename";

const OLD = "media_b2xkLm1wNA";
const NEW = "media_bmV3Lm1wNA";
const RENAME = {
	projectId: "project-1",
	fromId: OLD,
	toId: NEW,
	name: "new.mp4",
	localPath: "/projects/project-1/media/new.mp4",
};

function mediaTrack(mediaIds: string[]): TimelineTrack {
	return {
		id: "main",
		name: "Main",
		type: "media",
		muted: false,
		elements: mediaIds.map((mediaId, index) => ({
			id: `clip-${index}`,
			type: "media",
			mediaId,
		})),
	} as unknown as TimelineTrack;
}

describe("following a media file renamed in the project folder", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetMediaPersistenceQueue();
		storage.loadTimeline.mockResolvedValue(null);
		mediaState.mediaItems = [
			{
				id: OLD,
				name: "old.mp4",
				type: "video",
				file: new File(["picture"], "old.mp4", {
					type: "video/mp4",
					lastModified: 1234,
				}),
				url: "blob:old",
				localPath: "/projects/project-1/media/old.mp4",
				duration: 4,
				folderIds: ["folder-1"],
			},
			{ id: "media_other", name: "other.mp4", type: "video" },
		];
		timeline.tracks = [mediaTrack([OLD, "media_other", OLD])];
		stickers.overlayStickers = new Map([
			["s1", { id: "s1", mediaItemId: OLD }],
			["s2", { id: "s2", mediaItemId: "media_other" }],
		]);
	});

	it("stores the item under the new id, with its name, path and everything it had", async () => {
		const result = await renameProjectMedia(RENAME);
		expect(result.mediaRenamed).toBe(true);
		const [renamed, other] = mediaState.mediaItems as Array<
			Record<string, unknown>
		>;
		expect(renamed).toMatchObject({
			id: NEW,
			name: "new.mp4",
			localPath: RENAME.localPath,
			isLocalFile: true,
			url: "blob:old",
			duration: 4,
			folderIds: ["folder-1"],
		});
		const file = renamed.file as File;
		expect(file.name).toBe("new.mp4");
		expect(file.type).toBe("video/mp4");
		expect(file.lastModified).toBe(1234);
		expect(await file.text()).toBe("picture");
		expect(other).toMatchObject({ id: "media_other" });
		// Stored under the new id, and the old entry removed after that.
		expect(storage.saveMediaItem).toHaveBeenCalledWith("project-1", renamed);
		expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", OLD);
		expect(storage.saveMediaItem.mock.invocationCallOrder[0]).toBeLessThan(
			storage.deleteMediaItem.mock.invocationCallOrder[0]
		);
		expect(project.markProjectContentChanged).toHaveBeenCalledWith("project-1");
		expect(forgetAlpha).toHaveBeenCalledWith({ localPath: RENAME.localPath });
	});

	it("points the open scene's clips at the new id and saves the timeline", async () => {
		const result = await renameProjectMedia(RENAME);
		expect(result.clipsUpdated).toBe(2);
		expect(
			(timeline.tracks as TimelineTrack[])[0].elements.map((element) =>
				element.type === "media" ? element.mediaId : null
			)
		).toEqual([NEW, "media_other", NEW]);
		expect(timeline.saveImmediate).toHaveBeenCalledTimes(1);
	});

	it("repoints the scenes that are not open, in storage", async () => {
		storage.loadTimeline.mockImplementation(async (request: unknown) =>
			(request as { sceneId?: string }).sceneId === "scene-b"
				? [mediaTrack([OLD])]
				: null
		);
		const result = await renameProjectMedia(RENAME);
		expect(result.clipsUpdated).toBe(3);
		// The open scene is not read from storage: the store holds it.
		expect(storage.loadTimeline).toHaveBeenCalledTimes(1);
		expect(storage.loadTimeline).toHaveBeenCalledWith({
			projectId: "project-1",
			sceneId: "scene-b",
		});
		const saved = storage.saveTimeline.mock.calls[0][0] as {
			sceneId: string;
			tracks: TimelineTrack[];
		};
		expect(saved.sceneId).toBe("scene-b");
		expect(saved.tracks[0].elements[0]).toMatchObject({ mediaId: NEW });
	});

	it("takes the stickers along, which are dropped on load when their media is gone", async () => {
		const result = await renameProjectMedia(RENAME);
		expect(result.stickersUpdated).toBe(1);
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(NEW);
		expect(stickers.overlayStickers.get("s2")?.mediaItemId).toBe("media_other");
		expect(stickers.saveToProject).toHaveBeenCalledWith("project-1");
	});

	it("changes nothing when the new item cannot be stored, so the file can be put back", async () => {
		storage.saveMediaItem.mockRejectedValueOnce(new Error("Quota exceeded"));
		await expect(renameProjectMedia(RENAME)).rejects.toThrow("Quota exceeded");
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(OLD);
		expect(
			(timeline.tracks as TimelineTrack[])[0].elements.map((element) =>
				element.type === "media" ? element.mediaId : null
			)
		).toEqual([OLD, "media_other", OLD]);
		expect(storage.deleteMediaItem).not.toHaveBeenCalled();
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(OLD);
	});

	/**
	 * The desktop app puts the file back under its old name when the editor
	 * cannot follow. Whatever the editor had already changed has to go back
	 * too, or the clips are left on an id the file no longer has.
	 */
	it("takes back every step when a later one fails", async () => {
		const sceneB = [mediaTrack([OLD])];
		const sceneC = [mediaTrack([OLD, OLD])];
		project.activeProject.scenes = [
			{ id: "scene-main" },
			{ id: "scene-b" },
			{ id: "scene-c" },
		];
		storage.loadTimeline.mockImplementation(async (request: unknown) =>
			(request as { sceneId?: string }).sceneId === "scene-b" ? sceneB : sceneC
		);
		// Scene B is saved; saving scene C fails.
		storage.saveTimeline.mockImplementation(async (request: unknown) => {
			const { sceneId, tracks } = request as {
				sceneId: string;
				tracks: TimelineTrack[];
			};
			const repointing = tracks.some((track) =>
				track.elements.some(
					(element) => element.type === "media" && element.mediaId === NEW
				)
			);
			if (sceneId === "scene-c" && repointing) {
				throw new Error("Scene C could not be saved");
			}
		});
		try {
			await expect(renameProjectMedia(RENAME)).rejects.toThrow(
				"Scene C could not be saved"
			);
		} finally {
			project.activeProject.scenes = [{ id: "scene-main" }, { id: "scene-b" }];
			storage.saveTimeline.mockImplementation(async () => undefined);
		}

		// The editor holds the item under its old id again, as it was.
		expect(mediaState.mediaItems[0]).toMatchObject({
			id: OLD,
			name: "old.mp4",
			localPath: "/projects/project-1/media/old.mp4",
		});
		// The entry stored under the new id is gone; the old one was never touched.
		expect(storage.deleteMediaItem).toHaveBeenCalledTimes(1);
		expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", NEW);
		// The open scene points at the old id again, and that was saved.
		expect(
			(timeline.tracks as TimelineTrack[])[0].elements.map((element) =>
				element.type === "media" ? element.mediaId : null
			)
		).toEqual([OLD, "media_other", OLD]);
		expect(timeline.saveImmediate).toHaveBeenCalledTimes(2);
		// Scene B, which had been saved with the new id, is back as it was read.
		const lastSaveOfB = storage.saveTimeline.mock.calls
			.map(([request]) => request as { sceneId: string; tracks: unknown })
			.filter((request) => request.sceneId === "scene-b")
			.at(-1);
		expect(lastSaveOfB?.tracks).toBe(sceneB);
		// The stickers were not reached.
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(OLD);
		expect(project.markProjectContentChanged).not.toHaveBeenCalled();
	});

	it("takes the open scene back when it cannot be saved", async () => {
		timeline.saveImmediate.mockResolvedValueOnce(false);
		await expect(renameProjectMedia(RENAME)).rejects.toThrow(
			"The timeline could not be saved with the renamed media"
		);
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(OLD);
		expect(
			(timeline.tracks as TimelineTrack[])[0].elements.map((element) =>
				element.type === "media" ? element.mediaId : null
			)
		).toEqual([OLD, "media_other", OLD]);
		expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", NEW);
	});

	/**
	 * The asker waits only so long, then renames the file back. A rename
	 * that finishes after that must not leave anything on the new id.
	 */
	it("changes nothing when copying the file outlasts the asker's wait", async () => {
		await expect(
			renameProjectMedia({ ...RENAME, deadlineAt: Date.now() - 1 })
		).rejects.toThrow("took longer than the request waits for");
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(OLD);
		expect(timeline.saveImmediate).not.toHaveBeenCalled();
		// Only the copy made under the new id is removed.
		expect(storage.deleteMediaItem).toHaveBeenCalledTimes(1);
		expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", NEW);
	});

	it("takes everything back when the wait runs out on the last step", async () => {
		storage.loadTimeline.mockImplementation(async (request: unknown) => {
			await new Promise((resolve) => setTimeout(resolve, 60));
			return (request as { sceneId?: string }).sceneId === "scene-b"
				? [mediaTrack([OLD])]
				: null;
		});
		await expect(
			renameProjectMedia({ ...RENAME, deadlineAt: Date.now() + 25 })
		).rejects.toThrow("took longer than the request waits for");
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(OLD);
		expect(
			(timeline.tracks as TimelineTrack[])[0].elements.map((element) =>
				element.type === "media" ? element.mediaId : null
			)
		).toEqual([OLD, "media_other", OLD]);
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(OLD);
		// Saved with the new id, then saved back; the old entry never removed.
		expect(stickers.saveToProject).toHaveBeenCalledTimes(2);
		expect(storage.deleteMediaItem).toHaveBeenCalledTimes(1);
		expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", NEW);
	});

	it("refuses a new id the project already holds", async () => {
		await expect(
			renameProjectMedia({ ...RENAME, toId: "media_other" })
		).rejects.toThrow("already has a media item");
		expect(storage.saveMediaItem).not.toHaveBeenCalled();
	});

	it("still repoints the clips of a file the editor had not loaded", async () => {
		mediaState.mediaItems = [];
		const result = await renameProjectMedia(RENAME);
		expect(result).toMatchObject({ mediaRenamed: false, clipsUpdated: 2 });
		expect(storage.saveMediaItem).not.toHaveBeenCalled();
		expect(storage.deleteMediaItem).not.toHaveBeenCalled();
	});

	it("keeps the rename when only the old entry could not be removed", async () => {
		storage.deleteMediaItem.mockRejectedValueOnce(new Error("Entry is busy"));
		const result = await renameProjectMedia(RENAME);
		expect(result).toMatchObject({ mediaRenamed: true, clipsUpdated: 2 });
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(NEW);
	});
});
