# Phase 2: Split `timeline-track.tsx` (1325 → ~720)

**Risk Level:** Medium — drag effect stays in main component, drop handlers extracted as pure functions

## Overview

`TimelineTrackContentComponent` is a large React component with two independently extractable areas:
1. **Drop handlers** (lines 509-1196, ~690 lines) — `handleTrackDragOver`, `handleTrackDragEnter`, `handleTrackDragLeave`, `handleTrackDrop` contain self-contained drop logic
2. **Utility functions** — `getDropSnappedTime`, overlap checking, error fallback

The drag mouse effect (lines 88-365) stays in the main file because it depends on component-level refs and Zustand selectors.

## Source File

`apps/web/src/components/editor/timeline/timeline-track.tsx` — 1325 lines

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
| Error fallback + export | 1300-1325 | HOC wrapper |

Bold = extraction targets.

### Only Consumer

`TimelineTrackContent` is the sole export, imported only by:
- `apps/web/src/components/editor/timeline/index.tsx` (line 19)

No external files import internal handlers — safe to refactor.

---

## New Files

### 1. `apps/web/src/components/editor/timeline/timeline-track-drop-handlers.ts` (~530 lines)

**Contents:** All drop-related event handlers as standalone functions.

| Function | Current Lines | Description |
|----------|--------------|-------------|
| `handleTrackDragOverLogic()` | 509-670 | Validate drop zones, check overlaps |
| `handleTrackDragEnterLogic()` | 672-686 | Drag enter state toggle |
| `handleTrackDragLeaveLogic()` | 688-707 | Drag leave cleanup |
| `handleTrackDropLogic()` | 709-1196 | Execute drop — create/move elements |

These are extracted as **pure logic functions** that receive all dependencies as parameters:

```typescript
import type { TimelineTrack, TimelineElement as TimelineElementType, DragData } from "@/types/timeline";

export interface DropHandlerDeps {
  track: TimelineTrack;
  tracks: TimelineTrack[];
  zoomLevel: number;
  mediaItems: Array<{ id: string; name: string; url?: string; type?: string; duration?: number }>;
  snappingEnabled: boolean;
  rippleEditingEnabled: boolean;
  currentTime: number;
  // Store actions (from useTimelineStore selectors)
  addTrack: (type: string) => string;
  insertTrackAt: (type: string, index: number) => string;
  moveElementToTrack: (fromTrackId: string, toTrackId: string, elementId: string) => void;
  addElementToTrack: (trackId: string, element: Partial<TimelineElementType>) => void;
  updateElementStartTime: (trackId: string, elementId: string, time: number) => void;
  updateElementStartTimeWithRipple: (trackId: string, elementId: string, time: number) => void;
  // Utility
  getDropSnappedTime: (rawTime: number, duration: number, excludeElementId?: string) => number;
}

export interface DropStateSetters {
  setIsDropping: (value: boolean) => void;
  setDropPosition: (value: number | null) => void;
  setWouldOverlap: (value: boolean) => void;
  dragCounterRef: React.MutableRefObject<number>;
}
```

**Why parameter injection:**
- Makes the functions testable without Zustand
- Clear dependency declaration
- No closure over component state

### 2. `apps/web/src/components/editor/timeline/timeline-track-utils.ts` (~70 lines)

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
  track, tracks, zoomLevel, mediaItems,
  snappingEnabled, rippleEditingEnabled, currentTime,
  addTrack, insertTrackAt, moveElementToTrack,
  addElementToTrack, updateElementStartTime,
  updateElementStartTimeWithRipple,
  getDropSnappedTime: (rawTime, duration, excludeId) =>
    getDropSnappedTime(rawTime, duration, snappingEnabled, snapElementEdge, tracks, currentTime, zoomLevel, excludeId),
};

const dropSetters: DropStateSetters = {
  setIsDropping, setDropPosition, setWouldOverlap, dragCounterRef,
};

const handleTrackDragOver = (e: React.DragEvent) =>
  handleTrackDragOverLogic(e, dropDeps, dropSetters);

