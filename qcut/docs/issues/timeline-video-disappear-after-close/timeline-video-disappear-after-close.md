# Issue: Videos Disappear from Timeline After Closing Software

## Problem Description

When users add videos to the timeline, close the application, and reopen it, the videos in the timeline disappear. The timeline state is not properly persisted across sessions.

## Root Cause

### Primary Issue: Destructive State Clear on Project Load

The `loadProject` function in `project-store.ts` clears all timeline, media, and sticker data **before** attempting to load saved data from storage. If loading fails for any reason, the data is already gone with no way to recover.

### Secondary Issue: Auto-Save Timing

The auto-save mechanism has a 100ms delay. If the user closes the application within this window, changes may not be saved.

## Relevant Files

| File | Description |
|------|-------------|
| `apps/web/src/stores/project-store.ts` | Project lifecycle management, contains destructive clear pattern |
| `apps/web/src/stores/timeline-store.ts` | Timeline state management, auto-save logic |
| `apps/web/src/stores/media-store.ts` | Media item persistence |
| `apps/web/src/lib/storage/storage-service.ts` | Save/load operations for timeline |
| `apps/web/src/routes/editor.$project_id.lazy.tsx` | Editor initialization, calls loadProject |

## Relevant Code

### 1. Destructive Clear Pattern (project-store.ts:239-242)

```typescript
loadProject: async (id: string) => {
  // ... initialization code ...

  const mediaStore = (await getMediaStore()).useMediaStore.getState();
  const { useTimelineStore } = await import("./timeline-store");
  const timelineStore = useTimelineStore.getState();
  const { useStickersOverlayStore } = await import("./stickers-overlay-store");
  const { useSceneStore } = await import("./scene-store");
  const stickersStore = useStickersOverlayStore.getState();
  const sceneStore = useSceneStore.getState();

  // CRITICAL BUG: Clear data BEFORE loading from storage
  mediaStore.clearAllMedia();           // Line 239
  timelineStore.clearTimeline();        // Line 240
  stickersStore.clearAllStickers();     // Line 241
  sceneStore.clearScenes();             // Line 242

  try {
    const project = await storageService.loadProject({ id });
    // ... rest of loading ...
    await Promise.all([
      timelineStore.loadProjectTimeline({ projectId: id }),
      stickersStore.loadFromProject(id),
    ]);
  } catch (error) {
    // If loading fails, the data is already gone!
    throw error;
  }
}
```

### 2. Auto-Save Timer (timeline-store.ts:427-436)

```typescript
const updateTracksAndSave = (newTracks: TimelineTrack[]) => {
  updateTracks(newTracks);
  set({
    isAutoSaving: true,
    autoSaveStatus: "Auto-saving...",
  });
  setTimeout(autoSaveTimeline, 100);  // 100ms delay - may not complete before close
};
```

### 3. Auto-Save Function (timeline-store.ts:363-425)

```typescript
const autoSaveTimeline = async () => {
  set({
    isAutoSaving: true,
    autoSaveStatus: "Auto-saving...",
  });
  try {
    const { useProjectStore } = await import("./project-store");
    const activeProject = useProjectStore.getState().activeProject;
    if (activeProject) {
      await storageService.saveProjectTimeline({
        projectId: activeProject.id,
        tracks: get()._tracks,
        sceneId,
      });
    }
  } catch (error) {
    // Error handling
  }
};
```

---

## Implementation Plan

### Overview

**Total Estimated Time**: ~45-60 minutes
**Risk Level**: Medium (core state management changes)
**Testing Required**: Yes (regression testing for project load/save)

---

## Subtask 1: Fix Destructive Clear Pattern in `loadProject` (~15 min)

**File**: `apps/web/src/stores/project-store.ts`
**Lines**: 224-278

### Problem
Data is cleared at lines 239-242 BEFORE loading from storage. If storage load fails, data is lost.

### Solution
Load data from storage FIRST, then clear and apply new state only after successful load.

