# Refactoring Plan: timeline/index.tsx

**File**: `apps/web/src/components/editor/timeline/index.tsx`  
**Current Size**: ~1,538 lines  
**Target Size**: ~800 lines (main) + extracted modules  
**Status**: PENDING  
**Priority**: High (large, highly interactive UI component)

---

## Goals

- Reduce file size and cognitive load by separating concerns (handlers vs UI).
- Preserve current behavior, store wiring, and DOM/test selectors.
- Make high-risk logic (DnD, scroll sync, click-to-seek) easier to reason about and change safely.

## Non-goals

- No UX changes, visual redesign, or feature additions.
- No store API refactors (`useTimelineStore`, `usePlaybackStore`, etc.).
- No performance “optimizations” unless they are necessary for correctness (e.g., preventing loops).

---

## Current Structure (quick map)

Key anchors in the current file (approximate line numbers):

- `export function Timeline()` (~82): main component
- Selection + click-to-seek handlers (~180–350)
- Drag & drop handling (~360–520)
- Scroll synchronization `useEffect` (~540–615)
- Ruler UI and time markers (~680–820)
- Timeline content (tracks + context menu + effects) (~820–1040)
- `function TrackIcon(...)` (~1049)
- `function TimelineToolbar(...)` (~1060+) (large internal component)

Notable existing extractions already in place:

- `useTimelinePlayheadRuler` and `TimelinePlayhead` in `apps/web/src/components/editor/timeline/timeline-playhead.tsx`
- Track rendering in `apps/web/src/components/editor/timeline/timeline-track.tsx`
- Selection box logic via `useSelectionBox` / `SelectionBox`

---

## Constraints / Invariants to Preserve

- **Store selector pattern:** The file intentionally uses many individual `useTimelineStore((s) => s.foo)` selectors to avoid `useSyncExternalStore` infinite-loop issues. Keep this pattern in extracted components/modules (especially toolbar).
- **ScrollArea DOM shape:** Scroll sync code queries `[data-radix-scroll-area-viewport]`; keep the same structure/refs when extracting ruler/tracks.
- **DnD MIME types:** Preserve `application/x-media-item` and `application/x-timeline-element` semantics.
- **Test selectors:** Preserve `data-testid="timeline-toolbar"` and any other data attributes used elsewhere.
- **Frame snapping:** Click-to-seek uses `snapTimeToFrame(rawTime, activeProject?.fps || 30)`; keep exact behavior.

---

## Recommended Split (from TOP-10-LARGE-FILES.md)

### 1) `timeline-handlers.ts` (event handlers)

Move event logic out of the render path:

- Timeline background mouse tracking (`mouseTrackingRef`) + click-to-seek
- Drag enter/leave/over/drop logic, including:
  - Dropping existing media items
  - Dropping text/stickers
  - Dropping external files and calling `processMediaFiles`
- Scroll synchronization effect (either here or via a small `useTimelineScrollSync(...)` exported from this module)

Suggested exports (shape, not final API):

- `useTimelineBackgroundClickHandlers({ ...deps })`
- `useTimelineDragAndDrop({ ...deps })`
- `useTimelineScrollSync({ rulerScrollRef, tracksScrollRef, trackLabelsScrollRef })`

Notes:

- Keep `try/catch` blocks and user-facing errors via `toast`.
- Consider eliminating `await` inside loops in the drop-file path (`for ... of processedItems`) if safe; otherwise document why sequential ordering is required.

### 2) `timeline-toolbar.tsx` (toolbar UI)

Extract the internal `TimelineToolbar` (and `TrackIcon`) into its own file:

- Keep the public props the same (`zoomLevel`, `setZoomLevel`).
- Keep store selectors local in the toolbar to avoid passing many props and to avoid stale closures.
- Preserve `data-testid="timeline-toolbar"`.

### 3) `timeline-ruler.tsx` (ruler component)

Extract the “Timeline Header with Ruler” block:

- The ruler container (`data-ruler-area`) + wheel handling
- `ScrollArea` + `rulerRef` + `dynamicTimelineWidth`
- `TimelineCacheIndicator`
- Time marker rendering logic:
  - Extract pure helpers for `getTimeInterval(...)` and `formatTime(...)` (optional: `timeline-ruler-utils.ts`)
- Keep wiring for:
  - `onMouseDown={handleSelectionMouseDown}`
  - `onMouseDown={handleRulerMouseDown}` (on ruler content)
  - `onClick={handleTimelineContentClick}`

### 4) `timeline/index.tsx` (main component)

Keep as the orchestrator:

- Store wiring needed for composition
- `<TimelineToolbar />`, `<TimelineRuler />`
- Track labels + track content layout
- `<TimelinePlayhead />`, `<SnapIndicator />`, `<SelectionBox />`, `<EffectsTimeline />`

---

## Suggested File Layout (within `apps/web/src/components/editor/timeline/`)

```text
timeline/
  index.tsx                 # main component (reduced)
  timeline-handlers.ts      # DnD + click-to-seek + scroll sync
  timeline-toolbar.tsx      # TimelineToolbar + TrackIcon
  timeline-ruler.tsx        # Ruler UI + time markers + cache indicator
  timeline-ruler-utils.ts   # (optional) getTimeInterval/formatTime helpers
```

---

## Implementation Checklist (safe sequencing)

1. Extract `TimelineToolbar` + `TrackIcon` into `timeline-toolbar.tsx`; keep props + `data-testid` unchanged.
2. Extract ruler block into `timeline-ruler.tsx`; keep refs and DOM structure stable.
3. Extract handlers into `timeline-handlers.ts` as hooks returning stable callbacks/props; update `index.tsx` to use them.
4. Ensure the scroll sync effect remains attached exactly once and cleans up correctly.

---

## Verification Checklist

- Drag existing media from library onto timeline creates a new track element.
- Drag text onto timeline creates a new text track element.
- Drag sticker onto timeline downloads and inserts it (with correct media store behavior).
- Drag external files onto timeline processes files, adds to media store, then adds to new tracks.
- Selection box works and does not interfere with click-to-seek.
- Clicking empty timeline area clears selection; clicking ruler/tracks seeks with frame snapping.
- Horizontal scroll sync between ruler and tracks; vertical scroll sync between labels and tracks.
- Toolbar actions still work: play/pause, split, split-keep-left/right, duplicate, delete, zoom, bookmark, effects toggle.

