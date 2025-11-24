# Canvas Video Playback Debug - Clean Console Analysis

## Core Problem
**Canvas displays static image instead of playing video because blob URLs are revoked before videos can buffer.**

## Root Cause
Active video blob URLs are being revoked while the video is still buffering, preventing readyState from reaching 3 and blocking the `canplay` event.

## Critical Console Pattern

### What Happens:
```
[PLAYBACK] Play clicked
[CANVAS-VIDEO] Video not ready (readyState: 0)
[BlobUrlDebug] Revoked: blob:...7b6954b7...
GET blob:...7b6954b7... net::ERR_FILE_NOT_FOUND
[CANVAS-VIDEO] Cleaned up canplay listener (on pause)
```

### What Should Happen:
```
[CANVAS-VIDEO] Video not ready (readyState: 0)
... buffering ...
[CANVAS-VIDEO] canplay event fired
[CANVAS-VIDEO] play() succeeded
step 13: drawing to canvas
```

## Key Evidence
- **File:** `video-player.tsx` - `canplay` listener now persists (fixed 60fps churn)
- **Console:** Active blob revoked after ~12s while still buffering
- **Result:** `canplay` never fires, readyState stays at 0

## Required Fix
Stop revoking active playback blobs before buffering completes:
1. Track ALL blob revocations through blob manager
2. Block revocation of actively playing blobs
3. Ensure cleanup migrations run only once

## Success Criteria
- No `ERR_FILE_NOT_FOUND` for active blobs
- See `canplay event fired` in console
- See `play() succeeded` message
- Canvas draws video frames

## Debug Status
- ✅ Fixed: 60fps listener recreation
- ❌ Pending: Blob revocation during buffering
- ❌ Blocked: canplay event never fires
- ❌ Blocked: Canvas never draws frames