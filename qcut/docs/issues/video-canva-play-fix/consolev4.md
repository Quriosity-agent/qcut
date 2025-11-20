## Console V4 (cleaned)

Condensed from the noisy run where clicking play kept the canvas black. Replaces the copied `Object` spam with the fields that matter.

### What actually happened
- `[PLAYBACK] Play/Pause button clicked` - isPlaying: false -> true, currentTime: ~0, totalDuration: (not captured in copy).
- `step 1: user initiated playback` - action: "play".
- `step 3/4` - playback-update dispatched; video sync handler ran for `videoId: d78d4723-86c3-2d9f-abd3-ad04b0d0c700` at timeline/video time ~0s.
- `step 5/11/12` - preview render cycle; active elements resolved.
- `step 12a: rendering video element` - `{ elementId: 8b36cd37-709e-4233-bd14-8f0bfa81aeff, src: blob:app://./168c90cf-8853-4b73-9c4f-8ce7f517a9f2, clipStartTime: 0, trimStart: 0, trimEnd: 0 }`.
- `[CANVAS-VIDEO] play()` - fired repeatedly for the same `videoId`, with `currentTime` rising 0 -> 0.0199 -> 0.0407 -> 0.3097.
- `[CANVAS-VIDEO] play() failed` - every play call rejected immediately (promise failure), so the video never advanced.

### What never appeared
- No `[CANVAS-VIDEO] loadedmetadata/canplay/playing/timeupdate/stalled/waiting/error` lifecycle logs. The element never reached a ready state.

### Interpretation
- Playback pipeline (RAF, playhead, preview render, element resolution) is alive, and the video element is being told to play.
- The source blob `blob:app://./168c90cf-8853-4b73-9c4f-8ce7f517a9f2` never became ready; play() rejects immediately. This points to a bad/revoked/blocked blob or fetch failure, not a timeline tick issue.

### Next capture to unblock
- Expand the `play()` / `play() failed` objects to note `readyState`, `networkState`, and the `error` message.
- Watch for any `error`/`stalled`/`waiting` events on the video tag; if none fire, inspect the blob URL directly in DevTools (Network tab or `fetch(blobURL)` in console) to confirm it resolves.
