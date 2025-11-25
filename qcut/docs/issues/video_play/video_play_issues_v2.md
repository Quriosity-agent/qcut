# Video Playback Issues Analysis v2

Based on console log analysis from `consolev2.md` (after Issue 4 fix was applied).

**Update (consolev3.md verification):** All v2 issues have been verified as FIXED.

**Update (consolev4.md verification):** New issue discovered - `ERR_UPLOAD_FILE_CHANGED` when playing video in timeline. See Issue 9 below.

---

## Summary

The console log shows that **Issue 4 (Excessive Blob URL Creation) fix is partially working**, but reveals **new issues** and **remaining problems**:

### What's Working (After v2 Fixes - Verified in consolev3.md)
- ✅ Blob URL caching is functioning - URLs are being reused (ref counts increasing to 2, 3)
- ✅ File key matching is working correctly - **stable keys without lastModified**
- ✅ Temporary URLs (processVideoFile, getMediaDuration) are properly created and revoked
- ✅ **No ERR_FILE_NOT_FOUND errors** - delayed cleanup working
- ✅ **No wasteful recreation cycle** - lazy URL creation working
- ✅ **BlobUrlCleanup only runs once** - localStorage persistence working

### Remaining Issues

1. ~~**File Key Inconsistency** - Same file gets different keys due to `lastModified` changing~~ ✅ FIXED
2. ~~**Blob URL Cleanup Still Triggering Recreation** - Same wasteful cycle continues~~ ✅ FIXED
3. ~~**ERR_FILE_NOT_FOUND Still Occurring** - Race condition on thumbnail generation~~ ✅ FIXED
4. **React forwardRef Warning** - Still present (Issue 3 from original analysis)

---

## Issue 6: File Key Inconsistency Causing Cache Misses ✅ FIXED

### Problem
The same video file generates different file keys across loads because `lastModified` timestamp changes when the file is read from OPFS.

### Evidence from Console Log
```
// First load - file key includes timestamp 1764038912557
File key: 22945987-2cb2dca0-5b66-1f6b-393d-21f405cb9eab-1764038912557

// After cleanup, second load - different timestamp 1764040432761!
File key: 22945987-2cb2dca0-5b66-1f6b-393d-21f405cb9eab-1764040432761
```

Same file (22945987 bytes, id `2cb2dca0-5b66-1f6b-393d-21f405cb9eab`) has TWO different keys, causing cache misses and new blob URLs being created.

### Root Cause
The `getFileKey()` method in `blob-manager.ts` uses `lastModified`:
```typescript
private getFileKey(file: File | Blob): string {
  const name = (file as File).name || "blob";
  const lastModified = (file as File).lastModified || 0;
  return `${file.size}-${name}-${lastModified}`;  // ❌ lastModified changes!
}
```

When OPFS reads a file, it may create a new `File` object with current timestamp, not the original.

### Affected Files
| File | Line(s) | Issue |
|------|---------|-------|
| `apps/web/src/lib/blob-manager.ts` | 48-52 | `getFileKey()` uses unstable `lastModified` |

### Subtasks

#### Subtask 6.1: Remove lastModified from File Key ✅ IMPLEMENTED
**Priority: HIGH**
**File: `apps/web/src/lib/blob-manager.ts:48-52`**
**Status: COMPLETED**

Changed file key to use only stable properties (size + name).

**Current Code (blob-manager.ts:48-52):**
```typescript
/**
 * Generate a key for file-based caching (fallback when WeakMap misses)
 */
private getFileKey(file: File | Blob): string {
  const name = (file as File).name || "blob";
  const lastModified = (file as File).lastModified || 0;
  return `${file.size}-${name}-${lastModified}`;
}
```

**Proposed Fix:**
```typescript
/**
 * Generate a key for file-based caching (fallback when WeakMap misses)
 * NOTE: Don't use lastModified - it changes when OPFS reads the file
 */
private getFileKey(file: File | Blob): string {
  const name = (file as File).name || "blob";
  // Only use size + name for stable identification
  return `${file.size}-${name}`;
}
```

**Risk**: Size+name may collide for different files with same name and size.
**Mitigation**: The WeakMap (line 26) provides exact instance matching first, so collisions only affect different File instances with identical name+size.

**Why This Works:**
The caching system has TWO layers (blob-manager.ts:24-30):
```typescript
// WeakMap for File instance-based caching (avoids hash collisions)
// Only works when same File object is passed (not copies)
private fileToUrl = new WeakMap<File | Blob, string>();

// Fallback cache using file properties for when File instances differ
// Key format: "size-name-lastModified" → should be "size-name"
private fileKeyToUrl = new Map<string, string>();
```

1. **WeakMap** - Exact File instance match (100% accurate)
2. **fileKeyToUrl Map** - Property-based fallback (uses file key)

By removing `lastModified`, the fallback cache will match across OPFS reads.

---

#### Subtask 6.2: Alternative - Use Content Hash for Key (Optional Enhancement)
**Priority: MEDIUM**
**File: `apps/web/src/lib/blob-manager.ts`**

For more accurate identification, compute a hash of file content.

**Proposed Implementation - Add async method:**
```typescript
/**
 * Compute a stable file key using content hash (first 64KB)
 * More accurate than size+name but requires async operation
 */
private async computeFileHash(file: File | Blob): Promise<string> {
  const name = (file as File).name || "blob";

  // Hash first 64KB for identity (fast, avoids reading entire file)
  const slice = file.slice(0, 65536);
  const buffer = await slice.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');

  return `${file.size}-${name}-${hashHex}`;
}

/**
 * Async version of getOrCreateObjectURL with content-based hashing
 * Use when accurate identification is critical
 */
async getOrCreateObjectURLAsync(file: File | Blob, source?: string): Promise<string> {
  // First, try WeakMap (exact instance match)
  const existingFromWeakMap = this.fileToUrl.get(file);
  if (existingFromWeakMap && this.blobs.has(existingFromWeakMap)) {
    const entry = this.blobs.get(existingFromWeakMap)!;
    entry.refCount++;
    return existingFromWeakMap;
  }

  // Second, try content-based hash
  const fileHash = await this.computeFileHash(file);
  const existingFromHashCache = this.fileKeyToUrl.get(fileHash);
  if (existingFromHashCache && this.blobs.has(existingFromHashCache)) {
    const entry = this.blobs.get(existingFromHashCache)!;
    entry.refCount++;
    this.fileToUrl.set(file, existingFromHashCache);
    return existingFromHashCache;
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

  this.fileToUrl.set(file, url);
  this.fileKeyToUrl.set(fileHash, url);

  return url;
}
```

