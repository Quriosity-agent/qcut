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

## Issue 1: Blob URL Race Condition in VideoPlayer ✅ FIXED

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

**Current Code (PROBLEM):**
```typescript
// video-player.tsx:161-194
useEffect(() => {
  const video = videoRef.current;
  if (!video || !videoSource) return;

  if (videoSource.type === "file") {
    const blobUrl = URL.createObjectURL(videoSource.file);  // ❌ Direct URL creation
    blobUrlRef.current = blobUrl;
    video.src = blobUrl;
    console.log(`[VideoPlayer] Created blob URL for ${videoId ?? "video"}: ${blobUrl}`);

    return () => {
      if (blobUrlRef.current) {
        console.log(`[VideoPlayer] Revoking blob URL...`);
        URL.revokeObjectURL(blobUrlRef.current);  // ❌ Immediate revoke in cleanup
        blobUrlRef.current = null;
      }
    };
  }
  // ...
}, [videoSource, videoId]);  // ❌ Effect re-runs on every videoSource change
```

**Why This Happens:**
1. Component mounts, effect runs, blob URL created
2. Parent re-renders (e.g., playback state change)
3. React runs cleanup function (revokes blob URL)
4. React runs effect again (creates new blob URL)
5. Video element still loading from OLD blob URL → `ERR_FILE_NOT_FOUND`

### Affected Files
- `apps/web/src/components/ui/video-player.tsx:161-194`

### Subtasks

---

#### Subtask 1.1: Add Video Load State Tracking ✅ IMPLEMENTED
**Priority: CRITICAL**
**File: `apps/web/src/components/ui/video-player.tsx`**
**Status: COMPLETED**

Added refs to track whether the video has loaded successfully and pending cleanup URLs.

**Implementation (lines 33-35):**
```typescript
const blobUrlRef = useRef<string | null>(null);
const pendingCleanupRef = useRef<string | null>(null);
const videoLoadedRef = useRef(false);
```

---

#### Subtask 1.2: Delay Cleanup Until Video Load/Error ✅ IMPLEMENTED
**Priority: CRITICAL**
**File: `apps/web/src/components/ui/video-player.tsx:163-231`**
**Status: COMPLETED**

Modified the effect to not revoke blob URLs immediately. Instead, marks them for cleanup and only revokes when video source changes or component unmounts.

**Implementation - Replace lines 161-194:**
```typescript
// Video source tracking with delayed cleanup
useEffect(() => {
  const video = videoRef.current;
  if (!video || !videoSource) return;

  // Reset load state for new source
  videoLoadedRef.current = false;

  if (videoSource.type === "file") {
    // Clean up any pending blob URL from previous source AFTER new one is set
    const previousBlobUrl = pendingCleanupRef.current;

    const blobUrl = createObjectURL(videoSource.file, "VideoPlayer");
    blobUrlRef.current = blobUrl;
    video.src = blobUrl;

    console.log(`[VideoPlayer] Created blob URL for ${videoId ?? "video"}: ${blobUrl}`);

    // Now safe to revoke previous URL since new one is active
    if (previousBlobUrl && previousBlobUrl !== blobUrl) {
      console.log(`[VideoPlayer] Revoking previous blob URL: ${previousBlobUrl}`);
      revokeObjectURL(previousBlobUrl, "VideoPlayer-previous");
    }

    // Mark current URL for potential cleanup on unmount
    pendingCleanupRef.current = blobUrl;

    return () => {
      // DON'T revoke here - let the next effect iteration handle it
      // or component unmount cleanup
      console.log(`[VideoPlayer] Effect cleanup - blob URL marked for later cleanup: ${blobUrl}`);
    };
  }

  if (videoSource.type === "remote") {
    video.src = videoSource.src;
    // Clean up any pending blob URL when switching to remote
    if (pendingCleanupRef.current) {
      revokeObjectURL(pendingCleanupRef.current, "VideoPlayer-remote-switch");
      pendingCleanupRef.current = null;
    }
  }

  return () => {
    if (video) {
      video.src = "";
    }
  };
}, [videoSource, videoId]);

// Separate cleanup effect for component unmount
useEffect(() => {
  return () => {
    // Only revoke on actual component unmount
    if (pendingCleanupRef.current) {
      console.log(`[VideoPlayer] Component unmount - revoking: ${pendingCleanupRef.current}`);
      revokeObjectURL(pendingCleanupRef.current, "VideoPlayer-unmount");
      pendingCleanupRef.current = null;
    }
  };
}, []); // Empty deps = only runs on unmount
```

