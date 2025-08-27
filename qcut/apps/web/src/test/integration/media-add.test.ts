import { describe, it, expect, beforeEach } from 'vitest';
import { useMediaStore } from '@/stores/media-store';
import { mockVideoItem, mockImageItem } from '@/test/fixtures/media-items';

describe('Media Addition', () => {
  beforeEach(() => {
    useMediaStore.setState({ mediaItems: [] });
  });
  
  it('adds media item to store', async () => {
    const store = useMediaStore.getState();
    const initialCount = store.mediaItems.length;
    
    // Add video item
    await store.addMediaItem(mockVideoItem);
    expect(store.mediaItems.length).toBe(initialCount + 1);
    expect(store.mediaItems[0].id).toBe(mockVideoItem.id);
  });
  
  it('prevents duplicate media items', async () => {
    const store = useMediaStore.getState();
    await store.addMediaItem(mockVideoItem);
    await store.addMediaItem(mockVideoItem);
    
    expect(store.mediaItems.length).toBe(1);
  });
});