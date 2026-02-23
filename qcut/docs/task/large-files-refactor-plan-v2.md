# Large Files Refactoring Plan v2 — Next 5 Low-Risk Files

> Generated: 2026-02-23 | Continues from: large-files-refactor-plan.md (6 files DONE)
> **STATUS: ALL DONE ✅**

---

## 1. ✅ DONE `apps/web/src/lib/moyin/presets/director-presets.ts` (941 lines)

### Analysis
- **Pure data file.** Contains 15+ exported const arrays/objects of preset data, plus derived types.
- Cleanly sectioned with `// ==================== ... ====================` comment blocks.
- Categories: Shot Size, Duration, Sound Effects, Lighting (3 arrays), Focus (2 arrays), Camera Rig (2 arrays), Atmospheric Effects (2 arrays), Playback Speed, Camera Movement, Special Techniques, Emotions, Camera Angles, Focal Length, Photography Techniques.
- **Consumers (2 files):** `presets/index.ts` (barrel), `presets/__tests__/presets.test.ts`

### Plan: Split into category files
```text
apps/web/src/lib/moyin/presets/director-presets/
  shot-size.ts           → SHOT_SIZE_PRESETS, ShotSizeType
  duration.ts            → DURATION_PRESETS
  sound-effects.ts       → SOUND_EFFECT_PRESETS
  lighting.ts            → LIGHTING_STYLE_PRESETS, LIGHTING_DIRECTION_PRESETS, COLOR_TEMPERATURE_PRESETS
  focus.ts               → DEPTH_OF_FIELD_PRESETS, FOCUS_TRANSITION_PRESETS
  camera-rig.ts          → CAMERA_RIG_PRESETS, MOVEMENT_SPEED_PRESETS
  atmospheric.ts         → ATMOSPHERIC_EFFECT_PRESETS, EFFECT_INTENSITY_PRESETS
  playback-speed.ts      → PLAYBACK_SPEED_PRESETS
  camera-movement.ts     → CAMERA_MOVEMENT_PRESETS, CameraMovementType
  special-techniques.ts  → SPECIAL_TECHNIQUE_PRESETS, SpecialTechniqueType
  emotions.ts            → EMOTION_PRESETS, EmotionTag
  camera-angle.ts        → CAMERA_ANGLE_PRESETS, CameraAngleType
  focal-length.ts        → FOCAL_LENGTH_PRESETS, FocalLengthType
  photography.ts         → PHOTOGRAPHY_TECHNIQUE_PRESETS, PhotographyTechniqueType
  index.ts               → re-exports everything
```

**Simpler alternative (recommended — 4 files):**
```text
director-presets/
  shot-and-camera.ts     → SHOT_SIZE_PRESETS, CAMERA_ANGLE_PRESETS, CAMERA_MOVEMENT_PRESETS,
                            CAMERA_RIG_PRESETS, FOCAL_LENGTH_PRESETS, MOVEMENT_SPEED_PRESETS + types
  lighting-and-effects.ts → LIGHTING_*, COLOR_TEMPERATURE_*, ATMOSPHERIC_*, EFFECT_INTENSITY_*,
                            DEPTH_OF_FIELD_*, FOCUS_TRANSITION_*
  techniques.ts          → SPECIAL_TECHNIQUE_*, PHOTOGRAPHY_TECHNIQUE_*, EMOTION_*, PLAYBACK_SPEED_*,
                            SOUND_EFFECT_*, DURATION_PRESETS
  index.ts               → re-exports everything
```

- Update `presets/index.ts` import from `"./director-presets"` → `"./director-presets/index"` (or keep as-is if directory resolution works).
- **No cross-dependencies** between presets — each const is fully standalone.
- **Risk: Very low** — pure data, 2 consumers, barrel re-export preserves API.

---

## 2. ✅ DONE `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts` (958 lines)

