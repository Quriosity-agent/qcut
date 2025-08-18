/**
 * Sticker Export Helper
 *
 * Utilities for rendering overlay stickers to canvas during video export.
 * Integrates with the export engine to composite stickers on top of video frames.
 */

import type { OverlaySticker } from "@/types/sticker-overlay";
import type { MediaItem } from "@/stores/media-store-types";

/**
 * Interface for sticker render options
 */
export interface StickerRenderOptions {
  canvasWidth: number;
  canvasHeight: number;
  currentTime?: number;
  opacity?: number;
}

/**
 * Helper class for rendering stickers during export
 */
export class StickerExportHelper {
  private imageCache = new Map<string, HTMLImageElement>();

  /**
   * Render stickers to canvas at specified time
   */
  async renderStickersToCanvas(
    ctx: CanvasRenderingContext2D,
    stickers: OverlaySticker[],
    mediaItems: Map<string, MediaItem>,
    options: StickerRenderOptions
  ): Promise<void> {
    const { canvasWidth, canvasHeight, currentTime = 0 } = options;

    // Stickers are already filtered by export engine via getVisibleStickersAtTime()
    // No need to filter again - just sort by z-index to render in correct order
    const sortedStickers = stickers.sort((a, b) => a.zIndex - b.zIndex);

    // Render each sticker
    for (const sticker of sortedStickers) {
      const mediaItem = mediaItems.get(sticker.mediaItemId);
      if (!mediaItem) {
        continue;
      }

      try {
        await this.renderSticker(
          ctx,
          sticker,
          mediaItem,
          canvasWidth,
          canvasHeight
        );
      } catch (error) {}
    }
  }

  /**
   * Render individual sticker to canvas
   */
  private async renderSticker(
    ctx: CanvasRenderingContext2D,
    sticker: OverlaySticker,
    mediaItem: MediaItem,
    canvasWidth: number,
    canvasHeight: number
  ): Promise<void> {
    // Skip if no URL
    if (!mediaItem.url) {
      return;
    }

    // Load image from cache or create new
    const img = await this.loadImage(mediaItem.url);

    // FIX: Calculate dimensions preserving aspect ratio
    // Use the smaller dimension (height) as reference to maintain square aspect ratio for stickers
    const baseSize = Math.min(canvasWidth, canvasHeight);
    const width = (sticker.size.width / 100) * baseSize;
    const height = (sticker.size.height / 100) * baseSize;

    // Calculate pixel position from percentage
    // IMPORTANT: position.x and position.y represent the CENTER of the sticker (not top-left)
    // This matches the preview which uses transform: translate(-50%, -50%)
    const centerX = (sticker.position.x / 100) * canvasWidth;
    const centerY = (sticker.position.y / 100) * canvasHeight;

    // Calculate top-left corner for positioning
    const x = centerX - width / 2;
    const y = centerY - height / 2;

    // Save context state
    ctx.save();

    // Apply transformations
    ctx.globalAlpha = sticker.opacity;

    // Translate to center of sticker for rotation
    // (centerX and centerY already calculated above from position percentages)
    ctx.translate(centerX, centerY);

    // Apply rotation
    if (sticker.rotation !== 0) {
      ctx.rotate((sticker.rotation * Math.PI) / 180);
    }

    // Draw image centered at origin
    try {
      ctx.drawImage(img, -width / 2, -height / 2, width, height);
    } catch (error) {}

    // Restore context state
    ctx.restore();
  }

  /**
   * Load and cache image
   */
  private async loadImage(url: string): Promise<HTMLImageElement> {
    // Check cache first
    if (this.imageCache.has(url)) {
      const cached = this.imageCache.get(url)!;
      return cached;
    }

    // Load new image
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";

      img.onload = () => {
        this.imageCache.set(url, img);
        resolve(img);
      };

      img.onerror = (error) => {
        reject(new Error(`Failed to load image: ${url}`));
      };

      img.src = url;
    });
  }

  /**
   * Clear image cache to free memory
   */
  clearCache(): void {
    this.imageCache.clear();
  }

  /**
   * Pre-load sticker images for better performance
   */
  async preloadStickers(
    stickers: OverlaySticker[],
    mediaItems: Map<string, MediaItem>
  ): Promise<void> {
    const uniqueUrls = new Set<string>();

    for (const sticker of stickers) {
      const mediaItem = mediaItems.get(sticker.mediaItemId);
      if (mediaItem?.url) {
        uniqueUrls.add(mediaItem.url);
      }
    }

    // Load all images in parallel
    const loadPromises = Array.from(uniqueUrls).map((url) =>
      this.loadImage(url).catch((error) => {})
    );

    await Promise.all(loadPromises);
  }
}

/**
 * Singleton instance for easy access
 */
let stickerExportHelper: StickerExportHelper | null = null;

/**
 * Get or create sticker export helper instance
 */
export function getStickerExportHelper(): StickerExportHelper {
  if (!stickerExportHelper) {
    stickerExportHelper = new StickerExportHelper();
  }
  return stickerExportHelper;
}

/**
 * Convenience function to render stickers to canvas
 */
export async function renderStickersToCanvas(
  ctx: CanvasRenderingContext2D,
  stickers: OverlaySticker[],
  mediaItems: Map<string, MediaItem>,
  options: StickerRenderOptions
): Promise<void> {
  const helper = getStickerExportHelper();
  await helper.renderStickersToCanvas(ctx, stickers, mediaItems, options);
}
