# Project Folder Auto-Sync

## Overview

Automatically sync media files from the project's disk folder into the Media panel. Replaces the original "Project Folder" tab approach with a simpler design: auto-sync on project open + a sync button in the existing Media tab toolbar.

### Problem
Files placed in the project folder externally (drag-and-drop to Explorer, AI pipeline outputs) don't appear in the Media panel until manually imported via the "+" button.

### Solution
- **Auto-sync on mount**: When the Media tab initializes, scan `media/` recursively and import untracked files
- **Manual sync button**: RefreshCw icon button in the Media tab toolbar for on-demand re-scan
- **No new panel/tab**: Keeps the existing 21+ tab count unchanged

## Architecture

```
Disk: ~/Documents/QCut/Projects/{id}/media/
  ├── imported/          → DEFAULT_FOLDER_IDS.VIDEOS/AUDIO/IMAGES
  ├── generated/
  │   ├── images/        → IMAGES + AI_GENERATED
  │   ├── videos/        → VIDEOS + AI_GENERATED
  │   └── audio/         → AUDIO + AI_GENERATED
  └── temp/              → ignored (unknown type)

IPC Layer (existing, no changes):
  electron/project-folder-handler.ts
  └── project-folder:scan(projectId, "media", {recursive, mediaOnly})
  └── project-folder:ensure-structure(projectId)

Sync Logic (new):
  apps/web/src/lib/project-folder-sync.ts
  ├── syncProjectFolder()    → orchestrator
  ├── findUntrackedFiles()   → duplicate detection (pure)
  └── determineFolderIds()   → folder assignment (pure)

Store Integration:
  media-store.ts → syncFromProjectFolder() delegates to sync module

UI Integration:
  media.tsx → sync button + auto-sync useEffect
```

### Duplicate Detection Strategy

Files are matched against existing media items using three strategies (checked in order):
1. **localPath** — absolute disk path (case-insensitive, path-separator normalized)
2. **importMetadata.originalPath** — original source path from symlink import
3. **name + file.size** — fallback for files moved within the project

## Implementation

**Estimated Total Time**: ~2.5 hours
**Subtask Count**: 5

---

### Subtask 1: Sync Logic Module (60 min)

**Priority**: High
**File**: `apps/web/src/lib/project-folder-sync.ts` (NEW)

Core exports:
- `syncProjectFolder(projectId): Promise<SyncResult>` — scans disk, dedupes, imports
- `findUntrackedFiles(diskFiles, mediaItems): ProjectFolderFileInfo[]` — pure dedup filter
- `determineFolderIds(file): string[]` — pure folder assignment

Reuses:
- `getMimeType()` from `@/lib/bulk-import`
- `window.electronAPI.projectFolder.scan()` (existing IPC)
- `window.electronAPI.readFile()` (existing IPC)
- `useMediaStore.getState().addMediaItem()` (dynamic import)

---

### Subtask 2: Store Method (20 min)

**Priority**: High
**Files**:
- `apps/web/src/stores/media-store.ts` — add `syncFromProjectFolder` implementation
- `apps/web/src/stores/media-store.ts` interface — add method signature

---

### Subtask 3: Sync Button + Auto-Sync (30 min)

**Priority**: High
**File**: `apps/web/src/components/editor/media-panel/views/media.tsx`

- RefreshCw button between import and export buttons
- `handleSync` callback with toast feedback
- `useEffect` auto-sync on first mount (guarded by `hasSyncedRef`)

---

### Subtask 4: Unit Tests (45 min)

**Priority**: Medium
**File**: `apps/web/src/lib/__tests__/project-folder-sync.test.ts` (NEW)

Tests for:
- `determineFolderIds`: type-based and path-based folder assignment
- `findUntrackedFiles`: dedup by localPath, originalPath, name+size; skip dirs and unknowns
- `syncProjectFolder`: graceful handling when electronAPI unavailable

---

### Subtask 5: Task Documentation (15 min)

**Priority**: Medium
**File**: `docs/task/project-folder-auto-sync.md` (this file)

---

## Summary

| # | Subtask | Time | Files |
|---|---------|------|-------|
| 1 | Sync logic module | 60m | `lib/project-folder-sync.ts` |
| 2 | Store method | 20m | `media-store.ts` |
| 3 | Sync button + auto-sync | 30m | `views/media.tsx` |
| 4 | Unit tests | 45m | `lib/__tests__/project-folder-sync.test.ts` |
| 5 | Task documentation | 15m | `docs/task/project-folder-auto-sync.md` |

## Dependencies

- `electron/project-folder-handler.ts` — IPC scanning (existing)
- `electron/preload.ts` — `projectFolder` API bridge (existing)
- `apps/web/src/types/electron.d.ts` — `ProjectFolderFileInfo`, `ProjectFolderScanResult` (existing)
- `apps/web/src/lib/bulk-import.ts` — `getMimeType()` (existing)

## Future Enhancements (Out of Scope)

1. **Watch mode** — `fs.watch()` for real-time sync without manual button press
2. **Progress bar** — for large project folders (hundreds of files)
3. **Conflict resolution** — detect renamed/moved files beyond name+size matching
