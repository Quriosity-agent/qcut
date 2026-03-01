# Consolidated Refactor Plan — Remaining 7 Files Over 800 Lines

> Generated: 2026-03-01 | Branch: `refactor/remaining-7-files`
> Continues from: `large-files-refactor-plan-v6.md` (which covers drawing-canvas, ai/index, timeline/index)
> Rule: CLAUDE.md — "No code file longer than 800 lines"

---

## Current File Sizes (verified 2026-03-01)

| # | File | Lines | Area | Risk |
|---|------|------:|------|------|
| 1 | `electron/preload-integrations.ts` | 966 | Electron | Low |
| 2 | `electron/utility/utility-bridge.ts` | 958 | Electron | Medium |
| 3 | `apps/web/src/stores/moyin/moyin-store.ts` | 901 | Store | Medium |
| 4 | `apps/web/src/lib/claude-bridge/claude-timeline-bridge-helpers.ts` | 861 | Lib | Low |
| 5 | `apps/web/src/stores/ai/effects-store.ts` | 852 | Store | Low |
| 6 | `apps/web/src/components/editor/draw/hooks/use-canvas-objects.ts` | 829 | Hook | Medium |
| 7 | `apps/web/src/components/editor/media-panel/views/captions.tsx` | 804 | Component | Low |

**Total: 6,171 lines across 7 files**

---

## Implementation Order

Ordered by: risk (lowest first), dependencies (leaf files first), effort.

### Phase 1 — Low-risk extractions (no runtime behavior change)

#### 1.1 `effects-store.ts` (852 → ~370 + ~490)

**Problem**: 434 lines of static preset data precede the store logic. The store itself is clean.

**Split**:
```
stores/ai/
  effects-store.ts          → store logic only (~370)
  effects-presets.ts         → EFFECT_PRESETS array + mergeFFmpegEffectParameters() (~490)
```

**Steps**:
1. Move `EFFECT_PRESETS` array (lines 89–434) and `mergeFFmpegEffectParameters` helper (lines 26–86) into `effects-presets.ts`.
2. Import `EFFECT_PRESETS` and `mergeFFmpegEffectParameters` in `effects-store.ts`.
3. Re-export `EFFECT_PRESETS` from `effects-store.ts` if any external consumer imports it directly.

**Effort**: ~15 min | **Risk**: Low — pure data extraction, no logic change.

---

#### 1.2 `preload-integrations.ts` (966 → ~310 + ~350 + ~310)

**Problem**: 13 API builder functions in one file. The `createClaudeAPI()` function alone is ~650 lines. Each builder is already self-contained with no shared state.

**Split**:
```
electron/
  preload-integrations.ts           → createPtyAPI, createMcpAPI, createSkillsAPI,
                                      createAIPipelineAPI, createMediaImportAPI,
                                      createProjectFolderAPI, createRemotionFolderAPI,
                                      createMoyinAPI, createUpdatesAPI (~310)
  preload-integrations-claude.ts    → createClaudeAPI() with media, timeline,
                                      transaction, project, export, diagnostics,
                                      analyze, events, notifications (~350)
  preload-integrations-claude-ext.ts → createClaudeAPI() continued: navigator,
                                      screenRecordingBridge, ui, state,
                                      projectCrud (~310)
```

**Alternative** (simpler, preferred): Keep `createClaudeAPI` in one file but split it internally:
```
electron/
  preload-integrations.ts           → non-Claude API builders (~310)
  preload-integrations-claude.ts    → createClaudeAPI() entire function (~660)
```

**Steps**:
1. Move `createClaudeAPI()` (lines 192–845) into `preload-integrations-claude.ts`.
2. Move its type imports alongside it.
3. Import and re-export from `preload-integrations.ts`.
4. Update `preload.ts` to import from both files (or keep single entry via re-export).

**Effort**: ~20 min | **Risk**: Low — each function is a standalone factory, no shared mutable state.

---

#### 1.3 `claude-timeline-bridge-helpers.ts` (861 → ~380 + ~490)

**Problem**: File is already an extraction from `claude-timeline-bridge.ts`. It mixes element-resolution helpers with Remotion import logic (bundling, folder import). These are separate concerns.

**Split**:
```
lib/claude-bridge/
  claude-timeline-bridge-helpers.ts      → element resolution, formatting, media sync,
                                           addClaudeMediaElement, addClaudeTextElement,
                                           addClaudeMarkdownElement, formatTracksForExport,
                                           applyTimelineToStore (~380)
  claude-timeline-bridge-remotion.ts     → bundleAndRegisterComponent(),
                                           importRemotionFolder(),
                                           addClaudeRemotionElement() (~200)
```

Wait — that only gets us to ~580 + ~280. The file is 861, so the main file stays under 800 regardless. Let me re-measure the actual split points.

