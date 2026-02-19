/**
 * Claude Timeline Bridge
 * Connects Electron main process Claude API with renderer's Zustand stores.
 * Helper functions are in claude-timeline-bridge-helpers.ts.
 */

import { useTimelineStore } from "@/stores/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { useMediaStore } from "@/stores/media-store";
import { validateElementTrackCompatibility } from "@/types/timeline";
import type {
  ClaudeTimeline,
  ClaudeElement,
  ClaudeBatchAddElementRequest,
  ClaudeBatchAddResponse,
  ClaudeBatchDeleteResponse,
  ClaudeBatchUpdateResponse,
  ClaudeArrangeResponse,
} from "../../../../electron/types/claude-api";
import { debugLog, debugWarn, debugError } from "@/lib/debug-config";
import {
  calculateTimelineDuration,
  findTrackByElementId,
  isClaudeMediaElementType,
  addClaudeMediaElement,
  addClaudeTextElement,
  formatTracksForExport,
  applyTimelineToStore,
  syncProjectMediaIfNeeded,
} from "./claude-timeline-bridge-helpers";

const MAX_TIMELINE_BATCH_ITEMS = 50;

const CLAUDE_TRACK_ELEMENT_TYPES = {
  media: "media",
  text: "text",
  sticker: "sticker",
  captions: "captions",
  remotion: "remotion",
  markdown: "markdown",
} as const;

type ClaudeTrackElementType =
  (typeof CLAUDE_TRACK_ELEMENT_TYPES)[keyof typeof CLAUDE_TRACK_ELEMENT_TYPES];

function normalizeClaudeElementType({
  type,
}: {
  type: Partial<ClaudeElement>["type"] | undefined;
}): ClaudeTrackElementType | null {
  if (!type) return null;
  if (type === "video" || type === "audio" || type === "image") {
    return CLAUDE_TRACK_ELEMENT_TYPES.media;
  }
  if (
    type === CLAUDE_TRACK_ELEMENT_TYPES.media ||
    type === CLAUDE_TRACK_ELEMENT_TYPES.text ||
    type === CLAUDE_TRACK_ELEMENT_TYPES.sticker ||
    type === CLAUDE_TRACK_ELEMENT_TYPES.captions ||
    type === CLAUDE_TRACK_ELEMENT_TYPES.remotion
  ) {
    return type;
  }
  return null;
}

