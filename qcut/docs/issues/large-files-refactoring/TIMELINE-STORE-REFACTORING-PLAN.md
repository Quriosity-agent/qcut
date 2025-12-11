
# Timeline Store Refactoring Plan

## Overview

**File**: `qcut/apps/web/src/stores/timeline-store.ts`
**Current Size**: 2,194 lines
**Target**: Split into 3 files
**Status**: Pending
**Priority**: High (core functionality, high change frequency)

---

## Current Structure Analysis

### Imports & Dependencies (Lines 1-28)

```typescript
// External
import { create } from "zustand";
import { toast } from "sonner";

// Types
import { TrackType, TimelineElement, CreateTimelineElement, TimelineTrack, TextElement, MediaElement, DragData, sortTracksByOrder, ensureMainTrack, validateElementTrackCompatibility } from "@/types/timeline";

// Stores (potential circular deps)
import { useEditorStore } from "./editor-store";
import { useMediaStore, getMediaAspectRatio, type MediaItem } from "./media-store";
// Dynamic import: useProjectStore, useSceneStore

// Utilities
import { storageService } from "@/lib/storage/storage-service";
import { createObjectURL } from "@/lib/blob-manager";
import { generateUUID } from "@/lib/utils";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { checkElementOverlaps, resolveElementOverlaps } from "@/lib/timeline";
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";
```

### Helper Function (Lines 30-49)

```typescript
const getElementNameWithSuffix = (originalName: string, suffix: string): string
```
- Removes existing suffixes: `(left)`, `(right)`, `(audio)`, `(split N)`
- Adds new suffix

### TimelineStore Interface (Lines 51-353) - ~300 lines

**State Properties:**
- `_tracks: TimelineTrack[]` - Private track storage
- `tracks: TimelineTrack[]` - Sorted/computed tracks
- `history: TimelineTrack[][]` - Undo stack
- `redoStack: TimelineTrack[][]` - Redo stack
- `autoSaveStatus: string`, `isAutoSaving: boolean`, `lastAutoSaveAt: number | null`
- `snappingEnabled: boolean`
- `rippleEditingEnabled: boolean`
- `showEffectsTrack: boolean`
- `selectedElements: { trackId: string; elementId: string }[]`
- `dragState: { isDragging, elementId, trackId, startMouseX, startElementTime, clickOffsetTime, currentTime }`

**Methods (60+ total):**
- Track ops: `addTrack`, `insertTrackAt`, `removeTrack`, `removeTrackWithRipple`
- Element ops: `addElementToTrack`, `removeElementFromTrack`, `moveElementToTrack`
- Update ops: `updateElementTrim`, `updateElementDuration`, `updateElementStartTime`
- Ripple ops: `updateElementStartTimeWithRipple`, `removeElementFromTrackWithRipple`
- Split ops: `splitElement`, `splitAndKeepLeft`, `splitAndKeepRight`, `separateAudio`
- Transform ops: `updateElementTransform`, `updateElementPosition`, `updateElementSize`, `updateElementRotation`
- Text/Media ops: `updateTextElement`, `updateMediaElement`, `replaceElementMedia`
- Selection ops: `selectElement`, `deselectElement`, `clearSelectedElements`, `setSelectedElements`
- Drag ops: `setDragState`, `startDrag`, `updateDragTime`, `endDrag`
- Toggle ops: `toggleSnapping`, `toggleRippleEditing`, `toggleEffectsTrack`, `autoShowEffectsTrack`, `toggleTrackMute`, `toggleElementHidden`
- History ops: `undo`, `redo`, `pushHistory`
- Persistence ops: `loadProjectTimeline`, `saveProjectTimeline`, `saveImmediate`, `clearTimeline`, `restoreTracks`
- Query ops: `getSortedTracks`, `getTotalDuration`, `getProjectThumbnail`, `getAudioElements`, `checkElementOverlap`, `findOrCreateTrack`
- Add convenience: `addMediaAtTime`, `addTextAtTime`, `addMediaToNewTrack`, `addTextToNewTrack`
- Effects ops: `addEffectToElement`, `removeEffectFromElement`, `getElementEffectIds`, `clearElementEffects`

### Module-Level State (Line 355-356)

```typescript
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
```

### Store Implementation (Lines 358-2194) - ~1836 lines

#### Internal Helpers (Lines 358-478)

