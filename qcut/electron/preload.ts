import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

// Type definitions for the exposed API
interface FileDialogFilter {
  name: string;
  extensions: string[];
}

interface FileInfo {
  name: string;
  path: string;
  size: number;
  lastModified: Date;
  type: string;
}

interface SoundSearchParams {
  query?: string;
  page?: number;
  pageSize?: number;
  duration?: string;
  sort?: string;
}

interface SoundDownloadParams {
  soundId: number;
  previewUrl: string;
  name: string;
}

interface TranscriptionRequestData {
  id: string;
  filename: string;
  language?: string;
  decryptionKey?: string;
  iv?: string;
  controller?: AbortController;
}

interface TranscriptionResult {
  success: boolean;
  text?: string;
  segments?: TranscriptionSegment[];
  language?: string;
  error?: string;
  message?: string;
  id?: string;
}

interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface CancelResult {
  success: boolean;
  message?: string;
}

interface ExportSession {
  sessionId: string;
  frameDir: string;
  outputDir: string;
}

interface FrameData {
  sessionId: string;
  frameNumber: number;
  imageData: ArrayBuffer | Buffer;
}

interface VideoSource {
  path: string;
  startTime: number;
  duration: number;
  trimStart?: number;
  trimEnd?: number;
}

interface ExportOptions {
  sessionId: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  audioFiles?: AudioFile[];
  metadata?: Record<string, string>;
  useDirectCopy?: boolean;
  videoSources?: VideoSource[];
  // Mode 2: Direct video input with filters
  useVideoInput?: boolean;
  videoInputPath?: string;
  trimStart?: number;
  trimEnd?: number;
  // Mode 1.5: Video normalization (NEW!)
  optimizationStrategy?: 'image-pipeline' | 'direct-copy' | 'direct-video-with-filters' | 'video-normalization';
}

interface AudioFile {
  path: string;
  startTime: number;
  volume?: number;
}

interface ApiKeyConfig {
  FREESOUND_API_KEY?: string;
  FAL_API_KEY?: string;
  GEMINI_API_KEY?: string;
  freesoundApiKey?: string;
  falApiKey?: string;
  geminiApiKey?: string;
}

interface GitHubStarsResponse {
  stars: number;
}

type ThemeSource = "system" | "light" | "dark";

// Main electronAPI interface
interface ElectronAPI {
  // System info
  platform: NodeJS.Platform;

  // File operations
  openFileDialog: () => Promise<string | null>;
  openMultipleFilesDialog: () => Promise<string[]>;
  saveFileDialog: (
    defaultFilename?: string,
    filters?: FileDialogFilter[]
  ) => Promise<string | null>;
  readFile: (filePath: string) => Promise<Buffer | null>;
  writeFile: (filePath: string, data: Buffer | string) => Promise<boolean>;
  getFileInfo: (filePath: string) => Promise<FileInfo | null>;

  // Storage operations
  storage: {
    save: (key: string, data: any) => Promise<boolean>;
    load: (key: string) => Promise<any>;
    remove: (key: string) => Promise<boolean>;
    list: () => Promise<string[]>;
    clear: () => Promise<boolean>;
  };

  // Theme operations
  theme: {
    get: () => Promise<ThemeSource>;
    set: (theme: ThemeSource) => Promise<ThemeSource>;
    toggle: () => Promise<ThemeSource>;
    isDark: () => Promise<boolean>;
  };

  // Sound operations
  sounds: {
    search: (params: SoundSearchParams) => Promise<any>;
    downloadPreview: (
      params: SoundDownloadParams
    ) => Promise<{ success: boolean; path?: string; error?: string }>;
  };

  // Audio operations
  audio: {
    saveTemp: (audioData: Uint8Array, filename: string) => Promise<string>;
  };

  // Video temp file operations
  video?: {
    saveTemp: (
      videoData: Uint8Array,
      filename: string,
      sessionId?: string
    ) => Promise<string>;
  };

