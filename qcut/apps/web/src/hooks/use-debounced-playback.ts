import { useEffect, useState } from "react";
import { usePlaybackStore } from "@/stores/playback-store";

/**
 * Hook to provide debounced playback time for UI components
 * Reduces re-renders from 60fps to 10fps for non-critical UI updates
 */
export function useDebouncedPlayback() {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  
  const [debouncedTime, setDebouncedTime] = useState(currentTime);
  
  useEffect(() => {
    if (!isPlaying) {
      // Update immediately when not playing
      setDebouncedTime(currentTime);
      return;
    }
    
    // Debounce to 10fps (100ms) during playback
    const timeout = setTimeout(() => {
      setDebouncedTime(currentTime);
    }, 100);
    
    return () => clearTimeout(timeout);
  }, [currentTime, isPlaying]);
  
  return debouncedTime;
}

/**
 * Hook for components that need exact time (like playhead)
 */
export function useExactPlayback() {
  return usePlaybackStore((s) => s.currentTime);
}

/**
 * Hook for UI display components (like timecode display)
 */
export function useUIPlayback() {
  const debouncedTime = useDebouncedPlayback();
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const duration = usePlaybackStore((s) => s.duration);
  
  return {
    currentTime: debouncedTime,
    isPlaying,
    duration
  };
}