function decodeDeterministicMediaSourceName({
  sourceId,
}: {
  sourceId: string;
}): string | null {
  try {
    if (!sourceId.startsWith("media_")) {
      return null;
    }
    const encodedName = sourceId.slice("media_".length);
    if (!encodedName) {
      return null;
    }
    const base64 = encodedName.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = window.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function resolveMediaIdForBatchElement({
  element,
}: {
  element: ClaudeBatchAddElementRequest;
}): string | null {
  const { mediaItems } = useMediaStore.getState();

  if (element.mediaId) {
    const byMediaId = mediaItems.find((item) => item.id === element.mediaId);
    if (byMediaId) {
      return byMediaId.id;
    }
  }

  if (element.sourceId) {
    const bySourceId = mediaItems.find((item) => item.id === element.sourceId);
    if (bySourceId) {
      return bySourceId.id;
    }

    const decodedName = decodeDeterministicMediaSourceName({
      sourceId: element.sourceId,
    });
    if (decodedName) {
      const byDecodedName = mediaItems.find(
        (item) => item.name === decodedName
      );
      if (byDecodedName) {
        return byDecodedName.id;
      }
    }
  }

  if (element.sourceName) {
    const byName = mediaItems.find((item) => item.name === element.sourceName);
    if (byName) {
      return byName.id;
    }
  }

  return null;
}

/**
 * Setup Claude Timeline Bridge
 * Call this once during app initialization
 */
export function setupClaudeTimelineBridge(): void {
  if (!window.electronAPI?.claude?.timeline) {
    debugWarn("[ClaudeTimelineBridge] Claude Timeline API not available");
    return;
  }

  const claudeAPI = window.electronAPI.claude.timeline;
  debugLog("[ClaudeTimelineBridge] Setting up bridge...");

  // Respond to timeline export request from main process
  claudeAPI.onRequest(() => {
    try {
      debugLog("[ClaudeTimelineBridge] Received timeline export request");

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
      debugLog("[ClaudeTimelineBridge] Sent timeline response");
    } catch (error) {
      debugError(
        "[ClaudeTimelineBridge] Failed to handle timeline export request:",
        error
      );
    }
  });

  // Handle timeline import from Claude
  claudeAPI.onApply(async (timeline: ClaudeTimeline, replace?: boolean) => {
    try {
      debugLog(
        "[ClaudeTimelineBridge] Received timeline to apply:",
        timeline.name,
        "replace:",
        replace
      );

      if (replace) {
        const timelineStore = useTimelineStore.getState();
        timelineStore.pushHistory();
        for (const track of [...timelineStore.tracks]) {
          for (const element of [...track.elements]) {
            useTimelineStore
              .getState()
              .removeElementFromTrack(track.id, element.id, false);
          }
        }
      }

      await applyTimelineToStore(timeline);
    } catch (error) {
      debugError("[ClaudeTimelineBridge] Failed to apply timeline:", error);
    }
  });

  // Handle element addition from Claude
  claudeAPI.onAddElement(async (element: Partial<ClaudeElement>) => {
    try {
      debugLog("[ClaudeTimelineBridge] Adding element:", element);

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

      debugWarn(
        "[ClaudeTimelineBridge] Unsupported element type:",
        element.type
      );
    } catch (error) {
      debugError("[ClaudeTimelineBridge] Failed to add element:", error);
    }
  });

  const applyElementChanges = ({
    elementId,
    changes,
    pushHistory,
  }: {
    elementId: string;
    changes: Partial<ClaudeElement>;
    pushHistory: boolean;
  }): boolean => {
    try {
      const timelineStore = useTimelineStore.getState();
      const track = findTrackByElementId(timelineStore.tracks, elementId);
      if (!track) {
        debugWarn(
          "[ClaudeTimelineBridge] Could not find track for element:",
          elementId
        );
        return false;
      }

      const element = track.elements.find(
        (candidate) => candidate.id === elementId
      );
      if (!element) {
        debugWarn(
          "[ClaudeTimelineBridge] Could not find element in resolved track:",
          elementId
        );
        return false;
      }

      if (pushHistory) {
        timelineStore.pushHistory();
      }

      if (typeof changes.startTime === "number") {
        timelineStore.updateElementStartTime(
          track.id,
          elementId,
          changes.startTime,
          false
        );
      }

      if (
        typeof changes.trimStart === "number" ||
        typeof changes.trimEnd === "number"
      ) {
        timelineStore.updateElementTrim(
          track.id,
          elementId,
          changes.trimStart ?? element.trimStart,
          changes.trimEnd ?? element.trimEnd,
          false
        );
      }

      const isMarkdown = element.type === "markdown";
      if (typeof changes.duration === "number" && changes.duration > 0) {
        if (isMarkdown) {
          timelineStore.updateMarkdownElement(
            track.id,
            elementId,
            { duration: changes.duration },
            false
          );
        } else {
          timelineStore.updateElementDuration(
            track.id,
            elementId,
            changes.duration,
            false
          );
        }
      } else if (typeof changes.endTime === "number") {
        const resolvedStart = changes.startTime ?? element.startTime;
        const resolvedDuration = changes.endTime - resolvedStart;
        if (resolvedDuration > 0) {
          if (isMarkdown) {
            timelineStore.updateMarkdownElement(
              track.id,
              elementId,
              { duration: resolvedDuration },
              false
            );
          } else {
            timelineStore.updateElementDuration(
              track.id,
              elementId,
              resolvedDuration,
              false
            );
          }
        }
      }

      if (element.type === "text") {
        const textUpdates: Record<string, unknown> = {};
        if (typeof changes.content === "string") {
          textUpdates.content = changes.content;
        }
        if (changes.style) {
          const style = changes.style;
          if (typeof style.fontSize === "number")
            textUpdates.fontSize = style.fontSize;
          if (typeof style.fontFamily === "string")
            textUpdates.fontFamily = style.fontFamily;
          if (typeof style.color === "string") textUpdates.color = style.color;
          if (typeof style.backgroundColor === "string")
            textUpdates.backgroundColor = style.backgroundColor;
          if (typeof style.textAlign === "string")
            textUpdates.textAlign = style.textAlign;
          if (typeof style.fontWeight === "string")
            textUpdates.fontWeight = style.fontWeight;
          if (typeof style.fontStyle === "string")
            textUpdates.fontStyle = style.fontStyle;
          if (typeof style.textDecoration === "string")
            textUpdates.textDecoration = style.textDecoration;
        }
        if (Object.keys(textUpdates).length > 0) {
          timelineStore.updateTextElement(
            track.id,
            elementId,
            textUpdates,
            false
          );
        }
      }

      if (element.type === "markdown") {
        const markdownUpdates: Record<string, unknown> = {};
        if (typeof changes.content === "string") {
          markdownUpdates.markdownContent = changes.content;
        }
        if (Object.keys(markdownUpdates).length > 0) {
          timelineStore.updateMarkdownElement(
            track.id,
            elementId,
            markdownUpdates,
            false
          );
        }
      }

      if (element.type === "media" && changes.style) {
        const mediaUpdates: Record<string, unknown> = {};
        if (typeof changes.style.volume === "number") {
          mediaUpdates.volume = changes.style.volume;
        }
        if (Object.keys(mediaUpdates).length > 0) {
          timelineStore.updateMediaElement(
            track.id,
            elementId,
            mediaUpdates,
            false
          );
        }
      }

      return true;
    } catch (error) {
      debugError(
        "[ClaudeTimelineBridge] Failed to apply element changes:",
        error
      );
      return false;
    }
  };

  // Handle element update from Claude
  claudeAPI.onUpdateElement(
    (data: { elementId: string; changes: Partial<ClaudeElement> }) => {
      try {
        debugLog("[ClaudeTimelineBridge] Updating element:", data.elementId);
        const updated = applyElementChanges({
          elementId: data.elementId,
          changes: data.changes,
          pushHistory: true,
        });
        if (!updated) {
          return;
        }
        debugLog("[ClaudeTimelineBridge] Updated element:", data.elementId);
      } catch (error) {
        debugError(
          "[ClaudeTimelineBridge] Failed to handle element update:",
          error
        );
      }
    }
  );

  if (
    typeof claudeAPI.onBatchAddElements === "function" &&
    typeof claudeAPI.sendBatchAddElementsResponse === "function"
  ) {
    claudeAPI.onBatchAddElements(
      async (data: {
        requestId: string;
        elements: ClaudeBatchAddElementRequest[];
      }) => {
        const defaultErrorResponse: ClaudeBatchAddResponse = {
          added: [],
          failedCount: data.elements.length,
        };
        try {
          if (data.elements.length > MAX_TIMELINE_BATCH_ITEMS) {
            const message = `Batch add limit is ${MAX_TIMELINE_BATCH_ITEMS} elements`;
            const failedResponse: ClaudeBatchAddResponse = {
              added: data.elements.map((_, index) => ({
                index,
                success: false,
                error: message,
              })),
              failedCount: data.elements.length,
            };
            claudeAPI.sendBatchAddElementsResponse(
              data.requestId,
              failedResponse
            );
            return;
          }

          if (data.elements.length === 0) {
            claudeAPI.sendBatchAddElementsResponse(data.requestId, {
              added: [],
              failedCount: 0,
            });
            return;
          }

          const timelineStore = useTimelineStore.getState();
          const tracksById = new Map(
            timelineStore.tracks.map((track) => [track.id, track])
          );

          for (const element of data.elements) {
            const normalizedType = normalizeClaudeElementType({
              type: element.type,
            });
            if (!normalizedType) {
              throw new Error(`Unsupported element type: ${element.type}`);
            }

            const track = tracksById.get(element.trackId);
            if (!track) {
              throw new Error(`Track not found: ${element.trackId}`);
            }

            if (
              typeof element.startTime !== "number" ||
              Number.isNaN(element.startTime) ||
              element.startTime < 0
            ) {
              throw new Error(
                "Element startTime must be a non-negative number"
              );
            }
            if (
              typeof element.duration !== "number" ||
              Number.isNaN(element.duration) ||
              element.duration <= 0
            ) {
              throw new Error("Element duration must be greater than 0");
            }

            const compatibility = validateElementTrackCompatibility(
              { type: normalizedType },
              { type: track.type }
            );
            if (!compatibility.isValid) {
              throw new Error(
                compatibility.errorMessage || "Track compatibility failed"
              );
            }
          }

          // Sync media from disk so newly-imported files are discoverable
          const projectId = useProjectStore.getState().activeProject?.id;
          if (projectId) {
            await syncProjectMediaIfNeeded({ projectId });
          }

          timelineStore.pushHistory();

          const added: ClaudeBatchAddResponse["added"] = [];
          let failedCount = 0;

          for (const [index, element] of data.elements.entries()) {
            try {
              const normalizedType = normalizeClaudeElementType({
                type: element.type,
              });
              if (!normalizedType) {
                throw new Error(`Unsupported element type: ${element.type}`);
              }

              let createdElementId: string | null = null;

              if (normalizedType === CLAUDE_TRACK_ELEMENT_TYPES.media) {
                const mediaId = resolveMediaIdForBatchElement({ element });
                if (!mediaId) {
                  throw new Error("Media source could not be resolved");
                }

                createdElementId = timelineStore.addElementToTrack(
                  element.trackId,
                  {
                    type: "media",
                    name: element.sourceName || "Media",
                    mediaId,
                    startTime: element.startTime,
                    duration: element.duration,
                    trimStart: 0,
                    trimEnd: 0,
                  },
                  {
                    pushHistory: false,
                    selectElement: false,
                  }
                );
              } else if (normalizedType === CLAUDE_TRACK_ELEMENT_TYPES.text) {
                const style = element.style || {};
                const content =
                  typeof element.content === "string" &&
                  element.content.length > 0
                    ? element.content
                    : "Text";

                createdElementId = timelineStore.addElementToTrack(
                  element.trackId,
                  {
                    type: "text",
                    name: content,
                    content,
                    startTime: element.startTime,
                    duration: element.duration,
                    trimStart: 0,
                    trimEnd: 0,
                    fontSize:
                      typeof style.fontSize === "number" ? style.fontSize : 48,
                    fontFamily:
                      typeof style.fontFamily === "string"
                        ? style.fontFamily
                        : "Inter",
                    color:
                      typeof style.color === "string" ? style.color : "#ffffff",
                    backgroundColor:
                      typeof style.backgroundColor === "string"
                        ? style.backgroundColor
                        : "transparent",
                    textAlign:
                      style.textAlign === "left" ||
                      style.textAlign === "right" ||
                      style.textAlign === "center"
                        ? style.textAlign
                        : "center",
                    fontWeight: style.fontWeight === "bold" ? "bold" : "normal",
                    fontStyle:
                      style.fontStyle === "italic" ? "italic" : "normal",
                    textDecoration:
                      style.textDecoration === "underline" ||
                      style.textDecoration === "line-through"
                        ? style.textDecoration
                        : "none",
                    x: 0.5,
                    y: 0.5,
                    rotation: 0,
                    opacity: 1,
                  },
                  {
                    pushHistory: false,
                    selectElement: false,
                  }
                );
              } else {
                throw new Error(
                  `Unsupported batch add type: ${normalizedType}`
                );
              }

              if (!createdElementId) {
                throw new Error("Failed to create timeline element");
              }

              added.push({
                index,
                success: true,
                elementId: createdElementId,
              });
            } catch (error) {
              failedCount++;
              added.push({
                index,
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
              });
            }
          }

          claudeAPI.sendBatchAddElementsResponse(data.requestId, {
            added,
            failedCount,
          });
        } catch (error) {
          debugError(
            "[ClaudeTimelineBridge] Failed to batch add elements:",
            error
          );
          const errorMessage =
            error instanceof Error ? error.message : "Batch add failed";
          claudeAPI.sendBatchAddElementsResponse(data.requestId, {
            ...defaultErrorResponse,
            added: data.elements.map((_, index) => ({
              index,
              success: false,
              error: errorMessage,
            })),
          });
        }
      }
    );
  }

  if (
    typeof claudeAPI.onBatchUpdateElements === "function" &&
    typeof claudeAPI.sendBatchUpdateElementsResponse === "function"
  ) {
    claudeAPI.onBatchUpdateElements((data) => {
      try {
        if (data.updates.length > MAX_TIMELINE_BATCH_ITEMS) {
          const limitMessage = `Batch update limit is ${MAX_TIMELINE_BATCH_ITEMS} items`;
          const failedResponse: ClaudeBatchUpdateResponse = {
            updatedCount: 0,
            failedCount: data.updates.length,
            results: data.updates.map((_, index) => ({
              index,
              success: false,
              error: limitMessage,
            })),
          };
          claudeAPI.sendBatchUpdateElementsResponse(
            data.requestId,
            failedResponse
          );
          return;
        }

        if (data.updates.length === 0) {
          claudeAPI.sendBatchUpdateElementsResponse(data.requestId, {
            updatedCount: 0,
            failedCount: 0,
            results: [],
          });
          return;
        }

        useTimelineStore.getState().pushHistory();

        const results: ClaudeBatchUpdateResponse["results"] = [];
        let updatedCount = 0;
        let failedCount = 0;

        for (const [index, update] of data.updates.entries()) {
          const success = applyElementChanges({
            elementId: update.elementId,
            changes: update,
            pushHistory: false,
          });
          if (success) {
            updatedCount++;
            results.push({ index, success: true });
            continue;
          }

          failedCount++;
          results.push({
            index,
            success: false,
            error: `Element not found: ${update.elementId}`,
          });
        }

        claudeAPI.sendBatchUpdateElementsResponse(data.requestId, {
          updatedCount,
          failedCount,
          results,
        });
      } catch (error) {
        debugError(
          "[ClaudeTimelineBridge] Failed to batch update elements:",
          error
        );
        const errorMessage =
          error instanceof Error ? error.message : "Batch update failed";
        claudeAPI.sendBatchUpdateElementsResponse(data.requestId, {
          updatedCount: 0,
          failedCount: data.updates.length,
          results: data.updates.map((_, index) => ({
            index,
            success: false,
            error: errorMessage,
          })),
        });
      }
    });
  }

  if (
    typeof claudeAPI.onBatchDeleteElements === "function" &&
    typeof claudeAPI.sendBatchDeleteElementsResponse === "function"
  ) {
    claudeAPI.onBatchDeleteElements((data) => {
      try {
        if (data.elements.length > MAX_TIMELINE_BATCH_ITEMS) {
          const limitMessage = `Batch delete limit is ${MAX_TIMELINE_BATCH_ITEMS} items`;
          const failedResponse: ClaudeBatchDeleteResponse = {
            deletedCount: 0,
            failedCount: data.elements.length,
            results: data.elements.map((_, index) => ({
              index,
              success: false,
              error: limitMessage,
            })),
          };
          claudeAPI.sendBatchDeleteElementsResponse(
            data.requestId,
            failedResponse
          );
          return;
        }

        if (data.elements.length === 0) {
          claudeAPI.sendBatchDeleteElementsResponse(data.requestId, {
            deletedCount: 0,
            failedCount: 0,
            results: [],
          });
          return;
        }

        const timelineStore = useTimelineStore.getState();
        timelineStore.pushHistory();

        let deletedCount = 0;
        let failedCount = 0;
        const results: ClaudeBatchDeleteResponse["results"] = [];

        for (const [index, entry] of data.elements.entries()) {
          try {
            const currentTrack = useTimelineStore
              .getState()
              .tracks.find((track) => track.id === entry.trackId);
            const elementExists = currentTrack?.elements.some(
              (element) => element.id === entry.elementId
            );

            if (!elementExists) {
              throw new Error(`Element not found: ${entry.elementId}`);
            }

            if (data.ripple) {
              timelineStore.removeElementFromTrackWithRipple(
                entry.trackId,
                entry.elementId,
                false,
                true
              );
            } else {
              timelineStore.removeElementFromTrack(
                entry.trackId,
                entry.elementId,
                false
              );
            }
            deletedCount++;
            results.push({ index, success: true });
          } catch (error) {
            failedCount++;
            results.push({
              index,
              success: false,
              error: error instanceof Error ? error.message : "Delete failed",
            });
          }
        }

        claudeAPI.sendBatchDeleteElementsResponse(data.requestId, {
          deletedCount,
          failedCount,
          results,
        });
      } catch (error) {
        debugError(
          "[ClaudeTimelineBridge] Failed to batch delete elements:",
          error
        );
        const errorMessage =
          error instanceof Error ? error.message : "Batch delete failed";
        claudeAPI.sendBatchDeleteElementsResponse(data.requestId, {
          deletedCount: 0,
          failedCount: data.elements.length,
          results: data.elements.map((_, index) => ({
            index,
            success: false,
            error: errorMessage,
          })),
        });
      }
    });
  }

  if (
    typeof claudeAPI.onArrange === "function" &&
    typeof claudeAPI.sendArrangeResponse === "function"
  ) {
    claudeAPI.onArrange((data) => {
      try {
        const timelineStore = useTimelineStore.getState();
        const track = timelineStore.tracks.find(
          (candidate) => candidate.id === data.request.trackId
        );

        if (!track || track.elements.length === 0) {
          claudeAPI.sendArrangeResponse(data.requestId, { arranged: [] });
          return;
        }

        const requestMode = data.request.mode;
        const startOffset =
          typeof data.request.startOffset === "number" &&
          data.request.startOffset >= 0
            ? data.request.startOffset
            : 0;
        const gap =
          typeof data.request.gap === "number" && data.request.gap >= 0
            ? data.request.gap
            : requestMode === "spaced"
              ? 0.5
              : 0;

        const byStartTime = [...track.elements].sort(
          (left, right) => left.startTime - right.startTime
        );

        let orderedElements = byStartTime;
        if (requestMode === "manual" && data.request.order?.length) {
          const elementsById = new Map(
            byStartTime.map((element) => [element.id, element])
          );
          const manualOrder: typeof byStartTime = [];

          for (const elementId of data.request.order) {
            const element = elementsById.get(elementId);
            if (!element) {
              continue;
            }
            manualOrder.push(element);
            elementsById.delete(elementId);
          }

          orderedElements = [...manualOrder, ...elementsById.values()];
        }

        timelineStore.pushHistory();

        const arranged: ClaudeArrangeResponse["arranged"] = [];
        let currentStartTime = startOffset;
        for (const element of orderedElements) {
          const effectiveDuration = Math.max(
            0,
            element.duration - element.trimStart - element.trimEnd
          );

          timelineStore.updateElementStartTime(
            track.id,
            element.id,
            currentStartTime,
            false
          );
          arranged.push({
            elementId: element.id,
            newStartTime: currentStartTime,
          });
          currentStartTime += effectiveDuration + gap;
        }

        claudeAPI.sendArrangeResponse(data.requestId, { arranged });
      } catch (error) {
        debugError("[ClaudeTimelineBridge] Failed to arrange track:", error);
        claudeAPI.sendArrangeResponse(data.requestId, { arranged: [] });
      }
    });
  }

  // Handle element removal
  claudeAPI.onRemoveElement((elementId: string) => {
    try {
      debugLog("[ClaudeTimelineBridge] Removing element:", elementId);
      const timelineStore = useTimelineStore.getState();
      const tracks = timelineStore.tracks;

      const track = findTrackByElementId(tracks, elementId);
      if (track) {
        timelineStore.removeElementFromTrack(track.id, elementId);
        return;
      }

      debugWarn(
        "[ClaudeTimelineBridge] Could not find track for element:",
        elementId
      );
    } catch (error) {
      debugError(
        "[ClaudeTimelineBridge] Failed to handle element removal:",
        error
      );
    }
  });

  // Handle element split (request-response: returns secondElementId)
  claudeAPI.onSplitElement(
    (data: {
      requestId: string;
      elementId: string;
      splitTime: number;
      mode: "split" | "keepLeft" | "keepRight";
    }) => {
      try {
        debugLog(
          "[ClaudeTimelineBridge] Splitting element:",
          data.elementId,
          "at",
          data.splitTime,
          "mode:",
          data.mode
        );
        const timelineStore = useTimelineStore.getState();
        const track = findTrackByElementId(
          timelineStore.tracks,
          data.elementId
        );

        if (!track) {
          debugWarn(
            "[ClaudeTimelineBridge] Could not find track for element:",
            data.elementId
          );
          claudeAPI.sendSplitResponse(data.requestId, {
            secondElementId: null,
          });
          return;
        }

        let secondElementId: string | null = null;
        if (data.mode === "keepLeft") {
          timelineStore.splitAndKeepLeft(
            track.id,
            data.elementId,
            data.splitTime
          );
        } else if (data.mode === "keepRight") {
          timelineStore.splitAndKeepRight(
            track.id,
            data.elementId,
            data.splitTime
          );
        } else {
          secondElementId = timelineStore.splitElement(
            track.id,
            data.elementId,
            data.splitTime
          );
        }

        claudeAPI.sendSplitResponse(data.requestId, { secondElementId });
        debugLog("[ClaudeTimelineBridge] Split complete:", { secondElementId });
      } catch (error) {
        debugError("[ClaudeTimelineBridge] Failed to split element:", error);
        claudeAPI.sendSplitResponse(data.requestId, {
          secondElementId: null,
        });
      }
    }
  );

  // Handle element move (fire-and-forget)
  claudeAPI.onMoveElement(
    (data: { elementId: string; toTrackId: string; newStartTime?: number }) => {
      try {
        debugLog(
          "[ClaudeTimelineBridge] Moving element:",
          data.elementId,
          "to track:",
          data.toTrackId
        );
        const timelineStore = useTimelineStore.getState();
        const fromTrack = findTrackByElementId(
          timelineStore.tracks,
          data.elementId
        );

        if (!fromTrack) {
          debugWarn(
            "[ClaudeTimelineBridge] Could not find track for element:",
            data.elementId
          );
          return;
        }

        timelineStore.moveElementToTrack(
          fromTrack.id,
          data.toTrackId,
          data.elementId
        );

        if (typeof data.newStartTime === "number") {
          useTimelineStore
            .getState()
            .updateElementStartTime(
              data.toTrackId,
              data.elementId,
              data.newStartTime
            );
        }

        debugLog("[ClaudeTimelineBridge] Move complete:", data.elementId);
      } catch (error) {
        debugError("[ClaudeTimelineBridge] Failed to move element:", error);
      }
    }
  );

  // Handle selection set (fire-and-forget)
  claudeAPI.onSelectElements(
    (data: { elements: Array<{ trackId: string; elementId: string }> }) => {
      try {
        debugLog(
          "[ClaudeTimelineBridge] Setting selection:",
          data.elements.length,
          "elements"
        );
        const timelineStore = useTimelineStore.getState();
        timelineStore.clearSelectedElements();
        for (const el of data.elements) {
          useTimelineStore
            .getState()
            .selectElement(el.trackId, el.elementId, true);
        }
      } catch (error) {
        debugError("[ClaudeTimelineBridge] Failed to set selection:", error);
      }
    }
  );

  // Handle get selection (request-response)
  claudeAPI.onGetSelection((data: { requestId: string }) => {
    try {
      const { selectedElements } = useTimelineStore.getState();
      claudeAPI.sendSelectionResponse(data.requestId, selectedElements);
    } catch (error) {
      debugError("[ClaudeTimelineBridge] Failed to get selection:", error);
      claudeAPI.sendSelectionResponse(data.requestId, []);
    }
  });

  // Handle clear selection (fire-and-forget)
  claudeAPI.onClearSelection(() => {
    try {
      debugLog("[ClaudeTimelineBridge] Clearing selection");
      useTimelineStore.getState().clearSelectedElements();
    } catch (error) {
      debugError("[ClaudeTimelineBridge] Failed to clear selection:", error);
    }
  });

  // Handle batch cuts (request-response: removes multiple time ranges from an element)
  claudeAPI.onExecuteCuts(
    (data: {
      requestId: string;
      elementId: string;
      cuts: Array<{ start: number; end: number }>;
      ripple: boolean;
    }) => {
      const emptyResult = {
        cutsApplied: 0,
        elementsRemoved: 0,
        remainingElements: [] as Array<{
          id: string;
          startTime: number;
          duration: number;
        }>,
        totalRemovedDuration: 0,
      };

      try {
        debugLog(
          "[ClaudeTimelineBridge] Batch cuts:",
          data.cuts.length,
          "on element:",
          data.elementId
        );
        const timelineStore = useTimelineStore.getState();
        const track = findTrackByElementId(
          timelineStore.tracks,
          data.elementId
        );

        if (!track) {
          debugWarn(
            "[ClaudeTimelineBridge] Could not find track for element:",
            data.elementId
          );
          claudeAPI.sendExecuteCutsResponse(data.requestId, emptyResult);
          return;
        }

        // Push history ONCE for atomic undo
        timelineStore.pushHistory();

        // Sort cuts descending by start — process from end to avoid offset drift
        const sortedCuts = [...data.cuts].sort((a, b) => b.start - a.start);

        let cutsApplied = 0;
        let elementsRemoved = 0;
        let totalRemovedDuration = 0;

        for (const cut of sortedCuts) {
          const currentTracks = useTimelineStore.getState().tracks;
          const currentTrack = currentTracks.find((t) => t.id === track.id);
          if (!currentTrack) break;

          // Find element that contains this cut range
          const targetElement = currentTrack.elements.find((el) => {
            const elStart = el.startTime;
            const elEnd =
              el.startTime + (el.duration - el.trimStart - el.trimEnd);
            return elStart < cut.end && elEnd > cut.start;
          });

          if (!targetElement) continue;

          const effStart = targetElement.startTime;
          const effEnd =
            targetElement.startTime +
            (targetElement.duration -
              targetElement.trimStart -
              targetElement.trimEnd);

          const clampedStart = Math.max(cut.start, effStart);
          const clampedEnd = Math.min(cut.end, effEnd);
          if (clampedStart >= clampedEnd) continue;

          const store = useTimelineStore.getState();

          // Cut covers entire element → remove
          if (clampedStart <= effStart && clampedEnd >= effEnd) {
            store.removeElementFromTrack(track.id, targetElement.id, false);
            elementsRemoved++;
            totalRemovedDuration += effEnd - effStart;
            cutsApplied++;
            continue;
          }

          // Cut at end → keepLeft
          if (clampedEnd >= effEnd) {
            store.splitAndKeepLeft(
              track.id,
              targetElement.id,
              clampedStart,
              false
            );
            totalRemovedDuration += effEnd - clampedStart;
            cutsApplied++;
            continue;
          }

          // Cut at start → keepRight
          if (clampedStart <= effStart) {
            store.splitAndKeepRight(
              track.id,
              targetElement.id,
              clampedEnd,
              false
            );
            totalRemovedDuration += clampedEnd - effStart;
            cutsApplied++;
            continue;
          }

          // Cut in middle → split at start, split at end, remove middle
          const rightId = store.splitElement(
            track.id,
            targetElement.id,
            clampedStart,
            false
          );
          if (rightId) {
            const tailId = useTimelineStore
              .getState()
              .splitElement(track.id, rightId, clampedEnd, false);
            if (tailId) {
              useTimelineStore
                .getState()
                .removeElementFromTrack(track.id, rightId, false);
              elementsRemoved++;
            }
          }
          totalRemovedDuration += clampedEnd - clampedStart;
          cutsApplied++;
        }

        // Build remaining elements list
        const finalTracks = useTimelineStore.getState().tracks;
        const finalTrack = finalTracks.find((t) => t.id === track.id);
        const remainingElements = (finalTrack?.elements ?? []).map((el) => ({
          id: el.id,
          startTime: el.startTime,
          duration: el.duration - el.trimStart - el.trimEnd,
        }));

        claudeAPI.sendExecuteCutsResponse(data.requestId, {
          cutsApplied,
          elementsRemoved,
          remainingElements,
          totalRemovedDuration: Math.round(totalRemovedDuration * 100) / 100,
        });
      } catch (error) {
        debugError(
          "[ClaudeTimelineBridge] Failed to execute batch cuts:",
          error
        );
        claudeAPI.sendExecuteCutsResponse(data.requestId, emptyResult);
      }
    }
  );

  // Handle range delete (request-response: removes content in a time range)
  claudeAPI.onDeleteRange(
    (data: {
      requestId: string;
      request: {
        startTime: number;
        endTime: number;
        trackIds?: string[];
        ripple?: boolean;
        crossTrackRipple?: boolean;
      };
    }) => {
      const emptyResult = {
        deletedElements: 0,
        splitElements: 0,
        totalRemovedDuration: 0,
      };

      try {
        const { startTime, endTime, trackIds, ripple, crossTrackRipple } =
          data.request;
        debugLog(
          "[ClaudeTimelineBridge] Range delete:",
          startTime,
          "to",
          endTime,
          "ripple:",
          ripple,
          "crossTrackRipple:",
          crossTrackRipple
        );

        const result = useTimelineStore.getState().deleteTimeRange({
          startTime,
          endTime,
          trackIds,
          ripple: ripple ?? true,
          crossTrackRipple: crossTrackRipple ?? false,
        });

        claudeAPI.sendDeleteRangeResponse(data.requestId, result);
      } catch (error) {
        debugError(
          "[ClaudeTimelineBridge] Failed to execute range delete:",
          error
        );
        claudeAPI.sendDeleteRangeResponse(data.requestId, emptyResult);
      }
    }
  );

  debugLog("[ClaudeTimelineBridge] Bridge setup complete");
}

/**
 * Cleanup bridge listeners
 */
export function cleanupClaudeTimelineBridge(): void {
  if (window.electronAPI?.claude?.timeline?.removeListeners) {
    window.electronAPI.claude.timeline.removeListeners();
  }
  debugLog("[ClaudeTimelineBridge] Bridge cleanup complete");
}

/**
 * Setup Claude Project Bridge (for stats requests)
 */
export function setupClaudeProjectBridge(): void {
  if (!window.electronAPI?.claude?.project) {
    return;
  }

  const projectAPI = window.electronAPI.claude.project;

  // Respond to stats request (must forward requestId for main process matching)
  projectAPI.onStatsRequest((_projectId: string, requestId: string) => {
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

    projectAPI.sendStatsResponse(stats, requestId);
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