### Analysis
- **Pure types file.** Contains ~50+ exported interfaces/types organized into sections:
  - **Model Config types** (lines 22-137): `AIModelEndpoints`, `UpscaleModelEndpoints`, `AIModelParameters`, `UpscaleModelParameters`, `ModelCategory`, `AIModel`
  - **Generation types** (lines 139-165): `GeneratedVideo`, `GeneratedVideoResult`, `PollingState`, `AIServiceManager`
  - **Hook props** (lines 171-365): `UseAIGenerationProps` (giant ~190 line interface with all model-specific options)
  - **State types** (lines 366-453): `AIGenerationState`, `AIHistoryState`, `AIActiveTab`, `AvatarUploadState`, `ProgressUpdate`, `ImageUploadState`, `GenerationStatus`, `APIConfiguration`, `AIError`
  - **Model-specific request types** (lines 455-847): Seeddream, Video generation requests (Vidu, LTXV2, Avatar, Seedance, Kling, WAN, ByteDance, FlashVSR, Topaz upscale), Sync Lipsync, Sora2
  - **Convenience re-exports** (lines 940-958)
- **Consumers (33 files):** Widely imported across the AI feature. All use named imports.

### Plan: Split by concern
```text
ai-types/
  model-config.ts        → AIModelEndpoints, UpscaleModelEndpoints, AIModelParameters,
                            UpscaleModelParameters, ModelCategory, AIModel (~120 lines)
  generation.ts          → GeneratedVideo, GeneratedVideoResult, PollingState, AIServiceManager,
                            ProgressUpdate, ProgressCallback, GenerationStatus, APIConfiguration,
                            AIError (~90 lines)
  hook-props.ts          → UseAIGenerationProps, AIGenerationState, AIHistoryState,
                            UseAIHistoryProps, AIActiveTab, AvatarUploadState,
                            ImageUploadState (~300 lines)
  request-types.ts       → All model-specific request/response interfaces:
                            VideoGenerationRequest, ImageToVideoRequest, TextToVideoRequest,
                            Vidu*, LTXV2*, AvatarVideoRequest, Seedance*, Kling*, WAN*,
                            ByteDance*, FlashVSR*, Topaz*, VideoGenerationResponse,
                            ModelsResponse, CostEstimate (~400 lines)
  lipsync-types.ts       → SyncLipsync* types, SyncLipsyncReact1Request (~50 lines)
  sora2-types.ts         → Sora2ModelType, Sora2BasePayload, Sora2Payload (~40 lines)
  seeddream-types.ts     → Seeddream45* types (~40 lines)
  index.ts               → re-exports everything (including convenience aliases)
```

- Directory barrel means `from "../types/ai-types"` resolves to `./ai-types/index.ts` — **zero import changes needed** for the 33 consumers.
- **Internal dependencies:** `hook-props.ts` imports from `generation.ts` (ProgressUpdate, GeneratedVideo types) and `lipsync-types.ts` (SyncLipsync* types). `generation.ts` needs AIVideoOutputManager import from external.
- **Risk: Low** — types-only file, barrel re-export, no runtime behavior. Many consumers but all named imports resolve through barrel.

---

## 3. ✅ DONE `electron/preload-types.ts` (1139 lines)

### Analysis
- Structure:
  - **Supporting types** (lines 35-369): ~30 exported interfaces for file ops, transcription, export, sound, screen recording, Remotion, skills, media import, etc.
  - **ElectronAPI interface** (lines 371-1128): Single massive ~750 line interface defining every IPC method.
  - **Global augmentation** (lines 1130-1139): `declare global { Window.electronAPI }`
- **Consumers (3 files):** `preload.ts`, `preload-integrations.ts`, and self.
- The ElectronAPI interface is a single monolith but splitting it would require `interface merging` or `intersection types`, which adds complexity.

### Plan: Split supporting types out, keep ElectronAPI intact
```text
electron/preload-types/
  supporting-types.ts    → All 30+ small interfaces (FileDialogFilter, FileInfo,
                            SoundSearchParams, TranscriptionRequestData, ExportSession,
                            FrameData, VideoSource, ExportOptions, AudioFile, ApiKeyConfig,
                            SaveAIVideoOptions, GitHubStarsResponse, FalUploadResult, Skill,
                            MediaImportOptions, RemotionCompositionInfo, ScreenCapture*,
                            ThemeSource, etc.) (~335 lines)
  electron-api.ts        → ElectronAPI interface (~760 lines — still large but it's a single
                            interface definition, splitting further is unnatural)
  index.ts               → re-exports supporting-types + ElectronAPI + global augmentation
```