Actually, the cleaner split by concern:
```
lib/claude-bridge/
  claude-timeline-bridge-helpers.ts      → element add functions + media resolution (~460)
  claude-timeline-bridge-format.ts       → formatTracksForExport, formatElementForExport,
                                           calculateTimelineDuration, getEffectiveDuration,
                                           findTrackByElementId, isClaudeMediaElementType (~180)
  claude-timeline-bridge-remotion.ts     → bundleAndRegisterComponent, importRemotionFolder,
                                           addClaudeRemotionElement (~200)
```

**Steps**:
1. Extract pure formatting/query helpers (lines 37–86, 709–786) into `claude-timeline-bridge-format.ts`.
2. Extract Remotion functions (lines 462–703) into `claude-timeline-bridge-remotion.ts`.
3. Import Remotion adder into helpers for `applyTimelineToStore`.
4. Re-export format functions from helpers if needed by existing consumers.

**Effort**: ~25 min | **Risk**: Low — functions are stateless utilities.

---

### Phase 2 — Medium-risk store/hook extractions

#### 2.1 `moyin-store.ts` (901 → ~420 + ~490)

**Problem**: Large Zustand store with 60+ actions. The `parseScript` action alone is 140 lines. Actions are already delegated to external modules (`moyin-generation.ts`, `moyin-calibration.ts`, etc.), but the store file still orchestrates them all.

**Split**:
```
stores/moyin/
  moyin-store.ts                 → state types, initialState, simple setters,
                                   CRUD actions, selection, undo/redo, persistence (~420)
  moyin-store-media.ts           → generateShotImage, generateShotVideo,
                                   generateEndFrameImage, generateShotsForEpisode (~200)
  moyin-store-pipeline.ts        → parseScript (pipeline orchestration),
                                   generateScript, enhanceCharacters, enhanceScenes,
                                   analyzeCharacterStages, generateStoryboard,
                                   splitAndApplyStoryboard (~290)
```

**Steps**:
1. Extract media generation actions (lines 534–635) into `moyin-store-media.ts` as factory functions that accept `(set, get, patchShot)`.
2. Extract pipeline/calibration actions (lines 275–414, 421–444, 728–846) into `moyin-store-pipeline.ts`.
3. Both files export action creators that are spread into the main store.
4. Keep types, state, simple setters, CRUD, selection, undo/redo, persistence in `moyin-store.ts`.

**Pattern**: Follow the same pattern as existing `moyin-generation.ts` — pure functions called from the store.

**Effort**: ~30 min | **Risk**: Medium — action factories must preserve closure over `set`/`get`.

---

#### 2.2 `use-canvas-objects.ts` (829 → ~380 + ~280 + ~180)

**Problem**: Hook combines type definitions, object CRUD, drag/selection logic, and canvas rendering in one file. Heavy debug logging inflates line count.

**Split**:
```
components/editor/draw/hooks/
  use-canvas-objects.ts              → types, state, addStroke, addShape, addText,
                                       addImageObject, selectObjects,
                                       getObjectAtPosition, groups, clearAll,
                                       deleteSelectedObjects (~380)
  canvas-object-types.ts             → CanvasObject, StrokeObject, ShapeObject,
                                       TextObject, ImageObject, AnyCanvasObject,
                                       ObjectGroup type definitions (~70)
  use-canvas-drag.ts                 → startDrag, updateDrag, endDrag,
                                       dragState ref management (~180)
  canvas-object-renderer.ts          → renderObjects function (extracted as
                                       standalone utility, receives objects array) (~200)
```

**Steps**:
1. Extract type definitions (lines 5–71) into `canvas-object-types.ts`.
2. Extract drag logic (lines 506–624) into `use-canvas-drag.ts` as a sub-hook that takes `selectedObjectIds` and `setObjects`.
3. Extract `renderObjects` (lines 635–802) into `canvas-object-renderer.ts` as a pure function.
4. Import all three back into `use-canvas-objects.ts`.

**Effort**: ~30 min | **Risk**: Medium — drag state refs shared between hooks need careful wiring.

---

#### 2.3 `captions.tsx` (804 → ~350 + ~460)

**Problem**: Component mixes transcription logic (file validation, Gemini API calls, error handling, caching) with UI rendering. The `startTranscription` callback alone is 340 lines (half of which is deprecated comments that should be deleted).

**Split**:
```
components/editor/media-panel/views/
  captions.tsx                       → UI rendering, layout, drag-drop, state display (~350)
  hooks/use-captions-transcription.ts → startTranscription, handleFileSelect,
                                        stopTranscription, getCachedTranscription,
                                        addCaptionsToTimeline, TranscriptionState (~460)
```

