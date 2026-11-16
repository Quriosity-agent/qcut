import { beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({
	/** The notes of renames the desktop app holds, by project. */
	notes: new Map<string, unknown[]>(),
	notesFail: false,
	readFile: vi.fn(),
	getFileInfo: vi.fn(),
}));
const storage = vi.hoisted(() => ({
	saveMediaItemRecord: vi.fn(async (..._args: unknown[]) => undefined),
	saveMediaItem: vi.fn(async (..._args: unknown[]) => undefined),
}));
const mediaState = vi.hoisted(() => ({
	mediaItems: [] as unknown[],
	updateMediaItem: vi.fn(),
}));

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({
		files: { readFile: desktop.readFile, getFileInfo: desktop.getFileInfo },
		claude: {
			media: {
				unsettledRenames: async (projectId: string) => {
					if (desktop.notesFail) throw new Error("the app does not answer");
					return desktop.notes.get(projectId) ?? [];
				},
			},
		},
	}),
}));
vi.mock("@/lib/storage/storage-service", () => ({ storageService: storage }));
vi.mock("@/lib/media/alpha-playback-proxy", () => ({
	forgetMediaAlphaInspection: vi.fn(),
}));
vi.mock("@/lib/media/blob-manager", () => ({
	createReplacementObjectURL: vi.fn(() => "blob:new"),
	releaseObjectURL: vi.fn(),
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: { getState: () => ({ activeProject: { id: "p1" } }) },
}));
vi.mock("@/stores/media/media-store-helpers", () => ({
	getImageDimensions: vi.fn(async () => ({ width: 640, height: 360 })),
}));
vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: {
		getState: () => mediaState,
		setState: (
			update: (state: typeof mediaState) => Partial<typeof mediaState>
		) => Object.assign(mediaState, update(mediaState)),
	},
}));

import { resetMediaPersistenceQueue } from "@/stores/media/media-persistence-queue";
import { refreshChangedMediaSources } from "../media-source-refresh";
import { diskFile, FOLDER, mediaItem, recorded } from "./media-source-fixtures";

/**
 * A media file was renamed, the rename did not end with the editor where
 * the file is, and another file has taken the old name. The desktop app's
 * note of the rename settles that when the project is next open, by the
 * file the item was copied from. The check of changed files runs before
 * that: it read the other file into the item, and the item then looked like
 * the other file's own.
 */
describe("the check of changed files while a rename is not settled", () => {
	const note = {
		oldId: "media_shake",
		oldName: "shake.mp4",
		oldPath: `${FOLDER}/shake.mp4`,
		newId: "media_shake_v1",
		newName: "shake_v1.mp4",
		newPath: `${FOLDER}/shake_v1.mp4`,
		fileIs: "new",
		notedAt: 0,
		atWork: false,
	};
	/** Another file under the old name: not what the item was copied from. */
	const anotherFile = diskFile({ size: 8, modifiedAt: 9000 });

	beforeEach(() => {
		vi.clearAllMocks();
		resetMediaPersistenceQueue();
		desktop.notes.clear();
		desktop.notesFail = false;
		mediaState.updateMediaItem.mockResolvedValue(true);
		desktop.readFile.mockResolvedValue(Buffer.from(new Uint8Array(8)));
		desktop.getFileInfo.mockResolvedValue({
			size: 8,
			lastModified: new Date(9000),
		});
		mediaState.mediaItems = [mediaItem(recorded(400, 5000))];
	});

	it("leaves the item as it is, and says that it was not read", async () => {
		desktop.notes.set("p1", [note]);
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [anotherFile],
		});

		expect(result.refreshed).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "media_shake",
				name: "shake.mp4",
				error: expect.stringContaining("the rename is not settled yet"),
			},
		]);
		expect(desktop.readFile).not.toHaveBeenCalled();
		expect(mediaState.updateMediaItem).not.toHaveBeenCalled();
		// What it was copied from is still on record.
		expect(mediaState.mediaItems[0]).toMatchObject({
			metadata: { sourceFile: { size: 400, modifiedAt: 5000 } },
		});
	});

	it("leaves it alone as well while the desktop app is at work on the rename", async () => {
		desktop.notes.set("p1", [{ ...note, fileIs: undefined, atWork: true }]);
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [anotherFile],
		});
		expect(result.refreshed).toEqual([]);
		expect(desktop.readFile).not.toHaveBeenCalled();
	});

	it("reads the file once the note is gone, and for another project's note", async () => {
		// A note of another project names the same ids: they follow names.
		desktop.notes.set("p2", [note]);
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [anotherFile],
		});
		expect(result.refreshed).toEqual([
			{ id: "media_shake", name: "shake.mp4" },
		]);
		expect(result.failed).toEqual([]);
	});

	/**
	 * The record says by when the editor held the copy. A file that gets the
	 * item's name later than that is not what the item was copied from: a
	 * rename that is not settled tells by it whose an item is.
	 */
	it("records by when it held the copy: once the bytes were read, or when a copy was first found to match", async () => {
		// A changed file: held once it had been read.
		mediaState.mediaItems = [mediaItem({ bytes: 300 })];
		let read = 0;
		desktop.readFile.mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			read = Date.now();
			return Buffer.from(new Uint8Array(8));
		});
		await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 8, modifiedAt: 9000 })],
		});
		const again = mediaState.updateMediaItem.mock.calls[0][2];
		expect(again.metadata.sourceFile.heldSince).toBeGreaterThanOrEqual(read);
		expect(again.metadata.sourceFile.heldSince).toBeLessThanOrEqual(Date.now());

		// A copy from before any record: held, for all that is known, by now.
		mediaState.mediaItems = [mediaItem({ bytes: 400 })];
		const asked = Date.now();
		await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 400, modifiedAt: 5000 })],
		});
		const adopted = storage.saveMediaItemRecord.mock.calls[0][1] as {
			metadata: { sourceFile: { heldSince: number } };
		};
		expect(adopted.metadata.sourceFile.heldSince).toBeGreaterThanOrEqual(asked);
		expect(adopted.metadata.sourceFile.heldSince).toBeLessThanOrEqual(
			Date.now()
		);
	});

	it("goes on as without notes when they cannot be read", async () => {
		desktop.notesFail = true;
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [anotherFile],
		});
		expect(result.refreshed).toEqual([
			{ id: "media_shake", name: "shake.mp4" },
		]);
	});
});