| Helper | Lines | Purpose |
|--------|-------|---------|
| `updateTracks()` | 360-367 | Ensures main track, sorts, sets state |
| `autoSaveTimeline()` | 369-376 | Captures projectId, calls guarded version |
| `autoSaveTimelineGuarded()` | 378-444 | Project guard, scene ID, actual save |
| `updateTracksAndSave()` | 446-474 | Updates + debounced auto-save |

#### Initial State (Lines 476-498)

```typescript
const initialTracks = ensureMainTrack([]);
const sortedInitialTracks = sortTracksByOrder(initialTracks);
```

#### Methods by Category

| Category | Lines | Count | Key Methods |
|----------|-------|-------|-------------|
| History & Selection | 500-560 | 6 | `pushHistory`, `selectElement`, `deselectElement`, etc. |
| Track Operations | 562-720 | 4 | `addTrack`, `insertTrackAt`, `removeTrack`, `removeTrackWithRipple` |
| Element Operations | 722-1009 | 4 | `addElementToTrack`, `removeElementFromTrack`, `moveElementToTrack`, `removeElementFromTrackWithRipple` |
| Update Operations | 1011-1166 | 4 | `updateElementTrim`, `updateElementDuration`, `updateElementStartTime`, `updateElementStartTimeWithRipple` |
| Toggle Operations | 1168-1193 | 2 | `toggleTrackMute`, `toggleElementHidden` |
| Text/Transform Ops | 1195-1277 | 6 | `updateTextElement`, `updateElementTransform`, etc. |
| Split Operations | 1279-1411 | 4 | `splitElement`, `splitAndKeepLeft`, `splitAndKeepRight` |
| Audio Operations | 1413-1491 | 2 | `getAudioElements`, `separateAudio` |
| Replace Media | 1493-1643 | 1 | `replaceElementMedia` (~150 lines, async) |
| Computed/Query | 1645-1706 | 2 | `getTotalDuration`, `getProjectThumbnail` |
| Undo/Redo | 1708-1714 | 1 | `redo` |
| Drag State | 1716-1772 | 5 | `dragState`, `setDragState`, `startDrag`, `updateDragTime`, `endDrag` |
| Persistence | 1774-1880 | 5 | `loadProjectTimeline`, `saveProjectTimeline`, `saveImmediate`, `clearTimeline`, `restoreTracks` |
| Settings Toggles | 1882-1916 | 4 | `toggleSnapping`, `toggleRippleEditing`, `toggleEffectsTrack`, `autoShowEffectsTrack` |
| Overlap/Track Utils | 1918-1956 | 2 | `checkElementOverlap`, `findOrCreateTrack` |
| Add Convenience | 1958-2061 | 4 | `addMediaAtTime`, `addTextAtTime`, `addMediaToNewTrack`, `addTextToNewTrack` |
| Effects Management | 2063-2192 | 4 | `addEffectToElement`, `removeEffectFromElement`, `getElementEffectIds`, `clearElementEffects` |

---

## Proposed File Structure

### File 1: `stores/timeline/types.ts` (~350 lines)

**Purpose**: All type definitions and pure helper functions

**Contents**:
```typescript
// Re-export timeline types for convenience
export type { TrackType, TimelineElement, CreateTimelineElement, TimelineTrack, TextElement, MediaElement, DragData } from "@/types/timeline";

// Store state interface (subset for operations)
export interface TimelineStoreState {
  _tracks: TimelineTrack[];
  tracks: TimelineTrack[];
  history: TimelineTrack[][];
  redoStack: TimelineTrack[][];
  rippleEditingEnabled: boolean;
  selectedElements: { trackId: string; elementId: string }[];
}

// Full TimelineStore interface (~300 lines)
export interface TimelineStore extends TimelineStoreState {
  // ... all 60+ methods
}

// Pure helper function
export const getElementNameWithSuffix = (
  originalName: string,
  suffix: string
): string => {
  const baseName = originalName
    .replace(/ \(left\)$/, "")
    .replace(/ \(right\)$/, "")
    .replace(/ \(audio\)$/, "")
    .replace(/ \(split \d+\)$/, "");
  return `${baseName} (${suffix})`;
};

// Drag state type
export interface DragState {
  isDragging: boolean;
  elementId: string | null;
  trackId: string | null;
  startMouseX: number;
  startElementTime: number;
  clickOffsetTime: number;
  currentTime: number;
}

// Initial drag state
export const INITIAL_DRAG_STATE: DragState = {
  isDragging: false,
  elementId: null,
  trackId: null,
  startMouseX: 0,
  startElementTime: 0,
  clickOffsetTime: 0,
  currentTime: 0,
};
```

