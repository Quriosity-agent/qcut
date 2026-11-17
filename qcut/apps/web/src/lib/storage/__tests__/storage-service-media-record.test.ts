import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/stores/media/media-store-types";
import { storageService } from "../storage-service";
import type { MediaFileData } from "../types";
import { createMapStorageAdapter } from "./support/map-storage-adapter";

/**
 * A fact about a media item that leaves its file as it is (the size and time
 * of the file it was copied from) is saved with the item's record alone.
 * Saving the item whole would write its bytes again: once per item, for
 * every item of a project, the first time the project's files are checked.
 */

afterEach(() => {
	vi.restoreAllMocks();
});

describe("saving a media item's record", () => {
	it("stores the record and leaves the stored bytes alone", async () => {
		const metadata = createMapStorageAdapter<MediaFileData>();
		const files = { set: vi.fn(), setFromChunks: vi.fn() };
		const internals = storageService as unknown as {
			getProjectMediaAdapters: (projectId: string) => unknown;
		};
		const adapters = vi
			.spyOn(internals, "getProjectMediaAdapters")
			.mockReturnValue({
				mediaMetadataAdapter: metadata,
				mediaFilesAdapter: files,
			});
		const item = {
			id: "media_shake",
			name: "shake.mp4",
			type: "video",
			file: new File(["a film's worth of bytes"], "shake.mp4", {
				type: "video/mp4",
				lastModified: 1234,
			}),
			url: "blob:shake",
			thumbnailUrl: "data:image/jpeg;base64,thumb",
			localPath: "/projects/p1/media/shake.mp4",
			duration: 4,
			folderIds: ["videos"],
			metadata: {
				source: "upload",
				sourceFile: { size: 23, modifiedAt: 5000 },
			},
		} as MediaItem;

		await storageService.saveMediaItemRecord("p1", item);

		expect(adapters).toHaveBeenCalledWith("p1");
		expect(files.set).not.toHaveBeenCalled();
		expect(files.setFromChunks).not.toHaveBeenCalled();
		expect(await metadata.get("media_shake")).toEqual({
			id: "media_shake",
			name: "shake.mp4",
			type: "video",
			size: 23,
			lastModified: 1234,
			width: undefined,
			height: undefined,
			duration: 4,
			// A blob URL does not outlive the session and is not stored.
			url: undefined,
			thumbnailUrl: "data:image/jpeg;base64,thumb",
			metadata: {
				source: "upload",
				sourceFile: { size: 23, modifiedAt: 5000 },
			},
			localPath: "/projects/p1/media/shake.mp4",
			folderIds: ["videos"],
		});
	});
});
