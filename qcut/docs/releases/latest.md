---
version: "2026.11.10.1"
date: "2026-11-09"
channel: "stable"
---

# QCut v2026.11.10.1

### Added

- `editor:export:start` without `--preset` exports the project's own picture: its canvas size and frame rate, as MP4, at the bitrate of the YouTube preset of that size (5 Mbps up to 720p, 8 Mbps up to 1080p, 45 Mbps above), and the job reports `presetId: "project"`. A 1470×630, 24 fps project used to come out at 1920×1080, 30 fps unless `--data` said otherwise. A named preset, or values given with the request, still win.
- `editor:export:start --start-time <seconds> --end-time <seconds>` writes only that part of the timeline, as it plays in the full export. Every clip, overlay, transition and the mix keep their timeline timing; clips whose picture cannot show in the range are not decoded for their picture (their sound still is, so a limiter, ducking or fade reaching into the range hears what plays before it), overlays outside the range are not drawn, and the finished picture and the whole-programme mix are cut to the range. Both ends snap to the export's frames; a range outside the timeline is refused before anything is queued. Native MP4 and MOV exports only. The job reports the `range` it wrote and the file's `duration`.
- `editor:mix:loudness --start-time/--end-time` measures a stretch of the native rendering. The whole mix is still rendered, so the stretch reads as it plays in the export, and the result names it in `range`.
- `editor:timeline:replace-media --match-loudness` keeps the clip as loud as it was: the old and the new file are measured with FFmpeg's EBU R 128 meter over the stretch the clip plays (from its in-point, its timeline length times its speed), and the difference goes into the clip's gain, `audio.volumeDb` and every volumeDb keyframe with it, in the same change as the new media. The answer adds `loudness` (`previousLufs`, `replacementLufs`, `gainChangeDb`, `volumeDb`, and `clamped` when the −60..12 dB range cut the change short). A clip whose file is silent over the clip is refused before anything is imported; a silent replacement has its import taken back.

### Fixed

- `--start-time` and `--end-time` are read as numbers of seconds: `2:35` used to be read as 2 s, and text that is not a number was dropped as if the flag had not been given. Every command now refuses it with the reason.

### Documentation

- `editor-output.md` documents the project-picture default and range exports, `editor-mix.md` the measured stretch, `editor-timeline.md` `--match-loudness`, and `editor-core.md` the `--preset` default.
