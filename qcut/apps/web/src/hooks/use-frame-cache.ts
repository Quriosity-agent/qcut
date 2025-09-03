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

  // Helper to check if a frame is cached and valid
  const isFrameCached = useCallback(
    (
      time: number,
      tracks: TimelineTrack[],
      mediaItems: MediaItem[],
      activeProject: any
    ): boolean => {
      return (
        getRenderStatus(time, tracks, mediaItems, activeProject) === "cached"
      );
    },
    [getRenderStatus]
  );

  // Pre-render frames around current time during idle time
  const preRenderNearbyFrames = useCallback(
    async (
      currentTime: number,
      renderFunction: (time: number) => Promise<ImageData>,
      range: number = 2, // seconds before and after
      tracks?: TimelineTrack[],
      mediaItems?: MediaItem[],
      activeProject?: any
    ) => {
      if (!tracks || !mediaItems) return;

      const framesToPreRender: number[] = [];

      // Calculate frames to pre-render at the configured resolution
      for (
        let offset = -range;
        offset <= range;
        offset += 1 / cacheResolution
      ) {
        const time = currentTime + offset;
        if (time < 0) continue;

        if (!isFrameCached(time, tracks, mediaItems, activeProject)) {
          framesToPreRender.push(
            Math.floor(time * cacheResolution) / cacheResolution
          );
        }
      }

      // Limit pre-render count to avoid heavy work
      const limited = framesToPreRender.slice(0, 30);

      for (const time of limited) {
        // Schedule during idle time to avoid blocking UI
        (window as any).requestIdleCallback?.(() => {
          (async () => {
            try {
              const imageData = await renderFunction(time);
              cacheFrame(time, imageData, tracks, mediaItems, activeProject);
            } catch (error) {
              console.warn(`Pre-render failed for time ${time}:`, error);
            }
          })();
        }, { timeout: 1000 }) ||
          // Fallback if requestIdleCallback is unavailable
          setTimeout(async () => {
            try {
              const imageData = await renderFunction(time);
              cacheFrame(time, imageData, tracks, mediaItems, activeProject);
            } catch (error) {
              console.warn(`Pre-render failed for time ${time}:`, error);
            }
          }, 0);
      }
    },
    [cacheFrame, cacheResolution, isFrameCached]
  );

  return {
    getCachedFrame,
    cacheFrame,
    invalidateCache,
    getRenderStatus,
    isFrameCached,
    preRenderNearbyFrames,
    cacheSize: frameCacheRef.current.size,
  };
}
