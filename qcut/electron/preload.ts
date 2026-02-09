/**
 * Electron preload script that exposes a secure API to the renderer process.
 * Uses contextBridge to safely expose IPC methods without exposing the full Electron API.
 * @module preload
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
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
} from "./types/claude-api";

// Type definitions for the exposed API

/** File dialog filter for open/save dialogs */
interface FileDialogFilter {
  name: string;
  extensions: string[];
}

/** File information returned from file operations */
interface FileInfo {
  name: string;
  path: string;
  size: number;
  lastModified: Date;
  type: string;
}

/** Parameters for searching sounds via Freesound API */
interface SoundSearchParams {
  query?: string;
  page?: number;
  pageSize?: number;
  duration?: string;
  sort?: string;
}

/** Parameters for downloading a sound file */
interface SoundDownloadParams {
  soundId: number;
  previewUrl: string;
  name: string;
}

/** Data for initiating a transcription request */
interface TranscriptionRequestData {
  id: string;
  filename: string;
  language?: string;
  decryptionKey?: string;
  iv?: string;
  controller?: AbortController;
}

/** Result from a transcription operation */
interface TranscriptionResult {
  success: boolean;
  text?: string;
  segments?: TranscriptionSegment[];
  language?: string;
  error?: string;
  message?: string;
  id?: string;
}

/** A segment of transcribed text with timing information */
interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

/** Result from a cancellation operation */
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
  optimizationStrategy?:
    | "image-pipeline"
    | "direct-copy"
    | "direct-video-with-filters"
    | "video-normalization";
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

interface SaveAIVideoOptions {
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
}

interface SaveAIVideoResult {
  success: boolean;
  localPath?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
}

interface GitHubStarsResponse {
  stars: number;
}

interface FalUploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

interface Skill {
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
}

/** Options for importing media into a project */
interface MediaImportOptions {
  sourcePath: string;
  projectId: string;
  mediaId: string;
  preferSymlink?: boolean;
}

/** Result of a media import operation */
interface MediaImportResult {
  success: boolean;
  targetPath: string;
  importMethod: "symlink" | "copy";
  originalPath: string;
  fileSize: number;
  error?: string;
}

/** Composition information from a Remotion project */
interface RemotionCompositionInfo {
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

/** Result of selecting a Remotion folder via dialog */
interface RemotionFolderSelectResult {
  /** Whether selection was successful */
  success: boolean;
  /** Selected folder path (if successful) */
  folderPath?: string;
  /** Whether user cancelled the dialog */
  cancelled?: boolean;
  /** Error message if selection failed */
  error?: string;
}

/** Result of scanning a Remotion project folder */
interface RemotionFolderScanResult {
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

/** Result of bundling a single composition */
interface RemotionBundleResult {
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

/** Result of bundling compositions from a folder */
interface RemotionFolderBundleResult {
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

/** Combined result of folder import (scan + bundle) */
interface RemotionFolderImportResult {
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
  saveBlob: (
    data: Buffer | Uint8Array,
    defaultFilename?: string
  ) => Promise<{
    success: boolean;
    filePath?: string;
    canceled?: boolean;
    error?: string;
  }>;
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

  // Video operations
  video?: {
    // Temp file operations
    saveTemp: (
      videoData: Uint8Array,
      filename: string,
      sessionId?: string
    ) => Promise<string>;

    // AI Video save operations (MANDATORY - no fallback)
    saveToDisk: (options: SaveAIVideoOptions) => Promise<SaveAIVideoResult>;
    verifyFile: (filePath: string) => Promise<boolean>;
    deleteFile: (filePath: string) => Promise<boolean>;
    getProjectDir: (projectId: string) => Promise<string>;
  };

  // Transcription operations (Gemini API + ElevenLabs)
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
    cancel: (id: string) => Promise<CancelResult>;
    /** Transcribe using ElevenLabs Scribe v2 via FAL AI */
    elevenlabs: (options: {
      audioPath: string;
      language?: string;
      diarize?: boolean;
      tagAudioEvents?: boolean;
      keyterms?: string[];
    }) => Promise<{
      text: string;
      language_code: string;
      language_probability: number;
      words: Array<{
        text: string;
        start: number;
        end: number;
        type: "word" | "spacing" | "audio_event" | "punctuation";
        speaker_id: string | null;
      }>;
    }>;
    /** Upload file to FAL storage */
    uploadToFal: (filePath: string) => Promise<{ url: string }>;
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
    extractAudio: (options: { videoPath: string; format?: string }) => Promise<{
      audioPath: string;
      fileSize: number;
    }>;
    validateFilterChain: (filterChain: string) => Promise<boolean>;
    saveStickerForExport: (data: {
      sessionId: string;
      stickerId: string;
      imageData: Uint8Array;
      format?: string;
    }) => Promise<{ success: boolean; path?: string; error?: string }>;

