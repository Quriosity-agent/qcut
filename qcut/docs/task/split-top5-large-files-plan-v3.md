# Implementation Plan: Split Top 5 Largest Files — Round 3

**Created:** 2026-02-11
**Goal:** Reduce remaining >800-line files with no behavior changes.
**Predecessor:** [split-top5-large-files-plan-v2.md](./split-top5-large-files-plan-v2.md) (3/5 phases complete, 1 partial)

## Current Top 5 Files Worth Splitting

| # | File | Lines | Target | Status |
|---|------|------:|--------|--------|
| 1 | `apps/web/src/lib/export-engine.ts` | 1404 | ~550 core + ~440 renderer + ~125 recorder + ~145 utils + ~92 debug | **Not started** |
| 2 | `apps/web/src/lib/image-edit-client.ts` | 1325→793 | ~793 core + ~278 models + ~204 polling + ~75 utils | **Done** |
| 3 | `electron/ffmpeg-handler.ts` | 1310 | ~100 orchestrator + ~567 export + ~274 utilities + ~265 args + ~72 basic | **Not started** |
| 4 | `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-image-tab.tsx` | 1283 | ~400 shell + 7 model settings components | **Not started** |
| 5 | `apps/web/src/components/editor/media-panel/views/ai/index.tsx` | 1270 | ~400 core + ~89 cost hook + ~66 effects hook + ~235 UI components | **Not started** |

---

## Execution Order

| Phase | File | Why This Order | Status |
|-------|------|---------------|--------|
| **Phase 1** | **#2 image-edit-client** | Lowest risk — mostly pure data + independent polling module | **Done** |
| **Phase 2** | **#4 ai-image-tab** | Low-medium risk — 7 model sections are fully independent, no shared state | **Not started** |
| **Phase 3** | **#5 ai/index** | Medium risk — hook extraction + UI component extraction, well-bounded | **Not started** |
| **Phase 4** | **#1 export-engine** | Medium-high risk — class method extraction, shared canvas/ctx state | **Not started** |
| **Phase 5** | **#3 ffmpeg-handler** | Highest risk — IPC handler registration, module exports, dual CJS/ESM | **Not started** |

Each phase is one commit. Do not start the next phase until verification passes.

---

## Phase 1: Split `image-edit-client.ts` (1325 → ~450 + 3 extracted files)

**Risk Level:** Low — polling is self-contained, model metadata is pure data, no class coupling

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `apps/web/src/lib/image-edit-polling.ts` | `pollImageEditStatus()`, `mapEditStatusToProgress()`, `sleep()` | ~180 |
| `apps/web/src/lib/image-edit-models-info.ts` | `getImageEditModels()` — pure data array of 10 model definitions | ~270 |
| `apps/web/src/lib/image-edit-utils.ts` | `getFalApiKey()`, `generateJobId()`, cached API key state | ~65 |

### What Stays in `image-edit-client.ts` (~450 lines)

| Section | Description |
|---------|-------------|
| Imports & types | `ImageEditRequest`, `ImageUpscaleRequest`, `ImageEditResponse`, `ImageEditProgressCallback` |
| `MODEL_ENDPOINTS` | 12-model endpoint config constant (~138 lines) |
| `uploadImageToFAL()` | Single image upload to base64 (~49 lines) |
| `uploadImagesToFAL()` | Parallel upload wrapper (~23 lines) |
| `editImage()` | Main edit function with parameter mapping, API call, response parsing (~318 lines) |
| `upscaleImage()` | Upscale function (~146 lines) |
| Re-exports | Barrel re-exports from extracted files |

### Implementation

1. Create `image-edit-polling.ts`: move `pollImageEditStatus()` (lines 852-981), `mapEditStatusToProgress()` (lines 989-1031), `sleep()` (lines 1038-1043). Export all three.
2. Create `image-edit-models-info.ts`: move `getImageEditModels()` (lines 1056-1325). Export the function.
3. Create `image-edit-utils.ts`: move `getFalApiKey()` (lines 37-87), `generateJobId()` (lines 1047-1051), and the two cache variables (lines 34-35). Export all.
4. Update `image-edit-client.ts`: import from new files. Add re-exports so external consumers don't break.
5. Update any direct imports of `getImageEditModels` or `pollImageEditStatus` across codebase.

