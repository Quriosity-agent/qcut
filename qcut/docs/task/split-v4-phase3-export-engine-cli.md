# Phase 3: Split `export-engine-cli.ts` (1292 -> ~900 without behavior changes)

**Risk Level:** Medium — this file controls export mode selection and FFmpeg option construction
**Estimated Time:** ~45 minutes (including regression verification)

## Goal

Split `apps/web/src/lib/export-engine-cli.ts` into focused modules **without changing export behavior**.

Primary target extractions:
1. Electron bridge helpers (`getOptionalInvoke`, `invokeIfAvailable`, `getFileInfo`, `fileExists`, `validateAudioWithFfprobe`)
2. Audio preparation pipeline (`resolveAudioPreparationInputs`, `prepareAudioFiles`)

## Non-Breaking Constraints (Must Hold)

- Keep `CLIExportEngine` public API unchanged.
- Keep `export()` mode decision logic unchanged (Mode 1 / 1.5 / 2 behavior and gating).
- Keep `exportWithCLI()` export options shape unchanged.
- Keep all existing error messages and fallback behavior unchanged.
- Keep audio include/exclude behavior unchanged (`includeAudio ?? true`).
- Keep sticker/image/text filter handling unchanged.
- Keep session lifecycle unchanged (`createExportSession` -> export -> read -> cleanup path).
- Keep current debug logs unless explicitly removed in another task.

## Source Of Truth

`apps/web/src/lib/export-engine-cli.ts` (1292 lines)

Current extraction candidates in file:
- Electron bridge helpers: lines 252-360
- Audio preparation pipeline: lines 362-564

## Target Files

### 1. `apps/web/src/lib/export-engine-cli-utils.ts`

Move these methods as standalone functions:
- `getOptionalInvoke()`
- `invokeIfAvailable()`
- `getFileInfo()`
- `fileExists()`
- `validateAudioWithFfprobe()`

Export shared types used by both modules:
- `ElectronInvoke`
- `FileInfoLike`
- `AudioValidationLike`

### 2. `apps/web/src/lib/export-engine-cli-audio.ts`

Move these methods as standalone functions:
- `resolveAudioPreparationInputs()`
- `prepareAudioFilesForExport()`

`prepareAudioFilesForExport()` should receive explicit dependencies instead of `this`.

## Safe Migration Strategy (Wrapper-First)

### Step 0: Baseline safety checks before edits

Run and record baseline results:

```bash
bun x tsc --noEmit --pretty false
bunx vitest run apps/web/src/lib/__tests__/export-analysis.test.ts
bunx vitest run apps/web/src/lib/__tests__/export-engine-debug.test.ts
bunx vitest run apps/web/src/lib/__tests__/export-engine-utils.test.ts
bunx vitest run apps/web/src/lib/export-cli/sources/__tests__/audio-sources.test.ts
bunx vitest run apps/web/src/lib/export-cli/sources/__tests__/audio-detection.test.ts
```

### Step 1: Create `export-engine-cli-utils.ts`

1. Copy helper method bodies exactly (no logic edits).
2. Convert method signatures to function signatures with explicit params.
3. Keep try/catch behavior unchanged.
4. In `export-engine-cli.ts`, keep existing class methods but make them thin wrappers calling new utils.

This step avoids touching `exportWithCLI()` call sites directly.

### Step 2: Create `export-engine-cli-audio.ts`

1. Move `resolveAudioPreparationInputs()` and `prepareAudioFiles()` logic into standalone functions.
2. Rename exported function to `prepareAudioFilesForExport()`.
3. In class, keep `private async prepareAudioFiles()` as wrapper delegating to new module.
4. Keep return contract exactly `Promise<AudioFileInput[]>`.
5. Preserve all fallback paths (`return []` on failure where current code does so).

### Step 3: Keep class surface stable

- Keep method names used internally by class (`prepareAudioFiles`, `fileExists`, etc.) as wrappers in this phase.
- Do not inline new module calls into many places at once.
- Do not modify mode-selection branches during extraction.

### Step 4: Optional cleanup (only if all checks pass)

- If wrappers become redundant, remove them in a follow-up subtask, not in the same change.
- No cleanup should happen if it changes stack traces, logs, or behavior.

## What Must Not Change In This Phase

