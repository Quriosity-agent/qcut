# Canvas Video Playback Debug - Clean Console Analysis

## Purpose
Track why the canvas preview still shows a static frame instead of playing video.

## Current Status
**The canplay listener churn is fixed, but the active playback blob URL is still revoked before the video reaches readyState 3, so `canplay` never fires and the video never plays.**

## Evidence (consolev10)
- Play click logs once: `[CANVAS-VIDEO] Video not ready, waiting for canplay event (rs=0)`.
- Active playback blob `blob:...7b6954b7...` revoked after ~12.3s (shows both tracked and `Revoked untracked`), followed by repeated `ERR_FILE_NOT_FOUND` while buffering.
- `canplay` / `play() succeeded` never appear; listener is cleaned up only when playback is paused at ~0.516s.
- Earlier blob `blob:...61f43f64...` revoked in ~188ms and also 404s.
- New instrumentation: global `URL.revokeObjectURL` is now wrapped through the blob manager; look for `[BlobUrlDebug] Routed revoke via BlobManager guard` to confirm revokes are guarded.

```
[PLAYBACK] Play/Pause button clicked (action: play)
[CANVAS-VIDEO] Video not ready, waiting for canplay event (rs=0)
[BlobUrlDebug] Revoked: blob:...7b6954b7... (lifespan ~12330ms)
[BlobUrlDebug] Revoked untracked: blob:...7b6954b7...
GET blob:...7b6954b7... net::ERR_FILE_NOT_FOUND
[CANVAS-VIDEO] Cleaned up canplay listener (on pause)
```

## Relevant Code Snapshot (current main)
- `apps/web/src/components/ui/video-player.tsx`: play effect depends on `isPlaying` + clip range (no `currentTime`), so `{ once: true }` `canplay` listener survives; active blob marked in-use via blob manager; revoked on src change/unmount.
- `apps/web/src/components/editor/preview-panel.tsx`: memoizes video sources via `getVideoSource`; revokes only non-active blob URLs on cleanup through blob manager.
- `apps/web/src/lib/blob-manager.ts`: tracks blobs and skips revocation when marked in-use; `blob-url-debug.ts` logs untracked native revokes as "Revoked untracked".
- `apps/web/src/components/providers/migrators/blob-url-cleanup.tsx`: uses `runOnceRef` + sessionStorage guard but **missing `useRef` import**; logs "Starting blob URL cleanup migration..." twice under StrictMode, so cleanup may still run twice.
- Repo-wide direct `URL.revokeObjectURL` calls remain (e.g., `multi-image-upload.tsx`, `effect-templates-panel.tsx`, `ffmpeg-utils.ts`, `export-engine.ts`, `adjustment-store.ts`, `media-panel/video-edit-audio-sync.tsx`, etc.), matching the "Revoked untracked" noise seen in `consolev10`.

## Root Cause
Active playback blob URLs are still being revoked (often via untracked native revokes) while the video is buffering, keeping readyState at 0 and preventing `canplay` from ever firing.

## Required Fixes
1) Route all blob revocations through the blob manager (or wrap global `URL.revokeObjectURL`) so the in-use guard can block active playback blobs; eliminate "Revoked untracked" during playback.  
2) Ensure cleanup paths (preview cleanup, migrations, storage cleanup) always skip the active playback blob.  
3) Fix blob cleanup migrator to actually run once: import `useRef`, keep the run-once + session guard StrictMode-safe, and avoid touching any active blob.  
4) Re-test playback; expect `canplay` → `play() succeeded` without any `ERR_FILE_NOT_FOUND` for the active blob.

## Success Criteria
```
[CANVAS-VIDEO] Video not ready, waiting for canplay event
// ... 100–500ms ...
[CANVAS-VIDEO] canplay event fired, attempting play
[CANVAS-VIDEO] play() succeeded
step 13: drawing to canvas { frameDrawn: true }
```
And no `ERR_FILE_NOT_FOUND` for the active blob until playback stops.

## Debug Checklist
- [x] Play effect no longer tied to `currentTime` (listener survives)
- [ ] Active playback blob never revoked mid-buffer (no `ERR_FILE_NOT_FOUND`)
- [ ] `canplay` event fires
- [ ] `play()` succeeds
- [ ] Canvas draws frames
- [ ] Video actually plays

## How to Repro
1) Run the app (e.g., `bun dev`) and open the editor preview.  
2) Load a video clip, scrub inside the clip, and click Play.  
3) Observe console: single "Video not ready" log, then blob `ERR_FILE_NOT_FOUND` spam for the active src; readyState stays 0; `canplay` never appears.

## How to Verify the Fix
- Play in-clip and see `Video not ready` followed by `canplay event fired` and `play() succeeded` within ~0.5s.  
- No `ERR_FILE_NOT_FOUND` for the active blob during buffering/playing.  
- `step 13: drawing to canvas { frameDrawn: true }` appears and the video renders on canvas.

