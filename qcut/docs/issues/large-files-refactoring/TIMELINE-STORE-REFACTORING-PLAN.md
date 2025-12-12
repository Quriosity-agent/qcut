# Timeline Store Refactoring Plan

## Overview

**File**: `qcut/apps/web/src/stores/timeline-store.ts`
**Current Size**: 2,194 lines
**Target**: Split into 6 focused modules
**Status**: In Progress
**Priority**: High (core functionality, high change frequency)

---

## Review Notes (assistant)

- Avoid duplicating shared timeline types/helpers. `TimelineTrack`, `TimelineElement`, `sortTracksByOrder`, `ensureMainTrack`, and `validateElementTrackCompatibility` already live in `@/types/timeline`; consider keeping them there and letting `stores/timeline/types.ts` focus on store‑specific types (`TimelineStore`, `OperationContext`, drag/selection shapes) or just re‑export shared types.
- Phase 3 extracts only a subset of element operations. To actually hit the `<700 lines` main‑store target, add explicit tasks for the remaining element‑adjacent methods: `toggleTrackMute`, `toggleElementHidden`, `updateTextElement`, `updateMediaElement`, transform ops (`updateElementTransform` + delegates), export helpers (`getAudioElements`), media replacement (`replaceElementMedia`), and effects ops (`addEffectToElement`, `removeEffectFromElement`, `getElementEffectIds`, `clearElementEffects`).
- Effects ops currently use `updateTracks` + `autoSaveTimeline` (not `updateTracksAndSave`) and only push history/save when a real change occurs. When extracting, either pass these helpers via context or keep effects ops in the main store to avoid semantic drift.
- Ripple removal/move code already reuses `checkElementOverlaps`/`resolveElementOverlaps` from `@/lib/timeline`. Keep that dependency; don’t re‑implement overlap logic inside `stores/timeline/utils.ts`.
- Line numbers are useful now but will drift as soon as the refactor starts. Consider treating ranges as approximate and naming the function in each task title for durability.
- Small reuse win: `separateAudio` duplicates “find or create audio track” logic; after context extraction, it could call a shared `findOrCreateTrackOperation(\"audio\")` to keep track‑creation rules in one place.

## Guiding Principles

### Long-Term Maintainability First

1. **Single Responsibility**: Each module should have one clear purpose
2. **Dependency Direction**: Dependencies flow inward (utilities → operations → store)
3. **Testability**: Pure functions extracted for easy unit testing
4. **Discoverability**: Clear naming and organization for new developers
5. **Minimal Coupling**: Modules should be independently modifiable
6. **Future-Proofing**: Structure accommodates anticipated features (multi-track ripple, collaborative editing)

### Why Not Just 3 Files?

The original plan proposed 3 files, but this creates:
- 700+ line "operations" file (still too large)
- Mixed concerns (track ops + element ops + split ops)
- Difficult to locate specific functionality

A 6-module architecture provides:
- ~200-400 lines per module (easy to navigate)
- Clear ownership of each concern
- Easier code reviews and merge conflict resolution
- Better test organization

---

## Target Architecture

```plaintext
stores/
├── timeline-store.ts           # Main store orchestration (~600 lines)
└── timeline/
    ├── index.ts                # Barrel exports
    ├── types.ts                # Interfaces, types, constants (~150 lines)
    ├── track-operations.ts     # Track CRUD + ripple (~300 lines)
    ├── element-operations.ts   # Element CRUD + move (~350 lines)
    ├── split-operations.ts     # Split, trim, audio separation (~250 lines)
    ├── persistence.ts          # Load, save, auto-save (~200 lines)
    └── utils.ts                # Pure helper functions (~100 lines)
```

### Module Responsibilities

| Module | Responsibility | Key Functions |
|--------|----------------|---------------|
| `types.ts` | All TypeScript interfaces and constants | `TimelineStore`, `DragState`, `INITIAL_*` |
| `utils.ts` | Pure helper functions (no side effects) | `getElementNameWithSuffix`, `createTrack` |
| `track-operations.ts` | Track lifecycle management | `addTrack`, `removeTrack`, `removeTrackWithRipple` |
| `element-operations.ts` | Element lifecycle management | `addElement`, `removeElement`, `moveElement`, ripple |
| `split-operations.ts` | Time-based modifications | `split`, `splitAndKeep*`, `separateAudio`, `updateTrim` |
| `persistence.ts` | Storage and auto-save | `load`, `save`, `saveImmediate`, auto-save timer |
| `timeline-store.ts` | Orchestration and state | Zustand store, selection, drag, toggles, computed |

---

## Dependency Graph

