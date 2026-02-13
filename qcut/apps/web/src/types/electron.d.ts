import type { StickerSource } from "../../../../electron/ffmpeg-handler";
import type { FFmpegHealthResult } from "../../../../electron/ffmpeg/types";
import type {
  VideoSourceInput,
  AudioFileInput,
} from "../lib/export-engine-cli";
import type {
  MediaFile,
  ClaudeTimeline,
  ClaudeElement,
  ProjectSettings,
  ProjectStats,
  ExportPreset,
  ExportRecommendation,
  ErrorReport,
  DiagnosticResult,
} from "../../../../electron/types/claude-api";

/**
 * Word-level transcription item from ElevenLabs Scribe v2.
 */
export interface ElevenLabsTranscriptionWord {
  /** The transcribed word or event text */
  text: string;
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Type of element */
  type: "word" | "spacing" | "audio_event" | "punctuation";
  /** Speaker identifier (if diarization enabled) */
  speaker_id: string | null;
}

/**
 * Full transcription result from ElevenLabs Scribe v2.
 */
export interface ElevenLabsTranscribeResult {
  /** Full transcription text */
  text: string;
  /** Detected/specified language code */
  language_code: string;
  /** Confidence score for language detection (0-1) */
  language_probability: number;
  /** Word-level transcription data */
  words: ElevenLabsTranscriptionWord[];
}

export interface ElectronAPI {
  // System info
  platform: string;
  isElectron: boolean;

  // File operations
  openFileDialog: () => Promise<string | null>;

  openMultipleFilesDialog: () => Promise<string[]>;

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

  // Transcription operations (Gemini API + ElevenLabs)
  transcribe: {
    /** Gemini-based transcription (segments) */
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

    /**
     * ElevenLabs Scribe v2 transcription via FAL AI.
     * Returns word-level timestamps with speaker diarization.
     */
    elevenlabs: (options: {
      audioPath: string;
      language?: string;
      diarize?: boolean;
      tagAudioEvents?: boolean;
      keyterms?: string[];
    }) => Promise<ElevenLabsTranscribeResult>;

    /** Upload file to FAL storage */
    uploadToFal: (filePath: string) => Promise<{ url: string }>;
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
    /** Returns cached FFmpeg/FFprobe health check result */
    checkHealth: () => Promise<FFmpegHealthResult>;
  };

  apiKeys: {
    get: () => Promise<{
      falApiKey: string;
      freesoundApiKey: string;
      geminiApiKey: string;
      openRouterApiKey: string;
      anthropicApiKey: string;
    }>;
    set: (keys: {
      falApiKey?: string;
      freesoundApiKey?: string;
      geminiApiKey?: string;
      openRouterApiKey?: string;
      anthropicApiKey?: string;
    }) => Promise<boolean>;
    clear: () => Promise<boolean>;
  };

  // Shell operations
  shell: {
    showItemInFolder: (filePath: string) => Promise<void>;
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
    /** Proxy GET request to queue.fal.run through main process (bypasses CORS) */
    queueFetch: (
      url: string,
      apiKey: string
    ) => Promise<{ ok: boolean; status: number; data: unknown }>;
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
      command?: string; // e.g., "npx @google/gemini-cli" or "npx open-codex"
      env?: Record<string, string>; // Additional environment variables (e.g., OPENROUTER_API_KEY)
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

    /**
     * Scan for available skills (bundled + global ~/.claude/skills)
     * @returns Array of available skills with path, name, description, bundled flag
     */
    scanGlobal: () => Promise<
      Array<{
        path: string;
        name: string;
        description: string;
        bundled?: boolean;
      }>
    >;

    /**
     * Sync managed project skills into .claude/skills for Claude autodiscovery
     * @param projectId - Project identifier
     * @returns Sync summary
     */
    syncForClaude: (projectId: string) => Promise<{
      synced: boolean;
      copied: number;
      skipped: number;
      removed: number;
      warnings: string[];
      error?: string;
    }>;
  };

