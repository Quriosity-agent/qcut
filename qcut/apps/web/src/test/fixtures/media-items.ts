import type { MediaItem } from "@/stores/media-store-types";

/**
 * Mock media items matching MediaItem interface from media-store-types.ts
 */
export const mockVideoItem: MediaItem = {
  id: "video-test-001",
  name: "test-video.mp4",
  type: "video",
  url: "blob:http://localhost:3000/video-123",
  file: new File(["video content"], "test-video.mp4", { type: "video/mp4" }),
  duration: 120, // 2 minutes
  width: 1920,
  height: 1080,
  fps: 30,
  thumbnailUrl: "blob:http://localhost:3000/thumb-123",
  metadata: {
    source: "upload",
  },
};

export const mockImageItem: MediaItem = {
  id: "image-test-001",
  name: "test-image.jpg",
  type: "image",
  url: "blob:http://localhost:3000/image-456",
  file: new File(["image content"], "test-image.jpg", { type: "image/jpeg" }),
  width: 1920,
  height: 1080,
  metadata: {
    source: "upload",
  },
};

export const mockAudioItem: MediaItem = {
  id: "audio-test-001",
  name: "test-audio.mp3",
  type: "audio",
  url: "blob:http://localhost:3000/audio-789",
  originalUrl: "https://example.com/audio.mp3",
  file: new File(["audio content"], "test-audio.mp3", { type: "audio/mpeg" }),
  duration: 180, // 3 minutes
  metadata: {
    source: "sound-library",
  },
};

export const mockTextItem: MediaItem = {
  id: "text-test-001",
  name: "Test Text",
  type: "image", // Text items are treated as images for rendering
  file: new File([""], "text.txt", { type: "text/plain" }),
  content: "Sample Text Content",
  fontSize: 24,
  fontFamily: "Arial",
  color: "#FFFFFF",
  backgroundColor: "transparent",
  textAlign: "center",
  metadata: {
    source: "text-generator",
  },
};

export const mockMediaItems: MediaItem[] = [
  mockVideoItem,
  mockImageItem,
  mockAudioItem,
  mockTextItem,
];

/**
 * Create a custom media item for testing
 */
export function createMockMediaItem(
  overrides: Partial<MediaItem> = {}
): MediaItem {
  return {
    ...mockVideoItem,
    id: `media-${Date.now()}-${Math.random().toString(36).substring(2)}`,
    ...overrides,
  };
}
