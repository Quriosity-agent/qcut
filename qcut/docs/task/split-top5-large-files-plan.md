# Implementation Plan: Split Top 5 Largest Files

**Generated:** 2026-02-09
**Goal:** Split each file into 2 files to improve maintainability. Maximize code reuse — no logic changes, only reorganization.

---

## Overview

| # | File | Lines | Split Into |
|---|------|------:|------------|
| 1 | `use-ai-generation.ts` | 1695 | `use-ai-generation.ts` + `use-ai-generation-actions.ts` |
| 2 | `model-handlers.ts` | 1676 | `model-handlers-core.ts` + `model-handlers-extended.ts` |
| 3 | `timeline-store.ts` | 1660 | `timeline-store.ts` + `timeline-store-operations.ts` |
| 4 | `electron/preload.ts` | 1517 | `preload.ts` + `preload-integrations.ts` |
| 5 | `timeline/index.tsx` | 1485 | `timeline/index.tsx` + `timeline/timeline-toolbar.tsx` |

---

## 1. `use-ai-generation.ts` (1695 lines)

**Path:** `apps/web/src/components/editor/media-panel/views/ai/hooks/`

### File A: `use-ai-generation.ts` (~850 lines)

Keep the main hook shell with initialization, state, effects, and network helpers:

- Imports and constants
- `getSafeDuration()` utility
- Hook declaration + all `useState`/`useRef`/`useCallback` setup
- Side effects (elapsed timer, polling cleanup, job ID change, progress aggregation)
- `downloadVideoToMemory()`, `uploadImageToFal()`, `uploadAudioToFal()`
- `startStatusPolling()`
- `handleMockGenerate()`
- `handleGenerate()` — **first half** up to API call dispatch (~lines 784–1040)
- Import and call helpers from File B for the return object assembly

### File B: `use-ai-generation-actions.ts` (~845 lines)

Extract the response-handling and state-management portion:

- `handleGenerate()` **continuation** — response processing, media store integration, completion
- `resetGenerationState()`
- Veo 3.1 setters: `setVeo31Resolution()`, `setVeo31Duration()`, `setVeo31AspectRatio()`, `setVeo31GenerateAudio()`, `setVeo31EnhancePrompt()`, `setVeo31AutoFix()`
- Reve Edit helpers: `clearUploadedImageForEdit()`, `handleImageUploadForEdit()`
- `generationState` object builder
- `canGenerate` computed value logic
- Hook return object assembly

### Dependencies

- **B → A:** Needs state refs and setters passed as parameters or via a shared context object
- **Strategy:** File A creates a `GenerationContext` object holding all state/refs, passes it to functions exported from File B. No circular imports.

### Reuse Notes

- Zero logic changes — only moving function bodies
- The `GenerationContext` parameter replaces closure-captured state variables

---

## 2. `model-handlers.ts` (1676 lines)

**Path:** `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/`

### File A: `model-handlers-core.ts` (~900 lines)

Core types and primary generation handlers:

- All type definitions: `ModelHandlerContext`, `TextToVideoSettings`, `ImageToVideoSettings`, `AvatarSettings`, `UpscaleSettings`, `ModelHandlerResult`
- Type coercion helpers
- **All 7 Text-to-Video handlers:** `handleVeo31FastT2V`, `handleVeo31T2V`, `handleHailuo23T2V`, `handleLTXV2ProT2V`, `handleLTXV2FastT2V`, `handleViduQ3T2V`, `handleGenericT2V`
- **First 11 Image-to-Video handlers** (through `handleKlingV25I2V`): Veo, Vidu, LTX, Seedance, Kling v2.5 variants
- `routeTextToVideoHandler()` — only dispatches to handlers in this file

### File B: `model-handlers-extended.ts` (~776 lines)

Extended model handlers and remaining routers:

