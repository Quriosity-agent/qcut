# Changelog

All notable changes to QCut will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2026.10.16.1] - 2026-10-16

### Improved
- Mixer: a new Mixer panel in the media panel and a mix button on every audio track header. Each track has a level fader, pan, output bus, mute, solo, EQ/compressor/limiter and ducking; buses can be created, renamed and removed, and a track is sent to a bus by dragging it there; the master shows live momentary, short-term and integrated loudness and can measure the whole mix as exported (integrated LUFS, loudest 3 s, true peak).
- Level and pan automation: tracks, buses and the master can follow curves over timeline time, edited from each strip's A button or from the CLI. The preview and every export engine follow them.
- Stems: "Export stems per bus (WAV)" in the export dialog and `qcut editor export start --stems` write one WAV per bus beside the export; `qcut editor mix stems` writes them into a folder.
- CLI: `qcut editor track audio-get|audio-set|audio-automation|mute|solo` and `qcut editor mix export|bus-list|bus-create|bus-set|bus-remove|bus-automation|master-set|loudness|stems`. Every setting is range-checked and read back from the editor, and `timeline export` includes each track's mix settings and the project's buses.
- Track and clip colours: audio clips, and every other clip type, show their colour label; a track can carry a default colour its clips inherit; `qcut editor track create|update --color`, `qcut editor timeline color-label` and `qcut editor timeline select --color`.
- Electron E2E suite: each spec runs against an isolated QCut instance with its own data and a chosen locale, a smoke set (`bun run test:e2e:smoke`) covers 42 specs, and the specs are type-checked with the rest of the code.

### Fixed
- Exports apply the project mix (track levels, pan, buses, master, solo and ducking) in all three engines (in-browser, FFmpeg and the native CLI export) and in standalone MP3 exports; before, only the preview did.
- A direct-copy FFmpeg export no longer drops a video clip's own audio when audio tracks or a mix are present.
- A mix that silences every track exports silence instead of falling back to the raw audio.
- Ducking in FFmpeg exports reaches exactly the set depth.
- Keyboard crop and crop reset are saved as crop edits.
- The error shown when the editor is not ready within the allowed wait no longer varies with machine load.

### Verified
- Real exports from all three engines measured with FFmpeg: music −8.0 dB, SFX through a −4 dB bus and a −2 dB master −6.0 dB, picture audio −12.0 dB and −32 dB after its level curve, ducking 11.6–11.7 dB, soloed-out tracks below −66 dB. Stems are the programme's length and line up with the mix. Measured loudness matches FFmpeg's EBU R 128 meter within 0.1 LU.

### Limitations
- Automation curves are edited as point lists in the mixer, not drawn on the timeline lanes.
- Stems leave each bus before the master, so the master's level and limiter are not in them.
- The E2E suite runs locally only; it is not part of CI yet.

## [2026.10.15.1] - 2026-10-15

### Fixed
- Native manual body shaping now participates in the same source-history replay used by export, including combinations with intelligent body shaping and paused reverse seeks. Intelligent body shaping can also recover after a cold start.
- Manual body region controls stay aligned when a clip is rotated, mirrored or scaled.
- Filter CLI render and pipeline commands preserve full Windows file IDs when comparing input and output files, so different files are not mistaken for the same source. Hard-link, symlink and overwrite protections remain in place.

### Verified
- A 1080×1920, 30 fps, six-second moving-person fixture covers original, intelligent, manual and combined body paths with scale/crop keyframes, a dissolve and reverse seeks. All 64 sampled paused-preview/pre-encode export comparisons differ by at most one RGB level with identical alpha. All four exported videos decode to 180 frames with matching presentation timestamps.

### Limitations
- Acceptance covers sampled paused previews and the native runtime integration. Continuous real-time preview consistency, independent body rendering, a separate Jianying UI comparison, multi-person tracking, occlusion recovery, long-session stability and audio synchronization remain unverified.
- Native body processing remains slow: the six-second intelligent/manual/combined exports took approximately 15.4/37.6/53.1 minutes on the test machine. Body warps can also move the surrounding background; these tests do not establish background protection or visual quality across body types and clothing.

## [2026.10.14.2] - 2026-10-14

### Improved
- Clips can change volume over time through the editor API and CLI, for example to duck music under speech. `editor timeline update-element` accepts `audio.keyframes.volumeDb`, and `batch-add` accepts the same object on new media clips. Compose manifests take `volumeKeyframes` on clips and sounds; headless renders and editable projects play the same envelope.
- `qcut compose schema` prints every compose manifest field with its type, default and meaning, plus a worked example. The `--config` help points to it, and the bundled CLI skill documents the manifest format.

