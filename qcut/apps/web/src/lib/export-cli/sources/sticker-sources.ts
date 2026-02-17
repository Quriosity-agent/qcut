/**
 * Sticker Source Extraction
 *
 * Extracts sticker sources from overlay store for FFmpeg processing.
 * Downloads blob/data URLs to temp files since FFmpeg CLI cannot read them.
 *
 * Extracted from export-engine-cli.ts lines 667-855.
 */

import type { StickerSourceForFilter } from "../types";
import type { MediaItem } from "@/stores/media-store";
import { getStickerTimingMap } from "@/lib/sticker-timeline-query";
import { rasterizeSvgToPng, isSvgContent } from "./svg-rasterizer";

/**
 * Logger function type for dependency injection.
 */
type LogFn = (...args: unknown[]) => void;

/**
 * Sticker data from overlay store.
 */
interface StickerOverlayData {
  id: string;
  mediaItemId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  opacity?: number;
  rotation?: number;
  timing?: { startTime?: number; endTime?: number };
}

/**
 * Sticker export API interface.
 */
interface StickerExportAPI {
  saveStickerForExport: (params: {
    sessionId: string;
    stickerId: string;
    imageData: Uint8Array;
    format: string;
  }) => Promise<{ success: boolean; path?: string; error?: string }>;
}

/**
 * Stickers store getter interface.
 */
interface StickersStoreGetter {
  getStickersForExport: () => StickerOverlayData[];
}

/**
 * Download sticker blob/data URL to temp directory for FFmpeg CLI access.
 * SVG stickers are rasterized to PNG since FFmpeg has limited SVG support.
 *
 * @param sticker - Sticker data with ID
 * @param mediaItem - Media item with URL
 * @param sessionId - Export session ID
 * @param stickerAPI - Electron sticker export API
 * @param targetWidth - Target pixel width (used for SVG rasterization)
 * @param targetHeight - Target pixel height (used for SVG rasterization)
 * @param logger - Logger function
 * @returns Local file path
 * @throws Error if download fails
 */
