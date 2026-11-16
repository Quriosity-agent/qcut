/**
 * What the tests of settling a media rename share: a project with one media
 * item on its timeline, the stores and the storage it lives in, and the
 * desktop app's side (its key-value store with the notes of renames, and
 * its view of the project folder).
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
/** The desktop app's key-value store and its view of the project folder. */
export const desktop = {
	stored: new Map<string, unknown>(),
	/** The paths that have a file; "unreadable" when the folder cannot be asked. */
	files: new Set<string>() as Set<string> | "unreadable",
	/** What the file at a path looks like, where a test tells files apart. */
	looks: new Map<string, { size: number; modified: Date }>(),
};
export const mediaState = { mediaItems: [] as unknown[] };

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
/** The key of the note for the two ids above (media-rename-notes.test.ts). */
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

/**
 * The desktop app's note of the rename of old.mp4 to new.mp4, as it writes
 * it before it moves the file: long ago, unless `extra` says otherwise.
 */
export function appNote(extra: Partial<UnsettledRename> = {}): UnsettledRename {
	return {
		oldId: OLD,
		oldName: "old.mp4",
		oldPath: OLD_PATH,
		newId: NEW,
		newName: "new.mp4",
		newPath: NEW_PATH,
		notedAt: 0,
		...extra,
	};
}

/** The desktop app notes the rename. */
export function noted(extra: Partial<UnsettledRename> = {}): void {
	desktop.stored.set(NOTES, appNote(extra));
}

/** How far the clock has been put on since the test began. */
const clock = { ahead: 0 };
const realNow = Date.now.bind(Date);
/** Time goes by: a note written just now is no longer one being worked on. */
export function sometimeLater(): void {
	clock.ahead += 10 * 60 * 1000;
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

export function item({
	id,
	name,
	path,
}: {
	id: string;
	name: string;
	path: string;
}) {
	return {
		id,
		name,
		type: "video",
		file: new File(["picture"], name, { type: "video/mp4" }),
		url: `blob:${id}`,
		localPath: path,
	};
}

export const OLD_ITEM = () =>
	item({ id: OLD, name: "old.mp4", path: OLD_PATH });
export const NEW_ITEM = () =>
	item({ id: NEW, name: "new.mp4", path: NEW_PATH });

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
	mediaState.mediaItems = [OLD_ITEM()];
	timeline.tracks = [mediaTrack([OLD, "media_other", OLD])];
	storedTimelines.set(
		"project-1/scene-main",
		timeline.tracks as TimelineTrack[]
	);
	stickers.overlayStickers = new Map([["s1", { id: "s1", mediaItemId: OLD }]]);
}
