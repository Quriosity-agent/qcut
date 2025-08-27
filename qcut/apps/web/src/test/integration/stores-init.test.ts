import { describe, it, expect, beforeEach } from 'vitest';
import { useMediaStore } from '@/stores/media-store';
import { useTimelineStore } from '@/stores/timeline-store';
import { useProjectStore } from '@/stores/project-store';
import { resetAllStores } from '@/test/utils/store-helpers';

describe('Store Initialization', () => {
  beforeEach(() => {
    resetAllStores();
  });
  
  it('initializes media store with empty state', () => {
    const state = useMediaStore.getState();
    expect(state.mediaItems).toEqual([]);
    expect(state.isLoading).toBe(false);
  });
  
  it('initializes timeline store with default state', () => {
    const state = useTimelineStore.getState();
    expect(state.tracks).toEqual([]);
    expect(state.history).toEqual([]);
    expect(state.historyIndex).toBe(-1);
  });
  
  it('initializes project store with null project', () => {
    const state = useProjectStore.getState();
    expect(state.activeProject).toBeNull();
    expect(state.savedProjects).toEqual([]);
    expect(state.isInitialized).toBe(false);
  });
});