# Large Files Refactoring Plan v3 — Next 5 Low-Risk Files

> Generated: 2026-02-24 | Continues from: large-files-refactor-plan-v2.md (5 files DONE)
> **STATUS: PENDING**

---

## 1. `electron/main-ipc.ts` (801 lines)

### Analysis
- **IPC registration hub.** Single exported function `registerMainIpcHandlers(deps)` that registers ~25 `ipcMain.handle()` calls.
- Clearly sectioned by domain: Audio/Video temp (3 handlers), Shell/GitHub (2), FAL uploads (4), File dialogs (4), File I/O (6), Storage (4), FFmpeg resources (2), Updates (2), Release notes (2).
- Each section is fully independent — no cross-references between sections.
- **Consumers (1 file):** `electron/main.ts`

### Plan: Split into domain handler files
```text
electron/main-ipc/
  types.ts               → ReleaseNote, Logger, AutoUpdater, MainIpcDeps interfaces,
                            FAL content-type maps (~70 lines)
  audio-video-handlers.ts → save-temp-audio, save-temp-video, get-temp-dir handlers (~60 lines)
  shell-github-handlers.ts → open-external, fetch-github-stars handlers (~50 lines)
  fal-upload-handlers.ts  → fal:initiate-upload, fal:complete-upload,
                            fal:upload-image, fal:upload-video handlers (~140 lines)
  file-dialog-handlers.ts → show-open-dialog, show-save-dialog,
                            show-open-directory, show-message-box handlers (~85 lines)
  file-io-handlers.ts     → read-file, write-file, list-directory,
                            file-exists, read-binary-file, get-dir-size handlers (~200 lines)
  storage-handlers.ts     → storage:get, storage:set, storage:list, storage:clear handlers (~90 lines)
  ffmpeg-handlers.ts      → get-ffmpeg-path, get-ffprobe-path handlers (~45 lines)
  update-handlers.ts      → check-for-updates, install-update handlers (~50 lines)
  release-notes-handlers.ts → get-release-notes, get-changelog handlers (~45 lines)
  index.ts               → imports all sub-handlers, exports registerMainIpcHandlers
                            that calls each sub-registration function
```

**Barrel strategy:** Each sub-file exports a `registerXxxHandlers(deps: MainIpcDeps)` function. The barrel `index.ts` composes them:
```ts
export function registerMainIpcHandlers(deps: MainIpcDeps): void {
  registerAudioVideoHandlers(deps);
  registerShellGithubHandlers(deps);
  // ...
}
```
- `electron/main.ts` import path stays `./main-ipc` → resolves to `./main-ipc/index.ts`.
- **Risk: Very low** — 1 consumer, independent sections, no shared state between handlers.

---

## 2. `electron/claude/handlers/claude-export-handler.ts` (938 lines)

### Analysis
- **Export presets data + export job engine.** Contains:
  - **Types** (lines 34-67): `ExportSegment`, `ResolvedExportSettings`, `ExportJobInternal`, `ProgressEventPayload` interfaces
  - **Preset data** (lines 70-172): `PRESETS` — large array of 7 `ExportPreset` objects (~100 lines)
  - **Utility functions** (lines 173-270): `sanitizeFileName`, `parseBitrateForKbps`, `parseTimecodeToSeconds`, `clampProgress`, `pruneOldJobs`, `getDefaultOutputPath`
  - **Core logic** (lines 284-600): `findPresetById`, `resolveExportSettings`, `findMediaForElement`, `collectExportSegments`, `ensureDirectory`, `runFFmpegCommand`
  - **Job management** (lines 599-760): `executeExportJob`, `getActiveJobForProject`, `updateJobProgress`
  - **Public API** (lines 790-1011): `isTimelineEmpty`, `getExportPresets`, `getExportRecommendation`, `startExportJob`, `getExportJobStatus`, `listExportJobs`, `applyProgressEvent`, `clearExportJobsForTests`, `setupClaudeExportIPC`
- **Consumers (5 files):** `claude-http-shared-routes.ts`, `claude/index.ts`, 2 test files, `handler-functions.test.ts`