---

#### Subtask 1.3: Use BlobManager for Tracking ✅ IMPLEMENTED
**Priority: HIGH**
**File: `apps/web/src/components/ui/video-player.tsx`**
**Status: COMPLETED**

Imported and using the centralized BlobManager instead of direct URL.createObjectURL.

**Implementation - Add import at top of file:**
```typescript
import { createObjectURL, revokeObjectURL } from "@/lib/blob-manager";
```

**Benefits:**
- Automatic tracking of all blob URLs
- Lifespan logging in dev mode
- Prevention of double-revoke errors
- Memory leak detection via `window.debugBlobs()`

---

#### Subtask 1.4: Add Load/Error Event Handlers for Debugging ✅ IMPLEMENTED
**Priority: LOW**
**File: `apps/web/src/components/ui/video-player.tsx:249-269`**
**Status: COMPLETED**

Enhanced the existing event handlers to track load state and log useful debugging info.

**Implementation - Update event handlers:**
```typescript
onLoadedMetadata={(e) => {
  videoLoadedRef.current = true;
  console.log(`[VideoPlayer] ✅ Video loaded: ${videoId ?? "video"}`);
}}
onError={(e) => {
  const video = e.currentTarget;
  const errorCode = video.error?.code;
  const errorMessage = video.error?.message || "Unknown error";
  console.error(`[VideoPlayer] ❌ Video error for ${videoId ?? "video"}:`, {
    code: errorCode,
    message: errorMessage,
    src: video.src?.substring(0, 50) + "...",
    networkState: video.networkState,
    readyState: video.readyState,
  });
  videoLoadedRef.current = false;
}}
onCanPlay={() => {
  console.log(`[VideoPlayer] ▶️ Video ready to play: ${videoId ?? "video"}`);
}}
```

---

### Reviewer Notes
- Impact remains high: immediate cleanup in the effect is directly causing `ERR_FILE_NOT_FOUND` while the element still references the prior URL.
- Direction is correct: lean on BlobManager, delay revocation until load/error, and track the active URL per render.
- Multi-instance caution: if multiple players render the same file, make sure revocation keys are instance-scoped so one player can’t revoke another’s URL.
- Unmount hygiene: keep a final unmount revoke once the element is detached to avoid leaks.

---

### Alternative Solution: Stable Blob URL via File Identity

If the above solution doesn't fully resolve the issue, consider caching blob URLs by file identity.

**File: `apps/web/src/lib/blob-manager.ts`**
**Add method:**
```typescript
private fileUrlCache = new Map<string, string>();

/**
 * Get or create a blob URL for a file, reusing existing URL if file matches
 */
getOrCreateObjectURL(file: File | Blob, source?: string): string {
  // Create unique key from file properties
  const fileKey = `${file.size}-${(file as File).name || 'blob'}-${(file as File).lastModified || 0}`;

  const existingUrl = this.fileUrlCache.get(fileKey);
  if (existingUrl && this.blobs.has(existingUrl)) {
    console.log(`[BlobManager] ♻️ Reusing existing URL for file: ${fileKey}`);
    return existingUrl;
  }

  const url = this.createObjectURL(file, source);
  this.fileUrlCache.set(fileKey, url);
  return url;
}
```

---

### Verification Steps

