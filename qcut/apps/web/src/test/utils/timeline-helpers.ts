import { useTimelineStore } from '@/stores/timeline-store';
import type { TimelineElement, TimelineTrack, TrackType } from '@/types/timeline';

export function addElementToTimeline(
  trackId: string,
  element: Partial<TimelineElement>
): TimelineElement {
  const store = useTimelineStore.getState();
  // Capture existing ids to identify the new element deterministically
  const beforeIds = new Set(
    (store.tracks.find(t => t.id === trackId)?.elements ?? []).map(el => el.id)
  );
  const elementData: Partial<TimelineElement> = {
    startTime: 0,
    duration: 5,
    ...element,
  };
  store.addElementToTrack(trackId, elementData);
  const track = store.tracks.find(t => t.id === trackId);
  if (!track) throw new Error(`Track not found: ${trackId}`);
  const created = track.elements.find(el => !beforeIds.has(el.id));
  if (!created) throw new Error(`Failed to add element to track: ${trackId}`);
  return created;
}

export function createTestTrack(type: TrackType = 'media'): TimelineTrack {
  const store = useTimelineStore.getState();
  const id = store.addTrack(type);
  const track = store.tracks.find(t => t.id === id);
  if (!track) throw new Error(`Failed to create track of type: ${type}`);
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