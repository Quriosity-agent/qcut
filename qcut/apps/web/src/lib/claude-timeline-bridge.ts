/**
 * Claude Timeline Bridge
 * Connects Electron main process Claude API with renderer's Zustand stores.
 * Helper functions are in claude-timeline-bridge-helpers.ts.
 */

import { useTimelineStore } from "@/stores/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { useMediaStore } from "@/stores/media-store";
import type {
  ClaudeTimeline,
  ClaudeElement,
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
} from "./claude-timeline-bridge-helpers";

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
  claudeAPI.onApply(async (timeline: ClaudeTimeline) => {
    try {
      debugLog(
        "[ClaudeTimelineBridge] Received timeline to apply:",
        timeline.name
      );
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

  // Handle element update from Claude
  claudeAPI.onUpdateElement(
    (data: { elementId: string; changes: Partial<ClaudeElement> }) => {
      try {
        debugLog("[ClaudeTimelineBridge] Updating element:", data.elementId);

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
          return;
        }

        const element = track.elements.find((e) => e.id === data.elementId);
        if (!element) {
          return;
        }

        const { changes } = data;

        // Update start time
        if (typeof changes.startTime === "number") {
          timelineStore.updateElementStartTime(
            track.id,
            data.elementId,
            changes.startTime
          );
        }

        // Update duration (from explicit duration or endTime - startTime)
        // Markdown elements route through updateMarkdownElement for clamping
        const isMarkdown = element.type === "markdown";

        if (typeof changes.duration === "number" && changes.duration > 0) {
          if (isMarkdown) {
            timelineStore.updateMarkdownElement(track.id, data.elementId, {
              duration: changes.duration,
            });
          } else {
            timelineStore.updateElementDuration(
              track.id,
              data.elementId,
              changes.duration
            );
          }
        } else if (typeof changes.endTime === "number") {
          const start = changes.startTime ?? element.startTime;
          const newDuration = changes.endTime - start;
          if (newDuration > 0) {
            if (isMarkdown) {
              timelineStore.updateMarkdownElement(track.id, data.elementId, {
                duration: newDuration,
              });
            } else {
              timelineStore.updateElementDuration(
                track.id,
                data.elementId,
                newDuration
              );
            }
          }
        }

        // Update type-specific properties
        if (element.type === "text") {
          const textUpdates: Record<string, unknown> = {};
          if (typeof changes.content === "string") {
            textUpdates.content = changes.content;
          }
          if (changes.style) {
            const s = changes.style;
            if (typeof s.fontSize === "number")
              textUpdates.fontSize = s.fontSize;
            if (typeof s.fontFamily === "string")
              textUpdates.fontFamily = s.fontFamily;
            if (typeof s.color === "string") textUpdates.color = s.color;
            if (typeof s.backgroundColor === "string")
              textUpdates.backgroundColor = s.backgroundColor;
            if (typeof s.textAlign === "string")
              textUpdates.textAlign = s.textAlign;
            if (typeof s.fontWeight === "string")
              textUpdates.fontWeight = s.fontWeight;
            if (typeof s.fontStyle === "string")
              textUpdates.fontStyle = s.fontStyle;
            if (typeof s.textDecoration === "string")
              textUpdates.textDecoration = s.textDecoration;
          }
          if (Object.keys(textUpdates).length > 0) {
            timelineStore.updateTextElement(
              track.id,
              data.elementId,
              textUpdates
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
              data.elementId,
              markdownUpdates
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
              data.elementId,
              mediaUpdates
            );
          }
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