const handleTrackDrop = (e: React.DragEvent) =>
  handleTrackDropLogic(e, dropDeps, dropSetters);
```

---

## Implementation Steps

### Step 1: Create `timeline-track-utils.ts`

**Create** `apps/web/src/components/editor/timeline/timeline-track-utils.ts`

#### Code to add:

```typescript
import type { TimelineTrack } from "@/types/timeline";
import type { SnapResult } from "@/hooks/use-timeline-snapping";
import { snapTimeToFrame } from "@/constants/timeline-constants";
import { useProjectStore } from "@/stores/project-store";

/**
 * Calculate snapped drop position — tries both start and end edge snaps
 * and picks the closest one.
 *
 * Extracted from TimelineTrackContentComponent (original lines 382-426).
 */
export function getDropSnappedTime(
  dropTime: number,
  elementDuration: number,
  snappingEnabled: boolean,
  snapElementEdge: (
    targetTime: number,
    elementDuration: number,
    tracks: TimelineTrack[],
    playheadTime: number,
    zoomLevel: number,
    excludeElementId?: string,
    snapToStart?: boolean
  ) => SnapResult,
  tracks: TimelineTrack[],
  currentTime: number,
  zoomLevel: number,
  excludeElementId?: string,
): number {
  if (!snappingEnabled) {
    const projectStore = useProjectStore.getState();
    const projectFps = projectStore.activeProject?.fps || 30;
    return snapTimeToFrame(dropTime, projectFps);
  }

  const startSnapResult = snapElementEdge(
    dropTime, elementDuration, tracks, currentTime, zoomLevel,
    excludeElementId, true,
  );
  const endSnapResult = snapElementEdge(
    dropTime, elementDuration, tracks, currentTime, zoomLevel,
    excludeElementId, false,
  );

  let bestSnapResult = startSnapResult;
  if (
    endSnapResult.snapPoint &&
    (!startSnapResult.snapPoint || endSnapResult.snapDistance < startSnapResult.snapDistance)
  ) {
    bestSnapResult = endSnapResult;
  }

  return bestSnapResult.snappedTime;
}

/**
 * Error Fallback Component for Timeline Track.
 * Extracted from original lines 1300-1315.
 */
export const TimelineTrackErrorFallback = ({
  resetError,
}: {
  resetError: () => void;
}) => (
  <div className="h-16 bg-destructive/10 border border-destructive/20 rounded flex items-center justify-center text-sm text-destructive m-2">
    <span className="mr-2">⚠️ Track Error</span>
    <button
      onClick={resetError}
      className="underline hover:no-underline"
      type="button"
    >
      Retry
    </button>
  </div>
);
```

> **Note:** `TimelineTrackErrorFallback` uses JSX, so the file extension must be `.tsx` not `.ts`.
> **Rename to:** `timeline-track-utils.tsx`

### Step 2: Create `timeline-track-drop-handlers.ts`

**Create** `apps/web/src/components/editor/timeline/timeline-track-drop-handlers.ts`

#### Code to add:

```typescript
import type {
  TimelineTrack,
  TimelineElement as TimelineElementType,
  DragData,
} from "@/types/timeline";
import { getMainTrack, canElementGoOnTrack } from "@/types/timeline";
import { TIMELINE_CONSTANTS, snapTimeToFrame } from "@/constants/timeline-constants";
import { useTimelineStore } from "@/stores/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { toast } from "sonner";

// ─── Dependency interfaces ─────────────────────────────

export interface DropHandlerDeps {
  track: TimelineTrack;
  tracks: TimelineTrack[];
  zoomLevel: number;
  mediaItems: Array<{ id: string; name: string; url?: string; type?: string; duration?: number }>;
  snappingEnabled: boolean;
  rippleEditingEnabled: boolean;
  currentTime: number;
  addTrack: (type: string) => string;
  insertTrackAt: (type: string, index: number) => string;
  moveElementToTrack: (fromTrackId: string, toTrackId: string, elementId: string) => void;
  addElementToTrack: (trackId: string, element: Partial<TimelineElementType>) => void;
  updateElementStartTime: (trackId: string, elementId: string, time: number) => void;
  updateElementStartTimeWithRipple: (trackId: string, elementId: string, time: number) => void;
  getDropSnappedTime: (rawTime: number, duration: number, excludeElementId?: string) => number;
}

