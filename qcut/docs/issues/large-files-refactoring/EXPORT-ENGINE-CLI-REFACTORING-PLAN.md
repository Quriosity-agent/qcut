# Export Engine CLI Refactoring Plan

**File**: `qcut/apps/web/src/lib/export-engine-cli.ts`
**Original Size**: 1,690 lines
**Final Size**: 883 lines (main engine) + 1,051 lines (modular utilities)
**Status**: ✅ **IMPLEMENTED** (2025-12-10)
**Priority**: Medium
**Philosophy**: Long-term maintainability > scalability > performance > short-term gains

---

## Implementation Summary (2025-12-10)

### What Was Done

1. **Created `export-cli/` module structure** with types, filters, and sources submodules
2. **Extracted pure functions** to testable modules:
   - `text-escape.ts`: `escapeTextForFFmpeg()`, `escapePathForFFmpeg()`, `colorToFFmpeg()`
   - `font-resolver.ts`: `resolveFontPath()` with platform detection (injectable)
   - `text-overlay.ts`: `convertTextElementToDrawtext()`, `buildTextOverlayFilters()`
   - `sticker-overlay.ts`: `buildStickerOverlayFilters()` with logger injection
3. **Extracted source extraction** with dependency injection:
   - `video-sources.ts`: `extractVideoSources()`, `extractVideoInputPath()`
   - `sticker-sources.ts`: `extractStickerSources()` with store/API injection
4. **Created wrapper methods** in main class to maintain backward compatibility
5. **Added barrel exports** for convenient imports

### Key Design Decisions

- **Wrapper pattern**: Main class keeps thin wrappers that pass instance properties (tracks, mediaItems, sessionId) to extracted functions
- **Dependency injection**: All extracted functions accept optional logger and API parameters for testing
- **Type reuse**: Import `TimelineTrack` directly from `@/types/timeline` instead of creating new interfaces
- **Backward compatibility**: Re-export types from main file for existing consumers

### Files Created

```
apps/web/src/lib/export-cli/
├── index.ts              (48 lines)  - Barrel exports
├── types.ts              (72 lines)  - Type definitions
├── filters/
│   ├── index.ts          (24 lines)  - Filter barrel
│   ├── text-escape.ts    (75 lines)  - FFmpeg text/path escaping
│   ├── font-resolver.ts  (123 lines) - Cross-platform font paths
│   ├── text-overlay.ts   (170 lines) - Drawtext filter building
│   └── sticker-overlay.ts(99 lines)  - Sticker overlay filters
└── sources/
    ├── index.ts          (11 lines)  - Sources barrel
    ├── video-sources.ts  (199 lines) - Video path extraction
    └── sticker-sources.ts(230 lines) - Sticker path/download extraction
```

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

## Code Review (2025-12-10)

Quick checks against the current `export-engine-cli.ts` (1,689 lines) to align the refactor scope:

- `resolveFontPath` (lines 139-244) reads `window.electronAPI.platform`; extracted util needs platform/electron API passed in (or injected) to stay testable.
- Text overlays: `convertTextElementToDrawtext` and `buildTextOverlayFilters` (265-482) rely on class helpers (`escapePathForFFmpeg`, `resolveFontPath`) and `this.tracks`; when extracting, pass escape/resolve fns and tracks as params or keep helpers together.
- Video sources: `extractVideoSources` and `extractVideoInputPath` (490-665) create temp files via `window.electronAPI.video.saveTemp` using `this.sessionId`; source module must accept sessionId and electron API explicitly.
- Stickers: `extractStickerSources` (760-855) imports `useStickersOverlayStore`, uses canvas width/height, totalDuration, sessionId, and `window.electronAPI.ffmpeg.saveStickerForExport`; `buildStickerOverlayFilters` (883-955) also uses `this.totalDuration` and `debugLog`. Extraction needs these dependencies passed in (store getter, canvas dims, duration, session/electron API, logger) to stay pure.
- Audio: `prepareAudioFiles` (957-1029) dynamically imports timeline/media stores and writes temp files via `window.electronAPI.invoke("save-audio-for-export")`; keep this coupled to the main engine or extract alongside audio validation for cohesion.
- Orchestration: `exportWithCLI` (1230-1617) is ~400 lines covering audio validation, effect filter collection, filter wiring, and FFmpeg invocation. To hit the ~700-line target, plan to carve out helpers (e.g., `validateAudioFiles`, `collectEffectFilters`, `buildExportOptions`) instead of keeping everything inline.

---

## Current Structure (1,690 lines)

| Section | Lines | Content | Reuse Opportunity |
|---------|-------|---------|-------------------|
| Types & Imports | 1-57 | Imports, interfaces (`VideoSourceInput`, `AudioFileInput`, `StickerSourceForFilter`) | Extract to types file |
| Class Setup | 58-88 | Constructor, session mgmt, Electron check | Keep in main class |
| Text Escaping | 89-137 | `escapeTextForFFmpeg()`, `escapePathForFFmpeg()` | **High**: Pure functions |
| Font Resolution | 139-263 | `resolveFontPath()` with platform detection | **High**: Reusable utility |
| Text to Drawtext | 265-386 | `convertTextElementToDrawtext()` | **High**: Pure functions |
| Text Overlay Filters | 388-482 | `buildTextOverlayFilters()` | **High**: Filter chain building |
| Video Source Extraction | 484-665 | `extractVideoSources()`, `extractVideoInputPath()` | Medium: Keep together |
| Sticker Download | 667-754 | `downloadStickerToTemp()` | Medium: Electron IPC dependent |
| Sticker Extraction | 756-855 | `extractStickerSources()` | Medium: Store dependent |
| Sticker Overlay Filters | 857-955 | `buildStickerOverlayFilters()` | **High**: Pure functions |
| Audio Preparation | 957-1029 | `prepareAudioFiles()` | Medium: IPC dependent |
| Main Export Entry | 1031-1214 | `export()` - orchestration | Keep in main class |
| Export Session | 1216-1224 | `createExportSession()` | Keep in main class |
| FFmpeg CLI Export | 1230-1617 | `exportWithCLI()` - main export logic | Keep in main class |
| Output & Cleanup | 1619-1689 | `readOutputFile()`, `cleanup()`, utilities | Keep in main class |

