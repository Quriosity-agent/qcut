---
version: "2026.10.30.1"
date: "2026-10-30"
channel: "stable"
---

# QCut v2026.10.30.1

### Added

- `export start --peak-correction local|whole|check` (`peakCorrection` in the request) chooses what a native export with the master limiter on does when encoding pushes the true peak over the ceiling. `local` (the default) lowers only the moments around the overshoot. `whole` lowers the whole mix by the overshoot, as before 2026.10.29.3, which keeps the mix's level relationships. `check` lowers nothing, publishes the first encode and reports `exceeded` with a warning.
- `audioValidation.limiting.corrections` lists each stretch an export lowered (its ramps included), with its start, end and depth, next to `peakCorrection`, `correctedSeconds` (now their total, ramps included) and `maxCorrectionDb`. `editor mix loudness` with the native engine also returns this (`audioValidation`), so the stretches a default (`local`) export would lower are known before exporting; it measures with `local` whatever correction the export will use.
- `editor timeline replace-media --element-id <clip> --source <file>` (or `--media-id`) gives a media clip another file in one step. The clip keeps its track, start, length, in-point and every setting; only its source and the out trim that follows from the new file's length change, as one undo step. Media that ends before the clip's out-point is refused and the clip stays as it was; `--trim-start` reads the new media from another point. The same swap is an `update-element` patch with `mediaId`.
- Caption styles take film-subtitle looks: `fontWeight` 100–900 (a SemiBold 600 face), `letterSpacing` and `fontWeight` of the second-language line's own, `shadows` (up to four soft shadows with colour, opacity, blur and offset, drawn under both lines) and `fadeInFrames`/`fadeOutFrames` (fades counted in frames at the project rate). The preview, the canvas export, the native export and the Export dialog's FFmpeg export draw them alike, so a cue's look follows it when its time changes.

- `editor health` reports `releaseVersion` (the version as releases name it) and `lastUpdate`: the version QCut updated from, the one it updated to, when the new one first ran, and its release notes. The first editor command after an update says so once on stderr, so a silent overnight update no longer goes unnoticed.

### Changed

- Read-only editor commands read a project the editor does not have open as it was last saved, instead of answering 409 or switching what is open: `timeline export`, `mix export`, `project stats` and the timeline summary and report. They used to answer with the open project's numbers whatever id they were given. A timeline read from storage says `readFromStorage: true`.
- The native export draws Chinese in an installed font that covers it, such as Source Han Serif CN, instead of only in a fixed list of families; other fonts still get the platform's CJK font.
