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

## Implementation Review (current code changes)
- Global `URL.revokeObjectURL` now routes through blob manager; see `[BlobUrlDebug] Routed revoke via BlobManager guard` and `[BlobManager] Skip revoke (in use)` to confirm the guard is engaged.
- `blob-url-cleanup` migrator logs when it is skipped under StrictMode, reducing double-run risk.
- Recursion guard added so the revoke override calls the captured native revoke instead of itself.
- Outstanding gap: direct `URL.revokeObjectURL` call sites (e.g., media-store) still bypass the guard and are likely revoking the active playback blob; these must be routed through blob manager with an in-use check.
- Progress (today): BlobManager revoke now emits `[CANVAS-VIDEO] Guarded revoke (skipped; in use): …` and returns a boolean; blob-url-debug routes revokes through the manager with a context tag. Media-store now funnels revokes through a helper that passes context, and audio-sync / effect-templates / multi-image-upload call sites now use the manager so the guard log will fire if blocked.
- Progress (Subtask 1): `media-source.ts` now returns `{ file, type: "file" }` for local media (lazy blob creation); remote source whitelist unchanged. Downstream call sites still need to be updated to use the File-based source.
- Progress (Subtask 2): `preview-panel.tsx` now memoizes video sources without creating blob URLs and passes `videoSource={source}` into `VideoPlayer` (no blob revocation effect).
- Progress (Subtask 3): `video-player.tsx` now accepts `videoSource` and lazily creates/revokes blob URLs inside the component (logs creation/revoke), removing mark/unmark/revoke calls and the `src` prop.

## Next Step
- Finish routing the remaining raw `URL.revokeObjectURL` call sites (e.g., `adjustment-store`, `export-engine`, `ffmpeg-utils`, `image-utils`, `canvas-utils`, `use-export-progress`, `caption-export`, `zip-manager`, `media-processing`) through the blob manager with context so the `[CANVAS-VIDEO] Guarded revoke (skipped; in use)` log appears when a revoke is blocked for the active playback blob. Re-run playback and confirm you see the guard log (or a tracked revoke), and that no `ERR_FILE_NOT_FOUND` appears before `canplay`/`play() succeeded`.
- Update downstream consumers (preview-panel, video-player, etc.) to accept `{ file, type: "file" }` sources and create/revoke blob URLs lazily at the component boundary.

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

### Implementation Subtasks

**All file paths and line numbers have been verified ✅** (2025-11-24)

**Implementation Order**: Follow subtasks 1→2→3→4→5 sequentially. Each subtask builds on the previous one.

**Estimated Effort**:
- Subtask 1: 10 minutes (simple deletions)
- Subtask 2: 15 minutes (delete cleanup logic)
- Subtask 3: 30 minutes (refactor video player)
- Subtask 4: 5 minutes (update 2 call sites)
- Subtask 5: Optional (skip for now)
- **Total: ~1 hour** for core fix

---

#### Subtask 1: Modify `media-source.ts` - Return File Object with Lazy URL Creation

**File**: `apps/web/src/lib/media-source.ts` ✅ **Verified**

**Current Code** (lines 1-60):
```typescript
// Line 1: Import that will be removed
import { createObjectURL } from "@/lib/blob-manager";

// Line 3-4: Constants
const CSP_ALLOWED = new Set(["fal.media", "v3.fal.media", "v3b.fal.media"]);
const fileBlobCache = new WeakMap<File, string>();  // ❌ DELETE THIS

// Lines 6-9: Current type definition
export type VideoSource =
  | { src: string; type: "blob" }    // ❌ REPLACE
  | { src: string; type: "remote" }
  | null;

// Lines 29-37: Current function implementation
export function getVideoSource(mediaItem: { file?: File; url?: string }): VideoSource {
  if (mediaItem.file) {
    const cached = fileBlobCache.get(mediaItem.file);     // ❌ DELETE
    if (cached) {                                          // ❌ DELETE
      return { src: cached, type: "blob" };               // ❌ DELETE
    }                                                      // ❌ DELETE
    const url = createObjectURL(mediaItem.file, "media-source:getVideoSource"); // ❌ DELETE
    fileBlobCache.set(mediaItem.file, url);               // ❌ DELETE
    return { src: url, type: "blob" };                    // ❌ DELETE
  }

  if (mediaItem.url) {
    // Lines 40-56: Remote URL handling - KEEP UNCHANGED
  }

  console.warn("[media-source] No playable source available...");
  return null;
}
```

