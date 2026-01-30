# Hybrid Symbolic Link Approach for Media Imports

**Feature Branch:** `feature/virtual-folder-skill-improvements`
**Estimated Time:** ~3.5 hours
**Priority:** Medium-High

---

## Executive Summary

The hybrid symbolic link approach will enhance QCut's media import system by:
1. **Primary**: Attempting to create symbolic links to original media files
2. **Fallback**: Copying files when symlinks are not possible (lack of admin privileges, network drives, cross-device scenarios)
3. **Tracking**: Storing metadata about the import method for proper cleanup and management
4. **Consistency**: Maintaining a uniform project structure regardless of import method

---

## Current Architecture Analysis

### Key Observations:

1. **Project Structure Pattern**: Skills handler uses `Documents/QCut/Projects/{projectId}/skills` - we follow this pattern for media.

2. **Media Storage Flow**:
   - `media-processing.ts` processes imported files and calls `video.saveTemp()` for videos
   - `storage-service.ts` saves file data to OPFS via `OPFSAdapter` and metadata to IndexedDB
   - `media-store.ts` manages in-memory state and persists via `storageService`

3. **File Storage Locations**:
   - Temp files: `app.getPath("temp")/qcut-videos/`
   - AI videos: `app.getPath("userData")/projects/{projectId}/ai-videos/`
   - Project data: `app.getPath("userData")/projects/{projectId}.json`
   - Skills: `Documents/QCut/Projects/{projectId}/skills/`

4. **Type Definitions**:
   - `MediaItem` already has `localPath?: string` for FFmpeg export paths
   - `MediaFileData` (storage types) mirrors this with `localPath?: string`

---

## Project Structure After Implementation

```
Documents/QCut/Projects/{projectId}/
├── project.qcut
├── media/
│   ├── imported/          # Symlinks or copies of original files
│   │   ├── {mediaId}.mp4  # Symlink → C:\Users\...\original.mp4
│   │   ├── {mediaId}.jpg  # Copy (if symlink failed)
│   │   └── ...
│   ├── generated/         # AI-generated media (actual files)
│   └── temp/              # Processing intermediates
├── skills/                # Project skills
├── output/                # Exported videos
└── cache/                 # Processing cache
```

---

## Implementation Subtasks

### Subtask 1: Create Electron Media Import Handler (45 min)

**New File:** `electron/media-import-handler.ts`

Purpose: Core IPC handlers for symlink creation with fallback to copy.

```typescript
// Key Functions
export function setupMediaImportIPC(): void;
function getProjectMediaPath(projectId: string): string;
function createSymlink(sourcePath: string, targetPath: string): Promise<boolean>;
function copyFile(sourcePath: string, targetPath: string): Promise<boolean>;
function validateMediaPath(path: string): Promise<boolean>;
function removeImportedMedia(projectId: string, mediaId: string): Promise<boolean>;

// IPC Handlers
ipcMain.handle("media-import:import", ...);
ipcMain.handle("media-import:validate-symlink", ...);
ipcMain.handle("media-import:locate-original", ...);
ipcMain.handle("media-import:relink", ...);
ipcMain.handle("media-import:remove", ...);
```

**Related Files:**
- `electron/media-import-handler.ts` (NEW)
- `electron/main.ts` (register handler)

---

### Subtask 2: Add TypeScript Interfaces (15 min)

**File:** `apps/web/src/types/electron.d.ts`

```typescript
interface MediaImportOptions {
  sourcePath: string;
  projectId: string;
  mediaId: string;
  preferSymlink: boolean;
}

interface MediaImportResult {
  success: boolean;
  targetPath: string;
  importMethod: 'symlink' | 'copy';
  originalPath: string;
  error?: string;
}

interface MediaImportMetadata {
  importMethod: 'symlink' | 'copy';
  originalPath: string;
  importedAt: number;
  fileSize: number;
}
```

**File:** `apps/web/src/stores/media-store-types.ts`

```typescript
interface MediaItem {
  // ... existing fields
  importMetadata?: MediaImportMetadata;
}
```

**File:** `apps/web/src/lib/storage/types.ts`

```typescript
interface MediaFileData {
  // ... existing fields
  importMetadata?: MediaImportMetadata;
}
```

**Related Files:**
- `apps/web/src/types/electron.d.ts`
- `apps/web/src/stores/media-store-types.ts`
- `apps/web/src/lib/storage/types.ts`

---

### Subtask 3: Update Preload Script (15 min)

**File:** `electron/preload.ts`

```typescript
mediaImport: {
  import: (options: MediaImportOptions) =>
    ipcRenderer.invoke("media-import:import", options),
  validateSymlink: (path: string) =>
    ipcRenderer.invoke("media-import:validate-symlink", path),
  locateOriginal: (mediaPath: string) =>
    ipcRenderer.invoke("media-import:locate-original", mediaPath),
  relinkMedia: (mediaId: string, newSourcePath: string) =>
    ipcRenderer.invoke("media-import:relink", mediaId, newSourcePath),
  remove: (projectId: string, mediaId: string) =>
    ipcRenderer.invoke("media-import:remove", projectId, mediaId),
}
```

**Related Files:**
- `electron/preload.ts`

---

### Subtask 4: Register Handlers in Main Process (10 min)

**File:** `electron/main.ts`

```typescript
import { setupMediaImportIPC } from "./media-import-handler.js";

// In app.whenReady():
setupMediaImportIPC();
```

**Related Files:**
- `electron/main.ts`

---

### Subtask 5: Update Media Processing (30 min)

**File:** `apps/web/src/lib/media-processing.ts`

Add function to integrate hybrid import:

```typescript
async function importMediaToProject(
  file: File,
  sourcePath: string,
  projectId: string,
  mediaId: string
): Promise<{ localPath: string; importMetadata: MediaImportMetadata }> {
  // 1. Check if Electron API available
  // 2. Call window.electronAPI.mediaImport.import()
  // 3. Return result with metadata
}
```

Modify `processMediaFiles()` to:
1. Detect if running in Electron environment
2. For local file imports, call `importMediaToProject()`
3. Store `importMetadata` in the returned `ProcessedMediaItem`

**Related Files:**
- `apps/web/src/lib/media-processing.ts`

---

### Subtask 6: Update Storage Service (20 min)

**File:** `apps/web/src/lib/storage/storage-service.ts`

Update `saveMediaItem()`:
- Persist `importMetadata` to IndexedDB
- Skip OPFS storage for symlinked files (file data is on disk)

Update `loadMediaItem()`:
- Restore `importMetadata` from storage
- For symlinked files, read from disk path instead of OPFS

Update `deleteMediaItem()`:
- Check `importMetadata` for import method
- For symlinks: only remove the link, not the original
- For copies: remove the copied file

**Related Files:**
- `apps/web/src/lib/storage/storage-service.ts`

---

### Subtask 7: Update Media Store (20 min)

**File:** `apps/web/src/stores/media-store.ts`

Update `addMediaItem()`:
- Accept `importMetadata` in the item
- Pass metadata through to storage service

Update `removeMediaItem()`:
- Call proper cleanup based on `importMetadata`
- Handle symlink removal vs file deletion

**Related Files:**
- `apps/web/src/stores/media-store.ts`

---

### Subtask 8: Add Unit Tests (40 min)

**New File:** `apps/web/src/lib/__tests__/media-import.test.ts`

Test scenarios:
- Symlink creation on Windows (admin rights)
- Symlink fallback to copy (no admin rights)
- Cross-platform path handling
- Import metadata persistence
- Cleanup of symlinks vs copies
- Broken symlink detection
- Network drive handling

**File:** `apps/web/src/test/mocks/electron.ts`

Add mock for `mediaImport` API:

```typescript
mediaImport: {
  import: vi.fn().mockResolvedValue({
    success: true,
    targetPath: '/mock/path/media.mp4',
    importMethod: 'symlink',
    originalPath: '/original/path/media.mp4',
  }),
  validateSymlink: vi.fn().mockResolvedValue(true),
  locateOriginal: vi.fn().mockResolvedValue('/original/path'),
  relinkMedia: vi.fn().mockResolvedValue(true),
  remove: vi.fn().mockResolvedValue(undefined),
}
```

**Related Files:**
- `apps/web/src/lib/__tests__/media-import.test.ts` (NEW)
- `apps/web/src/test/mocks/electron.ts`

---

## Platform-Specific Considerations

### Windows
- Symlinks require admin rights or Developer Mode enabled
- Use `fs.symlink()` with `'file'` or `'junction'` type
- Fallback to `fs.copyFile()` on `EPERM` error
- Handle UNC paths for network drives

```typescript
// Windows symlink attempt
try {
  await fs.symlink(sourcePath, targetPath, 'file');
  return { method: 'symlink' };
} catch (error) {
  if (error.code === 'EPERM' || error.code === 'EACCES') {
    // Fallback to copy
    await fs.copyFile(sourcePath, targetPath);
    return { method: 'copy' };
  }
  throw error;
}
```

### macOS/Linux
- Symlinks work without elevated privileges
- Use `fs.symlink()` directly
- Handle cross-filesystem scenarios (fall back to copy)

### Cross-Platform Path Handling
- Normalize paths using `path.resolve()`
- Store original path with forward slashes in metadata
- Convert on read based on `process.platform`

---

## Time Estimates

| Subtask | Time | Dependencies |
|---------|------|--------------|
| 1. Electron Handler | 45 min | None |
| 2. Type Definitions | 15 min | None |
| 3. Preload Updates | 15 min | 1, 2 |
| 4. Main Process Registration | 10 min | 1 |
| 5. Media Processing | 30 min | 2, 3 |
| 6. Storage Service | 20 min | 2 |
| 7. Media Store | 20 min | 5, 6 |
| 8. Unit Tests | 40 min | All |
| **Total** | **~3.5 hours** | |

---

## Critical File Paths

| File | Purpose |
|------|---------|
| `electron/media-import-handler.ts` | NEW - Core symlink/copy logic |
| `electron/main.ts` | Register IPC handlers |
| `electron/preload.ts` | Expose API to renderer |
| `apps/web/src/types/electron.d.ts` | TypeScript interfaces |
| `apps/web/src/stores/media-store-types.ts` | MediaItem type extension |
| `apps/web/src/lib/storage/types.ts` | Storage type extension |
| `apps/web/src/lib/media-processing.ts` | Import integration |
| `apps/web/src/lib/storage/storage-service.ts` | Persistence logic |
| `apps/web/src/stores/media-store.ts` | State management |
| `apps/web/src/lib/__tests__/media-import.test.ts` | NEW - Unit tests |
| `apps/web/src/test/mocks/electron.ts` | Test mocks |

---

## Success Criteria

1. ✅ Media imports create symlinks when possible
2. ✅ Graceful fallback to copy when symlinks fail
3. ✅ Import metadata tracked in storage
4. ✅ Proper cleanup on media deletion
5. ✅ Broken symlink detection and re-linking
6. ✅ Cross-platform compatibility
7. ✅ Unit test coverage > 80%
8. ✅ No regression in existing import functionality

---

## Future Enhancements

1. **Settings UI** - User preference for symlink vs always copy
2. **Bulk re-link** - Re-link all broken symlinks at once
3. **Storage analytics** - Show space saved by symlinks
4. **Network drive detection** - Auto-detect and warn about network paths
