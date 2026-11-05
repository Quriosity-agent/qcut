---
version: "2026.11.05.1"
date: "2026-11-05"
channel: "stable"
---

# QCut v2026.11.05.1

### Fixed

- Exporting one project twice gives the same sound, sample for sample. FFmpeg reads each sound on its own thread, and two things depended on which one got there first: a ducked clip's last moments could lose their ducking, and after the first sound of a mix ended a level or pan curve could lose track of the time, which can come out silent. In a 170-second trailer the mix came out five different ways in 24 tries, and those tiny differences could send the AAC encoder down another path from there to the end, with true peaks 0.6 dB apart. It now comes out one way.
- Text and caption colours work as documented in every export: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`, `hsla()` and the CSS names such as `red` (#532). A name used to come out black or white from the native export and wrong from the Export dialog's FFmpeg export. A colour with its own alpha replaces its opacity field, as in the preview, and the preview now applies the opacity field to a name or an `rgb()` colour as well. Any other form (`oklch()`, a typo) draws white, or black for a shadow; the native export names it in `warnings`.
- The native export draws a text element's background: its own colour, opacity, size and corner radius, under the text. It used to draw a box in the outline colour, tight around the letters, or none at all when the text had no outline. A rotated text element now turns about the centre of its box, as in the preview.
- The Export dialog's FFmpeg export draws text elements at the size and position the preview and the native export draw them. In fonts such as Arial and Helvetica they came out 10–15 % smaller.
- Captions that overlap in time are stacked by the Export dialog's FFmpeg export as they are by the preview and the native export. They used to draw over each other.
- The Export dialog's FFmpeg export scales text and captions with the export's resolution when it differs from the project canvas, as the native export does. A 1470×630 project exported at 1080p used to draw them at their project size on a 2520×1080 frame, so about 40 % too small; an export smaller than the project drew them too large.
- In the Export dialog's FFmpeg export, a text element's outline keeps its own opacity, and Chinese, Japanese or Korean text in a font that cannot draw it falls back to the same font as captions and the native export.

- Canvas and WebCodecs exports now scale text, captions, outlines, shadows and animated text from the project canvas to the output resolution. Animated text rasterized for FFmpeg uses the same mapping and keeps the edges of its cropped frames.
- Captions use the preview's padded, rounded background across the native, canvas and FFmpeg exports, including bilingual and wrapped lines. Measured browser ASS sidecars include the background as well. The FFmpeg composition preserves background opacity instead of applying it again on a transparent intermediate.
- Native and FFmpeg text placement uses the font's metrics to match Canvas baselines and line spacing. Arial text previously sat about 9 project pixels too low at a 52 px font size.
- Standard MP4 exports now use the existing Canvas/WebCodecs pipeline with timeline frame timestamps and the project audio mix. The former canvas-only MediaRecorder path could silently omit audio and stretch a 3-second project to 4.91 seconds. Missing encoders now produce an error instead of a silent video-only fallback. The legacy WebM path is unchanged.
