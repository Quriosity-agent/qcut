# Implementation Plan: Split Top 5 Largest Files — Round 2

**Created:** 2026-02-11
**Goal:** Reduce remaining >800-line files with no behavior changes.
**Predecessor:** [split-top5-large-files-plan.md](./split-top5-large-files-plan.md) (4/5 phases complete)

## Current Top 5 Files Worth Splitting

| # | File | Lines | Target | New File(s) |
|---|------|------:|--------|-------------|
| 1 | `apps/web/src/components/editor/timeline/index.tsx` | 1584 | ~400 + ~480 + ~180 | `timeline-toolbar.tsx`, `timeline-drag-handlers.ts` |
| 2 | `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handler-implementations.ts` | 1518 | ~270 + ~620 + ~120 + ~415 | Split by handler category into 4 files |
| 3 | `apps/web/src/lib/fal-ai-client.ts` | 1512 | ~500 + ~375 + ~405 + ~155 | Split by model family |
| 4 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | 1428 | ~700 + ~180 + ~140 + ~55 | Continue partial split #2 |
| 5 | `apps/web/src/lib/text2image-models.ts` | 1422 | ~100 registry + ~4 provider files | Split by provider |

---

## Execution Order

| Phase | Subtask | Why This Order |
|-------|---------|---------------|
| **Phase 1** | **#5 text2image-models** | Lowest risk — pure config data, no logic, no state |
| **Phase 2** | **#2 model-handler-implementations** | Low risk — independent pure functions, clear category boundaries |
| **Phase 3** | **#3 fal-ai-client** | Medium risk — class method extraction, but methods are self-contained |
| **Phase 4** | **#4 use-ai-generation** | Medium risk — continues partial split, interdependent hook state |
| **Phase 5** | **#1 timeline/index** | Highest risk — complex refs, shared state, component extraction |

Each phase is one commit. Do not start the next phase until verification passes.

---

## Phase 1: Split `text2image-models.ts` (1422 → ~100 + 4 provider files)

**Risk Level:** Low — pure configuration data, no logic

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `apps/web/src/lib/text2image-models/google-models.ts` | imagen4-ultra, nano-banana, gemini-3-pro | ~250 |
| `apps/web/src/lib/text2image-models/bytedance-models.ts` | seeddream-v3, v4, v4-5, v4-5-edit | ~470 |
| `apps/web/src/lib/text2image-models/flux-models.ts` | flux-pro-v11-ultra, flux-2-flex | ~180 |
| `apps/web/src/lib/text2image-models/other-models.ts` | wan-v2-2, qwen-image, reve, z-image-turbo, gpt-image-1-5 | ~420 |
| `apps/web/src/lib/text2image-models/index.ts` | `Text2ImageModel` interface, `TEXT2IMAGE_MODELS` registry, `MODEL_CATEGORIES`, helpers | ~100 |

### Implementation

1. Create directory `apps/web/src/lib/text2image-models/`.
2. Move `Text2ImageModel` interface to `index.ts`.
3. Each provider file exports an array of model configs.
4. `index.ts` imports and aggregates all providers into `TEXT2IMAGE_MODELS`.
5. Move `TEXT2IMAGE_MODEL_ORDER`, `MODEL_CATEGORIES`, helper functions to `index.ts`.
6. Delete original `text2image-models.ts`.
7. Update all imports across codebase (likely `import { TEXT2IMAGE_MODELS } from '@/lib/text2image-models'` — path stays the same with barrel).

### Risks

| Risk | Mitigation |
|------|------------|
| Import paths break | Barrel `index.ts` preserves `@/lib/text2image-models` import path |
| Model order changes | `TEXT2IMAGE_MODEL_ORDER` stays in index, references model IDs not array position |

---

## Phase 2: Split `model-handler-implementations.ts` (1518 → 4 category files)