  /**
   * AI Content Pipeline API
   * Interfaces with the aicp CLI binary for AI content generation
   */
  aiPipeline?: {
    /**
     * Check if AI pipeline binary is available
     * @returns Availability status and optional error message
     */
    check: () => Promise<{ available: boolean; error?: string }>;

    /**
     * Get detailed pipeline status
     * @returns Full status including version, source, features
     */
    status: () => Promise<AIPipelineStatus>;

    /**
     * Generate AI content (image, video, avatar)
     * @param options - Generation options including command and arguments
     * @returns Result with output paths or error
     */
    generate: (options: AIPipelineGenerateOptions) => Promise<AIPipelineResult>;

    /**
     * List available AI models
     * @returns Result with model list
     */
    listModels: () => Promise<AIPipelineResult>;

    /**
     * Estimate generation cost
     * @param options - Model and generation parameters
     * @returns Result with cost estimate
     */
    estimateCost: (
      options: AIPipelineCostEstimate
    ) => Promise<AIPipelineResult>;

    /**
     * Cancel ongoing generation
     * @param sessionId - Session ID of the generation to cancel
     * @returns Success status
     */
    cancel: (sessionId: string) => Promise<{ success: boolean }>;

    /**
     * Refresh environment detection (after binary installation)
     * @returns Updated pipeline status
     */
    refresh: () => Promise<AIPipelineStatus>;

    /**
     * Listen for progress updates during generation
     * @param callback - Function called with progress data
     * @returns Cleanup function to remove listener
     */
    onProgress: (
      callback: (progress: AIPipelineProgress) => void
    ) => () => void;
  };

  /**
   * Media Import operations
   * Handles importing media files with symlink/copy hybrid approach
   */
  mediaImport?: {
    /**
     * Import a media file into the project
     * Attempts symlink first, falls back to copy if symlink fails
     * @param options - Import options including source path and project ID
     * @returns Import result with target path and method used
     */
    import: (options: MediaImportOptions) => Promise<MediaImportResult>;

    /**
     * Validate if a symlink is valid (target exists)
     * @param symlinkPath - Path to the symlink to validate
     * @returns True if symlink is valid
     */
    validateSymlink: (symlinkPath: string) => Promise<boolean>;

    /**
     * Get the original path of a symlinked file
     * @param mediaPath - Path to the imported media
     * @returns Original path or null if not a symlink
     */
    locateOriginal: (mediaPath: string) => Promise<string | null>;

    /**
     * Re-link media to a new source path
     * @param projectId - Project ID
     * @param mediaId - Media ID to relink
     * @param newSourcePath - New source file path
     * @returns Import result
     */
    relinkMedia: (
      projectId: string,
      mediaId: string,
      newSourcePath: string
    ) => Promise<MediaImportResult>;

    /**
     * Remove an imported media file (symlink or copy)
     * @param projectId - Project ID
     * @param mediaId - Media ID to remove
     */
    remove: (projectId: string, mediaId: string) => Promise<void>;

    /**
     * Check if symlinks are supported on the current system
     * @returns True if symlinks are supported
     */
    checkSymlinkSupport: () => Promise<boolean>;

    /**
     * Get the media folder path for a project
     * @param projectId - Project ID
     * @returns Absolute path to the project's media/imported folder
     */
    getMediaPath: (projectId: string) => Promise<string>;
  };

  /**
   * Project Folder operations
   * Enables browsing and managing project directory contents
   */
  projectFolder?: {
    /**
     * Get the root path for a project
     * @param projectId - Project ID
     * @returns Absolute path to the project root
     */
    getRoot: (projectId: string) => Promise<string>;

    /**
     * Scan a directory for files
     * @param projectId - Project ID
     * @param subPath - Subdirectory path relative to project root
     * @param options - Scan options (recursive, mediaOnly)
     * @returns Scan result with files, folders, and stats
     */
    scan: (
      projectId: string,
      subPath?: string,
      options?: { recursive?: boolean; mediaOnly?: boolean }
    ) => Promise<ProjectFolderScanResult>;

    /**
     * List immediate children of a directory
     * @param projectId - Project ID
     * @param subPath - Subdirectory path relative to project root
     * @returns Array of file/folder info
     */
    list: (
      projectId: string,
      subPath?: string
    ) => Promise<ProjectFolderFileInfo[]>;

    /**
     * Ensure project folder structure exists
     * @param projectId - Project ID
     * @returns Created and existing folder lists
     */
    ensureStructure: (
      projectId: string
    ) => Promise<{ created: string[]; existing: string[] }>;
  };

