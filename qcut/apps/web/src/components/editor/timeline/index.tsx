"use client";

import { ScrollArea } from "../../ui/scroll-area";
import { Bookmark } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../ui/context-menu";
import { useTimelineStore } from "@/stores/timeline-store";
import { useAsyncMediaStore } from "@/hooks/use-async-media-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { useFrameCache } from "@/hooks/use-frame-cache";
import { TimelineCacheIndicator } from "./timeline-cache-indicator";
import { useProjectStore } from "@/stores/project-store";
import { useTimelineZoom } from "@/hooks/use-timeline-zoom";
import { useState, useRef, useEffect, useCallback } from "react";
import { TimelineTrackContent } from "./timeline-track";
import {
  TimelinePlayhead,
  useTimelinePlayheadRuler,
} from "./timeline-playhead";
import { SelectionBox } from "../selection-box";
import { useSelectionBox } from "@/hooks/use-selection-box";
import { SnapIndicator } from "../snap-indicator";
import { SnapPoint } from "@/hooks/use-timeline-snapping";
import { EffectsTimeline } from "./effects-timeline";
import { EFFECTS_ENABLED } from "@/config/features";
import {
  getTrackHeight,
  getCumulativeHeightBefore,
  getTotalTracksHeight,
  TIMELINE_CONSTANTS,
  snapTimeToFrame,
  calculateMinimumTimelineDuration,
  calculateTimelineBuffer,
} from "@/constants/timeline-constants";
import { useWordTimelineStore } from "@/stores/word-timeline-store";
import { TimelineToolbar } from "./timeline-toolbar";
import { TrackIcon } from "./track-icon";
import { useDragHandlers } from "./timeline-drag-handlers";

