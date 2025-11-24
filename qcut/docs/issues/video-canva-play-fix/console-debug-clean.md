# Canvas Video Playback Debug - Clean Console Analysis

## Purpose
Identify why canvas is displaying a static image instead of playing video.

## Key Finding
**Active video blob URLs are still being revoked before the element reaches readyState 3, so `canplay` never fires (the 60fps canplay-listener churn is fixed).**

## Evidence (code + console)
- `apps/web/src/components/ui/video-player.tsx`: play effect now depends on `isPlaying` + clip range (no `currentTime`), so the `{ once: true }` `canplay` listener stays attached until teardown.
- `consolev10.md`: after Play, only one `Video not ready (rs=0)` log appears; there is never a `canplay`/`play() succeeded`; `Cleaned up canplay listener` fires once when pause happens at ~0.516s.
- `consolev10.md`: active playback blob `blob:...7b6954b7...` is revoked (tracked + "Revoked untracked") after ~12.3s and then spammed with `ERR_FILE_NOT_FOUND` while the video is buffering; earlier blob `blob:...61f43f64...` is revoked in ~188ms and also 404s.
- `apps/web/src/components/providers/migrators/blob-url-cleanup.tsx`: logs "Starting blob URL cleanup migration..." twice per load (StrictMode double-run), so cleanup may still execute more than once.

---

## Current Console Pattern (consolev10)

```
[PLAYBACK] Play/Pause button clicked (action: play)
[CANVAS-VIDEO] Video not ready, waiting for canplay event (rs=0)
BlobUrlDebug: Revoked blob:...7b6954b7... (lifespan ~12.3s) + Revoked untracked
GET blob:...7b6954b7... net::ERR_FILE_NOT_FOUND (suppressed)
[CANVAS-VIDEO] Cleaned up canplay listener (on pause at ~0.516s)
```

Shows:
1) Listener now survives (no 60fps re-render churn)
2) Blob is missing/404ing before readyState can reach 3
3) `canplay` never fires, so play() is never attempted successfully

---

## Essential Console Messages Only

### User Action
```
preview-panel-components.tsx:322 [PLAYBACK] Play/Pause button clicked
playback-store.ts:134 step 1: user initiated playback
playback-store.ts:28 step 2: playback timer started
```

### Video Playback Attempt (First Frame)
```
video-player.tsx:291 [CANVAS-VIDEO] Video not ready, waiting for canplay event
  currentReadyState: 0 (HAVE_NOTHING)
  needsReadyState: 3 (HAVE_FUTURE_DATA)
```

### Blob Revocation While Buffering
```
blob-url-debug.ts:59 [BlobUrlDebug] Revoked: blob:...7b6954b7... (lifespan ~12330ms)
blob-url-debug.ts:64 [BlobUrlDebug] Revoked untracked: blob:...7b6954b7...
blob:...7b6954b7... net::ERR_FILE_NOT_FOUND (multiple times)
```

### Cleanup (on pause)
```
video-player.tsx:350 [CANVAS-VIDEO] Cleaned up canplay listener
```

---

## What's Missing (Never Appears)

These SHOULD appear but never do:

```
// Never seen:
[CANVAS-VIDEO] canplay event fired, attempting play
[CANVAS-VIDEO] play() succeeded
[CANVAS-VIDEO] Video ready, playing immediately

// Never reaches:
step 13: drawing to canvas
```

---

## Root Cause

**Blob URLs for the active video are still being revoked or missing before buffering completes, so readyState stays 0 and `canplay` never fires.**

- Listener churn is fixed (effect no longer reruns every frame), but the video element never becomes ready because its blob 404s mid-load.
- Blob cleanup/migration still runs twice per mount, and untracked `URL.revokeObjectURL` calls are revoking the active blob even after adding in-use guards.
- With the source revoked, the player eventually pauses and cleans up the listener without ever seeing `canplay`.

---

## Required Fix

**Keep the active playback blob alive until `canplay`/`play()` succeed.**

Recommended order:
1) Route all blob revocations through the blob manager (or wrap native `URL.revokeObjectURL`) so the in-use guard can block active blobs; stop any untracked revokes (`Revoked untracked` in consolev10).
2) Ensure preview cleanup and blob migration skip the active blob URL and truly run once per session (avoid StrictMode double-run clearing blobs twice).
3) Re-test playback; expect `canplay` -> `play() succeeded` with no `ERR_FILE_NOT_FOUND` before readyState >= 3.

---

## Implementation (current)
- Play/useEffect no longer depends on `currentTime` (listener survives instead of being torn down at 60fps).
- Added `timelineTimeRef` to keep logs accurate without retriggering the play effect.
- Playback window listeners stay attached instead of being recreated every tick.
- Mark/unmark active playback blobs in `blob-manager` + preview cleanup skips the active blob when known.
- `getVideoSource` memoizes blob URLs per `File` and creates them via the blob manager.
- Blob cleanup migration is guarded to run once per session (still logging twice under StrictMode).

---

## Success Criteria

When fixed, console should show:

```
[CANVAS-VIDEO] Video not ready, waiting for canplay event
// ... time passes (100-500ms) ...
[CANVAS-VIDEO] canplay event fired, attempting play
[CANVAS-VIDEO] play() succeeded
step 13: drawing to canvas { frameDrawn: true }
```

And **no** `ERR_FILE_NOT_FOUND` for the active blob until playback stops.

---

## Debug Checklist

- [x] Play effect not tied to `currentTime` (canplay listener no longer destroyed every frame)
- [ ] Active playback blob never revoked mid-buffer (no `ERR_FILE_NOT_FOUND`)
- [ ] canplay event fires
- [ ] play() succeeds
- [ ] Canvas draws frames
- [ ] Video actually plays

---

## How to Repro
1) Run the web app (e.g., `bun dev` at repo root) and open the editor preview.
2) Load a clip with a video element, scrub to a point inside the clip, and click Play.
3) Watch console: `Video not ready` appears once, then blob `ERR_FILE_NOT_FOUND` spam for the active src; readyState stays at 0; `canplay` never appears.

## How to Verify the Fix
- Start playback in-clip and confirm `Video not ready` is followed (after ~100-500ms) by `canplay event fired` and `play() succeeded`.
- Confirm there are **no** `ERR_FILE_NOT_FOUND` logs for the active blob while buffering/playing.
- See `step 13: drawing to canvas { frameDrawn: true }` logs and observe the video rendering on canvas.

## New Evidence (consolev10) and Next Move
- After adding blob in-use guards and caching blob URLs per File, the active playback blob (`blob:...7b6954b7...`) was still revoked after ~12.3s and immediately 404ed; `canplay` never fired and readyState stayed 0.
- Blob cleanup migration still logs twice per load; need to ensure it only runs once and cannot clear the active blob.
- Next move: trace remaining `URL.revokeObjectURL` call sites (especially untracked revokes), ensure preview cleanup cannot reach the active blob, and retest until `canplay`/`play() succeeded` appear without blob 404s.

## Console Noise to Trim
- `preview-panel.tsx:445 step 11: calculating active elements` spam is already suppressed; keep logs focused on video lifecycle and blob tracking.
