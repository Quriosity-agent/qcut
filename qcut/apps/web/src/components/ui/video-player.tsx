"use client";

import { useRef, useEffect } from "react";
import type { CSSProperties } from "react";
import { usePlaybackStore } from "@/stores/playback-store";
import type { VideoSource } from "@/lib/media-source";

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

  // Video source tracking
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoSource) return;

    if (videoSource.type === "file") {
      const blobUrl = URL.createObjectURL(videoSource.file);
      blobUrlRef.current = blobUrl;
      video.src = blobUrl;
      console.log(
        `[VideoPlayer] Created blob URL for ${videoId ?? "video"}: ${blobUrl}`
      );

      return () => {
        if (blobUrlRef.current) {
          console.log(
            `[VideoPlayer] Revoking blob URL for ${videoId ?? "video"}: ${
              blobUrlRef.current
            }`
          );
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };
    }
    if (videoSource.type === "remote") {
      video.src = videoSource.src;
    }

    return () => {
      if (video) {
        video.src = "";
      }
    };
  }, [videoSource, videoId]);

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
      onLoadedMetadata={(e) => {
        // Video metadata loaded
      }}
      onError={(e) => {
        // Handle video errors silently
      }}
      onCanPlay={() => {
        // Video ready to play
      }}
    />
  );
}