### Risks

| Risk | Mitigation |
|------|------------|
| `getFalApiKey` used by both `editImage` and polling | Both import from `image-edit-utils.ts` — no circular dependency |
| `pollImageEditStatus` called from `editImage` and `upscaleImage` | Import from `image-edit-polling.ts` |
| External imports of `getImageEditModels` break | Re-export from `image-edit-client.ts` barrel |

---

## Phase 2: Split `ai-image-tab.tsx` (1283 → ~400 + 7 model components)

**Risk Level:** Low-medium — each model settings section is conditionally rendered and fully independent

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `.../ai/components/ai-vidu-q2-settings.tsx` | Duration, resolution, movement amplitude, BGM settings | ~97 |
| `.../ai/components/ai-ltx-i2v-settings.tsx` | Duration, resolution, FPS, audio settings | ~97 |
| `.../ai/components/ai-ltx-fast-i2v-settings.tsx` | Duration, resolution with extended constraints, FPS, audio | ~140 |
| `.../ai/components/ai-seedance-settings.tsx` | Duration, resolution, aspect, camera lock, end frame upload | ~139 |
| `.../ai/components/ai-kling-v25-settings.tsx` | Duration, aspect, CFG slider, enhance prompt, negative prompt | ~105 |
| `.../ai/components/ai-kling-v26-settings.tsx` | Duration, aspect, CFG, audio generation, negative prompt | ~114 |
| `.../ai/components/ai-wan25-settings.tsx` | Duration, resolution, prompt expansion, negative prompt, audio upload | ~134 |

### What Stays in `ai-image-tab.tsx` (~400 lines)

| Section | Description |
|---------|-------------|
| Imports | UI components + 7 new settings components |
| `AIImageTabProps` | Props interface (~127 lines) — keep for now, split later if needed |
| Component function | Prop destructuring, model selection booleans, config lookups |
| JSX return | Image upload, prompt input, 7 conditional `<AiModelSettings />` renders, advanced options |

### Implementation

1. Create `apps/web/src/components/editor/media-panel/views/ai/components/` directory (if not exists).
2. For each model section, create a new component file:
   - Define a focused props interface (only the props that model needs).
   - Move the conditional JSX block into the new component.
   - The parent still wraps with `{modelSelected && <ModelSettings ... />}`.
3. Move helper calculations (config lookups, cost estimates) into each model component — they're model-specific.
4. Keep shared logic (model selection booleans) in the parent.
5. Update `ai-image-tab.tsx` to import and render the 7 new components.

### Risks

| Risk | Mitigation |
|------|------------|
| Props interface explosion | Each model component defines its own focused props (8-17 props each) |
| Shared UI patterns duplicated | Common patterns (Select, Label, cost display) are already imported from shadcn |
| `isCompact` prop threading | Pass through as prop to each component — simple boolean |
| Seedance/WAN FileUpload `onError` | Pass `onError` callback as prop |

---

## Phase 3: Split `ai/index.tsx` (1270 → ~400 + hooks + components)

**Risk Level:** Medium — hook extraction requires careful dependency management

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `.../ai/hooks/use-cost-calculation.ts` | `useCostCalculation()` — total cost, per-model pricing, ByteDance/FlashVSR estimates | ~89 |
| `.../ai/hooks/use-ai-panel-effects.ts` | `useAIPanelEffects()` — capability clamping, Reve reset, frame sync | ~66 |
| `.../ai/components/ai-model-selection-grid.tsx` | `AIModelSelectionGrid` — model buttons with logo, name, price, toggle | ~58 |
| `.../ai/components/ai-generation-feedback.tsx` | `AIGenerationFeedback` — progress bar, timer, generated videos list, download | ~96 |
| `.../ai/components/ai-validation-messages.tsx` | `AIValidationMessages` — tab-specific validation banners | ~49 |

### What Stays in `ai/index.tsx` (~400 lines)

