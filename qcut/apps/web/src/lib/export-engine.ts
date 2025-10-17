import {
  ExportSettings,
  ExportProgress,
  FORMAT_INFO,
  ExportPurpose,
} from "@/types/export";
import { TimelineElement, TimelineTrack } from "@/types/timeline";
import type { MediaItem } from "@/stores/media-store-types";
import { useTimelineStore } from "@/stores/timeline-store";
import {
  FFmpegVideoRecorder,
  isFFmpegExportEnabled,
} from "@/lib/ffmpeg-video-recorder";
import { debugLog, debugError, debugWarn } from "@/lib/debug-config";
import { renderStickersToCanvas } from "@/lib/stickers/sticker-export-helper";
import { useStickersOverlayStore } from "@/stores/stickers-overlay-store";
import { useMediaStore } from "@/stores/media-store";
import { useEffectsStore } from "@/stores/effects-store";
import {
  applyEffectsToCanvas,
  resetCanvasFilters,
  mergeEffectParameters,
} from "@/lib/effects-utils";
import { applyAdvancedCanvasEffects } from "@/lib/effects-canvas-advanced";
import { EFFECTS_ENABLED } from "@/config/features";

// Interface for active elements at a specific time
interface ActiveElement {
  element: TimelineElement;
  track: TimelineTrack;
  mediaItem: MediaItem | null;
}

// Advanced progress info
interface AdvancedProgressInfo {
  currentFrame: number;
  totalFrames: number;
  encodingSpeed: number;
  processedFrames: number;
  elapsedTime: number;
  averageFrameTime: number;
  estimatedTimeRemaining: number;
}

// Progress callback type
type ProgressCallback = (
  progress: number,
  status: string,
  advancedInfo?: AdvancedProgressInfo
) => void;

// Export engine for rendering timeline to video
export class ExportEngine {
  protected canvas: HTMLCanvasElement;
  protected ctx: CanvasRenderingContext2D;
  protected settings: ExportSettings;
  protected tracks: TimelineTrack[];
  protected mediaItems: MediaItem[];
  protected totalDuration: number;
  protected fps = 30; // Fixed framerate for now

  // MediaRecorder properties
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  protected isExporting = false;
  protected abortController: AbortController | null = null;

  // FFmpeg recorder for WASM-based export
  private ffmpegRecorder: FFmpegVideoRecorder | null = null;
  private useFFmpegExport = false;

  // Video element cache for performance
  private videoCache = new Map<string, HTMLVideoElement>();

  // Track images used during export
  private usedImages = new Set<string>();

  constructor(
    canvas: HTMLCanvasElement,
    settings: ExportSettings,
    tracks: TimelineTrack[],
    mediaItems: MediaItem[],
    totalDuration: number
  ) {
    this.canvas = canvas;
    this.settings = settings;
    this.tracks = tracks;
    this.mediaItems = mediaItems;
    this.totalDuration = totalDuration;

    // Check if we should use FFmpeg WASM export
    this.useFFmpegExport = isFFmpegExportEnabled();
    debugLog(
      `[ExportEngine] Using ${this.useFFmpegExport ? "FFmpeg WASM" : "MediaRecorder"} for export`
    );

    console.log("🎬 STANDARD EXPORT ENGINE: Constructor called");
    console.log(
      `🎬 STANDARD EXPORT ENGINE: Will use ${this.useFFmpegExport ? "FFmpeg WASM" : "MediaRecorder"} for export`
    );

    // Progressive canvas quality based on export purpose
    const isPreview = settings.purpose === ExportPurpose.PREVIEW;
    const canvasOptions: CanvasRenderingContext2DSettings = {
      willReadFrequently: true,
      alpha: !isPreview, // Disable alpha channel for preview (faster)
      desynchronized: isPreview, // Allow desynchronized rendering for preview
    };

    const ctx = canvas.getContext("2d", canvasOptions);
    if (!ctx) {
      throw new Error("Failed to get 2D context from canvas");
    }
    this.ctx = ctx;

    // Set render quality based on purpose
    if (isPreview) {
      this.ctx.imageSmoothingEnabled = false; // Faster rendering
      this.ctx.imageSmoothingQuality = "low";
      debugLog("[ExportEngine] Canvas quality: preview mode (fast)");
    } else {
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = "high";
      debugLog("[ExportEngine] Canvas quality: final mode (high quality)");
    }

    // Set canvas dimensions to match export settings
    this.canvas.width = settings.width;
    this.canvas.height = settings.height;
  }

  // Calculate total number of frames needed for export
  calculateTotalFrames(): number {
    return Math.ceil(this.totalDuration * this.fps);
  }

