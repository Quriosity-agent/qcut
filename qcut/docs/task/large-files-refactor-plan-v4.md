# Large Files Refactoring Plan v4 — Next 5 Medium-Risk Files

> Generated: 2026-02-24 | Continues from: large-files-refactor-plan-v3.md (10 files DONE total)
> **STATUS: PENDING**

---

## Selection Criteria

Previous rounds targeted low-risk files (pure data, types, utilities). This round tackles **medium-risk** files — handlers, generators, and UI components with clear internal boundaries. Files were chosen for:
- High splittability (clear section boundaries)
- Low consumer count (1–8 files)
- Independent sections with minimal cross-dependencies

---

## 1. `electron/screen-recording-handler.ts` (1,075 lines)

### Analysis
- **Layered handler** with clear separation: types → utilities → file I/O → transcoding → IPC setup.
- Sections:
  - **Types & Constants** (lines 1-132): `SCREEN_SOURCE_TYPE`, `SCREEN_RECORDING_STATE`, `OUTPUT_FORMAT`, interfaces (~132 lines)
  - **Path Utilities** (lines 137-307): `sanitizeFilename()`, `ensureExtension()`, `resolveOutputFormat()`, `getRecordingsDir()`, `buildDefaultRecordingPath()`, `resolveOutputPath()` (~170 lines)
  - **File Operations** (lines 309-580): `buildCaptureFilePath()`, `ensureParentDirectory()`, `listCaptureSources()`, `pickSource()`, `waitForStreamOpen()`, `writeChunk()`, `closeStream()`, `moveFile()` (~270 lines)
  - **Transcoding & Output** (lines 581-704): `transcodeWebmToMp4()`, `finalizeRecordingOutput()`, `cleanupSessionFiles()` (~125 lines)
  - **Session State** (lines 705-825): `buildStatus()`, `resolveSourceForDisplayRequest()`, `ensureDisplayMediaHandlerConfigured()` (~120 lines)
  - **IPC Setup** (lines 827-1076): `setupScreenRecordingIPC()` — registers 5 handlers (~250 lines)
- **Consumers (2 files):** `utility-bridge.ts`, documentation

### Plan: Split by layer
```text
electron/screen-recording-handler/
  types.ts               → Constants (SCREEN_SOURCE_TYPE, SCREEN_RECORDING_STATE, OUTPUT_FORMAT),
                            all interfaces (~132 lines)
  path-utils.ts          → sanitizeFilename, ensureExtension, getPathExtension,
                            resolveOutputFormat, replaceExtension, normalizeOutputPathExtension,
                            getRecordingsDir, formatDateSegment, buildDefaultRecordingPath,
                            assertPathWithinAllowedDir, resolveOutputPath (~170 lines)
  file-ops.ts            → buildCaptureFilePath, ensureParentDirectory, mapSourceType,
                            listCaptureSources, getCurrentWindowSourceId, pickSource,
                            waitForStreamOpen, writeChunk, appendChunkToSession,
                            closeStream, removeFileIfExists, moveFile, getFileSize (~270 lines)
  transcoder.ts          → transcodeWebmToMp4, finalizeRecordingOutput,
                            cleanupSessionFiles (~125 lines)
  session.ts             → buildStatus, resolveSourceForDisplayRequest,
                            ensureDisplayMediaHandlerConfigured, session state (~120 lines)
  ipc.ts                 → setupScreenRecordingIPC (imports from above) (~250 lines)
  index.ts               → re-exports setupScreenRecordingIPC + types
```

- `from "./screen-recording-handler"` resolves to directory `index.ts` — **zero import changes**.
- **Internal dependencies:** `ipc.ts` → `session.ts` → `transcoder.ts` → `file-ops.ts` → `path-utils.ts` → `types.ts`. Clean one-directional dependency chain.
- **Risk: Low** — 2 consumers, layered architecture, barrel preserves API.

---

## 2. `apps/web/src/lib/ai-video/generators/text-to-video.ts` (866 lines)

### Analysis
- **Generator module** with one function per AI model, plus a shared payload builder.
- Sections:
  - **Imports & Docs** (lines 1-53): Type/validator imports (~53 lines)
  - **`generateVideo()`** (lines 73-283): Main entry point with queue polling (~210 lines)
  - **`generateVideoFromText()`** (lines 292-373): Hailuo 2.3 text-to-video (~80 lines)
  - **`generateLTXV2Video()`** (lines 380-468): LTX Video 2.0 with audio (~90 lines)
  - **`generateWAN26TextVideo()`** (lines 480-633): WAN v2.6 with multi-shot (~155 lines)
  - **`generateViduQ3TextVideo()`** (lines 645-776): Vidu Q3 with multi-resolution (~130 lines)
  - **`buildTextToVideoPayload()`** (lines 785-866): Payload construction helper (~80 lines)
