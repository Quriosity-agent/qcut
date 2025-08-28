import { mockVideoItem, mockImageItem, mockAudioItem } from './media-items';
import { 
  mockMainTrack, 
  mockTextTrack, 
  mockAudioTrack,
  mockStickerTrack,
  mockCaptionTrack,
  mockTimelineElements 
} from './timeline-data';
import { mockProject } from './project-data';
import type { MediaItem } from '@/stores/media-store-types';
import type { TimelineTrack, TimelineElement } from '@/types/timeline';
import type { TProject } from '@/types/project';

let __factorySeq = 0;
const nextId = (): string => `${Date.now()}-${__factorySeq++}`;

export const TestDataFactory = {
  createMediaItem: (type: MediaItem['type'], overrides: Partial<MediaItem> = {}): MediaItem => {
    let base: MediaItem;
    switch (type) {
      case 'video': base = mockVideoItem; break;
      case 'image': base = mockImageItem; break;
      case 'audio': base = mockAudioItem; break;
      default: throw new Error(`Unsupported media type: ${type}`);
    }
    const id = overrides.id ?? `media-${nextId()}`;
    const metadata = overrides.metadata ? { ...overrides.metadata } : { ...base.metadata };
    return { ...base, ...overrides, id, metadata };
  },

  createTimelineTrack: (type: TimelineTrack['type'] = 'media', overrides: Partial<TimelineTrack> = {}): TimelineTrack => {
    let base: TimelineTrack;
    switch (type) {
      case 'media': base = mockMainTrack; break;
      case 'text': base = mockTextTrack; break;
      case 'audio': base = mockAudioTrack; break;
      case 'sticker': base = mockStickerTrack; break;
      case 'captions': base = mockCaptionTrack; break;
      default: throw new Error(`Unsupported track type: ${type}`);
    }
    const id = overrides.id ?? `track-${nextId()}`;
    const elements = overrides.elements ? [...overrides.elements] : [...base.elements];
    return { ...base, ...overrides, id, elements };
  },

  createTimelineElement: (index = 0, overrides: Partial<TimelineElement> = {}): TimelineElement => {
    const base = mockTimelineElements.at(index) ?? mockTimelineElements[0];
    const id = overrides.id ?? `element-${nextId()}`;
    return { ...base, ...overrides, id } as TimelineElement;
  },

  createProject: (overrides: Partial<TProject> = {}): TProject => {
    const id = overrides.id ?? `project-${nextId()}`;
    return { ...mockProject, ...overrides, id };
  },

  // Strictly-typed, zero-`any` batch helper. Callers pass config via closure or the `options` object.
  createBatch: <T, TOptions>(
    count: number,
    createFn: (options: TOptions, ctx: { index: number }) => T,
    options: TOptions
  ): T[] => {
    const out: T[] = [];
    for (let i = 0; i < count; i++) {
      out.push(createFn(options, { index: i }));
    }
    return out;
  },
} as const;