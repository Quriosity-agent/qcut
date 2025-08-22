# Sticker Preview Implementation Guide

## Overview
Fix the sticker preview in timeline to show actual sticker images instead of just text, while ensuring backward compatibility with existing projects.

## Current Status (As of January 2025)
- ✅ **Data Layer**: Stickers properly downloaded and stored with blob URLs
- ✅ **Media Panel**: Stickers show image previews correctly
- ❌ **Timeline**: Shows only text names, not images (NEEDS FIX)
- ✅ **Export**: Stickers render correctly in final video

## Implementation Strategy
- **Minimal changes**: Only modify the rendering logic, not data structures
- **Graceful fallback**: Keep text display as fallback when image unavailable
- **No breaking changes**: Existing stickers without thumbnails still work

---

## Subtask 1: Add Sticker Thumbnail Rendering (5 minutes)

### File: `qcut/apps/web/src/components/editor/timeline/timeline-element.tsx`

**Location**: Lines 263-271 (inside the `renderContent` function)

**Current Code:**
```tsx
if (element.type === "sticker") {
  return (
    <div className="w-full h-full flex items-center justify-start pl-2">
      <span className="text-xs text-foreground/80 truncate">
        {element.name}
      </span>
    </div>
  );
}
```

**New Code:**
```tsx
if (element.type === "sticker") {
  // Safe fallback: mediaItem is already fetched at line 119
  const thumbnailUrl = mediaItem?.thumbnailUrl || mediaItem?.url;
  
  return (
    <div className="w-full h-full flex items-center justify-start pl-2 gap-2">
      {thumbnailUrl ? (
        <>
          <img 
            src={thumbnailUrl}
            alt={element.name}
            className="h-[calc(100%-8px)] w-auto object-contain rounded"
            onError={(e) => {
              // Hide image on error and show text fallback
              e.currentTarget.style.display = 'none';
            }}
          />
          <span className="text-xs text-foreground/80 truncate flex-1">
            {element.name}
          </span>
        </>
      ) : (
        <span className="text-xs text-foreground/80 truncate">
          {element.name}
        </span>
      )}
    </div>
  );
}
```

### Why This Works:
1. **Uses existing mediaItem**: The mediaItem is already fetched at line 119 for stickers
2. **Graceful fallback**: Shows text if no image available
3. **Error handling**: If image fails to load, it hides and shows text
4. **Preserves layout**: Maintains the same container structure

---

## Subtask 2: Verify Sticker Media Items Have URLs (ALREADY IMPLEMENTED)

### File: `qcut/apps/web/src/components/editor/timeline/index.tsx`

**Location**: Lines 387-441 (in the sticker drop handler)

**Current Implementation Status: ✅ COMPLETE**
The sticker drop handler already properly:
```tsx
1. Downloads sticker SVG from Iconify API
2. Creates blob URL using `URL.createObjectURL()`
3. Properly creates media item with URL
4. Adds to media store with correct ID
5. Creates timeline element with proper `mediaId` reference

**No changes needed here - the implementation is complete!**
```

---

## Subtask 3: Add CSS Styling for Consistency (2 minutes)

### File: `qcut/apps/web/src/components/editor/timeline/timeline-element.tsx`

**Add to the sticker rendering section:**

```tsx
// Additional styling classes for better appearance
const stickerImageClasses = cn(
  "h-[calc(100%-8px)]", // Leave padding
  "w-auto",
  "object-contain",
  "rounded",
  "pointer-events-none", // Prevent drag issues
  "select-none" // Prevent selection
);
```

---

## Testing Checklist (Quick Verification)

### Test Case 1: New Sticker Addition
1. Drag a sticker to timeline
2. ✅ Should show image preview immediately
3. ✅ Should show text name alongside

### Test Case 2: Existing Projects
1. Open project with existing stickers
2. ✅ Old stickers without thumbnails show text
3. ✅ New stickers show images

### Test Case 3: Error Handling
1. Add sticker with broken image URL
2. ✅ Should fallback to text display
3. ✅ No console errors

### Test Case 4: App Restart
1. Add sticker and save project
2. Restart app
3. ✅ Sticker preview still shows correctly

---

## Rollback Plan

If any issues occur, simply revert the changes in `timeline-element.tsx` back to:
```tsx
if (element.type === "sticker") {
  return (
    <div className="w-full h-full flex items-center justify-start pl-2">
      <span className="text-xs text-foreground/80 truncate">
        {element.name}
      </span>
    </div>
  );
}
```

---

## Why This Implementation is Safe

1. **No Data Structure Changes**: We only change rendering, not how stickers are stored
2. **Uses Existing Variables**: The `mediaItem` is already available in scope (fetched at line 119)
3. **Graceful Degradation**: Multiple fallback levels ensure something always displays
4. **Backward Compatible**: Old stickers without thumbnails continue to work
5. **Forward Compatible**: New stickers get enhanced preview automatically

## Performance Considerations

- **No Additional Fetches**: Uses already-loaded mediaItem
- **Lazy Loading**: Images load only when visible in timeline
- **Small Images**: Sticker icons are typically small SVGs (< 5KB typically)
- **Error Boundaries**: Failed images don't break the timeline
- **Blob URLs**: Stickers use efficient blob URLs, no network requests needed

## Time Estimate

- **Subtask 1**: 5 minutes (modify rendering logic) - **REQUIRED**
- **Subtask 2**: ~~3 minutes~~ Already implemented ✅
- **Subtask 3**: 2 minutes (add styling) - **OPTIONAL**
- **Total**: ~7 minutes implementation + 5 minutes testing

## Related Files and Current Implementation

### Core Files:
- **Timeline Element Rendering**: `timeline-element.tsx:263-271` (needs fix)
- **Sticker Drop Handler**: `timeline/index.tsx:387-441` (working)
- **Sticker Store**: `stickers-store.ts` (working)
- **Media Store**: `media-store.ts` (working)
- **Sticker Panel UI**: `sticker-item.tsx` (shows images correctly)

### Recent Commits:
- `e4e46be` - Added sticker preview bug analysis
- `498420b` - Improved sticker timeline integration
- `dc80f77` - Enhanced sticker drop handling
- `0888f28` - Added sticker type support

## Implementation Priority

**HIGH PRIORITY - Quick Win**: Only Subtask 1 is required. The fix is a simple 10-line change that will immediately improve user experience by showing sticker images in the timeline instead of just text.