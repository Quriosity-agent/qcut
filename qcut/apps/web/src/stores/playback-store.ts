import { create } from "zustand";
import type { PlaybackState, PlaybackControls } from "@/types/playback";
import { useTimelineStore } from "@/stores/timeline-store";
import { useProjectStore } from "./project-store";

interface PlaybackStore extends PlaybackState, PlaybackControls {
  setDuration: (duration: number) => void;
  setCurrentTime: (time: number) => void;
}

let playbackTimer: number | null = null;
let cachedContentDuration = 0;
let lastDurationCheck = 0;
let cachedProjectFps = 30; // Default fallback
const DURATION_CHECK_INTERVAL = 1000; // Check content duration once per second

const startTimer = (store: () => PlaybackStore) => {
  if (playbackTimer) cancelAnimationFrame(playbackTimer);

  // Use requestAnimationFrame for smoother updates
  const updateTime = () => {
    const state = store();
    if (state.isPlaying && state.currentTime < state.duration) {
      const now = performance.now();
      const delta = (now - lastUpdate) / 1000; // Convert to seconds
      lastUpdate = now;

      const newTime = state.currentTime + delta * state.speed;

      // Cache content duration and project FPS, only update occasionally to prevent excessive store calls
      if (now - lastDurationCheck > DURATION_CHECK_INTERVAL) {
        cachedContentDuration = useTimelineStore.getState().getTotalDuration();
        cachedProjectFps = useProjectStore.getState().activeProject?.fps ?? 30;
        lastDurationCheck = now;
      }

      // Stop at actual content end, not timeline duration (which has 10s minimum)
      const effectiveDuration =
        cachedContentDuration > 0 ? cachedContentDuration : state.duration;

      if (newTime >= effectiveDuration) {
        // When content completes, pause just before the end so we can see the last frame
        const frameOffset = 1 / cachedProjectFps; // Stop 1 frame before end based on cached project FPS
        const stopTime = Math.max(0, effectiveDuration - frameOffset);

        state.pause();
        state.setCurrentTime(stopTime);
        // Notify video elements to sync with end position
        window.dispatchEvent(
          new CustomEvent("playback-seek", {
            detail: { time: stopTime },
          })
        );
      } else {
        state.setCurrentTime(newTime);
        // Notify video elements to sync
        window.dispatchEvent(
          new CustomEvent("playback-update", { detail: { time: newTime } })
        );
      }
    }
    playbackTimer = requestAnimationFrame(updateTime);
  };

  let lastUpdate = performance.now();
  playbackTimer = requestAnimationFrame(updateTime);
};

const stopTimer = () => {
  if (playbackTimer) {
    cancelAnimationFrame(playbackTimer);
    playbackTimer = null;
  }
};

export const usePlaybackStore = create<PlaybackStore>((set, get) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  previousVolume: 1,
  speed: 1.0,

  play: () => {
    set({ isPlaying: true });
    startTimer(get);
  },

  pause: () => {
    set({ isPlaying: false });
    stopTimer();
  },

  toggle: () => {
    const { isPlaying } = get();
    if (isPlaying) {
      get().pause();
    } else {
      get().play();
    }
  },

  seek: (time: number) => {
    const { duration } = get();
    const clampedTime = Math.max(0, Math.min(duration, time));
    set({ currentTime: clampedTime });

    const event = new CustomEvent("playback-seek", {
      detail: { time: clampedTime },
    });
    window.dispatchEvent(event);
  },

  setVolume: (volume: number) =>
    set((state) => ({
      volume: Math.max(0, Math.min(1, volume)),
      muted: volume === 0,
      previousVolume: volume > 0 ? volume : state.previousVolume,
    })),

  setSpeed: (speed: number) => {
    const newSpeed = Math.max(0.1, Math.min(2.0, speed));
    set({ speed: newSpeed });

    const event = new CustomEvent("playback-speed", {
      detail: { speed: newSpeed },
    });
    window.dispatchEvent(event);
  },

  setDuration: (duration: number) => set({ duration }),
  setCurrentTime: (time: number) => set({ currentTime: time }),

  mute: () => {
    const { volume, previousVolume } = get();
    set({
      muted: true,
      previousVolume: volume > 0 ? volume : previousVolume,
      volume: 0,
    });
  },

  unmute: () => {
    const { previousVolume } = get();
    set({ muted: false, volume: previousVolume ?? 1 });
  },

  toggleMute: () => {
    const { muted } = get();
    if (muted) {
      get().unmute();
    } else {
      get().mute();
    }
  },
}));
