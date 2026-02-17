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
