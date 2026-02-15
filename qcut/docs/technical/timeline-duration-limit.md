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

## Recommended Fix: Replace Radix ScrollArea with Native Scroll

The core issue is the Radix ScrollArea's ~6,400px cap. Native browser `overflow: auto` containers can handle much larger content widths (tested up to millions of pixels in modern browsers).

### Step 1: Replace Radix ScrollArea with native scrollable div

**File**: `apps/web/src/components/editor/timeline/index.tsx`

Replace the `<ScrollArea>` wrapper around the timeline with a plain `<div>` using `overflow-x: auto`:

```tsx
// Before
<ScrollArea className="...">
  <div style={{ width: dynamicTimelineWidth }}>
    {/* timeline content */}
  </div>
</ScrollArea>

// After
<div ref={scrollContainerRef} className="overflow-x-auto overflow-y-hidden" style={{ position: 'relative' }}>
  <div style={{ width: dynamicTimelineWidth }}>
    {/* timeline content */}
  </div>
</div>
```

### Step 2: Verify dynamicTimelineWidth supports 2 hours

At default zoom (1x) with 50px/s: `7,200 * 50 = 360,000px`. Native scroll handles this fine.

No changes needed to the width calculation — it already computes the correct value. The only bottleneck was Radix ScrollArea capping the scrollable range.

### Step 3: Update scroll-related hooks

**File**: `apps/web/src/hooks/use-timeline-playhead.ts`

This hook reads `scrollWidth` for auto-scroll during playback. Update it to reference the new native scroll container ref instead of the Radix ScrollArea viewport:

- Replace any `scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')` with the direct `scrollContainerRef`
- The `scrollLeft`, `scrollWidth`, and `clientWidth` APIs work the same on native divs

### Step 4: Preserve custom scrollbar styling (optional)

If the Radix ScrollArea was providing styled scrollbars, add CSS to replicate it:

```css
.timeline-scroll::-webkit-scrollbar {
  height: 8px;
}
.timeline-scroll::-webkit-scrollbar-track {
  background: hsl(var(--muted));
}
.timeline-scroll::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 4px;
}
```

### Step 5: Validate zoom behavior

At all zoom levels, the formula `duration * PIXELS_PER_SECOND * zoomLevel` should produce correct widths:

| Zoom | px/s | 2-hour width | Editable? |
|------|------|-------------|-----------|
| 0.1x | 5 | 36,000px | Coarse overview |
| 0.25x | 12.5 | 90,000px | Section-level |
| 0.5x | 25 | 180,000px | Clip-level |
| 1x | 50 | 360,000px | Frame-level |
| 2x | 100 | 720,000px | Precise |

All within native scroll capability.

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/src/components/editor/timeline/index.tsx` | Replace `<ScrollArea>` with native `<div overflow-x-auto>` |
| `apps/web/src/hooks/use-timeline-playhead.ts` | Update scroll container reference |
| `apps/web/src/components/ui/scroll-area.tsx` | No change (keep for use elsewhere) |
| `apps/web/src/constants/timeline-constants.ts` | No change needed |
| `apps/web/src/stores/timeline-store.ts` | No change needed |
| `apps/web/src/stores/playback-store.ts` | No change needed |

## What NOT to Do

- **Don't reduce `PIXELS_PER_SECOND`** — makes the timeline too sparse to edit at normal zoom
- **Don't implement virtual scrolling** — adds major complexity and the native scroll approach is simpler and sufficient
- **Don't switch to canvas rendering** — massive rewrite for a problem solvable with a div swap
- **Don't add a hardcoded max duration** — the computed duration system already works correctly
