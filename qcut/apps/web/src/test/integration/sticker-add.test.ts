import { describe, it, expect, beforeEach } from 'vitest';
import { useStickersOverlayStore } from '@/stores/stickers-overlay-store';
import { mockStickerData } from '@/test/fixtures/sticker-data';

describe('Sticker Addition', () => {
  beforeEach(() => {
    const store = useStickersOverlayStore.getState();
    store.clearAllStickers();
  });
  
  it('adds sticker to overlay', () => {
    const store = useStickersOverlayStore.getState();
    const sticker = store.addSticker({
      src: mockStickerData[0].src,
      alt: mockStickerData[0].alt,
      position: { x: 100, y: 100 },
      size: { width: 50, height: 50 },
    });
    
    expect(sticker).toBeDefined();
    expect(sticker.position.x).toBe(100);
    expect(sticker.position.y).toBe(100);
    
    // Verify sticker was added to store
    const stickers = store.getVisibleStickers();
    expect(stickers).toHaveLength(1);
    expect(stickers[0].id).toBe(sticker.id);
  });
  
  it('updates sticker position', () => {
    const store = useStickersOverlayStore.getState();
    const sticker = store.addSticker(mockStickerData[0]);
    
    store.updateSticker(sticker.id, {
      position: { x: 200, y: 200 },
    });
    
    const updated = store.stickers.find(s => s.id === sticker.id);
    expect(updated?.position.x).toBe(200);
    expect(updated?.position.y).toBe(200);
  });
});