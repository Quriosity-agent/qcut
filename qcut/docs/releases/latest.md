---
version: "2026.10.16.1"
date: "2026-10-16"
channel: "stable"
---

# QCut v2026.10.16.1

### Improved
- Mixer: a new Mixer panel in the media panel and a mix button on every audio track header. Each track has a level fader, pan, output bus, mute, solo, EQ/compressor/limiter and ducking; buses can be created, renamed and removed, and a track is sent to a bus by dragging it there; the master shows live momentary, short-term and integrated loudness and can measure the whole mix as exported (integrated LUFS, loudest 3 s, true peak).
- Level and pan automation: tracks, buses and the master can follow curves over timeline time, edited from each strip's A button or from the CLI. The preview and every export engine follow them.
- Stems: "Export stems per bus (WAV)" in the export dialog and `qcut editor export start --stems` write one WAV per bus beside the export; `qcut editor mix stems` writes them into a folder.
- CLI: `qcut editor track audio-get|audio-set|audio-automation|mute|solo` and `qcut editor mix export|bus-list|bus-create|bus-set|bus-remove|bus-automation|master-set|loudness|stems`. Every setting is range-checked and read back from the editor, and `timeline export` includes each track's mix settings and the project's buses.
- Track and clip colours: audio clips, and every other clip type, show their colour label; a track can carry a default colour its clips inherit; `qcut editor track create|update --color`, `qcut editor timeline color-label` and `qcut editor timeline select --color`.
- Electron E2E suite: each spec runs against an isolated QCut instance with its own data and a chosen locale, a smoke set (`bun run test:e2e:smoke`) covers 42 specs, and the specs are type-checked with the rest of the code.

### Fixed
- Exports apply the project mix (track levels, pan, buses, master, solo and ducking) in all three engines (in-browser, FFmpeg and the native CLI export) and in standalone MP3 exports; before, only the preview did.
- A direct-copy FFmpeg export no longer drops a video clip's own audio when audio tracks or a mix are present.
- A mix that silences every track exports silence instead of falling back to the raw audio.
- Ducking in FFmpeg exports reaches exactly the set depth.
- Keyboard crop and crop reset are saved as crop edits.
- The error shown when the editor is not ready within the allowed wait no longer varies with machine load.

### Verified
- Real exports from all three engines measured with FFmpeg: music −8.0 dB, SFX through a −4 dB bus and a −2 dB master −6.0 dB, picture audio −12.0 dB and −32 dB after its level curve, ducking 11.6–11.7 dB, soloed-out tracks below −66 dB. Stems are the programme's length and line up with the mix. Measured loudness matches FFmpeg's EBU R 128 meter within 0.1 LU.

### Limitations
- Automation curves are edited as point lists in the mixer, not drawn on the timeline lanes.
- Stems leave each bus before the master, so the master's level and limiter are not in them.
- The E2E suite runs locally only; it is not part of CI yet.