| Section | Description |
|---------|-------------|
| Imports | Components, hooks, stores |
| `AiView()` | State init, tab hook setup, generation hook config |
| JSX | Container, header, collapsed state, tab selector, 5 tab content renders, settings, generate button |

### Implementation

1. Extract `useCostCalculation()` (lines 395-483): takes `selectedModels`, tab states, generation state, reve state. Returns `{ totalCost, bytedanceEstimatedCost, flashvsrEstimatedCost, hasRemixSelected }`.
2. Extract `useAIPanelEffects()` (lines 175-240): takes capabilities, tab setters, selected models, image state, selectedImage setter. No return value (side-effect only).
3. Extract `AIModelSelectionGrid` (lines 970-1027): takes `activeTab`, `selectedModels`, `isCompact`, `onToggleModel`.
4. Extract `AIGenerationFeedback` (lines 1094-1196): takes generation state, error. Combines error display + progress + results.
5. Extract `AIValidationMessages` (lines 1198-1246): takes `activeTab`, `selectedModels`, `prompt`, `selectedImage`, avatar/image states.
6. Update `ai/index.tsx` to import and use extracted hooks/components.

### Risks

| Risk | Mitigation |
|------|------------|
| Cost calculation depends on 15+ state values | Pass as structured config object, not individual params |
| Effects hook has side effects on multiple setters | Pass setters as callback object parameter |
| Model grid needs AI_MODELS constant filtering | Import directly in grid component |
| Generated videos download uses blob URL logic | Keep download handler inline or pass as callback |

---

## Phase 4: Split `export-engine.ts` (1404 → ~550 + 4 extracted modules)

**Risk Level:** Medium-high — class method extraction requires careful `this`/state management

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `apps/web/src/lib/export-engine-renderer.ts` | `renderFrame()`, `renderElement()`, `renderImage()`, `renderVideo()`, `renderVideoAttempt()`, `renderOverlayStickers()`, `renderTextElement()` | ~440 |
| `apps/web/src/lib/export-engine-recorder.ts` | `setupMediaRecorder()`, `getVideoBitrate()`, `startRecording()`, `stopRecording()` | ~125 |
| `apps/web/src/lib/export-engine-utils.ts` | `calculateTotalFrames()`, `getActiveElements()`, `calculateElementBounds()`, `getTotalDuration()`, `getFrameRate()` | ~145 |
| `apps/web/src/lib/export-engine-debug.ts` | `validateRenderedFrame()`, `logActualVideoDuration()` | ~92 |

### What Stays in `export-engine.ts` (~550 lines)

| Section | Description |
|---------|-------------|
| Imports & types | `ActiveElement`, `AdvancedProgressInfo`, `ProgressCallback` |
| `ExportEngine` class shell | Constructor, properties, `export()` orchestration method |
| Control methods | `cancel()`, `isExportInProgress()`, `isExportCancelled()` |
| Download methods | `downloadVideo()`, `exportAndDownload()` |
| Preloading | `preloadAllVideos()`, `preloadVideo()` |

### Implementation

1. Extract rendering functions as standalone functions that take an `ExportEngineContext` interface (canvas, ctx, settings, tracks, mediaItems, videoCache, usedImages). The class delegates: `renderFrame(...args) { return renderFrameImpl(this.context, ...args); }`.
2. Extract recorder functions similarly with a `RecorderContext` (canvas, settings, mediaRecorder, ffmpegRecorder, recordedChunks, useFFmpegExport).
3. Extract utility functions as pure functions — no class dependency needed.
4. Extract debug functions — only need ctx and canvas dimensions.
5. Define `ExportEngineContext` interface in the main file, pass `this` as context.

### Risks

| Risk | Mitigation |
|------|------------|
| `this` context lost in extracted methods | Pass explicit context object; don't rely on `this` |
| `export()` method references extracted methods | Import and call with context |
| Duplicated effects application in renderer | Consolidate into shared helper within renderer file |
| `renderVideo()` uses `videoCache` Map | Include in context; cache is mutable and shared |
| Class API shape changes | Keep all public method signatures identical; only internals move |

---

## Phase 5: Split `ffmpeg-handler.ts` (1310 → ~100 orchestrator + 4 modules)

