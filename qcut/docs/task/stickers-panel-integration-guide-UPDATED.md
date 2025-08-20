# Stickers Panel Integration Guide - UPDATED

## Current Status Analysis

### ✅ Already Implemented:
1. **iconify-api.ts** - Already exists in `src/lib/`
2. **stickers-store.ts** - Already exists in `src/stores/`
3. **stickers.tsx view** - Already exists in `src/components/editor/media-panel/views/`
4. **StickersView integrated** - Already imported and used in media panel
5. **Draggable item props** - `showLabel` and `rounded` already exist (but missing `variant` and `isDraggable`)

### ❌ Not Implemented:
1. **next.config.ts** - File doesn't exist (project uses Vite, not Next.js)
2. **use-infinite-scroll.ts** - Hook doesn't exist
3. **input-with-back.tsx** - Component doesn't exist
4. **ephemeral property** - Not in media store
5. **Timeline sticker support** - Not implemented
6. **Sounds view update** - Still using old scroll handling

---

## Revised Implementation Tasks

## Task 1: Skip Iconify Configuration (0 minutes)
**STATUS: NOT NEEDED** - Project uses Vite, not Next.js. Vite doesn't need domain configuration.

---

## Task 2: Create Infinite Scroll Hook (5 minutes)

### Files to Create:
- `qcut/apps/web/src/hooks/use-infinite-scroll.ts`

### Steps:
1. Copy `use-infinite-scroll.ts` from `qcut/docs/task/`
2. Place it in `qcut/apps/web/src/hooks/`

```bash
cp "C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\docs\task\use-infinite-scroll.ts" "C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\apps\web\src\hooks\"
```

---

## Task 3: Create Input with Back Component (5 minutes)

### Files to Create:
- `qcut/apps/web/src/components/ui/input-with-back.tsx`

### Steps:
1. Copy from task folder:

```bash
cp "C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\docs\task\input-with-back.tsx" "C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\apps\web\src\components\ui\"
```

2. Verify Input component has `"use client";` directive (check `src/components/ui/input.tsx`)

---

## Task 4: Update Draggable Item Component (5 minutes)

### Files to Modify:
- `qcut/apps/web/src/components/ui/draggable-item.tsx`

### Steps:
Since `showLabel` and `rounded` already exist, only add missing props:

1. Add to interface (around line 25):
```typescript
interface DraggableMediaItemProps {
  // ... existing props (showLabel and rounded already exist)
  variant?: "default" | "card";
  isDraggable?: boolean;
}
```

2. Add to function parameters (around line 38):
```typescript
export function DraggableMediaItem({
  // ... existing props
  variant = "default",
  isDraggable = true,
  // ... rest
}: DraggableMediaItemProps) {
```

3. Update className logic to support variant:
```typescript
const itemClassName = cn(
  "relative group cursor-pointer",
  rounded && "rounded-md", // This already exists
  variant === "card" && "bg-card border", // Add this
  className
);
```

4. Conditionally apply drag handlers based on isDraggable:
```typescript
const dragProps = isDraggable ? {
  draggable: true,
  onDragStart: handleDragStart,
  onDragEnd: handleDragEnd,
} : {};

// Apply dragProps to the main div
<div {...dragProps} className={itemClassName}>
```

---

## Task 5: Update Media Store (3 minutes)

### Files to Modify:
- `qcut/apps/web/src/stores/media-store.ts`

### Steps:
1. Find the `MediaItem` interface and add:
```typescript
export interface MediaItem {
  // ... existing properties
  ephemeral?: boolean; // Add this line
}
```

---

## Task 6: Update Media View Filter (3 minutes)

### Files to Modify:
- `qcut/apps/web/src/components/editor/media-panel/views/media.tsx`

### Steps:
1. Find the filter logic (search for `mediaItems.filter`) and add:
```typescript
useEffect(() => {
  let filtered = mediaItems.filter((item) => {
    if (item.ephemeral) return false; // Add this line
    // ... rest of existing filter logic
```

