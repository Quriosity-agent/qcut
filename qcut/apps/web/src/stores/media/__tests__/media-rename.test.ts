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
	} as {
		id: string;
		currentSceneId: string;
		scenes: Array<{ id: string }>;
	} | null,
	/** The project the stores have finished loading. */
	loadedProjectId: "project-1" as string | null,
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
const platformStorage = vi.hoisted(() => ({
	load: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
	save: vi.fn(async (..._args: unknown[]) => true),
}));
const forgetAlpha = vi.hoisted(() => vi.fn());

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({ storage: platformStorage }),
}));

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

/** What storage holds: one timeline per project and scene. */
const storedTimelines = new Map<string, TimelineTrack[]>();
const timelineKey = ({
	projectId,
	sceneId,
}: {
	projectId: string;
	sceneId?: string;
}) => `${projectId}/${sceneId}`;

function mediaIdsOf(tracks: unknown): Array<string | null> {
	return (tracks as TimelineTrack[]).flatMap((track) =>
		track.elements.map((element) =>
			element.type === "media" ? element.mediaId : null
		)
	);
}

/** Another project is opened: the stores hold its media, clips and stickers. */
function openAnotherProject(): void {
	project.activeProject = {
		id: "project-2",
		currentSceneId: "scene-main",
		scenes: [{ id: "scene-main" }],
	};
	project.loadedProjectId = "project-2";
	// Ids follow file names, so the other project has both of them too.
	mediaState.mediaItems = [
		{ id: OLD, name: "old.mp4", type: "video", url: "blob:theirs" },
		{ id: NEW, name: "new.mp4", type: "video", url: "blob:theirs-new" },
	];
	timeline.tracks = [mediaTrack([NEW, OLD])];
	stickers.overlayStickers = new Map([
		["t1", { id: "t1", mediaItemId: NEW }],
		["t2", { id: "t2", mediaItemId: OLD }],
	]);
}

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
		project.activeProject = {
			id: "project-1",
			currentSceneId: "scene-main",
			scenes: [{ id: "scene-main" }, { id: "scene-b" }],
		};
		project.loadedProjectId = "project-1";
		storedTimelines.clear();
		storage.loadTimeline.mockImplementation(
			async (request: unknown) =>
				storedTimelines.get(
					timelineKey(request as { projectId: string; sceneId?: string })
				) ?? null
		);
		storage.saveTimeline.mockImplementation(async (request: unknown) => {
			const saved = request as {
				projectId: string;
				sceneId?: string;
				tracks: TimelineTrack[];
			};
			storedTimelines.set(timelineKey(saved), saved.tracks);
		});
		// As the timeline store does: what it holds, to the open scene.
		timeline.saveImmediate.mockImplementation(async () => {
			const active = project.activeProject;
			if (!active) return false;
			storedTimelines.set(
				timelineKey({
					projectId: active.id,
					sceneId: active.currentSceneId,
				}),
				timeline.tracks as TimelineTrack[]
			);
			return true;
		});
		stickers.saveToProject.mockImplementation(async () => undefined);
		platformStorage.load.mockImplementation(async () => null);
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
		expect(storage.saveMediaItem).toHaveBeenCalledWith("project-1", renamed);
		expect(forgetAlpha).toHaveBeenCalledWith({ localPath: RENAME.localPath });
		// Stored under the new id, and the old entry removed after that, once
		// the answer is out.
		await vi.waitFor(() => {
			expect(project.markProjectContentChanged).toHaveBeenCalledWith(
				"project-1"
			);
		});
		expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", OLD);
		expect(storage.saveMediaItem.mock.invocationCallOrder[0]).toBeLessThan(
			storage.deleteMediaItem.mock.invocationCallOrder[0]
		);
	});

	/**
	 * The asker waits only so long for the answer, then puts the file back
	 * under its old name. Once the rename stands nothing here is taken back,
	 * so the answer must not wait for the tidying up that follows.
	 */
	it("answers as soon as the rename stands, before the old entry is removed", async () => {
		let removeOldEntry: () => void = () => undefined;
		storage.deleteMediaItem.mockImplementationOnce(
			() =>
				new Promise<undefined>((resolve) => {
					removeOldEntry = () => resolve(undefined);
				})
		);
		const result = await renameProjectMedia(RENAME);
		expect(result).toMatchObject({ mediaRenamed: true, clipsUpdated: 2 });
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(NEW);
		// Still removing: the project is marked as changed after that.
		await vi.waitFor(() => {
			expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", OLD);
		});
		expect(project.markProjectContentChanged).not.toHaveBeenCalled();
		removeOldEntry();
		await vi.waitFor(() => {
			expect(project.markProjectContentChanged).toHaveBeenCalledWith(
				"project-1"
			);
		});
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
		const sceneC = [mediaTrack([OLD, OLD])];
		project.activeProject = {
			id: "project-1",
			currentSceneId: "scene-main",
			scenes: [{ id: "scene-main" }, { id: "scene-b" }, { id: "scene-c" }],
		};
		storedTimelines.set("project-1/scene-b", [mediaTrack([OLD])]);
		storedTimelines.set("project-1/scene-c", sceneC);
		// Scene B is saved; saving scene C fails.
		storage.saveTimeline.mockImplementation(async (request: unknown) => {
			const saved = request as {
				projectId: string;
				sceneId: string;
				tracks: TimelineTrack[];
			};
			if (
				saved.sceneId === "scene-c" &&
				mediaIdsOf(saved.tracks).includes(NEW)
			) {
				throw new Error("Scene C could not be saved");
			}
			storedTimelines.set(timelineKey(saved), saved.tracks);
		});
		await expect(renameProjectMedia(RENAME)).rejects.toThrow(
			"Scene C could not be saved"
		);

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
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
		expect(timeline.saveImmediate).toHaveBeenCalledTimes(2);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			OLD,
			"media_other",
			OLD,
		]);
		// Scene B, which had been saved with the new id, names the old one again.
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-b"))).toEqual([OLD]);
		// Scene C is as it was read.
		expect(storedTimelines.get("project-1/scene-c")).toBe(sceneC);
		// The stickers were not reached.
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(OLD);
		expect(project.markProjectContentChanged).not.toHaveBeenCalled();
	});

	it("reports the failure that stopped it, even when a step cannot be taken back", async () => {
		// The open scene saves, the stickers save; removing the new entry on
		// the way back fails.
		storage.loadTimeline.mockImplementation(async () => {
			throw new Error("The other scene could not be read");
		});
		storage.deleteMediaItem.mockRejectedValueOnce(new Error("Entry is busy"));
		await expect(renameProjectMedia(RENAME)).rejects.toThrow(
			"The other scene could not be read"
		);
		// Everything else was still taken back.
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(OLD);
		expect(
			(timeline.tracks as TimelineTrack[])[0].elements.map((element) =>
				element.type === "media" ? element.mediaId : null
			)
		).toEqual([OLD, "media_other", OLD]);
	});

	/**
	 * The asker puts the file back whenever the editor fails. A step the
	 * editor could not put back leaves the project naming the new id
	 * somewhere, so it is tried again, and named if it still fails.
	 */
	it("tries a step again that could not be taken back", async () => {
		storedTimelines.set("project-1/scene-b", [mediaTrack([OLD])]);
		storage.saveTimeline.mockImplementation(async (request: unknown) => {
			const saved = request as {
				projectId: string;
				sceneId: string;
				tracks: TimelineTrack[];
			};
			if (mediaIdsOf(saved.tracks).includes(NEW)) {
				throw new Error("Scene B could not be saved");
			}
			storedTimelines.set(timelineKey(saved), saved.tracks);
		});
		// Saved going forward; on the way back the first save fails.
		timeline.saveImmediate
			.mockImplementationOnce(async () => true)
			.mockImplementationOnce(async () => false);
		const failure = await renameProjectMedia(RENAME).catch(
			(error: Error) => error
		);
		expect((failure as Error).message).toBe("Scene B could not be saved");
		expect(timeline.saveImmediate).toHaveBeenCalledTimes(3);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			OLD,
			"media_other",
			OLD,
		]);
	});

	it("says what could not be taken back", async () => {
		storage.loadTimeline.mockImplementation(async () => {
			throw new Error("The other scene could not be read");
		});
		// The open scene is saved going forward, and never again.
		timeline.saveImmediate
			.mockImplementationOnce(async () => true)
			.mockImplementation(async () => false);
		const failure = await renameProjectMedia(RENAME).catch(
			(error: Error) => error
		);
		const { message } = failure as Error;
		expect(message).toContain("The other scene could not be read");
		expect(message).toContain("Not everything could be taken back");
		expect(message).toContain("the open scene's timeline");
		expect(message).toContain(NEW);
		// What could be taken back was: the editor's own state is as it was.
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(OLD);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
		expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", NEW);
	});

	/**
	 * Each rename reads a stored scene, changes it and saves it. Two at once
	 * read the same tracks, and the one that saved last put the other's old
	 * id back.
	 */
	it("runs one rename at a time for a project", async () => {
		const other = {
			id: "media_other",
			name: "other.mp4",
			type: "video",
			file: new File(["other"], "other.mp4", { type: "video/mp4" }),
			localPath: "/projects/project-1/media/other.mp4",
		};
		mediaState.mediaItems = [mediaState.mediaItems[0], other];
		storedTimelines.set("project-1/scene-b", [
			mediaTrack([OLD, "media_other"]),
		]);
		storage.loadTimeline.mockImplementation(async (request: unknown) => {
			const tracks =
				storedTimelines.get(
					timelineKey(request as { projectId: string; sceneId?: string })
				) ?? null;
			// Read, then a pause: time for another rename to read the same.
			await new Promise((resolve) => setTimeout(resolve, 20));
			return tracks;
		});
		const results = await Promise.all([
			renameProjectMedia(RENAME),
			renameProjectMedia({
				projectId: "project-1",
				fromId: "media_other",
				toId: "media_other_2",
				name: "other-2.mp4",
				localPath: "/projects/project-1/media/other-2.mp4",
			}),
		]);
		expect(results.map((result) => result.clipsUpdated)).toEqual([3, 2]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-b"))).toEqual([
			NEW,
			"media_other_2",
		]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other_2", NEW]);
		expect(
			(mediaState.mediaItems as Array<{ id: string }>).map((item) => item.id)
		).toEqual([NEW, "media_other_2"]);
	});

	it("goes on to the next rename when one fails", async () => {
		storage.saveMediaItem.mockRejectedValueOnce(new Error("Quota exceeded"));
		const [first, second] = await Promise.allSettled([
			renameProjectMedia(RENAME),
			renameProjectMedia({ ...RENAME, toId: "media_bmV3LTIubXA0" }),
		]);
		expect(first).toMatchObject({ status: "rejected" });
		expect(second).toMatchObject({
			status: "fulfilled",
			value: { mediaRenamed: true, clipsUpdated: 2 },
		});
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(
			"media_bmV3LTIubXA0"
		);
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
		storage.saveMediaItem.mockImplementationOnce(async () => {
			await new Promise((resolve) => setTimeout(resolve, 80));
		});
		await expect(
			renameProjectMedia({ ...RENAME, deadlineAt: Date.now() + 40 })
		).rejects.toThrow("took longer than the request waits for");
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(OLD);
		expect(timeline.saveImmediate).not.toHaveBeenCalled();
		// Only the copy made under the new id is removed.
		expect(storage.deleteMediaItem).toHaveBeenCalledTimes(1);
		expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", NEW);
	});

	it("does not start once the wait is over", async () => {
		await expect(
			renameProjectMedia({ ...RENAME, deadlineAt: Date.now() - 1 })
		).rejects.toThrow("took longer than the request waits for");
		expect(storage.saveMediaItem).not.toHaveBeenCalled();
		expect(storage.deleteMediaItem).not.toHaveBeenCalled();
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(OLD);
	});

	it("takes everything back when the wait runs out on the last step", async () => {
		storedTimelines.set("project-1/scene-b", [mediaTrack([OLD])]);
		// Saving the stickers, the last step, outlasts the wait.
		stickers.saveToProject.mockImplementationOnce(async () => {
			await new Promise((resolve) => setTimeout(resolve, 80));
		});
		await expect(
			renameProjectMedia({ ...RENAME, deadlineAt: Date.now() + 40 })
		).rejects.toThrow("took longer than the request waits for");
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(OLD);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-b"))).toEqual([OLD]);
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(OLD);
		// Saved with the new id, then saved back; the old entry never removed.
		expect(stickers.saveToProject).toHaveBeenCalledTimes(2);
		expect(storage.deleteMediaItem).toHaveBeenCalledTimes(1);
		expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", NEW);
	});

	it("stops before the stickers when the wait ran out on the scenes", async () => {
		storage.loadTimeline.mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 80));
			return null;
		});
		await expect(
			renameProjectMedia({ ...RENAME, deadlineAt: Date.now() + 40 })
		).rejects.toThrow("took longer than the request waits for");
		expect(stickers.saveToProject).not.toHaveBeenCalled();
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
	});

	it("refuses a project that is not open, or still being opened", async () => {
		// Its record is the active one, its media and timeline not loaded yet.
		project.loadedProjectId = null;
		await expect(renameProjectMedia(RENAME)).rejects.toThrow(
			"is not open in the editor, or is still being opened"
		);
		expect(storage.saveMediaItem).not.toHaveBeenCalled();
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);

		project.activeProject = null;
		await expect(renameProjectMedia(RENAME)).rejects.toThrow(
			"is not open in the editor"
		);
	});

	/**
	 * Media ids follow file names, so they repeat across projects. A rename
	 * that is still copying its file when another project is opened must not
	 * re-key that project's item, nor repoint its clips and stickers.
	 */
	it("stops, and leaves another project alone, when one is opened while the file is copied", async () => {
		storage.saveMediaItem.mockImplementationOnce(async () => {
			openAnotherProject();
		});
		await expect(renameProjectMedia(RENAME)).rejects.toThrow(
			"another project or scene opened"
		);

		// Theirs, untouched: going forward and taking back.
		expect(mediaState.mediaItems).toMatchObject([
			{ id: OLD, url: "blob:theirs" },
			{ id: NEW, url: "blob:theirs-new" },
		]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, OLD]);
		expect(timeline.saveImmediate).not.toHaveBeenCalled();
		expect(stickers.overlayStickers.get("t1")?.mediaItemId).toBe(NEW);
		expect(stickers.saveToProject).not.toHaveBeenCalled();
		// Only the copy this project made under the new id is removed.
		expect(storage.deleteMediaItem).toHaveBeenCalledTimes(1);
		expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", NEW);
		expect(storage.saveTimeline).not.toHaveBeenCalled();
	});

	it("takes its saved scenes and stickers back in storage when another project opens on the last step", async () => {
		storedTimelines.set("project-1/scene-b", [mediaTrack([OLD])]);
		// The stickers are saved with the new id, then the project is left.
		stickers.saveToProject.mockImplementationOnce(async () => {
			platformStorage.load.mockImplementation(async (key: unknown) =>
				key === "overlay-stickers-project-1"
					? [
							{ id: "s1", mediaItemId: NEW },
							{ id: "s2", mediaItemId: "media_other" },
						]
					: null
			);
			openAnotherProject();
		});
		await expect(renameProjectMedia(RENAME)).rejects.toThrow(
			"another project or scene opened"
		);

		// What this project had saved names the old id again, in every scene.
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			OLD,
			"media_other",
			OLD,
		]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-b"))).toEqual([OLD]);
		expect(platformStorage.save).toHaveBeenCalledTimes(1);
		expect(platformStorage.save).toHaveBeenCalledWith(
			"overlay-stickers-project-1",
			[
				{ id: "s1", mediaItemId: OLD },
				{ id: "s2", mediaItemId: "media_other" },
			]
		);
		expect(storage.deleteMediaItem).toHaveBeenCalledTimes(1);
		expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", NEW);
		// The project now open kept its own, which bear the same ids.
		expect(mediaState.mediaItems).toMatchObject([
			{ id: OLD, url: "blob:theirs" },
			{ id: NEW, url: "blob:theirs-new" },
		]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, OLD]);
		expect(stickers.overlayStickers.get("t1")?.mediaItemId).toBe(NEW);
		expect(storedTimelines.has("project-2/scene-main")).toBe(false);
		expect(project.markProjectContentChanged).not.toHaveBeenCalled();
	});

	it("stops when another scene of the project is opened, each scene taken back where it is", async () => {
		const sceneB = [mediaTrack([OLD])];
		storedTimelines.set("project-1/scene-b", sceneB);
		// Scene B is opened once the rename has repointed it in storage: the
		// store then holds it as the rename saved it.
		stickers.saveToProject.mockImplementationOnce(async () => {
			timeline.tracks = storedTimelines.get("project-1/scene-b") ?? [];
			project.activeProject = {
				id: "project-1",
				currentSceneId: "scene-b",
				scenes: [{ id: "scene-main" }, { id: "scene-b" }],
			};
		});
		await expect(renameProjectMedia(RENAME)).rejects.toThrow(
			"another project or scene opened"
		);

		// Scene B, open by now, goes back in the store and is saved from it.
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-b"))).toEqual([OLD]);
		// The scene that was open goes back in storage.
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			OLD,
			"media_other",
			OLD,
		]);
		// The project is still the open one: its item and stickers go back
		// in the stores.
		expect((mediaState.mediaItems[0] as { id: string }).id).toBe(OLD);
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(OLD);
		expect(platformStorage.save).not.toHaveBeenCalled();
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
		// The project is marked as changed all the same.
		await vi.waitFor(() => {
			expect(project.markProjectContentChanged).toHaveBeenCalledWith(
				"project-1"
			);
		});
	});
});
