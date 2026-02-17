# Fix Sticker Zoom/Stretch/Move in Video Preview

## Problem Statement

Stickers in the video preview should be zoomable (stretch larger/smaller) and movable to any location. The code for drag and resize exists but has **critical bugs** that make the experience unreliable:

1. **Resize uses `window.innerWidth/Height` instead of canvas dimensions** — resize delta is wildly inaccurate when the canvas is smaller than the window
2. **Default sticker size is tiny (8%)** — user must immediately resize after adding
3. **No scroll-wheel zoom** — common UX pattern missing entirely
4. **Edge handles hidden when sticker < 15%** — small stickers can't be stretched on a single axis
5. **Resize allows sticker to overflow canvas bounds** — no boundary clamping during resize
6. **No double-click to reset size** — no quick way to restore original dimensions *(out of scope for this task — tracked separately)*

---

## Implementation Plan

**Estimated Total Time**: ~30 minutes (4 subtasks)

---

### Subtask 1: Fix Resize Delta Calculation (10 min)

**Objective**: Resize handles should calculate delta as percentage of the **canvas**, not the window.

**Files to Modify**:
- `apps/web/src/components/editor/stickers-overlay/ResizeHandles.tsx`

**Root Cause**: Lines 58-59 use `window.innerWidth/innerHeight`:
```typescript
// BUG: Uses window dimensions instead of canvas
const deltaXPercent = (deltaX / window.innerWidth) * 100;
const deltaYPercent = (deltaY / window.innerHeight) * 100;
```

**Fix**: Pass `canvasRef` to ResizeHandles and use canvas `getBoundingClientRect()`:
```typescript
// ResizeHandles needs canvasRef prop
interface ResizeHandlesProps {
  stickerId: string;
  isVisible: boolean;
  sticker: OverlaySticker;
  elementRef: React.RefObject<HTMLDivElement>;
  canvasRef: React.RefObject<HTMLDivElement>;  // ADD THIS
}

// In calculateNewSize, use canvas dimensions
const canvasRect = canvasRef.current?.getBoundingClientRect();
const canvasWidth = canvasRect?.width ?? window.innerWidth;
const canvasHeight = canvasRect?.height ?? window.innerHeight;
const deltaXPercent = (deltaX / canvasWidth) * 100;
const deltaYPercent = (deltaY / canvasHeight) * 100;
```

**Also update** the parent to pass `canvasRef`:
- `apps/web/src/components/editor/stickers-overlay/StickerElement.tsx` (line 149-154)

**Test**: `apps/web/src/components/editor/stickers-overlay/__tests__/ResizeHandles.test.ts`
- Verify resize delta uses canvas dimensions
- Verify resize with small canvas produces correct percentages

---

### Subtask 2: Add Scroll-Wheel Zoom for Stickers (10 min)

**Objective**: Selected sticker scales up/down with mouse scroll wheel.

**Files to Modify**:
- `apps/web/src/components/editor/stickers-overlay/StickerElement.tsx`

**Changes**:
1. Add `onWheel` handler to selected sticker element
2. Scale width/height proportionally based on scroll delta
3. Respect min/max constraints (5-100%)

**Implementation**:
```typescript
// In StickerElement component
const handleWheel = useCallback((e: React.WheelEvent) => {
  if (!isSelected) return;
  e.preventDefault();
  e.stopPropagation();

  // Scale factor: scroll up = larger, scroll down = smaller
  const scaleDelta = e.deltaY < 0 ? 1.05 : 0.95;
  const newWidth = Math.max(5, Math.min(100, sticker.size.width * scaleDelta));
  const newHeight = Math.max(5, Math.min(100, sticker.size.height * scaleDelta));

  updateOverlaySticker(sticker.id, {
    size: { width: newWidth, height: newHeight },
  });
}, [isSelected, sticker, updateOverlaySticker]);
```

Add `onWheel={handleWheel}` to the sticker `<div>` element (line 124).

