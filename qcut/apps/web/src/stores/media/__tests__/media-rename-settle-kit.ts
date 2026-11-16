/**
 * What the tests of settling a media rename share: a project with one media
 * item on its timeline, the stores and the storage it lives in, and the
 * desktop app's side (the notes of renames it keeps, which of them it is at
 * work on, and its view of the project folder).
 *
 * A test file mocks each module with the stand-in of the same name in
 * `modules`, and calls `resetKit` before each test.
 */
import { vi } from "vitest";
import type { TimelineTrack } from "@/types/timeline";
import { repointMediaReferences } from "../../timeline/media-references";
import { resetMediaPersistenceQueue } from "../media-persistence-queue";
import type { UnsettledRename } from "../media-rename-notes";

export const storage = {
	saveMediaItem: vi.fn(async (..._args: unknown[]) => undefined),
	deleteMediaItem: vi.fn(async (..._args: unknown[]) => undefined),
	loadTimeline: vi.fn(async (..._args: unknown[]): Promise<unknown> => null),
	saveTimeline: vi.fn(async (..._args: unknown[]) => undefined),
};
export const project = {
	activeProject: null as {
		id: string;
		currentSceneId: string;
		scenes: Array<{ id: string }>;
	} | null,
	loadedProjectId: null as string | null,
	markProjectContentChanged: vi.fn(async (..._args: unknown[]) => new Date()),
};
export const timeline = { tracks: [] as unknown[] };
export const stickers = {
	overlayStickers: new Map<string, { id: string; mediaItemId: string }>(),
	saveToProject: vi.fn(async (..._args: unknown[]) => undefined),
};
/**
 * The desktop app's side: its key-value store, where it keeps the notes of
 * renames; the renames it is at work on; and its view of the project folder.
 */
export const desktop = {
	stored: new Map<string, unknown>(),
	/** The notes, by key, of the renames the app is at work on. */
	atWork: new Set<string>(),
	/** The app does not answer when it is asked for its notes. */
	notesUnreadable: false,
	/** What a file holds, for a test that has files read: by path. */
	contents: new Map<string, string>(),
	/** The paths that have a file; "unreadable" when the folder cannot be asked. */
	files: new Set<string>() as Set<string> | "unreadable",
	/** What the file at a path looks like, where a test tells files apart. */
	looks: new Map<string, { size: number; modified: Date }>(),
};
export const mediaState = { mediaItems: [] as unknown[] };

/** A note as the desktop app stores it: it says apart what it is at work on. */
type StoredNote = Omit<UnsettledRename, "atWork">;

/** The notes the desktop app keeps for a project, each with its key. */
function notesOf(projectId: string): Array<[string, StoredNote]> {
	return [...desktop.stored.entries()].filter(([key]) =>
		key.startsWith(`media-rename-unsettled-${projectId}-`)
	) as Array<[string, StoredNote]>;
}

