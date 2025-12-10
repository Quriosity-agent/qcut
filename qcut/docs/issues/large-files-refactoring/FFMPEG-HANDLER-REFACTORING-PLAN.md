# FFmpeg Handler Refactoring Plan

**File**: `qcut/electron/ffmpeg-handler.ts`
**Current Size**: 2,210 lines
**Target Size**: ~900 lines (main handler) + modular utilities
**Priority**: Medium (Electron-specific, affects all video export functionality)

---

## Overview

The `ffmpeg-handler.ts` file is the core video processing module for QCut's Electron backend. It handles all FFmpeg-related IPC operations including video export, audio extraction, frame processing, and video normalization.

### Current Structure Analysis

| Section | Lines | Description |
|---------|-------|-------------|
| Imports & Debug Logging | 1-28 | Dependencies and debug utilities |
| Type Definitions | 30-259 | 15+ interfaces for FFmpeg operations |
| IPC Handler Registration | 269-1330 | Main `setupFFmpegIPC()` function with all handlers |
| Video Probing | 1332-1427 | `probeVideoFile()` for codec validation |
| Video Normalization | 1429-1747 | `normalizeVideo()` for Mode 1.5 |
| FFmpeg Path Resolution | 1749-1802 | `getFFmpegPath()` for binary location |
| Argument Building | 1804-2167 | `buildFFmpegArgs()` for export modes |
| Progress Parsing | 2169-2192 | `parseProgress()` for UI updates |
| Exports | 2194-2210 | Module exports |

---

## Proposed File Structure

```
electron/
├── ffmpeg-handler.ts          (~900 lines) - Main IPC handler registration
├── ffmpeg/
│   ├── index.ts               (~30 lines)  - Barrel exports
│   ├── types.ts               (~250 lines) - All type definitions
│   ├── config.ts              (~100 lines) - Path resolution & constants
│   ├── args-builder.ts        (~400 lines) - FFmpeg argument construction
│   ├── normalization.ts       (~350 lines) - Mode 1.5 video normalization
│   ├── probe.ts               (~120 lines) - Video file probing
│   └── progress.ts            (~50 lines)  - Progress parsing utilities
```

---

## Detailed Extraction Plan

### File 1: `ffmpeg/types.ts` (~250 lines)

Extract all TypeScript interfaces and types.

**Contents:**
```typescript
// Audio/Video source types
export interface AudioFile { ... }
export interface VideoSource { ... }
export interface StickerSource { ... }

// Export configuration
export interface ExportOptions { ... }
export interface FrameData { ... }
export interface FrameProcessOptions { ... }
export interface ExportResult { ... }

// Quality settings
export interface QualitySettings { ... }
export interface QualityMap { ... }

// Progress & errors
export interface FFmpegProgress { ... }
export interface FFmpegError extends Error { ... }

// Probe results
export interface VideoProbeResult { ... }

// Handler results
export interface OpenFolderResult { ... }
export interface ExtractAudioOptions { ... }
export interface ExtractAudioResult { ... }

// IPC handler type map
export interface FFmpegHandlers { ... }
```

**Benefits:**
- Single source of truth for all FFmpeg types
- Can be imported by renderer process for type safety
- Cleaner main handler file

---

### File 2: `ffmpeg/config.ts` (~100 lines)

Extract FFmpeg binary path resolution and configuration constants.

**Contents:**
```typescript
import { app } from "electron";
import path from "path";
import fs from "fs";

// Configuration constants
export const MAX_EXPORT_DURATION = 600;

// Quality presets
export const QUALITY_SETTINGS: QualityMap = {
  high: { crf: "18", preset: "slow" },
  medium: { crf: "23", preset: "fast" },
  low: { crf: "28", preset: "veryfast" },
};

// Debug logging utilities
export const debugLog = (...args: any[]) => { ... };
export const debugWarn = (...args: any[]) => { ... };
export const debugError = (...args: any[]) => { ... };

/**
 * Resolves FFmpeg binary path for current environment (dev/packaged).
 */
export function getFFmpegPath(): string { ... }

/**
 * Resolves FFprobe binary path (same directory as FFmpeg).
 */
export function getFFprobePath(): string { ... }
```

