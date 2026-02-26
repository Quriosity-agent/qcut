# Large Files Refactoring Plan v5 — Three 1000+ Line Files

> Generated: 2026-02-26 | Continues from: large-files-refactor-plan-v4.md
> **STATUS: PENDING**

---

## Selection Criteria

These are the three largest remaining files in the codebase, all exceeding the 800-line
limit by 250+ lines. Each has clear internal boundaries and existing extraction patterns
in sibling modules that demonstrate the target architecture.

| # | File | Lines | Risk |
|---|------|-------|------|
| 1 | `apps/web/src/lib/export/export-engine-cli.ts` | 1,128 | Medium |
| 2 | `apps/web/src/stores/timeline/timeline-store.ts` | 1,091 | Medium-High |
| 3 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | 1,085 | Medium |

---

## 1. `export-engine-cli.ts` (1,128 lines → ~350 lines)

### Current Structure Analysis

The file contains the `CLIExportEngine` class, a single class extending `ExportEngine`.
Previous refactoring already extracted filters, sources, utilities, and audio preparation
into sibling modules. What remains is:

| Section | Lines | Description |
|---------|-------|-------------|
| Imports + type alias | 1–58 | 13 import groups, `EffectsStore` type |
| Constructor | 60–94 | Electron env validation, audio options setup |
| Wrapper methods | 96–234 | 7 thin wrappers delegating to extracted modules |
| Utility delegators | 251–305 | 5 methods (`invokeIfAvailable`, `fileExists`, etc.) |
| **`export()`** | 307–499 | Main export orchestration (~190 lines) |
| `createExportSession()` | 501–509 | Simple IPC call |
| **`exportWithCLI()`** | 515–1056 | Audio validation + mode selection + FFmpeg call (~540 lines) |
| `readOutputFile()` | 1058–1064 | 7 lines |
| `calculateTotalFrames()` | 1066–1068 | 3 lines |
| `logActualVideoDurationCLI()` | 1070–1106 | Blob duration debug logging |
| `cleanup()` | 1108–1127 | Session cleanup |

**Key insight**: `exportWithCLI()` is 540 lines — it contains audio validation (~90 lines),
mode decision logic (~120 lines), export options assembly (~80 lines), debug logging (~60 lines),
and the FFmpeg invocation (~40 lines). These are clearly separable concerns.

### Proposed Split

```text
apps/web/src/lib/export/
  export-engine-cli.ts           → Slim class: constructor, export(), wrappers (~350 lines)
  export-engine-cli-validation.ts → Audio file validation pipeline (~120 lines)
  export-engine-cli-mode.ts      → Mode decision logic + export options assembly (~200 lines)
  export-engine-cli-ffmpeg.ts    → FFmpeg invocation + result handling (~130 lines)
  export-engine-cli-debug.ts     → Duration logging, debug output (EXISTING, extend) (~120 lines)
  export-engine-cli-utils.ts     → (EXISTING, keep as-is) (~132 lines)
  export-engine-cli-audio.ts     → (EXISTING, keep as-is) (~236 lines)
```

### File Details

#### `export-engine-cli-validation.ts` (~120 lines) — NEW
```text
Exports:
  validateAudioFiles(audioFiles, deps) → AudioFileInput[]

Contents:
  - Parallel audio file validation logic (current lines 569–659)
  - File existence checks, size validation, ffprobe format validation
  - Filter out files with no audio streams
  - Dependencies injected: fileExists, getFileInfo, validateAudioWithFfprobe
```

#### `export-engine-cli-mode.ts` (~200 lines) — NEW
```text
Exports:
  determineExportMode(analysis, tracks, ...) → ExportModeDecision
  buildExportOptions(decision, sessionId, ...) → ExportOptions

Contents:
  - Word filter detection + keep-segment calculation (current lines 790–903)
  - Mode 1/1.5/2 decision tree (current lines 800–844, 904–926)
  - Export options object assembly (current lines 929–966)
  - Types: ExportModeDecision, ExportOptions
```