### Implementation Steps

1. **Move storage load BEFORE clears** (lines 244-265 → before line 239)
   ```typescript
   loadProject: async (id: string) => {
     if (!get().isInitialized) {
       set({ isLoading: true });
     }

     // Get store references (no clearing yet)
     const mediaStore = (await getMediaStore()).useMediaStore.getState();
     const { useTimelineStore } = await import("./timeline-store");
     const timelineStore = useTimelineStore.getState();
     const { useStickersOverlayStore } = await import("./stickers-overlay-store");
     const { useSceneStore } = await import("./scene-store");
     const stickersStore = useStickersOverlayStore.getState();
     const sceneStore = useSceneStore.getState();

     try {
       // LOAD DATA FIRST - verify storage is accessible
       const project = await storageService.loadProject({ id });
       if (!project) {
         throw new NotFoundError(`Project ${id} not found`);
       }

       // ONLY NOW clear and apply new state (after successful load)
       mediaStore.clearAllMedia();
       timelineStore.clearTimeline();
       stickersStore.clearAllStickers();
       sceneStore.clearScenes();

       set({ activeProject: project });

       // Load media first, then other data
       await mediaStore.loadProjectMedia(id);
       await sceneStore.initializeProjectScenes(project);
       await Promise.all([
         timelineStore.loadProjectTimeline({ projectId: id }),
         stickersStore.loadFromProject(id),
       ]);
     } catch (error) {
       handleStorageError(error, "Load project", { projectId: id });
       throw error;
     } finally {
       set({ isLoading: false });
     }
   }
   ```

2. **Test**: Open project, verify data loads → close → reopen → verify data persists

### Acceptance Criteria
- [ ] Storage load happens before any `clear*()` calls
- [ ] If storage load fails, in-memory state is NOT cleared
- [ ] Existing projects load successfully after change

---

## Subtask 2: Add `beforeunload` Event Handler for Pending Saves (~15 min)

**File**: `apps/web/src/stores/timeline-store.ts` or new hook
**New Code Location**: Consider `apps/web/src/hooks/use-save-on-close.ts`

### Problem
100ms debounced auto-save may not complete if user closes browser/app immediately.

### Solution
Add `beforeunload` event listener to ensure saves complete before close.

### Implementation Steps

1. **Create new hook** `apps/web/src/hooks/use-save-on-close.ts`:
   ```typescript
   import { useEffect } from "react";
   import { useTimelineStore } from "@/stores/timeline-store";

   export function useSaveOnClose() {
     useEffect(() => {
       const handleBeforeUnload = (e: BeforeUnloadEvent) => {
         const { isAutoSaving } = useTimelineStore.getState();

         if (isAutoSaving) {
           // Trigger synchronous save attempt
           e.preventDefault();
           e.returnValue = ""; // Required for Chrome

           // Force immediate save (synchronous storage if possible)
           // Note: async operations may not complete in beforeunload
         }
       };

       window.addEventListener("beforeunload", handleBeforeUnload);
       return () => window.removeEventListener("beforeunload", handleBeforeUnload);
     }, []);
   }
   ```

2. **Alternative: Use `visibilitychange` for more reliable save**:
   ```typescript
   useEffect(() => {
     const handleVisibilityChange = async () => {
       if (document.visibilityState === "hidden") {
         // Page is being hidden - save immediately
         const { isAutoSaving, _tracks } = useTimelineStore.getState();
         const { activeProject } = useProjectStore.getState();

         if (activeProject && _tracks.length > 0) {
           await storageService.saveProjectTimeline({
             projectId: activeProject.id,
             tracks: _tracks,
           });
         }
       }
     };

     document.addEventListener("visibilitychange", handleVisibilityChange);
     return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
   }, []);
   ```

3. **Add hook to editor** in `apps/web/src/routes/editor.$project_id.lazy.tsx`

### Acceptance Criteria
- [ ] Save triggers when tab/window loses focus
- [ ] Save triggers before browser close (best effort)
- [ ] No data loss when closing browser during auto-save

