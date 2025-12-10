# FFmpeg Handler Refactoring Plan

**File**: `qcut/electron/ffmpeg-handler.ts`
**Current Size**: 2,210 lines
**Target Size**: ~1,200 lines (main handler) + reusable utilities
**Priority**: Medium

---

## Pre-Refactoring: Create Backup

Before starting, create a backup of the original file:

```bash
cp qcut/electron/ffmpeg-handler.ts qcut/electron/ffmpeg-handler.ts.backup
```

**Backup file**: `qcut/electron/ffmpeg-handler.ts.backup`

---

## Overview

The `ffmpeg-handler.ts` file handles all FFmpeg-related IPC operations. This plan follows existing patterns from `api-key-handler.ts` (240 lines), `sound-handler.ts` (700 lines), and `temp-manager.ts` (148 lines).

---

## Current Structure (2,210 lines)

| Section | Lines | Content |
|---------|-------|---------|
| Imports & Debug | 1-28 | Dependencies, debug utilities |
| Type Definitions | 30-259 | 15+ interfaces |
| IPC Handlers | 269-1330 | `setupFFmpegIPC()` with 10 handlers |
| `probeVideoFile()` | 1332-1427 | Video codec validation |
| `normalizeVideo()` | 1429-1747 | Mode 1.5 normalization (~320 lines) |
| `getFFmpegPath()` | 1749-1802 | Binary path resolution |
| `buildFFmpegArgs()` | 1804-2167 | Argument construction (~360 lines) |
| `parseProgress()` | 2169-2192 | Progress parsing |
| Exports | 2194-2210 | Module exports |

---

## Proposed Structure (3 files)

### File 1: `ffmpeg/types.ts` (~200 lines)
All TypeScript interfaces extracted for reuse.

```typescript
// Audio/Video source types
export interface AudioFile { path: string; startTime: number; volume?: number; }
export interface VideoSource { path: string; startTime: number; duration: number; ... }
export interface StickerSource { id: string; path: string; x: number; y: number; ... }

// Export configuration
export interface ExportOptions { sessionId: string; width: number; height: number; ... }
export interface ExportResult { success: boolean; outputFile: string; method: string; }

// Quality & Progress
export interface QualitySettings { crf: string; preset: string; }
export interface FFmpegProgress { frame?: number; time?: string; }

// Probe results
export interface VideoProbeResult { path: string; codec: string; width: number; ... }
```

**Why extract**: Types are referenced by renderer process typings (`electron.d.ts`), enables better IntelliSense.

---

### File 2: `ffmpeg/utils.ts` (~400 lines)
Reusable FFmpeg utilities that don't depend on IPC.

```typescript
import { spawn } from "child_process";
import { app } from "electron";
import path from "path";
import fs from "fs";
import type { VideoProbeResult, FFmpegProgress, QualitySettings } from "./types";

// Constants
export const MAX_EXPORT_DURATION = 600;
export const QUALITY_SETTINGS: Record<string, QualitySettings> = {
  high: { crf: "18", preset: "slow" },
  medium: { crf: "23", preset: "fast" },
  low: { crf: "28", preset: "veryfast" },
};

// Debug logging (reuse pattern from sound-handler.ts)
export const debugLog = (...args: any[]) => { ... };

// Path resolution
export function getFFmpegPath(): string { ... }
export function getFFprobePath(): string { ... }

// Video probing
export async function probeVideoFile(videoPath: string): Promise<VideoProbeResult> { ... }

// Progress parsing
export function parseProgress(output: string): FFmpegProgress | null { ... }

// Video normalization (Mode 1.5)
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
```

**Why extract**: These functions are pure utilities that can be tested independently and reused (e.g., `getFFmpegPath()` is already used in `main.ts:961`).

---

### File 3: `ffmpeg-handler.ts` (~1,200 lines)
Main handler focused on IPC registration and argument building.

```typescript
import { ipcMain, app, shell, IpcMainInvokeEvent } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { TempManager, ExportSession } from "./temp-manager.js";
import {
  getFFmpegPath,
  probeVideoFile,
  normalizeVideo,
  parseProgress,
  QUALITY_SETTINGS,
  MAX_EXPORT_DURATION,
} from "./ffmpeg/utils";
import type { ExportOptions, ExportResult, ... } from "./ffmpeg/types";

const tempManager = new TempManager();

// buildFFmpegArgs stays here (tightly coupled to export logic)
function buildFFmpegArgs(...): string[] { ... }

export function setupFFmpegIPC(): void {
  // 10 IPC handlers (unchanged)
}
```

---

## Implementation (2 Subtasks)

### Subtask 1: Extract Types (~15 min)

1. Create `electron/ffmpeg/types.ts`
2. Move all interfaces from lines 30-259
3. Update imports in `ffmpeg-handler.ts`
4. Verify: `bun x tsc` passes