/** The modules a rename works with, as these tests stand in for them. */
export const modules = {
	platformCore: {
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
			// The notes as the desktop app hands them out, and drops one.
			claude: {
				media: {
					unsettledRenames: async (projectId: string) => {
						if (desktop.notesUnreadable) {
							throw new Error(
								"Error invoking remote method 'claude:media:unsettled-renames'"
							);
						}
						return notesOf(projectId).map(([key, note]) => ({
							...note,
							atWork: desktop.atWork.has(key),
						}));
					},
					forgetSettledRename: async (request: {
						projectId: string;
						oldId: string;
						newId: string;
						notedAt: number;
					}) => {
						const pair = [request.newId, request.oldId].sort().join();
						for (const [key, note] of notesOf(request.projectId)) {
							if ([note.newId, note.oldId].sort().join() !== pair) continue;
							// At work on it, or written since the editor read it.
							if (desktop.atWork.has(key) || note.notedAt !== request.notedAt) {
								return false;
							}
							desktop.stored.delete(key);
						}
						return true;
					},
				},
			},
			files: {
				readFile: async (filePath: string) => {
					const held = desktop.contents.get(filePath);
					return held === undefined ? null : Buffer.from(held);
				},
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
	},
	storageService: { storageService: storage },
	alphaPlaybackProxy: { forgetMediaAlphaInspection: vi.fn() },
	projectStore: { useProjectStore: { getState: () => project } },
	stickersOverlayStore: {
		useStickersOverlayStore: {
			getState: () => stickers,
			setState: (next: Partial<typeof stickers>) =>
				Object.assign(stickers, next),
		},
	},
	timelineStore: {
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
	},
	mediaStore: {
		useMediaStore: {
			getState: () => mediaState,
			setState: (
				update: (state: typeof mediaState) => Partial<typeof mediaState>
			) => Object.assign(mediaState, update(mediaState)),
		},
	},
};

export const OLD = "media_b2xkLm1wNA";
export const NEW = "media_bmV3Lm1wNA";
export const OLD_PATH = "/projects/project-1/media/old.mp4";
export const NEW_PATH = "/projects/project-1/media/new.mp4";
/** The key the desktop app keeps the note of the two ids above under. */
export const NOTES =
	"media-rename-unsettled-project-1-a3cbdd9407c9b3ca14077f6663acc643";

/** The rename the desktop app asks the editor to follow. */
export const RENAME = {
	projectId: "project-1",
	fromId: OLD,
	toId: NEW,
	name: "new.mp4",
	localPath: NEW_PATH,
};
/** What it asks when the file is to have its old name again. */
export const BACK_ON_OLD = {
	projectId: "project-1",
	fromId: NEW,
	toId: OLD,
	name: "old.mp4",
	localPath: OLD_PATH,
	settles: true,
};
/** What it asks when the file could not be put back. */
export const FOLLOW_THE_FILE = { ...RENAME, settles: true };

/** What the renamed file looks like, and another file that took a name. */
export const THE_FILE = {
	size: 4096,
	modified: new Date("2026-11-01T08:00:00.123Z"),
};
export const ANOTHER_FILE = {
	size: 512,
	modified: new Date("2026-11-17T09:30:00.000Z"),
};
/** The renamed file, as the desktop app notes it. */
export const SEEN = {
	size: THE_FILE.size,
	modifiedAt: THE_FILE.modified.getTime(),
};

/** When the desktop app began the rename of old.mp4 to new.mp4. */
export const BEGAN_AT = Date.parse("2026-11-10T12:00:00.000Z");
/** A moment before that: the editor had the file's item by then. */
export const HELD_BEFORE = BEGAN_AT - 24 * 60 * 60 * 1000;
/** A moment after it: what the editor read then, it read since the rename. */
export const HELD_SINCE = BEGAN_AT + 60 * 60 * 1000;

/**
 * The desktop app's note of the rename of old.mp4 to new.mp4, as it writes
 * it before it moves the file: long ago, unless `extra` says otherwise.
 */
export function appNote(extra: Partial<StoredNote> = {}): StoredNote {
	return {
		oldId: OLD,
		oldName: "old.mp4",
		oldPath: OLD_PATH,
		newId: NEW,
		newName: "new.mp4",
		newPath: NEW_PATH,
		beganAt: BEGAN_AT,
		notedAt: 0,
		...extra,
	};
}

/** The desktop app notes the rename. */
export function noted(extra: Partial<StoredNote> = {}): void {
	desktop.stored.set(NOTES, appNote(extra));
}

export const storedTimelines = new Map<string, TimelineTrack[]>();

/**
 * How the saves of project-1's open scene go, one entry a save: `false`
 * fails it. Past the list they go as `otherwise` says.
 */
export const openSceneSaves = {
	count: 0,
	plan: [] as boolean[],
	otherwise: true,
};

/** What storage does with a timeline it is given. */
export function storeTimeline(request: unknown): void {
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

export function mediaTrack(mediaIds: string[]): TimelineTrack {
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

export function mediaIdsOf(tracks: unknown): Array<string | null> {
	return (tracks as TimelineTrack[]).flatMap((track) =>
		track.elements.map((element) =>
			element.type === "media" ? element.mediaId : null
		)
	);
}

/**
 * A media item. `copiedFrom` is the file its bytes were copied from, as the
 * item records it: the renamed file, unless a test says otherwise. And
 * `heldSince` is by when the editor held them: before the rename began,
 * unless a test says otherwise (null for a record that does not say).
 */
export function item({
	id,
	name,
	path,
	copiedFrom = THE_FILE,
	heldSince = HELD_BEFORE,
}: {
	id: string;
	name: string;
	path: string;
	copiedFrom?: { size: number; modified: Date } | null;
	heldSince?: number | null;
}) {
	return {
		id,
		name,
		type: "video",
		file: new File(["picture"], name, { type: "video/mp4" }),
		url: `blob:${id}`,
		localPath: path,
		...(copiedFrom
			? {
					metadata: {
						sourceFile: {
							size: copiedFrom.size,
							modifiedAt: copiedFrom.modified.getTime(),
							...(heldSince === null ? {} : { heldSince }),
						},
					},
				}
			: {}),
	};
}

export const OLD_ITEM = () =>
	item({ id: OLD, name: "old.mp4", path: OLD_PATH });
export const NEW_ITEM = () =>
	item({ id: NEW, name: "new.mp4", path: NEW_PATH });
/** The item of another file that has taken the old name since the rename. */
export const ANOTHER_FILES_ITEM = () =>
	item({
		id: OLD,
		name: "old.mp4",
		path: OLD_PATH,
		copiedFrom: ANOTHER_FILE,
		heldSince: HELD_SINCE,
	});

export const heldIds = () =>
	(mediaState.mediaItems as Array<{ id: string }>).map((held) => held.id);

/** The project is opened again: the stores hold what storage holds. */
export function reopenProject({ items }: { items: unknown[] }): void {
	mediaState.mediaItems = items;
	timeline.tracks = storedTimelines.get("project-1/scene-main") ?? [];
}

/**
 * Project-1 is open with two scenes. Its one media item, old.mp4, is on the
 * open scene's timeline twice and under one sticker, and the folder has the
 * file under that name. Nothing is noted.
 */
export function resetKit(): void {
	vi.clearAllMocks();
	resetMediaPersistenceQueue();
	desktop.stored.clear();
	desktop.atWork.clear();
	desktop.notesUnreadable = false;
	desktop.contents.clear();
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
	mediaState.mediaItems = [OLD_ITEM()];
	timeline.tracks = [mediaTrack([OLD, "media_other", OLD])];
	storedTimelines.set(
		"project-1/scene-main",
		timeline.tracks as TimelineTrack[]
	);
	stickers.overlayStickers = new Map([["s1", { id: "s1", mediaItemId: OLD }]]);
}