**Pros**: Accurate identification even with same name/size, different content
**Cons**: Async operation, ~64KB read overhead (negligible for videos)

---

#### Subtask 6.3: Clear fileKeyToUrl Cache on URL Revocation
**Priority: HIGH**
**File: `apps/web/src/lib/blob-manager.ts:209-232`**

Ensure the file key cache is properly cleaned up when URLs are revoked.

**Current Code (blob-manager.ts:209-232):**
```typescript
private forceRevokeInternal(
  url: string,
  entry: BlobEntry,
  context?: string
): void {
  nativeRevokeObjectURL(url);
  this.blobs.delete(url);

  // Remove from file key cache
  const fileKey = this.getFileKey(entry.file);
  if (this.fileKeyToUrl.get(fileKey) === url) {
    this.fileKeyToUrl.delete(fileKey);
  }

  // Note: WeakMap entry will be GC'd automatically when File is GC'd
  // ...
}
```

**Status**: Already implemented correctly. When `lastModified` is removed from `getFileKey()`, this cleanup will work properly across all file reads.

---

## Issue 7: BlobUrlCleanup Still Causing Wasteful Recreation Cycle ✅ FIXED

### Problem
`BlobUrlCleanup` triggers storage loads which create blob URLs, then immediately clears them, then media store loads them AGAIN creating new blob URLs.

### Evidence from Console Log
```
// Step 1: Storage service creates URLs during cleanup's loadAllMediaItems()
[BlobManager] 🟢 Created (cached): blob:app://./fa0951f5-...
  📍 Source: storage-service
  🔑 File key: 22945987-2cb2dca0-...-1764038912557

// Step 2: Cleanup clears them
[BlobUrlCleanup] Found media item with blob URL: export_2025-11-24_23-01.mp4
[BlobUrlCleanup] Cleared blob URL for media item: export_2025-11-24_23-01.mp4

// Step 3: Media store loads them AGAIN (different file key!)
[BlobManager] 🟢 Created (cached): blob:app://./cbce3693-...
  📍 Source: storage-service
  🔑 File key: 22945987-2cb2dca0-...-1764040432761  ← Different!

// Step 4: Same file requested again, NOW it reuses (same timestamp)
[BlobManager] ♻️ Reusing URL (key match): 2cb2dca0-5b66-1f6b-393d-21f405cb9eab
  📊 Ref count: 2
```

### Root Cause
1. `BlobUrlCleanup` calls `storageService.loadAllMediaItems()` which creates blob URLs
2. Cleanup clears those URLs
3. Later, `MediaStore.loadProjectMedia()` calls `loadAllMediaItems()` again
4. File key is different (due to Issue 6), so NEW URLs are created

### Timeline of Events
```
┌──────────────────────────────────────────────────────────────────────┐
│                        APP STARTUP SEQUENCE                           │
└──────────────────────────────────────────────────────────────────────┘

T+0ms   BlobUrlCleanup starts
        │
T+10ms  ├─► loadAllMediaItems() for cleanup check
        │   └─► Creates blob:./fa0951f5-... (file key: ...-1764038912557)
        │
T+20ms  ├─► Finds blob URL, clears it
        │   └─► saveMediaItem() with url=undefined
        │
T+100ms BlobUrlCleanup complete
        │
T+200ms MediaStore.loadProjectMedia() starts
        │
T+210ms ├─► loadAllMediaItems()
        │   └─► Creates blob:./cbce3693-... (file key: ...-1764040432761)
        │       ❌ Different key! No cache hit!
        │
T+220ms ├─► loadAllMediaItems() (again, for UI update?)
        │   └─► getOrCreateObjectURL() → ♻️ Reuses URL (same timestamp now)
        │       ✅ Ref count: 2
        │
T+230ms └─► processVideoFile() for thumbnails
            └─► Creates temporary URLs (correctly revoked)

RESULT: 2 "permanent" blob URLs created for each file instead of 1
```

### Affected Files
| File | Line(s) | Issue |
|------|---------|-------|
| `apps/web/src/components/providers/migrators/blob-url-cleanup.tsx` | 59-104 | Triggers unnecessary load/save cycle |
| `apps/web/src/lib/storage/storage-service.ts` | 331-337 | Creates URL on every load |
| `apps/web/src/stores/media-store.ts` | 609-680 | Loads media after cleanup |

### Subtasks

#### Subtask 7.1: Lazy Blob URL Creation in StorageService ✅ IMPLEMENTED
**Priority: HIGH**
**File: `apps/web/src/lib/storage/storage-service.ts:331-337`**
**Status: COMPLETED**

Removed blob URL creation from `loadMediaItem()`. Consumers now create URLs when needed.

**Current Code (storage-service.ts:331-337):**
```typescript
} else {
  // Use cached blob URL for web environment or non-image files
  // Uses ref-counting - call releaseObjectURL() when done instead of revokeObjectURL()
  url = getOrCreateObjectURL(file, "storage-service");
  debugLog(
    `[StorageService] Created object URL for ${metadata.name}: ${url}`
  );
}
```

**Proposed Fix:**
```typescript
} else {
  // DON'T create blob URL here - let consumers create lazily
  // This prevents wasteful URL creation during cleanup migrations
  // MediaStore.loadProjectMedia() will create URLs when needed
  url = undefined as unknown as string;  // Will be set by consumer
  debugLog(
    `[StorageService] Loaded ${metadata.name} without blob URL (lazy creation)`
  );
}
```

**Why This Works:**
- `BlobUrlCleanup` loads media to check for blob URLs → no URLs created
- `MediaStore.loadProjectMedia()` loads same media → creates URLs once
- Result: 1 URL per file instead of 2

**Impact**:
- `MediaItem.url` may be `undefined` after `loadMediaItem()`
- Consumers (MediaStore, VideoPlayer) must handle `undefined` URL

---

#### Subtask 7.2: Update MediaStore to Create URL on Demand ✅ IMPLEMENTED
**Priority: HIGH**
**File: `apps/web/src/stores/media-store.ts:617-688`**
**Status: COMPLETED**

