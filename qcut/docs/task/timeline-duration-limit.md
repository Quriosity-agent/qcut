# Timeline Duration Limit: Extending to 2 Hours

## Current Problem

The QCut timeline currently maxes out at approximately **2 minutes and 8 seconds (128 seconds)**. You can't scroll, place elements, or see time beyond this point — even though there is no explicit "max duration" constant set to 128 seconds anywhere in the code.

## Target

Support timelines up to **2 hours (7,200 seconds)**.

## Root Cause

This is **not** an intentional limit. It's an emergent constraint caused by the interaction between three things:

### 1. Pixel-per-second scale = 50px/s

In `apps/web/src/constants/timeline-constants.ts:129`:

```ts
PIXELS_PER_SECOND: 50
```

Every second of timeline content maps to **50 pixels** of width.

### 2. Timeline width is set in pixels via inline style

In `apps/web/src/components/editor/timeline/index.tsx:109-115`:

```ts
const dynamicTimelineWidth = Math.max(
  (duration || 0) * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel,
  (currentTime + dynamicBuffer) * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel,
  timelineRef.current?.clientWidth || 1000
);
```

This creates a `<div>` with `style={{ width: ${dynamicTimelineWidth}px }}` — the timeline container is sized in raw pixels.

### 3. Radix ScrollArea + browser rendering cap

The timeline is wrapped in a **Radix UI ScrollArea** (`apps/web/src/components/ui/scroll-area.tsx`). Radix's internal viewport uses `scrollWidth` to determine if scrolling is needed. Browsers impose rendering limits on element widths — typically around **6,400px** for certain scroll container implementations.

## The Math

### Current limit (2m 8s)

| Value | Calculation |
|-------|-------------|
| Scale | 50 px/second |
| Browser cap | ~6,400 px max scrollable width |
| **Max duration** | **6,400 / 50 = 128 seconds = 2m 8s** |

### 2-hour target (7,200s)

At 50px/s: `7,200 * 50 = 360,000px` — far beyond any browser limit. Reducing `PIXELS_PER_SECOND` alone won't work: `6,400 / 7,200 ≈ 0.89 px/s` which is too small to edit.

## How Duration is Calculated

The timeline duration isn't hardcoded — it's **computed from content**:

1. **`getTotalDuration()`** (`apps/web/src/stores/timeline-store.ts:787-803`) finds the latest element endpoint across all tracks
2. **`calculateMinimumTimelineDuration()`** (`apps/web/src/constants/timeline-constants.ts:197-208`) ensures at least 600 seconds (10 minutes) for empty timelines
3. **`setDuration()`** in the playback store (`apps/web/src/stores/playback-store.ts:227-228`) stores this value
4. The timeline `useEffect` (`apps/web/src/components/editor/timeline/index.tsx:316-319`) updates duration whenever tracks change:

```ts
useEffect(() => {
  const totalDuration = getTotalDuration();
  setDuration(calculateMinimumTimelineDuration(totalDuration));
}, [tracks, setDuration, getTotalDuration]);
```

So the **duration value itself** can be 600s (10 minutes) or more — the problem is that the **visual timeline** can only render ~128 seconds worth of pixels at default zoom before hitting the scroll container's width limit.

## Data Flow Summary

```text
Track elements (startTime + duration)
    ↓
getTotalDuration() → finds latest end time
    ↓
calculateMinimumTimelineDuration() → ensures ≥ 600s
    ↓
setDuration() → stored in playback-store
    ↓
dynamicTimelineWidth = duration * 50 * zoomLevel → pixel width
    ↓
<div style={{ width: dynamicTimelineWidth }}> → rendered in DOM
    ↓
Radix ScrollArea → scrollWidth capped by browser (~6400px)
    ↓
Cannot scroll past 128 seconds at 1x zoom
```

---

## Implementation Plan

**Estimated total time**: ~30 minutes → broken into subtasks.

### Subtask 1: Replace Radix ScrollArea with native scroll in ruler and tracks (~10 min)

**File**: `apps/web/src/components/editor/timeline/index.tsx`

Replace the two timeline-related `<ScrollArea>` usages (ruler at line 485 and tracks at line 737) with native `<div>` elements using `overflow-x: auto`. The track labels `<ScrollArea>` (line 680) stays as-is — it's not affected by the width cap.

