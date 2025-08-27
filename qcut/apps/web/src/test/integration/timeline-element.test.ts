import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from '@/stores/timeline-store';
import { createTestTrack, addElementToTimeline } from '@/test/utils/timeline-helpers';

describe('Timeline Element', () => {
  beforeEach(() => {
    useTimelineStore.getState().clearTimeline();
  });
  
  it('creates timeline element on track', () => {
    const track = createTestTrack('media');
    const element = addElementToTimeline(track.id, {
      type: 'media',
      mediaId: 'media-001',
      start: 0,
      duration: 10,
    });
    
    const state = useTimelineStore.getState();
    const updatedTrack = state.tracks.find(t => t.id === track.id);
    
    expect(updatedTrack?.elements).toHaveLength(1);
    expect(updatedTrack?.elements[0].id).toBe(element.id);
  });
});