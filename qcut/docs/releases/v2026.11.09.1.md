---
version: "2026.11.09.1"
date: "2026-11-08"
channel: "stable"
---

# QCut v2026.11.09.1

### Fixed

- A trimmed clip added by the CLI or the editor API (`add-element`, `batch-add`, `timeline apply`) takes the length it was given, or is refused with the reason. A clip's `duration` is its source span before its trims, but `timeline export` writes the span after them, so a clip written the way the export reads (8.5 s, cut from a 15.04 s file by trimEnd 6.54 s) went onto the timeline 1.96 s long, without an error. Every add now reads lengths both ways: beside `timelineDuration` (the length on the timeline), `duration` is the span after the trims, as the export writes it, and an `endTime` alone is where the clip ends. Without `timelineDuration`, a trimmed video or audio clip's `duration` must be its file's whole length; a shorter one is refused, and the message gives both ways to write the clip.
- A clip with nothing left after its trims is refused. Such clips used to be placed at 0 s, and a refused clip in `timeline apply --atomic` rolls the whole apply back, named by its alias.
- `timeline apply --verify` checks where each clip ends on the timeline even when the manifest gives no `endTime`, and compares a `timelineDuration` the manifest gives with the clip's length on the timeline. It used to check only lengths worked out from the manifest's own `duration`, so it passed clips that were placed at the wrong length.
- An export given only `--output-dir`, or no location at all, is named after its project: `<project name>-<YYYY-MM-DD-HHMMSS>.<format>`. It used to be `export-<time>.mp4` with `--output-dir` and the project id without one. Names keep their Chinese and other letters; only characters a file name cannot hold become `-`. A name already in the folder gets `-2`, `-3`…, so two exports within one second no longer write over each other.
- `editor:media:batch-import` returns each file's length, size and frame rate, as `media list` does, so a script can work out its trims without listing the media again.
- CLI commands that look for FFprobe, such as `project create --match-media`, no longer print `[FFmpeg] Using staged FFprobe binary…` on stderr; the line shows with `--verbose`, but never under `--stream`, whose stderr carries JSONL events.

### Documentation

- `editor-timeline.md` explains which length is which for a trimmed clip, with an example. `editor-output.md` documents `--output`, `--filename`, `--stems` and the default file name for `editor:export:start`. `editor-core.md` points scripts at `--json --flat`, which prints a command's payload without the two `data` wrappers.