### Plan: Split by concern
```text
electron/claude/handlers/claude-export-handler/
  types.ts               → ExportSegment, ResolvedExportSettings, ExportJobInternal,
                            ProgressEventPayload, EXPORT_JOB_STATUS const (~45 lines)
  presets.ts             → PRESETS array data, findPresetById (~120 lines)
  utils.ts               → sanitizeFileName, parseBitrateForKbps, parseTimecodeToSeconds,
                            clampProgress, pruneOldJobs, getDefaultOutputPath (~100 lines)
  export-engine.ts       → resolveExportSettings, findMediaForElement, collectExportSegments,
                            ensureDirectory, runFFmpegCommand, executeExportJob (~320 lines)
  job-manager.ts         → exportJobs Map, getActiveJobForProject, updateJobProgress,
                            getExportJobStatus, listExportJobs, clearExportJobsForTests (~120 lines)
  public-api.ts          → isTimelineEmpty, getExportPresets, getExportRecommendation,
                            startExportJob, applyProgressEvent (~200 lines)
  ipc.ts                 → setupClaudeExportIPC (~35 lines)
  index.ts               → re-exports public API + setupClaudeExportIPC
```

- Barrel re-export preserves `from "../handlers/claude-export-handler"` import paths.
- **Internal dependency:** `export-engine.ts` imports from `types.ts`, `utils.ts`, `presets.ts`. `public-api.ts` imports from `job-manager.ts`, `export-engine.ts`, `presets.ts`. `job-manager.ts` owns the `exportJobs` Map singleton.
- **Risk: Low** — 5 consumers (2 test files), well-sectioned, barrel preserves API.

---

## 3. `apps/web/src/lib/remotion/component-loader.ts` (874 lines)

### Analysis
- **Remotion component loading utility.** Clearly sectioned:
  - **Types** (lines 26-78): `LoadResult`, `LoadOptions`, `StoredComponent` interfaces (~50 lines)
  - **Constants** (lines 80-95): DB name, store name, version (~15 lines)
  - **IndexedDB helpers** (lines 97-230): `openDatabase`, `storeComponent`, `getStoredComponent`, `getAllStoredComponents`, `deleteStoredComponent` (~135 lines)
  - **Helpers** (lines 232-248): `generateComponentId` (~15 lines)
  - **Component Loading** (lines 249-621): `loadComponentFromCode`, `loadComponentFromFile`, `loadStoredComponents`, `loadStoredComponentsWithAnalysis`, `removeStoredComponent`, `getComponentSourceCode`, `updateStoredComponent` (~370 lines)
  - **Folder Import Types** (lines 623-671): `FolderImportResult`, `FolderComponentEntry`, `FolderImportProgress` interfaces (~50 lines)
  - **Folder Import Functions** (lines 673-end): `loadComponentsFromFolder`, `generateFolderComponentId`, `inferCategoryFromComposition`, `isFolderImportAvailable`, `importFromFolder` (~200 lines)
- **Consumers (5 files):** `component-import-dialog.tsx`, `folder-import-dialog.tsx`, `remotion-store.ts`, 2 test files

### Plan: Split by domain
```text
apps/web/src/lib/remotion/component-loader/
  types.ts               → LoadResult, LoadOptions, StoredComponent,
                            FolderImportResult, FolderComponentEntry,
                            FolderImportProgress interfaces (~100 lines)
  constants.ts           → DB_NAME, STORE_NAME, DB_VERSION (~15 lines)
  indexeddb.ts           → openDatabase, storeComponent, getStoredComponent,
                            getAllStoredComponents, deleteStoredComponent (~135 lines)
  loader.ts              → generateComponentId, loadComponentFromCode,
                            loadComponentFromFile, loadStoredComponents,
                            loadStoredComponentsWithAnalysis, removeStoredComponent,
                            getComponentSourceCode, updateStoredComponent (~385 lines)
  folder-import.ts       → loadComponentsFromFolder, generateFolderComponentId,
                            inferCategoryFromComposition, isFolderImportAvailable,
                            importFromFolder (~200 lines)
  index.ts               → re-exports everything from all sub-files
```

