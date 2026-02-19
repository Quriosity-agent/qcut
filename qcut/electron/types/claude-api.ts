/**
 * Shared type definitions for Claude Code Integration API
 * These types are used across main process handlers and renderer process
 */

// ============================================================================
// Response Types
// ============================================================================

export interface ClaudeAPIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// ============================================================================
// Media Types
// ============================================================================

export interface MediaFile {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  path: string;
  size: number;
  duration?: number;
  dimensions?: { width: number; height: number };
  createdAt: number;
  modifiedAt: number;
}

export interface MediaMetadata {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  bitrate?: number;
  audioCodec?: string;
  audioChannels?: number;
  sampleRate?: number;
}

// ============================================================================
// Timeline Types (Claude-compatible format for export/import)
// ============================================================================

export interface ClaudeTimeline {
  name: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  tracks: ClaudeTrack[];
}

export interface ClaudeTrack {
  index: number;
  name: string;
  type: string;
  elements: ClaudeElement[];
}

export interface ClaudeElement {
  id: string;
  trackIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  type:
    | "video"
    | "audio"
    | "image"
    | "text"
    | "sticker"
    | "captions"
    | "remotion"
    | "media";
  sourceId?: string;
  sourceName?: string;
  content?: string;
  style?: Record<string, unknown>;
  effects?: string[];
}

// ============================================================================
// Project Types
// ============================================================================

export interface ProjectSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
  backgroundColor: string;
  exportFormat: string;
  exportQuality: string;
}

export interface ProjectStats {
  totalDuration: number;
  mediaCount: { video: number; audio: number; image: number };
  trackCount: number;
  elementCount: number;
  lastModified: number;
  fileSize: number;
}

// ============================================================================
// Export Types
// ============================================================================

export interface ExportPreset {
  id: string;
  name: string;
  platform: string;
  width: number;
  height: number;
  fps: number;
  bitrate: string;
  format: string;
}

export interface ExportRecommendation {
  preset: ExportPreset;
  warnings: string[];
  suggestions: string[];
  estimatedFileSize?: string;
}

// ============================================================================
// Timeline Operation Types (split, move, selection)
// ============================================================================

export interface ClaudeSplitRequest {
  splitTime: number;
  mode?: "split" | "keepLeft" | "keepRight";
}

export interface ClaudeSplitResponse {
  secondElementId: string | null;
}

export interface ClaudeMoveRequest {
  toTrackId: string;
  newStartTime?: number;
}

export interface ClaudeSelectionItem {
  trackId: string;
  elementId: string;
}

// ============================================================================
// Diagnostics Types
// ============================================================================

export interface ErrorReport {
  message: string;
  stack?: string;
  context: string;
  timestamp: number;
  componentStack?: string;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  osVersion: string;
  appVersion: string;
  nodeVersion: string;
  electronVersion: string;
  memory: { total: number; free: number; used: number };
  cpuCount: number;
}

export interface DiagnosticResult {
  errorType: string;
  severity: "low" | "medium" | "high" | "critical";
  possibleCauses: string[];
  suggestedFixes: string[];
  canAutoFix: boolean;
  autoFixAction?: string;
  systemInfo: SystemInfo;
}

// ============================================================================
// Video Analysis Types
// ============================================================================

export type AnalyzeSource =
  | { type: "timeline"; elementId: string }
  | { type: "media"; mediaId: string }
  | { type: "path"; filePath: string };

export type AnalyzeOptions = {
  source: AnalyzeSource;
  /** Analysis type: timeline (default), describe, or transcribe */
  analysisType?: "timeline" | "describe" | "transcribe";
  /** Model key (default: "gemini-2.5-flash") */
  model?: string;
  /** Output format (default: "md") */
  format?: "md" | "json" | "both";
};

export type AnalyzeResult =
  | {
      success: true;
      markdown?: string;
      json?: Record<string, unknown>;
      outputFiles?: string[];
      videoPath?: string;
      duration?: number;
      cost?: number;
    }
  | {
      success: false;
      error: string;
      duration?: number;
    };

export type AnalyzeModel = {
  key: string;
  provider: string;
  modelId: string;
  description: string;
};

// ============================================================================
// URL Import Types
// ============================================================================

export interface UrlImportRequest {
  url: string;
  filename?: string;
}

// ============================================================================
// Batch Import Types
// ============================================================================

export interface BatchImportItem {
  path?: string;
  url?: string;
  filename?: string;
}

export interface BatchImportResult {
  index: number;
  success: boolean;
  mediaFile?: MediaFile;
  error?: string;
}

// ============================================================================
// Frame Extraction Types
// ============================================================================

export interface FrameExtractRequest {
  timestamp: number;
  format?: "png" | "jpg";
}

export interface FrameExtractResult {
  path: string;
  timestamp: number;
  format: string;
}

// ============================================================================
// Transcription Types (Stage 2)
// ============================================================================

export interface TranscriptionWord {
  text: string;
  start: number;
  end: number;
  speaker?: string;
  type: "word" | "spacing" | "audio_event" | "punctuation";
}

export interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  words: TranscriptionWord[];
  segments: TranscriptionSegment[];
  language: string;
  duration: number;
}

export interface TranscribeRequest {
  mediaId: string;
  provider?: "elevenlabs" | "gemini";
  language?: string;
  diarize?: boolean;
}

// ============================================================================
// Scene Detection Types (Stage 2)
// ============================================================================

export interface SceneBoundary {
  timestamp: number;
  confidence: number;
  description?: string;
  shotType?: "wide" | "medium" | "close-up" | "cutaway" | "unknown";
  transitionType?: "cut" | "dissolve" | "fade" | "unknown";
}

export interface SceneDetectionRequest {
  mediaId: string;
  threshold?: number;
  aiAnalysis?: boolean;
  model?: string;
}

export interface SceneDetectionResult {
  scenes: SceneBoundary[];
  totalScenes: number;
  averageShotDuration: number;
}

// ============================================================================
// Frame Analysis Types (Stage 2)
// ============================================================================

export interface FrameAnalysis {
  timestamp: number;
  objects: string[];
  text: string[];
  description: string;
  mood: string;
  composition: string;
}

export interface FrameAnalysisRequest {
  mediaId: string;
  timestamps?: number[];
  interval?: number;
  prompt?: string;
}

export interface FrameAnalysisResult {
  frames: FrameAnalysis[];
  totalFramesAnalyzed: number;
}

// ============================================================================
// Filler Detection HTTP Types (Stage 2)
// ============================================================================

export interface FillerWord {
  word: string;
  start: number;
  end: number;
  reason: string;
}

export interface SilenceGap {
  start: number;
  end: number;
  duration: number;
}

export interface FillerAnalysisRequest {
  mediaId?: string;
  words: Array<{
    id: string;
    text: string;
    start: number;
    end: number;
    type: "word" | "spacing";
    speaker_id?: string;
  }>;
}

export interface FillerAnalysisResult {
  fillers: FillerWord[];
  silences: SilenceGap[];
  totalFillerTime: number;
  totalSilenceTime: number;
}
