# Canvas Video Playback Debug - Clean Console Analysis

## Purpose
Identify why canvas is displaying a static image instead of playing video.

## Key Finding
**The video is stuck in an infinite loop of trying to play but never succeeding.**

## Evidence (code + console)
- `apps/web/src/components/ui/video-player.tsx`: the play/useEffect depends on `currentTime`, so it reruns on every `playback-update` tick (~60fps). Each rerun cleans up the `{ once: true } canplay` listener before the video buffers.
- `consolev8.md`: `video-player.tsx:264 ⏳ Video not ready…` is followed ~16ms later by `video-player.tsx:304 🧹 Cleaned up canplay listener`, repeating every frame while readyState stays 0/1.
- No `canplay`/`play() succeeded` messages show up in the same capture, proving the listener never survives long enough to fire.

---

## ?? Critical Pattern Detected (Repeats 60x/second)

```
[CANVAS-VIDEO] ? Video not ready, waiting for canplay event
[CANVAS-VIDEO] ?? Cleaned up canplay listener
```

This pattern shows:
1. Video detects it's not ready (readyState < 3)
2. Sets up canplay event listener
3. Component immediately re-renders
4. Listener is cleaned up before video can load
5. Repeats endlessly

---

## ?? Essential Console Messages Only

### User Action
```
preview-panel-components.tsx:322 [PLAYBACK] Play/Pause button clicked
playback-store.ts:134 step 1: user initiated playback
playback-store.ts:28 step 2: playback timer started
```

### Video Playback Attempt (First Frame)
```
video-player.tsx:264 [CANVAS-VIDEO] ? Video not ready, waiting for canplay event
  currentReadyState: 0 or 1 (HAVE_NOTHING or HAVE_METADATA)
  needsReadyState: 3 (HAVE_FUTURE_DATA)
```

### Immediate Cleanup (16ms later)
```
video-player.tsx:304 [CANVAS-VIDEO] ?? Cleaned up canplay listener
```

### Continuous Loop (Every ~16ms)
```
Frame 1:  ? Video not ready, waiting for canplay event
Frame 1:  ?? Cleaned up canplay listener
Frame 2:  ? Video not ready, waiting for canplay event
Frame 2:  ?? Cleaned up canplay listener
Frame 3:  ? Video not ready, waiting for canplay event
Frame 3:  ?? Cleaned up canplay listener
... (repeats 60 times per second)
```

---

## ? What's Missing (Never Appears)

These messages SHOULD appear but never do:

```
// Never seen:
[CANVAS-VIDEO] ? canplay event fired, attempting play
[CANVAS-VIDEO] ? play() succeeded
[CANVAS-VIDEO] ? Video ready, playing immediately

// Never reaches:
step 13: drawing to canvas
```

---

## ?? Root Cause

**Component re-renders are destroying the `canplay` listener before videos can load.**

### Why It Happens:
1. **Effect tied to `currentTime`**: The play/useEffect depends on `currentTime`, so it reruns on every `playback-update` tick (~16ms).
2. **Cleanup on each rerun**: Each rerun calls the effect cleanup, removing the `{ once: true } canplay` listener immediately after it is attached.
3. **Buffer never finishes**: The video needs 100–500ms to buffer to readyState 3/4, but the listener is removed after ~16ms, so it never fires.
4. **Stuck forever**: Ready state remains 0/1, so play() is never attempted successfully.

---

## ??? Required Fix

**Stop the play/useEffect from rerunning every frame so the `canplay` listener survives long enough to fire.**

Recommended order:
1) **Stabilize effect deps** — remove `currentTime` (and other 60fps signals) from the play/useEffect deps so it only reruns on `isPlaying`, `isInClipRange`, or source changes.
2) **Keep listener persistent** — if additional protection is needed, store the `canplay` handler in a ref and only attach once per source/play request.
3) **Optional isolation** — memoize or split out the video element if parent rerenders still leak through.

---

## ?? Success Criteria

When fixed, console should show:

```
[CANVAS-VIDEO] ? Video not ready, waiting for canplay event
// ... time passes (100-500ms) ...
[CANVAS-VIDEO] ? canplay event fired, attempting play
[CANVAS-VIDEO] ? play() succeeded
step 13: drawing to canvas { frameDrawn: true }
```

NOT:
```
? waiting -> ?? cleaned up -> ? waiting -> ?? cleaned up (infinite loop)
```

---

## ?? Debug Checklist

- [x] Problem #1 fix working (no play() failed errors)
- [ ] canplay event fires (never happens)
- [ ] play() succeeds (never happens)
- [ ] Canvas draws frames (never happens)
- [ ] Video actually plays (blocked by re-renders)

---

## ?? How to Repro
1) Run the web app (e.g., `bun dev` at repo root) and open the editor preview.
2) Load a clip with a video element, scrub to a point inside the clip, and click Play.
3) Watch console: `? Video not ready` followed ~16ms later by `?? Cleaned up canplay listener` repeating every frame; readyState stays at 0/1.

## ?? How to Verify the Fix
- Start playback in-clip and confirm `? Video not ready` is followed (after ~100–500ms) by `? canplay event fired` and `? play() succeeded`.
- Confirm `?? Cleaned up canplay listener` no longer appears every frame (should only fire on teardown).
- See `step 13: drawing to canvas { frameDrawn: true }` logs and observe the video rendering on canvas.
