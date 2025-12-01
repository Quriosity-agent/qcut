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

**Pros:**
- ✅ Full control over mask rendering
- ✅ Consistent color scheme with UI
- ✅ Per-object visibility toggles
- ✅ Works with multiple API calls
- ✅ No dependency on SAM-3 composite

**Cons:**
- ⚠️ More complex canvas rendering logic
- ⚠️ Requires proper mask color mapping

---

## Detailed Implementation Subtasks for Option 1

### Subtask 1: Add Visibility Field to SegmentedObject Interface

**File:** `qcut/apps/web/src/stores/segmentation-store.ts`

**Location:** Lines 39-60 (SegmentedObject interface)

**Action:** MODIFY

**Code Changes:**
```typescript
export interface SegmentedObject {
  /** Unique object ID */
  id: string;
  /** Display name (e.g., "Object 1", "Dog") */
  name: string;
  /** Color index from OBJECT_COLORS */
  colorIndex: number;
  /** Mask image URL */
  maskUrl?: string;
  /** Thumbnail crop URL */
  thumbnailUrl?: string;
  /** Confidence score (0-1) */
  score?: number;
  /** Bounding box [cx, cy, w, h] normalized */
  boundingBox?: number[];
  /** Point prompts used to define this object */
  pointPrompts: Sam3PointPrompt[];
  /** Box prompts used to define this object */
  boxPrompts: Sam3BoxPrompt[];
  /** Text prompt used to detect this object */
  textPrompt?: string;
  /** Whether this object's mask is visible on canvas */ // ✅ ADD THIS LINE
  visible: boolean; // ✅ ADD THIS LINE (default: true)
}
```

---

### Subtask 2: Add Toggle Visibility Action to Store

**File:** `qcut/apps/web/src/stores/segmentation-store.ts`

**Location:** Lines 108-159 (SegmentationActions interface)

**Action:** MODIFY

**Code Changes:**
```typescript
export interface SegmentationActions {
  // Mode
  setMode: (mode: "image" | "video") => void;
  setPromptMode: (mode: Sam3SegmentationMode) => void;

  // Source media
  setSourceImage: (file: File, url: string) => void;
  setSourceVideo: (file: File, url: string) => void;
  clearSource: () => void;
  setImageDimensions: (width: number, height: number) => void;

  // Object management
  addObject: (object: Omit<SegmentedObject, "id" | "colorIndex">) => string;
  updateObject: (id: string, updates: Partial<SegmentedObject>) => void;
  removeObject: (id: string) => void;
  selectObject: (id: string | null) => void;
  renameObject: (id: string, name: string) => void;
  clearObjects: () => void;
  toggleObjectVisibility: (id: string) => void; // ✅ ADD THIS LINE

  // ... rest of actions
}
```

---

### Subtask 3: Implement Toggle Visibility Action in Store

**File:** `qcut/apps/web/src/stores/segmentation-store.ts`

**Location:** After line 330 (after renameObject implementation)

**Action:** ADD

**Code Changes:**
```typescript
      renameObject: (id, name) =>
        set(
          (state) => ({
            objects: state.objects.map((obj) =>
              obj.id === id ? { ...obj, name } : obj
            ),
          }),
          false,
          "segmentation/renameObject"
        ),

      // ✅ ADD THIS ENTIRE BLOCK (after renameObject, before clearObjects)
      toggleObjectVisibility: (id) =>
        set(
          (state) => ({
            objects: state.objects.map((obj) =>
              obj.id === id ? { ...obj, visible: !obj.visible } : obj
            ),
          }),
          false,
          "segmentation/toggleObjectVisibility"
        ),

      clearObjects: () =>
        set(
          { objects: [], selectedObjectId: null, nextObjectId: 1 },
          false,
          "segmentation/clearObjects"
        ),
```

---

### Subtask 4: Set Default Visibility When Adding Objects

**File:** `qcut/apps/web/src/stores/segmentation-store.ts`

**Location:** Lines 269-294 (addObject implementation)

**Action:** MODIFY

**Code Changes:**
```typescript
      addObject: (objectData) => {
        const state = get();
        const id = `obj-${state.nextObjectId}`;
        const colorIndex = state.objects.length % OBJECT_COLORS.length;

        const newObject: SegmentedObject = {
          ...objectData,
          id,
          colorIndex,
          name: objectData.name || `Object ${state.nextObjectId}`,
          pointPrompts: objectData.pointPrompts || [],
          boxPrompts: objectData.boxPrompts || [],
          visible: objectData.visible !== undefined ? objectData.visible : true, // ✅ ADD THIS LINE
        };

        set(
          {
            objects: [...state.objects, newObject],
            nextObjectId: state.nextObjectId + 1,
            selectedObjectId: id,
          },
          false,
          "segmentation/addObject"
        );

        return id;
      },
```