1. **Check console for lifespan** - Should be > 0ms (ideally > 1000ms)
2. **Check for ERR_FILE_NOT_FOUND** - Should not appear during normal playback
3. **Run `window.debugBlobs()`** - Active count should be reasonable (< 10 for normal usage)
4. **Test rapid seeking** - Videos should continue playing without errors
5. **Test unmount/remount** - Blob URLs should be properly cleaned up

---

## Issue 2: Missing localPath Causes Export Failure ✅ FIXED

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

### Root Cause Analysis

The current `BlobManager` (`blob-manager.ts`) tracks blob URLs but **does not deduplicate** them. Each call to `createObjectURL()` creates a new blob URL, even for the same file.

**Current Flow for a Single Video File:**
```
┌───────────────────────────────────────────────────────────────────────┐
│                    SINGLE VIDEO FILE LOADING                           │
│                    (22.9 MB video file)                                │
└───────────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ storage-service │   │ processVideoFile│   │ getMediaDuration│
│ loadMediaItem() │   │ (thumbnail gen) │   │ (duration calc) │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘
         │                     │                     │
         ▼                     ▼                     ▼
   createObjectURL()    createObjectURL()    createObjectURL()
   blob:./978a1bdd      blob:./de66f6c3      blob:./b96c5b17
                                │
                                ▼
                    ┌─────────────────┐
                    │  VideoPlayer    │
                    │  (for playback) │
                    └────────┬────────┘
                             │
                             ▼
                       createObjectURL()
                       blob:./0c6e6adb

        RESULT: 4 blob URLs for same 22.9MB file = ~92MB memory overhead
```

### All Blob URL Creation Points in Codebase

| File | Line | Function | Purpose | Revokes? |
|------|------|----------|---------|----------|
| `storage-service.ts` | 334 | `loadMediaItem()` | Load media from storage | No |
| `media-store.ts` | 78 | `getImageDimensions()` | Get image size | Yes ✓ |
| `media-store.ts` | 242 | `generateVideoThumbnailBrowser()` | Thumbnail generation | Yes ✓ |
| `media-store.ts` | 310 | `getMediaDuration()` | Duration extraction | Yes (delayed) |
| `media-store.ts` | 483, 486 | `addMediaItem()` | Display URL | No |
| `video-player.tsx` | 175 | useEffect | Video playback | Yes (on unmount) |
| `ffmpeg-utils.ts` | 376-377 | `loadFFmpeg()` | FFmpeg WASM loading | No |
| `ffmpeg-utils.ts` | 557 | `generateThumbnail()` | FFmpeg thumbnail | No |
| `media-processing.ts` | 107, 280 | `processMediaFiles()` | Initial processing | No |
| `use-ai-generation.ts` | 1752, 2002, 2280 | AI video handling | AI video URLs | No |
| `timeline-store.ts` | 1509 | `addMedia()` | Timeline add | No |
| Many more... | | | | |

**Key Observation**: Files that create URLs for **temporary operations** (getImageDimensions, generateVideoThumbnailBrowser, getMediaDuration) do revoke properly. The problem is **permanent display URLs** created by multiple services.

### Current BlobManager Code (blob-manager.ts)

```typescript
class BlobManager {
  private blobs = new Map<string, BlobEntry>();  // Tracks by URL, not by file

  createObjectURL(file: File | Blob, source?: string): string {
    // ❌ ALWAYS creates new URL - no deduplication
    const url = URL.createObjectURL(file);
    this.blobs.set(url, { url, file, createdAt: Date.now(), source });
    return url;
  }
}
```

### Affected Files

| File | Line(s) | Role |
|------|---------|------|
| `apps/web/src/lib/blob-manager.ts` | 35-59 | Creates URLs without deduplication |
| `apps/web/src/lib/storage/storage-service.ts` | 334 | Creates URL on every load |
| `apps/web/src/stores/media-store.ts` | 78, 242, 310, 483, 486 | Multiple creation points |
| `apps/web/src/components/ui/video-player.tsx` | 175 | Creates for playback |
| `apps/web/src/lib/media-processing.ts` | 107, 280, 374 | Creates during processing |

