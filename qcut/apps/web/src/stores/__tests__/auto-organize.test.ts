import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useMediaStore } from "../media-store";
import { DEFAULT_FOLDER_IDS } from "../media-store-types";

// Mock the debug utilities
vi.mock("@/lib/debug-config", () => ({
	debugLog: vi.fn(),
	debugError: vi.fn(),
}));

// Create mock functions at module level so they can be referenced
const mockSaveMediaItem = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/storage/storage-service", () => ({
	storageService: {
		get saveMediaItem() {
			return mockSaveMediaItem;
		},
		get loadAllMediaItems() {
			return vi.fn().mockResolvedValue([]);
		},
		get deleteMediaItem() {
			return vi.fn().mockResolvedValue(undefined);
		},
	},
}));

// Mock the project store
vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: () => ({
			activeProject: { id: "test-project-123" },
		}),
	},
}));

// Helper to create a mock MediaItem
const createMockMediaItem = (
	id: string,
	type: "video" | "audio" | "image",
	options: {
		folderIds?: string[];
		metadata?: { source?: string; [key: string]: unknown };
		ephemeral?: boolean;
	} = {}
) => ({
	id,
	name: `${type}-${id}.${type === "video" ? "mp4" : type === "audio" ? "mp3" : "jpg"}`,
	type,
	file: new File(
		[""],
		`${type}-${id}.${type === "video" ? "mp4" : type === "audio" ? "mp3" : "jpg"}`
	),
	url: `blob:test-${id}`,
	folderIds: options.folderIds || [],
	metadata: options.metadata,
	ephemeral: options.ephemeral,
});