- **Consumers (4 code files):** `ai-video/index.ts`, `model-handlers.ts`, `model-handler-implementations.ts`, + tests

### Plan: Split by model family
```text
apps/web/src/lib/ai-video/generators/text-to-video/
  shared.ts              → buildTextToVideoPayload(), shared types/imports (~100 lines)
  generate-video.ts      → generateVideo() main entry with queue polling (~230 lines)
  hailuo-generator.ts    → generateVideoFromText() for Hailuo 2.3 (~100 lines)
  ltxv2-generator.ts     → generateLTXV2Video() for LTX Video 2.0 (~110 lines)
  wan26-generator.ts     → generateWAN26TextVideo() for WAN v2.6 (~175 lines)
  vidu-generator.ts      → generateViduQ3TextVideo() for Vidu Q3 (~150 lines)
  index.ts               → re-exports all public functions
```

- `from "../generators/text-to-video"` resolves to directory `index.ts` — **zero import changes**.
- **Internal dependencies:** Each model generator imports from `shared.ts`. `generate-video.ts` calls individual generators by model type. No cross-model dependencies.
- **Risk: Low** — 4 code consumers, function-per-model is natural split, barrel preserves API.

---

## 3. `electron/native-pipeline/cli/vimax-cli-handlers.ts` (830 lines)

### Analysis
- **10 independent handler functions** with zero inter-dependencies. Each handler follows the same pattern: validate input → import dependencies → process → return result.
- Sections:
  - `handleVimaxExtractCharacters()` (lines 25-88, ~64 lines)
  - `handleVimaxGenerateScript()` (lines 91-148, ~58 lines)
  - `handleVimaxGenerateStoryboard()` (lines 151-253, ~103 lines)
  - `handleVimaxGeneratePortraits()` (lines 256-402, ~147 lines)
  - `handleVimaxCreateRegistry()` (lines 405-483, ~79 lines)
  - `handleVimaxShowRegistry()` (lines 486-543, ~58 lines)
  - `handleVimaxIdea2Video()` (lines 546-629, ~84 lines)
  - `handleVimaxScript2Video()` (lines 632-710, ~79 lines)
  - `handleVimaxNovel2Movie()` (lines 713-778, ~66 lines)
  - `handleVimaxListModels()` (lines 781-829, ~49 lines)
- **Consumers (3 code files):** `cli-runner/runner.ts`, `manager.ts`, self-reference

### Plan: Group by domain
```text
electron/native-pipeline/cli/vimax-cli-handlers/
  character-handlers.ts  → handleVimaxExtractCharacters,
                            handleVimaxGeneratePortraits (~211 lines)
  script-handlers.ts     → handleVimaxGenerateScript,
                            handleVimaxGenerateStoryboard (~161 lines)
  registry-handlers.ts   → handleVimaxCreateRegistry,
                            handleVimaxShowRegistry (~137 lines)
  pipeline-handlers.ts   → handleVimaxIdea2Video, handleVimaxScript2Video,
                            handleVimaxNovel2Movie (~229 lines)
  model-handlers.ts      → handleVimaxListModels (~49 lines)
  index.ts               → re-exports all 10 handler functions
```

- `from "./vimax-cli-handlers"` resolves to directory `index.ts` — **zero import changes**.
- **Internal dependencies:** None. All 10 handlers are fully independent.
- **Risk: Very low** — independent functions, 3 consumers, barrel preserves API. This is effectively already modular — just needs file separation.

---

## 4. `apps/web/src/components/editor/media-panel/views/media.tsx` (868 lines)

### Analysis
- **Large UI component** with mixed callbacks, rendering logic, and JSX. Single consumer makes it safe to refactor.
- Sections:
  - **Imports** (lines 1-68)
  - **State & hooks** (lines 71-101): Local state, store hooks
  - **Callbacks** (lines 107-362): `processFiles()`, `handleSync()`, `handleFileSelect()`, selection helpers, `handleAddSelectedToTimeline()`, `handleDeleteSelected()`, `handleDownloadSelected()`, `handleEdit()`, `formatDuration()` (~255 lines)
  - **`renderPreview()`** (lines 389-481): Preview rendering with type switching (~93 lines)
  - **Main JSX** (lines 483-867): File input, toolbar, media grid (~385 lines)
- **Consumers (1 file):** `media-panel/index.tsx`

### Plan: Extract sub-components and hooks
```text
apps/web/src/components/editor/media-panel/views/media/
  use-media-actions.ts   → Custom hook: processFiles, handleSync, handleFileSelect,
                            handleAddSelectedToTimeline, handleDeleteSelected,
                            handleDownloadSelected, handleEdit, selection helpers (~280 lines)
  media-preview.tsx      → renderPreview extracted as <MediaPreview> component (~110 lines)
  media-item-card.tsx    → Individual media item with context menu, extracted from
                            the media grid JSX loop (~150 lines)
  media.tsx              → Main component — uses hook + renders sub-components (~330 lines)
  index.ts               → re-exports default from media.tsx
```

