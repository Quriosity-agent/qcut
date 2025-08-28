import { useTimelineStore } from '@/stores/timeline-store';
import type { TimelineElement, TimelineTrack, TrackType, CreateTimelineElement } from '@/types/timeline';

export function addElementToTimeline(
  trackId: string,
  element: Partial<TimelineElement>
): TimelineElement {
  const store = useTimelineStore.getState();
  // Capture existing ids to identify the new element deterministically
  const beforeIds = new Set(
    (store.tracks.find(t => t.id === trackId)?.elements ?? []).map(el => el.id)
  );
  
  // Find track to determine type
  const track = store.tracks.find(t => t.id === trackId);
  if (!track) throw new Error(`Track not found: ${trackId}`);
  
  // Create element data based on track type
  const elementData = {
    type: track.type === 'text' ? 'text' : 'media',
    startTime: 0,
    duration: 5,
    trimStart: 0,
    trimEnd: 5,
    name: 'Test Element',
    mediaId: 'test-media',
    ...element,
  } as CreateTimelineElement;
  
  store.addElementToTrack(trackId, elementData);
  const updatedTrack = store.tracks.find(t => t.id === trackId);
  if (!updatedTrack) throw new Error(`Track not found: ${trackId}`);
  const created = updatedTrack.elements.find(el => !beforeIds.has(el.id));
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
        (maxEnd, el) => Math.max(maxEnd, (el.startTime ?? 0) + (el.duration ?? 0)),
        0
      );
      return Math.max(max, trackDuration);
    }, 0),
  };
}