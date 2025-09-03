import { useRef, useCallback, useEffect } from "react";
import { openDB, type IDBPDatabase } from "idb";
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
  persist?: boolean;
}

export function useFrameCache(options: FrameCacheOptions = {}) {
  const { maxCacheSize = 300, cacheResolution = 30, persist = false } = options; // 10 seconds at 30fps
  const frameCacheRef = useRef(new Map<number, CachedFrame>());
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      if (!cached) {
        // metrics: miss when no entry
        metricsRef.current.misses++;
        return null;
      }

      const currentHash = getTimelineHash(
        time,
        tracks,
        mediaItems,
        activeProject
      );
      if (cached.timelineHash !== currentHash) {
        // Cache is stale, remove it
        frameCacheRef.current.delete(frameTime);
        metricsRef.current.misses++;
        return null;
      }

      metricsRef.current.hits++;
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
      const startTime = performance.now();
      const frameTime = Math.floor(time * cacheResolution) / cacheResolution;
      const timelineHash = getTimelineHash(
        time,
        tracks,
        mediaItems,
        activeProject
      );

      // Smarter LRU eviction based on access patterns
      if (frameCacheRef.current.size >= maxCacheSize) {
        const entries = Array.from(frameCacheRef.current.entries());
        // Sort by timestamp and distance from current time
        entries.sort((a, b) => {
          const aDistance = Math.abs(a[0] - frameTime);
          const bDistance = Math.abs(b[0] - frameTime);
          const aAge = Date.now() - a[1].timestamp;
          const bAge = Date.now() - b[1].timestamp;
          if (aDistance < 5 && bDistance >= 5) return -1;
          if (bDistance < 5 && aDistance >= 5) return 1;
          return bAge - aAge;
        });
        // Remove oldest ~20%
        const toRemove = Math.max(1, Math.floor(entries.length * 0.2));
        for (let i = 0; i < toRemove; i++) {
          frameCacheRef.current.delete(entries[i][0]);
        }
      }

      frameCacheRef.current.set(frameTime, {
        imageData,
        timelineHash,
        timestamp: Date.now(),
      });

      // metrics: approximate capture/caching time
      const captureTime = performance.now() - startTime;
      metricsRef.current.captureCount++;
      metricsRef.current.avgCaptureTime =
        (metricsRef.current.avgCaptureTime *
          (metricsRef.current.captureCount - 1) +
          captureTime) /
        metricsRef.current.captureCount;

      // schedule persistence if enabled (debounced)
      if (persist) {
        if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
        persistTimerRef.current = setTimeout(() => {
          void saveToIndexedDB();
        }, 1000);
      }
    },
    [getTimelineHash, cacheResolution, maxCacheSize, persist]
  );

  // Clear cache when timeline changes significantly
  const invalidateCache = useCallback(() => {
    frameCacheRef.current.clear();
    if (persist) {
      void saveToIndexedDB();
    }
  }, [persist]);

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
      range: number = 2, // kept for API compatibility
      tracks?: TimelineTrack[],
      mediaItems?: MediaItem[],
      activeProject?: any
    ) => {
      if (!tracks || !mediaItems) return;

      // For safety with DOM-capture rendering, only pre-render the quantized current frame
      const frameTime = Math.floor(currentTime * cacheResolution) / cacheResolution;
      if (!isFrameCached(frameTime, tracks, mediaItems, activeProject)) {
        const schedule = (fn: () => void) =>
          ((window as any).requestIdleCallback
            ? (window as any).requestIdleCallback(fn, { timeout: 1000 })
            : setTimeout(fn, 0));

        schedule(() => {
          (async () => {
            try {
              const imageData = await renderFunction(frameTime);
              cacheFrame(frameTime, imageData, tracks, mediaItems, activeProject);
            } catch (error) {
              // Silently ignore if render couldn't proceed (e.g., targeted time capture unsupported)
            }
          })();
        });
      }
    },
    [cacheFrame, cacheResolution, isFrameCached]
  );

  // Performance metrics
  interface CacheMetrics {
    hits: number;
    misses: number;
    avgCaptureTime: number;
    captureCount: number;
  }
  const metricsRef = useRef<CacheMetrics>({
    hits: 0,
    misses: 0,
    avgCaptureTime: 0,
    captureCount: 0,
  });

  // IndexedDB persistence helpers
  const saveToIndexedDB = useCallback(async () => {
    if (!persist) return;
    try {
      const db = await openDB("frame-cache", 1, {
        upgrade(db: IDBPDatabase) {
          if (!db.objectStoreNames.contains("frames")) {
            db.createObjectStore("frames");
          }
        },
      });

      const cacheArray = Array.from(frameCacheRef.current.entries()).map(
        ([key, value]) => ({
          key,
          imageData: value.imageData,
          timelineHash: value.timelineHash,
          timestamp: value.timestamp,
        })
      );

      await db.put("frames", cacheArray, "cache-snapshot");
    } catch (error) {
      console.warn("Failed to persist cache:", error);
    }
  }, [persist]);

  const restoreFromIndexedDB = useCallback(async () => {
    if (!persist) return;
    try {
      const db = await openDB("frame-cache", 1);
      const cacheArray: any = await db.get("frames", "cache-snapshot");
      if (cacheArray && Array.isArray(cacheArray)) {
        frameCacheRef.current.clear();
        for (const item of cacheArray) {
          frameCacheRef.current.set(item.key, {
            imageData: item.imageData,
            timelineHash: item.timelineHash,
            timestamp: item.timestamp,
          });
        }
      }
    } catch (error) {
      console.warn("Failed to restore cache:", error);
    }
  }, [persist]);

  // Restore on mount when persistence enabled
  useEffect(() => {
    if (persist) {
      void restoreFromIndexedDB();
    }
  }, [persist, restoreFromIndexedDB]);

  return {
    getCachedFrame,
    cacheFrame,
    invalidateCache,
    getRenderStatus,
    isFrameCached,
    preRenderNearbyFrames,
    cacheMetrics: metricsRef.current,
    cacheHitRate:
      (metricsRef.current.hits || 0) /
      Math.max(1, metricsRef.current.hits + metricsRef.current.misses),
    cacheSize: frameCacheRef.current.size,
  };
}