- `analyzeTimelineForExport(...)` usage and strategy checks.
- `useDirectCopy` computation in `exportOptions`.
- `videoInputPath/trimStart/trimEnd` behavior.
- Audio validation filtering semantics before FFmpeg invocation.
- Export option keys passed to `window.electronAPI.ffmpeg.exportVideoCLI(...)`.

## Risk Register

| Risk | Why It Can Break Features | Mitigation |
|------|----------------------------|------------|
| `this` binding loss | moved methods currently depend on instance state | use explicit dependency objects and keep class wrappers |
| subtle fallback changes | helper methods rely on specific try/catch return values | copy method bodies first, then parameterize |
| export mode regression | small condition edits can change Mode 1/1.5/2 path | no mode logic edits in this phase |
| audio dropouts | behavior depends on multi-step validation/filtering | preserve same validation order and null-filtering |
| Electron optional invoke behavior | helper has graceful fallback to null | preserve `invokeIfAvailable` semantics exactly |

## Verification

### Static + lint

```bash
bun x tsc --noEmit --pretty false
bunx @biomejs/biome check apps/web/src/lib/export-engine-cli.ts apps/web/src/lib/export-engine-cli-utils.ts apps/web/src/lib/export-engine-cli-audio.ts
```

### Unit tests (relevant paths)

```bash
bunx vitest run apps/web/src/lib/__tests__/export-analysis.test.ts
bunx vitest run apps/web/src/lib/__tests__/export-engine-debug.test.ts
bunx vitest run apps/web/src/lib/__tests__/export-engine-utils.test.ts
bunx vitest run apps/web/src/lib/export-cli/sources/__tests__/audio-sources.test.ts
bunx vitest run apps/web/src/lib/export-cli/sources/__tests__/audio-detection.test.ts
bunx vitest run apps/web/src/test/integration/export-settings.test.ts
```

## Implementation Status (February 15, 2026)

### Completed

- [x] Added `apps/web/src/lib/export-engine-cli-utils.ts` with extracted helper functions:
  `getOptionalInvoke`, `invokeIfAvailable`, `getFileInfo`, `fileExists`, `validateAudioWithFfprobe`.
- [x] Added `apps/web/src/lib/export-engine-cli-audio.ts` with extracted audio pipeline functions:
  `resolveAudioPreparationInputs`, `prepareAudioFilesForExport`.
- [x] Updated `apps/web/src/lib/export-engine-cli.ts` to use wrapper delegation to the new modules.
- [x] Preserved export mode logic and FFmpeg options construction in `exportWithCLI()`.

### Verification Results

- [x] `bunx @biomejs/biome check apps/web/src/lib/export-engine-cli.ts apps/web/src/lib/export-engine-cli-utils.ts apps/web/src/lib/export-engine-cli-audio.ts`
- [x] `bunx vitest run src/lib/__tests__/export-analysis.test.ts src/lib/__tests__/export-engine-debug.test.ts src/lib/__tests__/export-engine-utils.test.ts src/lib/export-cli/sources/__tests__/audio-sources.test.ts src/lib/export-cli/sources/__tests__/audio-detection.test.ts src/test/integration/export-settings.test.ts` (40/40 passed)
- [x] `bunx vitest run src/lib/__tests__/export-engine-cli-audio.test.ts` (7/7 passed)
- [ ] `bun x tsc --noEmit --pretty false` still reports an existing unrelated issue at `apps/web/src/test/mocks/electron.ts:158` (`status` missing on mock type). No new TS errors were reported for extracted files.

### Manual regression scenarios

- [ ] Export with `includeAudio=false` does not prepare audio files.
- [ ] Export with valid audio tracks includes mixed audio in output.
- [ ] Missing audio file paths are skipped, export still completes.
- [ ] Sticker overlays still render.
- [ ] Image overlays still render.
- [ ] Text overlays still render.
- [ ] Mode 1 direct copy still triggers when no overlays exist.
- [ ] Mode 2 with filters still triggers for single-video + overlays.
- [ ] Video normalization strategy path still works.

## Rollback Plan

If any regression appears:
1. Revert only module extraction wiring in `apps/web/src/lib/export-engine-cli.ts`.
2. Keep new files for reference but disconnect imports.
3. Re-run baseline test list and confirm parity.

## Deliverables

- `apps/web/src/lib/export-engine-cli-utils.ts` added
- `apps/web/src/lib/export-engine-cli-audio.ts` added
- `apps/web/src/lib/export-engine-cli.ts` updated with wrapper delegation only
- No behavior changes to export modes or FFmpeg option construction in this phase
