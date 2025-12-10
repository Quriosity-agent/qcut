# Export Engine CLI Refactoring Plan

**File**: `qcut/apps/web/src/lib/export-engine-cli.ts`
**Current Size**: 1,689 lines
**Target Size**: ~700 lines (main engine) + modular utilities
**Priority**: Medium
**Philosophy**: Long-term maintainability > scalability > performance > short-term gains

---

## Pre-Refactoring: Create Backup

```bash
cp qcut/apps/web/src/lib/export-engine-cli.ts qcut/apps/web/src/lib/export-engine-cli.ts.backup
```

---

## Overview

The `export-engine-cli.ts` file handles video export via Electron IPC to FFmpeg. It contains text/sticker overlay filter generation, video source extraction, and export orchestration. This refactoring:

1. **Extracts filter building logic** to reusable utilities
2. **Separates source extraction** for better testability
3. **Creates shared types** for cross-module consistency
4. **Reuses existing patterns** from `ffmpeg/` module structure

---

## Current Structure (1,689 lines)

| Section | Lines | Content | Reuse Opportunity |
|---------|-------|---------|-------------------|
| Types & Imports | 1-60 | Interfaces, callbacks | Extract to types file |
| Class Setup | 58-140 | Constructor, session mgmt | Keep in main class |
| Text Escaping | 93-140 | FFmpeg escape utilities | **High**: Pure functions |
| Font Resolution | 140-270 | Cross-platform fonts | **High**: Reusable utility |
| Text Overlay Filters | 270-490 | Drawtext filter building | **High**: Pure functions |
| Video Source Extraction | 490-700 | Path extraction, temp files | Medium: Keep together |
| Sticker Overlay System | 700-1000 | Overlay filter building | **High**: Pure functions |
| Main Export Methods | 1000-1689 | Export orchestration | Keep in main class |

---

## Proposed Architecture

### Directory Structure

```
apps/web/src/lib/export-cli/
├── index.ts              (~30 lines)  - Barrel exports
├── types.ts              (~100 lines) - All type definitions
├── filters/
│   ├── index.ts          (~20 lines)  - Filter barrel
│   ├── text-escape.ts    (~60 lines)  - FFmpeg text escaping
│   ├── font-resolver.ts  (~140 lines) - Cross-platform font paths
│   ├── text-overlay.ts   (~220 lines) - Drawtext filter building
│   └── sticker-overlay.ts(~200 lines) - Sticker overlay filters
├── sources/
│   ├── index.ts          (~20 lines)  - Sources barrel
│   ├── video-sources.ts  (~150 lines) - Video path extraction
│   └── sticker-sources.ts(~120 lines) - Sticker path extraction
└── (main file stays at lib/export-engine-cli.ts ~700 lines)
```

---

## Detailed Extraction Plan

### File 1: `export-cli/types.ts` (~100 lines)

All TypeScript interfaces extracted for reuse.

```typescript
/**
 * Video source input for export (matching IPC handler expectations)
 */
export interface VideoSourceInput {
  path: string;
  startTime: number;
  duration: number;
  trimStart?: number;
  trimEnd?: number;
}

/**
 * Audio file input for mixing into export
 */
export interface AudioFileInput {
  path: string;
  startTime: number;
  volume?: number;
}

/**
 * Sticker source for FFmpeg overlay filter
 */
export interface StickerSourceForFilter {
  id: string;
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  startTime: number;
  endTime: number;
  zIndex: number;
  opacity?: number;
  rotation?: number;
}

/**
 * Export progress callback
 */
export type ExportProgressCallback = (progress: {
  stage: "preparing" | "encoding" | "finalizing";
  percent: number;
  currentFrame?: number;
  totalFrames?: number;
}) => void;

/**
 * Export result from CLI engine
 */
export interface ExportResult {
  success: boolean;
  outputFile: string;
  method: "spawn" | "manual";
  message?: string;
}

/**
 * Text element for drawtext filter (subset of TimelineTextElement)
 */
export interface TextElementForFilter {
  id: string;
  content: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  startTime: number;
  endTime: number;
  // Optional styling
  fontWeight?: string;
  fontStyle?: string;
  textAlign?: string;
  opacity?: number;
}
```

