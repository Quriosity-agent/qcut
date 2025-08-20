# Stickers Panel Integration Guide - UPDATED

## Current Status Analysis (Verified)

### ✅ Already Implemented:
1. **iconify-api.ts** - Already exists in `src/lib/`
2. **stickers-store.ts** - Already exists in `src/stores/`
3. **stickers.tsx view** - Already exists in `src/components/editor/media-panel/views/`
4. **StickersView integrated** - Already imported and used in media panel
5. **Draggable item props** - `showLabel` and `rounded` already exist
6. **Timeline sticker support** - Already has basic sticker type handling in timeline-store.ts

### ⚠️ Partially Implemented:
1. **draggable-item.tsx** - Missing `variant` and `isDraggable` props
2. **media-store.ts** - Missing `ephemeral` property in MediaItem interface
3. **media.tsx filter** - Missing ephemeral filtering

### ❌ Not Implemented:
1. **use-infinite-scroll.ts** - Hook doesn't exist in `src/hooks/`
2. **input-with-back.tsx** - Component doesn't exist in `src/components/ui/`
3. **Sounds view** - Not using infinite scroll hook

### 📝 Not Applicable:
1. **next.config.ts** - Project uses Vite, not Next.js (no configuration needed)

---

## Revised Implementation Tasks

## Task 1: Skip Iconify Configuration (0 minutes)
**STATUS: NOT NEEDED** - Project uses Vite, not Next.js. No domain configuration required.

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

## Task 4: Update Draggable Item Component (3 minutes)

### Files to Modify:
- `qcut/apps/web/src/components/ui/draggable-item.tsx`

### Current State:
- ✅ `showLabel` prop exists (line 25)
- ✅ `rounded` prop exists (line 26)
- ❌ Missing `variant` prop
- ❌ Missing `isDraggable` prop

### Steps:
1. Add missing props to interface (line 16):
```typescript
export interface DraggableMediaItemProps {
  // ... existing props
  variant?: "default" | "card";
  isDraggable?: boolean;
}
```

2. Add to function parameters (line 29):
```typescript
export function DraggableMediaItem({
  // ... existing props
  variant = "default",
  isDraggable = true,
  // ... rest
}: DraggableMediaItemProps) {
```

3. Update rendering logic to support variant and isDraggable:
```typescript
// Add variant to className
const itemClassName = cn(
  "relative group cursor-pointer",
  rounded && "rounded-full", // Already exists
  variant === "card" && "bg-card border",
  className
);

// Conditionally apply drag handlers
const dragProps = isDraggable ? {
  draggable: true,
  onDragStart: handleDragStart,
  onDragEnd: handleDragEnd,
} : {};
```

---

## Task 5: Update Media Store (2 minutes)

### Files to Modify:
- `qcut/apps/web/src/stores/media-store.ts`

### Current State:
- MediaItem interface exists starting around line 7
- Missing `ephemeral` property

### Steps:
1. Add `ephemeral` property to MediaItem interface (after line 22):
```typescript
export interface MediaItem {
  id: string;
  name: string;
  type: MediaType;
  // ... existing properties
  color?: string; // Text color
  ephemeral?: boolean; // Add this line - marks items as temporary (not saved)
}
```

---

## Task 6: Update Media View Filter (2 minutes)

### Files to Modify:
- `qcut/apps/web/src/components/editor/media-panel/views/media.tsx`

### Current State:
- Filter logic exists in useEffect
- Missing ephemeral check

### Steps:
1. Find the filter logic (around line 58) and add ephemeral check:
```typescript
useEffect(() => {
  const filtered = mediaItems.filter((item) => {
    // Add this line first to exclude ephemeral items
    if (item.ephemeral) return false;
    
    if (mediaFilter && mediaFilter !== "all" && item.type !== mediaFilter) {
      return false;
    }
    // ... rest of existing filter logic
```

---

## Task 7: Verify Timeline Store Sticker Support (1 minute)

### Files to Check:
- `qcut/apps/web/src/stores/timeline-store.ts`

### Current State:
- ✅ Already has basic sticker type handling
- Search for `type === "sticker"` shows it's already implemented

