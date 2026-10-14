---
version: "2026.10.14.2"
date: "2026-10-14"
channel: "stable"
---

# QCut v2026.10.14.2

### Improved
- Clips can change volume over time through the editor API and CLI, for example to duck music under speech. `editor timeline update-element` accepts `audio.keyframes.volumeDb`, and `batch-add` accepts the same object on new media clips. Compose manifests take `volumeKeyframes` on clips and sounds; headless renders and editable projects play the same envelope.
- `qcut compose schema` prints every compose manifest field with its type, default and meaning, plus a worked example. The `--config` help points to it, and the bundled CLI skill documents the manifest format.

### Fixed
- Muxer exports no longer start audio about 56 ms late. This covers web and iPad exports, and desktop timelines with local color or portrait edits, filter stacks, shader transitions or stabilization. The measured offset is now 0.04 ms, the same as the source. If the encoder's start-up delay cannot be measured, the export still completes with the previous offset.
- `editor navigator open` reports success only after the project has finished loading, and fails for a project that does not exist.
- Project settings changed through the CLI or API while the project is closed, such as the aspect ratio, now take effect when the project opens.
- Rejected editor API element updates report the reason instead of "Element not found". Audio settings sent through the API are checked for unknown names and wrong value types.
- Headless compose renders place stickers the way the editor does: `transform.x`/`y` set the sticker's centre, and `scale` sets its width relative to the canvas's shorter side. Stickers in existing manifests move accordingly, and stickers centred near an edge are no longer rejected as outside the canvas.

### Limitations
- Exported audio can still run up to about 30 ms past the last video frame. The latency of pitch-corrected clips is not measured, and the start-up delay measurement has only been verified on macOS.
- `compose project --target editor` still rejects manifests that contain stickers.
- A fixed manifest `volume` above 1 only applies to headless renders; use volume keyframes (up to +12 dB) to boost audio in editor projects.
