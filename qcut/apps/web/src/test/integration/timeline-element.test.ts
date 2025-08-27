import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '@/stores/timeline-store';

describe('Timeline Element', () => {
  beforeEach(() => {
    useTimelineStore.getState().clearTimeline();
  });
  
  it('creates timeline element on track', () => {
    const store = useTimelineStore.getState();
    
    // Add a track using the correct method signature
    const trackId = store.addTrack('media');
    expect(trackId).toBeDefined();
    
    // Add element to track
    const element = {
      type: 'media' as const,
      mediaId: 'media-001',
      start: 0,
      duration: 10,
      trackId: trackId,
    };
    store.addElementToTrack(trackId, element);
    
    // Verify
    const updatedState = useTimelineStore.getState();
    const updatedTrack = updatedState.tracks.find(t => t.id === trackId);
    
    expect(updatedTrack).toBeDefined();
    expect(updatedTrack?.elements).toHaveLength(1);
    
    // Check the element properties (ID is auto-generated)
    const addedElement = updatedTrack?.elements[0];
    expect(addedElement).toBeDefined();
    expect(addedElement?.type).toBe('media');
    expect(addedElement?.mediaId).toBe('media-001');
    expect(addedElement?.start).toBe(0);
    expect(addedElement?.duration).toBe(10);
  });
});