**Alternative (more granular supporting types):**
```text
electron/preload-types/
  file-types.ts          → FileDialogFilter, FileInfo, VideoSource, FrameData, AudioFile
  transcription-types.ts → TranscriptionRequestData, TranscriptionResult, TranscriptionSegment,
                            AIFillerWordItem, AnalyzeFillersResult
  export-types.ts        → ExportSession, ExportOptions, CancelResult
  media-types.ts         → MediaImportOptions, MediaImportResult, SaveAIVideoOptions, SaveAIVideoResult
  screen-recording-types.ts → ScreenCapture*, StartScreenRecording*, StopScreenRecording*, ScreenRecordingStatus
  remotion-types.ts      → RemotionCompositionInfo, RemotionFolder*, RemotionBundleResult
  misc-types.ts          → ApiKeyConfig, FalUploadResult, Skill, SkillsSyncForClaudeResult,
                            GitHubStarsResponse, SoundSearchParams, SoundDownloadParams, ThemeSource
  electron-api.ts        → ElectronAPI interface (imports types from above)
  index.ts               → re-exports everything + global augmentation
```

- Keep original `preload-types.ts` as barrel re-export file → **zero import changes** for `preload.ts` and `preload-integrations.ts`.
- **Risk: Low** — types-only, 3 consumers, barrel approach.

---

## 4. ✅ DONE `apps/web/src/lib/ai-video/validation/validators.ts` (957 lines)

### Analysis
- Contains validators grouped by AI model, clearly sectioned:
  - **Constants** (lines 18-38): LTXV2 duration/resolution/FPS constants
  - **Hailuo 2.3** (lines 40-87): 3 functions
  - **Vidu Q2** (lines 89-117): 2 functions
  - **LTXV2** (lines 119-277): 7 functions + model ID checkers
  - **Kling Avatar v2** (lines 279-310): 1 function
  - **Kling/WAN25** (lines 312-350): 3 functions
  - **WAN26** (lines 352-466): 10 functions + model ID checkers
  - **Image generation (Reve)** (lines 468-723): constants + 6 functions
  - **Sync Lipsync React-1** (lines 725-855): constants + 6 functions
  - **Vidu Q3** (lines 857-957): constants + 5 functions
- **Consumers (12 files):** Various generator files + fal-ai client files.

### Plan: Split by model/feature
```text
apps/web/src/lib/ai-video/validation/
  ltxv2-validators.ts      → LTXV2 constants + all LTXV2 validation functions (~160 lines)
  hailuo-validators.ts     → Hailuo 2.3 validators (~50 lines)
  vidu-validators.ts       → Vidu Q2 + Vidu Q3 validators + constants (~100 lines)
  kling-validators.ts      → Kling avatar v2 + Kling prompt validators (~50 lines)
  wan-validators.ts        → WAN 2.5 + WAN 2.6 validators + model checkers (~120 lines)
  reve-validators.ts       → Reve/image constants + aspect ratio + output format +
                              Reve validation functions (~260 lines)
  lipsync-validators.ts    → Sync Lipsync React-1 constants + validators (~130 lines)
  index.ts                 → re-exports everything from all sub-files
```

- Transform `validators.ts` into a barrel re-export OR rename to directory + `index.ts`.
- **Option A (safest):** Keep `validators.ts` as thin barrel → zero import changes for 12 consumers.
- **Internal dependencies:** Only `ltxv2-validators.ts` imports `LTXV2_FAST_CONFIG` from `ai-constants`. All others import `ERROR_MESSAGES` and `debugLogger`. No cross-validator dependencies.
- **Risk: Low** — validators are self-contained per model, barrel re-export preserves API. 12 consumers all use named imports.

### Dependency map:
- All files import: `ERROR_MESSAGES` from `ai-constants`, `debugLogger` from `debug-logger`
- `ltxv2-validators.ts` additionally imports: `LTXV2_FAST_CONFIG` from `ai-constants`
- No validator imports another validator.

---

## 5. ✅ DONE `apps/web/src/types/electron.d.ts` (1694 lines)

### Analysis
- **Largest file in the codebase.** Structure:
  - **Standalone types** (lines 1-114): `ElevenLabsTranscription*`, `ScreenCapture*`, `StartScreenRecording*`, `StopScreenRecording*`, `ScreenRecordingStatus`
  - **ElectronAPI interface** (lines 115-1373): Massive ~1260 line interface (web-side mirror of `electron/preload-types.ts` ElectronAPI)
  - **Post-API types** (lines 1374-1694): `ReleaseNote`, `ProjectFolderFileInfo`, `ProjectFolderScanResult`, `AIPipeline*`, `MediaImport*`, `RemotionComposition*`, etc.
