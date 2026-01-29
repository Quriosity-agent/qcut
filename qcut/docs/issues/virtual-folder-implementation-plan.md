# Virtual Folder Implementation Plan

**Feature:** Virtual folder organization for Media Panel
**Branch:** `feature/virtual-folder-media-panel`
**Priority:** Medium-High
**Estimated Effort:** Large (6 subtasks)

---

## Overview

Implement virtual folder organization in the QCut media panel, following industry standards (Premiere, DaVinci, FCP). Virtual folders are metadata-based - files stay in their original locations on disk.

---

## Current State Analysis

### Existing Architecture

| Component | File Path | Purpose |
|-----------|-----------|---------|
| Media Types | `apps/web/src/stores/media-store-types.ts` | MediaItem interface definition |
| Media Store | `apps/web/src/stores/media-store.ts` | Zustand state + CRUD operations |
| Storage Service | `apps/web/src/lib/storage/storage-service.ts` | Persistence layer (IndexedDB + OPFS) |
| Storage Types | `apps/web/src/lib/storage/types.ts` | MediaFileData, StorageAdapter interfaces |
| Media Panel Store | `apps/web/src/components/editor/media-panel/store.ts` | Tab state management |
| Media View | `apps/web/src/components/editor/media-panel/views/media.tsx` | Grid display + context menu |
| Media Panel | `apps/web/src/components/editor/media-panel/index.tsx` | Tab routing container |

### Current MediaItem Interface
```typescript
// apps/web/src/stores/media-store-types.ts (lines 5-33)
export interface MediaItem {
  id: string;
  name: string;
  type: MediaType;
  file: File;
  url?: string;
  originalUrl?: string;
  localPath?: string;
  isLocalFile?: boolean;
  thumbnailUrl?: string;
  thumbnailStatus?: "pending" | "loading" | "ready" | "failed";
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  content?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  textAlign?: "left" | "center" | "right";
  ephemeral?: boolean;
  metadata?: {
    source?: string;
    [key: string]: any;
  };
  // NO folderIds field currently exists
}
```

### Current MediaFileData (Storage)
```typescript
// apps/web/src/lib/storage/types.ts (lines 12-26)
export interface MediaFileData {
  id: string;
  name: string;
  type: "image" | "video" | "audio";
  size: number;
  lastModified: number;
  width?: number;
  height?: number;
  duration?: number;
  url?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
  localPath?: string;
  // NO folderIds field currently exists
}
```

### Gap Analysis
- No folder/collection/category functionality exists
- Media items stored as flat array without organization
- No `folderIds` in MediaItem or MediaFileData
- Context menu lacks "Move to Folder" and "Copy Path" options

---

## Implementation Tasks

### Task 1: Define Types & Interfaces

**Files to modify:**
- `apps/web/src/stores/media-store-types.ts`
- `apps/web/src/lib/storage/types.ts`

**Changes to `media-store-types.ts`:**
```typescript
// Add after line 3 (after MediaType definition)

/**
 * Virtual folder for organizing media items.
 * Virtual = metadata-only, files stay in original locations.
 */
export interface MediaFolder {
  id: string;
  name: string;
  parentId: string | null;  // null = root level
  color?: string;           // hex color for visual identification
  isExpanded: boolean;      // UI collapse state
  createdAt: number;        // timestamp
  updatedAt: number;        // timestamp
}

// Constants for folder constraints
export const FOLDER_MAX_DEPTH = 3;
export const FOLDER_NAME_MAX_LENGTH = 50;
export const FOLDER_NAME_MIN_LENGTH = 1;

// Default folder IDs (optional auto-creation)
export const DEFAULT_FOLDER_IDS = {
  VIDEOS: 'default-videos',
  AUDIO: 'default-audio',
  IMAGES: 'default-images',
  AI_GENERATED: 'default-ai-generated',
} as const;
```

**Update MediaItem interface (line 5):**
```typescript
export interface MediaItem {
  // ... existing fields ...

  // NEW: Virtual folder membership (can be in multiple folders)
  folderIds?: string[];
}
```

