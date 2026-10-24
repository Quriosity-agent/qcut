# Changelog

All notable changes to QCut will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2026.10.24.1] - 2026-10-24

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

## [2026.10.23.1] - 2026-10-23

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

## [2026.10.21.1] - 2026-10-21

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

## [2026.10.19.2] - 2026-10-19

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

## [2026.10.19.1] - 2026-10-19

### Improved
- Independent engine, smart body on video: the body geometry now follows the person through the clip. The session's persistent composition ran in the photo mode that keeps the anchors of its first frame, so on a walking clip the leg-stretch band stayed at one height and the slimming amplitude never changed while the person moved and approached the camera; the anchors are now refreshed every frame, matching the native path's trajectory (band top within about 10 px, slimming within half a pixel on a 1080×1920 clip).
- The first frame of a body-video clip is processed too: the frame whose coarse pass seeds tracking is refined in the same frame, and the first body frame converges its geometry like a still before it is drawn, so the effect no longer fades in over the first half second.
- An export whose engine worker dies mid-frame now finishes by itself: the frame is resubmitted once and the engine replays from its last checkpoint instead of failing the export.
- Reopening a project keeps a body-video clip's session: the clip is named by its media bytes (length plus a head-and-tail fingerprint) and the edit's canonical shape rather than by the rebuilt File object, so the frame cache and checkpoints survive a restart (post-restart cached export 224 s → 24 s), and relinking a clip to a different file of the same length still starts a new session.

### Fixed
- Colour grades: `color.basic` now wins over a stale legacy `adjustments` mirror on write as well as on read, and the mirror is regenerated from the final grade; timeline apply with `--verify` now reads back colour and adjustment layers and rolls back on a mismatch, naming the field.
- Out-of-range grade values (basic, HSL, colour wheels, LUT intensity) are refused by every API entry (element patch, element colour, batch, timeline apply) with the allowed range, instead of being rendered.
- The editor-API native audio export honours `audio.volumeDb` (including mute and the −60 dB floor) instead of the legacy linear `volume`; patching audio settings mirrors the legacy fields immediately.
- Colour-wheel directions are documented as measured: x+ red/magenta, x− green; y+ blue, y− yellow.

### Verified
- Single-person body closure on one real 6 s walking-and-turning clip (1080×1920, 30 fps, 180 frames, slim 40 + long leg 30), untouched / native / independent through the real export: the paused preview canvas and the pre-encode export frame are identical (max level difference 0) on both engines; both engines change the body region on all 180 frames; native↔independent per-frame mean 3.7 levels (9.99 before the fix), with the only frames above 5 levels being the native path's own momentary stretch drop-outs. Six operation-invariance checks (sequential export, reverse seeks, cache cleared, cancel mid-export, worker killed mid-export, restart with and without cache) reproduce the same 180 frames; a separate project's export matched byte for byte.
- A cold-started native tracker produces the same frames as a warm one on every sampled frame.

### Limitations
- Steady-state geometry sits 5–60 px below the native band top and 0.2–0.4 px under its slimming amplitude; the native path's momentary stretch drop-outs are not reproduced. With anchors refreshed every frame, a second person entering the frame can now influence the tracked body's mesh; multi-person identity and background protection remain future work.
- Not real time: about 1.4 s per 1080p frame in the app's export (native path about 3.9 s).

## [2026.10.18.3] - 2026-10-18

### Improved
- Independent engine, smart body on video: a video clip with any of the ten smart body controls set now renders from the clip's own history instead of frame by frame as a photo. Body tracking, the face and the ten-part geometry carry from the clip's first frame, so the paused preview and the export show the same result, and seeking back or forward replays only the frames the engine lacks. The engine keeps a checkpoint every twelve frames in the project cache and resumes from it, so a restarted engine process or a second export reproduces the same bytes.
- The paused preview and the export decode a clip's frames the same way and share the frame cache: frames rendered while scrubbing are reused by the export, and an unchanged timeline exports from the cache alone.
- A tracked body is not disturbed by a second person entering the frame. A frame where the first detection sees several people, or where the person is lost, is shown as it is and tracking resumes on the next frame; a face kept through a re-detection is detected again instead of failing the clip.

