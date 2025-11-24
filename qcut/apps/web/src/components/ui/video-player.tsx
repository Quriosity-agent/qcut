"use client";

import { useRef, useEffect } from "react";
import {
  markBlobInUse,
  revokeObjectURL as revokeManagedObjectURL,
  unmarkBlobInUse,
} from "@/lib/blob-manager";
import { usePlaybackStore } from "@/stores/playback-store";

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
  const loggedOutOfRangeRef = useRef(false);
  const lastTimeUpdateLogRef = useRef<number>(-1);
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
      if (!loggedOutOfRangeRef.current) {
        console.warn(
          "[CANVAS-VIDEO] Skipping video events (out of clip range)",
          {
            videoId: videoId ?? src,
            currentTime: timelineTimeRef.current,
            clipStartTime,
            clipEndTime,
            trimStart,
            trimEnd,
            clipDuration,
          }
        );
        loggedOutOfRangeRef.current = true;
      }
      return;
    }
    loggedOutOfRangeRef.current = false;

    console.log("[CANVAS-VIDEO] Attaching playback listeners", {
      videoId: videoId ?? src,
      clipStartTime,
      clipEndTime,
      trimStart,
      trimEnd,
    });
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
      console.log("step 9: video player seeked", {
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
      console.log("step 4: video player synced", {
        videoId: videoId ?? src,
        timelineTime,
        videoTime: targetTime,
        trimStart,
        clipStartTime,
        clipDuration,
        videoElement: {
          readyState: video.readyState,
          currentTime: Number(video.currentTime.toFixed(3)),
          duration: Number(video.duration.toFixed(3)),
        },
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
  }, [
    clipStartTime,
    clipEndTime,
    trimStart,
    trimEnd,
    clipDuration,
    isInClipRange,
    videoId,
    src,
  ]);

  // Instrument video element lifecycle for diagnostics
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const logState = (label: string, extra?: Record<string, unknown>) => {
      const msgParts = [
        `id=${videoId ?? src}`,
        `t=${video.currentTime.toFixed(3)}`,
        `rs=${video.readyState}`,
        `ns=${video.networkState}`,
        video.paused ? "paused" : "playing",
      ];
      if (extra) {
        Object.entries(extra).forEach(([k, v]) =>
          msgParts.push(`${k}=${String(v)}`)
        );
      }
      console.log(`[CANVAS-VIDEO] ${label} | ${msgParts.join(" | ")}`);
    };

    const handleLoadedMetadata = () => logState("loadedmetadata");
    const handleCanPlay = () => logState("canplay");
    const handlePlay = () => logState("play()");
    const handlePlaying = () => logState("playing");
    const handlePause = () => logState("pause()");
    const handleEnded = () => logState("ended");
    const handleStalled = () => logState("stalled");
    const handleWaiting = () => logState("waiting");
    const handleSeeking = () => logState("seeking");
    const handleSeeked = () => logState("seeked");
    const handleError = () =>
      logState("error", {
        error:
          video.error &&
          `${video.error.code}:${video.error.message ?? "no-message"}`,
      });
    const handleTimeUpdate = () => {
      // Throttle noisy timeupdate logs to every ~0.25s progression
      if (
        lastTimeUpdateLogRef.current >= 0 &&
        Math.abs(video.currentTime - lastTimeUpdateLogRef.current) < 0.25
      ) {
        return;
      }
      lastTimeUpdateLogRef.current = video.currentTime;
      logState("timeupdate");
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("play", handlePlay);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("stalled", handleStalled);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("seeking", handleSeeking);
    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("error", handleError);
    video.addEventListener("timeupdate", handleTimeUpdate);
    logState("attach-listeners");

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("stalled", handleStalled);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("seeking", handleSeeking);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [videoId, src]);

  // Sync playback state with readyState check
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlayError = (err: any) => {
      console.error("[CANVAS-VIDEO] play() failed", {
        error: err?.message || String(err),
        videoState: {
          currentTime: Number(video.currentTime.toFixed(3)),
          readyState: video.readyState,
          networkState: video.networkState,
          paused: video.paused,
          seeking: video.seeking,
        },
        reason:
          video.readyState < 3
            ? "Video not ready (buffering needed)"
            : "Play interrupted or other error",
      });
    };

    if (isPlaying && isInClipRange) {
      // Check if video is ready to play
      if (video.readyState >= 3) {
        console.log("[CANVAS-VIDEO] ✅ Video ready, playing immediately", {
          videoId: videoId ?? src,
          currentTime: Number(video.currentTime.toFixed(3)),
          readyState: video.readyState,
          readyStateText:
            video.readyState === 3 ? "HAVE_FUTURE_DATA" : "HAVE_ENOUGH_DATA",
          paused: video.paused,
          duration: Number(video.duration.toFixed(3)),
          seeking: video.seeking,
        });
        video
          .play()
          .then(() => {
            console.log("[CANVAS-VIDEO] ✅ play() succeeded", {
              videoId: videoId ?? src,
              readyState: video.readyState,
              currentTime: Number(video.currentTime.toFixed(3)),
            });
          })
          .catch(handlePlayError);
      } else {
        // Video not ready, wait for it to be ready
        console.log(
          "[CANVAS-VIDEO] ⏳ Video not ready, waiting for canplay event",
          {
            videoId: videoId ?? src,
            currentReadyState: video.readyState,
            readyStateText:
              ["HAVE_NOTHING", "HAVE_METADATA", "HAVE_CURRENT_DATA"][
                video.readyState
              ] || "UNKNOWN",
            needsReadyState: 3,
            currentTime: Number(video.currentTime.toFixed(3)),
            paused: video.paused,
          }
        );

        const handleCanPlay = () => {
          if (isPlaying && isInClipRange) {
            console.log(
              "[CANVAS-VIDEO] ✅ canplay event fired, attempting play",
              {
                videoId: videoId ?? src,
                readyState: video.readyState,
                readyStateText:
                  video.readyState === 3
                    ? "HAVE_FUTURE_DATA"
                    : "HAVE_ENOUGH_DATA",
                currentTime: Number(video.currentTime.toFixed(3)),
              }
            );
            video
              .play()
              .then(() => {
                console.log(
                  "[CANVAS-VIDEO] ✅ play() succeeded after canplay",
                  {
                    videoId: videoId ?? src,
                    readyState: video.readyState,
                    currentTime: Number(video.currentTime.toFixed(3)),
                  }
                );
              })
              .catch(handlePlayError);
          } else {
            console.log(
              "[CANVAS-VIDEO] ⚠️ canplay fired but playback no longer needed",
              {
                videoId: videoId ?? src,
                isPlaying,
                isInClipRange,
              }
            );
          }
        };

        video.addEventListener("canplay", handleCanPlay, { once: true });

        // Clean up event listener on unmount or state change
        return () => {
          video.removeEventListener("canplay", handleCanPlay);
          console.log("[CANVAS-VIDEO] 🧹 Cleaned up canplay listener", {
            videoId: videoId ?? src,
          });
        };
      }
    } else {
      if (isPlaying && !isInClipRange) {
        console.warn("[CANVAS-VIDEO] Requested play but clip not active", {
          videoId: videoId ?? src,
          currentTime: timelineTimeRef.current,
          clipStartTime,
          clipEndTime,
        });
      }
      video.pause();
    }
  }, [
    isPlaying,
    isInClipRange,
    clipStartTime,
    clipEndTime,
    videoId,
    src,
  ]);

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
      unmarkBlobInUse(prev);
      revokeManagedObjectURL(prev);
    }

    previousSrcRef.current = src;

    if (src.startsWith("blob:")) {
      markBlobInUse(src);
    }

    return () => {
      if (previousSrcRef.current?.startsWith("blob:")) {
        const url = previousSrcRef.current;
        unmarkBlobInUse(url);
        revokeManagedObjectURL(url);
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