**Benefits:**
- Centralized configuration
- Easy to modify paths for different environments
- Reusable across multiple modules

---

### File 3: `ffmpeg/args-builder.ts` (~400 lines)

Extract the complex `buildFFmpegArgs()` function and related helpers.

**Contents:**
```typescript
import type {
  AudioFile, VideoSource, StickerSource,
  ExportOptions, QualitySettings
} from "./types";
import { QUALITY_SETTINGS, debugLog } from "./config";

/**
 * Build FFmpeg arguments for Mode 2: Direct video with filters
 */
function buildMode2Args(
  options: ExportOptions,
  quality: QualitySettings,
  ...
): string[] { ... }

/**
 * Build FFmpeg arguments for Mode 1: Direct copy (single video)
 */
function buildDirectCopySingleArgs(
  video: VideoSource,
  audioFiles: AudioFile[],
  outputFile: string
): string[] { ... }

/**
 * Build FFmpeg arguments for Mode 1: Direct copy (multi-video concat)
 */
function buildDirectConcatArgs(
  videoSources: VideoSource[],
  audioFiles: AudioFile[],
  inputDir: string,
  outputFile: string
): string[] { ... }

/**
 * Main argument builder - routes to appropriate mode
 */
export function buildFFmpegArgs(
  inputDir: string,
  outputFile: string,
  width: number,
  height: number,
  fps: number,
  quality: "high" | "medium" | "low",
  duration: number,
  audioFiles?: AudioFile[],
  filterChain?: string,
  textFilterChain?: string,
  useDirectCopy?: boolean,
  videoSources?: VideoSource[],
  stickerFilterChain?: string,
  stickerSources?: StickerSource[],
  useVideoInput?: boolean,
  videoInputPath?: string,
  trimStart?: number,
  trimEnd?: number
): string[] { ... }
```

**Benefits:**
- Isolated argument construction logic
- Easier to add new export modes
- Better testability of each mode

---

### File 4: `ffmpeg/normalization.ts` (~350 lines)

Extract Mode 1.5 video normalization logic.

**Contents:**
```typescript
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { getFFmpegPath, getFFprobePath, debugLog } from "./config";

/**
 * Normalize a single video to target resolution and fps using FFmpeg padding.
 *
 * Used by Mode 1.5 for multi-video exports with different properties.
 * Enables fast concat by ensuring all videos have identical:
 * - Resolution (with letterboxing/pillarboxing)
 * - Frame rate
 * - Codec (H.264)
 * - Audio format (AAC 48kHz stereo)
 */
export async function normalizeVideo(
  inputPath: string,
  outputPath: string,
  targetWidth: number,
  targetHeight: number,
  targetFps: number,
  duration: number,
  trimStart?: number,
  trimEnd?: number
): Promise<void> { ... }

/**
 * Verify output video duration matches expected duration.
 */
export async function verifyVideoDuration(
  videoPath: string,
  expectedDuration: number
): Promise<{ actual: number; difference: number }> { ... }
```

**Benefits:**
- Isolated normalization logic
- Can be reused for other preprocessing tasks
- Clear documentation of Mode 1.5 strategy

---

### File 5: `ffmpeg/probe.ts` (~120 lines)

Extract video probing functionality.

**Contents:**
```typescript
import { spawn } from "child_process";
import { getFFprobePath } from "./config";
import type { VideoProbeResult } from "./types";

/**
 * Probes a video file to extract codec information using ffprobe.
 * Used for validating codec compatibility in direct-copy mode.
 */
export async function probeVideoFile(videoPath: string): Promise<VideoProbeResult> { ... }

/**
 * Validate that multiple videos have compatible codecs for concat.
 */
export async function validateConcatCompatibility(
  videoSources: VideoSource[]
): Promise<{ compatible: boolean; error?: string }> { ... }

/**
 * Get video duration using ffprobe.
 */
export async function getVideoDuration(videoPath: string): Promise<number> { ... }
```

