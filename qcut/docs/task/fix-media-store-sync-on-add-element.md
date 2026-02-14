# Fix: Claude API — Timeline addElement & Stats Bugs

## Investigation Summary

When using the Claude API to import media files and add them to the timeline, images appear **broken** in the QCut editor. Investigation uncovered three bugs.

---

## Bug 1: Stats Always Return Empty (FIXED)

**Severity:** High — stats endpoint is completely broken

### Root Cause

The stats request/response uses a `requestId` for matching, but the bridge never forwards it:

```
Main process sends:   statsRequest({ projectId, requestId })
                           ↓
Preload passes:       callback(projectId, requestId)    // 2 params
                           ↓
Bridge receives:      onStatsRequest(() => { ... })     // 0 params! ← BUG
                           ↓
Bridge sends back:    sendStatsResponse(stats)           // no requestId! ← BUG
                           ↓
Main process checks:  responseId !== requestId           // undefined !== "abc123"
                           ↓
                      → filtered out → 3s timeout → empty stats
```

### Files Changed

**`apps/web/src/lib/claude-timeline-bridge.ts`** (line 713):

Before:
```typescript
projectAPI.onStatsRequest(() => {
    // ... computes stats ...
    projectAPI.sendStatsResponse(stats);
});
```

After:
```typescript
projectAPI.onStatsRequest((_projectId: string, requestId: string) => {
    // ... computes stats ...
    projectAPI.sendStatsResponse(stats, requestId);
});
```

**`apps/web/src/types/electron.d.ts`** (line 872-873):

Before:
```typescript
onStatsRequest: (callback: () => void) => void;
sendStatsResponse: (stats: ProjectStats) => void;
```

After:
```typescript
onStatsRequest: (callback: (projectId: string, requestId: string) => void) => void;
sendStatsResponse: (stats: ProjectStats, requestId: string) => void;
```

---

## Bug 2: Project Settings 404 (FIXED)

**Severity:** Medium — project settings endpoint always fails

### Root Cause

`getProjectSettingsPath()` in `electron/claude/utils/helpers.ts` pointed to `project.json`, but the actual file is `project.qcut`:

```
/Users/peter/Documents/QCut/Projects/{projectId}/
├── project.qcut    ← actual file
└── (no project.json)
```

### Fix

**`electron/claude/utils/helpers.ts`** (line 48):

Before:
```typescript
export function getProjectSettingsPath(projectId: string): string {
  return path.join(getProjectPath(projectId), "project.json");
}
```

After:
```typescript
export function getProjectSettingsPath(projectId: string): string {
  return path.join(getProjectPath(projectId), "project.qcut");
}
```

Both `getProjectSettings` and `updateProjectSettings` use this helper, so both are fixed. The `.qcut` file is standard JSON with the same structure the handler expects (`name`, `canvasSize`, `fps`, etc. at root level).

---

## Bug 3: Media Items Synced Without URL — Broken Images (FIXED)

**Severity:** High — all images added via Claude API appear broken in timeline

### Symptom

Console floods with:
```
[TimelineElement] Media item 586009de-f896-959e-9bc8-3d75761cd359 has no URL
```

Images are added to the timeline store (confirmed by timeline export), but render as broken/empty in the editor.

### Root Cause

When the Claude API adds an element to the timeline, the bridge calls `syncProjectFolder()` to import untracked media files from disk into the Zustand media store. The sync reads files from disk, creates `File` objects, and calls `addMediaItem()` — but **never creates a blob URL** for display.

The rendering pipeline in `timeline-element.tsx` reads `mediaItem.url` to display images:
```typescript
const mediaItemUrl = mediaItem?.url;   // ← undefined! No URL was set

if (mediaItem && !mediaItemUrl) {
    console.warn(`[TimelineElement] Media item ${mediaItem.id} has no URL`);
}
```

Compare with `addGeneratedImages()` in the media store, which correctly creates blob URLs:
```typescript
// addGeneratedImages does this:
displayUrl = getOrCreateObjectURL(file, "addMediaItem-display");
return { ...item, url: displayUrl };
```

