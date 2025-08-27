import { vi } from 'vitest';

declare global {
  interface Window {
    electronAPI?: typeof mockElectronAPI;
  }
}

/**
 * Complete mock of Electron API matching useElectron hook
 */
export const mockElectronAPI = {
  isElectron: true,
  
  // File operations
  openFileDialog: vi.fn().mockResolvedValue('/path/to/file.mp4'),
  openMultipleFilesDialog: vi.fn().mockResolvedValue(['/path/to/file1.mp4', '/path/to/file2.jpg']),
  saveFileDialog: vi.fn().mockResolvedValue('/path/to/save.mp4'),
  readFile: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
  writeFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getFileInfo: vi.fn().mockResolvedValue({ size: 1024, lastModified: Date.now() }),
  
  // Directory operations
  ensureDir: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue(['file1.mp4', 'file2.jpg']),
  
  // FFmpeg operations
  runFFmpegCommand: vi.fn().mockResolvedValue({ success: true, output: 'output.mp4' }),
  getFFmpegPath: vi.fn().mockReturnValue('/path/to/ffmpeg'),
  
  // Theme operations
  getTheme: vi.fn().mockReturnValue('dark'),
  setTheme: vi.fn(),
  onThemeChange: vi.fn(),
  
  // Sound operations (if exists)
  playSound: vi.fn(),
  stopSound: vi.fn(),
  getSounds: vi.fn().mockResolvedValue([]),
};

/**
 * Setup mock Electron API in window
 */
export function setupElectronMock() {
  window.electronAPI = mockElectronAPI;
  return () => {
    Reflect.deleteProperty(window, 'electronAPI');
  };
}

/**
 * Mock for non-Electron environment
 */
export const mockNonElectronAPI = {
  isElectron: false,
};