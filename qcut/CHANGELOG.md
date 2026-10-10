# Changelog

All notable changes to QCut will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2026.10.11.2] - 2026-10-10

### Fixed
- Beauty Lab native results no longer depend on what you rendered before. Each native comparison now starts from a fresh face tracker. Before, re-rendering the same photo after an edit could drift by up to 56 RGB levels in face-shaping areas, which showed up as differences against the independent engine that were not real.
- Beauty Lab's independent smoothing now matches native smoothing pixel for pixel. It brings in three upstream fixes from the standalone engine, so all 124 cases of the photo comparison matrix are within one RGB level, 95 of them identical.
- The Beauty Lab photo matrix tool now starts every case from a cold native render. It also refuses to resume older runs recorded the other way.

## [2026.10.11.1] - 2026-10-10

### Changed
- Add an end-to-end test for Beauty Lab's independent photo engine. It renders a real portrait with both engines and checks three things: zero settings leave the photo untouched, the two results match within one RGB level, and the exported comparison ZIP carries the engine's own image. Five oversized Beauty Lab test files were also split into shared fixtures and smaller files. Beauty Lab itself behaves exactly as before.

### Fixed
- A Beauty Lab research test fixture hard-linked the candidate frame to its baseline. Two tests that corrupt the candidate were therefore rejected on the baseline instead. The fixture now copies the frame, so those tests check the candidate itself.

## [2026.10.10.3] - 2026-10-10

### Changed
- Reorganize the source tree so it is easier to find your way around: the properties panel's 114 files are now grouped into audio, color, media, portrait, sticker, text, caption, Beauty Lab and settings folders; 117 Jianying and Beauty Lab files in the desktop main process moved from one flat folder into per-feature folders; and 31 files were renamed to the project's kebab-case convention. Files only moved, so features are unchanged.

### Fixed
- Give five person-cutout tests that compile native C++ code enough time to finish, so a busy CI machine no longer fails them.

## [2026.10.10.2] - 2026-10-09

### Fixed
- Include the AI Content Pipeline (AICP) binary in the published Windows, macOS and Linux installers. Installers built since AICP bundling began in February had shipped without it, so the legacy pipeline (`QCUT_NATIVE_PIPELINE=false`) and running the app with `set-key`, `check-keys` or `delete-key` reported that the binary was missing. The default AI pipeline was not affected. Each installer carries only its own platform's AICP binary, adding about 45 MB.
- Make the release build's AICP check tolerate a slow first launch of the freshly signed binary: it now allows 90 seconds, retries once only after a timeout, and fails if the binary reports a different version than the one QCut pins.
- Fix a timing-dependent search test that could fail on a busy CI machine.

## [2026.10.10.1] - 2026-10-09

### Changed
- Remove about 9,400 more lines of unused code, tests and configuration, found by checking what the production build actually loads: the old toast notification system, unused Moyin library modules, editor components that were no longer shown, duplicate re-export files and four unused pipeline helpers. None of it was reachable from the app, so features are unchanged.
- Remove the web app's duplicate database configuration and migrations (`packages/db` remains the single source), the old Next.js Docker web service with its Redis services, and 10 unused dependencies.

### Fixed
- Update the contributor guide and technical docs to describe the current desktop development flow and the single-row media panel navigation.

## [2026.10.09.1] - 2026-10-08

### Changed
- Remove about 27,000 lines of unused code and 24 unused dependencies, including abandoned editor experiments (the old Nano-edit tools, effect templates, Zip export, the WebCodecs/GIF export path and an old Remotion timeline element). None of it was reachable from the app, so features are unchanged.

### Fixed
- Fix the README's build-from-source steps, Node.js/Bun requirements and broken DeepWiki badge.
- Make a debounce test deterministic so it no longer fails intermittently on slow CI runners.

## [2026.10.08.3] - 2026-10-08

### Changed
- Remove the unused QAgent development tool (`packages/qagent`) and its scripts from the repository. It was never part of the QCut app, so installed builds are unaffected.

### Fixed
- Main-process, script and platform tests run in the Node test environment again; a Vitest 4 upgrade had silently moved them into a browser-like environment.
- Make a Beauty Lab live-candidate test robust on slow Windows CI runners.

## [2026.10.08.2] - 2026-10-08

### Fixed
- Fix Beauty Lab PNG decoding in production packages by including its required codec dependency.