- **Remaining 5 I2V handlers:** `handleKlingV26I2V`, `handleWAN25I2V`, `handleWAN26I2V`, `handleViduQ3I2V`, `handleWAN26T2V`, `handleGenericI2V`
- **2 Upscale handlers:** `handleByteDanceUpscale`, `handleFlashVSRUpscale`
- **8 Avatar handlers:** `handleKlingO1Ref2Video`, `handleWAN26Ref2Video`, `handleKlingO1V2V`, `handleKlingAvatarV2`, `handleGenericAvatar`, `handleSyncLipsyncReact1`, `handleVeo31FastExtendVideo`, `handleVeo31ExtendVideo`
- `VEO31_FRAME_MODELS` constant
- `routeImageToVideoHandler()` — imports core I2V handlers from File A
- `routeUpscaleHandler()`
- `routeAvatarHandler()`

### Dependencies

- **B → A:** Import types (`ModelHandlerContext`, `ModelHandlerResult`, settings interfaces) and some I2V handlers for router
- **A → B:** None. One-directional dependency.

### Reuse Notes

- Every handler follows the identical pattern (accept context + settings, call FAL, return result) — no structural changes needed
- Router functions use a switch-case; just add imports for handlers that moved

---

## 3. `timeline-store.ts` (1660 lines)

**Path:** `apps/web/src/stores/`

### File A: `timeline-store.ts` (~990 lines)

Core store definition with foundational operations:

- Store creation (`create<TimelineState>()`)
- State properties and initialization
- Auto-save helpers (`updateTracksAndSave`, `debouncedSave`)
- `pushHistory()`, `undo()`
- Selection management: `selectElement()`, `deselectElement()`, `clearSelectedElements()`, `setSelectedElements()`
- Track operations: `addTrack()`, `insertTrackAt()`, `removeTrack()`, `removeTrackWithRipple()`
- Element CRUD: `addElementToTrack()`, `removeElementFromTrack()`, `removeElementFromTrackWithRipple()`
- Element positioning: `moveElementToTrack()`, `updateElementTrim()`, `updateElementDuration()`, `updateElementStartTime()`, `updateElementStartTimeWithRipple()`
- Element property updates: `updateTextElement()`, `updateElementTransform()`, `updateElementPosition()`, `updateElementSize()`, `updateElementRotation()`, `updateMediaElement()`, `updateRemotionElement()`

### File B: `timeline-store-operations.ts` (~670 lines)

Advanced operations and utilities, injected into the store via a `spread` pattern:

- Element splitting: `splitElement()`, `splitAndKeepLeft()`, `splitAndKeepRight()`
- Audio: `getAudioElements()`, `separateAudio()`
- Media replacement: `replaceElementMedia()`
- Queries: `getTotalDuration()`, `getProjectThumbnail()`
- `redo()`
- Drag state: `setDragState()`, `startDrag()`, `updateDragTime()`, `endDrag()`
- Persistence: `loadProjectTimeline()`, `saveProjectTimeline()`, `saveImmediate()`, `clearTimeline()`, `restoreTracks()`
- Feature toggles: `toggleSnapping()`, `toggleRippleEditing()`, `toggleEffectsTrack()`, `autoShowEffectsTrack()`
- Helpers: `checkElementOverlap()`, `findOrCreateTrack()`
- Convenience add methods: `addMediaAtTime()`, `addTextAtTime()`, `addMediaToNewTrack()`, `addTextToNewTrack()`
- Effects: `addEffectToElement()`, `removeEffectFromElement()`, `getElementEffectIds()`, `clearElementEffects()`

### Dependencies

- **B → A:** Functions in B need `get()` and `set()` from the store, plus `pushHistory()` and auto-save helpers
- **Strategy:** Export operation functions from B that accept `(get, set)` parameters (Zustand slice pattern). File A composes both slices into the final store. Existing consumers import from `timeline-store.ts` unchanged.

### Reuse Notes

