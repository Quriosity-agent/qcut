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

## Implementation Plan

### Phase 1: Add Thumbnail Status Field

**Goal:** Track thumbnail generation state for better UX

**Changes:**
- Add `thumbnailStatus: 'pending' | 'loading' | 'ready' | 'failed'` to MediaItem type
- Update components to show appropriate UI based on status
- Show spinner while generating, placeholder if pending, error if failed

**Files:**
- `stores/media-store-types.ts` - Add thumbnailStatus to MediaItem interface
- `components/editor/media-panel/views/media.tsx` - Render based on status
- `components/editor/timeline/timeline-element.tsx` - Render based on status

---

### Phase 2: Persist Thumbnail to Storage

**Goal:** Save generated thumbnails so they survive reload

**Changes:**
- When thumbnail is generated, save to storage alongside MediaItem
- On load, retrieve thumbnail from storage
- No regeneration needed

**Storage Options:**

| Option | Pros | Cons |
|--------|------|------|
| **A: Inline in MediaItem** | Simple, single read | Larger metadata object |
| **B: Separate thumbnail store** | Clean separation | Extra read per item |
| **C: As separate file in OPFS** | Works with large thumbnails | More complex |

**Recommended: Option A** - Store thumbnail data URL directly in MediaItem metadata. Thumbnails are small (5-20KB base64), so inline storage is acceptable.

**Files:**
- `stores/media-store.ts` - Save thumbnailUrl to storage after generation
- `lib/storage/storage-service.ts` - Ensure thumbnailUrl persists with MediaItem

---

### Phase 3: Fix Background Update Flow

**Goal:** Ensure thumbnail updates trigger UI re-render

**Changes:**
- Pass item ID to background processor (not just file)
- Update by ID directly (no re-generation of ID)
- Use granular Zustand selectors in components

**Files:**
- `stores/media-store.ts` - Refactor extractVideoMetadataBackground
- `stores/media-store.ts` - Refactor updateMediaMetadata to use ID
- `components/editor/media-panel/views/media.tsx` - Use granular selector
- `components/editor/timeline/timeline-element.tsx` - Use granular selector

---

### Phase 4: Handle Edge Cases

**Goal:** Robust handling of failures and edge cases

**Scenarios:**
- Thumbnail generation fails → Set status to 'failed', show retry option
- File too large → Skip thumbnail, use placeholder
- Storage full → Log warning, continue without persistence
- Corrupted thumbnail in storage → Regenerate once

**Files:**
- `stores/media-store.ts` - Add error handling and retry logic

---

## Detailed Changes by File

### 1. `stores/media-store-types.ts`

Add to MediaItem interface:
- `thumbnailStatus?: 'pending' | 'loading' | 'ready' | 'failed'`
- Ensure `thumbnailUrl` can be data URL string

### 2. `stores/media-store.ts`

**processVideoFile:**
- Return `thumbnailStatus: 'pending'` initially
- Pass item ID to background processor

**extractVideoMetadataBackground:**
- Accept item ID as parameter
- Set `thumbnailStatus: 'loading'` when starting
- On success: Set `thumbnailStatus: 'ready'`, save to storage
- On failure: Set `thumbnailStatus: 'failed'`

**updateMediaMetadata:**
- Find item by ID (not by file hash)
- Update store AND persist to storage
- Call `storageService.saveMediaItem()` with updated thumbnailUrl

**loadProjectMedia:**
- Check if item already has thumbnailUrl from storage
- If yes: Use it directly, set `thumbnailStatus: 'ready'`
- If no: Generate thumbnail, persist result

### 3. `lib/storage/storage-service.ts`

**saveMediaItem:**
- Ensure thumbnailUrl is included in persisted data
- Data URLs are strings, should serialize fine

**loadMediaItem:**
- Return thumbnailUrl from stored metadata

### 4. `components/editor/media-panel/views/media.tsx`

**renderPreview for video:**
- If `thumbnailStatus === 'loading'`: Show spinner
- If `thumbnailStatus === 'ready'` && `thumbnailUrl`: Show thumbnail
- If `thumbnailStatus === 'failed'`: Show error icon with retry
- Otherwise: Show placeholder

### 5. `components/editor/timeline/timeline-element.tsx`

**renderElementContent for video:**
- Same status-based rendering as media panel
- Show loading indicator while thumbnail generates
- Gracefully handle missing thumbnail

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

- [ ] Video thumbnails display in Media Panel after import
- [ ] Video thumbnails display in Timeline when added
- [ ] Thumbnails persist across page reload
- [ ] No thumbnail regeneration on project load
- [ ] Loading state shown while thumbnail generates
- [ ] Error state shown when generation fails
- [ ] Console shows storage read (not regeneration) on reload

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