  // Transcription operations (Gemini API)
  transcribe: {
    transcribe: (request: {
      audioPath: string;
      language?: string;
    }) => Promise<{
      text: string;
      segments: Array<{
        id: number;
        seek: number;
        start: number;
        end: number;
        text: string;
        tokens: number[];
        temperature: number;
        avg_logprob: number;
        compression_ratio: number;
        no_speech_prob: number;
      }>;
      language: string;
    }>;
    cancel: (id: string) => Promise<CancelResult>;
  };

  // FFmpeg export operations
  ffmpeg: {
    createExportSession: () => Promise<ExportSession>;
    saveFrame: (
      data: FrameData
    ) => Promise<{ success: boolean; error?: string }>;
    exportVideoCLI: (
      options: ExportOptions
    ) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
    readOutputFile: (path: string) => Promise<Buffer | null>;
    cleanupExportSession: (sessionId: string) => Promise<boolean>;
    openFramesFolder: (sessionId: string) => Promise<void>;
    processFrame: (options: {
      sessionId: string;
      inputFrameName: string;
      outputFrameName: string;
      filterChain: string;
    }) => Promise<void>;
    extractAudio: (options: {
      videoPath: string;
      format?: string;
    }) => Promise<{
      audioPath: string;
      fileSize: number;
    }>;
    validateFilterChain: (filterChain: string) => Promise<boolean>;
    saveStickerForExport: (data: {
      sessionId: string;
      stickerId: string;
      imageData: ArrayBuffer;
      format?: string;
    }) => Promise<{ success: boolean; path?: string; error?: string }>;

    // FFmpeg resource helpers
    getFFmpegResourcePath: (filename: string) => Promise<string>;
    checkFFmpegResource: (filename: string) => Promise<boolean>;
    getPath: () => Promise<string>;
  };

  // API key operations
  apiKeys: {
    get: () => Promise<ApiKeyConfig>;
    set: (keys: ApiKeyConfig) => Promise<boolean>;
    clear: () => Promise<boolean>;
  };

  // GitHub operations
  github: {
    fetchStars: () => Promise<GitHubStarsResponse>;
  };

  // Utility functions
  isElectron: boolean;
}