**New Code**:
```typescript
// Line 1: REMOVE this import entirely
// import { createObjectURL } from "@/lib/blob-manager";  // ❌ DELETE

// Line 3: KEEP
const CSP_ALLOWED = new Set(["fal.media", "v3.fal.media", "v3b.fal.media"]);
// Line 4: DELETE
// const fileBlobCache = new WeakMap<File, string>();  // ❌ DELETE

// Lines 6-9: NEW type definition
export type VideoSource =
  | { file: File; type: "file" }     // ✅ NEW: Return File instead of blob URL
  | { src: string; type: "remote" }  // ✅ KEEP: Remote URLs unchanged
  | null;

// Simplified function (remove JSDoc comment about blob URLs - lines 11-28)
export function getVideoSource(mediaItem: { file?: File; url?: string }): VideoSource {
  if (mediaItem.file) {
    return { file: mediaItem.file, type: "file" };  // ✅ NEW: Single line!
  }

  if (mediaItem.url) {
    // Lines 40-56: Remote URL handling - KEEP UNCHANGED
    try {
      const hostname = new URL(mediaItem.url).hostname;
      if (CSP_ALLOWED.has(hostname)) {
        return { src: mediaItem.url, type: "remote" };
      }
    } catch { }
  }

  return null;
}
```

**Exact Changes**:
- **DELETE Line 1**: `import { createObjectURL } from "@/lib/blob-manager";`
- **DELETE Line 4**: `const fileBlobCache = new WeakMap<File, string>();`
- **DELETE Lines 11-28**: JSDoc comment about blob URL lifecycle
- **MODIFY Line 7**: Change `{ src: string; type: "blob" }` to `{ file: File; type: "file" }`
- **DELETE Lines 31-37**: Replace 7 lines with 1 line: `return { file: mediaItem.file, type: "file" };`
- **KEEP Lines 40-60**: Remote URL handling unchanged

**Why Long-term > Short-term**:
- **Long-term**: File objects are stable references; no lifecycle management needed. Scales to hundreds of videos without memory leaks.
- **Short-term pain avoided**: Removes complex caching logic and WeakMap management. Single source of truth for video data.
- **Maintainability**: Future developers don't need to understand blob URL lifecycle; File objects are familiar and self-documenting.
- **Code reduction**: 60 lines → 25 lines (58% less code to maintain)

---

#### Subtask 2: Update `preview-panel.tsx` - Pass File Objects Instead of Blob URLs

**File**: `apps/web/src/components/editor/preview-panel.tsx` ✅ **Verified**

**Current Code** (lines 596-633):
```typescript
// Lines 596-618: Video sources memoization (SIMPLIFY THIS)
const { videoSourcesById, videoBlobUrls } = useMemo(() => {
  const sources = new Map<string, ReturnType<typeof getVideoSource>>();
  const blobUrls: string[] = [];  // ❌ DELETE
  let videoCount = 0;
  let missingSourceIds: string[] = [];

  mediaItems.forEach((item) => {
    if (item.type === "video") {
      videoCount += 1;
      const source = getVideoSource(item);
      sources.set(item.id, source);
      if (source?.type === "blob") {        // ❌ DELETE: Will be "file" now
        blobUrls.push(source.src);          // ❌ DELETE
      }
      if (!source) {
        missingSourceIds.push(item.id);
      }
    }
  });

  return { videoSourcesById: sources, videoBlobUrls: blobUrls };  // ❌ CHANGE
}, [mediaItems]);

// Lines 621-626: Active blob URL calculation (DELETE THIS)
const activeVideoSource =
  currentMediaElement && currentMediaElement.mediaItem?.id
    ? videoSourcesById.get(currentMediaElement.mediaItem.id) ?? null
    : null;
const activeBlobUrl =
  activeVideoSource?.type === "blob" ? activeVideoSource.src : null;  // ❌ DELETE

// Lines 628-633: ⚠️ PRIMARY REVOCATION CULPRIT - DELETE ENTIRE BLOCK
useEffect(() => {
  const urlsToRevoke = videoBlobUrls.filter((url) => url !== activeBlobUrl);
  return () => {
    urlsToRevoke.forEach((url) => revokeManagedObjectURL(url));  // ❌ This revokes blobs prematurely!
  };
}, [videoBlobUrls, activeBlobUrl]);
```