    // FFmpeg resource helpers
    getFFmpegResourcePath: (filename: string) => Promise<string>;
    checkFFmpegResource: (filename: string) => Promise<boolean>;
    getPath: () => Promise<string>;
    checkHealth: () => Promise<{
      ffmpegOk: boolean;
      ffprobeOk: boolean;
      ffmpegVersion: string;
      ffprobeVersion: string;
      ffmpegPath: string;
      ffprobePath: string;
      errors: string[];
    }>;
  };

  // API key operations
  apiKeys: {
    get: () => Promise<ApiKeyConfig>;
    set: (keys: ApiKeyConfig) => Promise<boolean>;
    clear: () => Promise<boolean>;
  };

  // Shell operations
  shell: {
    showItemInFolder: (filePath: string) => Promise<void>;
  };

  // GitHub operations
  github: {
    fetchStars: () => Promise<GitHubStarsResponse>;
  };

  // FAL AI operations (bypasses CORS in Electron)
  fal: {
    uploadVideo: (
      videoData: Uint8Array,
      filename: string,
      apiKey: string
    ) => Promise<FalUploadResult>;
    uploadImage: (
      imageData: Uint8Array,
      filename: string,
      apiKey: string
    ) => Promise<FalUploadResult>;
    uploadAudio: (
      audioData: Uint8Array,
      filename: string,
      apiKey: string
    ) => Promise<FalUploadResult>;
    queueFetch: (
      url: string,
      apiKey: string
    ) => Promise<{ ok: boolean; status: number; data: unknown }>;
  };

  // Gemini Chat operations
  geminiChat: {
    send: (request: {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      attachments?: Array<{ path: string; mimeType: string; name: string }>;
      model?: string;
    }) => Promise<{ success: boolean; error?: string }>;
    onStreamChunk: (callback: (data: { text: string }) => void) => void;
    onStreamComplete: (callback: () => void) => void;
    onStreamError: (callback: (data: { message: string }) => void) => void;
    removeListeners: () => void;
  };

  // PTY Terminal operations
  pty: {
    spawn: (options?: {
      cols?: number;
      rows?: number;
      cwd?: string;
      command?: string;
    }) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
    write: (
      sessionId: string,
      data: string
    ) => Promise<{ success: boolean; error?: string }>;
    resize: (
      sessionId: string,
      cols: number,
      rows: number
    ) => Promise<{ success: boolean; error?: string }>;
    kill: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
    killAll: () => Promise<{ success: boolean }>;
    onData: (
      callback: (data: { sessionId: string; data: string }) => void
    ) => void;
    onExit: (
      callback: (data: {
        sessionId: string;
        exitCode: number;
        signal?: number;
      }) => void
    ) => void;
    removeListeners: () => void;
  };

  // Skills operations
  skills?: {
    list: (projectId: string) => Promise<Skill[]>;
    import: (projectId: string, sourcePath: string) => Promise<Skill | null>;
    delete: (projectId: string, skillId: string) => Promise<void>;
    getContent: (
      projectId: string,
      skillId: string,
      filename: string
    ) => Promise<string>;
    browse: () => Promise<string | null>;
    getPath: (projectId: string) => Promise<string>;
    scanGlobal: () => Promise<
      Array<{
        path: string;
        name: string;
        description: string;
        bundled?: boolean;
      }>
    >;
  };

