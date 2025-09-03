/**
 * Error Context Helper
 *
 * Utility functions to capture common context information for error reporting.
 * Provides consistent metadata across the application for better debugging.
 */

// Generate a session ID for the current browser session
let sessionId: string | null = null;

const getSessionId = (): string => {
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
  return sessionId;
};

// Get current browser and environment information
const getBrowserContext = () => ({
  userAgent:
    typeof navigator !== "undefined"
      ? ((navigator as any).userAgentData?.brands
          ?.map((b: any) => `${b.brand}/${b.version}`)
          .join(" ") ?? navigator.userAgent.slice(0, 64))
      : "unknown",
  platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
  language: typeof navigator !== "undefined" ? navigator.language : "unknown",
  cookieEnabled:
    typeof navigator !== "undefined" ? navigator.cookieEnabled : false,
  onLine: typeof navigator !== "undefined" ? navigator.onLine : true,
});

// Get current page and routing context
const getPageContext = () => ({
  url: typeof window !== "undefined" ? window.location.href : "unknown",
  pathname:
    typeof window !== "undefined" ? window.location.pathname : "unknown",
  search: typeof window !== "undefined" ? window.location.search : "",
  hash: typeof window !== "undefined" ? window.location.hash : "",
  referrer: typeof document !== "undefined" ? document.referrer : "unknown",
});

// Get performance and timing information
const getPerformanceContext = () => {
  if (typeof performance === "undefined") {
    return {
      timestamp: Date.now(),
      uptime: 0,
      memoryUsage: null,
    };
  }

  const memory = (performance as any).memory;
  return {
    timestamp: Date.now(),
    uptime: Math.round(performance.now()),
    memoryUsage: memory
      ? {
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit,
        }
      : null,
  };
};

/**
 * Get comprehensive error context information
 *
 * Safely captures context from stores and browser environment.
 * Returns null for unavailable information instead of throwing errors.
 */
export const getErrorContext = () => {
  const context = {
    // Session information
    sessionId: getSessionId(),

    // Browser and environment
    ...getBrowserContext(),

    // Page and routing
    ...getPageContext(),

    // Performance and timing
    ...getPerformanceContext(),

    // Project context (safely accessed)
    projectId: null as string | null,
    projectName: null as string | null,

    // Media context
    mediaItemCount: null as number | null,

    // Timeline context
    trackCount: null as number | null,
    selectedElementCount: null as number | null,
  };

  // Safely get project store context
  try {
    // Dynamic import to avoid circular dependencies
    if (typeof window !== "undefined") {
      const projectStore = (window as any).__PROJECT_STORE_STATE__;
      if (projectStore?.activeProject) {
        context.projectId = projectStore.activeProject.id;
        context.projectName = projectStore.activeProject.name;
      }
    }
  } catch (error) {
    // Ignore errors when accessing project store
  }

  // Safely get media store context
  try {
    if (typeof window !== "undefined") {
      const mediaStore = (window as any).__MEDIA_STORE_STATE__;
      if (mediaStore?.mediaItems) {
        context.mediaItemCount = mediaStore.mediaItems.length;
      }
    }
  } catch (error) {
    // Ignore errors when accessing media store
  }

  // Safely get timeline store context
  try {
    if (typeof window !== "undefined") {
      const timelineStore = (window as any).__TIMELINE_STORE_STATE__;
      if (timelineStore?._tracks) {
        context.trackCount = timelineStore._tracks.length;
        context.selectedElementCount =
          timelineStore.selectedElements?.length || 0;
      }
    }
  } catch (error) {
    // Ignore errors when accessing timeline store
  }

  return context;
};

/**
 * Get minimal error context for performance-critical paths
 *
 * Returns only essential context information to minimize overhead.
 */
export const getMinimalErrorContext = () => ({
  sessionId: getSessionId(),
  timestamp: Date.now(),
  url: typeof window !== "undefined" ? window.location.href : "unknown",
});

/**
 * Get project-specific error context
 *
 * Attempts to get project information more directly than getErrorContext.
 * Falls back gracefully if store access fails.
 */
export const getProjectErrorContext = async () => {
  try {
    // Try to get project store directly
    const { useProjectStore } = await import("@/stores/project-store");
    const activeProject = useProjectStore.getState().activeProject;

    return {
      projectId: activeProject?.id || null,
      projectName: activeProject?.name || null,
      projectCreated: activeProject?.createdAt || null,
      projectUpdated: activeProject?.updatedAt || null,
      projectFps: activeProject?.fps || null,
    };
  } catch (error) {
    return {
      projectId: null,
      projectName: null,
      projectCreated: null,
      projectUpdated: null,
      projectFps: null,
    };
  }
};

/**
 * Enhanced error context that includes store states
 *
 * Use this for critical errors where detailed context is needed.
 * May have performance implications, use judiciously.
 */
export const getDetailedErrorContext = async () => {
  const baseContext = getErrorContext();
  const projectContext = await getProjectErrorContext();

  let mediaContext = {};
  let timelineContext = {};

  // Try to get media store context
  try {
    const { useMediaStore } = await import("@/stores/media-store");
    const mediaState = useMediaStore.getState();
    mediaContext = {
      mediaItemCount: mediaState.mediaItems.length,
      isLoading: mediaState.isLoading,
      hasInitialized: mediaState.hasInitialized,
    };
  } catch (error) {
    // Ignore media store errors
  }

  // Try to get timeline store context
  try {
    const { useTimelineStore } = await import("@/stores/timeline-store");
    const timelineState = useTimelineStore.getState();
    timelineContext = {
      trackCount: timelineState._tracks.length,
      selectedElementCount: timelineState.selectedElements.length,
      historyLength: timelineState.history.length,
      canUndo: timelineState.history.length > 0,
      canRedo: timelineState.redoStack.length > 0,
    };
  } catch (error) {
    // Ignore timeline store errors
  }

  return {
    ...baseContext,
    ...projectContext,
    ...mediaContext,
    ...timelineContext,
  };
};

export default {
  getErrorContext,
  getMinimalErrorContext,
  getProjectErrorContext,
  getDetailedErrorContext,
};
