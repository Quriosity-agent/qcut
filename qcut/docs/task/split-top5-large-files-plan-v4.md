# Implementation Plan: Split Large Files — Round 4

**Created:** 2026-02-12
**Goal:** Reduce remaining >800-line files with no behavior changes.
**Predecessor:** [split-v3-overview.md](./split-v3-overview.md) (all 5 phases complete)

## Pre-Work: Cleanup

- [ ] Delete `apps/web/src/lib/export-engine.backup.ts` (927 lines) — leftover from v3 Phase 4, no longer needed.

## Current Top 15 Files Over 800 Lines

| # | File | Lines | Selected |
|---|------|------:|----------|
| 1 | `apps/web/src/types/electron.d.ts` | 1219 | Deferred (type-only) |
| 2 | `apps/web/src/components/editor/timeline/timeline-track.tsx` | 1094 | Deferred (very high complexity) |
| 3 | `apps/web/src/lib/ai-video/generators/image-to-video.ts` | 1084 | **Phase 1** |
| 4 | `apps/web/src/components/editor/preview-panel.tsx` | 1070 | Deferred (very high complexity) |
| 5 | `apps/web/src/stores/media-store.ts` | 1036 | Deferred (high complexity) |
| 6 | `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx` | 1018 | Deferred (high complexity) |
| 7 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | 996 | Deferred (very high complexity) |
| 8 | `apps/web/src/components/editor/media-panel/views/ai/index.tsx` | 935 | Deferred (already split in v3) |
| 9 | `apps/web/src/stores/timeline-store-operations.ts` | 901 | **Phase 5** |
| 10 | `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts` | 883 | **Phase 2** |
| 11 | `apps/web/src/lib/remotion/component-loader.ts` | 874 | **Phase 4** |
| 12 | `apps/web/src/lib/ai-video/validation/validators.ts` | 854 | **Phase 3** |
| 13 | `apps/web/src/stores/timeline-store.ts` | 854 | Deferred (high complexity) |
| 14 | `electron/ffmpeg/utils.ts` | 841 | Deferred (medium complexity) |
| 15 | `apps/web/src/lib/export-engine-cli.ts` | 831 | Deferred (high complexity) |

### Selection Rationale

The 5 selected files are the **lowest-risk, highest-impact** candidates:
- All contain pure functions, type declarations, or clearly independent sections.
- No tightly-coupled React component state or complex memoization chains.
- The 10 deferred files involve heavy hook coupling, mutable refs, or class method extraction and are candidates for a future v5 round.

---

## Execution Order

| Phase | File | Why This Order | Status |
|-------|------|---------------|--------|
| **Phase 1** | **#3 image-to-video** | Lowest risk — 12 independent generator functions grouped by model family | Not started |
| **Phase 2** | **#10 ai-types** | Zero risk — pure type declarations, no runtime behavior | Not started |
| **Phase 3** | **#12 validators** | Low risk — pure validation functions, no state | Not started |
| **Phase 4** | **#11 component-loader** | Medium risk — clear section boundaries (DB, core, folder) | Not started |
| **Phase 5** | **#9 timeline-store-operations** | Medium risk — already uses dependency injection pattern | Not started |

Each phase is one commit. Do not start the next phase until verification passes.

---

## Phase 1: Split `image-to-video.ts` (1084 → ~280 core + 4 generator modules)

**Risk Level:** Low — each generator function is self-contained, follows identical patterns, no shared mutable state

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `.../generators/kling-generators.ts` | `generateKlingImageVideo`, `generateKling26ImageVideo`, `generateKlingO1Video`, `generateKlingO1RefVideo` | ~318 |
| `.../generators/wan-generators.ts` | `generateWAN25ImageVideo`, `generateWAN26ImageVideo`, `generateWAN26RefVideo` | ~306 |
| `.../generators/vidu-generators.ts` | `generateViduQ2Video`, `generateViduQ3ImageVideo` | ~183 |
| `.../generators/misc-generators.ts` | `generateSeedanceVideo`, `generateLTXV2ImageVideo` | ~198 |

### What Stays in `image-to-video.ts` (~280 lines)

| Section | Description |
|---------|-------------|
| Imports & types | Type imports, FAL utilities |
| `generateVideoFromImage` | Generic I2V dispatch function (lines 71-192, ~122 lines) |
| Re-exports | Barrel re-exports from 4 new modules |

### Implementation

