---
version: "2026.10.23.1"
date: "2026-10-23"
channel: "stable"
---

# QCut v2026.10.23.1

### Improved
- Beauty Lab opens the standalone V3 CPU photo editor in its own Electron window, with 21 still-photo body controls, local shaping, background protection, automatic/manual glute contours, before-and-after comparisons and original-size PNG export.
- The independent Python API and resident worker offer an explicit macOS `swing-coreml-v1` execution profile. Separate resident coarse/refine hosts follow the pinned native per-detector CPU-to-CoreML readiness rules, cold-start refinement, two graph updates per source frame and parameter timing between updates.
- Completed frames record the engine's own backend decisions for replay and checkpoint recovery. Checkpoint identities bind the execution generation, source closure, external models, helper and system/backend configuration.

### Fixed
- Photo-window cancellation, stale results, renderer crashes, close and reopen preserve process ownership and prevent an outdated render from replacing the current edit.
- In-memory snapshots and active video-engine state are scoped to their session, execution profile/generation and checkpoint directory, preventing one batch or directory from reusing another history. Failed initialization and incomplete frames cannot become reusable completed state; activated CoreML fails explicitly instead of silently falling back to CPU.

### Verified
- PR #518 passed Windows, macOS and Linux CI. The full independent Python suite ran 1,050 tests with 9 explicit private-fixture skips and no failures; targeted regressions include execution and checkpoint-directory isolation.
- Photo acceptance includes 40 real-image comparisons with identical PNG and RGBA against standalone V3, plus real Electron import, render, export, cancellation and crash/reopen checks. This establishes standalone parity for the tested photos.
- Three matched native/independent backend histories each produced four identical 1080 x 1920 RGBA frames, using three unique source images and documented scheduling waits. Separately, 32 consecutive source-rate frames (about 1.33 seconds) matched the independent engine's own replay on 32/32 frames and checkpoint recovery on 16/16. Real helper termination and in-flight cancellation recovered identical output.

### Limitations
- The 21 added photo controls remain still-photo controls. The new CoreML profile is opt-in at the Python/worker boundary; the editor keeps its existing warm CPU default. UI selection, project-persisted execution generations and this profile's full editor preview/export acceptance remain pending.
- Matched backend histories do not establish equal asynchronous startup timing: the natural independent run still differs from the unmodified native schedule. The 32-frame test adds self-consistency evidence, not further native parity. Real-time throughput, long videos, broad multi-person/occlusion coverage and Windows/Linux CoreML parity remain unverified.
- Original private model weights remain external dependencies. The new host uses owned code and Apple system CoreML without loading Jianying libraries; private models, native libraries, compiled research helpers and captured validation assets are not added by this release.