#### `export-engine-cli-ffmpeg.ts` (~130 lines) — NEW
```text
Exports:
  invokeFFmpegExport(options) → string (outputFile)
  logExportConfiguration(options) → void

Contents:
  - Debug console.log block for export config (current lines 968–1009)
  - FFmpeg CLI invocation via electronAPI (current lines 1019–1055)
  - Error handling and timing
```

#### `export-engine-cli-debug.ts` (~120 lines) — EXTEND EXISTING
```text
Additions:
  logActualVideoDurationCLI(videoBlob, totalDuration) → void

Contents:
  - Existing debug utilities (92 lines)
  - Move blob duration logging here (current lines 1070–1106)
```

### Barrel Re-export Strategy

The existing `apps/web/src/lib/export/index.ts` already uses `export * from "./export-engine-cli"`.
No changes needed — `CLIExportEngine` stays exported from the same file. New modules are
internal implementation details, not re-exported from the barrel.

### Migration Steps

1. Create `export-engine-cli-validation.ts` — extract `validateAudioFiles()` as a pure function
2. Create `export-engine-cli-mode.ts` — extract mode decision + options builder as pure functions
3. Create `export-engine-cli-ffmpeg.ts` — extract FFmpeg invocation + config logging
4. Move `logActualVideoDurationCLI` to existing `export-engine-cli-debug.ts`
5. Refactor `exportWithCLI()` to call the new modules sequentially
6. Remove wrapper methods that add no value (thin delegators to utility functions can be inlined)
7. Verify: `bun check-types; bun run test`

### Estimated Result

| File | Before | After |
|------|--------|-------|
| `export-engine-cli.ts` | 1,128 | ~350 |
| `export-engine-cli-validation.ts` | — | ~120 |
| `export-engine-cli-mode.ts` | — | ~200 |
| `export-engine-cli-ffmpeg.ts` | — | ~130 |
| `export-engine-cli-debug.ts` | 92 | ~120 |

---

## 2. `timeline-store.ts` (1,091 lines → ~350 lines)

### Current Structure Analysis

The file creates the main Zustand timeline store using `create<TimelineStore>()`. Previous
refactoring already extracted heavy operations into `timeline-store-operations.ts` which
composes `timeline-add-ops.ts`, `timeline-element-ops.ts`, and `timeline-track-ops.ts`.
What remains is:

| Section | Lines | Description |
|---------|-------|-------------|
| Imports | 1–31 | 8 import groups |
| `normalizeMarkdownElement()` | 38–69 | Markdown element normalization |
| `normalizeLoadedTracks()` | 71–82 | Track normalization on load |
| `autoSaveTimer` | 36 | Module-level debounce timer |
| Closure helpers | 84–200 | `updateTracks`, `autoSaveTimeline`, `autoSaveTimelineGuarded`, `updateTracksAndSave` |
| Initial state | 202–225 | Default values for all state fields |
| Selection methods | 226–286 | `getSortedTracks`, `pushHistory`, `undo`, `selectElement`, `deselectElement`, `clearSelectedElements`, `setSelectedElements` |
| **Track/element CRUD** | 288–492 | `addTrack`, `insertTrackAt`, `addElementToTrack` (190 lines!) |
| **Element updates** | 494–828 | `removeElementFromTrack`, `moveElementToTrack`, 7x `update*` methods |
| **Queries & persistence** | 830–953 | `getTotalDuration`, `getProjectThumbnail`, `redo`, `loadProjectTimeline`, `saveProjectTimeline` |
| **Settings & utilities** | 955–1089 | `saveImmediate`, `clearTimeline`, `restoreTracks`, toggles, `checkElementOverlap`, `findOrCreateTrack`, spread operations |

**Key insight**: The store has three extractable concerns:
1. **Auto-save infrastructure** (closure helpers) — 120 lines of async save logic
2. **Element CRUD** (add/remove/move/update) — 340 lines of track mutation methods
3. **Persistence & queries** — 120 lines of load/save/thumbnail

### Proposed Split

