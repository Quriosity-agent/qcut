import { vi } from "vitest";
import type { FFmpeg } from "@ffmpeg/ffmpeg";

/**
 * Mock FFmpeg instance matching @ffmpeg/ffmpeg interface
 */
export class MockFFmpeg implements Partial<FFmpeg> {
  loaded = false;

  load = vi.fn().mockImplementation(async () => {
    this.loaded = true;
    return true;
  });

  writeFile = vi.fn().mockResolvedValue(undefined);
  readFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  deleteFile = vi.fn().mockResolvedValue(undefined);
  rename = vi.fn().mockResolvedValue(undefined);
  createDir = vi.fn().mockResolvedValue(undefined);
  listDir = vi.fn().mockResolvedValue([]);
  deleteDir = vi.fn().mockResolvedValue(undefined);

  exec = vi.fn().mockResolvedValue(0);
  terminate = vi.fn().mockResolvedValue(undefined);

  on = vi.fn();
  off = vi.fn();
}

/**
 * Mock for createFFmpeg function
 */
export const mockCreateFFmpeg = vi.fn(() => new MockFFmpeg());

/**
 * Mock for FFmpeg utilities
 */
export const mockFFmpegUtils = {
  fetchFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  toBlobURL: vi.fn((url: string) => Promise.resolve(`blob:${url}`)),
};

/**
 * Setup FFmpeg mocks globally
 */
export function setupFFmpegMocks() {
  vi.mock("@ffmpeg/ffmpeg", () => ({
    FFmpeg: MockFFmpeg,
    createFFmpeg: mockCreateFFmpeg,
  }));

  vi.mock("@ffmpeg/util", () => mockFFmpegUtils);
}
