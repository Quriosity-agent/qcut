# Implementation Plan (Reviewed): Audio-Safe Export Fix

**Created:** 2026-02-11  
**Reviewed:** 2026-02-11  
**Priority:** High  
**Bug Report:** [fix-audio-export-bug.md](./fix-audio-export-bug.md)

## Verified Facts From Current Code

1. `getAudioElements()` already scans both `"audio"` and `"media"` tracks (`apps/web/src/stores/timeline-store-operations.ts:514`).
2. Export dialog `hasAudio` only checks `"audio"` tracks today (`apps/web/src/components/export-dialog.tsx:73`), so video-only timelines can hide the audio toggle.
3. `includeAudio` is passed from dialog but dropped by `useExportProgress.handleExport()` type contract (`apps/web/src/hooks/use-export-progress.ts:53`), then bypassed in CLI collection.
4. CLI always runs `prepareAudioFiles()` (`apps/web/src/lib/export-engine-cli.ts:451`).
5. Mode 1.5 hard-fails whenever `audioFiles.length > 0` (`electron/ffmpeg-handler.ts:545`).
6. `normalizeVideo()` already keeps audio (`-c:a aac ...`) and does not use `-an` (`electron/ffmpeg/utils.ts:768`).

## Long-Term Design Goals

1. Keep audio behavior request-scoped, not global-singleton-scoped.
2. Preserve existing default behavior (`includeAudio = true`) for backward compatibility.
3. Avoid regressions across Mode 1, Mode 1.5, and Mode 2.
4. Share one source-of-truth for "audio present" logic between UI and export pipeline.

## Workstream 1: Fix End-to-End Audio Contract (Typed, Request-Scoped)

**Files:**
- `apps/web/src/components/export-dialog.tsx`
- `apps/web/src/hooks/use-export-progress.ts`
- `apps/web/src/lib/export-engine-factory.ts`
- `apps/web/src/lib/export-engine-cli.ts`
- `apps/web/src/types/electron.d.ts`

**Changes:**
1. Extend export settings passed through `handleExport()` to include `includeAudio`, `audioCodec`, and `audioBitrate` as typed optional fields (remove `as any` callsite bypass).
2. Pass the same typed audio options into `CLIExportEngine` via settings object.
3. Stop using `audio-export-config` singleton as export-time source of truth; only keep it for UI/state display if needed.
4. Align renderer IPC type (`apps/web/src/types/electron.d.ts`) with actual option payload shape (already contains runtime fields like `optimizationStrategy` in main process).

**Reasoning:** The global singleton approach is fragile for concurrent exports and hides data flow. Request-scoped settings are easier to reason about and test.

## Workstream 2: Unify Audio Source Detection for UI and Export

**Files:**
- `apps/web/src/lib/export-cli/sources` (new focused helper file)
- `apps/web/src/components/export-dialog.tsx`
- `apps/web/src/lib/export-engine-cli.ts`

**Changes:**
1. Add a shared helper to classify timeline audio candidates by source type:
   - `embeddedMediaAudio` from video items on media tracks.
   - `overlayAudio` from elements placed on audio tracks.
2. Exclude image items early using `mediaItem.type` from media store.
3. Use this helper in dialog `hasAudio` so image-only timelines do not show false-positive audio controls.

**Reasoning:** Current plan logic using only `element.type === "media"` can treat image timelines as audio-capable.

## Workstream 3: Enforce `includeAudio` in CLI Without Breaking Defaults

**Files:**
- `apps/web/src/lib/export-engine-cli.ts`

**Changes:**
1. Gate `prepareAudioFiles()` behind request-scoped `includeAudio`.
2. Keep default `includeAudio = true`.
3. Skip audio validation/mixing path when disabled.

**Reasoning:** This is the direct user-facing contract and must remain backward compatible.

## Workstream 4: Fix Mode 1.5 Audio Path Safely

**Files:**
- `electron/ffmpeg-handler.ts`
- `electron/ffmpeg/utils.ts` (only if helper extraction is needed)

**Changes:**
1. Remove Mode 1.5 hard throw on audio inputs.
2. Keep normalized clip audio from step 1 as primary audio bed.
3. Add a dedicated second-pass helper for mixing overlay audio (audio-track elements) into the concatenated output.
4. Use optional mapping (`0:a?`) where appropriate so videos without audio streams do not fail exports.

**Reasoning:** `normalizeVideo()` already preserves/transcodes audio; failure comes from the explicit throw and missing overlay mix strategy.

## Workstream 5: Test Coverage Focused on Regressions

**Files:**
- `apps/web/src/stores/__tests__/timeline-store-operations.test.ts` (extend existing)
- `apps/web/src/components/__tests__/export-dialog-audio.test.ts` (new)
- `apps/web/src/lib/__tests__/export-engine-cli-audio.test.ts` (new)
- `electron` test area (add focused unit tests for Mode 1.5 audio helper logic)

**Key scenarios:**
1. Video-only timeline shows audio option and exports with audio.
2. Image-only timeline does not show audio option.
3. `includeAudio=false` produces no audio inputs and no audio mixing.
4. Mode 1.5 with mixed-resolution videos keeps embedded audio.
5. Mode 1.5 with overlay audio mixes both embedded and overlay tracks.
6. Existing Mode 1 and Mode 2 exports still produce audio.

## Execution Order

| Order | Workstream | Why |
|------|------------|-----|
| 1 | Workstream 1 | Establishes stable data contract and removes hidden coupling |
| 2 | Workstream 2 | Ensures UI and export pipeline agree on audio presence |
| 3 | Workstream 3 | Enforces user choice while preserving backward compatibility |
| 4 | Workstream 4 | Fixes the actual Mode 1.5 failure path safely |
| 5 | Workstream 5 | Locks in non-regression guarantees |

## Rollout and Safety

1. Keep defaults unchanged (`includeAudio=true`).
2. Keep existing Mode 1/2 argument behavior unless tests prove parity after refactor.
3. Add high-signal logging only at mode boundaries and audio mapping points.
4. Run the full export scenario matrix before merge; reject rollout on any audio regression.
