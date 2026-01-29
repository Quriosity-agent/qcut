import { create } from "zustand";
import { debugLog, debugError } from "@/lib/debug-config";
import { generateUUID } from "@/lib/utils";
import type { MediaFolder } from "./media-store-types";
import {
  FOLDER_MAX_DEPTH,
  FOLDER_NAME_MAX_LENGTH,
  FOLDER_NAME_MIN_LENGTH,
} from "./media-store-types";

// ============================================================================
// Folder Store Types
// ============================================================================

interface FolderState {
  folders: MediaFolder[];
  selectedFolderId: string | null; // null = "All Media" view
  isLoading: boolean;
  activeProjectId: string | null; // Track project for auto-persistence
}

interface FolderActions {
  // CRUD Operations
  createFolder: (name: string, parentId?: string | null) => string | null;
  renameFolder: (id: string, name: string) => boolean;
  deleteFolder: (id: string) => void;
  setFolderColor: (id: string, color: string) => void;

  // UI State
  toggleFolderExpanded: (id: string) => void;
  setSelectedFolder: (id: string | null) => void;
  expandAll: () => void;
  collapseAll: () => void;

  // Queries
  getFolderById: (id: string) => MediaFolder | undefined;
  getChildFolders: (parentId: string | null) => MediaFolder[];
  getFolderDepth: (id: string) => number;
  getFolderPath: (id: string) => MediaFolder[]; // breadcrumb trail

  // Persistence
  loadFolders: (projectId: string) => Promise<void>;
  saveFolders: (projectId: string) => Promise<void>;
  clearFolders: () => void;
}

type FolderStore = FolderState & FolderActions;

// ============================================================================
// Folder Store Implementation
// ============================================================================

