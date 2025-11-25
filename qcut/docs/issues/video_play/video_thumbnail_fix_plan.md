# Video Thumbnail Fix Plan - Solution 5: Persist Thumbnails

## Problem Summary

Video thumbnails are not displaying in:
1. **Media Panel** - Shows generic "Video" icon instead of thumbnail
2. **Timeline** - Shows element name text instead of tiled thumbnail

### Root Causes

1. **Immediate Return** - `processVideoFile()` returns `thumbnailUrl: undefined` immediately
2. **Background Update Disconnected** - Thumbnail generates in background but UI doesn't re-render
3. **ID Mismatch** - Background uses `generateFileBasedId(file)` which may not match stored item ID
4. **No Persistence** - Thumbnails are not saved to storage, requiring regeneration on every load

---

## Relevant File Paths

| File | Purpose |
|------|---------|
| `apps/web/src/stores/media-store.ts` | processVideoFile, generateVideoThumbnailBrowser, updateMediaMetadata |
| `apps/web/src/stores/media-store-types.ts` | MediaItem interface definition |
| `apps/web/src/lib/media-processing.ts` | processMediaFiles - initial file processing |
| `apps/web/src/lib/storage/storage-service.ts` | Persistence layer for media items |
| `apps/web/src/components/editor/media-panel/views/media.tsx` | Media panel thumbnail display |
| `apps/web/src/components/editor/timeline/timeline-element.tsx` | Timeline thumbnail display |

---

## Console Log Evidence (consolev3.md)

```
[BlobManager] 🟢 Created (unique): blob:app://./1d10c62d-...
  📍 Source: processVideoFile

[BlobManager] 🔴 Force revoked: blob:app://./1d10c62d-...
  📍 Created by: processVideoFile
  🕒 Lifespan: 518ms
  🏷️ Context: media-store:generateVideoThumbnailBrowser
```

This shows:
1. Blob URL is created for thumbnail generation
2. Thumbnail is generated (canvas.toDataURL creates data URL)
3. Blob URL is revoked after 518ms
4. **BUT**: The data URL thumbnail is generated but UI doesn't update

---

## Chosen Solution: Persist Thumbnails to Storage

### Why This Solution

| Approach | Problem |
|----------|---------|
| Blocking wait | 500-1000ms delay per video - bad UX for bulk imports |
| Fix ID matching | Addresses symptom, not cause - still no persistence |
| Force re-render | Hack, not solution - thumbnails still lost on reload |
| **Persist to storage** | Complete solution - thumbnails survive reload, no regeneration |

### Benefits

- Thumbnails survive page reload
- No re-generation on project load (fast startup)
- Storage is source of truth
- Works with existing IndexedDB/OPFS infrastructure
- Data URLs are small (~5-20KB) - cheap to store

---

## Current Flow (Broken)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CURRENT FLOW                                  │
└─────────────────────────────────────────────────────────────────────────┘

IMPORT VIDEO:
T+0ms    processVideoFile(file)
         ├─► Returns { thumbnailUrl: undefined }
         └─► UI shows "Video" icon

T+500ms  Background generates thumbnail (data:image/jpeg;base64,...)
         ├─► updateMediaMetadata() attempts store update
         └─► UI may or may not re-render (ID mismatch / selector issue)

RELOAD PAGE:
T+0ms    loadProjectMedia()
         ├─► Loads media from storage (no thumbnail saved)
         ├─► processVideoFile() called again
         └─► Returns { thumbnailUrl: undefined } → cycle repeats

RESULT: Thumbnails never reliably display, regenerated every time
```

---

## Proposed Flow (Fixed)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FIXED FLOW                                    │
└─────────────────────────────────────────────────────────────────────────┘

IMPORT VIDEO:
T+0ms    processVideoFile(file)
         ├─► Returns { thumbnailUrl: undefined, thumbnailStatus: 'pending' }
         └─► UI shows loading placeholder

T+500ms  Background generates thumbnail (data:image/jpeg;base64,...)
         ├─► Save thumbnail to storage (IndexedDB)
         ├─► Update MediaItem with thumbnailUrl
         ├─► Set thumbnailStatus: 'ready'
         └─► UI re-renders with thumbnail

RELOAD PAGE:
T+0ms    loadProjectMedia()
         ├─► Loads media from storage
         ├─► thumbnailUrl already present (from storage)
         └─► UI shows thumbnail immediately ✅

RESULT: Thumbnails display reliably, persist across sessions
```