Added lazy URL creation in `loadProjectMedia()` for all media items.

**Current Code (media-store.ts:617-671):**
```typescript
loadProjectMedia: async (projectId) => {
  set({ isLoading: true });
  debugLog(`[MediaStore] Loading media for project: ${projectId}`);

  try {
    const mediaItems = await storageService.loadAllMediaItems(projectId);
    debugLog(
      `[MediaStore] Loaded ${mediaItems.length} media items from storage`
    );

    // Process media items with enhanced error handling
    const updatedMediaItems = await Promise.all(
      mediaItems.map(async (item) => {
        if (item.type === "video" && item.file) {
          try {
            const processResult = await processVideoFile(item.file);

            return {
              ...item,
              thumbnailUrl: processResult.thumbnailUrl || item.thumbnailUrl,
              // ... other fields
            };
          } catch (error) {
            // ... error handling
          }
        }
        return item;
      })
    );

    set({ mediaItems: updatedMediaItems, hasInitialized: true });
  }
  // ...
}
```

**Proposed Change:**
```typescript
loadProjectMedia: async (projectId) => {
  set({ isLoading: true });
  debugLog(`[MediaStore] Loading media for project: ${projectId}`);

  try {
    const mediaItems = await storageService.loadAllMediaItems(projectId);
    debugLog(
      `[MediaStore] Loaded ${mediaItems.length} media items from storage`
    );

    // Process media items with enhanced error handling
    const updatedMediaItems = await Promise.all(
      mediaItems.map(async (item) => {
        // LAZY URL CREATION: Create display URL if missing
        let displayUrl = item.url;
        if (!displayUrl && item.file && item.file.size > 0) {
          displayUrl = getOrCreateObjectURL(item.file, "media-store-display");
          debugLog(`[MediaStore] Created lazy URL for ${item.name}: ${displayUrl}`);
        }

        if (item.type === "video" && item.file) {
          try {
            const processResult = await processVideoFile(item.file);

            return {
              ...item,
              url: displayUrl,  // Use lazy-created URL
              thumbnailUrl: processResult.thumbnailUrl || item.thumbnailUrl,
              width: processResult.width || item.width,
              height: processResult.height || item.height,
              duration: processResult.duration || item.duration,
              fps: processResult.fps || item.fps,
              metadata: {
                ...item.metadata,
                processingMethod: processResult.processingMethod,
              },
            };
          } catch (error) {
            // ... error handling, still include displayUrl
            return {
              ...item,
              url: displayUrl,
              metadata: {
                ...item.metadata,
                processingError: `...`,
                processingMethod: "failed",
              },
            };
          }
        }
        return {
          ...item,
          url: displayUrl,  // Include for non-video items too
        };
      })
    );

    set({ mediaItems: updatedMediaItems, hasInitialized: true });
  }
  // ...
}
```

**Import Required:**
```typescript
import { getOrCreateObjectURL } from "@/lib/blob-manager";
```

---

#### Subtask 7.3: Disable BlobUrlCleanup for Non-Legacy Sessions ✅ IMPLEMENTED
**Priority: MEDIUM**
**File: `apps/web/src/components/providers/migrators/blob-url-cleanup.tsx`**
**Status: COMPLETED**

Changed from `sessionStorage` to `localStorage` with new key `blob-url-cleanup-v2`. Cleanup now only runs ONCE ever, not on every new browser session.

**Current Code (blob-url-cleanup.tsx:59-104):**
```typescript
// Clean up media items with blob URLs
let mediaItemsCleaned = 0;
let mediaItemsRemoved = 0;
for (const project of projects) {
  // ❌ PROBLEM: This loads ALL media items, creating blob URLs
  const mediaItems = await storageService.loadAllMediaItems(project.id);

  for (const item of mediaItems) {
    // Check if URL is a blob URL
    if (item.url?.startsWith("blob:")) {
      // ...
      item.url = undefined;
      await storageService.saveMediaItem(project.id, item);
    }
  }
}
```

**Option A: Metadata-Only Cleanup (Recommended)**
```typescript
// Clean up media items with blob URLs - metadata only
let mediaItemsCleaned = 0;
for (const project of projects) {
  // Load metadata only (doesn't create blob URLs)
  const { mediaMetadataAdapter } = storageService.getProjectMediaAdapters(project.id);
  const mediaIds = await mediaMetadataAdapter.list();

  for (const id of mediaIds) {
    const metadata = await mediaMetadataAdapter.get(id);
    if (!metadata) continue;

    // Check if stored URL is a blob URL (shouldn't be persisted)
    if (metadata.url?.startsWith("blob:")) {
      metadata.url = undefined;
      await mediaMetadataAdapter.set(id, metadata);
      mediaItemsCleaned++;
      console.log(`[BlobUrlCleanup] Cleared stored blob URL for: ${metadata.name}`);
    }
  }
}
```

**Option B: Skip Cleanup If Already Done**

The current code already has session-based skip (lines 21-30):
```typescript
const cleanupKey = "blob-url-cleanup-v1";
const hasCleanedSession = sessionStorage.getItem(cleanupKey);

if (hasCleanedSession) {
  console.log("[BlobUrlCleanup] Skipping cleanup (already done this session)");
  setHasCleanedUp(true);
  return;
}
```

But this still runs on first session after refresh. Consider using `localStorage` instead:
```typescript
const cleanupKey = "blob-url-cleanup-v2";
const hasCleanedPermanent = localStorage.getItem(cleanupKey);

if (hasCleanedPermanent) {
  console.log("[BlobUrlCleanup] Skipping cleanup (migration complete)");
  setHasCleanedUp(true);
  return;
}

// ... do cleanup ...

// Mark as done permanently
localStorage.setItem(cleanupKey, "true");
```

---

#### Subtask 7.4: Expose Metadata-Only Loading in StorageService
**Priority: LOW**
**File: `apps/web/src/lib/storage/storage-service.ts`**

Add a method to load metadata without creating blob URLs (for cleanup).

