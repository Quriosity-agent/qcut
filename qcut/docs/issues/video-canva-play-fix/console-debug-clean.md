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
- ❌ Critical Issue: Blobs revoked while still needed
- ❌ Blocked: Video cannot buffer without valid blob
- ❌ Blocked: Canvas cannot render without playing video