import { describe, it, expect, beforeEach } from 'vitest';
import { useMediaStore } from '@/stores/media-store';
import { useTimelineStore } from '@/stores/timeline-store';
import { useProjectStore } from '@/stores/project-store';
import { resetAllStores } from '@/test/utils/store-helpers';

describe('Store Initialization', () => {
  beforeEach(async () => {
    await resetAllStores();
  });
  
  it('initializes media store with empty state', () => {
    const state = useMediaStore.getState();
    expect(state.mediaItems).toEqual([]);
    expect(state.isLoading).toBe(false);
  });
  
  it('initializes timeline store with default state', () => {
    const state = useTimelineStore.getState();
    // Timeline store creates a default main track on initialization
    expect(state.tracks).toHaveLength(1);
    expect(state.tracks[0].isMain).toBe(true);
    expect(state.tracks[0].name).toBe('Main Track');
    expect(state.history).toEqual([]);
    expect(state.redoStack).toEqual([]);
  });
  
  it('initializes project store with null project', () => {
    const state = useProjectStore.getState();
    expect(state.activeProject).toBeNull();
    expect(state.savedProjects).toEqual([]);
    expect(state.isInitialized).toBe(false);
  });
});