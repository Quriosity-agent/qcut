import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTimelineStore } from '@/stores/timeline-store';
import type { TimelineTrack, TimelineElement, MediaElement, CreateMediaElement } from '@/types/timeline';

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
    expect(result.current.tracks[0].type).toBe('media');
    expect(result.current.tracks[0].isMain).toBe(true);
    expect(result.current.tracks[0].name).toBe('Main Track');
    expect(result.current.tracks[0].elements).toEqual([]);
  });
  
  it('adds text track', () => {
    const { result } = renderHook(() => useTimelineStore());
    
    act(() => {
      result.current.addTrack('text');
    });
    
    expect(result.current.tracks).toHaveLength(2);
    const textTrack = result.current.tracks.find(t => t.type === 'text');
    expect(textTrack).toBeDefined();
    expect(textTrack?.name).toContain('Text');
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
      result.current.addTrack('text');
    });
    
    const textTrack = result.current.tracks.find(t => t.type === 'text');
    expect(textTrack).toBeDefined();
    
    // Remove the track
    if (!textTrack) throw new Error('Expected text track to exist');
    act(() => {
      result.current.removeTrack(textTrack.id);
    });
    
    expect(result.current.tracks).toHaveLength(1);
    expect(result.current.tracks[0].isMain).toBe(true);
  });
  
  it('cannot remove main track', () => {
    const { result } = renderHook(() => useTimelineStore());
    const mainTrack = result.current.tracks[0];
    
    act(() => {
      result.current.removeTrack(mainTrack.id);
    });
    
    // Main track should still exist
    expect(result.current.tracks).toHaveLength(1);
    expect(result.current.tracks[0].isMain).toBe(true);
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
    
    const element: CreateMediaElement = {
      type: 'media',
      mediaId: 'test-media',
      startTime: 0,
      duration: 10,
      name: 'Test Element',
      trimStart: 0,
      trimEnd: 10
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
        name: 'To Remove',
        trimStart: 0,
        trimEnd: 0
      });
    });
    
    const element = result.current.tracks[0].elements[0];
    
    // Remove the element
    act(() => {
      result.current.removeElementFromTrack(mainTrack.id, element.id);
    });
    
    expect(result.current.tracks[0].elements).toHaveLength(0);
  });
  
  it('updates element properties', () => {
    const { result } = renderHook(() => useTimelineStore());
    const mainTrack = result.current.tracks[0];
    
    // Add an element
    act(() => {
      result.current.addElementToTrack(mainTrack.id, {
        type: 'media',
        mediaId: 'test-media',
        startTime: 0,
        duration: 5,
        name: 'Original Media',
        trimStart: 0,
        trimEnd: 0
      });
    });
    
    const element = result.current.tracks[0].elements[0];
    
    // Update element duration and start time
    act(() => {
      result.current.updateElementDuration(mainTrack.id, element.id, 10);
      result.current.updateElementStartTime(mainTrack.id, element.id, 5);
    });
    
    const updatedElement = result.current.tracks[0].elements[0];
    // Name won't change as there's no method to update it
    expect(updatedElement.name).toBe('Original Media');
    expect(updatedElement.duration).toBe(10);
    expect(updatedElement.startTime).toBe(5);
  });
  
  it('clears timeline', () => {
    const { result } = renderHook(() => useTimelineStore());
    
    // Add tracks and elements
    act(() => {
      result.current.addTrack('text');
      result.current.addTrack('audio');
      result.current.addElementToTrack(result.current.tracks[0].id, {
        type: 'media',
        mediaId: 'test',
        startTime: 0,
        duration: 10,
        name: 'Media',
        trimStart: 0,
        trimEnd: 0
      });
    });
    
    expect(result.current.tracks.length).toBeGreaterThan(1);
    
    // Clear timeline
    act(() => {
      result.current.clearTimeline();
    });
    
    // Should have only main track
    expect(result.current.tracks).toHaveLength(1);
    expect(result.current.tracks[0].isMain).toBe(true);
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
        duration: 10,
        name: 'Media 1',
        trimStart: 0,
        trimEnd: 0
      });
      result.current.addElementToTrack(mainTrack.id, {
        type: 'media',
        mediaId: 'media2',
        startTime: 10,
        duration: 10,
        name: 'Media 2',
        trimStart: 0,
        trimEnd: 0
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
    if (!audioTrack) throw new Error('Expected audio track to exist');
    act(() => {
      result.current.toggleTrackMute(audioTrack.id);
    });
    
    const mutedTrack = result.current.tracks.find(t => t.id === audioTrack.id);
    expect(mutedTrack?.muted).toBe(true);
    
    // Toggle again
    act(() => {
      result.current.toggleTrackMute(audioTrack.id);
    });
    
    const unmutedTrack = result.current.tracks.find(t => t.id === audioTrack.id);
    expect(unmutedTrack?.muted).toBe(false);
  });

  it('updates text elements using updateTextElement', () => {
    const { result } = renderHook(() => useTimelineStore());
    
    // Add a text track
    act(() => {
      result.current.addTrack('text');
    });
    
    const textTrack = result.current.tracks.find(t => t.type === 'text');
    if (!textTrack) throw new Error('Expected text track to exist');
    
    // Add a text element
    act(() => {
      result.current.addElementToTrack(textTrack.id, {
        type: 'text',
        content: 'Original Text',
        startTime: 0,
        duration: 5,
        name: 'Text Element',
        trimStart: 0,
        trimEnd: 0,
        fontSize: 16,
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
        opacity: 1
      });
    });
    
    const element = textTrack.elements[0];
    if (!element) throw new Error('Expected text element to exist');
    
    // Update text element using the correct method (updateTextElement, not updateElement)
    act(() => {
      result.current.updateTextElement(textTrack.id, element.id, {
        content: 'Updated Text',
        fontSize: 24,
        fontFamily: 'Arial'
      });
    });
    
    const updatedTrack = result.current.tracks.find(t => t.id === textTrack.id);
    const updatedElement = updatedTrack?.elements[0];
    
    // Verify the text was updated
    expect(updatedElement).toBeDefined();
    if (!updatedElement || updatedElement.type !== 'text') {
      throw new Error('Expected a text element');
    }
    expect(updatedElement.content).toBe('Updated Text');
  });
});