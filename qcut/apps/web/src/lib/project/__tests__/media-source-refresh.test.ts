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
import {
	planMediaSourceRefresh,
	readSourceFileStat,
	refreshChangedMediaSources,
} from "../media-source-refresh";

const FOLDER = "/Users/me/Documents/QCut/Projects/p1/media";

function diskFile(
	overrides: Partial<ProjectFolderFileInfo> = {}
): ProjectFolderFileInfo {
	return {
		name: "shake.mp4",
		path: `${FOLDER}/shake.mp4`,
		relativePath: "media/shake.mp4",
		type: "video",
		size: 400,
		modifiedAt: 5000,
		isDirectory: false,
		...overrides,
	};
}

/** An item the editor copied when the file was `bytes` long. */
function mediaItem({
	bytes = 400,
	...overrides
}: Partial<MediaItem> & { bytes?: number } = {}): MediaItem {
	return {
		id: "media_shake",
		name: "shake.mp4",
		type: "video",
		file: new File([new Uint8Array(bytes)], "shake.mp4", {
			type: "video/mp4",
		}),
		url: "blob:old",
		localPath: `${FOLDER}/shake.mp4`,
		duration: 2,
		width: 1920,
		height: 1080,
		thumbnailUrl: "data:old-thumbnail",
		...overrides,
	} as MediaItem;
}

const recorded = (size: number, modifiedAt: number) => ({
	metadata: { source: "upload", sourceFile: { size, modifiedAt } },
});

describe("which media files changed in the project folder", () => {
	it("leaves an item alone whose file is as it was when it was copied", () => {
		const plan = planMediaSourceRefresh({
			diskFiles: [diskFile({ size: 400, modifiedAt: 5000.4 })],
			// The time comes back in whole milliseconds from one call and with
			// a fraction from another.
			mediaItems: [mediaItem(recorded(400, 5000))],
		});
		expect(plan).toEqual({ changed: [], adopt: [], checked: 1 });
	});

	it("reads a file again whose size or time moved", () => {
		const item = mediaItem(recorded(400, 5000));
		for (const file of [
			diskFile({ size: 512, modifiedAt: 5000 }),
			// Written again with the same length.
			diskFile({ size: 400, modifiedAt: 9000 }),
		]) {
			expect(
				planMediaSourceRefresh({ diskFiles: [file], mediaItems: [item] })
					.changed
			).toEqual([{ item, file }]);
		}
	});

	/**
	 * Items imported before the record existed: the size of the editor's copy
	 * is all that is known about the file it came from.
	 */
	it("compares an item that has no record by the size of the editor's copy", () => {
		const stale = mediaItem({ id: "stale", bytes: 300 });
		const current = mediaItem({
			id: "current",
			name: "other.mp4",
			localPath: `${FOLDER}/other.mp4`,
			bytes: 700,
		});
		const shake = diskFile({ size: 400 });
		const other = diskFile({
			name: "other.mp4",
			path: `${FOLDER}/other.mp4`,
			size: 700,
		});
		expect(
			planMediaSourceRefresh({
				diskFiles: [shake, other],
				mediaItems: [stale, current],
			})
		).toEqual({
			changed: [{ item: stale, file: shake }],
			adopt: [{ item: current, file: other }],
			checked: 2,
		});
	});

	it("matches a path whatever its case and separators", () => {
		const item = mediaItem({
			localPath: "C:\\Users\\Me\\QCut\\Projects\\p1\\media\\Shake.MP4",
			bytes: 300,
		});
		const file = diskFile({
			path: "c:/users/me/qcut/projects/p1/media/shake.mp4",
		});
		expect(
			planMediaSourceRefresh({ diskFiles: [file], mediaItems: [item] }).changed
		).toHaveLength(1);
	});

	/**
	 * Where the file system tells `A.mp4` from `a.mp4`, they are two files:
	 * neither may be compared with, or read into, the other's item.
	 */
	it("keeps two files apart whose paths differ only by case", () => {
		const upper = mediaItem({
			id: "upper",
			localPath: `${FOLDER}/A.mp4`,
			...recorded(100, 1000),
		});
		const lower = mediaItem({
			id: "lower",
			localPath: `${FOLDER}/a.mp4`,
			...recorded(200, 2000),
		});
		const upperFile = diskFile({
			name: "A.mp4",
			path: `${FOLDER}/A.mp4`,
			size: 100,
			modifiedAt: 1000,
		});
		// Only the lower-case file was written over.
		const lowerFile = diskFile({
			name: "a.mp4",
			path: `${FOLDER}/a.mp4`,
			size: 250,
			modifiedAt: 9000,
		});
		for (const diskFiles of [
			[upperFile, lowerFile],
			[lowerFile, upperFile],
		]) {
			expect(
				planMediaSourceRefresh({ diskFiles, mediaItems: [upper, lower] })
			).toEqual({
				changed: [{ item: lower, file: lowerFile }],
				adopt: [],
				checked: 2,
			});
		}
		// A path that names neither as written cannot say which one it means.
		const vague = mediaItem({ id: "vague", localPath: `${FOLDER}/A.MP4` });
		expect(
			planMediaSourceRefresh({
				diskFiles: [upperFile, lowerFile],
				mediaItems: [vague],
			}).checked
		).toBe(0);
	});

	it("passes over items with no file in the folder, no bytes of their own, or not kept", () => {
		const plan = planMediaSourceRefresh({
			diskFiles: [diskFile({ size: 999 })],
			mediaItems: [
				mediaItem({ id: "elsewhere", localPath: "/tmp/elsewhere.mp4" }),
				mediaItem({ id: "no-path", localPath: undefined }),
				mediaItem({ id: "placeholder", bytes: 0 }),
				mediaItem({ id: "ephemeral", ephemeral: true }),
			],
		});
		expect(plan).toEqual({ changed: [], adopt: [], checked: 0 });
	});

	it("does not take a damaged record for a record", () => {
		expect(
			readSourceFileStat({
				item: { metadata: { sourceFile: { size: "400" } } },
			})
		).toBeUndefined();
		expect(readSourceFileStat({ item: {} })).toBeUndefined();
		expect(readSourceFileStat({ item: mediaItem(recorded(1, 2)) })).toEqual({
			size: 1,
			modifiedAt: 2,
		});
	});
});

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
		const result = await refreshChangedMediaSources({
			projectId: "p1",
			diskFiles: [diskFile({ size: 8, modifiedAt: 9000 })],
		});
		expect(result).toEqual({ checked: 1, refreshed: [], failed: [] });
		expect(mediaState.updateMediaItem).not.toHaveBeenCalled();
		expect(blobs.createReplacementObjectURL).not.toHaveBeenCalled();
		expect(mediaState.mediaItems).toEqual([otherProjectsItem]);
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
		await refreshChangedMediaSources({
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
		});
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
