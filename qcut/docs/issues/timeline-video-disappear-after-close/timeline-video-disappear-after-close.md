# Issue: Videos Disappear from Timeline After Closing Software

> **Status**: Open
> **Priority**: High
> **Category**: Data Persistence
> **Created**: 2025-11-27
> **Last Updated**: 2025-11-28

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

### Primary Issue: Destructive State Clear on Project Load

**Location**: `apps/web/src/stores/project-store.ts` (lines 229-242)
**Verified**: 2025-11-28 - Code unchanged, bug still present

The `loadProject` function clears all timeline, media, and sticker data **before** attempting to load saved data from storage. This is a "destructive clear" pattern where:

1. In-memory state is cleared immediately
2. Then async loading from storage is attempted
3. If loading fails for any reason, the data is already gone with no way to recover

The comment in the code even acknowledges this is intentional:

```typescript
// Clear media, timeline, and stickers immediately to prevent flickering when switching projects
```

However, this creates a critical data loss scenario when:

- Storage is inaccessible (IndexedDB corruption, quota exceeded)
- Network issues in Electron IPC
- Application crashes during the async loading phase
- User closes browser/app before load completes

### Secondary Issue: Auto-Save Timing Delay

**Location**: `apps/web/src/stores/timeline-store.ts` (lines 427-436)
**Verified**: 2025-11-28 - Code unchanged at lines 427-436

The auto-save mechanism has a 100ms delay before triggering:

```typescript
setTimeout(autoSaveTimeline, 100);
```

If the user closes the application within this 100ms window after making changes, those changes are lost.

### Tertiary Issue: No beforeunload Handler

The application does not implement a `beforeunload` event handler to ensure pending saves complete before the application closes.

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

### Timeline Save Flow

```
User Action (add/move/delete element)
         │
         ▼
updateTracksAndSave() [timeline-store.ts:428]
         │
         ├──► updateTracks() - Updates in-memory state immediately
         │
         └──► setTimeout(autoSaveTimeline, 100) - Schedules async save
                    │
                    ▼ (after 100ms)
              autoSaveTimeline() [timeline-store.ts:363]
                    │
                    ▼
              storageService.saveProjectTimeline()
                    │
                    ▼
              IndexedDBAdapter.set() or ElectronStorageAdapter.set()
```

### Project Load Flow (Current - Problematic)

```
EditorPage mounts [editor.$project_id.lazy.tsx]
         │
         ▼
loadProject(id) [project-store.ts:224]
         │
         ├──► mediaStore.clearAllMedia()      ← DESTRUCTIVE: Data cleared
         ├──► timelineStore.clearTimeline()   ← DESTRUCTIVE: Data cleared
         ├──► stickersStore.clearAllStickers()← DESTRUCTIVE: Data cleared
         ├──► sceneStore.clearScenes()        ← DESTRUCTIVE: Data cleared
         │
         ▼
    try {
         │
         ├──► storageService.loadProject({ id })
         ├──► mediaStore.loadProjectMedia(id)
         ├──► sceneStore.initializeProjectScenes(project)
         ├──► timelineStore.loadProjectTimeline({ projectId: id })
         └──► stickersStore.loadFromProject(id)
         │
    } catch (error) {
         │
         └──► Data is ALREADY GONE - no recovery possible!
    }
```

---

## Relevant Files