### Subtasks

---

#### Subtask 4.1: Add File Identity Cache to BlobManager
**Priority: HIGH**
**File: `apps/web/src/lib/blob-manager.ts`**

Add a cache that maps file identity to existing blob URLs.

**Proposed Implementation:**
```typescript
interface BlobEntry {
  url: string;
  file: File | Blob;
  createdAt: number;
  source?: string;
  refCount: number;  // NEW: Track how many consumers are using this URL
}

class BlobManager {
  private blobs = new Map<string, BlobEntry>();
  private fileUrlCache = new Map<string, string>();  // NEW: file key -> URL

  /**
   * Generate unique key for a file based on its properties
   */
  private getFileKey(file: File | Blob): string {
    const name = (file as File).name || 'blob';
    const lastModified = (file as File).lastModified || 0;
    // Use size + name + lastModified as unique identifier
    return `${file.size}-${name}-${lastModified}`;
  }

  /**
   * Get existing URL for file if available, or create new one
   */
  getOrCreateObjectURL(file: File | Blob, source?: string): string {
    const fileKey = this.getFileKey(file);

    // Check if we already have a URL for this file
    const existingUrl = this.fileUrlCache.get(fileKey);
    if (existingUrl && this.blobs.has(existingUrl)) {
      const entry = this.blobs.get(existingUrl)!;
      entry.refCount++;

      if (import.meta.env.DEV) {
        console.log(`[BlobManager] ♻️ Reusing URL for ${(file as File).name || 'blob'}`);
        console.log(`  📍 Original source: ${entry.source}`);
        console.log(`  🔄 Requested by: ${source}`);
        console.log(`  📊 Ref count: ${entry.refCount}`);
      }

      return existingUrl;
    }

    // Create new URL
    const url = URL.createObjectURL(file);
    this.blobs.set(url, {
      url,
      file,
      createdAt: Date.now(),
      source,
      refCount: 1,
    });
    this.fileUrlCache.set(fileKey, url);

    if (import.meta.env.DEV) {
      console.log(`[BlobManager] 🟢 Created: ${url}`);
      console.log(`  📍 Source: ${source}`);
      console.log(`  📦 File key: ${fileKey}`);
    }

    return url;
  }

  /**
   * Original createObjectURL - still creates unique URL each time
   * Use getOrCreateObjectURL for deduplication
   */
  createObjectURL(file: File | Blob, source?: string): string {
    // Keep original behavior for backwards compatibility
    const url = URL.createObjectURL(file);
    this.blobs.set(url, {
      url,
      file,
      createdAt: Date.now(),
      source,
      refCount: 1,
    });
    return url;
  }

  /**
   * Release a reference to a blob URL
   * Only actually revokes when refCount reaches 0
   */
  releaseObjectURL(url: string, context?: string): boolean {
    const entry = this.blobs.get(url);
    if (!entry) {
      return false;
    }

    entry.refCount--;

    if (import.meta.env.DEV) {
      console.log(`[BlobManager] 📉 Released: ${url}`);
      console.log(`  📊 Remaining refs: ${entry.refCount}`);
    }

    if (entry.refCount <= 0) {
      // Actually revoke
      URL.revokeObjectURL(url);
      this.blobs.delete(url);

      // Remove from file cache
      const fileKey = this.getFileKey(entry.file);
      if (this.fileUrlCache.get(fileKey) === url) {
        this.fileUrlCache.delete(fileKey);
      }

      if (import.meta.env.DEV) {
        console.log(`[BlobManager] 🔴 Revoked (no refs): ${url}`);
      }
    }

    return true;
  }
}
```

---

#### Subtask 4.2: Export Cached URL Helper Function
**Priority: HIGH**
**File: `apps/web/src/lib/blob-manager.ts`**