### Fixed
- The independent engine's resident worker plans a clip's frames once instead of starting the planner for every frame.

### Verified
- A 1080×1920 clip in the app: the preview's four rendered frames were reused by the export unchanged (15 frames, exactly 15 cache entries); a second export matched the first frame for frame and took 3.6 s instead of 15.6 s; after killing the engine process and emptying the frame cache, a seek to frame 13 reproduced the exported pixels from the frame-12 checkpoint, and a seek to frame 5 replayed from the clip's start. Snapshot and restore are byte-identical on real footage, in one process and across two engine processes.
- 240 frames in one session: 0.6 s per frame in the engine (0.41 s in the body stage), memory 335→396 MB, twenty checkpoints, no failures. Composited scenes with two people on the first frame, a second person entering and a person leaving behave as described.

### Limitations
- Not real time: about 0.6 s per 1080p frame in the engine and about 1.4 s per frame in the app's export. Body intensity cannot be keyframed yet.
- An export at a different resolution than the project canvas starts its own history. A cut inside one clip is not detected: split the clip first. Clips that also use skin or face controls replay more slowly. The body and face networks are still the extracted ones.

## [2026.10.18.1] - 2026-10-17

### Improved
- Transparent overlays: a video with an alpha channel on a media track above another clip is drawn over it in the preview and in both export engines, lowest track first and only on the clip's own frames, with its position, scale, rotation, opacity, fit, trims, speed and blend mode. VP9 WebM with alpha, ProRes 4444, QuickTime Animation and PNG MOV keep their transparency; an opaque clip covers what is under it as picture-in-picture, and an overlay's sound goes through its own track in the mix. The preview and the editor engine play ProRes, QuickTime Animation and PNG MOV from a VP9 alpha copy that QCut writes into the project's cache.
- `qcut editor media info` reports a video's codec, pixel format, alpha mode and `hasAlpha`, and `timeline export` marks each media clip with `hasAlpha`. `element patch`, batch adds and `timeline apply --verify` take a clip's `blendMode` and `blendEnabled`, so an overlay track round-trips.
- The independent engine adds the other nine smart body controls (small head, swan neck, slim arms, square shoulders, shoulder width, slim body, slim waist, bust and hip shape) beside the long leg, all ten in one smart-body stage after makeup.

### Fixed
- Native export: clips on an upper media track that played over the main track were appended after it, so a 15.04 s timeline exported as 25.75 s of full-screen clips on black. They are now composited over the picture. Stacks the native engine cannot draw (a transition on an overlay, neural frame interpolation on one, or a text, sticker, adjustment or effect layer below one) export through the editor engine, and `--engine native` says why.
- Editor engine: a VP9 clip with alpha decoded onto black, and ProRes, QuickTime Animation and PNG MOV clips were left out without a word. A clip that cannot be decoded now fails the export with its name, file and reason. The editor's export button keeps VP9 alpha too.
- FFmpeg layer compositing dropped a clip's last frame when its file ended inside the clip (a WebM lost one more); this affected the editor's CLI export and native transitions.
- Native export: audio limiters delayed the sound by their 3–5 ms lookahead, and a clip limiter raised the level up to its ceiling. The editor engine's compressor and limiter added Chromium's makeup gain (+0.57 dB for a −1 dB limiter, +0.91 dB for the default compressor), so it exported louder than native. Both engines now keep the timeline's timing and level.
- Native export: a moving sticker started wherever its loop had got to instead of on its own first frame, and a clip with its blend section switched off kept its opacity.