**New Code**:
```typescript
// Lines 596-618: Simplified video sources memoization
const videoSourcesById = useMemo(() => {
  const sources = new Map<string, ReturnType<typeof getVideoSource>>();
  let missingSourceIds: string[] = [];

  mediaItems.forEach((item) => {
    if (item.type === "video") {
      const source = getVideoSource(item);
      sources.set(item.id, source);
      if (!source) {
        missingSourceIds.push(item.id);
      }
    }
  });

  return sources;  // ✅ SIMPLIFIED: Only return sources map
}, [mediaItems]);

// ❌ DELETE Lines 621-626: activeBlobUrl calculation - no longer needed

// ❌ DELETE Lines 628-633: Entire cleanup effect - THIS FIXES THE BUG!
```

**Exact Changes**:
- **Line 599**: DELETE `const blobUrls: string[] = [];`
- **Lines 608-610**: DELETE blob URL collection:
  ```typescript
  if (source?.type === "blob") {
    blobUrls.push(source.src);
  }
  ```
- **Line 617**: CHANGE return value from `{ videoSourcesById: sources, videoBlobUrls: blobUrls }` to just `sources`
- **Line 596**: CHANGE destructuring from `const { videoSourcesById, videoBlobUrls } = useMemo(` to `const videoSourcesById = useMemo(`
- **Lines 621-626**: DELETE entire `activeBlobUrl` calculation block
- **Lines 628-633**: ⚠️ **DELETE ENTIRE useEffect** - This is the root cause of premature revocations!

**Why Long-term > Short-term**:
- **Long-term**: Removes the root cause of premature revocations. No more race conditions between component re-renders and video buffering.
- **Prevents future bugs**: Eliminates an entire class of timing-related bugs. Fewer useEffect dependencies = fewer unexpected re-runs.
- **Performance**: Reduces unnecessary effect executions on every render. Memory pressure decreases as blob URLs aren't created en masse.
- **Debugging**: Simpler code path makes it easier to trace where video sources come from.

---

#### Subtask 3: Refactor `video-player.tsx` - Lazy Blob URL Creation

**File**: `apps/web/src/components/ui/video-player.tsx` ✅ **Verified**

**Current Code**:
```typescript
// Lines 1-8: Current imports
"use client";
import { useRef, useEffect } from "react";
import {
  markBlobInUse,                              // ❌ DELETE import
  revokeObjectURL as revokeManagedObjectURL,  // ❌ DELETE import
  unmarkBlobInUse,                            // ❌ DELETE import
} from "@/lib/blob-manager";
import { usePlaybackStore } from "@/stores/playback-store";

// Lines 11-21: Current props interface
interface VideoPlayerProps {
  videoId?: string;
  src: string;           // ❌ CHANGE to videoSource: VideoSource
  poster?: string;
  className?: string;
  style?: React.CSSProperties;
  clipStartTime: number;
  trimStart: number;
  trimEnd: number;
  clipDuration: number;
}

// Line 35: Current ref
const previousSrcRef = useRef<string | null>(null);  // ❌ DELETE

// Lines 181-202: Video source tracking effect - DELETE ENTIRE BLOCK
useEffect(() => {
  const prev = previousSrcRef.current;
  if (prev && prev !== src && prev.startsWith("blob:")) {
    unmarkBlobInUse(prev);                    // ❌ DELETE
    revokeManagedObjectURL(prev);             // ❌ DELETE
  }

  previousSrcRef.current = src;

  if (src.startsWith("blob:")) {
    markBlobInUse(src);                       // ❌ DELETE
  }

  return () => {
    if (previousSrcRef.current?.startsWith("blob:")) {
      const url = previousSrcRef.current;
      unmarkBlobInUse(url);                   // ❌ DELETE
      revokeManagedObjectURL(url);            // ❌ DELETE
      previousSrcRef.current = null;
    }
  };
}, [src]);

// Line 207: Current video element
<video
  ref={videoRef}
  src={src}                 // ❌ CHANGE: will be set in useEffect
  poster={poster}
  className={`object-contain ${className}`}
  ...
/>
```

