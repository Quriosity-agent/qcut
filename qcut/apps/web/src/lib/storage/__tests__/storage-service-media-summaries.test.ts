import { afterEach, describe, expect, it, vi } from "vitest";
import { storageService } from "../storage-service";
import type { MediaFileData } from "../types";
import { createMapStorageAdapter } from "./support/map-storage-adapter";

/**
 * N23 (2026-10-30 trailer report): reading a project the editor does not
 * have open names its media from their stored records alone, without
 * loading any file.
 */

afterEach(() => {
	vi.restoreAllMocks();
});

describe("stored media summaries", () => {
	it("lists each stored record's id, name and type, skipping missing ones", async () => {
		const metadata = createMapStorageAdapter<MediaFileData>();
		await metadata.set("m1", {
			id: "m1",
			name: "05_拳域_01.mp4",
			type: "video",
			size: 1024,
			lastModified: 1,
		} as MediaFileData);
		await metadata.set("m2", {
			id: "m2",
			name: "score.mp3",
			type: "audio",
			size: 2048,
			lastModified: 2,
		} as MediaFileData);
		// Listed but gone by the time it is read.
		const list = metadata.list;
		metadata.list = async () => [...(await list()), "m3"];
		const internals = storageService as unknown as {
			getProjectMediaAdapters: (projectId: string) => unknown;
		};
		const adapters = vi
			.spyOn(internals, "getProjectMediaAdapters")
			.mockReturnValue({ mediaMetadataAdapter: metadata });

		expect(await storageService.loadAllMediaSummaries("v19")).toEqual([
			{ id: "m1", name: "05_拳域_01.mp4", type: "video" },
			{ id: "m2", name: "score.mp3", type: "audio" },
		]);
		expect(adapters).toHaveBeenCalledWith("v19");
	});
});