---

## Implementation Plan - Detailed Subtasks

---

### Phase 1: Add Thumbnail Status Field ✅ COMPLETED

**Goal:** Track thumbnail generation state for better UX

---

#### Subtask 1.1: Add thumbnailStatus to MediaItem Interface ✅ DONE
**File:** `apps/web/src/stores/media-store-types.ts`
**Action:** MODIFY
**Lines:** 14-15

**Current Code:**
```typescript
  thumbnailUrl?: string; // For video thumbnails
  duration?: number; // For video/audio duration
```

**New Code:**
```typescript
  thumbnailUrl?: string; // For video thumbnails (data URL, persisted to storage)
  thumbnailStatus?: 'pending' | 'loading' | 'ready' | 'failed'; // Thumbnail generation state
  duration?: number; // For video/audio duration
```

---

#### Subtask 1.2: Add Loading State to Media Panel Video Preview ✅ DONE
**File:** `apps/web/src/components/editor/media-panel/views/media.tsx`
**Action:** MODIFY
**Lines:** 241-272

**Current Code:**
```typescript
    if (item.type === "video") {
      if (item.thumbnailUrl) {
        return (
          <div className="relative w-full h-full">
            <img
              src={item.thumbnailUrl}
              alt={item.name}
              className="w-full h-full object-cover rounded"
              loading="lazy"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-background/20 rounded">
              <Video className="h-6 w-6 text-foreground drop-shadow-md" />
            </div>
            {item.duration && (
              <div className="absolute bottom-1 right-1 bg-background/70 text-foreground text-xs px-1 rounded">
                {formatDuration(item.duration)}
              </div>
            )}
          </div>
        );
      }
      return (
        <div className="w-full h-full bg-muted/30 flex flex-col items-center justify-center text-muted-foreground rounded">
          <Video className="h-6 w-6 mb-1" />
          <span className="text-xs">Video</span>
          {item.duration && (
            <span className="text-xs opacity-70">
              {formatDuration(item.duration)}
            </span>
          )}
        </div>
      );
    }
```

**New Code:**
```typescript
    if (item.type === "video") {
      // Show loading spinner while thumbnail is being generated
      if (item.thumbnailStatus === 'loading' || item.thumbnailStatus === 'pending') {
        return (
          <div className="w-full h-full bg-muted/30 flex flex-col items-center justify-center text-muted-foreground rounded">
            <Loader2 className="h-6 w-6 mb-1 animate-spin" />
            <span className="text-xs">Loading...</span>
            {item.duration && (
              <span className="text-xs opacity-70">
                {formatDuration(item.duration)}
              </span>
            )}
          </div>
        );
      }

      // Show thumbnail if available
      if (item.thumbnailUrl) {
        return (
          <div className="relative w-full h-full">
            <img
              src={item.thumbnailUrl}
              alt={item.name}
              className="w-full h-full object-cover rounded"
              loading="lazy"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-background/20 rounded">
              <Video className="h-6 w-6 text-foreground drop-shadow-md" />
            </div>
            {item.duration && (
              <div className="absolute bottom-1 right-1 bg-background/70 text-foreground text-xs px-1 rounded">
                {formatDuration(item.duration)}
              </div>
            )}
          </div>
        );
      }

      // Fallback: no thumbnail available
      return (
        <div className="w-full h-full bg-muted/30 flex flex-col items-center justify-center text-muted-foreground rounded">
          <Video className="h-6 w-6 mb-1" />
          <span className="text-xs">Video</span>
          {item.duration && (
            <span className="text-xs opacity-70">
              {formatDuration(item.duration)}
            </span>
          )}
        </div>
      );
    }
```

**Note:** `Loader2` is already imported from lucide-react (line 7).

---

#### Subtask 1.3: Add Loading State to Timeline Video Rendering ✅ DONE
**File:** `apps/web/src/components/editor/timeline/timeline-element.tsx`
**Action:** MODIFY
**Lines:** 381-441

