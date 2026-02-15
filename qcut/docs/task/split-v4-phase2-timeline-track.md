# Phase 2: Split `timeline-track.tsx` (LTS-safe)

**Primary Goal:** Improve long-term maintainability without changing runtime behavior.

**Risk Level:** Medium (reduced through phased extraction and test gates)

## Success Criteria

- Existing drag/drop behavior remains unchanged for all supported element types.
- `timeline-track.tsx` becomes an orchestration file, not a 500-line logic container.
- Drop logic is split into small, typed functions with explicit dependencies.
- Critical behavior is protected by automated tests before and after refactor.

## Non-Goals

- No feature additions.
- No UX changes.
- No drag/drop protocol changes (`application/x-media-item`, `application/x-timeline-element`).

## Design Principles

1. Behavior lock first, then refactor.
2. One file, one responsibility.
3. Keep impure code at the edge (DOM/store reads), keep core logic pure.
4. Use strict domain types (`TrackType`, `TimelineTrack`, `TimelineElement`) instead of `string` and broad `Partial` where avoidable.
5. Keep explicit `try-catch` in drop parsing/execution paths.

---

## Target File Structure

### 1) `apps/web/src/components/editor/timeline/timeline-track.tsx`

Responsibility: UI orchestration only.

- Store selectors
- local refs/state
- drag mouse effect
- render JSX
- thin wrappers that call extracted handlers

### 2) `apps/web/src/components/editor/timeline/timeline-track-drop-handlers.ts`

Responsibility: drop event orchestration (impure adapter layer).

- `handleTrackDragOverLogic`
- `handleTrackDragEnterLogic`
- `handleTrackDragLeaveLogic`
- `handleTrackDropLogic`
- `try-catch` around drag payload parsing and drop execution

### 3) `apps/web/src/components/editor/timeline/timeline-track-drop-logic.ts`

Responsibility: pure, reusable drop domain logic.

- overlap checks
- drop zone calculation (`above` | `on` | `below`)
- target track resolution rules
- snapped time calculation helpers that do not read stores directly

### 4) `apps/web/src/components/editor/timeline/timeline-track-fallback.tsx`

Responsibility: error boundary fallback UI only.

### 5) `apps/web/src/components/editor/timeline/timeline-track-drop-types.ts`

Responsibility: shared dependency and payload types for drop modules.

---

## Typed Contracts (Do This Early)

Use domain-safe types in dependency contracts:

```ts
import type {
  TimelineTrack,
  TimelineElement as TimelineElementType,
  TrackType,
} from "@/types/timeline";

export interface DropHandlerDeps {
  track: TimelineTrack;
  tracks: TimelineTrack[];
  zoomLevel: number;
  mediaItems: Array<{
    id: string;
    name: string;
    url?: string;
    type?: string;
    duration?: number;
  }>;
  snappingEnabled: boolean;
  rippleEditingEnabled: boolean;
  currentTime: number;
  addTrack: (type: TrackType) => string;
  insertTrackAt: (type: TrackType, index: number) => string;
  moveElementToTrack: (
    fromTrackId: string,
    toTrackId: string,
    elementId: string,
  ) => void;
  addElementToTrack: (
    trackId: string,
    element: Omit<TimelineElementType, "id">,
  ) => void;
  updateElementStartTime: (
    trackId: string,
    elementId: string,
    time: number,
  ) => void;
  updateElementStartTimeWithRipple: (
    trackId: string,
    elementId: string,
    time: number,
  ) => void;
  getDropSnappedTime: (
    rawTime: number,
    duration: number,
    excludeElementId?: string,
  ) => number;
}

export interface DropStateSetters {
  setIsDropping: (value: boolean) => void;
  setDropPosition: (value: number | null) => void;
  setWouldOverlap: (value: boolean) => void;
  dragCounterRef: React.MutableRefObject<number>;
}
```

Notes:
- If `addElementToTrack` requires the existing store type (currently accepts creation data), import and use that exact type alias from the store/timeline type layer.
- Do not widen to `string` for track type.

---

## Phased Implementation Plan

## Phase 2.0: Behavior Lock (Pre-Refactor)

### Work

- Add tests that lock current behavior of `timeline-track` drop logic before extraction.
- Keep existing code path untouched.

### Required Tests

