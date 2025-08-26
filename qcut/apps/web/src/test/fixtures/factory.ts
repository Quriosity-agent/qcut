import { mockVideoItem, mockImageItem, mockAudioItem } from './media-items';
import { 
  mockMainTrack, 
  mockTextTrack, 
  mockAudioTrack,
  mockTimelineElements 
} from './timeline-data';
import { mockProject } from './project-data';
import type { MediaItem } from '@/stores/media-store-types';
import type { TimelineTrack, TimelineElement } from '@/types/timeline';
import type { TProject } from '@/types/project';

export class TestDataFactory {
  static createMediaItem(type: 'video' | 'image' | 'audio', overrides: Partial<MediaItem> = {}): MediaItem {
    const base = type === 'video' ? mockVideoItem 
                : type === 'image' ? mockImageItem 
                : mockAudioItem;
    return { ...base, ...overrides, id: `${type}-${Date.now()}` };
  }
  
  static createTimelineTrack(type: 'media' | 'text' | 'audio' = 'media', overrides: Partial<TimelineTrack> = {}): TimelineTrack {
    const base = type === 'media' ? mockMainTrack
                : type === 'text' ? mockTextTrack
                : mockAudioTrack;
    return { ...base, ...overrides, id: `track-${Date.now()}` };
  }
  
  static createTimelineElement(index = 0, overrides: Partial<TimelineElement> = {}): TimelineElement {
    const base = mockTimelineElements[index] || mockTimelineElements[0];
    return { ...base, ...overrides, id: `element-${Date.now()}` };
  }
  
  static createProject(overrides: Partial<TProject> = {}): TProject {
    return { ...mockProject, ...overrides, id: `project-${Date.now()}` };
  }
  
  static createBatch<T>(
    createFn: (...args: any[]) => T, 
    count: number, 
    ...args: any[]
  ): T[] {
    return Array.from({ length: count }, (_, i) => 
      createFn(...args, { index: i })
    );
  }
}