  // AI Pipeline operations
  aiPipeline?: {
    check: () => Promise<{ available: boolean; error?: string }>;
    status: () => Promise<{
      available: boolean;
      version: string | null;
      source: "bundled" | "system" | "python" | "unavailable";
      compatible: boolean;
      features: Record<string, boolean>;
      error?: string;
    }>;
    generate: (options: {
      command: string;
      args: Record<string, string | number | boolean>;
      outputDir?: string;
      sessionId?: string;
    }) => Promise<{
      success: boolean;
      outputPath?: string;
      outputPaths?: string[];
      error?: string;
      duration?: number;
      cost?: number;
      models?: string[];
      data?: unknown;
    }>;
    listModels: () => Promise<{
      success: boolean;
      error?: string;
      models?: string[];
      data?: unknown;
    }>;
    estimateCost: (options: {
      model: string;
      duration?: number;
      resolution?: string;
    }) => Promise<{
      success: boolean;
      error?: string;
      cost?: number;
    }>;
    cancel: (sessionId: string) => Promise<{ success: boolean }>;
    refresh: () => Promise<{
      available: boolean;
      version: string | null;
      source: "bundled" | "system" | "python" | "unavailable";
      compatible: boolean;
      features: Record<string, boolean>;
      error?: string;
    }>;
    onProgress: (
      callback: (progress: {
        stage: string;
        percent: number;
        message: string;
        model?: string;
        eta?: number;
        sessionId?: string;
      }) => void
    ) => () => void;
  };

  // Media import operations (symlink with copy fallback)
  mediaImport?: {
    import: (options: MediaImportOptions) => Promise<MediaImportResult>;
    validateSymlink: (path: string) => Promise<boolean>;
    locateOriginal: (mediaPath: string) => Promise<string | null>;
    relinkMedia: (
      projectId: string,
      mediaId: string,
      newSourcePath: string
    ) => Promise<MediaImportResult>;
    remove: (projectId: string, mediaId: string) => Promise<void>;
    checkSymlinkSupport: () => Promise<boolean>;
    getMediaPath: (projectId: string) => Promise<string>;
  };

  // Project folder operations
  projectFolder?: {
    getRoot: (projectId: string) => Promise<string>;
    scan: (
      projectId: string,
      subPath?: string,
      options?: { recursive?: boolean; mediaOnly?: boolean }
    ) => Promise<{
      files: Array<{
        name: string;
        path: string;
        relativePath: string;
        type: "video" | "audio" | "image" | "unknown";
        size: number;
        modifiedAt: number;
        isDirectory: boolean;
      }>;
      folders: string[];
      totalSize: number;
      scanTime: number;
    }>;
    list: (
      projectId: string,
      subPath?: string
    ) => Promise<
      Array<{
        name: string;
        path: string;
        relativePath: string;
        type: "video" | "audio" | "image" | "unknown";
        size: number;
        modifiedAt: number;
        isDirectory: boolean;
      }>
    >;
    ensureStructure: (
      projectId: string
    ) => Promise<{ created: string[]; existing: string[] }>;
  };