### Improved
- Verify photo rendering through both native and independent engines, pixel comparison, and comparison ZIP export from the signed macOS app window.
- Add a local installer for the independent engine's external resources and a fresh Python environment, with source preservation, integrity checks, and rollback after failed installation.
- Check Python image-processing dependencies, Bun, and Swift/Metal before independent rendering. Cache successful environment probes while rechecking resource hashes and executable access on every request.

### Limitations
- Fresh installation is verified on the current Mac; installation on a different clean Mac remains unverified and still requires local developer tools. Private runtimes and models are not bundled.
- Independent/native parity remains incomplete: 19 of 124 tested photo cases exceed the 1-RGB-level comparison threshold. Production video, timeline export, and multi-face processing remain unfinished.

## [2026.10.08.1] - 2026-10-07

### Improved
- Beauty Lab can now render a photo through a separate independent engine alongside the native runtime, keep both results, compare their pixels, and export a verified comparison ZIP. Independent rendering never falls back to the native provider.
- The independent engine supports 32 numeric face controls and 28 makeup cards, with source-hash verification, cancellation, process-tree cleanup, and stale-result protection.
- Add a real-provider comparison matrix for research, with original/native/independent/difference images, parameter and hash receipts, and resumable checkpoints that re-verify saved pixels.
- Add a bounded research API for processing frame sequences with the independent engine (not yet part of timeline or video export).

### Fixed
- The signed native beauty host now resolves its libraries next to the executable instead of relying on DYLD environment variables, and rejects tampered cache entries or redirected links.
- Python bytecode is no longer written into packaged source resources when the independent worker runs.

### Limitations
- The independent engine handles one opaque still photo (max edge 1280). It matches the native result within 1 RGB level in 105 of 124 tested cases; extreme settings can still differ noticeably, so native parity is not established.
- Rendering and export from the packaged app window remain unverified.
- Private runtimes, models, and the Python environment are not bundled; the independent engine needs them provisioned externally.

## [2026.10.06.1] - 2026-10-06

### Improved
- Add a cancel button to Beauty Lab candidate verification. A cancelled or cleanly failed audit can be retried without restarting QCut, but only when its own cleanup receipt proves every task was reaped; any other failure still requires a restart.
- Classify candidate process failures (not started, cancelled, timeout, output limit, process error, exit code, signal) and record whether a forced kill was needed.
- Add a bounded video session protocol and stable, never-reused multi-face track IDs for Beauty Lab candidates, with in-order export backpressure and frame-gap-aware track retirement.
- Extend the Beauty Lab native research tools with opt-in reshape and mesh-matrix hardware diagnostics that fail closed on incomplete evidence.

### Limitations
- The live candidate backend remains development-only and is not a production timeline backend; no verification gate was loosened.
- The new live candidate interaction end-to-end test is written but has not been run.
- Small-face point consumption, 3D takeover, and independent geometry are unchanged in this release.
- Private reference models, vendor runtime binaries, and effect packages are not bundled in this release.

## [2026.10.05.1] - 2026-10-05

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

## [2026.10.04.2] - 2026-10-04

### Improved
- Align skin-tone controls, original-frame portrait sampling, and preview/export settings across Beauty Lab and the editor.
- Add bounded live native/ONNX comparison tools with cold-frame checks, owned-point consumption evidence, grayscale differences, and portable result exports.

### Fixed
- Validate comparison pixels, request identity, cancellation records, and dependency inventories before accepting local research results.
- Use portable catalog paths and cover Windows cross-drive rejection behavior without weakening filesystem validation.
- Bound portrait preroll decoding and handle missing tracks, invalid durations, exhausted history budgets, and late decoder results.

### Limitations
- The live ONNX candidate remains development-only and explicitly opt-in on macOS ARM64. It still relies on the native reference runtime for detection and rendering; dynamic, multi-face, makeup, and production cross-platform parity are not complete.
- Private reference models, vendor runtime binaries, and effect packages are not bundled in this release.

## [2026.10.04.1] - 2026-10-03

### Added
- Add Beauty Lab controls, local presets, original/native/candidate comparisons and portable PNG/JSON/ZIP evidence exports.
- Add bounded local face-model research tools for ONNX sampling, landmark alignment, temporal replay and native-renderer comparisons.

