import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { ProjectFolderFileInfo } from "@/types/electron";

const files = vi.hoisted(() => ({
	readFile: vi.fn(),
	getFileInfo: vi.fn(),
	scan: vi.fn(),
}));
const storage = vi.hoisted(() => ({
	saveMediaItemRecord: vi.fn(async (..._args: unknown[]) => undefined),
	saveMediaItem: vi.fn(async (..._args: unknown[]) => undefined),
}));
const mediaState = vi.hoisted(() => ({
	mediaItems: [] as unknown[],
	updateMediaItem: vi.fn(),
}));
const forgetAlpha = vi.hoisted(() => vi.fn());
const blobs = vi.hoisted(() => ({
	createReplacementObjectURL: vi.fn(
		(file: File) => `blob:new:${file.name}:${file.size}`
	),
	releaseObjectURL: vi.fn(),
}));
const project = vi.hoisted(() => ({
	activeProject: { id: "p1" } as { id: string } | null,
}));

vi.mock("@qcut/platform-core", () => ({
	platform: () => ({
		files: { readFile: files.readFile, getFileInfo: files.getFileInfo },
		projectFolder: { scan: files.scan },
	}),
}));
vi.mock("@/lib/storage/storage-service", () => ({ storageService: storage }));
vi.mock("@/lib/media/alpha-playback-proxy", () => ({
	forgetMediaAlphaInspection: forgetAlpha,
}));
vi.mock("@/lib/media/blob-manager", () => blobs);
vi.mock("@/stores/project-store", () => ({
	useProjectStore: { getState: () => project },
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

describe("reading changed media files again", () => {
	const NEW_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

	beforeEach(() => {
		vi.clearAllMocks();
		resetMediaPersistenceQueue();
		project.activeProject = { id: "p1" };
		mediaState.updateMediaItem.mockResolvedValue(true);
		files.readFile.mockResolvedValue(Buffer.from(NEW_BYTES));
		// The desktop app answers with dates, not the declared number.
		files.getFileInfo.mockResolvedValue({
			size: 8,
			lastModified: new Date(9000),
		});
	});

	it("gives the item the folder's file, and drops what was learned from the old one", async () => {
		const item = mediaItem({
			bytes: 300,
			metadata: { source: "upload", alpha: { hasAlpha: true } },
		});
		mediaState.mediaItems = [item];
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 8, modifiedAt: 9000.25 })],
		});

		expect(result).toEqual({
			checked: 1,
			refreshed: [{ id: "media_shake", name: "shake.mp4" }],
			failed: [],
		});
		expect(files.readFile).toHaveBeenCalledWith(`${FOLDER}/shake.mp4`);
		const [projectId, id, updates] = mediaState.updateMediaItem.mock.calls[0];
		expect([projectId, id]).toEqual(["p1", "media_shake"]);
		expect(new Uint8Array(await updates.file.arrayBuffer())).toEqual(NEW_BYTES);
		expect(updates.file.name).toBe("shake.mp4");
		expect(updates.file.type).toBe("video/mp4");
		expect(updates).toMatchObject({
			url: "blob:new:shake.mp4:8",
			// Made again from the new file by the store.
			thumbnailUrl: undefined,
			thumbnailStatus: "pending",
			duration: undefined,
			width: undefined,
			height: undefined,
			metadata: {
				source: "upload",
				sourceFile: { size: 8, modifiedAt: 9000.25 },
			},
		});
		expect(updates.metadata).not.toHaveProperty("alpha");
		expect(forgetAlpha).toHaveBeenCalledWith({
			localPath: `${FOLDER}/shake.mp4`,
		});
	});

	/**
	 * The folder is asked whether it sets case aside: the item's path, which
	 * no file is spelled like, answers only where it does.
	 */
	it("takes a file spelled in another case for the item's where the folder ignores case", async () => {
		mediaState.mediaItems = [
			mediaItem({ bytes: 300, localPath: `${FOLDER}/SHAKE.mp4` }),
		];
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 8, modifiedAt: 9000 })],
		});
		expect(files.getFileInfo).toHaveBeenCalledWith(`${FOLDER}/SHAKE.mp4`);
		expect(result.refreshed).toEqual([
			{ id: "media_shake", name: "shake.mp4" },
		]);
		expect(files.readFile).toHaveBeenCalledWith(`${FOLDER}/shake.mp4`);
	});

	it("leaves the item alone where the folder tells the two spellings apart", async () => {
		mediaState.mediaItems = [
			mediaItem({ bytes: 300, localPath: `${FOLDER}/SHAKE.mp4` }),
		];
		// Nothing is at the item's path: the file in the folder is another.
		files.getFileInfo.mockImplementation(async (filePath: unknown) =>
			filePath === `${FOLDER}/SHAKE.mp4`
				? null
				: { size: 8, lastModified: new Date(9000) }
		);
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 8, modifiedAt: 9000 })],
		});
		expect(result).toEqual({ checked: 0, refreshed: [], failed: [] });
		expect(files.readFile).not.toHaveBeenCalled();
		expect(mediaState.updateMediaItem).not.toHaveBeenCalled();
	});

	/**
	 * The first path asked may be of a file that went away after the folder
	 * was scanned. Taken for the folder's answer, it left every other item
	 * spelled in another case unmatched, and its changed file unread.
	 */
	it("asks the next path when the first one's file is gone", async () => {
		mediaState.mediaItems = [
			mediaItem({
				id: "media_gone",
				name: "gone.mp4",
				bytes: 300,
				localPath: `${FOLDER}/GONE.mp4`,
			}),
			mediaItem({ bytes: 300, localPath: `${FOLDER}/SHAKE.mp4` }),
		];
		// Scanned a moment ago; gone.mp4 was deleted since, under any spelling.
		files.getFileInfo.mockImplementation(async (filePath: unknown) =>
			String(filePath).toLowerCase().endsWith("/gone.mp4")
				? null
				: { size: 8, lastModified: new Date(9000) }
		);
		files.readFile.mockImplementation(async (filePath: unknown) =>
			String(filePath).toLowerCase().endsWith("/gone.mp4")
				? null
				: Buffer.from(NEW_BYTES)
		);
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [
				diskFile({
					name: "gone.mp4",
					path: `${FOLDER}/gone.mp4`,
					size: 8,
					modifiedAt: 9000,
				}),
				diskFile({ size: 8, modifiedAt: 9000 }),
			],
		});
		// The surviving file is read; the vanished one is a failure, not a
		// file passed over in silence.
		expect(result.refreshed).toEqual([
			{ id: "media_shake", name: "shake.mp4" },
		]);
		expect(result.failed).toEqual([
			{
				id: "media_gone",
				name: "gone.mp4",
				error: "the file could not be read",
			},
		]);
	});

	it("does not ask the folder when every path is spelled as its file is", async () => {
		mediaState.mediaItems = [mediaItem({ bytes: 400, ...recorded(400, 5000) })];
		await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile()],
		});
		expect(files.getFileInfo).not.toHaveBeenCalled();
	});

	it("records a file that has not changed without copying its bytes again", async () => {
		const item = mediaItem({ bytes: 400, metadata: { source: "upload" } });
		mediaState.mediaItems = [item];
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 400, modifiedAt: 5000 })],
		});

		expect(result).toEqual({ checked: 1, refreshed: [], failed: [] });
		expect(files.readFile).not.toHaveBeenCalled();
		expect(mediaState.updateMediaItem).not.toHaveBeenCalled();
		expect(storage.saveMediaItem).not.toHaveBeenCalled();
		expect(storage.saveMediaItemRecord).toHaveBeenCalledTimes(1);
		const metadata = {
			source: "upload",
			sourceFile: { size: 400, modifiedAt: 5000 },
		};
		expect(storage.saveMediaItemRecord.mock.calls[0][1]).toMatchObject({
			id: "media_shake",
			metadata,
		});
		expect(mediaState.mediaItems[0]).toMatchObject({ metadata });
		// With the record in place the next check has nothing to do.
		vi.clearAllMocks();
		await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 400, modifiedAt: 5000 })],
		});
		expect(storage.saveMediaItemRecord).not.toHaveBeenCalled();
	});

	it("adds the record to what the item holds by then, not to what it held when the folder was scanned", async () => {
		const second = {
			id: "media_other",
			name: "other.mp4",
			localPath: `${FOLDER}/other.mp4`,
		};
		mediaState.mediaItems = [
			mediaItem({ bytes: 400, metadata: { source: "upload" } }),
			mediaItem({ ...second, bytes: 700, metadata: { source: "upload" } }),
		];
		// While the first item's record is being saved, another task records
		// the second video's alpha.
		storage.saveMediaItemRecord.mockImplementationOnce(async () => {
			mediaState.mediaItems = (mediaState.mediaItems as MediaItem[]).map(
				(item) =>
					item.id === second.id
						? {
								...item,
								metadata: { ...item.metadata, alpha: { hasAlpha: true } },
							}
						: item
			);
		});
		await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [
				diskFile({ size: 400, modifiedAt: 5000 }),
				diskFile({
					name: second.name,
					path: second.localPath,
					size: 700,
					modifiedAt: 6000,
				}),
			],
		});
		const metadata = {
			source: "upload",
			alpha: { hasAlpha: true },
			sourceFile: { size: 700, modifiedAt: 6000 },
		};
		expect(mediaState.mediaItems[1]).toMatchObject({ metadata });
		expect(storage.saveMediaItemRecord.mock.calls[1][1]).toMatchObject({
			id: second.id,
			metadata,
		});
	});

	/**
	 * A media id is made from the file's name, so two projects with a
	 * `shake.mp4` each have an item of the same id. A read that finishes
	 * after the other project was opened must not write to its item.
	 */
	it("writes nothing once another project is open, even to an item of the same id", async () => {
		mediaState.mediaItems = [mediaItem({ bytes: 300 })];
		const otherProjectsItem = mediaItem({
			bytes: 300,
			localPath: "/Users/me/Documents/QCut/Projects/p2/media/shake.mp4",
		});
		files.readFile.mockImplementation(async () => {
			// The user opens project p2 while the file is being read.
			project.activeProject = { id: "p2" };
			mediaState.mediaItems = [otherProjectsItem];
			return Buffer.from(NEW_BYTES);
		});
		// The check did not get through: it says so, and is not taken for
		// one that found every file as the editor has it.
		await expect(
			refreshChangedMediaSources({
				projectId: "p1",
				diskFiles: [diskFile({ size: 8, modifiedAt: 9000 })],
			})
		).rejects.toThrow("the check is not complete");
		expect(mediaState.updateMediaItem).not.toHaveBeenCalled();
		expect(blobs.createReplacementObjectURL).not.toHaveBeenCalled();
		expect(mediaState.mediaItems).toEqual([otherProjectsItem]);
		// The next check of the project starts afresh.
		project.activeProject = { id: "p1" };
		mediaState.mediaItems = [mediaItem({ bytes: 8, ...recorded(8, 9000) })];
		files.readFile.mockResolvedValue(Buffer.from(NEW_BYTES));
		await expect(
			refreshChangedMediaSources({
				projectId: "p1",
				diskFiles: [diskFile({ size: 8, modifiedAt: 9000 })],
			})
		).resolves.toEqual({ checked: 1, refreshed: [], failed: [] });
	});

	/**
	 * One item going away is not the project going away. The check used to
	 * stop at it and answer as if every file had been looked at, so an
	 * export that followed could draw the old copy of a file further down.
	 */
	it("goes on with the other files when one item is removed while its file is read", async () => {
		const first = mediaItem({ bytes: 300 });
		const second = mediaItem({
			id: "media_other",
			name: "other.mp4",
			localPath: `${FOLDER}/other.mp4`,
			bytes: 300,
		});
		mediaState.mediaItems = [first, second];
		files.readFile.mockImplementationOnce(async () => {
			// The first item is deleted while its file is being read.
			mediaState.mediaItems = [second];
			return Buffer.from(NEW_BYTES);
		});
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [
				diskFile({ size: 8, modifiedAt: 9000 }),
				diskFile({
					name: "other.mp4",
					path: `${FOLDER}/other.mp4`,
					size: 8,
					modifiedAt: 9000,
				}),
			],
		});
		expect(result.refreshed).toEqual([
			{ id: "media_other", name: "other.mp4" },
		]);
		// Not brought up to date here, and said so.
		expect(result.failed).toEqual([
			{
				id: "media_shake",
				name: "shake.mp4",
				error: expect.stringContaining("removed or replaced"),
			},
		]);
		expect(mediaState.updateMediaItem).toHaveBeenCalledTimes(1);
		expect(mediaState.updateMediaItem.mock.calls[0][1]).toBe("media_other");
	});

	it("does not write over an item that was given another file while its own was read", async () => {
		const item = mediaItem({ bytes: 300 });
		mediaState.mediaItems = [item];
		const relinked = {
			...item,
			file: new File([new Uint8Array(12)], "shake.mp4", { type: "video/mp4" }),
			url: "blob:relinked",
		};
		files.readFile.mockImplementationOnce(async () => {
			// Relinked to the same path: same id, same path, other bytes.
			mediaState.mediaItems = [relinked];
			return Buffer.from(NEW_BYTES);
		});
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 8, modifiedAt: 9000 })],
		});
		expect(mediaState.updateMediaItem).not.toHaveBeenCalled();
		expect(blobs.createReplacementObjectURL).not.toHaveBeenCalled();
		expect(mediaState.mediaItems).toEqual([relinked]);
		expect(result.refreshed).toEqual([]);
		expect(result.failed).toEqual([
			{
				id: "media_shake",
				name: "shake.mp4",
				error: expect.stringContaining("removed or replaced"),
			},
		]);
	});

	it("records the other files when one item is removed meanwhile", async () => {
		const first = mediaItem({ bytes: 400 });
		const second = mediaItem({
			id: "media_other",
			name: "other.mp4",
			localPath: `${FOLDER}/other.mp4`,
			bytes: 700,
		});
		const third = mediaItem({
			id: "media_third",
			name: "third.mp4",
			localPath: `${FOLDER}/third.mp4`,
			bytes: 900,
		});
		mediaState.mediaItems = [first, second, third];
		storage.saveMediaItemRecord.mockImplementationOnce(async () => {
			// The second item is deleted while the first is being recorded.
			mediaState.mediaItems = (mediaState.mediaItems as MediaItem[]).filter(
				(item) => item.id !== "media_other"
			);
		});
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [
				diskFile({ size: 400, modifiedAt: 5000 }),
				diskFile({
					name: "other.mp4",
					path: `${FOLDER}/other.mp4`,
					size: 700,
					modifiedAt: 6000,
				}),
				diskFile({
					name: "third.mp4",
					path: `${FOLDER}/third.mp4`,
					size: 900,
					modifiedAt: 7000,
				}),
			],
		});
		expect(result.failed).toEqual([]);
		expect(
			storage.saveMediaItemRecord.mock.calls.map(
				([, item]) => (item as MediaItem).id
			)
		).toEqual(["media_shake", "media_third"]);
	});

	it("records nothing on an item of another project either", async () => {
		const first = mediaItem({ bytes: 400 });
		const second = mediaItem({
			id: "media_other",
			name: "other.mp4",
			localPath: `${FOLDER}/other.mp4`,
			bytes: 700,
		});
		mediaState.mediaItems = [first, second];
		const otherProjectsItem = mediaItem({
			id: "media_other",
			name: "other.mp4",
			localPath: "/Users/me/Documents/QCut/Projects/p2/media/other.mp4",
			bytes: 700,
		});
		storage.saveMediaItemRecord.mockImplementationOnce(async () => {
			project.activeProject = { id: "p2" };
			mediaState.mediaItems = [otherProjectsItem];
		});
		await expect(
			refreshChangedMediaSources({
				projectId: "p1",
				diskFiles: [
					diskFile({ size: 400, modifiedAt: 5000 }),
					diskFile({
						name: "other.mp4",
						path: `${FOLDER}/other.mp4`,
						size: 700,
						modifiedAt: 6000,
					}),
				],
			})
		).rejects.toThrow("the check is not complete");
		expect(storage.saveMediaItemRecord).toHaveBeenCalledTimes(1);
		expect(mediaState.mediaItems).toEqual([otherProjectsItem]);
		expect(otherProjectsItem.metadata).toBeUndefined();
	});

	it("gives the new file a URL of its own and lets go of the old file's", async () => {
		mediaState.mediaItems = [mediaItem({ bytes: 8, ...recorded(8, 5000) })];
		// Written over with a file of the same length: only its time moved.
		await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 8, modifiedAt: 9000 })],
		});
		expect(blobs.createReplacementObjectURL).toHaveBeenCalledTimes(1);
		expect(mediaState.updateMediaItem.mock.calls[0][2].url).toBe(
			"blob:new:shake.mp4:8"
		);
		expect(blobs.releaseObjectURL).toHaveBeenCalledTimes(1);
		expect(blobs.releaseObjectURL).toHaveBeenCalledWith(
			"blob:old",
			"media-source-refresh:superseded"
		);
	});

	it("lets go of the new URL, and keeps the old one, when the copy cannot be stored", async () => {
		mediaState.mediaItems = [mediaItem({ bytes: 300 })];
		mediaState.updateMediaItem.mockResolvedValue(false);
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 8, modifiedAt: 9000 })],
		});
		expect(result.failed).toEqual([
			{
				id: "media_shake",
				name: "shake.mp4",
				error: "the new copy could not be stored",
			},
		]);
		expect(blobs.releaseObjectURL).toHaveBeenCalledTimes(1);
		expect(blobs.releaseObjectURL).toHaveBeenCalledWith(
			"blob:new:shake.mp4:8",
			"media-source-refresh:failed"
		);
	});

	it("reads a file again that was still being written", async () => {
		mediaState.mediaItems = [mediaItem({ bytes: 300 })];
		files.readFile
			.mockResolvedValueOnce(Buffer.from(NEW_BYTES.subarray(0, 5)))
			.mockResolvedValueOnce(Buffer.from(NEW_BYTES));
		files.getFileInfo.mockResolvedValue({
			size: 8,
			lastModified: new Date(9500),
		});
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			// What the scan saw while the file was half written.
			diskFiles: [diskFile({ size: 5, modifiedAt: 9000 })],
		});

		expect(result.refreshed).toHaveLength(1);
		expect(files.readFile).toHaveBeenCalledTimes(2);
		const updates = mediaState.updateMediaItem.mock.calls[0][2];
		expect(updates.file.size).toBe(8);
		expect(updates.metadata.sourceFile).toEqual({ size: 8, modifiedAt: 9500 });
	});

	it("keeps the old copy and its record when the file cannot be read", async () => {
		const item = mediaItem({ bytes: 300 });
		mediaState.mediaItems = [item];
		files.readFile.mockResolvedValue(null);
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 8 })],
		});
		expect(result).toEqual({
			checked: 1,
			refreshed: [],
			failed: [
				{
					id: "media_shake",
					name: "shake.mp4",
					error: "the file could not be read",
				},
			],
		});
		expect(mediaState.updateMediaItem).not.toHaveBeenCalled();
		expect(mediaState.mediaItems[0]).toBe(item);
	});

	/**
	 * The desktop app answers a file's facts with dates today; its declared
	 * type says a number. Both are read, and anything else is a failure that
	 * leaves the item's record alone, so the next check tries again.
	 */
	it("reads the file's time in either shape, and fails on a file it cannot stat", async () => {
		const changed = () => {
			mediaState.mediaItems = [mediaItem({ bytes: 300 })];
			return refreshChangedMediaSources({
				projectId: "p1",
				diskFiles: [diskFile({ size: 8, modifiedAt: 9000 })],
			});
		};
		files.getFileInfo.mockResolvedValue({ size: 8, modifiedAt: 9000 });
		expect((await changed()).refreshed).toHaveLength(1);

		files.getFileInfo.mockResolvedValue(null);
		expect((await changed()).failed).toEqual([
			{ id: "media_shake", name: "shake.mp4", error: "the file is gone" },
		]);

		files.getFileInfo.mockResolvedValue({ size: 8, lastModified: "never" });
		expect((await changed()).failed[0].error).toBe(
			"the file's modification time could not be read"
		);
	});

	it("gives up on a file that never stops changing, and leaves its record for the next check", async () => {
		const item = mediaItem({ bytes: 300 });
		mediaState.mediaItems = [item];
		let size = 8;
		// Longer every time it is looked at: someone is still writing it.
		files.getFileInfo.mockImplementation(async () => {
			size += 1;
			return { size, lastModified: new Date(9000 + size) };
		});
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 8, modifiedAt: 9000 })],
		});
		expect(result.failed).toEqual([
			{
				id: "media_shake",
				name: "shake.mp4",
				error: "the file kept changing while it was read",
			},
		]);
		expect(files.readFile).toHaveBeenCalledTimes(3);
		expect(mediaState.mediaItems[0]).toBe(item);
	});

	it("measures a still again, since nothing else would", async () => {
		mediaState.mediaItems = [
			mediaItem({
				id: "media_card",
				name: "card.png",
				type: "image",
				localPath: `${FOLDER}/card.png`,
				bytes: 300,
			}),
		];
		await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [
				diskFile({
					name: "card.png",
					path: `${FOLDER}/card.png`,
					type: "image",
					size: 8,
					modifiedAt: 9000,
				}),
			],
		});
		expect(mediaState.updateMediaItem.mock.calls[0][2]).toMatchObject({
			width: 640,
			height: 360,
			thumbnailStatus: undefined,
		});
	});

	it("scans the project's media folder itself when no scan is handed in, one run at a time", async () => {
		mediaState.mediaItems = [mediaItem({ bytes: 300 })];
		files.scan.mockResolvedValue({
			files: [diskFile({ size: 8, modifiedAt: 9000 })],
		});
		const [first, second] = await Promise.all([
			refreshChangedMediaSources({ projectId: "p1" }),
			refreshChangedMediaSources({ projectId: "p1" }),
		]);
		expect(files.scan).toHaveBeenCalledTimes(1);
		expect(files.scan).toHaveBeenCalledWith("p1", "media", {
			recursive: true,
			mediaOnly: true,
		});
		expect(second).toBe(first);
		expect(first.refreshed).toHaveLength(1);
	});
});