---

## Proposed Architecture

### Directory Structure

```
apps/web/src/lib/export-cli/
├── index.ts              (~30 lines)  - Barrel exports
├── types.ts              (~80 lines)  - All type definitions
├── filters/
│   ├── index.ts          (~20 lines)  - Filter barrel
│   ├── text-escape.ts    (~70 lines)  - FFmpeg text/path escaping
│   ├── font-resolver.ts  (~150 lines) - Cross-platform font paths
│   ├── text-overlay.ts   (~180 lines) - Drawtext filter building
│   └── sticker-overlay.ts(~120 lines) - Sticker overlay filters
├── sources/
│   ├── index.ts          (~20 lines)  - Sources barrel
│   ├── video-sources.ts  (~200 lines) - Video path extraction
│   └── sticker-sources.ts(~150 lines) - Sticker path/download extraction
└── (main file stays at lib/export-engine-cli.ts ~700 lines)
```

---

## Detailed Extraction Plan

### File 1: `export-cli/types.ts` (~80 lines)

All TypeScript interfaces extracted for reuse (matching current implementation).

```typescript
import type { TextElement } from "@/types/timeline";

/**
 * Video source input for FFmpeg direct copy optimization
 * (Matches current VideoSourceInput in export-engine-cli.ts:27-33)
 */
export interface VideoSourceInput {
  path: string;
  startTime: number;
  duration: number;
  trimStart: number;  // Required in current impl
  trimEnd: number;    // Required in current impl
}

/**
 * Audio file input for FFmpeg export
 * (Matches current AudioFileInput in export-engine-cli.ts:38-42)
 */
export interface AudioFileInput {
  path: string;
  startTime: number;
  volume: number;  // Required in current impl
}

/**
 * Sticker source for FFmpeg overlay filter
 * (Matches current StickerSourceForFilter in export-engine-cli.ts:44-56)
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
 * Progress callback type (matches export-engine-cli.ts:22)
 */
export type ProgressCallback = (progress: number, message: string) => void;

/**
 * Font configuration return type for platform-specific resolution
 * (Matches resolveFontPath return in export-engine-cli.ts:172-174)
 */
export type FontConfig =
  | { useFontconfig: true; fontName: string }
  | { useFontconfig: false; fontPath: string };

/**
 * Re-export TextElement for use in filter modules
 */
export type { TextElement };
```

**Why extract**: Types are used by multiple modules and UI components. Keeps interface definitions in sync across filter and source extraction modules.

---

### File 2: `export-cli/filters/text-escape.ts` (~70 lines)

FFmpeg text escaping utilities (pure functions). Extracted from lines 89-137.

```typescript
/**
 * Escape special characters for FFmpeg drawtext filter.
 * FFmpeg drawtext uses ':' as delimiter and requires escaping for special chars.
 *
 * Characters escaped (in order):
 * - '\' -> '\\' (backslashes first)
 * - ':' -> '\:' (filter delimiter)
 * - '[' -> '\[' (bracket)
 * - ']' -> '\]' (bracket)
 * - ',' -> '\,' (filter separator)
 * - ';' -> '\;' (semicolon)
 * - "'" -> "\'" (single quote)
 * - '%' -> '\%' (expansion tokens)
 * - '\n' -> '\\n' (newlines to literal)
 * - '\r' -> '' (remove carriage returns)
 * - '=' -> '\=' (equals sign)
 *
 * @param text - Raw text content to escape
 * @returns FFmpeg-safe escaped string
 */
export function escapeTextForFFmpeg(text: string): string {
  return text
    .replace(/\\/g, "\\\\")  // Escape backslashes first
    .replace(/:/g, "\\:")    // Escape colons (filter delimiter)
    .replace(/\[/g, "\\[")   // Escape opening brackets
    .replace(/\]/g, "\\]")   // Escape closing brackets
    .replace(/,/g, "\\,")    // Escape commas (filter separator)
    .replace(/;/g, "\\;")    // Escape semicolons
    .replace(/'/g, "\\'")    // Escape single quotes
    .replace(/%/g, "\\%")    // Escape percent signs (expansion tokens)
    .replace(/\n/g, "\\n")   // Convert newlines to literal \n
    .replace(/\r/g, "")      // Remove carriage returns
    .replace(/=/g, "\\=");   // Escape equals signs
}

/**
 * Escape file system paths for FFmpeg filter arguments.
 * Ensures separators, spaces, and delimiters are properly escaped.
 *
 * @param path - File system path to escape
 * @returns FFmpeg-safe escaped path
 */
export function escapePathForFFmpeg(path: string): string {
  return path
    .replace(/\\/g, "\\\\")  // Windows backslashes
    .replace(/:/g, "\\:")    // Drive letter separator
    .replace(/ /g, "\\ ")    // Spaces in path segments
    .replace(/,/g, "\\,")    // Filter delimiters
    .replace(/;/g, "\\;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/=/g, "\\=");
}

/**
 * Convert CSS hex color to FFmpeg format (0xRRGGBB).
 *
 * @param hexColor - CSS color string (e.g., "#ffffff" or "ffffff")
 * @returns FFmpeg color format (e.g., "0xffffff")
 */
export function colorToFFmpeg(hexColor: string): string {
  const hex = hexColor.startsWith("#") ? hexColor.substring(1) : hexColor;
  return `0x${hex}`;
}
```