- `from "../views/media"` resolves to directory `index.ts` — **zero import changes**.
- **Internal dependencies:** `media.tsx` imports from `use-media-actions.ts`, `media-preview.tsx`, `media-item-card.tsx`. No circular dependencies.
- **Risk: Low** — 1 consumer, UI extraction is safe, barrel preserves API.

---

## 5. `apps/web/src/components/export-dialog.tsx` (816 lines)

### Analysis
- **Dialog component** where JSX dominates (585 lines / 72%). Contains independent setting "card" sections that are natural extraction targets.
- Sections:
  - **Imports** (lines 1-50)
  - **State & hooks** (lines 52-116)
  - **`handleExport()`** (lines 129-215): Export business logic (~87 lines)
  - **Main JSX** (lines 230-814): 8 independent card sections:
    - Presets grid (lines 338-386, ~50 lines)
    - File name card (lines 389-413, ~25 lines)
    - Quality card (lines 415-447, ~33 lines)
    - Engine card (lines 449-526, ~78 lines)
    - Format card (lines 528-558, ~30 lines)
    - Details card (lines 560-609, ~50 lines)
    - Caption export card (lines 612-686, ~75 lines)
    - Audio export card (lines 689-720, ~32 lines)
    - Warnings section (lines 724-809, ~86 lines)
- **Consumers (1 file):** `export-panel-content.tsx`

### Plan: Extract setting cards
```text
apps/web/src/components/export-dialog/
  export-settings-cards.tsx → PresetGrid, QualityCard, EngineCard, FormatCard,
                               DetailsCard sub-components (~270 lines)
  export-media-cards.tsx    → CaptionExportCard, AudioExportCard
                               sub-components (~120 lines)
  export-warnings.tsx       → ExportWarnings component (~100 lines)
  export-dialog.tsx         → Main dialog: state, handleExport, layout,
                               composes sub-components (~330 lines)
  index.ts                  → re-exports default from export-dialog.tsx
```

- `from "../export-dialog"` / `from "./export-dialog"` resolves to directory `index.ts` — **zero import changes**.
- **Internal dependencies:** `export-dialog.tsx` imports from the three sub-component files. Sub-components receive props from parent (no store access needed).
- **Risk: Low** — 1 consumer, UI card extraction is mechanical, barrel preserves API.

---

## Execution Order (recommended)

1. **Split** `vimax-cli-handlers.ts` — independent functions, zero cross-deps, very low risk
2. **Split** `screen-recording-handler.ts` — 2 consumers, clean layered architecture
3. **Split** `text-to-video.ts` — model-per-file, natural boundaries
4. **Split** `export-dialog.tsx` — 1 consumer, UI card extraction
5. **Split** `media.tsx` — 1 consumer, hook + component extraction

**Total lines affected:** ~4,455 lines reorganized into focused modules.

---

## Files NOT selected (and why)

| File | Lines | Reason skipped |
|------|-------|----------------|
| `timeline-store-operations.ts` | 1,427 | Core state logic — high risk, many consumers |
| `claude-timeline-bridge.ts` | 1,417 | Core bridge logic — high risk |
| `timeline-track.tsx` | 1,324 | Complex UI component — high risk |
| `preview-panel.tsx` | 1,296 | Complex UI component — high risk |
| `ffmpeg-export-handler.ts` | 1,219 | Core export logic — high risk |
| `export-engine-cli.ts` | 1,128 | Core export class — `exportWithCLI()` is 540-line monolith, medium-high risk |
| `word-timeline-view.tsx` | 1,166 | Complex UI component — high risk |
| `media-store.ts` | 1,157 | Core store — high risk, many consumers |
| `claude-timeline-handler.ts` | 1,143 | Core handler — high risk |
| `drawing-canvas.tsx` | 1,132 | Complex canvas component — high risk |
| `timeline-store.ts` | 1,087 | Core store — high risk |
| `use-ai-generation.ts` | 1,082 | Core hook — medium-high risk |
| `ffmpeg-utils.ts` | 903 | `initFFmpeg()` is 280-line monolith with complex fallback logic — risky to split |
| `remotion-store.ts` | 919 | 12 consumers — medium risk, candidate for v5 |
| `effects-store.ts` | 852 | 23 consumers + tight internal coupling — not worth splitting |
| `use-canvas-objects.ts` | 830 | 1 consumer — candidate for v5 |
| Test files (5) | 825–1,187 | Low value to split |
