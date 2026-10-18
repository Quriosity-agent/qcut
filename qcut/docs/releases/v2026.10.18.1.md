---
version: "2026.10.18.1"
date: "2026-10-17"
channel: "stable"
---

# QCut v2026.10.18.1

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