export const useFolderStore = create<FolderStore>((set, get) => {
  // Helper to auto-persist after mutations
  const persistFolders = async () => {
    const { activeProjectId, folders } = get();
    if (!activeProjectId) {
      debugLog("[FolderStore] Skipping persist - no active project");
      return;
    }
    try {
      const { storageService } = await import("@/lib/storage/storage-service");
      await storageService.saveFolders(activeProjectId, folders);
      debugLog("[FolderStore] Auto-persisted folders:", {
        projectId: activeProjectId,
        count: folders.length,
      });
    } catch (error) {
      debugError("[FolderStore] Failed to auto-persist folders:", error);
    }
  };

  return {
  // Initial State
  folders: [],
  selectedFolderId: null,
  isLoading: false,
  activeProjectId: null,

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  createFolder: (name, parentId = null) => {
    const trimmedName = name.trim();

    // Validate name length
    if (
      trimmedName.length < FOLDER_NAME_MIN_LENGTH ||
      trimmedName.length > FOLDER_NAME_MAX_LENGTH
    ) {
      debugError("[FolderStore] Invalid folder name length:", {
        length: trimmedName.length,
        min: FOLDER_NAME_MIN_LENGTH,
        max: FOLDER_NAME_MAX_LENGTH,
      });
      return null;
    }

    // Check depth limit if creating nested folder
    if (parentId) {
      const parentDepth = get().getFolderDepth(parentId);
      if (parentDepth >= FOLDER_MAX_DEPTH - 1) {
        debugError("[FolderStore] Max folder depth exceeded:", {
          parentId,
          parentDepth,
          maxDepth: FOLDER_MAX_DEPTH,
        });
        return null;
      }

      // Verify parent exists
      const parentFolder = get().getFolderById(parentId);
      if (!parentFolder) {
        debugError("[FolderStore] Parent folder not found:", parentId);
        return null;
      }
    }

    const id = generateUUID();
    const now = Date.now();

    const newFolder: MediaFolder = {
      id,
      name: trimmedName,
      parentId,
      isExpanded: true,
      createdAt: now,
      updatedAt: now,
    };

    set((state) => ({
      folders: [...state.folders, newFolder],
    }));

    debugLog("[FolderStore] Created folder:", {
      id,
      name: trimmedName,
      parentId,
    });

    // Auto-persist after mutation
    void persistFolders();

    return id;
  },

  renameFolder: (id, name) => {
    const trimmedName = name.trim();

    // Validate name length
    if (
      trimmedName.length < FOLDER_NAME_MIN_LENGTH ||
      trimmedName.length > FOLDER_NAME_MAX_LENGTH
    ) {
      debugError("[FolderStore] Invalid folder name for rename:", {
        length: trimmedName.length,
      });
      return false;
    }

    // Verify folder exists
    const folder = get().getFolderById(id);
    if (!folder) {
      debugError("[FolderStore] Folder not found for rename:", id);
      return false;
    }

    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === id
          ? { ...f, name: trimmedName, updatedAt: Date.now() }
          : f
      ),
    }));

    debugLog("[FolderStore] Renamed folder:", { id, newName: trimmedName });

    // Auto-persist after mutation
    void persistFolders();

    return true;
  },

  deleteFolder: (id) => {
    // Recursively get all descendant folder IDs
    const getDescendantIds = (folderId: string): string[] => {
      const children = get().folders.filter((f) => f.parentId === folderId);
      return children.flatMap((child) => [
        child.id,
        ...getDescendantIds(child.id),
      ]);
    };

    const idsToDelete = [id, ...getDescendantIds(id)];

    set((state) => ({
      folders: state.folders.filter((f) => !idsToDelete.includes(f.id)),
      // Reset selection if deleted folder was selected
      selectedFolderId:
        state.selectedFolderId && idsToDelete.includes(state.selectedFolderId)
          ? null
          : state.selectedFolderId,
    }));

    debugLog("[FolderStore] Deleted folders:", idsToDelete);

    // Auto-persist after mutation
    void persistFolders();
  },

  setFolderColor: (id, color) => {
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === id ? { ...f, color, updatedAt: Date.now() } : f
      ),
    }));

    debugLog("[FolderStore] Set folder color:", { id, color });

    // Auto-persist after mutation
    void persistFolders();
  },

  // ============================================================================
  // UI State
  // ============================================================================

  toggleFolderExpanded: (id) => {
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === id ? { ...f, isExpanded: !f.isExpanded } : f
      ),
    }));
  },

  setSelectedFolder: (id) => {
    set({ selectedFolderId: id });
    debugLog("[FolderStore] Selected folder:", id);
  },

  expandAll: () => {
    set((state) => ({
      folders: state.folders.map((f) => ({ ...f, isExpanded: true })),
    }));
  },

  collapseAll: () => {
    set((state) => ({
      folders: state.folders.map((f) => ({ ...f, isExpanded: false })),
    }));
  },

  // ============================================================================
  // Queries
  // ============================================================================

  getFolderById: (id) => {
    return get().folders.find((f) => f.id === id);
  },

  getChildFolders: (parentId) => {
    return get().folders.filter((f) => f.parentId === parentId);
  },

  getFolderDepth: (id) => {
    let depth = 0;
    let current = get().folders.find((f) => f.id === id);

    while (current?.parentId) {
      depth++;
      current = get().folders.find((f) => f.id === current!.parentId);

      // Safety check to prevent infinite loops
      if (depth > FOLDER_MAX_DEPTH + 1) {
        debugError("[FolderStore] Circular reference detected in folder tree");
        break;
      }
    }

    return depth;
  },

  getFolderPath: (id) => {
    const path: MediaFolder[] = [];
    let current = get().folders.find((f) => f.id === id);
    let safetyCounter = 0;

    while (current) {
      path.unshift(current);
      current = current.parentId
        ? get().folders.find((f) => f.id === current!.parentId)
        : undefined;

      // Safety check to prevent infinite loops
      safetyCounter++;
      if (safetyCounter > FOLDER_MAX_DEPTH + 1) {
        debugError("[FolderStore] Circular reference detected in folder path");
        break;
      }
    }

    return path;
  },

  // ============================================================================
  // Persistence
  // ============================================================================

  loadFolders: async (projectId) => {
    set({ isLoading: true });

    try {
      const { storageService } = await import("@/lib/storage/storage-service");
      const folders = await storageService.loadFolders(projectId);

      // Reset stale selection if current selectedFolderId doesn't exist in loaded folders
      const selected = get().selectedFolderId;
      const selectionValid = selected
        ? folders.some((f) => f.id === selected)
        : true;

      set({
        folders,
        isLoading: false,
        selectedFolderId: selectionValid ? selected : null,
        activeProjectId: projectId,
      });
      debugLog("[FolderStore] Loaded folders:", {
        projectId,
        count: folders.length,
        selectionReset: !selectionValid,
      });
    } catch (error) {
      debugError("[FolderStore] Failed to load folders:", error);
      set({ folders: [], selectedFolderId: null, isLoading: false, activeProjectId: null });
    }
  },

  saveFolders: async (projectId) => {
    try {
      const { storageService } = await import("@/lib/storage/storage-service");
      await storageService.saveFolders(projectId, get().folders);
      debugLog("[FolderStore] Saved folders:", {
        projectId,
        count: get().folders.length,
      });
    } catch (error) {
      debugError("[FolderStore] Failed to save folders:", error);
    }
  },

  clearFolders: () => {
    set({ folders: [], selectedFolderId: null, isLoading: false, activeProjectId: null });
    debugLog("[FolderStore] Cleared all folders");
  },
}});
