# Fix: Media Store Sync on Timeline addElement

## Problem

When using the Claude API to import media files and then add them to the timeline, images appear **broken** (missing/invisible) in the QCut editor. The API reports success for every operation, but the elements are silently dropped in the renderer.

### Root Cause Chain

```
Claude API: POST /media/:projectId/import
    -> claude-media-handler.ts: importMediaFile()
    -> Copies file to disk (media/ folder)
    -> Returns success with MediaFile metadata
    -> NEVER notifies the renderer's Zustand media store

Claude API: POST /timeline/:projectId/elements
    -> claude-timeline-handler.ts: addElement()
    -> event.sender.send("claude:timeline:addElement", element)
    -> Renderer receives event...
    -> claude-timeline-bridge.ts: onAddElement()
    -> addClaudeMediaElement()
    -> findMediaItemForElement() searches mediaStore.mediaItems
    -> Media NOT FOUND (store was never updated)
    -> console.warn() + silent return
    -> Element is DROPPED, never added to timeline store
```

### Why It Appears to Work

- **Media import returns success** -- because the file IS copied to disk
- **addElement returns success** -- because the main process generates an element ID and sends it to renderer immediately (fire-and-forget via `event.sender.send()`)
- **Timeline export shows elements** -- because the main process stores them separately
- **Project stats show 0 elements** -- because stats come from the renderer's Zustand store, where elements were never added

### Affected Files

| File | Role | Issue |
|------|------|-------|
| `electron/claude/claude-media-handler.ts` | Media import | Only copies files, never notifies renderer |
| `apps/web/src/lib/claude-timeline-bridge.ts` | Timeline bridge | Silently drops elements when media not in store |
| `apps/web/src/stores/media-store.ts` | Media store | Has `syncFromProjectFolder()` but it's never called after import |

## Fix Applied

**File:** `apps/web/src/lib/claude-timeline-bridge.ts`

**Change:** Modified `onAddElement` handler to auto-sync media from the project folder when a media item isn't found in the Zustand store.

### Before

```typescript
claudeAPI.onAddElement((element: Partial<ClaudeElement>) => {
  try {
    const timelineStore = useTimelineStore.getState();
    const mediaStore = useMediaStore.getState();

    if (isClaudeMediaElementType({ type: element.type })) {
      addClaudeMediaElement({ element, timelineStore, mediaStore });
      // ^ silently fails if media not in store
      return;
    }
    // ...
  } catch (error) { ... }
});
```

### After

```typescript
claudeAPI.onAddElement(async (element: Partial<ClaudeElement>) => {
  try {
    const timelineStore = useTimelineStore.getState();
    let mediaStore = useMediaStore.getState();

    if (isClaudeMediaElementType({ type: element.type })) {
      // Check if media exists in store; if not, sync from disk first
      const existingMedia = findMediaItemForElement({
        element,
        mediaItems: mediaStore.mediaItems,
      });

      if (!existingMedia) {
        console.log(
          "[ClaudeTimelineBridge] Media not in store, syncing from project folder..."
        );
        try {
          const projectState = useProjectStore.getState();
          const projectId = projectState.activeProject?.id;
          if (projectId) {
            await mediaStore.syncFromProjectFolder(projectId);
            // Re-read store after sync
            mediaStore = useMediaStore.getState();
          }
        } catch (syncError) {
          console.warn("[ClaudeTimelineBridge] Folder sync failed:", syncError);
        }
      }

      addClaudeMediaElement({ element, timelineStore, mediaStore });
      return;
    }
    // ...
  } catch (error) { ... }
});
```

### How the Fix Works

1. When `onAddElement` receives a media element, it first checks if the media exists in the Zustand store
2. If NOT found, it triggers `syncFromProjectFolder()` which scans the `media/` directory on disk and imports any untracked files into the store
3. After sync, it re-reads the store state (which now contains the newly imported media)
4. Then proceeds with the normal `addClaudeMediaElement()` flow, which can now find the media

## Additional Notes

### Related Issue: `applyTimelineToStore` is a Stub

The timeline import function at line 449 of `claude-timeline-bridge.ts` is a stub:

```typescript
function applyTimelineToStore(timeline: ClaudeTimeline): void {
  console.warn(
    "[ClaudeTimelineBridge] Timeline import requires user confirmation - not yet implemented"
  );
}
```

This means `POST /timeline/:projectId/import` with full JSON also doesn't work. This is separate from the addElement fix but worth noting.

### Potential Future Improvements

1. **Notify renderer on media import:** Have `claude-media-handler.ts` send an IPC event to trigger a media store refresh after successful import
2. **Return errors from addElement:** Instead of fire-and-forget (`event.sender.send`), use `event.sender.invoke` with a response so the API can report when element addition actually fails
3. **Implement `applyTimelineToStore`:** Complete the stub so full timeline JSON import works

## Testing

1. Start QCut with the patched code
2. Import media via `POST /api/claude/media/:projectId/import`
3. Add element via `POST /api/claude/timeline/:projectId/elements` with `sourceName` matching the imported file
4. Verify element appears on the timeline (not broken)
5. Verify `GET /api/claude/project/:projectId/stats` shows correct element count
