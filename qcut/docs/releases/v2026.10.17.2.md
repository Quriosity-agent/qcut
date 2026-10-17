---
version: "2026.10.17.2"
date: "2026-10-17"
channel: "stable"
---

# QCut v2026.10.17.2

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
