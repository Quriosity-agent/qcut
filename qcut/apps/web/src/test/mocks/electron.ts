import { vi } from "vitest";
import type { ElectronAPI } from "@/types/electron";

/**
 * Complete mock of Electron API matching useElectron hook
 */
export const mockElectronAPI: ElectronAPI = {
  // System info
  platform: "win32",
  isElectron: true,

  // File operations
  openFileDialog: vi.fn().mockResolvedValue({
    canceled: false,
    filePaths: ["/path/to/file.mp4"],
  }),
  openMultipleFilesDialog: vi.fn().mockResolvedValue({
    canceled: false,
    filePaths: ["/path/to/file1.mp4", "/path/to/file2.jpg"],
  }),
  saveFileDialog: vi.fn().mockResolvedValue({
    canceled: false,
    filePath: "/path/to/save.mp4",
  }),
  readFile: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
  writeFile: vi.fn().mockResolvedValue({ success: true }),
  getFileInfo: vi.fn().mockResolvedValue({
    size: 1024,
    created: new Date(),
    modified: new Date(),
    isFile: true,
    isDirectory: false,
  }),

  // Storage operations
  storage: {
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    clear: vi.fn().mockResolvedValue(undefined),
  },

  // Generic IPC invoke method
  invoke: vi.fn().mockResolvedValue(undefined),

  // FFmpeg operations
  ffmpeg: {
    createExportSession: vi.fn().mockResolvedValue({
      sessionId: "test-session",
      frameDir: "/tmp/frames",
      outputDir: "/tmp/output",
    }),
    saveFrame: vi.fn().mockResolvedValue("frame-001.png"),
    exportVideoCLI: vi.fn().mockResolvedValue({
      success: true,
      outputFile: "output.mp4",
    }),
    readOutputFile: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
    cleanupExportSession: vi.fn().mockResolvedValue(undefined),
  },
};

/**
 * Setup mock Electron API in window
 */
export function setupElectronMock() {
  window.electronAPI = mockElectronAPI;
  return () => {
    Reflect.deleteProperty(window, "electronAPI");
  };
}

/**
 * Mock for non-Electron environment
 */
export const mockNonElectronAPI = {
  isElectron: false,
};