**Why extract**: Pure utility functions, easily testable, reusable in other FFmpeg-related code (subtitles, watermarks).

---

### File 3: `export-cli/filters/font-resolver.ts` (~150 lines)

Cross-platform font path resolution. Extracted from lines 139-263.

```typescript
import type { FontConfig } from "../types";

/**
 * Font file mapping for Windows.
 * Maps font family names to actual .ttf files in C:\Windows\Fonts
 */
const WINDOWS_FONT_MAP: Record<
  string,
  { regular: string; bold?: string; italic?: string; boldItalic?: string }
> = {
  "arial": {
    regular: "arial.ttf",
    bold: "arialbd.ttf",
    italic: "ariali.ttf",
    boldItalic: "arialbi.ttf",
  },
  "times new roman": {
    regular: "times.ttf",
    bold: "timesbd.ttf",
    italic: "timesi.ttf",
    boldItalic: "timesbi.ttf",
  },
  "courier new": {
    regular: "cour.ttf",
    bold: "courbd.ttf",
    italic: "couri.ttf",
    boldItalic: "courbi.ttf",
  },
};

/**
 * Font name mapping for Linux/macOS (fontconfig).
 * Maps common Windows fonts to system equivalents.
 */
const FONTCONFIG_MAP: Record<string, { mac: string; linux: string }> = {
  "arial": { mac: "Helvetica", linux: "Liberation Sans" },
  "times new roman": { mac: "Times", linux: "Liberation Serif" },
  "courier new": { mac: "Courier", linux: "Liberation Mono" },
};

/**
 * Resolve font family to FFmpeg-compatible font configuration.
 *
 * Platform-specific approach:
 * - **Linux/macOS**: Use fontconfig (font='Arial:style=Bold')
 * - **Windows**: Use explicit fontfile path (no fontconfig support)
 *
 * @param fontFamily - CSS font family name (e.g., 'Arial', 'Times New Roman')
 * @param fontWeight - CSS font weight (e.g., 'bold')
 * @param fontStyle - CSS font style (e.g., 'italic')
 * @returns FontConfig object with platform-appropriate font specifier
 * @throws Error if platform detection fails (Electron API unavailable)
 */
export function resolveFontPath(
  fontFamily: string,
  fontWeight?: string,
  fontStyle?: string
): FontConfig {
  const normalizedFamily = fontFamily.toLowerCase().replace(/['"]/g, "");
  const isBold = fontWeight === "bold";
  const isItalic = fontStyle === "italic";

  // Detect platform using Electron API
  const platform = window.electronAPI?.platform;
  if (!platform) {
    throw new Error(
      "Platform information not available. Ensure Electron API is initialized."
    );
  }

  const isWindows = platform === "win32";
  const isMac = platform === "darwin";

  // Linux/macOS: Use fontconfig
  if (!isWindows) {
    const fontMapping = FONTCONFIG_MAP[normalizedFamily];
    const fontName = fontMapping
      ? (isMac ? fontMapping.mac : fontMapping.linux)
      : normalizedFamily;

    const styles: string[] = [];
    if (isBold) styles.push("Bold");
    if (isItalic) styles.push("Italic");
    const styleString = styles.length > 0 ? `:style=${styles.join(" ")}` : "";

    return { useFontconfig: true, fontName: `${fontName}${styleString}` };
  }

  // Windows: Use explicit font file paths
  const fontConfig = WINDOWS_FONT_MAP[normalizedFamily] || WINDOWS_FONT_MAP.arial;
  let fontFile = fontConfig.regular;

  if (isBold && isItalic && fontConfig.boldItalic) {
    fontFile = fontConfig.boldItalic;
  } else if (isBold && fontConfig.bold) {
    fontFile = fontConfig.bold;
  } else if (isItalic && fontConfig.italic) {
    fontFile = fontConfig.italic;
  }

  return { useFontconfig: false, fontPath: `C:/Windows/Fonts/${fontFile}` };
}
```

**Why extract**: Complex platform-specific logic that benefits from isolation and testing. It can be extended to support custom font directories.

---

### File 4: `export-cli/filters/text-overlay.ts` (~180 lines)

Text overlay filter building. Extracted from lines 265-482.

```typescript
import { escapeTextForFFmpeg, escapePathForFFmpeg, colorToFFmpeg } from "./text-escape";
import { resolveFontPath } from "./font-resolver";
import type { TextElement } from "../types";

/**
 * Convert a TextElement to FFmpeg drawtext filter string.
 * Includes positioning, styling, timing, and optional effects.
 *
 * @param element - Text element from timeline
 * @returns FFmpeg drawtext filter string, or empty string if element is invalid
 */
export function convertTextElementToDrawtext(element: TextElement): string {
  // Skip empty or hidden elements
  if (!element.content?.trim() || element.hidden) {
    return "";
  }

  const escapedText = escapeTextForFFmpeg(element.content);
  const fontConfig = resolveFontPath(
    element.fontFamily || "Arial",
    element.fontWeight,
    element.fontStyle
  );
  const fontColor = colorToFFmpeg(element.color || "#ffffff");

  // Calculate timing (accounting for trim)
  const trimStart = element.trimStart ?? 0;
  const trimEnd = element.trimEnd ?? 0;
  const duration = element.duration ?? 0;
  const startTime = element.startTime + trimStart;
  const endTime = element.startTime + duration - trimEnd;

  // Build base filter parameters
  const filterParams: string[] = [
    `text='${escapedText}'`,
    `fontsize=${element.fontSize || 24}`,
    `fontcolor=${fontColor}`,
  ];

  // Add font parameter (platform-specific)
  if (fontConfig.useFontconfig) {
    filterParams.push(`font='${fontConfig.fontName}'`);
  } else {
    filterParams.push(`fontfile=${escapePathForFFmpeg(fontConfig.fontPath)}`);
  }

  // Position calculation: element x/y are relative to canvas center
  const formatOffset = (value: number): string => {
    if (value === 0) return "";
    return value > 0 ? `+${value}` : `${value}`;
  };

  const xOffset = Math.round(element.x ?? 0);
  const yOffset = Math.round(element.y ?? 0);
  const anchorXExpr = `w/2${formatOffset(xOffset)}`;
  const yExpr = `(h-text_h)/2${formatOffset(yOffset)}`;

  // Apply text alignment
  let xExpr = `${anchorXExpr}-(text_w/2)`; // Default: center
  if (element.textAlign === "left") {
    xExpr = `${anchorXExpr}`;
  } else if (element.textAlign === "right") {
    xExpr = `${anchorXExpr}-text_w`;
  }

  filterParams.push(`x=${xExpr}`, `y=${yExpr}`);

  // Add border for readability
  filterParams.push("borderw=2", "bordercolor=black");

  // Handle opacity
  if (element.opacity !== undefined && element.opacity < 1) {
    filterParams.push(`alpha=${Math.round(element.opacity * 255)}/255`);
  }

  // Handle rotation
  if (element.rotation && element.rotation !== 0) {
    filterParams.push(`angle=${(element.rotation * Math.PI) / 180}`);
  }

  // Handle background color
  if (element.backgroundColor && element.backgroundColor !== "transparent") {
    const bgColor = colorToFFmpeg(element.backgroundColor);
    filterParams.push("box=1", `boxcolor=${bgColor}@0.5`, "boxborderw=5");
  }

  // Add timing constraint
  filterParams.push(`enable='between(t,${startTime},${endTime})'`);

  return `drawtext=${filterParams.join(":")}`;
}

/**
 * Build complete FFmpeg filter chain for all text overlays.
 *
 * @param tracks - Timeline tracks to extract text elements from
 * @returns Comma-separated FFmpeg drawtext filter chain
 */
export function buildTextOverlayFilters(
  tracks: Array<{ type: string; elements: TextElement[] }>
): string {
  const textElementsWithOrder: Array<{
    element: TextElement;
    trackIndex: number;
    elementIndex: number;
  }> = [];

  // Collect text elements with ordering info
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
    const track = tracks[trackIndex];
    if (track.type !== "text") continue;

    for (let elementIndex = 0; elementIndex < track.elements.length; elementIndex++) {
      const element = track.elements[elementIndex];
      if (element.type !== "text" || element.hidden) continue;

      textElementsWithOrder.push({ element, trackIndex, elementIndex });
    }
  }

  // Sort by track order, then element order (for proper layering)
  // NOTE: Text elements use track/element index for ordering (not zIndex).
  // This matches the original implementation in export-engine-cli.ts.
  // Lower track index = rendered first (background layer).
  textElementsWithOrder.sort((a, b) => {
    if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex;
    return a.elementIndex - b.elementIndex;
  });

  return textElementsWithOrder
    .map((item) => convertTextElementToDrawtext(item.element))
    .filter((f) => f !== "")
    .join(",");
}
```

**Why extract**: Filter building is complex, benefits from unit testing, and is logically separate from export orchestration. The track iteration logic can remain in the main class or be passed as parameters.

---

### File 5: `export-cli/filters/sticker-overlay.ts` (~120 lines)

Sticker overlay filter building. Extracted from lines 857-955.

