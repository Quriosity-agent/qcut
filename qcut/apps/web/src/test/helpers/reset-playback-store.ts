import { usePlaybackStore } from '@/stores/playback-store';

export function resetPlaybackStore() {
  usePlaybackStore.setState({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackSpeed: 1,
  });
}