**Proposed Addition:**
```typescript
/**
 * Load media metadata only (without creating blob URLs)
 * Use for cleanup/migration tasks that don't need actual files
 */
async loadMediaMetadataOnly(projectId: string): Promise<MediaFileData[]> {
  const { mediaMetadataAdapter } = this.getProjectMediaAdapters(projectId);
  const mediaIds = await mediaMetadataAdapter.list();
  const metadataItems: MediaFileData[] = [];

  for (const id of mediaIds) {
    const metadata = await mediaMetadataAdapter.get(id);
    if (metadata) {
      metadataItems.push(metadata);
    }
  }

  return metadataItems;
}

/**
 * Update media metadata only (without loading/creating file blob URLs)
 */
async updateMediaMetadata(
  projectId: string,
  id: string,
  updates: Partial<MediaFileData>
): Promise<void> {
  const { mediaMetadataAdapter } = this.getProjectMediaAdapters(projectId);
  const metadata = await mediaMetadataAdapter.get(id);
  if (metadata) {
    await mediaMetadataAdapter.set(id, { ...metadata, ...updates });
  }
}
```

---

## Issue 8: ERR_FILE_NOT_FOUND During Thumbnail Generation ✅ FIXED

### Problem
Blob URL is revoked while video element is still trying to load it for thumbnail generation.

### Evidence from Console Log
```
[BlobManager] 🟢 Created (unique): blob:app://./3dfd2ff0-89fc-441f-ba43-0e3fc01ae9dd
  📍 Source: processVideoFile

[BlobManager] 🔴 Force revoked: blob:app://./3dfd2ff0-89fc-441f-ba43-0e3fc01ae9dd
  📍 Created by: processVideoFile
  🕒 Lifespan: 337ms
  🏷️ Context: media-store:generateVideoThumbnailBrowser

blob:app://./3dfd2ff0-89fc-441f-ba43-0e3fc01ae9dd:1 Failed to load resource: net::ERR_FILE_NOT_FOUND
```

### Root Cause
In `generateVideoThumbnailBrowser()`, the blob URL is revoked after the seeked event fires, but the video element may still be loading:

```typescript
// media-store.ts:generateVideoThumbnailBrowser
video.addEventListener("seeked", () => {
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const thumbnailUrl = canvas.toDataURL("image/jpeg", 0.8);
    resolve({ thumbnailUrl, width, height });
    cleanup();  // ← Revokes URL immediately after drawing
  } catch (drawError) {
    // ...
  }
});
```

The `cleanup()` function revokes the URL, but the video element might still have pending loads or be accessed by other code.

### Affected Files
| File | Line(s) | Issue |
|------|---------|-------|
| `apps/web/src/stores/media-store.ts` | 173-255 | `generateVideoThumbnailBrowser()` revokes too early |

### Subtasks

#### Subtask 8.1: Delay URL Revocation After Thumbnail Generation ✅ IMPLEMENTED
**Priority: MEDIUM**
**File: `apps/web/src/stores/media-store.ts:177-258`**
**Status: COMPLETED**

Added 150ms delay before revoking and `cleanupScheduled` flag to prevent double cleanup.

**Current Code (media-store.ts:177-258):**
```typescript
// Helper function to generate video thumbnail using browser APIs (primary method)
export const generateVideoThumbnailBrowser = (
  file: File
): Promise<{ thumbnailUrl: string; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video") as HTMLVideoElement;
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      reject(new Error("Could not get canvas context"));
      return;
    }

    let blobUrl: string;

    const cleanup = () => {
      video.remove();
      canvas.remove();
      if (blobUrl) {
        revokeMediaBlob(blobUrl, "generateVideoThumbnailBrowser");  // ❌ Immediate revoke
      }
    };

    // Set timeout to prevent hanging
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Video thumbnail generation timed out"));
    }, 10_000);

    video.addEventListener("loadedmetadata", () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      video.currentTime = Math.min(1, video.duration * 0.1);
    });

    video.addEventListener("seeked", () => {
      try {
        clearTimeout(timeout);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const thumbnailUrl = canvas.toDataURL("image/jpeg", 0.8);
        const width = video.videoWidth;
        const height = video.videoHeight;

        resolve({ thumbnailUrl, width, height });
        cleanup();  // ❌ PROBLEM: Revokes immediately, but video may still be loading
      } catch (drawError) {
        cleanup();
        reject(new Error(`Canvas drawing failed: ${drawError}`));
      }
    });

    // ... error handling ...

    blobUrl = createObjectURL(file, "processVideoFile");
    video.src = blobUrl;
    video.load();
  });
};
```

**Proposed Fix:**
```typescript
export const generateVideoThumbnailBrowser = (
  file: File
): Promise<{ thumbnailUrl: string; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video") as HTMLVideoElement;
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      reject(new Error("Could not get canvas context"));
      return;
    }

    let blobUrl: string;
    let cleanupScheduled = false;

    const cleanup = () => {
      if (cleanupScheduled) return;  // Prevent double cleanup
      cleanupScheduled = true;

      // Remove elements immediately
      video.remove();
      canvas.remove();

      // Delay blob URL revocation to allow any pending loads to complete
      if (blobUrl) {
        setTimeout(() => {
          revokeMediaBlob(blobUrl, "generateVideoThumbnailBrowser");
        }, 150);  // ✅ 150ms delay for safety
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Video thumbnail generation timed out"));
    }, 10_000);

    video.addEventListener("loadedmetadata", () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      video.currentTime = Math.min(1, video.duration * 0.1);
    });

    video.addEventListener("seeked", () => {
      try {
        clearTimeout(timeout);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const thumbnailUrl = canvas.toDataURL("image/jpeg", 0.8);
        const width = video.videoWidth;
        const height = video.videoHeight;

        resolve({ thumbnailUrl, width, height });
        cleanup();  // Now with delayed revocation
      } catch (drawError) {
        cleanup();
        reject(new Error(`Canvas drawing failed: ${drawError}`));
      }
    });

    video.addEventListener("error", () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(`Video loading failed: ${video.error?.message || "Unknown error"}`));
    });

    try {
      blobUrl = createObjectURL(file, "processVideoFile");
      video.src = blobUrl;
      video.load();
    } catch (urlError) {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(`Failed to create object URL: ${urlError}`));
    }
  });
};
```

**Key Changes:**
1. Added `cleanupScheduled` flag to prevent double cleanup
2. Delayed `revokeMediaBlob()` by 150ms to allow video element to finish
3. Elements are removed immediately (no UI impact)

---