## Next Step
- Trace and guard remaining revokes: instrument `media-store` and other direct `URL.revokeObjectURL` call sites to route through the blob manager and log `[CANVAS-VIDEO] Guarded revoke` when a revoke is skipped due to active playback; re-run playback to confirm no `ERR_FILE_NOT_FOUND` appears before `canplay`/`play() succeeded`.

---

## Detailed File Paths and Code Lines Causing Premature Blob Revocation

### 1. **preview-panel.tsx** (Lines 625-633) - PRIMARY SUSPECT
**File**: `apps/web/src/components/editor/preview-panel.tsx`

```typescript
// Lines 625-633
const activeBlobUrl =
  activeVideoSource?.type === "blob" ? activeVideoSource.src : null;

useEffect(() => {
  const urlsToRevoke = videoBlobUrls.filter((url) => url !== activeBlobUrl);
  return () => {
    urlsToRevoke.forEach((url) => revokeManagedObjectURL(url));  // LINE 631
  };
}, [videoBlobUrls, activeBlobUrl]);  // LINE 633
```

**Issue**: This cleanup effect triggers whenever `videoBlobUrls` or `activeBlobUrl` changes. The effect revokes all blob URLs except the currently active one. However, during component re-renders or state updates, this can prematurely revoke blobs that are still needed for buffering or playback.

**Why it causes the problem**:
- When videoBlobUrls array changes (e.g., new blob created), the cleanup runs
- Blobs that were previously active but no longer in the `activeBlobUrl` get revoked immediately
- Video elements may still be buffering these URLs, leading to `ERR_FILE_NOT_FOUND`

---

### 2. **video-player.tsx** (Lines 181-202) - AGGRESSIVE CLEANUP
**File**: `apps/web/src/components/ui/video-player.tsx`

```typescript
// Lines 181-202
useEffect(() => {
  const prev = previousSrcRef.current;
  if (prev && prev !== src && prev.startsWith("blob:")) {
    unmarkBlobInUse(prev);
    revokeManagedObjectURL(prev);  // LINE 185 - Revokes previous blob
  }

  previousSrcRef.current = src;

  if (src.startsWith("blob:")) {
    markBlobInUse(src);
  }

  return () => {
    if (previousSrcRef.current?.startsWith("blob:")) {
      const url = previousSrcRef.current;
      unmarkBlobInUse(url);
      revokeManagedObjectURL(url);  // LINE 198 - Cleanup on unmount
      previousSrcRef.current = null;
    }
  };
}, [src]);
```

**Issue**: Aggressively revokes blobs when src changes or component unmounts.

**Why it causes the problem**:
- When `src` prop changes, the previous blob is immediately revoked (line 185)
- Video element may not have finished buffering the previous blob yet
- Component unmount cleanup (line 198) revokes blob even if video is mid-playback
- The timing between src changes and video buffering is not coordinated

---

### 3. **media-store.ts** - MULTIPLE REVOCATION POINTS
**File**: `apps/web/src/stores/media-store.ts`

**Critical revocation locations**:
```typescript
// Line 78 - In processVideoFile function
revokeObjectURL(blobUrl);

// Line 188 - In getMediaDuration function
revokeObjectURL(blobUrl);

// Line 270 - In addMediaItem function
revokeObjectURL(blobUrl!);

// Line 547 - In removeMediaItem function
revokeObjectURL(item.url);

// Line 684 - In clearProjectMedia function
revokeObjectURL(item.url);

// Line 738 - In reset function
revokeObjectURL(item.url);
```

**Issue**: Multiple places where blob URLs are revoked without checking if they're actively being used for playback.

**Why it causes the problem**:
- `processVideoFile` and `getMediaDuration` create temporary blobs and revoke them after processing
- If these temporary blobs are the same as playback blobs (due to timing), they get revoked mid-playback
- `removeMediaItem` and `clearProjectMedia` don't check if blob is currently playing before revoking

---

### 4. **blob-manager.ts** (Lines 64-95) - CENTRAL REVOCATION LOGIC
**File**: `apps/web/src/lib/blob-manager.ts`

```typescript
// Lines 64-95
revokeObjectURL(url: string): void {
  const blob = this.blobRegistry.get(url);

  if (!blob) {
    // Untracked blob - revoke directly
    console.log("[BlobManager] 🔴 Revoked untracked:", url);
    URL.revokeObjectURL(url);  // LINE 95 - UNTRACKED REVOCATION
    return;
  }

  // Check if blob is marked as in-use
  if (this.inUseBlobUrls.has(url)) {
    console.log("[BlobManager] ⚠️ Skipping revoke (blob in use):", url);
    return;
  }

  // Track revocation
  console.log("[BlobManager] 🔴 Revoked:", url);
  URL.revokeObjectURL(url);  // LINE 91 - TRACKED REVOCATION
  this.blobRegistry.delete(url);
}
```

**Issue**: Even with in-use tracking, blobs can still be revoked if not properly marked.