```text
apps/web/src/stores/timeline/
  timeline-store.ts              → Slim store: initial state + compose slices (~350 lines)
  timeline-store-autosave.ts     → Auto-save helpers and debounce logic (~130 lines)
  timeline-store-crud.ts         → Element add/remove/move + validation (~340 lines)
  timeline-store-persistence.ts  → load/save/immediate/thumbnail/clear (~160 lines)
  timeline-store-normalization.ts → normalizeMarkdownElement, normalizeLoadedTracks (~50 lines)
  timeline-store-operations.ts   → (EXISTING, keep as-is) (~51 lines)
  timeline-add-ops.ts            → (EXISTING, keep as-is) (~428 lines)
  timeline-element-ops.ts        → (EXISTING, keep as-is) (~518 lines)
  timeline-track-ops.ts          → (EXISTING, keep as-is) (~475 lines)
  index.ts                       → (EXISTING, add new module re-exports if needed)
```

### File Details

#### `timeline-store-autosave.ts` (~130 lines) — NEW
```text
Exports:
  createAutoSaveHelpers(set, get) → { updateTracks, autoSaveTimeline, autoSaveTimelineGuarded, updateTracksAndSave }

Contents:
  - Module-level autoSaveTimer (current line 36)
  - updateTracks() — ensureMainTrack + sort + set (current lines 86–93)
  - autoSaveTimeline() — dynamic import project-store, get projectId (current lines 96–102)
  - autoSaveTimelineGuarded(projectId) — cross-project guard + save (current lines 106–170)
  - updateTracksAndSave() — update + debounced save (current lines 174–200)
```

#### `timeline-store-crud.ts` (~340 lines) — NEW
```text
Exports:
  createCrudOperations(get, set, deps) → Partial<TimelineStore>

Contents:
  - addTrack, insertTrackAt (current lines 288–303)
  - addElementToTrack — validation + normalization + first-element canvas sizing (current lines 305–492)
  - removeElementFromTrack — sticker cleanup + ripple support (current lines 494–533)
  - moveElementToTrack — validation + track mutation (current lines 535–588)
  - updateElementTrim, updateElementDuration, updateElementStartTime (current lines 590–657)
  - toggleTrackMute, toggleElementHidden (current lines 659–684)
  - updateTextElement, updateMarkdownElement (current lines 686–737)
  - updateElementTransform, updateElementPosition, updateElementSize, updateElementRotation (current lines 740–783)
  - updateMediaElement, updateRemotionElement (current lines 785–828)
  - Dependencies injected: { updateTracksAndSave, pushHistory }
```

#### `timeline-store-persistence.ts` (~160 lines) — NEW
```text
Exports:
  createPersistenceOperations(get, set, deps) → Partial<TimelineStore>

Contents:
  - getTotalDuration() (current lines 830–846)
  - getProjectThumbnail() (current lines 848–891)
  - redo() (current lines 893–899)
  - loadProjectTimeline() (current lines 902–932)
  - saveProjectTimeline() (current lines 934–953)
  - saveImmediate() (current lines 956–994)
  - clearTimeline() (current lines 996–1000)
  - restoreTracks() (current lines 1002–1007)
  - Dependencies injected: { updateTracks, normalizeLoadedTracks }
```

#### `timeline-store-normalization.ts` (~50 lines) — NEW
```text
Exports:
  normalizeMarkdownElement(element) → TimelineElement
  normalizeLoadedTracks(tracks) → TimelineTrack[]

Contents:
  - Pure functions, no side effects (current lines 38–82)
```

### Barrel Re-export Strategy

The main store export (`useTimelineStore`) stays in `timeline-store.ts`. The barrel
`index.ts` does NOT currently export `timeline-store.ts` — consumers import it directly
via `@/stores/timeline/timeline-store`. No barrel changes needed. New modules are internal
implementation details imported only by `timeline-store.ts`.

### Migration Steps

1. Create `timeline-store-normalization.ts` — move pure normalization functions
2. Create `timeline-store-autosave.ts` — extract closure helpers into a factory function
3. Create `timeline-store-crud.ts` — extract all add/remove/move/update methods
4. Create `timeline-store-persistence.ts` — extract load/save/query methods
5. Refactor `timeline-store.ts` to compose slices: call factories, spread results into store
6. Verify: `bun check-types; bun run test`

