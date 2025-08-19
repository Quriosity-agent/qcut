"use client";

import { useRef, useState, useEffect, memo, useCallback } from "react";
import { TimelineTrack } from "@/types/timeline";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { useTimelinePlayhead } from "@/hooks/use-timeline-playhead";
import { usePlaybackStore } from "@/stores/playback-store";

interface TimelinePlayheadProps {
  currentTime: number;
  duration: number;
  zoomLevel: number;
  tracks: TimelineTrack[];
  seek: (time: number) => void;
  rulerRef: React.RefObject<HTMLDivElement>;
  rulerScrollRef: React.RefObject<HTMLDivElement>;
  tracksScrollRef: React.RefObject<HTMLDivElement>;
  trackLabelsRef?: React.RefObject<HTMLDivElement>;
  timelineRef: React.RefObject<HTMLDivElement>;
  playheadRef?: React.RefObject<HTMLDivElement>;
  isSnappingToPlayhead?: boolean;
}

export const TimelinePlayhead = memo(function TimelinePlayhead({
  currentTime: initialTime,
  duration,
  zoomLevel,
  tracks,
  seek,
  rulerRef,
  rulerScrollRef,
  tracksScrollRef,
  trackLabelsRef,
  timelineRef,
  playheadRef: externalPlayheadRef,
  isSnappingToPlayhead = false,
}: TimelinePlayheadProps) {
  const internalPlayheadRef = useRef<HTMLDivElement>(null);
  const playheadRef = externalPlayheadRef || internalPlayheadRef;
  
  // Use RAF to update position without re-renders
  const rafRef = useRef<number>();
  const scrollLeftRef = useRef(0);
  const currentTimeRef = useRef(initialTime);
  const isPlayingRef = useRef(false);
  
  // Only track if we're dragging, not the position
  const [isDragging, setIsDragging] = useState(false);
  
  const { playheadPosition, handlePlayheadMouseDown } = useTimelinePlayhead({
    currentTime: currentTimeRef.current,
    duration,
    zoomLevel,
    seek,
    rulerRef,
    rulerScrollRef,
    tracksScrollRef,
    playheadRef,
  });

  // Update refs without re-rendering
  useEffect(() => {
    currentTimeRef.current = initialTime;
  }, [initialTime]);

  // Subscribe to playback state separately
  useEffect(() => {
    const unsubscribe = usePlaybackStore.subscribe((state) => {
      isPlayingRef.current = state.isPlaying;
      return state.isPlaying;
    });
    return unsubscribe;
  }, []);

  // Track scroll position using passive listener
  useEffect(() => {
    const tracksViewport = (tracksScrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) || tracksScrollRef.current) as HTMLElement;

    if (!tracksViewport) return;

    const handleScroll = () => {
      scrollLeftRef.current = tracksViewport.scrollLeft;
    };

    // Set initial scroll position
    scrollLeftRef.current = tracksViewport.scrollLeft;

    tracksViewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => tracksViewport.removeEventListener("scroll", handleScroll);
  }, [tracksScrollRef]);

  // Update playhead position using RAF for smooth animation
  const updatePlayheadPosition = useCallback(() => {
    if (!playheadRef.current) return;
    
    const timelineContainerHeight = timelineRef.current?.offsetHeight || 400;
    const totalHeight = timelineContainerHeight - 8;
    
    const trackLabelsWidth =
      tracks.length > 0 && trackLabelsRef?.current
        ? trackLabelsRef.current.offsetWidth
        : 0;
    
    // Use current time from ref (updated by store subscription)
    const currentTime = isDragging ? playheadPosition : currentTimeRef.current;
    const timelinePosition =
      currentTime * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
    const rawLeftPosition = trackLabelsWidth + timelinePosition - scrollLeftRef.current;
    
    const timelineContentWidth =
      duration * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
    const tracksViewport = (tracksScrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) || tracksScrollRef.current) as HTMLElement;
    const viewportWidth = tracksViewport?.clientWidth || 1000;
    
    const leftBoundary = trackLabelsWidth;
    const rightBoundary = Math.min(
      trackLabelsWidth + timelineContentWidth - scrollLeftRef.current,
      trackLabelsWidth + viewportWidth
    );
    
    const leftPosition = Math.max(
      leftBoundary,
      Math.min(rightBoundary, rawLeftPosition)
    );
    
    // Update DOM directly without React re-render
    playheadRef.current.style.transform = `translateX(${leftPosition}px)`;
    playheadRef.current.style.height = `${totalHeight}px`;
  }, [
    playheadRef,
    timelineRef,
    tracks.length,
    trackLabelsRef,
    tracksScrollRef,
    duration,
    zoomLevel,
    isDragging,
    playheadPosition,
  ]);

  // Use RAF loop for smooth updates during playback
  useEffect(() => {
    const animate = () => {
      updatePlayheadPosition();
      
      // Continue animation if playing
      if (isPlayingRef.current) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };
    
    // Start animation if playing
    if (isPlayingRef.current) {
      rafRef.current = requestAnimationFrame(animate);
    } else {
      // Single update when not playing
      updatePlayheadPosition();
    }
    
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [updatePlayheadPosition]);

  // Update on scroll or resize
  useEffect(() => {
    updatePlayheadPosition();
  }, [updatePlayheadPosition]);

  // Subscribe to exact currentTime updates
  useEffect(() => {
    const unsubscribe = usePlaybackStore.subscribe((state) => {
      currentTimeRef.current = state.currentTime;
      // Only update if not playing (RAF handles it during playback)
      if (!isPlayingRef.current) {
        updatePlayheadPosition();
      }
      return state.currentTime;
    });
    return unsubscribe;
  }, [updatePlayheadPosition]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      handlePlayheadMouseDown(e);
    },
    [handlePlayheadMouseDown]
  );

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
    };
    
    if (isDragging) {
      window.addEventListener("mouseup", handleMouseUp);
      return () => window.removeEventListener("mouseup", handleMouseUp);
    }
  }, [isDragging]);

  return (
    <div
      ref={playheadRef}
      className="absolute pointer-events-auto z-150"
      style={{
        left: 0,
        top: 0,
        width: "2px",
        transform: "translateX(0px)", // Will be updated by RAF
      }}
      onMouseDown={handleMouseDown}
    >
      {/* The playhead line spanning full height */}
      <div
        className={`absolute left-0 w-0.5 cursor-col-resize h-full ${
          isSnappingToPlayhead ? "bg-primary" : "bg-foreground"
        }`}
      />

      {/* Playhead dot indicator at the top (in ruler area) */}
      <div
        className={`absolute top-1 left-1/2 transform -translate-x-1/2 w-3 h-3 rounded-full border-2 shadow-xs ${
          isSnappingToPlayhead
            ? "bg-primary border-primary"
            : "bg-foreground border-foreground"
        }`}
      />
    </div>
  );
});

// Also export a hook for getting ruler handlers
export function useTimelinePlayheadRuler({
  currentTime,
  duration,
  zoomLevel,
  seek,
  rulerRef,
  rulerScrollRef,
  tracksScrollRef,
  playheadRef,
}: Omit<TimelinePlayheadProps, "tracks" | "trackLabelsRef" | "timelineRef">) {
  const { handleRulerMouseDown, isDraggingRuler } = useTimelinePlayhead({
    currentTime,
    duration,
    zoomLevel,
    seek,
    rulerRef,
    rulerScrollRef,
    tracksScrollRef,
    playheadRef,
  });

  return { handleRulerMouseDown, isDraggingRuler };
}

export { TimelinePlayhead as default };