**Why it causes the problem**:
- Relies on `markBlobInUse()` being called before playback - timing issues can cause blobs to be unmarked
- "Untracked" blobs (created outside blob manager) bypass all guards and get revoked immediately
- Race condition: blob may be unmarked just before revocation check happens

---

### 5. **Direct URL.revokeObjectURL Calls** - BYPASSING BLOB MANAGER

**Files with direct revocations that bypass blob manager**:

1. **adjustment-store.ts**
   - Lines: 192, 207, 210, 227, 330, 334
   - Context: Image editing and adjustment operations

2. **export-engine-cli.ts**
   - Lines: 266, 282, 285, 292, 2184, 2191
   - Context: Video export operations

3. **ffmpeg-utils.ts**
   - Lines: 409, 410, 431, 432
   - Context: FFmpeg WASM core loading

4. **media-panel/video-edit-audio-sync.tsx**
   - Lines: 85, 89
   - Context: Audio synchronization

5. **effect-templates-panel.tsx**
   - Line: 126
   - Context: Effect template previews

6. **multi-image-upload.tsx**
   - Line: 50
   - Context: Image upload cleanup

**Issue**: These direct `URL.revokeObjectURL()` calls completely bypass the blob manager's in-use tracking.

**Why it causes the problem**:
- No in-use check performed
- Can revoke blobs that are actively playing in video elements
- Shows up as "Revoked untracked" in logs
- Cannot be prevented by blob manager guards

---

## Summary of Revocation Flow

```
Video Playback Attempt
  ↓
Blob URL Created (via blob-manager or storage-service)
  ↓
Blob Assigned to Video Element (src property)
  ↓
Video Element Starts Buffering (readyState: 0 → 1 → 2 → 3)
  ↓
🔴 PROBLEM: Blob Revoked Here (by one of the mechanisms above)
  ↓
Video Element: ERR_FILE_NOT_FOUND
  ↓
readyState Stuck at 0
  ↓
canplay Event Never Fires
  ↓
play() Never Succeeds
  ↓
Canvas Shows Static Image
```

---

## Fix Priority Order

1. **HIGH PRIORITY**: Fix preview-panel.tsx (line 631) - Most direct impact
2. **HIGH PRIORITY**: Guard direct URL.revokeObjectURL calls in media-store.ts
3. **MEDIUM PRIORITY**: Improve video-player.tsx cleanup timing
4. **MEDIUM PRIORITY**: Route all direct revokes through blob-manager
5. **LOW PRIORITY**: Add additional safety checks in blob-manager.ts

---

## Alternative Solution: Using File Objects Directly (User's Suggestion)

### Question
"If the video is uploaded to media it should have local path can we use that?"

### Answer
✅ **Yes - we already have access to the File object, but not traditional local filesystem paths.**

### Current Architecture
- **MediaItem** contains `file: File` property (actual file data stored in OPFS)
- **Storage**: Files stored in Origin Private File System (OPFS) via `storage-service.ts`
- **Access**: File objects available but no direct filesystem paths (browser security restriction)

### Why Traditional Local Paths Won't Work
1. **Web Security**: Browsers don't expose real filesystem paths from user uploads
2. **OPFS**: Virtual filesystem, not actual OS filesystem
3. **File API**: `File` objects don't expose `file://` URLs in browser environment

### Proposed Solution: Lazy Blob URL Creation
Instead of creating blob URLs early and managing complex lifecycle:

**Strategy: Create blob URLs just-in-time and keep them alive during playback**

```typescript
// Current (problematic):
// 1. Create blob URL early in getVideoSource()
// 2. Pass blob URL to video-player
// 3. Blob gets revoked while video still buffering
// 4. ERR_FILE_NOT_FOUND

// Proposed (stable):
// 1. Pass File object to video-player (not blob URL)
// 2. Create blob URL when video.src is set
// 3. Keep blob URL alive until canplay/playing event
// 4. Only revoke after playback stops
```

### Implementation Points
1. **media-source.ts**: Return File object instead of blob URL
2. **video-player.tsx**: Create blob URL from File when needed, revoke after successful play
3. **preview-panel.tsx**: Remove aggressive cleanup effect (lines 628-633)
4. **Blob lifecycle**: Tied to video element state, not component re-renders

### Benefits
- Eliminates premature revocation (root cause of ERR_FILE_NOT_FOUND)
- Blob URLs only exist during active playback
- File objects are stable and don't expire
- Simpler mental model: File → blob URL → play → revoke

### File Access Pattern
```typescript
// MediaItem structure
interface MediaItem {
  id: string;
  file: File;           // ✅ We have this!
  url?: string;         // Blob URL (temporary)
  // ...
}

// Proposed flow
function VideoPlayer({ file }: { file: File }) {
  const blobUrlRef = useRef<string | null>(null);

  // Create blob URL only when needed
  useEffect(() => {
    if (!file) return;

    blobUrlRef.current = URL.createObjectURL(file);
    videoRef.current.src = blobUrlRef.current;

    // Revoke only after successful playback or component unmount
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, [file]);
}
```