**Changes to `storage/types.ts`:**
```typescript
// Add after MediaFileData interface (line 26)

/**
 * Serialized folder data for IndexedDB storage.
 */
export interface FolderData {
  id: string;
  name: string;
  parentId: string | null;
  color?: string;
  isExpanded: boolean;
  createdAt: number;
  updatedAt: number;
}

// Update MediaFileData to include folderIds
export interface MediaFileData {
  // ... existing fields ...
  folderIds?: string[];  // NEW: folder membership
}
```

**Unit Tests:**
- `apps/web/src/stores/__tests__/media-store-types.test.ts`
  - Verify MediaFolder interface shape
  - Verify folderIds is optional array
  - Test FOLDER_MAX_DEPTH constant value

---

### Task 2: Implement Folder Store

**Files to create:**
- `apps/web/src/stores/folder-store.ts`
- `apps/web/src/stores/__tests__/folder-store.test.ts`

**Implementation (`folder-store.ts`):**
```typescript
import { create } from "zustand";
import { debugLog, debugError } from "@/lib/debug-config";
import { generateUUID } from "@/lib/utils";
import type { MediaFolder } from "./media-store-types";
import { FOLDER_MAX_DEPTH, FOLDER_NAME_MAX_LENGTH } from "./media-store-types";

interface FolderState {
  folders: MediaFolder[];
  selectedFolderId: string | null;  // null = "All Media"
  isLoading: boolean;
}

interface FolderActions {
  // CRUD
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
  getFolderPath: (id: string) => MediaFolder[];  // breadcrumb

  // Persistence
  loadFolders: (projectId: string) => Promise<void>;
  saveFolders: (projectId: string) => Promise<void>;
  clearFolders: () => void;
}

type FolderStore = FolderState & FolderActions;

export const useFolderStore = create<FolderStore>((set, get) => ({
  folders: [],
  selectedFolderId: null,
  isLoading: false,

  createFolder: (name, parentId = null) => {
    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > FOLDER_NAME_MAX_LENGTH) {
      debugError("[FolderStore] Invalid folder name length");
      return null;
    }

    // Check depth limit
    if (parentId) {
      const depth = get().getFolderDepth(parentId);
      if (depth >= FOLDER_MAX_DEPTH - 1) {
        debugError("[FolderStore] Max folder depth exceeded");
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

    debugLog("[FolderStore] Created folder:", { id, name: trimmedName, parentId });
    return id;
  },

  renameFolder: (id, name) => {
    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > FOLDER_NAME_MAX_LENGTH) {
      return false;
    }

    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === id ? { ...f, name: trimmedName, updatedAt: Date.now() } : f
      ),
    }));
    return true;
  },

  deleteFolder: (id) => {
    // Get all descendant folder IDs (recursive)
    const getDescendantIds = (folderId: string): string[] => {
      const children = get().folders.filter((f) => f.parentId === folderId);
      return children.flatMap((child) => [child.id, ...getDescendantIds(child.id)]);
    };

    const idsToDelete = [id, ...getDescendantIds(id)];

    set((state) => ({
      folders: state.folders.filter((f) => !idsToDelete.includes(f.id)),
      selectedFolderId:
        state.selectedFolderId && idsToDelete.includes(state.selectedFolderId)
          ? null
          : state.selectedFolderId,
    }));

    debugLog("[FolderStore] Deleted folders:", idsToDelete);
  },

  setFolderColor: (id, color) => {
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === id ? { ...f, color, updatedAt: Date.now() } : f
      ),
    }));
  },

  toggleFolderExpanded: (id) => {
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === id ? { ...f, isExpanded: !f.isExpanded } : f
      ),
    }));
  },

  setSelectedFolder: (id) => {
    set({ selectedFolderId: id });
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
    }
    return depth;
  },

  getFolderPath: (id) => {
    const path: MediaFolder[] = [];
    let current = get().folders.find((f) => f.id === id);
    while (current) {
      path.unshift(current);
      current = current.parentId
        ? get().folders.find((f) => f.id === current!.parentId)
        : undefined;
    }
    return path;
  },

  loadFolders: async (projectId) => {
    set({ isLoading: true });
    try {
      const { storageService } = await import("@/lib/storage/storage-service");
      const folders = await storageService.loadFolders(projectId);
      set({ folders, isLoading: false });
      debugLog("[FolderStore] Loaded folders:", folders.length);
    } catch (error) {
      debugError("[FolderStore] Failed to load folders:", error);
      set({ folders: [], isLoading: false });
    }
  },

  saveFolders: async (projectId) => {
    try {
      const { storageService } = await import("@/lib/storage/storage-service");
      await storageService.saveFolders(projectId, get().folders);
      debugLog("[FolderStore] Saved folders");
    } catch (error) {
      debugError("[FolderStore] Failed to save folders:", error);
    }
  },

  clearFolders: () => {
    set({ folders: [], selectedFolderId: null });
  },
}));
```