```typescript
import type { StickerSourceForFilter } from "../types";
import { debugLog } from "@/lib/debug-config";

/**
 * Build FFmpeg complex filter chain for sticker overlays.
 *
 * Filter chain structure:
 * 1. Scale each sticker to desired dimensions
 * 2. Apply rotation if needed
 * 3. Apply opacity using format+geq (alpha blending)
 * 4. Overlay on previous layer at specific position with timing
 *
 * @param stickerSources - Array of sticker data with position, size, timing
 * @param totalDuration - Total video duration for timing constraints
 * @returns FFmpeg complex filter chain string
 */
export function buildStickerOverlayFilters(
  stickerSources: StickerSourceForFilter[],
  totalDuration: number
): string {
  if (!stickerSources || stickerSources.length === 0) {
    return "";
  }

  debugLog(`[StickerOverlay] Building filters for ${stickerSources.length} stickers`);

  const filters: string[] = [];
  let lastOutput = "0:v"; // Start with base video stream

  for (const [index, sticker] of stickerSources.entries()) {
    const inputIndex = index + 1; // Sticker inputs start at 1 (0 is base video)
    const isLast = index === stickerSources.length - 1;
    const outputLabel = isLast ? "" : `[v${index + 1}]`;

    let currentInput = `[${inputIndex}:v]`;

    // Scale sticker to desired size
    const scaleFilter = `${currentInput}scale=${sticker.width}:${sticker.height}[scaled${index}]`;
    filters.push(scaleFilter);
    currentInput = `[scaled${index}]`;

    // Apply rotation if needed
    if (sticker.rotation !== undefined && sticker.rotation !== 0) {
      const rotateFilter = `${currentInput}rotate=${sticker.rotation}*PI/180:c=none[rotated${index}]`;
      filters.push(rotateFilter);
      currentInput = `[rotated${index}]`;
    }

    // Build overlay parameters
    const overlayParams = [`x=${sticker.x}`, `y=${sticker.y}`];

    // Add timing constraint
    if (sticker.startTime !== 0 || sticker.endTime !== totalDuration) {
      overlayParams.push(
        `enable='between(t,${sticker.startTime},${sticker.endTime})'`
      );
    }

    // Handle opacity
    if (sticker.opacity !== undefined && sticker.opacity < 1) {
      const opacityFilter = `${currentInput}format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${sticker.opacity}*alpha(X,Y)'[alpha${index}]`;
      filters.push(opacityFilter);
      const overlayFilter = `[${lastOutput}][alpha${index}]overlay=${overlayParams.join(":")}${outputLabel}`;
      filters.push(overlayFilter);
    } else {
      const overlayFilter = `[${lastOutput}]${currentInput}overlay=${overlayParams.join(":")}${outputLabel}`;
      filters.push(overlayFilter);
    }

    // Update last output for chaining
    if (outputLabel) {
      lastOutput = outputLabel.replace("[", "").replace("]", "");
    }
  }

  const filterChain = filters.join(";");
  debugLog(`[StickerOverlay] Generated filter chain: ${filterChain}`);

  return filterChain;
}
```

**Why extract**: Sticker filter logic is self-contained and complex enough to warrant isolation, and can be unit tested without Electron dependencies.

---

### File 6: `export-cli/sources/video-sources.ts` (~200 lines)

Video source path extraction. Extracted from lines 484-665.

```typescript
import type { VideoSourceInput } from "../types";
import type { TimelineTrack, TimelineElement } from "@/types/timeline";
import type { MediaItem } from "@/stores/media-store";
import { debugLog, debugWarn } from "@/lib/debug-config";

/**
 * Extract video sources from timeline for direct copy optimization.
 * Handles blob URLs by creating temp files via Electron IPC.
 *
 * @param tracks - Timeline tracks to extract video elements from
 * @param mediaItems - Media items to look up video paths
 * @param sessionId - Export session ID for temp file naming
 * @returns Array of video sources sorted by start time
 */
export async function extractVideoSources(
  tracks: TimelineTrack[],
  mediaItems: MediaItem[],
  sessionId: string | null
): Promise<VideoSourceInput[]> {
  const videoSources: VideoSourceInput[] = [];

  for (const track of tracks) {
    if (track.type !== "media") continue;

    for (const element of track.elements) {
      if (element.hidden || element.type !== "media") continue;

      const mediaItem = mediaItems.find(
        (item) => item.id === (element as any).mediaId
      );
      if (!mediaItem || mediaItem.type !== "video") continue;

      let localPath = mediaItem.localPath;

      // Create temp file from blob if no localPath
      if (!localPath && mediaItem.file && mediaItem.file.size > 0) {
        localPath = await createTempFileFromBlob(
          mediaItem,
          sessionId
        );
      }

      if (!localPath) {
        debugWarn(`[VideoSources] Video ${mediaItem.id} has no localPath`);
        continue;
      }

      videoSources.push({
        path: localPath,
        startTime: element.startTime,
        duration: element.duration,
        trimStart: element.trimStart,
        trimEnd: element.trimEnd,
      });
    }
  }

  videoSources.sort((a, b) => a.startTime - b.startTime);
  debugLog(`[VideoSources] Extracted ${videoSources.length} video sources`);
  return videoSources;
}

/**
 * Extract single video input path for Mode 2 optimization.
 * Returns video path only if exactly one video exists with a local path.
 *
 * @param tracks - Timeline tracks to search
 * @param mediaItems - Media items to look up paths
 * @param sessionId - Export session ID for temp file creation
 * @returns Video input info or null if Mode 2 not applicable
 */