| File Path | Lines | Description | Verified |
|-----------|-------|-------------|----------|
| `apps/web/src/stores/project-store.ts` | 593 | Project lifecycle management. **Critical**: destructive clear pattern at lines 239-242 in `loadProject()` | 2025-11-28 ✓ |
| `apps/web/src/stores/timeline-store.ts` | 2109 | Timeline state management. **Key functions**: `autoSaveTimeline()` (363-425), `updateTracksAndSave()` (427-436) | 2025-11-28 ✓ |
| `apps/web/src/stores/media-store.ts` | ~814 | Media item persistence. `clearAllMedia()` clears in-memory media items | - |
| `apps/web/src/lib/storage/storage-service.ts` | 625 | Storage abstraction layer. `saveProjectTimeline()`, `loadProjectTimeline()` | - |
| `apps/web/src/routes/editor.$project_id.lazy.tsx` | 210 | Editor page initialization. Calls `loadProject()` in useEffect | - |
| `apps/web/src/lib/storage/indexeddb-adapter.ts` | - | IndexedDB storage adapter for project/timeline metadata | - |
| `apps/web/src/lib/storage/opfs-adapter.ts` | - | Origin Private File System adapter for large media files | - |
| `apps/web/src/lib/storage/electron-adapter.ts` | - | Electron IPC storage adapter for desktop app | - |

---

## Relevant Code

### 1. Destructive Clear Pattern (Primary Bug)

**File**: `apps/web/src/stores/project-store.ts`
**Lines**: 224-278
**Last Verified**: 2025-11-28 ✓ Code unchanged

```typescript
loadProject: async (id: string) => {
  if (!get().isInitialized) {
    set({ isLoading: true });
  }

  // Clear media, timeline, and stickers immediately to prevent flickering when switching projects
  const mediaStore = (await getMediaStore()).useMediaStore.getState();
  const { useTimelineStore } = await import("./timeline-store");
  const timelineStore = useTimelineStore.getState();
  const { useStickersOverlayStore } = await import(
    "./stickers-overlay-store"
  );
  const { useSceneStore } = await import("./scene-store");
  const stickersStore = useStickersOverlayStore.getState();
  const sceneStore = useSceneStore.getState();

  // ⚠️ CRITICAL BUG: These lines clear data BEFORE loading from storage
  // If the try block below fails, all data is already lost!
  mediaStore.clearAllMedia();           // Line 239
  timelineStore.clearTimeline();        // Line 240
  stickersStore.clearAllStickers();     // Line 241
  sceneStore.clearScenes();             // Line 242

  try {
    const project = await storageService.loadProject({ id });
    if (project) {
      set({ activeProject: project });

      // Load media first, then other data to ensure stickers have access to media items
      debugLog(`[ProjectStore] Loading media for project: ${id}`);
      await mediaStore.loadProjectMedia(id);
      debugLog(
        "[ProjectStore] Media loading complete, now loading timeline and stickers"
      );

      // Initialize scenes for the project
      debugLog(`[ProjectStore] Initializing scenes for project: ${id}`);
      await sceneStore.initializeProjectScenes(project);

      // Load timeline and stickers in parallel (both may depend on media being loaded)
      await Promise.all([
        timelineStore.loadProjectTimeline({ projectId: id }),
        stickersStore.loadFromProject(id),
      ]);
      debugLog(`[ProjectStore] Project loading complete: ${id}`);
    } else {
      throw new NotFoundError(`Project ${id} not found`);
    }
  } catch (error) {
    // ⚠️ At this point, data is ALREADY CLEARED with no way to recover
    handleStorageError(error, "Load project", {
      projectId: id,
      operation: "loadProject",
    });
    throw error; // Re-throw so the editor page can handle it
  } finally {
    set({ isLoading: false });
  }
},
```

### 2. Auto-Save with 100ms Delay

**File**: `apps/web/src/stores/timeline-store.ts`
**Lines**: 427-436
**Last Verified**: 2025-11-28 ✓ Code unchanged

```typescript
// Helper to update tracks and auto-save
const updateTracksAndSave = (newTracks: TimelineTrack[]) => {
  updateTracks(newTracks);
  // Auto-save in background
  set({
    isAutoSaving: true,
    autoSaveStatus: "Auto-saving...",
  });
  // ⚠️ 100ms delay - if user closes app before this fires, data is lost
  setTimeout(autoSaveTimeline, 100);
};
```

### 3. Auto-Save Implementation

