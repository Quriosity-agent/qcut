/**
 * Claude Timeline Bridge Helpers
 * Utility functions for element resolution, formatting, and import operations.
 * Extracted from claude-timeline-bridge.ts to keep files under 800 lines.
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
import { debugLog, debugWarn, debugError } from "@/lib/debug-config";

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

export type TimelineStoreState = ReturnType<typeof useTimelineStore.getState>;

const projectMediaSyncInFlight = new Map<string, Promise<void>>();

/**
 * Calculate effective duration with safe trim handling
 */
export function getEffectiveDuration(element: TimelineElement): number {
  const trimStart = element.trimStart ?? 0;
  const trimEnd = element.trimEnd ?? 0;
  const effectiveDuration = element.duration - trimStart - trimEnd;
  return Math.max(0, effectiveDuration);
}

/**
 * Calculate total duration from tracks
 */
export function calculateTimelineDuration(tracks: TimelineTrack[]): number {
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
export function findTrackByElementId(
  tracks: TimelineTrack[],
  elementId: string
): TimelineTrack | null {
  return (
    tracks.find((track) => track.elements.some((e) => e.id === elementId)) ||
    null
  );
}

/** Check if element type is a media type (media, video, audio, image). */
export function isClaudeMediaElementType({
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

/** Get element start time, defaulting to 0 if not set. */
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

/** Derive element duration from start/end times or use fallback. */
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

/** Find matching media item by source name or ID. */
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

/** Decode a base64url-encoded UTF-8 string, returning null on failure. */
function decodeBase64UrlUtf8({ encoded }: { encoded: string }): string | null {
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

/** Extract original source name from a deterministic media ID prefix. */
function getSourceNameFromDeterministicSourceId({
  sourceId,
}: {
  sourceId: string;
}): string | null {
  if (!sourceId.startsWith(CLAUDE_DETERMINISTIC_MEDIA_ID_PREFIX)) {
    return null;
  }

  const encodedName = sourceId.slice(
    CLAUDE_DETERMINISTIC_MEDIA_ID_PREFIX.length
  );
  if (!encodedName) {
    return null;
  }

  return decodeBase64UrlUtf8({ encoded: encodedName });
}

/** Sync project media from disk if not already in flight. */
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
      debugWarn("[ClaudeTimelineBridge] Media sync failed:", error);
    } finally {
      projectMediaSyncInFlight.delete(projectId);
    }
  })();

  projectMediaSyncInFlight.set(projectId, syncPromise);
  await syncPromise;
}

/** Resolve a media item for an element, syncing project media if needed. */
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
    debugWarn("[ClaudeTimelineBridge] Media resolution failed:", error);
    return null;
  }
}

/** Add a Claude media element to the timeline store. */
export async function addClaudeMediaElement({
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
    debugWarn(
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

  debugLog("[ClaudeTimelineBridge] Added media element:", mediaItem.name);
}

/** Add a Claude text element to the timeline store. */
export function addClaudeTextElement({
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

  debugLog("[ClaudeTimelineBridge] Added text element:", content);
}

/**
 * Format internal tracks for Claude export
 */
export function formatTracksForExport(tracks: TimelineTrack[]): ClaudeTrack[] {
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
    type: element.type === "markdown" ? "text" : element.type,
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
    case "markdown":
      return {
        ...baseElement,
        content: element.markdownContent,
      };
    default:
      return baseElement;
  }
}

/**
 * Apply imported Claude timeline to store (appends to existing timeline)
 */
export async function applyTimelineToStore(
  timeline: ClaudeTimeline
): Promise<void> {
  const totalElements = timeline.tracks.reduce(
    (sum, t) => sum + t.elements.length,
    0
  );
  debugLog("[ClaudeTimelineBridge] Applying timeline:", {
    name: timeline.name,
    duration: timeline.duration,
    tracks: timeline.tracks.length,
    totalElements,
  });

  const projectId = useProjectStore.getState().activeProject?.id;
  let added = 0;

  for (const track of timeline.tracks) {
    for (const element of track.elements) {
      try {
        if (isClaudeMediaElementType({ type: element.type })) {
          await addClaudeMediaElement({
            element,
            timelineStore: useTimelineStore.getState(),
            projectId,
          });
          added++;
        } else if (element.type === "text") {
          addClaudeTextElement({
            element,
            timelineStore: useTimelineStore.getState(),
          });
          added++;
        } else {
          debugWarn(
            "[ClaudeTimelineBridge] Skipping unsupported element type:",
            element.type
          );
        }
      } catch (error) {
        debugError(
          "[ClaudeTimelineBridge] Failed to add element during import:",
          element.id,
          error
        );
      }
    }
  }

  debugLog(
    `[ClaudeTimelineBridge] Timeline import complete: ${added}/${totalElements} elements added`
  );
}
