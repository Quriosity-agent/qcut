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
  let elementData: CreateTimelineElement;
  
  if (track.type === 'text') {
    elementData = {
      type: 'text',
      startTime: 0,
      duration: 5,
      trimStart: 0,
      trimEnd: 0, // Text elements don't use trim values
      name: 'Test Text',
      content: 'Test Content',
      fontSize: 24,
      fontFamily: 'Arial',
      color: '#000000',
      backgroundColor: 'transparent',
      textAlign: 'center',
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none',
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      ...element,
    } as CreateTimelineElement;
  } else if (track.type === 'sticker') {
    elementData = {
      type: 'sticker',
      startTime: 0,
      duration: 5,
      trimStart: 0,
      trimEnd: 0, // Stickers don't use trim values
      name: 'Test Sticker',
      stickerId: 'test-sticker',
      mediaId: 'test-media',
      ...element,
    } as CreateTimelineElement;
  } else if (track.type === 'captions') {
    elementData = {
      type: 'captions',
      startTime: 0,
      duration: 5,
      trimStart: 0,
      trimEnd: 0, // Captions don't use trim values
      name: 'Test Caption',
      text: 'Test caption text',
      language: 'en',
      source: 'manual',
      ...element,
    } as CreateTimelineElement;
  } else {
    // Default to media element for 'media' and 'audio' tracks
    elementData = {
      type: 'media',
      startTime: 0,
      duration: 5,
      trimStart: 0,
      trimEnd: 0, // Set to 0 to avoid zero-length elements
      name: 'Test Media',
      mediaId: 'test-media',
      volume: 1,
      ...element,
    } as CreateTimelineElement;
  }
  
  store.addElementToTrack(trackId, elementData);
  // Get fresh state after mutation to avoid stale snapshot
  const updatedStore = useTimelineStore.getState();
  const updatedTrack = updatedStore.tracks.find(t => t.id === trackId);
  if (!updatedTrack) throw new Error(`Track not found: ${trackId}`);
  const created = updatedTrack.elements.find(el => !beforeIds.has(el.id));
  if (!created) throw new Error(`Failed to add element to track: ${trackId}`);
  return created;
}

export function createTestTrack(type: TrackType = 'media'): TimelineTrack {
  const store = useTimelineStore.getState();
  const id = store.addTrack(type);
  // Get fresh state after mutation to avoid stale snapshot
  const updated = useTimelineStore.getState();
  const track = updated.tracks.find(t => t.id === id);
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