1. Create `kling-generators.ts`: move `generateKlingImageVideo` (505-585), `generateKling26ImageVideo` (590-660), `generateKlingO1Video` (665-756), `generateKlingO1RefVideo` (761-833). Import shared FAL utilities and validators.
2. Create `wan-generators.ts`: move `generateWAN25ImageVideo` (838-930), `generateWAN26ImageVideo` (941-1046), `generateWAN26RefVideo` (1058-1164). Import shared FAL utilities and validators.
3. Create `vidu-generators.ts`: move `generateViduQ2Video` (197-294), `generateViduQ3ImageVideo` (1175-1259). Import shared FAL utilities and validators.
4. Create `misc-generators.ts`: move `generateSeedanceVideo` (403-500), `generateLTXV2ImageVideo` (299-398). Import shared FAL utilities and validators.
5. Update `image-to-video.ts`: import and re-export all generator functions. Update `generateVideoFromImage` to import from new modules if needed.
6. Verify no external files import individual generators directly — if so, re-exports handle it.

### Risks

| Risk | Mitigation |
|------|------------|
| All generators share FAL utilities | Each module imports `getFalApiKeyAsync`, `makeFalRequest`, `handleFalResponse`, `generateJobId` directly |
| All generators share validators | Each module imports from `../validation/validators` directly |
| `generateVideoFromImage` dispatches to generators | Import from new modules; same function signatures |
| External imports break | Re-export all generators from `image-to-video.ts` barrel |

---

## Phase 2: Split `ai-types.ts` (883 → 4 type modules)

**Risk Level:** Zero — pure TypeScript type/interface declarations, no runtime behavior

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `.../types/ai-model-types.ts` | `AIModelEndpoints`, `UpscaleModelEndpoints`, `AIModelParameters`, `AIModel`, `GeneratedVideo`, `GeneratedVideoResult`, `PollingState`, `AIServiceManager` | ~165 |
| `.../types/ai-hook-types.ts` | `UseAIGenerationProps`, `AIGenerationState`, `UseAIHistoryProps`, `AIHistoryState`, `AIActiveTab`, `AvatarUploadState`, `ProgressUpdate`, `ProgressCallback`, `ImageUploadState`, `GenerationStatus`, `APIConfiguration`, `AIError` | ~245 |
| `.../types/ai-request-types.ts` | `Seedream45*`, `VideoGenerationRequest`, `TextToVideoRequest`, `ViduQ2I2VRequest`, `AvatarVideoRequest`, `VideoGenerationResponse`, `ModelsResponse`, `CostEstimate`, `SeedanceI2VRequest`, `Kling*Request`, `WAN*Request`, `ByteDance*Request`, `FlashVSR*Request`, `TopazUpscaleRequest` | ~305 |
| `.../types/ai-specialized-types.ts` | `SyncLipsync*` types, `Sora2*` types | ~97 |

### What Stays in `ai-types.ts` (~70 lines)

| Section | Description |
|---------|-------------|
| Re-exports | Barrel re-exports from all 4 new type modules |
| Module docs | Header comments explaining the type organization |

### Implementation

1. Create `ai-model-types.ts`: move core model interfaces (lines 22-165).
2. Create `ai-hook-types.ts`: move hook props/state interfaces (lines 170-449). This file imports from `ai-model-types.ts` for type references.
3. Create `ai-request-types.ts`: move all API request/response types (lines 455-810).
4. Create `ai-specialized-types.ts`: move Sync Lipsync and Sora2 types (lines 848-944).
5. Update `ai-types.ts` to re-export everything: `export * from './ai-model-types'`, etc.
6. Verify all imports across codebase — consumers import from `ai-types.ts` barrel, so no changes needed.

### Risks

| Risk | Mitigation |
|------|------------|
| Cross-type references break | `ai-hook-types` imports from `ai-model-types` — one-directional, no circular deps |
| External imports break | `ai-types.ts` barrel re-exports everything — transparent to consumers |
| `UseAIGenerationProps` is 193 lines | Keep intact in `ai-hook-types.ts` — splitting an interface adds complexity without benefit |

---

## Phase 3: Split `validators.ts` (854 → ~250 core + 3 validator modules)

**Risk Level:** Low — all validators are pure functions with no shared state

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `.../validation/video-model-validators.ts` | Hailuo 2.3, Vidu Q2/Q3, LTX Video 2.0, Kling, Seedance validators + associated constants | ~310 |
| `.../validation/wan-validators.ts` | All WAN 2.5/2.6 validators, `isWAN26Model`, `isWAN26Ref2VideoModel` | ~120 |
| `.../validation/image-validators.ts` | Image constants (`VALID_OUTPUT_FORMATS`, `IMAGE_SIZE_TO_ASPECT_RATIO`), `normalizeAspectRatio`, `imageSizeToAspectRatio`, `normalizeOutputFormat`, Reve validators | ~255 |

### What Stays in `validators.ts` (~250 lines)

| Section | Description |
|---------|-------------|
| Imports & re-exports | Barrel re-exports from 3 new modules |
| Sync Lipsync React-1 validators | Constants + 5 validator functions (lines 725-854) |
| Any validators added after v3 | Keep recent additions in main file until next round |