**Current Code:**
```typescript
    if (mediaItem.type === "video" && mediaItem.thumbnailUrl) {
      const trackHeight = getTrackHeight(track.type);
      const tileHeight = trackHeight - 8;
      const tileWidth = tileHeight * TILE_ASPECT_RATIO;

      return (
        <div className="w-full h-full flex items-center justify-center">
          <div className="bg-[#004D52] py-3 w-full h-full relative">
            {/* Background with tiled thumbnails */}
            <div
              className="absolute top-3 bottom-3 left-0 right-0"
              style={{
                backgroundImage: mediaItem.thumbnailUrl
                  ? `url(${mediaItem.thumbnailUrl})`
                  : "none",
                backgroundRepeat: "repeat-x",
                backgroundSize: `${tileWidth}px ${tileHeight}px`,
                backgroundPosition: "left center",
                pointerEvents: "none",
              }}
              aria-label={`Tiled thumbnail of ${mediaItem.name}`}
            />
            {/* Overlay with vertical borders */}
            <div
              className="absolute top-3 bottom-3 left-0 right-0 pointer-events-none"
              style={{
                backgroundImage: `repeating-linear-gradient(
                  to right,
                  transparent 0px,
                  transparent ${tileWidth - 1}px,
                  rgba(255, 255, 255, 0.6) ${tileWidth - 1}px,
                  rgba(255, 255, 255, 0.6) ${tileWidth}px
                )`,
                backgroundPosition: "left center",
              }}
            />
          </div>
        </div>
      );
    }
```

**New Code:**
```typescript
    if (mediaItem.type === "video") {
      const trackHeight = getTrackHeight(track.type);
      const tileHeight = trackHeight - 8;
      const tileWidth = tileHeight * TILE_ASPECT_RATIO;

      // Show loading indicator while thumbnail generates
      if (mediaItem.thumbnailStatus === 'loading' || mediaItem.thumbnailStatus === 'pending') {
        return (
          <div className="w-full h-full flex items-center justify-center bg-[#004D52]">
            <span className="text-xs text-foreground/60 truncate px-2">
              {element.name} (loading...)
            </span>
          </div>
        );
      }

      // Show tiled thumbnails if available
      if (mediaItem.thumbnailUrl) {
        return (
          <div className="w-full h-full flex items-center justify-center">
            <div className="bg-[#004D52] py-3 w-full h-full relative">
              {/* Background with tiled thumbnails */}
              <div
                className="absolute top-3 bottom-3 left-0 right-0"
                style={{
                  backgroundImage: `url(${mediaItem.thumbnailUrl})`,
                  backgroundRepeat: "repeat-x",
                  backgroundSize: `${tileWidth}px ${tileHeight}px`,
                  backgroundPosition: "left center",
                  pointerEvents: "none",
                }}
                aria-label={`Tiled thumbnail of ${mediaItem.name}`}
              />
              {/* Overlay with vertical borders */}
              <div
                className="absolute top-3 bottom-3 left-0 right-0 pointer-events-none"
                style={{
                  backgroundImage: `repeating-linear-gradient(
                    to right,
                    transparent 0px,
                    transparent ${tileWidth - 1}px,
                    rgba(255, 255, 255, 0.6) ${tileWidth - 1}px,
                    rgba(255, 255, 255, 0.6) ${tileWidth}px
                  )`,
                  backgroundPosition: "left center",
                }}
              />
            </div>
          </div>
        );
      }

      // Fallback: no thumbnail
      return (
        <div className="w-full h-full flex items-center justify-center bg-[#004D52]">
          <span className="text-xs text-foreground/80 truncate px-2">
            {element.name}
          </span>
        </div>
      );
    }
```

---

### Phase 2: Persist Thumbnail to Storage ✅ COMPLETED

**Goal:** Save generated thumbnails so they survive reload

---

#### Subtask 2.1: Add thumbnailUrl to Storage Schema ✅ DONE
**File:** `apps/web/src/lib/storage/storage-service.ts`
**Action:** MODIFY
**Lines:** 271-286 (inside saveMediaItem)

**Current Code:**
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
      // Only store non-blob URLs (e.g., data URLs, http URLs)
      // Blob URLs are temporary and don't persist across sessions
      url: mediaItem.url?.startsWith("blob:") ? undefined : mediaItem.url,
      metadata: mediaItem.metadata,
      // Persist localPath for FFmpeg CLI export (videos only)
      localPath: mediaItem.localPath,
    };