Add convenience export for the cached version.

**Proposed Implementation:**
```typescript
// Convenience exports
export const createObjectURL = (file: File | Blob, source?: string): string => {
  return blobManager.createObjectURL(file, source);
};

// NEW: For long-lived URLs (display, playback)
export const getOrCreateObjectURL = (file: File | Blob, source?: string): string => {
  return blobManager.getOrCreateObjectURL(file, source);
};

// NEW: For releasing refs (instead of immediate revoke)
export const releaseObjectURL = (url: string, context?: string): boolean => {
  return blobManager.releaseObjectURL(url, context);
};

// Keep original for compatibility
export const revokeObjectURL = (url: string, context?: string): boolean => {
  return blobManager.revokeObjectURL(url, context);
};
```

---

#### Subtask 4.3: Update StorageService to Use Cached URLs
**Priority: HIGH**
**File: `apps/web/src/lib/storage/storage-service.ts:331-337`**

Replace `createObjectURL` with `getOrCreateObjectURL` for display URLs.

**Current Code:**
```typescript
} else {
  // Use blob URL for web environment or non-image files
  url = createObjectURL(file, "storage-service");
}
```

**Proposed Change:**
```typescript
import { getOrCreateObjectURL } from "@/lib/blob-manager";

} else {
  // Use cached blob URL to prevent duplicates
  url = getOrCreateObjectURL(file, "storage-service");
}
```

---

#### Subtask 4.4: Update VideoPlayer to Use Cached URLs
**Priority: HIGH**
**File: `apps/web/src/components/ui/video-player.tsx:175`**

Replace `createObjectURL` with `getOrCreateObjectURL` for playback.

**Current Code:**
```typescript
const blobUrl = createObjectURL(videoSource.file, "VideoPlayer");
```

**Proposed Change:**
```typescript
import { getOrCreateObjectURL, releaseObjectURL } from "@/lib/blob-manager";

const blobUrl = getOrCreateObjectURL(videoSource.file, "VideoPlayer");

// In cleanup:
releaseObjectURL(blobUrl, "VideoPlayer-cleanup");  // Decrements ref, only revokes if 0
```

---

#### Subtask 4.5: Update MediaStore Display URL Creation
**Priority: MEDIUM**
**File: `apps/web/src/stores/media-store.ts:483-486`**

Use cached URLs for display purposes in `addMediaItem`.

**Current Code:**
```typescript
} else {
  displayUrl = createObjectURL(file, "addMediaItem-display");
}
```

**Proposed Change:**
```typescript
} else {
  displayUrl = getOrCreateObjectURL(file, "addMediaItem-display");
}
```

---

#### Subtask 4.6: Keep Unique URLs for Temporary Operations
**Priority: LOW**

These functions should KEEP using `createObjectURL` (not cached) because they:
- Create temporary URLs
- Revoke them immediately after use
- Don't need deduplication

**Functions that should NOT change:**
- `getImageDimensions()` (line 78) - Creates and revokes immediately
- `generateVideoThumbnailBrowser()` (line 242) - Creates and revokes
- `getMediaDuration()` (line 310) - Creates and revokes with delay

---

### Decision Matrix: When to Use Each Method

| Use Case | Method | Why |
|----------|--------|-----|
| Display URL (long-lived) | `getOrCreateObjectURL()` | Deduplicate across services |
| Video playback | `getOrCreateObjectURL()` | May be same file as display |
| Temporary processing | `createObjectURL()` | Will be revoked immediately |
| Thumbnail generation | `createObjectURL()` | Temporary, revoked after |
| Duration extraction | `createObjectURL()` | Temporary, revoked after |
| Export/download | `createObjectURL()` | One-time use |

---

### Alternative: Simpler WeakMap-Based Cache

If File objects are the same instance (not copies), use WeakMap for automatic cleanup:

