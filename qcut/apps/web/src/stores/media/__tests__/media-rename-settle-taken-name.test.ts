import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
	"@qcut/platform-core",
	async () => (await import("./media-rename-settle-kit")).modules.platformCore
);
vi.mock(
	"@/lib/storage/storage-service",
	async () => (await import("./media-rename-settle-kit")).modules.storageService
);
vi.mock(
	"@/lib/media/alpha-playback-proxy",
	async () =>
		(await import("./media-rename-settle-kit")).modules.alphaPlaybackProxy
);
vi.mock(
	"../../project-store",
	async () => (await import("./media-rename-settle-kit")).modules.projectStore
);
vi.mock(
	"../../stickers-overlay-store",
	async () =>
		(await import("./media-rename-settle-kit")).modules.stickersOverlayStore
);
vi.mock(
	"../../timeline/timeline-store",
	async () => (await import("./media-rename-settle-kit")).modules.timelineStore
);
vi.mock(
	"../media-store",
	async () => (await import("./media-rename-settle-kit")).modules.mediaStore
);

import { settleUnsettledMediaRenames } from "../media-rename";
import {
	ANOTHER_FILE,
	desktop,
	heldIds,
	mediaIdsOf,
	mediaState,
	mediaTrack,
	NEW,
	NEW_ITEM,
	NEW_PATH,
	NOTES,
	noted,
	OLD,
	OLD_ITEM,
	OLD_PATH,
	project,
	reopenProject,
	resetKit,
	SEEN,
	stickers,
	storage,
	storedTimelines,
	THE_FILE,
	timeline,
} from "./media-rename-settle-kit";

/**
 * A file could not be put back because another file had taken its old name
 * meanwhile, or another file took that name later. Both names have a file
 * then, and a note of the rename is still there.
 */
