---
version: "2026.11.02.1"
date: "2026-11-01"
channel: "stable"
---

# QCut v2026.11.02.1

### Added

- With `QCUT_EXPORT_KEEP_TEMP=1` in QCut's environment, a native export keeps its intermediate files (its segments, the video before the audio mix, the mixed master, and the limiter's audio before and after each correction) and logs where they are, so two exports of one project can be compared step by step. It is off by default: a kept folder holds a full-size intermediate video.

### Fixed

- Media deleted moments after it was imported no longer stays in the project. After an import QCut reads the file's thumbnail and duration in the background and then saves the item again; a delete that ran in the meantime failed or had the item written back, so a `replace-media --source` that was refused kept the file it had just imported in two of six tries. A delete now waits for a save already under way and drops later saves of the removed item, and a deleted item no longer reappears in the media panel when the background read finishes.
- When a refused `replace-media --source` still cannot take back the file it imported, the error says so, names the file and gives the `qcut editor:media:delete` command that removes it; it used to report a clean refusal. A failed removal is retried once.
- `editor:snapshot:check` no longer reports `check_failed` for a switch that did change: it read the switch the moment it clicked it, before QCut had redrawn it. It now waits up to a second for the change and answers with `checked`, the state the control settled on, and `changed`, which is false when the control already held that state and was left alone.
- The native export draws a text element's shadow blurred by its `shadowBlur`, as the preview does. A shadow without an offset was not drawn at all, and the blur was ignored. A shadow colour with its own alpha (`#rrggbbaa`, `rgba(…)`) uses that alpha instead of the shadow opacity, also as in the preview.
- The Export dialog's FFmpeg export draws captions at the size and position the preview and the native export draw them. In fonts such as Arial and Helvetica they came out 10–15 % smaller. QCut now measures each caption font, as the native export already did; the still preview frame QCut renders with FFmpeg uses the same sizes.
- Text and captions in a font that can draw Chinese, Japanese or Korean (Songti SC, for one) keep that font in the Export dialog's FFmpeg export. Any such character used to switch the font to the platform's CJK font, so a serif caption exported in a sans. A font that cannot draw the text still gets the platform's font; for captions, an installed font that covers the text counts as well, as in the native export.

### Limitations

- Text elements, unlike captions, are still drawn 10–15 % small by the Export dialog's FFmpeg export in fonts such as Arial and Helvetica; the native export draws them at the preview's size.
- Captions that overlap in time are stacked differently by the Export dialog's FFmpeg export than by the preview and the native export.
- A text shadow colour given by name (`red`) exports as black from the native export; hex, `rgb()` and `rgba()` colours export as set (#532).
- Exporting one project twice can still give slightly different audio. Of four native exports of one project, two had identical audio; one differed over 40 ms near 20 s, the other from 20 s to the end with a true peak 0.6 dB higher. The cause is not found yet; `QCUT_EXPORT_KEEP_TEMP` is there to find it.
