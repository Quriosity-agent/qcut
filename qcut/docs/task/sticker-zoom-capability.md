# Sticker Zoom/Stretch/Move — Analysis & Implementation Plan

## Problem Statement

Stickers in the video preview should be zoomable (stretch larger/smaller) and freely movable. The architecture exists (percentage-based positioning, 8 resize handles, drag hook) but has **critical bugs** making it unreliable in practice.

---

## Current Architecture

### Data Model

```typescript
// OverlaySticker (store) — apps/web/src/types/sticker-overlay.ts
{
  id: string;
  mediaItemId: string;
  position: { x: number; y: number };       // % of canvas (0-100)
  size: { width: number; height: number };   // % of canvas (0-100)
  rotation: number;                          // degrees (0-360)
  opacity: number;                           // 0-1
  zIndex: number;
  maintainAspectRatio: boolean;
  timing?: { startTime?: number; endTime?: number };
}

// StickerSource (FFmpeg export) — electron/ffmpeg/types.ts
{
  id: string;
  path: string;
  x: number; y: number;           // pixels (top-left)
  width: number; height: number;  // pixels
  startTime: number; endTime: number;
  zIndex: number;
  opacity?: number;
  rotation?: number;
}
```

### Key Files

| Area | File Path | Key Lines |
|------|-----------|-----------|
| Store & constraints | `apps/web/src/stores/stickers-overlay-store.ts` | 24 (default size), 236-291 (update), 266-274 (validation) |
| Drag hook | `apps/web/src/components/editor/stickers-overlay/hooks/useStickerDrag.ts` | 53-87 (position calc), 92-129 (mousedown), 134-151 (mousemove) |
| Resize handles | `apps/web/src/components/editor/stickers-overlay/ResizeHandles.tsx` | 44-133 (size calc), 155-227 (resize start), 58-59 (**BUG**) |
| Sticker element | `apps/web/src/components/editor/stickers-overlay/StickerElement.tsx` | 110-121 (style), 46-51 (click), 68-108 (media render) |
| Sticker controls | `apps/web/src/components/editor/stickers-overlay/StickerControls.tsx` | 48-51 (delete), 56-67 (duplicate), 72-77 (rotate), 82-86 (opacity) |
| Canvas container | `apps/web/src/components/editor/stickers-overlay/StickerCanvas.tsx` | 122-170 (drop handler), 300 (visible filter) |
| Export conversion | `apps/web/src/lib/export-cli/sources/sticker-sources.ts` | 191-200 (% → pixel) |
| FFmpeg filters | `apps/web/src/lib/export-cli/filters/sticker-overlay.ts` | 52-86 (scale/rotate/overlay) |
| Sticker types | `apps/web/src/types/sticker-overlay.ts` | 13-57 (OverlaySticker type) |

### What Already Works

| Feature | Status | File |
|---------|--------|------|
| Drag/move with boundary clamping | Working | `useStickerDrag.ts` |
| Corner resize handles (4) | Working (but delta calc is wrong) | `ResizeHandles.tsx` |
| Edge resize handles (4) | Working (hidden when small) | `ResizeHandles.tsx:261` |
| Aspect ratio preservation | Working (Shift key toggle) | `ResizeHandles.tsx:99-122` |
| Touch drag support | Working | `useStickerDrag.ts:239-278` |
| Delete/duplicate/rotate/opacity | Working | `StickerControls.tsx` |
| Layer management (z-index) | Working | `stickers-overlay-store.ts:314-331` |
| Undo/redo (50 entries) | Working | `stickers-overlay-store.ts:407-441` |
| Export % → pixel conversion | Working | `sticker-sources.ts:191-200` |
| FFmpeg scale/rotate/overlay filters | Working | `sticker-overlay.ts:52-86` |

---

## Bugs Found

| # | Bug | File | Line | Impact |
|---|-----|------|------|--------|
| 1 | **Resize delta uses `window.innerWidth/Height`** instead of canvas dimensions | `ResizeHandles.tsx` | 58-59 | Resize wildly inaccurate — 1px mouse move ≠ 1% of canvas |
| 2 | **Default sticker size is 8%** — too small to see or interact with | `stickers-overlay-store.ts` | 24 | User must resize immediately after adding |
| 3 | **No scroll-wheel zoom** — standard UX pattern missing | `StickerElement.tsx` | — | No quick zoom, only drag handles |
| 4 | **Edge handles hidden when sticker < 15%** | `ResizeHandles.tsx` | 261 | Small stickers can't be stretched on single axis |
| 5 | **Resize allows canvas overflow** — no boundary clamping | `ResizeHandles.tsx` | 124-128 | Sticker extends past canvas edges |

