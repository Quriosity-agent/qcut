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
/** The desktop app's key-value store and its view of the project folder. */
const desktop = vi.hoisted(() => ({
	stored: new Map<string, unknown>(),
	/** The paths that have a file; "unreadable" when the folder cannot be asked. */
	files: new Set<string>() as Set<string> | "unreadable",
}));

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({
		storage: {
			load: async (key: string) => desktop.stored.get(key) ?? null,
			save: async (key: string, value: unknown) => {
				desktop.stored.set(key, value);
				return true;
			},
			remove: async (key: string) => desktop.stored.delete(key),
		},
		files: {
			getFileInfo: async (filePath: string) => {
				if (desktop.files === "unreadable") {
					throw new Error("Error invoking remote method 'get-file-info'");
				}
				if (!desktop.files.has(filePath)) {
					// As the desktop app answers a file that is not there.
					throw new Error(
						`ENOENT: no such file or directory, stat '${filePath}'`
					);
				}
				return { path: filePath, size: 1 };
			},
		},
	}),
}));
vi.mock("@/lib/storage/storage-service", () => ({ storageService: storage }));
vi.mock("@/lib/media/alpha-playback-proxy", () => ({
	forgetMediaAlphaInspection: vi.fn(),
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
import {
	renameProjectMedia,
	settleUnsettledMediaRenames,
} from "../media-rename";
import {
	forgetUnsettledRename,
	noteUnsettledRename,
	readUnsettledRenames,
	resetUnsettledRenameChanges,
	type UnsettledRename,
} from "../media-rename-notes";

const OLD = "media_b2xkLm1wNA";
const NEW = "media_bmV3Lm1wNA";
const OLD_PATH = "/projects/project-1/media/old.mp4";
const NEW_PATH = "/projects/project-1/media/new.mp4";
const NOTES = "media-renames-unsettled-project-1";
/** The rename the desktop app asks the editor to follow. */
const RENAME = {
	projectId: "project-1",
	fromId: OLD,
	toId: NEW,
	name: "new.mp4",
	localPath: NEW_PATH,
	previous: { name: "old.mp4", localPath: OLD_PATH },
};
/** What it asks when the file has its old name for good. */
const BACK_ON_OLD = {
	projectId: "project-1",
	fromId: NEW,
	toId: OLD,
	name: "old.mp4",
	localPath: OLD_PATH,
	previous: { name: "new.mp4", localPath: NEW_PATH },
	settles: true,
};
const NOTE: UnsettledRename = {
	oldId: OLD,
	oldName: "old.mp4",
	oldPath: OLD_PATH,
	newId: NEW,
	newName: "new.mp4",
	newPath: NEW_PATH,
	notedAt: 0,
};

const storedTimelines = new Map<string, TimelineTrack[]>();

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

function mediaIdsOf(tracks: unknown): Array<string | null> {
	return (tracks as TimelineTrack[]).flatMap((track) =>
		track.elements.map((element) =>
			element.type === "media" ? element.mediaId : null
		)
	);
}

function item({ id, name, path }: { id: string; name: string; path: string }) {
	return {
		id,
		name,
		type: "video",
		file: new File(["picture"], name, { type: "video/mp4" }),
		url: `blob:${id}`,
		localPath: path,
	};
}

const heldIds = () =>
	(mediaState.mediaItems as Array<{ id: string }>).map((held) => held.id);

/** The project is opened again: the stores hold what storage holds. */
function reopenProject({ items }: { items: unknown[] }): void {
	mediaState.mediaItems = items;
	timeline.tracks = storedTimelines.get("project-1/scene-main") ?? [];
}

describe("a media rename that ended with the editor and the folder apart", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetMediaPersistenceQueue();
		resetUnsettledRenameChanges();
		desktop.stored.clear();
		desktop.files = new Set([OLD_PATH]);
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
					`${(request as { projectId: string }).projectId}/${(request as { sceneId: string }).sceneId}`
				) ?? null
		);
		storage.saveTimeline.mockImplementation(async (request: unknown) => {
			const saved = request as {
				projectId: string;
				sceneId: string;
				tracks: TimelineTrack[];
			};
			storedTimelines.set(`${saved.projectId}/${saved.sceneId}`, saved.tracks);
		});
		timeline.saveImmediate.mockImplementation(async () => {
			storedTimelines.set(
				"project-1/scene-main",
				timeline.tracks as TimelineTrack[]
			);
			return true;
		});
		mediaState.mediaItems = [
			item({ id: OLD, name: "old.mp4", path: OLD_PATH }),
		];
		timeline.tracks = [mediaTrack([OLD, "media_other", OLD])];
		storedTimelines.set(
			"project-1/scene-main",
			timeline.tracks as TimelineTrack[]
		);
		stickers.overlayStickers = new Map([
			["s1", { id: "s1", mediaItemId: OLD }],
		]);
	});

	/**
	 * The open scene was saved with the new id, a later step failed, and the
	 * save that would put the old id back failed too. The file is put back
	 * all the same, so the stored project named an id the file did not have,
	 * and nothing put that right once the project was closed.
	 */
	it("puts the stored project right when it is next opened, though the take-back could not be saved", async () => {
		storedTimelines.set("project-1/scene-b", [mediaTrack([OLD])]);
		storage.saveTimeline.mockImplementationOnce(async () => {
			throw new Error("Scene B could not be saved");
		});
		// Saved going forward; never while it is taken back.
		timeline.saveImmediate.mockImplementationOnce(async () => {
			storedTimelines.set(
				"project-1/scene-main",
				timeline.tracks as TimelineTrack[]
			);
			return true;
		});
		timeline.saveImmediate.mockImplementation(async () => false);
		await expect(renameProjectMedia(RENAME)).rejects.toThrow(
			"Not everything could be taken back"
		);
		// The editor has the old id again; what is stored has the new one.
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			NEW,
			"media_other",
			NEW,
		]);
		expect(await readUnsettledRenames("project-1")).toMatchObject([
			{ oldId: OLD, oldPath: OLD_PATH, newId: NEW, newPath: NEW_PATH },
		]);

		// The project is closed and opened again; saving works by then.
		timeline.saveImmediate.mockImplementation(async () => {
			storedTimelines.set(
				"project-1/scene-main",
				timeline.tracks as TimelineTrack[]
			);
			return true;
		});
		reopenProject({
			items: [item({ id: OLD, name: "old.mp4", path: OLD_PATH })],
		});
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		await settleUnsettledMediaRenames({ projectId: "project-1" });

		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			OLD,
			"media_other",
			OLD,
		]);
		expect(heldIds()).toEqual([OLD]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	/**
	 * The editor finished the rename, and its answer reached the desktop
	 * app too late: the file was put back. The desktop app then asks the
	 * editor to end on the old id.
	 */
	it("goes back to the old id when asked to settle after it had finished the rename", async () => {
		await renameProjectMedia(RENAME);
		expect(heldIds()).toEqual([NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);

		const result = await renameProjectMedia(BACK_ON_OLD);
		expect(result).toMatchObject({ mediaRenamed: true, clipsUpdated: 2 });
		expect(mediaState.mediaItems[0]).toMatchObject({
			id: OLD,
			name: "old.mp4",
			localPath: OLD_PATH,
		});
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			OLD,
			"media_other",
			OLD,
		]);
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(OLD);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("has nothing to change, and saves the open scene, when it had taken the rename back already", async () => {
		// The scene is stored with the new id; the store has the old one.
		storedTimelines.set("project-1/scene-main", [
			mediaTrack([NEW, "media_other", NEW]),
		]);
		const result = await renameProjectMedia(BACK_ON_OLD);
		expect(result).toEqual({
			mediaRenamed: false,
			clipsUpdated: 0,
			stickersUpdated: 0,
		});
		expect(heldIds()).toEqual([OLD]);
		expect(timeline.saveImmediate).toHaveBeenCalledTimes(1);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			OLD,
			"media_other",
			OLD,
		]);
	});

	it("has no deadline when it settles: the file keeps that name for good", async () => {
		await renameProjectMedia(RENAME);
		await expect(
			renameProjectMedia({ ...BACK_ON_OLD, deadlineAt: Date.now() - 1 })
		).resolves.toMatchObject({ clipsUpdated: 2 });
		expect(heldIds()).toEqual([OLD]);
	});

	it("notes a rename it was asked to settle and could not, and settles it later", async () => {
		await renameProjectMedia(RENAME);
		timeline.saveImmediate.mockImplementation(async () => false);
		await expect(renameProjectMedia(BACK_ON_OLD)).rejects.toThrow(
			"The timeline could not be saved"
		);
		expect(await readUnsettledRenames("project-1")).toMatchObject([
			{ oldId: OLD, oldPath: OLD_PATH, newId: NEW, newPath: NEW_PATH },
		]);

		timeline.saveImmediate.mockImplementation(async () => {
			storedTimelines.set(
				"project-1/scene-main",
				timeline.tracks as TimelineTrack[]
			);
			return true;
		});
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(heldIds()).toEqual([OLD]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			OLD,
			"media_other",
			OLD,
		]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("notes a request to settle for a project that is not open, and leaves the open one alone", async () => {
		project.activeProject = {
			id: "project-2",
			currentSceneId: "scene-main",
			scenes: [{ id: "scene-main" }],
		};
		project.loadedProjectId = "project-2";
		// The open project has media and clips of the same ids.
		mediaState.mediaItems = [
			item({ id: NEW, name: "new.mp4", path: "/p2/new.mp4" }),
		];
		timeline.tracks = [mediaTrack([NEW])];

		await expect(renameProjectMedia(BACK_ON_OLD)).rejects.toThrow(
			"is not open in the editor"
		);
		expect(heldIds()).toEqual([NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW]);
		expect(timeline.saveImmediate).not.toHaveBeenCalled();
		expect(await readUnsettledRenames("project-1")).toMatchObject([
			{ oldId: OLD, oldPath: OLD_PATH, newId: NEW, newPath: NEW_PATH },
		]);
		expect(await readUnsettledRenames("project-2")).toEqual([]);
	});

	it("follows the file when it kept the new name after all", async () => {
		// The editor took the rename back; the file could not be put back.
		desktop.files = new Set([NEW_PATH]);
		await noteUnsettledRename({ projectId: "project-1", rename: NOTE });
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(mediaState.mediaItems[0]).toMatchObject({
			id: NEW,
			name: "new.mp4",
			localPath: NEW_PATH,
		});
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("drops the copy a rename left behind when the project's own item is held too", async () => {
		reopenProject({
			items: [
				item({ id: OLD, name: "old.mp4", path: OLD_PATH }),
				item({ id: NEW, name: "new.mp4", path: NEW_PATH }),
			],
		});
		timeline.tracks = [mediaTrack([NEW, OLD])];
		await noteUnsettledRename({ projectId: "project-1", rename: NOTE });
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(heldIds()).toEqual([OLD]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, OLD]);
		await vi.waitFor(() => {
			expect(storage.deleteMediaItem).toHaveBeenCalledWith("project-1", NEW);
		});
		// The project's own copy is not stored again, nor removed.
		expect(storage.saveMediaItem).not.toHaveBeenCalled();
		expect(storage.deleteMediaItem).not.toHaveBeenCalledWith("project-1", OLD);
	});

	it("waits when the folder cannot say which name the file has", async () => {
		await noteUnsettledRename({
			projectId: "project-1",
			rename: { ...NOTE, notedAt: Date.now() },
		});
		timeline.tracks = [mediaTrack([NEW])];

		// Neither name has a file: nothing to go by.
		desktop.files = new Set();
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		// The folder cannot be asked at all.
		desktop.files = "unreadable";
		await settleUnsettledMediaRenames({ projectId: "project-1" });

		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW]);
		expect(timeline.saveImmediate).not.toHaveBeenCalled();
		expect(await readUnsettledRenames("project-1")).toHaveLength(1);
	});

	it("drops a note that nothing in the folder has spoken to for a day", async () => {
		desktop.files = new Set();
		await noteUnsettledRename({
			projectId: "project-1",
			rename: { ...NOTE, notedAt: Date.now() - 25 * 60 * 60 * 1000 },
		});
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("keeps the note when settling fails, for the next time", async () => {
		await noteUnsettledRename({ projectId: "project-1", rename: NOTE });
		timeline.tracks = [mediaTrack([NEW])];
		timeline.saveImmediate.mockImplementation(async () => false);
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(await readUnsettledRenames("project-1")).toHaveLength(1);
		// Taken back: the editor is as it was before the attempt.
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW]);
	});
});