**Benefits:**
- Reusable video analysis utilities
- Clean separation from export logic
- Easy to extend with more probe features

---

### File 6: `ffmpeg/progress.ts` (~50 lines)

Extract progress parsing utilities.

**Contents:**
```typescript
import type { FFmpegProgress } from "./types";

/**
 * Extracts progress information from FFmpeg stderr output.
 * FFmpeg writes progress to stderr; this parser extracts
 * frame numbers and timestamps for UI progress updates.
 */
export function parseProgress(output: string): FFmpegProgress | null { ... }

/**
 * Calculate export percentage from frame progress.
 */
export function calculateProgressPercentage(
  currentFrame: number,
  totalFrames: number
): number { ... }

/**
 * Parse FFmpeg time string to seconds.
 * @param time - Time in "HH:MM:SS.ss" format
 */
export function parseTimeToSeconds(time: string): number { ... }
```

**Benefits:**
- Isolated progress logic
- Easy to add more progress parsing features
- Testable without spawning FFmpeg

---

### File 7: `ffmpeg/index.ts` (~30 lines)

Barrel file for clean imports.

**Contents:**
```typescript
// Types
export * from "./types";

// Configuration
export { getFFmpegPath, getFFprobePath, QUALITY_SETTINGS } from "./config";

// Core functions
export { buildFFmpegArgs } from "./args-builder";
export { normalizeVideo, verifyVideoDuration } from "./normalization";
export { probeVideoFile, validateConcatCompatibility, getVideoDuration } from "./probe";
export { parseProgress, calculateProgressPercentage, parseTimeToSeconds } from "./progress";
```

---

### Updated: `ffmpeg-handler.ts` (~900 lines)

The main handler file becomes focused on IPC registration.

**Contents:**
```typescript
import { ipcMain, app, shell, IpcMainInvokeEvent } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";

import { TempManager, ExportSession } from "./temp-manager.js";
import {
  getFFmpegPath,
  buildFFmpegArgs,
  normalizeVideo,
  probeVideoFile,
  parseProgress,
  type ExportOptions,
  type ExportResult,
  type FrameData,
  type FFmpegProgress,
  // ... other types
} from "./ffmpeg";

const tempManager = new TempManager();

/**
 * Registers all FFmpeg-related IPC handlers for video export operations.
 */
export function setupFFmpegIPC(): void {
  // ffmpeg-path handler
  ipcMain.handle("ffmpeg-path", async (): Promise<string> => { ... });

  // create-export-session handler
  ipcMain.handle("create-export-session", async (): Promise<ExportSession> => { ... });

  // save-frame handler
  ipcMain.handle("save-frame", async (event, data: FrameData): Promise<string> => { ... });

  // read-output-file handler
  ipcMain.handle("read-output-file", async (event, outputPath): Promise<Buffer> => { ... });

  // cleanup-export-session handler
  ipcMain.handle("cleanup-export-session", async (event, sessionId): Promise<void> => { ... });

  // open-frames-folder handler
  ipcMain.handle("open-frames-folder", async (event, sessionId): Promise<OpenFolderResult> => { ... });

  // export-video-cli handler (main export logic)
  ipcMain.handle("export-video-cli", async (event, options: ExportOptions): Promise<ExportResult> => {
    // Mode routing logic (1, 1.5, 2)
    // Calls buildFFmpegArgs, normalizeVideo, etc.
  });

  // validate-filter-chain handler
  ipcMain.handle("validate-filter-chain", async (event, filterChain): Promise<boolean> => { ... });

  // processFrame handler
  ipcMain.handle("processFrame", async (event, options): Promise<void> => { ... });

  // extract-audio handler
  ipcMain.handle("extract-audio", async (event, options): Promise<ExtractAudioResult> => { ... });

  // save-sticker-for-export handler
  ipcMain.handle("save-sticker-for-export", async (event, options): Promise<...> => { ... });
}

// Exports
export { getFFmpegPath };
export default { setupFFmpegIPC, getFFmpegPath };
```

