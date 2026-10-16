---
version: "2026.10.16.2"
date: "2026-10-16"
channel: "stable"
---

# QCut v2026.10.16.2

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
