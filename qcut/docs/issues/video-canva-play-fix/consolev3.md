## Console V3 Snapshot (black canvas run)

Key logs captured:
- `step 3` + `step 4/5/6/11/12/12a` — RAF is ticking, video sync handler runs, preview renders one active video element.
- `[PLAYBACK] Play/Pause button clicked` → `step 1: user initiated playback`.
- `[CANVAS-VIDEO] play()` repeated — play requests reaching the element.

What’s missing:
- No `[CANVAS-VIDEO] loadedmetadata/canplay/playing/timeupdate` lifecycle logs.
- No `[CANVAS-VIDEO] error/stalled/waiting` logs.

Interpretation:
- The video element is being rendered with a blob URL and receives play() calls, but it never reports `loadedmetadata` or `timeupdate`. That means the source is not becoming ready (likely an invalid/blocked blob or the URL was revoked/not accessible).

Next checks:
1) Watch for new lifecycle logs (loadedmetadata/canplay/playing/timeupdate) after a fresh load; if absent, the blob is bad.
2) Inspect the blob source creation logs: `[CANVAS-VIDEO] Built video source map … missingSourceIds` and any `blob-url-debug` messages. Ensure blob isn’t revoked before use.
3) Confirm the blob URL resolves in devtools (Network tab or fetch in console). If it 404s/blocked, regenerate or use a file-backed source instead of the revoked blob.
