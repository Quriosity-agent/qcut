# Video Playback Issues Analysis

Based on console log analysis from `consolev1.md`.

---

## Problem Summary

The console log reveals **4 main categories of issues** that need to be fixed for video playback and export to work correctly:

1. **Blob URL Race Condition** - Blob URLs are created and revoked too quickly (0ms lifespan)
2. **Missing localPath for Export** - Videos have blob URLs but no filesystem path for FFmpeg export
3. **React Ref Warning** - Function component passed to Radix UI without forwardRef
4. **Duplicate Blob URL Creation** - Multiple blob URLs created for same file unnecessarily

---

## Issue 1: Blob URL Race Condition in VideoPlayer

### Problem
Blob URLs are being created and immediately revoked (0ms lifespan), causing `ERR_FILE_NOT_FOUND` errors.

### Evidence from Console Log
```
[VideoPlayer] Created blob URL for ecbb2587-d623-2eb2-109f-e8306a658615: blob:app://./0c6e6adb-7846-4a80-be55-7117fbaff60e
[VideoPlayer] Revoking blob URL for ecbb2587-d623-2eb2-109f-e8306a658615: blob:app://./0c6e6adb-7846-4a80-be55-7117fbaff60e
[BlobUrlDebug] Lifespan: 0ms
```

### Root Cause
In `video-player.tsx:161-194`, the cleanup function runs immediately after blob URL creation due to React's effect lifecycle when videoSource changes rapidly.

### Affected Files
- `apps/web/src/components/ui/video-player.tsx:161-194`

### Subtasks
1. [ ] **Add blob URL reference counting** - Track active uses before revoking
   - File: `apps/web/src/components/ui/video-player.tsx`
   - Add useRef to track if video element is still using the URL

2. [ ] **Delay cleanup until video element reports load/error**
   - File: `apps/web/src/components/ui/video-player.tsx`
   - Wait for `onLoadedData` or `onError` before allowing cleanup

3. [ ] **Use BlobManager instead of direct URL.createObjectURL**
   - File: `apps/web/src/components/ui/video-player.tsx:166`
   - Replace `URL.createObjectURL(videoSource.file)` with `blobManager.createObjectURL()`

---

## Issue 2: Missing localPath Causes Export Failure

### Problem
Export validation fails because media items have blob URLs (`blob:app://...`) but no `localPath` property, which is required for FFmpeg CLI export.

### Evidence from Console Log
```
[EXPORT VALIDATION] Some videos have blob URLs without local paths
```

### Root Cause Analysis

The export pipeline requires `localPath` (absolute filesystem path) for FFmpeg CLI to read video files directly. The issue occurs in this flow:

1. **Initial Import** (`media-processing.ts:165-201`): When a video is first imported, it IS saved to temp via `window.electronAPI.video.saveTemp()` and `localPath` IS set correctly.

2. **Storage Save** (`storage-service.ts:256-288`): When saving to IndexedDB/OPFS, `localPath` is NOT included in `MediaFileData` metadata - it's lost!

3. **Storage Load** (`storage-service.ts:290-374`): When loading from storage, `localPath` is never restored because it wasn't saved.

4. **Export Validation** (`export-analysis.ts:726-732`): Export fails because `mediaItem.localPath` is undefined.

### Data Flow Diagram
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Import Video   │────▶│  media-processing │────▶│  localPath SET  │
│  (File Upload)  │     │  saveTemp() ✓     │     │  (temp file)    │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  App Reload     │◀────│  storage-service │◀────│  localPath LOST │
│                 │     │  save() ✗        │     │  (not persisted)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Load from      │────▶│  storage-service │────▶│  localPath NULL │
│  IndexedDB      │     │  load()          │     │  (never restored)│
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Export Video   │────▶│  export-analysis │────▶│  VALIDATION FAIL│
│                 │     │  validateTimeline│     │  "blob URLs..."  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Affected Files