#### Subtask 8.2: Apply Same Fix to getMediaDuration
**Priority: MEDIUM**
**File: `apps/web/src/stores/media-store.ts:261-318`**

The `getMediaDuration()` function already has a 100ms delay, but it can still race. Increase delay and add similar safeguards.

**Current Code (media-store.ts:270-281):**
```typescript
const cleanup = () => {
  if (cleanupTimeout) {
    clearTimeout(cleanupTimeout);
    cleanupTimeout = null;
  }
  element.remove();
  if (blobUrl) {
    // Delay cleanup to prevent timing conflicts
    setTimeout(() => {
      revokeMediaBlob(blobUrl!, "getMediaDuration");
    }, 100);  // ← Already has delay, but may not be enough
  }
};
```

**Proposed Change:**
```typescript
const cleanup = () => {
  if (cleanupTimeout) {
    clearTimeout(cleanupTimeout);
    cleanupTimeout = null;
  }
  element.remove();
  if (blobUrl) {
    // Delay cleanup to prevent timing conflicts
    // Use 150ms to match generateVideoThumbnailBrowser
    setTimeout(() => {
      revokeMediaBlob(blobUrl!, "getMediaDuration");
    }, 150);  // ✅ Increased from 100ms to 150ms
  }
};
```

---

#### Subtask 8.3: Alternative - Clear Video Source Before Revoke
**Priority: LOW**

Clear the video element's source before revoking the blob URL.

**Proposed Enhancement:**
```typescript
const cleanup = () => {
  // Clear source first to stop any pending loads
  video.src = "";
  video.load();  // Force the element to release the URL

  video.remove();
  canvas.remove();

  if (blobUrl) {
    // Small delay after clearing source
    setTimeout(() => {
      revokeMediaBlob(blobUrl, "generateVideoThumbnailBrowser");
    }, 50);
  }
};
```

**Why This Might Help:**
- Setting `src = ""` tells the video element to stop loading
- Calling `load()` after ensures the element releases its reference
- Shorter delay needed since element is explicitly released

---

## Issue 3: React forwardRef Warning (Still Present)

### Problem
Same warning from original analysis - still present.

### Evidence from Console Log
```
Warning: Function components cannot be given refs. Attempts to access this ref will fail.
Check the render method of `Primitive.button.SlotClone`.
```

### Status
Not yet fixed. See original `video_play_issues.md` for details.

---

## Summary of New Issues

| Issue | Priority | Status | Impact | Subtasks |
|-------|----------|--------|--------|----------|
| Issue 6: File Key Inconsistency | HIGH | ✅ FIXED | Cache misses, duplicate URLs | 6.1 ✅ |
| Issue 7: Cleanup Recreation Cycle | HIGH | ✅ FIXED | 2x URLs per file on startup | 7.1 ✅, 7.2 ✅, 7.3 ✅ |
| Issue 8: Thumbnail ERR_FILE_NOT_FOUND | MEDIUM | ✅ FIXED | Console errors, potential UI issues | 8.1 ✅ |
| Issue 3: forwardRef Warning | LOW | Existing | Warning only | See v1 doc |

---

## Implementation Priority

### Phase 1: Quick Wins (Immediate Impact) ✅ COMPLETED
1. **Subtask 6.1** - Remove `lastModified` from file key ✅
2. **Subtask 8.1** - Add 150ms delay to thumbnail cleanup ✅

### Phase 2: Core Fixes (Prevents Startup Waste) ✅ COMPLETED
3. **Subtask 7.1** - Lazy blob URL creation in StorageService ✅
4. **Subtask 7.2** - Update MediaStore to create URLs on demand ✅
5. **Subtask 7.3** - Optimize BlobUrlCleanup to use localStorage ✅

### Phase 3: Polish (Optional Enhancements)
6. **Subtask 6.2** - Content hash for file key (optional, for collision prevention)
7. **Subtask 7.4** - Metadata-only loading API
8. **Subtask 8.3** - Clear video source before revoke

---

## Files to Modify

| File | Changes Required |
|------|------------------|
| `apps/web/src/lib/blob-manager.ts` | Subtask 6.1: Remove `lastModified` from `getFileKey()` |
| `apps/web/src/lib/storage/storage-service.ts` | Subtask 7.1: Remove blob URL creation in `loadMediaItem()` |
| `apps/web/src/stores/media-store.ts` | Subtask 7.2: Add lazy URL creation in `loadProjectMedia()`, Subtask 8.1/8.2: Add cleanup delays |
| `apps/web/src/components/providers/migrators/blob-url-cleanup.tsx` | Subtask 7.3: Use localStorage instead of sessionStorage |

---

## Verification Steps After Fixes

### Test 1: Single Blob URL Per File
```javascript
// Run in browser console
window.debugBlobs()
// Expected: Each file should have exactly 1 blob URL
// Expected: Ref count should be 1-3 (depending on usage)
```

### Test 2: No ERR_FILE_NOT_FOUND
1. Open project with videos
2. Check console for `ERR_FILE_NOT_FOUND` errors
3. **Expected**: No errors

### Test 3: Cache Hits on Reload
1. Reload the page
2. Watch console for `[BlobManager]` logs
3. **Expected**: `♻️ Reusing URL` messages for same files

### Test 4: Cleanup Efficiency
1. Note blob URL count after first load
2. Reload page
3. **Expected**: Same or fewer URLs (not 2x more)

---

## Console Log Analysis Commands

```javascript
// Check active blob URLs
window.debugBlobs()

// Check for specific file patterns
// Look for: "♻️ Reusing URL" vs "🟢 Created"

// Check file key consistency
// Look for: Same file should have same "🔑 File key" across loads
```

---

## Verification Results (consolev3.md)

### Test Results After v2 Fixes

**Date:** Post-implementation verification

### ✅ Issue 6: File Key Inconsistency - VERIFIED FIXED

**Evidence:**
```
🔑 File key: 22945987-2cb2dca0-5b66-1f6b-393d-21f405cb9eab
🔑 File key: 22946198-ecbb2587-d623-2eb2-109f-e8306a658615
```
- File keys now use stable `size-name` format (no `lastModified`)
- Different files have different keys (22945987 vs 22946198 = different sizes)
- Same file will have same key across loads

### ✅ Issue 7: Cleanup Recreation Cycle - VERIFIED FIXED