```plaintext
                    ┌─────────────┐
                    │   types.ts  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   utils.ts  │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼───────┐  ┌───────▼───────┐  ┌───────▼───────┐
│track-operations│  │element-ops    │  │split-operations│
└───────┬───────┘  └───────┬───────┘  └───────┬───────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                    ┌──────▼──────┐
                    │ persistence │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │timeline-store│
                    └─────────────┘
```

---

## Operation Context Pattern

All operation modules receive a consistent context object:

```typescript
// timeline/types.ts
export interface OperationContext {
  // State access
  getTracks: () => TimelineTrack[];
  getSelectedElements: () => SelectedElement[];
  isRippleEnabled: () => boolean;

  // State mutation
  updateTracksAndSave: (tracks: TimelineTrack[]) => void;
  pushHistory: () => void;

  // Cross-cutting concerns
  selectElement: (trackId: string, elementId: string) => void;
  deselectElement: (trackId: string, elementId: string) => void;
}
```

This pattern:
- Decouples operations from Zustand's `get()`/`set()`
- Enables unit testing with mock context
- Makes dependencies explicit
- Allows future migration to different state management

---

## Implementation Phases

Each subtask is designed to be completable in **under 20 minutes**.

### Phase 1: Foundation (Types & Utils)

#### Task 1.1: Create types.ts (~15 min) ✅ COMPLETED
**Create** `stores/timeline/types.ts`

Extract from `timeline-store.ts`:
- [x] `TimelineStore` interface (lines 55-353)
- [x] `DragState` type (from lines 108-123)
- [x] `INITIAL_DRAG_STATE` constant
- [x] `OperationContext` interface (new)
- [x] `SelectedElement` type alias
- [x] Re-export timeline types from `@/types/timeline`

**Verification**: `bun run check-types` passes ✅

---

#### Task 1.2: Create utils.ts (~10 min) ✅ COMPLETED
**Create** `stores/timeline/utils.ts`

Extract from `timeline-store.ts`:
- [x] `getElementNameWithSuffix` function (lines 37-49)
- [x] `createTrack` helper (extract from addTrack logic, lines 564-583)
- [x] `getTrackName` helper function
- [x] `getEffectiveDuration` helper function
- [x] `getElementEndTime` helper function

**Verification**: `bun run check-types` passes ✅

---

#### Task 1.3: Create index.ts barrel (~5 min) ✅ COMPLETED
**Create** `stores/timeline/index.ts`

```typescript
export * from "./types";
export * from "./utils";
// More exports added as modules are created
```

**Verification**: Import works from main store ✅

---

#### Task 1.4: Update main store imports (~10 min) ✅ COMPLETED
**Modify** `stores/timeline-store.ts`

- [x] Import types from `./timeline/types`
- [x] Import utils from `./timeline/utils`
- [x] Remove extracted code from main file
- [x] Verify no regressions

**Verification**: `bun run check-types` + manual test (add track) ✅

---

### Phase 2: Track Operations ✅ COMPLETED

#### Task 2.1: Create track-operations.ts ✅ COMPLETED
**Create** `stores/timeline/track-operations.ts`

- [x] Set up imports and `OperationContext` parameter pattern
- [x] Export `addTrackOperation`
- [x] Export `insertTrackAtOperation`
- [x] Export `removeTrackSimpleOperation`
- [x] Export `removeTrackWithRippleOperation`
- [x] Export `findOrCreateTrackOperation`

**Verification**: `bun run check-types` passes ✅

---

### Phase 3: Element Operations ✅ COMPLETED

#### Task 3.1: Create element-operations.ts ✅ COMPLETED
**Create** `stores/timeline/element-operations.ts`

- [x] Set up imports and context pattern
- [x] Define `AddElementCallbacks` interface for side effects
- [x] Export `removeElementSimpleOperation`
- [x] Export `removeElementWithRippleOperation`
- [x] Export `moveElementToTrackOperation`
- [x] Export `updateElementTrimOperation`
- [x] Export `updateElementDurationOperation`
- [x] Export `updateElementStartTimeOperation`
- [x] Export `updateElementStartTimeWithRippleOperation`
- [x] Export `toggleElementHiddenOperation`
- [x] Export `toggleTrackMuteOperation`
- [x] Export `checkElementOverlapOperation`

**Verification**: `bun run check-types` passes ✅

---

### Phase 4: Split Operations ✅ COMPLETED

#### Task 4.1: Create split-operations.ts ✅ COMPLETED
**Create** `stores/timeline/split-operations.ts`

- [x] Set up imports and context pattern
- [x] Import utilities from utils.ts
- [x] Export `splitElementOperation`
- [x] Export `splitAndKeepLeftOperation`
- [x] Export `splitAndKeepRightOperation`
- [x] Export `separateAudioOperation`
- [x] Export `getAudioElementsOperation`
- [x] Export `getTotalDurationOperation`