**Why extract**: Types are used by multiple modules and UI components.

---

### File 2: `export-cli/filters/text-escape.ts` (~60 lines)

FFmpeg text escaping utilities (pure functions).

```typescript
/**
 * Escape special characters for FFmpeg drawtext filter.
 * FFmpeg drawtext requires escaping: ' : \ and newlines.
 */
export function escapeTextForFFmpeg(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")  // Backslash
    .replace(/'/g, "\\'")         // Single quote
    .replace(/:/g, "\\:")         // Colon (filter separator)
    .replace(/\n/g, "\\n")        // Newline
    .replace(/\r/g, "");          // Remove carriage return
}

/**
 * Escape file path for FFmpeg filter (Windows compatibility).
 * Converts backslashes and escapes colons.
 */
export function escapePathForFFmpeg(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")          // Convert to forward slashes
    .replace(/:/g, "\\:");        // Escape colons (Windows drive letters)
}

/**
 * Convert hex color to FFmpeg format (strip # prefix).
 */
export function colorToFFmpeg(hexColor: string): string {
  return hexColor.startsWith("#") ? hexColor.slice(1) : hexColor;
}
```

**Why extract**: Pure utility functions, easily testable, reusable in other FFmpeg-related code.

---

### File 3: `export-cli/filters/font-resolver.ts` (~140 lines)

Cross-platform font path resolution.

```typescript
/**
 * Windows font file name mapping.
 * Maps font family names to actual .ttf/.otf file names in C:\Windows\Fonts
 */
const WINDOWS_FONT_MAP: Record<string, string> = {
  "Arial": "arial.ttf",
  "Arial Bold": "arialbd.ttf",
  "Times New Roman": "times.ttf",
  "Courier New": "cour.ttf",
  "Verdana": "verdana.ttf",
  "Georgia": "georgia.ttf",
  "Tahoma": "tahoma.ttf",
  "Trebuchet MS": "trebuc.ttf",
  "Comic Sans MS": "comic.ttf",
  "Impact": "impact.ttf",
  // ... more mappings
};

/**
 * Resolve font family to FFmpeg-compatible font path.
 *
 * @param fontFamily - CSS font family name
 * @param fontWeight - CSS font weight (normal, bold, etc.)
 * @returns Font specifier for FFmpeg (path on Windows, fontconfig name on Unix)
 */
export function resolveFontPath(
  fontFamily: string,
  fontWeight?: string
): string {
  const isWindows = typeof process !== "undefined" && process.platform === "win32";

  if (isWindows) {
    return resolveWindowsFontPath(fontFamily, fontWeight);
  }

  // Linux/macOS: Use fontconfig name (FFmpeg uses fontconfig)
  return fontFamily;
}

function resolveWindowsFontPath(
  fontFamily: string,
  fontWeight?: string
): string {
  const isBold = fontWeight === "bold" || fontWeight === "700";
  const lookupKey = isBold ? `${fontFamily} Bold` : fontFamily;

  const fontFile = WINDOWS_FONT_MAP[lookupKey] || WINDOWS_FONT_MAP[fontFamily];

  if (fontFile) {
    return `C\\:/Windows/Fonts/${fontFile}`;  // Escaped for FFmpeg
  }

  // Fallback to Arial
  console.warn(`Font not found: ${fontFamily}, falling back to Arial`);
  return "C\\:/Windows/Fonts/arial.ttf";
}

/**
 * Check if a font file exists (for validation).
 */
export async function fontExists(fontPath: string): Promise<boolean> {
  // Implementation using Electron IPC or fs check
}
```

**Why extract**: Complex platform-specific logic that benefits from isolation and testing.

---

### File 4: `export-cli/filters/text-overlay.ts` (~220 lines)

Text overlay filter building.