**File**: `apps/web/src/stores/timeline-store.ts`
**Lines**: 363-425
**Last Verified**: 2025-11-28 ✓ Code unchanged

```typescript
// Helper to auto-save timeline changes
const autoSaveTimeline = async () => {
  set({
    isAutoSaving: true,
    autoSaveStatus: "Auto-saving...",
  });
  try {
    const { useProjectStore } = await import("./project-store");
    const activeProject = useProjectStore.getState().activeProject;
    if (activeProject) {
      try {
        // Include current scene ID to avoid desync
        const { useSceneStore } = await import("./scene-store");
        const sceneId =
          useSceneStore.getState().currentScene?.id ??
          activeProject.currentSceneId;
        await storageService.saveProjectTimeline({
          projectId: activeProject.id,
          tracks: get()._tracks,
          sceneId,
        });
        set({
          isAutoSaving: false,
          autoSaveStatus: "Auto-saved",
          lastAutoSaveAt: Date.now(),
        });
      } catch (error) {
        set({
          isAutoSaving: false,
          autoSaveStatus: "Auto-save failed",
        });
        handleError(error, {
          operation: "Auto-save Timeline",
          category: ErrorCategory.STORAGE,
          severity: ErrorSeverity.LOW,
          showToast: false,
          metadata: {
            projectId: activeProject.id,
            trackCount: get()._tracks.length,
          },
        });
      }
    } else {
      set({
        isAutoSaving: false,
        autoSaveStatus: "Auto-save idle",
      });
    }
  } catch (error) {
    set({
      isAutoSaving: false,
      autoSaveStatus: "Auto-save failed",
    });
    handleError(error, {
      operation: "Access Project Store",
      category: ErrorCategory.STORAGE,
      severity: ErrorSeverity.LOW,
      showToast: false,
      metadata: {
        operation: "timeline-autosave",
      },
    });
  }
};
```

### 4. Timeline Clear Function

**File**: `apps/web/src/stores/timeline-store.ts`
**Lines**: 1790-1794

```typescript
clearTimeline: () => {
  const defaultTracks = ensureMainTrack([]);
  updateTracks(defaultTracks);
  set({ history: [], redoStack: [], selectedElements: [] });
},
```

### 5. Storage Service - Save Timeline

**File**: `apps/web/src/lib/storage/storage-service.ts`
**Lines**: 493-511

```typescript
// Scene-aware timeline operations
async saveTimeline({
  projectId,
  tracks,
  sceneId,
}: {
  projectId: string;
  tracks: TimelineTrack[];
  sceneId?: string;
}): Promise<void> {
  const timelineAdapter = this.getProjectTimelineAdapter({
    projectId,
    sceneId,
  });
  const timelineData: TimelineData = {
    tracks,
    lastModified: new Date().toISOString(),
  };
  await timelineAdapter.set("timeline", timelineData);
}
```

### 6. Storage Service - Load Timeline

**File**: `apps/web/src/lib/storage/storage-service.ts`
**Lines**: 513-526

```typescript
async loadTimeline({
  projectId,
  sceneId,
}: {
  projectId: string;
  sceneId?: string;
}): Promise<TimelineTrack[] | null> {
  const timelineAdapter = this.getProjectTimelineAdapter({
    projectId,
    sceneId,
  });
  const timelineData = await timelineAdapter.get("timeline");
  return timelineData ? timelineData.tracks : null;
}
```

### 7. Editor Page Load Flow

**File**: `apps/web/src/routes/editor.$project_id.lazy.tsx`
**Lines**: 41-181

