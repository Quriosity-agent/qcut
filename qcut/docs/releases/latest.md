---
version: "2026.10.14.1"
date: "2026-10-14"
channel: "stable"
---

# QCut v2026.10.14.1

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