**Risk Level:** Low — all handlers are independent exported functions

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `.../generation/handlers/text-to-video-handlers.ts` | 8 T2V handlers (Veo, Hailuo, LTX, Vidu, WAN, generic) | ~270 |
| `.../generation/handlers/image-to-video-handlers.ts` | 15 I2V handlers (Veo, Vidu, LTX, Seedance, Kling, WAN, generic) | ~620 |
| `.../generation/handlers/upscale-handlers.ts` | ByteDance + FlashVSR upscale | ~120 |
| `.../generation/handlers/avatar-handlers.ts` | Kling ref/v2v/avatar, WAN ref, lipsync, Veo extend | ~415 |

### Implementation

1. Create `handlers/` subdirectory under `generation/`.
2. Move coercion types (lines 45-79) into each handler file as needed (they're private to implementations).
3. Each file imports types from `../model-handlers.ts`.
4. Update `model-handlers.ts` router imports to point to new files.
5. Delete `model-handler-implementations.ts`.

### What Stays in `model-handlers.ts` (~379 lines, unchanged)

Router functions, public types, constants — no changes needed to this file beyond updating import paths.

### Risks

| Risk | Mitigation |
|------|------------|
| Router import paths break | Update switch-case imports; routers don't change logic |
| Coercion types duplicated | Each file has only the coercion types it needs |

---

## Phase 3: Split `fal-ai-client.ts` (1512 → ~500 core + method files)

**Risk Level:** Medium — class method extraction requires careful `this` binding

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `apps/web/src/lib/fal-ai-client-veo31.ts` | Veo 3.1 Fast/Standard T2V, I2V, F2V, Extend methods | ~405 |
| `apps/web/src/lib/fal-ai-client-generation.ts` | `convertSettingsToParams`, `generateWithModel`, `generateWithMultipleModels` | ~375 |
| `apps/web/src/lib/fal-ai-client-reve.ts` | `generateReveTextToImage`, `generateReveEdit` | ~155 |

### What Stays in `fal-ai-client.ts` (~500 lines)

| Section | Description |
|---------|-------------|
| Imports & types | Interface definitions |
| FalAIClient class shell | Constructor, `makeRequest`, API key management, upload methods |
| Utility methods | `testModelAvailability`, `estimateGenerationTime`, `getModelCapabilities` |
| Singleton & exports | Lazy init, export wrappers, `batchGenerate` |

### Implementation

1. Extract Veo 3.1 methods as standalone functions that take `client: FalAIClient` as first param.
2. Extract generation methods similarly.
3. In the class, delegate to extracted functions: `generateVeo31FastT2V(...args) { return veo31FastT2V(this, ...args); }`.
4. Or use a mixin/composition pattern to keep the class API identical.

### Risks

| Risk | Mitigation |
|------|------------|
| `this` context lost in extracted methods | Pass `client` explicitly; don't use arrow functions |
| Class API shape changes | Keep method signatures identical; only internals move |
| Singleton pattern breaks | Singleton stays in main file; extracted functions are stateless |

---

## Phase 4: Continue Split `use-ai-generation.ts` (1428 → ~700 + extracted hooks)

**Risk Level:** Medium — hook state interdependencies

### New Files (additions to existing `use-ai-generation-helpers.ts`)

| File | Contents | ~Lines |
|------|----------|-------:|
| `.../hooks/use-ai-polling.ts` | `startStatusPolling` logic extracted as custom hook | ~180 |
| `.../hooks/use-ai-mock-generation.ts` | `handleMockGenerate` extracted as standalone function | ~140 |
| `.../hooks/use-ai-generation-helpers.ts` | **Existing** — add settings builders + response handlers from original plan Groups 3 & 4 | ~583 → ~780 |

### What Was Already Extracted (583 lines in helpers)

Group 1 (pure utilities) and Group 2 (validation) from the original split-2 plan.

### What Still Needs Extraction

| Group | Functions | ~Lines to Move |
|-------|-----------|---------------:|
| Settings Builders | `buildUnifiedParams`, `buildTextToVideoSettings`, `buildImageToVideoSettings`, `buildUpscaleSettings`, `buildAvatarSettings` | ~200 |
| Response Handlers | `classifyResponse`, `handleDirectWithJobResponse`, `handleJobIdOnlyResponse`, `handleDirectVideoResponse` | ~200 |
| Polling | `startStatusPolling` (closure-heavy, needs hook extraction) | ~180 |
| Mock Generation | `handleMockGenerate` | ~140 |

### Implementation

1. Extract settings builders into `use-ai-generation-helpers.ts` (extends existing file).
2. Extract response handlers into `use-ai-generation-helpers.ts`.
3. Create `use-ai-polling.ts` as a custom hook wrapping `startStatusPolling`.
4. Create `use-ai-mock-generation.ts` for mock generation logic.
5. Refactor `handleGenerate` to call extracted helpers.

### Risks

| Risk | Mitigation |
|------|------------|
| Polling uses 10+ state setters | Pass setters as callback object parameter |
| Mock generation uses store hooks | Pass as deps parameter |
| `handleGenerate` deps array breaks | Extracted helpers are stable; fewer deps needed |

---

## Phase 5: Split `timeline/index.tsx` (1584 → ~400 + components)

**Risk Level:** High — shared refs, drag state, complex render tree

### New Files

| File | Contents | ~Lines |
|------|----------|-------:|
| `.../timeline/timeline-toolbar.tsx` | `TimelineToolbar` component (already self-contained) | ~480 |
| `.../timeline/timeline-drag-handlers.ts` | `useDragHandlers` hook (drag/drop event logic) | ~180 |
| `.../timeline/timeline-ruler.tsx` | Time markers + ruler rendering (optional, lower priority) | ~165 |

### What Stays in `timeline/index.tsx` (~400 lines)

| Section | Description |
|---------|-------------|
| Imports | Components, hooks, stores |
| Timeline component | State init, scroll sync, click handlers, layout composition |
| TrackIcon | Small utility (18 lines), can stay or move with toolbar |

### Implementation

1. **Move `TimelineToolbar`** (lines 1106-1584) to `timeline-toolbar.tsx`. This is already a separate component — cleanest extraction.
2. **Extract `useDragHandlers`** (lines 365-546) into a custom hook. Pass refs and store methods as parameters.
3. **Optionally extract ruler** (lines 729-891) into `TimelineRuler` component.
4. Update imports in `timeline/index.tsx`.

### Risks

| Risk | Mitigation |
|------|------------|
| Shared refs between Timeline and Toolbar | Pass refs as props to TimelineToolbar |
| Drag handlers need scroll position refs | `useDragHandlers` takes refs as params |
| Store hook calls duplicated | Both components read from same Zustand store — no issue |
| `TrackIcon` used by both files | Move to toolbar file or create shared `timeline-icons.ts` |

---

## New Files Created (Summary)

| Phase | New File(s) |
|-------|-------------|
| #1 | `text2image-models/google-models.ts`, `bytedance-models.ts`, `flux-models.ts`, `other-models.ts`, `index.ts` |
| #2 | `generation/handlers/text-to-video-handlers.ts`, `image-to-video-handlers.ts`, `upscale-handlers.ts`, `avatar-handlers.ts` |
| #3 | `fal-ai-client-veo31.ts`, `fal-ai-client-generation.ts`, `fal-ai-client-reve.ts` |
| #4 | `hooks/use-ai-polling.ts`, `hooks/use-ai-mock-generation.ts` (+ extend existing helpers) |
| #5 | `timeline/timeline-toolbar.tsx`, `timeline/timeline-drag-handlers.ts` |

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
| Config model ordering | Registry file controls order; provider files just define models |
| Class method extraction | Pass `client` explicitly; keep class API shape identical |
| Hook state interdependencies | Extract pure logic first; stateful hooks last |
| Timeline ref sharing | Pass refs as props; avoid global ref patterns |