```typescript
useEffect(() => {
  const abortController = new AbortController();

  const init = async () => {
    debugLog(`[Editor] init called for project: ${project_id}`);

    if (!project_id || abortController.signal.aborted) {
      debugLog("[Editor] Early return - no project_id or aborted");
      return;
    }

    if (activeProject?.id === project_id) {
      debugLog(
        `[Editor] Early return - project already loaded: ${activeProject.id}`
      );
      return;
    }

    // ... duplicate load prevention logic ...

    debugLog(`[Editor] Starting project load: ${project_id}`);

    inFlightProjectIdRef.current = project_id;
    const loadPromise = (async () => {
      try {
        await loadProject(project_id);  // ← This triggers the destructive clear
        debugLog(`[Editor] Project load complete: ${project_id}`);
        // ...
      } catch (error) {
        // Handle NotFoundError by creating new project
        // ...
      }
    })();

    currentLoadPromiseRef.current = loadPromise;
    // ...
  };

  init();

  return () => {
    debugLog(`[Editor] Cleanup - aborting loads for project: ${project_id}`);
    abortController.abort();
  };
}, [/* dependencies */]);
```

---

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

### High Priority

1. **Load flow still wipes state on downstream failures** (`apps/web/src/stores/project-store.ts`): After moving `storageService.loadProject` earlier, the current implementation still clears all stores before `loadProjectTimeline`/`loadProjectMedia`/`loadFromProject` run. Any failure in those calls leaves the timeline/media empty, recreating the original data-loss symptom. The backup/rollback approach (Fix 2) should be **required**, not optional.

### Medium Priority

2. **beforeunload hook is non-blocking** (`apps/web/src/hooks/use-save-on-close.ts` proposal): The outlined handler triggers async saves but browsers often abort async work during `beforeunload`; `returnValue` alone does not guarantee the promise completes. Use `visibilitychange` with synchronous persistence, or `navigator.sendBeacon` for reliable saves.

3. **Overlapping auto-save timers** (`apps/web/src/stores/timeline-store.ts`): `setTimeout(autoSaveTimeline, 100)` is additive; rapid edits schedule multiple saves that may race and persist stale tracks. Debounce or cancel the prior timer, and gate concurrent saves to ensure last-write wins.

### Low Priority

4. **Missing error and loading guards** (`apps/web/src/stores/project-store.ts`): The snippet uses `NotFoundError` without confirming it exists/imports, and `isLoading` cleanup in `finally` is implied but not shown. Clarify imports and loading flag handling to avoid runtime errors or stuck spinners.

### Open Questions

- Do downstream loaders (media/timeline/stickers) assume prior clears? If so, a staged/rollback approach needs explicit reset hooks to avoid ID collisions.
- Should auto-save be paused during `loadProject` to prevent writes of the previous project while the new one loads?

---

## Additional Review (Maintainability)

- **High** – Cross-project autosave bleed risk (`qcut/apps/web/src/stores/timeline-store.ts:427-436`): the scheduled `autoSaveTimeline` reads the *current* `activeProject` at fire time, not at schedule time. If a user switches projects while a save timer is pending, the stale tracks from the previous project can be written into the newly opened project's storage, corrupting both timelines. Capture the projectId when scheduling and no-op if it differs at execution, or cancel timers during `loadProject`.
- **Medium** – No schema/versioning on timeline payloads (`qcut/apps/web/src/lib/storage/storage-service.ts:493-526`): timeline data is persisted without a version marker, so future shape changes or scene-aware tweaks cannot be migrated, leading to silent load failures or dropped fields. Add a `schemaVersion` + migration path and reject/upgrade unknown versions to keep long-term compatibility.
- **Testing gap** – Missing multi-project race regression: add an integration that edits project A, triggers an autosave timer, then switches to project B before the timer fires and asserts B's timeline is untouched and A still persists. This catches the cross-project bleed and enforces timer cancellation/guarding behavior.

---

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
| 2025-11-28 | Code Review | All bug patterns confirmed unchanged. `project-store.ts:239-242` still clears before load. `timeline-store.ts:427-436` still uses 100ms setTimeout without debounce. No `visibilitychange` handler exists. **Issue remains unfixed.** |
