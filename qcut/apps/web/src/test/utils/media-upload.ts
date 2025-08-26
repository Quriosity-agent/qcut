import { fireEvent } from '@testing-library/react';

export function createMockFile(
  name: string,
  size = 1024,
  type = 'image/jpeg'
): File {
  const content = new ArrayBuffer(size);
  return new File([content], name, { type });
}

export function createMockVideoFile(name = 'video.mp4', duration = 10): File {
  return createMockFile(name, 1024 * 1024, 'video/mp4');
}

export function createMockAudioFile(name = 'audio.mp3'): File {
  return createMockFile(name, 512 * 1024, 'audio/mpeg');
}

export function simulateFileUpload(
  input: HTMLInputElement,
  files: File | File[]
) {
  const fileList = Array.isArray(files) ? files : [files];
  
  Object.defineProperty(input, 'files', {
    value: fileList,
    writable: true,
    configurable: true,
  });
  
  fireEvent.change(input, { target: { files: fileList } });
}