export interface DropStateSetters {
  setIsDropping: (value: boolean) => void;
  setDropPosition: (value: number | null) => void;
  setWouldOverlap: (value: boolean) => void;
  dragCounterRef: React.MutableRefObject<number>;
}

// ─── Helpers ───────────────────────────────────────────

/** Check if a new element would overlap any existing element on the track */
function checkOverlap(
  elements: TimelineElementType[],
  snappedTime: number,
  duration: number,
  excludeElementId?: string,
  excludeFromTrackId?: string,
  currentTrackId?: string,
): boolean {
  const newEnd = snappedTime + duration;
  return elements.some((el) => {
    if (excludeFromTrackId === currentTrackId && el.id === excludeElementId) return false;
    const existingStart = el.startTime;
    const existingEnd = el.startTime + (el.duration - el.trimStart - el.trimEnd);
    return snappedTime < existingEnd && newEnd > existingStart;
  });
}

// ─── handleTrackDragEnterLogic ─────────────────────────
// Original: timeline-track.tsx lines 672-686

export function handleTrackDragEnterLogic(
  e: React.DragEvent,
  setters: DropStateSetters,
): void {
  e.preventDefault();
  const hasTimelineElement = e.dataTransfer.types.includes("application/x-timeline-element");
  const hasMediaItem = e.dataTransfer.types.includes("application/x-media-item");
  if (!hasTimelineElement && !hasMediaItem) return;
  setters.dragCounterRef.current++;
  setters.setIsDropping(true);
}

// ─── handleTrackDragLeaveLogic ─────────────────────────
// Original: timeline-track.tsx lines 688-707

export function handleTrackDragLeaveLogic(
  e: React.DragEvent,
  setters: DropStateSetters,
): void {
  e.preventDefault();
  const hasTimelineElement = e.dataTransfer.types.includes("application/x-timeline-element");
  const hasMediaItem = e.dataTransfer.types.includes("application/x-media-item");
  if (!hasTimelineElement && !hasMediaItem) return;
  setters.dragCounterRef.current--;
  if (setters.dragCounterRef.current === 0) {
    setters.setIsDropping(false);
    setters.setWouldOverlap(false);
    setters.setDropPosition(null);
  }
}

// ─── handleTrackDragOverLogic ──────────────────────────
// Original: timeline-track.tsx lines 509-670
// Move the full body of `handleTrackDragOver` here.
// Receives deps for track/tracks/mediaItems/zoomLevel/getDropSnappedTime,
// and setters for setDropPosition/setWouldOverlap.

export function handleTrackDragOverLogic(
  e: React.DragEvent,
  deps: DropHandlerDeps,
  setters: DropStateSetters,
): void {
  // ... (full body from lines 509-670 verbatim, replacing closure refs with deps.*)
}

// ─── handleTrackDropLogic ──────────────────────────────
// Original: timeline-track.tsx lines 709-1196
// Move the full body of `handleTrackDrop` here.
// Receives deps for all store actions and setters for state reset.