```typescript
import { escapeTextForFFmpeg, escapePathForFFmpeg, colorToFFmpeg } from "./text-escape";
import { resolveFontPath } from "./font-resolver";
import type { TextElementForFilter } from "../types";

/**
 * Convert a text element to FFmpeg drawtext filter string.
 */
export function convertTextElementToDrawtext(
  element: TextElementForFilter,
  canvasWidth: number,
  canvasHeight: number,
  fps: number
): string {
  const escapedText = escapeTextForFFmpeg(element.content);
  const fontPath = resolveFontPath(element.fontFamily, element.fontWeight);
  const escapedFontPath = escapePathForFFmpeg(fontPath);
  const color = colorToFFmpeg(element.color);

  // Calculate position (convert from percentage if needed)
  const x = Math.round(element.x);
  const y = Math.round(element.y);

  // Calculate timing (frame-based enable)
  const startFrame = Math.floor(element.startTime * fps);
  const endFrame = Math.floor(element.endTime * fps);

  return [
    `drawtext=text='${escapedText}'`,
    `fontfile='${escapedFontPath}'`,
    `fontsize=${element.fontSize}`,
    `fontcolor=${color}`,
    `x=${x}`,
    `y=${y}`,
    `enable='between(n,${startFrame},${endFrame})'`,
  ].join(":");
}

/**
 * Build complete text overlay filter chain for all text elements.
 */
export function buildTextOverlayFilters(
  textElements: TextElementForFilter[],
  canvasWidth: number,
  canvasHeight: number,
  fps: number
): string {
  if (textElements.length === 0) return "";

  // Sort by z-index (lower = rendered first = behind)
  const sorted = [...textElements].sort((a, b) =>
    (a.zIndex ?? 0) - (b.zIndex ?? 0)
  );

  return sorted
    .map(el => convertTextElementToDrawtext(el, canvasWidth, canvasHeight, fps))
    .join(",");
}
```

**Why extract**: Filter building is complex, benefits from unit testing, and is logically separate from export orchestration.

---

### File 5: `export-cli/filters/sticker-overlay.ts` (~200 lines)

Sticker overlay filter building.

```typescript
import { escapePathForFFmpeg } from "./text-escape";
import type { StickerSourceForFilter } from "../types";

/**
 * Build FFmpeg overlay filter for a single sticker.
 */
export function buildStickerOverlayFilter(
  sticker: StickerSourceForFilter,
  inputIndex: number,
  fps: number
): string {
  const startFrame = Math.floor(sticker.startTime * fps);
  const endFrame = Math.floor(sticker.endTime * fps);

  // Scale filter for sticker dimensions
  const scaleFilter = `[${inputIndex}:v]scale=${sticker.width}:${sticker.height}[sticker${inputIndex}]`;

  // Overlay filter with timing and position
  const overlayFilter = [
    `overlay=${sticker.x}:${sticker.y}`,
    `enable='between(n,${startFrame},${endFrame})'`,
  ].join(":");

  return { scaleFilter, overlayFilter };
}

/**
 * Build complete sticker overlay filter chain.
 */
export function buildStickerOverlayFilters(
  stickers: StickerSourceForFilter[],
  fps: number
): { filterChain: string; inputCount: number } {
  if (stickers.length === 0) {
    return { filterChain: "", inputCount: 0 };
  }

  // Sort by z-index
  const sorted = [...stickers].sort((a, b) => a.zIndex - b.zIndex);

  // Build filter chain (complex graph building)
  // ...
}
```

**Why extract**: Sticker filter logic is self-contained and complex enough to warrant isolation.

---

### File 6: `export-cli/sources/video-sources.ts` (~150 lines)

Video source path extraction.

```typescript
import type { VideoSourceInput } from "../types";

/**
 * Extract video sources from timeline elements.
 * Handles blob URLs, file paths, and temp file creation.
 */
export async function extractVideoSources(
  elements: TimelineElement[],
  sessionId: string
): Promise<VideoSourceInput[]> {
  // Implementation
}

/**
 * Extract single video input path for Mode 2 optimization.
 * Returns the video path if only one video source exists.
 */
export function extractVideoInputPath(
  elements: TimelineElement[]
): string | null {
  // Implementation
}

/**
 * Create temp file from blob URL for FFmpeg processing.
 */
async function createTempFileFromBlob(
  blobUrl: string,
  sessionId: string,
  filename: string
): Promise<string> {
  // Implementation using Electron IPC
}
```

