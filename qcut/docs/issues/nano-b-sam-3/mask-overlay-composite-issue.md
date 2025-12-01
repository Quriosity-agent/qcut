# SAM-3 Mask Overlay vs Single Mask Display Issue

**Date:** 2025-12-01  
**Component:** Segmentation Canvas  
**Status:** Updated analysis

## Problem Statement

The segmentation interface shows only a single mask preview instead of a proper **multi-mask overlay visualization** where all segmented objects are drawn together with their UI-assigned colors.

## Observed Behavior

![Screenshot showing the issue](c:\Downloads\Screenshots\2025-12\electron_kUlpit631D.png)

**What the user sees:**
- Object list shows 4 segmented objects (person 1, person 2, person 3, + 1 more)
- Each object has a color indicator (cyan, pink, blue)
- Preview shows only one cutout instead of all masks overlaid

**What the user expects:**
- Main canvas shows the original image
- All 4 masks are overlaid with their respective colors (cyan, pink, blue, etc.)
- Visuals match the object list color coding

## Root Cause Analysis

### 1) SAM-3 API Composite Behavior

Call in `sam3-client.ts` / `sam3.ts`:

```typescript
const result = await segmentWithText(uploadedImageUrl, currentTextPrompt.trim(), {
  return_multiple_masks: true,
  max_masks: 10,
  include_scores: true,
  include_boxes: true,
  apply_mask: true,  // Returns composite with masks
});
```

The API returns:
- `result.image.url`: Composite image with all masks from **this single API call**
- `result.masks[]`: Individual mask images (one per detected object)

### 2) Composite and Mask Overwrites

**Location:** `qcut/apps/web/src/components/editor/segmentation/index.tsx:112-118`

```typescript
if (result.image?.url) {
  setCompositeImage(result.image.url);  // Overwrites previous composite
}
setMasks(result.masks);                 // Overwrites previous masks/download list
```

Scenarios:
- Multiple prompts (person → dog): later call replaces the composite, losing earlier objects.
- Mask downloads rely on `masks`, so previous-call masks disappear even if objects remain.

### 3) Color Coding Mismatch

**Location:** `qcut/apps/web/src/stores/segmentation-store.ts:23-33`

```typescript
export const OBJECT_COLORS = [
  { name: "Cyan", hex: "#00CED1", rgb: "0, 206, 209" },
  { name: "Pink", hex: "#FF69B4", rgb: "255, 105, 180" },
  { name: "Blue", hex: "#4169E1", rgb: "65, 105, 225" },
  // ... more colors
];
```

The SAM-3 composite uses internal colors that do not match `OBJECT_COLORS`, so the canvas and object list disagree.

### 4) Mask Persistence Gap

- `SegmentedObject` lacks a `visible` flag and a blob URL for mask drawing.
- The store replaces `masks` per call; downloads and any future client-side compositing drop earlier results.

### 5) Canvas Display Limitations

**Location:** `qcut/apps/web/src/components/editor/segmentation/SegmentationCanvas.tsx:73-110`

The canvas can show the SAM-3 composite but:
- Depends on a single `compositeImageUrl`
- Has no per-object visibility toggles
- Cannot accumulate masks across calls
- Draws prompts/boxes per render, but mask drawing is tied to the composite and not cleared/redrawn per-object, so any per-mask change would require a full redraw path

## Why This Happens

Design assumptions:
1. Single API call per session supplies all masks
2. SAM-3 composite is the final visualization
3. No need for per-mask visibility or cumulative state

User reality:
- Multiple prompts across a session (person, dog, etc.)
- Need to toggle masks and keep UI colors consistent
- Need reliable downloads that include all masks seen in the UI

## Recommended Solution

### Option 1: Client-Side Mask Compositing (Recommended, long-term)