---

### Subtask 5: Update SegmentationCanvas to Composite Masks Client-Side

**File:** `qcut/apps/web/src/components/editor/segmentation/SegmentationCanvas.tsx`

**Location:** Lines 45-129 (main useEffect for image loading)

**Action:** REPLACE

**Code Changes:**
```typescript
  // Load and display image with client-side mask compositing
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !sourceImageUrl) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      // Calculate fit dimensions
      const containerRect = container.getBoundingClientRect();
      const scale = Math.min(
        containerRect.width / img.width,
        containerRect.height / img.height
      );

      const displayWidth = img.width * scale;
      const displayHeight = img.height * scale;

      canvas.width = displayWidth;
      canvas.height = displayHeight;

      setImageDimensions(img.width, img.height);

      // ✅ NEW: Client-side mask compositing
      const render = () => {
        // 1. Draw original image as base
        ctx.clearRect(0, 0, displayWidth, displayHeight);
        ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

        // 2. Draw all visible masks with their assigned colors
        const visibleObjects = objects.filter(obj => obj.visible !== false);

        if (visibleObjects.length > 0 && maskOpacity > 0) {
          // Load and composite each visible mask
          let loadedCount = 0;
          const totalToLoad = visibleObjects.length;

          visibleObjects.forEach((obj) => {
            if (!obj.maskUrl) return;

            const maskImg = new Image();
            maskImg.crossOrigin = "anonymous";

            maskImg.onload = () => {
              const color = OBJECT_COLORS[obj.colorIndex];

              // Create off-screen canvas for mask colorization
              const tempCanvas = document.createElement('canvas');
              tempCanvas.width = displayWidth;
              tempCanvas.height = displayHeight;
              const tempCtx = tempCanvas.getContext('2d');

              if (tempCtx) {
                // Draw mask
                tempCtx.drawImage(maskImg, 0, 0, displayWidth, displayHeight);

                // Apply color overlay
                tempCtx.globalCompositeOperation = 'source-in';
                tempCtx.fillStyle = color.hex;
                tempCtx.fillRect(0, 0, displayWidth, displayHeight);

                // Composite onto main canvas with opacity
                ctx.globalAlpha = maskOpacity;
                ctx.drawImage(tempCanvas, 0, 0);
                ctx.globalAlpha = 1.0;
              }

              loadedCount++;

              // After all masks loaded, draw prompts and boxes
              if (loadedCount === totalToLoad) {
                drawPointPrompts(ctx, currentPointPrompts, scale);
                drawBoxPrompts(ctx, currentBoxPrompts, scale);
                if (showBoundingBoxes) {
                  drawBoundingBoxes(ctx, objects, displayWidth, displayHeight);
                }
              }
            };

            maskImg.src = obj.maskUrl;
          });
        } else {
          // No masks or opacity is 0 - just show prompts
          drawPointPrompts(ctx, currentPointPrompts, scale);
          drawBoxPrompts(ctx, currentBoxPrompts, scale);
          if (showBoundingBoxes) {
            drawBoundingBoxes(ctx, objects, displayWidth, displayHeight);
          }
        }
      };

      render();
    };

    img.src = sourceImageUrl;
  }, [
    sourceImageUrl,
    objects, // ✅ CHANGED: Now depends on objects array (for visibility changes)
    currentPointPrompts,
    currentBoxPrompts,
    maskOpacity,
    showBoundingBoxes,
    setImageDimensions,
  ]);
```

**Note:** Remove the old `compositeBlobUrl` logic (lines 73-116) and replace with the above code.

---

### Subtask 6: Add Visibility Toggle Button to ObjectList

**File:** `qcut/apps/web/src/components/editor/segmentation/ObjectList.tsx`

**Location:** Lines 21-124 (ObjectListItem component)

**Action:** MODIFY

**Code Changes:**

**Step 6a: Import Eye icons**
```typescript
import { Trash2, Plus, Eye, EyeOff } from "lucide-react"; // ✅ ADD Eye, EyeOff
```