---

### File 7: `export-cli/sources/sticker-sources.ts` (~120 lines)

Sticker source extraction.

```typescript
import type { StickerSourceForFilter } from "../types";

/**
 * Extract sticker sources from timeline elements.
 * Handles SVG to PNG conversion for FFmpeg compatibility.
 */
export async function extractStickerSources(
  elements: TimelineElement[],
  sessionId: string
): Promise<StickerSourceForFilter[]> {
  // Implementation
}

/**
 * Convert SVG sticker to PNG for FFmpeg overlay.
 */
async function convertSvgToPng(
  svgPath: string,
  outputPath: string,
  width: number,
  height: number
): Promise<string> {
  // Implementation using Electron IPC or canvas
}
```

---

### Updated: `export-engine-cli.ts` (~700 lines)

Main engine focused on orchestration.

```typescript
import {
  VideoSourceInput,
  AudioFileInput,
  StickerSourceForFilter,
  ExportProgressCallback,
  ExportResult,
} from "./export-cli/types";
import {
  buildTextOverlayFilters,
  buildStickerOverlayFilters,
} from "./export-cli/filters";
import {
  extractVideoSources,
  extractVideoInputPath,
  extractStickerSources,
} from "./export-cli/sources";

export class CLIExportEngine {
  private sessionId: string | null = null;
  private frameDir: string | null = null;

  constructor() {
    if (typeof window === "undefined" || !window.electronAPI) {
      throw new Error("CLIExportEngine requires Electron environment");
    }
  }

  /**
   * Main export method - orchestrates the entire export process.
   */
  async exportVideo(
    elements: TimelineElement[],
    options: ExportOptions,
    onProgress?: ExportProgressCallback
  ): Promise<ExportResult> {
    // 1. Create export session
    // 2. Extract sources (uses extracted modules)
    // 3. Build filter chains (uses extracted modules)
    // 4. Select export mode (Mode 1, 1.5, or 2)
    // 5. Execute FFmpeg via IPC
    // 6. Handle progress and cleanup
  }

  // ... other methods
}
```

---

## Implementation Subtasks

### Subtask 1: Extract Types (10 min)

1. Create `apps/web/src/lib/export-cli/types.ts`
2. Move all interfaces from lines 1-60
3. Create barrel file `export-cli/index.ts`
4. Update imports in `export-engine-cli.ts`
5. Verify: `bun run check-types`

**Risk**: Low (no logic changes)

---

### Subtask 2: Extract Text Escape & Font Resolver (15 min)

1. Create `export-cli/filters/text-escape.ts`
2. Create `export-cli/filters/font-resolver.ts`
3. Move escape functions from lines 93-140
4. Move font resolution from lines 140-270
5. Create `export-cli/filters/index.ts` barrel
6. Update imports in `export-engine-cli.ts`
7. Verify: `bun run check-types`

**Risk**: Low (pure functions)

---

### Subtask 3: Extract Text Overlay Filters (15 min)

1. Create `export-cli/filters/text-overlay.ts`
2. Move `convertTextElementToDrawtext` from lines 270-380
3. Move `buildTextOverlayFilters` from lines 380-490
4. Update imports in `export-engine-cli.ts`
5. Verify: Test text overlay export

**Risk**: Medium (filter chain building)

---

### Subtask 4: Extract Sticker Overlay Filters (15 min)

1. Create `export-cli/filters/sticker-overlay.ts`
2. Move sticker filter building from lines 700-900
3. Update imports in `export-engine-cli.ts`
4. Verify: Test sticker overlay export

**Risk**: Medium (filter chain building)

---

### Subtask 5: Extract Source Extraction (15 min)

1. Create `export-cli/sources/video-sources.ts`
2. Create `export-cli/sources/sticker-sources.ts`
3. Move extraction logic from lines 490-700 and 900-1000
4. Create `export-cli/sources/index.ts` barrel
5. Update imports in `export-engine-cli.ts`
6. Verify: Full export test