---

### File 2: `stores/timeline/operations.ts` (~700 lines)

**Purpose**: Pure operation functions that can be unit tested

**Design Pattern**: Functions that receive state getter and updater

```typescript
import type { TimelineTrack, TimelineElement, CreateTimelineElement, TrackType } from "@/types/timeline";
import { sortTracksByOrder, ensureMainTrack, validateElementTrackCompatibility } from "@/types/timeline";
import { checkElementOverlaps, resolveElementOverlaps } from "@/lib/timeline";
import { generateUUID } from "@/lib/utils";
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";
import { getElementNameWithSuffix } from "./types";

// Types for operation context
export interface OperationContext {
  getTracks: () => TimelineTrack[];
  pushHistory: () => void;
  updateTracksAndSave: (tracks: TimelineTrack[]) => void;
  isRippleEnabled: () => boolean;
}

// ============== TRACK OPERATIONS ==============

export function createTrack(type: TrackType): TimelineTrack {
  const trackName = type === "media" ? "Media Track"
    : type === "text" ? "Text Track"
    : type === "audio" ? "Audio Track"
    : type === "sticker" ? "Sticker Track"
    : "Track";

  return {
    id: generateUUID(),
    name: trackName,
    type,
    elements: [],
    muted: false,
  };
}

export function addTrackOperation(
  ctx: OperationContext,
  type: TrackType
): string {
  ctx.pushHistory();
  const newTrack = createTrack(type);
  ctx.updateTracksAndSave([...ctx.getTracks(), newTrack]);
  return newTrack.id;
}

export function insertTrackAtOperation(
  ctx: OperationContext,
  type: TrackType,
  index: number
): string {
  ctx.pushHistory();
  const newTrack = createTrack(type);
  const newTracks = [...ctx.getTracks()];
  newTracks.splice(index, 0, newTrack);
  ctx.updateTracksAndSave(newTracks);
  return newTrack.id;
}

export function removeTrackOperation(
  ctx: OperationContext,
  trackId: string
): void {
  if (ctx.isRippleEnabled()) {
    removeTrackWithRippleOperation(ctx, trackId);
  } else {
    ctx.pushHistory();
    ctx.updateTracksAndSave(
      ctx.getTracks().filter((track) => track.id !== trackId)
    );
  }
}

export function removeTrackWithRippleOperation(
  ctx: OperationContext,
  trackId: string
): void {
  // ... ~90 lines of ripple logic
}

// ============== ELEMENT OPERATIONS ==============

export function addElementToTrackOperation(
  ctx: OperationContext,
  trackId: string,
  elementData: CreateTimelineElement,
  callbacks: {
    selectElement: (trackId: string, elementId: string) => void;
    onFirstMediaElement?: (element: TimelineElement) => void;
  }
): void {
  // ... validation and element creation
}

export function removeElementFromTrackOperation(
  ctx: OperationContext,
  trackId: string,
  elementId: string,
  pushHistory: boolean
): void {
  // ... removal logic
}

export function moveElementToTrackOperation(
  ctx: OperationContext,
  fromTrackId: string,
  toTrackId: string,
  elementId: string
): void {
  // ... move logic with validation
}

// ============== SPLIT OPERATIONS ==============

export function splitElementOperation(
  ctx: OperationContext,
  trackId: string,
  elementId: string,
  splitTime: number
): string | null {
  // ... split logic (~50 lines)
}

export function splitAndKeepLeftOperation(
  ctx: OperationContext,
  trackId: string,
  elementId: string,
  splitTime: number
): void {
  // ... keep left logic
}

export function splitAndKeepRightOperation(
  ctx: OperationContext,
  trackId: string,
  elementId: string,
  splitTime: number
): void {
  // ... keep right logic
}

export function separateAudioOperation(
  ctx: OperationContext,
  trackId: string,
  elementId: string
): string | null {
  // ... audio separation logic (~50 lines)
}

// ============== RIPPLE OPERATIONS ==============

export function updateElementStartTimeWithRippleOperation(
  ctx: OperationContext,
  trackId: string,
  elementId: string,
  newStartTime: number,
  updateElementStartTime: (trackId: string, elementId: string, time: number) => void
): void {
  // ... ~90 lines of ripple logic
}

export function removeElementFromTrackWithRippleOperation(
  ctx: OperationContext,
  trackId: string,
  elementId: string,
  pushHistory: boolean
): void {
  // ... ~75 lines of ripple removal
}

// ============== UPDATE OPERATIONS ==============

export function updateElementTrimOperation(
  ctx: OperationContext,
  trackId: string,
  elementId: string,
  trimStart: number,
  trimEnd: number,
  pushHistory: boolean
): void {
  if (pushHistory) ctx.pushHistory();
  ctx.updateTracksAndSave(
    ctx.getTracks().map((track) =>
      track.id === trackId
        ? {
            ...track,
            elements: track.elements.map((element) =>
              element.id === elementId
                ? { ...element, trimStart, trimEnd }
                : element
            ),
          }
        : track
    )
  );
}

// ... similar for updateElementDuration, updateElementStartTime
```

---

### File 3: `stores/timeline-store.ts` (~1150 lines) - Main Store

**Purpose**: Zustand store creation, orchestration, persistence, effects

```typescript
import { create } from "zustand";
import { toast } from "sonner";

// Types
import type { TimelineStore, DragState } from "./timeline/types";
import { INITIAL_DRAG_STATE, getElementNameWithSuffix } from "./timeline/types";
import type { TimelineTrack, TextElement } from "@/types/timeline";
import { sortTracksByOrder, ensureMainTrack } from "@/types/timeline";

// Operations
import {
  addTrackOperation,
  insertTrackAtOperation,
  removeTrackOperation,
  addElementToTrackOperation,
  // ... etc
} from "./timeline/operations";

// External deps
import { useEditorStore } from "./editor-store";
import { useMediaStore, getMediaAspectRatio, type MediaItem } from "./media-store";
import { storageService } from "@/lib/storage/storage-service";
import { createObjectURL } from "@/lib/blob-manager";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";

// Module-level timer for debounced auto-save
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

export const useTimelineStore = create<TimelineStore>((set, get) => {
  // ============== INTERNAL HELPERS ==============

  const updateTracks = (newTracks: TimelineTrack[]) => {
    const tracksWithMain = ensureMainTrack(newTracks);
    const sortedTracks = sortTracksByOrder(tracksWithMain);
    set({ _tracks: tracksWithMain, tracks: sortedTracks });
  };

  const autoSaveTimeline = async () => { /* ... */ };
  const autoSaveTimelineGuarded = async (scheduledProjectId: string) => { /* ... */ };
  const updateTracksAndSave = async (newTracks: TimelineTrack[]) => { /* ... */ };

  // Operation context for extracted functions
  const getOperationContext = () => ({
    getTracks: () => get()._tracks,
    pushHistory: () => get().pushHistory(),
    updateTracksAndSave,
    isRippleEnabled: () => get().rippleEditingEnabled,
  });

  // Initialize
  const initialTracks = ensureMainTrack([]);
  const sortedInitialTracks = sortTracksByOrder(initialTracks);

  return {
    // ============== STATE ==============
    _tracks: initialTracks,
    tracks: sortedInitialTracks,
    history: [],
    redoStack: [],
    autoSaveStatus: "Auto-save idle",
    isAutoSaving: false,
    lastAutoSaveAt: null,
    selectedElements: [],
    rippleEditingEnabled: false,
    snappingEnabled: true,
    showEffectsTrack: typeof window !== "undefined"
      ? localStorage.getItem("timeline-showEffectsTrack") === "true"
      : false,
    dragState: INITIAL_DRAG_STATE,

    // ============== HISTORY ==============
    pushHistory: () => { /* ... */ },
    undo: () => { /* ... */ },
    redo: () => { /* ... */ },

    // ============== TRACK OPERATIONS (delegated) ==============
    addTrack: (type) => addTrackOperation(getOperationContext(), type),
    insertTrackAt: (type, index) => insertTrackAtOperation(getOperationContext(), type, index),
    removeTrack: (trackId) => removeTrackOperation(getOperationContext(), trackId),
    removeTrackWithRipple: (trackId) => removeTrackWithRippleOperation(getOperationContext(), trackId),

    // ============== ELEMENT OPERATIONS (delegated) ==============
    addElementToTrack: (trackId, elementData) => {
      addElementToTrackOperation(getOperationContext(), trackId, elementData, {
        selectElement: get().selectElement,
        onFirstMediaElement: (element) => { /* canvas size logic */ },
      });
    },
    // ... etc

    // ============== SELECTION (inline - simple) ==============
    selectElement: (trackId, elementId, multi = false) => { /* ... */ },
    deselectElement: (trackId, elementId) => { /* ... */ },
    clearSelectedElements: () => set({ selectedElements: [] }),
    setSelectedElements: (elements) => set({ selectedElements: elements }),

    // ============== DRAG STATE (inline - simple) ==============
    setDragState: (dragState) => set((state) => ({ dragState: { ...state.dragState, ...dragState } })),
    startDrag: (elementId, trackId, startMouseX, startElementTime, clickOffsetTime) => { /* ... */ },
    updateDragTime: (currentTime) => { /* ... */ },
    endDrag: () => set({ dragState: INITIAL_DRAG_STATE }),

    // ============== PERSISTENCE (keep in main - async + auto-save coupling) ==============
    loadProjectTimeline: async ({ projectId, sceneId }) => { /* ... */ },
    saveProjectTimeline: async ({ projectId, sceneId }) => { /* ... */ },
    saveImmediate: async () => { /* ... */ },
    clearTimeline: () => { /* ... */ },
    restoreTracks: (tracks) => { /* ... */ },

    // ============== TOGGLES (inline - simple) ==============
    toggleSnapping: () => set((state) => ({ snappingEnabled: !state.snappingEnabled })),
    toggleRippleEditing: () => set((state) => ({ rippleEditingEnabled: !state.rippleEditingEnabled })),
    toggleEffectsTrack: () => { /* ... with localStorage */ },
    autoShowEffectsTrack: () => { /* ... */ },
    toggleTrackMute: (trackId) => { /* ... */ },
    toggleElementHidden: (trackId, elementId) => { /* ... */ },

    // ============== EFFECTS MANAGEMENT (keep in main - auto-save coupling) ==============
    addEffectToElement: (elementId, effectId) => { /* ... */ },
    removeEffectFromElement: (elementId, effectId) => { /* ... */ },
    getElementEffectIds: (elementId) => { /* ... */ },
    clearElementEffects: (elementId) => { /* ... */ },

    // ============== QUERY/COMPUTED (inline - simple) ==============
    getSortedTracks: () => { /* ... */ },
    getTotalDuration: () => { /* ... */ },
    getProjectThumbnail: async (projectId) => { /* ... */ },
    getAudioElements: () => { /* ... */ },
    checkElementOverlap: (trackId, startTime, duration, excludeElementId) => { /* ... */ },
    findOrCreateTrack: (trackType) => { /* ... */ },

    // ============== ADD CONVENIENCE (inline - delegates to other methods) ==============
    addMediaAtTime: (item, currentTime = 0) => { /* ... */ },
    addTextAtTime: (item, currentTime = 0) => { /* ... */ },
    addMediaToNewTrack: (item) => { /* ... */ },
    addTextToNewTrack: (item) => { /* ... */ },

    // ============== COMPLEX ASYNC (keep in main) ==============
    replaceElementMedia: async (trackId, elementId, newFile) => { /* ~150 lines */ },
  };
});

// Re-export types for consumers
export type { TimelineStore } from "./timeline/types";
```