### Verified
- In the app, one clip with the same transparent card in all four formats above it exports from both engines with 144 of 144 frames, the card on exactly its frames and the picture showing through its clear pixels; the two engines agree at 58 dB. `timeline export` → `apply --replace` keeps every overlay field, and a broken MOV fails both exports by name. The requester's four test files (native): the transparent area is 45–48 dB against the plain picture and the text 39.8–41.5 dB against FFmpeg's own overlay. Real title cards composited onto the original clip match the version baked by hand at 44–45 dB.
- Clicks through a track compressor and a −1 dB master limiter land on time in both engines (native was 3.02 ms late), and the level matches the source within 0.07 dB in both (the editor engine was 1.48 dB louder).
- Smart body: the port is byte-identical to the research implementation on 138 cases, its accepted meshes and both face frames. A 1080×1920 export with long legs, slim waist and small head follows the engine's render on the moved pixels (2.7–3.0 grey levels, against 43–45 from the photo).

### Limitations
- The editor engine decodes transparent videos frame by frame through the video element, so long overlays export more slowly there.
- The two engines read untagged media differently (BT.709 in the editor, BT.601 in FFmpeg), so coloured overlay text can differ slightly between them; white text does not.
- Smart body stills use eight updates of the pose, fitted to native renders rather than reproduced; one person, upright frames, and no smoothing across video frames.

## [2026.10.17.2] - 2026-10-17

### Improved
- Manual body edits now run on the independent engine for timeline clips: stretch, slim and zoom follow rules measured from native renders (stretch moves each side of the band 5 % of the frame height outward, or 2 % inward; slim moves along the box's own horizontal axis, rotated boxes included, from a measured 41×41 displacement table; zoom is a radial displacement measured on the frame's short side). They run in the native order (stretch, slim, zoom) after skin and before face shaping. An engine that cannot render a tool names it in the portrait panel instead of switching to native, and Beauty Lab lists the tools the installed engine renders.
- The independent engine adds the smart body long leg (长腿, 0–100), applied after makeup. It finds the person with QCut's own port of the two body-keypoint networks (a coarse pass on the frame scaled to 640 px on the long side, then two refinement passes) and stretches the legs with a mesh warp drawn in Metal, taking about 0.3–0.5 s a frame.

### Fixed
- Native export: the main track's sound no longer drifts later at every cut. Each clip was 40–60 ms later than the one before it, because every segment's AAC start-up delay and end padding survived the concat. Segments and gaps now carry PCM sound in the export's format and the joined sound is encoded once; picture-only and silent clips get silence, frame-interpolated clips keep their own sound, and the cursor pass keeps the segment's trimmed sound.
- Editor export: a timeline that ends less than 1 ms past a frame no longer gains a frame (212.250301 s at 24 fps is 5094 frames), and a cut a fraction of a microsecond after a frame start no longer shows the outgoing clip for one extra frame.
- Master level and pan automation now applies in the editor export, so a master fade-out fades the file.
- An API export on auto sent clips whose only portrait edits were makeup, manual body, manual retouch or per-face settings to the native engine, which dropped those edits; any portrait edit that changes the picture now routes the export to the renderer.

### Verified
- Eight hard cuts from a 32 kHz source drifted 0/62/115/151/197/247/306/340 ms before the fix and 0.04 ms after. In the app, both engines export a 204-frame, eight-cut project frame for frame, with clicks within 0.06 ms and the master fade at about −48 dB; native stems match within 0.06 ms.
- Manual body against native on coordinate-coded frames: slim within 1.85 px and zoom within 1.27 px; timeline exports of stretch, slim and zoom match the engine's render with a 0.3 px median error.
- Long leg: both networks reproduce native inputs and outputs bit for bit and the two refinement boxes match native exactly. Against native renders the mean difference is 0.86–4.65 grey levels, where the effect itself changes 5–10. A 1080×1920 export at 100 differs from the engine's render by 2.63 on the legs (encoding noise 2.28) and from the original by 24.55.

### Limitations
- Manual body: the whole-frame sub-pixel resample native applies (up to 1.2 px horizontally) is not reproduced, and most of the remaining difference on photos comes from it.
- Long leg: the still-frame body measurement is fitted to native renders rather than reproduced, one person only, with no smoothing across video frames; a small person in a landscape frame is not detected (native does not detect one either). Native's second refinement pass can run in floating point, which moves 11 of 18 joints by 1–5 px. The other smart body controls remain native only.
- The long leg needs the body networks in the external runtime. They are extracted on the machine from the installed model and are not distributed, so existing independent-engine installations need the updated runtime.

