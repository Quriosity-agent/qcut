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
vi.mock("@/lib/media/blob-manager", () => ({
	createReplacementObjectURL: vi.fn(() => "blob:read-again"),
	releaseObjectURL: vi.fn(),
}));
vi.mock("../media-store-helpers", () => ({
	getImageDimensions: vi.fn(async () => ({ width: 640, height: 360 })),
}));

import { refreshChangedMediaSources } from "@/lib/project/media-source-refresh";
import { settleUnsettledMediaRenames } from "../media-rename";
import {
	ANOTHER_FILE,
	desktop,
	heldIds,
	mediaIdsOf,
	mediaState,
	NEW,
	NEW_PATH,
	NOTES,
	noted,
	OLD,
	OLD_PATH,
	resetKit,
	SEEN,
	stickers,
	THE_FILE,
	timeline,
} from "./media-rename-settle-kit";

/**
 * A rename ended with the file under its new name and the editor on the old
 * id, and another file has taken the old name. The app's note of the rename
 * is what brings the editor's item and clips over, when the project is next
 * open; until then the check of changed files leaves that item alone.
 *
 * The check went by the notes it could read. When they could not be read it
 * went on as if there were none: it read the other file into the item and
 * wrote that file into the item's record. The note, readable again, then
 * found an item copied from the other file after the rename began, took it
 * for that file's own, and was dropped: the clips stayed with the other
 * file for good.
 */
describe("a noted rename when the notes cannot be read for a while", () => {
	const scan = (
		name: string,
		path: string,
		look: { size: number; modified: Date }
	) => ({
		name,
		path,
		relativePath: `media/${name}`,
		type: "video" as const,
		size: look.size,
		modifiedAt: look.modified.getTime(),
		isDirectory: false,
	});
	/** The project's media folder as a scan shows it. */
	const folder = () => [
		scan("old.mp4", OLD_PATH, ANOTHER_FILE),
		scan("new.mp4", NEW_PATH, THE_FILE),
	];
	const updateMediaItem = vi.fn(
		async (_projectId: string, id: string, updates: object) => {
			mediaState.mediaItems = (
				mediaState.mediaItems as Array<{ id: string }>
			).map((held) => (held.id === id ? { ...held, ...updates } : held));
			return true;
		}
	);

	beforeEach(() => {
		resetKit();
		Object.assign(mediaState, { updateMediaItem });
		// The renamed file kept its new name; another file has the old one.
		desktop.files = new Set([OLD_PATH, NEW_PATH]);
		desktop.looks.set(NEW_PATH, THE_FILE);
		desktop.looks.set(OLD_PATH, ANOTHER_FILE);
		desktop.contents.set(OLD_PATH, "x".repeat(ANOTHER_FILE.size));
		desktop.contents.set(NEW_PATH, "y".repeat(THE_FILE.size));
		noted({ file: SEEN, fileIs: "new" });
	});

	it("leaves the renamed file's item as it is while they cannot, and brings it over once they can", async () => {
		const item = mediaState.mediaItems[0];
		desktop.notesUnreadable = true;

		await expect(
			refreshChangedMediaSources({
				projectId: "project-1",
				diskFiles: folder(),
			})
		).rejects.toThrow(
			"The notes of media renames could not be read (Error invoking remote method 'claude:media:unsettled-renames'), so the media files were not checked"
		);
		// Nor is anything settled by notes that cannot be read.
		await expect(
			settleUnsettledMediaRenames({ projectId: "project-1" })
		).rejects.toThrow("claude:media:unsettled-renames");

		// The item still is what it was: its bytes, and its record of the
		// file they were copied from.
		expect(updateMediaItem).not.toHaveBeenCalled();
		expect(mediaState.mediaItems).toEqual([item]);
		expect(mediaState.mediaItems[0]).toBe(item);
		expect(desktop.stored.has(NOTES)).toBe(true);

		// The app answers again.
		desktop.notesUnreadable = false;
		expect(
			await settleUnsettledMediaRenames({ projectId: "project-1" })
		).toEqual({ dropped: 1 });

		// Brought over to the renamed file, with its clips and its sticker.
		expect(mediaState.mediaItems[0]).toMatchObject({
			id: NEW,
			name: "new.mp4",
			localPath: NEW_PATH,
		});
		expect(heldIds()).toEqual([NEW]);
		expect(mediaIdsOf(timeline.tracks)).toEqual([NEW, "media_other", NEW]);
		expect(stickers.overlayStickers.get("s1")?.mediaItemId).toBe(NEW);
		expect(desktop.stored.has(NOTES)).toBe(false);
	});

	it("leaves it alone in the check for as long as the note is there, when the notes can be read", async () => {
		const item = mediaState.mediaItems[0];
		const result = await refreshChangedMediaSources({
			projectId: "project-1",
			diskFiles: folder(),
		});
		expect(result.refreshed).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: OLD,
				name: "old.mp4",
				error: expect.stringContaining("the rename is not settled yet"),
			},
		]);
		expect(mediaState.mediaItems[0]).toBe(item);
	});
});