---

## Implementation Challenges & Solutions

### 1. Zustand `get()` / `set()` Coupling

**Problem**: Operations need access to store's `get()` and `set()` functions.

**Solution**: Create an `OperationContext` object that wraps these:

```typescript
const getOperationContext = () => ({
  getTracks: () => get()._tracks,
  pushHistory: () => get().pushHistory(),
  updateTracksAndSave,
  isRippleEnabled: () => get().rippleEditingEnabled,
});
```

### 2. Module-Level `autoSaveTimer`

**Problem**: Timer is module-level, used by `updateTracksAndSave`.

**Solution**: Keep `updateTracksAndSave` in main file since it's tightly coupled to:
- `autoSaveTimer` (module-level)
- `set()` for updating `isAutoSaving`, `autoSaveStatus`
- Dynamic imports (`useProjectStore`, `useSceneStore`)

### 3. Circular Dependencies

**Current**: `timeline-store` → `project-store` (dynamic import)

**Solution**: Dynamic imports are already used, keep them in persistence methods.

### 4. First Element Canvas Size Logic

**Problem**: `addElementToTrack` has complex side effect for first media element.

**Solution**: Pass callback to extracted function:
```typescript
addElementToTrackOperation(ctx, trackId, elementData, {
  onFirstMediaElement: (element) => {
    // Handle canvas size in main store
  },
});
```

