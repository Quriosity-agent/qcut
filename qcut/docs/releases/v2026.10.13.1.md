---
version: "2026.10.13.1"
date: "2026-10-13"
channel: "stable"
---

# QCut v2026.10.13.1

### Improved
- Independent beauty keeps its renderer and CPU model sessions ready between frames. Measured warm renders of a 541×640 portrait on Apple M4 Pro are 4.75–7.38 times faster than restarting the same engine for every frame, with identical output bytes and without reusing rendered frames.
- Independent photo and video processing supports up to 4096 pixels on the longest edge and 8,294,400 pixels total. Updated smoothing and whitening profiles support vertical portraits, including 9:16 frames.

### Fixed
- Cancelling an independent render or encountering a worker crash stops the current export, reports the failure, and allows the next request to start a fresh worker. Failed exports no longer save black frames; unrelated decoder and effect errors retain their existing retry and fallback behavior.
- Cancelled cache operations and stale preview requests no longer publish a result after a newer request takes over.

### Runtime update and limitations
- The independent engine currently requires macOS. Existing independent-engine installations require the updated external runtime with four additional model and contract files. Private models and native binaries are supplied separately.
- A non-square-pixel video case still differs from native smoothing and whitening by up to 5 RGB levels. Real-time playback, long-video stability, full-effect 4K photo acceptance, and preview/export pixel parity remain unverified.
