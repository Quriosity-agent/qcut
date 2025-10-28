import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { useMediaStore } from "@/stores/media-store";
import { useProjectStore } from "@/stores/project-store";
import { useStickersStore } from "@/stores/stickers-store";
import { useStickersOverlayStore } from "@/stores/stickers-overlay-store";
import { downloadIconSvg, createSvgBlob } from "@/lib/iconify-api";
import { debugLog, debugError } from "@/lib/debug-config";

export function useStickerSelect() {
  const addMediaItem = useMediaStore((s) => s.addMediaItem);
  const activeProject = useProjectStore((s) => s.activeProject);
  const addRecentSticker = useStickersStore((s) => s.addRecentSticker);
  const addOverlaySticker = useStickersOverlayStore((s) => s.addOverlaySticker);

  // Track object URLs for cleanup
  const objectUrlsRef = useRef<Set<string>>(new Set());

  const handleStickerSelect = useCallback(
    async (iconId: string, name: string): Promise<string | undefined> => {
      debugLog(`[StickerSelect] Starting selection for ${iconId} (${name})`);

      if (!activeProject) {
        debugError("[StickerSelect] No project selected");
        toast.error("No project selected");
        return;
      }

      // DEBUG: Log activeProject.id
      console.log(
        `[StickerSelect] activeProject.id = ${activeProject.id}, iconId = ${iconId}`
      );

      let createdObjectUrl: string | null = null;
      try {
        // Download the actual SVG content with transparency
        const [collection, icon] = iconId.split(":");

        if (!collection || !icon) {
          debugError(`[StickerSelect] Invalid sticker ID format: ${iconId}`);
          toast.error("Invalid sticker ID format");
          return;
        }

        debugLog(`[StickerSelect] Downloading SVG for ${collection}:${icon}`);
        const svgContent = await downloadIconSvg(collection, icon, {
          // No color specified to maintain transparency
          width: 512,
          height: 512,
        });
        debugLog(
          `[StickerSelect] SVG downloaded, length: ${svgContent.length}`
        );

        if (!svgContent || svgContent.trim().length === 0) {
          throw new Error("Empty SVG content");
        }

        // Create a Blob from the downloaded SVG content
        const svgBlob = createSvgBlob(svgContent);

        const svgFile = new File([svgBlob], `${name}.svg`, {
          type: "image/svg+xml;charset=utf-8",
        });
        debugLog(
          `[StickerSelect] Created SVG file: ${svgFile.name}, size: ${svgFile.size}`
        );

        // For Electron (file:// protocol), use data URL instead of blob URL
        let imageUrl: string;

        if (window.location.protocol === "file:") {
          // Use URL-encoded data URL to support non-ASCII SVG content
          const encoded = encodeURIComponent(svgContent);
          imageUrl = `data:image/svg+xml;charset=utf-8,${encoded}`;
          debugLog(
            `[StickerSelect] Using data URL (Electron), length: ${imageUrl.length}`
          );
        } else {
          // Use blob URL for web environment
          createdObjectUrl = URL.createObjectURL(svgBlob);
          imageUrl = createdObjectUrl;
          objectUrlsRef.current.add(imageUrl);
          debugLog(`[StickerSelect] Using blob URL (Web): ${imageUrl}`);
        }

        const mediaItem = {
          name: `${name}.svg`,
          type: "image" as const,
          file: svgFile,
          url: imageUrl,
          thumbnailUrl: imageUrl,
          width: 512,
          height: 512,
          duration: 0,
        };
        debugLog("[StickerSelect] Adding media item:", mediaItem);

        const mediaItemId = await addMediaItem(activeProject.id, mediaItem);
        debugLog(`[StickerSelect] Media item added with ID: ${mediaItemId}`);

        // Add to recent stickers
        addRecentSticker(iconId, name);

        toast.success(`Added ${name} to media library`);

        // Return the media item ID for potential overlay use
        return mediaItemId;
      } catch (error) {
        debugError(`[StickerSelect] Error adding sticker ${iconId}:`, error);
        if (createdObjectUrl) {
          URL.revokeObjectURL(createdObjectUrl);
          objectUrlsRef.current.delete(createdObjectUrl);
        }
        toast.error("Failed to add sticker to project");
        return;
      }
    },
    [activeProject, addMediaItem, addRecentSticker]
  );

  // New function to add sticker directly to overlay
  const handleStickerSelectToOverlay = useCallback(
    async (iconId: string, name: string) => {
      // First add to media, then to overlay
      const mediaItemId = await handleStickerSelect(iconId, name);
      if (mediaItemId) {
        addOverlaySticker(mediaItemId);
      } else {
      }
    },
    [handleStickerSelect, addOverlaySticker]
  );

  const cleanupObjectUrls = useCallback(() => {
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current.clear();
  }, []);

  return {
    handleStickerSelect,
    handleStickerSelectToOverlay,
    cleanupObjectUrls,
    objectUrlsRef,
  };
}
