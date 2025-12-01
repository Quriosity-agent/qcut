# SAM-3 Mask Overlay vs Single Mask Display Issue

**Date:** 2025-12-01
**Component:** Segmentation Canvas
**Status:** Analysis Complete

## Problem Statement

The segmentation interface currently displays a single mask preview instead of a proper **multi-mask overlay visualization** where all segmented objects are shown with their respective color overlays on the original image simultaneously.

## Observed Behavior

![Screenshot showing the issue](c:\Downloads\Screenshots\2025-12\electron_kUlpit631D.png)

**What the user sees:**
- Object list on the right showing 4 segmented objects (person 1, person 2, person 3, + 1 more)
- Each object has a color indicator (cyan, pink, blue)
- Preview on the left shows only ONE person cutout instead of all masks overlaid

**What the user expects:**
- A main canvas showing the original image
- All 4 masks overlaid on top with their respective colors (cyan, pink, blue, etc.)
- Visual representation matching the object list's color coding

## Root Cause Analysis

### 1. **SAM-3 API Composite Behavior**

From `sam3-client.ts` and `sam3.ts`, when calling the SAM-3 API:

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
- **`result.image.url`**: Composite image with ALL masks from **this specific API call**
- **`result.masks[]`**: Individual mask images (one per detected object)

### 2. **Composite Overwriting Issue**

**Location:** `qcut/apps/web/src/components/editor/segmentation/index.tsx:112-114`

```typescript
if (result.image?.url) {
  setCompositeImage(result.image.url);  // ❌ Overwrites previous composite
}
```

**Problem Scenarios:**

**Scenario A: Multiple Segmentation Calls**
1. User segments with prompt "person" → API returns composite with 3 people
2. Store sets `compositeImageUrl` to show those 3 people
3. User segments again with prompt "dog" → API returns composite with 1 dog
4. Store **overwrites** `compositeImageUrl`, losing the 3 people
5. Canvas now only shows the dog, not all 4 objects

**Scenario B: Single Call with Multiple Masks**
1. User segments with prompt "person" → API returns 4 masks
2. SAM-3 returns `result.image` (composite) BUT...
3. The composite may use **generic mask colors** from SAM-3, not the app's color scheme
4. The composite doesn't match the color indicators shown in the object list (cyan, pink, blue)

### 3. **Color Coding Mismatch**

**Location:** `qcut/apps/web/src/stores/segmentation-store.ts:23-33`

```typescript
export const OBJECT_COLORS = [
  { name: "Cyan", hex: "#00CED1", rgb: "0, 206, 209" },
  { name: "Pink", hex: "#FF69B4", rgb: "255, 105, 180" },
  { name: "Blue", hex: "#4169E1", rgb: "65, 105, 225" },
  // ... more colors
];
```

