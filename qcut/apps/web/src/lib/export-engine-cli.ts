import { ExportEngine } from "./export-engine";
import { ExportSettings } from "@/types/export";
import {
  TimelineTrack,
  TimelineElement,
  type TextElement,
} from "@/types/timeline";
import { MediaItem } from "@/stores/media-store";
import { debugLog, debugError, debugWarn } from "@/lib/debug-config";
import { useEffectsStore } from "@/stores/effects-store";
import {
  analyzeTimelineForExport,
  type ExportAnalysis,
} from "./export-analysis";

type EffectsStore = ReturnType<typeof useEffectsStore.getState>;

// Note: Module-level cached dynamic imports (stickersModulePromise, mediaModulePromise,
// stickerHelperModulePromise) have been removed as part of Mode 3 removal.
// They were only used by the removed Canvas rendering methods for sticker compositing.

export type ProgressCallback = (progress: number, message: string) => void;

/**
 * Video source input for FFmpeg direct copy optimization
 */
export interface VideoSourceInput {
  path: string;
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
}

/**
 * Audio file input for FFmpeg export
 */
export interface AudioFileInput {
  path: string;
  startTime: number;
  volume: number;
}

interface StickerSourceForFilter {
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

    // 🚨 SAFETY CHECK: Verify Electron environment
    if (
      !window.electronAPI ||
      !window.electronAPI.ffmpeg ||
      typeof window.electronAPI.ffmpeg.exportVideoCLI !== "function"
    ) {
      throw new Error("CLI Export Engine requires Electron environment");
    }
  }

  // Note: Canvas rendering methods (renderFrame, renderElementCLI, renderMediaElementCLI,
  // renderVideoCLI, renderImageCLI, renderTextElementCLI, renderStickerElementCLI)
  // have been removed as part of Mode 3 removal. All exports now use FFmpeg directly.

  /**
   * Escape special characters for FFmpeg drawtext filter
   * FFmpeg drawtext uses ':' as delimiter and requires escaping for special chars
   */
  private escapeTextForFFmpeg(text: string): string {
    // FFmpeg drawtext filter requires escaping these characters:
    // '\' -> '\\'
    // ':' -> '\:'
    // '[' -> '\['
    // ']' -> '\]'
    // ',' -> '\,'
    // ';' -> '\;'
    // "'" -> "\\'" (escaped apostrophe)
    // '%' -> '\\%' (prevent expansion tokens)
    // Newlines -> literal '\n' string

    return text
      .replace(/\\/g, "\\\\") // Escape backslashes first
      .replace(/:/g, "\\:") // Escape colons (filter delimiter)
      .replace(/\[/g, "\\[") // Escape opening brackets
      .replace(/\]/g, "\\]") // Escape closing brackets
      .replace(/,/g, "\\,") // Escape commas (filter separator)
      .replace(/;/g, "\\;") // Escape semicolons
      .replace(/'/g, "\\'") // Escape single quotes
      .replace(/%/g, "\\%") // Escape percent signs (expansion tokens)
      .replace(/\n/g, "\\n") // Convert newlines to literal \n
      .replace(/\r/g, "") // Remove carriage returns
      .replace(/=/g, "\\="); // Escape equals signs
  }

  /**
   * Escape file system paths for FFmpeg filter arguments.
   * Ensures separators, spaces, and delimiters are escaped.
   */
  private escapePathForFFmpeg(path: string): string {
    return path
      .replace(/\\/g, "\\\\") // Windows backslashes
      .replace(/:/g, "\\:") // Drive letter separator
      .replace(/ /g, "\\ ") // Spaces in path segments
      .replace(/,/g, "\\,") // Filter delimiters
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
   * Resolve font family name for FFmpeg drawtext filter across platforms.
   *
   * WHY platform-specific approach is required:
   * - **Linux/macOS**: Have fontconfig system for font resolution
   *   - Use font='Arial:style=Bold' format
   *   - Fontconfig handles font finding and loading
   *   - More robust across different installations
   *
   * - **Windows**: No fontconfig support
   *   - Must use fontfile='C:/Windows/Fonts/arial.ttf' format
   *   - Requires hardcoded paths to font files
   *   - Each font variant (bold, italic) is a separate file
   *
   * Edge cases handled:
   * - Unknown font family: Falls back to Arial
   * - Bold+Italic: Uses combined font file (e.g., arialbi.ttf)
   * - Platform detection failure: Throws error to prevent silent failures
   *
   * Performance note:
   * - Called once per text element during filter chain building
   * - No runtime overhead during export
   *
   * @param fontFamily - CSS font family name (e.g., 'Arial', 'Times New Roman')
   * @param fontWeight - CSS font weight (e.g., 'bold')
   * @param fontStyle - CSS font style (e.g., 'italic')
   * @returns Font configuration for fontconfig (Linux/macOS) or file path (Windows)
   * @throws Error if platform detection fails
   */
  private resolveFontPath(
    fontFamily: string,
    fontWeight?: string,
    fontStyle?: string
  ):
    | { useFontconfig: true; fontName: string }
    | { useFontconfig: false; fontPath: string } {
    // Normalize font family name for comparison
    const normalizedFamily = fontFamily.toLowerCase().replace(/['"]/g, "");
    const isBold = fontWeight === "bold";
    const isItalic = fontStyle === "italic";

    // Detect platform using Electron API (reliable)
    const platform = window.electronAPI?.platform;
    if (!platform) {
      throw new Error(
        "Platform information not available. Ensure Electron API is initialized."
      );
    }
    const isWindows = platform === "win32";
    const isMac = platform === "darwin";
    const isLinux = platform === "linux";

    // For Linux and macOS, use fontconfig (font= parameter)
    // This lets the system resolve fonts - much more robust!
    if (isLinux || isMac) {
      // Map common fonts to system equivalents
      const fontNameMap: Record<string, string> = {
        "arial": isMac ? "Helvetica" : "Liberation Sans",
        "times new roman": isMac ? "Times" : "Liberation Serif",
        "courier new": isMac ? "Courier" : "Liberation Mono",
      };

      const fontName = fontNameMap[normalizedFamily] || normalizedFamily;

      // Build fontconfig style string
      const styles: string[] = [];
      if (isBold) styles.push("Bold");
      if (isItalic) styles.push("Italic");

      const styleString = styles.length > 0 ? `:style=${styles.join(" ")}` : "";

      return {
        useFontconfig: true,
        fontName: `${fontName}${styleString}`,
      };
    }

    // For Windows, use explicit font file paths
    // Windows doesn't have fontconfig, so we need absolute paths
    const fontBasePath = "C:/Windows/Fonts/";

    // Font file mapping for Windows
    const fontMap: Record<
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

    // Find matching font or default to Arial
    const fontConfig = fontMap[normalizedFamily] || fontMap.arial;

    // Select appropriate font variant
    let fontFile = fontConfig.regular;
    if (isBold && isItalic && fontConfig.boldItalic) {
      fontFile = fontConfig.boldItalic;
    } else if (isBold && fontConfig.bold) {
      fontFile = fontConfig.bold;
    } else if (isItalic && fontConfig.italic) {
      fontFile = fontConfig.italic;
    }

    // Return full path for Windows
    return {
      useFontconfig: false,
      fontPath: `${fontBasePath}${fontFile}`,
    };
  }

  /**
   * Convert a TextElement to FFmpeg drawtext filter string
   * Includes all positioning, styling, and timing parameters
   */
  private convertTextElementToDrawtext(element: TextElement): string {
    // Skip empty text elements
    if (!element.content || !element.content.trim()) {
      return "";
    }

    // Skip hidden elements
    if (element.hidden) {
      return "";
    }

    // Escape the text content for FFmpeg
    const escapedText = this.escapeTextForFFmpeg(element.content);

    // Get font configuration based on platform
    const fontConfig = this.resolveFontPath(
      element.fontFamily || "Arial",
      element.fontWeight,
      element.fontStyle
    );

    // Convert CSS color to FFmpeg format (remove # if present)
    let fontColor = element.color || "#ffffff";
    if (fontColor.startsWith("#")) {
      // Convert #RRGGBB to 0xRRGGBB format for FFmpeg
      fontColor = "0x" + fontColor.substring(1);
    }

    // Calculate actual display timing (accounting for trim)
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

    // Add font parameter (fontconfig on Linux/macOS, fontfile on Windows)
    if (fontConfig.useFontconfig) {
      // Linux/macOS: Use font= with fontconfig name
      // No escaping needed for font names
      filterParams.push(`font='${fontConfig.fontName}'`);
    } else {
      // Windows: Use fontfile= with escaped path
      const escapedFontPath = this.escapePathForFFmpeg(fontConfig.fontPath);
      filterParams.push(`fontfile=${escapedFontPath}`);
    }

    // Helper to format numeric offsets with explicit sign when positive
    const formatOffset = (value: number): string => {
      if (value === 0) return "";
      return value > 0 ? `+${value}` : `${value}`;
    };

    // Element x/y are relative to canvas center; convert to FFmpeg coordinates
    const xOffset = Math.round(element.x ?? 0);
    const yOffset = Math.round(element.y ?? 0);

    // Default to centered placement with offset
    const anchorXExpr = `w/2${formatOffset(xOffset)}`;
    let xExpr = `${anchorXExpr}-(text_w/2)`;
    const yExpr = `(h-text_h)/2${formatOffset(yOffset)}`;

    // Apply text alignment while preserving offsets
    if (element.textAlign === "left") {
      // Left-align: anchor left edge at canvas center + offset
      xExpr = `${anchorXExpr}`;
    } else if (element.textAlign === "center") {
      // Center-align: already centered; keep offset
      xExpr = `${anchorXExpr}-(text_w/2)`;
    } else if (element.textAlign === "right") {
      // Right-align: place right edge at canvas center + offset
      xExpr = `${anchorXExpr}-text_w`;
    }

    filterParams.push(`x=${xExpr}`);
    filterParams.push(`y=${yExpr}`);

    // Add text border for better readability
    filterParams.push("borderw=2");
    filterParams.push("bordercolor=black");

    // Handle opacity if not fully opaque
    if (element.opacity !== undefined && element.opacity < 1) {
      // FFmpeg uses alpha channel in range 0-255
      const alpha = Math.round(element.opacity * 255);
      filterParams.push(`alpha=${alpha}/255`);
    }

    // Handle rotation if present
    if (element.rotation && element.rotation !== 0) {
      // Convert degrees to radians for FFmpeg
      const radians = (element.rotation * Math.PI) / 180;
      filterParams.push(`angle=${radians}`);
    }

    // Background color if not transparent
    if (element.backgroundColor && element.backgroundColor !== "transparent") {
      let bgColor = element.backgroundColor;
      if (bgColor.startsWith("#")) {
        bgColor = "0x" + bgColor.substring(1);
      }
      filterParams.push("box=1");
      filterParams.push(`boxcolor=${bgColor}@0.5`);
      filterParams.push("boxborderw=5");
    }

    // Add timing - text only appears during its timeline duration
    filterParams.push(`enable='between(t,${startTime},${endTime})'`);

    // Combine all parameters into drawtext filter
    return `drawtext=${filterParams.join(":")}`;
  }

  /**
   * Build complete FFmpeg filter chain for all text overlays using drawtext filters.
   *
   * WHY FFmpeg drawtext is used instead of canvas rendering:
   * - Mode 2 optimization avoids frame-by-frame rendering
   * - Drawtext applies text directly during video encoding
   * - 3-5x faster than canvas text rendering
   *
   * Filter layering logic:
   * - Lower track index = rendered first (background)
   * - Higher track index = rendered last (foreground)
   * - Elements within track maintain timeline order
   * - Later filters in chain draw on top of earlier filters
   *
   * WHY sorting matters:
   * - FFmpeg processes filters sequentially
   * - Last filter appears on top visually
   * - Must match timeline track ordering for correct layering
   *
   * Edge cases handled:
   * - Hidden elements: Skipped entirely
   * - Empty text content: Filtered out
   * - No text elements: Returns empty string
   * - Special characters: Escaped in convertTextElementToDrawtext
   *
   * Performance implications:
   * - Each text element adds one drawtext filter
   * - 10 text elements = ~0.1s additional encoding time (negligible)
   * - Still much faster than frame rendering
   *
   * @returns Comma-separated FFmpeg drawtext filter chain
   */
  private buildTextOverlayFilters(): string {
    const textElementsWithOrder: Array<{
      element: TextElement;
      trackIndex: number;
      elementIndex: number;
    }> = [];

    // Iterate through all tracks to find text elements
    for (let trackIndex = 0; trackIndex < this.tracks.length; trackIndex++) {
      const track = this.tracks[trackIndex];

      // Only process text tracks
      if (track.type !== "text") {
        continue;
      }

      // Process each element in the track
      for (
        let elementIndex = 0;
        elementIndex < track.elements.length;
        elementIndex++
      ) {
        const element = track.elements[elementIndex];

        // Skip non-text elements (shouldn't happen on text track, but be safe)
        if (element.type !== "text") {
          continue;
        }

        // Skip hidden elements
        if (element.hidden) {
          continue;
        }

        // Collect text element with its order information
        textElementsWithOrder.push({
          element: element as TextElement,
          trackIndex,
          elementIndex,
        });
      }
    }

    // Sort by track order, then by element order within track for proper layering
    // WHY: In FFmpeg, later filters draw on top. Lower track index = background, higher = foreground.
    // Elements within the same track maintain their timeline order.
    textElementsWithOrder.sort((a, b) => {
      // First sort by track index (track rendering order)
      if (a.trackIndex !== b.trackIndex) {
        return a.trackIndex - b.trackIndex;
      }
      // If same track, sort by element index (order in track)
      return a.elementIndex - b.elementIndex;
    });

    // Convert each to drawtext filter
    const filters = textElementsWithOrder
      .map((item) => this.convertTextElementToDrawtext(item.element))
      .filter((f) => f !== "");

    // Join all filters with comma separator
    return filters.join(",");
  }

  // Note: getActiveElementsCLI method has been removed as part of Mode 3 removal.
  // It was only used by the removed Canvas rendering methods.

  /**
   * Extract video source paths from timeline for direct copy optimization
   */
  private extractVideoSources(): VideoSourceInput[] {
    const videoSources: VideoSourceInput[] = [];

    // Iterate through all tracks to find video elements
    this.tracks.forEach((track) => {
      if (track.type !== "media") return;

      track.elements.forEach((element) => {
        if (element.hidden) return;
        if (element.type !== "media") return;

        const mediaItem = this.mediaItems.find(
          (item) => item.id === (element as any).mediaId
        );
        if (!mediaItem || mediaItem.type !== "video") return;

        // Check if we have a local path (required for direct copy)
        if (!mediaItem.localPath) {
          debugWarn(
            `[CLIExportEngine] Video ${mediaItem.id} has no localPath, cannot use direct copy`
          );
          return;
        }

        videoSources.push({
          path: mediaItem.localPath,
          startTime: element.startTime,
          duration: element.duration,
          trimStart: element.trimStart,
          trimEnd: element.trimEnd,
        });
      });
    });

    // Sort by start time
    videoSources.sort((a, b) => a.startTime - b.startTime);

    debugLog(
      `[CLIExportEngine] Extracted ${videoSources.length} video sources for direct copy`
    );
    return videoSources;
  }

  /**
   * Extract single video input path for Mode 2 optimization.
   *
   * WHY Mode 2 exists:
   * - Avoids frame-by-frame rendering when only text/stickers are added
   * - FFmpeg can apply filters (drawtext, overlay) directly to video stream
   * - Results in 3-5x faster exports compared to frame rendering
   *
   * WHY this returns null:
   * - Multiple videos: Cannot use single video input (falls back to Mode 3)
   * - No localPath: Blob URLs cannot be read by FFmpeg CLI
   * - No videos: Nothing to optimize
   *
   * Performance impact:
   * - Success: Enables Mode 2 (~1-2s export time)
   * - Failure: Falls back to Mode 3 (~5-10s export time)
   *
   * @returns Video path and trim info if exactly one video exists, null otherwise
   */
  private extractVideoInputPath(): {
    path: string;
    trimStart: number;
    trimEnd: number;
  } | null {
    debugLog("[CLIExportEngine] Extracting video input path for Mode 2...");

    let videoElement: TimelineElement | null = null;
    let mediaItem: MediaItem | null = null;

    // Iterate through all tracks to find video elements
    for (const track of this.tracks) {
      if (track.type !== "media") continue;

      for (const element of track.elements) {
        if (element.hidden) continue;
        if (element.type !== "media") continue;

        const item = this.mediaItems.find(
          (m) => m.id === (element as any).mediaId
        );
        if (item && item.type === "video" && item.localPath) {
          if (videoElement) {
            // Multiple videos found, can't use single video input
            debugLog(
              "[CLIExportEngine] Multiple videos found, Mode 2 not applicable"
            );
            return null;
          }
          videoElement = element;
          mediaItem = item;
        }
      }
    }

    if (!videoElement || !mediaItem?.localPath) {
      debugLog("[CLIExportEngine] No video with localPath found");
      return null;
    }

    const result = {
      path: mediaItem.localPath,
      trimStart: videoElement.trimStart || 0,
      trimEnd: videoElement.trimEnd || 0,
    };

    debugLog(`[CLIExportEngine] Video input extracted: ${result.path}`);
    return result;
  }

  /**
   * Download sticker blob/data URL to temp directory for FFmpeg CLI access.
   *
   * WHY this is necessary:
   * - FFmpeg CLI cannot read blob: or data: URLs
   * - Stickers are often stored as blob URLs in browser memory
   * - Must convert to filesystem paths before FFmpeg can process them
   *
   * Edge cases handled:
   * - Already has localPath: Skip download, use existing file
   * - Blob fetch fails: Throw error to prevent corrupt exports
   * - Invalid format: Default to PNG format
   *
   * Performance note:
   * - Runs once per sticker during export preparation
   * - Uses temp directory that's cleaned up after export
   *
   * @param sticker - Sticker element from timeline
   * @param mediaItem - Associated media item with blob URL
   * @returns Filesystem path to downloaded sticker image
   * @throws Error if download fails or Electron API unavailable
   */
  private async downloadStickerToTemp(
    sticker: { id: string; [key: string]: unknown },
    mediaItem: MediaItem
  ): Promise<string> {
    debugLog(
      `[CLIExportEngine] Downloading sticker ${sticker.id} to temp directory`
    );

    try {
      // Check if already has local path
      if (mediaItem.localPath) {
        debugLog(
          `[CLIExportEngine] Using provided local path: ${mediaItem.localPath}`
        );
        return mediaItem.localPath;
      }

      // Fetch blob/data URL
      if (!mediaItem.url) {
        throw new Error(`No URL for sticker media item ${mediaItem.id}`);
      }

      const response = await fetch(mediaItem.url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch sticker: ${response.status} ${response.statusText}`
        );
      }

      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const imageBytes = new Uint8Array(arrayBuffer);

      // Determine format from blob type or default to png
      const format = blob.type?.split("/")[1] || "png";

      // Save via Electron IPC
      if (!window.electronAPI?.ffmpeg?.saveStickerForExport) {
        throw new Error("Electron API not available for sticker export");
      }

      if (!this.sessionId) {
        throw new Error("No active export session");
      }

      const result = await window.electronAPI.ffmpeg.saveStickerForExport({
        sessionId: this.sessionId,
        stickerId: sticker.id,
        imageData: imageBytes,
        format,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to save sticker");
      }

      debugLog(`[CLIExportEngine] Downloaded sticker to: ${result.path}`);
      return result.path!;
    } catch (error) {
      debugError(
        `[CLIExportEngine] Failed to download sticker ${sticker.id}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Extract sticker sources from overlay store for FFmpeg processing
   * Returns array of sticker data with local file paths
   */
  private async extractStickerSources(): Promise<StickerSourceForFilter[]> {
    debugLog("[CLIExportEngine] Extracting sticker sources for FFmpeg overlay");

    try {
      // Import stickers store dynamically
      const { useStickersOverlayStore } = await import(
        "@/stores/stickers-overlay-store"
      );
      const stickersStore = useStickersOverlayStore.getState();

      // Get all stickers for export
      const allStickers = stickersStore.getStickersForExport();

      if (allStickers.length === 0) {
        debugLog("[CLIExportEngine] No stickers to export");
        return [];
      }

      debugLog(
        `[CLIExportEngine] Processing ${allStickers.length} stickers for export`
      );

      const stickerSources: StickerSourceForFilter[] = [];

      // Process each sticker
      for (const sticker of allStickers) {
        try {
          // Find media item for this sticker
          const mediaItem = this.mediaItems.find(
            (m) => m.id === sticker.mediaItemId
          );

          if (!mediaItem) {
            debugWarn(
              `[CLIExportEngine] Media item not found for sticker ${sticker.id}`
            );
            continue;
          }

          // Download sticker to temp directory if needed
          const localPath = await this.downloadStickerToTemp(
            sticker,
            mediaItem
          );

          // Convert percentage positions to pixel coordinates
          // Note: FFmpeg overlay uses top-left corner, not center
          const pixelX = (sticker.position.x / 100) * this.canvas.width;
          const pixelY = (sticker.position.y / 100) * this.canvas.height;

          // Convert percentage size to pixels (using smaller dimension as base)
          const baseSize = Math.min(this.canvas.width, this.canvas.height);
          const pixelWidth = (sticker.size.width / 100) * baseSize;
          const pixelHeight = (sticker.size.height / 100) * baseSize;

          // Adjust for center-based positioning (sticker position is center, not top-left)
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
            endTime: sticker.timing?.endTime ?? this.totalDuration,
            zIndex: sticker.zIndex,
            opacity: sticker.opacity,
            rotation: sticker.rotation,
          });

          debugLog(
            `[CLIExportEngine] Processed sticker ${sticker.id}: ${pixelWidth}x${pixelHeight} at (${topLeftX}, ${topLeftY})`
          );
        } catch (error) {
          debugError(
            `[CLIExportEngine] Failed to process sticker ${sticker.id}:`,
            error
          );
        }
      }

      // Sort by zIndex for proper layering order
      stickerSources.sort((a, b) => a.zIndex - b.zIndex);

      debugLog(
        `[CLIExportEngine] Extracted ${stickerSources.length} valid sticker sources`
      );
      return stickerSources;
    } catch (error) {
      debugError("[CLIExportEngine] Failed to extract sticker sources:", error);
      return [];
    }
  }

  /**
   * Build FFmpeg overlay filter chain for stickers using complex filter graphs.
   *
   * WHY complex filters are needed:
   * - Each sticker is a separate input stream to FFmpeg
   * - Must scale, rotate, and overlay each sticker in sequence
   * - Timing constraints (enable) ensure stickers appear/disappear correctly
   *
   * Filter chain structure:
   * 1. Scale sticker to desired dimensions
   * 2. Apply rotation if needed (prevents edge clipping)
   * 3. Apply opacity using format+geq (alpha blending)
   * 4. Overlay on previous layer at specific position with timing
   *
   * Performance implications:
   * - More stickers = longer filter chain = slightly slower encoding
   * - Still much faster than frame-by-frame rendering (~1-2s total)
   *
   * Edge cases:
   * - Empty array: Returns empty string (no-op)
   * - Single sticker: Simple overlay without intermediate labels
   * - Opacity < 1: Requires format+geq filter for alpha channel
   *
   * @param stickerSources - Array of sticker data with position, size, timing
   * @returns FFmpeg complex filter chain string
   */
  private buildStickerOverlayFilters(
    stickerSources: StickerSourceForFilter[]
  ): string {
    if (!stickerSources || stickerSources.length === 0) {
      return "";
    }

    debugLog(
      `[CLIExportEngine] Building overlay filters for ${stickerSources.length} stickers`
    );

    // Build complex filter for multiple overlays
    // Input streams: [0] = base video, [1] = first sticker, [2] = second sticker, etc.

    const filters: string[] = [];
    let lastOutput = "0:v"; // Start with base video stream

    stickerSources.forEach((sticker, index) => {
      const inputIndex = index + 1; // Sticker inputs start at 1 (0 is base video)
      const outputLabel =
        index === stickerSources.length - 1 ? "" : `[v${index + 1}]`;

      // Scale sticker to desired size
      let currentInput = `[${inputIndex}:v]`;
      const scaleFilter = `${currentInput}scale=${sticker.width}:${sticker.height}[scaled${index}]`;
      filters.push(scaleFilter);
      currentInput = `[scaled${index}]`;

      // Apply rotation if needed (before opacity)
      if (sticker.rotation !== undefined && sticker.rotation !== 0) {
        const rotateFilter = `${currentInput}rotate=${sticker.rotation}*PI/180:c=none[rotated${index}]`;
        filters.push(rotateFilter);
        currentInput = `[rotated${index}]`;
      }

      // Build overlay filter with timing
      const overlayParams = [`x=${sticker.x}`, `y=${sticker.y}`];

      // Add timing constraint
      if (sticker.startTime !== 0 || sticker.endTime !== this.totalDuration) {
        overlayParams.push(
          `enable='between(t,${sticker.startTime},${sticker.endTime})'`
        );
      }

      // Add opacity if not fully opaque
      if (sticker.opacity !== undefined && sticker.opacity < 1) {
        // Apply opacity using format and geq filters before overlay
        const opacityFilter = `${currentInput}format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${sticker.opacity}*alpha(X,Y)'[alpha${index}]`;
        filters.push(opacityFilter);

        // Update overlay to use opacity-adjusted input
        const overlayFilter = `[${lastOutput}][alpha${index}]overlay=${overlayParams.join(":")}${outputLabel}`;
        filters.push(overlayFilter);
      } else {
        // Direct overlay without opacity adjustment
        const overlayFilter = `[${lastOutput}]${currentInput}overlay=${overlayParams.join(":")}${outputLabel}`;
        filters.push(overlayFilter);
      }

      // Update last output for chaining
      if (outputLabel) {
        lastOutput = outputLabel.replace("[", "").replace("]", "");
      }
    });

    const filterChain = filters.join(";");
    debugLog(
      `[CLIExportEngine] Generated sticker filter chain: ${filterChain}`
    );

    return filterChain;
  }

  private async prepareAudioFiles(): Promise<AudioFileInput[]> {
    const results: AudioFileInput[] = [];
    const { useTimelineStore } = await import("@/stores/timeline-store");
    const { useMediaStore } = await import("@/stores/media-store");

    const audioElements = useTimelineStore.getState().getAudioElements();
    const concurrency = 4;
    const queue = [...audioElements];
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const audioElement = queue.shift()!;
        const mediaItem = useMediaStore
          .getState()
          .mediaItems.find(
            (m) => m.id === (audioElement.element as any).mediaId
          );
        if (!mediaItem?.url) {
          continue;
        }
        try {
          const response = await fetch(mediaItem.url);
          if (!response.ok) {
            debugWarn(
              `[CLIExportEngine] Failed to fetch audio: ${mediaItem.name}`
            );
            continue;
          }
          const arrayBuffer = await response.arrayBuffer();
          const guessExt = () => {
            const fromName = mediaItem.name.split(".").pop();
            if (fromName && fromName.length <= 5) return fromName.toLowerCase();
            // basic mime fallback
            const mt = (mediaItem as any).file?.type as string | undefined;
            if (mt?.includes("wav")) return "wav";
            if (mt?.includes("mpeg")) return "mp3";
            if (mt?.includes("ogg")) return "ogg";
            return "mp3";
          };
          const ext = guessExt();
          const filename = `audio_${this.sessionId}_${(audioElement.element as any).id}.${ext}`;
          const result = await window.electronAPI?.invoke(
            "save-audio-for-export",
            {
              audioData: arrayBuffer,
              filename,
            }
          );
          if (result?.success) {
            results.push({
              path: result.path,
              startTime: audioElement.absoluteStart ?? 0,
              volume: (audioElement.element as any).volume ?? 1.0,
            });
            debugLog(
              `[CLIExportEngine] Prepared audio file: ${filename} at ${audioElement.absoluteStart}s`
            );
          } else {
            debugWarn(
              `[CLIExportEngine] Failed to save audio file: ${result?.error}`
            );
          }
        } catch (error) {
          debugError("[CLIExportEngine] Error preparing audio file:", error);
        }
      }
    });
    await Promise.all(workers);

    debugLog(
      `[CLIExportEngine] Prepared ${results.length} audio files for export`
    );
    return results;
  }

  /**
   * Main export entry point - analyzes timeline and selects optimal export mode.
   *
   * Three export modes (automatic selection):
   *
   * **Mode 1 - Direct Copy** (15-48x faster):
   * - Single or sequential videos with NO overlays
   * - FFmpeg concat demuxer (no re-encoding)
   * - Time: ~0.1-0.5s
   *
   * **Mode 2 - Direct Video + Filters** (3-5x faster):
   * - Single video WITH text/stickers
   * - FFmpeg filters applied to video stream
   * - Time: ~1-2s
   *
   * **Mode 3 - Frame Rendering** (baseline):
   * - Images, overlapping videos, or unsupported cases
   * - Canvas compositing + FFmpeg encoding
   * - Time: ~5-10s
   *
   * WHY automatic selection matters:
   * - Wrong mode = 5-10x slower exports
   * - Mode detection prevents unnecessary frame rendering
   * - Graceful fallbacks ensure exports always succeed
   *
   * Edge cases handled:
   * - Feature flag to force Mode 3 (for testing)
   * - Optimization failure: Falls back to Mode 3
   * - Missing localPath: Cannot use Modes 1 or 2
   *
   * Performance impact:
   * - Optimal mode selection can reduce export time from 10s to 0.5s
   *
   * @param progressCallback - Optional callback for progress updates (0-100)
   * @returns Blob containing the exported video file (MP4)
   * @throws Error if export fails or Electron environment unavailable
   */
  async export(progressCallback?: ProgressCallback): Promise<Blob> {
    debugLog("[CLIExportEngine] Starting CLI export...");

    // Log original timeline duration
    debugLog(
      `[CLIExportEngine] 📏 Original timeline duration: ${this.totalDuration.toFixed(3)}s`
    );
    debugLog(
      `[CLIExportEngine] 🎬 Target frames: ${this.calculateTotalFrames()} frames at 30fps`
    );

    // Create export session
    progressCallback?.(5, "Setting up export session...");
    const session = await this.createExportSession();
    this.sessionId = session.sessionId;
    this.frameDir = session.frameDir;

    // Analyze timeline to determine optimization strategy
    // Note: This will throw ExportUnsupportedError for unsupported configurations
    // (images, overlapping videos, blob URLs without local paths)
    debugLog(
      "[CLIExportEngine] 🔍 Analyzing timeline for export optimization..."
    );
    this.exportAnalysis = analyzeTimelineForExport(
      this.tracks,
      this.mediaItems
    );

    debugLog("[CLIExportEngine] 📊 Export Analysis:", this.exportAnalysis);

    try {
      // Pre-load videos (our optimization)
      progressCallback?.(10, "Pre-loading videos...");
      await this.preloadAllVideos();

      // Determine export mode based on analysis
      // Note: Mode 3 (image-pipeline) has been removed - unsupported cases now throw errors
      const canUseMode2 =
        this.exportAnalysis?.optimizationStrategy ===
        "direct-video-with-filters";
      const videoInput = canUseMode2 ? this.extractVideoInputPath() : null;

      // All supported modes skip frame rendering (Mode 1, 1.5, 2)
      if (videoInput) {
        // Mode 2: Direct video input with filters
        debugLog(
          "[CLIExportEngine] ⚡ MODE 2: Using direct video input with filters"
        );
        debugLog(`[CLIExportEngine] Video path: ${videoInput.path}`);
        debugLog(
          `[CLIExportEngine] Trim: ${videoInput.trimStart}s - ${videoInput.trimEnd}s`
        );
        progressCallback?.(15, "Preparing video with filters...");
      } else if (this.exportAnalysis?.canUseDirectCopy) {
        // Mode 1: Direct copy
        debugLog("[CLIExportEngine] ⚡ MODE 1: Using direct video copy");
        debugLog(
          `[CLIExportEngine] Optimization: ${this.exportAnalysis?.optimizationStrategy}`
        );
        progressCallback?.(15, "Preparing direct video copy...");
      } else if (
        this.exportAnalysis?.optimizationStrategy === "video-normalization"
      ) {
        // Mode 1.5: Video normalization
        debugLog("[CLIExportEngine] ⚡ MODE 1.5: Using video normalization");
        progressCallback?.(15, "Preparing video normalization...");
      }

      // Export with FFmpeg CLI
      progressCallback?.(85, "Encoding with FFmpeg CLI...");
      const outputFile = await this.exportWithCLI(progressCallback);

      // Read result and cleanup
      progressCallback?.(95, "Reading output...");
      const videoBlob = await this.readOutputFile(outputFile);

      // Log exported video information
      debugLog(
        `[CLIExportEngine] 📦 Exported video size: ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`
      );
      debugLog(`[CLIExportEngine] 🔗 Blob type: ${videoBlob.type}`);

      // Calculate and log expected vs actual video duration
      const expectedDuration = this.totalDuration;
      const actualFramesRendered = this.calculateTotalFrames();
      const calculatedDuration = actualFramesRendered / 30; // 30fps

      debugLog(
        `[CLIExportEngine] ⏱️  Expected duration: ${expectedDuration.toFixed(3)}s`
      );
      debugLog(
        `[CLIExportEngine] ⏱️  Calculated duration: ${calculatedDuration.toFixed(3)}s (${actualFramesRendered} frames / 30fps)`
      );
      debugLog(
        `[CLIExportEngine] 📊 Duration ratio: ${(calculatedDuration / expectedDuration).toFixed(3)}x`
      );

      // Try to get actual video duration from blob
      this.logActualVideoDurationCLI(videoBlob);

      progressCallback?.(100, "Export completed!");
      return videoBlob;
    } finally {
      // DEBUG MODE: Set to false to enable automatic cleanup after export
      const DEBUG_MODE = true; // Keep frames for inspection

      if (DEBUG_MODE) {
        // For debugging: don't cleanup temp files so we can inspect frames
        debugLog(
          "[CLIExportEngine] 🔍 DEBUG MODE ENABLED: Keeping frames in temp directory for inspection"
        );
        debugLog(
          `[CLIExportEngine] 📁 Frames location: ${this.frameDir}\\frames`
        );
        debugLog(
          "[CLIExportEngine] 🧪 TEST: Try this FFmpeg command manually:"
        );
        (async () => {
          // get the ffmpeg path from main process (works in dev & packaged)
          if (window.electronAPI?.ffmpeg?.getPath) {
            const ffmpegPath = await window.electronAPI.ffmpeg.getPath();
            const framesDir = `${this.frameDir}\\frames`;
            const duration = Math.ceil(this.totalDuration);
            debugLog(
              `"${ffmpegPath}" -y -framerate ${this.fps}` +
                ` -i "${framesDir}\\frame-%04d.png" -c:v libx264` +
                ` -preset fast -crf 23 -t ${duration} "output.mp4"`
            );
          }
        })();

        debugLog(
          "[CLIExportEngine] ⚠️ NOTE: Frames will NOT be deleted. Set DEBUG_MODE=false to enable cleanup."
        );
      } else {
        // Clean up temporary files including audio when not in debug mode
        debugLog("[CLIExportEngine] 🧹 Cleaning up temporary files...");
        if (this.sessionId) {
          await this.cleanup();
        }
      }
    }
  }

  private async createExportSession() {
    // Use existing Electron API structure
    if (!window.electronAPI) {
      throw new Error("CLI export only available in Electron");
    }

    const session = await window.electronAPI.ffmpeg.createExportSession();
    return session;
  }

  // Note: renderFramesToDisk and saveFrameToDisk methods have been removed
  // as part of Mode 3 removal. All exports now use FFmpeg directly without
  // frame-by-frame Canvas rendering.

  private async exportWithCLI(
    progressCallback?: ProgressCallback
  ): Promise<string> {
    if (!window.electronAPI) {
      throw new Error("CLI export only available in Electron");
    }

    // Progress: 5% - Preparing audio files
    progressCallback?.(5, "Preparing audio files...");

    // Prepare audio files for FFmpeg
    let audioFiles = await this.prepareAudioFiles();

    // audioFiles can be validated and filtered here if needed
    // e.g., audioFiles = audioFiles.filter(validateAudioFile);

    debugLog(`[CLI] Prepared ${audioFiles.length} audio files for export`);

    // Progress: 10% - Starting video compilation
    progressCallback?.(10, "Starting video compilation...");

    // Log initial audio files before validation
    debugLog(`[CLI Export] Initial audio files count: ${audioFiles.length}`);
    // Force detailed logging of audio files
    for (const [index, audioFile] of audioFiles.entries()) {
      debugLog(`[CLI Export] Audio file ${index}:`, {
        path: audioFile.path,
        startTime: audioFile.startTime,
        volume: audioFile.volume,
        isBlob: audioFile.path?.startsWith("blob:"),
        isData: audioFile.path?.startsWith("data:"),
        pathType: typeof audioFile.path,
        pathLength: audioFile.path?.length,
      });
      debugLog(`[CLI Export] Audio file ${index} raw path:`, audioFile.path);
    }

    // Validate audio files in parallel before sending to FFmpeg
    debugLog("[CLI Export] Starting parallel validation of audio files...");

    const validationResults = await Promise.all(
      audioFiles.map(async (audioFile, index) => {
        debugLog(
          `[CLI Export] Validating audio file ${index}: ${audioFile.path}`
        );

        try {
          // Check if file exists
          const exists = await window.electronAPI?.invoke(
            "file-exists",
            audioFile.path
          );
          debugLog(`[CLI Export] Audio file ${index} exists: ${exists}`);

          if (!exists) {
            const error = `Audio file does not exist: ${audioFile.path}`;
            debugError(`[CLI Export] ${error}`);
            throw new Error(error);
          }

          // Check file size to ensure it's not empty/corrupted
          const fileInfo = await window.electronAPI?.invoke(
            "get-file-info",
            audioFile.path
          );
          debugLog(
            `[CLI Export] Audio file ${index} size: ${fileInfo.size} bytes`
          );

          if (fileInfo.size === 0) {
            const error = `Audio file is empty: ${audioFile.path}`;
            debugError(`[CLI Export] ${error}`);
            throw new Error(error);
          }

          // Validate audio file format with ffprobe
          debugLog(
            `[CLI Export] Validating audio file ${index} format with ffprobe...`
          );

          try {
            const audioValidation = await window.electronAPI?.invoke(
              "validate-audio-file",
              audioFile.path
            );
            debugLog(
              `[CLI Export] Audio file ${index} validation result:`,
              audioValidation
            );

            if (!audioValidation.valid) {
              const error = `Invalid audio file format: ${audioFile.path} - ${audioValidation.error}`;
              debugError(`[CLI Export] ${error}`);
              throw new Error(error);
            }

            debugLog(
              `[CLI Export] Audio file ${index} validated successfully:`,
              {
                path: audioFile.path,
                hasAudio: audioValidation.hasAudio,
                duration: audioValidation.duration,
                streams: audioValidation.info?.streams?.length || 0,
              }
            );

            // Skip files that have no audio streams
            if (!audioValidation.hasAudio) {
              debugWarn(
                `[CLI Export] File has no audio streams: ${audioFile.path}`
              );
              return null; // Mark for filtering
            }

            return audioFile; // Valid audio file
          } catch (validationError) {
            // Log validation error but continue with the file
            debugError(
              "[CLI Export] Audio validation failed:",
              validationError
            );
            debugLog(
              "[CLI Export] Including file despite validation failure..."
            );
            return audioFile; // Keep the file despite ffprobe failure
          }
        } catch (error) {
          debugError(
            `[CLI Export] Failed to validate audio file ${index}:`,
            error
          );
          throw new Error(`Failed to validate audio file: ${audioFile.path}`);
        }
      })
    );

    // Filter out null values (files with no audio streams)
    audioFiles = validationResults.filter(
      (file): file is (typeof audioFiles)[0] => file !== null
    );

    debugLog(
      `[CLI Export] Validation complete. ${audioFiles.length} valid audio files.`
    );

    // Collect all filter chains for timeline elements
    const elementFilterChains = new Map<string, string>();

    this.tracks.forEach((track) => {
      track.elements.forEach((element) => {
        if (this.effectsStore) {
          const filterChain = this.effectsStore.getFFmpegFilterChain(
            element.id
          );
          if (filterChain) {
            elementFilterChains.set(element.id, filterChain);
          }
        }
      });
    });

    // Combine all filter chains (simplified - assumes single video element)
    const combinedFilterChain = Array.from(elementFilterChains.values()).join(
      ","
    );

    // Build text overlay filter chain for FFmpeg drawtext
    console.log(
      "🔍 [TEXT EXPORT DEBUG] Starting text filter chain generation..."
    );
    const textFilterChain = this.buildTextOverlayFilters();
    if (textFilterChain) {
      console.log(
        "✅ [TEXT EXPORT DEBUG] Text filter chain generated successfully"
      );
      console.log(
        `📊 [TEXT EXPORT DEBUG] Text filter chain: ${textFilterChain}`
      );
      console.log(
        `📈 [TEXT EXPORT DEBUG] Text element count: ${(textFilterChain.match(/drawtext=/g) || []).length}`
      );
      console.log(
        "🎯 [TEXT EXPORT DEBUG] Text will be rendered by FFmpeg CLI (not canvas)"
      );
      debugLog(`[CLI Export] Text filter chain generated: ${textFilterChain}`);
      debugLog(
        `[CLI Export] Text filter count: ${(textFilterChain.match(/drawtext=/g) || []).length}`
      );
    } else {
      console.log("ℹ️ [TEXT EXPORT DEBUG] No text elements found in timeline");
    }

    // ADD: Extract and build sticker overlays
    // IMPORTANT: Always extract stickers if they exist, regardless of direct copy mode
    let stickerFilterChain: string | undefined;
    let stickerSources: StickerSourceForFilter[] = [];

    try {
      // Extract sticker sources with local file paths (always check for stickers)
      stickerSources = await this.extractStickerSources();

      if (stickerSources.length > 0) {
        // Build FFmpeg overlay filter chain
        stickerFilterChain = this.buildStickerOverlayFilters(stickerSources);

        debugLog(`[CLI Export] Sticker sources: ${stickerSources.length}`);
        debugLog(`[CLI Export] Sticker filter chain: ${stickerFilterChain}`);
      }
    } catch (error) {
      debugWarn(
        "[CLI Export] Failed to process stickers, continuing without:",
        error
      );
      // Continue export without stickers if processing fails
      stickerSources = [];
      stickerFilterChain = undefined;
    }

    // Extract video sources for direct copy optimization
    // IMPORTANT: Disable direct copy if we have text filters OR sticker filters
    const hasTextFilters = textFilterChain.length > 0;
    const hasStickerFilters = (stickerFilterChain?.length ?? 0) > 0;

    // Determine which mode to use and extract appropriate video info
    const canUseMode2 =
      this.exportAnalysis?.optimizationStrategy === "direct-video-with-filters";
    const videoInput = canUseMode2 ? this.extractVideoInputPath() : null;

    // Log Mode 2 detection result
    if (canUseMode2 && videoInput) {
      console.log(
        "⚡ [MODE 2 EXPORT] ============================================"
      );
      console.log("⚡ [MODE 2 EXPORT] Mode 2 optimization enabled!");
      console.log(`⚡ [MODE 2 EXPORT] Video input: ${videoInput.path}`);
      console.log(`⚡ [MODE 2 EXPORT] Trim start: ${videoInput.trimStart}s`);
      console.log(`⚡ [MODE 2 EXPORT] Trim end: ${videoInput.trimEnd}s`);
      console.log(
        `⚡ [MODE 2 EXPORT] Text filters: ${hasTextFilters ? "YES" : "NO"}`
      );
      console.log(
        `⚡ [MODE 2 EXPORT] Sticker filters: ${hasStickerFilters ? "YES" : "NO"}`
      );
      console.log(
        "⚡ [MODE 2 EXPORT] Frame rendering: SKIPPED (using direct video)"
      );
      console.log(
        "⚡ [MODE 2 EXPORT] Expected speedup: 3-5x faster than frame rendering"
      );
      console.log(
        "⚡ [MODE 2 EXPORT] ============================================"
      );
    } else if (canUseMode2 && !videoInput) {
      console.log(
        "⚠️ [MODE 2 EXPORT] Mode 2 requested but video input extraction failed"
      );
      console.log("⚠️ [MODE 2 EXPORT] Falling back to standard export");
    }

    const videoSources =
      this.exportAnalysis?.canUseDirectCopy &&
      !hasTextFilters &&
      !hasStickerFilters
        ? this.extractVideoSources()
        : [];

    // Build options AFTER validation so the filtered list is sent
    if (!this.sessionId) {
      throw new Error("No active session ID");
    }
    const exportOptions = {
      sessionId: this.sessionId,
      width: this.canvas.width,
      height: this.canvas.height,
      fps: 30,
      quality: this.settings.quality || "medium",
      duration: this.totalDuration, // CRITICAL: Pass timeline duration to FFmpeg
      audioFiles, // Now contains only validated audio files
      filterChain: combinedFilterChain || undefined,
      textFilterChain: hasTextFilters ? textFilterChain : undefined, // Add text filter chain
      stickerFilterChain, // ADD THIS
      stickerSources, // ADD THIS
      useDirectCopy: !!(
        this.exportAnalysis?.canUseDirectCopy &&
        !hasTextFilters &&
        !hasStickerFilters
      ), // Disable direct copy when text or stickers present
      videoSources: videoSources.length > 0 ? videoSources : undefined,
      // Mode 2: Direct video input with filters
      useVideoInput: !!videoInput,
      videoInputPath: videoInput?.path,
      trimStart: videoInput?.trimStart || 0,
      trimEnd: videoInput?.trimEnd || 0,
      // Mode 1.5: Video normalization
      optimizationStrategy: this.exportAnalysis?.optimizationStrategy,
    };

    console.log(
      "🚀 [FFMPEG EXPORT DEBUG] ============================================"
    );
    console.log("🚀 [FFMPEG EXPORT DEBUG] Starting FFmpeg CLI export process");
    console.log("🚀 [FFMPEG EXPORT DEBUG] Export configuration:");
    console.log(`   - Session ID: ${exportOptions.sessionId}`);
    console.log(
      `   - Dimensions: ${exportOptions.width}x${exportOptions.height}`
    );
    console.log(`   - FPS: ${exportOptions.fps}`);
    console.log(`   - Duration: ${exportOptions.duration}s`);
    console.log(`   - Quality: ${exportOptions.quality}`);
    console.log(`   - Audio files: ${exportOptions.audioFiles?.length || 0}`);
    console.log(
      `   - Text elements: ${hasTextFilters ? "YES (using FFmpeg drawtext)" : "NO"}`
    );
    console.log(
      `   - Sticker overlays: ${hasStickerFilters ? `YES (${stickerSources.length} stickers)` : "NO"}`
    );
    console.log(
      `   - Direct copy mode: ${exportOptions.useDirectCopy ? "ENABLED" : "DISABLED"}`
    );
    console.log(
      `   - Video sources: ${exportOptions.videoSources?.length || 0}`
    );
    if (hasTextFilters) {
      console.log(
        "📝 [TEXT RENDERING] Text will be rendered directly by FFmpeg (not canvas)"
      );
      console.log(
        `📝 [TEXT RENDERING] Text filter chain length: ${textFilterChain.length} characters`
      );
    }
    console.log(
      "🚀 [FFMPEG EXPORT DEBUG] ============================================"
    );

    debugLog(
      "[CLI Export] Starting FFmpeg export with options:",
      exportOptions
    );

    // Note: Progress updates would need to be added to electronAPI
    // For now, use basic invoke without progress tracking

    try {
      console.log("⏳ [FFMPEG EXPORT DEBUG] Invoking FFmpeg CLI...");
      const startTime = Date.now();

      const result =
        await window.electronAPI.ffmpeg.exportVideoCLI(exportOptions);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(
        `✅ [FFMPEG EXPORT DEBUG] FFmpeg export completed in ${duration}s`
      );
      console.log(
        "✅ [EXPORT OPTIMIZATION] FFmpeg export completed successfully!"
      );
      debugLog("[CLI Export] FFmpeg export completed successfully:", result);
      return result.outputFile;
    } catch (error) {
      console.error("❌ [EXPORT OPTIMIZATION] FFmpeg export FAILED!", error);
      console.error(
        "❌ [EXPORT OPTIMIZATION] Error message:",
        error instanceof Error ? error.message : String(error)
      );
      console.error("❌ [EXPORT OPTIMIZATION] Error details:", {
        message: error instanceof Error ? error.message : String(error),
        code: (error as any)?.code,
        stderr: (error as any)?.stderr,
        stdout: (error as any)?.stdout,
      });
      debugError("[CLI Export] FFmpeg export failed:", error);
      debugError("[CLI Export] Error details:", {
        message: error instanceof Error ? error.message : String(error),
        code: (error as any)?.code,
        stderr: (error as any)?.stderr,
        stdout: (error as any)?.stdout,
      });
      throw error;
    }
  }

  private async readOutputFile(outputPath: string): Promise<Blob> {
    if (!window.electronAPI) {
      throw new Error("CLI export only available in Electron");
    }
    const buffer = await window.electronAPI.ffmpeg.readOutputFile(outputPath);
    return new Blob([buffer as unknown as ArrayBuffer], { type: "video/mp4" });
  }

  calculateTotalFrames(): number {
    return Math.ceil(this.totalDuration * 30); // 30 fps
  }

  // Get actual video duration from blob for debugging (CLI version)
  private logActualVideoDurationCLI(videoBlob: Blob): void {
    const video = document.createElement("video");
    const url = URL.createObjectURL(videoBlob);

    video.onloadedmetadata = () => {
      const actualDuration = video.duration;
      const expectedDuration = this.totalDuration;

      debugLog(
        `[CLIExportEngine] 🎥 Actual video duration: ${actualDuration.toFixed(3)}s`
      );
      debugLog(
        `[CLIExportEngine] 📈 Timeline vs Video ratio: ${(actualDuration / expectedDuration).toFixed(3)}x`
      );

      if (Math.abs(actualDuration - expectedDuration) > 0.1) {
        debugWarn(
          `[CLIExportEngine] ⚠️  Duration mismatch detected! Expected: ${expectedDuration.toFixed(3)}s, Got: ${actualDuration.toFixed(3)}s`
        );
      } else {
        debugLog("[CLIExportEngine] ✅ Duration match within tolerance");
      }

      // Cleanup
      URL.revokeObjectURL(url);
    };

    video.onerror = () => {
      debugWarn(
        "[CLIExportEngine] ⚠️  Could not determine actual video duration"
      );
      URL.revokeObjectURL(url);
    };

    video.src = url;
  }

  /**
   * Clean up temporary files for this export session
   */
  private async cleanup(): Promise<void> {
    if (!window.electronAPI || !this.sessionId) {
      return;
    }

    try {
      await window.electronAPI.ffmpeg.cleanupExportSession(this.sessionId);
      debugLog(
        `[CLIExportEngine] 🧹 Cleaned up export session: ${this.sessionId}`
      );
    } catch (error) {
      debugWarn(
        `[CLIExportEngine] ⚠️  Failed to cleanup session ${this.sessionId}:`,
        error
      );
    }
  }
}