export function handleTrackDropLogic(
  e: React.DragEvent,
  deps: DropHandlerDeps,
  setters: DropStateSetters,
): void {
  // ... (full body from lines 709-1196, replacing closure refs with deps.*)
}
```

### Step 3: Update `timeline-track.tsx`

#### Code to delete (move to new files):

| Lines to remove | What | Moved to |
|----------------|------|----------|
| 382-426 | `getDropSnappedTime` function body | `timeline-track-utils.tsx` |
| 509-670 | `handleTrackDragOver` function body | `timeline-track-drop-handlers.ts` |
| 672-686 | `handleTrackDragEnter` function body | `timeline-track-drop-handlers.ts` |
| 688-707 | `handleTrackDragLeave` function body | `timeline-track-drop-handlers.ts` |
| 709-1196 | `handleTrackDrop` function body | `timeline-track-drop-handlers.ts` |
| 1300-1315 | `TimelineTrackErrorFallback` component | `timeline-track-utils.tsx` |

#### Code to add (new imports):

```typescript
// Add after existing imports (line 26)
import { getDropSnappedTime, TimelineTrackErrorFallback } from "./timeline-track-utils";
import {
  handleTrackDragOverLogic,
  handleTrackDragEnterLogic,
  handleTrackDragLeaveLogic,
  handleTrackDropLogic,
  type DropHandlerDeps,
  type DropStateSetters,
} from "./timeline-track-drop-handlers";
```

#### Code to modify — replace inline `getDropSnappedTime` (lines 382-426):

**Delete** the entire closure function and replace with a wrapper:

```typescript
// Replace lines 382-426 with:
const getDropSnappedTimeFn = (
  dropTime: number,
  elementDuration: number,
  excludeElementId?: string,
) => getDropSnappedTime(
  dropTime, elementDuration, snappingEnabled, snapElementEdge,
  tracks, currentTime, zoomLevel, excludeElementId,
);
```

#### Code to modify — replace inline handlers (lines 509-707, 709-1196):

**Delete** all four handler function bodies. Replace with:

```typescript
// Replace lines 509-1196 with:
const dropDeps: DropHandlerDeps = {
  track, tracks, zoomLevel, mediaItems,
  snappingEnabled, rippleEditingEnabled, currentTime,
  addTrack, insertTrackAt, moveElementToTrack,
  addElementToTrack, updateElementStartTime,
  updateElementStartTimeWithRipple,
  getDropSnappedTime: getDropSnappedTimeFn,
};

const dropSetters: DropStateSetters = {
  setIsDropping, setDropPosition, setWouldOverlap, dragCounterRef,
};

const handleTrackDragOver = (e: React.DragEvent) =>
  handleTrackDragOverLogic(e, dropDeps, dropSetters);

const handleTrackDragEnter = (e: React.DragEvent) =>
  handleTrackDragEnterLogic(e, dropSetters);

const handleTrackDragLeave = (e: React.DragEvent) =>
  handleTrackDragLeaveLogic(e, dropSetters);

const handleTrackDrop = (e: React.DragEvent) =>
  handleTrackDropLogic(e, dropDeps, dropSetters);
```

#### Code to modify — error fallback export (lines 1300-1325):

**Delete** the `TimelineTrackErrorFallback` component definition (lines 1300-1315). Keep the export line but import the fallback:

```typescript
// Line 1318 stays, but now uses imported TimelineTrackErrorFallback
export const TimelineTrackContent = withErrorBoundary(
  TimelineTrackContentComponent,
  {
    isolate: true,
    fallback: TimelineTrackErrorFallback,
  }
);
```

#### Imports to remove from `timeline-track.tsx`:

These imports are **no longer needed** in the main file after extraction (they move to the new files):

| Import | Used by | Now lives in |
|--------|---------|-------------|
| `getMainTrack` | `handleTrackDrop` (lines 874, 959, 1077, 1121) | `timeline-track-drop-handlers.ts` |
| `canElementGoOnTrack` | `handleTrackDrop` (line 1066) | `timeline-track-drop-handlers.ts` |
| `sortTracksByOrder` | Not used anywhere in the file | Delete entirely |
| `ensureMainTrack` | Not used anywhere in the file | Delete entirely |

**Keep** in `timeline-track.tsx`: `TimelineTrack` (type, used in component body), `DragData` (no — only used in drop handlers, remove).

Updated import at line 8-14:
```typescript
// Before:
import {
  TimelineTrack,
  sortTracksByOrder,
  ensureMainTrack,
  getMainTrack,
  canElementGoOnTrack,
} from "@/types/timeline";