**File: `apps/web/src/lib/blob-manager.ts`**
```typescript
class BlobManager {
  private fileToUrl = new WeakMap<File | Blob, string>();

  getOrCreateObjectURL(file: File | Blob, source?: string): string {
    const existing = this.fileToUrl.get(file);
    if (existing && this.blobs.has(existing)) {
      return existing;
    }

    const url = URL.createObjectURL(file);
    this.fileToUrl.set(file, url);
    this.blobs.set(url, { url, file, createdAt: Date.now(), source, refCount: 1 });
    return url;
  }
}
```

**Pros:** Automatic cleanup when File is garbage collected
**Cons:** Only works if same File instance is passed (not copies)

---

### Verification Steps

1. **Import a video file** → Check console for blob URL creation
2. **Expected**: Only 1 blob URL for display (not 4)
3. **Run `window.debugBlobs()`**:
   - Before fix: 4+ URLs for same file
   - After fix: 1 URL with refCount > 1
4. **Memory check**: File size × URL count should decrease

### Impact Assessment

| Metric | Before Fix | After Fix |
|--------|------------|-----------|
| Blob URLs per video | 4+ | 1 |
| Memory overhead | ~4× file size | ~1× file size |
| Potential memory leak | High | Low |
| URL revocation complexity | Per-service | Centralized |

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

### Root Cause Analysis

The blob URL cleanup/recreation cycle happens because of this flow:

1. **App Start**: `BlobUrlCleanup` runs as a provider
2. **Cleanup Phase** (`blob-url-cleanup.tsx:59-104`):
   - Calls `storageService.loadAllMediaItems(projectId)` for each project
   - For each item, clears `item.url` if it's a blob URL
   - Calls `storageService.saveMediaItem(project.id, item)` to persist
3. **Immediate Recreation** (`storage-service.ts:331-337`):
   - `loadAllMediaItems()` calls `loadMediaItem()` for each item
   - `loadMediaItem()` **always** creates a blob URL at line 334: `url = createObjectURL(file, "storage-service")`
   - This happens even when the cleanup just cleared the URL

### Data Flow Diagram
```
┌─────────────────────────────────────────────────────────────────┐
│                       APP STARTUP                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  BlobUrlCleanup Provider (blob-url-cleanup.tsx)                  │
│  ─────────────────────────────────────────────────────────────  │
│  for each project:                                               │
│    mediaItems = storageService.loadAllMediaItems(projectId)      │
│    ↓                                                            │
│    [Storage creates blob URLs during load!]                      │
│    ↓                                                            │
│    for each item:                                                │
│      if item.url.startsWith("blob:"):                           │
│        item.url = undefined  ← Clear blob URL                   │
│        storageService.saveMediaItem(item)  ← Save cleared       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  MediaStore.loadProjectMedia (media-store.ts:609-680)           │
│  ─────────────────────────────────────────────────────────────  │
│  mediaItems = storageService.loadAllMediaItems(projectId)        │
│  ↓                                                              │
│  [Storage creates blob URLs AGAIN!]                              │
│  ↓                                                              │
│  for each video: processVideoFile(item.file)                    │
│  ↓                                                              │
│  [Creates ANOTHER blob URL in processVideoFile!]                 │
└─────────────────────────────────────────────────────────────────┘
```

**Result**: Same video file gets 2-3 blob URLs created within seconds of app startup.

### Affected Files

| File | Line(s) | Role in Issue |
|------|---------|---------------|
| `apps/web/src/components/providers/migrators/blob-url-cleanup.tsx` | 59-104 | Triggers load→clear→save cycle |
| `apps/web/src/lib/storage/storage-service.ts` | 331-337 | Always creates blob URL on load |
| `apps/web/src/stores/media-store.ts` | 614, 624 | Loads media then processes videos |
| `apps/web/src/stores/media-store.ts` | 242 | `processVideoFile` creates another blob URL |

### Current Code Analysis