**Risk Level:** High — IPC handler registration, dual CJS/ESM exports, Electron process context

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `electron/ffmpeg-export-handler.ts` | `export-video-cli` IPC handler (3-mode video export) | ~567 |
| `electron/ffmpeg-utility-handlers.ts` | `validate-filter-chain`, `processFrame`, `extract-audio`, `save-sticker-for-export` handlers | ~274 |
| `electron/ffmpeg-args-builder.ts` | `buildFFmpegArgs()` — Mode 1 & 2 argument construction | ~265 |
| `electron/ffmpeg-basic-handlers.ts` | `ffmpeg-path`, `ffmpeg-health`, `create-export-session`, `save-frame`, `read-output-file`, `cleanup-export-session`, `open-frames-folder` handlers | ~72 |

### What Stays in `ffmpeg-handler.ts` (~100 lines)

| Section | Description |
|---------|-------------|
| Imports | All handler modules |
| Health check | `getFFmpegHealth()`, `initFFmpegHealthCheck()` (~28 lines) |
| `setupFFmpegIPC()` | Calls sub-module registration functions |
| Type re-exports | All FFmpeg types from `./ffmpeg/types` |
| Module exports | Both CJS `module.exports` and ES6 `export default` |

### Implementation

1. Extract `buildFFmpegArgs()` (lines 1027-1291) first — it's a pure function with no IPC dependency.
2. Extract basic handlers (lines 101-172) — simple, stateless IPC handlers. Each takes `tempManager` as parameter.
3. Extract utility handlers (lines 744-1016) — filter validation, frame processing, audio extraction, sticker saving.
4. Extract export video handler (lines 175-741) — the most complex, 3-mode export. Imports `buildFFmpegArgs`.
5. Each module exports a `setup*Handlers(tempManager)` function that registers its IPC handlers.
6. `setupFFmpegIPC()` calls all 4 setup functions with the shared `tempManager` instance.

### Risks

| Risk | Mitigation |
|------|------------|
| Shared `tempManager` singleton | Pass as parameter to each setup function |
| `ipcMain.handle` registration order matters | Register in same order within orchestrator |
| CJS/ESM dual export breaks | Keep all exports in main file; sub-modules use ES6 only |
| `buildFFmpegArgs` called from export handler | Import directly — no circular dependency |
| Health check cached promise is module-level | Keep in main file — only 28 lines |

---

## New Files Created (Summary)

| Phase | New File(s) |
|-------|-------------|
| #1 | `image-edit-polling.ts`, `image-edit-models-info.ts`, `image-edit-utils.ts` |
| #2 | `ai/components/ai-vidu-q2-settings.tsx`, `ai-ltx-i2v-settings.tsx`, `ai-ltx-fast-i2v-settings.tsx`, `ai-seedance-settings.tsx`, `ai-kling-v25-settings.tsx`, `ai-kling-v26-settings.tsx`, `ai-wan25-settings.tsx` |
| #3 | `ai/hooks/use-cost-calculation.ts`, `ai/hooks/use-ai-panel-effects.ts`, `ai/components/ai-model-selection-grid.tsx`, `ai-generation-feedback.tsx`, `ai-validation-messages.tsx` |
| #4 | `export-engine-renderer.ts`, `export-engine-recorder.ts`, `export-engine-utils.ts`, `export-engine-debug.ts` |
| #5 | `ffmpeg-export-handler.ts`, `ffmpeg-utility-handlers.ts`, `ffmpeg-args-builder.ts`, `ffmpeg-basic-handlers.ts` |

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
| Circular imports | One-directional: new files import types from parent, parent imports implementations |
| Barrel re-export perf | Keep barrels thin; only re-export public API |
| Class method extraction | Pass explicit context object; keep public API identical |
| IPC handler registration | Orchestrator calls setup functions in order; sub-modules don't register independently |
| Dual CJS/ESM exports | Keep compatibility layer in main `ffmpeg-handler.ts` only |
| Hook state dependencies | Pass state as structured config objects, not 15+ individual params |
| Model component props | Each model component defines its own focused props interface |
| Shared UI components | Import from shadcn directly; no duplication needed |