describe("a noted rename when another file has taken one of the two names", () => {
	beforeEach(() => {
		resetKit();
		desktop.files = new Set([OLD_PATH, NEW_PATH]);
	});

	/** The renamed file is under its new name, another file under the old one. */
	function anotherFileHasTheOldName(): void {
		desktop.looks.set(NEW_PATH, THE_FILE);
		desktop.looks.set(OLD_PATH, ANOTHER_FILE);
	}

	/**
	 * With a file under each name the old one won, and the clips went to a
	 * file that was never theirs.
	 */
	it("follows the renamed file, not the other file, by what the app noted of it", async () => {
		anotherFileHasTheOldName();
		noted({ file: SEEN });

		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(mediaState.mediaItems[0]).toMatchObject({
			id: NEW,
			localPath: NEW_PATH,
		});
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("stays on the old name when the renamed file is the one that has it", async () => {
		desktop.looks.set(OLD_PATH, THE_FILE);
		desktop.looks.set(NEW_PATH, ANOTHER_FILE);
		noted({ file: SEEN });
		timeline.tracks = [mediaTrack([NEW, OLD])];

		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(heldIds()).toEqual([OLD]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, OLD]);
	});

	it("goes by where the app left the file when the two cannot be told apart", async () => {
		noted({ fileIs: "new", notedAt: Date.now() });
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(heldIds()).toEqual([NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		expect(desktop.stored.has(NOTES)).toBe(false);

		noted({ fileIs: "old", notedAt: Date.now() });
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(heldIds()).toEqual([OLD]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
	});

	/**
	 * The app noted the rename before it moved the file. The file could not
	 * be put back, since its old name was taken, and the app could not write
	 * that down either; the editor could not be asked. The first note is all
	 * there is, and the two files look alike (or the app saw nothing of the
	 * file). Put back, the file would have left its new name free: it is
	 * under the new name.
	 */
	it("takes the new name when the app never said where it left the file and the two look alike", async () => {
		desktop.looks.set(NEW_PATH, THE_FILE);
		desktop.looks.set(OLD_PATH, THE_FILE);
		noted({ file: SEEN });

		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(mediaState.mediaItems[0]).toMatchObject({
			id: NEW,
			localPath: NEW_PATH,
		});
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(NEW);
		expect(desktop.stored.has(NOTES)).toBe(false);

		// The same with nothing noted of the file.
		resetKit();
		desktop.files = new Set([OLD_PATH, NEW_PATH]);
		noted();
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(heldIds()).toEqual([NEW]);
	});

	/**
	 * The editor never followed the file: it was reloaded, or its window
	 * was gone. Opened again, the project finds the renamed file in its
	 * folder and brings it in as a new item, while the item the clips are
	 * on has the name another file took. The clips are the renamed file's.
	 */
	it("takes the clips to the renamed file when the project had not followed it", async () => {
		anotherFileHasTheOldName();
		// The new one was found in the folder when the project was opened.
		reopenProject({ items: [OLD_ITEM(), NEW_ITEM()] });
		noted({ file: SEEN, fileIs: "new" });

		await settleUnsettledMediaRenames({ projectId: "project-1" });

		expect(heldIds()).toEqual([NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(NEW);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	/**
	 * A rename that could not take everything back leaves one scene on the
	 * new id and another on the old one, and both mean the renamed file. The
	 * file then could not be put back, and the app said so. With an item
	 * under each id and both in use, this looked like two media: nothing was
	 * changed, the note was dropped, and the clips left on the old id played
	 * the other file from then on.
	 */
	it("brings every scene to the renamed file when the app left it under its new name, whatever is in use", async () => {
		anotherFileHasTheOldName();
		reopenProject({ items: [OLD_ITEM(), NEW_ITEM()] });
		// The open scene was taken back, the other one was not.
		timeline.tracks = [mediaTrack([OLD, "media_other"])];
		storedTimelines.set("project-1/scene-b", [mediaTrack([NEW, OLD])]);
		noted({ file: SEEN, fileIs: "new", notedAt: Date.now() });

		await settleUnsettledMediaRenames({ projectId: "project-1" });

		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other"]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			NEW,
			"media_other",
		]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-b"))).toEqual([
			NEW,
			NEW,
		]);
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(NEW);
		expect(heldIds()).toEqual([NEW]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	/**
	 * The app ended before it had said where it left the file. The editor
	 * may have followed the file meanwhile, and the other file be a media
	 * item of its own, with clips of its own; or the clips on the old id may
	 * still be the renamed file's. That cannot be told, so nothing is
	 * changed, and the note is kept: for a day.
	 */
	describe("and the app never said where it left the file", () => {
		/** Past the time the app may still be at work, and well within a day. */
		const aWhileAgo = () => Date.now() - 10 * 60 * 1000;

		beforeEach(() => {
			anotherFileHasTheOldName();
			reopenProject({ items: [OLD_ITEM(), NEW_ITEM()] });
		});

		it("changes nothing and keeps the note when each id has an item and clips", async () => {
			timeline.tracks = [mediaTrack([OLD, NEW])];
			noted({ file: SEEN, notedAt: aWhileAgo() });

			await settleUnsettledMediaRenames({ projectId: "project-1" });

			expect(heldIds()).toEqual([OLD, NEW]);
			expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, NEW]);
			expect(storage.saveTimeline).not.toHaveBeenCalled();
			expect(storage.deleteMediaItem).not.toHaveBeenCalled();
			expect(desktop.stored.has(NOTES)).toBe(true);
		});

		it("counts a clip in a scene that is not open as use", async () => {
			stickers.overlayStickers = new Map();
			timeline.tracks = [mediaTrack([OLD])];
			storedTimelines.set("project-1/scene-b", [mediaTrack([NEW])]);
			noted({ file: SEEN, notedAt: aWhileAgo() });

			await settleUnsettledMediaRenames({ projectId: "project-1" });

			expect(heldIds()).toEqual([OLD, NEW]);
			expect(mediaIdsOf(timeline.tracks)).toEqual([OLD]);
			expect(mediaIdsOf(storedTimelines.get("project-1/scene-b"))).toEqual([
				NEW,
			]);
			expect(desktop.stored.has(NOTES)).toBe(true);
		});

		it("drops such a note after a day, still changing nothing", async () => {
			timeline.tracks = [mediaTrack([OLD, NEW])];
			noted({ file: SEEN, notedAt: Date.now() - 25 * 60 * 60 * 1000 });

			await settleUnsettledMediaRenames({ projectId: "project-1" });

			expect(heldIds()).toEqual([OLD, NEW]);
			expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, NEW]);
			expect(desktop.stored.has(NOTES)).toBe(false);
		});

		it("takes the clips to the renamed file when only the old id is in use", async () => {
			noted({ file: SEEN });

			await settleUnsettledMediaRenames({ projectId: "project-1" });

			expect(heldIds()).toEqual([NEW]);
			expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
			expect(desktop.stored.has(NOTES)).toBe(false);
		});

		it("keeps the note when the project is left while its scenes are looked at", async () => {
			stickers.overlayStickers = new Map();
			timeline.tracks = [];
			noted({ file: SEEN, notedAt: aWhileAgo() });
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
	});
});
