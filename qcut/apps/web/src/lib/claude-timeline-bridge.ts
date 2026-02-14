/**
 * Claude Timeline Bridge
 * Connects Electron main process Claude API with renderer's Zustand stores
 */

import { useTimelineStore } from "@/stores/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { useMediaStore, type MediaItem } from "@/stores/media-store";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import type {
  ClaudeTimeline,
  ClaudeTrack,
  ClaudeElement,
} from "../../../../electron/types/claude-api";

/**
 * Calculate effective duration with safe trim handling
 * Guards against undefined trims and negative durations
 */
function getEffectiveDuration(element: TimelineElement): number {
  const trimStart = element.trimStart ?? 0;
  const trimEnd = element.trimEnd ?? 0;
  const effectiveDuration = element.duration - trimStart - trimEnd;
  return Math.max(0, effectiveDuration);
}

/**
 * Calculate total duration from tracks
 */
function calculateTimelineDuration(tracks: TimelineTrack[]): number {
  let maxEndTime = 0;
  for (const track of tracks) {
    for (const element of track.elements) {
      const effectiveDuration = getEffectiveDuration(element);
      const endTime = element.startTime + effectiveDuration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
  }
  return maxEndTime;
}

/**
 * Find track containing an element
 */
function findTrackByElementId(
  tracks: TimelineTrack[],
  elementId: string
): TimelineTrack | null {
  return (
    tracks.find((track) => track.elements.some((e) => e.id === elementId)) ||
    null
  );
}

const CLAUDE_MEDIA_ELEMENT_TYPES = {
  media: "media",
  video: "video",
  audio: "audio",
  image: "image",
} as const;

const DEFAULT_MEDIA_DURATION_SECONDS = 10;
const DEFAULT_TEXT_DURATION_SECONDS = 5;
const DEFAULT_TEXT_CONTENT = "Text";
const CLAUDE_DETERMINISTIC_MEDIA_ID_PREFIX = "media_";

type TimelineStoreState = ReturnType<typeof useTimelineStore.getState>;

const projectMediaSyncInFlight = new Map<string, Promise<void>>();

function isClaudeMediaElementType({
  type,
}: {
  type: Partial<ClaudeElement>["type"] | undefined;
}): boolean {
  return (
    type === CLAUDE_MEDIA_ELEMENT_TYPES.media ||
    type === CLAUDE_MEDIA_ELEMENT_TYPES.video ||
    type === CLAUDE_MEDIA_ELEMENT_TYPES.audio ||
    type === CLAUDE_MEDIA_ELEMENT_TYPES.image
  );
}

function getElementStartTime({
  element,
}: {
  element: Partial<ClaudeElement>;
}): number {
  if (typeof element.startTime === "number" && element.startTime >= 0) {
    return element.startTime;
  }
  return 0;
}

function getElementDuration({
  element,
  fallbackDuration,
}: {
  element: Partial<ClaudeElement>;
  fallbackDuration: number;
}): number {
  if (
    typeof element.startTime === "number" &&
    typeof element.endTime === "number"
  ) {
    const rangeDuration = element.endTime - element.startTime;
    if (rangeDuration > 0) {
      return rangeDuration;
    }
  }

  if (fallbackDuration > 0) {
    return fallbackDuration;
  }

  return DEFAULT_MEDIA_DURATION_SECONDS;
}

function findMediaItemForElement({
  element,
  mediaItems,
}: {
  element: Partial<ClaudeElement>;
  mediaItems: MediaItem[];
}): MediaItem | null {
  if (element.sourceName) {
    const mediaByName = mediaItems.find(
      (item) => item.name === element.sourceName
    );
    if (mediaByName) {
      return mediaByName;
    }
  }

  if (element.sourceId) {
    const mediaById = mediaItems.find((item) => item.id === element.sourceId);
    if (mediaById) {
      return mediaById;
    }

    const decodedSourceName = getSourceNameFromDeterministicSourceId({
      sourceId: element.sourceId,
    });
    if (decodedSourceName) {
      const mediaByDecodedName = mediaItems.find(
        (item) => item.name === decodedSourceName
      );
      if (mediaByDecodedName) {
        return mediaByDecodedName;
      }
    }
  }

  return null;
}

function decodeBase64UrlUtf8({
  encoded,
}: {
  encoded: string;
}): string | null {
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = window.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function getSourceNameFromDeterministicSourceId({
  sourceId,
}: {
  sourceId: string;
}): string | null {
  if (!sourceId.startsWith(CLAUDE_DETERMINISTIC_MEDIA_ID_PREFIX)) {
    return null;
  }

  const encodedName = sourceId.slice(CLAUDE_DETERMINISTIC_MEDIA_ID_PREFIX.length);
  if (!encodedName) {
    return null;
  }

  return decodeBase64UrlUtf8({ encoded: encodedName });
}

async function syncProjectMediaIfNeeded({
  projectId,
}: {
  projectId: string;
}): Promise<void> {
  const existingSync = projectMediaSyncInFlight.get(projectId);
  if (existingSync) {
    await existingSync;
    return;
  }

  const syncPromise = (async (): Promise<void> => {
    try {
      const { syncProjectFolder } = await import("@/lib/project-folder-sync");
      await syncProjectFolder(projectId);
    } catch (error) {
      console.warn("[ClaudeTimelineBridge] Media sync failed:", error);
    } finally {
      projectMediaSyncInFlight.delete(projectId);
    }
  })();

  projectMediaSyncInFlight.set(projectId, syncPromise);
  await syncPromise;
}

async function resolveMediaItemForElement({
  element,
  projectId,
}: {
  element: Partial<ClaudeElement>;
  projectId: string | undefined;
}): Promise<MediaItem | null> {
  try {
    const mediaBeforeSync = findMediaItemForElement({
      element,
      mediaItems: useMediaStore.getState().mediaItems,
    });
    if (mediaBeforeSync) {
      return mediaBeforeSync;
    }

    if (!projectId || !window.electronAPI?.projectFolder) {
      return null;
    }

    await syncProjectMediaIfNeeded({ projectId });

    return findMediaItemForElement({
      element,
      mediaItems: useMediaStore.getState().mediaItems,
    });
  } catch (error) {
    console.warn("[ClaudeTimelineBridge] Media resolution failed:", error);
    return null;
  }
}

async function addClaudeMediaElement({
  element,
  timelineStore,
  projectId,
}: {
  element: Partial<ClaudeElement>;
  timelineStore: TimelineStoreState;
  projectId: string | undefined;
}): Promise<void> {
  const mediaItem = await resolveMediaItemForElement({
    element,
    projectId,
  });

  if (!mediaItem) {
    console.warn(
      "[ClaudeTimelineBridge] Media not found:",
      element.sourceName || element.sourceId
    );
    return;
  }

  const trackId = timelineStore.findOrCreateTrack("media");
  const fallbackDuration =
    typeof mediaItem.duration === "number" && mediaItem.duration > 0
      ? mediaItem.duration
      : DEFAULT_MEDIA_DURATION_SECONDS;
  const startTime = getElementStartTime({ element });
  const duration = getElementDuration({
    element,
    fallbackDuration,
  });

  timelineStore.addElementToTrack(trackId, {
    type: "media",
    name: mediaItem.name,
    mediaId: mediaItem.id,
    startTime,
    duration,
    trimStart: 0,
    trimEnd: 0,
  });

  console.log("[ClaudeTimelineBridge] Added media element:", mediaItem.name);
}

function addClaudeTextElement({
  element,
  timelineStore,
}: {
  element: Partial<ClaudeElement>;
  timelineStore: TimelineStoreState;
}): void {
  const trackId = timelineStore.findOrCreateTrack("text");
  const startTime = getElementStartTime({ element });
  const duration = getElementDuration({
    element,
    fallbackDuration: DEFAULT_TEXT_DURATION_SECONDS,
  });
  const content =
    typeof element.content === "string" && element.content.trim().length > 0
      ? element.content
      : DEFAULT_TEXT_CONTENT;

  timelineStore.addElementToTrack(trackId, {
    type: "text",
    name: content,
    content,
    startTime,
    duration,
    trimStart: 0,
    trimEnd: 0,
    fontSize: 48,
    fontFamily: "Inter",
    color: "#ffffff",
    backgroundColor: "transparent",
    textAlign: "center",
    fontWeight: "normal",
    fontStyle: "normal",
    textDecoration: "none",
    x: 0.5,
    y: 0.5,
    rotation: 0,
    opacity: 1,
  });

  console.log("[ClaudeTimelineBridge] Added text element:", content);
}

/**
 * Setup Claude Timeline Bridge
 * Call this once during app initialization
 */
export function setupClaudeTimelineBridge(): void {
  if (!window.electronAPI?.claude?.timeline) {
    console.warn("[ClaudeTimelineBridge] Claude Timeline API not available");
    return;
  }

  const claudeAPI = window.electronAPI.claude.timeline;
  console.log("[ClaudeTimelineBridge] Setting up bridge...");

  // Respond to timeline export request from main process
  claudeAPI.onRequest(() => {
    try {
      console.log("[ClaudeTimelineBridge] Received timeline export request");

      const timelineState = useTimelineStore.getState();
      const projectState = useProjectStore.getState();
      const project = projectState.activeProject;
      const tracks = timelineState.tracks;

      const timeline: ClaudeTimeline = {
        name: project?.name || "Untitled",
        duration: calculateTimelineDuration(tracks),
        width: project?.canvasSize?.width || 1920,
        height: project?.canvasSize?.height || 1080,
        fps: project?.fps || 30,
        tracks: formatTracksForExport(tracks),
      };

      claudeAPI.sendResponse(timeline);
      console.log("[ClaudeTimelineBridge] Sent timeline response");
    } catch (error) {
      console.error(
        "[ClaudeTimelineBridge] Failed to handle timeline export request:",
        error
      );
    }
  });

  // Handle timeline import from Claude
  claudeAPI.onApply((timeline: ClaudeTimeline) => {
    try {
      console.log(
        "[ClaudeTimelineBridge] Received timeline to apply:",
        timeline.name
      );
      applyTimelineToStore(timeline);
    } catch (error) {
      console.error("[ClaudeTimelineBridge] Failed to apply timeline:", error);
    }
  });

  // Handle element addition from Claude
  claudeAPI.onAddElement(async (element: Partial<ClaudeElement>) => {
    try {
      console.log("[ClaudeTimelineBridge] Adding element:", element);

      const timelineStore = useTimelineStore.getState();
      const projectId = useProjectStore.getState().activeProject?.id;

      if (isClaudeMediaElementType({ type: element.type })) {
        await addClaudeMediaElement({
          element,
          timelineStore,
          projectId,
        });
        return;
      }

      if (element.type === "text") {
        addClaudeTextElement({
          element,
          timelineStore,
        });
        return;
      }

      console.warn(
        "[ClaudeTimelineBridge] Unsupported element type:",
        element.type
      );
    } catch (error) {
      console.error("[ClaudeTimelineBridge] Failed to add element:", error);
    }
  });

  /**
   * Handle element update from Claude
   *
   * @stub This handler is intentionally a stub. Updating elements requires:
   * 1. Timeline store to expose an updateElement method
   * 2. Mapping partial ClaudeElement changes to TimelineElement fields
   * 3. Validating changes don't create invalid state (overlaps, negative times)
   */
  claudeAPI.onUpdateElement(
    (data: { elementId: string; changes: Partial<ClaudeElement> }) => {
      try {
        console.log("[ClaudeTimelineBridge] Updating element:", data.elementId);
        console.warn(
          "[ClaudeTimelineBridge] updateElement not implemented - needs store method"
        );
      } catch (error) {
        console.error(
          "[ClaudeTimelineBridge] Failed to handle element update:",
          error
        );
      }
    }
  );

  // Handle element removal
  claudeAPI.onRemoveElement((elementId: string) => {
    try {
      console.log("[ClaudeTimelineBridge] Removing element:", elementId);
      const timelineStore = useTimelineStore.getState();
      const tracks = timelineStore.tracks;

      // Find the track containing this element
      const track = findTrackByElementId(tracks, elementId);
      if (track) {
        timelineStore.removeElementFromTrack(track.id, elementId);
        return;
      }

      console.warn(
        "[ClaudeTimelineBridge] Could not find track for element:",
        elementId
      );
    } catch (error) {
      console.error(
        "[ClaudeTimelineBridge] Failed to handle element removal:",
        error
      );
    }
  });

  console.log("[ClaudeTimelineBridge] Bridge setup complete");
}

/**
 * Format internal tracks for Claude export
 */
function formatTracksForExport(tracks: TimelineTrack[]): ClaudeTrack[] {
  return tracks.map((track, index) => ({
    index,
    name: track.name || `Track ${index + 1}`,
    type: track.type,
    elements: track.elements.map((element) =>
      formatElementForExport(element, index)
    ),
  }));
}

/**
 * Format a single element for export
 */
function formatElementForExport(
  element: TimelineElement,
  trackIndex: number
): ClaudeElement {
  const effectiveDuration = getEffectiveDuration(element);

  const baseElement: ClaudeElement = {
    id: element.id,
    trackIndex,
    startTime: element.startTime,
    endTime: element.startTime + effectiveDuration,
    duration: effectiveDuration,
    type: element.type,
  };

  // Add type-specific fields
  switch (element.type) {
    case "media":
      return {
        ...baseElement,
        sourceId: element.mediaId,
        sourceName: element.name,
      };
    case "text":
      return {
        ...baseElement,
        content: element.content,
      };
    case "captions":
      return {
        ...baseElement,
        content: element.text,
      };
    case "sticker":
      return {
        ...baseElement,
        sourceId: element.stickerId,
      };
    case "remotion":
      return {
        ...baseElement,
        sourceId: element.componentId,
      };
    default:
      return baseElement;
  }
}

/**
 * Apply imported Claude timeline to store
 *
 * @stub This function is intentionally a stub. Timeline import is a complex
 * operation that requires user confirmation before overwriting existing work.
 * Full implementation is tracked separately and out of scope for this PR.
 *
 * Future implementation will:
 * 1. Validate media references exist in the media store
 * 2. Map Claude elements back to internal TimelineElement types
 * 3. Handle conflicts with existing elements (prompt user)
 * 4. Update timeline store with imported data
 */
function applyTimelineToStore(timeline: ClaudeTimeline): void {
  try {
    // Log import details for debugging - helps verify the bridge is working
    console.log("[ClaudeTimelineBridge] Would apply timeline:", {
      name: timeline.name,
      duration: timeline.duration,
      tracks: timeline.tracks.length,
      totalElements: timeline.tracks.reduce(
        (sum, t) => sum + t.elements.length,
        0
      ),
    });

    console.warn(
      "[ClaudeTimelineBridge] Timeline import requires user confirmation - not yet implemented"
    );
  } catch (error) {
    console.error("[ClaudeTimelineBridge] Timeline import failed:", error);
  }
}

/**
 * Cleanup bridge listeners
 */
export function cleanupClaudeTimelineBridge(): void {
  if (window.electronAPI?.claude?.timeline?.removeListeners) {
    window.electronAPI.claude.timeline.removeListeners();
  }
  console.log("[ClaudeTimelineBridge] Bridge cleanup complete");
}

/**
 * Setup Claude Project Bridge (for stats requests)
 */
export function setupClaudeProjectBridge(): void {
  if (!window.electronAPI?.claude?.project) {
    return;
  }

  const projectAPI = window.electronAPI.claude.project;

  // Respond to stats request
  projectAPI.onStatsRequest(() => {
    const timelineState = useTimelineStore.getState();
    const projectState = useProjectStore.getState();
    const tracks = timelineState.tracks;

    // Count media by type
    const mediaCount = { video: 0, audio: 0, image: 0 };
    let elementCount = 0;
    const mediaItems = useMediaStore.getState().mediaItems;

    for (const track of tracks) {
      elementCount += track.elements.length;
      for (const element of track.elements) {
        if (element.type === "media") {
          const mediaItem = mediaItems.find((m) => m.id === element.mediaId);
          if (mediaItem && mediaItem.type in mediaCount) {
            mediaCount[mediaItem.type]++;
          } else {
            // Fallback to video if media not found
            mediaCount.video++;
          }
        }
      }
    }

    const stats = {
      totalDuration: calculateTimelineDuration(tracks),
      mediaCount,
      trackCount: tracks.length,
      elementCount,
      lastModified:
        projectState.activeProject?.updatedAt?.getTime() || Date.now(),
      fileSize: 0, // Would need to calculate
    };

    projectAPI.sendStatsResponse(stats);
  });
}

/**
 * Cleanup project bridge listeners
 */
export function cleanupClaudeProjectBridge(): void {
  if (window.electronAPI?.claude?.project?.removeListeners) {
    window.electronAPI.claude.project.removeListeners();
  }
}
