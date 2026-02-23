/**
 * Tests for project folder auto-sync logic.
 *
 * @module lib/__tests__/project-folder-sync.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	findUntrackedFiles,
	determineFolderIds,
} from "../project/project-folder-sync";
import type { ProjectFolderFileInfo } from "@/types/electron";
import type { MediaItem } from "@/stores/media/media-store-types";
import { DEFAULT_FOLDER_IDS } from "@/stores/media/media-store-types";

// Helper to create a mock ProjectFolderFileInfo
function mockDiskFile(
	overrides: Partial<ProjectFolderFileInfo> = {}
): ProjectFolderFileInfo {
	return {
		name: "clip.mp4",
		path: "C:/Users/test/Documents/QCut/Projects/p1/media/imported/clip.mp4",
		relativePath: "media/imported/clip.mp4",
		type: "video",
		size: 1_024_000,
		modifiedAt: Date.now(),
		isDirectory: false,
		...overrides,
	};
}

// Helper to create a mock MediaItem
function mockMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
	return {
		id: "test-id",
		name: "clip.mp4",
		type: "video",
		file: new File(["test"], "clip.mp4", { type: "video/mp4" }),
		localPath:
			"C:/Users/test/Documents/QCut/Projects/p1/media/imported/clip.mp4",
		...overrides,
	} as MediaItem;
}

describe("project-folder-sync", () => {
	describe("determineFolderIds", () => {
		it("assigns video files to VIDEOS folder", () => {
			const file = mockDiskFile({
				type: "video",
				relativePath: "media/imported/clip.mp4",
			});
			expect(determineFolderIds(file)).toEqual([DEFAULT_FOLDER_IDS.VIDEOS]);
		});

		it("assigns audio files to AUDIO folder", () => {
			const file = mockDiskFile({
				name: "song.mp3",
				type: "audio",
				relativePath: "media/imported/song.mp3",
			});
			expect(determineFolderIds(file)).toEqual([DEFAULT_FOLDER_IDS.AUDIO]);
		});

		it("assigns image files to IMAGES folder", () => {
			const file = mockDiskFile({
				name: "photo.png",
				type: "image",
				relativePath: "media/imported/photo.png",
			});
			expect(determineFolderIds(file)).toEqual([DEFAULT_FOLDER_IDS.IMAGES]);
		});

		it("assigns files in media/generated/ to AI_GENERATED folder too", () => {
			const file = mockDiskFile({
				type: "video",
				relativePath: "media/generated/videos/ai-clip.mp4",
			});
			const ids = determineFolderIds(file);
			expect(ids).toContain(DEFAULT_FOLDER_IDS.VIDEOS);
			expect(ids).toContain(DEFAULT_FOLDER_IDS.AI_GENERATED);
		});

		it("handles backslash paths (Windows) for generated detection", () => {
			const file = mockDiskFile({
				name: "ai-image.png",
				type: "image",
				relativePath: "media\\generated\\images\\ai-image.png",
			});
			const ids = determineFolderIds(file);
			expect(ids).toContain(DEFAULT_FOLDER_IDS.IMAGES);
			expect(ids).toContain(DEFAULT_FOLDER_IDS.AI_GENERATED);
		});

		it("returns empty array for unknown type", () => {
			const file = mockDiskFile({
				name: "readme.txt",
				type: "unknown",
				relativePath: "media/readme.txt",
			});
			expect(determineFolderIds(file)).toEqual([]);
		});
	});

	describe("findUntrackedFiles", () => {
		it("returns empty when all files match by localPath", () => {
			const diskFiles = [
				mockDiskFile({
					path: "C:/projects/p1/media/imported/clip.mp4",
				}),
			];
			const mediaItems = [
				mockMediaItem({
					localPath: "C:\\projects\\p1\\media\\imported\\clip.mp4",
				}),
			];
			expect(findUntrackedFiles(diskFiles, mediaItems)).toEqual([]);
		});

		it("returns empty when all files match by importMetadata.originalPath", () => {
			const diskFiles = [
				mockDiskFile({
					path: "C:/projects/p1/media/imported/clip.mp4",
				}),
			];
			const mediaItems = [
				mockMediaItem({
					localPath: "/some/other/path.mp4",
					importMetadata: {
						importMethod: "symlink",
						originalPath: "C:\\projects\\p1\\media\\imported\\clip.mp4",
						importedAt: Date.now(),
						fileSize: 1_024_000,
					},
				}),
			];
			expect(findUntrackedFiles(diskFiles, mediaItems)).toEqual([]);
		});

		it("returns empty when all files match by name+size", () => {
			const diskFiles = [
				mockDiskFile({
					name: "clip.mp4",
					size: 5000,
					path: "C:/projects/p1/media/clip.mp4",
				}),
			];
			const mediaItems = [
				mockMediaItem({
					name: "clip.mp4",
					localPath: "/different/path.mp4",
					file: new File([new ArrayBuffer(5000)], "clip.mp4", {
						type: "video/mp4",
					}),
				}),
			];
			expect(findUntrackedFiles(diskFiles, mediaItems)).toEqual([]);
		});

		it("returns new files that do not match any existing item", () => {
			const newFile = mockDiskFile({
				name: "new-clip.mp4",
				path: "C:/projects/p1/media/imported/new-clip.mp4",
				size: 9999,
			});
			const mediaItems = [
				mockMediaItem({
					name: "old-clip.mp4",
					localPath: "C:/projects/p1/media/imported/old-clip.mp4",
				}),
			];
			const result = findUntrackedFiles([newFile], mediaItems);
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("new-clip.mp4");
		});

		it("skips directories", () => {
			const dir = mockDiskFile({
				name: "subfolder",
				isDirectory: true,
			});
			expect(findUntrackedFiles([dir], [])).toEqual([]);
		});

		it("skips files with unknown type", () => {
			const file = mockDiskFile({
				name: "readme.txt",
				type: "unknown",
			});
			expect(findUntrackedFiles([file], [])).toEqual([]);
		});

		it("handles mixed tracked and untracked files", () => {
			const tracked = mockDiskFile({
				name: "existing.mp4",
				path: "C:/p/media/existing.mp4",
				size: 1000,
			});
			const untracked = mockDiskFile({
				name: "brand-new.mp4",
				path: "C:/p/media/brand-new.mp4",
				size: 2000,
			});
			const mediaItems = [
				mockMediaItem({
					name: "existing.mp4",
					localPath: "C:/p/media/existing.mp4",
				}),
			];
			const result = findUntrackedFiles([tracked, untracked], mediaItems);
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe("brand-new.mp4");
		});
	});

	describe("syncProjectFolder", () => {
		let originalElectronAPI: any;

		beforeEach(() => {
			originalElectronAPI = (window as any).electronAPI;
		});

		afterEach(() => {
			(window as any).electronAPI = originalElectronAPI;
			vi.restoreAllMocks();
		});

		it("returns zero imported when electronAPI.projectFolder is unavailable", async () => {
			(window as any).electronAPI = undefined;

			const { syncProjectFolder } = await import(
				"../project/project-folder-sync"
			);
			const result = await syncProjectFolder("test-project");
			expect(result.imported).toBe(0);
			expect(result.skipped).toBe(0);
			expect(result.totalDiskFiles).toBe(0);
		});

		it("returns zero imported when no untracked files exist", async () => {
			(window as any).electronAPI = {
				projectFolder: {
					ensureStructure: vi.fn().mockResolvedValue({
						created: [],
						existing: ["media"],
					}),
					scan: vi.fn().mockResolvedValue({
						files: [],
						folders: [],
						totalSize: 0,
						scanTime: 5,
					}),
				},
				readFile: vi.fn(),
			};

			// Mock media store with empty items
			vi.doMock("@/stores/media/media-store", () => ({
				useMediaStore: {
					getState: () => ({
						mediaItems: [],
						addMediaItem: vi.fn(),
					}),
				},
			}));

			const { syncProjectFolder } = await import(
				"../project/project-folder-sync"
			);
			const result = await syncProjectFolder("test-project");
			expect(result.imported).toBe(0);
			expect(result.totalDiskFiles).toBe(0);
		});
	});
});
