# Canvas Video Playback Debug - Clean Console Analysis

## Core Problem
**Canvas displays static image instead of playing video because blob URLs are revoked prematurely before videos can play.**

## Latest Evidence (consolev11)

### Blob Lifecycle Pattern
1. **Creation**: Blobs created successfully with proper tracking
   - `blob:app://./7de6d66a-9f2c-44b6-92e9-3cfce7085413` created for video playback
   - Source: `media-source:getVideoSource`
   - Size: 1804357 bytes (1.8MB video file)

2. **Premature Revocation**: Blob revoked after only 2.19 seconds
   - Revoked by: `at zn → at app://./assets/editor._project_id.lazy-DVbcJekg.js:300:16659`
   - Result: `Failed to load resource: net::ERR_FILE_NOT_FOUND`
   - Video element cannot play without valid source

3. **Cleanup Migration Issue**: Blob cleanup runs on startup
   - Clears blob URLs from storage (line 11: "Cleared blob URL for media item: kling.mp4")
   - Creates new blobs but they're still revoked too quickly

## Critical Console Pattern

### What Happens:
```
[BlobManager] 🟢 Created: blob:app://./7de6d66a...
  📍 Source: media-source:getVideoSource
  ⏱️ Lifespan: 2191ms

[PLAYBACK] Play clicked
// Timeline updates occur (step 6: timeline playhead updated)

[BlobManager] 🔴 Revoked: blob:app://./7de6d66a...
[BlobUrlDebug] Revoked untracked: blob:app://./7de6d66a...
blob:app://./7de6d66a... Failed to load resource: net::ERR_FILE_NOT_FOUND
```

### What Should Happen:
```
[BlobManager] 🟢 Created: blob for video
[PLAYBACK] Play clicked
Video plays successfully
[BlobManager] 🔴 Revoked: blob (only after playback stops)
```

## Relevant File Paths and Code Lines Causing Issues

### 1. **preview-panel.tsx** (Lines 625-633) - PRIMARY SUSPECT
```typescript
// File: apps/web/src/components/editor/preview-panel.tsx
// Lines: 625-633
const activeBlobUrl =
  activeVideoSource?.type === "blob" ? activeVideoSource.src : null;

useEffect(() => {
  const urlsToRevoke = videoBlobUrls.filter((url) => url !== activeBlobUrl);
  return () => {
    urlsToRevoke.forEach((url) => revokeManagedObjectURL(url));  // LINE 631 - PREMATURE REVOCATION
  };
}, [videoBlobUrls, activeBlobUrl]);  // LINE 633 - TRIGGERS ON EVERY CHANGE
```
**Problem**: This effect runs whenever `videoBlobUrls` or `activeBlobUrl` changes, potentially revoking URLs that are still needed.

### 2. **video-player.tsx** (Lines 181-202) - AGGRESSIVE CLEANUP
```typescript
// File: apps/web/src/components/ui/video-player.tsx
// Lines: 181-202
useEffect(() => {
  const prev = previousSrcRef.current;
  if (prev && prev !== src && prev.startsWith("blob:")) {
    unmarkBlobInUse(prev);
    revokeManagedObjectURL(prev);  // LINE 185 - REVOKES PREVIOUS BLOB
  }

  return () => {
    if (previousSrcRef.current?.startsWith("blob:")) {
      revokeManagedObjectURL(url);  // LINE 198 - CLEANUP ON UNMOUNT
    }
  };
}, [src]);
```
**Problem**: Revokes blob URLs when src changes or component unmounts, even if video is still buffering.

### 3. **media-store.ts** - MULTIPLE REVOCATION POINTS
```typescript
// File: apps/web/src/stores/media-store.ts
// Critical lines with revokeObjectURL calls:
- Line 78:  revokeObjectURL(blobUrl);  // In processVideoFile
- Line 188: revokeObjectURL(blobUrl);  // In getMediaDuration
- Line 270: revokeObjectURL(blobUrl!); // In addMediaItem
- Line 547: revokeObjectURL(item.url); // In removeMediaItem
- Line 684: revokeObjectURL(item.url); // In clearProjectMedia
- Line 738: revokeObjectURL(item.url); // In reset
```
**Problem**: Multiple places where blob URLs are revoked, possibly while still in use.

### 4. **blob-manager.ts** (Lines 64-95) - CENTRAL REVOCATION
```typescript
// File: apps/web/src/lib/blob-manager.ts
// Lines: 64-95
revokeObjectURL(url: string): void {
  if (!this.blobRegistry.has(url)) {
    URL.revokeObjectURL(url);  // LINE 95 - UNTRACKED REVOCATION
    return;
  }
  // ... tracking logic ...
  URL.revokeObjectURL(url);    // LINE 91 - TRACKED REVOCATION
}
```
**Problem**: Even with tracking, blobs are still revoked too aggressively.

## Key Findings
- **Blob tracking works**: Both BlobManager and BlobUrlDebug are monitoring correctly
- **Lifespan too short**: Blobs revoked after 130ms-2.2s (far too short for video buffering)
- **Untracked revocations**: Some revokes bypass the blob manager ("Revoked untracked")
- **Playback attempts work**: Timeline updates show playback is running
- **But video can't load**: Blob URL gone before video element can buffer

## Required Fix
1. **Prevent premature revocation**: Keep blobs alive during active playback
2. **Track active video sources**: Mark blobs as "in-use" when video is playing
3. **Fix cleanup timing**: Only revoke when video element is destroyed or playback stops
4. **Handle untracked revocations**: Route all revokes through blob manager

## Success Criteria
- Blob URLs remain valid throughout playback session
- No `ERR_FILE_NOT_FOUND` errors during active playback
- Video element successfully buffers and plays
- Canvas renders video frames (not static image)

## Debug Status
- ✅ Fixed: 60fps listener recreation
- ✅ Fixed: Console logging removed for cleaner output
- ✅ Working: Blob creation and tracking
- ❌ Critical Issue: Blobs revoked while still needed (preview-panel.tsx:631)
- ❌ Blocked: Video cannot buffer without valid blob
- ❌ Blocked: Canvas cannot render without playing video

## Recommended Fix Strategy
1. **Modify preview-panel.tsx (Line 631)**: Don't revoke blobs that are actively playing
2. **Update video-player.tsx**: Keep blob alive until video element is destroyed AND playback is stopped
3. **Enhance blob-manager.ts**: Add reference counting to prevent premature revocation
4. **Fix media-store.ts**: Only revoke blobs when truly no longer needed