async function downloadStickerToTemp(
  sticker: { id: string },
  mediaItem: MediaItem,
  sessionId: string,
  stickerAPI: StickerExportAPI,
  targetWidth: number,
  targetHeight: number,
  logger: LogFn
): Promise<string> {
  // Return existing local path if available (but not for SVGs — they need rasterization)
  if (mediaItem.localPath && !mediaItem.localPath.endsWith(".svg")) {
    logger(`[StickerSources] Using existing path: ${mediaItem.localPath}`);
    return mediaItem.localPath;
  }

  if (!mediaItem.url) {
    throw new Error(`No URL for sticker media item ${mediaItem.id}`);
  }

  // Fetch blob/data URL
  logger(`[StickerSources] Downloading sticker ${sticker.id}...`);
  const response = await fetch(mediaItem.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch sticker: ${response.status}`);
  }

  const blob = await response.blob();
  let imageBytes: Uint8Array;
  let format: string;

  // Rasterize SVG to PNG for FFmpeg compatibility
  if (isSvgContent(blob, mediaItem.url)) {
    logger(
      `[StickerSources] Rasterizing SVG sticker ${sticker.id} to PNG (${targetWidth}x${targetHeight})`
    );
    imageBytes = await rasterizeSvgToPng(blob, targetWidth, targetHeight);
    format = "png";
  } else {
    const arrayBuffer = await blob.arrayBuffer();
    imageBytes = new Uint8Array(arrayBuffer);
    format = blob.type?.split("/")[1] || "png";
    if (format === "svg+xml") format = "png"; // Shouldn't reach here, but safety
    if (format === "jpeg") format = "jpg";
  }

  const result = await stickerAPI.saveStickerForExport({
    sessionId,
    stickerId: sticker.id,
    imageData: imageBytes,
    format,
  });

  if (!result.success) {
    throw new Error(result.error || "Failed to save sticker");
  }

  if (!result.path) {
    throw new Error("Sticker saved but no path returned");
  }

  logger(`[StickerSources] Downloaded sticker to: ${result.path}`);
  return result.path;
}

/**
 * Extract sticker sources from overlay store for FFmpeg processing.
 * Downloads blob/data URLs to temp files since FFmpeg CLI cannot read them.
 *
 * @param mediaItems - Media items to look up sticker paths
 * @param sessionId - Export session ID for temp file naming
 * @param canvasWidth - Canvas width for position calculation
 * @param canvasHeight - Canvas height for position calculation
 * @param totalDuration - Total video duration for timing defaults
 * @param stickersStoreGetter - Function to get stickers store state
 * @param stickerAPI - Electron sticker export API
 * @param logger - Logger function
 * @returns Array of sticker sources sorted by z-index
 */
export async function extractStickerSources(
  mediaItems: MediaItem[],
  sessionId: string | null,
  canvasWidth: number,
  canvasHeight: number,
  totalDuration: number,
  stickersStoreGetter?: () => Promise<StickersStoreGetter>,
  stickerAPI?: StickerExportAPI,
  logger: LogFn = console.log
): Promise<StickerSourceForFilter[]> {
  logger("[StickerSources] Extracting sticker sources for FFmpeg overlay");

  if (!sessionId) {
    logger("[StickerSources] No session ID, skipping sticker extraction");
    return [];
  }

  try {
    // Get stickers store - use provided getter or dynamic import
    let stickersStore: StickersStoreGetter;
    if (stickersStoreGetter) {
      stickersStore = await stickersStoreGetter();
    } else {
      const { useStickersOverlayStore } = await import(
        "@/stores/stickers-overlay-store"
      );
      stickersStore = useStickersOverlayStore.getState();
    }

    const allStickers = stickersStore.getStickersForExport();

    if (allStickers.length === 0) {
      logger("[StickerSources] No stickers to export");
      return [];
    }

    logger(`[StickerSources] Processing ${allStickers.length} stickers`);

    // Get API - use provided or default
    const api =
      stickerAPI ?? (window.electronAPI?.ffmpeg as unknown as StickerExportAPI);
    if (!api?.saveStickerForExport) {
      logger("[StickerSources] Sticker export API not available");
      return [];
    }

    const stickerSources: StickerSourceForFilter[] = [];

    // Get timing from timeline (source of truth)
    const timingMap = getStickerTimingMap();

    for (const sticker of allStickers) {
      try {
        const mediaItem = mediaItems.find((m) => m.id === sticker.mediaItemId);
        if (!mediaItem) {
          logger(
            `[StickerSources] Media item not found for sticker ${sticker.id}`
          );
          continue;
        }

        // Convert percentage positions to pixel coordinates
        const baseSize = Math.min(canvasWidth, canvasHeight);
        const pixelX = (sticker.position.x / 100) * canvasWidth;
        const pixelY = (sticker.position.y / 100) * canvasHeight;
        const pixelWidth = (sticker.size.width / 100) * baseSize;
        const pixelHeight = (sticker.size.height / 100) * baseSize;

        // Download sticker to temp directory (SVGs are rasterized to PNG)
        const localPath = await downloadStickerToTemp(
          sticker,
          mediaItem,
          sessionId,
          api,
          Math.round(pixelWidth),
          Math.round(pixelHeight),
          logger
        );

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
          startTime: timingMap.get(sticker.id)?.startTime ?? 0,
          endTime: timingMap.get(sticker.id)?.endTime ?? totalDuration,
          zIndex: sticker.zIndex,
          opacity: sticker.opacity,
          rotation: sticker.rotation,
        });

        logger(
          `[StickerSources] Processed sticker ${sticker.id}: ${Math.round(pixelWidth)}x${Math.round(pixelHeight)} at (${Math.round(topLeftX)}, ${Math.round(topLeftY)})`
        );
      } catch (error) {
        logger(
          `[StickerSources] Failed to process sticker ${sticker.id}:`,
          error
        );
      }
    }

    stickerSources.sort((a, b) => a.zIndex - b.zIndex);
    logger(
      `[StickerSources] Extracted ${stickerSources.length} valid sticker sources`
    );
    return stickerSources;
  } catch (error) {
    logger("[StickerSources] Failed to extract sticker sources:", error);
    return [];
  }
}