| File | Line(s) | Issue |
|------|---------|-------|
| `apps/web/src/lib/storage/storage-service.ts` | 272-285 | `MediaFileData` doesn't include `localPath` |
| `apps/web/src/lib/storage/types.ts` | ~15-30 | `MediaFileData` interface missing `localPath` |
| `apps/web/src/stores/media-store-types.ts` | 12 | `localPath` is optional but should be persisted |
| `apps/web/src/lib/export-analysis.ts` | 726-732 | Throws error when `localPath` missing |
| `apps/web/src/lib/export-engine-cli.ts` | 506-512 | `extractVideoSources()` skips videos without `localPath` |
| `apps/web/src/lib/media-processing.ts` | 165-201 | Sets `localPath` on initial import (works correctly) |

### Implementation Details

#### Current Code: storage-service.ts:272-285 (PROBLEM)
```typescript
// Save metadata to project-specific IndexedDB
const metadata: MediaFileData = {
  id: mediaItem.id,
  name: mediaItem.name,
  type: mediaItem.type,
  size: mediaItem.file.size,
  lastModified: mediaItem.file.lastModified,
  width: mediaItem.width,
  height: mediaItem.height,
  duration: mediaItem.duration,
  url: mediaItem.url?.startsWith("blob:") ? undefined : mediaItem.url,
  metadata: mediaItem.metadata,
  // ❌ localPath is NOT saved here!
};
```

#### Current Code: export-engine-cli.ts:506-512 (WHERE IT FAILS)
```typescript
// Check if we have a local path (required for direct copy)
if (!mediaItem.localPath) {
  debugWarn(
    `[CLIExportEngine] Video ${mediaItem.id} has no localPath, cannot use direct copy`
  );
  return; // ❌ Video skipped from export!
}
```

#### Current Code: export-analysis.ts:726-732 (VALIDATION ERROR)
```typescript
// Check for blob URLs without local paths
if (!allVideosHaveLocalPath) {
  console.error(
    "❌ [EXPORT VALIDATION] Some videos have blob URLs without local paths"
  );
  throw new ExportUnsupportedError("blob-urls"); // ❌ Export blocked!
}
```

### Subtasks

#### Subtask 2.1: Persist localPath in Storage Metadata ✅ IMPLEMENTED
**Priority: CRITICAL**
**File: `apps/web/src/lib/storage/storage-service.ts:285-286`**
**Status: COMPLETED**

Added `localPath` to the saved metadata in `saveMediaItem()`:
```typescript
const metadata: MediaFileData = {
  // ... existing fields ...
  // Persist localPath for FFmpeg CLI export (videos only)
  localPath: mediaItem.localPath,
};
```

---

#### Subtask 2.2: Restore localPath When Loading from Storage ✅ IMPLEMENTED
**Priority: CRITICAL**
**File: `apps/web/src/lib/storage/storage-service.ts:414-415`**
**Status: COMPLETED**

Added `localPath` to the returned MediaItem in `loadMediaItem()`:
```typescript
return {
  // ... existing fields ...
  // Restore localPath for FFmpeg CLI export
  localPath,
};
```

---

#### Subtask 2.3: Regenerate localPath for Legacy Data ✅ IMPLEMENTED
**Priority: HIGH**
**File: `apps/web/src/lib/storage/storage-service.ts:364-402`**
**Status: COMPLETED**

Added automatic regeneration of `localPath` for videos that don't have it (legacy data migration):
```typescript
// Regenerate localPath for videos that don't have it (legacy data migration)
let localPath = metadata.localPath;
if (
  metadata.type === "video" &&
  !localPath &&
  actualFile &&
  actualFile.size > 0
) {
  if (
    this.isElectronEnvironment() &&
    (window as any).electronAPI?.video?.saveTemp
  ) {
    try {
      debugLog(
        `[StorageService] Regenerating localPath for video: ${metadata.name}`
      );
      const arrayBuffer = await actualFile.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      localPath = await (window as any).electronAPI.video.saveTemp(
        uint8Array,
        metadata.name
      );

      // Update metadata with new localPath for future loads
      if (localPath) {
        metadata.localPath = localPath;
        await mediaMetadataAdapter.set(id, metadata);
        debugLog(
          `[StorageService] Regenerated and saved localPath: ${localPath}`
        );
      }
    } catch (error) {
      debugWarn(
        `[StorageService] Failed to regenerate localPath for ${metadata.name}:`,
        error
      );
    }
  }
}
```

