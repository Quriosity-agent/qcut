---
version: "2026.10.11.3"
date: "2026-10-11"
channel: "stable"
---

# QCut v2026.10.11.3

### Improved
- Timeline clips can now process their portrait edits with the independent beauty engine. Each clip picks 原生 (Native) or 自研 (Independent) in its portrait panel, and Native stays the default. A paused preview shows the independent result while playback shows the original frame. Export processes every frame with progress and cancel, and keeps processed frames in a disk cache so a second export reuses them. The engine can be chosen and configured on a machine without the native runtime.
- Edits the independent engine cannot run are never rendered natively instead: the panel names them, the preview explains why and shows the original frame, and export stops before the first frame.
- Tighten access to the account and licensing database so that only QCut's own servers can read or change account, session, license and credit records.

### Limitations
- The independent engine takes about 3–12 s a frame, slower with more edits, and processes at up to 1280 px on the long edge, so 1080p exports are processed at 720×1280 and scaled up.
- Smoothing and whitening do not support 9:16 vertical frames yet; face shaping, acne and lip makeup do.
- The independent engine applies one set of edits to every face, so per-person settings, manual retouch and manual body edits are not supported on it.
