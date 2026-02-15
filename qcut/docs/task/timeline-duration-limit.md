# Timeline Duration Limit: Why 2 Minutes 8 Seconds?

## The Problem

The QCut timeline currently maxes out at approximately **2 minutes and 8 seconds (128 seconds)**. You can't scroll, place elements, or see time beyond this point — even though there is no explicit "max duration" constant set to 128 seconds anywhere in the code.

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

| Value | Calculation |
|-------|-------------|
| Scale | 50 px/second |
| Browser cap | ~6,400 px max scrollable width |
| **Max duration** | **6,400 / 50 = 128 seconds = 2m 8s** |

At the default zoom level (1x), the timeline width for 128 seconds = `128 * 50 = 6,400px`. Beyond that, the scroll container can't scroll further — the content is effectively clipped.

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

## Why Zoom Makes It Worse (or Better)

The width formula includes `* zoomLevel`:

- **Zoom in (2x)**: `50 * 2 = 100 px/s` — max visible duration drops to ~64 seconds
- **Zoom out (0.25x)**: `50 * 0.25 = 12.5 px/s` — max visible duration rises to ~512 seconds

But this is a workaround, not a fix — zooming out makes the timeline too compressed to edit precisely.

## Data Flow Summary

```
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

## Potential Fixes

1. **Reduce PIXELS_PER_SECOND** — e.g., 10px/s would allow 640 seconds, but makes the timeline too sparse to edit
2. **Use CSS transform/scale** instead of pixel width — render a smaller DOM element and use `transform: scaleX()` for zoom, avoiding the browser width limit
3. **Virtual scrolling** — only render the visible portion of the timeline (like how large lists work), dynamically computing which time markers and elements are in view
4. **Canvas-based rendering** — draw the timeline on a `<canvas>` element instead of DOM nodes, which doesn't have the same width constraints
5. **Reduce ruler div width + use scroll offset** — keep the DOM element at a reasonable width but translate the "visible window" position, similar to how map applications work

## Files Involved

| File | Role |
|------|------|
| `apps/web/src/constants/timeline-constants.ts` | `PIXELS_PER_SECOND = 50`, duration utilities |
| `apps/web/src/components/editor/timeline/index.tsx` | `dynamicTimelineWidth` calculation, duration update effect |
| `apps/web/src/stores/playback-store.ts` | Stores `duration`, playback tick loop |
| `apps/web/src/stores/timeline-store.ts` | `getTotalDuration()` computation |
| `apps/web/src/components/ui/scroll-area.tsx` | Radix ScrollArea wrapper |
| `apps/web/src/hooks/use-timeline-playhead.ts` | Uses `scrollWidth` for auto-scroll |