**Test**: `apps/web/src/components/editor/stickers-overlay/__tests__/StickerElement.test.ts`
- Verify scroll up increases size
- Verify scroll down decreases size
- Verify min/max constraints respected
- Verify only selected sticker responds to scroll

---

### Subtask 3: Increase Default Size and Always Show Corner Handles (5 min)

**Objective**: New stickers are large enough to interact with immediately. Corner handles always visible on selection.

**Files to Modify**:
- `apps/web/src/stores/stickers-overlay-store.ts` — change default size
- `apps/web/src/components/editor/stickers-overlay/ResizeHandles.tsx` — always show edge handles

**Changes**:

1. **Default size 8% → 15%** (`stickers-overlay-store.ts`, line ~24):
```typescript
// Before
const DEFAULT_STICKER_SIZE = 8;
// After
const DEFAULT_STICKER_SIZE = 15;
```

2. **Always show edge handles** — remove the `> 15` conditional (`ResizeHandles.tsx`, line 261):
```typescript
// Before
{sticker.size.width > 15 && sticker.size.height > 15 && (
// After — always show edge handles when selected
{(
```

**Test**: Verify via existing sticker tests that default size is 15%.

---

### Subtask 4: Clamp Resize to Canvas Bounds (5 min)

**Objective**: Resize handles should not allow sticker to extend past canvas edges.

**Files to Modify**:
- `apps/web/src/components/editor/stickers-overlay/ResizeHandles.tsx`

**Changes**: After calculating new size (line 124-128), add boundary clamping that accounts for sticker position:

```typescript
// After existing min/max constraints, add canvas boundary clamping
// Ensure sticker doesn't extend past canvas edges
// (position is center-based, so check position ± size/2)
const maxWidth = Math.min(100, newX * 2, (100 - newX) * 2);
const maxHeight = Math.min(100, newY * 2, (100 - newY) * 2);
newWidth = Math.max(5, Math.min(maxWidth, newWidth));
newHeight = Math.max(5, Math.min(maxHeight, newHeight));
```

**Test**: `apps/web/src/components/editor/stickers-overlay/__tests__/ResizeHandles.test.ts`
- Verify sticker at edge (90%, 50%) can't resize beyond canvas right
- Verify sticker at center (50%, 50%) can resize to full width

---

## Files Summary

### Modified Files

| File | Change | Lines |
|------|--------|-------|
| `apps/web/src/components/editor/stickers-overlay/ResizeHandles.tsx` | Fix delta calc, add canvasRef, boundary clamp, always show edges | 14-18, 58-59, 124-128, 261 |
| `apps/web/src/components/editor/stickers-overlay/StickerElement.tsx` | Pass canvasRef to ResizeHandles, add onWheel handler | 149-154, new handler |
| `apps/web/src/stores/stickers-overlay-store.ts` | Increase default sticker size | ~24 |

### New/Updated Test Files

| File | Purpose |
|------|---------|
| `apps/web/src/components/editor/stickers-overlay/__tests__/ResizeHandles.test.ts` | Delta calc, boundary clamping |
| `apps/web/src/components/editor/stickers-overlay/__tests__/StickerElement.test.ts` | Scroll-wheel zoom |

---

## What Already Works (No Changes Needed)

- **Drag/move**: `useStickerDrag.ts` — properly calculates position as % of canvas, boundary-clamped
- **Corner resize handles**: Work correctly (just delta calculation is wrong)
- **Aspect ratio preservation**: Shift key + `maintainAspectRatio` flag both work
- **Touch support**: Single-touch drag works via synthetic mouse events
- **Export pipeline**: Percentage → pixel conversion in `sticker-sources.ts` is correct
- **Undo/redo**: Full history for position and size changes

---

## Success Criteria

1. Drag sticker to any position on canvas — sticker stays within bounds
2. Corner/edge resize handles resize accurately (1:1 with mouse movement on canvas)
3. Scroll wheel on selected sticker scales proportionally
4. New stickers appear at visible size (15% default)
5. Resize cannot push sticker outside canvas bounds
6. All existing sticker tests pass