### Verification Steps:
1. Verify sticker handling exists in timeline-store.ts
2. Check if it properly handles sticker drops
3. No changes needed if already working

**Note**: If sticker drops aren't working despite the code being there, check:
- Is `useStickersStore` imported?
- Is the sticker download logic working?
- Are stickers being added to the timeline correctly?

---

## Task 8: Update Sounds View (3 minutes) - OPTIONAL

### Files to Modify:
- `qcut/apps/web/src/components/editor/media-panel/views/sounds.tsx`

### Current State:
- Works without infinite scroll hook
- Can be updated after hook is created

### Steps (After Task 2 is complete):
1. Import the hook:
```typescript
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
```

2. Find scroll handling and integrate the hook:
```typescript
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

**Note**: This is optional - sounds view works without this optimization.

---

## Task 9: Verify Stickers View (1 minute)

### Files to Check:
- `qcut/apps/web/src/components/editor/media-panel/views/stickers.tsx`

### Current State:
- ✅ Stickers view already exists and is functional
- Currently using standard Input component (works fine)
- Not using infinite scroll (works fine with current implementation)

### Optional Enhancement (After Tasks 2 & 3):
Once `InputWithBack` and `useInfiniteScroll` are created, update imports:
```typescript
import { InputWithBack } from "@/components/ui/input-with-back";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
```

**Note**: Stickers panel works without these enhancements.

---

## Task 10: Test Integration (3 minutes)

### Steps:
1. Build the project:
```bash
cd qcut && bun run build
```

2. Run in development:
```bash
bun run dev
```

3. Test what's already working:
- ✅ Open media panel
- ✅ Click on Stickers tab (already works)
- ✅ Search for icons (already works)
- ⚠️ Try adding a sticker to timeline (verify if working)
- ✅ Check if recent stickers appear (already works)

---

## Implementation Priority

### 🔴 Critical (Required for basic functionality):
1. **Task 2**: Create `use-infinite-scroll.ts` - 5 min
2. **Task 3**: Create `input-with-back.tsx` - 5 min
3. **Task 5**: Add `ephemeral` property to MediaItem - 2 min
4. **Task 6**: Add ephemeral filtering to media view - 2 min

### 🟡 Important (Enhances functionality):
5. **Task 4**: Add variant & isDraggable to draggable-item - 3 min

### 🟢 Optional (Nice to have):
6. **Task 8**: Update sounds view with infinite scroll - 3 min

### ✅ Already Done:
- Task 1: Iconify config (not needed for Vite)
- Task 7: Timeline sticker support (already exists)
- Task 9: Stickers view (already functional)

---

## Quick Implementation Commands

```bash
# Step 1: Copy the two missing files
cp "C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\docs\task\use-infinite-scroll.ts" "C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\apps\web\src\hooks\"
cp "C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\docs\task\input-with-back.tsx" "C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut\apps\web\src\components\ui\"

# Step 2: Build and test
cd qcut
bun run build
bun run dev
```

---

## Updated Files Status

| File | Current Status | Action Required | Priority |
|------|---------------|-----------------|----------|
| iconify-api.ts | ✅ Exists | None | - |
| stickers-store.ts | ✅ Exists | None | - |
| stickers.tsx | ✅ Works | Optional: update imports | 🟢 |
| use-infinite-scroll.ts | ❌ Missing | Create/Copy | 🔴 |
| input-with-back.tsx | ❌ Missing | Create/Copy | 🔴 |
| draggable-item.tsx | ⚠️ Partial | Add 2 props | 🟡 |
| media-store.ts | ⚠️ Incomplete | Add ephemeral | 🔴 |
| media.tsx | ⚠️ Incomplete | Add filter | 🔴 |
| timeline-store.ts | ✅ Has stickers | Verify working | ✅ |
| sounds.tsx | ✅ Works | Optional: add infinite scroll | 🟢 |

---

## Estimated Time: 20 minutes total
- Critical tasks: 14 minutes
- Important tasks: 3 minutes  
- Optional tasks: 3 minutes

**Note**: The stickers panel is mostly functional. These updates will complete the integration and add optimizations.