---

## Task 7: Update Timeline Store for Stickers (8 minutes)

### Files to Modify:
- `qcut/apps/web/src/stores/timeline-store.ts`

### Steps:
1. Import stickers store at the top:
```typescript
import { useStickersStore } from "./stickers-store";
```

2. In the `handleDrop` function, add sticker handling:
```typescript
// Find where drop types are handled (search for "if (data.type")
// Add this case:
if (data.type === "sticker") {
  const { downloadSticker } = useStickersStore.getState();
  const file = await downloadSticker(data.iconName);
  
  if (file) {
    const mediaItem = {
      id: generateId(),
      name: data.iconName.replace(":", "-"),
      type: "image" as const,
      file,
      url: URL.createObjectURL(file),
      width: 200,
      height: 200,
      duration: 5000, // 5 seconds default
      ephemeral: false,
    };
    
    // Add to media store
    const { addMediaItem } = useMediaStore.getState();
    await addMediaItem(activeProject.id, mediaItem);
    
    // Add to timeline at drop position
    const added = useMediaStore.getState().mediaItems.find(
      m => m.url === mediaItem.url
    );
    if (added) {
      addMediaAtTime(added, dropTime);
    }
  }
  return;
}
```

---

## Task 8: Update Sounds View (5 minutes)

### Files to Modify:
- `qcut/apps/web/src/components/editor/media-panel/views/sounds.tsx`

### Steps:
1. Import the hook:
```typescript
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
```

2. Find the scroll handling code and replace with:
```typescript
// Remove manual scroll handling code
// Replace with:
const { scrollAreaRef, handleScroll } = useInfiniteScroll({
  onLoadMore: loadMore,
  hasMore: hasNextPage,
  isLoading: isLoadingMore || isSearching,
});

// Update ScrollArea component:
<ScrollArea
  className="flex-1 h-full"
  ref={scrollAreaRef}
  onScrollCapture={handleScroll}
>
```

---

## Task 9: Update Stickers View Imports (3 minutes)

### Files to Modify:
- `qcut/apps/web/src/components/editor/media-panel/views/stickers.tsx`

### Steps:
1. Verify the component has all necessary imports:
```typescript
import { InputWithBack } from "@/components/ui/input-with-back";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
```

2. If any imports are missing, add them at the top of the file

---

## Task 10: Test Integration (5 minutes)

### Steps:
1. Build the project:
```bash
cd qcut && bun run build
```

2. Run in development:
```bash
bun run dev
```

3. Test:
- Open media panel
- Click on Stickers tab
- Search for icons
- Try adding a sticker to timeline
- Check if recent stickers appear

---

## Files Status Summary

| File | Status | Action Needed |
|------|--------|---------------|
| iconify-api.ts | ✅ Exists | None |
| stickers-store.ts | ✅ Exists | None |
| stickers.tsx | ✅ Exists | Update imports |
| use-infinite-scroll.ts | ❌ Missing | Copy from task folder |
| input-with-back.tsx | ❌ Missing | Copy from task folder |
| draggable-item.tsx | ⚠️ Partial | Add variant & isDraggable |
| media-store.ts | ⚠️ Missing ephemeral | Add property |
| timeline-store.ts | ❌ No sticker support | Add handler |
| sounds.tsx | ❌ Old scroll | Update to use hook |

---

## Quick Command Summary

```bash
# Copy missing files
cp "qcut\docs\task\use-infinite-scroll.ts" "qcut\apps\web\src\hooks\"
cp "qcut\docs\task\input-with-back.tsx" "qcut\apps\web\src\components\ui\"

# Build and test
cd qcut
bun run build
bun run dev
```

---

## Estimated Time: 45 minutes total
- Most of the heavy work is already done
- Just need to fill in the missing pieces
- Each task is still under 10 minutes