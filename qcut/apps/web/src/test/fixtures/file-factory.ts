/**
 * Factory functions for creating mock File objects for testing
 */

// Create a mock video file with realistic metadata
export function createMockVideoFile(
  name = 'test-video.mp4',
  sizeInMB = 10
): File {
  const content = new Uint8Array(sizeInMB * 1024 * 1024);
  return new File([content], name, { 
    type: 'video/mp4',
    lastModified: Date.now()
  });
}

// Create a mock image file
export function createMockImageFile(
  name = 'test-image.jpg',
  sizeInKB = 500
): File {
  const content = new Uint8Array(sizeInKB * 1024);
  return new File([content], name, { 
    type: 'image/jpeg',
    lastModified: Date.now()
  });
}

// Create a mock audio file
export function createMockAudioFile(
  name = 'test-audio.mp3',
  sizeInMB = 3
): File {
  const content = new Uint8Array(sizeInMB * 1024 * 1024);
  return new File([content], name, { 
    type: 'audio/mpeg',
    lastModified: Date.now()
  });
}

// Create a mock text file (for subtitles/captions)
export function createMockTextFile(
  name = 'subtitles.srt',
  content = 'Test subtitle content'
): File {
  return new File([content], name, { 
    type: 'text/plain',
    lastModified: Date.now()
  });
}

// Create multiple files at once
export function createMockMediaFiles() {
  return {
    video: createMockVideoFile(),
    image: createMockImageFile(),
    audio: createMockAudioFile(),
    text: createMockTextFile(),
  };
}

// Helper to get file type (matching getFileType from media-store.ts)
export function getMockFileType(file: File): 'video' | 'audio' | 'image' | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  return null;
}