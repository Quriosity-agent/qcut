import { useRef, useCallback } from "react";
import { TimelineTrack, TimelineElement } from "@/types/timeline";
import { MediaItem } from "@/stores/media-store-types";

interface CachedFrame {
  imageData: ImageData;
  timelineHash: string;
  timestamp: number;
}

interface FrameCacheOptions {
  maxCacheSize?: number;
  cacheResolution?: number;
}

export function useFrameCache(options: FrameCacheOptions = {}) {
  const { maxCacheSize = 300, cacheResolution = 30 } = options; // 10 seconds at 30fps
  const frameCacheRef = useRef(new Map<number, CachedFrame>());

  // Generate a hash of the timeline state that affects rendering
  const getTimelineHash = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaItems: MediaItem[],
      activeProject: any
    ): string => {
      // Get elements that are active at this time
      const activeElements: Array<{
        id: string;
        type: string;
        startTime: number;
        duration: number;
        trimStart: number;
        trimEnd: number;
        mediaId?: string;
      }> = [];

      for (const track of tracks) {
        if (track.muted) continue;

        for (const element of track.elements) {
          // Check if element has hidden property
          const isHidden = "hidden" in element ? element.hidden : false;
          if (isHidden) continue;

          const elementStart = element.startTime;
          const elementEnd =
            element.startTime +
            (element.duration - element.trimStart - element.trimEnd);

          if (time >= elementStart && time < elementEnd) {
            activeElements.push({
              id: element.id,
              type: element.type,
              startTime: element.startTime,
              duration: element.duration,
              trimStart: element.trimStart,
              trimEnd: element.trimEnd,
              mediaId:
                element.type === "media" ? (element as any).mediaId : undefined,
            });
          }
        }
      }

      // Include project settings that affect rendering
      const projectState = {
        backgroundColor: activeProject?.backgroundColor,
        backgroundType: activeProject?.backgroundType,
        blurIntensity: activeProject?.blurIntensity,
        canvasSize: activeProject?.canvasSize,
      };

      return JSON.stringify({
        activeElements,
        projectState,
        time: Math.floor(time * cacheResolution) / cacheResolution, // Quantize time
      });
    },
    [cacheResolution]
  );

  // Get cached frame if available and valid
  const getCachedFrame = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaItems: MediaItem[],
      activeProject: any
    ): ImageData | null => {
      const frameTime = Math.floor(time * cacheResolution) / cacheResolution;
      const cached = frameCacheRef.current.get(frameTime);

      if (!cached) return null;

      const currentHash = getTimelineHash(
        time,
        tracks,
        mediaItems,
        activeProject
      );
      if (cached.timelineHash !== currentHash) {
        // Cache is stale, remove it
        frameCacheRef.current.delete(frameTime);
        return null;
      }

      return cached.imageData;
    },
    [getTimelineHash, cacheResolution]
  );

  // Cache a rendered frame
  const cacheFrame = useCallback(
    (
      time: number,
      imageData: ImageData,
      tracks: TimelineTrack[],
      mediaItems: MediaItem[],
      activeProject: any
    ): void => {
      const frameTime = Math.floor(time * cacheResolution) / cacheResolution;
      const timelineHash = getTimelineHash(
        time,
        tracks,
        mediaItems,
        activeProject
      );

      // LRU eviction if cache is full
      if (frameCacheRef.current.size >= maxCacheSize) {
        // Get oldest entry (first in Map)
        const firstKey = frameCacheRef.current.keys().next().value;
        if (firstKey !== undefined) {
          frameCacheRef.current.delete(firstKey);
        }
      }

      frameCacheRef.current.set(frameTime, {
        imageData,
        timelineHash,
        timestamp: Date.now(),
      });
    },
    [getTimelineHash, cacheResolution, maxCacheSize]
  );

  // Clear cache when timeline changes significantly
  const invalidateCache = useCallback(() => {
    frameCacheRef.current.clear();
  }, []);

  // Get render status for timeline indicator
  const getRenderStatus = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaItems: MediaItem[],
      activeProject: any
    ): "cached" | "not-cached" => {
      const frameTime = Math.floor(time * cacheResolution) / cacheResolution;
      const cached = frameCacheRef.current.get(frameTime);

      if (!cached) return "not-cached";

      const currentHash = getTimelineHash(
        time,
        tracks,
        mediaItems,
        activeProject
      );
      return cached.timelineHash === currentHash ? "cached" : "not-cached";
    },
    [getTimelineHash, cacheResolution]
  );

  return {
    getCachedFrame,
    cacheFrame,
    invalidateCache,
    getRenderStatus,
    cacheSize: frameCacheRef.current.size,
  };
}