**Step 6b: Get toggleObjectVisibility from store**
```typescript
function ObjectListItem({ object }: { object: SegmentedObject }) {
  const { selectedObjectId, selectObject, removeObject, renameObject, toggleObjectVisibility } = // ✅ ADD toggleObjectVisibility
    useSegmentationStore();
```

**Step 6c: Add visibility toggle button before delete button**
```typescript
      {/* Name and score */}
      <div className="flex-1 min-w-0">
        {/* ... existing name/score code ... */}
      </div>

      {/* ✅ ADD VISIBILITY TOGGLE BUTTON */}
      <Button
        variant="text"
        size="icon"
        className="h-6 w-6 flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          toggleObjectVisibility(object.id);
        }}
        title={object.visible ? "Hide mask" : "Show mask"}
      >
        {object.visible ? (
          <Eye className="w-3 h-3" />
        ) : (
          <EyeOff className="w-3 h-3 opacity-50" />
        )}
      </Button>

      {/* Delete button */}
      <Button
        variant="text"
        size="icon"
        className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          removeObject(object.id);
        }}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
```

**Step 6d: Add visual indication for hidden objects**
```typescript
  return (
    <div
      className={cn(
        "group flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors",
        isSelected
          ? "bg-accent border border-accent-foreground/20"
          : "hover:bg-accent/50",
        !object.visible && "opacity-50" // ✅ ADD THIS LINE - dim hidden objects
      )}
      onClick={() => selectObject(object.id)}
    >
```

---

### Subtask 7: Remove Composite Image Dependency

**File:** `qcut/apps/web/src/components/editor/segmentation/index.tsx`

**Location:** Lines 111-114

**Action:** DELETE (or comment out)

**Code Changes:**
```typescript
      // Process results
      // ❌ DELETE OR COMMENT OUT - No longer needed with client-side compositing
      // if (result.image?.url) {
      //   setCompositeImage(result.image.url);
      // }

      if (result.masks) {
        setMasks(result.masks);
```

**Reasoning:** Since we're now compositing masks client-side, we don't need the SAM-3 API's composite image anymore.

---

### Subtask 8: Update useBlobImage Hook Call in SegmentationCanvas

**File:** `qcut/apps/web/src/components/editor/segmentation/SegmentationCanvas.tsx`

**Location:** Lines 42-43

**Action:** DELETE

**Code Changes:**
```typescript
  // ❌ DELETE THIS - No longer needed
  // const { blobUrl: compositeBlobUrl } = useBlobImage(compositeImageUrl ?? undefined);
```

**Reasoning:** We're no longer using the composite image from the API.

---

### Subtask 9: Convert Mask URLs to Blob URLs in Canvas

**File:** `qcut/apps/web/src/components/editor/segmentation/SegmentationCanvas.tsx`

**Location:** In the new render function (from Subtask 5)

**Action:** MODIFY

**Code Changes:**
Update the mask loading section to use blob URLs:

```typescript
          visibleObjects.forEach((obj) => {
            if (!obj.maskUrl) return;

            // ✅ ADD: Convert FAL URL to blob URL
            const useBlobImageInline = async (url: string) => {
              try {
                const response = await fetch(url);
                const blob = await response.blob();
                return URL.createObjectURL(blob);
              } catch (error) {
                console.error('Failed to load mask:', error);
                return url; // fallback to original URL
              }
            };

            useBlobImageInline(obj.maskUrl).then(blobUrl => {
              const maskImg = new Image();
              maskImg.crossOrigin = "anonymous";

              maskImg.onload = () => {
                // ... existing mask drawing code ...
              };

              maskImg.src = blobUrl;
            });
          });
```

**Alternative (Better):** Use the existing `useBlobImage` hook for each object in ObjectList and pass blob URLs to canvas.

---

### Subtask 10: Add Global Mask Opacity Slider (Optional Enhancement)

**File:** `qcut/apps/web/src/components/editor/segmentation/SegmentationControls.tsx`

**Location:** Create new component or add to existing controls

**Action:** ADD (if component exists, otherwise create new)

**Code Changes:**
```typescript
import { Slider } from "@/components/ui/slider";
import { useSegmentationStore } from "@/stores/segmentation-store";

export function SegmentationControls() {
  const { maskOpacity, setMaskOpacity } = useSegmentationStore();

  return (
    <div className="flex items-center gap-4 p-4 border-t">
      <label className="text-sm font-medium">Mask Opacity:</label>
      <Slider
        value={[maskOpacity * 100]}
        onValueChange={([value]) => setMaskOpacity(value / 100)}
        min={0}
        max={100}
        step={1}
        className="flex-1 max-w-xs"
      />
      <span className="text-sm text-muted-foreground w-12">
        {Math.round(maskOpacity * 100)}%
      </span>
    </div>
  );
}
```

