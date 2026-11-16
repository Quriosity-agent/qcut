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
	ANOTHER_FILES_ITEM,
	desktop,
	heldIds,
	item,
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
 * meanwhile, or another file took a name later. Both names have a file
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

	it("goes by where the app left the file when the two files look alike", async () => {
		desktop.looks.set(NEW_PATH, THE_FILE);
		desktop.looks.set(OLD_PATH, THE_FILE);
		noted({ file: SEEN, fileIs: "new", notedAt: Date.now() });
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(heldIds()).toEqual([NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		expect(desktop.stored.has(NOTES)).toBe(false);

		noted({ file: SEEN, fileIs: "old", notedAt: Date.now() });
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(heldIds()).toEqual([OLD]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
	});

	/**
	 * The app noted the rename before it moved the file, and its later note
	 * could not be written. Two things can have happened since, and they
	 * leave the same behind: the file could not be put back because another
	 * file had its old name; or it was put back, and another file took the
	 * new name. When the two files look alike, nothing tells which. Taking
	 * the new name sent the clips to the other file in the second case, the
	 * old name in the first.
	 */
	it("changes nothing, and keeps the note, when the app never said where it left the file and the two look alike", async () => {
		desktop.looks.set(NEW_PATH, THE_FILE);
		desktop.looks.set(OLD_PATH, THE_FILE);
		// Long ago: the note does not go for that.
		noted({ file: SEEN, notedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 });

		expect(
			await settleUnsettledMediaRenames({ projectId: "project-1" })
		).toEqual({ dropped: 0 });

		expect(heldIds()).toEqual([OLD]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
		expect(storage.saveTimeline).not.toHaveBeenCalled();
		expect(desktop.stored.has(NOTES)).toBe(true);

		// The same with nothing noted of the file.
		noted();
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(heldIds()).toEqual([OLD]);
		expect(desktop.stored.has(NOTES)).toBe(true);
	});

	it("settles such a note once one of the two files is gone", async () => {
		desktop.looks.set(NEW_PATH, THE_FILE);
		desktop.looks.set(OLD_PATH, THE_FILE);
		noted({ file: SEEN });
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(desktop.stored.has(NOTES)).toBe(true);

		desktop.files = new Set([NEW_PATH]);
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(heldIds()).toEqual([NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	/**
	 * Whose the item under the old id is, the renamed file's or the other
	 * file's, is told by the file it was copied from. That both ids are in
	 * use tells nothing: a rename taken back in one scene only leaves both
	 * in use for one file, and two media are in use each for its own.
	 */
	describe("with an item under each id", () => {
		beforeEach(anotherFileHasTheOldName);

		/**
		 * The editor never followed the file: it was reloaded, or its window
		 * was gone. Opened again, the project finds the renamed file in its
		 * folder and brings it in as a new item, while the item the clips are
		 * on has the name another file took. The clips are the renamed file's.
		 */
		it("takes the clips to the renamed file when the item they are on was copied from it", async () => {
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
		 * A rename that could not take everything back leaves one scene on
		 * the new id and another on the old one, and both mean the renamed
		 * file. The file then could not be put back. With both ids in use,
		 * this was taken for two media: nothing was changed, the note was
		 * dropped, and the clips left on the old id played the other file.
		 */
		it("brings every scene to the renamed file after a rename that was taken back in part", async () => {
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
		 * The editor did follow the file, and the note could not be dropped,
		 * by the editor or by the app. The other file was then brought into
		 * the project under the old id and used. Opened again, the project
		 * still has the note, which says that the file is under its new name:
		 * the other file's item was dropped for it, and its clips sent to
		 * the renamed file.
		 */
		it("leaves another file's item and clips alone, though the note outlived the rename", async () => {
			reopenProject({ items: [ANOTHER_FILES_ITEM(), NEW_ITEM()] });
			timeline.tracks = [mediaTrack([OLD, NEW, OLD])];
			noted({ file: SEEN, fileIs: "new" });

			expect(
				await settleUnsettledMediaRenames({ projectId: "project-1" })
			).toEqual({ dropped: 1 });

			expect(heldIds()).toEqual([OLD, NEW]);
			expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, NEW, OLD]);
			expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(OLD);
			expect(storage.saveTimeline).not.toHaveBeenCalled();
			expect(storage.deleteMediaItem).not.toHaveBeenCalled();
			// Nothing is apart: the note has no more to say.
			expect(desktop.stored.has(NOTES)).toBe(false);
		});

		it("goes by the same when the app never said where it left the file", async () => {
			reopenProject({ items: [ANOTHER_FILES_ITEM(), NEW_ITEM()] });
			timeline.tracks = [mediaTrack([OLD, NEW])];
			noted({ file: SEEN });
			await settleUnsettledMediaRenames({ projectId: "project-1" });
			expect(heldIds()).toEqual([OLD, NEW]);
			expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, NEW]);
			expect(desktop.stored.has(NOTES)).toBe(false);

			resetKit();
			desktop.files = new Set([OLD_PATH, NEW_PATH]);
			anotherFileHasTheOldName();
			reopenProject({ items: [OLD_ITEM(), NEW_ITEM()] });
			noted({ file: SEEN });
			await settleUnsettledMediaRenames({ projectId: "project-1" });
			expect(heldIds()).toEqual([NEW]);
			expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		});

		it("tells an item from before the record was kept by the size of its copy", async () => {
			// 7 bytes, as the items of these tests are; nothing recorded.
			const unrecorded = (id: string, name: string, path: string) =>
				item({ id, name, path, copiedFrom: null });
			reopenProject({
				items: [unrecorded(OLD, "old.mp4", OLD_PATH), NEW_ITEM()],
			});
			timeline.tracks = [mediaTrack([OLD, NEW])];

			// The renamed file is not 7 bytes long: the item is another file's.
			noted({ file: SEEN, fileIs: "new" });
			await settleUnsettledMediaRenames({ projectId: "project-1" });
			expect(heldIds()).toEqual([OLD, NEW]);

			// It is: the item is the renamed file's own.
			desktop.looks.set(NEW_PATH, { ...THE_FILE, size: 7 });
			noted({ file: { ...SEEN, size: 7 }, fileIs: "new" });
			await settleUnsettledMediaRenames({ projectId: "project-1" });
			expect(heldIds()).toEqual([NEW]);
			expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, NEW]);
		});

		it("changes nothing, and keeps the note, when nothing was noted of the file", async () => {
			desktop.looks.clear();
			reopenProject({ items: [OLD_ITEM(), NEW_ITEM()] });
			timeline.tracks = [mediaTrack([OLD, NEW])];
			noted({ fileIs: "new" });

			await settleUnsettledMediaRenames({ projectId: "project-1" });

			expect(heldIds()).toEqual([OLD, NEW]);
			expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, NEW]);
			expect(desktop.stored.has(NOTES)).toBe(true);
		});
	});
});
