"use client";

import { useRef, useEffect } from "react";
import type { CSSProperties } from "react";
import { usePlaybackStore } from "@/stores/playback-store";
import type { VideoSource } from "@/lib/media-source";
import { createObjectURL, revokeObjectURL } from "@/lib/blob-manager";

interface VideoPlayerProps {
  videoId?: string;
  videoSource: VideoSource | null;
  poster?: string;
  className?: string;
  style?: CSSProperties;
  clipStartTime: number;
  trimStart: number;
  trimEnd: number;
  clipDuration: number;
}

export function VideoPlayer({
  videoId,
  videoSource,
  poster,
  className = "",
  style,
  clipStartTime,
  trimStart,
  trimEnd,
  clipDuration,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const pendingCleanupRef = useRef<string | null>(null);
  const videoLoadedRef = useRef(false);
  const { isPlaying, currentTime, volume, speed, muted } = usePlaybackStore();
  const timelineTimeRef = useRef(currentTime);

  useEffect(() => {
    timelineTimeRef.current = currentTime;
  }, [currentTime]);

  // Calculate if we're within this clip's timeline range
  const clipEndTime = clipStartTime + (clipDuration - trimStart - trimEnd);
  const isInClipRange =
    currentTime >= clipStartTime && currentTime < clipEndTime;

  // Sync playback events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!isInClipRange) {
      return;
    }

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
  }, [clipStartTime, trimStart, trimEnd, clipDuration, isInClipRange]);

  // Sync playback state with readyState check
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlayError = (err: any) => {
      // Silently handle play errors
    };

    if (isPlaying && isInClipRange) {
      // Check if video is ready to play
      if (video.readyState >= 3) {
        video.play().catch(handlePlayError);
      } else {
        // Video not ready, wait for it to be ready
        const handleCanPlay = () => {
          if (isPlaying && isInClipRange) {
            video.play().catch(handlePlayError);
          }
        };

        video.addEventListener("canplay", handleCanPlay, { once: true });

        // Clean up event listener on unmount or state change
        return () => {
          video.removeEventListener("canplay", handleCanPlay);
        };
      }
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

  // Video source tracking with delayed cleanup to prevent race conditions
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSource) return;

    // Reset load state for new source
    videoLoadedRef.current = false;

    if (videoSource.type === "file") {
      // Clean up any pending blob URL from previous source AFTER new one is set
      const previousBlobUrl = pendingCleanupRef.current;

      const blobUrl = createObjectURL(videoSource.file, "VideoPlayer");
      blobUrlRef.current = blobUrl;
      video.src = blobUrl;

      console.log(
        `[VideoPlayer] Created blob URL for ${videoId ?? "video"}: ${blobUrl}`
      );

      // Now safe to revoke previous URL since new one is active
      if (previousBlobUrl && previousBlobUrl !== blobUrl) {
        console.log(
          `[VideoPlayer] Revoking previous blob URL: ${previousBlobUrl}`
        );
        revokeObjectURL(previousBlobUrl, "VideoPlayer-previous");
      }

      // Mark current URL for potential cleanup on unmount
      pendingCleanupRef.current = blobUrl;

      return () => {
        // DON'T revoke here - let the next effect iteration handle it
        // or component unmount cleanup
        console.log(
          `[VideoPlayer] Effect cleanup - blob URL marked for later: ${blobUrl}`
        );
      };
    }

    if (videoSource.type === "remote") {
      video.src = videoSource.src;
      // Clean up any pending blob URL when switching to remote
      if (pendingCleanupRef.current) {
        revokeObjectURL(pendingCleanupRef.current, "VideoPlayer-remote-switch");
        pendingCleanupRef.current = null;
      }
    }

    return () => {
      if (video) {
        video.src = "";
      }
    };
  }, [videoSource, videoId]);

  // Separate cleanup effect for component unmount only
  useEffect(() => {
    return () => {
      // Only revoke on actual component unmount
      if (pendingCleanupRef.current) {
        console.log(
          `[VideoPlayer] Component unmount - revoking: ${pendingCleanupRef.current}`
        );
        revokeObjectURL(pendingCleanupRef.current, "VideoPlayer-unmount");
        pendingCleanupRef.current = null;
      }
    };
  }, []); // Empty deps = only runs on unmount

  return (
    <video
      ref={videoRef}
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
      onLoadedMetadata={() => {
        videoLoadedRef.current = true;
        console.log(`[VideoPlayer] ✅ Video loaded: ${videoId ?? "video"}`);
      }}
      onError={(e) => {
        const video = e.currentTarget;
        const errorCode = video.error?.code;
        const errorMessage = video.error?.message || "Unknown error";
        console.error(`[VideoPlayer] ❌ Video error for ${videoId ?? "video"}:`, {
          code: errorCode,
          message: errorMessage,
          src: video.src?.substring(0, 50) + "...",
          networkState: video.networkState,
          readyState: video.readyState,
        });
        videoLoadedRef.current = false;
      }}
      onCanPlay={() => {
        console.log(`[VideoPlayer] ▶️ Video ready to play: ${videoId ?? "video"}`);
      }}
    />
  );
}
