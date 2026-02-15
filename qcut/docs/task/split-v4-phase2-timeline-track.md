# Phase 2: Split `timeline-track.tsx` (1324 → ~720)

**Risk Level:** Medium — drag effect stays in main component, drop handlers extracted as pure functions
**Estimated Time:** ~40 minutes

## Overview

`TimelineTrackContentComponent` is a large React component with two independently extractable areas:
1. **Drop handlers** (lines 509-1196, ~690 lines) — `handleTrackDragOver`, `handleTrackDragEnter`, `handleTrackDragLeave`, `handleTrackDrop` contain self-contained drop logic
2. **Utility functions** — `getDropSnappedTime`, overlap checking, error fallback

The drag mouse effect (lines 88-365) stays in the main file because it depends on component-level refs and Zustand selectors.

## Source File

`apps/web/src/components/editor/timeline/timeline-track.tsx` — 1324 lines

### Current Structure

| Section | Lines | Description |
|---------|------:|-------------|
| Imports | 1-26 | React, stores, types, utils |
| Component function + store selectors | 28-74 | 15+ Zustand selectors |
| Local state & refs | 76-86 | 6 state/ref declarations |
| **Drag mouse effect** | 88-365 | Mouse move/up handlers (stays) |
| Loading/error states | 368-379 | Conditional returns |
| **`getDropSnappedTime()`** | **382-426** | **Snap position calculator** |
| Element mouse handlers | 428-507 | mouseDown, click |
| **`handleTrackDragOver()`** | **509-670** | **Drop validation & preview** |
| **`handleTrackDragEnter()`** | **672-686** | **Drag enter state** |
| **`handleTrackDragLeave()`** | **688-707** | **Drag leave cleanup** |
| **`handleTrackDrop()`** | **709-1196** | **Drop execution (490 lines)** |
| Render JSX | 1198-1296 | Container + element mapping |
| Error fallback + export | 1300-1324 | HOC wrapper |

Bold = extraction targets.

---

## New Files

### 1. `apps/web/src/components/editor/timeline/timeline-track-drop-handlers.ts` (~500 lines)

**Contents:** All drop-related event handlers as standalone functions.

| Function | Current Lines | Description |
|----------|--------------|-------------|
| `handleTrackDragOverLogic()` | 509-670 | Validate drop zones, check overlaps |
| `handleTrackDropLogic()` | 709-1196 | Execute drop — create/move elements |

These are extracted as **pure logic functions** that receive all dependencies as parameters:

```typescript
interface DropHandlerDeps {
  track: TimelineTrack
  tracks: TimelineTrack[]
  zoomLevel: number
  mediaItems: MediaItem[]
  timelineRef: React.RefObject<HTMLDivElement>
  snappingEnabled: boolean
  rippleEditingEnabled: boolean
  currentTime: number
  // Store actions
  addTrack: (track: Partial<TimelineTrack>) => string
  insertTrackAt: (index: number, type: string) => string
  moveElementToTrack: (elementId: string, fromTrack: string, toTrack: string, startTime: number) => void
  addElementToTrack: (trackId: string, element: TimelineElement) => void
  updateElementStartTime: (trackId: string, elementId: string, time: number) => void
  updateElementStartTimeWithRipple: (trackId: string, elementId: string, time: number) => void
  // Utilities
  getDropSnappedTime: (rawTime: number, duration: number) => number
}
```

**Why parameter injection:**
- Makes the functions testable without Zustand
- Clear dependency declaration
- No closure over component state

### 2. `apps/web/src/components/editor/timeline/timeline-track-utils.ts` (~60 lines)

**Contents:** Pure utility functions used by drop handlers.

| Function | Current Lines | Description |
|----------|--------------|-------------|
| `getDropSnappedTime()` | 382-426 | Calculate snapped drop position |
| `TimelineTrackErrorFallback` | 1300-1315 | Error boundary UI component |

---

## What Stays in `timeline-track.tsx` (~720 lines)

| Section | Lines | Description |
|---------|------:|-------------|
| Imports | ~30 | + imports from new modules |
| Component + store selectors | ~50 | All Zustand selectors stay (component-level) |
| Local state & refs | ~12 | State declarations |
| Drag mouse effect | ~280 | The main useEffect for mouse drag (tightly coupled to refs) |
| Loading/error states | ~12 | Conditional returns |
| Element mouse handlers | ~80 | mouseDown, click handlers |
| Drop handler wrappers | ~30 | Thin wrappers calling imported logic with deps |
| Render JSX | ~100 | Container + element mapping |
| HOC export | ~8 | withErrorBoundary wrapper |

The main component creates a `deps` object and passes it to the extracted drop handler functions:

```typescript
// In component body
const dropDeps: DropHandlerDeps = {
  track, tracks, zoomLevel, mediaItems, timelineRef,
  snappingEnabled, rippleEditingEnabled, currentTime,
  addTrack, insertTrackAt, moveElementToTrack,
  addElementToTrack, updateElementStartTime,
  updateElementStartTimeWithRipple,
  getDropSnappedTime: (rawTime, duration) => getDropSnappedTime(...)
}

const handleTrackDragOver = useCallback(
  (e: React.DragEvent) => handleTrackDragOverLogic(e, dropDeps, setDropPosition, setWouldOverlap),
  [dropDeps]
)
```

---

## Implementation Steps

### Step 1: Create `timeline-track-utils.ts`

1. Create the file
2. Move `getDropSnappedTime()` (lines 382-426) — convert from closure to standalone function:
   ```typescript
   export function getDropSnappedTime(
     rawTime: number,
     duration: number,
     snappingEnabled: boolean,
     snapElementEdge: (...) => ...,
     tracks: TimelineTrack[],
     currentTime: number,
     zoomLevel: number,
   ): number
   ```
3. Move `TimelineTrackErrorFallback` (lines 1300-1315)
4. Add necessary imports (`TimelineTrack`, `snapTimeToFrame`, etc.)

### Step 2: Create `timeline-track-drop-handlers.ts`

1. Create the file
2. Define `DropHandlerDeps` interface
3. Move `handleTrackDragOver` logic (lines 509-670) → `handleTrackDragOverLogic()`
   - Receives `e: React.DragEvent`, `deps: DropHandlerDeps`, state setters
   - Returns `{ dropPosition, wouldOverlap }` or calls setters
4. Move `handleTrackDrop` logic (lines 709-1196) → `handleTrackDropLogic()`
   - Receives `e: React.DragEvent`, `deps: DropHandlerDeps`, state setters
   - Contains all text/markdown/media element creation logic
5. Move `handleTrackDragEnter` logic (lines 672-686) and `handleTrackDragLeave` logic (lines 688-707) — these are simple enough to inline or extract
6. Add imports for types, constants, track utilities

### Step 3: Update `timeline-track.tsx`

1. Remove moved code
2. Add imports from new modules
3. Create `dropDeps` object in component body
4. Replace inline handlers with thin wrappers calling imported functions
5. Verify event handler refs in JSX remain correct

### Step 4: Verify no external imports break

1. Check files importing from `timeline-track.tsx`:
   - Should only be `TimelineTrackContent` export
   - No external files import the internal handlers

---

## Subtasks

### Subtask 2.1: Extract `getDropSnappedTime` to utils (~5 min)
**Files:** `timeline-track-utils.ts`, `timeline-track.tsx`
- Move function, add explicit parameters
- Import in main file, verify snap behavior

### Subtask 2.2: Extract drag enter/leave handlers (~5 min)
**Files:** `timeline-track-drop-handlers.ts`, `timeline-track.tsx`
- Simple state toggle logic
- `handleTrackDragEnter`: increment counter, set `isDropping`
- `handleTrackDragLeave`: decrement counter, reset states

### Subtask 2.3: Extract `handleTrackDragOver` (~10 min)
**Files:** `timeline-track-drop-handlers.ts`, `timeline-track.tsx`
- Move validation logic (overlap checking, position calculation)
- Pass `setDropPosition`, `setWouldOverlap` as callbacks

### Subtask 2.4: Extract `handleTrackDrop` (~15 min)
**Files:** `timeline-track-drop-handlers.ts`, `timeline-track.tsx`
- Largest extraction (490 lines)
- Contains text/markdown/media element creation
- Track insertion logic (above/on/below)
- Pass all store actions via deps object

### Subtask 2.5: Move error fallback to utils (~5 min)
**Files:** `timeline-track-utils.ts`, `timeline-track.tsx`
- Move `TimelineTrackErrorFallback` component
- Update `withErrorBoundary` import in main file

---

## Risks

| Risk | Mitigation |
|------|------------|
| Drop handlers use 14+ Zustand selectors | Pass via `DropHandlerDeps` interface — explicit, testable |
| `handleTrackDrop` creates elements inline | Same logic, just receives store actions as params |
| State setters passed as callbacks | Type-safe: `(value: T) => void` signatures |
| `toast` calls in drop handlers | Import `toast` directly in new file |
| `useProjectStore.getState()` calls | Import store directly in new file (same pattern used elsewhere) |
| Large dependency arrays on wrappers | Use `useMemo` for deps object to avoid re-creation |

## Verification

```bash
bun check-types
bun lint:clean
bun run test
bun run electron:dev
```

## Test Scenarios

- [ ] Drag media item from media panel → drop on empty track
- [ ] Drag media item → drop above/below existing track (new track created)
- [ ] Drag timeline element between tracks
- [ ] Drag text element to text track
- [ ] Overlap detection shows red indicator
- [ ] Snapping works during drop
- [ ] Ripple editing mode works during drop
- [ ] Right-click context menu still works on elements
- [ ] Element split/duplicate/delete from context menu