### Implementation

1. Create `video-model-validators.ts`: move Hailuo (40-87), Vidu Q2 (89-117), LTX Video 2.0 (119-277), Kling avatar (279-310), Seedance validators + constants.
2. Create `wan-validators.ts`: move all WAN validators (312-466).
3. Create `image-validators.ts`: move image constants (468-496), normalization functions (526-613), Reve validators (615-723).
4. Update `validators.ts`: import and re-export from new modules. Keep Sync Lipsync and Vidu Q3 validators in main file.
5. Verify imports — all consumers import from `validators.ts` barrel.

### Risks

| Risk | Mitigation |
|------|------------|
| Validators reference `ERROR_MESSAGES` constant | Import from `ai-constants` in each new module |
| Validators use `debugLogger` | Import in each new module |
| Cross-validator dependencies | None detected — all validators are independent |
| External imports break | Barrel re-exports handle this transparently |

---

## Phase 4: Split `component-loader.ts` (874 → ~80 orchestrator + 3 modules)

**Risk Level:** Medium — IndexedDB operations and Electron IPC calls require careful extraction

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `.../remotion/component-loader-db.ts` | `openDatabase`, `storeComponent`, `getStoredComponent`, `getAllStoredComponents`, `deleteStoredComponent`, DB constants | ~145 |
| `.../remotion/component-loader-core.ts` | `generateComponentId`, `loadComponentFromCode`, `loadComponentFromFile`, `loadStoredComponents`, `loadStoredComponentsWithAnalysis`, `removeStoredComponent`, `getComponentSourceCode`, `updateStoredComponent` | ~315 |
| `.../remotion/component-loader-folder.ts` | `FolderLoadResult`, `FolderCompositionInfo`, `FolderBundleResult` types, `loadComponentsFromFolder`, `generateFolderComponentId`, `inferCategoryFromComposition`, `isFolderImportAvailable`, `importFromFolder` | ~310 |

### What Stays in `component-loader.ts` (~80 lines)

| Section | Description |
|---------|-------------|
| Imports | Import from 3 new modules |
| Default export | Object aggregating all public functions |
| Re-exports | Named re-exports for direct imports |

### Implementation

1. Create `component-loader-db.ts`: move IndexedDB operations (lines 82-230) including constants (`DB_NAME`, `DB_VERSION`, `STORE_NAME`, `DEFAULT_LOAD_OPTIONS`) and all 5 DB helper functions.
2. Create `component-loader-core.ts`: move component loading functions (lines 236-621). Import DB helpers from `component-loader-db.ts`.
3. Create `component-loader-folder.ts`: move folder types and functions (lines 626-969). Import DB helpers and core functions as needed.
4. Update `component-loader.ts`: import from modules, re-export, build default export object.
5. Verify all imports — check both direct imports and default import usage.

### Risks

| Risk | Mitigation |
|------|------------|
| DB helpers used by both core and folder modules | Both import from `component-loader-db.ts` — no circular deps |
| `loadComponentFromCode` used by folder module | Import from `component-loader-core.ts` — one-directional |
| Default export shape changes | Keep identical default export object in main file |
| Type imports (LoadResult, LoadOptions, StoredComponent) | Export types from `component-loader-db.ts`, re-export from main |

---

## Phase 5: Split `timeline-store-operations.ts` (901 → ~100 orchestrator + 4 operation modules)

**Risk Level:** Medium — uses dependency injection pattern (`OperationDeps`), clean extraction boundaries

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `.../stores/timeline-ripple-operations.ts` | `removeTrack`, `removeTrackWithRipple`, `removeElementFromTrackWithRipple`, `updateElementStartTimeWithRipple` | ~290 |
| `.../stores/timeline-split-operations.ts` | `splitElement`, `splitAndKeepLeft`, `splitAndKeepRight` | ~145 |
| `.../stores/timeline-media-operations.ts` | `getAudioElements`, `separateAudio`, `replaceElementMedia` | ~245 |
| `.../stores/timeline-add-operations.ts` | `addMediaAtTime`, `addTextAtTime`, `addMediaToNewTrack`, `addTextToNewTrack` | ~105 |

### What Stays in `timeline-store-operations.ts` (~120 lines)

