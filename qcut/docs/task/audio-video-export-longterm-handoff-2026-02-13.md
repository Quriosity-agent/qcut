# Audio + Video Export Long-Term Handoff (2026-02-13)

## Request Context

User requested long-term fix and verification for export bug where timeline with video + audio exports video-only.

## What Was Implemented

1. Added stable audio checkbox test selector:
   - `apps/web/src/components/export-dialog.tsx`
   - Added `data-testid="export-include-audio-checkbox"` on the include-audio checkbox.

2. Added new E2E regression spec:
   - `apps/web/src/test/e2e/audio-video-simultaneous-export.e2e.ts`
   - Test flow:
     - Create project
     - Import `sample-video.mp4` + `sample-audio.mp3`
     - Place media into timeline
     - Export via CLI mode with audio enabled
     - Capture exported blob and validate for audio presence

3. Hardened CLI audio prep path:
   - `apps/web/src/lib/export-engine-cli.ts`
   - Changes:
     - Added `resolveAudioPreparationInputs()` to use engine snapshot (`this.tracks` / `this.mediaItems`) and hydrate missing media from storage when needed.
     - Updated audio temp saving to prefer typed API: `window.electronAPI.audio.saveTemp(...)` with fallback to `invoke("save-audio-for-export", ...)`.
     - Added warnings when `detectAudioSources()` says audio exists but extracted audio inputs are empty.
     - Added diagnostics for `includeAudio` and audio prep input counts.

4. Replaced broken audio fixture:
   - `apps/web/src/test/e2e/fixtures/media/sample-audio.mp3`
   - Regenerated with ffmpeg (valid 5s MP3).

## Key Findings

1. New E2E consistently reproduces issue:
   - Export logs show `Audio files: 0`.
   - Extract-audio validation on exported MP4 fails with no audio stream.

2. Root-cause-level observation from logs:
   - Timeline contains audio element and media element.
   - Export still chooses Mode 1 direct copy and sends zero audio inputs.
   - Final output contains only video stream.

3. Important environment detail discovered:
   - E2E runs Electron from built `dist/` artifacts.
   - Source code changes in `apps/web/src` / `electron` require rebuild before E2E reflects them.
   - Build command was started but interrupted by user before completion.

## Tests/Commands Executed

1. E2E reruns (many iterations), command:
   ```bash
   PLAYWRIGHT_HTML_OPEN=never bun run test:e2e -- apps/web/src/test/e2e/audio-video-simultaneous-export.e2e.ts --reporter=line
   ```
   Result: failed, audio missing in export.

2. Fixture validation:
   ```bash
   ffprobe -v error -show_streams -show_format apps/web/src/test/e2e/fixtures/media/sample-audio.mp3
   ```
   Result: valid MP3 with audio stream, 5.0s duration.

3. Interrupted before completion:
   ```bash
   cd apps/web && bun run build && cd ../.. && bun run build:electron
   ```

## Current Git State (at handoff)

- Modified:
  - `apps/web/src/components/export-dialog.tsx`
  - `apps/web/src/lib/export-cli/sources/index.ts`
  - `apps/web/src/lib/export-engine-cli.ts`
  - `apps/web/src/test/e2e/fixtures/media/sample-audio.mp3`
- Untracked:
  - `apps/web/src/lib/export-cli/sources/audio-sources.ts`
  - `apps/web/src/lib/export-cli/sources/__tests__/audio-sources.test.ts`
  - `apps/web/src/test/e2e/audio-video-simultaneous-export.e2e.ts`
  - `docs/task/console_audio_bug.md`
- Unrelated existing deletion (not touched in this task):
  - `docs/task/preload-fix-analysis.md`

## Exact Next Steps

1. Rebuild artifacts so runtime matches source:
   ```bash
   cd apps/web && bun run build && cd ../.. && bun run build:electron
   ```

2. Re-run focused E2E:
   ```bash
   PLAYWRIGHT_HTML_OPEN=never bun run test:e2e -- apps/web/src/test/e2e/audio-video-simultaneous-export.e2e.ts --reporter=line
   ```

3. If still failing with `Audio files: 0`, inspect built runtime logs around:
   - `[CLI Export] includeAudio option:`
   - `[CLIExportEngine] Audio preparation inputs:`
   - `[AudioSources] Collected ...`
   - `[CLI Export] Initial audio files count:`

4. If diagnostics still do not appear, confirm dist app is stale and rebuild succeeded.

## Long-Term Direction (recommended)

