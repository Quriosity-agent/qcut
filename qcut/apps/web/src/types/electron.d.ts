import type { StickerSource } from "../../../../electron/ffmpeg-handler";
import type {
  VideoSourceInput,
  AudioFileInput,
} from "../lib/export-engine-cli";

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
  saveBlob: (
    data: Buffer | Uint8Array,
    defaultFilename?: string
  ) => Promise<{
    success: boolean;
    filePath?: string;
    canceled?: boolean;
    error?: string;
  }>;
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
   * Video file management API
   * Includes both temp file management and AI video permanent storage
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

    /**
     * MANDATORY: Save AI-generated video to permanent storage
     * This must succeed or the entire operation should fail
     * @param options - Save options including file data and metadata
     * @returns Result object with local path or error
     */
    saveToDisk: (options: {
      fileName: string;
      fileData: ArrayBuffer | Uint8Array;
      projectId: string;
      modelId?: string;
      metadata?: {
        width?: number;
        height?: number;
        duration?: number;
        fps?: number;
      };
    }) => Promise<{
      success: boolean;
      localPath?: string;
      fileName?: string;
      fileSize?: number;
      error?: string;
    }>;

    /**
     * Verify if a saved AI video file exists and is valid
     * @param filePath - Absolute path to the video file
     * @returns True if file exists and is valid
     */
    verifyFile: (filePath: string) => Promise<boolean>;

    /**
     * Delete AI video file and its metadata
     * @param filePath - Absolute path to the video file
     * @returns True if deletion succeeded
     */
    deleteFile: (filePath: string) => Promise<boolean>;

    /**
     * Get the AI videos directory for a project
     * @param projectId - Project identifier
     * @returns Absolute path to the project's AI videos directory
     */
    getProjectDir: (projectId: string) => Promise<string>;
  };

  // Transcription operations (Gemini API)
  transcribe: {
    transcribe: (request: { audioPath: string; language?: string }) => Promise<{
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
    /**
     * Save sticker image data to temp directory for FFmpeg export
     * @param data.sessionId - Export session ID for organizing temp files
     * @param data.stickerId - Unique sticker identifier for filename generation
     * @param data.imageData - Sticker image data as Uint8Array
     * @param data.format - Optional image format (default: png)
     * @returns Promise resolving to success status, absolute file path, or error message
     */
    saveStickerForExport: (data: {
      sessionId: string;
      stickerId: string;
      imageData: Uint8Array;
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
      audioFiles?: AudioFileInput[];
      useDirectCopy?: boolean;
      videoSources?: VideoSourceInput[];
      // Mode 2: Direct video input with filters
      useVideoInput?: boolean;
      videoInputPath?: string;
      trimStart?: number;
      trimEnd?: number;
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
    extractAudio: (options: { videoPath: string; format?: string }) => Promise<{
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

  /**
   * FAL AI operations (bypasses CORS in Electron)
   * These methods run in the main process to avoid browser CORS restrictions
   */
  fal: {
    /**
     * Upload video to FAL storage via Electron IPC
     * This bypasses CORS restrictions that would block direct browser fetch calls
     * @param videoData - Video file data as Uint8Array
     * @param filename - Original filename
     * @param apiKey - FAL API key for authentication
     * @returns Upload result with URL or error
     */
    uploadVideo: (
      videoData: Uint8Array,
      filename: string,
      apiKey: string
    ) => Promise<{
      success: boolean;
      url?: string;
      error?: string;
    }>;

    /**
     * Upload image to FAL storage via Electron IPC
     * Used for Seeddream 4.5 edit and other image-based models
     * @param imageData - Image file data as Uint8Array
     * @param filename - Original filename
     * @param apiKey - FAL API key for authentication
     * @returns Upload result with URL or error
     */
    uploadImage: (
      imageData: Uint8Array,
      filename: string,
      apiKey: string
    ) => Promise<{
      success: boolean;
      url?: string;
      error?: string;
    }>;

    /**
     * Upload audio to FAL storage via Electron IPC
     * Used for Kling Avatar v2 and other audio-based models
     * @param audioData - Audio file data as Uint8Array
     * @param filename - Original filename
     * @param apiKey - FAL API key for authentication
     * @returns Upload result with URL or error
     */
    uploadAudio: (
      audioData: Uint8Array,
      filename: string,
      apiKey: string
    ) => Promise<{
      success: boolean;
      url?: string;
      error?: string;
    }>;
  };

  /**
   * Gemini Chat operations
   * Enables conversational AI interactions with media context
   */
  geminiChat?: {
    /**
     * Send a chat message to Gemini with optional attachments
     * @param request - Chat request with messages and optional media attachments
     * @returns Promise resolving to success status
     */
    send: (request: {
      messages: Array<{
        role: "user" | "assistant";
        content: string;
      }>;
      attachments?: Array<{
        path: string;
        mimeType: string;
        name: string;
      }>;
      model?: string;
    }) => Promise<{ success: boolean; error?: string }>;

    /**
     * Register callback for streaming text chunks
     */
    onStreamChunk: (callback: (data: { text: string }) => void) => void;

    /**
     * Register callback for stream completion
     */
    onStreamComplete: (callback: () => void) => void;

    /**
     * Register callback for stream errors
     */
    onStreamError: (callback: (data: { message: string }) => void) => void;

    /**
     * Remove all stream listeners (call on cleanup)
     */
    removeListeners: () => void;
  };

  /**
   * PTY Terminal operations
   * Enables full terminal emulation via node-pty
   */
  pty?: {
    /**
     * Spawn a new PTY session
     * @param options - Optional spawn configuration
     * @returns Promise resolving to session ID or error
     */
    spawn: (options?: {
      cols?: number;
      rows?: number;
      cwd?: string;
      command?: string; // e.g., "npx @google/gemini-cli"
    }) => Promise<{ success: boolean; sessionId?: string; error?: string }>;

    /**
     * Write data to PTY (keyboard input)
     * @param sessionId - Session to write to
     * @param data - Data to write (keystrokes)
     */
    write: (
      sessionId: string,
      data: string
    ) => Promise<{ success: boolean; error?: string }>;

    /**
     * Resize PTY dimensions
     * @param sessionId - Session to resize
     * @param cols - Number of columns
     * @param rows - Number of rows
     */
    resize: (
      sessionId: string,
      cols: number,
      rows: number
    ) => Promise<{ success: boolean; error?: string }>;

    /**
     * Kill a PTY session
     * @param sessionId - Session to kill
     */
    kill: (sessionId: string) => Promise<{ success: boolean; error?: string }>;

    /**
     * Kill all PTY sessions (cleanup)
     */
    killAll: () => Promise<{ success: boolean }>;

    /**
     * Register callback for PTY output data
     */
    onData: (
      callback: (data: { sessionId: string; data: string }) => void
    ) => void;

    /**
     * Register callback for PTY exit
     */
    onExit: (
      callback: (data: {
        sessionId: string;
        exitCode: number;
        signal?: number;
      }) => void
    ) => void;

    /**
     * Remove all PTY event listeners
     */
    removeListeners: () => void;
  };

  /**
   * Skills operations
   * Manages AI skills stored per-project
   */
  skills?: {
    /**
     * List all skills in a project
     * @param projectId - Project identifier
     * @returns Array of skills
     */
    list: (projectId: string) => Promise<
      Array<{
        id: string;
        name: string;
        description: string;
        dependencies?: string;
        folderName: string;
        mainFile: string;
        additionalFiles: string[];
        content: string;
        createdAt: number;
        updatedAt: number;
      }>
    >;

    /**
     * Import a skill from a source folder
     * @param projectId - Target project
     * @param sourcePath - Absolute path to skill folder
     * @returns Imported skill or null on failure
     */
    import: (
      projectId: string,
      sourcePath: string
    ) => Promise<{
      id: string;
      name: string;
      description: string;
      dependencies?: string;
      folderName: string;
      mainFile: string;
      additionalFiles: string[];
      content: string;
      createdAt: number;
      updatedAt: number;
    } | null>;

    /**
     * Delete a skill from a project
     * @param projectId - Project identifier
     * @param skillId - Skill folder name/ID
     */
    delete: (projectId: string, skillId: string) => Promise<void>;

    /**
     * Get content of a specific file in a skill
     * @param projectId - Project identifier
     * @param skillId - Skill folder name/ID
     * @param filename - File to read (e.g., "Skill.md", "REFERENCE.md")
     */
    getContent: (
      projectId: string,
      skillId: string,
      filename: string
    ) => Promise<string>;

    /**
     * Open folder browser to select a skill folder
     * @returns Selected path or null if canceled
     */
    browse: () => Promise<string | null>;

    /**
     * Get the skills folder path for a project
     * @param projectId - Project identifier
     */
    getPath: (projectId: string) => Promise<string>;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