**New Code**:
```typescript
// Lines 1-8: New imports
"use client";
import { useRef, useEffect } from "react";
import { usePlaybackStore } from "@/stores/playback-store";
import type { VideoSource } from "@/lib/media-source";  // ✅ NEW import

// Lines 11-21: New props interface
interface VideoPlayerProps {
  videoId?: string;
  videoSource: VideoSource;  // ✅ CHANGED from src: string
  poster?: string;
  className?: string;
  style?: React.CSSProperties;
  clipStartTime: number;
  trimStart: number;
  trimEnd: number;
  clipDuration: number;
}

// Inside component:
export function VideoPlayer({ videoSource, videoId, ... }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const blobUrlRef = useRef<string | null>(null);  // ✅ NEW: Track our created blob URL
  const { isPlaying, currentTime, volume, speed, muted } = usePlaybackStore();

  // ✅ NEW: Lazy blob URL creation effect (insert after other effects, around line 180)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSource) return;

    if (videoSource.type === "file") {
      // Create blob URL just-in-time from File object
      const blobUrl = URL.createObjectURL(videoSource.file);
      blobUrlRef.current = blobUrl;
      video.src = blobUrl;

      console.log(`[VideoPlayer] Created blob URL for ${videoId}:`, blobUrl);

      // Cleanup: revoke only when component unmounts or source changes
      return () => {
        if (blobUrlRef.current) {
          console.log(`[VideoPlayer] Revoking blob URL for ${videoId}:`, blobUrlRef.current);
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
    } else if (videoSource?.type === "remote") {
      // Remote URLs used directly
      video.src = videoSource.src;
    }

    return () => {
      if (video) {
        video.src = "";
      }
    };
  }, [videoSource, videoId]);

  // ❌ DELETE: Old blob tracking effect (lines 181-202)

  return (
    <video
      ref={videoRef}
      // ❌ REMOVE: src={src}  // Src is now set in useEffect
      poster={poster}
      className={`object-contain ${className}`}
      style={style}
      ...
    />
  );
}
```

**Exact Changes**:
- **Lines 4-8**: DELETE imports of `markBlobInUse`, `revokeManagedObjectURL`, `unmarkBlobInUse`
- **Line 4**: ADD `import type { VideoSource } from "@/lib/media-source";`
- **Line 13**: CHANGE `src: string` to `videoSource: VideoSource`
- **Line 23**: CHANGE param from `src` to `videoSource`
- **Line 35**: DELETE `const previousSrcRef = useRef<string | null>(null);`
- **Line 35**: ADD `const blobUrlRef = useRef<string | null>(null);` (new ref for our blob)
- **Lines 181-202**: DELETE entire old blob tracking effect
- **After line 180**: ADD new lazy blob creation effect (see above)
- **Line 207**: REMOVE `src={src}` prop from `<video>` element

**Why Long-term > Short-term**:
- **Long-term**: Video player owns its resources. Clear responsibility: "I create, I destroy." Future refactors won't accidentally break blob lifecycle.
- **Simplicity**: Removes dependency on external blob-manager guards. Native browser `URL.createObjectURL` is more predictable than custom tracking.
- **Testability**: Self-contained lifecycle is easier to unit test. Mock File objects, verify blob creation/revocation sequence.
- **Scalability**: Works correctly with React 18 Concurrent Mode, Suspense, and future React features. No hidden global state.
- **Clear ownership**: Blob URL lifetime exactly matches component lifetime. No guessing when it's safe to revoke.

---

#### Subtask 4: Update VideoPlayer Call Sites in `preview-panel.tsx`

**File**: `apps/web/src/components/editor/preview-panel.tsx` ✅ **Verified**