---

## Subtask 3: Reduce Auto-Save Debounce & Add Immediate Save Option (~10 min)

**File**: `apps/web/src/stores/timeline-store.ts`
**Lines**: 428-436

### Problem
100ms debounce delay can cause data loss on rapid close.

### Solution
1. Reduce debounce to 50ms (or use `requestIdleCallback`)
2. Add `saveImmediate()` method for critical operations

### Implementation Steps

1. **Reduce debounce timer** (line 435):
   ```typescript
   setTimeout(autoSaveTimeline, 50); // Reduced from 100ms
   ```

2. **Add immediate save method**:
   ```typescript
   saveImmediate: async () => {
     const { useProjectStore } = await import("./project-store");
     const activeProject = useProjectStore.getState().activeProject;
     if (activeProject) {
       await storageService.saveProjectTimeline({
         projectId: activeProject.id,
         tracks: get()._tracks,
       });
     }
   },
   ```

3. **Export for use in `beforeunload` handler**

### Acceptance Criteria
- [ ] Auto-save delay reduced to 50ms
- [ ] `saveImmediate()` available for forced saves
- [ ] No performance regression from reduced debounce

---

## Subtask 4: Add Storage Verification Before Clear (~10 min)

**File**: `apps/web/src/stores/project-store.ts`

### Problem
If storage is inaccessible (quota exceeded, corruption), clearing state causes data loss.

### Solution
Verify storage is accessible before clearing in-memory state.

### Implementation Steps

1. **Add storage health check**:
   ```typescript
   const isStorageAccessible = async (projectId: string): Promise<boolean> => {
     try {
       await storageService.loadProject({ id: projectId });
       return true;
     } catch {
       return false;
     }
   };
   ```

2. **Use in `loadProject`** before clearing:
   ```typescript
   if (!await isStorageAccessible(id)) {
     toast.error("Storage is not accessible. Cannot safely switch projects.");
     return;
   }
   ```

### Acceptance Criteria
- [ ] Storage accessibility verified before state clear
- [ ] User-friendly error message if storage unavailable
- [ ] Existing data preserved on storage errors

---

## Subtask 5: Add Backup/Rollback Capability (~15 min) [OPTIONAL - Future Enhancement]

**File**: `apps/web/src/stores/project-store.ts`

### Problem
Even with load-before-clear, concurrent operations could cause issues.

### Solution
Keep shallow copy of previous state until new state is fully applied.

### Implementation Steps

1. **Create backup before clear**:
   ```typescript
   const backup = {
     media: mediaStore.getState().items,
     tracks: timelineStore.getState()._tracks,
     stickers: stickersStore.getState().stickers,
   };
   ```

2. **Restore on failure**:
   ```typescript
   catch (error) {
     // Restore from backup
     mediaStore.setState({ items: backup.media });
     timelineStore.setState({ _tracks: backup.tracks });
     // ...
   }
   ```

### Acceptance Criteria
- [ ] Backup created before state modification
- [ ] Rollback triggered on load failure
- [ ] Memory cleaned up after successful load

---

## Testing Plan

### Manual Tests
1. Add video to timeline → close browser → reopen → verify video present
2. Add video → close within 100ms → reopen → verify video present
3. Add video → switch to different project → switch back → verify video present
4. Simulate storage error → verify data not cleared

### Automated Tests
- Unit test: `loadProject` loads data before clearing
- Unit test: `saveImmediate` saves synchronously
- Integration test: Full project save/load cycle

---

## Rollback Plan

If issues arise:
1. Revert changes to `project-store.ts`
2. Remove `use-save-on-close.ts` hook
3. Restore original 100ms debounce

---

## Notes

- **Priority Order**: Subtask 1 > Subtask 2 > Subtask 3 > Subtask 4 > Subtask 5
- Subtask 1 alone should fix 90% of the data loss issues
- Subtask 5 is optional for extra safety but adds complexity