describe("the notes of unsettled renames", () => {
	beforeEach(() => {
		resetUnsettledRenameChanges();
		desktop.stored.clear();
	});

	it("keeps one note for a pair of ids, and none once it is forgotten", async () => {
		await noteUnsettledRename({ projectId: "project-1", rename: NOTE });
		await noteUnsettledRename({
			projectId: "project-1",
			rename: { ...NOTE, notedAt: 5 },
		});
		await noteUnsettledRename({
			projectId: "project-1",
			rename: { ...NOTE, newId: "media_third", newPath: "/p/third.mp4" },
		});
		expect(
			(await readUnsettledRenames("project-1")).map((note) => [
				note.newId,
				note.notedAt,
			])
		).toEqual([
			[NEW, 5],
			["media_third", 0],
		]);
		// Another project's notes are its own.
		expect(await readUnsettledRenames("project-2")).toEqual([]);

		await forgetUnsettledRename({ projectId: "project-1", rename: NOTE });
		await forgetUnsettledRename({
			projectId: "project-1",
			rename: { newId: "media_third", oldId: OLD },
		});
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("keeps every note when several are written at once", async () => {
		await Promise.all(
			["a", "b", "c"].map((name) =>
				noteUnsettledRename({
					projectId: "project-1",
					rename: { ...NOTE, newId: `media_${name}` },
				})
			)
		);
		expect(await readUnsettledRenames("project-1")).toHaveLength(3);
	});

	it("reads nothing from what is not a list of notes", async () => {
		desktop.stored.set(NOTES, { not: "a list" });
		expect(await readUnsettledRenames("project-1")).toEqual([]);
		desktop.stored.set(NOTES, [NOTE, { newId: NEW }, "junk", null]);
		expect(await readUnsettledRenames("project-1")).toEqual([NOTE]);
	});
});