### Pattern: Dependency Injection

Follow the existing pattern from `timeline-store-operations.ts`:

```typescript
// timeline-store-crud.ts
export function createCrudOperations(
  get: StoreGet,
  set: StoreSet,
  deps: { updateTracksAndSave: (tracks: TimelineTrack[]) => void }
): Partial<TimelineStore> {
  return {
    addTrack: (type) => { ... },
    removeElementFromTrack: (trackId, elementId) => { ... },
    // ...
  };
}
```

### Estimated Result

| File | Before | After |
|------|--------|-------|
| `timeline-store.ts` | 1,091 | ~350 |
| `timeline-store-autosave.ts` | — | ~130 |
| `timeline-store-crud.ts` | — | ~340 |
| `timeline-store-persistence.ts` | — | ~160 |
| `timeline-store-normalization.ts` | — | ~50 |

---

## 3. `use-ai-generation.ts` (1,085 lines → ~280 lines)

### Current Structure Analysis

This is a React hook (`useAIGeneration`) that manages AI video generation. Previous
refactoring already extracted helpers, polling, mock generation, model handlers, and
sub-state hooks into sibling modules. What remains is:

| Section | Lines | Description |
|---------|-------|-------------|
| Imports | 1–53 | 15 import groups |
| Props destructuring | 62–170 | **109 lines** of destructured props with defaults |
| State declarations | 172–208 | 14 `useState` calls |
| Sub-hook composition | 210–232 | `useVeo31State`, `useReveEditState` |
| Derived flags | 234–244 | `isSora2Selected`, `isVeo31Selected`, etc. |
| Effects | 254–319 | 5 `useEffect` hooks (timer, cleanup, parent notifications) |
| Stable callbacks | 321–333 | 3 `useCallback` wrappers for helpers |
| Polling setup | 335–350 | `useAIPolling` configuration |
| `handleMockGenerate` | 352–409 | Mock generation callback |
| **`handleGenerate`** | 411–883 | **470 lines** — main generation logic |
| `resetGenerationState` | 885–906 | State reset callback |
| `generationState` object | 908–922 | State aggregation |
| **Return value** | 924–1083 | **160 lines** — massive return object |
| Type export | 1085 | `UseAIGenerationReturn` type |

**Key insight**: Three problems drive the size:
1. `handleGenerate` at 470 lines — already delegates to route handlers but still assembles
   settings objects and processes responses inline
2. The return value is 160 lines — exposing too much internal state
3. Props destructuring is 109 lines — the hook accepts too many parameters

### Proposed Split

```text
apps/web/src/components/editor/media-panel/views/ai/hooks/
  use-ai-generation.ts              → Slim orchestrator: compose sub-hooks, return API (~280 lines)
  use-ai-generation-core.ts         → handleGenerate logic (~350 lines)
  use-ai-generation-state.ts        → State declarations + effects + reset (~180 lines)
  use-ai-generation-can-generate.ts → canGenerate computed logic (~100 lines)
  use-ai-generation-helpers.ts      → (EXISTING, keep as-is) (~583 lines)
  use-ai-mock-generation.ts         → (EXISTING, keep as-is) (~169 lines)
  use-ai-polling.ts                 → (EXISTING, keep as-is) (~226 lines)
```

### File Details

#### `use-ai-generation-state.ts` (~180 lines) — NEW
```text
Exports:
  useAIGenerationState(props) → AIGenerationInternalState

Contents:
  - All 14 useState declarations (current lines 173–208)
  - Sub-hook composition: useVeo31State, useReveEditState (current lines 210–232)
  - Derived flags: isSora2Selected, isVeo31Selected, etc. (current lines 234–244)
  - useAsyncMediaStoreActions hook (current lines 247–251)
  - All 5 useEffect hooks (current lines 254–319)
  - Stable callback wrappers: downloadVideoToMemory, uploadImageToFal, uploadAudioToFal (current lines 321–333)
  - Polling setup via useAIPolling (current lines 335–350)
  - resetGenerationState callback (current lines 886–906)
  - generationState aggregation object (current lines 908–922)
  - Types: AIGenerationInternalState (bundles all state + setters for internal use)
```