---

## Implementation Plan

**Estimated Total Time**: ~30 minutes (4 subtasks)

---

### Subtask 1: Fix Resize Delta Calculation (10 min)

**Objective**: Resize handles calculate delta as percentage of the **canvas**, not the window.

**Files to Modify**:
- `apps/web/src/components/editor/stickers-overlay/ResizeHandles.tsx` — add `canvasRef` prop, fix delta calc
- `apps/web/src/components/editor/stickers-overlay/StickerElement.tsx` — pass `canvasRef` to `ResizeHandles`

**Root Cause** (`ResizeHandles.tsx:58-59`):
```typescript
// BUG: window dimensions ≠ canvas dimensions
const deltaXPercent = (deltaX / window.innerWidth) * 100;
const deltaYPercent = (deltaY / window.innerHeight) * 100;
```

**Fix**:
```typescript
// ResizeHandlesProps — add canvasRef
interface ResizeHandlesProps {
  stickerId: string;
  isVisible: boolean;
  sticker: OverlaySticker;
  elementRef: React.RefObject<HTMLDivElement>;
  canvasRef: React.RefObject<HTMLDivElement>;  // NEW
}

// In calculateNewSize — use canvas rect
const canvasRect = canvasRef.current?.getBoundingClientRect();
const canvasWidth = canvasRect?.width ?? window.innerWidth;
const canvasHeight = canvasRect?.height ?? window.innerHeight;
const deltaXPercent = (deltaX / canvasWidth) * 100;
const deltaYPercent = (deltaY / canvasHeight) * 100;
```

**StickerElement.tsx** (line ~149):
```typescript
<ResizeHandles
  stickerId={sticker.id}
  isVisible={isSelected}
  sticker={sticker}
  elementRef={elementRef}
  canvasRef={canvasRef}       // NEW — pass through from props
/>
```

**Test File**: `apps/web/src/components/editor/stickers-overlay/__tests__/ResizeHandles.test.ts`
- Verify delta calculation uses canvas dimensions, not window
- Verify small canvas (e.g. 400x300) produces correct resize percentages

---

### Subtask 2: Add Scroll-Wheel Zoom for Stickers (10 min)

**Objective**: Selected sticker scales up/down with mouse scroll wheel.

**Files to Modify**:
- `apps/web/src/components/editor/stickers-overlay/StickerElement.tsx`

**Changes**:
1. Add `onWheel` handler to the sticker `<div>` element
2. Scale width/height proportionally with 5% step per scroll tick
3. Respect min (5%) / max (100%) constraints

**Implementation** (add to `StickerElement` component):
```typescript
const { updateOverlaySticker } = useStickersOverlayStore();

const handleWheel = useCallback((e: React.WheelEvent) => {
  if (!isSelected) return;
  e.preventDefault();
  e.stopPropagation();

  const scaleDelta = e.deltaY < 0 ? 1.05 : 0.95;
  const newWidth = Math.max(5, Math.min(100, sticker.size.width * scaleDelta));
  const newHeight = Math.max(5, Math.min(100, sticker.size.height * scaleDelta));

  updateOverlaySticker(sticker.id, {
    size: { width: newWidth, height: newHeight },
  });
}, [isSelected, sticker, updateOverlaySticker]);
```

Add `onWheel={handleWheel}` to the sticker `<div>` (line ~124).

**Test File**: `apps/web/src/components/editor/stickers-overlay/__tests__/StickerElement.test.ts`
- Scroll up → size increases by ~5%
- Scroll down → size decreases by ~5%
- Min/max constraints enforced at 5% and 100%
- Non-selected stickers ignore scroll events

---

### Subtask 3: Increase Default Size & Always Show Edge Handles (5 min)

**Objective**: New stickers appear at usable size. Edge handles always visible on selection.

**Files to Modify**:
- `apps/web/src/stores/stickers-overlay-store.ts` (line ~24)
- `apps/web/src/components/editor/stickers-overlay/ResizeHandles.tsx` (line 261)

**Changes**:

1. **Default size 8% → 15%** (`stickers-overlay-store.ts`):
```typescript
// Before
const DEFAULT_STICKER_SIZE = 8;
// After
const DEFAULT_STICKER_SIZE = 15;
```