### Improved
- Validate Beauty Lab research records against source hashes, image integrity and candidate ownership before importing evidence.
- Reduce comparison validation overhead with exact row-level RGBA checks and a bounded PNG decode fast path.

### Fixed
- Restore timeline portrait settings after importing read-only research cases and replace stale comparison ZIPs during export.
- Isolate inherited native-probe environment settings and contain C++ exceptions at the Espresso C ABI boundary.

### Limitations
- Arbitrary-frame independent ONNX beauty processing remains unavailable. Historical research evidence requires recapture after source changes; private reference models, effect packages and vendor binaries are not bundled.

## [2026.10.01.1] - 2026-10-01

### Improved
- Complete portrait face-shape, contour, nose, eye, mouth and brow controls with per-face editing and resets.
- Align makeup categories, thumbnails and intensity controls with the Jianying reference workflow while retaining saved legacy selections.
- Verify portrait rendering, project reopening and exports on multiple real-person reference images.

### Fixed
- Commit pending makeup intensity edits to the correct category when switching tabs, including equal-intensity and per-face cases.
- Preserve partial portrait E2E reports and failure screenshots without hiding failed assertions.
- Run backend model-routing tests in Node and use platform-native makeup cache paths in cross-platform tests.

## [2026.09.29.1] - 2026-09-29

### Improved
- Keep timeline navigation responsive by coalescing hover previews, bounding visible ruler and caption work, and reducing redundant zoom updates.
- Align portrait skin controls and improve blemish-removal and jawbone processing consistency between preview and export.

### Fixed
- Preserve quarter-second ruler labels and avoid stale or blank cached preview frames.
- Retry transient Windows file locks when publishing verified FFmpeg binaries without hiding permanent failures.
- Bind portrait comparison evidence to file hashes and make export cleanup and cross-platform regression tests more reliable.

## [2026.09.12.1] - 2026-09-12

### Added
- Edit position, scale, rotation and opacity across multiple video clips, with mixed values, relative adjustments, keyframe support and one undo step per field change.
- Run `qcut edit deflicker` with the local FFmpeg backend by default. The explicit Jianying reference backend remains available. Deflicker is intended for individual shots, not across scene cuts.

### Improved
- Reduce frame-transfer overhead in the independent Metal filter host while preserving shader output.
- Verify deflicker frame counts, video/container duration and audio tails, including MKV files without video-stream duration.

### Fixed
- Prevent duplicate editor actions after StrictMode remounts, restoring single-step toolbar undo and redo.
- Protect deflicker source files against directory/case aliases and cancellation during output publication; cover directory junctions in Windows CI.

## [0.3.58] - 2026-02-09

## [0.3.57] - 2026-02-09

## [0.3.56] - 2026-02-09

## [0.3.55] - 2026-02-09

## [0.3.54] - 2026-02-08

### Added
- AI content pipeline skill with 51 models across 8 categories
- Speech-to-text transcription with ElevenLabs Scribe v2
- Project folder organization skill
- Virtual folder system for media management

### Changed
- Improved media import with symlink support
- Enhanced error handling in IPC handlers

### Fixed
- Media import error handling for unexpected symlink failures
- Path validation in list-files and ensure-structure handlers

## [0.3.52] - 2025-01-31

### Added
- Skills system with default skills bundled in resources
- FFmpeg skill for video/audio processing
- Organize-project skill for project structure management

### Changed
- Simplified execWithTimeout using promisify in AI pipeline
- Improved documentation for organize-project skill

### Fixed
- Various bug fixes and stability improvements

## [0.3.0] - 2025-01-15

### Added
- Electron desktop application
- Timeline-based video editing
- Media panel with drag-and-drop support
- FFmpeg WebAssembly integration for client-side processing
- Auto-update functionality

### Changed
- Migrated from Next.js to Vite + TanStack Router

## [0.2.0] - 2025-01-01

### Added
- Initial project structure
- Basic video playback
- Project management system

## [0.1.0] - 2024-12-15

### Added
- Initial release
- Core video editor framework
- React-based UI components

[Unreleased]: https://github.com/qcut-team/qcut/compare/v0.3.52...HEAD
[0.3.52]: https://github.com/qcut-team/qcut/compare/v0.3.0...v0.3.52
[0.3.0]: https://github.com/qcut-team/qcut/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/qcut-team/qcut/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/qcut-team/qcut/releases/tag/v0.1.0
