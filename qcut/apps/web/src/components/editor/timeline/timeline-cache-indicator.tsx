"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { TimelineTrack } from "@/types/timeline";
import { MediaItem } from "@/stores/media-store-types";
import { TProject } from "@/types/project";

interface CacheSegment {
  startTime: number;
  endTime: number;
  cached: boolean;
}

interface TimelineCacheIndicatorProps {
  duration: number;
  zoomLevel: number;
  tracks: TimelineTrack[];
  mediaItems: MediaItem[];
  activeProject: TProject | null;
  getRenderStatus: (
    time: number,
    tracks: TimelineTrack[],
    mediaItems: MediaItem[],
    activeProject: TProject | null
  ) => "cached" | "not-cached";
  cacheResolution?: number; // optional, for step alignment
}

export function TimelineCacheIndicator({
  duration,
  zoomLevel,
  tracks,
  mediaItems,
  activeProject,
  getRenderStatus,
}: TimelineCacheIndicatorProps) {
  // Calculate cache segments by sampling the timeline (memoized)
  const cacheSegments = useMemo<CacheSegment[]>(() => {
    if (!duration || duration <= 0) {
      return [{ startTime: 0, endTime: 0, cached: false }];
    }
    // Bound total samples to avoid excessive work on long timelines
    const MAX_SAMPLES = 2000;
    const quantStep = 1 / 30; // Default to 30fps resolution
    const approxStep = Math.max(duration / MAX_SAMPLES, quantStep);
    const total = Math.ceil(duration / approxStep);

    const segments: CacheSegment[] = [];
    let current: CacheSegment | null = null;

    for (let i = 0; i <= total; i++) {
      const time = Math.min(i * approxStep, duration);
      const cached =
        getRenderStatus(time, tracks, mediaItems, activeProject) === "cached";
      if (!current) {
        current = { startTime: time, endTime: time, cached };
      } else if (current.cached === cached) {
        current.endTime = time;
      } else {
        segments.push(current);
        current = { startTime: time, endTime: time, cached };
      }
    }
    if (current) {
      current.endTime = duration;
      segments.push(current);
    }
    return segments;
  }, [duration, tracks, mediaItems, activeProject, getRenderStatus]);

  return (
    <div className="absolute top-0 left-0 right-0 h-px z-10 pointer-events-none">
      {cacheSegments.map((segment, index) => {
        const startX =
          segment.startTime * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
        const endX =
          segment.endTime * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
        const width = endX - startX;

        return (
          <div
            key={`${segment.startTime}-${segment.endTime}-${segment.cached ? 1 : 0}`}
            className={cn(
              "absolute top-0 h-px",
              segment.cached ? "bg-primary" : "bg-border"
            )}
            style={{
              left: `${startX}px`,
              width: `${width}px`,
            }}
            title={
              segment.cached
                ? "Cached (fast playback)"
                : "Not cached (will render)"
            }
          />
        );
      })}
    </div>
  );
}