2. **Always show edge handles** — remove conditional (`ResizeHandles.tsx:261`):
```typescript
// Before
{sticker.size.width > 15 && sticker.size.height > 15 && (
// After
{(
```

**Test**: Existing sticker creation tests should verify default size is 15%.

---

### Subtask 4: Clamp Resize to Canvas Bounds (5 min)

**Objective**: Sticker cannot extend past canvas edges during resize.

**Files to Modify**:
- `apps/web/src/components/editor/stickers-overlay/ResizeHandles.tsx` (after line 128)

**Changes**: Add boundary clamping after existing min/max constraints:
```typescript
// Position is center-based, so max size = 2× distance to nearest edge
const maxWidth = Math.min(100, newX * 2, (100 - newX) * 2);
const maxHeight = Math.min(100, newY * 2, (100 - newY) * 2);
newWidth = Math.max(5, Math.min(maxWidth, newWidth));
newHeight = Math.max(5, Math.min(maxHeight, newHeight));
```

**Test File**: `apps/web/src/components/editor/stickers-overlay/__tests__/ResizeHandles.test.ts`
- Sticker at (90%, 50%) can't resize width beyond 20% (edge constraint)
- Sticker at (50%, 50%) can resize to full 100% width

---

## Files Summary

### Modified Files

| File | Change |
|------|--------|
| `apps/web/src/components/editor/stickers-overlay/ResizeHandles.tsx` | Fix delta calc with canvasRef, boundary clamping, always show edge handles |
| `apps/web/src/components/editor/stickers-overlay/StickerElement.tsx` | Pass canvasRef to ResizeHandles, add onWheel zoom handler |
| `apps/web/src/stores/stickers-overlay-store.ts` | Default sticker size 8% → 15% |

### New Test Files

| File | Purpose |
|------|---------|
| `apps/web/src/components/editor/stickers-overlay/__tests__/ResizeHandles.test.ts` | Canvas-relative delta calc, boundary clamping |
| `apps/web/src/components/editor/stickers-overlay/__tests__/StickerElement.test.ts` | Scroll-wheel zoom behavior |

---

## Export Pipeline (No Changes Needed)

The export path converts percentages to pixels correctly and is unaffected by these fixes:

1. **Store** → `position: {x%, y%}`, `size: {w%, h%}`
2. **sticker-sources.ts:191-200** → converts to pixel coordinates using canvas dimensions
3. **sticker-overlay.ts:52-86** → generates FFmpeg `scale`, `rotate`, `overlay` filters
4. **FFmpeg** → renders at final video resolution

---

## Success Criteria

1. Drag sticker to any position — stays within canvas bounds
2. Resize handles move 1:1 with mouse relative to canvas (not window)
3. Scroll wheel on selected sticker scales proportionally (5% per tick)
4. New stickers appear at 15% default size (visible and interactive)
5. Edge handles always visible when sticker is selected
6. Resize cannot push sticker outside canvas bounds
7. All existing sticker tests pass
8. Export produces correct sticker position/size in output video

---

## Code Review

**Reviewer**: Claude Opus 4.6
**Date**: 2026-02-17
**Scope**: All 4 subtasks — ResizeHandles, StickerElement, stickers-overlay-store, and supporting files

---

### Subtask 1: Fix Resize Delta Calculation — PASS

**ResizeHandles.tsx:58-63** — Fixed correctly. `canvasRef` prop added to interface (line 19), `getBoundingClientRect()` used for delta calculation with `window.innerWidth/Height` as fallback. The fix is exactly what was planned.

**StickerElement.tsx:182** — `canvasRef` passed through correctly from props.

No issues found.

---

### Subtask 2: Scroll-Wheel Zoom — PASS with notes

**StickerElement.tsx:69-90** — `handleWheel` implemented as planned. Multiplicative 5% scaling (`1.05`/`0.95`), min/max clamping at 5%/100%, `useCallback` with correct dependencies, `preventDefault` + `stopPropagation` to avoid page scroll.

**Note 1 — Missing canvas boundary clamping in wheel zoom**: The wheel handler clamps to `[5, 100]` but does not apply the same center-based boundary clamping that `ResizeHandles` does (Subtask 4). A sticker at position (90%, 50%) can be scrolled to 100% width via wheel, causing it to overflow the canvas. Should apply:
```typescript
const maxWidth = Math.min(100, sticker.position.x * 2, (100 - sticker.position.x) * 2);
const maxHeight = Math.min(100, sticker.position.y * 2, (100 - sticker.position.y) * 2);
```

