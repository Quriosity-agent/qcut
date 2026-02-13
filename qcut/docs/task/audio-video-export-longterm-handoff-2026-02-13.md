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
