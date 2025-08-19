"use client";

import { useRef, useEffect, memo } from "react";
import { usePlaybackStore } from "@/stores/playback-store";

interface AudioPlayerProps {
  src: string;
  className?: string;
  clipStartTime: number;
  trimStart: number;
  trimEnd: number;
  clipDuration: number;
  trackMuted?: boolean;
}

export const AudioPlayer = memo(function AudioPlayer({
  src,
  className = "",
  clipStartTime,
  trimStart,
  trimEnd,
  clipDuration,
  trackMuted = false,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  
  // Use refs to avoid re-renders
  const clipStartTimeRef = useRef(clipStartTime);
  const trimStartRef = useRef(trimStart);
  const trimEndRef = useRef(trimEnd);
  const clipDurationRef = useRef(clipDuration);
  const trackMutedRef = useRef(trackMuted);
  const isPlayingRef = useRef(false);
  const currentTimeRef = useRef(0);
  
  // Update refs when props change
  useEffect(() => {
    clipStartTimeRef.current = clipStartTime;
    trimStartRef.current = trimStart;
    trimEndRef.current = trimEnd;
    clipDurationRef.current = clipDuration;
    trackMutedRef.current = trackMuted;
  }, [clipStartTime, trimStart, trimEnd, clipDuration, trackMuted]);

  // Subscribe to playback state without re-rendering
  useEffect(() => {
    const unsubscribeIsPlaying = usePlaybackStore.subscribe((state) => {
      const prevIsPlaying = isPlayingRef.current;
      isPlayingRef.current = state.isPlaying;
      
      // Handle play/pause changes
      if (prevIsPlaying !== state.isPlaying) {
        const audio = audioRef.current;
        if (!audio) return;
        
        const clipEndTime = clipStartTimeRef.current + 
          (clipDurationRef.current - trimStartRef.current - trimEndRef.current);
        const isInClipRange = currentTimeRef.current >= clipStartTimeRef.current && 
          currentTimeRef.current < clipEndTime;
        
        if (state.isPlaying && isInClipRange && !trackMutedRef.current) {
          audio.play().catch(() => {});
        } else {
          audio.pause();
        }
      }
      
      return state.isPlaying;
    });
    
    return unsubscribeIsPlaying;
  }, []);
  
  // Subscribe to currentTime without re-rendering
  useEffect(() => {
    let rafId: number;
    
    const updateAudioPosition = () => {
      const state = usePlaybackStore.getState();
      const audio = audioRef.current;
      if (!audio) return;
      
      currentTimeRef.current = state.currentTime;
      
      const clipEndTime = clipStartTimeRef.current + 
        (clipDurationRef.current - trimStartRef.current - trimEndRef.current);
      const isInClipRange = state.currentTime >= clipStartTimeRef.current && 
        state.currentTime < clipEndTime;
      
      if (isInClipRange) {
        const targetTime = Math.max(
          trimStartRef.current,
          Math.min(
            clipDurationRef.current - trimEndRef.current,
            state.currentTime - clipStartTimeRef.current + trimStartRef.current
          )
        );
        
        // Only update if significantly out of sync
        if (Math.abs(audio.currentTime - targetTime) > 0.1) {
          audio.currentTime = targetTime;
        }
        
        // Start playing if needed
        if (isPlayingRef.current && audio.paused && !trackMutedRef.current) {
          audio.play().catch(() => {});
        }
      } else {
        // Stop if outside range
        if (!audio.paused) {
          audio.pause();
        }
      }
      
      // Continue updating if playing
      if (isPlayingRef.current) {
        rafId = requestAnimationFrame(updateAudioPosition);
      }
    };
    
    // Start RAF loop if playing
    const unsubscribe = usePlaybackStore.subscribe((state) => {
      if (state.isPlaying && !rafId) {
        rafId = requestAnimationFrame(updateAudioPosition);
      } else if (!state.isPlaying && rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      return state.isPlaying;
    });
    
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      unsubscribe();
    };
  }, []);
  
  // Subscribe to volume/speed/muted without re-rendering
  useEffect(() => {
    const unsubscribeVolume = usePlaybackStore.subscribe((state) => {
      const audio = audioRef.current;
      if (audio) {
        audio.volume = state.volume;
        audio.playbackRate = state.speed;
        audio.muted = state.muted || trackMutedRef.current;
      }
      return { volume: state.volume, speed: state.speed, muted: state.muted };
    });
    
    return unsubscribeVolume;
  }, []);
  
  // Handle track mute changes
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.muted = usePlaybackStore.getState().muted || trackMuted;
    }
  }, [trackMuted]);

  // Sync playback events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleSeekEvent = (e: CustomEvent) => {
      const timelineTime = e.detail.time;
      const audioTime = Math.max(
        trimStartRef.current,
        Math.min(
          clipDurationRef.current - trimEndRef.current,
          timelineTime - clipStartTimeRef.current + trimStartRef.current
        )
      );
      audio.currentTime = audioTime;
      currentTimeRef.current = timelineTime;
    };

    const handleSpeed = (e: CustomEvent) => {
      audio.playbackRate = e.detail.speed;
    };

    window.addEventListener("playback-seek", handleSeekEvent as EventListener);
    window.addEventListener("playback-speed", handleSpeed as EventListener);

    return () => {
      window.removeEventListener("playback-seek", handleSeekEvent as EventListener);
      window.removeEventListener("playback-speed", handleSpeed as EventListener);
    };
  }, []);

  return (
    <audio
      ref={audioRef}
      src={src}
      className={className}
      preload="auto"
      controls={false}
      style={{ display: "none" }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
});