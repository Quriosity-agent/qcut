/**
 * Timeline Store
 *
 * Core state management for the video timeline. Handles tracks, elements,
 * drag operations, selection, and timeline persistence.
 *
 * @module stores/timeline-store
 */

import { create } from "zustand";
import {
  sortTracksByOrder,
  ensureMainTrack,
  validateElementTrackCompatibility,
} from "@/types/timeline";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import { storageService } from "@/lib/storage/storage-service";
// Dynamic import to break circular dependency
// import { useProjectStore } from "./project-store";
import { generateUUID } from "@/lib/utils";
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";

// Import from timeline module
import { type TimelineStore, createTrack } from "./timeline";
import { createTimelineOperations } from "./timeline-store-operations";

// TimelineStore interface is now imported from ./timeline/types

// Module-level timer for debounced auto-save
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

export const useTimelineStore = create<TimelineStore>((set, get) => {
  // Helper to update tracks and maintain ordering
  const updateTracks = (newTracks: TimelineTrack[]) => {
    const tracksWithMain = ensureMainTrack(newTracks);
    const sortedTracks = sortTracksByOrder(tracksWithMain);
    set({
      _tracks: tracksWithMain,
      tracks: sortedTracks,
    });
  };

  // Helper to auto-save timeline - captures projectId and calls guarded version
  const autoSaveTimeline = async () => {
    const { useProjectStore } = await import("./project-store");
    const projectId = useProjectStore.getState().activeProject?.id;
    if (projectId) {
      await autoSaveTimelineGuarded(projectId);
    }
  };

  // Helper to auto-save timeline changes with project guard
  // Takes scheduledProjectId to prevent cross-project bleed when user switches projects
  const autoSaveTimelineGuarded = async (scheduledProjectId: string) => {
    try {
      const { useProjectStore } = await import("./project-store");
      const activeProject = useProjectStore.getState().activeProject;

      // Guard: Skip save if project changed since scheduling
      if (!activeProject || activeProject.id !== scheduledProjectId) {
        console.log(
          `[TimelineStore] Skipping auto-save: project changed (scheduled: ${scheduledProjectId}, current: ${activeProject?.id})`
        );
        set({
          isAutoSaving: false,
          autoSaveStatus: "Auto-save idle",
        });
        return;
      }

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

  // Helper to update tracks and auto-save with debouncing
  // Captures projectId at schedule time to prevent cross-project bleed
  const updateTracksAndSave = async (newTracks: TimelineTrack[]) => {
    updateTracks(newTracks);

    // Capture projectId at schedule time (not at save time)
    const { useProjectStore } = await import("./project-store");
    const scheduledProjectId = useProjectStore.getState().activeProject?.id;

    if (!scheduledProjectId) {
      // No active project, skip auto-save
      return;
    }

    // Auto-save in background with debouncing
    set({
      isAutoSaving: true,
      autoSaveStatus: "Auto-saving...",
    });

    // Cancel previous timer to prevent race conditions and stale saves
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = setTimeout(
      () => autoSaveTimelineGuarded(scheduledProjectId),
      50
    );
  };

  // Initialize with proper track ordering
  const initialTracks = ensureMainTrack([]);
  const sortedInitialTracks = sortTracksByOrder(initialTracks);

  return {
    _tracks: initialTracks,
    tracks: sortedInitialTracks,
    history: [],
    redoStack: [],
    autoSaveStatus: "Auto-save idle",
    isAutoSaving: false,
    lastAutoSaveAt: null,
    selectedElements: [],
    rippleEditingEnabled: false,

    // Snapping settings defaults
    snappingEnabled: true,

    // Effects track visibility - load from localStorage, default to false
    showEffectsTrack:
      typeof window !== "undefined"
        ? localStorage.getItem("timeline-showEffectsTrack") === "true"
        : false,

    getSortedTracks: () => {
      const { _tracks } = get();
      const tracksWithMain = ensureMainTrack(_tracks);
      return sortTracksByOrder(tracksWithMain);
    },

    pushHistory: () => {
      const { _tracks, history } = get();
      set({
        history: [...history, JSON.parse(JSON.stringify(_tracks))],
        redoStack: [],
      });
    },

    undo: () => {
      const { history, redoStack, _tracks } = get();
      if (history.length === 0) return;
      const prev = history[history.length - 1];
      updateTracksAndSave(prev);
      set({
        history: history.slice(0, -1),
        redoStack: [...redoStack, JSON.parse(JSON.stringify(_tracks))],
      });
    },

    selectElement: (trackId, elementId, multi = false) => {
      set((state) => {
        const exists = state.selectedElements.some(
          (c) => c.trackId === trackId && c.elementId === elementId
        );
        if (multi) {
          return exists
            ? {
                selectedElements: state.selectedElements.filter(
                  (c) => !(c.trackId === trackId && c.elementId === elementId)
                ),
              }
            : {
                selectedElements: [
                  ...state.selectedElements,
                  { trackId, elementId },
                ],
              };
        }
        return { selectedElements: [{ trackId, elementId }] };
      });
    },

    deselectElement: (trackId, elementId) => {
      set((state) => ({
        selectedElements: state.selectedElements.filter(
          (c) => !(c.trackId === trackId && c.elementId === elementId)
        ),
      }));
    },

    clearSelectedElements: () => {
      set({ selectedElements: [] });
    },

    setSelectedElements: (elements) => set({ selectedElements: elements }),

    addTrack: (type) => {
      get().pushHistory();
      const newTrack = createTrack(type);
      updateTracksAndSave([...get()._tracks, newTrack]);
      return newTrack.id;
    },

    insertTrackAt: (type, index) => {
      get().pushHistory();
      const newTrack = createTrack(type);
      const newTracks = [...get()._tracks];
      const clampedIndex = Math.min(Math.max(0, index), newTracks.length);
      newTracks.splice(clampedIndex, 0, newTrack);
      updateTracksAndSave(newTracks);
      return newTrack.id;
    },

    addElementToTrack: (trackId, elementData) => {
      get().pushHistory();

      // Validate element type matches track type
      const track = get()._tracks.find((t) => t.id === trackId);
      if (!track) {
        handleError(new Error(`Track not found: ${trackId}`), {
          operation: "Add Element to Track",
          category: ErrorCategory.VALIDATION,
          severity: ErrorSeverity.MEDIUM,
          metadata: {
            trackId,
          },
        });
        return;
      }

      // Use utility function for validation
      const validation = validateElementTrackCompatibility(elementData, track);
      if (!validation.isValid) {
        handleError(
          new Error(
            validation.errorMessage || "Invalid element for track type"
          ),
          {
            operation: "Element Track Compatibility",
            category: ErrorCategory.VALIDATION,
            severity: ErrorSeverity.MEDIUM,
            metadata: {
              trackType: track.type,
              elementType: elementData.type,
            },
          }
        );
        return;
      }

      // For media elements, validate mediaId exists
      if (elementData.type === "media" && !elementData.mediaId) {
        handleError(new Error("Media element must have mediaId"), {
          operation: "Media Element Validation",
          category: ErrorCategory.VALIDATION,
          severity: ErrorSeverity.MEDIUM,
          metadata: {
            elementType: "media",
            trackId,
          },
        });
        return;
      }

      // For text elements, validate required text properties
      if (elementData.type === "text" && !elementData.content) {
        handleError(new Error("Text element must have content"), {
          operation: "Text Element Validation",
          category: ErrorCategory.VALIDATION,
          severity: ErrorSeverity.MEDIUM,
          metadata: {
            elementType: "text",
            trackId,
          },
        });
        return;
      }

      // Check if this is the first element being added to the timeline
      const currentState = get();
      const totalElementsInTimeline = currentState._tracks.reduce(
        (total, track) => total + track.elements.length,
        0
      );
      const isFirstElement = totalElementsInTimeline === 0;

      const newElement: TimelineElement = {
        ...elementData,
        id: generateUUID(),
        startTime: elementData.startTime || 0,
        trimStart: 0,
        trimEnd: 0,
      } as TimelineElement; // Type assertion since we trust the caller passes valid data

      // If this is the first element and it's a media element, automatically set the project canvas size
      // to match the media's aspect ratio and FPS (for videos)
      if (isFirstElement && newElement.type === "media") {
        import("./media-store")
          .then(({ useMediaStore, getMediaAspectRatio }) => {
            const mediaStore = useMediaStore.getState();
            const mediaItem = mediaStore.mediaItems.find(
              (item) => item.id === newElement.mediaId
            );

            if (
              mediaItem &&
              (mediaItem.type === "image" || mediaItem.type === "video")
            ) {
              import("./editor-store").then(({ useEditorStore }) => {
                const editorStore = useEditorStore.getState();
                editorStore.setCanvasSizeFromAspectRatio(
                  getMediaAspectRatio(mediaItem)
                );
              });
            }

            // Set project FPS from the first video element
            if (mediaItem && mediaItem.type === "video" && mediaItem.fps) {
              const fps = mediaItem.fps;
              import("./project-store")
                .then(({ useProjectStore }) => {
                  const projectStore = useProjectStore.getState();
                  if (projectStore.activeProject) {
                    projectStore.updateProjectFps(fps);
                  }
                })
                .catch((error) => {
                  handleError(error, {
                    operation: "Update FPS from Project Store",
                    category: ErrorCategory.STORAGE,
                    severity: ErrorSeverity.LOW,
                    showToast: false,
                    metadata: {
                      operation: "fps-update",
                    },
                  });
                });
            }
          })
          .catch((error) => {
            handleError(error, {
              operation: "Set canvas size from first element",
              category: ErrorCategory.STORAGE,
              severity: ErrorSeverity.LOW,
              showToast: false,
            });
          });
      }

      updateTracksAndSave(
        get()._tracks.map((track) =>
          track.id === trackId
            ? { ...track, elements: [...track.elements, newElement] }
            : track
        )
      );

      get().selectElement(trackId, newElement.id);
    },

    removeElementFromTrack: (trackId, elementId, pushHistory = true) => {
      const { rippleEditingEnabled } = get();

      if (rippleEditingEnabled) {
        get().removeElementFromTrackWithRipple(trackId, elementId, pushHistory);
      } else {
        if (pushHistory) get().pushHistory();
        updateTracksAndSave(
          get()
            ._tracks.map((track) =>
              track.id === trackId
                ? {
                    ...track,
                    elements: track.elements.filter(
                      (element) => element.id !== elementId
                    ),
                  }
                : track
            )
            .filter((track) => track.elements.length > 0 || track.isMain)
        );
      }
    },

    moveElementToTrack: (fromTrackId, toTrackId, elementId) => {
      get().pushHistory();

      const fromTrack = get()._tracks.find((track) => track.id === fromTrackId);
      const toTrack = get()._tracks.find((track) => track.id === toTrackId);
      const elementToMove = fromTrack?.elements.find(
        (element) => element.id === elementId
      );

      if (!elementToMove || !toTrack) return;

      // Validate element type compatibility with target track
      const validation = validateElementTrackCompatibility(
        elementToMove,
        toTrack
      );
      if (!validation.isValid) {
        handleError(
          new Error(validation.errorMessage || "Invalid drag operation"),
          {
            operation: "Timeline Drag Validation",
            category: ErrorCategory.VALIDATION,
            severity: ErrorSeverity.MEDIUM,
            metadata: {
              targetTrackId: toTrackId,
              elementId,
            },
          }
        );
        return;
      }

      const newTracks = get()
        ._tracks.map((track) => {
          if (track.id === fromTrackId) {
            return {
              ...track,
              elements: track.elements.filter(
                (element) => element.id !== elementId
              ),
            };
          }
          if (track.id === toTrackId) {
            return {
              ...track,
              elements: [...track.elements, elementToMove],
            };
          }
          return track;
        })
        .filter((track) => track.elements.length > 0 || track.isMain);

      updateTracksAndSave(newTracks);
    },

    updateElementTrim: (
      trackId,
      elementId,
      trimStart,
      trimEnd,
      pushHistory = true
    ) => {
      if (pushHistory) get().pushHistory();
      updateTracksAndSave(
        get()._tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                elements: track.elements.map((element) =>
                  element.id === elementId
                    ? { ...element, trimStart, trimEnd }
                    : element
                ),
              }
            : track
        )
      );
    },

    updateElementDuration: (
      trackId,
      elementId,
      duration,
      pushHistory = true
    ) => {
      if (pushHistory) get().pushHistory();
      updateTracksAndSave(
        get()._tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                elements: track.elements.map((element) =>
                  element.id === elementId ? { ...element, duration } : element
                ),
              }
            : track
        )
      );
    },

    updateElementStartTime: (
      trackId,
      elementId,
      startTime,
      pushHistory = true
    ) => {
      if (pushHistory) get().pushHistory();
      const clampedStartTime = Math.max(0, startTime);
      updateTracksAndSave(
        get()._tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                elements: track.elements.map((element) =>
                  element.id === elementId
                    ? { ...element, startTime: clampedStartTime }
                    : element
                ),
              }
            : track
        )
      );
    },

    toggleTrackMute: (trackId) => {
      get().pushHistory();
      updateTracksAndSave(
        get()._tracks.map((track) =>
          track.id === trackId ? { ...track, muted: !track.muted } : track
        )
      );
    },

    toggleElementHidden: (trackId, elementId) => {
      get().pushHistory();
      updateTracksAndSave(
        get()._tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                elements: track.elements.map((element) =>
                  element.id === elementId
                    ? { ...element, hidden: !element.hidden }
                    : element
                ),
              }
            : track
        )
      );
    },

    updateTextElement: (trackId, elementId, updates) => {
      get().pushHistory();
      updateTracksAndSave(
        get()._tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                elements: track.elements.map((element) =>
                  element.id === elementId && element.type === "text"
                    ? { ...element, ...updates }
                    : element
                ),
              }
            : track
        )
      );
    },

    // Interactive element manipulation (for effects)
    updateElementTransform: (elementId, updates, options) => {
      const push = options?.pushHistory !== false;
      if (push) get().pushHistory();
      const newTracks = get()._tracks.map((track) => ({
        ...track,
        elements: track.elements.map((el) => {
          if (el.id !== elementId) return el;
          return {
            ...el,
            ...(updates.position && {
              x: updates.position.x,
              y: updates.position.y,
            }),
            ...(updates.size && {
              width: updates.size.width,
              height: updates.size.height,
              ...(updates.size.x !== undefined && { x: updates.size.x }),
              ...(updates.size.y !== undefined && { y: updates.size.y }),
            }),
            ...(updates.rotation !== undefined && {
              rotation: updates.rotation,
            }),
          };
        }),
      }));
      updateTracksAndSave(newTracks);
    },

    updateElementPosition: (elementId, position) =>
      get().updateElementTransform(
        elementId,
        { position },
        { pushHistory: true }
      ),

    updateElementSize: (elementId, size) =>
      get().updateElementTransform(elementId, { size }, { pushHistory: true }),

    updateElementRotation: (elementId, rotation) =>
      get().updateElementTransform(
        elementId,
        { rotation },
        { pushHistory: true }
      ),

    updateMediaElement: (trackId, elementId, updates, pushHistory = true) => {
      if (pushHistory) {
        get().pushHistory();
      }
      updateTracksAndSave(
        get()._tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                elements: track.elements.map((element) =>
                  element.id === elementId && element.type === "media"
                    ? { ...element, ...updates }
                    : element
                ),
              }
            : track
        )
      );
    },

    updateRemotionElement: (
      trackId,
      elementId,
      updates,
      pushHistory = true
    ) => {
      if (pushHistory) {
        get().pushHistory();
      }
      updateTracksAndSave(
        get()._tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                elements: track.elements.map((element) =>
                  element.id === elementId && element.type === "remotion"
                    ? { ...element, ...updates }
                    : element
                ),
              }
            : track
        )
      );
    },

    getTotalDuration: () => {
      const { _tracks } = get();
      if (_tracks.length === 0) return 0;

      const trackEndTimes = _tracks.map((track) =>
        track.elements.reduce((maxEnd, element) => {
          const elementEnd =
            element.startTime +
            element.duration -
            element.trimStart -
            element.trimEnd;
          return Math.max(maxEnd, elementEnd);
        }, 0)
      );

      return Math.max(...trackEndTimes, 0);
    },

    getProjectThumbnail: async (projectId) => {
      try {
        const tracks = await storageService.loadTimeline({ projectId });
        const mediaItems = await storageService.loadAllMediaItems(projectId);

        if (!tracks || !mediaItems.length) return null;

        const firstMediaElement = tracks
          .flatMap((track) => track.elements)
          .filter((element) => element.type === "media")
          .sort((a, b) => a.startTime - b.startTime)[0];

        if (!firstMediaElement) return null;

        const mediaItem = mediaItems.find(
          (item) => item.id === firstMediaElement.mediaId
        );
        if (!mediaItem) return null;

        if (mediaItem.type === "video" && mediaItem.file) {
          const { generateVideoThumbnail } = await import(
            "@/stores/media-store-loader"
          ).then((m) => m.getMediaStoreUtils());
          const { thumbnailUrl } = await generateVideoThumbnail(mediaItem.file);
          return thumbnailUrl;
        }
        if (mediaItem.type === "image" && mediaItem.url) {
          return mediaItem.url;
        }

        return null;
      } catch (error) {
        handleError(error, {
          operation: "Generate Project Thumbnail",
          category: ErrorCategory.MEDIA_PROCESSING,
          severity: ErrorSeverity.LOW,
          showToast: false,
          metadata: {
            operation: "thumbnail-generation",
          },
        });
        return null;
      }
    },

    redo: () => {
      const { redoStack } = get();
      if (redoStack.length === 0) return;
      const next = redoStack[redoStack.length - 1];
      updateTracksAndSave(next);
      set({ redoStack: redoStack.slice(0, -1) });
    },

    // Persistence methods
    loadProjectTimeline: async ({ projectId, sceneId }) => {
      try {
        const tracks = await storageService.loadProjectTimeline({
          projectId,
          sceneId,
        });
        if (tracks) {
          updateTracks(tracks);
        } else {
          // No timeline saved yet, initialize with default
          const defaultTracks = ensureMainTrack([]);
          updateTracks(defaultTracks);
        }
        // Clear history when loading a project
        set({ history: [], redoStack: [] });
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
        updateTracks(defaultTracks);
        set({ history: [], redoStack: [] });
      }
    },

    saveProjectTimeline: async ({ projectId, sceneId }) => {
      try {
        await storageService.saveProjectTimeline({
          projectId,
          tracks: get()._tracks,
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
            trackCount: get()._tracks.length,
          },
        });
      }
    },

    // Save immediately without debounce - for critical operations like app close
    saveImmediate: async () => {
      // Cancel any pending debounced save
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
      }

      try {
        const { useProjectStore } = await import("./project-store");
        const activeProject = useProjectStore.getState().activeProject;
        if (activeProject) {
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
            autoSaveStatus: "Saved",
            lastAutoSaveAt: Date.now(),
          });
        }
      } catch (error) {
        handleError(error, {
          operation: "Immediate Save Timeline",
          category: ErrorCategory.STORAGE,
          severity: ErrorSeverity.HIGH,
          metadata: {
            trackCount: get()._tracks.length,
          },
        });
      }
    },

    clearTimeline: () => {
      const defaultTracks = ensureMainTrack([]);
      updateTracks(defaultTracks);
      set({ history: [], redoStack: [], selectedElements: [] });
    },

    restoreTracks: (tracks: TimelineTrack[]) => {
      console.log(
        `[TimelineStore] Restoring ${tracks.length} tracks (rollback)`
      );
      updateTracks(tracks);
    },

    // Snapping actions
    toggleSnapping: () => {
      set((state) => ({ snappingEnabled: !state.snappingEnabled }));
    },

    // Ripple editing functions
    toggleRippleEditing: () => {
      set((state) => ({
        rippleEditingEnabled: !state.rippleEditingEnabled,
      }));
    },

    // Effects track visibility functions
    toggleEffectsTrack: () => {
      const { showEffectsTrack } = get();
      const newValue = !showEffectsTrack;
      set({ showEffectsTrack: newValue });

      // Persist to localStorage
      if (typeof window !== "undefined") {
        localStorage.setItem("timeline-showEffectsTrack", String(newValue));
      }
    },

    autoShowEffectsTrack: () => {
      const { showEffectsTrack } = get();
      if (!showEffectsTrack) {
        set({ showEffectsTrack: true });

        // Persist to localStorage
        if (typeof window !== "undefined") {
          localStorage.setItem("timeline-showEffectsTrack", "true");
        }
      }
    },

    checkElementOverlap: (trackId, startTime, duration, excludeElementId) => {
      const track = get()._tracks.find((t) => t.id === trackId);
      if (!track) return false;

      const overlap = track.elements.some((element) => {
        const elementEnd =
          element.startTime +
          element.duration -
          element.trimStart -
          element.trimEnd;

        if (element.id === excludeElementId) {
          return false;
        }

        return (
          (startTime >= element.startTime && startTime < elementEnd) ||
          (startTime + duration > element.startTime &&
            startTime + duration <= elementEnd) ||
          (startTime < element.startTime && startTime + duration > elementEnd)
        );
      });
      return overlap;
    },

    findOrCreateTrack: (trackType) => {
      // Always create new text track to allow multiple text elements
      // Insert text tracks at the top
      if (trackType === "text") {
        return get().insertTrackAt(trackType, 0);
      }

      const existingTrack = get()._tracks.find((t) => t.type === trackType);
      if (existingTrack) {
        return existingTrack.id;
      }

      return get().addTrack(trackType);
    },

    // Operations (ripple, split, audio/media, drag, add-at-time, effects)
    ...createTimelineOperations({
      get,
      set,
      deps: { updateTracks, updateTracksAndSave, autoSaveTimeline },
    }),
  };
});