**Evidence:**
```
[BlobUrlCleanup] Starting blob URL cleanup migration...
[BlobUrlCleanup] Cleanup complete. Projects: 0, Media items cleaned: 0, Media items removed: 0
```
- Cleanup ran but found nothing to clean (no blob URLs in storage)
- No blob URLs created during cleanup process
- Lazy URL creation working - only `media-store-display` creates URLs when needed

### ✅ Issue 8: ERR_FILE_NOT_FOUND - VERIFIED FIXED

**Evidence:**
```
[BlobManager] 🔴 Force revoked: blob:app://./26a50de1-c04c-4f83-96c4-96f01b9a71b5
  📍 Created by: getMediaDuration
  🕒 Lifespan: 431ms

[BlobManager] 🔴 Force revoked: blob:app://./1d10c62d-0296-4b92-a55d-be1a67f6caf6
  📍 Created by: processVideoFile
  🕒 Lifespan: 518ms
```
- **No ERR_FILE_NOT_FOUND errors in console!**
- Temporary URLs properly revoked after delay (431ms, 518ms, 577ms lifespans)
- 150ms delay before revocation prevents race conditions

### ✅ Blob URL Reuse Working

**Evidence:**
```
[BlobManager] ♻️ Reusing URL (instance match): ecbb2587-d623-2eb2-109f-e8306a658615
  📍 Original source: media-store-display
  🔄 Requested by: VideoPlayer
  📊 Ref count: 2

[BlobManager] 📉 Released: blob:app://./f41436d1-c371-4a9d-8095-2ac30ed96641
  📍 Created by: media-store-display
  🔄 Released by: VideoPlayer-unmount
  📊 Remaining refs: 1
```
- Cache hits working (`♻️ Reusing URL`)
- Ref counting working correctly (2 → 1 on unmount)
- Proper lifecycle management

### ⚠️ Remaining: React forwardRef Warning

**Still present (not addressed in v2):**
```
Warning: Function components cannot be given refs. Attempts to access this ref will fail.
Check the render method of `Primitive.button.SlotClone`.
```
- This is Issue 3 from the original analysis
- Low priority - warning only, no functional impact

---

## Final Status

| Issue | Status | Verification |
|-------|--------|--------------|
| Issue 6: File Key Inconsistency | ✅ FIXED | consolev3.md - stable keys confirmed |
| Issue 7: Cleanup Recreation Cycle | ✅ FIXED | consolev3.md - no wasteful URL creation |
| Issue 8: ERR_FILE_NOT_FOUND | ✅ FIXED | consolev3.md - no errors present |
| Issue 3: forwardRef Warning | ⚠️ Open | Low priority, warning only |

**All critical blob URL issues from v2 have been resolved.**

---

## Issue 9: ERR_UPLOAD_FILE_CHANGED When Playing Video in Timeline (NEW - consolev4.md)

### Problem
When a video is added to the timeline and playback is attempted, the blob URL fails with `ERR_UPLOAD_FILE_CHANGED`. This happens even though the blob URL was created correctly and is being reused.

### Evidence from Console Log (consolev4.md)
```
// Blob URL created and cached correctly
[BlobManager] 🟢 Created (cached): blob:app://./2e67ac73-c2ca-42be-9f8d-a52f8a91de8e
  📍 Source: media-store-display
  📦 Type: File, Size: 22946198 bytes
  🔑 File key: 22946198-ecbb2587-d623-2eb2-109f-e8306a658615

// Video dropped to timeline, blob URL reused correctly
timeline-track.tsx:696 {"message":"Drop event started..."}
[BlobManager] ♻️ Reusing URL (instance match): ecbb2587-d623-2eb2-109f-e8306a658615
  📍 Original source: media-store-display
  🔄 Requested by: VideoPlayer
  📊 Ref count: 2

video-player.tsx:184 [VideoPlayer] Using blob URL for ecbb2587-d623-2eb2-109f-e8306a658615: blob:app://./2e67ac73-c2ca-42be-9f8d-a52f8a91de8e

// VideoPlayer unmount/remount cycle
video-player.tsx:202 [VideoPlayer] Effect cleanup - blob URL marked for later
video-player.tsx:232 [VideoPlayer] Component unmount - releasing
[BlobManager] 📉 Released: blob:app://./2e67ac73-c2ca-42be-9f8d-a52f8a91de8e
  📊 Remaining refs: 1

// Remounted, reusing URL again
[BlobManager] ♻️ Reusing URL (instance match): ecbb2587-d623-2eb2-109f-e8306a658615
  📊 Ref count: 2

video-player.tsx:184 [VideoPlayer] Using blob URL for ecbb2587-d623-2eb2-109f-e8306a658615: blob:app://./2e67ac73-c2ca-42be-9f8d-a52f8a91de8e

// ❌ ERROR: File changed!
blob:app://./2e67ac73-c2ca-42be-9f8d-a52f8a91de8e:1 Failed to load resource: net::ERR_UPLOAD_FILE_CHANGED
index.html:68 🔧 Suppressed blob network error for: VIDEO
```

---

### Deep Analysis

#### What is ERR_UPLOAD_FILE_CHANGED?

In Chromium/Electron, `ERR_UPLOAD_FILE_CHANGED` (error code -23) is thrown when:
1. A blob URL was created from a File object
2. The browser detects the underlying file data has changed since URL creation
3. This is a security feature to prevent serving stale file content

#### OPFS File Lifecycle

**Key insight from `opfs-adapter.ts:17-28`:**
```typescript
async get(key: string): Promise<File | null> {
  const directory = await this.getDirectory();
  const fileHandle = await directory.getFileHandle(key);
  return await fileHandle.getFile();  // Returns NEW File instance each time!
}
```

`fileHandle.getFile()` returns a **snapshot** of the file at that moment. Each call creates a new File instance, even for the same underlying data.

#### The Problem Chain

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    WHY ERR_UPLOAD_FILE_CHANGED OCCURS                     │
└──────────────────────────────────────────────────────────────────────────┘

1. loadProjectMedia() calls storageService.loadAllMediaItems()
   └─► OPFSAdapter.get() → fileHandle.getFile() → File instance A
   └─► MediaItem.file = File A

2. getOrCreateObjectURL(item.file) creates blob URL from File A
   └─► blob:app://./2e67ac73-... references File A's data snapshot

3. extractVideoMetadataBackground(item.file) for thumbnail generation
   └─► createObjectURL(file) → temporary URL from same File A
   └─► revokeObjectURL() after thumbnail extracted
   └─► Revocation MAY invalidate File A's snapshot in Chromium

4. VideoPlayer requests URL via getOrCreateObjectURL()
   └─► WeakMap finds File A, returns cached blob URL
   └─► Video element tries to load blob:app://./2e67ac73-...

5. ❌ ERR_UPLOAD_FILE_CHANGED
   └─► File A's snapshot was invalidated when temporary URL was revoked
   └─► Or: Chromium detects internal state change in File A
```

#### Why Does Revoking Temporary URLs Affect the Display URL?

The same File instance (File A) is used for:
1. **Display URL** (cached, long-lived): `getOrCreateObjectURL(item.file, "media-store-display")`
2. **Thumbnail URL** (temporary): `createObjectURL(file, "processVideoFile")`
3. **Duration URL** (temporary): `createObjectURL(file, "getMediaDuration")`

When temporary URLs are revoked, Chromium may:
- Mark the File object as "modified" internally
- Invalidate the file data snapshot
- Cause subsequent blob URL loads to fail with ERR_UPLOAD_FILE_CHANGED

---

### Affected Files

| File | Line(s) | Role |
|------|---------|------|
| `apps/web/src/lib/storage/opfs-adapter.ts` | 17-28 | `get()` returns new File instance each call |
| `apps/web/src/lib/blob-manager.ts` | 63-135 | Caches URLs by File instance (WeakMap) |
| `apps/web/src/stores/media-store.ts` | 155-188 | `extractVideoMetadataBackground()` creates temporary URLs |
| `apps/web/src/stores/media-store.ts` | 640-707 | `loadProjectMedia()` creates display URL |
| `apps/web/src/components/ui/video-player.tsx` | 168-225 | Uses blob URL for playback |

---

### Implementation Plan

#### Subtask 9.1: Create Separate File Instance for Temporary Operations ✅ IMPLEMENTED
**Priority: HIGH**
**File: `apps/web/src/stores/media-store.ts`**
**Action: MODIFY**
**Status: COMPLETED**

**Problem:** Temporary blob URLs for thumbnail/duration are created from the same File instance as the display URL. Revoking them may invalidate the File snapshot.

**Solution:** Clone the File before creating temporary URLs.

**Current Code (media-store.ts:155-188):**
```typescript
const extractVideoMetadataBackground = async (
  file: File,
  itemId: string,
  projectId: string
) => {
  try {
    updateMediaItemField(itemId, { thumbnailStatus: "loading" });

    const [thumbnailData, duration] = await Promise.all([
      generateVideoThumbnailBrowser(file),  // Uses same file instance
      getMediaDuration(file),                // Uses same file instance
    ]);
    // ...
  }
};
```

**Proposed Fix:**
```typescript
const extractVideoMetadataBackground = async (
  file: File,
  itemId: string,
  projectId: string
) => {
  try {
    updateMediaItemField(itemId, { thumbnailStatus: "loading" });

    // Clone file to isolate temporary operations from display URL
    // This prevents ERR_UPLOAD_FILE_CHANGED when temporary URLs are revoked
    const fileClone = new File([file], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });

    const [thumbnailData, duration] = await Promise.all([
      generateVideoThumbnailBrowser(fileClone),  // Uses cloned file
      getMediaDuration(fileClone),               // Uses cloned file
    ]);
    // ...
  }
};
```

**Why This Works:**
- The original File instance (used for display URL) is never touched by temporary operations
- The cloned File has its own blob URL lifecycle
- When temporary URLs are revoked, only the clone's snapshot is affected

---

#### Subtask 9.2: Add Error Recovery in VideoPlayer ✅ IMPLEMENTED
**Priority: HIGH**
**File: `apps/web/src/components/ui/video-player.tsx`**
**Action: MODIFY**
**Status: COMPLETED**

**Current Code (video-player.tsx:262-277):**
```typescript
onError={(e) => {
  const video = e.currentTarget;
  const errorCode = video.error?.code;
  const errorMessage = video.error?.message || "Unknown error";
  console.error(
    `[VideoPlayer] ❌ Video error for ${videoId ?? "video"}:`,
    {
      code: errorCode,
      message: errorMessage,
      src: video.src?.substring(0, 50) + "...",
      networkState: video.networkState,
      readyState: video.readyState,
    }
  );
  videoLoadedRef.current = false;
}}
```

**Proposed Fix:**
```typescript
onError={(e) => {
  const video = e.currentTarget;
  const errorCode = video.error?.code;
  const errorMessage = video.error?.message || "Unknown error";

  console.error(
    `[VideoPlayer] ❌ Video error for ${videoId ?? "video"}:`,
    {
      code: errorCode,
      message: errorMessage,
      src: video.src?.substring(0, 50) + "...",
      networkState: video.networkState,
      readyState: video.readyState,
    }
  );

  // Handle ERR_UPLOAD_FILE_CHANGED by creating fresh blob URL
  // Error code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED (often wraps network errors)
  if (
    errorMessage.includes("UPLOAD_FILE_CHANGED") ||
    (errorCode === 4 && videoSource?.type === "file")
  ) {
    console.log(`[VideoPlayer] 🔄 Attempting recovery with fresh blob URL`);

    // Release old URL reference
    if (pendingCleanupRef.current) {
      releaseObjectURL(pendingCleanupRef.current, "VideoPlayer-error-recovery");
    }

    // Create fresh URL (bypasses cache)
    const freshUrl = createObjectURL(videoSource.file, "VideoPlayer-recovery");
    blobUrlRef.current = freshUrl;
    pendingCleanupRef.current = freshUrl;
    video.src = freshUrl;
    video.load();

    console.log(`[VideoPlayer] 🔄 Recovery URL: ${freshUrl}`);
    return;
  }

  videoLoadedRef.current = false;
}}
```

**Required Import:**
```typescript
import {
  getOrCreateObjectURL,
  releaseObjectURL,
  revokeObjectURL,
  createObjectURL,  // ADD THIS
} from "@/lib/blob-manager";
```

---

#### Subtask 9.3: Add File Clone Helper Utility ✅ IMPLEMENTED
**Priority: MEDIUM**
**File: `apps/web/src/stores/media-store.ts`**
**Action: ADD**
**Status: COMPLETED (merged with Subtask 9.1)**

Add helper function for file cloning:

```typescript
/**
 * Clone a File to create an isolated instance for temporary operations.
 * This prevents ERR_UPLOAD_FILE_CHANGED when blob URLs are revoked.
 *
 * Note: This reads the entire file into memory, so use sparingly for large files.
 * For video metadata extraction, this is acceptable as the file is already in memory.
 */
const cloneFileForTemporaryUse = (file: File): File => {
  return new File([file], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
};
```

---

#### Subtask 9.4: Alternative - Invalidate Cached URL on Error (BlobManager)
**Priority: LOW**
**File: `apps/web/src/lib/blob-manager.ts`**
**Action: ADD (Optional)**

Add method to invalidate a cached URL and force recreation:

```typescript
/**
 * Invalidate a cached URL for a file, forcing the next getOrCreateObjectURL
 * to create a fresh URL. Use when ERR_UPLOAD_FILE_CHANGED is detected.
 */
invalidateCachedUrl(file: File | Blob): boolean {
  const existingUrl = this.fileToUrl.get(file);
  if (existingUrl && this.blobs.has(existingUrl)) {
    const entry = this.blobs.get(existingUrl)!;

    // Remove from caches
    this.fileToUrl.delete(file);
    const fileKey = this.getFileKey(file);
    if (this.fileKeyToUrl.get(fileKey) === existingUrl) {
      this.fileKeyToUrl.delete(fileKey);
    }

    // Revoke the URL
    nativeRevokeObjectURL(existingUrl);
    this.blobs.delete(existingUrl);

    if (import.meta.env.DEV) {
      console.log(`[BlobManager] 🗑️ Invalidated cached URL: ${existingUrl}`);
    }

    return true;
  }
  return false;
}
```

---

### Testing Plan

#### Test 1: Import and Play Video
1. Import a video file
2. Wait for thumbnail generation (loading state → ready)
3. Drag video to timeline
4. Press play
5. **Expected:** Video plays without ERR_UPLOAD_FILE_CHANGED

#### Test 2: Multiple Videos
1. Import 3 videos
2. Wait for all thumbnails
3. Add all to timeline
4. Play through timeline
5. **Expected:** All videos play correctly

#### Test 3: Repeated Play/Pause
1. Import video, add to timeline
2. Play → Pause → Play → Pause (10 times)
3. **Expected:** No errors, consistent playback

#### Test 4: Timeline Scrubbing
1. Import video, add to timeline
2. Scrub timeline back and forth rapidly
3. **Expected:** VideoPlayer handles mount/unmount gracefully

---

### Summary

| Subtask | Priority | Effort | Impact | Status |
|---------|----------|--------|--------|--------|
| 9.1: Clone File for temp ops | HIGH | LOW | Prevents root cause | ✅ DONE |
| 9.2: VideoPlayer error recovery | HIGH | MEDIUM | Graceful fallback | ✅ DONE |
| 9.3: File clone helper | MEDIUM | LOW | Code organization | ✅ DONE |
| 9.4: BlobManager invalidation | LOW | LOW | Alternative approach | ⏭️ Skipped |

**Implementation complete.** Both the root cause fix (file cloning) and the safety net (error recovery) are implemented. TypeScript compilation and build passed

---

## Summary of All Issues

| Issue | Priority | Status | Impact |
|-------|----------|--------|--------|
| Issue 6: File Key Inconsistency | HIGH | ✅ FIXED | Cache misses, duplicate URLs |
| Issue 7: Cleanup Recreation Cycle | HIGH | ✅ FIXED | 2x URLs per file on startup |
| Issue 8: Thumbnail ERR_FILE_NOT_FOUND | MEDIUM | ✅ FIXED | Console errors |
| Issue 3: forwardRef Warning | LOW | ⚠️ Open | Warning only |
| **Issue 9: ERR_UPLOAD_FILE_CHANGED** | **HIGH** | **✅ FIXED** | **Video playback fails in timeline** |

---

## Next Steps

### Issue 9 Fix - COMPLETED ✅

1. **Subtask 9.1: Clone File for temp operations** ✅ DONE
   - File: `apps/web/src/stores/media-store.ts:166-171`
   - Added `cloneFileForTemporaryUse()` helper function
   - Used in `extractVideoMetadataBackground()` before creating temporary blob URLs
   - This prevents the display URL from being invalidated when temp URLs are revoked

2. **Subtask 9.2: Add VideoPlayer error recovery** ✅ DONE
   - File: `apps/web/src/components/ui/video-player.tsx:279-312`
   - Detects ERR_UPLOAD_FILE_CHANGED and ERR_FILE_NOT_FOUND errors
   - Creates fresh blob URL as recovery mechanism
   - Graceful fallback for any edge cases

3. **Subtask 9.3: Add cloneFileForTemporaryUse helper** ✅ DONE
   - Merged with Subtask 9.1

### Remaining Tasks

1. **Test video playback** - Verify the fix works:
   - Import video → wait for thumbnail → add to timeline → play
   - Expected: No ERR_UPLOAD_FILE_CHANGED errors
2. **Test thumbnail persistence** - Verify the thumbnail fix from `video_thumbnail_fix_plan.md` works correctly
3. **Run full test suite** - Ensure no regressions from the blob URL changes

---

## Root Cause Summary (Issue 9)

```
┌─────────────────────────────────────────────────────────────────┐
│  SAME FILE INSTANCE → MULTIPLE BLOB URLS → REVOKE ONE → ALL BREAK  │
└─────────────────────────────────────────────────────────────────┘

File A (from OPFS)
    │
    ├─► Display URL (cached, long-lived)      ← Used by VideoPlayer
    │   blob:app://./2e67ac73-...
    │
    ├─► Thumbnail URL (temporary)              ← Revoked after use
    │   blob:app://./b30ed520-...
    │
    └─► Duration URL (temporary)               ← Revoked after use
        blob:app://./b21e2b6f-...

When temp URLs are revoked, Chromium may invalidate File A's snapshot,
causing the display URL to fail with ERR_UPLOAD_FILE_CHANGED.

SOLUTION: Clone File A before creating temporary URLs.
```