```

**New Code:**
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
      // Only store non-blob URLs (e.g., data URLs, http URLs)
      // Blob URLs are temporary and don't persist across sessions
      url: mediaItem.url?.startsWith("blob:") ? undefined : mediaItem.url,
      // Persist thumbnail data URL for videos (survives reload)
      thumbnailUrl: mediaItem.thumbnailUrl,
      metadata: mediaItem.metadata,
      // Persist localPath for FFmpeg CLI export (videos only)
      localPath: mediaItem.localPath,
    };
```

---

#### Subtask 2.2: Add thumbnailUrl to MediaFileData Interface ✅ DONE
**File:** `apps/web/src/lib/storage/types.ts`
**Action:** MODIFY
**Lines:** 12-26 (MediaFileData interface)

**Find the interface and ADD:**
```typescript
  thumbnailUrl?: string; // Video thumbnail as data URL
```

---

#### Subtask 2.3: Load thumbnailUrl from Storage ✅ DONE
**File:** `apps/web/src/lib/storage/storage-service.ts`
**Action:** MODIFY
**Lines:** 406-420 (loadMediaItem return statement)

**Find where MediaItem is constructed and ensure thumbnailUrl is included:**
```typescript
    return {
      id: metadata.id,
      name: metadata.name,
      type: metadata.type,
      file: actualFile,
      url,
      thumbnailUrl: metadata.thumbnailUrl,  // ADD THIS LINE
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      localPath,
      metadata: metadata.metadata,
    };
```

---

### Phase 3: Fix Background Update Flow ✅ COMPLETED

**Goal:** Ensure thumbnail updates trigger UI re-render and persist to storage

---

#### Subtask 3.1: Modify extractVideoMetadataBackground to Accept Item ID and ProjectId ✅ DONE
**File:** `apps/web/src/stores/media-store.ts`
**Action:** MODIFY
**Lines:** 155-188

**Current Code:**
```typescript
  // Start background metadata extraction (don't await)
  extractVideoMetadataBackground(file);

// Background metadata extraction without blocking UI
const extractVideoMetadataBackground = async (file: File) => {
  try {
    // Try browser processing first - it's fast and reliable
    const [thumbnailData, duration] = await Promise.all([
      generateVideoThumbnailBrowser(file),
      getMediaDuration(file),
    ]);

    const result = {
      thumbnailUrl: thumbnailData.thumbnailUrl,
      width: thumbnailData.width,
      height: thumbnailData.height,
      duration,
      fps: 30,
      processingMethod: "browser" as const,
    };

    // Update the media item with real metadata
    updateMediaMetadata(file, result);
    return result;
  } catch (browserError) {
    // Skip FFmpeg entirely to avoid the 60s timeout
    // Users get instant response with defaults, which is better UX
  }
};
```

**New Code:**
```typescript
  // Start background metadata extraction (don't await)
  // Note: itemId and projectId must be passed from caller
  // This is called from loadProjectMedia where we have both

// Background metadata extraction without blocking UI
const extractVideoMetadataBackground = async (
  file: File,
  itemId: string,
  projectId: string
) => {
  try {
    // Set status to loading
    updateMediaItemField(itemId, { thumbnailStatus: 'loading' });

    // Try browser processing first - it's fast and reliable
    const [thumbnailData, duration] = await Promise.all([
      generateVideoThumbnailBrowser(file),
      getMediaDuration(file),
    ]);

    const result = {
      thumbnailUrl: thumbnailData.thumbnailUrl,
      thumbnailStatus: 'ready' as const,
      width: thumbnailData.width,
      height: thumbnailData.height,
      duration,
      fps: 30,
      processingMethod: "browser" as const,
    };

    // Update the media item with real metadata and persist to storage
    await updateMediaMetadataAndPersist(itemId, projectId, result);
    return result;
  } catch (browserError) {
    // Set status to failed
    updateMediaItemField(itemId, { thumbnailStatus: 'failed' });
    debugError('[MediaStore] Thumbnail generation failed:', browserError);
  }
};
```

---

#### Subtask 3.2: Add Helper Functions for Updating Media Items ✅ DONE
**File:** `apps/web/src/stores/media-store.ts`
**Action:** ADD
**Location:** Lines 107-153

