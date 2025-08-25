/**
 * StickerCanvas Component
 *
 * Main overlay canvas that renders all stickers on top of the video preview.
 * Uses absolute positioning to avoid affecting the video/timeline layout.
 */

import React, { useRef, useEffect, memo } from "react";
import { useStickersOverlayStore } from "@/stores/stickers-overlay-store";
import { useAsyncMediaStore } from "@/hooks/use-async-media-store";
import { cn } from "@/lib/utils";
import { debugLog } from "@/lib/debug-config";
import { StickerElement } from "./StickerElement";
import { StickerOverlayAutoSave } from "./AutoSave";
import { useProjectStore } from "@/stores/project-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { Button } from "@/components/ui/button";

/**
 * Main canvas component that manages all overlay stickers
 */
export const StickerCanvas: React.FC<{
  className?: string;
  disabled?: boolean;
}> = memo(({ className, disabled = false }) => {
  const canvasRef = useRef<HTMLDivElement>(null);

  // Store subscriptions
  const {
    overlayStickers,
    selectedStickerId,
    selectSticker,
    loadFromProject,
    saveToProject,
    cleanupInvalidStickers,
    getVisibleStickersAtTime,
  } = useStickersOverlayStore();

  const {
    store: mediaStore,
    loading: mediaStoreLoading,
    error: mediaStoreError,
  } = useAsyncMediaStore();
  const mediaItems = mediaStore?.mediaItems || [];
  const { activeProject } = useProjectStore();
  const { currentTime } = usePlaybackStore();

  // Debug state tracking for timing analysis (Task 2.1)
  useEffect(() => {
    if (overlayStickers.size > 0) {
      console.log("[StickerCanvas] Media availability check:", {
        mediaItemsLoaded: mediaItems.length,
        mediaIds: mediaItems.map((m) => ({ id: m.id, name: m.name })),
        stickersWaitingForMedia: Array.from(overlayStickers.values()).filter(
          (s) => !mediaItems.find((m) => m.id === s.mediaItemId)
        ).length,
        timestamp: new Date().toISOString(),
      });

      // Additional timing debug
      console.log("[StickerCanvas] Timing Debug:", {
        timestamp: new Date().toISOString(),
        mediaStoreReady: !mediaStoreLoading,
        mediaCount: mediaItems.length,
        stickerCount: overlayStickers.size,
        currentTime,
        visibleStickersCount: getVisibleStickersAtTime(currentTime).length,
      });
    }
  }, [
    mediaItems.length,
    overlayStickers.size,
    mediaStoreLoading,
    currentTime,
    getVisibleStickersAtTime,
  ]);

  // Migration: Fix media items with wrong MIME type
  useEffect(() => {
    const fixMimeTypes = () => {
      mediaItems.forEach((mediaItem) => {
        if (
          mediaItem.type === "image" &&
          mediaItem.url?.startsWith("data:application/octet-stream") &&
          mediaItem.url.includes("PHN2ZyB4bWxu") // Base64 start of SVG
        ) {
          // Extract the base64 data
          const base64Data = mediaItem.url.split(",")[1];
          if (base64Data) {
            // Create correct data URL
            const correctedUrl = `data:image/svg+xml;base64,${base64Data}`;

            // Update the media item URL in place
            mediaItem.url = correctedUrl;
          }
        }
      });
    };

    if (mediaItems.length > 0) {
      fixMimeTypes();
    }
  }, [mediaItems]);

  // Handle clicking on canvas (deselect)
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current) {
      selectSticker(null);
    }
  };

  // Handle drag and drop from media panel
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();

    const mediaItemData = e.dataTransfer.getData("application/x-media-item");
    if (!mediaItemData) return;

    try {
      const mediaItem = JSON.parse(mediaItemData);
      debugLog(
        "[StickerCanvas] 🎯 DROP DETECTED: Adding sticker from drag-and-drop",
        mediaItem
      );

      // Only allow images and videos as stickers
      if (mediaItem.type === "image" || mediaItem.type === "video") {
        const { addOverlaySticker } = useStickersOverlayStore.getState();

        // Calculate drop position as percentage
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * 100;

          addOverlaySticker(mediaItem.id, {
            position: {
              x: Math.min(Math.max(x, 0), 100),
              y: Math.min(Math.max(y, 0), 100),
            },
            timing: { startTime: currentTime, endTime: currentTime + 5 }, // 5 second default duration
          });

          debugLog(
            "[StickerCanvas] ✅ DRAG-DROP FIX: Added sticker at position",
            { x, y }
          );
        } else {
          // Fallback to center position
          addOverlaySticker(mediaItem.id, {
            timing: { startTime: currentTime, endTime: currentTime + 5 }, // 5 second default duration
          });
          debugLog(
            "[StickerCanvas] ✅ DRAG-DROP FIX: Added sticker at center (fallback)"
          );
        }
      }
    } catch (error) {
      debugLog("[StickerCanvas] ❌ DROP ERROR:", error);
    }
  };

  // Manual save for testing
  const handleManualSave = async () => {
    if (!activeProject?.id) return;
    debugLog("[StickerCanvas] Manual save triggered");
    await saveToProject(activeProject.id);
  };

  // Clean up stickers with missing media items when media loads
  // Add a delay to avoid race conditions during project loading
  useEffect(() => {
    if (mediaItems.length > 0 && overlayStickers.size > 0) {
      const timeoutId = setTimeout(() => {
        const mediaIds = mediaItems.map((item) => item.id);

        debugLog(
          `[StickerCanvas] Cleanup check - Media count: ${mediaItems.length}, Sticker count: ${overlayStickers.size}`
        );
        debugLog("[StickerCanvas] Cleanup check - Media IDs:", mediaIds);
        debugLog(
          "[StickerCanvas] Cleanup check - Sticker media IDs:",
          Array.from(overlayStickers.values()).map((s) => s.mediaItemId)
        );

        // Only cleanup if we're confident media has fully loaded
        // This helps prevent premature cleanup during initial load
        if (mediaItems.length > 0) {
          cleanupInvalidStickers(mediaIds);
        } else if (overlayStickers.size > 0 && !mediaStoreLoading) {
          // If we have stickers but no media and store is not loading,
          // these are likely orphaned stickers that should be cleaned up
          console.log(
            `[StickerCanvas] Found ${overlayStickers.size} stickers with no media items - cleaning up orphaned stickers`
          );
          cleanupInvalidStickers([]);
        } else {
          debugLog(
            "[StickerCanvas] Skipping cleanup - no media items loaded yet or store is loading"
          );
        }
      }, 2000); // Increased to 2 seconds to ensure media is fully loaded

      return () => clearTimeout(timeoutId);
    }
  }, [
    mediaItems,
    overlayStickers.size,
    cleanupInvalidStickers,
    overlayStickers,
  ]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedStickerId || disabled) return;

      // Delete key removes selected sticker
      if (e.key === "Delete" || e.key === "Backspace") {
        const { removeOverlaySticker } = useStickersOverlayStore.getState();
        removeOverlaySticker(selectedStickerId);
      }

      // Escape deselects
      if (e.key === "Escape") {
        selectSticker(null);
      }

      // Ctrl/Cmd + Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        const { undo } = useStickersOverlayStore.getState();
        undo();
      }

      // Ctrl/Cmd + Shift + Z for redo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        const { redo } = useStickersOverlayStore.getState();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedStickerId, disabled, selectSticker]);

  // Get only visible stickers at current time - moved before hooks
  const visibleStickers = getVisibleStickersAtTime(currentTime);

  // Don't render if disabled - moved after all hooks
  if (disabled) return null;

  // Debug logging for sticker visibility - moved before early return
  // This needs to be before any conditional returns to avoid hooks order issues
  useEffect(() => {
    if (overlayStickers.size > 0) {
      console.log("[StickerCanvas] State check:", {
        totalStickers: overlayStickers.size,
        visibleStickers: visibleStickers.length,
        currentTime,
        mediaItemsCount: mediaItems.length,
        mediaStoreLoading,
        mediaStoreError: !!mediaStoreError,
      });

      const stickerDetails = Array.from(overlayStickers.values()).map(
        (sticker) => ({
          id: sticker.id,
          mediaItemId: sticker.mediaItemId,
          timing: sticker.timing,
          position: sticker.position,
          hasMediaItem: mediaItems.some(
            (item) => item.id === sticker.mediaItemId
          ),
          isVisible:
            currentTime >= (sticker.timing?.startTime || 0) &&
            currentTime <= (sticker.timing?.endTime || Infinity),
        })
      );
      console.log("[StickerCanvas] Sticker details:", stickerDetails);
    }
  }, [
    overlayStickers.size,
    visibleStickers.length,
    currentTime,
    mediaItems.length,
    mediaStoreLoading,
    mediaStoreError,
  ]);

  // Show loading state while media store is loading
  if (mediaStoreLoading && overlayStickers.size > 0) {
    return (
      <div className="absolute inset-0 z-50 pointer-events-none">
        <div className="absolute top-2 right-2 text-xs bg-black/50 text-white px-2 py-1 rounded">
          Loading media...
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Auto-save component */}
      <StickerOverlayAutoSave />

      <div
        ref={canvasRef}
        className={cn("absolute inset-0 z-50 pointer-events-auto", className)}
        onClick={handleCanvasClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        data-testid="sticker-canvas"
        style={{
          isolation: "isolate", // Create new stacking context
        }}
      >
        {/* Render stickers using StickerElement */}
        {visibleStickers.map((sticker) => {
          const mediaItem = mediaItems.find(
            (item) => item.id === sticker.mediaItemId
          );

          // Show placeholder if media item not found (it might still be loading)
          if (!mediaItem) {
            // Only log error if media store is not loading
            if (!mediaStoreLoading) {
              console.warn(
                `[StickerCanvas] ⚠️ MEDIA MISSING: Media item not found for sticker ${sticker.id}, mediaItemId: ${sticker.mediaItemId}. Available media: ${mediaItems.length}`,
                {
                  stickerMediaId: sticker.mediaItemId,
                  availableMediaIds: mediaItems.map((m) => ({
                    id: m.id,
                    name: m.name,
                  })),
                  sticker,
                  mediaStoreLoading,
                }
              );
            }
            // Show a placeholder to indicate missing media
            return (
              <div
                key={sticker.id}
                className="absolute border-2 border-dashed border-yellow-500 bg-yellow-500/10 flex items-center justify-center text-xs text-yellow-600 pointer-events-none"
                style={{
                  left: `${sticker.position.x}%`,
                  top: `${sticker.position.y}%`,
                  width: `${sticker.size?.width || 20}%`,
                  height: `${sticker.size?.height || 20}%`,
                  transform: `translate(-50%, -50%) rotate(${sticker.rotation || 0}deg)`,
                }}
              >
                {mediaStoreLoading ? "Loading..." : "Media Missing"}
              </div>
            );
          }

          return (
            <StickerElement
              key={sticker.id}
              sticker={sticker}
              mediaItem={mediaItem}
              canvasRef={canvasRef}
            />
          );
        })}

        {/* Show placeholder when empty */}
        {overlayStickers.size === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-muted-foreground text-sm opacity-0">
              {/* Hidden placeholder for layout */}
            </div>
          </div>
        )}

        {/* Debug info */}
        {import.meta.env.DEV && (
          <div className="absolute top-2 right-2 flex gap-2 pointer-events-none">
            <div className="text-xs bg-black/50 text-white px-2 py-1 rounded">
              Stickers: {overlayStickers.size}
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleManualSave}
              className="pointer-events-auto text-xs h-6"
            >
              Save Test
            </Button>
          </div>
        )}
      </div>
    </>
  );
});

StickerCanvas.displayName = "StickerCanvas";

/**
 * Export a version that can be used in different contexts
 */
export const StickerOverlay = StickerCanvas;