**Pre-step**: Delete ~100 lines of deprecated/commented-out Modal Whisper/R2 code (lines 282–358). This alone may bring the file under 800.

**Steps**:
1. Remove deprecated commented-out code blocks (R2 upload, encryption, Modal Whisper).
2. If still over 800: extract transcription logic into `use-captions-transcription.ts`.
3. The hook returns `{ state, handleFileSelect, stopTranscription, addCaptionsToTimeline }`.
4. `captions.tsx` becomes a pure UI shell.

**Effort**: ~25 min | **Risk**: Low — clean hook extraction boundary.

---

### Phase 3 — Largest file, most complex

#### 3.1 `utility-bridge.ts` (958 → ~420 + ~350 + ~200)

**Problem**: Single file manages utility process lifecycle, PTY session proxy, heartbeat monitoring, message queuing, crash recovery, and a large `handleMainRequest` switch (230 lines, 30+ cases).

**Split**:
```
electron/utility/
  utility-bridge.ts                  → startUtilityProcess, stopUtilityProcess,
                                       cleanupUtilityProcess, message handler,
                                       crash recovery, exports (~420)
  utility-bridge-main-request.ts     → handleMainRequest switch statement (~350)
  utility-bridge-pty.ts              → setupUtilityPtyIPC, respawnSessions,
                                       session registry, PTY spawn/write/resize/kill (~200)
```

**Steps**:
1. Extract `handleMainRequest` (lines 308–541) into `utility-bridge-main-request.ts`.
2. Extract PTY IPC setup (lines 812–943) and session management (lines 544–623) into `utility-bridge-pty.ts`.
3. Share `sendToUtility`, `sessionRegistry`, `sessionToWebContentsId` via module-level exports or pass as parameters.
4. Keep lifecycle (start/stop/cleanup), heartbeat, and message queue in `utility-bridge.ts`.

**Effort**: ~35 min | **Risk**: Medium — shared mutable state (`utilityChild`, `sessionRegistry`) requires careful module boundary design. Consider exporting getter functions instead of raw references.

---

## Summary

### Total Impact

| File | Before | After (main) | New Files |
|------|-------:|-------------:|----------:|
| `effects-store.ts` | 852 | ~370 | 1 |
| `preload-integrations.ts` | 966 | ~310 | 1 |
| `claude-timeline-bridge-helpers.ts` | 861 | ~460 | 2 |
| `moyin-store.ts` | 901 | ~420 | 2 |
| `use-canvas-objects.ts` | 829 | ~380 | 3 |
| `captions.tsx` | 804 | ~350 | 1 |
| `utility-bridge.ts` | 958 | ~420 | 2 |
| **Totals** | **6,171** | **~2,710** | **12** |

### Estimated Effort

| Phase | Files | Time |
|-------|-------|------|
| Phase 1 (Low-risk) | effects-store, preload-integrations, bridge-helpers | ~60 min |
| Phase 2 (Medium-risk) | moyin-store, use-canvas-objects, captions | ~85 min |
| Phase 3 (Complex) | utility-bridge | ~35 min |
| **Total** | **7 files** | **~3 hours** |

### Dependencies Between Files

None of the 7 files depend on each other — they can be refactored in any order or in parallel. The ordering above is purely by risk level.

### Cross-cutting Concerns

- **captions.tsx**: Delete ~100 lines of dead commented-out code first. May drop below 800 without any extraction.
- **use-canvas-objects.ts**: Heavy debug logging (~50 lines) could be removed or moved behind a debug flag to further reduce size.
- **effects-store.ts**: Many preset entries have `isImplemented: false`. These could be moved to a separate "planned presets" file, but that's a product decision, not a refactor concern.

---

## Verification Checklist (Per Refactor)

1. `bun check-types` — no new type errors
2. `bun run test` — all existing tests pass
3. `bun lint:clean` — no new lint warnings on changed files
4. Manual spot-check in `bun run electron:dev`:
   - **effects-store**: Apply/remove effects on a timeline element
   - **preload-integrations**: Claude terminal, MCP, media import all functional
   - **bridge-helpers**: Import/export Claude timeline, add media/text/remotion elements
   - **moyin-store**: Parse script, generate shots, undo/redo
   - **use-canvas-objects**: Draw strokes/shapes, select/drag, group/ungroup
   - **captions**: Upload audio, transcribe with Gemini, add to timeline
   - **utility-bridge**: PTY spawn, heartbeat, crash recovery

---

## PR Strategy

- One PR per phase (3 PRs), or one PR per file (7 PRs) for easier review.
- Recommended: **One PR per file** with the commit message format:
  ```
  refactor: extract <module> from <file> to stay under 800 lines
  ```
- Each PR should be independently mergeable with no cross-dependencies.
