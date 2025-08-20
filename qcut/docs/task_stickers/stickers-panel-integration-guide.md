# Stickers Panel Integration Guide

## Overview
This guide breaks down the stickers panel implementation into small, manageable tasks that can each be completed in under 10 minutes. Each task reuses existing code patterns and maintains backward compatibility.

---

## Task 1: Add Iconify API Configuration (5 minutes)

### Files to Modify:
- `qcut/apps/web/next.config.ts`

### Steps:
1. Open `next.config.ts`
2. Add Iconify API domains to image configuration:

```typescript
// In next.config.ts, find the images.remotePatterns array and add:
{
  protocol: "https",
  hostname: "api.iconify.design",
},
{
  protocol: "https",
  hostname: "api.simplesvg.com",
},
{
  protocol: "https",
  hostname: "api.unisvg.com",
},
```

**Note**: This enables loading SVG icons from Iconify's CDN servers.

---

## Task 2: Create Iconify API Utilities (8 minutes)

### Files to Create:
- `qcut/apps/web/src/lib/iconify-api.ts`

### Steps:
1. Copy the entire `iconify-api.ts` file from `qcut/docs/task/iconify-api.ts`
2. Place it in `qcut/apps/web/src/lib/`

**Key Features**:
- Multiple host fallback system
- SVG download and conversion
- Collection management
- Search functionality

---

## Task 3: Add Infinite Scroll Hook (5 minutes)

### Files to Create:
- `qcut/apps/web/src/hooks/use-infinite-scroll.ts`

### Steps:
1. Copy `use-infinite-scroll.ts` from `qcut/docs/task/`
2. Place it in `qcut/apps/web/src/hooks/`

**Reuses**: Existing React hooks patterns from the codebase

---

## Task 4: Create Input with Back Component (7 minutes)

### Files to Create:
- `qcut/apps/web/src/components/ui/input-with-back.tsx`

### Files to Modify:
- `qcut/apps/web/src/components/ui/input.tsx`

### Steps:
1. Copy `input-with-back.tsx` from `qcut/docs/task/`
2. Place it in `qcut/apps/web/src/components/ui/`
3. Add `"use client";` to top of `input.tsx` if not present

**Dependencies**: Uses existing Button and Input components

---

## Task 5: Update Draggable Item Component (8 minutes)

### Files to Modify:
- `qcut/apps/web/src/components/ui/draggable-item.tsx`

### Steps:
1. Add new props to `DraggableMediaItemProps` interface:

```typescript
interface DraggableMediaItemProps {
  // ... existing props
  showLabel?: boolean;
  rounded?: boolean;
  variant?: "default" | "card";
  isDraggable?: boolean;
}
```

2. Update component to handle new props:

```typescript
export function DraggableMediaItem({
  // ... existing props
  showLabel = true,
  rounded = false,
  variant = "default",
  isDraggable = true,
  // ... rest
}: DraggableMediaItemProps) {
  // Update className logic to support rounded and variant
  const itemClassName = cn(
    "relative group cursor-pointer",
    rounded && "rounded-full",
    variant === "card" && "bg-card border",
    className
  );
  
  // Conditionally render label based on showLabel
  // Conditionally apply drag handlers based on isDraggable
}
```

---

## Task 6: Create Stickers Store (8 minutes)

### Files to Create:
- `qcut/apps/web/src/stores/stickers-store.ts`

### Steps:
1. Copy entire `stickers-store.ts` from `qcut/docs/task/`
2. Place it in `qcut/apps/web/src/stores/`

**Pattern**: Follows existing Zustand store patterns (media-store, timeline-store)

---

## Task 7: Update Media Store (3 minutes)

### Files to Modify:
- `qcut/apps/web/src/stores/media-store.ts`

### Steps:
1. Add `ephemeral` property to `MediaItem` type:

```typescript
export interface MediaItem {
  // ... existing properties
  ephemeral?: boolean; // Add this line
}
```

2. In `MediaView` component, filter out ephemeral items:

```typescript
// In the filter logic, add:
if (item.ephemeral) return false;
```

---