---

#### Subtask 2.4: Create Export-Time Fallback in CLIExportEngine ✅ IMPLEMENTED
**Priority: MEDIUM**
**Files:**
- `apps/web/src/lib/export-engine-cli.ts:490-560` (`extractVideoSources()`)
- `apps/web/src/lib/export-engine-cli.ts:581-665` (`extractVideoInputPath()`)
**Status: COMPLETED**

Both methods now create temp files on-demand if `localPath` is missing:

**extractVideoSources()** - Changed to async and added fallback:
```typescript
private async extractVideoSources(): Promise<VideoSourceInput[]> {
  // ...
  // If no localPath, try to create temp file from File blob (export-time fallback)
  if (!localPath && mediaItem.file && mediaItem.file.size > 0) {
    if ((window as any).electronAPI?.video?.saveTemp) {
      try {
        const arrayBuffer = await mediaItem.file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        localPath = await (window as any).electronAPI.video.saveTemp(
          uint8Array,
          mediaItem.name,
          this.sessionId || undefined
        );
        debugLog(`[CLIExportEngine] Created temp file at export time: ${localPath}`);
      } catch (error) {
        debugWarn(`[CLIExportEngine] Failed to create temp file...`);
        continue;
      }
    }
  }
  // ...
}
```

**extractVideoInputPath()** - Changed to async with same fallback pattern for Mode 2 exports.

---

#### Subtask 2.5: Update MediaFileData Type Definition ✅ IMPLEMENTED
**Priority: CRITICAL**
**File: `apps/web/src/lib/storage/types.ts:23`**
**Status: COMPLETED**

Added `localPath` to the `MediaFileData` interface:
```typescript
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
  metadata?: Record<string, unknown>;
  localPath?: string; // Filesystem path for FFmpeg CLI export (videos only)
}
```

---

### Verification Steps

1. **Import new video** → Check `localPath` is set in media store
2. **Reload page** → Check `localPath` is preserved after reload
3. **Export video** → Should complete without "blob URLs" error
4. **Check console** → No "[EXPORT VALIDATION] Some videos have blob URLs" error

### Related Electron IPC Handlers

The `video:save-temp` handler already exists and works correctly:
- **File:** `electron/main.ts:417-435`
- **Handler:** `electron/video-temp-handler.ts` (via `require('./video-temp-handler.js')`)
- **Returns:** Absolute filesystem path (e.g., `C:\Users\...\qcut-temp\video-xxx.mp4`)

---

## Issue 3: React forwardRef Warning

### Problem
React warning about function components being given refs when using Radix UI Primitive.button with SlotClone.

### Evidence from Console Log
```
Warning: Function components cannot be given refs. Attempts to access this ref will fail.
Check the render method of `Primitive.button.SlotClone`.
```

### Root Cause
A component is being passed to Radix UI's `asChild` prop that doesn't use `forwardRef`. The warning trace points to editor components.

### Affected Files
- `apps/web/src/components/editor/preview-panel-components.tsx` (likely)
- Any component using Radix UI Button with `asChild` prop

### Subtasks
1. [ ] **Identify the component missing forwardRef**
   - Search for `asChild` usage in preview panel components
   - File: `apps/web/src/components/editor/preview-panel-components.tsx`

2. [ ] **Wrap component with React.forwardRef**
   - Modify the identified component to properly forward refs

