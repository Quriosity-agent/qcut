## Console V2: Video Canvas Debug Signals

Use these messages to pinpoint why the video stays black.

- **Playback loop**
  - `step 1/2/3/8` — play/pause, RAF start, per-frame `playback-update`, seek dispatch.
  - `[PLAYBACK-RAF] Skipping tick; not playing` / `…reached duration` — RAF idle; duration or play state is blocking updates.
- **Timeline**
  - `step 6` — playhead auto-scroll decisions for the current time.
- **Preview**
  - `step 5/10/11/12` — preview render cycle and active element resolution.
  - `step 12a` — video element render with chosen `src`.
  - `[CANVAS-VIDEO] No active elements rendered while playing` — timeline has items but nothing is active at this time; expect a black canvas.
- **Video element health (new, always on)**
  - `[CANVAS-VIDEO] loadedmetadata/canplay/playing/waiting/stalled/error/timeupdate` — per-video lifecycle with `readyState`, `networkState`, `currentTime`; `timeupdate` is throttled.
  - `[CANVAS-VIDEO] Skipping video events (out of clip range)` — timeline time outside this clip.
  - `[CANVAS-VIDEO] No available video source` — media entry exists but no playable blob/URL could be built.
  - `[CANVAS-VIDEO] play()/pause()` — actual play/pause calls reaching the element.
- **Sources**
  - `[CANVAS-VIDEO] Built video source map` — counts of blob URLs and missing sources.

### Quick triage
1) Verify `step 3` is incrementing; if not, see `[PLAYBACK-RAF]` warnings and confirm `setDuration` ran.
2) If `play()` logs appear but no `loadedmetadata/canplay/playing/timeupdate`, the video never became ready—suspect a bad blob URL or blocked fetch.
3) If `timeupdate` appears but the canvas is black, ensure active elements > 0 (`step 11/12`) and not suppressed by trim/range (`Skipping video events (out of clip range)`).
4) If video is waiting/stalled, check network/CSP for the blob or remote URL.
