/**
 * Lazy import utilities for stores to optimize bundle splitting
 *
 * These wrappers allow dynamic imports to work properly without
 * conflicting with static imports in other parts of the application.
 */

import { debugLogger } from "@/lib/debug-logger";

// Cache for loaded stores to avoid repeated imports
const storeCache = new Map<string, any>();

/**
 * Lazily loads the media store when needed
 * @returns Promise<useMediaStore> The media store hook
 */
export async function getMediaStore() {
  const cacheKey = "media-store";

  if (storeCache.has(cacheKey)) {
    return storeCache.get(cacheKey);
  }

  try {
    const { useMediaStore } = await import("@/stores/media-store");
    storeCache.set(cacheKey, useMediaStore);
    return useMediaStore;
  } catch (error) {
    debugLogger.error(
      "lazy-stores",
      "Failed to lazy load media store",
      error instanceof Error ? error : String(error)
    );
    // Fallback to direct import if dynamic import fails
    const { useMediaStore } = await import("@/stores/media-store");
    return useMediaStore;
  }
}

/**
 * Lazily loads the timeline store when needed
 * @returns Promise<useTimelineStore> The timeline store hook
 */
export async function getTimelineStore() {
  const cacheKey = "timeline-store";

  if (storeCache.has(cacheKey)) {
    return storeCache.get(cacheKey);
  }

  try {
    const { useTimelineStore } = await import("@/stores/timeline-store");
    storeCache.set(cacheKey, useTimelineStore);
    return useTimelineStore;
  } catch (error) {
    debugLogger.error(
      "lazy-stores",
      "Failed to lazy load timeline store",
      error instanceof Error ? error : String(error)
    );
    // Fallback to direct import if dynamic import fails
    const { useTimelineStore } = await import("@/stores/timeline-store");
    return useTimelineStore;
  }
}

/**
 * Lazily loads the project store when needed
 * @returns Promise<useProjectStore> The project store hook
 */
export async function getProjectStore() {
  const cacheKey = "project-store";

  if (storeCache.has(cacheKey)) {
    return storeCache.get(cacheKey);
  }

  try {
    const { useProjectStore } = await import("@/stores/project-store");
    storeCache.set(cacheKey, useProjectStore);
    return useProjectStore;
  } catch (error) {
    debugLogger.error(
      "lazy-stores",
      "Failed to lazy load project store",
      error instanceof Error ? error : String(error)
    );
    // Fallback to direct import if dynamic import fails
    const { useProjectStore } = await import("@/stores/project-store");
    return useProjectStore;
  }
}

/**
 * Lazily loads the scene store when needed
 * @returns Promise<useSceneStore> The scene store hook
 */
export async function getSceneStore() {
  const cacheKey = "scene-store";

  if (storeCache.has(cacheKey)) {
    return storeCache.get(cacheKey);
  }

  try {
    const { useSceneStore } = await import("@/stores/scene-store");
    storeCache.set(cacheKey, useSceneStore);
    return useSceneStore;
  } catch (error) {
    debugLogger.error(
      "lazy-stores",
      "Failed to lazy load scene store",
      error instanceof Error ? error : String(error)
    );
    const { useSceneStore } = await import("@/stores/scene-store");
    return useSceneStore;
  }
}

/**
 * Lazily loads the stickers overlay store when needed
 * @returns Promise<useStickersOverlayStore> The stickers overlay store hook
 */
export async function getStickersOverlayStore() {
  const cacheKey = "stickers-overlay-store";

  if (storeCache.has(cacheKey)) {
    return storeCache.get(cacheKey);
  }

  try {
    const { useStickersOverlayStore } = await import("@/stores/stickers-overlay-store");
    storeCache.set(cacheKey, useStickersOverlayStore);
    return useStickersOverlayStore;
  } catch (error) {
    debugLogger.error(
      "lazy-stores",
      "Failed to lazy load stickers overlay store",
      error instanceof Error ? error : String(error)
    );
    const { useStickersOverlayStore } = await import("@/stores/stickers-overlay-store");
    return useStickersOverlayStore;
  }
}

/**
 * Lazily loads the playback store when needed
 * @returns Promise<usePlaybackStore> The playback store hook
 */
export async function getPlaybackStore() {
  const cacheKey = "playback-store";

  if (storeCache.has(cacheKey)) {
    return storeCache.get(cacheKey);
  }

  try {
    const { usePlaybackStore } = await import("@/stores/playback-store");
    storeCache.set(cacheKey, usePlaybackStore);
    return usePlaybackStore;
  } catch (error) {
    debugLogger.error(
      "lazy-stores",
      "Failed to lazy load playback store",
      error instanceof Error ? error : String(error)
    );
    const { usePlaybackStore } = await import("@/stores/playback-store");
    return usePlaybackStore;
  }
}

/**
 * Lazily loads the export store when needed
 * @returns Promise<useExportStore> The export store hook
 */
export async function getExportStore() {
  const cacheKey = "export-store";

  if (storeCache.has(cacheKey)) {
    return storeCache.get(cacheKey);
  }

  try {
    const { useExportStore } = await import("@/stores/export-store");
    storeCache.set(cacheKey, useExportStore);
    return useExportStore;
  } catch (error) {
    debugLogger.error(
      "lazy-stores",
      "Failed to lazy load export store",
      error instanceof Error ? error : String(error)
    );
    const { useExportStore } = await import("@/stores/export-store");
    return useExportStore;
  }
}

/**
 * Lazily loads the editor store when needed
 * @returns Promise<useEditorStore> The editor store hook
 */
export async function getEditorStore() {
  const cacheKey = "editor-store";

  if (storeCache.has(cacheKey)) {
    return storeCache.get(cacheKey);
  }

  try {
    const { useEditorStore } = await import("@/stores/editor-store");
    storeCache.set(cacheKey, useEditorStore);
    return useEditorStore;
  } catch (error) {
    debugLogger.error(
      "lazy-stores",
      "Failed to lazy load editor store",
      error instanceof Error ? error : String(error)
    );
    const { useEditorStore } = await import("@/stores/editor-store");
    return useEditorStore;
  }
}

/**
 * Preloads critical stores for better performance
 * Call this early in the application lifecycle
 */
export async function preloadCriticalStores() {
  try {
    // Preload the most commonly used stores
    await Promise.all([getMediaStore(), getTimelineStore(), getProjectStore()]);
  } catch (error) {
    debugLogger.error(
      "lazy-stores",
      "Failed to preload stores",
      error instanceof Error ? error : String(error)
    );
  }
}

/**
 * Clears the store cache (useful for testing or memory management)
 */
export function clearStoreCache() {
  storeCache.clear();
}
