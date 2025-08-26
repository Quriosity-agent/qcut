import { useTimelineStore } from '@/stores/timeline-store';
import type { TimelineElement, TimelineTrack } from '@/types/timeline';

export function addElementToTimeline(
  trackId: string,
  element: Partial<TimelineElement>
): TimelineElement {
  const store = useTimelineStore.getState();
  const fullElement: TimelineElement = {
    id: `element-${Date.now()}`,
    type: 'media',
    start: 0,
    duration: 5,
    trackId,
    ...element,
  } as TimelineElement;
  
  store.addElementToTrack(trackId, fullElement);
  return fullElement;
}

export function createTestTrack(type: 'media' | 'text' | 'audio' = 'media'): TimelineTrack {
  const store = useTimelineStore.getState();
  const track: TimelineTrack = {
    id: `track-${Date.now()}`,
    name: `Test ${type} track`,
    type,
    elements: [],
    muted: false,
    isMain: type === 'media',
  };
  
  store.addTrack(track);
  return track;
}

export function getTimelineSnapshot() {
  const store = useTimelineStore.getState();
  return {
    tracks: store.tracks,
    duration: store.tracks.reduce((max, track) => {
      const trackDuration = track.elements.reduce(
        (sum, el) => Math.max(sum, el.start + el.duration),
        0
      );
      return Math.max(max, trackDuration);
    }, 0),
  };
}