  /**
   * Claude Code Integration API
   * Provides APIs for Claude to interact with QCut
   */
  claude?: {
    media: {
      list: (projectId: string) => Promise<MediaFile[]>;
      info: (projectId: string, mediaId: string) => Promise<MediaFile | null>;
      import: (projectId: string, source: string) => Promise<MediaFile | null>;
      delete: (projectId: string, mediaId: string) => Promise<boolean>;
      rename: (
        projectId: string,
        mediaId: string,
        newName: string
      ) => Promise<boolean>;
    };
    timeline: {
      export: (projectId: string, format: "json" | "md") => Promise<string>;
      import: (
        projectId: string,
        data: string,
        format: "json" | "md"
      ) => Promise<void>;
      addElement: (
        projectId: string,
        element: Partial<ClaudeElement>
      ) => Promise<string>;
      updateElement: (
        projectId: string,
        elementId: string,
        changes: Partial<ClaudeElement>
      ) => Promise<void>;
      removeElement: (projectId: string, elementId: string) => Promise<void>;
      onRequest: (callback: () => void) => void;
      onApply: (callback: (timeline: ClaudeTimeline) => void) => void;
      onAddElement: (
        callback: (element: Partial<ClaudeElement>) => void
      ) => void;
      onUpdateElement: (
        callback: (data: {
          elementId: string;
          changes: Partial<ClaudeElement>;
        }) => void
      ) => void;
      onRemoveElement: (callback: (elementId: string) => void) => void;
      sendResponse: (timeline: ClaudeTimeline) => void;
      removeListeners: () => void;
    };
    project: {
      getSettings: (projectId: string) => Promise<ProjectSettings>;
      updateSettings: (
        projectId: string,
        settings: Partial<ProjectSettings>
      ) => Promise<void>;
      getStats: (projectId: string) => Promise<ProjectStats>;
      onStatsRequest: (callback: () => void) => void;
      sendStatsResponse: (stats: ProjectStats) => void;
      onUpdated: (
        callback: (
          projectId: string,
          settings: Partial<ProjectSettings>
        ) => void
      ) => void;
      removeListeners: () => void;
    };
    export: {
      getPresets: () => Promise<ExportPreset[]>;
      recommend: (
        projectId: string,
        target: string
      ) => Promise<ExportRecommendation>;
    };
    diagnostics: {
      analyze: (error: ErrorReport) => Promise<DiagnosticResult>;
    };
  };

  /**
   * Remotion Folder operations
   * Enables importing Remotion project folders with composition detection
   */
  remotionFolder?: {
    /**
     * Open folder selection dialog for Remotion projects
     * @returns Selection result with folder path or cancellation
     */
    select: () => Promise<RemotionFolderSelectResult>;

    /**
     * Scan a Remotion project folder for compositions
     * @param folderPath - Absolute path to the Remotion project
     * @returns Scan result with detected compositions
     */
    scan: (folderPath: string) => Promise<RemotionFolderScanResult>;

    /**
     * Bundle compositions from a folder
     * @param folderPath - Absolute path to the Remotion project
     * @param compositionIds - Optional array of specific composition IDs to bundle
     * @returns Bundle result with compiled code
     */
    bundle: (
      folderPath: string,
      compositionIds?: string[]
    ) => Promise<RemotionFolderBundleResult>;

    /**
     * Full import: scan + bundle in one operation
     * @param folderPath - Absolute path to the Remotion project
     * @returns Combined import result
     */
    import: (folderPath: string) => Promise<RemotionFolderImportResult>;

    /**
     * Check if bundler (esbuild) is available
     * @returns Bundler availability status
     */
    checkBundler: () => Promise<{ available: boolean }>;

    /**
     * Validate a folder is a valid Remotion project
     * @param folderPath - Absolute path to validate
     * @returns Validation result
     */
    validate: (
      folderPath: string
    ) => Promise<{ isValid: boolean; error?: string }>;
  };

  /**
   * Remotion pre-rendering operations
   * Used for pre-rendering Remotion compositions in Electron
   */
  remotion?: {
    /**
     * Pre-render frames for a composition
     * @param options - Pre-render options including element and render config
     * @returns Pre-render result with success status and rendered frames
     */
    preRender: (options: {
      elementId: string;
      componentId: string;
      props: Record<string, unknown>;
      outputDir: string;
      format: string;
      quality: number;
      width: number;
      height: number;
      fps: number;
      totalFrames: number;
      onProgress?: (frame: number) => void;
    }) => Promise<{
      success: boolean;
      frames: Map<number, string>;
      error?: string;
    }>;

    /**
     * Cleanup pre-rendered frames
     * @param sessionId - Session ID to cleanup
     */
    cleanup: (sessionId: string) => Promise<void>;
  };