1. Keep request-scoped export inputs as single source of truth (`this.tracks` + `this.mediaItems`) and avoid reading mutable stores during export execution.
2. Keep audio extraction fallback chain:
   - `localPath` -> `file` bytes -> `url` fetch
3. Keep E2E assertion based on output artifact stream validation (not only UI status text).
4. Add a second E2E case for video-only timeline to guard embedded-audio path separately.

---

## Update (2026-02-13, Later Session)

### Additional Root Cause Confirmed

1. `apps/web/src/lib/export-engine-cli.ts` relied on `window.electronAPI.invoke(...)` for:
   - `file-exists`
   - `get-file-info`
   - `validate-audio-file`
2. `invoke` is not exposed by `electron/preload.ts`, so this path was brittle and could block export startup or drop audio inputs.

### Long-Term Fixes Added

1. Removed hard dependency on generic `invoke` in renderer audio flow:
   - Added typed-safe helpers in `CLIExportEngine`:
     - optional invoke bridge (only when available)
     - typed `getFileInfo` and `fileExists`
     - optional ffprobe validation wrapper
   - Audio validation now skips invalid files instead of aborting the whole export.

2. Narrowed overlay audio extraction to real audio timeline overlays:
   - `apps/web/src/lib/export-cli/sources/audio-sources.ts`
   - `collectAudioCandidates()` now collects from `audio` tracks only.
   - Media-track video audio remains in base video stream (Mode 1/2/1.5 handling), avoiding duplicate or invalid overlay inputs.

3. Updated unit tests for new extraction behavior:
   - `apps/web/src/lib/export-cli/sources/__tests__/audio-sources.test.ts`
   - Test now expects only audio-track candidates.

### Verification Results

1. Unit tests passed:
   ```bash
   cd apps/web && bunx vitest run src/lib/export-cli/sources/__tests__/audio-sources.test.ts src/lib/export-cli/sources/__tests__/audio-detection.test.ts
   ```

2. Type-check passed:
   ```bash
   cd apps/web && bunx tsc --noEmit -p tsconfig.json
   ```

3. Rebuilt runtime artifacts:
   ```bash
   cd apps/web && bun run build && cd ../.. && bun run build:electron
   ```

4. Focused E2E passed:
   ```bash
   PLAYWRIGHT_HTML_OPEN=never bun run test:e2e -- apps/web/src/test/e2e/audio-video-simultaneous-export.e2e.ts --reporter=line
   ```
   Key signal from logs:
   - `Audio files: 1`
   - `FFmpeg export completed successfully`
   - test status: `1 passed`

### Edge Case: Audio Longer Than Video

Question raised: what happens if overlay audio duration is longer than the video/timeline duration?

Current behavior (important):
1. Mode 2 / composite path is mostly safe because export args include `-t <timelineDuration>`, which clamps output duration.
2. Mode 1 direct-copy path does not consistently enforce `-shortest` when external audio is mapped, so long overlay audio can outlive video.
3. Mode 1.5 overlay mix uses:
   - `amix=duration=first` when base audio exists (generally clamped),
   - `amix=duration=longest` when no base audio exists (can exceed video duration).

Long-term policy recommendation:
1. Export output duration should equal timeline/video duration by default.
2. Audio longer than timeline should be trimmed (not extend output), unless a future explicit "extend output to longest audio" option is added.

Concrete implementation plan:
1. Mode 1 (`electron/ffmpeg-args-builder.ts`):
   - add `-shortest` when external audio inputs are present.
2. Mode 1.5 (`electron/ffmpeg-export-handler.ts` in `mixOverlayAudio()`):
   - force clamping to video duration by either:
     - using `-shortest`, and/or
     - applying `atrim=0:<videoDuration>` on final mixed audio.
3. Keep Mode 2 clamp with `-t <duration>`; optionally add `-shortest` for consistency.

Test cases to add:
1. 5s video + 20s audio-track clip -> output must be ~5s.
2. 5s silent video + 20s audio-track clip (no base audio) -> output must be ~5s.
3. 5s video (with embedded audio) + 20s overlay audio -> output must be ~5s and include mixed audio.

### Recorded Decision (User Request)

Date: 2026-02-13

1. User asked: what if audio is longer than video.
2. Decision recorded: prioritize long-term stability and deterministic output duration.
3. Expected product behavior: export length follows timeline/video length by default; excess audio is trimmed.
4. Follow-up implementation (pending): add explicit duration clamping in Mode 1 and Mode 1.5 paths as listed above.