  // Claude Code Integration API
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
      sendResponse: (timeline: ClaudeTimeline) => void;
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
      removeListeners: () => void;
    };
    project: {
      getSettings: (projectId: string) => Promise<ProjectSettings>;
      updateSettings: (
        projectId: string,
        settings: Partial<ProjectSettings>
      ) => Promise<void>;
      getStats: (projectId: string) => Promise<ProjectStats>;
      onStatsRequest: (
        callback: (projectId: string, requestId: string) => void
      ) => void;
      sendStatsResponse: (stats: ProjectStats, requestId: string) => void;
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

  // Remotion folder operations
  remotionFolder?: {
    /** Open folder selection dialog for Remotion projects */
    select: () => Promise<RemotionFolderSelectResult>;
    /** Scan a Remotion project folder for compositions */
    scan: (folderPath: string) => Promise<RemotionFolderScanResult>;
    /** Bundle compositions from a folder */
    bundle: (
      folderPath: string,
      compositionIds?: string[]
    ) => Promise<RemotionFolderBundleResult>;
    /** Full import: scan + bundle in one operation */
    import: (folderPath: string) => Promise<RemotionFolderImportResult>;
    /** Check if bundler is available */
    checkBundler: () => Promise<{ available: boolean }>;
    /** Validate a folder is a Remotion project */
    validate: (
      folderPath: string
    ) => Promise<{ isValid: boolean; error?: string }>;
  };

  // Update and release notes operations
  updates?: {
    checkForUpdates: () => Promise<{
      available: boolean;
      version?: string;
      message?: string;
      error?: string;
    }>;
    installUpdate: () => Promise<{
      success: boolean;
      message?: string;
      error?: string;
    }>;
    getReleaseNotes: (version?: string) => Promise<{
      version: string;
      date: string;
      channel: string;
      content: string;
    } | null>;
    getChangelog: () => Promise<
      Array<{
        version: string;
        date: string;
        channel: string;
        content: string;
      }>
    >;
    onUpdateAvailable: (
      callback: (data: {
        version: string;
        releaseNotes?: string;
        releaseDate?: string;
      }) => void
    ) => () => void;
    onDownloadProgress: (
      callback: (data: {
        percent: number;
        transferred: number;
        total: number;
      }) => void
    ) => () => void;
    onUpdateDownloaded: (
      callback: (data: { version: string }) => void
    ) => () => void;
  };

  // Utility functions
  isElectron: boolean;
}

// Expose the API to the renderer process
const electronAPI: ElectronAPI = {
  // System info
  platform: process.platform,

  // File operations
  openFileDialog: async (): Promise<string | null> => {
    const result = await ipcRenderer.invoke("open-file-dialog");
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  },
  openMultipleFilesDialog: async (): Promise<string[]> => {
    const result = await ipcRenderer.invoke("open-multiple-files-dialog");
    if (result.canceled || !result.filePaths) {
      return [];
    }
    return result.filePaths;
  },
  saveFileDialog: (
    defaultFilename?: string,
    filters?: FileDialogFilter[]
  ): Promise<string | null> =>
    ipcRenderer.invoke("save-file-dialog", defaultFilename, filters),
  readFile: (filePath: string): Promise<Buffer | null> =>
    ipcRenderer.invoke("read-file", filePath),
  writeFile: (filePath: string, data: Buffer | string): Promise<boolean> =>
    ipcRenderer.invoke("write-file", filePath, data),
  saveBlob: (
    data: Buffer | Uint8Array,
    defaultFilename?: string
  ): Promise<{
    success: boolean;
    filePath?: string;
    canceled?: boolean;
    error?: string;
  }> => ipcRenderer.invoke("save-blob", data, defaultFilename),
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

  // Video operations
  video: {
    // Temp file operations
    saveTemp: (
      videoData: Uint8Array,
      filename: string,
      sessionId?: string
    ): Promise<string> =>
      ipcRenderer.invoke("video:save-temp", videoData, filename, sessionId),

    // AI Video save operations (MANDATORY - no fallback)
    saveToDisk: (options: SaveAIVideoOptions): Promise<SaveAIVideoResult> =>
      ipcRenderer.invoke("ai-video:save-to-disk", options),
    verifyFile: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke("ai-video:verify-file", filePath),
    deleteFile: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke("ai-video:delete-file", filePath),
    getProjectDir: (projectId: string): Promise<string> =>
      ipcRenderer.invoke("ai-video:get-project-dir", projectId),
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

    /**
     * Transcribe audio using ElevenLabs Scribe v2 via FAL AI.
     * Returns word-level timestamps with speaker diarization.
     *
     * @param options.audioPath - Path to audio file
     * @param options.language - Language code (e.g., "eng"). Default: auto-detect
     * @param options.diarize - Enable speaker identification. Default: true
     * @param options.tagAudioEvents - Tag laughter, applause, etc. Default: true
     * @param options.keyterms - Words to bias toward (+30% cost)
     */
    elevenlabs: (options: {
      audioPath: string;
      language?: string;
      diarize?: boolean;
      tagAudioEvents?: boolean;
      keyterms?: string[];
    }): Promise<{
      text: string;
      language_code: string;
      language_probability: number;
      words: Array<{
        text: string;
        start: number;
        end: number;
        type: "word" | "spacing" | "audio_event" | "punctuation";
        speaker_id: string | null;
      }>;
    }> => ipcRenderer.invoke("transcribe:elevenlabs", options),

    /**
     * Upload a file to FAL storage.
     * Returns the URL of the uploaded file.
     */
    uploadToFal: (filePath: string): Promise<{ url: string }> =>
      ipcRenderer.invoke("transcribe:upload-to-fal", filePath),
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
    checkHealth: (): Promise<{
      ffmpegOk: boolean;
      ffprobeOk: boolean;
      ffmpegVersion: string;
      ffprobeVersion: string;
      ffmpegPath: string;
      ffprobePath: string;
      errors: string[];
    }> => ipcRenderer.invoke("ffmpeg-health"),
  },

  // API key operations
  apiKeys: {
    get: (): Promise<ApiKeyConfig> => ipcRenderer.invoke("api-keys:get"),
    set: (keys: ApiKeyConfig): Promise<boolean> =>
      ipcRenderer.invoke("api-keys:set", keys),
    clear: (): Promise<boolean> => ipcRenderer.invoke("api-keys:clear"),
  },

  // Shell operations
  shell: {
    showItemInFolder: (filePath: string): Promise<void> =>
      ipcRenderer.invoke("shell:showItemInFolder", filePath),
  },

  // GitHub operations
  github: {
    fetchStars: (): Promise<GitHubStarsResponse> =>
      ipcRenderer.invoke("fetch-github-stars"),
  },

  // FAL AI operations (bypasses CORS in Electron)
  fal: {
    uploadVideo: (
      videoData: Uint8Array,
      filename: string,
      apiKey: string
    ): Promise<FalUploadResult> =>
      ipcRenderer.invoke("fal:upload-video", videoData, filename, apiKey),
    uploadImage: (
      imageData: Uint8Array,
      filename: string,
      apiKey: string
    ): Promise<FalUploadResult> =>
      ipcRenderer.invoke("fal:upload-image", imageData, filename, apiKey),
    uploadAudio: (
      audioData: Uint8Array,
      filename: string,
      apiKey: string
    ): Promise<FalUploadResult> =>
      ipcRenderer.invoke("fal:upload-audio", audioData, filename, apiKey),
    queueFetch: (
      url: string,
      apiKey: string
    ): Promise<{ ok: boolean; status: number; data: unknown }> =>
      ipcRenderer.invoke("fal:queue-fetch", url, apiKey),
  },

  // Gemini Chat operations
  geminiChat: {
    send: (request: {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      attachments?: Array<{ path: string; mimeType: string; name: string }>;
      model?: string;
    }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("gemini:chat", request),
    onStreamChunk: (callback: (data: { text: string }) => void): void => {
      ipcRenderer.removeAllListeners("gemini:stream-chunk");
      ipcRenderer.on("gemini:stream-chunk", (_, data) => callback(data));
    },
    onStreamComplete: (callback: () => void): void => {
      ipcRenderer.removeAllListeners("gemini:stream-complete");
      ipcRenderer.on("gemini:stream-complete", () => callback());
    },
    onStreamError: (callback: (data: { message: string }) => void): void => {
      ipcRenderer.removeAllListeners("gemini:stream-error");
      ipcRenderer.on("gemini:stream-error", (_, data) => callback(data));
    },
    removeListeners: (): void => {
      ipcRenderer.removeAllListeners("gemini:stream-chunk");
      ipcRenderer.removeAllListeners("gemini:stream-complete");
      ipcRenderer.removeAllListeners("gemini:stream-error");
    },
  },

  // PTY Terminal operations
  pty: {
    spawn: (options?: {
      cols?: number;
      rows?: number;
      cwd?: string;
      command?: string;
    }): Promise<{ success: boolean; sessionId?: string; error?: string }> =>
      ipcRenderer.invoke("pty:spawn", options),
    write: (
      sessionId: string,
      data: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("pty:write", sessionId, data),
    resize: (
      sessionId: string,
      cols: number,
      rows: number
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("pty:resize", sessionId, cols, rows),
    kill: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("pty:kill", sessionId),
    killAll: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("pty:kill-all"),
    onData: (
      callback: (data: { sessionId: string; data: string }) => void
    ): void => {
      ipcRenderer.removeAllListeners("pty:data");
      ipcRenderer.on("pty:data", (_, data) => callback(data));
    },
    onExit: (
      callback: (data: {
        sessionId: string;
        exitCode: number;
        signal?: number;
      }) => void
    ): void => {
      ipcRenderer.removeAllListeners("pty:exit");
      ipcRenderer.on("pty:exit", (_, data) => callback(data));
    },
    removeListeners: (): void => {
      ipcRenderer.removeAllListeners("pty:data");
      ipcRenderer.removeAllListeners("pty:exit");
    },
  },

  // Skills operations
  skills: {
    list: (projectId: string): Promise<Skill[]> =>
      ipcRenderer.invoke("skills:list", projectId),
    import: (projectId: string, sourcePath: string): Promise<Skill | null> =>
      ipcRenderer.invoke("skills:import", projectId, sourcePath),
    delete: (projectId: string, skillId: string): Promise<void> =>
      ipcRenderer.invoke("skills:delete", projectId, skillId),
    getContent: (
      projectId: string,
      skillId: string,
      filename: string
    ): Promise<string> =>
      ipcRenderer.invoke("skills:getContent", projectId, skillId, filename),
    browse: (): Promise<string | null> => ipcRenderer.invoke("skills:browse"),
    getPath: (projectId: string): Promise<string> =>
      ipcRenderer.invoke("skills:getPath", projectId),
    scanGlobal: (): Promise<
      Array<{
        path: string;
        name: string;
        description: string;
        bundled?: boolean;
      }>
    > => ipcRenderer.invoke("skills:scanGlobal"),
  },

  // AI Pipeline operations
  aiPipeline: {
    check: (): Promise<{ available: boolean; error?: string }> =>
      ipcRenderer.invoke("ai-pipeline:check"),

    status: (): Promise<{
      available: boolean;
      version: string | null;
      source: "bundled" | "system" | "python" | "unavailable";
      compatible: boolean;
      features: Record<string, boolean>;
      error?: string;
    }> => ipcRenderer.invoke("ai-pipeline:status"),

    generate: (options: {
      command: string;
      args: Record<string, string | number | boolean>;
      outputDir?: string;
      sessionId?: string;
    }): Promise<{
      success: boolean;
      outputPath?: string;
      outputPaths?: string[];
      error?: string;
      duration?: number;
      cost?: number;
      models?: string[];
      data?: unknown;
    }> => ipcRenderer.invoke("ai-pipeline:generate", options),

    listModels: (): Promise<{
      success: boolean;
      error?: string;
      models?: string[];
      data?: unknown;
    }> => ipcRenderer.invoke("ai-pipeline:list-models"),

    estimateCost: (options: {
      model: string;
      duration?: number;
      resolution?: string;
    }): Promise<{
      success: boolean;
      error?: string;
      cost?: number;
    }> => ipcRenderer.invoke("ai-pipeline:estimate-cost", options),

    cancel: (sessionId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke("ai-pipeline:cancel", sessionId),

    refresh: (): Promise<{
      available: boolean;
      version: string | null;
      source: "bundled" | "system" | "python" | "unavailable";
      compatible: boolean;
      features: Record<string, boolean>;
      error?: string;
    }> => ipcRenderer.invoke("ai-pipeline:refresh"),

    onProgress: (
      callback: (progress: {
        stage: string;
        percent: number;
        message: string;
        model?: string;
        eta?: number;
        sessionId?: string;
      }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: {
          stage: string;
          percent: number;
          message: string;
          model?: string;
          eta?: number;
          sessionId?: string;
        }
      ) => callback(progress);
      ipcRenderer.on("ai-pipeline:progress", handler);
      return () => {
        ipcRenderer.removeListener("ai-pipeline:progress", handler);
      };
    },
  },

  // Media import operations (symlink with copy fallback)
  mediaImport: {
    import: (options: MediaImportOptions): Promise<MediaImportResult> =>
      ipcRenderer.invoke("media-import:import", options),
    validateSymlink: (path: string): Promise<boolean> =>
      ipcRenderer.invoke("media-import:validate-symlink", path),
    locateOriginal: (mediaPath: string): Promise<string | null> =>
      ipcRenderer.invoke("media-import:locate-original", mediaPath),
    relinkMedia: (
      projectId: string,
      mediaId: string,
      newSourcePath: string
    ): Promise<MediaImportResult> =>
      ipcRenderer.invoke(
        "media-import:relink",
        projectId,
        mediaId,
        newSourcePath
      ),
    remove: (projectId: string, mediaId: string): Promise<void> =>
      ipcRenderer.invoke("media-import:remove", projectId, mediaId),
    checkSymlinkSupport: (): Promise<boolean> =>
      ipcRenderer.invoke("media-import:check-symlink-support"),
    getMediaPath: (projectId: string): Promise<string> =>
      ipcRenderer.invoke("media-import:get-media-path", projectId),
  },

  // Project folder operations
  projectFolder: {
    getRoot: (projectId: string): Promise<string> =>
      ipcRenderer.invoke("project-folder:get-root", projectId),
    scan: (
      projectId: string,
      subPath?: string,
      options?: { recursive?: boolean; mediaOnly?: boolean }
    ): Promise<{
      files: Array<{
        name: string;
        path: string;
        relativePath: string;
        type: "video" | "audio" | "image" | "unknown";
        size: number;
        modifiedAt: number;
        isDirectory: boolean;
      }>;
      folders: string[];
      totalSize: number;
      scanTime: number;
    }> =>
      ipcRenderer.invoke("project-folder:scan", projectId, subPath, options),
    list: (
      projectId: string,
      subPath?: string
    ): Promise<
      Array<{
        name: string;
        path: string;
        relativePath: string;
        type: "video" | "audio" | "image" | "unknown";
        size: number;
        modifiedAt: number;
        isDirectory: boolean;
      }>
    > => ipcRenderer.invoke("project-folder:list", projectId, subPath),
    ensureStructure: (
      projectId: string
    ): Promise<{ created: string[]; existing: string[] }> =>
      ipcRenderer.invoke("project-folder:ensure-structure", projectId),
  },

  // Claude Code Integration API
  claude: {
    // Media operations
    media: {
      list: (projectId: string): Promise<MediaFile[]> =>
        ipcRenderer.invoke("claude:media:list", projectId),
      info: (projectId: string, mediaId: string): Promise<MediaFile | null> =>
        ipcRenderer.invoke("claude:media:info", projectId, mediaId),
      import: (projectId: string, source: string): Promise<MediaFile | null> =>
        ipcRenderer.invoke("claude:media:import", projectId, source),
      delete: (projectId: string, mediaId: string): Promise<boolean> =>
        ipcRenderer.invoke("claude:media:delete", projectId, mediaId),
      rename: (
        projectId: string,
        mediaId: string,
        newName: string
      ): Promise<boolean> =>
        ipcRenderer.invoke("claude:media:rename", projectId, mediaId, newName),
    },

    // Timeline operations
    timeline: {
      export: (projectId: string, format: "json" | "md"): Promise<string> =>
        ipcRenderer.invoke("claude:timeline:export", projectId, format),
      import: (
        projectId: string,
        data: string,
        format: "json" | "md"
      ): Promise<void> =>
        ipcRenderer.invoke("claude:timeline:import", projectId, data, format),
      addElement: (
        projectId: string,
        element: Partial<ClaudeElement>
      ): Promise<string> =>
        ipcRenderer.invoke("claude:timeline:addElement", projectId, element),
      updateElement: (
        projectId: string,
        elementId: string,
        changes: Partial<ClaudeElement>
      ): Promise<void> =>
        ipcRenderer.invoke(
          "claude:timeline:updateElement",
          projectId,
          elementId,
          changes
        ),
      removeElement: (projectId: string, elementId: string): Promise<void> =>
        ipcRenderer.invoke(
          "claude:timeline:removeElement",
          projectId,
          elementId
        ),
      // Event listeners for timeline sync
      onRequest: (callback: () => void): void => {
        ipcRenderer.removeAllListeners("claude:timeline:request");
        ipcRenderer.on("claude:timeline:request", () => callback());
      },
      onApply: (callback: (timeline: ClaudeTimeline) => void): void => {
        ipcRenderer.removeAllListeners("claude:timeline:apply");
        ipcRenderer.on("claude:timeline:apply", (_, timeline) =>
          callback(timeline)
        );
      },
      onAddElement: (
        callback: (element: Partial<ClaudeElement>) => void
      ): void => {
        ipcRenderer.removeAllListeners("claude:timeline:addElement");
        ipcRenderer.on("claude:timeline:addElement", (_, element) =>
          callback(element)
        );
      },
      onUpdateElement: (
        callback: (data: {
          elementId: string;
          changes: Partial<ClaudeElement>;
        }) => void
      ): void => {
        ipcRenderer.removeAllListeners("claude:timeline:updateElement");
        ipcRenderer.on("claude:timeline:updateElement", (_, data) =>
          callback(data)
        );
      },
      onRemoveElement: (callback: (elementId: string) => void): void => {
        ipcRenderer.removeAllListeners("claude:timeline:removeElement");
        ipcRenderer.on("claude:timeline:removeElement", (_, id) =>
          callback(id)
        );
      },
      sendResponse: (timeline: ClaudeTimeline): void => {
        ipcRenderer.send("claude:timeline:response", timeline);
      },
      removeListeners: (): void => {
        ipcRenderer.removeAllListeners("claude:timeline:request");
        ipcRenderer.removeAllListeners("claude:timeline:apply");
        ipcRenderer.removeAllListeners("claude:timeline:addElement");
        ipcRenderer.removeAllListeners("claude:timeline:updateElement");
        ipcRenderer.removeAllListeners("claude:timeline:removeElement");
      },
    },

    // Project operations
    project: {
      getSettings: (projectId: string): Promise<ProjectSettings> =>
        ipcRenderer.invoke("claude:project:getSettings", projectId),
      updateSettings: (
        projectId: string,
        settings: Partial<ProjectSettings>
      ): Promise<void> =>
        ipcRenderer.invoke(
          "claude:project:updateSettings",
          projectId,
          settings
        ),
      getStats: (projectId: string): Promise<ProjectStats> =>
        ipcRenderer.invoke("claude:project:getStats", projectId),
      onStatsRequest: (
        callback: (projectId: string, requestId: string) => void
      ): void => {
        ipcRenderer.removeAllListeners("claude:project:statsRequest");
        ipcRenderer.on(
          "claude:project:statsRequest",
          (_event, { projectId, requestId }) => callback(projectId, requestId)
        );
      },
      sendStatsResponse: (stats: ProjectStats, requestId: string): void => {
        ipcRenderer.send("claude:project:statsResponse", stats, requestId);
      },
      onUpdated: (
        callback: (
          projectId: string,
          settings: Partial<ProjectSettings>
        ) => void
      ): void => {
        ipcRenderer.removeAllListeners("claude:project:updated");
        ipcRenderer.on(
          "claude:project:updated",
          (_, projectId, settings: Partial<ProjectSettings>) =>
            callback(projectId, settings)
        );
      },
      removeListeners: (): void => {
        ipcRenderer.removeAllListeners("claude:project:statsRequest");
        ipcRenderer.removeAllListeners("claude:project:updated");
      },
    },

    // Export operations
    export: {
      getPresets: (): Promise<ExportPreset[]> =>
        ipcRenderer.invoke("claude:export:getPresets"),
      recommend: (
        projectId: string,
        target: string
      ): Promise<ExportRecommendation> =>
        ipcRenderer.invoke("claude:export:recommend", projectId, target),
    },

    // Diagnostics operations
    diagnostics: {
      analyze: (error: ErrorReport): Promise<DiagnosticResult> =>
        ipcRenderer.invoke("claude:diagnostics:analyze", error),
    },
  },

  // Remotion folder operations
  remotionFolder: {
    select: (): Promise<RemotionFolderSelectResult> =>
      ipcRenderer.invoke("remotion-folder:select"),
    scan: (folderPath: string): Promise<RemotionFolderScanResult> =>
      ipcRenderer.invoke("remotion-folder:scan", folderPath),
    bundle: (
      folderPath: string,
      compositionIds?: string[]
    ): Promise<RemotionFolderBundleResult> =>
      ipcRenderer.invoke("remotion-folder:bundle", folderPath, compositionIds),
    import: (folderPath: string): Promise<RemotionFolderImportResult> =>
      ipcRenderer.invoke("remotion-folder:import", folderPath),
    checkBundler: (): Promise<{ available: boolean }> =>
      ipcRenderer.invoke("remotion-folder:check-bundler"),
    validate: (
      folderPath: string
    ): Promise<{ isValid: boolean; error?: string }> =>
      ipcRenderer.invoke("remotion-folder:validate", folderPath),
  },

  // Update and release notes operations
  updates: {
    checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
    installUpdate: () => ipcRenderer.invoke("install-update"),
    getReleaseNotes: (version?: string) =>
      ipcRenderer.invoke("get-release-notes", version),
    getChangelog: () => ipcRenderer.invoke("get-changelog"),
    onUpdateAvailable: (
      callback: (data: {
        version: string;
        releaseNotes?: string;
        releaseDate?: string;
      }) => void
    ) => {
      const handler = (
        _: IpcRendererEvent,
        data: { version: string; releaseNotes?: string; releaseDate?: string }
      ) => callback(data);
      ipcRenderer.on("update-available", handler);
      return () => ipcRenderer.removeListener("update-available", handler);
    },
    onDownloadProgress: (
      callback: (data: {
        percent: number;
        transferred: number;
        total: number;
      }) => void
    ) => {
      const handler = (
        _: IpcRendererEvent,
        data: { percent: number; transferred: number; total: number }
      ) => callback(data);
      ipcRenderer.on("download-progress", handler);
      return () => ipcRenderer.removeListener("download-progress", handler);
    },
    onUpdateDownloaded: (callback: (data: { version: string }) => void) => {
      const handler = (_: IpcRendererEvent, data: { version: string }) =>
        callback(data);
      ipcRenderer.on("update-downloaded", handler);
      return () => ipcRenderer.removeListener("update-downloaded", handler);
    },
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
  FalUploadResult,
  ThemeSource,
  Skill,
  MediaImportOptions,
  MediaImportResult,
  RemotionCompositionInfo,
  RemotionFolderSelectResult,
  RemotionFolderScanResult,
  RemotionBundleResult,
  RemotionFolderBundleResult,
  RemotionFolderImportResult,
};

// Global type augmentation for renderer process
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