export async function extractVideoInputPath(
  tracks: TimelineTrack[],
  mediaItems: MediaItem[],
  sessionId: string | null
): Promise<{ path: string; trimStart: number; trimEnd: number } | null> {
  debugLog("[VideoSources] Extracting video input path for Mode 2...");

  let videoElement: TimelineElement | null = null;
  let mediaItem: MediaItem | null = null;
  let videoCount = 0;

  for (const track of tracks) {
    if (track.type !== "media") continue;

    for (const element of track.elements) {
      if (element.hidden || element.type !== "media") continue;

      const item = mediaItems.find((m) => m.id === (element as any).mediaId);
      if (item?.type === "video") {
        videoCount++;
        if (videoCount > 1) {
          debugLog("[VideoSources] Multiple videos found, Mode 2 not applicable");
          return null;
        }
        videoElement = element;
        mediaItem = item;
      }
    }
  }

  if (!videoElement || !mediaItem) {
    debugLog("[VideoSources] No video found");
    return null;
  }

  let localPath = mediaItem.localPath;

  // Create temp file from blob if needed
  if (!localPath && mediaItem.file && mediaItem.file.size > 0) {
    localPath = await createTempFileFromBlob(mediaItem, sessionId);
  }

  if (!localPath) {
    debugLog("[VideoSources] No video with localPath found");
    return null;
  }

  return {
    path: localPath,
    trimStart: videoElement.trimStart || 0,
    trimEnd: videoElement.trimEnd || 0,
  };
}

/**
 * Create temp file from File blob for FFmpeg processing.
 */
async function createTempFileFromBlob(
  mediaItem: MediaItem,
  sessionId: string | null
): Promise<string | undefined> {
  if (!window.electronAPI?.video?.saveTemp) return undefined;

  try {
    debugLog(`[VideoSources] Creating temp file for: ${mediaItem.name}`);
    const arrayBuffer = await mediaItem.file!.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const path = await window.electronAPI.video.saveTemp(
      uint8Array,
      mediaItem.name,
      sessionId || undefined
    );
    debugLog(`[VideoSources] Created temp file: ${path}`);
    return path;
  } catch (error) {
    debugWarn(`[VideoSources] Failed to create temp file:`, error);
    return undefined;
  }
}
```

**Why extract**: Video source extraction is a distinct concern from filter building, and can be tested with mock media items independently.

---

### File 7: `export-cli/sources/sticker-sources.ts` (~150 lines)

Sticker source extraction. Extracted from lines 667-855.

```typescript
import type { StickerSourceForFilter } from "../types";
import type { MediaItem } from "@/stores/media-store";
import { debugLog, debugWarn, debugError } from "@/lib/debug-config";

/**
 * Extract sticker sources from stickers overlay store for FFmpeg processing.
 * Downloads blob/data URLs to temp files since FFmpeg CLI cannot read them.
 *
 * @param mediaItems - Media items to look up sticker paths
 * @param sessionId - Export session ID for temp file naming
 * @param canvasWidth - Canvas width for position calculation
 * @param canvasHeight - Canvas height for position calculation
 * @param totalDuration - Total video duration for timing defaults
 * @returns Array of sticker sources sorted by z-index
 */
export async function extractStickerSources(
  mediaItems: MediaItem[],
  sessionId: string | null,
  canvasWidth: number,
  canvasHeight: number,
  totalDuration: number
): Promise<StickerSourceForFilter[]> {
  debugLog("[StickerSources] Extracting sticker sources for FFmpeg overlay");

  try {
    // Import stickers store dynamically
    const { useStickersOverlayStore } = await import(
      "@/stores/stickers-overlay-store"
    );
    const stickersStore = useStickersOverlayStore.getState();
    const allStickers = stickersStore.getStickersForExport();

    if (allStickers.length === 0) {
      debugLog("[StickerSources] No stickers to export");
      return [];
    }

    debugLog(`[StickerSources] Processing ${allStickers.length} stickers`);

    const stickerSources: StickerSourceForFilter[] = [];

    for (const sticker of allStickers) {
      try {
        const mediaItem = mediaItems.find((m) => m.id === sticker.mediaItemId);
        if (!mediaItem) {
          debugWarn(`[StickerSources] Media item not found for ${sticker.id}`);
          continue;
        }

        // Download sticker to temp directory if needed
        const localPath = await downloadStickerToTemp(sticker, mediaItem, sessionId);

        // Convert percentage positions to pixel coordinates
        const baseSize = Math.min(canvasWidth, canvasHeight);
        const pixelX = (sticker.position.x / 100) * canvasWidth;
        const pixelY = (sticker.position.y / 100) * canvasHeight;
        const pixelWidth = (sticker.size.width / 100) * baseSize;
        const pixelHeight = (sticker.size.height / 100) * baseSize;

        // Adjust for center-based positioning
        const topLeftX = pixelX - pixelWidth / 2;
        const topLeftY = pixelY - pixelHeight / 2;

        stickerSources.push({
          id: sticker.id,
          path: localPath,
          x: Math.round(topLeftX),
          y: Math.round(topLeftY),
          width: Math.round(pixelWidth),
          height: Math.round(pixelHeight),
          startTime: sticker.timing?.startTime ?? 0,
          endTime: sticker.timing?.endTime ?? totalDuration,
          zIndex: sticker.zIndex,
          opacity: sticker.opacity,
          rotation: sticker.rotation,
        });
      } catch (error) {
        debugError(`[StickerSources] Failed to process sticker ${sticker.id}:`, error);
      }
    }

    stickerSources.sort((a, b) => a.zIndex - b.zIndex);
    debugLog(`[StickerSources] Extracted ${stickerSources.length} valid sources`);
    return stickerSources;
  } catch (error) {
    debugError("[StickerSources] Failed to extract sticker sources:", error);
    return [];
  }
}

/**
 * Download sticker blob/data URL to temp directory for FFmpeg CLI access.
 */
