---
version: "2026.10.05.1"
date: "2026-10-05"
channel: "stable"
---

# QCut v2026.10.05.1

### Improved
- Extend the Beauty Lab native/ONNX research tools with audited makeup and render-stage consumer evidence, opt-in Extra landmark refinement heads, isolated comparison matrices, and bounded real-video A/B probes.
- Add read-only face-mesh and face-reshape diagnostics whose strict audits still reject incomplete ownership or consumption claims.

### Fixed
- Report a research filter render as failed when its final frame is suppressed, instead of returning success without an output file.
- Write a durable probe report when the Extra landmark model root is missing, and hash the same resolved root in the probe and its worker so identical models pass the provenance check.
- Let the launcher diagnostics tests run on a fresh checkout that lacks the local model directory.

### Limitations
- No user-facing app changes in this release. The live ONNX candidate remains development-only and is not a production timeline backend.
- Highlighter and freckle makeup (6 of 84 portrait/card results), small-face point consumption, minute-level video, multiple faces, and cross-platform parity remain unverified.
- Private reference models, vendor runtime binaries, and effect packages are not bundled in this release.