- `from "@/lib/remotion/component-loader"` resolves to directory `index.ts` — **zero import changes**.
- **Internal dependencies:** `loader.ts` imports from `types.ts`, `constants.ts`, `indexeddb.ts`. `folder-import.ts` imports from `types.ts`, `loader.ts`, `indexeddb.ts`.
- **Risk: Low** — utility module, 5 consumers, clean sections, barrel preserves API.

---

## 4. `electron/ai-pipeline-handler.ts` (848 lines)

### Analysis
- **Single class `AIPipelineManager`** (~750 lines) + types (~85 lines at top).
- Class methods by concern:
  - **Environment detection** (lines 92-232): constructor, `getFallbackConfig`, `loadEnvironment`, `ensureEnvironmentReady`, `detectEnvironment`, `getBundledConfig`, `getVersionFromCommand`, `execCommand` (~140 lines)
  - **Status/availability** (lines 275-380): `refreshEnvironment`, `isAvailable`, `getStatus`, `getUnavailableErrorMessage`, `getDefaultFeatures`, `getExecutionTimeoutMs` (~105 lines)
  - **Command building helpers** (lines 419-540): `buildSessionId`, `shouldUseJsonOutput`, `commandSupportsOutputDir`, `commandRequiresFalKey`, `resolveOutputDirectory`, `buildSpawnEnvironment` (~120 lines)
  - **Auto-import** (lines 540-596): `maybeAutoImportOutput` (~55 lines)
  - **Execution** (lines 597-end): `execute`, `cancelExecution`, `cleanup` (~250 lines)
- **Consumers (2 files):** `ai-pipeline-ipc.ts`, `claude-analyze-handler.ts`

### Plan: Extract helpers, keep class slim
```text
electron/ai-pipeline-handler/
  types.ts               → PipelineConfig, GenerateOptions, PipelineProgress,
                            PipelineResult, PipelineStatus, ExecutionEvent interfaces (~85 lines)
  environment.ts         → detectEnvironment(), getBundledConfig(),
                            getVersionFromCommand(), execCommand() as standalone
                            functions (extracted from class) (~140 lines)
  command-builder.ts     → buildSessionId(), shouldUseJsonOutput(),
                            commandSupportsOutputDir(), commandRequiresFalKey(),
                            resolveOutputDirectory(), buildSpawnEnvironment() (~120 lines)
  auto-import.ts         → maybeAutoImportOutput() logic (~55 lines)
  pipeline-manager.ts    → AIPipelineManager class (now delegates to above modules,
                            keeps state + execute/cancel/cleanup) (~300 lines)
  index.ts               → re-exports AIPipelineManager + all types
```

- `from "./ai-pipeline-handler"` resolves to directory `index.ts` — **zero import changes**.
- **Class refactor note:** The extracted functions become standalone helpers that receive config/deps as params instead of using `this`. The class delegates to them. This is a slightly more involved refactor than pure barrel splits.
- **Risk: Low-Medium** — 2 consumers, but class method extraction requires careful parameter threading. Types and helpers are clean.

---

## 5. `electron/native-pipeline/cli/cli-runner.ts` (877 lines)

### Analysis
- **Single class `CLIPipelineRunner`** (~710 lines) + 2 standalone utility functions + types/imports.
- Class methods by concern:
  - **Main dispatch** (lines 229-349): `run()` — giant switch statement dispatching ~35 commands to handler files or internal methods (~120 lines)
  - **Generate handler** (lines 350-493): `handleGenerate()` — image/video/avatar generation (~145 lines)
  - **Pipeline handler** (lines 494-609): `handleRunPipeline()` — chain pipeline execution (~115 lines)
  - **Transfer motion** (lines 610-680): `handleTransferMotion()` (~70 lines)
  - **Grid generation** (lines 681-830): `handleGenerateGrid()` (~150 lines)
  - **Upscale** (lines 831-920): `handleUpscaleImage()` (~90 lines)
  - **Standalone utilities** (lines 921-end): `guessExtFromCommand()`, `createProgressReporter()`, `renderProgressBar()` (~50 lines)