**Found 2 VideoPlayer usages** (verified via grep):

**Location 1: Lines 684-698 - Blur Background Layer**
```typescript
// CURRENT:
<VideoPlayer
  videoId={`${mediaItem.id}-blur-background`}
  src={source.src}           // ❌ CHANGE
  poster={mediaItem.thumbnailUrl}
  clipStartTime={element.startTime}
  trimStart={element.trimStart}
  trimEnd={element.trimEnd}
  clipDuration={element.duration}
  className="object-cover"
  style={
    EFFECTS_ENABLED && element.id === currentMediaElement?.element.id
      ? { filter: filterStyle }
      : undefined
  }
/>

// NEW:
<VideoPlayer
  videoId={`${mediaItem.id}-blur-background`}
  videoSource={source}       // ✅ CHANGED: Pass VideoSource object
  poster={mediaItem.thumbnailUrl}
  clipStartTime={element.startTime}
  trimStart={element.trimStart}
  trimEnd={element.trimEnd}
  clipDuration={element.duration}
  className="object-cover"
  style={
    EFFECTS_ENABLED && element.id === currentMediaElement?.element.id
      ? { filter: filterStyle }
      : undefined
  }
/>
```

**Location 2: Lines 853-863 - Main Video Layer**
```typescript
// CURRENT:
<VideoPlayer
  src={source.src}           // ❌ CHANGE
  poster={mediaItem.thumbnailUrl}
  clipStartTime={element.startTime}
  trimStart={element.trimStart}
  trimEnd={element.trimEnd}
  clipDuration={element.duration}
  className="object-cover"
  videoId={mediaItem.id}
  style={filterValue ? { filter: filterValue } : undefined}
/>

// NEW:
<VideoPlayer
  videoSource={source}       // ✅ CHANGED: Pass VideoSource object
  poster={mediaItem.thumbnailUrl}
  clipStartTime={element.startTime}
  trimStart={element.trimStart}
  trimEnd={element.trimEnd}
  clipDuration={element.duration}
  className="object-cover"
  videoId={mediaItem.id}
  style={filterValue ? { filter: filterValue } : undefined}
/>
```

**Exact Changes**:
- **Line 686**: CHANGE `src={source.src}` to `videoSource={source}`
- **Line 854**: CHANGE `src={source.src}` to `videoSource={source}`

**Additional Updates Needed**:
Update null/conditional checks for sources:
```typescript
// Find patterns like:
if (!source) {
  return <div>No available video source</div>;
}

// No change needed - source itself being null/undefined is still valid check
// The type system will ensure source.type is checked when accessing properties
```

**Why Long-term > Short-term**:
- **Type safety**: TypeScript will catch incorrect VideoSource usage at compile time. Runtime errors become compile errors.
- **Consistency**: All video players use the same interface. Easy to add new video players without repeating blob logic.
- **Refactoring safety**: Renaming/moving VideoPlayer won't break blob lifecycle. Component interface is self-documenting.
- **Minimal changes**: Only 2 prop names to change across the entire file.

---

#### Subtask 5: Remove Blob Manager In-Use Tracking (Optional Cleanup)

**File**: `apps/web/src/lib/blob-manager.ts` ✅ **Verified**

