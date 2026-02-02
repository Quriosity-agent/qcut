/**
 * Remotion Sync Manager
 *
 * Handles synchronization between QCut's timeline and Remotion player instances.
 * Manages frame translation, active element detection, and playback synchronization.
 *
 * @module lib/remotion/sync-manager
 */

import type { TimelineTrack, RemotionElement } from "@/types/timeline";
import { getActiveRemotionElements, isRemotionElement } from "@/types/timeline";
import { useRemotionStore } from "@/stores/remotion-store";

import type { SyncConfig, SyncState } from "./types";

// ============================================================================
// Constants
// ============================================================================

/** Default sync configuration */
const DEFAULT_SYNC_CONFIG: SyncConfig = {
  driftTolerance: 2, // Frames
  seekDebounceMs: 16, // ~60fps
  preloadEnabled: true,
  preloadFrames: 30, // 1 second at 30fps
};

// ============================================================================
// Frame Translation
// ============================================================================

/**
 * Convert a global timeline frame to a local frame within a Remotion element
 *
 * @param globalFrame - Frame number on the main timeline
 * @param element - The Remotion element
 * @param fps - Frames per second (used for time-to-frame conversion)
 * @returns Local frame number within the Remotion component, or null if not in range
 */
export function globalToLocalFrame(
  globalFrame: number,
  element: RemotionElement,
  fps: number
): number | null {
  const elementStartFrame = element.startTime * fps;
  const trimStartFrames = element.trimStart * fps;
  const effectiveDuration =
    element.duration - element.trimStart - element.trimEnd;
  const effectiveDurationFrames = effectiveDuration * fps;
  const elementEndFrame = elementStartFrame + effectiveDurationFrames;

  // Check if global frame is within element range
  if (globalFrame < elementStartFrame || globalFrame >= elementEndFrame) {
    return null;
  }

  // Calculate local frame (accounting for trim start)
  const localFrame = globalFrame - elementStartFrame + trimStartFrames * fps;
  return Math.round(localFrame);
}

/**
 * Convert a local frame within a Remotion element to a global timeline frame
 *
 * @param localFrame - Frame number within the Remotion component
 * @param element - The Remotion element
 * @param fps - Frames per second
 * @returns Global frame number on the timeline
 */
export function localToGlobalFrame(
  localFrame: number,
  element: RemotionElement,
  fps: number
): number {
  const elementStartFrame = element.startTime * fps;
  const trimStartFrames = element.trimStart * fps;

  return Math.round(elementStartFrame + localFrame - trimStartFrames * fps);
}

/**
 * Convert time in seconds to frame number
 */
export function timeToFrame(time: number, fps: number): number {
  return Math.round(time * fps);
}

/**
 * Convert frame number to time in seconds
 */
export function frameToTime(frame: number, fps: number): number {
  return frame / fps;
}

// ============================================================================
// Active Element Detection
// ============================================================================

/**
 * Get all Remotion elements that should be active at the given time
 *
 * @param tracks - All timeline tracks
 * @param currentTime - Current playback time in seconds
 * @returns Array of active Remotion elements with their track info
 */
export function getActiveElements(
  tracks: TimelineTrack[],
  currentTime: number
): Array<{ element: RemotionElement; track: TimelineTrack }> {
  const activeElements: Array<{
    element: RemotionElement;
    track: TimelineTrack;
  }> = [];

  for (const track of tracks) {
    for (const element of track.elements) {
      if (!isRemotionElement(element)) continue;
      if (element.hidden) continue;

      const effectiveStart = element.startTime;
      const effectiveEnd =
        element.startTime +
        (element.duration - element.trimStart - element.trimEnd);

      if (currentTime >= effectiveStart && currentTime < effectiveEnd) {
        activeElements.push({ element, track });
      }
    }
  }

  return activeElements;
}

/**
 * Check if a Remotion element is active at the given time
 */
export function isElementActive(
  element: RemotionElement,
  currentTime: number
): boolean {
  const effectiveStart = element.startTime;
  const effectiveEnd =
    element.startTime +
    (element.duration - element.trimStart - element.trimEnd);

  return currentTime >= effectiveStart && currentTime < effectiveEnd;
}

// ============================================================================
// Sync Manager Class
// ============================================================================

/**
 * SyncManager - Manages synchronization between timeline and Remotion instances
 */
export class SyncManager {
  private config: SyncConfig;
  private seekTimeout: NodeJS.Timeout | null = null;
  private tracks: TimelineTrack[] = [];
  private fps = 30;
  private lastSyncTime = 0;

  constructor(config: Partial<SyncConfig> = {}) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  /**
   * Update the tracks reference
   */
  setTracks(tracks: TimelineTrack[]): void {
    this.tracks = tracks;
  }

  /**
   * Update the FPS setting
   */
  setFps(fps: number): void {
    this.fps = fps;
  }

  /**
   * Sync all active Remotion instances to a global frame
   */
  syncToFrame(globalFrame: number): void {
    const currentTime = frameToTime(globalFrame, this.fps);
    const store = useRemotionStore.getState();
    const activeElements = getActiveElements(this.tracks, currentTime);

    // Update active elements in store
    const activeIds = activeElements.map((ae) => ae.element.id);
    store.updateActiveElements(activeIds);

    // Seek each active instance to its local frame
    for (const { element } of activeElements) {
      const localFrame = globalToLocalFrame(globalFrame, element, this.fps);
      if (localFrame !== null) {
        store.seekInstance(element.id, localFrame);
      }
    }

    // Update sync state
    store.syncToGlobalFrame(globalFrame);
    this.lastSyncTime = Date.now();
  }

