import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTimelineStore } from '@/stores/timeline-store';
import type { TimelineTrack, TimelineElement, MediaElement } from '@/types/timeline';

// Mock dependencies
vi.mock('@/stores/editor-store', () => ({
  useEditorStore: {
    getState: vi.fn(() => ({
      currentTime: 0,
      setCurrentTime: vi.fn()
    }))
  }
}));

vi.mock('@/stores/media-store', () => ({
  useMediaStore: {
    getState: vi.fn(() => ({
      mediaItems: []
    }))
  },
  getMediaAspectRatio: vi.fn(() => 16/9)
}));

vi.mock('@/lib/storage/storage-service', () => ({
  storageService: {
    saveTimeline: vi.fn(() => Promise.resolve()),
    loadTimeline: vi.fn(() => Promise.resolve(null))
  }
}));

vi.mock('@/stores/project-store', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      activeProject: null
    }))
  }
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

describe('TimelineStore', () => {
  beforeEach(() => {
    // Reset the store state completely
    useTimelineStore.setState({
      _tracks: [],
      tracks: [],
      history: [],
      redoStack: [],
      selectedElements: [],
      snappingEnabled: true,
      rippleEditingEnabled: false,
      dragState: {
        isDragging: false,
        elementId: null,
        trackId: null,
        startMouseX: 0,
        startElementTime: 0,
        clickOffsetTime: 0,
        currentTime: 0,
      },
    });
    
    // Force re-initialization with main track
    const { result } = renderHook(() => useTimelineStore());
    act(() => {
      result.current.clearTimeline();
    });
    vi.clearAllMocks();
  });
  
  it('initializes with main track', () => {
    const { result } = renderHook(() => useTimelineStore());
    
    expect(result.current.tracks).toHaveLength(1);
    expect(result.current.tracks[0].type).toBe('main');
    expect(result.current.tracks[0].order).toBe(0);
    expect(result.current.tracks[0].elements).toEqual([]);
  });
  
  it('adds overlay track', () => {
    const { result } = renderHook(() => useTimelineStore());
    
    act(() => {
      result.current.addTrack('overlay');
    });
    
    expect(result.current.tracks).toHaveLength(2);
    const overlayTrack = result.current.tracks.find(t => t.type === 'overlay');
    expect(overlayTrack).toBeDefined();
    expect(overlayTrack?.order).toBe(1);
  });
  
  it('adds audio track', () => {
    const { result } = renderHook(() => useTimelineStore());
    
    act(() => {
      result.current.addTrack('audio');
    });
    
    expect(result.current.tracks).toHaveLength(2);
    const audioTrack = result.current.tracks.find(t => t.type === 'audio');
    expect(audioTrack).toBeDefined();
    expect(audioTrack?.name).toContain('Audio');
  });
  
  it('removes track by ID', () => {
    const { result } = renderHook(() => useTimelineStore());
    
    // Add a track
    act(() => {
      result.current.addTrack('overlay');
    });
    
    const overlayTrack = result.current.tracks.find(t => t.type === 'overlay');
    expect(overlayTrack).toBeDefined();
    
    // Remove the track
    act(() => {
      result.current.removeTrack(overlayTrack!.id);
    });
    
    expect(result.current.tracks).toHaveLength(1);
    expect(result.current.tracks[0].type).toBe('main');
  });
  
  it('cannot remove main track', () => {
    const { result } = renderHook(() => useTimelineStore());
    const mainTrack = result.current.tracks[0];
    
    act(() => {
      result.current.removeTrack(mainTrack.id);
    });
    
    // Main track should still exist
    expect(result.current.tracks).toHaveLength(1);
    expect(result.current.tracks[0].type).toBe('main');
  });
  
  it('maintains history for undo/redo', () => {
    const { result } = renderHook(() => useTimelineStore());
    
    // Initial state - no history
    expect(result.current.history).toHaveLength(0);
    
    // Add a track (creates history entry)
    act(() => {
      result.current.addTrack('audio');
    });
    
    expect(result.current.history).toHaveLength(1);
    expect(result.current.tracks).toHaveLength(2);
    
    // Undo
    act(() => {
      result.current.undo();
    });
    
    expect(result.current.tracks).toHaveLength(1);
    expect(result.current.redoStack).toHaveLength(1);
    
    // Redo
    act(() => {
      result.current.redo();
    });
    
    expect(result.current.tracks).toHaveLength(2);
    expect(result.current.redoStack).toHaveLength(0);
  });
  
  it('adds element to track', () => {
    const { result } = renderHook(() => useTimelineStore());
    const mainTrack = result.current.tracks[0];
    
    const element: Partial<TimelineElement> = {
      type: 'media',
      mediaId: 'test-media',
      startTime: 0,
      duration: 10,
      name: 'Test Element'
    };
    
    act(() => {
      result.current.addElementToTrack(mainTrack.id, element);
    });
    
    expect(result.current.tracks[0].elements).toHaveLength(1);
    expect(result.current.tracks[0].elements[0].name).toBe('Test Element');
    expect(result.current.tracks[0].elements[0].duration).toBe(10);
  });
  
  it('removes element from track', () => {
    const { result } = renderHook(() => useTimelineStore());
    const mainTrack = result.current.tracks[0];
    
    // Add an element
    act(() => {
      result.current.addElementToTrack(mainTrack.id, {
        type: 'media',
        mediaId: 'test-media',
        startTime: 0,
        duration: 10,
        name: 'To Remove'
      });
    });
    
    const element = result.current.tracks[0].elements[0];
    
    // Remove the element
    act(() => {
      result.current.removeElement(mainTrack.id, element.id);
    });
    
    expect(result.current.tracks[0].elements).toHaveLength(0);
  });
  
  it('updates element properties', () => {
    const { result } = renderHook(() => useTimelineStore());
    const mainTrack = result.current.tracks[0];
    
    // Add an element
    act(() => {
      result.current.addElementToTrack(mainTrack.id, {
        type: 'text',
        startTime: 0,
        duration: 5,
        name: 'Original Text'
      });
    });
    
    const element = result.current.tracks[0].elements[0];
    
    // Update element
    act(() => {
      result.current.updateElement(mainTrack.id, element.id, {
        name: 'Updated Text',
        duration: 10,
        startTime: 5
      });
    });
    
    const updatedElement = result.current.tracks[0].elements[0];
    expect(updatedElement.name).toBe('Updated Text');
    expect(updatedElement.duration).toBe(10);
    expect(updatedElement.startTime).toBe(5);
  });
  
  it('clears timeline', () => {
    const { result } = renderHook(() => useTimelineStore());
    
    // Add tracks and elements
    act(() => {
      result.current.addTrack('overlay');
      result.current.addTrack('audio');
      result.current.addElementToTrack(result.current.tracks[0].id, {
        type: 'media',
        mediaId: 'test',
        startTime: 0,
        duration: 10
      });
    });
    
    expect(result.current.tracks.length).toBeGreaterThan(1);
    
    // Clear timeline
    act(() => {
      result.current.clearTimeline();
    });
    
    // Should have only main track
    expect(result.current.tracks).toHaveLength(1);
    expect(result.current.tracks[0].type).toBe('main');
    expect(result.current.tracks[0].elements).toEqual([]);
    expect(result.current.history).toEqual([]);
    expect(result.current.redoStack).toEqual([]);
  });
  
  it('selects and deselects elements', () => {
    const { result } = renderHook(() => useTimelineStore());
    const mainTrack = result.current.tracks[0];
    
    // Add elements
    act(() => {
      result.current.addElementToTrack(mainTrack.id, {
        type: 'media',
        mediaId: 'media1',
        startTime: 0,
        duration: 10
      });
      result.current.addElementToTrack(mainTrack.id, {
        type: 'media',
        mediaId: 'media2',
        startTime: 10,
        duration: 10
      });
    });
    
    const [element1, element2] = result.current.tracks[0].elements;
    
    // Select first element
    act(() => {
      result.current.selectElement(mainTrack.id, element1.id);
    });
    
    expect(result.current.selectedElements).toHaveLength(1);
    expect(result.current.selectedElements[0].elementId).toBe(element1.id);
    
    // Select second element (multi-select)
    act(() => {
      result.current.selectElement(mainTrack.id, element2.id, true);
    });
    
    expect(result.current.selectedElements).toHaveLength(2);
    
    // Clear selection
    act(() => {
      result.current.clearSelectedElements();
    });
    
    expect(result.current.selectedElements).toHaveLength(0);
  });
  
  it('toggles track mute state', () => {
    const { result } = renderHook(() => useTimelineStore());
    
    // Add audio track
    act(() => {
      result.current.addTrack('audio');
    });
    
    const audioTrack = result.current.tracks.find(t => t.type === 'audio');
    expect(audioTrack?.muted).toBe(false);
    
    // Toggle mute
    act(() => {
      result.current.toggleTrackMute(audioTrack!.id);
    });
    
    const mutedTrack = result.current.tracks.find(t => t.id === audioTrack!.id);
    expect(mutedTrack?.muted).toBe(true);
    
    // Toggle again
    act(() => {
      result.current.toggleTrackMute(audioTrack!.id);
    });
    
    const unmutedTrack = result.current.tracks.find(t => t.id === audioTrack!.id);
    expect(unmutedTrack?.muted).toBe(false);
  });
});