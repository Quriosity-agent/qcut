import type { TimelineElement } from "@/types/timeline";
import type { MediaItem } from "@/stores/media-store-types";
import { debugLog, debugError, debugWarn } from "@/lib/debug-config";
import { renderStickersToCanvas } from "@/lib/stickers/sticker-export-helper";
import { useStickersOverlayStore } from "@/stores/stickers-overlay-store";
import { useMediaStore } from "@/stores/media-store";
import { useEffectsStore } from "@/stores/effects-store";
import {
  applyEffectsToCanvas,
  mergeEffectParameters,
} from "@/lib/effects-utils";
import { applyAdvancedCanvasEffects } from "@/lib/effects-canvas-advanced";
import { EFFECTS_ENABLED } from "@/config/features";
import {
  getActiveElements,
  calculateElementBounds,
} from "./export-engine-utils";
import { validateRenderedFrame } from "./export-engine-debug";

/** Context passed to renderer functions */
export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tracks: import("@/types/timeline").TimelineTrack[];
  mediaItems: MediaItem[];
  videoCache: Map<string, HTMLVideoElement>;
  usedImages: Set<string>;
  fps: number;
}

/** Render a single frame at the specified time */
export async function renderFrame(
  context: RenderContext,
  currentTime: number
): Promise<void> {
  const { ctx, canvas } = context;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Fill with background color (black)
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const activeElements = getActiveElements(
    context.tracks,
    context.mediaItems,
    currentTime
  );

  // Log frame rendering details for first frame and every 30th frame
  if (currentTime === 0 || Math.floor(currentTime * context.fps) % 30 === 0) {
    console.log(
      `🎨 FRAME RENDER: Time=${currentTime.toFixed(2)}s, Elements=${activeElements.length}`
    );
  }

  // Sort elements by track type (render bottom to top)
  const sortedElements = activeElements.sort((a, b) => {
    if (a.track.type === "text" && b.track.type !== "text") return 1;
    if (b.track.type === "text" && a.track.type !== "text") return -1;
    if (a.track.type === "audio" && b.track.type !== "audio") return -1;
    if (b.track.type === "audio" && a.track.type !== "audio") return 1;
    return 0;
  });

  // Render each active element
  for (const { element, mediaItem } of sortedElements) {
    await renderElement(context, element, mediaItem, currentTime);
  }

  // Render overlay stickers on top of everything
  await renderOverlayStickers(context, currentTime);
}

/** Render individual element (media or text) */
async function renderElement(
  context: RenderContext,
  element: TimelineElement,
  mediaItem: MediaItem | null,
  currentTime: number
): Promise<void> {
  const elementTimeOffset = currentTime - element.startTime;

  if (element.type === "media" && mediaItem) {
    await renderMediaElement(context, element, mediaItem, elementTimeOffset);
  } else if (element.type === "text") {
    renderTextElement(context.ctx, element);
  }
}

/** Render media elements (images/videos) */
async function renderMediaElement(
  context: RenderContext,
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
      await renderImage(context, element, mediaItem);
    } else if (mediaItem.type === "video") {
      await renderVideo(context, element, mediaItem, timeOffset);
    }
  } catch (error) {
    debugError(`[ExportEngine] Failed to render ${element.id}:`, error);
  }
}

/** Render image element with effects support */
export async function renderImage(
  context: RenderContext,
  element: TimelineElement,
  mediaItem: MediaItem
): Promise<void> {
  const { ctx, canvas } = context;

  // Track which image is being used
  context.usedImages.add(mediaItem.id);

  console.log(
    `🖼️ EXPORT: Using image - ID: ${mediaItem.id}, Name: ${mediaItem.name || "Unnamed"}, URL: ${mediaItem.url}`
  );

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const { x, y, width, height } = calculateElementBounds(
          element,
          img.width,
          img.height,
          canvas.width,
          canvas.height
        );

        console.log(
          `🖼️ EXPORT: Rendered image "${mediaItem.name || mediaItem.id}" at position (${x}, ${y}) with size ${width}x${height}`
        );

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
              ctx.save();
              const mergedParams = mergeEffectParameters(
                ...enabledEffects.map((e) => e.parameters)
              );
              console.log(
                "🔨 EXPORT ENGINE: Applying effects to image canvas:",
                mergedParams
              );
              applyEffectsToCanvas(ctx, mergedParams);
              ctx.drawImage(img, x, y, width, height);
              applyAdvancedCanvasEffects(ctx, mergedParams);
              ctx.restore();
            } else {
              console.log(
                `🚫 EXPORT ENGINE: No enabled effects for image element ${element.id}, drawing normally`
              );
              ctx.drawImage(img, x, y, width, height);
            }
          } catch (error) {
            console.error(
              `❌ EXPORT ENGINE: Effects failed for image element ${element.id}:`,
              error
            );
            debugWarn(`[Export] Effects failed for ${element.id}:`, error);
            ctx.drawImage(img, x, y, width, height);
          }
        } else {
          ctx.drawImage(img, x, y, width, height);
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

/** Render video element with retry mechanism */
export async function renderVideo(
  context: RenderContext,
  element: TimelineElement,
  mediaItem: MediaItem,
  timeOffset: number
): Promise<void> {
  if (!mediaItem.url) {
    debugWarn(`[ExportEngine] No URL for video element ${element.id}`);
    return;
  }

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await renderVideoAttempt(
        context,
        element,
        mediaItem,
        timeOffset,
        attempt
      );
      return;
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        debugWarn(
          `[ExportEngine] Video render attempt ${attempt} failed, retrying... Error: ${error}`
        );
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
      }
    }
  }

  debugError(
    `[ExportEngine] All ${maxRetries} video render attempts failed for ${mediaItem.url}`
  );
  throw lastError || new Error("Video rendering failed after retries");
}

