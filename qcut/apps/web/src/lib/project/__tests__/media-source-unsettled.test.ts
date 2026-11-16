import { beforeEach, describe, expect, it, vi } from "vitest";

const desktop = vi.hoisted(() => ({
	stored: new Map<string, unknown>(),
	storeFails: false,
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
		storage: {
			list: async () => {
				if (desktop.storeFails) throw new Error("the store cannot be read");
				return [...desktop.stored.keys()];
			},
			load: async (key: string) => desktop.stored.get(key) ?? null,
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
	};
	/** Another file under the old name: not what the item was copied from. */
	const anotherFile = diskFile({ size: 8, modifiedAt: 9000 });

	beforeEach(() => {
		vi.clearAllMocks();
		resetMediaPersistenceQueue();
		desktop.stored.clear();
		desktop.storeFails = false;
		mediaState.updateMediaItem.mockResolvedValue(true);
		desktop.readFile.mockResolvedValue(Buffer.from(new Uint8Array(8)));
		desktop.getFileInfo.mockResolvedValue({
			size: 8,
			lastModified: new Date(9000),
		});
		mediaState.mediaItems = [mediaItem(recorded(400, 5000))];
	});

	it("leaves the item as it is, and says that it was not read", async () => {
		desktop.stored.set("media-rename-unsettled-p1-0123", note);
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

	it("reads the file once the note is gone, and for another project's note", async () => {
		// A note of another project names the same ids: they follow names.
		desktop.stored.set("media-rename-unsettled-p2-0123", note);
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [anotherFile],
		});
		expect(result.refreshed).toEqual([
			{ id: "media_shake", name: "shake.mp4" },
		]);
		expect(result.failed).toEqual([]);
	});

	it("goes on as without notes when they cannot be read", async () => {
		desktop.storeFails = true;
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [anotherFile],
		});
		expect(result.refreshed).toEqual([
			{ id: "media_shake", name: "shake.mp4" },
		]);
	});
});