But `project-folder-sync.ts` did NOT:
```typescript
// project-folder-sync.ts was doing this — no url!
await store.addMediaItem(projectId, {
    name: file.name,
    type: file.type,
    file: fileObj,        // ← File object exists
    // url: ???            // ← MISSING! No blob URL created
    localPath: file.path,
    isLocalFile: true,
});
```

### The Fix

**`apps/web/src/lib/project-folder-sync.ts`**:

1. Import `getOrCreateObjectURL` from `@/lib/blob-manager`
2. Create a blob URL from the `File` object before calling `addMediaItem`

Before:
```typescript
import { getMimeType } from "@/lib/bulk-import";
import { debugLog, debugError } from "@/lib/debug-config";

// ... later in the sync loop:

await store.addMediaItem(projectId, {
    name: file.name,
    type: file.type as "video" | "audio" | "image",
    file: fileObj,
    localPath: file.path,
    isLocalFile: true,
    folderIds,
    metadata: isGenerated
        ? { source: "project-folder-sync-generated" }
        : { source: "project-folder-sync" },
});
```

After:
```typescript
import { getMimeType } from "@/lib/bulk-import";
import { getOrCreateObjectURL } from "@/lib/blob-manager";
import { debugLog, debugError } from "@/lib/debug-config";

// ... later in the sync loop:

// Create blob URL for display so timeline elements can render the media
const displayUrl = getOrCreateObjectURL(fileObj, "project-folder-sync");

await store.addMediaItem(projectId, {
    name: file.name,
    type: file.type as "video" | "audio" | "image",
    file: fileObj,
    url: displayUrl,
    localPath: file.path,
    isLocalFile: true,
    folderIds,
    metadata: isGenerated
        ? { source: "project-folder-sync-generated" }
        : { source: "project-folder-sync" },
});
```

### Why This Works

- `getOrCreateObjectURL` creates a `blob:` URL from the `File` object via `URL.createObjectURL()`
- The blob URL is cached by the blob manager, so the same file won't get duplicate URLs
- `timeline-element.tsx` reads `mediaItem.url` and uses it as the `<img>` src
- This matches the pattern already used by `addGeneratedImages()` in the media store

---

## Media Store Sync Flow (Working)

The auto-sync mechanism in `claude-timeline-bridge.ts` works correctly:

```typescript
async function resolveMediaItemForElement({ element, projectId }) {
    // 1. Check store first
    const mediaBeforeSync = findMediaItemForElement({ element, mediaItems });
    if (mediaBeforeSync) return mediaBeforeSync;

    // 2. If not found, sync from disk
    await syncProjectMediaIfNeeded({ projectId });

    // 3. Retry lookup after sync
    return findMediaItemForElement({ element, updatedMediaItems });
}
```

- Media import copies files to `media/` folder ← works
- `addElement` triggers auto-sync when media not in store ← works
- Elements ARE added to the timeline store ← confirmed by timeline export
- Synced items now have blob URLs for rendering ← fixed by Bug 3

---

## Testing After Fix

1. Rebuild QCut with all fixes
2. Run the full workflow:
   ```bash
   # Import media
   curl -X POST -H "Content-Type: application/json" \
     -d '{"source":"/path/to/image.png"}' \
     http://127.0.0.1:8765/api/claude/media/PROJECT_ID/import

   # Add to timeline
   curl -X POST -H "Content-Type: application/json" \
     -d '{"type":"media","trackIndex":0,"startTime":0,"endTime":5,"sourceName":"image.png"}' \
     http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/elements

   # Verify stats now work
   curl http://127.0.0.1:8765/api/claude/project/PROJECT_ID/stats
   ```
3. Verify stats return correct `elementCount` and `mediaCount`
4. Verify images render properly in the QCut editor (no "has no URL" warnings in console)
5. Open DevTools — confirm no `[TimelineElement] Media item ... has no URL` warnings