---

### Subtask 11: Add "Show All" / "Hide All" Bulk Actions

**File:** `qcut/apps/web/src/stores/segmentation-store.ts`

**Location:** After toggleObjectVisibility action (around line 340)

**Action:** ADD

**Code Changes:**
```typescript
      // Add to SegmentationActions interface (around line 125)
      showAllObjects: () => void;
      hideAllObjects: () => void;

      // Add implementations (around line 340)
      showAllObjects: () =>
        set(
          (state) => ({
            objects: state.objects.map((obj) => ({ ...obj, visible: true })),
          }),
          false,
          "segmentation/showAllObjects"
        ),

      hideAllObjects: () =>
        set(
          (state) => ({
            objects: state.objects.map((obj) => ({ ...obj, visible: false })),
          }),
          false,
          "segmentation/hideAllObjects"
        ),
```

**File:** `qcut/apps/web/src/components/editor/segmentation/ObjectList.tsx`

**Location:** Lines 150-160 (header area)

**Action:** MODIFY

```typescript
export function ObjectList() {
  const { objects, clearObjects, showAllObjects, hideAllObjects } = useSegmentationStore(); // ✅ ADD actions

  // ...

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Objects ({objects.length})</h3>
        <div className="flex gap-1"> {/* ✅ ADD wrapper div */}
          <Button
            variant="text"
            size="sm"
            onClick={showAllObjects}
            className="h-6 text-xs"
            title="Show all masks"
          >
            <Eye className="w-3 h-3" />
          </Button>
          <Button
            variant="text"
            size="sm"
            onClick={hideAllObjects}
            className="h-6 text-xs"
            title="Hide all masks"
          >
            <EyeOff className="w-3 h-3" />
          </Button>
          <Button
            variant="text"
            size="sm"
            onClick={clearObjects}
            className="h-6 text-xs"
          >
            Clear all
          </Button>
        </div>
      </div>
```

---

## Summary of File Changes

| File | Action | Lines | Description |
|------|--------|-------|-------------|
| `stores/segmentation-store.ts` | MODIFY | 39-60 | Add `visible: boolean` to `SegmentedObject` |
| `stores/segmentation-store.ts` | MODIFY | 108-159 | Add `toggleObjectVisibility` to actions interface |
| `stores/segmentation-store.ts` | ADD | ~330 | Implement `toggleObjectVisibility` action |
| `stores/segmentation-store.ts` | MODIFY | 269-294 | Set default `visible: true` in `addObject` |
| `stores/segmentation-store.ts` | ADD | ~340 | Add `showAllObjects` and `hideAllObjects` actions |
| `SegmentationCanvas.tsx` | REPLACE | 45-129 | Replace composite logic with client-side compositing |
| `SegmentationCanvas.tsx` | DELETE | 42-43 | Remove `compositeBlobUrl` hook usage |
| `ObjectList.tsx` | MODIFY | 12 | Import `Eye`, `EyeOff` icons |
| `ObjectList.tsx` | MODIFY | 22 | Add `toggleObjectVisibility` to destructured store |
| `ObjectList.tsx` | ADD | ~110 | Add visibility toggle button before delete button |
| `ObjectList.tsx` | MODIFY | 44 | Add opacity styling for hidden objects |
| `ObjectList.tsx` | MODIFY | 150-160 | Add "Show All" / "Hide All" buttons |
| `segmentation/index.tsx` | DELETE | 112-114 | Remove `setCompositeImage` call |
| `SegmentationControls.tsx` | ADD | New | Add mask opacity slider control (optional) |

---

## Testing Checklist After Implementation

- [ ] Segment single object → verify mask appears with correct color
- [ ] Segment multiple objects → verify all masks overlay correctly
- [ ] Click eye icon on object → verify mask hides/shows on canvas
- [ ] Adjust mask opacity slider → verify all masks fade proportionally
- [ ] Click "Show All" → verify all hidden masks reappear
- [ ] Click "Hide All" → verify all masks disappear, canvas shows original image
- [ ] Segment with different prompts multiple times → verify masks accumulate
- [ ] Verify color consistency between object list dots and canvas overlay colors
- [ ] Remove object → verify its mask disappears from canvas
- [ ] Test with 10+ objects → verify performance is acceptable

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
