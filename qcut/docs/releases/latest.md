---
version: "2026.10.24.1"
date: "2026-10-24"
channel: "stable"
---

# QCut v2026.10.24.1

### Added

- Select the opt-in macOS CoreML profile in the editor's independent video engine. Preview, export, undo, save and reopen preserve the selection; existing independent-engine projects keep the CPU default. Unavailable CoreML resources are reported before export encoding.

### Fixed

- Body-video processing now receives decoded source timestamps when source and timeline frame rates differ. Cache and history identities include the source clock and execution resources, while every timeline frame still advances the required processing steps.
- Overlapping requests for the same frame wait for cache publication, avoiding duplicate inference. Resource contents remain validated on every request. Completed route journals survive checkpoint cleanup and support consistent seeking, cancellation and worker recovery.
- Prepared playback fills the initial three-segment window without increasing its cache or decoded-frame memory limits. Accepted cancellation remains effective during cache writes and cleanup.
- JianYing draft export preserves inactive CoreML preferences and explicitly requires baking when CoreML body effects are active.

### Verified

- PR #520 passed Linux, macOS and Windows CI, plus Linux/macOS body execution contracts.
- On one silent, single-person, six-second clip at 1080 × 1920 and 30 fps, all 180 independent paused previews matched their pre-encode export pixels. All three comparison videos fully decoded. Fourteen smart/manual control cases verified 168 effect frames and 42 paused previews.
- Seven complete 36-frame operation exports covered parameter changes, cold seeks, pending cancellation, actual inference-worker termination and normal editor reopen. Recovery reproduced the baseline output.
- After preparation, lightweight cached playback took about 6.003 seconds, presented 179/180 frames and started no new inference. Both 180-frame playback caches matched their corresponding exports.

### Limitations

- General native parity remains incomplete: the latest 180-frame comparison averaged 4.169/255 RGB error against the native reference. These results do not establish identical startup scheduling or identical output for other footage.
- Initial computation and preparation are not realtime. Long-video throughput and memory growth, audio sync, multi-person/occlusion scenes and complex multi-clip timelines still need separate acceptance.
- This CoreML path requires macOS, Python and externally supplied private models. It uses owned helpers and Apple system CoreML without loading JianYing rendering libraries. Private models, native libraries, videos, captured tensors and validation images are not included in this release.
