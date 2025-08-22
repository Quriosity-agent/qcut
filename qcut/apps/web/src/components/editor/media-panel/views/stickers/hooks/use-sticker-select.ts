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
      console.log(`[StickerSelect] Starting selection for ${iconId} (${name})`);
      debugLog(`[StickerSelect] Starting selection for ${iconId} (${name})`);
      
      if (!activeProject) {
        console.error("[StickerSelect] No project selected");
        debugError("[StickerSelect] No project selected");
        toast.error("No project selected");
        return;
      }

      let createdObjectUrl: string | null = null;
      try {
        // Download the actual SVG content with transparency
        const [collection, icon] = iconId.split(":");

        if (!collection || !icon) {
          debugError(`[StickerSelect] Invalid sticker ID format: ${iconId}`);
          toast.error("Invalid sticker ID format");
          return;
        }
        
        console.log(`[StickerSelect] Downloading SVG for ${collection}:${icon}`);
        debugLog(`[StickerSelect] Downloading SVG for ${collection}:${icon}`);
        const svgContent = await downloadIconSvg(collection, icon, {
          // No color specified to maintain transparency
          width: 512,
          height: 512,
        });
        console.log(`[StickerSelect] SVG downloaded, length: ${svgContent.length}`);
        console.log(`[StickerSelect] SVG content preview:`, svgContent.substring(0, 200) + '...');
        debugLog(`[StickerSelect] SVG downloaded, length: ${svgContent.length}`);
        
        if (!svgContent || svgContent.trim().length === 0) {
          console.error(`[StickerSelect] Empty SVG content for ${iconId}`);
          throw new Error('Empty SVG content');
        }

        // Create a Blob from the downloaded SVG content
        console.log(`[StickerSelect] Creating SVG blob from content, length: ${svgContent.length}`);
        const svgBlob = createSvgBlob(svgContent);
        console.log(`[StickerSelect] SVG blob created:`, svgBlob);
        
        const svgFile = new File([svgBlob], `${name}.svg`, {
          type: "image/svg+xml;charset=utf-8",
        });
        console.log(`[StickerSelect] Created SVG file: ${svgFile.name}, size: ${svgFile.size}`);
        debugLog(`[StickerSelect] Created SVG file: ${svgFile.name}, size: ${svgFile.size}`);

        // For Electron (file:// protocol), use data URL instead of blob URL
        let imageUrl: string;
        console.log(`[StickerSelect] Current protocol: ${window.location.protocol}`);

        if (window.location.protocol === "file:") {
          // Use URL-encoded data URL to support non-ASCII SVG content
          const encoded = encodeURIComponent(svgContent);
          imageUrl = `data:image/svg+xml;charset=utf-8,${encoded}`;
          console.log(`[StickerSelect] Using data URL (Electron), length: ${imageUrl.length}`);
          debugLog(`[StickerSelect] Using data URL (Electron), length: ${imageUrl.length}`);
        } else {
          // Use blob URL for web environment
          createdObjectUrl = URL.createObjectURL(svgBlob);
          imageUrl = createdObjectUrl;
          objectUrlsRef.current.add(imageUrl);
          console.log(`[StickerSelect] Using blob URL (Web): ${imageUrl}`);
          debugLog(`[StickerSelect] Using blob URL (Web): ${imageUrl}`);
        }
        console.log(`[StickerSelect] Final imageUrl: ${imageUrl}`);

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
        console.log(`[StickerSelect] Adding media item:`, mediaItem);
        debugLog(`[StickerSelect] Adding media item:`, mediaItem);
        
        const mediaItemId = await addMediaItem(activeProject.id, mediaItem);
        console.log(`[StickerSelect] Media item added with ID: ${mediaItemId}`);
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