---

## Implementation Steps

### Phase 1: Type Extraction (Low Risk)
1. Create `electron/ffmpeg/types.ts` with all interfaces
2. Update imports in `ffmpeg-handler.ts` to use new types file
3. Verify TypeScript compilation passes
4. Test: Run build and verify no type errors

### Phase 2: Config Extraction (Low Risk)
1. Create `electron/ffmpeg/config.ts` with path resolution and constants
2. Move `getFFmpegPath()`, debug utilities, and quality settings
3. Update imports in `ffmpeg-handler.ts`
4. Test: Run `bun run electron:dev` and verify FFmpeg detection works

### Phase 3: Utility Extraction (Medium Risk)
1. Create `electron/ffmpeg/progress.ts` with progress parsing
2. Create `electron/ffmpeg/probe.ts` with video probing
3. Update imports and verify functionality
4. Test: Export a video and verify progress updates work

### Phase 4: Core Logic Extraction (Higher Risk)
1. Create `electron/ffmpeg/args-builder.ts` with argument construction
2. Create `electron/ffmpeg/normalization.ts` with Mode 1.5 logic
3. Create `electron/ffmpeg/index.ts` barrel file
4. Update `ffmpeg-handler.ts` to use extracted modules
5. Test: Verify all export modes (1, 1.5, 2) work correctly

### Phase 5: Cleanup & Verification
1. Remove duplicate code from `ffmpeg-handler.ts`
2. Verify all exports are properly re-exported
3. Run full test suite
4. Test in packaged Electron app

---

## Testing Checklist

### Export Mode Tests
- [ ] Mode 1: Single video direct copy
- [ ] Mode 1: Multi-video concat (identical codecs)
- [ ] Mode 1.5: Multi-video normalization (different resolutions)
- [ ] Mode 1.5: Videos with trim values
- [ ] Mode 2: Direct video with text overlays
- [ ] Mode 2: Direct video with sticker overlays
- [ ] Mode 2: Direct video with both text and stickers

### Feature Tests
- [ ] FFmpeg path detection (dev mode)
- [ ] FFmpeg path detection (packaged app)
- [ ] Audio extraction
- [ ] Frame processing with filters
- [ ] Progress reporting to UI
- [ ] Export session cleanup

### Edge Cases
- [ ] Missing FFmpeg binary
- [ ] Invalid video file
- [ ] Codec mismatch detection
- [ ] Duration validation (MAX_EXPORT_DURATION)
- [ ] Windows path escaping in concat files

---

## Dependencies

This refactoring does NOT affect:
- `electron/main.ts` - Only imports `setupFFmpegIPC`
- `electron/temp-manager.ts` - Independent module
- Frontend code - Uses IPC, not direct imports

This refactoring DOES require:
- TypeScript recompilation after each phase
- Testing on Windows (FFmpeg path resolution is platform-specific)

---

## Benefits Summary

| Benefit | Description |
|---------|-------------|
| **Maintainability** | Smaller, focused files are easier to understand |
| **Testability** | Extracted functions can be unit tested in isolation |
| **Reusability** | Probe and progress utilities can be used elsewhere |
| **Developer Experience** | Clear module boundaries and imports |
| **Performance** | No runtime impact (same code, better organization) |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Import path issues | Use barrel file for clean imports |
| Circular dependencies | Types file has no imports from other modules |
| Windows path issues | Keep path resolution logic together in config.ts |
| Build failures | Incremental extraction with testing after each phase |

---

*Document created: 2025-12-10*
*Target completion: After current sprint*
*Author: Claude Code*