/** Single video render attempt */
async function renderVideoAttempt(
  context: RenderContext,
  element: TimelineElement,
  mediaItem: MediaItem,
  timeOffset: number,
  attempt: number
): Promise<void> {
  const { ctx, canvas, videoCache } = context;

  try {
    let video = videoCache.get(mediaItem.url!);
    if (!video) {
      video = document.createElement("video");
      video.src = mediaItem.url!;
      video.crossOrigin = "anonymous";

      await new Promise<void>((resolve, reject) => {
        video!.onloadeddata = () => resolve();
        video!.onerror = () => reject(new Error("Failed to load video"));
      });

      videoCache.set(mediaItem.url!, video);
    }

    const seekTime = timeOffset + element.trimStart;
    video.currentTime = seekTime;

    await new Promise<void>((resolve, reject) => {
      const baseTimeout = 500;
      const maxTimeout = 2000;
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
        setTimeout(() => {
          resolve();
        }, 150);
      };
    });

    const { x, y, width, height } = calculateElementBounds(
      element,
      video.videoWidth,
      video.videoHeight,
      canvas.width,
      canvas.height
    );

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
            console.log(
              `🚫 EXPORT ENGINE: No enabled effects for video element ${element.id}, drawing normally`
            );
            ctx.drawImage(video, x, y, width, height);
            return;
          }

          ctx.save();
          const mergedParams = mergeEffectParameters(
            ...activeEffects.map((e) => e.parameters)
          );
          console.log(
            "🔨 EXPORT ENGINE: Applying effects to video canvas:",
            mergedParams
          );
          applyEffectsToCanvas(ctx, mergedParams);
          ctx.drawImage(video, x, y, width, height);
          applyAdvancedCanvasEffects(ctx, mergedParams);
          ctx.restore();
        } else {
          console.log(
            `🚫 EXPORT ENGINE: No effects found for video element ${element.id}, drawing normally`
          );
          ctx.drawImage(video, x, y, width, height);
        }
      } catch (error) {
        console.error(
          `❌ EXPORT ENGINE: Video effects failed for element ${element.id}:`,
          error
        );
        debugWarn(`[Export] Video effects failed for ${element.id}:`, error);
        ctx.drawImage(video, x, y, width, height);
      }
    } else {
      ctx.drawImage(video, x, y, width, height);
    }

    const frameValidation = validateRenderedFrame(
      ctx,
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
    throw error;
  }
}

/** Render overlay stickers on top of video */
export async function renderOverlayStickers(
  context: RenderContext,
  currentTime: number
): Promise<void> {
  let visibleStickers: any[] = [];
  try {
    const stickersStore = useStickersOverlayStore.getState();
    visibleStickers = stickersStore.getVisibleStickersAtTime(currentTime);

    debugLog(`[STICKER_FRAME] Frame time: ${currentTime.toFixed(3)}s`);
    debugLog(
      `[STICKER_FRAME] Found ${visibleStickers.length} stickers for this frame`
    );

    if (visibleStickers.length === 0) {
      return;
    }

    debugLog(
      "[STICKER_FRAME] Sticker IDs:",
      visibleStickers.map((s) => s.id)
    );

    const mediaStore = useMediaStore.getState();
    const mediaItemsMap = new Map(
      mediaStore.mediaItems.map((item) => [item.id, item])
    );

    const renderResult = await renderStickersToCanvas(
      context.ctx,
      visibleStickers,
      mediaItemsMap,
      {
        canvasWidth: context.canvas.width,
        canvasHeight: context.canvas.height,
        currentTime,
      }
    );

    if (renderResult.successful > 0) {
      debugLog(
        `[ExportEngine] Rendered ${renderResult.successful}/${renderResult.attempted} stickers at time ${currentTime.toFixed(3)}s`
      );
    }

    if (renderResult.failed.length > 0) {
      debugWarn(
        `[ExportEngine] ${renderResult.failed.length} stickers failed to render at time ${currentTime.toFixed(3)}s:`,
        renderResult.failed.map((f) => `${f.stickerId}: ${f.error}`).join(", ")
      );
    }
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
  }
}

/** Render text element */
export function renderTextElement(
  ctx: CanvasRenderingContext2D,
  element: TimelineElement
): void {
  if (element.type !== "text") return;
  if (!element.content || !element.content.trim()) return;

  ctx.fillStyle = element.color || "#ffffff";
  ctx.font = `${element.fontSize || 24}px ${element.fontFamily || "Arial"}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const x = element.type === "text" ? element.x || 50 : 50;
  const y = element.type === "text" ? element.y || 50 : 50;

  ctx.fillText(element.content, x, y);
}