#### BlobUrlCleanup (blob-url-cleanup.tsx:59-104)
```typescript
// Load ALL media items (creates blob URLs during load)
const mediaItems = await storageService.loadAllMediaItems(project.id);

for (const item of mediaItems) {
  // Check if URL is a blob URL
  if (item.url?.startsWith("blob:")) {
    // Item has a file, clear the blob URL and let it regenerate
    item.url = undefined;  // ❌ Clear the URL we just created
    needsUpdate = true;
  }

  if (needsUpdate && !shouldRemove) {
    await storageService.saveMediaItem(project.id, item);  // Save with cleared URL
  }
}
```

#### StorageService.loadMediaItem (storage-service.ts:331-337)
```typescript
if (file && file.size > 0) {
  // File exists with content
  actualFile = file;

  // ... image handling ...

  } else {
    // Use blob URL for web environment or non-image files
    // ❌ ALWAYS creates blob URL on every load
    url = createObjectURL(file, "storage-service");
  }
}
```

#### MediaStore.loadProjectMedia (media-store.ts:614-624)
```typescript
const mediaItems = await storageService.loadAllMediaItems(projectId);

// Process media items - creates MORE blob URLs
const updatedMediaItems = await Promise.all(
  mediaItems.map(async (item) => {
    if (item.type === "video" && item.file) {
      // ❌ processVideoFile creates ANOTHER blob URL at line 242
      const processResult = await processVideoFile(item.file);
      // ...
    }
  })
);
```

### Subtasks

---

#### Subtask 5.1: Add Lazy Blob URL Creation in StorageService
**Priority: HIGH**
**File: `apps/web/src/lib/storage/storage-service.ts:306-362`**

Change `loadMediaItem()` to NOT create blob URLs automatically. Instead, return `undefined` for URL and let consumers create blob URLs when needed.

**Proposed Change:**
```typescript
async loadMediaItem(projectId: string, id: string): Promise<MediaItem | null> {
  // ... existing loading code ...

  let url: string | undefined;
  let actualFile: File;

  if (file && file.size > 0) {
    actualFile = file;

    // In Electron, convert to data URL for images (better compatibility)
    if (this.isElectronEnvironment() && metadata.type === "image") {
      url = await this.fileToDataURL(file);
    } else {
      // DON'T create blob URL here - let consumer create when needed
      // Blob URLs should be created lazily by the component that needs playback
      url = undefined;
      debugLog(
        `[StorageService] Loaded file for ${metadata.name} without blob URL (lazy creation)`
      );
    }
  }
  // ... rest of method ...
}
```

**Why This Works:**
- Storage service returns `MediaItem` with `file` but no `url`
- VideoPlayer component creates blob URL only when it needs to play
- Cleanup doesn't trigger wasteful recreation cycle

---

#### Subtask 5.2: Update BlobUrlCleanup to Skip Unnecessary Saves
**Priority: MEDIUM**
**File: `apps/web/src/components/providers/migrators/blob-url-cleanup.tsx:59-104`**

Optimize cleanup to avoid loading/saving items that don't need changes.

**Proposed Change:**
```typescript
// Use metadata-only query if available to check for blob URLs
// before loading full media items
for (const project of projects) {
  const mediaItems = await storageService.loadAllMediaItems(project.id);

  for (const item of mediaItems) {
    // Only process items that actually have blob URLs persisted in storage
    // Note: item.url from loadMediaItem might be undefined now (lazy creation)
    // We need to check the stored metadata directly

    // Skip if URL is already undefined or not a blob URL
    if (!item.url || !item.url.startsWith("blob:")) {
      continue;
    }

    // Only clear and save if there's actually a blob URL to clear
    item.url = undefined;
    item.thumbnailUrl = undefined;
    await storageService.saveMediaItem(project.id, item);
    mediaItemsCleaned++;
  }
}
```

---