  /**
   * Auto-update and release notes operations
   * Provides manual update control and access to bundled release notes
   */
  updates?: {
    /** Manually check for available updates */
    checkForUpdates: () => Promise<{
      available: boolean;
      version?: string;
      message?: string;
      error?: string;
    }>;
    /** Install a downloaded update (triggers app restart) */
    installUpdate: () => Promise<{
      success: boolean;
      message?: string;
      error?: string;
    }>;
    /** Get release notes for a specific version, or latest if omitted */
    getReleaseNotes: (version?: string) => Promise<ReleaseNote | null>;
    /** Get all available release notes, sorted newest first */
    getChangelog: () => Promise<ReleaseNote[]>;
    /** Listen for update-available events from auto-updater */
    onUpdateAvailable: (
      callback: (data: {
        version: string;
        releaseNotes?: string;
        releaseDate?: string;
      }) => void
    ) => () => void;
    /** Listen for download progress events */
    onDownloadProgress: (
      callback: (data: {
        percent: number;
        transferred: number;
        total: number;
      }) => void
    ) => () => void;
    /** Listen for update-downloaded events */
    onUpdateDownloaded: (
      callback: (data: { version: string }) => void
    ) => () => void;
  };
}

/**
 * A parsed release note with frontmatter metadata and Markdown content
 */
export interface ReleaseNote {
  /** Semver version string */
  version: string;
  /** Release date in ISO format */
  date: string;
  /** Release channel: stable, alpha, beta, or rc */
  channel: "stable" | "alpha" | "beta" | "rc";
  /** Raw Markdown content (excluding frontmatter) */
  content: string;
}

/**
 * File information from project folder operations
 */
export interface ProjectFolderFileInfo {
  /** File or folder name */
  name: string;
  /** Absolute path to the file */
  path: string;
  /** Path relative to project root */
  relativePath: string;
  /** Media type classification */
  type: "video" | "audio" | "image" | "unknown";
  /** File size in bytes (0 for directories) */
  size: number;
  /** Last modified timestamp in milliseconds */
  modifiedAt: number;
  /** Whether this entry is a directory */
  isDirectory: boolean;
}

/**
 * Result of a project folder scan operation
 */
export interface ProjectFolderScanResult {
  /** List of files found */
  files: ProjectFolderFileInfo[];
  /** List of folder relative paths */
  folders: string[];
  /** Total size of all files in bytes */
  totalSize: number;
  /** Time taken to scan in milliseconds */
  scanTime: number;
}

// ============================================================================
// AI Pipeline Types
// ============================================================================

/**
 * Progress update during AI content generation
 */
export interface AIPipelineProgress {
  /** Current stage of generation */
  stage: string;
  /** Progress percentage (0-100) */
  percent: number;
  /** Human-readable progress message */
  message: string;
  /** AI model being used (if applicable) */
  model?: string;
  /** Estimated time remaining in seconds */
  eta?: number;
  /** Session ID for this generation */
  sessionId?: string;
}

/**
 * Options for AI content generation
 */
export interface AIPipelineGenerateOptions {
  /** Command to execute */
  command:
    | "generate-image"
    | "create-video"
    | "generate-avatar"
    | "list-models"
    | "estimate-cost"
    | "run-pipeline";
  /** Command arguments */
  args: Record<string, string | number | boolean>;
  /** Output directory for generated files */
  outputDir?: string;
  /** Unique session ID for tracking/cancellation */
  sessionId?: string;
}

/**
 * Result from AI pipeline operations
 */
export interface AIPipelineResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Primary output file path */
  outputPath?: string;
  /** All output file paths (for batch operations) */
  outputPaths?: string[];
  /** Error message if failed */
  error?: string;
  /** Operation duration in seconds */
  duration?: number;
  /** Estimated or actual cost */
  cost?: number;
  /** List of models (for list-models command) */
  models?: string[];
  /** Raw response data */
  data?: unknown;
}

/**
 * Options for cost estimation
 */