3. [ ] **Add TypeScript type for forwarded ref**
   - Ensure proper typing with `React.ForwardedRef<HTMLButtonElement>`

---

## Issue 4: Excessive Blob URL Creation

### Problem
Multiple blob URLs are created for the same video file during different operations, leading to memory waste and potential issues.

### Evidence from Console Log
```
[BlobManager] Created: blob:app://./978a1bdd-... Source: storage-service
[BlobManager] Created: blob:app://./de66f6c3-... Source: processVideoFile
[BlobManager] Created: blob:app://./b96c5b17-... Source: getMediaDuration
[BlobManager] Created: blob:app://./0c6e6adb-... Source: at editor...
```
Same 22945987 byte file has 4+ different blob URLs created.

### Root Cause
Different services create their own blob URLs without checking if one already exists:
- `storage-service` creates blob URLs when loading media
- `processVideoFile` creates blob URLs for thumbnail generation
- `getMediaDuration` creates blob URLs for duration extraction
- `video-player.tsx` creates blob URLs for playback

### Affected Files
- `apps/web/src/lib/storage/storage-service.ts`
- `apps/web/src/stores/media-store.ts:242` (processVideoFile)
- `apps/web/src/stores/media-store.ts:174` (generateVideoThumbnailBrowser)
- `apps/web/src/components/ui/video-player.tsx:166`

### Subtasks
1. [ ] **Create centralized blob URL cache in BlobManager**
   - File: `apps/web/src/lib/blob-manager.ts`
   - Add method `getOrCreateObjectURL(file, source)` that returns existing URL if file already has one

2. [ ] **Add file identity check (by size + name hash)**
   - File: `apps/web/src/lib/blob-manager.ts`
   - Create unique key from file properties to detect same file

3. [ ] **Update all services to use cached blob URLs**
   - Files: `storage-service.ts`, `media-store.ts`, `video-player.tsx`
   - Replace direct `createObjectURL` calls with cached version

---

## Issue 5: Blob URL Cleanup Timing Issue

### Problem
`BlobUrlCleanup` clears blob URLs from media items, but then the system immediately recreates them, causing unnecessary churn.

### Evidence from Console Log
```
[BlobUrlCleanup] Cleared blob URL for media item: export_2025-11-24_23-01.mp4
[BlobUrlCleanup] Updated media item: export_2025-11-24_23-01.mp4
... then immediately ...
[BlobManager] Created: blob:app://./978a1bdd-... Source: storage-service
```

### Root Cause
The cleanup migration runs, then storage-service recreates blob URLs when re-accessing the media items.

### Affected Files
- `apps/web/src/components/providers/migrators/blob-url-cleanup.tsx`
- `apps/web/src/lib/storage/storage-service.ts`

### Subtasks
1. [ ] **Coordinate cleanup with storage service**
   - File: `apps/web/src/components/providers/migrators/blob-url-cleanup.tsx`
   - Set flag to prevent immediate recreation

2. [ ] **Add lazy blob URL creation**
   - File: `apps/web/src/lib/storage/storage-service.ts`
   - Only create blob URLs when actually needed for playback, not on load

---

## Priority Order for Fixes

1. **HIGH** - Issue 2 (localPath) - Blocks export functionality completely
2. **HIGH** - Issue 1 (Race condition) - Causes video playback failures
3. **MEDIUM** - Issue 4 (Duplicate URLs) - Memory waste, potential issues
4. **MEDIUM** - Issue 5 (Cleanup timing) - Performance/efficiency issue
5. **LOW** - Issue 3 (forwardRef) - Warning only, doesn't break functionality

---

## Testing Checklist

After fixes, verify:
- [ ] Videos play in preview panel without `ERR_FILE_NOT_FOUND`
- [ ] Export completes successfully with FFmpeg CLI
- [ ] No React ref warnings in console
- [ ] Blob URL count stays stable (check with `window.debugBlobs()`)
- [ ] Page reload preserves video playback ability