**Changes**:
- **Ruler** (line 485-667): Replace `<ScrollArea className="w-full" ref={rulerScrollRef}>` with `<div ref={rulerScrollRef} className="w-full overflow-x-auto overflow-y-hidden">`
- **Tracks** (line 737-854): Replace `<ScrollArea className="w-full h-full" ref={tracksScrollRef} type="scroll" showHorizontalScrollbar>` with `<div ref={tracksScrollRef} className="w-full h-full overflow-x-auto overflow-y-auto">`
- Remove the `ScrollArea` import if no longer used (but it's still needed for track labels)
- **Scroll sync** (lines 324-400): Remove all `querySelector('[data-radix-scroll-area-viewport]')` calls and use refs directly (`rulerScrollRef.current`, `tracksScrollRef.current`) since the ref will now point to the scroll container itself
- **Click-to-seek** (lines 270-286): Same — replace `querySelector('[data-radix-scroll-area-viewport]')` with direct ref access

**Why native scroll works**: Native browser `overflow: auto` containers can handle widths up to millions of pixels in Chromium. At 2 hours/1x zoom = 360,000px — well within capability.

### Subtask 2: Update scroll references in playhead hook (~5 min)

**File**: `apps/web/src/hooks/use-timeline-playhead.ts`

Three locations use `querySelector('[data-radix-scroll-area-viewport]')` to find the scroll container:

1. **`performAutoScroll`** (lines 116-121): Change to use `rulerScrollRef.current` and `tracksScrollRef.current` directly
2. **Auto-scroll during playback** (lines 239-244): Same change
3. Hardcoded `* 50 * zoomLevel` references are fine — they match `TIMELINE_CONSTANTS.PIXELS_PER_SECOND`

### Subtask 3: Update scroll references in playhead component (~5 min)

**File**: `apps/web/src/components/editor/timeline/timeline-playhead.tsx`

Two locations:

1. **Scroll tracking useEffect** (line 54): Change `tracksScrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')` to `tracksScrollRef.current` with fallback
2. **Viewport width calculation** (lines 89-92): Same change

### Subtask 4: Update scroll reference in snap indicator (~2 min)

**File**: `apps/web/src/components/editor/snap-indicator.tsx`

One location:

1. **Scroll tracking useEffect** (line 31): Change `tracksScrollRef.current?.querySelector('[data-radix-scroll-area-viewport]')` to `tracksScrollRef.current`

### Subtask 5: Add custom scrollbar CSS (~3 min)

**File**: `apps/web/src/index.css` (or equivalent global CSS)

Radix provided styled scrollbars. Add webkit scrollbar CSS to replicate the look on the native divs:

```css
.timeline-scroll::-webkit-scrollbar {
  height: 8px;
  width: 8px;
}
.timeline-scroll::-webkit-scrollbar-track {
  background: hsl(var(--muted));
}
.timeline-scroll::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 4px;
}
```

Apply `timeline-scroll` class to the ruler and tracks native scroll containers.

### Subtask 6: Unit tests for timeline constants (~5 min)

**File**: `apps/web/src/constants/__tests__/timeline-constants.test.ts` (new)

No tests currently exist for `timeline-constants.ts`. Add tests to validate:

- `calculateMinimumTimelineDuration()` returns ≥600s for empty/zero/invalid durations
- `calculateMinimumTimelineDuration()` returns content duration when > 600s
- `calculateTimelineBuffer()` returns ≥5s minimum
- `calculateTimelineBuffer()` returns 10% for large durations
- `snapTimeToFrame()` returns correct frame-snapped values
- `snapTimeToFrame()` handles invalid FPS gracefully
- Validate that `dynamicTimelineWidth` formula produces correct pixel values for 2-hour timelines at each zoom level

---

## Files Summary

| File | Change | Subtask |
|------|--------|---------|
| `apps/web/src/components/editor/timeline/index.tsx` | Replace ruler + tracks `<ScrollArea>` with native `<div overflow-x-auto>`; update all `querySelector('[data-radix-scroll-area-viewport]')` to direct ref access | 1 |
| `apps/web/src/hooks/use-timeline-playhead.ts` | Replace 3× `querySelector('[data-radix-scroll-area-viewport]')` with direct ref access | 2 |
| `apps/web/src/components/editor/timeline/timeline-playhead.tsx` | Replace 2× `querySelector('[data-radix-scroll-area-viewport]')` with direct ref access | 3 |
| `apps/web/src/components/editor/snap-indicator.tsx` | Replace 1× `querySelector('[data-radix-scroll-area-viewport]')` with direct ref access | 4 |
| `apps/web/src/index.css` | Add custom scrollbar styles for `.timeline-scroll` | 5 |
| `apps/web/src/constants/__tests__/timeline-constants.test.ts` | New test file for duration/buffer/snap utilities | 6 |

## What NOT to Do

- **Don't reduce `PIXELS_PER_SECOND`** — makes the timeline too sparse to edit at normal zoom
- **Don't implement virtual scrolling** — adds major complexity and the native scroll approach is simpler and sufficient
- **Don't switch to canvas rendering** — massive rewrite for a problem solvable with a div swap
- **Don't add a hardcoded max duration** — the computed duration system already works correctly
- **Don't modify `scroll-area.tsx`** — it's still used elsewhere (track labels, media panel, etc.)

## Verification

After implementation, verify:

1. Empty timeline renders 10 minutes of scrollable area
2. Can place an element at 1 hour and scroll to it
3. Playhead scrubbing/seeking works at any position
4. Auto-scroll during playback works past 128s
5. Zoom in/out works correctly at all levels
6. Scroll sync between ruler and tracks is maintained
7. Snap indicator tracks scroll position correctly
8. Custom scrollbar appearance matches design
9. `bun run test` passes
10. `bun check-types` passes