**New Code to ADD:**
```typescript
// Helper to update a single field on a media item (in-memory only)
const updateMediaItemField = (itemId: string, updates: Partial<MediaItem>) => {
  const mediaStore = useMediaStore.getState();
  const updatedItems = mediaStore.mediaItems.map((item) => {
    if (item.id === itemId) {
      return { ...item, ...updates };
    }
    return item;
  });
  useMediaStore.setState({ mediaItems: updatedItems });
};

// Helper to update media item metadata and persist to storage
const updateMediaMetadataAndPersist = async (
  itemId: string,
  projectId: string,
  metadata: Partial<MediaItem>
) => {
  const mediaStore = useMediaStore.getState();
  const item = mediaStore.mediaItems.find((i) => i.id === itemId);

  if (!item) {
    debugError(`[MediaStore] Cannot update item ${itemId} - not found`);
    return;
  }

  // Update in-memory state
  const updatedItem = { ...item, ...metadata };
  const updatedItems = mediaStore.mediaItems.map((i) =>
    i.id === itemId ? updatedItem : i
  );
  useMediaStore.setState({ mediaItems: updatedItems });

  // Persist to storage
  try {
    await storageService.saveMediaItem(projectId, updatedItem);
    debugLog(`[MediaStore] Persisted thumbnail for ${item.name}`);
  } catch (error) {
    debugError(`[MediaStore] Failed to persist thumbnail for ${item.name}:`, error);
  }
};
```

---

#### Subtask 3.3: Delete Old updateMediaMetadata Function ✅ DONE
**File:** `apps/web/src/stores/media-store.ts`
**Action:** DELETE (replaced with new helper functions)

**Delete this code:**
```typescript
// Helper to update media item metadata after background processing
const updateMediaMetadata = async (file: File, metadata: any) => {
  const mediaStore = useMediaStore.getState();
  const fileId = await generateFileBasedId(file);

  // Find and update the media item
  const updatedItems = mediaStore.mediaItems.map((item) => {
    if (item.id === fileId) {
      return {
        ...item,
        width: metadata.width,
        height: metadata.height,
        duration: metadata.duration,
        fps: metadata.fps,
        thumbnailUrl: metadata.thumbnailUrl,
      };
    }
    return item;
  });

  // Update the store
  useMediaStore.setState({ mediaItems: updatedItems });
};
```

---

#### Subtask 3.4: Modify loadProjectMedia to Use Stored Thumbnail or Generate New ✅ DONE
**File:** `apps/web/src/stores/media-store.ts`
**Action:** MODIFY
**Lines:** 661-684

**Current Code:**
```typescript
          if (item.type === "video" && item.file) {
            try {
              const processResult = await processVideoFile(item.file);

              return {
                ...item,
                url: displayUrl, // Use lazy-created URL
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
```

**New Code:**
```typescript
          if (item.type === "video" && item.file) {
            // Check if thumbnail already exists in storage
            if (item.thumbnailUrl) {
              debugLog(`[MediaStore] Using stored thumbnail for ${item.name}`);
              return {
                ...item,
                url: displayUrl,
                thumbnailStatus: 'ready' as const,
              };
            }

            // No stored thumbnail - need to generate
            debugLog(`[MediaStore] Generating thumbnail for ${item.name}`);

            // Start background generation (will update store and persist when done)
            extractVideoMetadataBackground(item.file, item.id, projectId);

            // Return item with pending status for now
            return {
              ...item,
              url: displayUrl,
              thumbnailStatus: 'pending' as const,
            };
```

---

#### Subtask 3.5: Remove processVideoFile Call from loadProjectMedia ✅ DONE
**File:** `apps/web/src/stores/media-store.ts`
**Action:** DELETE (removed try-catch block, replaced with background processing)

**Current Code:**
```typescript
            } catch (error) {
              handleMediaProcessingError(
                error,
                "Process video during project load",
                {
                  videoName: item.name,
                  itemId: item.id,
                  operation: "processVideoOnLoad",
                  showToast: false, // Don't spam during batch loading
                }
              );

              // Return item with error metadata to prevent complete failure
              return {
                ...item,
                url: displayUrl, // Still include URL even if processing failed
                metadata: {
                  ...item.metadata,
                  processingError: `Video processing failed: ${error instanceof Error ? error.message : String(error)}`,
                  processingMethod: "failed",
                },
              };
            }
          }
```

**New Code:**
```typescript
          }
```

