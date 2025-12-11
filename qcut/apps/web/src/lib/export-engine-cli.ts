import { ExportEngine } from "./export-engine";
import { ExportSettings } from "@/types/export";
import { TimelineTrack, TimelineElement } from "@/types/timeline";
import { MediaItem } from "@/stores/media-store";
import { debugLog, debugError, debugWarn } from "@/lib/debug-config";
import { useEffectsStore } from "@/stores/effects-store";
import {
  analyzeTimelineForExport,
  type ExportAnalysis,
} from "./export-analysis";

// Import extracted modules
import type {
  VideoSourceInput,
  AudioFileInput,
  StickerSourceForFilter,
  ProgressCallback,
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

    // 🚨 SAFETY CHECK: Verify Electron environment
    if (
      !window.electronAPI ||
      !window.electronAPI.ffmpeg ||
      typeof window.electronAPI.ffmpeg.exportVideoCLI !== "function"
    ) {
      throw new Error("CLI Export Engine requires Electron environment");
    }
  }

  // Note: Filter building and source extraction methods have been moved to export-cli/ module.
  // - Text/path escaping: export-cli/filters/text-escape.ts
  // - Font resolution: export-cli/filters/font-resolver.ts
  // - Text overlay filters: export-cli/filters/text-overlay.ts
  // - Sticker overlay filters: export-cli/filters/sticker-overlay.ts
  // - Video source extraction: export-cli/sources/video-sources.ts
  // - Sticker source extraction: export-cli/sources/sticker-sources.ts

  /**
   * Build text overlay filters using extracted module.
   * Wrapper that passes tracks to the extracted function.
   */
  private buildTextOverlayFiltersWrapper(): string {
    return buildTextOverlayFilters(this.tracks);
  }

  /**
   * Build sticker overlay filters using extracted module.
   * Wrapper that passes totalDuration to the extracted function.
   */
  private buildStickerOverlayFiltersWrapper(
    stickerSources: StickerSourceForFilter[]
  ): string {
    return buildStickerOverlayFilters(
      stickerSources,
      this.totalDuration,
      debugLog
    );
  }

  /**
   * Extract video sources using extracted module.
   * Wrapper that passes instance properties.
   */
  private async extractVideoSourcesWrapper(): Promise<VideoSourceInput[]> {
    return extractVideoSources(
      this.tracks,
      this.mediaItems,
      this.sessionId,
      undefined, // Use default API
      debugLog
    );
  }

  /**
   * Extract single video input path using extracted module.
   * Wrapper that passes instance properties.
   */
  private async extractVideoInputPathWrapper(): Promise<{
    path: string;
    trimStart: number;
    trimEnd: number;
  } | null> {
    return extractVideoInputPath(
      this.tracks,
      this.mediaItems,
      this.sessionId,
      undefined, // Use default API
      debugLog
    );
  }

  /**
   * Extract sticker sources using extracted module.
   * Wrapper that passes instance properties.
   */
  private async extractStickerSourcesWrapper(): Promise<
    StickerSourceForFilter[]
  > {
    return extractStickerSources(
      this.mediaItems,
      this.sessionId,
      this.canvas.width,
      this.canvas.height,
      this.totalDuration,
      undefined, // Use default store getter
      undefined, // Use default API
      debugLog
    );
  }

  // Note: getActiveElementsCLI method has been removed as part of Mode 3 removal.
  // It was only used by the removed Canvas rendering methods.

  // Note: The following methods were extracted to export-cli/ module:
  // - escapeTextForFFmpeg -> export-cli/filters/text-escape.ts
  // - escapePathForFFmpeg -> export-cli/filters/text-escape.ts
  // - resolveFontPath -> export-cli/filters/font-resolver.ts
  // - convertTextElementToDrawtext -> export-cli/filters/text-overlay.ts
  // - buildTextOverlayFilters -> export-cli/filters/text-overlay.ts (now uses wrapper)
  // - extractVideoSources -> export-cli/sources/video-sources.ts (now uses wrapper)
  // - extractVideoInputPath -> export-cli/sources/video-sources.ts (now uses wrapper)
  // - downloadStickerToTemp -> export-cli/sources/sticker-sources.ts
  // - extractStickerSources -> export-cli/sources/sticker-sources.ts (now uses wrapper)
  // - buildStickerOverlayFilters -> export-cli/filters/sticker-overlay.ts (now uses wrapper)

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
      const videoInput: {
        path: string;
        trimStart: number;
        trimEnd: number;
      } | null = canUseMode2 ? await this.extractVideoInputPathWrapper() : null;

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
    const textFilterChain = this.buildTextOverlayFiltersWrapper();
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
      stickerSources = await this.extractStickerSourcesWrapper();

      if (stickerSources.length > 0) {
        // Build FFmpeg overlay filter chain
        stickerFilterChain =
          this.buildStickerOverlayFiltersWrapper(stickerSources);

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
    const videoInput: {
      path: string;
      trimStart: number;
      trimEnd: number;
    } | null = canUseMode2 ? await this.extractVideoInputPathWrapper() : null;

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

    const shouldExtractVideoSources =
      this.exportAnalysis?.optimizationStrategy === "video-normalization" ||
      (this.exportAnalysis?.canUseDirectCopy &&
        !hasTextFilters &&
        !hasStickerFilters);

    const videoSources: VideoSourceInput[] = shouldExtractVideoSources
      ? await this.extractVideoSourcesWrapper()
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
        this.exportAnalysis?.optimizationStrategy !== "video-normalization" &&
        !hasTextFilters &&
        !hasStickerFilters
      ), // Disable direct copy when text, stickers, or video-normalization mode
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
