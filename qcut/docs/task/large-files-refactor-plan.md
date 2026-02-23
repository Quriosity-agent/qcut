# Large Files Refactoring Plan — Low Risk Files

> Generated: 2026-02-23 | Branch: win-7
> **STATUS: ALL DONE ✅**

---

## 1. `apps/web/src/lib/export-engine.backup.ts` (1089 lines)

### Analysis
- **Dead code confirmed.** No file in the entire codebase imports `export-engine.backup`.
- It's a `.backup.ts` file — clearly a manual backup of the export engine before a rewrite.

### Action: **DELETE** ✅ DONE
- Simply delete the file. Zero risk — nothing references it.
- If we want a safety net, `git log` already has the history.

---

## 2. `electron/native-pipeline/registry-data.ts` (1115 lines)

### Analysis
- Contains 3 exported functions registering AI model definitions:
  - `registerTextToVideoModels()` (line 12, ~320 lines) — ~15 text-to-video models
  - `registerImageToVideoModels()` (line 334, ~570 lines) — image-to-video models
  - `registerImageToImageModels()` (line 904, ~210 lines) — image-to-image models
- **Single consumer:** `electron/native-pipeline/init.ts` imports all 3 functions.

### Plan: Split into 3 files by category ✅ DONE
```
electron/native-pipeline/registry-data/
  text-to-video.ts    → registerTextToVideoModels()
  image-to-video.ts   → registerImageToVideoModels()
  image-to-image.ts   → registerImageToImageModels()
  index.ts            → re-exports all 3 functions
```
- Update `init.ts` import from `"./registry-data.js"` → `"./registry-data/index.js"`
- Each file imports `ModelRegistry` from `"../registry.js"`
- **Risk: Very low** — pure data, single consumer, barrel re-export keeps API identical.

---

## 3. `electron/native-pipeline/registry-data-2.ts` (825 lines)

### Analysis
- Contains 12 exported functions for various model categories:
  - `registerAvatarModels()` (line 12)
  - `registerVideoToVideoModels()` (line 228)
  - `registerTextToImageModels()` (line 389)
  - `registerTTSModels()` (line 511)
  - `registerImageUnderstandingModels()` (line 555)
  - `registerPromptGenerationModels()` (line 655)
  - `registerSpeechToTextModels()` (line 727)
  - `registerRunwayModels()` (line 743)
  - `registerHeyGenModels()` (line 760)
  - `registerDIDModels()` (line 777)
  - `registerSynthesiaModels()` (line 794)
  - `registerAllPart2Models()` (line 812) — calls all of the above
- **Single consumer:** `init.ts` imports only `registerAllPart2Models`.

### Plan: Split into category files under same directory ✅ DONE
```
electron/native-pipeline/registry-data/
  avatar.ts              → registerAvatarModels()
  video-to-video.ts      → registerVideoToVideoModels()
  text-to-image.ts       → registerTextToImageModels()
  tts.ts                 → registerTTSModels()
  image-understanding.ts → registerImageUnderstandingModels()
  prompt-generation.ts   → registerPromptGenerationModels()
  speech-to-text.ts      → registerSpeechToTextModels()
  platform-models.ts     → registerRunwayModels(), registerHeyGenModels(), registerDIDModels(), registerSynthesiaModels() (small, keep together)
  index-part2.ts         → registerAllPart2Models() re-importing from above
```
- Alternatively, merge the tiny functions (Runway/HeyGen/DID/Synthesia are ~15 lines each) into `platform-models.ts`.
- Update `init.ts` import from `"./registry-data-2.js"` → `"./registry-data/index-part2.js"`
- **Risk: Very low** — same pattern as #2.

### Combined directory structure for #2 + #3:
```
electron/native-pipeline/registry-data/
  index.ts              → re-exports from part 1 + part 2
  text-to-video.ts
  image-to-video.ts
  image-to-image.ts
  avatar.ts
  video-to-video.ts
  text-to-image.ts
  tts.ts
  image-understanding.ts
  prompt-generation.ts
  speech-to-text.ts
  platform-models.ts
```

---

## 4. `apps/web/src/lib/effects-templates.ts` (827 lines)

### Analysis
- Structure:
  - Interfaces: `EffectTemplate`, `TemplateEffect` (lines 13-36)
  - Data arrays by category: `PROFESSIONAL_TEMPLATES` (line 38), `CREATIVE_TEMPLATES` (128), `VINTAGE_TEMPLATES` (242), `MODERN_TEMPLATES` (371)
  - Combined array: `EFFECT_TEMPLATES` (line 475)
  - Utility functions: `applyTemplate`, `saveCustomTemplate`, `loadCustomTemplates`, `deleteCustomTemplate`, `exportTemplate`, `importTemplate`, `getTemplatesByCategory`, `searchTemplates` (lines 538-827)
- **Single consumer:** `apps/web/src/components/editor/effect-templates-panel.tsx`