(Delete the entire try-catch block since we're using background processing now)

---

#### Subtask 3.6: Remove Unused processVideoFile Function ✅ DONE
**File:** `apps/web/src/stores/media-store.ts`
**Action:** DELETE (removed as part of refactoring)

If `processVideoFile` is only used in loadProjectMedia, delete it:
```typescript
// Instant video processing with defaults first, background metadata extraction
export const processVideoFile = async (file: File) => {
  // Return immediate defaults for instant UI response
  const defaultResult = {
    thumbnailUrl: undefined,
    width: 1920,
    height: 1080,
    duration: 0,
    fps: 30,
    processingMethod: "immediate" as const,
    error: undefined,
  };

  // Start background metadata extraction (don't await)
  extractVideoMetadataBackground(file);

  return defaultResult;
};
```

**Note:** Check if `processVideoFile` is used in `media-processing.ts` before deleting. If used there, keep it but remove the background call.

---

### Phase 4: Handle Edge Cases ✅ COMPLETED

**Goal:** Robust handling of failures and edge cases

---

#### Subtask 4.1: Add Error Status Handling in Background Processor ✅ DONE
**File:** `apps/web/src/stores/media-store.ts`
**Action:** Already included in Subtask 3.1

The `catch` block already sets `thumbnailStatus: 'failed'`.

---

#### Subtask 4.2: Add Retry Logic for Failed Thumbnails (Optional)
**File:** `apps/web/src/components/editor/media-panel/views/media.tsx`
**Action:** ADD (Optional enhancement)

Add click handler to retry thumbnail generation for failed items:
```typescript
if (item.thumbnailStatus === 'failed') {
  return (
    <div
      className="w-full h-full bg-red-500/10 flex flex-col items-center justify-center text-muted-foreground rounded cursor-pointer"
      onClick={() => {/* TODO: Implement retry */}}
      title="Click to retry thumbnail generation"
    >
      <Video className="h-6 w-6 mb-1 text-red-500" />
      <span className="text-xs text-red-500">Failed</span>
    </div>
  );
}
```

---

## Summary of Changes

### Files to MODIFY:

| File | Subtasks |
|------|----------|
| `stores/media-store-types.ts` | 1.1 |
| `stores/media-store.ts` | 3.1, 3.2, 3.3, 3.4, 3.5, (3.6) |
| `lib/storage/storage-service.ts` | 2.1, 2.2, 2.3 |
| `components/editor/media-panel/views/media.tsx` | 1.2, (4.2) |
| `components/editor/timeline/timeline-element.tsx` | 1.3 |

### Code to ADD:
- `thumbnailStatus` field to MediaItem interface (1.1)
- `thumbnailUrl` field to MediaFileData interface (2.2)
- Loading state UI in media panel (1.2)
- Loading state UI in timeline (1.3)
- `updateMediaItemField` helper function (3.2)
- `updateMediaMetadataAndPersist` helper function (3.2)

### Code to DELETE:
- Old `updateMediaMetadata` function (3.3)
- Try-catch block in loadProjectMedia (3.5)
- `processVideoFile` function if unused elsewhere (3.6 - optional)

---

## Data Model Change

**Current MediaItem:**
```
{
  id: string
  name: string
  type: 'video' | 'image' | 'audio'
  file: File
  url: string
  thumbnailUrl?: string  // Not persisted, lost on reload
  duration?: number
  width?: number
  height?: number
}
```

**Updated MediaItem:**
```
{
  id: string
  name: string
  type: 'video' | 'image' | 'audio'
  file: File
  url: string
  thumbnailUrl?: string        // Data URL, persisted to storage
  thumbnailStatus?: string     // 'pending' | 'loading' | 'ready' | 'failed'
  duration?: number
  width?: number
  height?: number
}
```

---

## Storage Schema

**MediaItem in IndexedDB:**
```
{
  id: "abc-123",
  name: "video.mp4",
  type: "video",
  url: undefined,              // Blob URLs not persisted (recreated on load)
  thumbnailUrl: "data:image/jpeg;base64,/9j/4AAQ...",  // ✅ Persisted
  thumbnailStatus: "ready",
  duration: 120.5,
  width: 1920,
  height: 1080,
  // file stored separately in OPFS
}
```

---

## Testing Plan

### Test 1: New Video Import
1. Import a video file
2. Verify loading spinner appears in Media Panel
3. Verify thumbnail appears after ~500ms
4. Verify Timeline shows thumbnail when video is added

### Test 2: Page Reload Persistence
1. Import a video, wait for thumbnail
2. Reload the page
3. Verify thumbnail appears immediately (no regeneration)
4. Check console - no `generateVideoThumbnailBrowser` calls

### Test 3: Multiple Videos
1. Import 5 videos simultaneously
2. Verify all show loading states
3. Verify all thumbnails appear as they complete
4. Reload page - all thumbnails persist

### Test 4: Error Handling
1. Import corrupted video file
2. Verify error state appears
3. Verify other videos still work

### Test 5: Storage Verification
1. Import video, wait for thumbnail
2. Open browser DevTools → Application → IndexedDB
3. Find media item record
4. Verify `thumbnailUrl` contains data URL

---

## Rollback Plan

If issues arise:
1. Remove `thumbnailStatus` field (backward compatible)
2. Revert to previous `processVideoFile` behavior
3. Thumbnails will regenerate each load (current behavior)

---

## Success Criteria

**Implementation Complete - Ready for Testing:**

- [ ] Video thumbnails display in Media Panel after import
- [ ] Video thumbnails display in Timeline when added
- [ ] Thumbnails persist across page reload
- [ ] No thumbnail regeneration on project load
- [ ] Loading state shown while thumbnail generates
- [ ] Error state shown when generation fails
- [ ] Console shows storage read (not regeneration) on reload

---

## Implementation Status

| Phase | Status |
|-------|--------|
| Phase 1: Add Thumbnail Status Field | ✅ COMPLETED |
| Phase 2: Persist Thumbnail to Storage | ✅ COMPLETED |
| Phase 3: Fix Background Update Flow | ✅ COMPLETED |
| Phase 4: Handle Edge Cases | ✅ COMPLETED |

**All code changes implemented. TypeScript compilation passed.**

---

## Appendix: Current Code Analysis

### processVideoFile Returns Immediately (media-store.ts:107-124)

```typescript
export const processVideoFile = async (file: File) => {
  const defaultResult = {
    thumbnailUrl: undefined,  // ❌ Always undefined initially
    width: 1920,
    height: 1080,
    duration: 0,
    fps: 30,
    processingMethod: "immediate" as const,
  };

  extractVideoMetadataBackground(file);  // Fire and forget
  return defaultResult;  // Returns before thumbnail generated
};
```

### Background Processing (media-store.ts:126-170)

```typescript
const extractVideoMetadataBackground = async (file: File) => {
  try {
    const [thumbnailData, duration] = await Promise.all([
      generateVideoThumbnailBrowser(file),
      getMediaDuration(file),
    ]);

    updateMediaMetadata(file, {
      thumbnailUrl: thumbnailData.thumbnailUrl,
      width: thumbnailData.width,
      height: thumbnailData.height,
      duration,
    });
  } catch (browserError) {
    // Silent fail - users get defaults
  }
};

const updateMediaMetadata = async (file: File, metadata: any) => {
  const mediaStore = useMediaStore.getState();
  const fileId = await generateFileBasedId(file);  // ⚠️ May not match

  const updatedItems = mediaStore.mediaItems.map((item) => {
    if (item.id === fileId) {  // ⚠️ ID comparison may fail
      return { ...item, ...metadata };
    }
    return item;
  });

  useMediaStore.setState({ mediaItems: updatedItems });
  // ⚠️ Missing: persist to storage
};
```

### Media Panel Rendering (media.tsx:241-272)

```typescript
if (item.type === "video") {
  if (item.thumbnailUrl) {  // Fails when undefined
    return (
      <img src={item.thumbnailUrl} alt={item.name} />
    );
  }
  return (
    <div>
      <Video className="h-6 w-6" />
      <span>Video</span>  // Shows this instead
    </div>
  );
}
```

### Timeline Rendering (timeline-element.tsx:381-420)

```typescript
if (mediaItem.type === "video" && mediaItem.thumbnailUrl) {  // Fails
  return (
    <div style={{
      backgroundImage: `url(${mediaItem.thumbnailUrl})`,
    }} />
  );
}

return (
  <span>{element.name}</span>  // Shows this instead
);
```

### loadProjectMedia (media-store.ts:648-664)

```typescript
if (item.type === "video" && item.file) {
  const processResult = await processVideoFile(item.file);
  return {
    ...item,
    thumbnailUrl: processResult.thumbnailUrl || item.thumbnailUrl,
    // processResult.thumbnailUrl is undefined!
  };
}
```