**Risk**: Medium (Electron IPC integration)

---

### Subtask 6: Cleanup & Documentation (10 min)

1. Remove duplicated code from main file
2. Update all imports to use barrels
3. Add JSDoc comments to public APIs
4. Update `LARGE-FILES-ANALYSIS.md`
5. Remove backup file

**Risk**: Low

---

## Testing Checklist

### After Subtask 1-2 (Types & Escape)
- [ ] `bun run check-types` passes
- [ ] App starts without errors

### After Subtask 3 (Text Overlay)
- [ ] Export video with text overlays
- [ ] Text positioning correct
- [ ] Text timing correct (appears/disappears)
- [ ] Special characters render correctly

### After Subtask 4 (Sticker Overlay)
- [ ] Export video with stickers
- [ ] Sticker positioning correct
- [ ] Sticker timing correct
- [ ] SVG stickers render correctly

### After Subtask 5 (Sources)
- [ ] Export with multiple video clips
- [ ] Export with blob URL sources
- [ ] Mode 2 optimization triggers correctly
- [ ] Temp files cleaned up after export

### Full Integration
- [ ] Export Mode 1 (direct copy)
- [ ] Export Mode 1.5 (normalization)
- [ ] Export Mode 2 (filters)
- [ ] Progress reporting works
- [ ] Error handling works

---

## File Size Summary

| File | Before | After |
|------|--------|-------|
| `export-engine-cli.ts` | 1,689 | ~700 |
| `export-cli/types.ts` | - | ~100 |
| `export-cli/filters/text-escape.ts` | - | ~60 |
| `export-cli/filters/font-resolver.ts` | - | ~140 |
| `export-cli/filters/text-overlay.ts` | - | ~220 |
| `export-cli/filters/sticker-overlay.ts` | - | ~200 |
| `export-cli/sources/video-sources.ts` | - | ~150 |
| `export-cli/sources/sticker-sources.ts` | - | ~120 |
| `export-cli/index.ts` + barrels | - | ~70 |
| **Total** | 1,689 | ~1,760 |

**Net change**: +71 lines (better organization)
**Main file reduction**: 989 lines (59%)

---

## Code Reuse Opportunities

### Reuse FROM Existing Modules

| Existing Module | Can Reuse |
|-----------------|-----------|
| `ffmpeg/types.ts` | `VideoSource`, `StickerSource` interfaces (align types) |
| `ai-video/validation/validators.ts` | Aspect ratio utilities if needed |

### Reuse BY Future Modules

| New Module | Can Be Used By |
|------------|----------------|
| `filters/text-escape.ts` | Any FFmpeg filter building |
| `filters/font-resolver.ts` | Subtitle rendering, watermarks |
| `sources/video-sources.ts` | Preview generation, thumbnails |

---

## Backward Compatibility

Existing imports continue to work:

```typescript
// Before and after - unchanged
import { CLIExportEngine } from "@/lib/export-engine-cli";
```

New modular imports available:

```typescript
// New option for specific utilities
import { escapeTextForFFmpeg } from "@/lib/export-cli/filters/text-escape";
import { resolveFontPath } from "@/lib/export-cli/filters/font-resolver";
import { buildTextOverlayFilters } from "@/lib/export-cli/filters/text-overlay";
```

---

## Rollback Plan

```bash
# Remove new directory
rm -rf qcut/apps/web/src/lib/export-cli/

# Restore original
mv qcut/apps/web/src/lib/export-engine-cli.ts.backup qcut/apps/web/src/lib/export-engine-cli.ts
```

---

## Long-Term Benefits

1. **Testability**: Filter building functions can be unit tested without FFmpeg
2. **Maintainability**: Font mappings easy to update independently
3. **Reusability**: Text escaping usable across FFmpeg features
4. **Onboarding**: Clear module boundaries aid understanding
5. **Debugging**: Isolated modules easier to debug in isolation
6. **Future Features**: Subtitle export can reuse text overlay logic

---

*Document created: 2025-12-10*
*Estimated time: ~80 minutes total (6 subtasks)*
*Author: Claude Code*
