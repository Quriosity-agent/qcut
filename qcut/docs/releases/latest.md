---
version: "2026.10.21.1"
date: "2026-10-21"
channel: "stable"
---

# QCut v2026.10.21.1

### Improved
- Effect playback prepares bounded segments around the playhead, retaining the previous, current and next windows instead of requiring the whole timeline to fit in the preview cache. Seeking reprioritizes work; parameter edits hide stale frames and automatically rebuild the current window.
- Native body rendering reuses verified source-window frames while preserving the existing pre-roll and tracking rules. Independent rendering retains its checkpoint and replay history. Segment boundaries introduce no additional tracking resets.

### Fixed
- Cancelling preparation prevents late frames from being presented and supports a clean restart. Export suspends background prefetch, while unchanged clips can reuse eligible backend frames after edits elsewhere.
- Accepted video-face points outside the image retain native float32 coordinates instead of being clipped or rejected by the photo-only bounds check.
- Valid independent PNGs whose compressed bytes contain an SVG marker now decode correctly without weakening integrity checks. Native disk caching retries its lease after transient contention instead of remaining disabled.

### Verified
- PR #516 passed Windows, macOS and Linux CI. Native and independent 1080 x 1920 editor runs each passed all 13 acceptance gates, including parameter changes, forward/backward seeking, in-flight cancellation and recovery.
- Each engine's 720 cached frames matched its own pre-encode export RGBA exactly. The observed playback frames also matched: 719 native and 717 independent. All 360 edited-clip cached frames matched the changed export; the unchanged clip retained identical export pixels.
- Cumulative preview PNG output exceeded 2.55 GB while sampled active preview storage stayed below 698 MB. Three locations on a six-clip 72-second timeline passed sparse pixel and cache-bound checks. The native baseline retained identical raw RGBA hashes across all 720 frames before and after the cache fixes.

### Limitations
- Native and independent outputs still differ visibly. Initial inference remains slower than real time; this release does not establish arbitrary continuous Jianying-history equivalence.
- The 72-second checks are sparse samples, not a complete long-video export. Long-term process memory growth, broader multi-person footage and unrestricted audio/video synchronization remain unverified.
- Two Minor performance follow-ups remain deferred. Automated reviews did not cover every final commit: CodeRabbit paused and Devin skipped for unavailable credits.
- Private beauty model weights, original native libraries and local research captures remain external and are not added by this release.