| Section | Description |
|---------|-------------|
| Imports & types | `OperationDeps` interface, type imports |
| Drag state operations | `dragState`, `setDragState`, `startDrag`, `updateDragTime`, `endDrag` (lines 763-801, ~39 lines) |
| Effects management | `addEffectToElement`, `removeEffectFromElement`, `getElementEffectIds`, `clearElementEffects` (kept because they're simple and use `pushHistory` directly) |
| `createTimelineOperations` | Factory function that wires all modules together |
| Re-exports | Barrel re-exports |

### Implementation

1. Create `timeline-ripple-operations.ts`: move ripple functions (lines 67-357). Accept `OperationDeps` parameter. Import overlap/gap helpers.
2. Create `timeline-split-operations.ts`: move split functions (lines 363-507). Accept `OperationDeps` parameter. Import UUID generator and name suffix helper.
3. Create `timeline-media-operations.ts`: move audio/media functions (lines 513-757). Accept `OperationDeps` parameter. Uses dynamic imports for media processing.
4. Create `timeline-add-operations.ts`: move add-at-time functions (lines 807-911). Accept `OperationDeps` parameter. Import `TIMELINE_CONSTANTS`.
5. Update `timeline-store-operations.ts`: import from modules, keep drag state + effects + `createTimelineOperations` factory.
6. `createTimelineOperations` wires all module functions with the shared `deps` object.

### Risks

| Risk | Mitigation |
|------|------------|
| All operations need `OperationDeps` | Pass `deps` as first parameter to each module's functions |
| Ripple operations reference overlap helpers | Import `checkElementOverlaps`, `resolveElementOverlaps` from timeline-store |
| Media operations use dynamic imports | Keep `await import()` calls in extracted module — no circular risk |
| `createTimelineOperations` return shape changes | Keep identical return shape — only internals move |
| Drag state uses Zustand `set`/`get` directly | Keep in main file — only 39 lines |

---

## New Files Created (Summary)

| Phase | New File(s) |
|-------|-------------|
| Pre | (delete `export-engine.backup.ts`) |
| #1 | `generators/kling-generators.ts`, `wan-generators.ts`, `vidu-generators.ts`, `misc-generators.ts` |
| #2 | `types/ai-model-types.ts`, `ai-hook-types.ts`, `ai-request-types.ts`, `ai-specialized-types.ts` |
| #3 | `validation/video-model-validators.ts`, `wan-validators.ts`, `image-validators.ts` |
| #4 | `remotion/component-loader-db.ts`, `component-loader-core.ts`, `component-loader-folder.ts` |
| #5 | `stores/timeline-ripple-operations.ts`, `timeline-split-operations.ts`, `timeline-media-operations.ts`, `timeline-add-operations.ts` |

**Total new files:** 18 (+ 1 deletion)

---

## Deferred Files (Candidates for v5)

These 10 files exceed 800 lines but are deferred due to high coupling or complexity:

| File | Lines | Why Deferred |
|------|------:|-------------|
| `electron.d.ts` | 1219 | Type-only file; splitting a single interface requires all consumers to update imports. Lower priority. |
| `timeline-track.tsx` | 1094 | 15+ Zustand selectors, deeply coupled drag/drop state, event handler chains. |
| `preview-panel.tsx` | 1070 | Heavy memoization chains, 6 store hooks, `renderElement` (291 lines) has cross-cutting deps. |
| `media-store.ts` | 1036 | Zustand `set`/`get` coupling, cross-store deps (timeline, stickers, project), circular import risk. |
| `drawing-canvas.tsx` | 1018 | `forwardRef` + `useImperativeHandle`, tightly coupled refs and canvas state. |
| `use-ai-generation.ts` | 996 | 166 destructured props, main generation loop tightly coupled to 5+ custom hooks. |
| `ai/index.tsx` | 935 | Already split in v3. 587-line JSX return with 40-113 props per tab component. |
| `timeline-store.ts` | 854 | Core store with auto-save timers, lazy circular imports, history management. |
| `ffmpeg/utils.ts` | 841 | Path resolution (322 lines) is extractable but platform-specific edge cases. |
| `export-engine-cli.ts` | 831 | `exportWithCLI` (399 lines) mixes validation, filter building, and FFmpeg invocation. |

---

## Verification Checklist (Per Phase)

1. Create new file(s), move code, keep exports stable.
2. Run `bun run check-types`.
3. Run `bun lint:clean`.
4. Run `bun run test` for any affected test files.
5. Smoke test: `bun run electron:dev` — verify affected features work.

## Risk Checklist

| Risk | Mitigation |
|------|------------|
| Circular imports | One-directional: new files import types/utils, parent re-exports |
| Barrel re-export perf | Keep barrels thin — only re-export public API |
| Dependency injection pattern | Pass `OperationDeps` or context objects as parameters |
| Type-only modules | Use `export type` where possible for tree-shaking |
| External import breakage | All main files become barrel re-exporters — transparent to consumers |
| Dynamic imports in media operations | Keep `await import()` in extracted module — same behavior |
| IndexedDB transaction scope | Keep all DB operations in single `component-loader-db.ts` module |
