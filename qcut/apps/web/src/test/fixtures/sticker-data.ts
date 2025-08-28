import type { OverlaySticker } from '@/types/sticker-overlay';

// Z_INDEX constants from sticker-overlay.ts
const Z_INDEX = {
  MIN: 1,
  MAX: 9999,
  INCREMENT: 10,
} as const;

/**
 * Mock sticker matching types/sticker-overlay.ts
 */
export const mockSticker: OverlaySticker = {
  id: 'sticker-001',
  mediaItemId: 'media-001',
  position: { x: 50, y: 50 }, // Percentage values
  size: { width: 8, height: 8 }, // Percentage values (smaller default)
  rotation: 0,
  opacity: 1,
  zIndex: Z_INDEX.MIN,
  maintainAspectRatio: true,
  timing: {
    startTime: 0,
    endTime: 10,
  },
  metadata: {
    addedAt: Date.now(),
    lastModified: Date.now(),
    source: 'library',
  },
};

export const mockAnimatedSticker: OverlaySticker = {
  ...mockSticker,
  id: 'sticker-animated-001',
  rotation: 45,
  opacity: 0.8,
  timing: {
    startTime: 2,
    endTime: 8,
    durationMs: 1000,
  },
};

export const mockStickerTopLayer: OverlaySticker = {
  ...mockSticker,
  id: 'sticker-top-001',
  zIndex: Z_INDEX.MAX - Z_INDEX.INCREMENT,
  position: { x: 75, y: 25 },
  size: { width: 15, height: 15 },
};

/**
 * Create multiple stickers at different positions
 */
export function createMockStickers(count: number): OverlaySticker[] {
  return Array.from({ length: count }, (_, i) => ({
    ...mockSticker,
    id: `sticker-${i + 1}`,
    mediaItemId: `media-${(i % 3) + 1}`, // Cycle through 3 media items
    position: {
      x: 10 + (i * 20) % 80, // Distribute across canvas
      y: 10 + (i * 15) % 80,
    },
    zIndex: Z_INDEX.MIN + (i * Z_INDEX.INCREMENT),
    timing: {
      startTime: i * 2,
      endTime: (i + 1) * 5,
    },
    metadata: {
      addedAt: Date.now() - (i * 1000),
      lastModified: Date.now() - (i * 500),
      source: i % 2 === 0 ? 'library' : 'upload',
    },
  }));
}

/**
 * Create sticker with custom properties
 */
export function createMockSticker(overrides: Partial<OverlaySticker> = {}): OverlaySticker {
  const now = Date.now();
  return {
    ...mockSticker,
    // Deep-clone nested objects to avoid shared references in tests
    position: { ...mockSticker.position },
    size: { ...mockSticker.size },
    timing: mockSticker.timing ? { ...mockSticker.timing } : undefined,
    id: `sticker-${now}-${Math.random().toString(36).slice(2)}`,
    metadata: {
      ...mockSticker.metadata,
      addedAt: now,
      lastModified: now,
      source: 'library',
    },
    ...overrides,
  };
}

/**
 * Mock sticker data array for tests
 */
export const mockStickerData: Partial<OverlaySticker>[] = [
  {
    src: '/stickers/emoji-smile.png',
    alt: 'Smile Emoji',
    position: { x: 50, y: 50 },
    size: { width: 10, height: 10 },
    rotation: 0,
    opacity: 1,
  },
  {
    src: '/stickers/emoji-heart.png',
    alt: 'Heart Emoji',
    position: { x: 60, y: 60 },
    size: { width: 10, height: 10 },
    rotation: 0,
    opacity: 1,
  },
  {
    src: '/stickers/emoji-star.png',
    alt: 'Star Emoji',
    position: { x: 70, y: 70 },
    size: { width: 10, height: 10 },
    rotation: 0,
    opacity: 1,
  },
];