### 5. Effects Methods Use `updateTracks` + `autoSaveTimeline`

**Problem**: Effects methods call internal helpers directly.

**Solution**: Keep effects methods in main file since they need:
- `updateTracks` (internal)
- `autoSaveTimeline` (internal)
- `pushHistory` (from `get()`)

---

## Extraction Order (Step by Step)

### Phase 1: Types (~30 min)
1. Create `stores/timeline/types.ts`
2. Move `TimelineStore` interface
3. Move `getElementNameWithSuffix` helper
4. Add `DragState` type and `INITIAL_DRAG_STATE`
5. Run type check: `bun run check-types`

### Phase 2: Simple Operations (~1 hour)
1. Create `stores/timeline/operations.ts`
2. Extract `createTrack` helper
3. Extract `addTrackOperation`, `insertTrackAtOperation`
4. Extract `removeTrackOperation` (simple version)
5. Update main store to use extracted functions
6. Run type check

### Phase 3: Complex Operations (~1.5 hours)
1. Extract `removeTrackWithRippleOperation` (~90 lines)
2. Extract `addElementToTrackOperation` with callbacks
3. Extract `removeElementFromTrackOperation`
4. Extract `moveElementToTrackOperation`
5. Run type check + manual test

### Phase 4: Split & Ripple Operations (~1 hour)
1. Extract split operations (3 functions)
2. Extract `separateAudioOperation`
3. Extract ripple operations (2 functions)
4. Run type check + manual test

### Phase 5: Update Operations (~30 min)
1. Extract `updateElementTrimOperation`
2. Extract `updateElementDurationOperation`
3. Extract `updateElementStartTimeOperation`
4. Run type check

### Phase 6: Cleanup & Testing (~1 hour)
1. Add barrel export `stores/timeline/index.ts`
2. Update any external imports
3. Run full test suite
4. Manual testing in Electron app

---

## Testing Strategy

### Automated Tests
```bash
# Type checking
bun run check-types

# Run all tests
cd qcut/apps/web && bun run test

# Run timeline-specific tests (if any)
bun run test -- timeline
```

### Manual Testing Checklist

| Feature | Test Steps |
|---------|------------|
| Add track | Click "Add Track" in timeline |
| Remove track | Right-click track → Delete |
| Add element | Drag media to timeline |
| Remove element | Select element → Delete key |
| Split element | Position playhead → "S" key |
| Undo/Redo | Ctrl+Z / Ctrl+Shift+Z |
| Ripple edit | Enable ripple → delete element |
| Auto-save | Make changes → check status indicator |
| Load project | Open existing project |

---

## Expected Results

| File | Lines | Purpose |
|------|-------|---------|
| `stores/timeline/types.ts` | ~350 | Types, interfaces, constants |
| `stores/timeline/operations.ts` | ~700 | Pure operation functions |
| `stores/timeline-store.ts` | ~1150 | Main store, persistence, effects |
| **Total** | ~2200 | Similar total, better organization |

### Size Reduction for Main File
- **Before**: 2,194 lines
- **After**: ~1,150 lines
- **Reduction**: ~48%

---

## Benefits

1. **Testability**: Operation functions can be unit tested with mock context
2. **Maintainability**: Clear separation between types, operations, and orchestration
3. **Code Navigation**: Find track operations in `operations.ts`, types in `types.ts`
4. **Merge Conflicts**: Reduced when multiple developers work on different areas
5. **Reusability**: Operations could be reused in other contexts (e.g., testing)

---

## Rollback Plan

1. All changes in single branch: `refactor/timeline-store-split`
2. Each phase committed separately for easy partial rollback
3. Keep original file backed up until fully tested
4. If critical issues found: `git revert` the merge commit

---

## Files to Update After Refactoring

These files import from `timeline-store.ts`:

```bash
# Find all imports
grep -r "from.*timeline-store" --include="*.ts" --include="*.tsx"
```

Most imports use `useTimelineStore` which will still be exported from main file.
Type imports may need updating to `from "./timeline/types"`.

---

*Document created: 2025-12-11*
*Last updated: 2025-12-11*
*Status: Planning phase - Ready for implementation*