## [2026.10.17.1] - 2026-10-17

### Improved
- Smart shot split: `qcut editor timeline shot-split` finds a clip's cuts with the bundled local shot model (ONNX or FFmpeg scene detection when it is unavailable, `qcut editor analyze engines` says which), takes manual cut points, a minimum shot length and dry runs, and splits on the timeline as one undo step; the same split is in the clip's context menu. `qcut editor analyze shots` reports cut times.
- Colour: `qcut editor element color` sets the 15 basic controls on a clip or a whole track as one undo step, `qcut editor element filter --resource-id` applies a filter preset, and `element patch` accepts `color` and `adjustments`. Adjustment layers export through the native engine; layers with masks or multi-pass effects, clips with a filter stack, GL transitions and animated grades that use the tonal controls export through the editor engine automatically, and `--engine native` says why it is refused.
- Captions: `qcut editor captions import` puts an SRT, VTT or ASS file on captions tracks (overlapping cues get their own lane and stack upward in the preview and both exports; `--replace` swaps the old tracks in one transaction). Caption placement and stacking are the same in the preview, the editor export and the native export.
- Beats: `qcut editor beats mark` reads a clip's tempo and beats from the periodicity of its onsets (no threshold to tune), marks them in the editor's beat store and can bookmark the downbeats; `qcut editor timeline snap --to beats` moves clips onto the nearest beat (`--edge start|end|onset` — onset puts a sound effect's first attack on the beat — `--frame-align`, `--max-distance`, `--downbeats-only`, `--dry-run`), with visual clips landing on whole frames.
- Timeline round trip: `qcut editor timeline export` carries the mix (buses and master), each track's colour, mute, hidden, lock and audio settings, and `qcut editor timeline apply --replace --verify` restores all of it, trims included, in batches sized to the project (a 132-clip, 26-track project in one command). Ripple `delete-range` moves level and pan automation with the clips (`--keep-automation` leaves it).
- `qcut editor project duplicate` copies the media (into the copy's own folder), media folders, every scene's timeline, stickers and the mix, and names the copy "原名（副本）". `qcut editor track update --lock|--unlock|--hide|--unhide`; `add-element` text accepts `anchor` (e.g. `bottom-center`) instead of pixel offsets; transition refusals name the failing check.
- Text and captions render the same from both export engines: the native pass sizes each font to the preview's em, draws the glow as a blurred copy of the glyphs, honours letter spacing and the text box, and uses the preview's caption insets.

### Fixed
- Native export timing: timeline gaps are kept as black and silence, so text, stickers, adjustment layers and audio tracks after a gap stay where the timeline has them; the picture and sound start at zero (they ran 21–40 ms late after the concat, plus a third of a frame per text, sticker or adjustment pass); an untrimmed clip no longer loses its last frame; both engines end the file where the timeline ends (the editor engine cut its last frame to the remainder instead of adding a whole frame).
- Native colour grades match the preview: a static basic grade is rendered through a cube of the preview's own pixel maths, so shadows, highlights, whites, blacks, fade, saturation, vibrance and exposure come out as shown (FFmpeg's eq could not lift black and clipped above about +1.5 exposure).
- A trimmed clip restored by `timeline apply` kept its trims (the export's duration was trimmed already); `timeline apply` aborts before touching the mixer when the mix cannot be read; the master patch no longer tries to solo the master.
- Routes that change the open project refuse another project with 409 (batch cuts, shot split and the rest); a cut list is bound to its project; `project duplicate` rewrites media paths on Windows too.
- GL transitions were silently dropped on write and reported as added; a transition request without a numeric `duration` is refused with that reason.
- A range delete at a half-frame boundary left a zero-length sliver; a split clip keeps its transition on the half that still touches the next clip; the editor export creates its output folder first.

### Verified
- The drill film (212.25 s, 12 clips, 24 fps) exports natively with 5094 frames = the timeline, no frame gaps at the seams, cut points within 0.11 frame of the timeline and the picture starting at 0; the 26-track, 132-clip project round-trips through `timeline export` → `apply --replace --verify` with 0 field differences; text measured from both engines agrees within 4 px and the stacked captions sit at the same offsets; the trailer cue reads 142.4 BPM against a 144 BPM reference.

### Limitations
- Both export engines' files run up to two AAC frames (about 21–43 ms) longer than the timeline because sound is written in whole AAC frames; the picture ends on the timeline.
- Beat strength measures attacks, not loudness: a held note or a rest on a beat reads 0 even when it is loud.
- The shot model runs only where the local runtime is installed; elsewhere shot split uses ONNX or FFmpeg scene detection.

## [2026.10.16.2] - 2026-10-16

### Improved
- Mixer jobs: `qcut editor mix loudness` and `qcut editor mix stems` start a job and poll it, so a long programme no longer breaks the connection. `--timeout` (default 30 min) only bounds the wait and names the job when it runs out, `--no-wait` returns the job id at once, and `qcut editor mix job-status` follows a job from any terminal.
- `qcut editor mix loudness --engine native|browser`: the default renders the mix through the FFmpeg export pipeline and reports what FFmpeg's EBU R 128 meter reads on the exported file; `browser` measures the editor's own graph (the preview, the muxer engine and the mixer panel's Measure).
- Command line tool: `qcut cli install` writes a `qcut` launcher (`~/.local/bin/qcut`; Windows `%LOCALAPPDATA%\QCut\bin\qcut.cmd`) that runs the command bundled with the installed app, so it follows app updates; the same "Install command line tool" button is in About & updates and in Settings. `qcut cli status` says which qcut a terminal runs and what shadows it on PATH; `qcut --version`, `qcut --help` and `qcut editor health` report the command's QCut version, with a warning when it differs from the app's; `qcut update` says whether the command it ran will follow the update.
- `qcut editor export cancel` stops a running native export and removes its partial output; `--poll --json` keeps stdout to one JSON document (the job announcement goes to stderr).
- `qcut editor ui switch-panel --panel mixer`; `timeline export` media clips carry `name` and the same `audio` shape the write commands take (volumeDb, fades, pan).
- Stems are written as 48 kHz 32-bit float WAV, so a bus that passes full scale is not clipped.

### Fixed
- Exporting to another disk (an external drive) failed with EXDEV and left a 240 MB intermediate file; files now move across volumes by copying, and a failed mix leaves nothing behind.
- Stems and the preview lifted sub-bass: the pass-through low- and high-cut filters in the clip chain and in every strip carried Web Audio's default resonance (+1 dB at the cut), and four in a row gave 25 Hz +7.8 dB, 40 Hz +4.7 dB, a shotgun clip +2.2 dB and clipped 16-bit stems. Unused cuts now sit at exact identity (0 Hz / Nyquist) and active ones are Butterworth, like FFmpeg's.
- Loudness and stems no longer stop after 120 s with a false "Cannot connect to QCut"; a closed connection, a connect timeout and an unreachable editor each get their own message.
- Export audio defaults to 48 kHz (export dialog, native export, MP3), and an export is no longer two frames short when a clip's AAC audio ends a frame before its picture.
- Finished mix jobs are pruned past the 50-job limit; cancelling the export behind a loudness measurement ends the job instead of polling forever; a cancel that lands after the last FFmpeg step still removes the file.
- Windows launcher paths escape `%`; paths with `"` are refused.

### Verified
- On the 233.5 s, 26-track test programme: `mix loudness` reads −20.2 LUFS / −1.9 dBTP, identical to FFmpeg's ebur128 of the export; the picture lane's stem matches its source within 0.07 dB with no clipping; export with stems to an external disk completes in 349 s with no intermediate files; cancelling an export at 21% ends both FFmpeg processes and removes the temp folders and the partial output.

### Limitations
- The mixer panel's Measure shows the editor's rendering; the FFmpeg export can differ by a few tenths of an LU when the master limiter works hard. `qcut editor mix loudness` (default engine) gives the exported number.
- Exports that run in the editor window (the muxer engine) cannot be cancelled from the CLI.

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