## Task 8: Add Timeline Sticker Support (9 minutes)

### Files to Modify:
- `qcut/apps/web/src/stores/timeline-store.ts`

### Steps:
1. Add sticker drop handling in the `handleDrop` function:

```typescript
// Around line where drop types are handled, add:
if (data.type === "sticker") {
  // Download sticker using stickers store
  const file = await useStickersStore.getState().downloadSticker(data.iconName);
  if (file) {
    // Create media item
    const mediaItem = {
      name: data.iconName.replace(":", "-"),
      type: "image" as const,
      file,
      url: URL.createObjectURL(file),
      width: 200,
      height: 200,
      duration: TIMELINE_CONSTANTS.DEFAULT_IMAGE_DURATION,
      ephemeral: false,
    };
    // Add to media store and timeline
    await addMediaItem(activeProject.id, mediaItem);
    // ... rest of timeline add logic
  }
}
```

---

## Task 9: Create Stickers View Component (10 minutes)

### Files to Create:
- `qcut/apps/web/src/components/editor/media-panel/views/stickers.tsx`

### Steps:
1. Copy entire `stickers-view.tsx` from `qcut/docs/task/`
2. Place it in `qcut/apps/web/src/components/editor/media-panel/views/`

**Note**: This is the largest file but it's self-contained and follows existing view patterns

---

## Task 10: Integrate Stickers Panel (5 minutes)

### Files to Modify:
- `qcut/apps/web/src/components/editor/media-panel/index.tsx`

### Steps:
1. Import StickersView:

```typescript
import { StickersView } from "./views/stickers";
```

2. Replace stickers placeholder:

```typescript
// Find and replace:
stickers: (
  <div className="p-4 text-muted-foreground">
    Stickers view coming soon...
  </div>
),

// With:
stickers: <StickersView />,
```

---

## Task 11: Update Sounds View (7 minutes)

### Files to Modify:
- `qcut/apps/web/src/components/editor/media-panel/views/sounds.tsx`

### Steps:
1. Import the new infinite scroll hook:

```typescript
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
```

2. Replace manual scroll handling with hook:

```typescript
// Replace existing scroll logic with:
const { scrollAreaRef, handleScroll } = useInfiniteScroll({
  onLoadMore: loadMore,
  hasMore: hasNextPage,
  isLoading: isLoadingMore || isSearching,
});

// Update ScrollArea:
<ScrollArea
  ref={scrollAreaRef}
  onScrollCapture={handleScroll}
  // ... rest
>
```

---

## Task 12: Add Package Dependencies (3 minutes)

### Files to Modify:
- `qcut/packages/web/package.json`

### Steps:
1. Add to dependencies:

```json
"@tanstack/react-virtual": "^3.5.0"
```

2. Run installation:

```bash
bun install
```

---

## Testing Checklist (5 minutes)

After completing all tasks, verify:

1. **Build passes**: `bun run build`
2. **No TypeScript errors**: `bun run check-types`
3. **Existing features work**: Media, Sounds, Text panels still function
4. **New features**:
   - Stickers tab appears in media panel
   - Search works
   - Icons load from Iconify
   - Can add stickers to timeline
   - Recent stickers show up

---

## Rollback Plan

If any issues occur:

1. **Git stash changes**: `git stash`
2. **Revert individual files** if needed
3. **Check console** for specific errors
4. **Disable stickers tab** temporarily by reverting Task 10

---

## Common Issues & Solutions

### Issue: Icons not loading
**Solution**: Check network tab for Iconify API calls, verify domains in next.config.ts

### Issue: TypeScript errors
**Solution**: Ensure all imports are correct, check if types match existing patterns

### Issue: Stickers not adding to timeline
**Solution**: Check timeline-store.ts handleDrop implementation, verify media store integration

### Issue: Infinite scroll not working
**Solution**: Verify use-infinite-scroll hook is imported correctly, check scroll container ref

---

## Notes

- All code follows existing patterns in the codebase
- No breaking changes to existing features
- Can be implemented incrementally (stop at any task)
- Each task is independent enough to test separately
- Total implementation time: ~90 minutes (9 minutes average per task)