- **Consumers (14 files):** `cli.ts` (main), 7 test files, 6 handler/editor files (mostly importing `CLIRunOptions` type)
- Note: Already partially split — admin/media/remotion/vimax/editor handlers extracted to separate files.

### Plan: Continue the extraction pattern
```text
electron/native-pipeline/cli/cli-runner/
  types.ts               → CLIRunOptions, CLIResult interfaces + re-export
                            (currently defined in cli-runner.ts, imported by ~12 files) (~30 lines)
  progress.ts            → createProgressReporter(), renderProgressBar(),
                            guessExtFromCommand() standalone utilities (~50 lines)
  handler-generate.ts    → handleGenerate() logic as standalone function (~145 lines)
  handler-pipeline.ts    → handleRunPipeline() logic as standalone function (~115 lines)
  handler-transfer.ts    → handleTransferMotion() logic as standalone function (~70 lines)
  handler-grid.ts        → handleGenerateGrid() logic as standalone function (~150 lines)
  handler-upscale.ts     → handleUpscaleImage() logic as standalone function (~90 lines)
  runner.ts              → CLIPipelineRunner class (delegates to handler functions,
                            keeps run() dispatch + abort logic) (~250 lines)
  index.ts               → re-exports CLIPipelineRunner, CLIRunOptions, CLIResult,
                            createProgressReporter
```

- `from "../cli/cli-runner"` / `"../cli/cli-runner.js"` resolves to directory `index.ts` — **zero import changes** for 14 consumers.
- **Type extraction is high-value:** `CLIRunOptions` and `CLIResult` are imported by 12+ files. Moving them to `types.ts` breaks the circular risk where handler files import types from the runner.
- **Risk: Low** — follows existing extraction pattern (admin/media/remotion handlers already split). The remaining handlers are self-contained methods.

---

## Execution Order (recommended)

1. **Split** `main-ipc.ts` — 1 consumer, independent sections, pure registration
2. **Split** `claude-export-handler.ts` — well-sectioned, data + logic separation
3. **Split** `component-loader.ts` — clean sections, utility module
4. **Split** `cli-runner.ts` — continues existing extraction pattern
5. **Split** `ai-pipeline-handler.ts` — class extraction requires more care

**Total estimated effort:** ~4 hours for all 5 files.
**Total lines affected:** ~4,338 lines reorganized into focused modules.

---

## Files NOT selected (and why)

| File | Lines | Reason skipped |
|------|-------|----------------|
| `claude-timeline-bridge.ts` | 1418 | Core bridge logic — high risk |
| `timeline-store-operations.ts` | 1244 | Core state logic — high risk |
| `preview-panel.tsx` | 1196 | Complex UI component — high risk |
| `timeline-track.tsx` | 1187 | Complex UI component — high risk |
| `ffmpeg-export-handler.ts` | 1104 | Core export logic — high risk |
| `editor-cli-integration.test.ts` | 1073 | Test file — low value to split |
| `word-timeline-view.tsx` | 1071 | Complex UI component — high risk |
| `moyin-view.test.tsx` | 1067 | Test file — low value |
| `electron-helpers.ts` | 1062 | Test helper — low value |
| `claude-timeline-handler.ts` | 1039 | Core handler — high risk |
| `media-store.ts` | 1038 | Core store — high risk |
| `drawing-canvas.tsx` | 1022 | Complex canvas component — high risk |
| `export-engine-cli.ts` | 1016 | Core export logic — high risk |
| `use-ai-generation.ts` | 999 | Core hook — medium-high risk |
| `timeline-store.ts` | 989 | Core store — high risk |
| `remaining-gaps.test.ts` | 989 | Test file — low value |
| `screen-recording-handler.ts` | 967 | Core handler — medium risk |
| `ai/index.tsx` | 940 | Complex UI component — medium risk |
| `cli-pipeline.test.ts` | 919 | Test file — low value |
| `timeline/index.tsx` | 887 | Complex UI component — medium risk |
| `media.tsx` | 805 | UI component — medium risk |