async function downloadStickerToTemp(
  sticker: { id: string },
  mediaItem: MediaItem,
  sessionId: string | null
): Promise<string> {
  // Return existing local path if available
  if (mediaItem.localPath) {
    return mediaItem.localPath;
  }

  if (!mediaItem.url) {
    throw new Error(`No URL for sticker media item ${mediaItem.id}`);
  }

  // Fetch blob/data URL
  const response = await fetch(mediaItem.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch sticker: ${response.status}`);
  }

  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const imageBytes = new Uint8Array(arrayBuffer);
  const format = blob.type?.split("/")[1] || "png";

  if (!window.electronAPI?.ffmpeg?.saveStickerForExport || !sessionId) {
    throw new Error("Electron API not available for sticker export");
  }

  const result = await window.electronAPI.ffmpeg.saveStickerForExport({
    sessionId,
    stickerId: sticker.id,
    imageData: imageBytes,
    format,
  });

  if (!result.success) {
    throw new Error(result.error || "Failed to save sticker");
  }

  debugLog(`[StickerSources] Downloaded sticker to: ${result.path}`);
  return result.path!;
}
```

**Why extract**: Sticker extraction involves store access and file I/O, distinct from filter building logic. Separation allows independent testing.

---

### Updated: `export-engine-cli.ts` (~700 lines)

Main engine focused on orchestration. Imports extracted modules.

```typescript
import { ExportEngine } from "./export-engine";
import { ExportSettings } from "@/types/export";
import { TimelineTrack, TimelineElement, type TextElement } from "@/types/timeline";
import { MediaItem } from "@/stores/media-store";
import { debugLog, debugError, debugWarn } from "@/lib/debug-config";
import { useEffectsStore } from "@/stores/effects-store";
import { analyzeTimelineForExport, type ExportAnalysis } from "./export-analysis";

// Import extracted modules
import type {
  VideoSourceInput,
  AudioFileInput,
  StickerSourceForFilter,
  ProgressCallback,
} from "./export-cli/types";
import { buildTextOverlayFilters } from "./export-cli/filters/text-overlay";
import { buildStickerOverlayFilters } from "./export-cli/filters/sticker-overlay";
import { extractVideoSources, extractVideoInputPath } from "./export-cli/sources/video-sources";
import { extractStickerSources } from "./export-cli/sources/sticker-sources";

// Re-export types for backward compatibility
export type { ProgressCallback, VideoSourceInput, AudioFileInput };

type EffectsStore = ReturnType<typeof useEffectsStore.getState>;

export class CLIExportEngine extends ExportEngine {
  private sessionId: string | null = null;
  private frameDir: string | null = null;
  private effectsStore?: EffectsStore;
  private exportAnalysis: ExportAnalysis | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    settings: ExportSettings,
    tracks: TimelineTrack[],
    mediaItems: MediaItem[],
    totalDuration: number,
    effectsStore?: EffectsStore
  ) {
    super(canvas, settings, tracks, mediaItems, totalDuration);
    this.effectsStore = effectsStore;

    if (!window.electronAPI?.ffmpeg?.exportVideoCLI) {
      throw new Error("CLI Export Engine requires Electron environment");
    }
  }

  /**
   * Main export entry point - analyzes timeline and selects optimal export mode.
   * Delegates to extracted modules for filter building and source extraction.
   */
  async export(progressCallback?: ProgressCallback): Promise<Blob> {
    // 1. Create export session
    // 2. Analyze timeline for optimization strategy
    // 3. Extract sources using: extractVideoSources(), extractStickerSources()
    // 4. Build filter chains using: buildTextOverlayFilters(), buildStickerOverlayFilters()
    // 5. Select export mode (Mode 1, 1.5, or 2)
    // 6. Execute FFmpeg via IPC (exportWithCLI)
    // 7. Handle progress and cleanup
  }

  // Remaining methods (~500 lines):
  // - prepareAudioFiles()
  // - createExportSession()
  // - exportWithCLI() - main FFmpeg orchestration
  // - readOutputFile()
  // - calculateTotalFrames()
  // - logActualVideoDurationCLI()
  // - cleanup()
}
```

**Key changes in main file:**
1. Import extracted type definitions from `export-cli/types.ts`
2. Import filter builders from `export-cli/filters/`
3. Import source extractors from `export-cli/sources/`
4. Re-export types for backward compatibility
5. Remove ~500 lines of extracted code
6. Keep orchestration logic, audio prep, and IPC handling

---

## Implementation Subtasks

### Subtask 1: Extract Types (~10 min)

1. Create `apps/web/src/lib/export-cli/types.ts`
2. Move interfaces from lines 22-56:
   - `ProgressCallback` (line 22)
   - `VideoSourceInput` (lines 27-33)
   - `AudioFileInput` (lines 38-42)
   - `StickerSourceForFilter` (lines 44-56)
   - Add `FontConfig` type for font resolver
3. Create barrel file `export-cli/index.ts`
4. Update imports in `export-engine-cli.ts`
5. Verify: `bun run check-types`

**Risk**: Low (no logic changes)

---

### Subtask 2: Extract Text Escape & Font Resolver (~15 min)

1. Create `export-cli/filters/text-escape.ts`
2. Create `export-cli/filters/font-resolver.ts`
3. Move `escapeTextForFFmpeg()` from lines 93-117
4. Move `escapePathForFFmpeg()` from lines 123-137
5. Move `resolveFontPath()` from lines 168-263
6. Create `export-cli/filters/index.ts` barrel
7. Update method calls in `export-engine-cli.ts` to use imports
8. Verify: `bun run check-types`

**Risk**: Low (pure functions, no side effects)

---

### Subtask 3: Extract Text Overlay Filters (~15 min)

1. Create `export-cli/filters/text-overlay.ts`
2. Move `convertTextElementToDrawtext()` from lines 269-386
3. Move `buildTextOverlayFilters()` from lines 420-482
4. Update filter barrel exports
5. Update `export-engine-cli.ts` to import and call extracted functions
6. Verify: `bun run check-types` + test text overlay export

**Risk**: Medium (filter chain building, timing logic)

---

### Subtask 4: Extract Sticker Overlay Filters (~15 min)

1. Create `export-cli/filters/sticker-overlay.ts`
2. Move `buildStickerOverlayFilters()` from lines 883-955
3. Update filter barrel exports
4. Update `export-engine-cli.ts` to import and call extracted function
5. Verify: Test sticker overlay export

**Risk**: Medium (complex filter graph building)

---

### Subtask 5: Extract Video Source Extraction (~15 min)

1. Create `export-cli/sources/video-sources.ts`
2. Move `extractVideoSources()` from lines 490-560
3. Move `extractVideoInputPath()` from lines 581-665
4. Create `export-cli/sources/index.ts` barrel
5. Update `export-engine-cli.ts` to pass required params (tracks, mediaItems, sessionId)
6. Verify: Full export test with Mode 1/2

**Risk**: Medium (Electron IPC, temp file creation)

---

### Subtask 6: Extract Sticker Source Extraction (~15 min)

1. Create `export-cli/sources/sticker-sources.ts`
2. Move `downloadStickerToTemp()` from lines 689-754
3. Move `extractStickerSources()` from lines 760-855
4. Update sources barrel exports
5. Update `export-engine-cli.ts` to pass required params (mediaItems, sessionId, canvas dimensions)
6. Verify: Test sticker export

**Risk**: Medium (store access, file I/O)

---

### Subtask 7: Cleanup & Documentation (~10 min)

1. Remove duplicated code from main file
2. Update all imports to use barrels
3. Ensure re-exports maintain backward compatibility
4. Update `LARGE-FILES-ANALYSIS.md` with new file sizes
5. Run full test suite: `bun run test`
6. Remove backup file after successful validation

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
| `export-engine-cli.ts` | 1,690 | **883** |
| `export-cli/types.ts` | - | 72 |
| `export-cli/filters/text-escape.ts` | - | 75 |
| `export-cli/filters/font-resolver.ts` | - | 123 |
| `export-cli/filters/text-overlay.ts` | - | 170 |
| `export-cli/filters/sticker-overlay.ts` | - | 99 |
| `export-cli/sources/video-sources.ts` | - | 199 |
| `export-cli/sources/sticker-sources.ts` | - | 230 |
| `export-cli/index.ts` | - | 48 |
| `export-cli/filters/index.ts` | - | 24 |
| `export-cli/sources/index.ts` | - | 11 |
| **Total** | 1,690 | **1,934** |

**Net change**: +244 lines (JSDoc additions, wrapper methods, barrel files)
**Main file reduction**: 807 lines (48%)
**Type checks**: ✅ Pass
**Lint**: ✅ Pass (no new errors)

---

## Code Reuse Opportunities

### Reuse FROM Existing Modules

| Existing Module | Can Reuse |
|-----------------|-----------|
| `@/types/timeline` | `TextElement`, `TimelineTrack`, `TimelineElement` types |
| `@/stores/media-store` | `MediaItem` type for video/sticker lookup |
| `@/lib/debug-config` | `debugLog`, `debugWarn`, `debugError` for consistent logging |
| `./export-analysis` | `analyzeTimelineForExport()` for optimization strategy |

### Reuse BY Future Modules

| New Module | Can Be Used By |
|------------|----------------|
| `filters/text-escape.ts` | Subtitle rendering, watermark filters, caption export |
| `filters/font-resolver.ts` | SRT/ASS subtitle generation, text effects |
| `filters/text-overlay.ts` | Thumbnail generation with text, preview rendering |
| `filters/sticker-overlay.ts` | Watermark overlays, logo placement |
| `sources/video-sources.ts` | Clip preview generation, metadata extraction |
| `sources/sticker-sources.ts` | GIF export, image sequence export |

---

## Backward Compatibility

Existing imports continue to work:

```typescript
// Before and after - unchanged
import { CLIExportEngine } from "@/lib/export-engine-cli";
import type { VideoSourceInput, AudioFileInput, ProgressCallback } from "@/lib/export-engine-cli";
```

New modular imports available:

```typescript
// Import specific utilities for other features
import { escapeTextForFFmpeg, escapePathForFFmpeg, colorToFFmpeg } from "@/lib/export-cli/filters/text-escape";
import { resolveFontPath } from "@/lib/export-cli/filters/font-resolver";
import { buildTextOverlayFilters, convertTextElementToDrawtext } from "@/lib/export-cli/filters/text-overlay";
import { buildStickerOverlayFilters } from "@/lib/export-cli/filters/sticker-overlay";

// Import types for type-safe development
import type { StickerSourceForFilter, FontConfig } from "@/lib/export-cli/types";
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
*Implementation completed: 2025-12-10*
*Original file: 1,690 lines*
*Final main file: 883 lines (48% reduction)*
*Extracted modules: 1,051 lines (10 files)*
*Author: Claude Code*
