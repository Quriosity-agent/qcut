/**
 * Timeline Store Operations
 *
 * Heavy operations extracted from timeline-store.ts for maintainability.
 * Contains ripple editing, split, audio/media, drag, add-at-time, and effects operations.
 *
 * Uses dependency injection to access store closure helpers (updateTracks, updateTracksAndSave, etc.)
 * without creating circular imports.
 *
 * @module stores/timeline-store-operations
 */

import type {
  TimelineTrack,
  TimelineElement,
  TextElement,
  DragData,
} from "@/types/timeline";
import type { MediaItem } from "./media-store";
import type { TimelineStore, DragState } from "./timeline";
import { INITIAL_DRAG_STATE, getElementNameWithSuffix } from "./timeline";
import { generateUUID } from "@/lib/utils";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { toast } from "sonner";
import { checkElementOverlaps, resolveElementOverlaps } from "@/lib/timeline";
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";
import { createObjectURL } from "@/lib/blob-manager";

/**
 * Dependencies injected from the store closure.
 * These are module-level helpers not accessible via get().
 */
interface OperationDeps {
  updateTracks: (tracks: TimelineTrack[]) => void;
  updateTracksAndSave: (tracks: TimelineTrack[]) => void;
  autoSaveTimeline: () => void;
}

type StoreGet = () => TimelineStore;
type StoreSet = (
  partial:
    | Partial<TimelineStore>
    | ((state: TimelineStore) => Partial<TimelineStore>)
) => void;

/**
 * Creates all heavy timeline operations with injected dependencies.
 * The returned object is spread into the Zustand store.
 */
