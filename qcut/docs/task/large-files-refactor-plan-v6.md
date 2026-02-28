# Large Files Refactoring Plan v6 — Current Editor Hotspots

> Generated: 2026-02-28 | Continues from: large-files-refactor-plan-v5.md
> **STATUS: PENDING (REFRESHED WITH CURRENT CODEBASE STATE)**

---

## Reality Check (Why v6 Needed Refresh)

The prior `v6` draft targeted files that have already been reduced below the 800-line limit:

| File | Previous Size in Plan | Current Size (2026-02-28) |
|---|---:|---:|
| `apps/web/src/lib/export/export-engine-cli.ts` | 1,128 | 589 |
| `apps/web/src/stores/timeline/timeline-store.ts` | 1,091 | 209 |
| `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | 1,085 | 206 |

Those are now historical wins, not current priorities.

---

## Selection Criteria

This refreshed plan targets the largest remaining **runtime editor files** in `apps/web` (excluding tests) with clear extraction seams and strong impact on maintainability.

| # | File | Lines | Risk |
|---|---|---:|---|
| 1 | `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx` | 1,136 | High |
| 2 | `apps/web/src/components/editor/media-panel/views/ai/index.tsx` | 985 | Medium |
| 3 | `apps/web/src/components/editor/timeline/index.tsx` | 952 | Medium-High |

---

## 1. `drawing-canvas.tsx` (1,136 lines -> ~320 lines)

### Current Structure Analysis

| Section | Lines | Description |
|---|---|---|
| Imports + types | 1-59 | Component types + ref handle types |
| Canvas state + object hooks | 60-248 | Refs, modal state, stores, object hooks, history helpers |
| `useCanvasDrawing` wiring | 249-457 | Large callback bundle (`onDrawingStart`, `onCreateText`, `onMoveObject`, etc.) |
| Init effect | 460-563 | Canvas setup + background image setup |
| Text/image handlers | 566-769 | Text confirm/cancel, disabled restore flow, image upload |
| History sync effect | 772-835 | Undo/redo restoration with guard refs |
| Render effects | 838-980 | Foreground/background canvas rendering |
| Imperative handle | 983-1073 | Proxy-based `ref` API with group/image ops |
| JSX output | 1075-1134 | Layered canvas + modal |

### Key Problems

1. Too many responsibilities in one component (interaction orchestration, rendering, history, image upload, imperative API).
2. Heavy callback object passed to `useCanvasDrawing`, difficult to scan and test.
3. Mixed concerns between state mutation and rendering side effects.
4. Non-essential debug logging dominates many hot paths.

### Proposed Split

```text
apps/web/src/components/editor/draw/canvas/
  drawing-canvas.tsx                     -> UI composition + refs only (~320)
  use-drawing-canvas-interactions.ts     -> useCanvasDrawing callback wiring (~250)
  use-drawing-canvas-history.ts          -> save/restore guards + history sync (~180)
  use-drawing-canvas-rendering.ts        -> foreground/background render effects (~170)
  use-drawing-canvas-imperative.ts       -> ref proxy + exposed methods (~140)
  drawing-canvas-image-utils.ts          -> background fit + image upload helpers (~120)
```

### Migration Steps

1. Extract history logic (`isSavingToHistory`, `recentObjectCreation`, save/restore effect) into `use-drawing-canvas-history.ts`.
2. Extract render effects into `use-drawing-canvas-rendering.ts`.
3. Move image/background helpers into `drawing-canvas-image-utils.ts`.
4. Move imperative `ref` proxy creation into `use-drawing-canvas-imperative.ts`.
5. Keep `drawing-canvas.tsx` as orchestrator + JSX only.

### Tests

1. Add `drawing-canvas-history` unit tests (restore guard behavior, threshold behavior).
2. Add `drawing-canvas-image-utils` tests for aspect-ratio fitting.
3. Add integration test for imperative API contract (`handleImageUpload`, `handleCreateGroup`, `handleUngroup`).

---

## 2. `AiView` in `ai/index.tsx` (985 lines -> ~300 lines)

### Current Structure Analysis

| Section | Lines | Description |
|---|---|---|
| Imports | 1-74 | Large import surface across hooks/components/settings |
| Shared state + tab state wiring | 85-203 | Cross-tab local state and hook composition |
| Generation input assembly | 207-328 | Massive prop object passed to `useAIGeneration` |
| Panel/cost helpers | 330-377 | Layout flags + cost hook |
| Main JSX | 409-985 | Large render tree with tab-specific prop plumbing |

### Key Problems

1. `useAIGeneration` config assembly is too large and tightly coupled to local state shape.
2. JSX is long mostly due prop plumbing for tab components.
3. Cross-tab state and UI composition are mixed in one file.
4. Inline callback wrappers create noise and make behavior harder to scan.

### Proposed Split

```text
apps/web/src/components/editor/media-panel/views/ai/
  index.tsx                               -> shell composition + panel layout (~300)
  hooks/use-ai-view-state.ts              -> shared state + model defaulting (~180)
  hooks/use-ai-generation-config.ts       -> build useAIGeneration input object (~220)
  hooks/use-ai-tab-props.ts               -> map state to tab props (~220)
  components/ai-tabs-content.tsx          -> Tabs + tab content rendering (~220)
