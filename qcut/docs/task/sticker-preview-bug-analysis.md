# Sticker Preview Bug Analysis

## Bug Description
The sticker preview in the timeline is broken (shows only text, not the actual sticker image). However, after closing and reopening QCut, the sticker preview works correctly. This indicates a state initialization or caching issue.

## Current Behavior

### What's Happening Now:
1. When a sticker is added to the timeline, it only shows the sticker name as text
2. The timeline-element.tsx file (lines 263-271) renders stickers as plain text:
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

### Expected Behavior:
Stickers should show a visual preview/thumbnail like other media types (images, videos) do.

## Root Cause Analysis

### 1. Missing Thumbnail Implementation
Unlike media elements (videos/images) which have thumbnail rendering logic, stickers don't have any preview image rendering. The code only displays the sticker name.

### 2. Media Item Loading Issue
The sticker element is treated as having a `mediaId` (line 119-120 in timeline-element.tsx):
```tsx
const mediaItem =
  element.type === "media" || element.type === "sticker"
    ? mediaItems.find((item) => item.id === element.mediaId)
    : null;
```

However, stickers might not have proper media items in the store when first added, which could explain why they work after a restart (when data is loaded from storage).

### 3. Possible Race Condition
The fact that it works after restarting suggests:
- Stickers are properly saved to storage
- On app restart, stickers are loaded from storage with proper media data
- During initial addition, the media item might not be properly created or synced

## Why It Works After Restart

When the app restarts:
1. All media items are loaded from IndexedDB/localStorage
2. Sticker media items are properly initialized with their URLs/thumbnails
3. The timeline can then find the media item and render it properly

During initial addition:
1. The sticker might be added to timeline before its media item is created
2. Or the media item might be missing the thumbnail URL
3. The timeline element falls back to text-only display

## Potential Solutions

### Solution 1: Add Sticker Preview Rendering (Recommended)
Modify the sticker rendering in timeline-element.tsx to show an image preview:

```tsx
if (element.type === "sticker") {
  // Try to get the media item for the sticker
  const stickerMedia = mediaItems.find(item => item.id === element.mediaId);
  
  return (
    <div className="w-full h-full flex items-center justify-start pl-2">
      {stickerMedia?.thumbnailUrl ? (
        <img 
          src={stickerMedia.thumbnailUrl} 
          alt={element.name}
          className="h-full object-contain"
        />
      ) : (
        <span className="text-xs text-foreground/80 truncate">
          {element.name}
        </span>
      )}
    </div>
  );
}
```

### Solution 2: Ensure Media Item Creation
When adding a sticker to the timeline, ensure the media item is properly created first:
1. Create media item with proper thumbnail URL
2. Wait for media item to be saved
3. Then add timeline element with correct mediaId

### Solution 3: Fix Media Store Synchronization
Investigate the media store to ensure:
1. Sticker media items are created with thumbnailUrl
2. Media items are immediately available after creation
3. No race conditions between timeline and media store updates

## Files to Investigate/Modify

1. **qcut/apps/web/src/components/editor/timeline/timeline-element.tsx**
   - Lines 263-271: Current sticker rendering logic
   - Need to add image preview support

2. **qcut/apps/web/src/stores/media-store.ts**
   - Check how sticker media items are created
   - Ensure thumbnailUrl is set for stickers

3. **qcut/apps/web/src/components/editor/timeline/index.tsx**
   - Lines 385-387: Sticker drop handling
   - Ensure media item is created before timeline element

4. **qcut/apps/web/src/stores/timeline-store.ts**
   - Check addElementToTrack logic for stickers
   - Ensure proper synchronization with media store

## Next Steps

1. Add image preview rendering for stickers in timeline-element.tsx
2. Verify media items are created with thumbnailUrl for stickers
3. Test the fix by:
   - Adding a new sticker to timeline
   - Checking if preview shows immediately
   - Verifying it persists after restart
4. Consider adding a loading state while media item is being created