**Unit Tests (`__tests__/folder-store.test.ts`):**
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { useFolderStore } from "../folder-store";

describe("FolderStore", () => {
  beforeEach(() => {
    useFolderStore.getState().clearFolders();
  });

  it("creates folder at root level", () => {
    const id = useFolderStore.getState().createFolder("Test Folder");
    expect(id).toBeTruthy();
    expect(useFolderStore.getState().folders).toHaveLength(1);
    expect(useFolderStore.getState().folders[0].name).toBe("Test Folder");
    expect(useFolderStore.getState().folders[0].parentId).toBeNull();
  });

  it("creates nested folder", () => {
    const parentId = useFolderStore.getState().createFolder("Parent");
    const childId = useFolderStore.getState().createFolder("Child", parentId);
    expect(childId).toBeTruthy();
    const child = useFolderStore.getState().getFolderById(childId!);
    expect(child?.parentId).toBe(parentId);
  });

  it("enforces max depth of 3", () => {
    const level1 = useFolderStore.getState().createFolder("Level 1");
    const level2 = useFolderStore.getState().createFolder("Level 2", level1);
    const level3 = useFolderStore.getState().createFolder("Level 3", level2);
    const level4 = useFolderStore.getState().createFolder("Level 4", level3);
    expect(level4).toBeNull(); // Should fail
  });

  it("deletes folder and descendants", () => {
    const parent = useFolderStore.getState().createFolder("Parent");
    const child = useFolderStore.getState().createFolder("Child", parent);
    useFolderStore.getState().deleteFolder(parent!);
    expect(useFolderStore.getState().folders).toHaveLength(0);
  });

  it("renames folder with validation", () => {
    const id = useFolderStore.getState().createFolder("Original");
    const success = useFolderStore.getState().renameFolder(id!, "Renamed");
    expect(success).toBe(true);
    expect(useFolderStore.getState().folders[0].name).toBe("Renamed");
  });

  it("rejects empty folder name", () => {
    const id = useFolderStore.getState().createFolder("");
    expect(id).toBeNull();
  });

  it("calculates folder depth correctly", () => {
    const level1 = useFolderStore.getState().createFolder("L1");
    const level2 = useFolderStore.getState().createFolder("L2", level1);
    const level3 = useFolderStore.getState().createFolder("L3", level2);
    expect(useFolderStore.getState().getFolderDepth(level1!)).toBe(0);
    expect(useFolderStore.getState().getFolderDepth(level2!)).toBe(1);
    expect(useFolderStore.getState().getFolderDepth(level3!)).toBe(2);
  });

  it("returns correct folder path (breadcrumb)", () => {
    const l1 = useFolderStore.getState().createFolder("L1");
    const l2 = useFolderStore.getState().createFolder("L2", l1);
    const l3 = useFolderStore.getState().createFolder("L3", l2);
    const path = useFolderStore.getState().getFolderPath(l3!);
    expect(path.map((f) => f.name)).toEqual(["L1", "L2", "L3"]);
  });
});
```

---

### Task 3: Update Storage Service for Folders

**Files to modify:**
- `apps/web/src/lib/storage/storage-service.ts`

**Add to StorageService class:**
```typescript
// Add new adapter cache for folders (after line 28)
private folderAdapterCache = new Map<string, IndexedDBAdapter<FolderData>>();