#### Subtask 5.3: Optimize processVideoFile to Reuse Existing Blob URLs
**Priority: MEDIUM**
**File: `apps/web/src/stores/media-store.ts:104-280`**

If the `MediaItem` already has a valid `url`, don't create a new blob URL in `processVideoFile`.

**Proposed Change in loadProjectMedia (line 620-662):**
```typescript
const updatedMediaItems = await Promise.all(
  mediaItems.map(async (item) => {
    if (item.type === "video" && item.file) {
      try {
        // Pass existing URL to avoid creating duplicates
        const processResult = await processVideoFile(item.file, item.url);

        return {
          ...item,
          // Only update URL if one was created during processing
          url: processResult.url || item.url,
          thumbnailUrl: processResult.thumbnailUrl || item.thumbnailUrl,
          // ... rest of fields
        };
      } catch (error) {
        // ... error handling
      }
    }
    return item;
  })
);
```

**Proposed Change in processVideoFile signature:**
```typescript
export const processVideoFile = async (file: File, existingUrl?: string) => {
  // ...

  // Reuse existing URL if provided
  const blobUrl = existingUrl || createObjectURL(file, "processVideoFile");

  // ... rest of processing

  // Only revoke if we created a new URL
  if (!existingUrl && blobUrl) {
    revokeObjectURL(blobUrl, "processVideoFile");
  }
};
```

---

#### Subtask 5.4: Add Skip Flag for Cleanup During Initial Load
**Priority: LOW**
**File: `apps/web/src/components/providers/migrators/blob-url-cleanup.tsx`**

Add a flag to indicate cleanup is running, so storage service can skip blob URL creation.

**Proposed Change - Add context or global flag:**
```typescript
// At module level
let isCleanupRunning = false;

export function isCleanupInProgress(): boolean {
  return isCleanupRunning;
}

// In cleanupBlobUrls function:
const cleanupBlobUrls = async () => {
  isCleanupRunning = true;
  try {
    // ... cleanup logic
  } finally {
    isCleanupRunning = false;
  }
};
```

**In storage-service.ts:**
```typescript
import { isCleanupInProgress } from "@/components/providers/migrators/blob-url-cleanup";

// In loadMediaItem:
if (file && file.size > 0) {
  actualFile = file;

  if (!isCleanupInProgress()) {
    // Only create blob URL if not during cleanup
    url = createObjectURL(file, "storage-service");
  }
}
```

---

### Alternative Solution: Deferred Blob URL Creation Pattern

Instead of creating blob URLs at load time, implement a getter pattern:

**File: `apps/web/src/stores/media-store-types.ts`**
```typescript
export interface MediaItem {
  // ... existing fields ...

  // New: Lazily get or create blob URL
  getDisplayUrl(): string;

  // Internal: Cached blob URL (not persisted)
  _cachedBlobUrl?: string;
}
```

**File: `apps/web/src/stores/media-store.ts`**
```typescript
// Helper to add lazy URL getter
function withLazyUrl(item: MediaItem): MediaItem {
  return {
    ...item,
    getDisplayUrl() {
      if (!this._cachedBlobUrl && this.file && this.file.size > 0) {
        this._cachedBlobUrl = createObjectURL(this.file, "lazy-media-url");
      }
      return this._cachedBlobUrl || this.url || "";
    }
  };
}
```

---

### Verification Steps

1. **App startup** → Check console for blob URL creation count
2. **Expected**: Each video should have at most 1 blob URL created
3. **Run `window.debugBlobs()`** → Active count should equal number of displayed videos
4. **Reload page** → No "cleanup" followed by immediate "created" logs for same file

### Impact Assessment

| Metric | Before Fix | After Fix |
|--------|------------|-----------|
| Blob URLs per video on load | 2-3 | 1 |
| Storage reads during cleanup | N media items | N media items (unchanged) |
| Storage writes during cleanup | N media items | 0-few (only actual blob URLs) |
| Memory usage | Higher (duplicate URLs) | Lower (single URL per media) |

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