The app assigns colors to objects based on their order:
- Object 1 → Cyan (#00CED1)
- Object 2 → Pink (#FF69B4)
- Object 3 → Blue (#4169E1)

**But:** The SAM-3 API's composite image uses its **own internal color scheme**, which doesn't match these predefined colors.

**Result:** Visual inconsistency between the object list color indicators and the actual mask overlay colors.

### 4. **Canvas Display Logic**

**Location:** `qcut/apps/web/src/components/editor/segmentation/SegmentationCanvas.tsx:73-110`

```typescript
if (compositeBlobUrl) {
  const compositeImg = new Image();
  compositeImg.onload = () => {
    if (maskOpacity >= 1.0) {
      ctx.drawImage(compositeImg, 0, 0, displayWidth, displayHeight);  // Show composite
    } else if (maskOpacity <= 0.0) {
      ctx.drawImage(img, 0, 0, displayWidth, displayHeight);  // Show original
    } else {
      // Blend composite and original based on opacity
      ctx.drawImage(compositeImg, 0, 0, displayWidth, displayHeight);
      ctx.globalAlpha = 1 - maskOpacity;
      ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
      ctx.globalAlpha = 1.0;
    }
  };
  compositeImg.src = compositeBlobUrl;
}
```

The canvas **does** support displaying a composite image, but:
- It relies on a **single** `compositeImageUrl` from the store
- It doesn't support **per-object visibility toggles**
- It can't handle compositing masks from **multiple API calls**

## Why This Happens

### Design Assumption Violation

The current architecture assumes:
1. ✅ User makes **one** API call per segmentation session
2. ✅ SAM-3 returns **all** masks in that single call
3. ✅ SAM-3's composite image is the final visualization
4. ❌ **But:** Users want to:
   - Make multiple segmentation calls with different prompts
   - Combine results from different API calls
   - Toggle individual mask visibility
   - Use consistent color coding matching the UI

### Missing Functionality

The system lacks:
1. **Client-side mask compositing**: Ability to manually overlay individual masks
2. **Cumulative mask storage**: Preserving masks across multiple API calls
3. **Per-object visibility control**: Show/hide individual masks
4. **Consistent color mapping**: Apply app's color scheme to masks
5. **Interactive mask overlay**: Click to toggle, adjust opacity per mask, etc.

## Recommended Solution

### Option 1: Client-Side Mask Compositing (Recommended)

**Approach:**
- Store individual mask images in each `SegmentedObject`
- Canvas manually composites all visible masks using the app's color scheme
- Support per-object visibility toggles

**Implementation:**

```typescript
// In SegmentationCanvas.tsx
useEffect(() => {
  const canvas = canvasRef.current;
  const ctx = canvas.getContext("2d");

  // 1. Draw original image
  ctx.drawImage(originalImg, 0, 0, displayWidth, displayHeight);

  // 2. Draw each visible mask with its assigned color
  objects.forEach((obj) => {
    if (!obj.visible) return;  // Skip hidden objects

    const maskImg = new Image();
    maskImg.onload = () => {
      const color = OBJECT_COLORS[obj.colorIndex];

      // Apply color tint to mask
      ctx.globalAlpha = maskOpacity;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = color.hex;
      ctx.drawImage(maskImg, 0, 0, displayWidth, displayHeight);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
    };
    maskImg.src = obj.maskBlobUrl;
  });
}, [objects, maskOpacity, sourceImageUrl]);
```

**Store Changes:**

```typescript
// Add visibility flag to SegmentedObject
export interface SegmentedObject {
  id: string;
  name: string;
  colorIndex: number;
  maskUrl?: string;
  visible: boolean;  // ✅ New field
  // ... rest of fields
}

// Add toggle action
toggleObjectVisibility: (id: string) => void;
```

**Pros:**
- ✅ Full control over mask rendering
- ✅ Consistent color scheme with UI
- ✅ Per-object visibility toggles
- ✅ Works with multiple API calls
- ✅ No dependency on SAM-3 composite

**Cons:**
- ⚠️ More complex canvas rendering logic
- ⚠️ Requires proper mask color mapping

### Option 2: Aggregate Composite Image

**Approach:**
- After each API call, manually composite the new masks onto the existing composite
- Use canvas operations to blend masks with proper colors

**Pros:**
- ✅ Single composite image stored
- ✅ Less rendering overhead

**Cons:**
- ❌ Can't toggle individual masks
- ❌ Complex to implement color matching
- ❌ Harder to manage cumulative state

### Option 3: Request SAM-3 for Custom Colors (Not Feasible)

**Why it won't work:**
- SAM-3 API doesn't support custom mask colors
- API's color scheme is predetermined

## Implementation Checklist

If implementing **Option 1 (Client-Side Compositing)**:

- [ ] Add `visible: boolean` field to `SegmentedObject` interface
- [ ] Add `toggleObjectVisibility(id: string)` action to store
- [ ] Update `SegmentationCanvas` to manually composite masks:
  - [ ] Load original image as base
  - [ ] Iterate through visible objects
  - [ ] Load each mask image
  - [ ] Apply color tint using `OBJECT_COLORS[colorIndex]`
  - [ ] Blend with original using `maskOpacity`
- [ ] Add visibility toggle UI in `ObjectList` component:
  - [ ] Eye icon button per object
  - [ ] Visual indication of visible/hidden state
- [ ] Remove dependency on `compositeImageUrl` for multi-mask visualization
- [ ] Test with multiple segmentation calls to verify cumulative display
- [ ] Ensure color consistency between object list indicators and canvas overlays

## Testing Scenarios

1. **Multiple text prompts:**
   - Segment "person" → 3 masks
   - Segment "dog" → 1 mask
   - **Expected:** All 4 masks visible with correct colors

2. **Visibility toggles:**
   - Hide "person 2"
   - **Expected:** Canvas updates to hide pink mask

3. **Opacity control:**
   - Adjust global mask opacity slider
   - **Expected:** All masks fade proportionally

4. **Color consistency:**
   - Object list shows cyan dot for "person 1"
   - **Expected:** Canvas shows cyan overlay for that mask

## Related Files

- `qcut/apps/web/src/components/editor/segmentation/SegmentationCanvas.tsx:73-110`
- `qcut/apps/web/src/components/editor/segmentation/index.tsx:112-114`
- `qcut/apps/web/src/stores/segmentation-store.ts:23-33`
- `qcut/apps/web/src/lib/sam3-client.ts:94-168`
- `qcut/apps/web/src/types/sam3.ts:111-122`

## References

- SAM-3 API Documentation: https://fal.ai/models/fal-ai/sam-3
- Canvas Compositing: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation
