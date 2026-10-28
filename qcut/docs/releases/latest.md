---
version: "2026.10.29.1"
date: "2026-10-28"
channel: "stable"
---

# QCut v2026.10.29.1

### Added

- `editor transaction list|status|rollback`: see timeline transactions, including one only the editor still holds, and end it (an orphan is discarded without restoring anything).
- `editor transcribe start --to-captions` puts a finished transcript on captions tracks (with `--style`, `--preset`, `--replace`); `captions import --preset film` (电影字幕: no box, thin outline, soft shadow), also in the captions panel presets.
- `editor track move --above <trackId>` / `--below <trackId>` puts a track directly over or under another one; the answer has the resulting index and order.
- Bilingual captions: a caption can carry a second-language line (`secondaryContent`) in its own font, size, colour, weight and slant (`style.secondary`), drawn under its text by the preview and both exports at the same places; `captions import --secondary-file` takes the second lines from another subtitle file by time, and SRT/VTT/ASS/TTML exports write the line as the cue's second line.

### Fixed

- `add-element` with a `trackId` that no longer exists fails with `Track not found` instead of putting the clip on a new track; the answer names the track used. A delete removes only the track it emptied (a new, unfilled track survives deletes elsewhere) and says when it removed one.
- A `captions import` whose transaction begin timed out no longer leaves a transaction that blocks every later import; commit/rollback timeouts stay recoverable, and the utility API waits the full 25 s for `navigator open`.
- Caption style accepts the text element's field names and top-level style fields, and names every field it cannot use instead of dropping it.
- Bold captions in families outside `/System/Library/Fonts/Supplemental` (e.g. Avenir Next) export upright: libass gets a per-export folder with just the used fonts from every macOS font folder (also ~420 MB less memory per text export).
- `--provider elevenlabs` transcription uses `ELEVENLABS_API_KEY` directly, else the signed-in QCut account, else a FAL key; test placeholder keys are skipped and the error names what is missing. E2E runs no longer write the user's credential files.
- Explicit line breaks in captions are drawn by the preview and the canvas export too, and stacked captions make room for every line.
- `delete-element` answers once the editor's timeline no longer has the element (`confirmed`), and a `timeline export` right after it can no longer get the late answer of an older, timed-out read (each read is matched to its own request).
- `media:batch-import` answers once the editor has loaded the copied files (`editorReady` per file), so an `add-element` right after finds them; a single add waits up to 25 s for a busy editor and, if it still times out, says the element may yet be placed.
- Multi-line captions keep the preview's line spacing in the native export, and captions in fonts whose two line-height metrics differ (e.g. Songti SC) sit where the canvas export draws them.
- `transcribe start --to-captions` checks `--style` and `--preset` before transcribing, and Gemini transcripts no longer run their segments together.
- The native export applies a main-track clip's own volume, mute (`audio.enabled: false`), volume keyframes and fades (it played the clip as imported), and gives audio-track and overlay clips their full audio settings, as the muxer export does; main-track clips whose other audio effects only the muxer export applies are listed in the export's warnings.
- `timeline batch-delete` accepts `--cuts` as well as `--elements`, and without `--ripple` keeps every gap, on the main track too; a single `add-element` honours `collision` (`insert`, `overwrite`, `reject`) as `batch-add` does.
- `editor undo` / `redo` answer the step they took back or redid (`label`) and what it changed (`changes`), and fail when nothing changed instead of printing ok.
- A ripple delete, a ripple move and `editor:track:delete --ripple` no longer move clips they do not ripple, and an overlap under half a frame (which a placement accepts) stays where the ripple puts it: two sound effects that overlapped a neighbour by a few milliseconds were nudged.
