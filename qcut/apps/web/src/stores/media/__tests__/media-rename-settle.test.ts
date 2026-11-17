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
	 * there is: it settles the two once the app is done.
	 */
	it("leaves a rename alone while the desktop app is at work on it", async () => {
		await renameProjectMedia(RENAME);
		desktop.files = new Set([NEW_PATH]);
		noted({ file: SEEN, notedAt: Date.now() });
		desktop.atWork.add(NOTES);

		const asked = Date.now();
		const { lookAgainAt, dropped } = await settleUnsettledMediaRenames({
			projectId: "project-1",
		});
		expect(dropped).toBe(0);
		expect(heldIds()).toEqual([NEW]);
		expect(desktop.stored.has(NOTES)).toBe(true);
		expect(storage.saveTimeline).toHaveBeenCalledTimes(1);
		// Worth another look in a while, not at once and not much later.
		expect(lookAgainAt).toBeGreaterThan(asked + 1000);
		expect(lookAgainAt).toBeLessThanOrEqual(Date.now() + 60_000);

		// The file went back, and the app is done without another word.
		desktop.files = new Set([OLD_PATH]);
		desktop.atWork.delete(NOTES);
		expect(
			await settleUnsettledMediaRenames({ projectId: "project-1" })
		).toEqual({ dropped: 1 });
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
	 * A copy of a large file takes longer than anyone waits, and the app may
	 * not be able to write its note again in all that time. The editor went
	 * by the age of the note: one that had not been written for five minutes
	 * was taken for a rename the app had left, settled by the folder as it
	 * was in the middle of the copy, and dropped. The copy then finished,
	 * the editor followed, its answer was lost, the file went back, and the
	 * app could not write that either: nothing was left to settle the rename
	 * by, and the stored project named the new id.
	 */
	it("leaves it alone however old the note is, and settles by that note once the app is done", async () => {
		// The copy is under way: the file is under its old name still, and the
		// note is as old as the rename.
		noted({ file: SEEN, notedAt: Date.now() - 3 * 60 * 60 * 1000 });
		desktop.atWork.add(NOTES);
		const written = desktop.stored.get(NOTES);

		// The project is loaded again in the middle of it.
		const { lookAgainAt } = await settleUnsettledMediaRenames({
			projectId: "project-1",
		});
		expect(lookAgainAt).toBeDefined();
		expect(desktop.stored.get(NOTES)).toEqual(written);
		expect(storage.saveTimeline).not.toHaveBeenCalled();

		// The copy finished and the editor followed; its answer was lost, the
		// request to go back did not reach it, the file went back, and the app
		// could not write that: the note is as it was. The app is done.
		await renameProjectMedia(RENAME);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			NEW,
			"media_other",
			NEW,
		]);
		expect(desktop.stored.get(NOTES)).toEqual(written);
		desktop.atWork.delete(NOTES);

		expect(
			await settleUnsettledMediaRenames({ projectId: "project-1" })
		).toEqual({ dropped: 1 });
		expect(heldIds()).toEqual([OLD]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([OLD, "media_other", OLD]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			OLD,
			"media_other",
			OLD,
		]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("settles a rename of a note written this moment, when the app is not at work on it", async () => {
		// Left by an app that ended in the middle: nothing is at work on it.
		desktop.files = new Set([NEW_PATH]);
		noted({ file: SEEN, notedAt: Date.now() });
		expect(
			await settleUnsettledMediaRenames({ projectId: "project-1" })
		).toEqual({ dropped: 1 });
		expect(heldIds()).toEqual([NEW]);
	});

	/**
	 * The editor settles by what it read of the note and the folder a moment
	 * ago. The app can begin the rename again in that moment, or write where
	 * it has left the file: the note is then no longer the one that was
	 * settled, and dropping it would drop what is still to be settled.
	 */
	it("has the app keep a note it has written again while the editor was settling", async () => {
		await renameProjectMedia(RENAME);
		noted({ file: SEEN, notedAt: 1000 });
		const stays = appNote({ file: SEEN, fileIs: "new", notedAt: 2000 });
		storage.saveTimeline.mockImplementation(async (request: unknown) => {
			storeTimeline(request);
			// Meanwhile the app says that the file stays renamed after all.
			desktop.stored.set(NOTES, stays);
		});

		// Settled by the folder as it was: the file under its old name.
		expect(
			await settleUnsettledMediaRenames({ projectId: "project-1" })
		).toEqual({ dropped: 0 });
		expect(heldIds()).toEqual([OLD]);
		expect(desktop.stored.get(NOTES)).toEqual(stays);

		// The next time, by what the note says now and the folder holds now.
		desktop.files = new Set([NEW_PATH]);
		expect(
			await settleUnsettledMediaRenames({ projectId: "project-1" })
		).toEqual({ dropped: 1 });
		expect(heldIds()).toEqual([NEW]);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("has the app keep the note of a rename it began again while the editor was settling", async () => {
		await renameProjectMedia(RENAME);
		noted({ file: SEEN, notedAt: 1000 });
		storage.saveTimeline.mockImplementation(async (request: unknown) => {
			storeTimeline(request);
			desktop.atWork.add(NOTES);
		});
		expect(
			await settleUnsettledMediaRenames({ projectId: "project-1" })
		).toEqual({ dropped: 0 });
		expect(desktop.stored.has(NOTES)).toBe(true);
	});

	/**
	 * A rename the app begins while the editor is settling an older note of
	 * the same two names asks the editor after that: the request has the
	 * last word, whatever the folder held when the editor looked.
	 */
	it("settles in turn with the app's requests, which come after it", async () => {
		await renameProjectMedia(RENAME);
		// An earlier rename ended with the file back and the editor not.
		noted({ file: SEEN, notedAt: 1000 });
		const settled = settleUnsettledMediaRenames({ projectId: "project-1" });
		// The app renames the file again, and has the editor follow.
		const followed = renameProjectMedia(RENAME);
		await settled;
		await followed;
		expect(heldIds()).toEqual([NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		expect(mediaIdsOf(storedTimelines.get("project-1/scene-main"))).toEqual([
			NEW,
			"media_other",
			NEW,
		]);
	});

	it("settles at once a note in which the app says where it left the file", async () => {
		await renameProjectMedia(RENAME);
		noted({ file: SEEN, fileIs: "old", notedAt: Date.now() });
		expect(
			await settleUnsettledMediaRenames({ projectId: "project-1" })
		).toEqual({ dropped: 1 });
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
