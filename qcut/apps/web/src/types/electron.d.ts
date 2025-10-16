import type { StickerSource } from '../../../../electron/ffmpeg-handler';

export interface ElectronAPI {
  // System info
  platform: string;
  isElectron: boolean;

  // File operations
  openFileDialog: () => Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;

  openMultipleFilesDialog: () => Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;

  saveFileDialog: (
    defaultFilename?: string,
    filters?: Array<{ name: string; extensions: string[] }>
  ) => Promise<{
    canceled: boolean;
    filePath?: string;
  }>;

  readFile: (filePath: string) => Promise<Buffer>;
  writeFile: (
    filePath: string,
    data: Buffer | Uint8Array
  ) => Promise<{ success: boolean }>;
  getFileInfo: (filePath: string) => Promise<{
    size: number;
    created: Date;
    modified: Date;
    isFile: boolean;
    isDirectory: boolean;
  }>;

  // Storage operations
  storage: {
    save: (key: string, data: any) => Promise<void>;
    load: (key: string) => Promise<any | null>;
    remove: (key: string) => Promise<void>;
    list: () => Promise<string[]>;
    clear: () => Promise<void>;
  };

  // Sound operations
  sounds: {
    search: (params: {
      q?: string;
      type?: "effects" | "songs";
      page?: number;
      page_size?: number;
      sort?: "downloads" | "rating" | "created" | "score";
      min_rating?: number;
      commercial_only?: boolean;
    }) => Promise<{
      success: boolean;
      count?: number;
      next?: string | null;
      previous?: string | null;
      results?: Array<{
        id: number;
        name: string;
        description: string;
        url: string;
        previewUrl?: string;
        downloadUrl?: string;
        duration: number;
        filesize: number;
        type: string;
        channels: number;
        bitrate: number;
        bitdepth: number;
        samplerate: number;
        username: string;
        tags: string[];
        license: string;
        created: string;
        downloads: number;
        rating: number;
        ratingCount: number;
      }>;
      query?: string;
      type?: string;
      page?: number;
      pageSize?: number;
      sort?: string;
      minRating?: number;
      error?: string;
      message?: string;
    }>;
    downloadPreview: (params: { url: string; id: number }) => Promise<{
      success: boolean;
      localPath?: string;
      error?: string;
    }>;
  };

  // Audio operations
  audio: {
    saveTemp: (audioData: Uint8Array, filename: string) => Promise<string>;
  };

  /**
   * Video temp file management API
   * Saves video files to temporary directory for FFmpeg direct copy optimization
   */
  video?: {
    /**
     * Save video data to temp directory
     * @param videoData - Video file data as Uint8Array
     * @param filename - Original filename (will be sanitized)
     * @param sessionId - Optional session ID for session-based cleanup
     * @returns Absolute path to saved temp file
     */
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
    cancel: (id: string) => Promise<{
      success: boolean;
      message?: string;
      error?: string;
    }>;
  };

  // Generic IPC invoke method
  invoke: (channel: string, ...args: any[]) => Promise<any>;

  // FFmpeg export operations
  ffmpeg: {
    createExportSession: () => Promise<{
      sessionId: string;
      frameDir: string;
      outputDir: string;
    }>;
    saveFrame: (data: {
      sessionId: string;
      frameName: string;
      data: string;
    }) => Promise<string>;
    saveStickerForExport: (data: {
      sessionId: string;
      stickerId: string;
      imageData: ArrayBuffer;
      format?: string;
    }) => Promise<{ success: boolean; path?: string; error?: string }>;
    exportVideoCLI: (options: {
      sessionId: string;
      width: number;
      height: number;
      fps: number;
      quality: string;
      filterChain?: string;
      textFilterChain?: string;
      stickerFilterChain?: string;
      stickerSources?: StickerSource[];
      duration?: number;
      audioFiles?: any[];
      useDirectCopy?: boolean;
      videoSources?: any[];
    }) => Promise<{ success: boolean; outputFile: string }>;
    readOutputFile: (path: string) => Promise<Buffer>;
    cleanupExportSession: (sessionId: string) => Promise<void>;
    validateFilterChain: (filterChain: string) => Promise<boolean>;
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
    getPath: () => Promise<string>;
  };

  apiKeys: {
    get: () => Promise<{
      falApiKey: string;
      freesoundApiKey: string;
      geminiApiKey: string;
    }>;
    set: (keys: {
      falApiKey?: string;
      freesoundApiKey?: string;
      geminiApiKey?: string;
    }) => Promise<boolean>;
    clear: () => Promise<boolean>;
  };

  github: {
    fetchStars: () => Promise<{
      stars: number;
    }>;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