#### `use-ai-generation-core.ts` (~350 lines) — NEW
```text
Exports:
  useHandleGenerate(state, props) → () => Promise<void>

Contents:
  - The handleGenerate useCallback (current lines 411–883)
  - Settings assembly for text/image/upscale/avatar tabs
  - Sequential model loop with progress tracking
  - Response processing via processModelResponse
  - Error handling and cleanup
  - This is a single useCallback — extract as a custom hook that
    receives state/setters as parameters
```

#### `use-ai-generation-can-generate.ts` (~100 lines) — NEW
```text
Exports:
  useCanGenerate(props, state) → boolean

Contents:
  - The canGenerate computed value (current lines 957–1042)
  - Model-specific requirement checks per tab
  - Frame-to-video validation for Veo 3.1
  - Avatar model requirement matrix
  - Pure derivation from props + state
```

### Barrel Re-export Strategy

There is no barrel `index.ts` in the hooks directory. `use-ai-generation.ts` is imported
directly by consumers. The public API (`useAIGeneration` function and `UseAIGenerationReturn`
type) stays in `use-ai-generation.ts`. New modules are internal implementation details.

**No import changes needed for consumers.**

### Migration Steps

1. Create `use-ai-generation-can-generate.ts` — extract canGenerate as a custom hook
2. Create `use-ai-generation-state.ts` — extract all state, effects, and derived values
3. Create `use-ai-generation-core.ts` — extract handleGenerate as a custom hook
4. Refactor `use-ai-generation.ts` to compose: call sub-hooks, assemble return value
5. Verify: `bun check-types; bun run test`

### Pattern: Hook Composition

```typescript
// use-ai-generation.ts (after refactoring)
export function useAIGeneration(props: UseAIGenerationProps) {
  const state = useAIGenerationState(props);
  const handleGenerate = useHandleGenerate(state, props);
  const handleMockGenerate = useHandleMockGenerate(state, props);
  const canGenerate = useCanGenerate(props, state);

  return {
    ...state.publicState,
    handleGenerate,
    handleMockGenerate,
    canGenerate,
    // ... remaining return values
  };
}
```

### Estimated Result

| File | Before | After |
|------|--------|-------|
| `use-ai-generation.ts` | 1,085 | ~280 |
| `use-ai-generation-state.ts` | — | ~180 |
| `use-ai-generation-core.ts` | — | ~350 |
| `use-ai-generation-can-generate.ts` | — | ~100 |

---

## Summary

### Total Impact

| File | Before | After | New Files |
|------|--------|-------|-----------|
| `export-engine-cli.ts` | 1,128 | ~350 | 3 new + 1 extended |
| `timeline-store.ts` | 1,091 | ~350 | 4 new |
| `use-ai-generation.ts` | 1,085 | ~280 | 3 new |
| **Totals** | **3,304** | **~980** | **10 new files** |

All resulting files will be under the 800-line CLAUDE.md limit.

### Risk Assessment

| File | Risk | Reason |
|------|------|--------|
| `export-engine-cli.ts` | Medium | Class method extraction; private methods become module functions |
| `timeline-store.ts` | Medium-High | Zustand closure helpers require careful DI wiring |
| `use-ai-generation.ts` | Medium | React hook composition; dependency arrays must be preserved |

### Verification Checklist (per file)

1. `bun check-types` — no new TypeScript errors
2. `bun run test` — all existing tests pass
3. `bun lint:clean` — no lint violations in new files
4. Manual: Export flow works in `bun run electron:dev`
5. Manual: Timeline operations work (add/remove/save/load)
6. Manual: AI generation works (text-to-video, image-to-video)

### Implementation Order

1. **`use-ai-generation.ts`** — Lowest risk, pure hook composition, most tests
2. **`export-engine-cli.ts`** — Medium risk, class decomposition, integration tests
3. **`timeline-store.ts`** — Highest risk, Zustand closure wiring, core store
