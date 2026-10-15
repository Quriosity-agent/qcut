---
version: "2026.10.15.1"
date: "2026-10-15"
channel: "stable"
---

# QCut v2026.10.15.1

### Fixed
- Native manual body shaping now participates in the same source-history replay used by export, including combinations with intelligent body shaping and paused reverse seeks. Intelligent body shaping can also recover after a cold start.
- Manual body region controls stay aligned when a clip is rotated, mirrored or scaled.
- Filter CLI render and pipeline commands preserve full Windows file IDs when comparing input and output files, so different files are not mistaken for the same source. Hard-link, symlink and overwrite protections remain in place.

### Verified
- A 1080×1920, 30 fps, six-second moving-person fixture covers original, intelligent, manual and combined body paths with scale/crop keyframes, a dissolve and reverse seeks. All 64 sampled paused-preview/pre-encode export comparisons differ by at most one RGB level with identical alpha. All four exported videos decode to 180 frames with matching presentation timestamps.

### Limitations
- Acceptance covers sampled paused previews and the native runtime integration. Continuous real-time preview consistency, independent body rendering, a separate Jianying UI comparison, multi-person tracking, occlusion recovery, long-session stability and audio synchronization remain unverified.
- Native body processing remains slow: the six-second intelligent/manual/combined exports took approximately 15.4/37.6/53.1 minutes on the test machine. Body warps can also move the surrounding background; these tests do not establish background protection or visual quality across body types and clothing.