- **Consumers (19 files):** Widely imported across the web app.
- **Note:** This file mirrors `electron/preload-types.ts` for the web side. The ElectronAPI interface is a single declaration.

### Plan: Split surrounding types out, keep ElectronAPI intact
```text
apps/web/src/types/electron/
  screen-recording.ts    → ScreenCaptureSourceType, ScreenCaptureSource, StartScreenRecording*,
                            StopScreenRecording*, ScreenRecordingStatus (~55 lines)
  transcription.ts       → ElevenLabsTranscriptionWord, ElevenLabsTranscribeResult (~30 lines)
  electron-api.d.ts      → ElectronAPI interface (~1260 lines — single interface, impractical
                            to split further without interface merging)
  release-notes.ts       → ReleaseNote (~20 lines)
  project-folder.ts      → ProjectFolderFileInfo, ProjectFolderScanResult (~50 lines)
  ai-pipeline.ts         → AIPipelineProgress, AIPipelineGenerateOptions, AIPipelineResult,
                            AIPipelineCostEstimate, AIPipelineStatus (~90 lines)
  media-import.ts        → MediaImportOptions, MediaImportResult, MediaImportMetadata (~40 lines)
  remotion.ts            → RemotionCompositionInfo, RemotionFolderSelectResult, RemotionFolderScanResult,
                            RemotionBundleResult, RemotionFolderBundleResult, RemotionFolderImportResult (~90 lines)
  index.ts               → re-exports everything
```

- Keep original `electron.d.ts` as barrel re-export → **zero import changes** for 19 consumers.
- The ElectronAPI interface stays monolithic (1260 lines) since TypeScript interface merging in declaration files is complex and could cause issues.
- **Net win:** ~375 lines extracted from surrounding types into focused modules. The main interface stays cohesive.
- **Risk: Low-Medium** — types-only, 19 consumers, barrel preserves API. The `.d.ts` → directory conversion needs careful TypeScript config checking to ensure declaration files resolve correctly.

### Important caveat:
- This file uses `export interface` (not `declare`), so it works as a regular `.ts` module despite `.d.ts` extension.
- Verify that `tsconfig.json` doesn't have special handling for `.d.ts` files in this path.
- **Safer approach:** Rename to `electron.ts` (drop `.d.ts`) during the split, or keep the barrel as `electron.d.ts`.

---

## Execution Order (recommended)

1. **Split** `director-presets.ts` — pure data, 2 consumers, zero dependencies
2. **Split** `validators.ts` — well-sectioned, model-per-file, barrel preserves 12 consumers
3. **Split** `ai-types.ts` — types-only, barrel preserves 33 consumers
4. **Split** `preload-types.ts` — types-only, 3 consumers
5. **Split** `electron.d.ts` — largest file, 19 consumers, needs careful `.d.ts` handling

**Total estimated effort:** ~3 hours for all 5 files.
**Total lines affected:** ~5,629 lines reorganized into focused modules.

---

## Files NOT selected (and why)

| File | Lines | Reason skipped |
|------|-------|----------------|
| `timeline-store-operations.ts` | 1428 | Core state logic — high risk |
| `claude-timeline-bridge.ts` | 1396 | Core bridge logic — high risk |
| `timeline-track.tsx` | 1325 | Complex UI component — high risk |
| `preview-panel.tsx` | 1297 | Complex UI component — high risk |
| `ffmpeg-export-handler.ts` | 1220 | Core export logic — high risk |
| `moyin-view.test.tsx` | 1186 | Test file — low value to split |
| `electron-helpers.ts` | 1183 | Test helper — low value to split |
| `word-timeline-view.tsx` | 1165 | Complex UI component — high risk |
| `media-store.ts` | 1158 | Core store logic — high risk |
| `claude-timeline-handler.ts` | 1139 | Core handler — high risk |
| `drawing-canvas.tsx` | 1133 | Complex canvas component — high risk |
| `remaining-gaps.test.ts` | 1130 | Test file — low value |
| `export-engine-cli.ts` | 1129 | Core export logic — high risk |
| `timeline-store.ts` | 1088 | Core store — high risk |
| `use-ai-generation.ts` | 1083 | Core hook — medium-high risk |
| `screen-recording-handler.ts` | 1076 | Core handler — medium risk |