// After:
import { TimelineTrack } from "@/types/timeline";
```

Also **remove** `DragData` from the type import (line 18) since it's only used in drop handlers:
```typescript
// Before:
import type {
  TimelineElement as TimelineElementType,
  DragData,
} from "@/types/timeline";

// After:
import type { TimelineElement as TimelineElementType } from "@/types/timeline";
```

### Step 4: Verify no external imports break

1. Only `apps/web/src/components/editor/timeline/index.tsx` imports from `timeline-track.tsx`
2. It imports only `TimelineTrackContent` — unchanged
3. Run verification commands

---

## Subtasks

### Subtask 2.1: Extract `getDropSnappedTime` to utils

**Files to create:** `apps/web/src/components/editor/timeline/timeline-track-utils.tsx`
**Files to modify:** `apps/web/src/components/editor/timeline/timeline-track.tsx`

**What to do:**
1. Create `timeline-track-utils.tsx` with the `getDropSnappedTime` standalone function
2. Convert from closure (captures `snappingEnabled`, `snapElementEdge`, `tracks`, `currentTime`, `zoomLevel`) to explicit parameters
3. Import in main file, replace lines 382-426 with wrapper that passes captured values

**Original code (lines 382-426):**
```typescript
const getDropSnappedTime = (dropTime: number, elementDuration: number, excludeElementId?: string) => {
  if (!snappingEnabled) {
    const projectStore = useProjectStore.getState();
    const projectFps = projectStore.activeProject?.fps || 30;
    return snapTimeToFrame(dropTime, projectFps);
  }
  const startSnapResult = snapElementEdge(dropTime, elementDuration, tracks, currentTime, zoomLevel, excludeElementId, true);
  const endSnapResult = snapElementEdge(dropTime, elementDuration, tracks, currentTime, zoomLevel, excludeElementId, false);
  let bestSnapResult = startSnapResult;
  if (endSnapResult.snapPoint && (!startSnapResult.snapPoint || endSnapResult.snapDistance < startSnapResult.snapDistance)) {
    bestSnapResult = endSnapResult;
  }
  return bestSnapResult.snappedTime;
};
```

**New standalone function signature:**
```typescript
export function getDropSnappedTime(
  dropTime: number,
  elementDuration: number,
  snappingEnabled: boolean,
  snapElementEdge: (targetTime: number, elementDuration: number, tracks: TimelineTrack[], playheadTime: number, zoomLevel: number, excludeElementId?: string, snapToStart?: boolean) => SnapResult,
  tracks: TimelineTrack[],
  currentTime: number,
  zoomLevel: number,
  excludeElementId?: string,
): number
```

**Dependencies needed in new file:**
- `import type { TimelineTrack } from "@/types/timeline"`
- `import type { SnapResult } from "@/hooks/use-timeline-snapping"` — `SnapResult = { snappedTime: number; snapPoint: SnapPoint | null; snapDistance: number }`
- `import { snapTimeToFrame } from "@/constants/timeline-constants"`
- `import { useProjectStore } from "@/stores/project-store"` — for `getState().activeProject?.fps`

### Subtask 2.2: Extract drag enter/leave handlers

**Files to create:** `apps/web/src/components/editor/timeline/timeline-track-drop-handlers.ts`
**Files to modify:** `apps/web/src/components/editor/timeline/timeline-track.tsx`

**What to do:**
1. Create drop handlers file with `DropStateSetters` interface
2. Move `handleTrackDragEnter` (lines 672-686) → `handleTrackDragEnterLogic`
3. Move `handleTrackDragLeave` (lines 688-707) → `handleTrackDragLeaveLogic`
4. These are simple — they only check `e.dataTransfer.types` and toggle state

**`handleTrackDragEnter` original (lines 672-686):**
- Reads: `e.dataTransfer.types`
- Writes: `dragCounterRef.current++`, `setIsDropping(true)`
- No deps on track/store — only needs `DropStateSetters`

**`handleTrackDragLeave` original (lines 688-707):**
- Reads: `e.dataTransfer.types`, `dragCounterRef.current`
- Writes: `dragCounterRef.current--`, `setIsDropping(false)`, `setWouldOverlap(false)`, `setDropPosition(null)`
- No deps on track/store — only needs `DropStateSetters`

### Subtask 2.3: Extract `handleTrackDragOver`

**Files to modify:** `timeline-track-drop-handlers.ts`, `timeline-track.tsx`

**What to do:**
1. Move lines 509-670 → `handleTrackDragOverLogic(e, deps, setters)`
2. Replace all closure references with `deps.*` access

**Closure references to replace:**

| Original closure ref | Replace with | Lines |
|---------------------|-------------|-------|
| `track` | `deps.track` | 553, 571, 593, 637, 638 |
| `track.elements` | `deps.track.elements` | 553, 571, 593, 637 |
| `zoomLevel` | `deps.zoomLevel` | 530 |
| `getDropSnappedTime(...)` | `deps.getDropSnappedTime(...)` | 547, 565, 587, 630, 662 |
| `tracks` | `deps.tracks` | 618 |
| `mediaItems` | `deps.mediaItems` | 582 |
| `setWouldOverlap(...)` | `setters.setWouldOverlap(...)` | 660, 667 |
| `setDropPosition(...)` | `setters.setDropPosition(...)` | 662, 669 |

**Data types parsed from `e.dataTransfer`:**
- `"application/x-media-item"` → parsed as `DragData` (lines 538-542)
- `"application/x-timeline-element"` → parsed as `{ elementId: string, trackId: string }` (lines 612-617)

**Import needed:** `DragData` from `@/types/timeline`

### Subtask 2.4: Extract `handleTrackDrop` (largest — 490 lines)

**Files to modify:** `timeline-track-drop-handlers.ts`, `timeline-track.tsx`

**What to do:**
1. Move lines 709-1196 → `handleTrackDropLogic(e, deps, setters)`
2. Replace all closure references with `deps.*` access
3. This function also calls `useTimelineStore.getState()` and `useProjectStore.getState()` directly — import those stores in the new file

**Closure references to replace:**

| Original closure ref | Replace with | Lines |
|---------------------|-------------|-------|
| `track` | `deps.track` | 719, 752, 807-809, 832, etc. |
| `track.id` | `deps.track.id` | 719, 752, 832, 838, etc. |
| `track.type` | `deps.track.type` | 872, 958, etc. |
| `track.elements` | `deps.track.elements` | 807 |
| `tracks` | `deps.tracks` | 752, 779, 874, 959, etc. |
| `zoomLevel` | `deps.zoomLevel` | 746 |
| `mediaItems` | `deps.mediaItems` | 1043 |
| `rippleEditingEnabled` | `deps.rippleEditingEnabled` | 834, 850 |
| `addTrack(...)` | `deps.addTrack(...)` | 1081 |
| `insertTrackAt(...)` | `deps.insertTrackAt(...)` | 894, 975, 1111, 1140 |
| `moveElementToTrack(...)` | `deps.moveElementToTrack(...)` | 845 |
| `addElementToTrack(...)` | `deps.addElementToTrack(...)` | 933, 1010, 1181 |
| `updateElementStartTime(...)` | `deps.updateElementStartTime(...)` | 841, 854 |
| `updateElementStartTimeWithRipple(...)` | `deps.updateElementStartTimeWithRipple(...)` | 836, 851 |
| `getDropSnappedTime(...)` | `deps.getDropSnappedTime(...)` | 799, 906, 985, 1154 |
| `dragCounterRef.current = 0` | `setters.dragCounterRef.current = 0` | 724 |
| `setIsDropping(false)` | `setters.setIsDropping(false)` | 725 |
| `setWouldOverlap(false)` | `setters.setWouldOverlap(false)` | 726 |

**Direct store access (keep as imports in new file):**
- `useTimelineStore.getState()` — lines 896, 976, 1082, 1113, 1142 (to get updated tracks after `insertTrackAt`)
- `useProjectStore.getState()` — line 747 (for `activeProject?.fps`)

**`toast` calls to keep (import `toast` in new file):**
- Line 787: `toast.error("Element not found")`
- Line 826-828: `toast.error("Cannot move element here...")`
- Line 926-928: `toast.error("Cannot place element here...")`
- Line 1003-1005: `toast.error("Cannot place element here...")`
- Line 1055: `toast.error("Media item not found")`
- Line 1174-1176: `toast.error("Cannot place element here...")`
- Line 1194: `toast.error("Failed to add media to track")`

**Imports from `@/types/timeline` needed:**
- `getMainTrack` — used at lines 874, 959, 1077, 1121
- `canElementGoOnTrack` — used at line 1066
- `DragData` — used at lines 865, 542

**Constants from `@/constants/timeline-constants` needed:**
- `TIMELINE_CONSTANTS.PIXELS_PER_SECOND` — line 746
- `TIMELINE_CONSTANTS.DEFAULT_TEXT_DURATION` — line 937
- `TIMELINE_CONSTANTS.MARKDOWN_DEFAULT_DURATION` — line 984
- `snapTimeToFrame` — line 749

**Drop position logic (lines 754-762) — stays in function:**
```typescript
let dropPosition: "above" | "on" | "below";
if (mouseY < 20) dropPosition = "above";
else if (mouseY > 40) dropPosition = "below";
else dropPosition = "on";
```

**Element creation payloads (verbatim, no changes):**
- Text element: lines 933-953 — `{ type: "text", name, content, duration, startTime, trimStart, trimEnd, fontSize, fontFamily, color, backgroundColor, textAlign, fontWeight, fontStyle, textDecoration, x, y, rotation, opacity }`
- Markdown element: lines 1010-1033 — `{ type: "markdown", name, markdownContent, duration, startTime, trimStart, trimEnd, theme, fontSize, fontFamily, padding, backgroundColor, textColor, scrollMode, scrollSpeed, x, y, width, height, rotation, opacity }`
- Media element: lines 1181-1189 — `{ type: "media", mediaId, name, duration, startTime, trimStart, trimEnd }`

### Subtask 2.5: Move error fallback to utils

**Files to modify:** `timeline-track-utils.tsx`, `timeline-track.tsx`

**What to do:**
1. Move `TimelineTrackErrorFallback` (lines 1300-1315) to `timeline-track-utils.tsx`
2. Add React import to utils file (for JSX)
3. In `timeline-track.tsx`, import `TimelineTrackErrorFallback` from `./timeline-track-utils`
4. Delete lines 1299-1315 from main file

**Original code to move (lines 1300-1315):**
```tsx
const TimelineTrackErrorFallback = ({
  resetError,
}: {
  resetError: () => void;
}) => (
  <div className="h-16 bg-destructive/10 border border-destructive/20 rounded flex items-center justify-center text-sm text-destructive m-2">
    <span className="mr-2">⚠️ Track Error</span>
    <button
      onClick={resetError}
      className="underline hover:no-underline"
      type="button"
    >
      Retry
    </button>
  </div>
);
```

**Props type matches `withErrorBoundary` expectation:** `{ resetError: () => void }` (see `ErrorFallbackProps` in `apps/web/src/components/error-boundary.tsx`).

---

## Risks

| Risk | Mitigation |
|------|------------|
| Drop handlers use 14+ Zustand selectors | Pass via `DropHandlerDeps` interface — explicit, testable |
| `handleTrackDrop` creates elements inline | Same logic, just receives store actions as params |
| State setters passed as callbacks | Type-safe: `(value: T) => void` signatures |
| `toast` calls in drop handlers | Import `toast` directly in new file |
| `useProjectStore.getState()` calls | Import store directly in new file (same pattern used elsewhere) |
| `useTimelineStore.getState()` calls in drop | Import store directly — needed for fresh tracks after `insertTrackAt` |
| `checkOverlap` repeated 7+ times | Extract as helper in drop-handlers file to reduce duplication |
| File extension for utils (JSX) | Use `.tsx` since `TimelineTrackErrorFallback` contains JSX |

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