**Severity**: Low — the store's `updateOverlaySticker` clamps position to `[0, 100]` but does not enforce the size-vs-position relationship, so overflow is visually possible.

**Note 2 — No undo history for wheel zoom**: Each scroll tick calls `updateOverlaySticker` which does NOT push to `history.past` (only `addOverlaySticker` and `removeOverlaySticker` do). This means Ctrl+Z won't undo scroll-wheel resizes. This is consistent with handle-resize behavior (also no undo per drag), so it's a pre-existing design choice, not a regression.

---

### Subtask 3: Default Size & Edge Handles — PASS

**stickers-overlay-store.ts:24** — Default size changed to `{ width: 15, height: 15 }`. Confirmed.

**ResizeHandles.tsx:271-303** — Edge handles render unconditionally (no size guard). The old conditional `{sticker.size.width > 15 && ...}` has been removed. Confirmed.

**Inconsistency noted**: `STICKER_DEFAULTS` in `sticker-overlay.ts:150-151` has `size: { width: 20, height: 20 }` while the store's `DEFAULTS` uses `{ width: 15, height: 15 }`. The store's `DEFAULTS` object is what's actually used for sticker creation, so the types file constant is dead code or used elsewhere. Not a bug, but could cause confusion if someone references `STICKER_DEFAULTS` expecting it to match actual behavior.

---

### Subtask 4: Clamp Resize to Canvas Bounds — PASS

**ResizeHandles.tsx:134-139** — Boundary clamping implemented exactly as planned. Applied after the basic `[5, 100]` clamp, using center-based `newX * 2` / `(100 - newX) * 2` math. Correct.

---

### Cross-cutting Observations

**1. Drag boundary clamping (useStickerDrag.ts:53-87)** — Well implemented. Uses `stickerWidthPct / 2` and `stickerHeightPct / 2` to keep sticker edges within canvas. This correctly accounts for center-based positioning. The drag and resize systems now both enforce canvas bounds.

**2. Export pipeline (sticker-sources.ts:192-196)** — Uses `Math.min(canvasWidth, canvasHeight)` as `baseSize` for pixel conversion, which makes sticker sizing square-biased. A sticker at 50% width on a 1920x1080 canvas gets `pixelWidth = 0.5 * 1080 = 540px` rather than `0.5 * 1920 = 960px`. This is a pre-existing design choice (consistent sizing across aspect ratios) but means preview and export may not match exactly for non-square canvases. Not introduced by this PR.

**3. StickerCanvas.tsx dependency arrays** — Lines 77-80 and 295-297 include `mediaItems.find`, `mediaItems.map`, `mediaItems.some`, `overlayStickers.values` as dependencies. These are prototype methods that never change between renders — they are no-ops in the dependency array. Not harmful but unnecessary noise. Pre-existing, not introduced by this PR.

**4. ResizeHandles.tsx:143 dependency array** — `calculateNewSize` depends on `[sticker.position.x, sticker.position.y]` but also reads `canvasRef` via closure. Since `canvasRef` is a stable ref object, this is correct — the ref itself doesn't change, only `.current` does. No issue.

**5. Event listener cleanup in ResizeHandles** — The `handleMouseMove` and `handleMouseUp` listeners are added inside `handleResizeStart` and properly cleaned up in `handleMouseUp`. This is correct and prevents listener leaks.

---

### Summary

| Subtask | Status | Issues |
|---------|--------|--------|
| 1. Fix resize delta | PASS | None |
| 2. Scroll-wheel zoom | PASS | Low: missing canvas bounds clamping on wheel zoom |
| 3. Default size & edge handles | PASS | Minor: `STICKER_DEFAULTS` in types file is stale (20% vs 15%) |
| 4. Canvas bounds clamping | PASS | None |

**Overall: APPROVED** — All 5 bugs from the plan are fixed. The implementation matches the spec closely. One low-severity gap exists (wheel zoom doesn't enforce canvas bounds), and one minor inconsistency in exported constants. Neither blocks shipping.

### Recommended Follow-ups

1. Add canvas bounds clamping to `handleWheel` in `StickerElement.tsx` to match resize behavior
2. Sync `STICKER_DEFAULTS` in `sticker-overlay.ts` with the store's actual default (15%)
3. Consider adding undo snapshots for resize/zoom operations (currently only add/remove are undoable)
4. Add the test files listed in the plan (`ResizeHandles.test.ts`, `StickerElement.test.ts`) — not yet created