- All existing `useTimelineStore()` imports remain unchanged — File A re-exports everything
- Zustand slice pattern is idiomatic and already used in the codebase (`media-store.ts`)

---

## 4. `electron/preload.ts` (1517 lines)

**Path:** `electron/`

### File A: `preload.ts` (~800 lines)

Core editor and media operations:

- All type/interface definitions (lines 21–296)
- `contextBridge.exposeInMainWorld` call (wrapper)
- **API groups:** system, fileIO, storage, theme, sounds, audio, video, transcription, ffmpeg, apiKeys, shell, github, falAI, geminiChat, aiPipeline, mediaImport
- Global type exports and Window augmentation

### File B: `preload-integrations.ts` (~717 lines)

Developer tools and integration features:

- **API groups:** ptyTerminal, skills, projectFolder, claude (media, timeline, project, export, diagnostics), remotion, updates
- Helper function for building these API objects

### Dependencies

- **A → B:** File A calls a builder function from B to get the integration API objects, then spreads them into the `electronAPI` object
- **B → A:** Import shared types/interfaces from A
- **Strategy:** File B exports a function `buildIntegrationAPIs()` returning the API object fragments. File A calls it inside `contextBridge.exposeInMainWorld`.

### Reuse Notes

- All IPC patterns (`ipcRenderer.invoke`, `ipcRenderer.on`) are identical — no structural changes
- Type definitions stay in File A since they're already co-located with the `Window` augmentation
- Renderer-side imports (`window.electronAPI.*`) are unaffected — the exposed API shape is identical

---

## 5. `timeline/index.tsx` (1485 lines)

**Path:** `apps/web/src/components/editor/timeline/`

### File A: `timeline/index.tsx` (~900 lines)

Main timeline component with ruler and tracks:

- All imports
- `Timeline` component: state, hooks, layout calculations
- Scroll synchronization logic
- Drag & drop handlers
- Ruler / time display section (time markers, bookmarks, deleted word indicators)
- Tracks area (labels sidebar, track containers, `EffectsTimeline` integration)
- Import and render `<TimelineToolbar />` from File B

### File B: `timeline/timeline-toolbar.tsx` (~585 lines)

Toolbar extracted as a standalone component:

- `TimelineToolbar` component (currently lines 1106–1584)
- `TrackIcon` helper component (currently lines 1087–1104)
- Store selectors and action handlers (playback controls, zoom, add track/text/effects)
- All toolbar JSX: left section (playback + editing tools), center (time display), right (zoom controls)

### Dependencies

- **A → B:** `<TimelineToolbar />` rendered as child in the timeline layout
- **B → A:** None. Toolbar reads all state from Zustand stores directly.
- **Props:** Minimal — only `timelineRef` (for scroll-to-playhead) if needed, otherwise fully self-contained via store hooks.

### Reuse Notes

- `TimelineToolbar` already functions as an independent sub-component — it has its own store selectors and handlers
- `TrackIcon` is only used within the toolbar area, so it moves with it
- No prop drilling needed — both components read from `useTimelineStore` and `usePlaybackStore` independently

---

## Migration Checklist (per file)

1. Create the new file (File B)
2. Move the designated code blocks into File B
3. Add necessary imports in File B (types, shared utilities)
4. In File A, add imports from File B and wire them in (re-export, compose, or render)
5. Update any external imports if the export location changed (search with `grep`)
6. Run `bun check-types` to verify no type errors
7. Run `bun run test` to verify no regressions
8. Run `bunx @biomejs/biome check --skip-parse-errors` on both files
9. Verify `bun run electron:dev` launches correctly

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Circular imports | All splits are one-directional (B → A for types only) |
| Broken imports from consumers | File A re-exports everything from B; external imports unchanged |
| Zustand store split breaks reactivity | Use slice pattern — store object remains single instance |
| Preload API shape changes | Builder pattern keeps `electronAPI` shape identical |
| Component prop drilling | Toolbar already uses store hooks; no new props needed |