export interface AIPipelineCostEstimate {
  /** Model to estimate for */
  model: string;
  /** Video duration in seconds */
  duration?: number;
  /** Output resolution (e.g., "1920x1080") */
  resolution?: string;
}

/**
 * Detailed pipeline status
 */
export interface AIPipelineStatus {
  /** Whether pipeline is available */
  available: boolean;
  /** Binary/module version */
  version: string | null;
  /** Source of the pipeline (bundled, system, python, unavailable) */
  source: "bundled" | "system" | "python" | "unavailable";
  /** Whether version is compatible with QCut */
  compatible: boolean;
  /** Feature flags for available capabilities */
  features: Record<string, boolean>;
  /** Error message if unavailable */
  error?: string;
}

// ============================================================================
// Media Import Types
// ============================================================================

/**
 * Options for importing media into a project
 */
export interface MediaImportOptions {
  /** Absolute path to the source file */
  sourcePath: string;
  /** Project ID to import into */
  projectId: string;
  /** Unique media ID for the imported file */
  mediaId: string;
  /** Whether to prefer symlinks over copies (default: true) */
  preferSymlink?: boolean;
}

/**
 * Result of a media import operation
 */
export interface MediaImportResult {
  /** Whether the import succeeded */
  success: boolean;
  /** Path to the imported file (symlink or copy) */
  targetPath: string;
  /** Method used for import */
  importMethod: "symlink" | "copy";
  /** Original source path */
  originalPath: string;
  /** File size in bytes */
  fileSize: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Metadata about how media was imported
 * Stored with the media item for proper cleanup and management
 */
export interface MediaImportMetadata {
  /** Method used for import */
  importMethod: "symlink" | "copy";
  /** Original source path */
  originalPath: string;
  /** Timestamp when media was imported */
  importedAt: number;
  /** File size in bytes */
  fileSize: number;
}

// ============================================================================
// Remotion Folder Import Types
// ============================================================================

/**
 * Composition information from a Remotion project
 */
export interface RemotionCompositionInfo {
  /** Unique composition ID from the id prop */
  id: string;
  /** Display name (defaults to id if not specified) */
  name: string;
  /** Duration in frames */
  durationInFrames: number;
  /** Frames per second */
  fps: number;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** Path to the component file (resolved from import) */
  componentPath: string;
  /** Original import path from the source */
  importPath: string;
  /** Line number in source for debugging */
  line: number;
}

/**
 * Result of selecting a Remotion folder via dialog
 */
export interface RemotionFolderSelectResult {
  /** Whether selection was successful */
  success: boolean;
  /** Selected folder path (if successful) */
  folderPath?: string;
  /** Whether user cancelled the dialog */
  cancelled?: boolean;
  /** Error message if selection failed */
  error?: string;
}

/**
 * Result of scanning a Remotion project folder
 */
export interface RemotionFolderScanResult {
  /** Whether the folder is a valid Remotion project */
  isValid: boolean;
  /** Path to the Root.tsx or equivalent file */
  rootFilePath: string | null;
  /** Detected compositions */
  compositions: RemotionCompositionInfo[];
  /** Any errors encountered during parsing */
  errors: string[];
  /** Folder path that was scanned */
  folderPath: string;
}

/**
 * Result of bundling a single composition
 */
export interface RemotionBundleResult {
  /** Composition ID */
  compositionId: string;
  /** Whether bundling was successful */
  success: boolean;
  /** Bundled JavaScript code (ESM format) */
  code?: string;
  /** Source map for debugging */
  sourceMap?: string;
  /** Error message if bundling failed */
  error?: string;
}

/**
 * Result of bundling compositions from a folder
 */
export interface RemotionFolderBundleResult {
  /** Overall success (true if all succeeded) */
  success: boolean;
  /** Individual bundle results */
  results: RemotionBundleResult[];
  /** Number of successful bundles */
  successCount: number;
  /** Number of failed bundles */
  errorCount: number;
  /** Folder path that was bundled */
  folderPath: string;
}

/**
 * Combined result of folder import (scan + bundle)
 */
export interface RemotionFolderImportResult {
  /** Whether import was successful */
  success: boolean;
  /** Scan result with composition metadata */
  scan: RemotionFolderScanResult;
  /** Bundle result with compiled code */
  bundle: RemotionFolderBundleResult | null;
  /** Total import time in milliseconds */
  importTime: number;
  /** Error message if import failed */
  error?: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
