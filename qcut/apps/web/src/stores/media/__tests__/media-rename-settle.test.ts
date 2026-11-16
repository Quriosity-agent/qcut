import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineTrack } from "@/types/timeline";

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

import {
	renameProjectMedia,
	settleUnsettledMediaRenames,
} from "../media-rename";
import {
	appNote,
	BACK_ON_OLD,
	desktop,
	FOLLOW_THE_FILE,
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
	openSceneSaves,
	project,
	RENAME,
	reopenProject,
	resetKit,
	SEEN,
	sometimeLater,
	stickers,
	storage,
	storedTimelines,
	storeTimeline,
	timeline,
} from "./media-rename-settle-kit";

/**
 * The desktop app notes every rename before it moves the file, and drops
 * the note when the rename has ended with the editor where the file is. A
 * note that is left is what settles the two, when the project is next open.
 * The editor writes no notes of its own.
 */
describe("a media rename that ended with the editor and the folder apart", () => {
	beforeEach(resetKit);

	/**
	 * The open scene was saved with the new id, a later step failed, and the
	 * save that would put the old id back failed too. The file is put back
	 * all the same, so the stored project named an id the file did not have,
	 * and nothing put that right once the project was closed.
	 */
	it("puts the stored project right when it is next opened, though the take-back could not be saved", async () => {
		noted({ file: SEEN, notedAt: Date.now() });
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
		// The note is the desktop app's: the editor has not touched it.
		expect(desktop.stored.get(NOTES)).toEqual(
			appNote({ file: SEEN, notedAt: expect.any(Number) as never })
		);

		// The app puts the file back and says so. The project is closed and
		// opened again; saving works by then.
		noted({ file: SEEN, fileIs: "old", notedAt: Date.now() });
		openSceneSaves.otherwise = true;
		storage.saveTimeline.mockImplementation(async (request: unknown) => {
			storeTimeline(request);
		});
		reopenProject({ items: [OLD_ITEM()] });
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
	 * app too late: the file is to be put back. The desktop app then asks
	 * the editor to end on the old id.
	 */
	it("goes back to the old id when asked to settle after it had finished the rename", async () => {
		await renameProjectMedia(RENAME);
		expect(heldIds()).toEqual([NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		noted({ file: SEEN, notedAt: Date.now() });

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
		// The file is still under its new name, and may not get back: the
		// app has not said where it left it, and the note stays.
		expect(desktop.stored.has(NOTES)).toBe(true);
	});

	/**
	 * The app has said where it left the file, and the editor ends there,
	 * perhaps long after the app stopped waiting for its answer. The two
	 * agree then, and a note left behind would settle them again later, by
	 * a folder that may have changed since.
	 */
	it("drops the note when it has ended on the name the app left the file under", async () => {
		// Left under its new name: it could not be put back.
		desktop.files = new Set([NEW_PATH]);
		noted({ file: SEEN, fileIs: "new", notedAt: Date.now() });
		await renameProjectMedia(FOLLOW_THE_FILE);
		expect(heldIds()).toEqual([NEW]);
		expect(desktop.stored.has(NOTES)).toBe(false);

		// Left under its old name again.
		desktop.files = new Set([OLD_PATH]);
		noted({ file: SEEN, fileIs: "old", notedAt: Date.now() });
		await renameProjectMedia(BACK_ON_OLD);
		expect(heldIds()).toEqual([OLD]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("keeps a note that says the file was left under the other name", async () => {
		await renameProjectMedia(RENAME);
		// Asked to go back while the file could not be put back after all.
		noted({ file: SEEN, fileIs: "new", notedAt: Date.now() });
		await renameProjectMedia(BACK_ON_OLD);
		expect(heldIds()).toEqual([OLD]);
		expect(desktop.stored.get(NOTES)).toMatchObject({ fileIs: "new" });
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

	it("has no deadline when it settles", async () => {
		await renameProjectMedia(RENAME);
		await expect(
			renameProjectMedia({ ...BACK_ON_OLD, deadlineAt: Date.now() - 1 })
		).resolves.toMatchObject({ clipsUpdated: 2 });
		expect(heldIds()).toEqual([OLD]);
	});

	it("leaves the note as it is when it cannot settle, and settles by it later", async () => {
		await renameProjectMedia(RENAME);
		const written = appNote({ file: SEEN, fileIs: "old", notedAt: Date.now() });
		desktop.stored.set(NOTES, written);
		openSceneSaves.otherwise = false;
		await expect(renameProjectMedia(BACK_ON_OLD)).rejects.toThrow(
			"The timeline could not be saved"
		);
		expect(desktop.stored.get(NOTES)).toEqual(written);

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

	it("refuses a request to settle for a project that is not open, and leaves the open one and the note alone", async () => {
		const written = appNote({ file: SEEN, notedAt: Date.now() });
		desktop.stored.set(NOTES, written);
		project.activeProject = {
			id: "project-2",
			currentSceneId: "scene-main",
			scenes: [{ id: "scene-main" }],
		};
		project.loadedProjectId = "project-2";
		// The open project has media and clips of the same ids.
		mediaState.mediaItems = [{ ...NEW_ITEM(), localPath: "/p2/new.mp4" }];
		timeline.tracks = [mediaTrack([NEW])];

		await expect(renameProjectMedia(BACK_ON_OLD)).rejects.toThrow(
			"is not open in the editor"
		);
		expect(heldIds()).toEqual([NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW]);
		expect(storage.saveTimeline).not.toHaveBeenCalled();
		expect(desktop.stored.get(NOTES)).toEqual(written);
	});

	it("follows the file when it kept the new name after all", async () => {
		// The editor took the rename back; the file could not be put back.
		desktop.files = new Set([NEW_PATH]);
		noted();
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
		reopenProject({ items: [OLD_ITEM(), NEW_ITEM()] });
		timeline.tracks = [mediaTrack([NEW, OLD])];
		noted();
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
		noted({ fileIs: "old", notedAt: Date.now() });
		timeline.tracks = [mediaTrack([NEW])];

		// Neither name has a file: nothing to go by.
		desktop.files = new Set();
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		// The folder cannot be asked at all.
		desktop.files = "unreadable";
		await settleUnsettledMediaRenames({ projectId: "project-1" });

		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW]);
		expect(storage.saveTimeline).not.toHaveBeenCalled();
		expect(desktop.stored.has(NOTES)).toBe(true);
	});

	it("drops a note that nothing in the folder has spoken to for a day", async () => {
		desktop.files = new Set();
		noted({ notedAt: Date.now() - 25 * 60 * 60 * 1000 });
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("keeps the note when settling fails, for the next time", async () => {
		noted();
		timeline.tracks = [mediaTrack([NEW])];
		openSceneSaves.otherwise = false;
		await settleUnsettledMediaRenames({ projectId: "project-1" });
		expect(desktop.stored.has(NOTES)).toBe(true);
		// Taken back: the editor is as it was before the attempt.
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW]);
	});

	/**
	 * The desktop app notes a rename before it moves the file. A project
	 * that finishes loading while the app is still at work (the editor was
	 * reloaded) saw the file under its new name, followed it and dropped the
	 * note; the file then went back. And when the app's later notes cannot
	 * be written and the editor cannot be asked, this first note is all
	 * there is: it settles the two once the app must be done.
	 */
	it("leaves a note alone while the desktop app may still be moving the file", async () => {
		await renameProjectMedia(RENAME);
		desktop.files = new Set([NEW_PATH]);
		const notedAt = Date.now();
		noted({ file: SEEN, notedAt });

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
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			OLD,
			"media_other",
			OLD,
		]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	/**
	 * A copy of a large file takes longer than the editor waits. The app
	 * writes the note again every minute while it is at work, so the note
	 * is never old while the file may still move. Taken for a note the app
	 * had left, it was settled by the folder as it was in the middle of the
	 * copy, and dropped; the copy then finished and nothing was left to
	 * settle the rename by when it went wrong.
	 */
	it("leaves a note alone for as long as the app keeps it fresh", async () => {
		// The copy is under way: the file is under its old name still.
		noted({ file: SEEN, notedAt: Date.now() });
		await settleUnsettledMediaRenames({ projectId: "project-1" });

		// A long time later it still is, and the app has just said so again.
		sometimeLater();
		sometimeLater();
		const writtenAgain = Date.now() - 30_000;
		noted({ file: SEEN, notedAt: writtenAgain });
		const { lookAgainAt } = await settleUnsettledMediaRenames({
			projectId: "project-1",
		});
		expect(lookAgainAt).toBe(writtenAgain + 5 * 60 * 1000);
		expect(desktop.stored.has(NOTES)).toBe(true);
		expect(storage.saveTimeline).not.toHaveBeenCalled();

		// The copy finished and the editor followed; its answer was lost,
		// the file went back, and the app could not say so. The note is not
		// written any more, and settles the two once it has gone stale.
		await renameProjectMedia(RENAME);
		sometimeLater();
		expect(
			await settleUnsettledMediaRenames({ projectId: "project-1" })
		).toEqual({});
		expect(heldIds()).toEqual([OLD]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("settles at once a note in which the app says where it left the file", async () => {
		await renameProjectMedia(RENAME);
		noted({ file: SEEN, fileIs: "old", notedAt: Date.now() });
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
		noted({ file: SEEN, fileIs: "old", notedAt: Date.now() });
		// Opened again: the stores hold the rename as it was stored.
		reopenProject({ items: [NEW_ITEM()] });
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
		expect(
			mediaIdsOf(storedTimelines.get("project-1/scene-main") as TimelineTrack[])
		).toEqual([OLD, "media_other", OLD]);
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(OLD);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});
});
