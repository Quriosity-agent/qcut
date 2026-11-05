# Desktop export acceptance for PR #533

Validated on macOS arm64 on 2026-11-05 with the source Electron production build. No model, proprietary binary, source footage, or generated media is part of this change.

## Desktop coverage

`export-desktop-acceptance.e2e.ts` creates an isolated project, imports a real encoded video/audio fixture, adds animated outlined text and bilingual captions, saves the timeline, reloads the editor, and exports through the actual Export panel. Only the native save-file picker is replaced with a deterministic test destination.

| Project canvas | Export panel | Editor export API |
| --- | --- | --- |
| 1280×720 | Native CLI 1920×1080 and 854×480; Standard 1920×1080 | Native and WebCodecs 1920×1080 |
| 720×1280 | Native CLI 1080×1920 and 480×854; Standard 1080×1920 | Native and WebCodecs 1080×1920 |

All ten outputs must have the requested dimensions, stereo audio RMS of 0.0625 ±0.003, three-second video/audio duration, a zero video start timestamp, visible text and caption backgrounds, and a successful full FFmpeg decode. Geometry is measured after resizing frames back to the project canvas: exports must agree within 3 px, and the editor preview within 4 px. The preview capture waits for the seek, fonts and paint frames. Background fill is checked against the expected 70% cyan composite as well as the preview, not just against another engine.

The desktop test found and now covers three defects that lower-level tests missed:

- Standard MP4 used a canvas-only MediaRecorder stream: its three-second project produced a silent 4.911833-second file. Standard MP4 now uses the existing offline Canvas/WebCodecs muxer. Missing codecs or initialization failure produce an error instead of falling back to the silent recorder.
- ASS rendered onto a transparent intermediate applied opacity twice. A 70% cyan box measured roughly `[20,94,94]`, versus `[9,187,188]` from native and Canvas output. Normal ASS layers now render directly into the ordered composite. Multiply/screen use their exact white/black matte identities; the remaining blend modes reconstruct coverage from black and white renders. Real FFmpeg tests cover transparency, overlapping glyphs/shadows, inactive periods and layer order.
- Native Arial text at 52 px sat about nine project pixels lower than Canvas. Baseline placement now derives from the font tables and Chromium's Canvas baseline convention, including explicit multiline leading.

Screenshots, exports, probes, measured bounds and audio levels are written under the ignored `QCUT_EXPORT_ACCEPTANCE_DIR`. Text is sampled at 1.5 seconds after the entrance has settled. Separate real Canvas tests exercise fade, slide and blur animation rasterization across output sizes; this desktop sample does not establish native API entrance-animation parity.

## Audio regressions

The real FFmpeg mix tests assert signal content as well as repeatability:

- Eight repeated mixes retain the expected −13 dB late voice level after shorter inputs end.
- Track, bus and master automation preserve left/right pan, expected gain, the delayed input's silent lead-in and exact PCM length.
- Ducking remains −21 ±0.5 dB through the music's final 140 ms.

Local mutation checks separately replaced output with silence, froze timestamps and removed timestamps. Each mutation failed five real render tests; restoring the implementation passed all seven tests. Merely removing the timestamp repair did not reproduce the scheduling race during this run, so that mutation is not claimed as a deterministic reproduction.

The frozen-source full Vitest run passed 18,736 tests in 1,992 files, with 102 conditional skips. Repository typechecking and lint completed successfully; lint reported warnings but no errors.

## 32 real source clips

The existing `editor-real-batch-workflow.ts` was rerun in a fresh test project using the local 32-clip trailer fixture:

- Import, playback, saved-project reopen and authenticated sidecar synchronization passed.
- Both complete 1470×630, 24 fps exports decoded successfully: 805 frames and 33.541667 seconds.
- The +12 dB stress mix measured +10.6 dBTP without limiting and −1.5 dBTP with the −1 dBTP ceiling enabled.
- Limited and unlimited exports had identical video packet hashes; all 32 source hashes remained unchanged.

This real-footage pair uses the editor's native export API; the two synthetic projects above exercise the Export panel controls. It is a fresh 33.54-second regression fixture, not a replay of the earlier 170-second, 373-element trailer audit.

## Reproduction

```sh
bun run build
QCUT_EXPORT_ACCEPTANCE_DIR="$PWD/.local/export-desktop-acceptance" \
  bunx playwright test export-desktop-acceptance.e2e.ts \
  --reporter=list --output=.local/export-desktop-playwright
bunx vitest run --config vitest.config.ts \
  electron/__tests__/audio-mix-determinism-real.test.ts \
  electron/__tests__/caption-background-real.test.ts \
  electron/__tests__/ass-alpha-composition-real.test.ts \
  apps/web/src/lib/export/__tests__/export-project-canvas.test.ts \
  apps/web/src/lib/export/__tests__/export-engine-standard-mp4.test.ts
```

The desktop test requires a working Electron display and staged FFmpeg binaries. Font-dependent real-render unit cases report skips when their required fonts or binaries are absent. Legacy Standard WebM, installer packaging, long-duration memory behavior and subframe audio/video synchronization are outside this acceptance run.