  // Get active elements at a specific time
  private getActiveElements(currentTime: number): ActiveElement[] {
    const activeElements: ActiveElement[] = [];

    this.tracks.forEach((track, trackIndex) => {
      track.elements.forEach((element, elementIndex) => {
        if (element.hidden) {
          return;
        }

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
            if (!mediaItem) {
              debugWarn(
                `[ExportEngine] Media item not found: ${element.mediaId}`
              );
            }
          }
          activeElements.push({ element, track, mediaItem });
        }
      });
    });

    // Log active elements for investigation
    if (activeElements.length > 0 && currentTime % 1 === 0) {
      // Log every second
      console.log(
        `\n🔍 EXPORT @ ${currentTime.toFixed(1)}s: ${activeElements.length} active elements`
      );
      activeElements.forEach(({ element, track }) => {
        const effects = useEffectsStore
          .getState()
          .getElementEffects(element.id);
        const hasEffects = effects && effects.length > 0;
        console.log(
          `  🎥 Element: ${element.id} (${element.type}) - Effects: ${hasEffects ? effects.length : "none"}`
        );
        if (hasEffects) {
          console.log(
            `    ✨ Effects applied: ${effects.map((e) => `${e.name}(${e.enabled ? "on" : "off"})`).join(", ")}`
          );
        }
      });
    }

    return activeElements;
  }

  // Render a single frame at the specified time
  async renderFrame(currentTime: number): Promise<void> {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Fill with background color (black for now)
    this.ctx.fillStyle = "#000000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const activeElements = this.getActiveElements(currentTime);

    // Log frame rendering details for first frame and every 30th frame
    if (currentTime === 0 || Math.floor(currentTime * this.fps) % 30 === 0) {
      console.log(
        `🎨 FRAME RENDER: Time=${currentTime.toFixed(2)}s, Elements=${activeElements.length}`
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

    // Render each active element
    for (const { element, mediaItem } of sortedElements) {
      await this.renderElement(element, mediaItem, currentTime);
    }

    // Render overlay stickers on top of everything
    await this.renderOverlayStickers(currentTime);
  }

  // Render individual element (media or text)
  private async renderElement(
    element: TimelineElement,
    mediaItem: MediaItem | null,
    currentTime: number
  ): Promise<void> {
    const elementTimeOffset = currentTime - element.startTime;

    if (element.type === "media" && mediaItem) {
      await this.renderMediaElement(element, mediaItem, elementTimeOffset);
    } else if (element.type === "text") {
      this.renderTextElement(element);
    }
  }

  // Render media elements (images/videos)
  private async renderMediaElement(
    element: TimelineElement,
    mediaItem: MediaItem,
    timeOffset: number
  ): Promise<void> {
    if (!mediaItem.url) {
      debugWarn(`[ExportEngine] No URL for media item ${mediaItem.id}`);
      return;
    }

    try {
      if (mediaItem.type === "image") {
        await this.renderImage(element, mediaItem);
      } else if (mediaItem.type === "video") {
        await this.renderVideo(element, mediaItem, timeOffset);
      }
    } catch (error) {
      debugError(`[ExportEngine] Failed to render ${element.id}:`, error);
    }
  }

  // Render image element
  private async renderImage(
    element: TimelineElement,
    mediaItem: MediaItem
  ): Promise<void> {
    // Track which image is being used
    this.usedImages.add(mediaItem.id);

    // Log which image is being used
    console.log(`🖼️ EXPORT: Using image - ID: ${mediaItem.id}, Name: ${mediaItem.name || 'Unnamed'}, URL: ${mediaItem.url}`);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";

      img.onload = () => {
        try {
          const { x, y, width, height } = this.calculateElementBounds(
            element,
            img.width,
            img.height
          );

          console.log(`🖼️ EXPORT: Rendered image "${mediaItem.name || mediaItem.id}" at position (${x}, ${y}) with size ${width}x${height}`);

          // Apply effects if enabled
          if (EFFECTS_ENABLED) {
            try {
              const effects = useEffectsStore
                .getState()
                .getElementEffects(element.id);
              console.log(
                `🎨 EXPORT ENGINE: Retrieved ${effects.length} effects for image element ${element.id}`
              );
              const enabledEffects = effects.filter((e) => e.enabled);
              console.log(
                `✨ EXPORT ENGINE: ${enabledEffects.length} enabled effects for image element ${element.id}`
              );

              if (enabledEffects.length > 0) {
                // Save context state before applying effects
                this.ctx.save();

                // Merge all active effect parameters
                const mergedParams = mergeEffectParameters(
                  ...enabledEffects.map((e) => e.parameters)
                );
                console.log(
                  "🔨 EXPORT ENGINE: Applying effects to image canvas:",
                  mergedParams
                );

                // Apply CSS-compatible effects to canvas context
                applyEffectsToCanvas(this.ctx, mergedParams);

                // Draw image with effects applied
                this.ctx.drawImage(img, x, y, width, height);

                // Apply advanced canvas-only effects
                applyAdvancedCanvasEffects(this.ctx, mergedParams);

                // Restore context state
                this.ctx.restore();
              } else {
                // No enabled effects - draw normally
                console.log(
                  `🚫 EXPORT ENGINE: No enabled effects for image element ${element.id}, drawing normally`
                );
                this.ctx.drawImage(img, x, y, width, height);
              }
            } catch (error) {
              // Log but don't fail export
              console.error(
                `❌ EXPORT ENGINE: Effects failed for image element ${element.id}:`,
                error
              );
              debugWarn(`[Export] Effects failed for ${element.id}:`, error);
              // Fallback to drawing without effects
              this.ctx.drawImage(img, x, y, width, height);
            }
          } else {
            // Effects disabled or no effects - draw normally
            this.ctx.drawImage(img, x, y, width, height);
          }

          resolve();
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => {
        debugError(`[ExportEngine] Failed to load image: ${mediaItem.url}`);
        reject(new Error(`Failed to load image: ${mediaItem.url}`));
      };

      img.src = mediaItem.url!;
    });
  }

  // Render video element with retry mechanism for better reliability
  private async renderVideo(
    element: TimelineElement,
    mediaItem: MediaItem,
    timeOffset: number
  ): Promise<void> {
    if (!mediaItem.url) {
      debugWarn(`[ExportEngine] No URL for video element ${element.id}`);
      return;
    }

    // Retry mechanism: retry appropriately if frames don't appear in time (max 3 attempts)
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.renderVideoAttempt(element, mediaItem, timeOffset, attempt);
        return; // Return immediately on success
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries) {
          debugWarn(
            `[ExportEngine] Video render attempt ${attempt} failed, retrying... Error: ${error}`
          );
          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        }
      }
    }

    // All retries failed
    debugError(
      `[ExportEngine] All ${maxRetries} video render attempts failed for ${mediaItem.url}`
    );
    throw lastError || new Error("Video rendering failed after retries");
  }

  // Single video render attempt
  private async renderVideoAttempt(
    element: TimelineElement,
    mediaItem: MediaItem,
    timeOffset: number,
    attempt: number
  ): Promise<void> {
    try {
      // Use cached video element or create new one
      let video = this.videoCache.get(mediaItem.url!);
      if (!video) {
        video = document.createElement("video");
        video.src = mediaItem.url!;
        video.crossOrigin = "anonymous";

        // Wait for video to load
        await new Promise<void>((resolve, reject) => {
          video!.onloadeddata = () => resolve();
          video!.onerror = () => reject(new Error("Failed to load video"));
        });

        // Cache the loaded video
        this.videoCache.set(mediaItem.url!, video);
      }

      // Seek to the correct time
      const seekTime = timeOffset + element.trimStart;
      video.currentTime = seekTime;

      // Wait for seek to complete with extended timeout for better frame capture
      await new Promise<void>((resolve, reject) => {
        // Extended timeout: 500-2000ms for reliable frame capture (experience shows 300ms+ significantly improves success rate)
        const baseTimeout = 500; // Increased from 200ms to 500ms base timeout
        const maxTimeout = 2000; // Increased from 1000ms to 2000ms max timeout
        const adaptiveTimeout = Math.max(
          baseTimeout,
          Math.min(maxTimeout, video.duration * 30)
        );
        const seekDistanceFactor =
          Math.abs(video.currentTime - seekTime) / video.duration;
        const finalTimeout = adaptiveTimeout * (1 + seekDistanceFactor * 2);

        const timeout = setTimeout(() => {
          debugWarn(
            `[ExportEngine] Video seek timeout after ${finalTimeout.toFixed(0)}ms (extended for frame quality)`
          );
          reject(new Error("Video seek timeout"));
        }, finalTimeout);

        video.onseeked = () => {
          clearTimeout(timeout);
          // Additional 100-200ms delay to ensure browser completes frame rendering (avoid capturing empty frames)
          setTimeout(() => {
            resolve();
          }, 150); // Give frame rendering sufficient time
        };
      });

      // Calculate bounds
      const { x, y, width, height } = this.calculateElementBounds(
        element,
        video.videoWidth,
        video.videoHeight
      );

      // Draw video frame to canvas with effects if enabled
      if (EFFECTS_ENABLED) {
        try {
          const effects = useEffectsStore
            .getState()
            .getElementEffects(element.id);
          console.log(
            `🎨 EXPORT ENGINE: Retrieved ${effects?.length || 0} effects for video element ${element.id}`
          );
          if (effects && effects.length > 0) {
            const activeEffects = effects.filter((e) => e.enabled);
            console.log(
              `✨ EXPORT ENGINE: ${activeEffects.length} enabled effects for video element ${element.id}`
            );
            if (activeEffects.length === 0) {
              // No enabled effects - draw normally
              console.log(
                `🚫 EXPORT ENGINE: No enabled effects for video element ${element.id}, drawing normally`
              );
              this.ctx.drawImage(video, x, y, width, height);
              return;
            }

            // Save context state before applying effects
            this.ctx.save();

            // Merge all active effect parameters
            const mergedParams = mergeEffectParameters(
              ...activeEffects.map((e) => e.parameters)
            );
            console.log(
              "🔨 EXPORT ENGINE: Applying effects to video canvas:",
              mergedParams
            );

            // Apply CSS-compatible effects to canvas context
            applyEffectsToCanvas(this.ctx, mergedParams);

            // Draw video with effects applied
            this.ctx.drawImage(video, x, y, width, height);

            // Apply advanced canvas-only effects
            applyAdvancedCanvasEffects(this.ctx, mergedParams);

            // Restore context state
            this.ctx.restore();
          } else {
            // No active effects - draw normally
            console.log(
              `🚫 EXPORT ENGINE: No effects found for video element ${element.id}, drawing normally`
            );
            this.ctx.drawImage(video, x, y, width, height);
          }
        } catch (error) {
          // Log but don't fail export
          console.error(
            `❌ EXPORT ENGINE: Video effects failed for element ${element.id}:`,
            error
          );
          debugWarn(`[Export] Video effects failed for ${element.id}:`, error);
          // Fallback to drawing without effects
          this.ctx.drawImage(video, x, y, width, height);
        }
      } else {
        // Effects disabled or no effects - draw normally
        this.ctx.drawImage(video, x, y, width, height);
      }

      // Validate frame rendering success (detect black frames)
      const frameValidation = this.validateRenderedFrame(
        x,
        y,
        width,
        height,
        attempt
      );
      if (!frameValidation.isValid) {
        throw new Error(`Frame validation failed: ${frameValidation.reason}`);
      }
    } catch (error) {
      debugError(
        `[ExportEngine] Failed to render video (attempt ${attempt}):`,
        error
      );
      throw error; // Re-throw error for retry mechanism to handle
    }
  }

  // Render text elements
  // Render overlay stickers on top of video
  protected async renderOverlayStickers(currentTime: number): Promise<void> {
    let visibleStickers: any[] = [];
    try {
      // Get stickers from store
      const stickersStore = useStickersOverlayStore.getState();
      visibleStickers = stickersStore.getVisibleStickersAtTime(currentTime);

      // Debug logging for sticker export
      debugLog(`[STICKER_FRAME] Frame time: ${currentTime.toFixed(3)}s`);
      debugLog(
        `[STICKER_FRAME] Found ${visibleStickers.length} stickers for this frame`
      );
      debugLog(
        "[STICKER_FRAME] Sticker IDs:",
        visibleStickers.map((s) => s.id)
      );
      debugLog(
        "[STICKER_DEBUG] All stickers in store:",
        Array.from(stickersStore.overlayStickers.values())
      );
      debugLog("[STICKER_DEBUG] Visible stickers:", visibleStickers);

      if (visibleStickers.length === 0) {
        debugLog(
          `[STICKER_DEBUG] No visible stickers at time ${currentTime}, skipping render`
        );
        return;
      }

      // Get media items for stickers
      const mediaStore = useMediaStore.getState();
      const mediaItemsMap = new Map(
        mediaStore.mediaItems.map((item) => [item.id, item])
      );

      // Render stickers to canvas
      await renderStickersToCanvas(this.ctx, visibleStickers, mediaItemsMap, {
        canvasWidth: this.canvas.width,
        canvasHeight: this.canvas.height,
        currentTime,
      });

      debugLog(
        `[ExportEngine] Rendered ${visibleStickers.length} overlay stickers at time ${currentTime}`
      );

      // CANVAS DEBUG: Validate canvas content after sticker rendering
      const imageData = this.ctx.getImageData(0, 0, 100, 100); // Sample top-left corner
      const hasContent = Array.from(imageData.data).some(
        (value, index) => index % 4 !== 3 && value > 10 // Check RGB channels, ignore alpha
      );
      debugLog(
        "[FRAME_CANVAS] Canvas has visible content after stickers:",
        hasContent
      );
    } catch (error) {
      debugError("[ExportEngine] Failed to render overlay stickers:", error);
      debugError(
        `[ExportEngine] Failed at time ${currentTime} with ${visibleStickers?.length || 0} stickers`
      );
      debugError(
        "[ExportEngine] Sticker details:",
        visibleStickers?.map((s: any) => ({
          id: s.id,
          mediaItemId: s.mediaItemId,
        })) || []
      );
      // Continue export even if stickers fail
    }
  }

  private renderTextElement(element: TimelineElement): void {
    if (element.type !== "text") return;

    if (!element.content || !element.content.trim()) return;

    // Set text properties
    this.ctx.fillStyle = element.color || "#ffffff";
    this.ctx.font = `${element.fontSize || 24}px ${element.fontFamily || "Arial"}`;
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "top";

    // Position text (using element position or defaults)
    const x = element.type === "text" ? element.x || 50 : 50;
    const y = element.type === "text" ? element.y || 50 : 50;

    // Simple text rendering (no word wrap for now)
    this.ctx.fillText(element.content, x, y);
  }

  /**
   * Calculate element bounds with smart resolution adjustment.
   *
   * WHY this logic matters:
   * - Prevents upscaling of small videos (quality degradation)
   * - Ensures consistent output resolution for all clips
   * - Black padding maintains aspect ratio without distortion
   *
   * Scaling rules:
   * 1. If video is SMALLER than canvas in BOTH dimensions:
   *    - Keep original size, center with black padding
   * 2. If video is LARGER than canvas in ANY dimension:
   *    - Scale down to fit while maintaining aspect ratio
   * 3. Always center the result
   *
   * @param element - Timeline element being rendered
   * @param mediaWidth - Original width of the media
   * @param mediaHeight - Original height of the media
   * @returns Bounds object with x, y, width, height for canvas rendering
   */
  protected calculateElementBounds(
    element: TimelineElement,
    mediaWidth: number,
    mediaHeight: number
  ) {
    const canvasAspect = this.canvas.width / this.canvas.height;
    const mediaAspect = mediaWidth / mediaHeight;

    let width: number;
    let height: number;

    // Check if media is smaller than canvas in both dimensions
    const isSmaller = mediaWidth <= this.canvas.width && mediaHeight <= this.canvas.height;

    if (isSmaller) {
      // Video is smaller - use original size, no upscaling
      // Black padding will be added automatically by canvas background
      width = mediaWidth;
      height = mediaHeight;

      debugLog(
        `[ExportEngine] Video smaller than canvas (${mediaWidth}x${mediaHeight} vs ${this.canvas.width}x${this.canvas.height}), keeping original size with padding`
      );
    } else {
      // Video is larger - scale down to fit canvas while maintaining aspect ratio
      if (mediaAspect > canvasAspect) {
        // Media is wider relative to canvas - fit to canvas width
        width = this.canvas.width;
        height = width / mediaAspect;
      } else {
        // Media is taller relative to canvas - fit to canvas height
        width = this.canvas.height * mediaAspect;
        height = this.canvas.height;
      }

      debugLog(
        `[ExportEngine] Video larger than canvas, scaling down from ${mediaWidth}x${mediaHeight} to ${Math.round(width)}x${Math.round(height)}`
      );
    }

    // Center the element on canvas (black padding fills the rest)
    const x = (this.canvas.width - width) / 2;
    const y = (this.canvas.height - height) / 2;

    // Apply element transformations if available (text elements have x,y properties)
    const elementX = element.type === "text" ? element.x : undefined;
    const elementY = element.type === "text" ? element.y : undefined;

    return {
      x: elementX || x,
      y: elementY || y,
      width,
      height,
    };
  }

  // Get total duration
  getTotalDuration(): number {
    return this.totalDuration;
  }

  // Get frame rate
  getFrameRate(): number {
    return this.fps;
  }

  // Setup MediaRecorder for canvas capture with proper timing
  private setupMediaRecorder(existingStream?: MediaStream): void {
    if (this.mediaRecorder) {
      return; // Already set up
    }

    // If using FFmpeg, skip MediaRecorder setup
    if (this.useFFmpegExport) {
      debugLog(
        "[ExportEngine] Skipping MediaRecorder setup - using FFmpeg WASM"
      );
      return;
    }

    // Use existing stream if provided, otherwise create a new one
    const stream = existingStream || this.canvas.captureStream(0); // 0 fps = manual frame capture

    // Configure MediaRecorder options based on format and quality
    const formatInfo = FORMAT_INFO[this.settings.format];
    let selectedMimeType = formatInfo.mimeTypes[0]; // Default to first option

    // Find the first supported MIME type for this format
    for (const mimeType of formatInfo.mimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        selectedMimeType = mimeType as any;
        break;
      }
    }

    const videoBitrate = this.getVideoBitrate();
    const options: MediaRecorderOptions = {
      mimeType: selectedMimeType as string,
      videoBitsPerSecond: videoBitrate,
    };

    // Fallback to WebM if selected format not supported
    if (!MediaRecorder.isTypeSupported(selectedMimeType)) {
      options.mimeType = "video/webm;codecs=vp8" as string;
    }

    // Create MediaRecorder
    this.mediaRecorder = new MediaRecorder(stream, options);

    // Handle data chunks
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };

    // Handle recording stop
    this.mediaRecorder.onstop = () => {
      // Recording stopped
    };
  }

  // Get video bitrate based on quality settings
  protected getVideoBitrate(): number {
    // Bitrates in bits per second
    const bitrates = {
      "1080p": 8_000_000, // 8 Mbps
      "720p": 5_000_000, // 5 Mbps
      "480p": 2_500_000, // 2.5 Mbps
    };

    return bitrates[this.settings.quality] || bitrates["720p"];
  }

  // Start recording
  private async startRecording(): Promise<void> {
    if (this.useFFmpegExport) {
      // Initialize FFmpeg recorder
      if (!this.ffmpegRecorder) {
        this.ffmpegRecorder = new FFmpegVideoRecorder({
          fps: this.fps,
          settings: this.settings,
        });
      }
      await this.ffmpegRecorder.startRecording();
      return;
    }

    if (!this.mediaRecorder) {
      this.setupMediaRecorder();
    }

    if (this.mediaRecorder && this.mediaRecorder.state === "inactive") {
      this.recordedChunks = []; // Clear previous chunks
      this.mediaRecorder.start(100); // Record in 100ms chunks
    }
  }

  // Stop recording and return blob
  private async stopRecording(): Promise<Blob> {
    if (this.useFFmpegExport && this.ffmpegRecorder) {
      return await this.ffmpegRecorder.stopRecording();
    }

    if (!this.mediaRecorder) {
      throw new Error("MediaRecorder not initialized");
    }

    const totalSize = this.recordedChunks.reduce(
      (total, chunk) => total + chunk.size,
      0
    );
    debugLog(
      `[ExportEngine] Export complete: ${totalSize} bytes, ${this.recordedChunks.length} chunks`
    );

    return new Promise((resolve, reject) => {
      this.mediaRecorder!.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: "video/webm" });
        resolve(blob);
      };

      if (this.mediaRecorder!.state === "recording") {
        this.mediaRecorder!.stop();
      } else {
        // Already stopped, create blob immediately
        const blob = new Blob(this.recordedChunks, { type: "video/webm" });
        resolve(blob);
      }
    });
  }

  // Main export method - renders timeline and captures video
  async export(progressCallback?: ProgressCallback): Promise<Blob> {
    console.log("🎬 STANDARD EXPORT ENGINE: Export method called");
    console.log(
      `🎬 STANDARD EXPORT ENGINE: Will use ${this.useFFmpegExport ? "FFmpeg WASM" : "MediaRecorder"} export path`
    );

    // Log next investigation steps
    console.log("\n📋 NEXT INVESTIGATION STEPS:");
    console.log("1️⃣ Track which elements have effects applied during export");
    console.log("2️⃣ Compare element IDs between preview and export");
    console.log("3️⃣ Monitor CSS filter to canvas filter conversion");
    console.log("4️⃣ Check if effects persist through entire export duration");
    console.log("5️⃣ Verify canvas context save/restore for effects\n");

    if (this.isExporting) {
      throw new Error("Export already in progress");
    }

    this.isExporting = true;
    this.abortController = new AbortController();

    // Reset tracking for this export
    this.usedImages.clear();

    // Log original timeline duration and export optimizations
    debugLog(
      `[ExportEngine] 📏 Original timeline duration: ${this.totalDuration.toFixed(3)}s`
    );
    debugLog(
      `[ExportEngine] 🎬 Target frames: ${this.calculateTotalFrames()} frames at ${this.fps}fps`
    );
    debugLog(
      "[ExportEngine] ⚡ Optimizations: 500-2000ms timeout, retry mechanism, frame validation"
    );

    try {
      // Get canvas stream for manual frame capture FIRST (only for MediaRecorder)
      let videoTrack: MediaStreamTrack | null = null;

      if (!this.useFFmpegExport) {
        const stream = this.canvas.captureStream(0);
        videoTrack = stream.getVideoTracks()[0];

        // Setup MediaRecorder with the same stream
        this.setupMediaRecorder(stream);
      }

      await this.startRecording();

      const totalFrames = this.calculateTotalFrames();
      const frameTime = 1 / this.fps; // Time per frame in seconds
      const startTime = Date.now();

      progressCallback?.(0, "Starting export...");

      // Verify stream sync (only for MediaRecorder)
      if (!this.useFFmpegExport && this.mediaRecorder?.stream) {
        const stream = this.canvas.captureStream(0);
        if (stream.id !== this.mediaRecorder.stream.id) {
          debugWarn("[ExportEngine] Stream mismatch detected!");
        }
      }

      // Render each frame with advanced progress tracking
      for (let frame = 0; frame < totalFrames; frame++) {
        const frameStartTime = performance.now();

        // Check if export was cancelled
        if (this.abortController.signal.aborted) {
          throw new Error("Export cancelled by user");
        }

        const currentTime = frame * frameTime;

        // FRAME DEBUG: Track each frame progression during export
        debugLog(
          `[FRAME_DEBUG] Frame ${frame + 1}/${totalFrames} at time ${currentTime.toFixed(3)}s`
        );

        // Render frame to canvas
        await this.renderFrame(currentTime);

        // Smart canvas verification - only check every 10th frame or when needed
        if (frame % 10 === 0 || frame === 0) {
          const imageData = this.ctx.getImageData(
            0,
            0,
            this.canvas.width,
            this.canvas.height
          );
          const pixels = imageData.data;
          let nonBlackPixels = 0;

          // Sample every 10th pixel for 10x faster checking
          const sampleRate = 10;
          for (let i = 0; i < pixels.length; i += 4 * sampleRate) {
            if (pixels[i] > 0 || pixels[i + 1] > 0 || pixels[i + 2] > 0) {
              nonBlackPixels++;
            }
          }

          // Adjust count for sampling
          nonBlackPixels *= sampleRate;

          if (nonBlackPixels === 0) {
            debugWarn(`[ExportEngine] BLACK FRAME at ${frame + 1}!`);
          } else if (frame % 30 === 0) {
            debugLog(
              `[ExportEngine] Frame ${frame + 1}: ~${nonBlackPixels} pixels (sampled)`
            );
          }
        }

        // Capture frame based on export method
        if (this.useFFmpegExport && this.ffmpegRecorder) {
          // For FFmpeg export, capture the canvas as PNG data
          const dataUrl = this.canvas.toDataURL("image/png");
          await this.ffmpegRecorder.addFrame(dataUrl, frame);
        } else {
          // For MediaRecorder, manually capture this frame to the stream
          if (videoTrack && "requestFrame" in videoTrack) {
            (videoTrack as any).requestFrame();
            // Frame capture delay for Electron compatibility
            await new Promise((resolve) => setTimeout(resolve, 50)); // Increased for better stability
          } else {
            debugWarn(`[ExportEngine] Cannot capture frame ${frame + 1}`);
          }
        }

        // Calculate advanced progress metrics with performance timing
        const now = Date.now();
        const elapsedTime = (now - startTime) / 1000; // seconds
        const frameProcessingTime = performance.now() - frameStartTime; // milliseconds
        const averageFrameTime = (elapsedTime * 1000) / (frame + 1); // milliseconds
        const encodingSpeed = (frame + 1) / elapsedTime; // fps

        // Log frame timing every 30 frames
        if (frame % 30 === 0) {
          debugLog(
            `[ExportEngine] Frame ${frame + 1} took ${frameProcessingTime.toFixed(1)}ms`
          );
        }

        // Estimate time remaining
        const remainingFrames = totalFrames - frame - 1;
        const estimatedTimeRemaining =
          remainingFrames * (averageFrameTime / 1000); // seconds

        // Update progress with advanced info
        const progress = (frame / totalFrames) * 95; // Reserve 5% for finalization
        const status = `Rendering frame ${frame + 1} of ${totalFrames} (${encodingSpeed.toFixed(1)} fps)`;

        // Call with advanced progress info
        if (progressCallback) {
          progressCallback(progress, status, {
            currentFrame: frame + 1,
            totalFrames,
            encodingSpeed,
            processedFrames: frame + 1,
            elapsedTime,
            averageFrameTime,
            estimatedTimeRemaining,
          });
        }

        // Minimal UI update delay
        if (frame % 10 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      }

      progressCallback?.(95, "Finalizing video...");

      // Stop recording and get final blob
      const videoBlob = await this.stopRecording();

      // Log exported video information
      debugLog(
        `[ExportEngine] 📦 Exported video size: ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`
      );
      debugLog(`[ExportEngine] 🔗 Blob type: ${videoBlob.type}`);

      // Calculate and log expected vs actual video duration
      const expectedDuration = this.totalDuration;
      const actualFramesRendered = this.calculateTotalFrames();
      const calculatedDuration = actualFramesRendered / this.fps;

      debugLog(
        `[ExportEngine] ⏱️  Expected duration: ${expectedDuration.toFixed(3)}s`
      );
      debugLog(
        `[ExportEngine] ⏱️  Calculated duration: ${calculatedDuration.toFixed(3)}s (${actualFramesRendered} frames / ${this.fps}fps)`
      );
      debugLog(
        `[ExportEngine] 📊 Duration ratio: ${(calculatedDuration / expectedDuration).toFixed(3)}x`
      );

      // Try to get actual video duration from blob (this requires creating a video element)
      this.logActualVideoDuration(videoBlob);

      progressCallback?.(100, "Export complete!");

      // Export investigation summary
      const totalFramesRendered = this.calculateTotalFrames();
      console.log("\n🎆 EXPORT INVESTIGATION SUMMARY:");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`🎥 Total frames rendered: ${totalFramesRendered}`);
      console.log(`⏱️ Export duration: ${(Date.now() - startTime) / 1000}s`);
      console.log(
        `💽 Video size: ${(videoBlob.size / (1024 * 1024)).toFixed(2)} MB`
      );

      // Count effects applied
      const allElements = new Set<string>();
      const elementsWithEffects = new Set<string>();
      this.tracks.forEach((track) => {
        track.elements.forEach((element) => {
          allElements.add(element.id);
          const effects = useEffectsStore
            .getState()
            .getElementEffects(element.id);
          if (effects && effects.length > 0) {
            elementsWithEffects.add(element.id);
          }
        });
      });

      console.log(
        `🎨 Elements with effects: ${elementsWithEffects.size}/${allElements.size}`
      );
      if (elementsWithEffects.size > 0) {
        console.log("✅ Effects were found and should be applied");
        console.log("⚠️ If effects are missing in export, check:");
        console.log("  1. Canvas filter support in export environment");
        console.log("  2. Context save/restore timing");
        console.log("  3. Effect parameter conversion");
      } else {
        console.log("❌ No effects found on any elements");
      }

      // Log summary of images used
      console.log(`\n🖼️ Images used in export: ${this.usedImages.size}`);
      if (this.usedImages.size > 0) {
        this.usedImages.forEach((imageId) => {
          const mediaItem = this.mediaItems.find((item) => item.id === imageId);
          if (mediaItem) {
            console.log(`  📸 ${mediaItem.name || 'Unnamed'} (ID: ${imageId})`);
          }
        });
      }
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      return videoBlob;
    } catch (error) {
      debugError("[ExportEngine] Export failed:", error);
      // Clean up on error
      if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
        this.mediaRecorder.stop();
      }
      if (this.ffmpegRecorder) {
        this.ffmpegRecorder.cleanup();
      }
      this.isExporting = false;
      throw error;
    } finally {
      this.isExporting = false;
      if (this.ffmpegRecorder) {
        this.ffmpegRecorder.cleanup();
        this.ffmpegRecorder = null;
      }
    }
  }

  // Cancel export
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }

    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.stop();
    }

    if (this.ffmpegRecorder) {
      this.ffmpegRecorder.cleanup();
      this.ffmpegRecorder = null;
    }

    this.isExporting = false;
    this.recordedChunks = []; // Clear any partial data
  }

  // Check if export is in progress
  isExportInProgress(): boolean {
    return this.isExporting;
  }

  // Check if export was cancelled (protected method for subclasses)
  protected isExportCancelled(): boolean {
    return this.abortController?.signal.aborted || false;
  }

  // Download video blob - adapted from zip-manager.ts downloadZipSafely
  async downloadVideo(blob: Blob, filename: string): Promise<void> {
    // Ensure filename has proper extension for the selected format
    const formatInfo = FORMAT_INFO[this.settings.format];
    const extension = formatInfo.extension;
    const finalFilename = filename.endsWith(extension)
      ? filename
      : `${filename}${extension}`;

    // Use modern File System Access API if available
    if ("showSaveFilePicker" in window) {
      try {
        const mimeType = blob.type || formatInfo.mimeTypes[0];
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: finalFilename,
          types: [
            {
              description: `${formatInfo.label} files`,
              accept: { [mimeType]: [extension] },
            },
          ],
        });

        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (error) {
        // Fall back to traditional download if user cancels or API unavailable
      }
    }

    // Traditional download with navigation bug prevention (borrowed from zip-manager.ts)
    const url = URL.createObjectURL(blob);

    // Create download in a way that prevents navigation
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (iframeDoc) {
      const link = iframeDoc.createElement("a");
      link.href = url;
      link.download = finalFilename;
      iframeDoc.body.appendChild(link);
      link.click();
      iframeDoc.body.removeChild(link);
    }

    // Cleanup blob URL after download
    setTimeout(() => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // Complete export with download
  async exportAndDownload(
    filename: string,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    const videoBlob = await this.export(progressCallback);
    await this.downloadVideo(videoBlob, filename);
  }

  // Validate rendered frame to avoid black frames
  private validateRenderedFrame(
    x: number,
    y: number,
    width: number,
    height: number,
    attempt: number
  ): { isValid: boolean; reason: string } {
    try {
      // Sample pixels in the rendered area
      const sampleWidth = Math.min(width, 50);
      const sampleHeight = Math.min(height, 50);
      const imageData = this.ctx.getImageData(x, y, sampleWidth, sampleHeight);
      const pixels = imageData.data;

      let nonBlackPixels = 0;
      let totalPixels = 0;

      // Check sampled pixels for non-black content
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const alpha = pixels[i + 3];

        totalPixels++;

        // Non-black and non-transparent pixels
        if ((r > 10 || g > 10 || b > 10) && alpha > 10) {
          nonBlackPixels++;
        }
      }

      const nonBlackRatio = nonBlackPixels / totalPixels;
      const minValidRatio = 0.05; // At least 5% of pixels should be non-black

      if (nonBlackRatio < minValidRatio) {
        return {
          isValid: false,
          reason: `Frame appears to be mostly black (${(nonBlackRatio * 100).toFixed(1)}% non-black pixels, attempt ${attempt})`,
        };
      }

      if (attempt > 1) {
        debugLog(
          `[ExportEngine] ✅ Frame validation passed on attempt ${attempt} (${(nonBlackRatio * 100).toFixed(1)}% content)`
        );
      }

      return { isValid: true, reason: "Frame is valid" };
    } catch (error) {
      debugWarn(`[ExportEngine] Frame validation error: ${error}`);
      // If validation itself fails, assume frame is valid
      return { isValid: true, reason: "Validation error - assuming valid" };
    }
  }

  // Get actual video duration from blob for debugging
  private logActualVideoDuration(videoBlob: Blob): void {
    const video = document.createElement("video");
    const url = URL.createObjectURL(videoBlob);

    video.onloadedmetadata = () => {
      const actualDuration = video.duration;
      const expectedDuration = this.totalDuration;

      debugLog(
        `[ExportEngine] 🎥 Actual video duration: ${actualDuration.toFixed(3)}s`
      );
      debugLog(
        `[ExportEngine] 📈 Timeline vs Video ratio: ${(actualDuration / expectedDuration).toFixed(3)}x`
      );

      if (Math.abs(actualDuration - expectedDuration) > 0.1) {
        debugWarn(
          `[ExportEngine] ⚠️  Duration mismatch detected! Expected: ${expectedDuration.toFixed(3)}s, Got: ${actualDuration.toFixed(3)}s`
        );
      } else {
        debugLog("[ExportEngine] ✅ Duration match within tolerance");
      }

      // Cleanup
      URL.revokeObjectURL(url);
    };

    video.onerror = () => {
      debugWarn("[ExportEngine] ⚠️  Could not determine actual video duration");
      URL.revokeObjectURL(url);
    };

    video.src = url;
  }

  // Pre-load all videos for performance (Task 1.5)
  protected async preloadAllVideos(): Promise<void> {
    const videoUrls = new Set<string>();

    // Collect unique video URLs
    this.mediaItems
      .filter((item) => item.type === "video" && item.url)
      .forEach((item) => videoUrls.add(item.url!));

    debugLog(`[ExportEngine] Pre-loading ${videoUrls.size} videos...`);

    // Load videos in parallel
    const loadPromises = Array.from(videoUrls).map((url) =>
      this.preloadVideo(url)
    );
    await Promise.all(loadPromises);

    debugLog(`[ExportEngine] Pre-loaded ${this.videoCache.size} videos`);
  }

  private async preloadVideo(url: string): Promise<void> {
    if (this.videoCache.has(url)) return;

    const video = document.createElement("video");
    video.src = url;
    video.crossOrigin = "anonymous";

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error(`Failed to load video: ${url}`));
    });

    this.videoCache.set(url, video);
  }
}
