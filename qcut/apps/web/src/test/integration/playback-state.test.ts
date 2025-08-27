import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaybackStore } from '@/stores/playback-store';

describe('Playback State', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      playbackSpeed: 1,
    });
  });
  
  it('toggles playback state', () => {
    const store = usePlaybackStore.getState();
    expect(store.isPlaying).toBe(false);
    
    store.play();
    expect(store.isPlaying).toBe(true);
    
    store.pause();
    expect(store.isPlaying).toBe(false);
  });
  
  it('updates current time', () => {
    const store = usePlaybackStore.getState();
    store.seek(10.5);
    expect(store.currentTime).toBe(10.5);
  });
  
  it('changes playback speed', () => {
    const store = usePlaybackStore.getState();
    store.setPlaybackSpeed(2);
    expect(store.playbackSpeed).toBe(2);
  });
});