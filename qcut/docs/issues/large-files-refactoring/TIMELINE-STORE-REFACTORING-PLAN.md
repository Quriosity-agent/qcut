# Timeline Store Refactoring Plan

## Overview

**File**: `qcut/apps/web/src/stores/timeline-store.ts`
**Current Size**: 2,194 lines
**Target**: Split into 6 focused modules
**Status**: Planning
**Priority**: High (core functionality, high change frequency)

---

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

```
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

#### Task 1.1: Create types.ts (~15 min)
**Create** `stores/timeline/types.ts`

Extract from `timeline-store.ts`:
- [ ] `TimelineStore` interface (lines 55-353)
- [ ] `DragState` type (from lines 108-123)
- [ ] `INITIAL_DRAG_STATE` constant
- [ ] `OperationContext` interface (new)
- [ ] `SelectedElement` type alias
- [ ] Re-export timeline types from `@/types/timeline`

**Verification**: `bun run check-types` passes

---

#### Task 1.2: Create utils.ts (~10 min)
**Create** `stores/timeline/utils.ts`

Extract from `timeline-store.ts`:
- [ ] `getElementNameWithSuffix` function (lines 37-49)
- [ ] `createTrack` helper (extract from addTrack logic, lines 564-583)

**Verification**: `bun run check-types` passes

---

#### Task 1.3: Create index.ts barrel (~5 min)
**Create** `stores/timeline/index.ts`

```typescript
export * from "./types";
export * from "./utils";
// More exports added as modules are created
```

**Verification**: Import works from main store

---

#### Task 1.4: Update main store imports (~10 min)
**Modify** `stores/timeline-store.ts`

- [ ] Import types from `./timeline/types`
- [ ] Import utils from `./timeline/utils`
- [ ] Remove extracted code from main file
- [ ] Verify no regressions

**Verification**: `bun run check-types` + manual test (add track)

---

### Phase 2: Track Operations

#### Task 2.1: Create track-operations.ts skeleton (~10 min)
**Create** `stores/timeline/track-operations.ts`

- [ ] Set up imports and `OperationContext` parameter pattern
- [ ] Export `addTrackOperation` (simple case)
- [ ] Export `insertTrackAtOperation`

**Verification**: `bun run check-types` passes

---

#### Task 2.2: Extract removeTrack (~15 min)
**Modify** `stores/timeline/track-operations.ts`

- [ ] Extract `removeTrackOperation` (simple case, lines 618-629)
- [ ] Update main store to call extracted function

**Verification**: `bun run check-types` + manual test (delete empty track)

---

#### Task 2.3: Extract removeTrackWithRipple (~20 min)
**Modify** `stores/timeline/track-operations.ts`

- [ ] Extract `removeTrackWithRippleOperation` (lines 631-720)
- [ ] Import `checkElementOverlaps`, `resolveElementOverlaps` from `@/lib/timeline`
- [ ] Update main store to call extracted function

**Verification**: `bun run check-types` + manual test (delete track with ripple enabled)

---

#### Task 2.4: Wire up track operations in main store (~10 min)
**Modify** `stores/timeline-store.ts`

- [ ] Create `getOperationContext()` helper inside store
- [ ] Replace inline track operations with calls to extracted functions
- [ ] Remove old inline code

**Verification**: All track operations work (add, insert, remove, remove with ripple)

---

### Phase 3: Element Operations

#### Task 3.1: Create element-operations.ts skeleton (~10 min)
**Create** `stores/timeline/element-operations.ts`

- [ ] Set up imports and context pattern
- [ ] Define callback interfaces for side effects

```typescript
interface AddElementCallbacks {
  selectElement: (trackId: string, elementId: string) => void;
  onFirstMediaElement?: (element: TimelineElement, mediaItem: MediaItem) => void;
}
```

**Verification**: `bun run check-types` passes

---

#### Task 3.2: Extract addElementToTrack (~20 min)
**Modify** `stores/timeline/element-operations.ts`

- [ ] Extract `addElementToTrackOperation` (lines 722-854)
- [ ] Handle validation logic
- [ ] Handle first-element canvas size via callback
- [ ] Update main store

**Verification**: `bun run check-types` + manual test (drag media to timeline)

---

#### Task 3.3: Extract removeElementFromTrack (~15 min)
**Modify** `stores/timeline/element-operations.ts`

- [ ] Extract `removeElementFromTrackOperation` (lines 856-878)
- [ ] Update main store

**Verification**: `bun run check-types` + manual test (delete element)

---

#### Task 3.4: Extract removeElementFromTrackWithRipple (~20 min)
**Modify** `stores/timeline/element-operations.ts`

- [ ] Extract `removeElementFromTrackWithRippleOperation` (lines 880-954)
- [ ] Update main store

**Verification**: `bun run check-types` + manual test (delete with ripple)

---

#### Task 3.5: Extract moveElementToTrack (~15 min)
**Modify** `stores/timeline/element-operations.ts`

- [ ] Extract `moveElementToTrackOperation` (lines 956-1009)
- [ ] Update main store

**Verification**: `bun run check-types` + manual test (drag element between tracks)

---

#### Task 3.6: Extract update operations (~15 min)
**Modify** `stores/timeline/element-operations.ts`

- [ ] Extract `updateElementTrimOperation` (lines 1011-1033)
- [ ] Extract `updateElementDurationOperation` (lines 1035-1054)
- [ ] Extract `updateElementStartTimeOperation` (lines 1056-1078)
- [ ] Update main store

**Verification**: `bun run check-types` + manual test (trim element)

---

#### Task 3.7: Extract updateElementStartTimeWithRipple (~20 min)
**Modify** `stores/timeline/element-operations.ts`

- [ ] Extract `updateElementStartTimeWithRippleOperation` (lines 1080-1166)
- [ ] Update main store

**Verification**: `bun run check-types` + manual test (move element with ripple)

---

### Phase 4: Split Operations

#### Task 4.1: Create split-operations.ts (~10 min)
**Create** `stores/timeline/split-operations.ts`

- [ ] Set up imports and context pattern
- [ ] Import `getElementNameWithSuffix` from utils

**Verification**: `bun run check-types` passes

---

#### Task 4.2: Extract splitElement (~15 min)
**Modify** `stores/timeline/split-operations.ts`

- [ ] Extract `splitElementOperation` (lines 1279-1330)
- [ ] Update main store

**Verification**: `bun run check-types` + manual test (split at playhead)

---

#### Task 4.3: Extract splitAndKeepLeft/Right (~15 min)
**Modify** `stores/timeline/split-operations.ts`

- [ ] Extract `splitAndKeepLeftOperation` (lines 1333-1371)
- [ ] Extract `splitAndKeepRightOperation` (lines 1374-1411)
- [ ] Update main store

**Verification**: `bun run check-types` + manual test

---

#### Task 4.4: Extract separateAudio (~15 min)
**Modify** `stores/timeline/split-operations.ts`

- [ ] Extract `separateAudioOperation` (lines 1439-1491)
- [ ] Update main store

**Verification**: `bun run check-types` + manual test (separate audio from video)

---

### Phase 5: Persistence

#### Task 5.1: Create persistence.ts (~15 min)
**Create** `stores/timeline/persistence.ts`

- [ ] Move `autoSaveTimer` module variable
- [ ] Set up async context with dynamic imports pattern
- [ ] Define `PersistenceContext` interface

```typescript
interface PersistenceContext {
  getTracks: () => TimelineTrack[];
  updateTracks: (tracks: TimelineTrack[]) => void;
  setAutoSaveStatus: (status: string, isAutoSaving: boolean, lastAt?: number) => void;
}
```

**Verification**: `bun run check-types` passes

---

#### Task 5.2: Extract autoSaveTimelineGuarded (~20 min)
**Modify** `stores/timeline/persistence.ts`

- [ ] Extract `autoSaveTimelineGuarded` (lines 380-444)
- [ ] Keep dynamic imports for `useProjectStore`, `useSceneStore`
- [ ] Update main store

**Verification**: `bun run check-types` + verify auto-save indicator works

---

#### Task 5.3: Extract updateTracksAndSave (~15 min)
**Modify** `stores/timeline/persistence.ts`

- [ ] Extract `createUpdateTracksAndSave` factory function
- [ ] Handles debounce timer logic
- [ ] Update main store

**Verification**: `bun run check-types` + verify changes trigger auto-save

---

#### Task 5.4: Extract load/save operations (~15 min)
**Modify** `stores/timeline/persistence.ts`

- [ ] Extract `loadProjectTimelineOperation` (lines 1775-1805)
- [ ] Extract `saveProjectTimelineOperation` (lines 1807-1826)
- [ ] Extract `saveImmediateOperation` (lines 1829-1867)
- [ ] Update main store

**Verification**: `bun run check-types` + manual test (open project, save)

---

### Phase 6: Cleanup & Verification

#### Task 6.1: Update barrel exports (~5 min)
**Modify** `stores/timeline/index.ts`

- [ ] Export all public functions and types
- [ ] Ensure clean public API

**Verification**: External imports work

---

#### Task 6.2: Clean up main store (~15 min)
**Modify** `stores/timeline-store.ts`

- [ ] Remove any remaining dead code
- [ ] Organize remaining methods into clear sections
- [ ] Add section comments for remaining inline code

**Verification**: `bun run check-types` passes

---

#### Task 6.3: Update external imports (~10 min)
**Search and update** any files importing types from timeline-store

```bash
grep -r "from.*timeline-store" --include="*.ts" --include="*.tsx"
```

- [ ] Update type imports to use `./timeline/types` if needed
- [ ] Ensure `useTimelineStore` remains the main export

**Verification**: `bun run check-types` passes

---

#### Task 6.4: Run full test suite (~10 min)
- [ ] `bun run test` - all tests pass
- [ ] `bun run check-types` - no type errors
- [ ] `bun run lint:clean` - no lint errors

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
*Last updated: 2025-12-11*
*Status: Ready for implementation*