**Approach**
- Store per-object mask sources (`maskUrl` + blob URL) and a `visible` flag in `SegmentedObject`.
- Accumulate masks/objects across API calls instead of replacing them.
- Canvas redraw loop: clear → draw base image → draw tinted visible masks → draw prompts/boxes.
- Tint via `source-in` (mask as alpha, UI color as fill) so `OBJECT_COLORS` are honored.
- Keep SAM-3 composite optional for fast preview, but do not rely on it for multi-mask display.

**Implementation sketch**

```typescript
// store additions
export interface SegmentedObject {
  id: string;
  name: string;
  colorIndex: number;
  maskUrl?: string;       // API PNG
  maskBlobUrl?: string;   // blob URL for canvas
  visible: boolean;
  // ... existing fields
}

// accumulate masks instead of overwrite
setMasks([...state.masks, ...result.masks]);

// canvas redraw (conceptual)
useEffect(() => {
  const ctx = canvas.getContext("2d");
  if (!ctx || !baseImg) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseImg, 0, 0, w, h);

  for (const obj of objects) {
    if (!obj.visible || !obj.maskBlobUrl) continue;
    const maskImg = await loadImage(obj.maskBlobUrl);
    const tinted = tintMask(maskImg, OBJECT_COLORS[obj.colorIndex].hex);
    ctx.globalAlpha = maskOpacity;
    ctx.drawImage(tinted, 0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  drawPromptsAndBoxes(ctx);
}, [objects, maskOpacity, baseImg, prompts]);

function tintMask(maskImg: HTMLImageElement, color: string) {
  const off = document.createElement("canvas");
  off.width = maskImg.width;
  off.height = maskImg.height;
  const mctx = off.getContext("2d")!;
  mctx.drawImage(maskImg, 0, 0);
  mctx.globalCompositeOperation = "source-in"; // keep mask alpha, replace color
  mctx.fillStyle = color;
  mctx.fillRect(0, 0, off.width, off.height);
  mctx.globalCompositeOperation = "source-over";
  return off;
}
```

**Pros**
- Full control over rendering with UI-consistent colors
- Per-object visibility (and future per-mask opacity) possible
- Works across multiple segmentation calls; state is cumulative
- Downloads can rely on the same accumulated masks

**Cons**
- More client-side rendering work and blob lifecycle management
- Needs disciplined redraw/cleanup to avoid stale pixels

### Option 2: Aggregate Composite Image

**Approach:** After each call, draw new masks onto an existing composite in canvas, then export it as the new composite image.

**Pros:** Single composite to manage; lighter per-frame drawing.  
**Cons:** No per-mask toggles; harder to keep UI colors aligned; still needs custom coloring logic.

## Implementation Checklist (Option 1)

- [ ] Extend `SegmentedObject` with `visible: boolean` and `maskBlobUrl?: string`
- [ ] Add `toggleObjectVisibility(id: string)` to the store
- [ ] Make mask state cumulative (`setMasks([...state.masks, ...newMasks])`) and keep downloads in sync with the accumulated list
- [ ] Update `SegmentationCanvas` to clear and redraw every change:
  - [ ] Base image
  - [ ] Tinted visible masks using `source-in` on an offscreen buffer
  - [ ] Apply global `maskOpacity`
  - [ ] Prompts and optional bounding boxes
- [ ] Add visibility toggle UI in `ObjectList` (eye icon + visible/hidden state)
- [ ] Keep `compositeImageUrl` only as a fast preview; do not rely on it for multi-mask display
- [ ] Ensure blob URLs are created/revoked to avoid leaks

## Testing Scenarios

1. **Multiple text prompts:** Segment "person" (3 masks) then "dog" (1 mask). **Expected:** All 4 masks visible with correct colors.  
2. **Visibility toggles:** Hide "person 2". **Expected:** Canvas hides the pink mask only.  
3. **Opacity control:** Adjust global mask opacity. **Expected:** All visible masks fade proportionally.  
4. **Color consistency:** Object list shows cyan dot for "person 1". **Expected:** Canvas shows a cyan overlay for that mask.  
5. **Download/export after multiple prompts:** Download masks after two prompts. **Expected:** All masks from both calls are included.  
