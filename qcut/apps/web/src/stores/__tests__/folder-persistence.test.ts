import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useMediaStore } from "../media-store";
import { useFolderStore } from "../folder-store";
import { DEFAULT_FOLDER_IDS, type MediaFolder } from "../media-store-types";

// Mock the debug utilities
vi.mock("@/lib/debug-config", () => ({
  debugLog: vi.fn(),
  debugError: vi.fn(),
}));

// Create mock functions at module level so they can be referenced
const mockSaveMediaItem = vi.fn().mockResolvedValue(undefined);
const mockSaveFolders = vi.fn().mockResolvedValue(undefined);
const mockLoadFolders = vi.fn().mockResolvedValue([] as MediaFolder[]);

vi.mock("@/lib/storage/storage-service", () => ({
  storageService: {
    get saveMediaItem() { return mockSaveMediaItem; },
    get loadAllMediaItems() { return vi.fn().mockResolvedValue([]); },
    get deleteMediaItem() { return vi.fn().mockResolvedValue(undefined); },
    get saveFolders() { return mockSaveFolders; },
    get loadFolders() { return mockLoadFolders; },
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
const createMockMediaItem = (id: string, type: "video" | "audio" | "image", folderIds: string[] = []) => ({
  id,
  name: `${type}-${id}.${type === "video" ? "mp4" : type === "audio" ? "mp3" : "jpg"}`,
  type,
  file: new File([""], `${type}-${id}.${type === "video" ? "mp4" : type === "audio" ? "mp3" : "jpg"}`),
  url: `blob:test-${id}`,
  folderIds,
});

describe("Media Folder Persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset stores
    useMediaStore.setState({ mediaItems: [], isLoading: false, hasInitialized: false });
    useFolderStore.getState().clearFolders();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("addToFolder persistence", () => {
    it("should persist folder assignment when adding media to folder", async () => {
      // Set up initial state with a media item
      const mediaItem = createMockMediaItem("media-1", "video");
      useMediaStore.setState({ mediaItems: [mediaItem] });

      // Add media to folder
      useMediaStore.getState().addToFolder("media-1", "folder-1");

      // Wait for async persistence
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify the store was updated
      const updatedItem = useMediaStore.getState().mediaItems.find((m) => m.id === "media-1");
      expect(updatedItem?.folderIds).toContain("folder-1");

      // Verify persistence was called
      expect(mockSaveMediaItem).toHaveBeenCalledWith(
        "test-project-123",
        expect.objectContaining({ id: "media-1", folderIds: ["folder-1"] })
      );
    });

    it("should dedupe folder IDs when adding same folder twice", () => {
      const mediaItem = createMockMediaItem("media-1", "video", ["folder-1"]);
      useMediaStore.setState({ mediaItems: [mediaItem] });

      // Try to add same folder again
      useMediaStore.getState().addToFolder("media-1", "folder-1");

      const updatedItem = useMediaStore.getState().mediaItems.find((m) => m.id === "media-1");
      expect(updatedItem?.folderIds).toEqual(["folder-1"]); // No duplicates
    });
  });

  describe("removeFromFolder persistence", () => {
    it("should persist folder removal", async () => {
      const mediaItem = createMockMediaItem("media-1", "video", ["folder-1", "folder-2"]);
      useMediaStore.setState({ mediaItems: [mediaItem] });

      // Remove from folder
      useMediaStore.getState().removeFromFolder("media-1", "folder-1");

      // Wait for async persistence
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify the store was updated
      const updatedItem = useMediaStore.getState().mediaItems.find((m) => m.id === "media-1");
      expect(updatedItem?.folderIds).toEqual(["folder-2"]);

      // Verify persistence was called
      expect(mockSaveMediaItem).toHaveBeenCalledWith(
        "test-project-123",
        expect.objectContaining({ id: "media-1", folderIds: ["folder-2"] })
      );
    });
  });

  describe("moveToFolder persistence", () => {
    it("should persist folder move", async () => {
      const mediaItem = createMockMediaItem("media-1", "video", ["folder-1"]);
      useMediaStore.setState({ mediaItems: [mediaItem] });

      // Move to different folder
      useMediaStore.getState().moveToFolder("media-1", "folder-2");

      // Wait for async persistence
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify the store was updated
      const updatedItem = useMediaStore.getState().mediaItems.find((m) => m.id === "media-1");
      expect(updatedItem?.folderIds).toEqual(["folder-2"]);

      // Verify persistence was called
      expect(mockSaveMediaItem).toHaveBeenCalledWith(
        "test-project-123",
        expect.objectContaining({ id: "media-1", folderIds: ["folder-2"] })
      );
    });

    it("should clear folders when moving to null", async () => {
      const mediaItem = createMockMediaItem("media-1", "video", ["folder-1", "folder-2"]);
      useMediaStore.setState({ mediaItems: [mediaItem] });

      // Move to no folder (root)
      useMediaStore.getState().moveToFolder("media-1", null);

      // Wait for async persistence
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify the store was updated
      const updatedItem = useMediaStore.getState().mediaItems.find((m) => m.id === "media-1");
      expect(updatedItem?.folderIds).toEqual([]);

      // Verify persistence was called
      expect(mockSaveMediaItem).toHaveBeenCalledWith(
        "test-project-123",
        expect.objectContaining({ id: "media-1", folderIds: [] })
      );
    });
  });

  describe("bulk folder operations persistence", () => {
    it("should persist bulk folder assignments", async () => {
      const mediaItems = [
        createMockMediaItem("media-1", "video"),
        createMockMediaItem("media-2", "audio"),
        createMockMediaItem("media-3", "image"),
      ];
      useMediaStore.setState({ mediaItems });

      // Bulk add to folder
      useMediaStore.getState().bulkAddToFolder(["media-1", "media-2"], "folder-1");

      // Wait for async persistence
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify items were updated
      const updatedItems = useMediaStore.getState().mediaItems;
      expect(updatedItems.find((m) => m.id === "media-1")?.folderIds).toContain("folder-1");
      expect(updatedItems.find((m) => m.id === "media-2")?.folderIds).toContain("folder-1");
      expect(updatedItems.find((m) => m.id === "media-3")?.folderIds || []).not.toContain("folder-1");

      // Verify persistence was called (at least once - may batch or call multiple times)
      expect(mockSaveMediaItem).toHaveBeenCalled();
    });

    it("should persist bulk folder moves", async () => {
      const mediaItems = [
        createMockMediaItem("media-1", "video", ["old-folder"]),
        createMockMediaItem("media-2", "audio", ["old-folder"]),
      ];
      useMediaStore.setState({ mediaItems });

      // Bulk move to new folder
      useMediaStore.getState().bulkMoveToFolder(["media-1", "media-2"], "new-folder");

      // Wait for async persistence
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify items were moved (old folder replaced)
      const updatedItems = useMediaStore.getState().mediaItems;
      expect(updatedItems.find((m) => m.id === "media-1")?.folderIds).toEqual(["new-folder"]);
      expect(updatedItems.find((m) => m.id === "media-2")?.folderIds).toEqual(["new-folder"]);

      // Verify persistence was called (at least once)
      expect(mockSaveMediaItem).toHaveBeenCalled();
    });
  });
});

describe("Default Folder Auto-Creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFolderStore.getState().clearFolders();
    mockLoadFolders.mockResolvedValue([]);
  });

  it("should create default folders when loading empty project", async () => {
    // Load folders for a project (simulates project load)
    await useFolderStore.getState().loadFolders("test-project-123");

    const folders = useFolderStore.getState().folders;

    // Check that default folders were created
    expect(folders.find((f) => f.id === DEFAULT_FOLDER_IDS.VIDEOS)).toBeDefined();
    expect(folders.find((f) => f.id === DEFAULT_FOLDER_IDS.AUDIO)).toBeDefined();
    expect(folders.find((f) => f.id === DEFAULT_FOLDER_IDS.IMAGES)).toBeDefined();
    expect(folders.find((f) => f.id === DEFAULT_FOLDER_IDS.AI_GENERATED)).toBeDefined();
  });

  it("should have correct names and colors for default folders", async () => {
    await useFolderStore.getState().loadFolders("test-project-123");

    const folders = useFolderStore.getState().folders;

    const videosFolder = folders.find((f) => f.id === DEFAULT_FOLDER_IDS.VIDEOS);
    expect(videosFolder?.name).toBe("Videos");
    expect(videosFolder?.color).toBe("#3b82f6");

    const audioFolder = folders.find((f) => f.id === DEFAULT_FOLDER_IDS.AUDIO);
    expect(audioFolder?.name).toBe("Audio");
    expect(audioFolder?.color).toBe("#22c55e");

    const imagesFolder = folders.find((f) => f.id === DEFAULT_FOLDER_IDS.IMAGES);
    expect(imagesFolder?.name).toBe("Images");
    expect(imagesFolder?.color).toBe("#f59e0b");

    const aiFolder = folders.find((f) => f.id === DEFAULT_FOLDER_IDS.AI_GENERATED);
    expect(aiFolder?.name).toBe("AI Generated");
    expect(aiFolder?.color).toBe("#a855f7");
  });

  it("should not duplicate default folders if they already exist", async () => {
    // Simulate existing folders from storage
    mockLoadFolders.mockResolvedValue([
      { id: DEFAULT_FOLDER_IDS.VIDEOS, name: "Videos", parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
    ]);

    await useFolderStore.getState().loadFolders("test-project-123");

    const folders = useFolderStore.getState().folders;
    const videoFolders = folders.filter((f) => f.id === DEFAULT_FOLDER_IDS.VIDEOS);

    expect(videoFolders).toHaveLength(1); // No duplicates
    expect(folders.length).toBe(4); // 1 existing + 3 new
  });

  it("should set default folders as expanded and at root level", async () => {
    await useFolderStore.getState().loadFolders("test-project-123");

    const folders = useFolderStore.getState().folders;

    for (const folder of folders) {
      expect(folder.isExpanded).toBe(true);
      expect(folder.parentId).toBeNull();
    }
  });

  it("should persist default folders after creation", async () => {
    await useFolderStore.getState().loadFolders("test-project-123");

    // Wait for async persistence
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify persistence was called
    expect(mockSaveFolders).toHaveBeenCalledWith(
      "test-project-123",
      expect.arrayContaining([
        expect.objectContaining({ id: DEFAULT_FOLDER_IDS.VIDEOS }),
        expect.objectContaining({ id: DEFAULT_FOLDER_IDS.AUDIO }),
        expect.objectContaining({ id: DEFAULT_FOLDER_IDS.IMAGES }),
        expect.objectContaining({ id: DEFAULT_FOLDER_IDS.AI_GENERATED }),
      ])
    );
  });
});
