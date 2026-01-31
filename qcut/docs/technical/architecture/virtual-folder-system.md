# Virtual Folder System Architecture

This document describes QCut's virtual folder system for organizing media items in the media panel.

## Overview

Virtual folders are metadata-only organizational structures following industry standards (Premiere bins, DaVinci bins, FCP events). Files remain in their original disk locations - only folder membership is tracked.

```
┌─────────────────────────────────────────────────────────────┐
│                    Media Panel                               │
│  ┌───────────────────┐  ┌─────────────────────────────────┐ │
│  │   Folder Tree     │  │        Media Grid               │ │
│  │  ┌─────────────┐  │  │  ┌─────┐ ┌─────┐ ┌─────┐       │ │
│  │  │ All Media   │  │  │  │ img │ │ vid │ │ aud │ ...   │ │
│  │  │ 📁 Videos   │◄─┼──│  └─────┘ └─────┘ └─────┘       │ │
│  │  │   📁 Raw    │  │  │  Filtered by selectedFolderId  │ │
│  │  │   📁 Final  │  │  └─────────────────────────────────┘ │
│  │  │ 📁 Audio    │  │                                      │
│  │  └─────────────┘  │                                      │
│  └───────────────────┘                                      │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### MediaFolder Interface

```typescript
interface MediaFolder {
  id: string;
  name: string;
  parentId: string | null;  // null = root level
  color?: string;           // hex color (e.g., "#ef4444")
  isExpanded: boolean;      // UI collapse state
  createdAt: number;
  updatedAt: number;
}
```

### MediaItem Integration

Media items use `folderIds` array for multi-folder membership (like tags):

```typescript
interface MediaItem {
  // ... other fields
  folderIds?: string[];  // Can be in multiple folders
}
```

### Constraints

| Constant | Value | Purpose |
|----------|-------|---------|
| `FOLDER_MAX_DEPTH` | 3 | Prevents deep nesting |
| `FOLDER_NAME_MAX_LENGTH` | 50 | UI display limits |
| `FOLDER_NAME_MIN_LENGTH` | 1 | Validation |

## Key Components

### 1. Folder Store (`apps/web/src/stores/folder-store.ts`)

Zustand store managing folder state with auto-persistence.

**State:**
```typescript
interface FolderState {
  folders: MediaFolder[];
  selectedFolderId: string | null;  // null = "All Media"
  isLoading: boolean;
  activeProjectId: string | null;   // For auto-persist
}
```

**Key Actions:**
| Action | Description |
|--------|-------------|
| `createFolder(name, parentId)` | Creates folder, enforces depth limit |
| `deleteFolder(id)` | Deletes folder + all descendants (cycle-safe) |
| `renameFolder(id, name)` | Validates name length, returns success |
| `setFolderColor(id, color)` | Visual customization |
| `getFolderDepth(id)` | Returns nesting level (0 = root) |
| `getFolderPath(id)` | Returns breadcrumb trail |

**Auto-Persistence:**
```typescript
// Mutations automatically persist via serialized queue
const persistFolders = () => {
  persistQueue = persistQueue.then(async () => {
    await storageService.saveFolders(activeProjectId, folders);
  });
};
```

### 2. Media Store Integration (`apps/web/src/stores/media-store.ts`)

**Folder Assignment Methods:**
```typescript
addToFolder(mediaId, folderId)      // Add to folder (deduplicated)
removeFromFolder(mediaId, folderId) // Remove from specific folder
moveToFolder(mediaId, folderId)     // Replace all with single folder
getMediaByFolder(folderId)          // Filter media by folder (null = all)
```

### 3. Storage Service (`apps/web/src/lib/storage/storage-service.ts`)

Folders stored in separate IndexedDB per project:

```typescript
// Database name pattern
`qcut-media-{projectId}-folders`

// Operations
saveFolders(projectId, folders)  // Clear + write all
loadFolders(projectId)           // Read all folders
deleteFolders(projectId)         // Cleanup on project delete
```

### 4. UI Components

| Component | Path | Purpose |
|-----------|------|---------|
| `FolderTree` | `media-panel/folder-tree.tsx` | Sidebar with hierarchy |
| `FolderItem` | `media-panel/folder-item.tsx` | Single folder row (recursive) |
| `CreateFolderDialog` | `media-panel/create-folder-dialog.tsx` | New folder modal |

## Data Flow

### Creating a Folder
```
User clicks [+] → CreateFolderDialog → store.createFolder()
                                            │
                    ┌───────────────────────┘
                    ▼
            Validate (depth, name length)
                    │
                    ▼
            Add to folders array
                    │
                    ▼
            Auto-persist to IndexedDB
```

### Filtering Media by Folder
```
User clicks folder → store.setSelectedFolder(id)
                            │
        ┌───────────────────┘
        ▼
  MediaView useEffect triggers
        │
        ▼
  Filter: item.folderIds?.includes(selectedFolderId)
        │
        ▼
  Update filteredMediaItems
```

### Deleting Folder (Cascade)
```
store.deleteFolder(id)
        │
        ▼
  getDescendantIds(id, visited)  // Cycle-safe recursion
        │
        ▼
  Filter out all IDs from folders array
        │
        ▼
  Reset selection if deleted folder was selected
        │
        ▼
  Auto-persist changes
```

## Cycle Detection

Recursive operations use visited sets to prevent infinite loops from corrupted data:

```typescript
const getDescendantIds = (folderId: string, visited = new Set<string>()) => {
  if (visited.has(folderId)) {
    debugError("Circular reference detected");
    return [];
  }
  visited.add(folderId);
  // ... recursive logic
};
```

Similar guards exist in `getFolderDepth()` and `getFolderPath()`.

## Context Menu Integration

Media items have folder-related context menu options:

| Option | Action |
|--------|--------|
| Move to Folder | Opens submenu with all folders |
| Copy File Path | Copies `localPath` or `url` to clipboard |
| Open in Explorer | Calls `shell.showItemInFolder()` (desktop only) |

## Project Isolation

- Each project has its own folder IndexedDB store
- Switching projects triggers `loadFolders(projectId)`
- Stale `selectedFolderId` is reset if folder doesn't exist in new project
- Deleting project cleans up folder storage

## Related Files

| File | Purpose |
|------|---------|
| `stores/media-store-types.ts` | MediaFolder interface, constraints |
| `stores/folder-store.ts` | Folder state management |
| `stores/media-store.ts` | Folder assignment methods |
| `lib/storage/storage-service.ts` | Folder persistence |
| `components/editor/media-panel/folder-tree.tsx` | Folder sidebar UI |
| `components/editor/media-panel/folder-item.tsx` | Folder row component |
| `components/editor/media-panel/views/media.tsx` | Filtering integration |