1. `handleTrackDragOver` overlap indicator behavior
2. moving timeline element within same track and across tracks
3. dropping text creates/uses correct track and preserves defaults
4. dropping markdown creates/uses correct track and preserves defaults
5. dropping media chooses compatible target track and validates overlap
6. `above` / `on` / `below` drop zone behavior
7. drag enter/leave counter reset behavior

### Exit Gate

- New tests pass on current code.

---

## Phase 2.1: Mechanical Extraction (No Behavior Changes)

### Work

- Move fallback component to `timeline-track-fallback.tsx`.
- Move `getDropSnappedTime` helper to `timeline-track-drop-logic.ts` (or dedicated utility file).
- Move drag enter/leave/over/drop handler bodies to `timeline-track-drop-handlers.ts` verbatim except dependency access replacement.
- Keep direct store reads in handler module temporarily if needed to avoid behavior drift.

### Guardrails

- Do not alter conditions, constants, payload fields, or toast messages in this phase.
- Preserve all `try-catch` behavior currently present.

### Exit Gate

- Typecheck/lint/test pass.
- No snapshot/behavior delta in new tests.

---

## Phase 2.2: Dependency Hardening

### Work

- Introduce `timeline-track-drop-types.ts`.
- Replace weak contract types with domain-safe types.
- Make dependencies explicit and stable.

### Guardrails

- No business logic changes.
- Avoid "stringly typed" track operations.

### Exit Gate

- Typecheck passes without new casts.
- No `any` introduced.

---

## Phase 2.3: Decompose `handleTrackDrop` by Responsibility

### Work

Split large drop execution into focused functions in `timeline-track-drop-logic.ts`:

- `parseTimelineElementDragData`
- `parseMediaItemDragData`
- `calculateDropContext`
- `findTargetTrackForTextDrop`
- `findTargetTrackForMarkdownDrop`
- `findTargetTrackForMediaDrop`
- `validateNoOverlap`
- `moveExistingElement`
- `createTextElementPayload`
- `createMarkdownElementPayload`
- `createMediaElementPayload`

Keep `handleTrackDropLogic` as orchestration only.

### Guardrails

- Maintain existing toast/error messages.
- Keep requestAnimationFrame placement semantics unchanged.
- Keep all existing default durations and payload defaults.

### Exit Gate

- Unit tests added for each pure helper.
- Existing behavior tests remain green.

---

## Phase 2.4: Isolate Remaining Impure Reads

### Work

- Decide and standardize one approach:

Option A (preferred): inject store read callbacks into `DropHandlerDeps`.

Option B: keep store reads in handler adapter, but keep pure logic store-agnostic.

- Document chosen approach in file header comments.

### Exit Gate

- No direct store access in pure logic module.
- Test setup does not require Zustand store bootstrapping for pure functions.

---

## Phase 2.5: Cleanup and Documentation

### Work

- Remove stale imports from `timeline-track.tsx`.
- Verify fallback import path.
- Add a short module-level doc to each new file describing responsibility boundaries.

### Exit Gate

- `timeline-track.tsx` reduced and scannable.
- No dead code or unused imports.

---

## Verification Commands

```bash
bun check-types
bun lint:clean
bun run test
```

If available in local workflow, add focused runs for timeline tests during refactor loops.

---

## Regression Checklist (Must Pass)

- [ ] Drag media item from media panel to empty track
- [ ] Drag media item above/below track creates track in correct position
- [ ] Drag timeline element within same track preserves overlap constraints
- [ ] Drag timeline element across tracks moves and re-times correctly
- [ ] Drag text item creates text element with expected defaults
- [ ] Drag markdown item creates markdown element with expected defaults
- [ ] Overlap state toggles correctly in drag over UI
- [ ] Snapping behavior unchanged when enabled
- [ ] Frame snapping behavior unchanged when snapping disabled
- [ ] Ripple editing updates use ripple path where expected
- [ ] Context-menu actions (split/duplicate/delete) remain unaffected

---

## Rollback Plan

If regressions appear after any phase:

1. Revert only that phase's commit.
2. Keep behavior-lock tests and fix forward in smaller increments.
3. Do not continue to next phase until current phase gate is green.

---

## Implementation Notes for This Repo

- No TypeScript enums; use existing union/object patterns.
- Include `try-catch` for exported drop handlers and drag payload parsing branches.
- Prefer clear helper names over comments; add comments only for non-obvious behavior.
- Keep each new file focused on one responsibility.