// Helper to get project-specific folder adapter (after getProjectMediaAdapters)
private getProjectFolderAdapter(projectId: string): IndexedDBAdapter<FolderData> {
  const cached = this.folderAdapterCache.get(projectId);
  if (cached) return cached;

  const adapter = new IndexedDBAdapter<FolderData>(
    `${this.config.mediaDb}-${projectId}-folders`,
    "folders",
    this.config.version
  );

  this.folderAdapterCache.set(projectId, adapter);
  return adapter;
}

// Folder operations (add after deleteProjectMedia method)
async saveFolders(projectId: string, folders: MediaFolder[]): Promise<void> {
  const adapter = this.getProjectFolderAdapter(projectId);

  // Clear existing and save all
  await adapter.clear();

  for (const folder of folders) {
    const folderData: FolderData = {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      color: folder.color,
      isExpanded: folder.isExpanded,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    };
    await adapter.set(folder.id, folderData);
  }

  debugLog(`[StorageService] Saved ${folders.length} folders for project ${projectId}`);
}

async loadFolders(projectId: string): Promise<MediaFolder[]> {
  const adapter = this.getProjectFolderAdapter(projectId);
  const folderIds = await adapter.list();
  const folders: MediaFolder[] = [];

  for (const id of folderIds) {
    const data = await adapter.get(id);
    if (data) {
      folders.push({
        id: data.id,
        name: data.name,
        parentId: data.parentId,
        color: data.color,
        isExpanded: data.isExpanded ?? true,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    }
  }

  debugLog(`[StorageService] Loaded ${folders.length} folders for project ${projectId}`);
  return folders;
}

async deleteFolders(projectId: string): Promise<void> {
  const adapter = this.getProjectFolderAdapter(projectId);
  await adapter.clear();
  this.folderAdapterCache.delete(projectId);
}
```

**Update saveMediaItem and loadMediaItem to include folderIds:**
```typescript
// In saveMediaItem method, add to metadata object:
const metadata: MediaFileData = {
  // ... existing fields ...
  folderIds: mediaItem.folderIds,  // NEW
};

// In loadMediaItem method, add to return object:
return {
  // ... existing fields ...
  folderIds: metadata.folderIds,  // NEW
};
```

**Update deleteProject to clean up folders:**
```typescript
async deleteProject(id: string): Promise<void> {
  await this.projectsAdapter.remove(id);
  this.clearProjectMediaAdapters(id);
  await this.deleteFolders(id);  // NEW
}
```

---

### Task 4: Update Media Store for Folder Integration

**Files to modify:**
- `apps/web/src/stores/media-store.ts`

**Add new methods to MediaStore interface (after line 51):**
```typescript
// Folder assignment methods
addToFolder: (mediaId: string, folderId: string) => void;
removeFromFolder: (mediaId: string, folderId: string) => void;
moveToFolder: (mediaId: string, targetFolderId: string | null) => void;
getMediaByFolder: (folderId: string | null) => MediaItem[];
```

**Implement methods in create() (after restoreMediaItems):**
```typescript
addToFolder: (mediaId, folderId) => {
  set((state) => ({
    mediaItems: state.mediaItems.map((item) =>
      item.id === mediaId
        ? {
            ...item,
            folderIds: [...(item.folderIds || []), folderId].filter(
              (id, index, arr) => arr.indexOf(id) === index // dedupe
            ),
          }
        : item
    ),
  }));
  debugLog("[MediaStore] Added media to folder:", { mediaId, folderId });
},

removeFromFolder: (mediaId, folderId) => {
  set((state) => ({
    mediaItems: state.mediaItems.map((item) =>
      item.id === mediaId
        ? {
            ...item,
            folderIds: (item.folderIds || []).filter((id) => id !== folderId),
          }
        : item
    ),
  }));
  debugLog("[MediaStore] Removed media from folder:", { mediaId, folderId });
},

moveToFolder: (mediaId, targetFolderId) => {
  set((state) => ({
    mediaItems: state.mediaItems.map((item) =>
      item.id === mediaId
        ? {
            ...item,
            folderIds: targetFolderId ? [targetFolderId] : [],
          }
        : item
    ),
  }));
  debugLog("[MediaStore] Moved media to folder:", { mediaId, targetFolderId });
},

getMediaByFolder: (folderId) => {
  const { mediaItems } = get();
  if (folderId === null) {
    // "All Media" - return everything
    return mediaItems;
  }
  return mediaItems.filter((item) =>
    (item.folderIds || []).includes(folderId)
  );
},
```

---

### Task 5: Create Folder UI Components

**Files to create:**
- `apps/web/src/components/editor/media-panel/folder-tree.tsx`
- `apps/web/src/components/editor/media-panel/folder-item.tsx`
- `apps/web/src/components/editor/media-panel/create-folder-dialog.tsx`

**folder-tree.tsx:**
```typescript
"use client";

import { useFolderStore } from "@/stores/folder-store";
import { FolderItem } from "./folder-item";
import { CreateFolderDialog } from "./create-folder-dialog";
import { Button } from "@/components/ui/button";
import { FolderPlus, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FolderTreeProps {
  onFolderSelect?: (folderId: string | null) => void;
}

export function FolderTree({ onFolderSelect }: FolderTreeProps) {
  const { folders, selectedFolderId, setSelectedFolder, getChildFolders } = useFolderStore();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const rootFolders = getChildFolders(null);

  const handleSelect = (folderId: string | null) => {
    setSelectedFolder(folderId);
    onFolderSelect?.(folderId);
  };

  return (
    <div className="flex flex-col h-full border-r border-border">
      {/* Header */}
      <div className="p-2 border-b border-border flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Folders</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => setIsCreateDialogOpen(true)}
          aria-label="Create new folder"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Folder List */}
      <ScrollArea className="flex-1">
        <div className="p-1">
          {/* All Media (root) */}
          <button
            type="button"
            className={`w-full text-left px-2 py-1.5 text-sm rounded flex items-center gap-2 ${
              selectedFolderId === null
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted"
            }`}
            onClick={() => handleSelect(null)}
          >
            <span className="text-muted-foreground">All Media</span>
          </button>

          {/* Folder hierarchy */}
          {rootFolders.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              depth={0}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </ScrollArea>

      <CreateFolderDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </div>
  );
}
```

**folder-item.tsx:**
```typescript
"use client";

import { useFolderStore } from "@/stores/folder-store";
import type { MediaFolder } from "@/stores/media-store-types";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";

interface FolderItemProps {
  folder: MediaFolder;
  depth: number;
  onSelect: (folderId: string | null) => void;
}

const FOLDER_COLORS = [
  { label: "Default", value: undefined },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Yellow", value: "#eab308" },
  { label: "Green", value: "#22c55e" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Purple", value: "#a855f7" },
];

export function FolderItem({ folder, depth, onSelect }: FolderItemProps) {
  const {
    selectedFolderId,
    getChildFolders,
    toggleFolderExpanded,
    deleteFolder,
    renameFolder,
    setFolderColor,
  } = useFolderStore();

  const children = getChildFolders(folder.id);
  const hasChildren = children.length > 0;
  const isSelected = selectedFolderId === folder.id;
  const isExpanded = folder.isExpanded;

  const handleRename = () => {
    const newName = prompt("Rename folder:", folder.name);
    if (newName && newName.trim()) {
      renameFolder(folder.id, newName.trim());
    }
  };

  const handleDelete = () => {
    if (confirm(`Delete folder "${folder.name}" and all subfolders?`)) {
      deleteFolder(folder.id);
    }
  };

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger>
          <button
            type="button"
            className={`w-full text-left px-2 py-1.5 text-sm rounded flex items-center gap-1 ${
              isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted"
            }`}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onClick={() => onSelect(folder.id)}
          >
            {/* Expand/Collapse */}
            {hasChildren ? (
              <button
                type="button"
                className="p-0.5 hover:bg-muted rounded"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFolderExpanded(folder.id);
                }}
                aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </button>
            ) : (
              <span className="w-4" /> // Spacer
            )}

            {/* Folder icon */}
            {isExpanded && hasChildren ? (
              <FolderOpen
                className="h-4 w-4"
                style={{ color: folder.color }}
              />
            ) : (
              <Folder className="h-4 w-4" style={{ color: folder.color }} />
            )}

            {/* Name */}
            <span className="truncate flex-1">{folder.name}</span>
          </button>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={handleRename}>Rename</ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Change Color</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {FOLDER_COLORS.map((color) => (
                <ContextMenuItem
                  key={color.label}
                  onClick={() => setFolderColor(folder.id, color.value || "")}
                >
                  <span
                    className="w-3 h-3 rounded-full mr-2"
                    style={{ backgroundColor: color.value || "#888" }}
                  />
                  {color.label}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={handleDelete}>
            Delete Folder
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Children (recursive) */}
      {isExpanded && hasChildren && (
        <div>
          {children.map((child) => (
            <FolderItem
              key={child.id}
              folder={child}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

**create-folder-dialog.tsx:**
```typescript
"use client";

import { useState } from "react";
import { useFolderStore } from "@/stores/folder-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FOLDER_NAME_MAX_LENGTH } from "@/stores/media-store-types";

interface CreateFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId?: string | null;
}

export function CreateFolderDialog({
  open,
  onOpenChange,
  parentId = null,
}: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const { createFolder } = useFolderStore();

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Folder name cannot be empty");
      return;
    }

    const folderId = createFolder(trimmed, parentId);
    if (folderId) {
      toast.success(`Created folder "${trimmed}"`);
      setName("");
      onOpenChange(false);
    } else {
      toast.error("Failed to create folder. Check depth limit (max 3 levels).");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Folder</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder Name</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Folder"
              maxLength={FOLDER_NAME_MAX_LENGTH}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

### Task 6: Update Media View with Folder Integration

**Files to modify:**
- `apps/web/src/components/editor/media-panel/views/media.tsx`

**Key changes:**

1. **Add folder sidebar** (resizable panel)
2. **Filter media by selected folder**
3. **Add "Move to Folder" context menu**
4. **Add "Copy File Path" and "Open in Explorer" context menu items**

**Import additions:**
```typescript
import { FolderTree } from "../folder-tree";
import { useFolderStore } from "@/stores/folder-store";
import { Copy, FolderInput, ExternalLink } from "lucide-react";
import {
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
```

**Add folder state (after existing useState hooks):**
```typescript
const { folders, selectedFolderId } = useFolderStore();
const { moveToFolder } = mediaStore || {};
```

**Update filtering logic:**
```typescript
useEffect(() => {
  let filtered = mediaItems.filter((item) => {
    if (item.ephemeral) return false;
    if (mediaFilter && mediaFilter !== "all" && item.type !== mediaFilter) return false;
    if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;

    // NEW: Filter by folder
    if (selectedFolderId !== null) {
      if (!(item.folderIds || []).includes(selectedFolderId)) return false;
    }

    return true;
  });

  setFilteredMediaItems(filtered);
}, [mediaItems, mediaFilter, searchQuery, selectedFolderId]);
```

**Update layout (wrap with folder sidebar):**
```tsx
return (
  <div className="flex h-full">
    {/* Folder sidebar */}
    <div className="w-48 min-w-[150px] max-w-[250px] flex-shrink-0">
      <FolderTree />
    </div>

    {/* Media grid (existing content) */}
    <div className="flex-1 flex flex-col">
      {/* ... existing content ... */}
    </div>
  </div>
);
```

**Add to context menu (after "Analyze with Gemini"):**
```tsx
<ContextMenuSeparator />

{/* Move to Folder */}
<ContextMenuSub>
  <ContextMenuSubTrigger>
    <FolderInput className="h-4 w-4 mr-2" />
    Move to Folder
  </ContextMenuSubTrigger>
  <ContextMenuSubContent>
    <ContextMenuItem onClick={() => moveToFolder?.(item.id, null)}>
      No Folder
    </ContextMenuItem>
    <ContextMenuSeparator />
    {folders.map((folder) => (
      <ContextMenuItem
        key={folder.id}
        onClick={() => moveToFolder?.(item.id, folder.id)}
      >
        {folder.name}
      </ContextMenuItem>
    ))}
  </ContextMenuSubContent>
</ContextMenuSub>

{/* Copy File Path */}
<ContextMenuItem
  onClick={async (e) => {
    e.stopPropagation();
    const path = item.localPath || item.url;
    if (path && !path.startsWith("blob:")) {
      await navigator.clipboard.writeText(path);
      toast.success("Path copied to clipboard");
    } else {
      toast.error("No file path available");
    }
  }}
>
  <Copy className="h-4 w-4 mr-2" />
  Copy File Path
</ContextMenuItem>

{/* Open in Explorer */}
{item.localPath && (
  <ContextMenuItem
    onClick={(e) => {
      e.stopPropagation();
      if (window.electronAPI?.shell?.showItemInFolder) {
        window.electronAPI.shell.showItemInFolder(item.localPath!);
      } else {
        toast.error("Only available in desktop app");
      }
    }}
  >
    <ExternalLink className="h-4 w-4 mr-2" />
    Open in Explorer
  </ContextMenuItem>
)}
```

---

## File Path Summary

### New Files
| File | Purpose |
|------|---------|
| `stores/folder-store.ts` | Zustand store for folder state |
| `stores/__tests__/folder-store.test.ts` | Unit tests for folder store |
| `components/editor/media-panel/folder-tree.tsx` | Folder hierarchy sidebar |
| `components/editor/media-panel/folder-item.tsx` | Single folder row component |
| `components/editor/media-panel/create-folder-dialog.tsx` | New folder dialog |

### Modified Files
| File | Changes |
|------|---------|
| `stores/media-store-types.ts` | Add MediaFolder interface, folderIds to MediaItem |
| `stores/media-store.ts` | Add folder assignment methods |
| `lib/storage/types.ts` | Add FolderData interface, folderIds to MediaFileData |
| `lib/storage/storage-service.ts` | Add folder persistence methods |
| `components/editor/media-panel/views/media.tsx` | Add folder sidebar, context menu updates |

---

## Implementation Order

```
Task 1: Types & Interfaces
    ↓
Task 2: Folder Store (depends on types)
    ↓
Task 3: Storage Service (depends on types)
    ↓
Task 4: Media Store Integration (depends on store + storage)
    ↓
Task 5: Folder UI Components (depends on store)
    ↓
Task 6: Media View Integration (depends on all above)
```

---

## Accessibility Checklist (per CLAUDE.md rules)

- [ ] All `<button>` elements have `type="button"` or `type="submit"`
- [ ] Folder icons have descriptive `aria-label` attributes
- [ ] Keyboard navigation works (arrow keys, Enter, Space)
- [ ] ARIA attributes: `aria-expanded`, `aria-selected`
- [ ] Focus management when creating/deleting folders
- [ ] No `tabIndex` on non-interactive elements

---

## Long-Term Support Considerations

1. **Project scoping** - Folders are project-specific, not global
2. **Backward compatibility** - Old projects load fine (empty folderIds = unorganized)
3. **Data migration** - No breaking changes to MediaItem or MediaFileData
4. **Storage isolation** - Separate IndexedDB for folders per project
5. **Cascade behavior** - Deleting folder removes assignment, not media files
6. **Performance** - Folder operations are O(n) where n = folder count (typically < 100)

---

## Success Criteria

1. ✅ Users can create/rename/delete virtual folders (max 3 levels deep)
2. ✅ Media items can be assigned to multiple folders
3. ✅ Folder structure persists with project (survives reload)
4. ✅ Context menu includes "Move to Folder", "Copy Path", "Open in Explorer"
5. ✅ All existing functionality unchanged
6. ✅ Unit tests pass for folder-store
7. ✅ Accessible (keyboard nav, screen reader compatible)