// Expose the API to the renderer process
const electronAPI: ElectronAPI = {
  // System info
  platform: process.platform,

  // File operations
  openFileDialog: (): Promise<string | null> =>
    ipcRenderer.invoke("open-file-dialog"),
  openMultipleFilesDialog: (): Promise<string[]> =>
    ipcRenderer.invoke("open-multiple-files-dialog"),
  saveFileDialog: (
    defaultFilename?: string,
    filters?: FileDialogFilter[]
  ): Promise<string | null> =>
    ipcRenderer.invoke("save-file-dialog", defaultFilename, filters),
  readFile: (filePath: string): Promise<Buffer | null> =>
    ipcRenderer.invoke("read-file", filePath),
  writeFile: (filePath: string, data: Buffer | string): Promise<boolean> =>
    ipcRenderer.invoke("write-file", filePath, data),
  getFileInfo: (filePath: string): Promise<FileInfo | null> =>
    ipcRenderer.invoke("get-file-info", filePath),

  // Storage operations
  storage: {
    save: (key: string, data: any): Promise<boolean> =>
      ipcRenderer.invoke("storage:save", key, data),
    load: (key: string): Promise<any> =>
      ipcRenderer.invoke("storage:load", key),
    remove: (key: string): Promise<boolean> =>
      ipcRenderer.invoke("storage:remove", key),
    list: (): Promise<string[]> => ipcRenderer.invoke("storage:list"),
    clear: (): Promise<boolean> => ipcRenderer.invoke("storage:clear"),
  },

  // Theme operations
  theme: {
    get: (): Promise<ThemeSource> => ipcRenderer.invoke("theme:get"),
    set: (theme: ThemeSource): Promise<ThemeSource> =>
      ipcRenderer.invoke("theme:set", theme),
    toggle: (): Promise<ThemeSource> => ipcRenderer.invoke("theme:toggle"),
    isDark: (): Promise<boolean> => ipcRenderer.invoke("theme:isDark"),
  },

  // Sound operations
  sounds: {
    search: (params: SoundSearchParams): Promise<any> =>
      ipcRenderer.invoke("sounds:search", params),
    downloadPreview: (
      params: SoundDownloadParams
    ): Promise<{ success: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke("sounds:download-preview", params),
  },

  // Audio operations
  audio: {
    saveTemp: (audioData: Uint8Array, filename: string): Promise<string> =>
      ipcRenderer.invoke("audio:save-temp", audioData, filename),
  },

  // Video temp file operations
  video: {
    saveTemp: (
      videoData: Uint8Array,
      filename: string,
      sessionId?: string
    ): Promise<string> =>
      ipcRenderer.invoke("video:save-temp", videoData, filename, sessionId),
  },

  // Transcription operations (Gemini API)
  transcribe: {
    transcribe: (request: {
      audioPath: string;
      language?: string;
    }): Promise<{
      text: string;
      segments: Array<{
        id: number;
        seek: number;
        start: number;
        end: number;
        text: string;
        tokens: number[];
        temperature: number;
        avg_logprob: number;
        compression_ratio: number;
        no_speech_prob: number;
      }>;
      language: string;
    }> => ipcRenderer.invoke("transcribe:audio", request),
    cancel: (id: string): Promise<CancelResult> =>
      ipcRenderer.invoke("transcribe:cancel", id),
  },

  // FFmpeg export operations
  ffmpeg: {
    createExportSession: (): Promise<ExportSession> =>
      ipcRenderer.invoke("create-export-session"),
    saveFrame: (
      data: FrameData
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("save-frame", data),
    exportVideoCLI: (
      options: ExportOptions
    ): Promise<{ success: boolean; outputPath?: string; error?: string }> =>
      ipcRenderer.invoke("export-video-cli", options),
    readOutputFile: (path: string): Promise<Buffer | null> =>
      ipcRenderer.invoke("read-output-file", path),
    cleanupExportSession: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke("cleanup-export-session", sessionId),
    openFramesFolder: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke("open-frames-folder", sessionId),
    extractAudio: (options: {
      videoPath: string;
      format?: string;
    }): Promise<{
      audioPath: string;
      fileSize: number;
    }> => ipcRenderer.invoke("extract-audio", options),
    saveStickerForExport: (data: {
      sessionId: string;
      stickerId: string;
      imageData: ArrayBuffer;
      format?: string;
    }): Promise<{ success: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke("save-sticker-for-export", data),
    processFrame: (options: {
      sessionId: string;
      inputFrameName: string;
      outputFrameName: string;
      filterChain: string;
    }): Promise<void> => ipcRenderer.invoke("processFrame", options),
    validateFilterChain: (filterChain: string): Promise<boolean> =>
      ipcRenderer.invoke("validate-filter-chain", filterChain),

    // FFmpeg resource helpers
    getFFmpegResourcePath: (filename: string): Promise<string> =>
      ipcRenderer.invoke("get-ffmpeg-resource-path", filename),
    checkFFmpegResource: (filename: string): Promise<boolean> =>
      ipcRenderer.invoke("check-ffmpeg-resource", filename),
    getPath: (): Promise<string> => ipcRenderer.invoke("ffmpeg-path"),
  },

  // API key operations
  apiKeys: {
    get: (): Promise<ApiKeyConfig> => ipcRenderer.invoke("api-keys:get"),
    set: (keys: ApiKeyConfig): Promise<boolean> =>
      ipcRenderer.invoke("api-keys:set", keys),
    clear: (): Promise<boolean> => ipcRenderer.invoke("api-keys:clear"),
  },

  // GitHub operations
  github: {
    fetchStars: (): Promise<GitHubStarsResponse> =>
      ipcRenderer.invoke("fetch-github-stars"),
  },

  // Utility functions
  isElectron: true,
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Export types for use in renderer process
export type {
  ElectronAPI,
  FileDialogFilter,
  FileInfo,
  SoundSearchParams,
  SoundDownloadParams,
  TranscriptionRequestData,
  TranscriptionResult,
  TranscriptionSegment,
  CancelResult,
  ExportSession,
  FrameData,
  ExportOptions,
  VideoSource,
  AudioFile,
  ApiKeyConfig,
  GitHubStarsResponse,
  ThemeSource,
};

// Global type augmentation for renderer process
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