### Plan: Split into template data + functions ✅ DONE
```
apps/web/src/lib/effects-templates/
  types.ts              → EffectTemplate, TemplateEffect interfaces
  professional.ts       → PROFESSIONAL_TEMPLATES array
  creative.ts           → CREATIVE_TEMPLATES array
  vintage.ts            → VINTAGE_TEMPLATES array
  modern.ts             → MODERN_TEMPLATES array
  templates.ts          → EFFECT_TEMPLATES combined array (imports above)
  utils.ts              → applyTemplate, save/load/delete/export/import/search functions
  index.ts              → re-exports everything (maintains API)
```
- **Simpler alternative (recommended):** Just 3 files:
  ```
  effects-templates/
    types.ts       → interfaces
    data.ts        → all 4 template arrays + EFFECT_TEMPLATES
    utils.ts       → all utility functions
    index.ts       → re-exports
  ```
- Update import in `effect-templates-panel.tsx` from `"@/lib/effects-templates"` → `"@/lib/effects-templates"` (index.ts barrel, no change needed if directory has index)
- **Risk: Very low** — single consumer, barrel re-export.

---

## 5. `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts` (876 lines)

### Analysis
- Structure:
  - `T2V_MODELS` object (line 23, ~370 lines) — all model definitions
  - `T2VModelId` type (line 391)
  - `T2V_MODEL_ORDER` array (line 397)
  - `T2V_MODEL_ID_ALIASES` map (line 427)
  - `T2VModelCapabilities` interface (line 458)
  - `T2V_MODEL_CAPABILITIES` record (line 478, ~280 lines)
  - Helper functions: `getCombinedCapabilities`, `getT2VModelsInOrder`, `resolveT2VModelId` (lines 766-876)
- **Consumers (7 files):** `ai-constants.ts`, `use-ai-generation-helpers.ts`, `use-ai-panel-effects.ts`, `ai-text-tab.tsx`, `index.tsx`, plus 2 test files.

### Plan: Split by concern ✅ DONE
```
text2video-models-config/
  models.ts          → T2V_MODELS object + T2VModelId type
  order.ts           → T2V_MODEL_ORDER + T2V_MODEL_ID_ALIASES
  capabilities.ts    → T2VModelCapabilities interface + T2V_MODEL_CAPABILITIES record
  helpers.ts         → getCombinedCapabilities, getT2VModelsInOrder, resolveT2VModelId
  index.ts           → re-exports everything
```
- Directory-based barrel export means existing imports `from "./text2video-models-config"` resolve to `./text2video-models-config/index.ts` — **zero import changes needed**.
- **Risk: Low** — barrel re-export preserves API. Multiple consumers but they all use named imports.

---

## 6. `electron/ffmpeg/utils.ts` (1009 lines)

### Analysis
- Sections (well-marked with `====` comment blocks):
  - **Constants** (lines 19-31): `MAX_EXPORT_DURATION`, `QUALITY_SETTINGS`
  - **Debug Logging** (lines 33-63): `debugLog`, `debugWarn`, `debugError`
  - **Path Resolution** (lines 65-444): `getFFmpegPath()`, `getFFprobePath()` — large section with staged binary search logic
  - **Health Check** (lines 445-569): `verifyFFmpegBinary()`
  - **Progress Parsing** (lines 570-692): `parseProgress()`
  - **Video Normalization** (lines 693-end): `normalizeVideo()`, `probeVideoFile()`
- **Many consumers (10+ files):** Various electron handlers import different subsets.

### Plan: Split by section ✅ DONE
```
electron/ffmpeg/
  constants.ts       → MAX_EXPORT_DURATION, QUALITY_SETTINGS, debug logging functions
  paths.ts           → getFFmpegPath(), getFFprobePath() + StagedBinarySearchResult + internal helpers
  health.ts          → verifyFFmpegBinary()
  progress.ts        → parseProgress()
  probe.ts           → probeVideoFile(), normalizeVideo()
  index.ts           → re-exports everything from above (barrel)
```
- Rename/keep `utils.ts` as `index.ts` or add barrel `index.ts` that re-exports.
- **Important:** Current imports are `from "./ffmpeg/utils"` or `from "../ffmpeg/utils.js"`. Two options:
  - **Option A (safest):** Keep `utils.ts` as a barrel that re-exports from sub-modules. Zero import changes.
  - **Option B:** Rename to directory + index.ts, update imports.
- **Recommend Option A** — transform `utils.ts` into a thin re-export file.
- **Risk: Low-Medium** — many consumers, but Option A requires zero import changes. Internal dependencies between sections (e.g., health check uses `getFFmpegPath`) handled by importing between split files.

### Dependency map within utils.ts:
- `health.ts` needs: `getFFmpegPath` from `paths.ts`, `debugLog/debugError` from `constants.ts`
- `probe.ts` needs: `getFFmpegPath`, `getFFprobePath` from `paths.ts`, `debugLog/debugError` from `constants.ts`
- `progress.ts` needs: nothing (standalone)
- `paths.ts` needs: `debugLog` from `constants.ts`

---

## Execution Order (recommended)

1. **Delete** `export-engine.backup.ts` — instant win, zero risk
2. **Split** `registry-data.ts` + `registry-data-2.ts` together — pure data, single consumer
3. **Split** `effects-templates.ts` — single consumer, simple structure
4. **Split** `text2video-models-config.ts` — directory barrel = zero import changes
5. **Split** `ffmpeg/utils.ts` — last because most consumers, but Option A (barrel) is safe

**Total estimated effort:** ~2 hours for all 6 files.
**Total lines reduced:** ~4,741 lines removed from monolithic files (redistributed into focused modules).
