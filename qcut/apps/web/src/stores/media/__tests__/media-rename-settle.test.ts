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
	/** What the file at a path looks like, where a test tells files apart. */
	looks: new Map<string, { size: number; modified: Date }>(),
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
			list: async () => [...desktop.stored.keys()],
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
				// As the desktop app shows a file: the time is a date.
				return { path: filePath, size: 1, ...desktop.looks.get(filePath) };
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
				// What the store holds, as its save would write it.
				get _tracks() {
					return timeline.tracks;
				},
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
	noteUnsettledRename,
	readUnsettledRenames,
	type UnsettledRename,
} from "../media-rename-notes";

const OLD = "media_b2xkLm1wNA";
const NEW = "media_bmV3Lm1wNA";
const OLD_PATH = "/projects/project-1/media/old.mp4";
const NEW_PATH = "/projects/project-1/media/new.mp4";
/** The key of the note for the two ids above (media-rename-notes.test.ts). */
const NOTES =
	"media-rename-unsettled-project-1-a3cbdd9407c9b3ca14077f6663acc643";
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
/** What the renamed file looks like, and another file that took a name. */
const THE_FILE = { size: 4096, modified: new Date("2026-11-01T08:00:00.123Z") };
const ANOTHER_FILE = {
	size: 512,
	modified: new Date("2026-11-17T09:30:00.000Z"),
};
/** The note the desktop app writes before it moves the file. */
const APP_NOTE: UnsettledRename = {
	...NOTE,
	file: { size: THE_FILE.size, modifiedAt: THE_FILE.modified.getTime() },
};

/** The desktop app's note of a file that could not be put back. */
const FILE_STAYS_NOTE: UnsettledRename = {
	oldId: NEW,
	oldName: "new.mp4",
	oldPath: NEW_PATH,
	newId: OLD,
	newName: "old.mp4",
	newPath: OLD_PATH,
	file: APP_NOTE.file,
	decided: true,
	notedAt: 0,
};

/** How far the clock has been put on since the test began. */
const clock = { ahead: 0 };
const realNow = Date.now.bind(Date);
/** Time goes by: a note written just now is no longer one being worked on. */
function sometimeLater(): void {
	clock.ahead += 10 * 60 * 1000;
}

const storedTimelines = new Map<string, TimelineTrack[]>();

/**
 * How the saves of project-1's open scene go, one entry a save: `false`
 * fails it. Past the list they go as `otherwise` says.
 */
const openSceneSaves = {
	count: 0,
	plan: [] as boolean[],
	otherwise: true,
};