export function createTimelineOperations({
  get,
  set,
  deps,
}: {
  get: StoreGet;
  set: StoreSet;
  deps: OperationDeps;
}) {
  const { updateTracks, updateTracksAndSave, autoSaveTimeline } = deps;

  return {
    // -----------------------------------------------------------------------
    // Ripple deletion
    // -----------------------------------------------------------------------

    removeTrack: (trackId: string) => {
      const { rippleEditingEnabled, selectedElements } = get();

      if (rippleEditingEnabled) {
        get().removeTrackWithRipple(trackId);
      } else {
        get().pushHistory();

        // Clear selection for elements on the removed track to avoid dangling references
        for (const sel of selectedElements) {
          if (sel.trackId === trackId) {
            get().deselectElement(sel.trackId, sel.elementId);
          }
        }

        updateTracksAndSave(
          get()._tracks.filter((track) => track.id !== trackId)
        );
      }
    },

    removeTrackWithRipple: (trackId: string) => {
      const { _tracks, selectedElements } = get();
      const trackToRemove = _tracks.find((t) => t.id === trackId);

      if (!trackToRemove) return;

      get().pushHistory();

      // Clear selection for elements on the removed track to avoid dangling references
      for (const sel of selectedElements) {
        if (sel.trackId === trackId) {
          get().deselectElement(sel.trackId, sel.elementId);
        }
      }

      // If track has no elements, just remove it normally
      if (trackToRemove.elements.length === 0) {
        updateTracksAndSave(_tracks.filter((track) => track.id !== trackId));
        return;
      }

      // Find all the time ranges occupied by elements in the track being removed
      const occupiedRanges = trackToRemove.elements.map((element) => ({
        startTime: element.startTime,
        endTime:
          element.startTime +
          (element.duration - element.trimStart - element.trimEnd),
      }));

      // Sort ranges by start time
      occupiedRanges.sort((a, b) => a.startTime - b.startTime);

      // Merge overlapping ranges to get consolidated gaps
      const mergedRanges: Array<{
        startTime: number;
        endTime: number;
        duration: number;
      }> = [];

      for (const range of occupiedRanges) {
        if (mergedRanges.length === 0) {
          mergedRanges.push({
            startTime: range.startTime,
            endTime: range.endTime,
            duration: range.endTime - range.startTime,
          });
        } else {
          const lastRange = mergedRanges[mergedRanges.length - 1];
          if (range.startTime <= lastRange.endTime) {
            // Overlapping or adjacent ranges, merge them
            lastRange.endTime = Math.max(lastRange.endTime, range.endTime);
            lastRange.duration = lastRange.endTime - lastRange.startTime;
          } else {
            // Non-overlapping range, add as new
            mergedRanges.push({
              startTime: range.startTime,
              endTime: range.endTime,
              duration: range.endTime - range.startTime,
            });
          }
        }
      }

      // Remove the track and apply ripple effects to remaining tracks
      const updatedTracks = _tracks
        .filter((track) => track.id !== trackId)
        .map((track) => {
          const updatedElements = track.elements.map((element) => {
            let newStartTime = element.startTime;

            // Process gaps from right to left (latest to earliest) to avoid cumulative shifts
            for (let i = mergedRanges.length - 1; i >= 0; i--) {
              const gap = mergedRanges[i];
              // If this element starts after the gap, shift it left by the gap duration
              if (newStartTime >= gap.endTime) {
                newStartTime -= gap.duration;
              }
            }

            return {
              ...element,
              startTime: Math.max(0, newStartTime),
            };
          });

          // Check for overlaps and resolve them if necessary
          const hasOverlaps = checkElementOverlaps(updatedElements);
          if (hasOverlaps) {
            const resolvedElements = resolveElementOverlaps(updatedElements);
            return { ...track, elements: resolvedElements };
          }

          return { ...track, elements: updatedElements };
        });

      updateTracksAndSave(updatedTracks);
    },

    // -----------------------------------------------------------------------
    // Ripple element removal
    // -----------------------------------------------------------------------

    removeElementFromTrackWithRipple: (
      trackId: string,
      elementId: string,
      pushHistory = true
    ) => {
      const { _tracks, rippleEditingEnabled } = get();

      if (!rippleEditingEnabled) {
        // If ripple editing is disabled, use regular removal
        get().removeElementFromTrack(trackId, elementId, pushHistory);
        return;
      }

      const track = _tracks.find((t) => t.id === trackId);
      const element = track?.elements.find((e) => e.id === elementId);

      if (!element || !track) return;

      if (pushHistory) get().pushHistory();

      const elementStartTime = element.startTime;
      const elementDuration =
        element.duration - element.trimStart - element.trimEnd;
      const elementEndTime = elementStartTime + elementDuration;

      // Remove the element and shift all elements that come after it
      const updatedTracks = _tracks
        .map((currentTrack) => {
          // Only apply ripple effects to the same track unless multi-track ripple is enabled
          const shouldApplyRipple = currentTrack.id === trackId;

          const updatedElements = currentTrack.elements
            .filter((currentElement) => {
              // Remove the target element
              if (
                currentElement.id === elementId &&
                currentTrack.id === trackId
              ) {
                return false;
              }
              return true;
            })
            .map((currentElement) => {
              // Only apply ripple effects if we should process this track
              if (!shouldApplyRipple) {
                return currentElement;
              }

              // Shift elements that start after the removed element
              if (currentElement.startTime >= elementEndTime) {
                return {
                  ...currentElement,
                  startTime: Math.max(
                    0,
                    currentElement.startTime - elementDuration
                  ),
                };
              }
              return currentElement;
            });

          // Check for overlaps and resolve them if necessary
          const hasOverlaps = checkElementOverlaps(updatedElements);
          if (hasOverlaps) {
            // Resolve overlaps by adjusting element positions
            const resolvedElements = resolveElementOverlaps(updatedElements);
            return { ...currentTrack, elements: resolvedElements };
          }

          return { ...currentTrack, elements: updatedElements };
        })
        .filter((track) => track.elements.length > 0 || track.isMain);

      updateTracksAndSave(updatedTracks);
    },

    // -----------------------------------------------------------------------
    // Ripple start time
    // -----------------------------------------------------------------------

    updateElementStartTimeWithRipple: (
      trackId: string,
      elementId: string,
      newStartTime: number
    ) => {
      const { _tracks, rippleEditingEnabled } = get();
      const clampedNewStartTime = Math.max(0, newStartTime);

      if (!rippleEditingEnabled) {
        // If ripple editing is disabled, use regular update
        get().updateElementStartTime(trackId, elementId, clampedNewStartTime);
        return;
      }

      const track = _tracks.find((t) => t.id === trackId);
      const element = track?.elements.find((e) => e.id === elementId);

      if (!element || !track) return;

      get().pushHistory();

      const oldStartTime = element.startTime;
      const oldEndTime =
        element.startTime +
        (element.duration - element.trimStart - element.trimEnd);
      const newEndTime =
        clampedNewStartTime +
        (element.duration - element.trimStart - element.trimEnd);
      const timeDelta = clampedNewStartTime - oldStartTime;

      // Update tracks based on multi-track ripple setting
      const updatedTracks = _tracks.map((currentTrack) => {
        // Only apply ripple effects to the same track unless multi-track ripple is enabled
        const shouldApplyRipple = currentTrack.id === trackId;

        const updatedElements = currentTrack.elements.map((currentElement) => {
          if (currentElement.id === elementId && currentTrack.id === trackId) {
            return { ...currentElement, startTime: clampedNewStartTime };
          }

          // Only apply ripple effects if we should process this track
          if (!shouldApplyRipple) {
            return currentElement;
          }

          // For ripple editing, we need to move elements that come after the moved element
          const currentElementStart = currentElement.startTime;

          // If moving element to the right (positive delta)
          if (timeDelta > 0) {
            // Move elements that start after the original position of the moved element
            if (currentElementStart >= oldEndTime) {
              return {
                ...currentElement,
                startTime: currentElementStart + timeDelta,
              };
            }
          }
          // If moving element to the left (negative delta)
          else if (timeDelta < 0) {
            // Move elements that start after the new position of the moved element
            if (
              currentElementStart >= newEndTime &&
              currentElementStart >= oldStartTime
            ) {
              return {
                ...currentElement,
                startTime: Math.max(0, currentElementStart + timeDelta),
              };
            }
          }

          return currentElement;
        });

        // Check for overlaps and resolve them if necessary
        const hasOverlaps = checkElementOverlaps(updatedElements);
        if (hasOverlaps) {
          // Resolve overlaps by adjusting element positions
          const resolvedElements = resolveElementOverlaps(updatedElements);
          return { ...currentTrack, elements: resolvedElements };
        }

        return { ...currentTrack, elements: updatedElements };
      });

      updateTracksAndSave(updatedTracks);
    },

    // -----------------------------------------------------------------------
    // Split operations
    // -----------------------------------------------------------------------

    splitElement: (
      trackId: string,
      elementId: string,
      splitTime: number
    ): string | null => {
      const { _tracks } = get();
      const track = _tracks.find((t) => t.id === trackId);
      const element = track?.elements.find((c) => c.id === elementId);

      if (!element) return null;

      const effectiveStart = element.startTime;
      const effectiveEnd =
        element.startTime +
        (element.duration - element.trimStart - element.trimEnd);

      if (splitTime <= effectiveStart || splitTime >= effectiveEnd) return null;

      get().pushHistory();

      const relativeTime = splitTime - element.startTime;
      const firstDuration = relativeTime;
      const secondDuration =
        element.duration - element.trimStart - element.trimEnd - relativeTime;

      const secondElementId = generateUUID();

      const leftPart = {
        ...element,
        trimEnd: element.trimEnd + secondDuration,
        name: getElementNameWithSuffix(element.name, "left"),
      };

      const rightPart = {
        ...element,
        id: secondElementId,
        startTime: splitTime,
        trimStart: element.trimStart + firstDuration,
        name: getElementNameWithSuffix(element.name, "right"),
      };

      updateTracksAndSave(
        get()._tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                elements: track.elements.flatMap((c) =>
                  c.id === elementId ? [leftPart, rightPart] : [c]
                ),
              }
            : track
        )
      );

      return secondElementId;
    },

    // Split element and keep only the left portion
    splitAndKeepLeft: (
      trackId: string,
      elementId: string,
      splitTime: number
    ) => {
      const { _tracks } = get();
      const track = _tracks.find((t) => t.id === trackId);
      const element = track?.elements.find((c) => c.id === elementId);

      if (!element) return;

      const effectiveStart = element.startTime;
      const effectiveEnd =
        element.startTime +
        (element.duration - element.trimStart - element.trimEnd);

      if (splitTime <= effectiveStart || splitTime >= effectiveEnd) return;

      get().pushHistory();

      const relativeTime = splitTime - element.startTime;
      const durationToRemove =
        element.duration - element.trimStart - element.trimEnd - relativeTime;

      updateTracksAndSave(
        get()._tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                elements: track.elements.map((c) =>
                  c.id === elementId
                    ? {
                        ...c,
                        trimEnd: c.trimEnd + durationToRemove,
                        name: getElementNameWithSuffix(c.name, "left"),
                      }
                    : c
                ),
              }
            : track
        )
      );
    },

    // Split element and keep only the right portion
    splitAndKeepRight: (
      trackId: string,
      elementId: string,
      splitTime: number
    ) => {
      const { _tracks } = get();
      const track = _tracks.find((t) => t.id === trackId);
      const element = track?.elements.find((c) => c.id === elementId);

      if (!element) return;

      const effectiveStart = element.startTime;
      const effectiveEnd =
        element.startTime +
        (element.duration - element.trimStart - element.trimEnd);

      if (splitTime <= effectiveStart || splitTime >= effectiveEnd) return;

      get().pushHistory();

      const relativeTime = splitTime - element.startTime;

      updateTracksAndSave(
        get()._tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                elements: track.elements.map((c) =>
                  c.id === elementId
                    ? {
                        ...c,
                        startTime: splitTime,
                        trimStart: c.trimStart + relativeTime,
                        name: getElementNameWithSuffix(c.name, "right"),
                      }
                    : c
                ),
              }
            : track
        )
      );
    },

    // -----------------------------------------------------------------------
    // Audio & media operations
    // -----------------------------------------------------------------------

    // Get all audio elements for export
    getAudioElements: (): Array<{
      element: TimelineElement;
      trackId: string;
      absoluteStart: number;
    }> => {
      const { tracks } = get();
      const audioElements: Array<{
        element: TimelineElement;
        trackId: string;
        absoluteStart: number;
      }> = [];
      for (const track of tracks) {
        if (track.type === "audio" || track.type === "media") {
          for (const element of track.elements) {
            // Only media elements carry audio
            if (element.type === "media") {
              audioElements.push({
                element,
                trackId: track.id,
                absoluteStart: element.startTime,
              });
            }
          }
        }
      }
      return audioElements;
    },

    // Extract audio from video element to an audio track
    separateAudio: (trackId: string, elementId: string): string | null => {
      const { _tracks } = get();
      const track = _tracks.find((t) => t.id === trackId);
      const element = track?.elements.find((c) => c.id === elementId);

      if (!element || track?.type !== "media") return null;

      get().pushHistory();

      // Find existing audio track or prepare to create one
      const existingAudioTrack = _tracks.find((t) => t.type === "audio");
      const audioElementId = generateUUID();

      if (existingAudioTrack) {
        // Add audio element to existing audio track
        updateTracksAndSave(
          get()._tracks.map((track) =>
            track.id === existingAudioTrack.id
              ? {
                  ...track,
                  elements: [
                    ...track.elements,
                    {
                      ...element,
                      id: audioElementId,
                      name: getElementNameWithSuffix(element.name, "audio"),
                    },
                  ],
                }
              : track
          )
        );
      } else {
        // Create new audio track with the audio element in a single atomic update
        const newAudioTrack: TimelineTrack = {
          id: generateUUID(),
          name: "Audio Track",
          type: "audio",
          elements: [
            {
              ...element,
              id: audioElementId,
              name: getElementNameWithSuffix(element.name, "audio"),
            },
          ],
          muted: false,
        };

        updateTracksAndSave([...get()._tracks, newAudioTrack]);
      }

      return audioElementId;
    },

    // Replace media for an element
    replaceElementMedia: async (
      trackId: string,
      elementId: string,
      newFile: File
    ): Promise<{ success: boolean; error?: string }> => {
      const { _tracks } = get();
      const track = _tracks.find((t) => t.id === trackId);
      const element = track?.elements.find((c) => c.id === elementId);

      if (!element) {
        return { success: false, error: "Timeline element not found" };
      }

      if (element.type !== "media") {
        return {
          success: false,
          error: "Replace is only available for media clips",
        };
      }

      try {
        const { useMediaStore } = await import("./media-store");
        const mediaStore = useMediaStore.getState();
        const { useProjectStore } = await import("./project-store");
        const projectStore = useProjectStore.getState();

        if (!projectStore.activeProject) {
          return { success: false, error: "No active project found" };
        }

        // Import required media processing functions
        const {
          getFileType,
          getImageDimensions,
          generateVideoThumbnail,
          getMediaDuration,
        } = await import("./media-store-loader").then((m) =>
          m.getMediaStoreUtils()
        );

        const fileType = getFileType(newFile);
        if (!fileType) {
          return {
            success: false,
            error:
              "Unsupported file type. Please select a video, audio, or image file.",
          };
        }

        // Process the new media file
        const mediaData: {
          name: string;
          type: string;
          file: File;
          url: string;
          width?: number;
          height?: number;
          duration?: number;
          thumbnailUrl?: string;
        } = {
          name: newFile.name,
          type: fileType,
          file: newFile,
          url: createObjectURL(newFile, "timeline-add-media"),
        };

        try {
          // Get media-specific metadata
          if (fileType === "image") {
            const { width, height } = await getImageDimensions(newFile);
            mediaData.width = width;
            mediaData.height = height;
          } else if (fileType === "video") {
            const [duration, { thumbnailUrl, width, height }] =
              await Promise.all([
                getMediaDuration(newFile),
                generateVideoThumbnail(newFile),
              ]);
            mediaData.duration = duration;
            mediaData.thumbnailUrl = thumbnailUrl;
            mediaData.width = width;
            mediaData.height = height;
          } else if (fileType === "audio") {
            mediaData.duration = await getMediaDuration(newFile);
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to process ${fileType} file: ${error instanceof Error ? error.message : "Unknown error"}`,
          };
        }

        // Add new media item to store
        let newMediaItemId: string;
        try {
          newMediaItemId = await mediaStore.addMediaItem(
            projectStore.activeProject.id,
            mediaData
          );
        } catch (error) {
          return {
            success: false,
            error: `Failed to add media to project: ${error instanceof Error ? error.message : "Unknown error"}`,
          };
        }

        // Find the newly created media item using the returned ID
        const newMediaItem = mediaStore.mediaItems.find(
          (item) => item.id === newMediaItemId
        );

        if (!newMediaItem) {
          return {
            success: false,
            error: "Failed to create media item in project. Please try again.",
          };
        }

        get().pushHistory();

        // Update the timeline element to reference the new media
        updateTracksAndSave(
          _tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  elements: track.elements.map((c) =>
                    c.id === elementId
                      ? {
                          ...c,
                          mediaId: newMediaItem.id,
                          name: newMediaItem.name,
                          // Update duration if the new media has a different duration
                          duration: newMediaItem.duration || c.duration,
                        }
                      : c
                  ),
                }
              : track
          )
        );

        return { success: true };
      } catch (error) {
        handleError(error, {
          operation: "Replace Element Media",
          category: ErrorCategory.MEDIA_PROCESSING,
          severity: ErrorSeverity.MEDIUM,
          metadata: {
            elementId,
            trackId,
            fileName: newFile.name,
          },
        });
        return {
          success: false,
          error: `Unexpected error: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    },

    // -----------------------------------------------------------------------
    // Drag state
    // -----------------------------------------------------------------------

    dragState: INITIAL_DRAG_STATE,

    setDragState: (dragState: Partial<DragState>) =>
      set((state: TimelineStore) => ({
        dragState: { ...state.dragState, ...dragState },
      })),

    startDrag: (
      elementId: string,
      trackId: string,
      startMouseX: number,
      startElementTime: number,
      clickOffsetTime: number
    ) => {
      set({
        dragState: {
          isDragging: true,
          elementId,
          trackId,
          startMouseX,
          startElementTime,
          clickOffsetTime,
          currentTime: startElementTime,
        },
      });
    },

    updateDragTime: (currentTime: number) => {
      set((state: TimelineStore) => ({
        dragState: {
          ...state.dragState,
          currentTime,
        },
      }));
    },

    endDrag: () => {
      set({ dragState: INITIAL_DRAG_STATE });
    },

    // -----------------------------------------------------------------------
    // Add-at-time operations
    // -----------------------------------------------------------------------

    addMediaAtTime: (item: MediaItem, currentTime = 0): boolean => {
      const trackType = item.type === "audio" ? "audio" : "media";
      const targetTrackId = get().findOrCreateTrack(trackType);

      const duration =
        item.duration || TIMELINE_CONSTANTS.DEFAULT_IMAGE_DURATION;

      if (get().checkElementOverlap(targetTrackId, currentTime, duration)) {
        toast.error(
          "Cannot place element here - it would overlap with existing elements"
        );
        return false;
      }

      get().addElementToTrack(targetTrackId, {
        type: "media",
        mediaId: item.id,
        name: item.name,
        duration,
        startTime: currentTime,
        trimStart: 0,
        trimEnd: 0,
      });
      return true;
    },

    addTextAtTime: (item: TextElement, currentTime = 0): boolean => {
      const targetTrackId = get().insertTrackAt("text", 0); // Always create new text track at the top

      get().addElementToTrack(targetTrackId, {
        type: "text",
        name: item.name || "Text",
        content: item.content || "Default Text",
        duration: item.duration || TIMELINE_CONSTANTS.DEFAULT_TEXT_DURATION,
        startTime: currentTime,
        trimStart: 0,
        trimEnd: 0,
        fontSize: item.fontSize || 48,
        fontFamily: item.fontFamily || "Arial",
        color: item.color || "#ffffff",
        backgroundColor: item.backgroundColor || "transparent",
        textAlign: item.textAlign || "center",
        fontWeight: item.fontWeight || "normal",
        fontStyle: item.fontStyle || "normal",
        textDecoration: item.textDecoration || "none",
        x: item.x || 0,
        y: item.y || 0,
        rotation: item.rotation || 0,
        opacity: item.opacity !== undefined ? item.opacity : 1,
      });
      return true;
    },

    addMediaToNewTrack: (item: MediaItem): boolean => {
      const trackType = item.type === "audio" ? "audio" : "media";
      const targetTrackId = get().findOrCreateTrack(trackType);

      get().addElementToTrack(targetTrackId, {
        type: "media",
        mediaId: item.id,
        name: item.name,
        duration: item.duration || TIMELINE_CONSTANTS.DEFAULT_IMAGE_DURATION,
        startTime: 0,
        trimStart: 0,
        trimEnd: 0,
      });
      return true;
    },

    addTextToNewTrack: (item: TextElement | DragData): boolean => {
      const targetTrackId = get().insertTrackAt("text", 0); // Always create new text track at the top

      get().addElementToTrack(targetTrackId, {
        type: "text",
        name: item.name || "Text",
        content:
          ("content" in item ? item.content : "Default Text") || "Default Text",
        duration: TIMELINE_CONSTANTS.DEFAULT_TEXT_DURATION,
        startTime: 0,
        trimStart: 0,
        trimEnd: 0,
        fontSize: ("fontSize" in item ? item.fontSize : 48) || 48,
        fontFamily:
          ("fontFamily" in item ? item.fontFamily : "Arial") || "Arial",
        color: ("color" in item ? item.color : "#ffffff") || "#ffffff",
        backgroundColor:
          ("backgroundColor" in item ? item.backgroundColor : "transparent") ||
          "transparent",
        textAlign:
          ("textAlign" in item ? item.textAlign : "center") || "center",
        fontWeight:
          ("fontWeight" in item ? item.fontWeight : "normal") || "normal",
        fontStyle:
          ("fontStyle" in item ? item.fontStyle : "normal") || "normal",
        textDecoration:
          ("textDecoration" in item ? item.textDecoration : "none") || "none",
        x: "x" in item && item.x !== undefined ? item.x : 0,
        y: "y" in item && item.y !== undefined ? item.y : 0,
        rotation:
          "rotation" in item && item.rotation !== undefined ? item.rotation : 0,
        opacity:
          "opacity" in item && item.opacity !== undefined ? item.opacity : 1,
      });
      return true;
    },

    // -----------------------------------------------------------------------
    // Effects management
    // -----------------------------------------------------------------------

    addEffectToElement: (elementId: string, effectId: string) => {
      const { _tracks, pushHistory } = get();
      let updated = false;

      // Create immutable update
      const newTracks = _tracks.map((track) => {
        const elementIndex = track.elements.findIndex(
          (e) => e.id === elementId
        );
        if (elementIndex === -1) return track;

        const element = track.elements[elementIndex];
        const currentEffectIds = element.effectIds || [];

        // Check if effect already exists
        if (currentEffectIds.includes(effectId)) return track;

        // Create new element with updated effect IDs
        const updatedElement = {
          ...element,
          effectIds: [...currentEffectIds, effectId],
        };

        // Create new track with updated element
        const newElements = [...track.elements];
        newElements[elementIndex] = updatedElement;

        updated = true;
        return { ...track, elements: newElements };
      });

      if (updated) {
        pushHistory();
        updateTracks(newTracks);
        autoSaveTimeline();
      }
    },

    removeEffectFromElement: (elementId: string, effectId: string) => {
      const { _tracks, pushHistory } = get();
      let updated = false;

      // Create immutable update
      const newTracks = _tracks.map((track) => {
        const elementIndex = track.elements.findIndex(
          (e) => e.id === elementId
        );
        if (elementIndex === -1) return track;

        const element = track.elements.at(elementIndex);
        if (
          !element ||
          !element.effectIds ||
          !element.effectIds.includes(effectId)
        )
          return track;

        // Create new element with updated effect IDs
        const nextEffectIds = element.effectIds.filter(
          (id: string) => id !== effectId
        );
        const updatedElement = {
          ...element,
          effectIds: nextEffectIds,
        };

        // Create new track with updated element
        const newElements = [...track.elements];
        newElements[elementIndex] = updatedElement;

        updated = true;
        return { ...track, elements: newElements };
      });

      if (updated) {
        pushHistory();
        updateTracks(newTracks);
        autoSaveTimeline();
      }
    },

    getElementEffectIds: (elementId: string): string[] => {
      const tracks = get()._tracks;

      for (const track of tracks) {
        const element = track.elements.find((e) => e.id === elementId);
        if (element) {
          return element.effectIds || [];
        }
      }

      return [];
    },

    clearElementEffects: (elementId: string) => {
      const { _tracks, pushHistory } = get();
      let updated = false;

      // Create immutable update
      const newTracks = _tracks.map((track) => {
        const elementIndex = track.elements.findIndex(
          (e) => e.id === elementId
        );
        if (elementIndex === -1) return track;

        const element = track.elements.at(elementIndex);
        if (!element || !element.effectIds || element.effectIds.length === 0)
          return track;

        // Create new element with cleared effect IDs
        const updatedElement = {
          ...element,
          effectIds: [],
        };

        // Create new track with updated element
        const newElements = [...track.elements];
        newElements[elementIndex] = updatedElement;

        updated = true;
        return { ...track, elements: newElements };
      });

      if (updated) {
        pushHistory();
        updateTracks(newTracks);
        autoSaveTimeline();
      }
    },
  };
}