**Files changed**: 2
**Risk**: Low (no logic changes)

---

### Subtask 2: Extract Utils (~25 min)

1. Create `electron/ffmpeg/utils.ts`
2. Move functions:
   - `getFFmpegPath()` (lines 1758-1802)
   - `getFFprobePath()` (new helper, extracted from probe logic)
   - `probeVideoFile()` (lines 1352-1427)
   - `normalizeVideo()` (lines 1468-1747)
   - `parseProgress()` (lines 2178-2192)
   - Debug utilities (lines 12-28)
   - Constants (QUALITY_SETTINGS, MAX_EXPORT_DURATION)
3. Update imports in `ffmpeg-handler.ts` and `main.ts`
4. Create `electron/ffmpeg/index.ts` barrel file
5. Verify: `bun run electron:dev` works

**Files changed**: 4
**Risk**: Medium (function extraction)

---

## Reuse Opportunities

### Already Used Elsewhere
- `getFFmpegPath()` is called in `main.ts:961-967` for `validate-audio-file` handler
- After extraction, `main.ts` can import from `./ffmpeg/utils` instead of `./ffmpeg-handler`

### Pattern Alignment
- Types file pattern: matches `temp-manager.ts` exports
- Logger pattern: matches `sound-handler.ts` noop logger
- Export pattern: matches all handlers (CommonJS + ES6 dual exports)

---

## Testing Checklist

### After Subtask 1 (Types)
- [ ] `bun x tsc` compiles without errors
- [ ] No runtime errors on app start

### After Subtask 2 (Utils)
- [ ] Export Mode 1: Single video direct copy
- [ ] Export Mode 1.5: Multi-video normalization
- [ ] Export Mode 2: Video with filters (text/stickers)
- [ ] Audio extraction works
- [ ] Progress updates in UI

---

## File Size Summary

| File | Before | After |
|------|--------|-------|
| `ffmpeg-handler.ts` | 2,210 | ~1,200 |
| `ffmpeg/types.ts` | - | ~200 |
| `ffmpeg/utils.ts` | - | ~400 |
| `ffmpeg/index.ts` | - | ~20 |
| **Total** | 2,210 | ~1,820 |

**Net reduction**: ~400 lines (18%) via removing duplication and cleaner structure.

---

## Not Extracting

### `buildFFmpegArgs()` (~360 lines)
Stays in `ffmpeg-handler.ts` because:
- Tightly coupled to export options logic
- Only called from one place (`export-video-cli` handler)
- Complex mode routing (1, 1.5, 2) that's hard to separate

### Mode 1.5 Execution Logic (~300 lines in handler)
Stays in handler because:
- Deeply integrated with IPC event (progress reporting)
- Uses `tempManager` instance
- Complex error handling with fallbacks

---

## Post-Refactoring: Verification & Cleanup

### Verification Checklist

Compare refactored code against backup to ensure completeness:

```bash
# Check all exported functions are preserved
grep -E "^export (function|const|type|interface)" qcut/electron/ffmpeg-handler.ts.backup
grep -E "^export" qcut/electron/ffmpeg/types.ts qcut/electron/ffmpeg/utils.ts qcut/electron/ffmpeg-handler.ts

# Check all IPC handlers are registered
grep -c "ipcMain.handle" qcut/electron/ffmpeg-handler.ts.backup
grep -c "ipcMain.handle" qcut/electron/ffmpeg-handler.ts
# Both should return: 10

# Verify TypeScript compilation
cd qcut && bun x tsc --noEmit

# Test runtime
bun run electron:dev
```

### Functional Tests (with backup reference)

| Test | Command/Action | Expected | Verified |
|------|----------------|----------|----------|
| App starts | `bun run electron:dev` | No console errors | [ ] |
| FFmpeg detected | Check console for FFmpeg path | Path logged | [ ] |
| Export Mode 1 | Export single video | Video exports | [ ] |
| Export Mode 1.5 | Export 2+ videos (different sizes) | Normalized + concatenated | [ ] |
| Export Mode 2 | Export with text overlay | Text visible in output | [ ] |
| Audio extraction | Right-click video → Extract audio | WAV file created | [ ] |
| Progress updates | Export any video | Progress bar updates | [ ] |

### Cleanup

After all tests pass, remove the backup:

```bash
rm qcut/electron/ffmpeg-handler.ts.backup
```

### Rollback (if needed)

If refactoring causes issues, restore from backup:

```bash
# Remove new files
rm -rf qcut/electron/ffmpeg/

# Restore original
mv qcut/electron/ffmpeg-handler.ts.backup qcut/electron/ffmpeg-handler.ts
```

---

*Document created: 2025-12-10*
*Estimated time: ~40 minutes total*
*Author: Claude Code*