/** What storage does with a timeline it is given. */
function storeTimeline(request: unknown): void {
	const saved = request as {
		projectId: string;
		sceneId: string;
		tracks: TimelineTrack[];
	};
	const key = `${saved.projectId}/${saved.sceneId}`;
	if (key === "project-1/scene-main") {
		const saves =
			openSceneSaves.plan[openSceneSaves.count] ?? openSceneSaves.otherwise;
		openSceneSaves.count += 1;
		if (!saves) throw new Error("The open scene could not be saved");
	}
	storedTimelines.set(key, saved.tracks);
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
		clock.ahead = 0;
		vi.spyOn(Date, "now").mockImplementation(() => realNow() + clock.ahead);
		desktop.stored.clear();
		desktop.files = new Set([OLD_PATH]);
		desktop.looks.clear();
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
		openSceneSaves.count = 0;
		openSceneSaves.plan = [];
		openSceneSaves.otherwise = true;
		storage.saveTimeline.mockImplementation(async (request: unknown) => {
			storeTimeline(request);
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
		storage.saveTimeline.mockImplementation(async (request: unknown) => {
			if ((request as { sceneId: string }).sceneId === "scene-b") {
				throw new Error("Scene B could not be saved");
			}
			storeTimeline(request);
		});
		// Saved going forward; never while it is taken back.
		openSceneSaves.plan = [true];
		openSceneSaves.otherwise = false;
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
		sometimeLater();
		openSceneSaves.otherwise = true;
		storage.saveTimeline.mockImplementation(async (request: unknown) => {
			storeTimeline(request);
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
		// The desktop app noted the rename before it asked.
		desktop.stored.set(NOTES, { ...APP_NOTE, notedAt: Date.now() });

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
		// The file is still under its new name: whether it gets back is the
		// desktop app's to know, and the note its to drop.
		expect(desktop.stored.get(NOTES)).toMatchObject({
			oldId: OLD,
			newId: NEW,
			file: APP_NOTE.file,
		});
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
		expect(openSceneSaves.count).toBe(1);
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
		openSceneSaves.otherwise = false;
		await expect(renameProjectMedia(BACK_ON_OLD)).rejects.toThrow(
			"The timeline could not be saved"
		);
		expect(await readUnsettledRenames("project-1")).toMatchObject([
			{ oldId: OLD, oldPath: OLD_PATH, newId: NEW, newPath: NEW_PATH },
		]);

		sometimeLater();
		openSceneSaves.otherwise = true;
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
		expect(storage.saveTimeline).not.toHaveBeenCalled();
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
			rename: { ...NOTE, decided: true, notedAt: Date.now() },
		});
		timeline.tracks = [mediaTrack([NEW])];

		// Neither name has a file: nothing to go by.
		desktop.files = new Set();
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		// The folder cannot be asked at all.
		desktop.files = "unreadable";
		await settleUnsettledMediaRenames({ projectId: "project-1" });

		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW]);
		expect(storage.saveTimeline).not.toHaveBeenCalled();
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
		openSceneSaves.otherwise = false;
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(await readUnsettledRenames("project-1")).toHaveLength(1);
		// Taken back: the editor is as it was before the attempt.
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW]);
	});

	/**
	 * The desktop app notes a rename before it asks the editor to go back
	 * and before it moves the file. A project that finishes loading in
	 * between (the editor was reloaded) saw the file under its new name,
	 * followed it and dropped the note; the file then went back.
	 */
	it("leaves a note alone while the desktop app may still be moving the file", async () => {
		await renameProjectMedia(RENAME);
		desktop.files = new Set([NEW_PATH]);
		const notedAt = Date.now();
		desktop.stored.set(NOTES, { ...APP_NOTE, notedAt });

		const { lookAgainAt } = await settleUnsettledMediaRenames({
			projectId: "project-1",
		});
		expect(heldIds()).toEqual([NEW]);
		expect(desktop.stored.has(NOTES)).toBe(true);
		expect(storage.saveTimeline).toHaveBeenCalledTimes(1);
		// When to look again: once the app must be done.
		expect(lookAgainAt).toBe(notedAt + 5 * 60 * 1000);

		// The file went back, and nothing more was heard of the app.
		desktop.files = new Set([OLD_PATH]);
		sometimeLater();
		expect(
			await settleUnsettledMediaRenames({ projectId: "project-1" })
		).toEqual({});
		expect(heldIds()).toEqual([OLD]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("settles at once a note the desktop app says it is done with", async () => {
		await renameProjectMedia(RENAME);
		desktop.stored.set(NOTES, {
			...APP_NOTE,
			decided: true,
			notedAt: Date.now(),
		});
		expect(
			await settleUnsettledMediaRenames({ projectId: "project-1" })
		).toEqual({});
		expect(heldIds()).toEqual([OLD]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	/**
	 * The editor made the rename and its answer was lost; the request to go
	 * back could not reach it (its window was gone), and the file was put
	 * back. All that is left is the desktop app's note.
	 */
	it("is back on the old id when the project is next opened, by the desktop app's note alone", async () => {
		await renameProjectMedia(RENAME);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			NEW,
			"media_other",
			NEW,
		]);
		desktop.stored.set(NOTES, {
			...APP_NOTE,
			decided: true,
			notedAt: Date.now(),
		});
		// Opened again: the stores hold the rename as it was stored.
		reopenProject({
			items: [item({ id: NEW, name: "new.mp4", path: NEW_PATH })],
		});
		stickers.overlayStickers = new Map([
			["s1", { id: "s1", mediaItemId: NEW }],
		]);

		await settleUnsettledMediaRenames({ projectId: "project-1" });

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

	/**
	 * The file could not be put back because another file had taken its old
	 * name. Both names have a file then, and the old one won: the clips went
	 * to a file that was never theirs.
	 */
	it("follows the renamed file, not another file that has taken its old name", async () => {
		desktop.files = new Set([OLD_PATH, NEW_PATH]);
		desktop.looks.set(NEW_PATH, THE_FILE);
		desktop.looks.set(OLD_PATH, ANOTHER_FILE);
		desktop.stored.set(NOTES, APP_NOTE);

		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(mediaState.mediaItems[0]).toMatchObject({
			id: NEW,
			localPath: NEW_PATH,
		});
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("stays on the old name when the renamed file is the one that has it", async () => {
		desktop.files = new Set([OLD_PATH, NEW_PATH]);
		desktop.looks.set(OLD_PATH, THE_FILE);
		desktop.looks.set(NEW_PATH, ANOTHER_FILE);
		desktop.stored.set(NOTES, APP_NOTE);
		timeline.tracks = [mediaTrack([NEW, OLD])];

		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(heldIds()).toEqual([OLD]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, OLD]);
	});

	it("goes by the name the note expects when the two files cannot be told apart", async () => {
		desktop.files = new Set([OLD_PATH, NEW_PATH]);
		// The file stayed renamed: the desktop app expects it under new.mp4.
		desktop.stored.set(NOTES, {
			oldId: NEW,
			oldName: "new.mp4",
			oldPath: NEW_PATH,
			newId: OLD,
			newName: "old.mp4",
			newPath: OLD_PATH,
			decided: true,
			notedAt: Date.now(),
		});

		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(heldIds()).toEqual([NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	/**
	 * The file kept its new name because another file had taken the old
	 * one, and the editor followed it. The other file is then brought into
	 * the project as a media item of its own, under the old id, and used. A
	 * note left from the rename took that item for a copy the rename had
	 * left behind: it was dropped, and its clips went to the renamed file.
	 */
	it("does not make one item of two when another file has the old name, an item of its own and clips", async () => {
		desktop.files = new Set([OLD_PATH, NEW_PATH]);
		desktop.looks.set(NEW_PATH, THE_FILE);
		desktop.looks.set(OLD_PATH, ANOTHER_FILE);
		reopenProject({
			items: [
				item({ id: OLD, name: "old.mp4", path: OLD_PATH }),
				item({ id: NEW, name: "new.mp4", path: NEW_PATH }),
			],
		});
		timeline.tracks = [mediaTrack([OLD, NEW])];
		desktop.stored.set(NOTES, FILE_STAYS_NOTE);

		await settleUnsettledMediaRenames({ projectId: "project-1" });

		expect(heldIds()).toEqual([OLD, NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, NEW]);
		expect(storage.saveTimeline).not.toHaveBeenCalled();
		expect(storage.deleteMediaItem).not.toHaveBeenCalled();
		// Nothing is apart: the note has nothing left to say.
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("counts a clip in a scene that is not open as use", async () => {
		desktop.files = new Set([OLD_PATH, NEW_PATH]);
		desktop.looks.set(NEW_PATH, THE_FILE);
		desktop.looks.set(OLD_PATH, ANOTHER_FILE);
		reopenProject({
			items: [
				item({ id: OLD, name: "old.mp4", path: OLD_PATH }),
				item({ id: NEW, name: "new.mp4", path: NEW_PATH }),
			],
		});
		stickers.overlayStickers = new Map();
		timeline.tracks = [mediaTrack([OLD])];
		storedTimelines.set("project-1/scene-b", [mediaTrack([NEW])]);
		desktop.stored.set(NOTES, FILE_STAYS_NOTE);

		await settleUnsettledMediaRenames({ projectId: "project-1" });

		expect(heldIds()).toEqual([OLD, NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-b"))).toEqual([NEW]);
	});

	it("keeps the note when the project is left while its scenes are looked at", async () => {
		desktop.files = new Set([OLD_PATH, NEW_PATH]);
		desktop.looks.set(NEW_PATH, THE_FILE);
		desktop.looks.set(OLD_PATH, ANOTHER_FILE);
		reopenProject({
			items: [
				item({ id: OLD, name: "old.mp4", path: OLD_PATH }),
				item({ id: NEW, name: "new.mp4", path: NEW_PATH }),
			],
		});
		stickers.overlayStickers = new Map();
		timeline.tracks = [];
		desktop.stored.set(NOTES, FILE_STAYS_NOTE);
		// Another project is opened while the stored scene is read. Its
		// timeline plays media of the same ids.
		storage.loadTimeline.mockImplementation(async () => {
			project.activeProject = {
				id: "project-2",
				currentSceneId: "scene-main",
				scenes: [{ id: "scene-main" }],
			};
			project.loadedProjectId = "project-2";
			timeline.tracks = [mediaTrack([OLD, NEW])];
			return [mediaTrack([OLD])];
		});

		await settleUnsettledMediaRenames({ projectId: "project-1" });

		// Nothing was concluded from the other project's timeline.
		expect(desktop.stored.has(NOTES)).toBe(true);
		expect(heldIds()).toEqual([OLD, NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, NEW]);
		expect(storage.saveTimeline).not.toHaveBeenCalled();
	});

	/**
	 * The editor never followed the file: it was reloaded, or its window
	 * was gone. Opened again, the project finds the renamed file in its
	 * folder and brings it in as a new item, while the item the clips are
	 * on has the name another file took. The clips are the renamed file's.
	 */
	it("takes the clips to the renamed file when the project had not followed it", async () => {
		desktop.files = new Set([OLD_PATH, NEW_PATH]);
		desktop.looks.set(NEW_PATH, THE_FILE);
		desktop.looks.set(OLD_PATH, ANOTHER_FILE);
		reopenProject({
			items: [
				item({ id: OLD, name: "old.mp4", path: OLD_PATH }),
				// Found in the folder when the project was opened.
				item({ id: NEW, name: "new.mp4", path: NEW_PATH }),
			],
		});
		desktop.stored.set(NOTES, FILE_STAYS_NOTE);

		await settleUnsettledMediaRenames({ projectId: "project-1" });

		expect(heldIds()).toEqual([NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(NEW);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});
});
