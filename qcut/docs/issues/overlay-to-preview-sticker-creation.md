# Overlay to Preview: Sticker Not Creating in Timeline

## Issue Description
When using the "Add as Overlay" context menu option from the media panel to add media items as overlay stickers, the stickers are not being created in the timeline as expected.

## Expected Behavior
1. Right-click on a media item (image or video) in the media panel
2. Select "Add as Overlay" from the context menu
3. Sticker should appear in the timeline at the current playback position
4. Sticker should be visible in the preview/canvas area

## Current Behavior
The "Add as Overlay" context menu action executes without error, but no sticker appears in the timeline or preview area.

## Code Location
The issue is located in `qcut/apps/web/src/components/editor/media-panel/views/media.tsx` around lines 389-417:

```typescript
{(item.type === "image" || item.type === "video") && (
  <ContextMenuItem
    aria-label="Add as overlay"
    onClick={(e) => {
      e.stopPropagation();
      const { addOverlaySticker } = useStickersOverlayStore.getState();
      const { currentTime } = usePlaybackStore.getState();
      const { getTotalDuration } = useTimelineStore.getState();
      const totalDuration = getTotalDuration();
      const start = Math.max(0, Math.min(currentTime, totalDuration));
      const end = Math.min(start + 5, totalDuration);
      addOverlaySticker(item.id, {
        timing: {
          startTime: start,
          endTime: end,
        },
      });
      toast.success(`Added "${item.name}" as overlay`);
    }}
  >
    <Layers className="h-4 w-4 mr-2" aria-hidden="true" />
    Add as Overlay
  </ContextMenuItem>
)}
```

## Investigation Points
1. **Store Integration**: Verify that `useStickersOverlayStore.addOverlaySticker()` is properly updating the store state
2. **Timeline Rendering**: Check if the timeline component is properly subscribing to and rendering overlay stickers
3. **State Synchronization**: Ensure the stickers overlay store is properly connected to the timeline rendering system
4. **Canvas Integration**: Verify that overlay stickers are being rendered on the canvas/preview area

## Related Files to Investigate
- `qcut/apps/web/src/stores/stickers-overlay-store.ts` - Store implementation
- `qcut/apps/web/src/components/editor/timeline/` - Timeline components
- `qcut/apps/web/src/components/editor/preview-panel.tsx` - Canvas rendering
- Media item data structure and overlay sticker data model compatibility

## Severity
**Medium** - Feature works in UI but fails to create expected timeline elements

## Priority
**High** - This affects the core video editing workflow where users expect to be able to add overlay elements to their timeline

## Date Created
August 22, 2025

## Status
**Open** - Needs investigation and fix