```

### Migration Steps

1. Extract local state and default-model tab switching into `use-ai-view-state.ts`.
2. Create `use-ai-generation-config.ts` to return a typed config object for `useAIGeneration`.
3. Create `use-ai-tab-props.ts` to centralize per-tab prop mapping.
4. Move the tab JSX block into `components/ai-tabs-content.tsx`.
5. Keep `index.tsx` focused on layout, history panel, and high-level orchestration.

### Tests

1. Add tests for `use-ai-generation-config` to ensure model settings map correctly.
2. Add tests for `use-ai-tab-props` to verify required props per tab.
3. Keep existing hook tests (`use-ai-generation-contract`, polling, panel effects) as regression suite.

---

## 3. `timeline/index.tsx` (952 lines -> ~320 lines)

### Current Structure Analysis

| Section | Lines | Description |
|---|---|---|
| Store selectors + refs + local state | 53-190 | Many selectors and refs in one component |
| Interaction handlers | 191-325 | Mouse tracking + click-to-seek rules |
| Sync effects | 327-413 | Duration sync and scroll sync listeners |
| Main JSX | 433-951 | Ruler, markers, labels, tracks, context menu, effects lane |

### Key Problems

1. Rendering and interaction logic are intertwined.
2. Ruler markers/time formatting are inlined in JSX IIFEs.
3. Scroll synchronization effect is large and not reusable.
4. Track row/context-menu rendering is mixed with container concerns.

### Proposed Split

```text
apps/web/src/components/editor/timeline/
  index.tsx                               -> compose timeline subcomponents (~320)
  hooks/use-timeline-click-seek.ts        -> mouse tracking + seek decision logic (~170)
  hooks/use-timeline-scroll-sync.ts       -> horizontal/vertical scroll sync (~140)
  timeline-ruler.tsx                      -> ruler, time markers, bookmarks, filter markers (~220)
  timeline-track-labels.tsx               -> left track label column (~120)
  timeline-track-layers.tsx               -> track content rows + context menus (~220)
```

### Migration Steps

1. Move click classification and seek calculation to `use-timeline-click-seek.ts`.
2. Move scroll sync listener effect to `use-timeline-scroll-sync.ts`.
3. Extract ruler rendering (time markers/bookmarks/AI markers) to `timeline-ruler.tsx`.
4. Extract track labels and track layers into separate components.
5. Keep `index.tsx` as orchestration shell.

### Tests

1. Add unit tests for click-to-seek behavior (drag vs click thresholds).
2. Add tests for scroll-sync hook attach/cleanup behavior.
3. Add focused render tests for ruler marker visibility and formatting.

---

## Summary

### Total Impact (Target)

| File | Before | After | New Files |
|---|---:|---:|---:|
| `drawing-canvas.tsx` | 1,136 | ~320 | 5 |
| `ai/index.tsx` | 985 | ~300 | 4 |
| `timeline/index.tsx` | 952 | ~320 | 5 |
| **Totals** | **3,073** | **~940** | **14** |

### Risk Assessment

| File | Risk | Why |
|---|---|---|
| `drawing-canvas.tsx` | High | Multi-canvas rendering + imperative API contract + history behavior |
| `ai/index.tsx` | Medium | Mostly prop wiring and composition, lower algorithmic risk |
| `timeline/index.tsx` | Medium-High | Dense interaction logic + synchronized scrolling + playback coupling |

### Verification Checklist (Per Refactor)

1. `bun check-types`
2. `bunx vitest run` targeted suites for modified modules
3. `bunx eslint <changed files>`
4. Manual editor checks:
   - Draw: create/select/move/group/undo-redo/image upload
   - AI: tab switching, validation states, generation dispatch
   - Timeline: seek, selection box, scrolling sync, context menu mute

### Implementation Order

1. `ai/index.tsx` (lowest risk)
2. `timeline/index.tsx` (medium-high risk)
3. `drawing-canvas.tsx` (highest risk)

---

## Notes

- Keep extraction boundaries behavior-preserving first; avoid functional changes in the same PR.
- Prefer pure helpers for mapping/derivation logic.
- Ensure all extracted async paths preserve existing error handling (`try/catch` + existing logger utilities).
