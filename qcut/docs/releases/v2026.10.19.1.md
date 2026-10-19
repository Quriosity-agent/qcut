---
version: "2026.10.19.1"
date: "2026-10-19"
channel: "stable"
---

# QCut v2026.10.19.1

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