export function Timeline() {
  // Timeline shows all tracks (video, audio, effects) and their elements.
  // You can drag media here to add it to your project.
  // elements can be trimmed, deleted, and moved.
  //
  // Fixed infinite loop: replaced object selectors with individual selectors
  // using individual selectors to keep snapshots stable

  // Individual selectors to prevent infinite loops with useSyncExternalStore
  const tracks = useTimelineStore((s) => s.tracks);
  const getTotalDuration = useTimelineStore((s) => s.getTotalDuration);
  const clearSelectedElements = useTimelineStore(
    (s) => s.clearSelectedElements
  );
  const snappingEnabled = useTimelineStore((s) => s.snappingEnabled);
  const showEffectsTrack = useTimelineStore((s) => s.showEffectsTrack);
  const setSelectedElements = useTimelineStore((s) => s.setSelectedElements);
  const toggleTrackMute = useTimelineStore((s) => s.toggleTrackMute);
  const dragState = useTimelineStore((s) => s.dragState);
  const {
    store: mediaStore,
    loading: mediaStoreLoading,
    error: mediaStoreError,
  } = useAsyncMediaStore();
  const mediaItems = mediaStore?.mediaItems || [];
  const addMediaItem = mediaStore?.addMediaItem;
  const activeProject = useProjectStore((s) => s.activeProject);
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const duration = usePlaybackStore((s) => s.duration);
  const seek = usePlaybackStore((s) => s.seek);
  const setDuration = usePlaybackStore((s) => s.setDuration);

  // Get deleted words from transcription for red markers on timeline
  const wordTimelineData = useWordTimelineStore((s) => s.data);
  const deletedWords =
    wordTimelineData?.words.filter((w) => w.type === "word" && w.deleted) || [];

  const timelineRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [isInTimeline, setIsInTimeline] = useState(false);

  // Track mouse down/up for distinguishing clicks from drag/resize ends
  const mouseTrackingRef = useRef({
    isMouseDown: false,
    downX: 0,
    downY: 0,
    downTime: 0,
  });

  // Timeline zoom functionality
  const { zoomLevel, setZoomLevel, handleWheel } = useTimelineZoom({
    containerRef: timelineRef,
    isInTimeline,
  });
  const { dragProps } = useDragHandlers({
    mediaItems,
    addMediaItem,
    activeProject,
  });

  // Old marquee selection removed - using new SelectionBox component instead

  // Dynamic timeline width calculation based on playhead position and duration
  // Use utility function to calculate flexible timeline buffer
  const dynamicBuffer = calculateTimelineBuffer(duration || 0);
  const dynamicTimelineWidth = Math.max(
    (duration || 0) * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel, // Base width from duration
    (currentTime + dynamicBuffer) *
      TIMELINE_CONSTANTS.PIXELS_PER_SECOND *
      zoomLevel, // Width to show current time + dynamic buffer
    timelineRef.current?.clientWidth || 1000 // Minimum width
  );

  // Scroll synchronization and auto-scroll to playhead
  const rulerScrollRef = useRef<HTMLDivElement>(null);
  const tracksScrollRef = useRef<HTMLDivElement>(null);
  const trackLabelsRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const trackLabelsScrollRef = useRef<HTMLDivElement>(null);
  const isUpdatingRef = useRef(false);
  const lastRulerSync = useRef(0);
  const lastTracksSync = useRef(0);
  const lastVerticalSync = useRef(0);

  // Cache status tracking
  const { getRenderStatus } = useFrameCache({
    maxCacheSize: 300,
    cacheResolution: 30,
  });

  // Timeline playhead ruler handlers
  const { handleRulerMouseDown } = useTimelinePlayheadRuler({
    currentTime,
    duration,
    zoomLevel,
    seek,
    rulerRef,
    rulerScrollRef,
    tracksScrollRef,
    playheadRef,
  });

  // Selection box functionality
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const {
    selectionBox,
    handleMouseDown: handleSelectionMouseDown,
    isSelecting,
    justFinishedSelecting,
  } = useSelectionBox({
    containerRef: tracksContainerRef,
    playheadRef,
    onSelectionComplete: (elements) => {
      console.log(JSON.stringify({ onSelectionComplete: elements.length }));
      setSelectedElements(elements);
    },
  });

  // Calculate snap indicator state
  const [currentSnapPoint, setCurrentSnapPoint] = useState<SnapPoint | null>(
    null
  );
  const showSnapIndicator =
    dragState.isDragging && snappingEnabled && currentSnapPoint !== null;

  // Callback to handle snap point changes from TimelineTrackContent
  const handleSnapPointChange = useCallback((snapPoint: SnapPoint | null) => {
    setCurrentSnapPoint(snapPoint);
  }, []);

  // Track mouse down to distinguish real clicks from drag/resize ends
  const handleTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    // Only track mouse down on timeline background areas (not elements)
    const target = e.target as HTMLElement;
    const isTimelineBackground =
      !target.closest(".timeline-element") &&
      !playheadRef.current?.contains(target) &&
      !target.closest("[data-track-labels]");

    if (isTimelineBackground) {
      mouseTrackingRef.current = {
        isMouseDown: true,
        downX: e.clientX,
        downY: e.clientY,
        downTime: e.timeStamp,
      };
    }
  }, []);

  // Timeline content click to seek handler
  const handleTimelineContentClick = useCallback(
    (e: React.MouseEvent) => {
      const { isMouseDown, downX, downY, downTime } = mouseTrackingRef.current;

      // Reset mouse tracking
      mouseTrackingRef.current = {
        isMouseDown: false,
        downX: 0,
        downY: 0,
        downTime: 0,
      };

      // Only process as click if we tracked a mouse down on timeline background
      if (!isMouseDown) {
        console.log(
          JSON.stringify({
            ignoredClickWithoutMouseDown: true,
            timeStamp: e.timeStamp,
          })
        );
        return;
      }

      // Check if mouse moved significantly (indicates drag, not click)
      const deltaX = Math.abs(e.clientX - downX);
      const deltaY = Math.abs(e.clientY - downY);
      const deltaTime = e.timeStamp - downTime;

      if (deltaX > 5 || deltaY > 5 || deltaTime > 500) {
        console.log(
          JSON.stringify({
            ignoredDragNotClick: true,
            deltaX,
            deltaY,
            deltaTime,
            timeStamp: e.timeStamp,
          })
        );
        return;
      }

      // Don't seek if this was a selection box operation
      if (isSelecting || justFinishedSelecting) {
        return;
      }

      // Don't seek if clicking on timeline elements, but still deselect
      if ((e.target as HTMLElement).closest(".timeline-element")) {
        return;
      }

      // Don't seek if clicking on playhead
      if (playheadRef.current?.contains(e.target as Node)) {
        return;
      }

      // Don't seek if clicking on track labels
      if ((e.target as HTMLElement).closest("[data-track-labels]")) {
        clearSelectedElements();
        return;
      }

      // Clear selected elements when clicking empty timeline area
      console.log(JSON.stringify({ clearingSelectedElements: true }));
      clearSelectedElements();

      // Determine if we're clicking in ruler or tracks area
      const isRulerClick = (e.target as HTMLElement).closest(
        "[data-ruler-area]"
      );

      let mouseX: number;
      let scrollLeft = 0;

      if (isRulerClick) {
        // Calculate based on ruler position
        const rulerContent = rulerScrollRef.current;
        if (!rulerContent) return;
        const rect = rulerContent.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        scrollLeft = rulerContent.scrollLeft;
      } else {
        // Calculate based on tracks content position
        const tracksContent = tracksScrollRef.current;
        if (!tracksContent) return;
        const rect = tracksContent.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        scrollLeft = tracksContent.scrollLeft;
      }

      const rawTime = Math.max(
        0,
        Math.min(
          duration,
          (mouseX + scrollLeft) /
            (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel)
        )
      );

      // Use frame snapping for timeline clicking
      const projectFps = activeProject?.fps || 30;
      const time = snapTimeToFrame(rawTime, projectFps);

      seek(time);
    },
    [
      duration,
      zoomLevel,
      seek,
      clearSelectedElements,
      isSelecting,
      justFinishedSelecting,
      activeProject?.fps,
    ]
  );

  // Update timeline duration when tracks change
  // biome-ignore lint/correctness/useExhaustiveDependencies: tracks is necessary - getTotalDuration() reads from store but reference doesn't change when tracks change
  useEffect(() => {
    const totalDuration = getTotalDuration();
    setDuration(calculateMinimumTimelineDuration(totalDuration));
  }, [tracks, setDuration, getTotalDuration]);

  // Old marquee system removed - using new SelectionBox component instead

  // --- Scroll synchronization effect ---
  // Re-runs when mediaStoreLoading changes because the component renders a
  // loading spinner (early return) until the store is ready, so refs are null
  // on the first effect run. Without this dependency the listeners never attach.
  useEffect(() => {
    const rulerViewport = rulerScrollRef.current;
    const tracksViewport = tracksScrollRef.current;
    const trackLabelsViewport = trackLabelsScrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLElement;

    if (!rulerViewport || !tracksViewport) return;

    // Horizontal scroll synchronization between ruler and tracks
    const handleRulerScroll = () => {
      const now = Date.now();
      if (isUpdatingRef.current || now - lastRulerSync.current < 16) return;
      lastRulerSync.current = now;
      isUpdatingRef.current = true;
      tracksViewport.scrollLeft = rulerViewport.scrollLeft;
      isUpdatingRef.current = false;
    };
    const handleTracksScroll = () => {
      const now = Date.now();
      if (isUpdatingRef.current || now - lastTracksSync.current < 16) return;
      lastTracksSync.current = now;
      isUpdatingRef.current = true;
      rulerViewport.scrollLeft = tracksViewport.scrollLeft;
      isUpdatingRef.current = false;
    };

    rulerViewport.addEventListener("scroll", handleRulerScroll);
    tracksViewport.addEventListener("scroll", handleTracksScroll);

    // Vertical scroll synchronization between track labels and tracks content
    if (trackLabelsViewport) {
      const handleTrackLabelsScroll = () => {
        const now = Date.now();
        if (isUpdatingRef.current || now - lastVerticalSync.current < 16)
          return;
        lastVerticalSync.current = now;
        isUpdatingRef.current = true;
        tracksViewport.scrollTop = trackLabelsViewport.scrollTop;
        isUpdatingRef.current = false;
      };
      const handleTracksVerticalScroll = () => {
        const now = Date.now();
        if (isUpdatingRef.current || now - lastVerticalSync.current < 16)
          return;
        lastVerticalSync.current = now;
        isUpdatingRef.current = true;
        trackLabelsViewport.scrollTop = tracksViewport.scrollTop;
        isUpdatingRef.current = false;
      };

      trackLabelsViewport.addEventListener("scroll", handleTrackLabelsScroll);
      tracksViewport.addEventListener("scroll", handleTracksVerticalScroll);

      return () => {
        rulerViewport.removeEventListener("scroll", handleRulerScroll);
        tracksViewport.removeEventListener("scroll", handleTracksScroll);
        trackLabelsViewport.removeEventListener(
          "scroll",
          handleTrackLabelsScroll
        );
        tracksViewport.removeEventListener(
          "scroll",
          handleTracksVerticalScroll
        );
      };
    }

    return () => {
      rulerViewport.removeEventListener("scroll", handleRulerScroll);
      tracksViewport.removeEventListener("scroll", handleTracksScroll);
    };
  }, [mediaStoreLoading, tracks.length]);

  // Handle media store loading/error states
  if (mediaStoreError) {
    console.error("Failed to load media store:", mediaStoreError);
    return (
      <div className="flex items-center justify-center h-full text-red-500">
        Failed to load media store: {mediaStoreError.message}
      </div>
    );
  }

  if (mediaStoreLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div
      className={
        "h-full flex flex-col transition-colors duration-200 relative bg-panel rounded-sm overflow-hidden"
      }
      {...dragProps}
      onMouseEnter={() => setIsInTimeline(true)}
      onMouseLeave={() => setIsInTimeline(false)}
    >
      <TimelineToolbar zoomLevel={zoomLevel} setZoomLevel={setZoomLevel} />

      {/* Timeline Container */}
      <div
        className="flex-1 flex flex-col overflow-hidden relative"
        ref={timelineRef}
      >
        <TimelinePlayhead
          currentTime={currentTime}
          duration={duration}
          zoomLevel={zoomLevel}
          tracks={tracks}
          seek={seek}
          rulerRef={rulerRef}
          rulerScrollRef={rulerScrollRef}
          tracksScrollRef={tracksScrollRef}
          trackLabelsRef={trackLabelsRef}
          timelineRef={timelineRef}
          playheadRef={playheadRef}
          isSnappingToPlayhead={
            showSnapIndicator && currentSnapPoint?.type === "playhead"
          }
        />
        <SnapIndicator
          snapPoint={currentSnapPoint}
          zoomLevel={zoomLevel}
          tracks={tracks}
          timelineRef={timelineRef}
          trackLabelsRef={trackLabelsRef}
          tracksScrollRef={tracksScrollRef}
          isVisible={showSnapIndicator}
        />
        {/* Timeline Header with Ruler */}
        <div className="flex bg-panel sticky top-0 z-10">
          {/* Track Labels Header */}
          <div className="w-48 shrink-0 bg-panel border-r flex items-center justify-between px-3 py-2">
            {/* Empty space */}
            <span className="text-sm font-medium text-muted-foreground opacity-0">
              .
            </span>
          </div>

          {/* Timeline Ruler */}
          <div
            className="flex-1 relative overflow-hidden h-10"
            onWheel={(e) => {
              // Check if this is horizontal scrolling - if so, don't handle it here
              if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                return; // Let scroll container handle horizontal scrolling
              }
              handleWheel(e);
            }}
            onMouseDown={handleSelectionMouseDown}
            onClick={handleTimelineContentClick}
            data-ruler-area
          >
            <div ref={rulerScrollRef} className="w-full overflow-x-auto overflow-y-hidden scrollbar-hidden">
              <div
                ref={rulerRef}
                className="relative h-10 select-none cursor-default"
                style={{
                  width: `${dynamicTimelineWidth}px`,
                }}
                onMouseDown={handleRulerMouseDown}
              >
                {/* Cache indicator */}
                <TimelineCacheIndicator
                  duration={duration}
                  zoomLevel={zoomLevel}
                  tracks={tracks}
                  mediaItems={mediaItems}
                  activeProject={activeProject}
                  getRenderStatus={getRenderStatus}
                />

                {/* Time markers */}
                {(() => {
                  // Calculate appropriate time interval based on zoom level
                  const getTimeInterval = (
                    zoom: number,
                    totalDuration: number
                  ) => {
                    const pixelsPerSecond =
                      TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoom;

                    // For very short durations, ensure we have enough markers to show progression
                    if (totalDuration <= 5) {
                      if (pixelsPerSecond >= 100) return 0.1; // Every 0.1s for short content
                      if (pixelsPerSecond >= 50) return 0.25; // Every 0.25s for short content
                      return 0.5; // Every 0.5s minimum for short content
                    }

                    // Standard intervals for longer content
                    if (pixelsPerSecond >= 200) return 0.1; // Every 0.1s when very zoomed in
                    if (pixelsPerSecond >= 100) return 0.5; // Every 0.5s when zoomed in
                    if (pixelsPerSecond >= 50) return 1; // Every 1s at normal zoom
                    if (pixelsPerSecond >= 25) return 2; // Every 2s when zoomed out
                    if (pixelsPerSecond >= 12) return 5; // Every 5s when more zoomed out
                    if (pixelsPerSecond >= 6) return 10; // Every 10s when very zoomed out
                    return 30; // Every 30s when extremely zoomed out
                  };

                  const interval = getTimeInterval(zoomLevel, duration);
                  const markerCount = Math.max(
                    Math.ceil(duration / interval) + 1,
                    10
                  ); // Ensure at least 10 markers for short content

                  return Array.from({ length: markerCount }, (_, i) => {
                    const time = i * interval;
                    if (time > duration) return null;

                    const isMainMarker =
                      time % (interval >= 1 ? Math.max(1, interval) : 1) === 0;

                    return (
                      <div
                        key={i}
                        className={`absolute top-0 h-4 ${
                          isMainMarker
                            ? "border-l border-muted-foreground/40"
                            : "border-l border-muted-foreground/20"
                        }`}
                        style={{
                          left: `${
                            time *
                            TIMELINE_CONSTANTS.PIXELS_PER_SECOND *
                            zoomLevel
                          }px`,
                        }}
                      >
                        <span
                          className={`absolute top-1 left-1 text-[0.6rem] ${
                            isMainMarker
                              ? "text-muted-foreground font-medium"
                              : "text-muted-foreground/70"
                          }`}
                        >
                          {(() => {
                            const formatTime = (seconds: number) => {
                              const hours = Math.floor(seconds / 3600);
                              const minutes = Math.floor((seconds % 3600) / 60);
                              const secs = seconds % 60;

                              if (hours > 0) {
                                return `${hours}:${minutes
                                  .toString()
                                  .padStart(2, "0")}:${Math.floor(secs)
                                  .toString()
                                  .padStart(2, "0")}`;
                              }
                              if (minutes > 0) {
                                return `${minutes}:${Math.floor(secs)
                                  .toString()
                                  .padStart(2, "0")}`;
                              }

                              // Better formatting for seconds - show more precision for sub-second intervals
                              if (interval >= 1) {
                                return `${Math.floor(secs)}s`;
                              }
                              if (interval >= 0.1) {
                                return `${secs.toFixed(1)}s`;
                              }
                              return `${secs.toFixed(2)}s`;
                            };

                            return formatTime(time);
                          })()}
                        </span>
                      </div>
                    );
                  }).filter(Boolean);
                })()}

                {/* Bookmark markers */}
                {(() => {
                  const { activeProject } = useProjectStore.getState();
                  if (!activeProject?.bookmarks?.length) return null;

                  return activeProject.bookmarks.map((bookmarkTime, i) => (
                    <div
                      key={`bookmark-${i}`}
                      className="absolute top-0 h-10 w-0.5 !bg-primary cursor-pointer"
                      style={{
                        left: `${bookmarkTime * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel}px`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        usePlaybackStore.getState().seek(bookmarkTime);
                      }}
                    >
                      <div className="absolute top-[-1px] left-[-5px] text-primary">
                        <Bookmark className="h-3 w-3 fill-primary" />
                      </div>
                    </div>
                  ));
                })()}

                {/* Deleted word markers (red regions) */}
                {deletedWords.length > 0 &&
                  deletedWords.map((word) => {
                    const left =
                      word.start *
                      TIMELINE_CONSTANTS.PIXELS_PER_SECOND *
                      zoomLevel;
                    const width = Math.max(
                      2,
                      (word.end - word.start) *
                        TIMELINE_CONSTANTS.PIXELS_PER_SECOND *
                        zoomLevel
                    );
                    return (
                      <div
                        key={`deleted-${word.id}`}
                        role="button"
                        tabIndex={0}
                        className="absolute bottom-0 h-2 bg-red-500/60 cursor-pointer hover:bg-red-500/80 focus:ring-2 focus:ring-red-400 focus:outline-none transition-colors"
                        style={{
                          left: `${left}px`,
                          width: `${width}px`,
                        }}
                        aria-label={`Deleted word: ${word.text}, ${word.start.toFixed(2)} to ${word.end.toFixed(2)} seconds`}
                        onClick={(e) => {
                          e.stopPropagation();
                          usePlaybackStore.getState().seek(word.start);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            usePlaybackStore.getState().seek(word.start);
                          }
                        }}
                      />
                    );
                  })}
              </div>
            </div>
          </div>
        </div>

        {/* Tracks Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Track Labels */}
          {tracks.length > 0 && (
            <div
              ref={trackLabelsRef}
              className="w-48 shrink-0 border-r border-black overflow-y-auto z-200 bg-panel"
              data-track-labels
            >
              <ScrollArea className="w-full h-full" ref={trackLabelsScrollRef}>
                <div className="flex flex-col gap-1">
                  {tracks.map((track) => (
                    <div
                      key={track.id}
                      className="flex items-center px-3 border-b border-muted/30 group bg-foreground/5"
                      style={{ height: `${getTrackHeight(track.type)}px` }}
                    >
                      <div className="flex items-center flex-1 min-w-0">
                        <TrackIcon type={track.type} />
                      </div>
                      {track.muted && (
                        <span className="ml-2 text-xs text-red-500 font-semibold shrink-0">
                          Muted
                        </span>
                      )}
                    </div>
                  ))}
                  {/* Effects Track Label */}
                  {EFFECTS_ENABLED && tracks.length > 0 && showEffectsTrack && (
                    <div
                      className="flex items-center px-3 border-t-2 border-purple-500/30 group bg-purple-500/10"
                      style={{ height: "64px" }}
                    >
                      <div className="flex items-center flex-1 min-w-0">
                        <span className="text-sm text-purple-400">Effects</span>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Timeline Tracks Content */}
          <div
            className="flex-1 relative overflow-hidden"
            onWheel={(e) => {
              // Check if this is horizontal scrolling - if so, don't handle it here
              if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                return; // Let scroll container handle horizontal scrolling
              }
              handleWheel(e);
            }}
            onMouseDown={(e) => {
              handleTimelineMouseDown(e);
              handleSelectionMouseDown(e);
            }}
            onClick={handleTimelineContentClick}
            ref={tracksContainerRef}
          >
            <SelectionBox
              startPos={selectionBox?.startPos || null}
              currentPos={selectionBox?.currentPos || null}
              containerRef={tracksContainerRef}
              isActive={selectionBox?.isActive || false}
            />
            <div
              className="w-full h-full overflow-x-auto overflow-y-auto timeline-scroll"
              ref={tracksScrollRef}
            >
              <div
                className="relative flex-1"
                style={{
                  height: `${Math.max(
                    200,
                    Math.min(
                      800,
                      getTotalTracksHeight(tracks) +
                        (EFFECTS_ENABLED &&
                        tracks.length > 0 &&
                        showEffectsTrack
                          ? TIMELINE_CONSTANTS.TRACK_HEIGHT
                          : 0)
                    )
                  )}px`,
                  width: `${dynamicTimelineWidth}px`,
                }}
              >
                {tracks.length === 0 ? (
                  <div />
                ) : (
                  <>
                    {tracks.map((track, index) => (
                      <ContextMenu key={track.id}>
                        <ContextMenuTrigger asChild>
                          <div
                            className="absolute left-0 right-0 border-b border-muted/30 py-[0.05rem]"
                            style={{
                              top: `${getCumulativeHeightBefore(
                                tracks,
                                index
                              )}px`,
                              height: `${getTrackHeight(track.type)}px`,
                            }}
                            onClick={(e) => {
                              // If clicking empty area (not on a element), deselect all elements
                              if (
                                !(e.target as HTMLElement).closest(
                                  ".timeline-element"
                                )
                              ) {
                                clearSelectedElements();
                              }
                            }}
                          >
                            <TimelineTrackContent
                              track={track}
                              zoomLevel={zoomLevel}
                              onSnapPointChange={handleSnapPointChange}
                            />
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="z-200">
                          <ContextMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTrackMute(track.id);
                            }}
                          >
                            {track.muted ? "Unmute Track" : "Mute Track"}
                          </ContextMenuItem>
                          <ContextMenuItem onClick={(e) => e.stopPropagation()}>
                            Track settings (soon)
                          </ContextMenuItem>
                          {activeProject?.bookmarks?.length &&
                            activeProject.bookmarks.length > 0 && (
                              <>
                                <ContextMenuItem disabled>
                                  Bookmarks
                                </ContextMenuItem>
                                {activeProject.bookmarks.map(
                                  (bookmarkTime, i) => (
                                    <ContextMenuItem
                                      key={`bookmark-menu-${i}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        seek(bookmarkTime);
                                      }}
                                    >
                                      <Bookmark className="h-3 w-3 mr-2 inline-block" />
                                      {bookmarkTime.toFixed(1)}s
                                    </ContextMenuItem>
                                  )
                                )}
                              </>
                            )}
                        </ContextMenuContent>
                      </ContextMenu>
                    ))}
                    {/* Effects Timeline Visualization */}
                    {EFFECTS_ENABLED &&
                      tracks.length > 0 &&
                      showEffectsTrack && (
                        <div
                          className="absolute left-0 right-0 border-t-2 border-purple-500/30"
                          style={{
                            top: `${getTotalTracksHeight(tracks)}px`,
                            height: `${TIMELINE_CONSTANTS.TRACK_HEIGHT}px`,
                          }}
                        >
                          <EffectsTimeline
                            tracks={tracks}
                            pixelsPerSecond={
                              TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel
                            }
                          />
                        </div>
                      )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