### Fixed
- Muxer exports no longer start audio about 56 ms late. This covers web and iPad exports, and desktop timelines with local color or portrait edits, filter stacks, shader transitions or stabilization. The measured offset is now 0.04 ms, the same as the source. If the encoder's start-up delay cannot be measured, the export still completes with the previous offset.
- `editor navigator open` reports success only after the project has finished loading, and fails for a project that does not exist.
- Project settings changed through the CLI or API while the project is closed, such as the aspect ratio, now take effect when the project opens.
- Rejected editor API element updates report the reason instead of "Element not found". Audio settings sent through the API are checked for unknown names and wrong value types.
- Headless compose renders place stickers the way the editor does: `transform.x`/`y` set the sticker's centre, and `scale` sets its width relative to the canvas's shorter side. Stickers in existing manifests move accordingly, and stickers centred near an edge are no longer rejected as outside the canvas.

### Limitations
- Exported audio can still run up to about 30 ms past the last video frame. The latency of pitch-corrected clips is not measured, and the start-up delay measurement has only been verified on macOS.
- `compose project --target editor` still rejects manifests that contain stickers.
- A fixed manifest `volume` above 1 only applies to headless renders; use volume keyframes (up to +12 dB) to boost audio in editor projects.

## [2026.10.14.1] - 2026-10-14

### Improved
- Supported paused timeline previews now use the export compositor with the same source frame, animated transforms, crop, background and transitions. A 1080×1920, 12-second fixture combines face shape, eye adjustments and lip makeup with keyframes, crop and dissolve; 33 sampled native, independent and original paused-preview/pre-encode export Canvas pairs differ by at most one RGB level with identical alpha.
- Independent compound beauty uses four real neighboring source frames to confirm ambiguous face selection and preserves the selected identity through later makeup stages.

### Fixed
- Stop hidden DOM previews from repeating portrait work while the canvas composition preview is active; restore the existing preview fallback if canvas rendering fails.
- Isolate preview compositor settings and lifetime from exports, so previewing speed regions cannot leave stale settings in the next preview or export.
- Copy only visible frame/evidence bytes after validating dimensions and memory budgets, and retain usable source evidence when decoder errors have an empty message.
- Decode export audio from source presentation timestamps. The measured 12-second AAC fixture now retains its full duration instead of losing about 0.49 seconds.

### Limitations
- This verifies sampled paused previews and the Muxer export path. Continuous playback, true multi-person/occlusion acceptance, long-session memory and temporal flicker remain separate work. Native and independent rendering are not claimed to be algorithmically identical.
- The measured speech MP4 still has a fixed approximately 56 ms audio offset; compensation for processing-graph and AAC priming delays, and full three-mode speech acceptance, remain unfinished.

## [2026.10.13.1] - 2026-10-13

### Improved
- Independent beauty keeps its renderer and CPU model sessions ready between frames. Measured warm renders of a 541×640 portrait on Apple M4 Pro are 4.75–7.38 times faster than restarting the same engine for every frame, with identical output bytes and without reusing rendered frames.
- Independent photo and video processing supports up to 4096 pixels on the longest edge and 8,294,400 pixels total. Updated smoothing and whitening profiles support vertical portraits, including 9:16 frames.

### Fixed
- Cancelling an independent render or encountering a worker crash stops the current export, reports the failure, and allows the next request to start a fresh worker. Failed exports no longer save black frames; unrelated decoder and effect errors retain their existing retry and fallback behavior.
- Cancelled cache operations and stale preview requests no longer publish a result after a newer request takes over.

### Runtime update and limitations
- The independent engine currently requires macOS. Existing independent-engine installations require the updated external runtime with four additional model and contract files. Private models and native binaries are supplied separately.
- A non-square-pixel video case still differs from native smoothing and whitening by up to 5 RGB levels. Real-time playback, long-video stability, full-effect 4K photo acceptance, and preview/export pixel parity remain unverified.

## [2026.10.11.3] - 2026-10-11

### Improved
- Timeline clips can now process their portrait edits with the independent beauty engine. Each clip picks 原生 (Native) or 自研 (Independent) in its portrait panel, and Native stays the default. A paused preview shows the independent result while playback shows the original frame. Export processes every frame with progress and cancel, and keeps processed frames in a disk cache so a second export reuses them. The engine can be chosen and configured on a machine without the native runtime.
- Edits the independent engine cannot run are never rendered natively instead: the panel names them, the preview explains why and shows the original frame, and export stops before the first frame.
- Tighten access to the account and licensing database so that only QCut's own servers can read or change account, session, license and credit records.

### Limitations
- The independent engine takes about 3–12 s a frame, slower with more edits, and processes at up to 1280 px on the long edge, so 1080p exports are processed at 720×1280 and scaled up.
- Smoothing and whitening do not support 9:16 vertical frames yet; face shaping, acne and lip makeup do.
- The independent engine applies one set of edits to every face, so per-person settings, manual retouch and manual body edits are not supported on it.

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
