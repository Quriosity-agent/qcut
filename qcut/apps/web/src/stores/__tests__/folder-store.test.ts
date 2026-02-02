import { describe, it, expect, beforeEach, vi } from "vitest";
import { useFolderStore } from "../folder-store";
import { FOLDER_MAX_DEPTH, FOLDER_NAME_MAX_LENGTH } from "../media-store-types";

// Mock the debug utilities
vi.mock("@/lib/debug-config", () => ({
  debugLog: vi.fn(),
  debugError: vi.fn(),
}));

// Mock the storage service
vi.mock("@/lib/storage/storage-service", () => ({
  storageService: {
    loadFolders: vi.fn().mockResolvedValue([]),
    saveFolders: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("FolderStore", () => {
  beforeEach(() => {
    // Reset store state before each test
    useFolderStore.getState().clearFolders();
  });

  // ============================================================================
  // Folder Creation Tests
  // ============================================================================

  describe("createFolder", () => {
    it("creates a folder at root level", () => {
      const id = useFolderStore.getState().createFolder("Test Folder");

      expect(id).toBeTruthy();
      expect(useFolderStore.getState().folders).toHaveLength(1);

      const folder = useFolderStore.getState().folders[0];
      expect(folder.name).toBe("Test Folder");
      expect(folder.parentId).toBeNull();
      expect(folder.isExpanded).toBe(true);
      expect(folder.createdAt).toBeGreaterThan(0);
      expect(folder.updatedAt).toBeGreaterThan(0);
    });

    it("creates a nested folder", () => {
      const parentId = useFolderStore.getState().createFolder("Parent");
      const childId = useFolderStore.getState().createFolder("Child", parentId);

      expect(childId).toBeTruthy();
      expect(useFolderStore.getState().folders).toHaveLength(2);

      const child = useFolderStore.getState().getFolderById(childId!);
      expect(child?.parentId).toBe(parentId);
      expect(child?.name).toBe("Child");
    });

    it("trims whitespace from folder name", () => {
      const id = useFolderStore.getState().createFolder("  Trimmed Name  ");

      const folder = useFolderStore.getState().getFolderById(id!);
      expect(folder?.name).toBe("Trimmed Name");
    });

    it("rejects empty folder name", () => {
      const id = useFolderStore.getState().createFolder("");

      expect(id).toBeNull();
      expect(useFolderStore.getState().folders).toHaveLength(0);
    });

    it("rejects whitespace-only folder name", () => {
      const id = useFolderStore.getState().createFolder("   ");

      expect(id).toBeNull();
      expect(useFolderStore.getState().folders).toHaveLength(0);
    });

    it("rejects folder name exceeding max length", () => {
      const longName = "a".repeat(FOLDER_NAME_MAX_LENGTH + 1);
      const id = useFolderStore.getState().createFolder(longName);

      expect(id).toBeNull();
    });

    it("accepts folder name at max length", () => {
      const maxLengthName = "a".repeat(FOLDER_NAME_MAX_LENGTH);
      const id = useFolderStore.getState().createFolder(maxLengthName);

      expect(id).toBeTruthy();
      const folder = useFolderStore.getState().getFolderById(id!);
      expect(folder?.name.length).toBe(FOLDER_NAME_MAX_LENGTH);
    });

    it("enforces max depth of folders", () => {
      // Create folders up to max depth
      let currentParentId: string | null = null;

      for (let i = 0; i < FOLDER_MAX_DEPTH; i++) {
        const id = useFolderStore
          .getState()
          .createFolder(`Level ${i + 1}`, currentParentId);
        expect(id).toBeTruthy();
        currentParentId = id;
      }

      // Try to create one more level - should fail
      const tooDeepId = useFolderStore
        .getState()
        .createFolder("Too Deep", currentParentId);

      expect(tooDeepId).toBeNull();
      expect(useFolderStore.getState().folders).toHaveLength(FOLDER_MAX_DEPTH);
    });

    it("rejects creation with non-existent parent", () => {
      const id = useFolderStore
        .getState()
        .createFolder("Orphan", "non-existent-parent-id");

      expect(id).toBeNull();
    });
  });

  // ============================================================================
  // Folder Rename Tests
  // ============================================================================

  describe("renameFolder", () => {
    it("renames a folder successfully", () => {
      const id = useFolderStore.getState().createFolder("Original");
      const success = useFolderStore.getState().renameFolder(id!, "Renamed");

      expect(success).toBe(true);
      const folder = useFolderStore.getState().getFolderById(id!);
      expect(folder?.name).toBe("Renamed");
    });

    it("updates updatedAt timestamp on rename", async () => {
      const id = useFolderStore.getState().createFolder("Original");
      const originalFolder = useFolderStore.getState().getFolderById(id!);
      const originalUpdatedAt = originalFolder?.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      useFolderStore.getState().renameFolder(id!, "Renamed");

      const updatedFolder = useFolderStore.getState().getFolderById(id!);
      expect(updatedFolder?.updatedAt).toBeGreaterThanOrEqual(
        originalUpdatedAt!
      );
    });

    it("rejects rename with empty name", () => {
      const id = useFolderStore.getState().createFolder("Original");
      const success = useFolderStore.getState().renameFolder(id!, "");

      expect(success).toBe(false);
      const folder = useFolderStore.getState().getFolderById(id!);
      expect(folder?.name).toBe("Original");
    });

    it("rejects rename for non-existent folder", () => {
      const success = useFolderStore
        .getState()
        .renameFolder("non-existent-id", "New Name");

      expect(success).toBe(false);
    });

    it("trims whitespace on rename", () => {
      const id = useFolderStore.getState().createFolder("Original");
      useFolderStore.getState().renameFolder(id!, "  Trimmed  ");

      const folder = useFolderStore.getState().getFolderById(id!);
      expect(folder?.name).toBe("Trimmed");
    });
  });

  // ============================================================================
  // Folder Deletion Tests
  // ============================================================================

  describe("deleteFolder", () => {
    it("deletes a single folder", () => {
      const id = useFolderStore.getState().createFolder("To Delete");
      expect(useFolderStore.getState().folders).toHaveLength(1);

      useFolderStore.getState().deleteFolder(id!);

      expect(useFolderStore.getState().folders).toHaveLength(0);
    });

    it("deletes folder and all descendants", () => {
      const parentId = useFolderStore.getState().createFolder("Parent");
      const child1Id = useFolderStore
        .getState()
        .createFolder("Child 1", parentId);
      const child2Id = useFolderStore
        .getState()
        .createFolder("Child 2", parentId);
      const grandchildId = useFolderStore
        .getState()
        .createFolder("Grandchild", child1Id);

      expect(useFolderStore.getState().folders).toHaveLength(4);

      useFolderStore.getState().deleteFolder(parentId!);

      expect(useFolderStore.getState().folders).toHaveLength(0);
    });

    it("resets selectedFolderId when selected folder is deleted", () => {
      const id = useFolderStore.getState().createFolder("Selected");
      useFolderStore.getState().setSelectedFolder(id!);

      expect(useFolderStore.getState().selectedFolderId).toBe(id);

      useFolderStore.getState().deleteFolder(id!);

      expect(useFolderStore.getState().selectedFolderId).toBeNull();
    });

    it("resets selectedFolderId when ancestor of selected folder is deleted", () => {
      const parentId = useFolderStore.getState().createFolder("Parent");
      const childId = useFolderStore.getState().createFolder("Child", parentId);
      useFolderStore.getState().setSelectedFolder(childId!);

      useFolderStore.getState().deleteFolder(parentId!);

      expect(useFolderStore.getState().selectedFolderId).toBeNull();
    });

    it("preserves selectedFolderId when different folder is deleted", () => {
      const folder1 = useFolderStore.getState().createFolder("Folder 1");
      const folder2 = useFolderStore.getState().createFolder("Folder 2");
      useFolderStore.getState().setSelectedFolder(folder1!);

      useFolderStore.getState().deleteFolder(folder2!);

      expect(useFolderStore.getState().selectedFolderId).toBe(folder1);
    });
  });

  // ============================================================================
  // Folder Color Tests
  // ============================================================================

  describe("setFolderColor", () => {
    it("sets folder color", () => {
      const id = useFolderStore.getState().createFolder("Colored");
      useFolderStore.getState().setFolderColor(id!, "#ef4444");

      const folder = useFolderStore.getState().getFolderById(id!);
      expect(folder?.color).toBe("#ef4444");
    });

    it("clears folder color with empty string", () => {
      const id = useFolderStore.getState().createFolder("Colored");
      useFolderStore.getState().setFolderColor(id!, "#ef4444");
      useFolderStore.getState().setFolderColor(id!, "");

      const folder = useFolderStore.getState().getFolderById(id!);
      expect(folder?.color).toBe("");
    });
  });

  // ============================================================================
  // UI State Tests
  // ============================================================================

  describe("UI State", () => {
    it("toggles folder expanded state", () => {
      const id = useFolderStore.getState().createFolder("Expandable");

      expect(useFolderStore.getState().getFolderById(id!)?.isExpanded).toBe(
        true
      );

      useFolderStore.getState().toggleFolderExpanded(id!);
      expect(useFolderStore.getState().getFolderById(id!)?.isExpanded).toBe(
        false
      );

      useFolderStore.getState().toggleFolderExpanded(id!);
      expect(useFolderStore.getState().getFolderById(id!)?.isExpanded).toBe(
        true
      );
    });

    it("sets selected folder", () => {
      const id = useFolderStore.getState().createFolder("Selectable");

      expect(useFolderStore.getState().selectedFolderId).toBeNull();

      useFolderStore.getState().setSelectedFolder(id!);
      expect(useFolderStore.getState().selectedFolderId).toBe(id);

      useFolderStore.getState().setSelectedFolder(null);
      expect(useFolderStore.getState().selectedFolderId).toBeNull();
    });

    it("expands all folders", () => {
      const id1 = useFolderStore.getState().createFolder("Folder 1");
      const id2 = useFolderStore.getState().createFolder("Folder 2");
      useFolderStore.getState().toggleFolderExpanded(id1!);
      useFolderStore.getState().toggleFolderExpanded(id2!);

      useFolderStore.getState().expandAll();

      expect(useFolderStore.getState().folders.every((f) => f.isExpanded)).toBe(
        true
      );
    });

    it("collapses all folders", () => {
      useFolderStore.getState().createFolder("Folder 1");
      useFolderStore.getState().createFolder("Folder 2");

      useFolderStore.getState().collapseAll();

      expect(
        useFolderStore.getState().folders.every((f) => !f.isExpanded)
      ).toBe(true);
    });
  });

  // ============================================================================
  // Query Tests
  // ============================================================================

  describe("Queries", () => {
    it("getFolderById returns correct folder", () => {
      const id = useFolderStore.getState().createFolder("Findable");
      const folder = useFolderStore.getState().getFolderById(id!);

      expect(folder).toBeDefined();
      expect(folder?.id).toBe(id);
      expect(folder?.name).toBe("Findable");
    });

    it("getFolderById returns undefined for non-existent id", () => {
      const folder = useFolderStore.getState().getFolderById("non-existent");

      expect(folder).toBeUndefined();
    });

    it("getChildFolders returns children of parent", () => {
      const parentId = useFolderStore.getState().createFolder("Parent");
      useFolderStore.getState().createFolder("Child 1", parentId);
      useFolderStore.getState().createFolder("Child 2", parentId);
      useFolderStore.getState().createFolder("Other Root");

      const children = useFolderStore.getState().getChildFolders(parentId!);

      expect(children).toHaveLength(2);
      expect(children.every((c) => c.parentId === parentId)).toBe(true);
    });

    it("getChildFolders returns root folders when parentId is null", () => {
      const root1 = useFolderStore.getState().createFolder("Root 1");
      const root2 = useFolderStore.getState().createFolder("Root 2");
      useFolderStore.getState().createFolder("Child", root1);

      const rootFolders = useFolderStore.getState().getChildFolders(null);

      expect(rootFolders).toHaveLength(2);
      expect(rootFolders.every((f) => f.parentId === null)).toBe(true);
    });

    it("getFolderDepth returns correct depth", () => {
      const level1 = useFolderStore.getState().createFolder("Level 1");
      const level2 = useFolderStore.getState().createFolder("Level 2", level1);
      const level3 = useFolderStore.getState().createFolder("Level 3", level2);

      expect(useFolderStore.getState().getFolderDepth(level1!)).toBe(0);
      expect(useFolderStore.getState().getFolderDepth(level2!)).toBe(1);
      expect(useFolderStore.getState().getFolderDepth(level3!)).toBe(2);
    });

    it("getFolderPath returns correct breadcrumb trail", () => {
      const l1 = useFolderStore.getState().createFolder("L1");
      const l2 = useFolderStore.getState().createFolder("L2", l1);
      const l3 = useFolderStore.getState().createFolder("L3", l2);

      const path = useFolderStore.getState().getFolderPath(l3!);

      expect(path).toHaveLength(3);
      expect(path.map((f) => f.name)).toEqual(["L1", "L2", "L3"]);
    });

    it("getFolderPath returns single item for root folder", () => {
      const root = useFolderStore.getState().createFolder("Root");

      const path = useFolderStore.getState().getFolderPath(root!);

      expect(path).toHaveLength(1);
      expect(path[0].name).toBe("Root");
    });
  });

  // ============================================================================
  // Clear/Reset Tests
  // ============================================================================

  describe("clearFolders", () => {
    it("clears all folders and resets state", () => {
      useFolderStore.getState().createFolder("Folder 1");
      useFolderStore.getState().createFolder("Folder 2");
      const id = useFolderStore.getState().createFolder("Folder 3");
      useFolderStore.getState().setSelectedFolder(id!);

      useFolderStore.getState().clearFolders();

      expect(useFolderStore.getState().folders).toHaveLength(0);
      expect(useFolderStore.getState().selectedFolderId).toBeNull();
      expect(useFolderStore.getState().isLoading).toBe(false);
    });
  });
});