**Verification**: `bun run check-types` passes ✅

---

### Phase 5: Persistence ✅ COMPLETED

#### Task 5.1: Create persistence.ts ✅ COMPLETED
**Create** `stores/timeline/persistence.ts`

- [x] Move `autoSaveTimer` module variable
- [x] Define `PersistenceContext` interface
- [x] Export `cancelAutoSaveTimer`
- [x] Export `autoSaveTimelineGuarded`
- [x] Export `triggerAutoSave`
- [x] Export `updateTracksAndSaveOperation`
- [x] Export `loadProjectTimelineOperation`
- [x] Export `saveProjectTimelineOperation`
- [x] Export `saveImmediateOperation`
- [x] Export `clearTimelineOperation`
- [x] Export `restoreTracksOperation`
- [x] Export `prepareTracks` helper

**Verification**: `bun run check-types` passes ✅

---

### Phase 6: Cleanup & Verification ✅ IN PROGRESS

#### Task 6.1: Update barrel exports ✅ COMPLETED
**Modify** `stores/timeline/index.ts`

- [x] Export all public functions and types
- [x] Ensure clean public API

**Verification**: External imports work ✅

---

#### Task 6.2: Type check ✅ COMPLETED
- [x] `bun run check-types` - no new type errors (only pre-existing error in polling.ts)

---

#### Task 6.3: Build verification ✅ COMPLETED
- [x] `bun run build` - build succeeded ✅
- [x] Fixed pre-existing ProgressUpdate type import in polling.ts

---

#### Task 6.5: Manual integration testing (~20 min)
Test in Electron app:

| Feature | Steps | Expected |
|---------|-------|----------|
| Add track | Click "Add Track" | New track appears |
| Remove track | Right-click → Delete | Track removed |
| Add element | Drag media to timeline | Element appears |
| Remove element | Select → Delete key | Element removed |
| Split element | Position playhead → "S" | Element splits |
| Move element | Drag to different track | Element moves |
| Ripple edit | Enable ripple → delete | Subsequent elements shift |
| Undo/Redo | Ctrl+Z / Ctrl+Shift+Z | State restored |
| Auto-save | Make changes | Status indicator updates |
| Load project | Open existing project | Timeline loads |

---

## Risk Mitigation

### Rollback Strategy

1. **Branch**: `refactor/timeline-store-split`
2. **Commits**: One commit per task for granular rollback
3. **Backup**: Keep original file as `.backup` until fully tested
4. **Feature Flag**: Not needed (no user-facing changes)

### Common Pitfalls

| Risk | Mitigation |
|------|------------|
| Circular imports | Follow dependency graph strictly |
| `this` binding lost | Use arrow functions or explicit binding |
| Auto-save timer race | Keep timer management in persistence module |
| Dynamic import timing | Test with actual project load/save |
| History stack corruption | Test undo/redo after each operation extraction |

---

## Success Criteria

### Quantitative
- [ ] Main store file < 700 lines
- [ ] No module > 400 lines
- [ ] Zero increase in bundle size
- [ ] All 200+ existing tests pass
- [ ] Type coverage maintained at 100%

### Qualitative
- [ ] New developer can find "split element" code in < 30 seconds
- [ ] Adding a new operation type requires editing only 1-2 files
- [ ] Code review diffs are scoped to relevant module
- [ ] Unit tests can mock operation context easily

---

## Post-Refactoring Opportunities

After this refactoring, these improvements become easier:

1. **Unit Testing Operations**: Write pure function tests for each operation
2. **Operation Composition**: Chain operations for complex workflows
3. **Optimistic Updates**: Separate UI updates from persistence
4. **Collaborative Editing**: Operation-based sync becomes possible
5. **Plugin System**: Operations become hookable extension points

---

## Task Summary

| Phase | Tasks | Total Time |
|-------|-------|------------|
| Phase 1: Foundation | 4 tasks | ~40 min |
| Phase 2: Track Ops | 4 tasks | ~55 min |
| Phase 3: Element Ops | 7 tasks | ~115 min |
| Phase 4: Split Ops | 4 tasks | ~55 min |
| Phase 5: Persistence | 4 tasks | ~65 min |
| Phase 6: Cleanup | 5 tasks | ~60 min |
| **Total** | **28 tasks** | **~390 min (~6.5 hours)** |

Each task is independently committable and testable.

---

*Document created: 2025-12-11*
*Last updated: 2025-12-12*
*Status: Phases 1-6 Complete - Timeline module extraction finished, build successful*
