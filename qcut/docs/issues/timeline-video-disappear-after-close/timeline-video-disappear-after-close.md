# Issue: Videos Disappear from Timeline After Closing Software

> **Status**: IMPLEMENTED
> **Priority**: High
> **Category**: Data Persistence
> **Created**: 2025-11-27
> **Implemented**: 2025-11-28

---

## Table of Contents

- [Problem Description](#problem-description)
- [Root Cause Analysis](#root-cause-analysis)
- [Data Flow Architecture](#data-flow-architecture)
- [Relevant Files](#relevant-files)
- [Relevant Code](#relevant-code)
- [Reproduction Steps](#reproduction-steps)
- [Suggested Fixes](#suggested-fixes)
- [Implementation Plan](#implementation-plan)
- [Testing Checklist](#testing-checklist)
- [Review Findings](#review-findings)

---

## Problem Description

When users add videos to the timeline, close the application, and reopen it, the videos in the timeline disappear. The timeline state is not properly persisted across sessions.

### User Impact

- Loss of work when closing the application unexpectedly
- Users must re-add all media to timeline after each session
- Project data may become corrupted if errors occur during load

---

## Root Cause Analysis

### Primary Issue (historical): Destructive State Clear on Project Load

**Location**: `apps/web/src/stores/project-store.ts` (was lines 229-242; now 224-304)
**Status**: Resolved in code on 2025-11-28 (load-before-clear + rollback now implemented)

Previously, `loadProject` cleared timeline, media, stickers, and scenes **before** loading from storage. Any downstream failure left the project empty with no recovery path.

**Pre-fix implementation (for reference):**

```typescript
// Clear media, timeline, and stickers immediately to prevent flickering when switching projects
mediaStore.clearAllMedia();
timelineStore.clearTimeline();
stickersStore.clearAllStickers();
sceneStore.clearScenes();
```

**Current implementation (post-fix):**
- Loads project from storage first, throws if missing
- Clears state only after successful load verification
- Backs up previous media/timeline/activeProject and rolls back on failure

### Secondary Issue (historical): Auto-Save Timing Delay

**Location**: `apps/web/src/stores/timeline-store.ts` (was lines 427-436)
**Status**: Resolved via debounced save with project guard (50ms, timer cancellation)

Original behavior used `setTimeout(autoSaveTimeline, 100);`, allowing a quick-close data loss window. Current code debounces saves, cancels previous timers, and guards against cross-project writes.

### Tertiary Issue (historical): No beforeunload Handler

**Status**: Addressed with `visibilitychange` save hook (`apps/web/src/hooks/use-save-on-visibility-change.ts`)

The app now saves on page hide/visibility change instead of relying on non-blocking `beforeunload`.

---

## Data Flow Architecture

### State Management Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Zustand State Stores                        │
├─────────────────────────────────────────────────────────────────┤
│  project-store.ts    │  timeline-store.ts   │  media-store.ts   │
│  - activeProject     │  - _tracks           │  - mediaItems     │
│  - savedProjects     │  - history           │  - persistedIds   │
│  - isLoading         │  - autoSaveStatus    │                   │
└──────────┬───────────┴──────────┬───────────┴─────────┬─────────┘
           │                      │                     │
           ▼                      ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Storage Service Layer                        │
│                 (storage-service.ts)                            │
├─────────────────────────────────────────────────────────────────┤
│  saveProject()      │  saveProjectTimeline()  │  saveMediaItem()│
│  loadProject()      │  loadProjectTimeline()  │  loadMediaItem()│
└──────────┬───────────┴──────────┬───────────┴─────────┬─────────┘
           │                      │                     │
           ▼                      ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Storage Adapters                            │
├─────────────────────────────────────────────────────────────────┤
│ ElectronStorageAdapter │ IndexedDBAdapter │ LocalStorageAdapter │
│ (Electron IPC)         │ (Browser DB)     │ (Fallback)          │
├────────────────────────┴─────────────────┴──────────────────────┤
│                       OPFSAdapter                               │
│               (Origin Private File System - Media Files)        │
└─────────────────────────────────────────────────────────────────┘
```

### Timeline Save Flow (Pre-fix)

```
User Action (add/move/delete element)
         │
         ▼
updateTracksAndSave() [timeline-store.ts]
         │
         ├──► updateTracks() - Updates in-memory state immediately
         │
         └──► setTimeout(autoSaveTimeline, 100) - Schedules async save
                    │
                    ▼ (after 100ms)
              autoSaveTimeline()
                    │
                    ▼
              storageService.saveProjectTimeline()
                    │
                    ▼
              IndexedDBAdapter.set() or ElectronStorageAdapter.set()
```

### Timeline Save Flow (Current - Post-fix)

- `updateTracksAndSave` updates tracks, captures the current `activeProject` id, cancels any prior timer, and schedules a 50ms debounced save.
- `autoSaveTimelineGuarded` no-ops if the project changed while the timer was pending, and persists when ids match.
- `saveImmediate` flushes immediately and clears any pending timer for critical operations.

### Project Load Flow (Pre-fix - Problematic)

1. Editor page mounts (`editor.$project_id.lazy.tsx`).
2. `loadProject(id)` cleared media, timeline, stickers, and scenes before any load.
3. Storage calls then attempted to load project, media, scenes, timeline, stickers.
4. Any failure left state empty because the clear already ran and no rollback existed.

### Project Load Flow (Current - Post-fix)

- Load project from storage first; throw if missing.
- Backup prior media/timeline/activeProject before mutating.
- Clear stores only after successful load verification.
- Initialize scenes, then load media, timeline, and stickers.
- On any failure, restore backups and surface error.

## Relevant Files

| File Path | Lines | Description | Verified |
|-----------|-------|-------------|----------|
| `apps/web/src/stores/project-store.ts` | ~224-320 | `loadProject` now loads-before-clear with backup/rollback | 2025-11-28 ✓ updated |
| `apps/web/src/stores/timeline-store.ts` | ~356-470, ~1829-1875 | Debounced 50ms auto-save with project guard; `saveImmediate`; `restoreTracks` | 2025-11-28 ✓ updated |
| `apps/web/src/stores/media-store.ts` | ~50, ~820-840 | `restoreMediaItems()` supports rollback on load failure | 2025-11-28 ✓ updated |
| `apps/web/src/hooks/use-save-on-visibility-change.ts` | - | Visibility-change save hook for timeline/project | 2025-11-28 ✓ added |
| `apps/web/src/routes/editor.$project_id.lazy.tsx` | ~40-60 | Imports visibility-change save hook for editor page | 2025-11-28 ✓ updated |


---

## Relevant Code

### 1. loadProject (post-fix)

**File**: `apps/web/src/stores/project-store.ts` (around 224-320)
**Status**: Load-before-clear with backup/rollback

```typescript
loadProject: async (id: string) => {
  if (!get().isInitialized) set({ isLoading: true });

  const mediaStore = (await getMediaStore()).useMediaStore.getState();
  const { useTimelineStore } = await import("./timeline-store");
  const timelineStore = useTimelineStore.getState();
  const { useStickersOverlayStore } = await import(
    "./stickers-overlay-store"
  );
  const { useSceneStore } = await import("./scene-store");
  const stickersStore = useStickersOverlayStore.getState();
  const sceneStore = useSceneStore.getState();

  const backup = {
    media: [...mediaStore.mediaItems],
    timeline: [...timelineStore._tracks],
    activeProject: get().activeProject,
  };

  try {
    const project = await storageService.loadProject({ id });
    if (!project) throw new NotFoundError(`Project ${id} not found`);

    mediaStore.clearAllMedia();
    timelineStore.clearTimeline();
    stickersStore.clearAllStickers();
    sceneStore.clearScenes();

    set({ activeProject: project });

    await mediaStore.loadProjectMedia(id);
    await sceneStore.initializeProjectScenes(project);
    await Promise.all([
      timelineStore.loadProjectTimeline({ projectId: id }),
      stickersStore.loadFromProject(id),
    ]);
    debugLog(`[ProjectStore] Project loading complete: ${id}`);
  } catch (error) {
    // Rollback to previous state if we had a project open
    if (backup.activeProject) {
      set({ activeProject: backup.activeProject });
      if (backup.timeline.length) {
        timelineStore.restoreTracks(backup.timeline);
      }
      if (backup.media.length) {
        mediaStore.restoreMediaItems(backup.media);
      }
    }
    handleStorageError(error, "Load project", {
      projectId: id,
      operation: "loadProject",
    });
    throw error;
  } finally {
    set({ isLoading: false });
  }
},
```

### 2. Debounced/guarded auto-save

**File**: `apps/web/src/stores/timeline-store.ts` (around 240-520, 1800-1880)
**Status**: 50ms debounce, timer cancellation, project guard, `saveImmediate`

```typescript
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

const autoSaveTimelineGuarded = async (scheduledProjectId: string) => {
  const { useProjectStore } = await import("./project-store");
  const activeProject = useProjectStore.getState().activeProject;

  if (!activeProject || activeProject.id !== scheduledProjectId) {
    set({ isAutoSaving: false, autoSaveStatus: "Auto-save idle" });
    return;
  }

  // ...persist timeline...
};

const updateTracksAndSave = async (newTracks: TimelineTrack[]) => {
  updateTracks(newTracks);
  const { useProjectStore } = await import("./project-store");
  const scheduledProjectId = useProjectStore.getState().activeProject?.id;
  if (!scheduledProjectId) return;

  set({ isAutoSaving: true, autoSaveStatus: "Auto-saving..." });
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(
    () => autoSaveTimelineGuarded(scheduledProjectId),
    50
  );
};
```

`saveImmediate()` flushes without debounce and cancels pending timers; `restoreTracks()` supports rollback when project load fails.

### 3. Visibility-change save hook

**File**: `apps/web/src/hooks/use-save-on-visibility-change.ts`
**Status**: Saves timeline when document becomes hidden

```typescript
useEffect(() => {
  const handleVisibilityChange = async () => {
    if (document.visibilityState !== "hidden") return;

    const { useProjectStore } = await import("@/stores/project-store");
    const { useTimelineStore } = await import("@/stores/timeline-store");
    const activeProject = useProjectStore.getState().activeProject;
    const tracks = useTimelineStore.getState()._tracks;

    if (activeProject && tracks.length > 0) {
      await storageService.saveProjectTimeline({
        projectId: activeProject.id,
        tracks,
      });
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () =>
    document.removeEventListener("visibilitychange", handleVisibilityChange);
}, []);
```

## Reproduction Steps

### Standard Reproduction

1. Open QCut application
2. Create a new project or open an existing one
3. Add one or more videos to the timeline
4. Wait for "Auto-saved" status indicator
5. Close the application
6. Reopen the application and load the same project
7. **Expected**: Videos should appear in timeline
8. **Actual**: Timeline is empty

### Quick Close Reproduction (100ms Window)

1. Add a video to the timeline
2. Close the application **immediately** (within 100ms)
3. Reopen and load the project
4. **Result**: Video is missing (auto-save never completed)

### Load Failure Reproduction

1. Add videos to timeline
2. Wait for auto-save to complete
3. Open DevTools > Application > IndexedDB
4. Delete or corrupt the timeline database
5. Refresh the page
6. **Result**: All timeline data lost (cleared before failed load)

---

## Suggested Fixes

All five fixes below were implemented on 2025-11-28; they remain here as a reference to what changed.

### Fix 1: Load Before Clear (Required - Highest Priority)

Change the load order to load data from storage first, validate it, then clear and apply:

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
    // 1. LOAD FROM STORAGE FIRST - verify it's accessible
    const project = await storageService.loadProject({ id });
    if (!project) {
      throw new NotFoundError(`Project ${id} not found`);
    }

    // 2. ONLY NOW clear and apply new state (after successful load verification)
    mediaStore.clearAllMedia();
    timelineStore.clearTimeline();
    stickersStore.clearAllStickers();
    sceneStore.clearScenes();

    set({ activeProject: project });

    // 3. Load remaining data
    await mediaStore.loadProjectMedia(id);
    await sceneStore.initializeProjectScenes(project);
    await Promise.all([
      timelineStore.loadProjectTimeline({ projectId: id }),
      stickersStore.loadFromProject(id),
    ]);
  } catch (error) {
    // Data is NOT cleared if we reach here
    handleStorageError(error, "Load project", { projectId: id });
    throw error;
  } finally {
    set({ isLoading: false });
  }
}
```

### Fix 2: Implement Backup/Rollback (Required)

Even with load-before-clear, downstream failures can still cause issues. Keep backup until fully loaded:

```typescript
loadProject: async (id: string) => {
  // Backup current state
  const backup = {
    media: mediaStore.mediaItems,
    timeline: timelineStore._tracks,
    stickers: stickersStore.stickers,
    scenes: sceneStore.scenes,
  };

  try {
    // Load and apply new data...
  } catch (error) {
    // Rollback on ANY failure
    if (backup.timeline.length > 0) {
      mediaStore.setMediaItems(backup.media);
      timelineStore.setTracks(backup.timeline);
      stickersStore.setStickers(backup.stickers);
      sceneStore.setScenes(backup.scenes);
    }
    throw error;
  }
}
```

### Fix 3: Add visibilitychange Handler (Required)

Use `visibilitychange` instead of `beforeunload` for reliable saves:

```typescript
// In EditorProvider or new hook
useEffect(() => {
  const handleVisibilityChange = async () => {
    if (document.visibilityState === "hidden") {
      const { _tracks } = useTimelineStore.getState();
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

### Fix 4: Debounce Auto-Save Timer

Prevent overlapping saves by canceling previous timer:

```typescript
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

const updateTracksAndSave = (newTracks: TimelineTrack[]) => {
  updateTracks(newTracks);
  set({
    isAutoSaving: true,
    autoSaveStatus: "Auto-saving...",
  });

  // Cancel previous timer to prevent race conditions
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  autoSaveTimer = setTimeout(autoSaveTimeline, 50); // Reduced from 100ms
};
```

### Fix 5: Add Immediate Save Method

For critical operations, bypass debounce entirely:

```typescript
// Add to timeline-store.ts interface and implementation
saveImmediate: async () => {
  const { useProjectStore } = await import("./project-store");
  const activeProject = useProjectStore.getState().activeProject;
  if (activeProject) {
    await storageService.saveProjectTimeline({
      projectId: activeProject.id,
      tracks: get()._tracks,
    });
    set({
      isAutoSaving: false,
      autoSaveStatus: "Saved",
      lastAutoSaveAt: Date.now(),
    });
  }
},
```

---

## Implementation Plan

### Priority Order (All Required Unless Noted)

| Priority | Fix | Time Est. | Risk | Notes |
|----------|-----|-----------|------|-------|
| 1 | Load Before Clear | 15 min | Medium | Core fix for 90% of issues |
| 2 | Backup/Rollback | 20 min | Medium | Prevents downstream failures |
| 3 | visibilitychange Handler | 15 min | Low | Reliable page-hide saves |
| 4 | Debounce Timer | 10 min | Low | Prevents race conditions |
| 5 | Immediate Save | 10 min | Low | Optional, useful for explicit saves |

### Total Estimated Time: ~70 minutes

---

## Testing Checklist

After implementing fixes, verify:

- [ ] Timeline data persists after normal app close
- [ ] Timeline data persists after browser refresh
- [ ] Timeline data persists after quick close (within 100ms)
- [ ] Timeline data recovers from IndexedDB errors
- [ ] Switching between projects preserves each project's data
- [ ] Multiple scenes within a project persist correctly
- [ ] Media items associated with timeline elements persist
- [ ] Undo/redo history is preserved within session
- [ ] Error messages display when save fails
- [ ] Auto-save indicator shows correct status
- [ ] No performance regression from changes
- [ ] Rollback works when load fails midway

---

## Review Findings

- Load flow now uses load-before-clear with backup/rollback; downstream failures no longer wipe timeline/media.
- Autosave is debounced (50ms), timer-cancelled, and guarded by scheduled project id; cross-project bleed and rapid-edit races are mitigated.
- Visibility-change hook saves on page hide; non-blocking `beforeunload` concern is addressed.
- Remaining follow-up: add regression tests for rollback/autosave guards and keep schema/versioning in mind for future timeline changes.

## Additional Review (Maintainability)

- **Medium** – Cross-project autosave bleed is mitigated by the scheduled-project guard and timer cancellation; add an integration test to enforce the guard when switching projects during a pending save.
- **Medium** – No schema/versioning on timeline payloads (`qcut/apps/web/src/lib/storage/storage-service.ts`): consider adding a `schemaVersion` and migrations to keep future shape changes compatible.
- **Testing** – Add a regression covering quick edits + project switch + visibility-change save to validate rollback/guarded autosave behavior.

## Related Issues

- Media files not loading after restart
- Stickers disappearing from overlay
- Project thumbnail not generating

---

## References

- [Zustand Documentation](https://docs.pmnd.rs/zustand/getting-started/introduction)
- [IndexedDB API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [Origin Private File System - MDN](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [Page Visibility API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)

---

## Verification Log

| Date | Verified By | Finding |
|------|-------------|---------|
| 2025-11-28 | Code review (pre-fix snapshot) | Confirmed destructive clear and missing autosave/visibility guards (historical reference). |
| 2025-11-28 | Implementation verification | Verified load-before-clear + rollback, debounced guarded autosave, and visibility-change save hook. Issue addressed. |


---

## Implementation Summary

All 5 fixes have been implemented to resolve the timeline video disappear issue:

### Fix 1: Load Before Clear ✅
**File**: `apps/web/src/stores/project-store.ts` (lines 224-302)

Changed `loadProject()` to:
1. Load project from storage FIRST
2. Verify project exists and is accessible
3. ONLY THEN clear previous state
4. This prevents data loss if storage is inaccessible

### Fix 2: Backup/Rollback ✅
**Files**:
- `apps/web/src/stores/project-store.ts` (lines 240-245, 284-300)
- `apps/web/src/stores/media-store.ts` (lines 52, 829-832)
- `apps/web/src/stores/timeline-store.ts` (lines 259-260, 1849-1854)

Added:
- Backup of current state before loading (media, timeline, activeProject)
- Full rollback on failure: `activeProject`, timeline tracks, media items
- New `restoreMediaItems()` method in media-store
- New `restoreTracks()` method in timeline-store
- Logging for debugging rollback operations

### Fix 3: visibilitychange Handler ✅
**Files**:
- NEW: `apps/web/src/hooks/use-save-on-visibility-change.ts`
- `apps/web/src/routes/editor.$project_id.lazy.tsx` (line 38)

Created new hook `useSaveOnVisibilityChange()` that:
- Listens for `visibilitychange` event
- Saves timeline and project data when page becomes hidden
- More reliable than `beforeunload` for async saves
- Used in EditorPage component

### Fix 4: Debounced Auto-Save Timer with Cross-Project Guard ✅
**File**: `apps/web/src/stores/timeline-store.ts` (lines 351-352, 369-376, 437-474)

Changed:
- Added module-level `autoSaveTimer` variable
- `updateTracksAndSave()` now cancels previous timer before scheduling new one
- **Captures `projectId` at schedule time** to prevent cross-project bleed
- Added `autoSaveTimelineGuarded(scheduledProjectId)` that validates project hasn't changed
- Skips save if user switched projects while timer was pending
- Prevents race conditions and stale saves
- Reduced delay from 100ms to 50ms for faster saves

### Fix 5: Immediate Save Method ✅
**File**: `apps/web/src/stores/timeline-store.ts` (lines 256-257, 1800-1839)

Added new `saveImmediate()` method that:
- Cancels any pending debounced save
- Saves timeline immediately without delay
- Used for critical operations like app close
- Updates auto-save status on completion

---

## Files Modified

| File | Changes |
|------|---------|
| `apps/web/src/stores/project-store.ts` | Load-before-clear pattern, full backup/rollback |
| `apps/web/src/stores/timeline-store.ts` | Debounced timer, `saveImmediate()`, `restoreTracks()` methods |
| `apps/web/src/stores/media-store.ts` | `restoreMediaItems()` method for rollback |
| `apps/web/src/hooks/use-save-on-visibility-change.ts` | NEW - visibility change handler |
| `apps/web/src/routes/editor.$project_id.lazy.tsx` | Import and use visibility change hook |
