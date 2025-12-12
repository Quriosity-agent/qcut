/**
 * Timeline Persistence
 *
 * Operations for loading, saving, and auto-saving timeline data.
 * Handles debounced auto-save and project/scene context management.
 */

import type { TimelineTrack } from "@/types/timeline";
import { ensureMainTrack, sortTracksByOrder } from "@/types/timeline";
import { storageService } from "@/lib/storage/storage-service";
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";

/**
 * Context for persistence operations
 */
export interface PersistenceContext {
  getTracks: () => TimelineTrack[];
  updateTracks: (tracks: TimelineTrack[]) => void;
  setAutoSaveStatus: (
    status: string,
    isAutoSaving: boolean,
    lastAt?: number
  ) => void;
  clearHistory: () => void;
}

/**
 * Module-level timer for debounced auto-save
 */
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Cancel any pending auto-save timer
 */
export function cancelAutoSaveTimer(): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

/**
 * Auto-save timeline with project guard
 * Prevents cross-project bleed when user switches projects
 * @param ctx - Persistence context
 * @param scheduledProjectId - Project ID captured at schedule time
 */
export async function autoSaveTimelineGuarded(
  ctx: PersistenceContext,
  scheduledProjectId: string
): Promise<void> {
  try {
    const { useProjectStore } = await import("../project-store");
    const activeProject = useProjectStore.getState().activeProject;

    // Guard: Skip save if project changed since scheduling
    if (!activeProject || activeProject.id !== scheduledProjectId) {
      console.log(
        `[TimelineStore] Skipping auto-save: project changed (scheduled: ${scheduledProjectId}, current: ${activeProject?.id})`
      );
      ctx.setAutoSaveStatus("Auto-save idle", false);
      return;
    }

    try {
      // Include current scene ID to avoid desync
      const { useSceneStore } = await import("../scene-store");
      const sceneId =
        useSceneStore.getState().currentScene?.id ??
        activeProject.currentSceneId;

      await storageService.saveProjectTimeline({
        projectId: activeProject.id,
        tracks: ctx.getTracks(),
        sceneId,
      });

      ctx.setAutoSaveStatus("Auto-saved", false, Date.now());
    } catch (error) {
      ctx.setAutoSaveStatus("Auto-save failed", false);
      handleError(error, {
        operation: "Auto-save Timeline",
        category: ErrorCategory.STORAGE,
        severity: ErrorSeverity.LOW,
        showToast: false,
        metadata: {
          projectId: activeProject.id,
          trackCount: ctx.getTracks().length,
        },
      });
    }
  } catch (error) {
    ctx.setAutoSaveStatus("Auto-save failed", false);
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
}

/**
 * Trigger auto-save without knowing the project ID
 * Captures the project ID from the current state
 * @param ctx - Persistence context
 */
export async function triggerAutoSave(ctx: PersistenceContext): Promise<void> {
  const { useProjectStore } = await import("../project-store");
  const projectId = useProjectStore.getState().activeProject?.id;
  if (projectId) {
    await autoSaveTimelineGuarded(ctx, projectId);
  }
}

/**
 * Update tracks and trigger debounced auto-save
 * @param ctx - Persistence context
 * @param newTracks - New tracks to save
 * @param debounceMs - Debounce delay in milliseconds (default: 50)
 */
export async function updateTracksAndSaveOperation(
  ctx: PersistenceContext,
  newTracks: TimelineTrack[],
  debounceMs = 50
): Promise<void> {
  ctx.updateTracks(newTracks);

  // Capture projectId at schedule time (not at save time)
  const { useProjectStore } = await import("../project-store");
  const scheduledProjectId = useProjectStore.getState().activeProject?.id;

  if (!scheduledProjectId) {
    // No active project, skip auto-save
    return;
  }

  // Auto-save in background with debouncing
  ctx.setAutoSaveStatus("Auto-saving...", true);

  // Cancel previous timer to prevent race conditions and stale saves
  cancelAutoSaveTimer();
  autoSaveTimer = setTimeout(
    () => autoSaveTimelineGuarded(ctx, scheduledProjectId),
    debounceMs
  );
}

/**
 * Load timeline for a project/scene
 * @param ctx - Persistence context
 * @param projectId - Project ID to load
 * @param sceneId - Optional scene ID
 */
export async function loadProjectTimelineOperation(
  ctx: PersistenceContext,
  projectId: string,
  sceneId?: string
): Promise<void> {
  try {
    const tracks = await storageService.loadProjectTimeline({
      projectId,
      sceneId,
    });
    if (tracks) {
      ctx.updateTracks(tracks);
    } else {
      // No timeline saved yet, initialize with default
      const defaultTracks = ensureMainTrack([]);
      ctx.updateTracks(defaultTracks);
    }
    // Clear history when loading a project
    ctx.clearHistory();
  } catch (error) {
    handleError(error, {
      operation: "Load Timeline",
      category: ErrorCategory.STORAGE,
      severity: ErrorSeverity.HIGH,
      metadata: {
        projectId,
        sceneId,
      },
    });
    // Initialize with default on error
    const defaultTracks = ensureMainTrack([]);
    ctx.updateTracks(defaultTracks);
    ctx.clearHistory();
  }
}

/**
 * Save timeline for a project/scene
 * @param ctx - Persistence context
 * @param projectId - Project ID to save
 * @param sceneId - Optional scene ID
 */
export async function saveProjectTimelineOperation(
  ctx: PersistenceContext,
  projectId: string,
  sceneId?: string
): Promise<void> {
  try {
    await storageService.saveProjectTimeline({
      projectId,
      tracks: ctx.getTracks(),
      sceneId,
    });
  } catch (error) {
    handleError(error, {
      operation: "Save Timeline",
      category: ErrorCategory.STORAGE,
      severity: ErrorSeverity.HIGH,
      metadata: {
        projectId,
        sceneId,
        trackCount: ctx.getTracks().length,
      },
    });
  }
}

/**
 * Save timeline immediately without debounce
 * For critical operations like app close
 * @param ctx - Persistence context
 */
export async function saveImmediateOperation(
  ctx: PersistenceContext
): Promise<void> {
  // Cancel any pending debounced save
  cancelAutoSaveTimer();

  try {
    const { useProjectStore } = await import("../project-store");
    const activeProject = useProjectStore.getState().activeProject;
    if (activeProject) {
      const { useSceneStore } = await import("../scene-store");
      const sceneId =
        useSceneStore.getState().currentScene?.id ??
        activeProject.currentSceneId;

      await storageService.saveProjectTimeline({
        projectId: activeProject.id,
        tracks: ctx.getTracks(),
        sceneId,
      });

      ctx.setAutoSaveStatus("Saved", false, Date.now());
    }
  } catch (error) {
    handleError(error, {
      operation: "Immediate Save Timeline",
      category: ErrorCategory.STORAGE,
      severity: ErrorSeverity.HIGH,
      metadata: {
        trackCount: ctx.getTracks().length,
      },
    });
  }
}

/**
 * Clear the timeline to default state
 * @param ctx - Persistence context
 */
export function clearTimelineOperation(ctx: PersistenceContext): void {
  const defaultTracks = ensureMainTrack([]);
  ctx.updateTracks(defaultTracks);
  ctx.clearHistory();
}

/**
 * Restore tracks (for rollback on load failure)
 * @param ctx - Persistence context
 * @param tracks - Tracks to restore
 */
export function restoreTracksOperation(
  ctx: PersistenceContext,
  tracks: TimelineTrack[]
): void {
  console.log(`[TimelineStore] Restoring ${tracks.length} tracks (rollback)`);
  ctx.updateTracks(tracks);
}

/**
 * Helper to create sorted tracks with main track ensured
 * @param tracks - Input tracks
 * @returns Sorted tracks with main track
 */
export function prepareTracks(tracks: TimelineTrack[]): {
  tracksWithMain: TimelineTrack[];
  sortedTracks: TimelineTrack[];
} {
  const tracksWithMain = ensureMainTrack(tracks);
  const sortedTracks = sortTracksByOrder(tracksWithMain);
  return { tracksWithMain, sortedTracks };
}
