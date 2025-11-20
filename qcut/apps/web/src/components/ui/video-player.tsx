"use client";

import { useRef, useEffect } from "react";
import { usePlaybackStore } from "@/stores/playback-store";
import { debugLog } from "@/lib/debug-config";

interface VideoPlayerProps {
  videoId?: string;
  src: string;
  poster?: string;
  className?: string;
  style?: React.CSSProperties;
  clipStartTime: number;
  trimStart: number;
  trimEnd: number;
  clipDuration: number;
}

export function VideoPlayer({
  videoId,
  src,
  poster,
  className = "",
  style,
  clipStartTime,
  trimStart,
  trimEnd,
  clipDuration,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previousSrcRef = useRef<string | null>(null);
  const { isPlaying, currentTime, volume, speed, muted } = usePlaybackStore();

  // Calculate if we're within this clip's timeline range
  const clipEndTime = clipStartTime + (clipDuration - trimStart - trimEnd);
  const isInClipRange =
    currentTime >= clipStartTime && currentTime < clipEndTime;

  // Sync playback events
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isInClipRange) return;

    const handleSeekEvent = (e: CustomEvent) => {
      // Always update video time, even if outside clip range
      const timelineTime = e.detail.time;
      const videoTime = Math.max(
        trimStart,
        Math.min(
          clipDuration - trimEnd,
          timelineTime - clipStartTime + trimStart
        )
      );
      video.currentTime = videoTime;
      debugLog("step 9: video player seeked", {
        videoId: videoId ?? src,
        timelineTime,
        calculatedVideoTime: videoTime,
        wasPlaying: !video.paused,
      });
    };

    const handleUpdateEvent = (e: CustomEvent) => {
      // Always update video time, even if outside clip range
      const timelineTime = e.detail.time;
      const targetTime = Math.max(
        trimStart,
        Math.min(
          clipDuration - trimEnd,
          timelineTime - clipStartTime + trimStart
        )
      );

      if (Math.abs(video.currentTime - targetTime) > 0.5) {
        video.currentTime = targetTime;
      }
      debugLog("step 4: video player synced", {
        videoId: videoId ?? src,
        timelineTime,
        videoTime: targetTime,
        trimStart,
        clipStartTime,
      });
    };

    const handleSpeed = (e: CustomEvent) => {
      video.playbackRate = e.detail.speed;
    };

    window.addEventListener("playback-seek", handleSeekEvent as EventListener);
    window.addEventListener(
      "playback-update",
      handleUpdateEvent as EventListener
    );
    window.addEventListener("playback-speed", handleSpeed as EventListener);

    return () => {
      window.removeEventListener(
        "playback-seek",
        handleSeekEvent as EventListener
      );
      window.removeEventListener(
        "playback-update",
        handleUpdateEvent as EventListener
      );
      window.removeEventListener(
        "playback-speed",
        handleSpeed as EventListener
      );
    };
  }, [clipStartTime, trimStart, trimEnd, clipDuration, isInClipRange, videoId, src]);

  // Sync playback state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying && isInClipRange) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying, isInClipRange]);

  // Sync volume and speed
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = volume;
    video.muted = muted;
    video.playbackRate = speed;
  }, [volume, speed, muted]);

  // Check video element dimensions on mount
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Dimensions will be checked by video element itself
  }, []);

  // Video source tracking
  useEffect(() => {
    const prev = previousSrcRef.current;
    if (prev && prev !== src && prev.startsWith("blob:")) {
      URL.revokeObjectURL(prev);
    }

    previousSrcRef.current = src;

    return () => {
      if (previousSrcRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(previousSrcRef.current);
        previousSrcRef.current = null;
      }
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      className={`object-contain ${className}`}
      playsInline
      preload="auto"
      controls={false}
      disablePictureInPicture
      disableRemotePlayback
      style={{
        pointerEvents: "none",
        width: "100%",
        height: "100%",
        ...style,
      }}
      onContextMenu={(e) => e.preventDefault()}
      onLoadedMetadata={(e) => {
        // Video metadata loaded
      }}
      onError={(e) => {
        console.error("[VideoPlayer] Video error:", e, "src:", src);
        if (src.includes("fal.media")) {
          console.error(
            "🚨 CSP FIX NEEDED: FAL.ai video blocked by Content Security Policy"
          );
          console.error(
            "   - Add https://fal.media https://v3.fal.media https://v3b.fal.media to media-src CSP directive"
          );
        }
      }}
      onCanPlay={() => {
        console.log("✅ [VideoPlayer] Video ready to play:", src);
        if (src.includes("fal.media")) {
          console.log("🎉 CSP FIX SUCCESS: FAL.ai video loaded successfully!");
          console.log("   - URL:", src.substring(0, 50) + "...");
        }
      }}
    />
  );
}
