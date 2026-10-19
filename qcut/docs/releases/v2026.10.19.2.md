---
version: "2026.10.19.2"
date: "2026-10-19"
channel: "stable"
---

# QCut v2026.10.19.2

### Fixed
- Independent body-video processing now follows the verified native tracking and reset lifecycle through missing detections, timestamp jumps and retained-face recovery. Five face slots keep their own histories and suppress duplicate detections; the body still tracks the original package's default single target.
- A worker pipe closing before its exit event now enters the existing frame replay path. Cancellation, timeouts and unrelated I/O errors keep their original failure behavior.
- Relinking media detects content changes anywhere in the file, including equal-length edits in the middle. Full-file hashing releases each chunk as it advances and shares concurrent requests.
- A valid transient frame after a source-size change is no longer rejected by an extra steady-frame size check. Cold and steady frames still enforce their network limits without advancing state after validation failure.

### Improved
- The research body engine supports native warm image resets, ordered parameter-reset events, live size changes and explicitly supplied shoulder-protection masks. Version 5 checkpoints preserve the corresponding state and reject older incompatible snapshots before mutation.

### Verified
- PR #511 passed Ubuntu, macOS and Windows CI. Targeted regressions cover worker recovery, bounded hashing, resize validation, checkpoint continuation and portable test prerequisites.
- Scoped native audits match 177 original-image frames across controlled multi-face/crossing, resizing, irregular aspect ratios and explicit shoulder-mask inputs. See the body research notes for exact source snapshots and evidence boundaries.

### Limitations
- Native parity evidence is limited to the pinned upright modern-CPU configuration, default single-body target and explicitly supplied shoulder mask. Automatic matting, appearance re-identification, other orientations and full editor reset/mask event transport remain unverified.
- The earlier 180-frame editor preview/export comparison belongs to the previous engine snapshot; it has not been rerun on this native-lifecycle revision. Long-video memory, audio synchronization and real-time throughput are not established by these engine tests.
- Independent execution still needs locally installed private model weights. This release adds no model weights, original native libraries or captured research assets to the repository.
