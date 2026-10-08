---
version: "2026.10.08.2"
date: "2026-10-08"
channel: "stable"
---

# QCut v2026.10.08.2

### Fixed
- Fix Beauty Lab PNG decoding in production packages by including its required codec dependency.

### Improved
- Verify photo rendering through both native and independent engines, pixel comparison, and comparison ZIP export from the signed macOS app window.
- Add a local installer for the independent engine's external resources and a fresh Python environment, with source preservation, integrity checks, and rollback after failed installation.
- Check Python image-processing dependencies, Bun, and Swift/Metal before independent rendering. Cache successful environment probes while rechecking resource hashes and executable access on every request.

### Limitations
- Fresh installation is verified on the current Mac; installation on a different clean Mac remains unverified and still requires local developer tools. Private runtimes and models are not bundled.
- Independent/native parity remains incomplete: 19 of 124 tested photo cases exceed the 1-RGB-level comparison threshold. Production video, timeline export, and multi-face processing remain unfinished.
