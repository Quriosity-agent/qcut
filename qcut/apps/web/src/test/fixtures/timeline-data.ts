import type {
  TimelineElement,
  TimelineTrack,
  MediaElement,
  TextElement,
  StickerElement,
  CaptionElement,
} from '@/types/timeline';

/**
 * Mock timeline tracks matching types/timeline.ts
 */
export const mockMainTrack: TimelineTrack = {
  id: 'track-main',
  name: 'Main Track',
  type: 'media',
  elements: [],
  isMain: true,
  muted: false,
};

export const mockTextTrack: TimelineTrack = {
  id: 'track-text-1',
  name: 'Text Track',
  type: 'text',
  elements: [],
  muted: false,
};

export const mockAudioTrack: TimelineTrack = {
  id: 'track-audio-1',
  name: 'Audio Track',
  type: 'audio',
  elements: [],
  muted: false,
};

/**
 * Mock timeline elements
 */
export const mockMediaElement: MediaElement = {
  id: 'element-media-001',
  type: 'media',
  name: 'Test Video Clip',
  mediaId: 'video-test-001',
  startTime: 0,
  duration: 10,
  trimStart: 0,
  trimEnd: 0,
  volume: 1,
  hidden: false,
};

export const mockTextElement: TextElement = {
  id: 'element-text-001',
  type: 'text',
  name: 'Test Text',
  startTime: 5,
  duration: 5,
  trimStart: 0,
  trimEnd: 0,
  content: 'Test Text Content',
  fontSize: 32,
  fontFamily: 'Arial',
  fontWeight: 'normal',
  fontStyle: 'normal',
  textDecoration: 'none',
  textAlign: 'center',
  color: '#FFFFFF',
  backgroundColor: 'transparent',
  x: 0,
  y: 0,
  rotation: 0,
  opacity: 1,
  hidden: false,
};

export const mockStickerElement: StickerElement = {
  id: 'element-sticker-001',
  type: 'sticker',
  name: 'Test Sticker',
  stickerId: 'sticker-001',
  mediaId: 'image-test-001',
  startTime: 2,
  duration: 8,
  trimStart: 0,
  trimEnd: 0,
  hidden: false,
};

export const mockCaptionElement: CaptionElement = {
  id: 'element-caption-001',
  type: 'captions',
  name: 'Test Caption',
  text: 'This is a test caption',
  language: 'en',
  confidence: 0.95,
  source: 'transcription',
  startTime: 0,
  duration: 3,
  trimStart: 0,
  trimEnd: 0,
  hidden: false,
};

export const mockTimelineElements: TimelineElement[] = [
  mockMediaElement,
  mockTextElement,
  mockStickerElement,
  mockCaptionElement,
];

export const mockTimelineTracks: TimelineTrack[] = [
  { ...mockMainTrack, elements: [mockMediaElement] },
  { ...mockTextTrack, elements: [mockTextElement] },
  { ...mockAudioTrack, elements: [] },
];

/**
 * Create custom timeline element
 */
export function createMockTimelineElement(
  type: 'media' | 'text' | 'sticker' | 'captions',
  overrides: Partial<TimelineElement> = {}
): TimelineElement {
  const baseElement = {
    id: `element-${type}-${Date.now()}-${Math.random().toString(36).substring(2)}`,
    name: `Test ${type}`,
    startTime: 0,
    duration: 5,
    trimStart: 0,
    trimEnd: 0,
    hidden: false,
  };

  switch (type) {
    case 'media':
      return {
        ...baseElement,
        ...mockMediaElement,
        ...overrides,
      } as MediaElement;
    case 'text':
      return {
        ...baseElement,
        ...mockTextElement,
        ...overrides,
      } as TextElement;
    case 'sticker':
      return {
        ...baseElement,
        ...mockStickerElement,
        ...overrides,
      } as StickerElement;
    case 'captions':
      return {
        ...baseElement,
        ...mockCaptionElement,
        ...overrides,
      } as CaptionElement;
  }
}

/**
 * Create custom timeline track
 */
export function createMockTimelineTrack(
  type: 'media' | 'text' | 'audio' | 'sticker' | 'captions',
  overrides: Partial<TimelineTrack> = {}
): TimelineTrack {
  return {
    id: `track-${type}-${Date.now()}`,
    name: `${type} Track`,
    type,
    elements: [],
    muted: false,
    ...overrides,
  };
}