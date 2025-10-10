import { ExportEngine } from "./export-engine";
import { ExportSettings } from "@/types/export";
import { TimelineTrack, TimelineElement } from "@/types/timeline";
import { MediaItem } from "@/stores/media-store";
import { debugLog, debugError, debugWarn } from "@/lib/debug-config";
import { useEffectsStore } from "@/stores/effects-store";
import { analyzeTimelineForExport, type ExportAnalysis } from './export-analysis';

type EffectsStore = ReturnType<typeof useEffectsStore.getState>;

// Module-level cached dynamic imports to avoid per-frame overhead
let stickersModulePromise: Promise<
  typeof import("@/stores/stickers-overlay-store")
> | null = null;
let mediaModulePromise: Promise<typeof import("@/stores/media-store")> | null =
  null;
let stickerHelperModulePromise: Promise<
  typeof import("@/lib/stickers/sticker-export-helper")
> | null = null;

export type ProgressCallback = (progress: number, message: string) => void;

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

  // Override parent's renderFrame to skip video validation issues
  async renderFrame(currentTime: number): Promise<void> {
    debugLog(
      `[CLI_FRAME_DEBUG] Rendering frame at time ${currentTime.toFixed(3)}s`
    );

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Fill with background color (black for now)
    this.ctx.fillStyle = "#000000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const activeElements = this.getActiveElementsCLI(currentTime);

    // Only log every 30 frames (1 second) to reduce spam
    if (Math.round(currentTime * 30) % 30 === 0) {
      const elementTypes = activeElements.map((el) => el.element.type);
      debugLog(
        `📊 Frame ${currentTime.toFixed(1)}s: ${activeElements.length} elements: ${elementTypes.join(", ")}`
      );
    }

    // Sort elements by track type (render bottom to top)
    const sortedElements = activeElements.sort((a, b) => {
      // Text tracks on top
      if (a.track.type === "text" && b.track.type !== "text") return 1;
      if (b.track.type === "text" && a.track.type !== "text") return -1;
      // Audio tracks at bottom
      if (a.track.type === "audio" && b.track.type !== "audio") return -1;
      if (b.track.type === "audio" && a.track.type !== "audio") return 1;
      return 0;
    });

    // Render each active element WITHOUT validation
    for (const { element, mediaItem } of sortedElements) {
      await this.renderElementCLI(element, mediaItem, currentTime);
    }

    // CRITICAL: Render overlay stickers (separate from timeline elements)
    // Use the parent class's renderOverlayStickers method
    debugLog(
      `[CLI_OVERLAY_STICKERS] Calling parent renderOverlayStickers at time ${currentTime}`
    );
    await this.renderOverlayStickers(currentTime);
  }

  // CLI-specific element rendering without black frame validation
  private async renderElementCLI(
    element: any,
    mediaItem: any,
    currentTime: number
  ): Promise<void> {
    const elementTimeOffset = currentTime - element.startTime;

    if (element.type === "media" && mediaItem) {
      await this.renderMediaElementCLI(element, mediaItem, elementTimeOffset);
    } else if (element.type === "text") {
      this.renderTextElementCLI(element);
    } else if (element.type === "sticker") {
      debugLog(
        `[CLI_STICKER_DEBUG] Found sticker element: ${element.id} at time ${currentTime}`
      );
      await this.renderStickerElementCLI(element, mediaItem, currentTime);
    }
  }

  // CLI media rendering with more lenient validation
  private async renderMediaElementCLI(
    element: any,
    mediaItem: any,
    timeOffset: number
  ): Promise<void> {
    if (!mediaItem.url) {
      debugWarn(`[CLIExportEngine] No URL for media item ${mediaItem.id}`);
      return;
    }

    try {
      if (mediaItem.type === "image") {
        await this.renderImageCLI(element, mediaItem);
      } else if (mediaItem.type === "video") {
        await this.renderVideoCLI(element, mediaItem, timeOffset);
      }
    } catch (error) {
      debugWarn(
        `[CLIExportEngine] Failed to render ${element.id}, using fallback:`,
        error
      );
      // Fallback: render a colored rectangle instead of failing
      this.ctx.fillStyle = "#333333";
      const bounds = this.calculateElementBounds(element, 640, 480);
      this.ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
  }

  // Simplified video rendering for CLI without strict validation
  private async renderVideoCLI(
    element: any,
    mediaItem: any,
    timeOffset: number
  ): Promise<void> {
    try {
      let video = this.getVideoFromCache(mediaItem.url);
      if (!video) {
        video = document.createElement("video");
        video.src = mediaItem.url;
        video.crossOrigin = "anonymous";

        await new Promise<void>((resolve, reject) => {
          video!.onloadeddata = () => resolve();
          video!.onerror = () => reject(new Error("Failed to load video"));
          setTimeout(() => reject(new Error("Video load timeout")), 5000);
        });

        this.cacheVideo(mediaItem.url, video);
      }

      // Seek to the correct time
      const seekTime = timeOffset + element.trimStart;
      video.currentTime = seekTime;

      // Wait for seek with generous timeout
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(); // Don't reject, just use whatever frame we have
        }, 3000);

        video.onseeked = () => {
          clearTimeout(timeout);
          setTimeout(() => resolve(), 200); // Longer stabilization
        };
      });

      // Calculate bounds and draw
      const { x, y, width, height } = this.calculateElementBounds(
        element,
        video.videoWidth || 640,
        video.videoHeight || 480
      );

      // Draw video WITHOUT canvas effects (FFmpeg will handle effects)
      this.ctx.drawImage(video, x, y, width, height);
    } catch (error) {
      debugWarn(
        "[CLIExportEngine] Video render failed, using placeholder:",
        error
      );
      // Render placeholder instead of failing
      this.ctx.fillStyle = "#444444";
      const bounds = this.calculateElementBounds(element, 640, 480);
      this.ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
  }

  // Enhanced image rendering for CLI with better blob URL handling
  private renderImageCLI(element: any, mediaItem: any): Promise<void> {
    return new Promise((resolve) => {
      try {
        // For generated images with blob URLs, try to get the actual file data first
        if (
          mediaItem.url?.startsWith("blob:") &&
          mediaItem.file &&
          mediaItem.file.size > 0
        ) {
          // Create a new blob URL from the file data to ensure it's accessible
          const newBlobUrl = URL.createObjectURL(mediaItem.file);

          const img = new Image();
          img.crossOrigin = "anonymous";

          const timeout = setTimeout(() => {
            URL.revokeObjectURL(newBlobUrl);
            resolve();
          }, 8000); // Increased timeout for generated images

          img.onload = () => {
            try {
              clearTimeout(timeout);

              const { x, y, width, height } = this.calculateElementBounds(
                element,
                img.width,
                img.height
              );

              this.ctx.drawImage(img, x, y, width, height);

              URL.revokeObjectURL(newBlobUrl);
              resolve();
            } catch (error) {
              URL.revokeObjectURL(newBlobUrl);
              resolve();
            }
          };

          img.onerror = () => {
            clearTimeout(timeout);
            URL.revokeObjectURL(newBlobUrl);
            resolve();
          };

          img.src = newBlobUrl;
          return;
        }

        // Fallback to original URL loading for regular images
        const img = new Image();
        img.crossOrigin = "anonymous";

        const timeout = setTimeout(() => {
          resolve();
        }, 5000); // Standard timeout for regular images

        img.onload = () => {
          try {
            clearTimeout(timeout);

            const { x, y, width, height } = this.calculateElementBounds(
              element,
              img.width,
              img.height
            );

            this.ctx.drawImage(img, x, y, width, height);

            resolve();
          } catch (error) {
            resolve();
          }
        };

        img.onerror = () => {
          clearTimeout(timeout);
          resolve();
        };

        img.src = mediaItem.url!;
      } catch (error) {
        resolve();
      }
    });
  }

  // Simple text rendering for CLI
  private renderTextElementCLI(element: any): void {
    if (element.type !== "text" || !element.content?.trim()) return;

    this.ctx.fillStyle = element.color || "#ffffff";
    this.ctx.font = `${element.fontSize || 24}px ${element.fontFamily || "Arial"}`;
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "top";

    const x = element.x || 50;
    const y = element.y || 50;

    this.ctx.fillText(element.content, x, y);
  }

  // CLI sticker rendering using overlay sticker system
  private async renderStickerElementCLI(
    element: TimelineElement,
    mediaItem: MediaItem | null,
    currentTime: number
  ): Promise<void> {
    debugLog(
      `[CLI_STICKER_DEBUG] Starting sticker render for element ${element.id}`
    );

    try {
      // Import stickers overlay store dynamically (cached)
      if (!stickersModulePromise) {
        stickersModulePromise = import("@/stores/stickers-overlay-store");
      }
      const { useStickersOverlayStore } = await stickersModulePromise;

      if (!mediaModulePromise) {
        mediaModulePromise = import("@/stores/media-store");
      }
      const { useMediaStore } = await mediaModulePromise;

      // Get visible stickers at current time
      const stickersStore = useStickersOverlayStore.getState();
      const visibleStickers =
        stickersStore.getVisibleStickersAtTime(currentTime);

      debugLog(
        `[CLI_STICKER_DEBUG] Found ${visibleStickers.length} overlay stickers at time ${currentTime}`
      );

      if (visibleStickers.length === 0) {
        debugLog("[CLI_STICKER_DEBUG] No overlay stickers to render");
        return;
      }

      // Get media items map
      const mediaStore = useMediaStore.getState();
      const mediaItemsMap = new Map(
        mediaStore.mediaItems.map((item) => [item.id, item])
      );

      // Use the existing sticker export helper (cached)
      if (!stickerHelperModulePromise) {
        stickerHelperModulePromise = import(
          "@/lib/stickers/sticker-export-helper"
        );
      }
      const { getStickerExportHelper } = await stickerHelperModulePromise;
      const stickerHelper = getStickerExportHelper();

      debugLog("[CLI_STICKER_DEBUG] Rendering stickers to canvas...");
      await stickerHelper.renderStickersToCanvas(
        this.ctx,
        visibleStickers,
        mediaItemsMap,
        {
          canvasWidth: this.canvas.width,
          canvasHeight: this.canvas.height,
          currentTime,
        }
      );

      debugLog(
        `[CLI_STICKER_DEBUG] ✅ Successfully rendered ${visibleStickers.length} stickers`
      );
    } catch (error) {
      debugError("[CLI_STICKER_DEBUG] Failed to render stickers:", error);
    }
  }

  // Helper methods for video caching (CLI-specific cache)
  private cliVideoCache = new Map<string, HTMLVideoElement>();

  private getVideoFromCache(url: string): HTMLVideoElement | undefined {
    return this.cliVideoCache.get(url);
  }

  private cacheVideo(url: string, video: HTMLVideoElement): void {
    this.cliVideoCache.set(url, video);
  }

  // Helper to get active elements (CLI-specific version)
  private getActiveElementsCLI(
    currentTime: number
  ): Array<{ element: any; track: any; mediaItem: any }> {
    const activeElements: Array<{ element: any; track: any; mediaItem: any }> =
      [];

    this.tracks.forEach((track) => {
      track.elements.forEach((element) => {
        if (element.hidden) return;

        const elementStart = element.startTime;
        const elementEnd =
          element.startTime +
          (element.duration - element.trimStart - element.trimEnd);

        if (currentTime >= elementStart && currentTime < elementEnd) {
          let mediaItem = null;
          if (element.type === "media" && element.mediaId !== "test") {
            mediaItem =
              this.mediaItems.find((item) => item.id === element.mediaId) ||
              null;
          }
          activeElements.push({ element, track, mediaItem });
        }
      });
    });

    return activeElements;
  }

  private async prepareAudioFiles(): Promise<
    Array<{ path: string; startTime: number; volume: number }>
  > {
    const results: Array<{ path: string; startTime: number; volume: number }> =
      [];
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
        if (!mediaItem?.url) continue;
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

    // Check feature flag to disable optimization if needed
    const skipOptimization = localStorage.getItem('qcut_skip_export_optimization') === 'true';

    // Analyze timeline to determine optimization strategy
    debugLog("[CLIExportEngine] 🔍 Analyzing timeline for export optimization...");
    this.exportAnalysis = analyzeTimelineForExport(
      this.tracks,
      this.mediaItems
    );

    // TEMPORARY: Force image pipeline until direct copy is fully implemented
    // TODO: Remove this once buildFFmpegArgs implements direct video copy logic
    const forceImagePipeline = true;

    // Override analysis if feature flag is set OR if forcing image pipeline
    if (skipOptimization || forceImagePipeline) {
      if (forceImagePipeline) {
        console.log('🔧 [EXPORT OPTIMIZATION] Direct copy not yet implemented - forcing image pipeline');
        debugLog('[CLIExportEngine] 🔧 Direct copy feature incomplete, using image pipeline');
      } else {
        console.log('🔧 [EXPORT OPTIMIZATION] Feature flag enabled - forcing image pipeline');
        debugLog('[CLIExportEngine] 🔧 Optimization disabled via feature flag');
      }
      this.exportAnalysis = {
        ...this.exportAnalysis,
        needsImageProcessing: true,
        canUseDirectCopy: false,
        optimizationStrategy: 'image-pipeline',
        reason: forceImagePipeline ? 'Direct copy not yet implemented' : 'Optimization disabled by feature flag'
      };
    }

    console.log('📊 [EXPORT OPTIMIZATION] Analysis Result:', {
      needsImageProcessing: this.exportAnalysis.needsImageProcessing,
      canUseDirectCopy: this.exportAnalysis.canUseDirectCopy,
      optimizationStrategy: this.exportAnalysis.optimizationStrategy,
      reason: this.exportAnalysis.reason,
      hasImageElements: this.exportAnalysis.hasImageElements,
      hasTextElements: this.exportAnalysis.hasTextElements,
      hasStickers: this.exportAnalysis.hasStickers,
      hasEffects: this.exportAnalysis.hasEffects,
      hasOverlappingVideos: this.exportAnalysis.hasOverlappingVideos
    });
    debugLog("[CLIExportEngine] 📊 Export Analysis:", this.exportAnalysis);

    try {
      // Pre-load videos (our optimization)
      progressCallback?.(10, "Pre-loading videos...");
      await this.preloadAllVideos();

      // Render frames to disk ONLY if image processing is needed
      try {
        if (this.exportAnalysis?.needsImageProcessing) {
          console.log('🎨 [EXPORT OPTIMIZATION] Image processing required - RENDERING FRAMES');
          console.log('📝 [EXPORT OPTIMIZATION] Reason:', this.exportAnalysis.reason);
          debugLog('[CLIExportEngine] 🎨 Image processing required - rendering frames to disk');
          debugLog(`[CLIExportEngine] Reason: ${this.exportAnalysis.reason}`);
          progressCallback?.(15, "Rendering frames...");
          await this.renderFramesToDisk(progressCallback);
        } else {
          console.log('⚡ [EXPORT OPTIMIZATION] Skipping frame rendering - using direct video copy!');
          console.log('📝 [EXPORT OPTIMIZATION] Strategy:', this.exportAnalysis?.optimizationStrategy);
          debugLog('[CLIExportEngine] ⚡ Skipping frame rendering - using direct video processing');
          debugLog(`[CLIExportEngine] Optimization: ${this.exportAnalysis?.optimizationStrategy}`);
          progressCallback?.(15, "Preparing direct video processing...");
          // Frame rendering skipped - will use direct FFmpeg video copy
        }
      } catch (error) {
        console.error('❌ [EXPORT OPTIMIZATION] Error in frame rendering decision:', error);
        // Fallback: Force image pipeline if optimization fails
        debugWarn('[CLIExportEngine] ⚠️ Direct processing preparation failed, falling back to image pipeline:', error);

        // Safe default for exportAnalysis if it's null
        const analysisBase: ExportAnalysis = this.exportAnalysis || {
          needsImageProcessing: false,
          hasImageElements: false,
          hasTextElements: false,
          hasStickers: false,
          hasEffects: false,
          hasMultipleVideoSources: false,
          hasOverlappingVideos: false,
          canUseDirectCopy: false,
          optimizationStrategy: 'image-pipeline',
          reason: 'Initial analysis failed'
        };

        // Force image processing
        this.exportAnalysis = {
          ...analysisBase,
          needsImageProcessing: true,
          canUseDirectCopy: false,
          optimizationStrategy: 'image-pipeline',
          reason: 'Fallback due to optimization error'
        };

        // Render frames as fallback
        progressCallback?.(15, "Rendering frames (fallback)...");
        await this.renderFramesToDisk(progressCallback);
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

  private async renderFramesToDisk(
    progressCallback?: ProgressCallback
  ): Promise<void> {
    const totalFrames = this.calculateTotalFrames();
    const frameTime = 1 / 30; // fps

    debugLog(`[CLI] Rendering ${totalFrames} frames to disk...`);

    for (let frame = 0; frame < totalFrames; frame++) {
      if (this.abortController?.signal.aborted) {
        throw new Error("Export cancelled");
      }

      const currentTime = frame * frameTime;
      const frameName = `frame-${frame.toString().padStart(4, "0")}.png`;

      // Render frame with all elements including stickers
      await this.renderFrame(currentTime);

      // Save frame for video compilation
      await this.saveFrameToDisk(frameName, currentTime);

      // Progress update (15% to 80% for frame rendering)
      const progress = 15 + (frame / totalFrames) * 65;
      progressCallback?.(
        progress,
        `Rendering frame ${frame + 1}/${totalFrames}`
      );
    }

    debugLog(`[CLI] Rendered ${totalFrames} frames to ${this.frameDir}`);
  }

  private async saveFrameToDisk(
    frameName: string,
    currentTime: number
  ): Promise<void> {
    if (!window.electronAPI) {
      throw new Error("CLI export only available in Electron");
    }

    try {
      // Convert canvas to base64
      const dataUrl = this.canvas.toDataURL("image/png", 1.0);
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");

      // Validate base64 data
      if (!base64Data || base64Data.length < 100) {
        throw new Error(`Invalid PNG data: ${base64Data.length} chars`);
      }

      // 🐛 DEBUG: Save debug frame to temp folder for inspection
      const debugFrameName = `debug_${frameName}`;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const timestampedDebugFrame = `debug_${timestamp}_${frameName}`;

      try {
        // Save regular debug frame
        await window.electronAPI.ffmpeg.saveFrame({
          sessionId: this.sessionId || "debug",
          frameName: debugFrameName,
          data: base64Data,
        });

        // Save timestamped debug frame for easier identification
        await window.electronAPI.ffmpeg.saveFrame({
          sessionId: this.sessionId || "debug",
          frameName: timestampedDebugFrame,
          data: base64Data,
        });

        // 🗂️ DEBUG: Explorer opening moved to renderFramesToDisk to avoid opening 30+ windows
      } catch (debugError) {
        console.warn("⚠️ DEBUG: Failed to save debug frame:", debugError);
      }

      // Save via IPC
      if (!this.sessionId) {
        throw new Error("No active session ID");
      }

      // First save the raw frame
      const rawFrameName = `raw_${frameName}`;
      await window.electronAPI.ffmpeg.saveFrame({
        sessionId: this.sessionId,
        frameName: rawFrameName,
        data: base64Data,
      });

      // Get filter chain for active elements
      let filterChain: string | undefined;
      const activeElements = this.getActiveElementsCLI(currentTime);

      for (const { element } of activeElements) {
        if (element.type === "media" && this.effectsStore) {
          const elementFilter = this.effectsStore.getFFmpegFilterChain(
            element.id
          );
          if (elementFilter) {
            filterChain = elementFilter;
            break; // Use first element with filters
          }
        }
      }

      // If we have a filter chain, process the frame through FFmpeg
      if (filterChain && window.electronAPI.ffmpeg.processFrame) {
        try {
          await window.electronAPI.ffmpeg.processFrame({
            sessionId: this.sessionId,
            inputFrameName: rawFrameName,
            outputFrameName: frameName,
            filterChain,
          });
        } catch (filterError) {
          console.warn(
            `⚠️ Failed to apply FFmpeg filter to ${frameName}, using raw frame:`,
            filterError
          );
          // Fallback: copy raw frame as final frame
          await window.electronAPI.ffmpeg.saveFrame({
            sessionId: this.sessionId,
            frameName,
            data: base64Data,
          });
        }
      } else {
        // No filter chain, just save the raw frame as the final frame
        await window.electronAPI.ffmpeg.saveFrame({
          sessionId: this.sessionId,
          frameName,
          data: base64Data,
        });
      }
    } catch (error) {
      debugError(`[CLIExportEngine] Failed to save frame ${frameName}:`, error);
      throw error;
    }
  }

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
      useDirectCopy: this.exportAnalysis?.canUseDirectCopy || false,
    };

    console.log('🎬 [EXPORT OPTIMIZATION] Sending to FFmpeg with useDirectCopy =', exportOptions.useDirectCopy);
    console.log('📦 [EXPORT OPTIMIZATION] Export options:', {
      sessionId: exportOptions.sessionId,
      useDirectCopy: exportOptions.useDirectCopy,
      width: exportOptions.width,
      height: exportOptions.height,
      fps: exportOptions.fps,
      duration: exportOptions.duration,
      hasAudio: audioFiles.length > 0,
      hasFilterChain: !!exportOptions.filterChain
    });

    debugLog(
      "[CLI Export] Starting FFmpeg export with options:",
      exportOptions
    );

    // Note: Progress updates would need to be added to electronAPI
    // For now, use basic invoke without progress tracking

    try {
      const result =
        await window.electronAPI.ffmpeg.exportVideoCLI(exportOptions);
      console.log('✅ [EXPORT OPTIMIZATION] FFmpeg export completed successfully!');
      debugLog("[CLI Export] FFmpeg export completed successfully:", result);
      return result.outputFile;
    } catch (error) {
      console.error('❌ [EXPORT OPTIMIZATION] FFmpeg export FAILED!', error);
      console.error('❌ [EXPORT OPTIMIZATION] Error message:', error instanceof Error ? error.message : String(error));
      console.error('❌ [EXPORT OPTIMIZATION] Error details:', {
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