  /**
   * Sync to a time position (debounced for scrubbing)
   */
  syncToTime(time: number): void {
    if (this.seekTimeout) {
      clearTimeout(this.seekTimeout);
    }

    this.seekTimeout = setTimeout(() => {
      const frame = timeToFrame(time, this.fps);
      this.syncToFrame(frame);
    }, this.config.seekDebounceMs);
  }

  /**
   * Sync play state to all active instances
   */
  syncPlayState(isPlaying: boolean): void {
    const store = useRemotionStore.getState();
    store.syncPlayState(isPlaying);
  }

  /**
   * Sync playback rate to all active instances
   */
  syncPlaybackRate(rate: number): void {
    const store = useRemotionStore.getState();
    store.syncPlaybackRate(rate);
  }

  /**
   * Handle timeline seek event
   */
  onTimelineSeek(time: number): void {
    this.syncToTime(time);
  }

  /**
   * Handle timeline play event
   */
  onTimelinePlay(): void {
    this.syncPlayState(true);
  }

  /**
   * Handle timeline pause event
   */
  onTimelinePause(): void {
    this.syncPlayState(false);
  }

  /**
   * Get current sync state
   */
  getSyncState(): SyncState {
    return useRemotionStore.getState().syncState;
  }

  /**
   * Check for sync drift and correct if needed
   */
  checkDrift(currentGlobalFrame: number): boolean {
    const state = this.getSyncState();
    const drift = Math.abs(state.globalFrame - currentGlobalFrame);

    if (drift > this.config.driftTolerance) {
      this.syncToFrame(currentGlobalFrame);
      return true;
    }

    return false;
  }

  /**
   * Preload frames for smooth scrubbing
   */
  preloadFrames(currentTime: number): void {
    if (!this.config.preloadEnabled) return;

    const store = useRemotionStore.getState();
    const activeElements = getActiveElements(this.tracks, currentTime);

    for (const { element } of activeElements) {
      const component = store.getComponent(element.componentId);
      if (!component) continue;

      const currentFrame = timeToFrame(currentTime, this.fps);
      const localFrame = globalToLocalFrame(currentFrame, element, this.fps);

      if (localFrame === null) continue;

      // Queue preload for nearby frames
      const startFrame = Math.max(0, localFrame - this.config.preloadFrames);
      const endFrame = Math.min(
        component.durationInFrames,
        localFrame + this.config.preloadFrames
      );

      // Add render job for preloading (low priority)
      store.addRenderJob({
        elementId: element.id,
        componentId: element.componentId,
        startFrame,
        endFrame,
        priority: 0, // Low priority for preload
        status: "pending",
        progress: 0,
      });
    }
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.seekTimeout) {
      clearTimeout(this.seekTimeout);
    }
  }
}

// ============================================================================
// React Hook
// ============================================================================

import { useRef, useEffect, useCallback } from "react";
import { useTimelineStore } from "@/stores/timeline-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useProjectStore } from "@/stores/project-store";

/**
 * Hook for using the sync manager in React components
 */
export function useSyncManager(config?: Partial<SyncConfig>) {
  const managerRef = useRef<SyncManager | null>(null);

  // Get state from stores
  const tracks = useTimelineStore((state) => state.tracks);
  const currentTime = usePlaybackStore((state) => state.currentTime);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const fps = useProjectStore((state) => state.activeProject?.fps ?? 30);

  // Initialize manager
  useEffect(() => {
    managerRef.current = new SyncManager(config);

    return () => {
      managerRef.current?.dispose();
      managerRef.current = null;
    };
  }, [config]);

  // Update tracks and fps when they change
  useEffect(() => {
    if (managerRef.current) {
      managerRef.current.setTracks(tracks);
      managerRef.current.setFps(fps);
    }
  }, [tracks, fps]);

  // Sync on time change
  useEffect(() => {
    if (managerRef.current) {
      managerRef.current.syncToTime(currentTime);
    }
  }, [currentTime]);

  // Sync play state
  useEffect(() => {
    if (managerRef.current) {
      managerRef.current.syncPlayState(isPlaying);
    }
  }, [isPlaying]);

  // Return manager methods
  const syncToFrame = useCallback((frame: number) => {
    managerRef.current?.syncToFrame(frame);
  }, []);

  const syncToTime = useCallback((time: number) => {
    managerRef.current?.syncToTime(time);
  }, []);

  const preloadFrames = useCallback((time: number) => {
    managerRef.current?.preloadFrames(time);
  }, []);

  const getActiveElementsForTime = useCallback(() => {
    return getActiveElements(tracks, currentTime);
  }, [tracks, currentTime]);

  return {
    syncToFrame,
    syncToTime,
    preloadFrames,
    getActiveElements: getActiveElementsForTime,
    globalToLocalFrame: (globalFrame: number, element: RemotionElement) =>
      globalToLocalFrame(globalFrame, element, fps),
    localToGlobalFrame: (localFrame: number, element: RemotionElement) =>
      localToGlobalFrame(localFrame, element, fps),
  };
}

// ============================================================================
// Exports
// ============================================================================

export { DEFAULT_SYNC_CONFIG };
// SyncConfig and SyncState types are exported from ./types