**Current Code** (lines 15-115):
```typescript
// Line 16: Current blob registry
class BlobManager {
  private blobs = new Map<string, BlobEntry>();
  private cleanupInterval: number | null = null;

  // Line 19: In-use tracking Set
  private inUseUrls = new Set<string>();  // ❌ OPTIONAL DELETE

  // Lines 104-107: markInUse method
  markInUse(url: string): void {           // ❌ OPTIONAL DELETE
    if (!url.startsWith("blob:")) return;
    this.inUseUrls.add(url);
  }

  // Lines 109-115: unmarkInUse method
  unmarkInUse(url: string): void {         // ❌ OPTIONAL DELETE
    if (!url.startsWith("blob:")) return;
    this.inUseUrls.delete(url);
  }

  // Lines 66-99: revokeObjectURL with in-use guard
  revokeObjectURL(url: string): void {
    // Lines 67-72: In-use check
    if (this.inUseUrls.has(url)) {         // ❌ OPTIONAL DELETE
      if (import.meta.env.DEV) {
        console.log(`[BlobManager] ⏸ Skip revoke (in use): ${url}`);
      }
      return;
    }

    if (this.blobs.has(url)) {
      const entry = this.blobs.get(url);
      // ... logging code (KEEP)
      nativeRevokeObjectURL(url);          // ✅ KEEP
      this.blobs.delete(url);              // ✅ KEEP
    } else {
      nativeRevokeObjectURL(url);          // ✅ KEEP
    }
  }

  // Lines 37-61: createObjectURL (KEEP - still useful)
  createObjectURL(file: File | Blob, source?: string): string {
    const url = URL.createObjectURL(file);
    this.blobs.set(url, { url, file, createdAt: Date.now(), source });
    // ... logging (KEEP)
    return url;
  }
}

// Lines 194-200: Exported helper functions
export const markBlobInUse = (url: string): void => {    // ❌ OPTIONAL DELETE
  blobManager.markInUse(url);
};

export const unmarkBlobInUse = (url: string): void => {  // ❌ OPTIONAL DELETE
  blobManager.unmarkInUse(url);
};
```

**Option A: Full Cleanup (Recommended)**
```typescript
// DELETE:
- Line 19: `private inUseUrls = new Set<string>();`
- Lines 67-72: In-use guard in revokeObjectURL
- Lines 104-115: markInUse() method
- Lines 194-200: Export statements for markBlobInUse/unmarkBlobInUse

// RESULT: Simple tracking-only blob manager
class BlobManager {
  private blobs = new Map<string, BlobEntry>();

  createObjectURL(file: File | Blob, source?: string): string {
    const url = URL.createObjectURL(file);
    this.blobs.set(url, { url, file, createdAt: Date.now(), source });
    console.log(`[BlobManager] 🟢 Created: ${url}`);
    return url;
  }

  revokeObjectURL(url: string): void {
    if (this.blobs.has(url)) {
      console.log(`[BlobManager] 🔴 Revoked: ${url}`);
      URL.revokeObjectURL(url);
      this.blobs.delete(url);
    } else {
      URL.revokeObjectURL(url);
    }
  }
}
```

**Option B: Keep for Non-Video Blobs (Conservative)**
- Keep all in-use tracking code
- Used for image thumbnails, audio waveforms, etc.
- No changes needed to blob-manager.ts
- Just don't call `markBlobInUse`/`unmarkBlobInUse` from video-player anymore

**Recommendation**: **Option B (Keep)** for now
- Other parts of codebase may still rely on in-use tracking
- Video player changes already solve the problem
- Can clean up later after verifying no other uses

**Why Long-term > Short-term**:
- **Long-term**: Simplifies blob-manager to do one thing well: track creation for debugging. No complex state management.
- **Less cognitive load**: Fewer concepts for developers to understand. "Create blob, use it, revoke it" is simpler than "Create, mark in-use, unmark, guard revoke."
- **Future-proof**: Easier to replace blob-manager entirely if needed. Less coupling to specific use cases.
- **Safe approach**: Option B allows gradual migration. Option A is cleaner but requires auditing all blob-manager usage.

---

### Benefits Summary

**Long-term Architectural Wins**:
1. **Eliminates premature revocation** (root cause of ERR_FILE_NOT_FOUND)
2. **Single responsibility**: VideoPlayer owns its blob URLs, not scattered across 5 files
3. **Predictable lifecycle**: File → create blob → play → revoke (clear, linear flow)
4. **Type safety**: VideoSource union type prevents passing wrong data
5. **Testability**: Each component can be unit tested independently
6. **Scalability**: Works with 1 video or 1000 videos without memory leaks
7. **React-compatible**: No fighting React's re-render model with useEffect cleanup races

**vs. Short-term Band-aids**:
- ❌ Adding more blob-manager guards → More complexity, harder to debug
- ❌ Tweaking useEffect dependencies → Fragile, breaks with future React updates
- ❌ Adding delay timers → Unreliable, doesn't fix root cause
- ✅ **This refactor**: Removes the problem entirely by changing ownership model

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
