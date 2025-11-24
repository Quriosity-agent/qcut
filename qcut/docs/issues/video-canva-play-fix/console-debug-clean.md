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