describe("Auto-Organize Media", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useMediaStore.setState({
			mediaItems: [],
			isLoading: false,
			hasInitialized: false,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("autoOrganizeByType", () => {
		it("should organize videos to Videos folder", async () => {
			const mediaItems = [
				createMockMediaItem("video-1", "video"),
				createMockMediaItem("video-2", "video"),
			];
			useMediaStore.setState({ mediaItems });

			useMediaStore.getState().autoOrganizeByType();

			// Wait for async operations
			await new Promise((resolve) => setTimeout(resolve, 50));

			const updatedItems = useMediaStore.getState().mediaItems;
			expect(updatedItems.find((m) => m.id === "video-1")?.folderIds).toContain(
				DEFAULT_FOLDER_IDS.VIDEOS
			);
			expect(updatedItems.find((m) => m.id === "video-2")?.folderIds).toContain(
				DEFAULT_FOLDER_IDS.VIDEOS
			);
		});

		it("should organize audio to Audio folder", async () => {
			const mediaItems = [
				createMockMediaItem("audio-1", "audio"),
				createMockMediaItem("audio-2", "audio"),
			];
			useMediaStore.setState({ mediaItems });

			useMediaStore.getState().autoOrganizeByType();

			await new Promise((resolve) => setTimeout(resolve, 50));

			const updatedItems = useMediaStore.getState().mediaItems;
			expect(updatedItems.find((m) => m.id === "audio-1")?.folderIds).toContain(
				DEFAULT_FOLDER_IDS.AUDIO
			);
			expect(updatedItems.find((m) => m.id === "audio-2")?.folderIds).toContain(
				DEFAULT_FOLDER_IDS.AUDIO
			);
		});

		it("should organize images to Images folder", async () => {
			const mediaItems = [
				createMockMediaItem("image-1", "image"),
				createMockMediaItem("image-2", "image"),
			];
			useMediaStore.setState({ mediaItems });

			useMediaStore.getState().autoOrganizeByType();

			await new Promise((resolve) => setTimeout(resolve, 50));

			const updatedItems = useMediaStore.getState().mediaItems;
			expect(updatedItems.find((m) => m.id === "image-1")?.folderIds).toContain(
				DEFAULT_FOLDER_IDS.IMAGES
			);
			expect(updatedItems.find((m) => m.id === "image-2")?.folderIds).toContain(
				DEFAULT_FOLDER_IDS.IMAGES
			);
		});

		it("should organize AI-generated media to AI Generated folder", async () => {
			const mediaItems = [
				createMockMediaItem("ai-image-1", "image", {
					metadata: { source: "text2image" },
				}),
				createMockMediaItem("ai-video-1", "video", {
					metadata: { source: "fal-ai" },
				}),
			];
			useMediaStore.setState({ mediaItems });

			useMediaStore.getState().autoOrganizeByType();

			await new Promise((resolve) => setTimeout(resolve, 50));

			const updatedItems = useMediaStore.getState().mediaItems;
			// AI-generated items should go to AI Generated folder, not by type
			expect(
				updatedItems.find((m) => m.id === "ai-image-1")?.folderIds
			).toContain(DEFAULT_FOLDER_IDS.AI_GENERATED);
			expect(
				updatedItems.find((m) => m.id === "ai-video-1")?.folderIds
			).toContain(DEFAULT_FOLDER_IDS.AI_GENERATED);
		});

		it("should skip already-organized media", async () => {
			const existingFolder = "custom-folder-123";
			const mediaItems = [
				createMockMediaItem("organized-1", "video", {
					folderIds: [existingFolder],
				}),
				createMockMediaItem("unorganized-1", "video"),
			];
			useMediaStore.setState({ mediaItems });

			useMediaStore.getState().autoOrganizeByType();

			await new Promise((resolve) => setTimeout(resolve, 50));

			const updatedItems = useMediaStore.getState().mediaItems;
			// Already organized item should keep its folder
			expect(
				updatedItems.find((m) => m.id === "organized-1")?.folderIds
			).toEqual([existingFolder]);
			// Unorganized item should be organized
			expect(
				updatedItems.find((m) => m.id === "unorganized-1")?.folderIds
			).toContain(DEFAULT_FOLDER_IDS.VIDEOS);
		});

		it("should skip ephemeral media items", async () => {
			const mediaItems = [
				createMockMediaItem("ephemeral-1", "video", { ephemeral: true }),
				createMockMediaItem("regular-1", "video"),
			];
			useMediaStore.setState({ mediaItems });

			useMediaStore.getState().autoOrganizeByType();

			await new Promise((resolve) => setTimeout(resolve, 50));

			const updatedItems = useMediaStore.getState().mediaItems;
			// Ephemeral items should not be organized
			expect(
				updatedItems.find((m) => m.id === "ephemeral-1")?.folderIds || []
			).toHaveLength(0);
			// Regular items should be organized
			expect(
				updatedItems.find((m) => m.id === "regular-1")?.folderIds
			).toContain(DEFAULT_FOLDER_IDS.VIDEOS);
		});

		it("should handle mixed media types correctly", async () => {
			const mediaItems = [
				createMockMediaItem("video-1", "video"),
				createMockMediaItem("audio-1", "audio"),
				createMockMediaItem("image-1", "image"),
				createMockMediaItem("ai-1", "image", {
					metadata: { source: "ai-gen" },
				}),
			];
			useMediaStore.setState({ mediaItems });

			useMediaStore.getState().autoOrganizeByType();

			await new Promise((resolve) => setTimeout(resolve, 50));

			const updatedItems = useMediaStore.getState().mediaItems;
			expect(updatedItems.find((m) => m.id === "video-1")?.folderIds).toContain(
				DEFAULT_FOLDER_IDS.VIDEOS
			);
			expect(updatedItems.find((m) => m.id === "audio-1")?.folderIds).toContain(
				DEFAULT_FOLDER_IDS.AUDIO
			);
			expect(updatedItems.find((m) => m.id === "image-1")?.folderIds).toContain(
				DEFAULT_FOLDER_IDS.IMAGES
			);
			expect(updatedItems.find((m) => m.id === "ai-1")?.folderIds).toContain(
				DEFAULT_FOLDER_IDS.AI_GENERATED
			);
		});

		it("should persist organized items", async () => {
			const mediaItems = [
				createMockMediaItem("video-1", "video"),
				createMockMediaItem("audio-1", "audio"),
			];
			useMediaStore.setState({ mediaItems });

			useMediaStore.getState().autoOrganizeByType();

			// Wait for async persistence
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Verify persistence was called for each changed item
			expect(mockSaveMediaItem).toHaveBeenCalled();
		});

		it("should not organize items that already have folders", async () => {
			const mediaItems = [
				createMockMediaItem("already-organized", "video", {
					folderIds: ["existing-folder"],
				}),
			];
			useMediaStore.setState({ mediaItems });

			useMediaStore.getState().autoOrganizeByType();

			const updatedItems = useMediaStore.getState().mediaItems;
			const item = updatedItems.find((m) => m.id === "already-organized");

			// Should still have only the existing folder, not modified
			expect(item?.folderIds).toEqual(["existing-folder"]);
		});
	});

	describe("getMediaByFolder", () => {
		it("should return all non-ephemeral media for null folderId", () => {
			const mediaItems = [
				createMockMediaItem("regular-1", "video"),
				createMockMediaItem("regular-2", "audio"),
				createMockMediaItem("ephemeral-1", "image", { ephemeral: true }),
			];
			useMediaStore.setState({ mediaItems });

			const result = useMediaStore.getState().getMediaByFolder(null);

			expect(result).toHaveLength(2);
			expect(result.map((m) => m.id)).toContain("regular-1");
			expect(result.map((m) => m.id)).toContain("regular-2");
			expect(result.map((m) => m.id)).not.toContain("ephemeral-1");
		});

		it("should return media in specific folder", () => {
			const folderId = "test-folder";
			const mediaItems = [
				createMockMediaItem("in-folder-1", "video", { folderIds: [folderId] }),
				createMockMediaItem("in-folder-2", "audio", { folderIds: [folderId] }),
				createMockMediaItem("not-in-folder", "image"),
			];
			useMediaStore.setState({ mediaItems });

			const result = useMediaStore.getState().getMediaByFolder(folderId);

			expect(result).toHaveLength(2);
			expect(result.map((m) => m.id)).toContain("in-folder-1");
			expect(result.map((m) => m.id)).toContain("in-folder-2");
		});

		it("should support media in multiple folders", () => {
			const folder1 = "folder-1";
			const folder2 = "folder-2";
			const mediaItems = [
				createMockMediaItem("multi-folder", "video", {
					folderIds: [folder1, folder2],
				}),
				createMockMediaItem("single-folder", "audio", { folderIds: [folder1] }),
			];
			useMediaStore.setState({ mediaItems });

			const result1 = useMediaStore.getState().getMediaByFolder(folder1);
			const result2 = useMediaStore.getState().getMediaByFolder(folder2);

			expect(result1).toHaveLength(2);
			expect(result2).toHaveLength(1);
			expect(result2.map((m) => m.id)).toContain("multi-folder");
		});

		it("should exclude ephemeral items from folder queries", () => {
			const folderId = "test-folder";
			const mediaItems = [
				createMockMediaItem("regular", "video", { folderIds: [folderId] }),
				createMockMediaItem("ephemeral", "audio", {
					folderIds: [folderId],
					ephemeral: true,
				}),
			];
			useMediaStore.setState({ mediaItems });

			const result = useMediaStore.getState().getMediaByFolder(folderId);

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("regular");
		});
	});
});
