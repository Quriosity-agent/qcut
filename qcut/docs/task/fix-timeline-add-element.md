# Fix: Timeline addElement Bridge Not Implemented

**Date:** 2026-02-13
**File:** `apps/web/src/lib/claude-timeline-bridge.ts`
**Status:** Fix applied, rebuild required

## What Happened

When importing 10 videos from `~/Downloads` via the Claude API:

1. **Media import worked** — all 10 files were copied to the project's `media/` folder and appeared in QCut's media panel.
2. **Timeline add failed silently** — the API returned `success: true` with generated element IDs for each clip, but nothing appeared on the timeline.

## Root Cause

The `addElement` flow has three stages:

```
Claude API (HTTP) → Electron Main Process (IPC) → Renderer Bridge → Zustand Store
```

The **renderer bridge handler** (`onAddElement`) was an intentional stub. It logged the incoming element but never called the timeline store:

```typescript
// BEFORE (stub)
claudeAPI.onAddElement((element: Partial<ClaudeElement>) => {
  console.log("[ClaudeTimelineBridge] Adding element:", element);
  console.warn(
    "[ClaudeTimelineBridge] addElement not implemented - requires type mapping"
  );
});
```

The main process handler generated an element ID and returned it immediately — making the HTTP response look successful — but the renderer discarded the actual element data.

The same issue affects `applyTimelineToStore` (used by the timeline import endpoint) and `onUpdateElement` — both are also stubs.

## The Fix

Replaced the stub with a working implementation that:

1. Looks up the media item by `sourceName` (or `sourceId`) in `useMediaStore`
2. Finds or creates a track via `timelineStore.findOrCreateTrack("media")`
3. Calculates duration from `endTime - startTime` (falls back to media duration)
4. Calls `timelineStore.addElementToTrack()` with a proper `CreateMediaElement`

Also added support for `type: "text"` elements with default styling.

```typescript
// AFTER (working)
claudeAPI.onAddElement((element: Partial<ClaudeElement>) => {
  const timelineStore = useTimelineStore.getState();
  const mediaStore = useMediaStore.getState();

  if (
    element.type === "media" ||
    element.type === "video" ||
    element.type === "audio" ||
    element.type === "image"
  ) {
    let mediaItem = null;
    if (element.sourceName) {
      mediaItem = mediaStore.mediaItems.find(
        (item) => item.name === element.sourceName
      );
    }
    if (!mediaItem && element.sourceId) {
      mediaItem = mediaStore.mediaItems.find(
        (item) => item.id === element.sourceId
      );
    }

    if (!mediaItem) {
      console.warn("[ClaudeTimelineBridge] Media not found:", element.sourceName || element.sourceId);
      return;
    }

    const trackId = timelineStore.findOrCreateTrack("media");
    const duration =
      element.endTime != null && element.startTime != null
        ? element.endTime - element.startTime
        : mediaItem.duration || 10;

    timelineStore.addElementToTrack(trackId, {
      type: "media",
      name: mediaItem.name,
      mediaId: mediaItem.id,
      startTime: element.startTime || 0,
      duration,
      trimStart: 0,
      trimEnd: 0,
    });
  }
  // ... text element handling omitted for brevity
});
```

## Remaining Stubs

Two other bridge handlers are still stubs and will fail silently:

| Handler | Channel | Status |
|---------|---------|--------|
| `onAddElement` | `claude:timeline:addElement` | **Fixed** |
| `onUpdateElement` | `claude:timeline:updateElement` | Stub |
| `onApply` (timeline import) | `claude:timeline:apply` | Stub |

## To Apply

The fix is in renderer code, so QCut must be rebuilt:

```bash
cd /Users/peter/Desktop/code/qcut/qcut
bun run build
# then restart QCut
```
