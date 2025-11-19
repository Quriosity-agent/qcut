import { create } from "zustand";
import { debugLog, debugError } from "@/lib/debug-config";
import { storageService } from "@/lib/storage/storage-service";
import { useTimelineStore } from "./timeline-store";
import { generateUUID, generateFileBasedId } from "@/lib/utils";
import { getVideoInfo, generateThumbnail } from "@/lib/ffmpeg-utils";
import { createObjectURL, revokeObjectURL } from "@/lib/blob-manager";
import {
  handleError,
  ErrorCategory,
  ErrorSeverity,
  handleStorageError,
  handleMediaProcessingError,
} from "@/lib/error-handler";
import type { MediaItem, MediaType } from "./media-store-types";

// Re-export types for backward compatibility
export type { MediaItem, MediaType } from "./media-store-types";

interface MediaStore {
  mediaItems: MediaItem[];
  isLoading: boolean;
  hasInitialized: boolean; // Track if the store has completed at least one load attempt

  // Actions - now require projectId
  addMediaItem: (
    projectId: string,
    item: Omit<MediaItem, "id"> & { id?: string }
  ) => Promise<string>;
  addGeneratedImages: (
    items: Array<{
      id?: string;
      url: string;
      type: MediaType;
      name: string;
      size: number;
      duration: number;
      metadata?: {
        source?: string;
        [key: string]: any;
      };
    }>
  ) => Promise<void>;
  removeMediaItem: (projectId: string, id: string) => Promise<void>;
  loadProjectMedia: (projectId: string) => Promise<void>;
  clearProjectMedia: (projectId: string) => Promise<void>;
  clearAllMedia: () => void; // Clear local state only
}

// Helper function to determine file type
export const getFileType = (file: File): MediaType | null => {
  const { type } = file;

  if (type.startsWith("image/")) {
    return "image";
  }
  if (type.startsWith("video/")) {
    return "video";
  }
  if (type.startsWith("audio/")) {
    return "audio";
  }

  return null;
};

// Helper function to get image dimensions
export const getImageDimensions = (
  file: File
): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const blobUrl = createObjectURL(file, "getImageDimensions");

    const cleanup = () => {
      img.remove();
      if (blobUrl) {
        revokeObjectURL(blobUrl);
      }
    };

    img.addEventListener("load", () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      cleanup();
      resolve({ width, height });
    });

    img.addEventListener("error", () => {
      cleanup();
      reject(new Error("Could not load image"));
    });

    img.src = blobUrl;
  });
};

// Instant video processing with defaults first, background metadata extraction
export const processVideoFile = async (file: File) => {
  // Return immediate defaults for instant UI response
  const defaultResult = {
    thumbnailUrl: undefined,
    width: 1920,
    height: 1080,
    duration: 0,
    fps: 30,
    processingMethod: "immediate" as const,
    error: undefined,
  };

  // Start background metadata extraction (don't await)
  extractVideoMetadataBackground(file);

  return defaultResult;
};

// Background metadata extraction without blocking UI
const extractVideoMetadataBackground = async (file: File) => {
  try {
    // Try browser processing first - it's fast and reliable
    const [thumbnailData, duration] = await Promise.all([
      generateVideoThumbnailBrowser(file),
      getMediaDuration(file),
    ]);

    const result = {
      thumbnailUrl: thumbnailData.thumbnailUrl,
      width: thumbnailData.width,
      height: thumbnailData.height,
      duration,
      fps: 30,
      processingMethod: "browser" as const,
    };

    // Update the media item with real metadata
    updateMediaMetadata(file, result);
    return result;
  } catch (browserError) {
    // Skip FFmpeg entirely to avoid the 60s timeout
    // Users get instant response with defaults, which is better UX
  }
};

// Helper to update media item metadata after background processing
const updateMediaMetadata = async (file: File, metadata: any) => {
  const mediaStore = useMediaStore.getState();
  const fileId = await generateFileBasedId(file);

  // Find and update the media item
  const updatedItems = mediaStore.mediaItems.map((item) => {
    if (item.id === fileId) {
      return {
        ...item,
        width: metadata.width,
        height: metadata.height,
        duration: metadata.duration,
        fps: metadata.fps,
        thumbnailUrl: metadata.thumbnailUrl,
      };
    }
    return item;
  });

  // Update the store
  useMediaStore.setState({ mediaItems: updatedItems });
};

// Helper function to generate video thumbnail using browser APIs (primary method)
export const generateVideoThumbnailBrowser = (
  file: File
): Promise<{ thumbnailUrl: string; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video") as HTMLVideoElement;
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      reject(new Error("Could not get canvas context"));
      return;
    }

    let blobUrl: string;

    const cleanup = () => {
      video.remove();
      canvas.remove();
      if (blobUrl) {
        revokeObjectURL(blobUrl);
      }
    };

    // Set timeout to prevent hanging
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Video thumbnail generation timed out"));
    }, 10_000);

    video.addEventListener("loadedmetadata", () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Seek to 1 second or 10% of duration, whichever is smaller
      video.currentTime = Math.min(1, video.duration * 0.1);
    });

    video.addEventListener("seeked", () => {
      try {
        clearTimeout(timeout);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const thumbnailUrl = canvas.toDataURL("image/jpeg", 0.8);
        const width = video.videoWidth;
        const height = video.videoHeight;

        resolve({ thumbnailUrl, width, height });
        cleanup();
      } catch (drawError) {
        cleanup();
        reject(
          new Error(
            `Canvas drawing failed: ${drawError instanceof Error ? drawError.message : String(drawError)}`
          )
        );
      }
    });

    video.addEventListener("error", (event) => {
      clearTimeout(timeout);
      cleanup();
      reject(
        new Error(
          `Video loading failed: ${video.error?.message || "Unknown error"}`
        )
      );
    });

    try {
      blobUrl = createObjectURL(file, "processVideoFile");
      video.src = blobUrl;
      video.load();
    } catch (urlError) {
      clearTimeout(timeout);
      cleanup();
      reject(
        new Error(
          `Failed to create object URL: ${urlError instanceof Error ? urlError.message : String(urlError)}`
        )
      );
    }
  });
};

// Helper function to get media duration
export const getMediaDuration = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const element = document.createElement(
      file.type.startsWith("video/") ? "video" : "audio"
    ) as HTMLMediaElement;
    let blobUrl: string | null = null;
    let cleanupTimeout: number | null = null;

    const cleanup = () => {
      if (cleanupTimeout) {
        clearTimeout(cleanupTimeout);
        cleanupTimeout = null;
      }
      element.remove();
      if (blobUrl) {
        // Delay cleanup to prevent timing conflicts
        setTimeout(() => {
          revokeObjectURL(blobUrl!);
        }, 100);
      }
    };

    // Set a reasonable timeout for media loading
    const timeoutId = setTimeout(() => {
      console.warn("[getMediaDuration] Timeout loading media:", file.name);
      cleanup();
      reject(new Error("Media loading timeout"));
    }, 10_000);

    element.addEventListener("loadedmetadata", () => {
      clearTimeout(timeoutId);
      const duration = element.duration;
      if (isNaN(duration) || duration <= 0) {
        cleanup();
        reject(new Error("Invalid media duration"));
        return;
      }

      // Delay cleanup to allow other processes to finish using the blob URL
      cleanupTimeout = window.setTimeout(() => {
        cleanup();
        resolve(duration);
      }, 50);
    });

    element.addEventListener("error", (e) => {
      clearTimeout(timeoutId);
      console.warn("[getMediaDuration] Media loading failed:", e);
      cleanup();
      reject(new Error("Could not load media"));
    });

    blobUrl = createObjectURL(file, "getMediaDuration");
    element.src = blobUrl;
    element.load();
  });
};

// Helper to get aspect ratio from MediaItem
export const getMediaAspectRatio = (item: MediaItem): number => {
  if (item.width && item.height) {
    return item.width / item.height;
  }
  return 16 / 9; // Default aspect ratio
};

export const useMediaStore = create<MediaStore>((set, get) => ({
  mediaItems: [],
  isLoading: false,
  hasInitialized: false,

  addMediaItem: async (projectId, item) => {
    console.log("step 6g: media-store addMediaItem", {
      projectId,
      id: item.id,
      hasFile: !!item.file,
      url: item.url,
      originalUrl: (item as any).originalUrl,
      size: item.file?.size,
      type: item.type,
    });
    // DEBUG: Log projectId parameter
    console.log(
      `[MediaStore.addMediaItem] Called with projectId: ${projectId}, item.name: ${item.name}`
    );

    // Generate consistent ID based on file properties if not provided
    let id = item.id;
    if (!id && item.file) {
      try {
        id = await generateFileBasedId(item.file);
        debugLog(
          `[MediaStore] Generated consistent ID for ${item.name}: ${id}`
        );
      } catch (error) {
        debugLog(
          "[MediaStore] Failed to generate file-based ID, using random UUID"
        );
        id = generateUUID();
      }
    } else if (!id) {
      id = generateUUID();
    }

    const newItem: MediaItem = {
      ...item,
      id,
    };

    console.log("[MediaStore.addMediaItem] Saving media item", {
      projectId,
      id: newItem.id,
      name: newItem.name,
      type: newItem.type,
      hasFile: !!newItem.file,
      fileSize: newItem.file?.size,
      url: newItem.url,
    });

    // Debug logging for ID generation (Task 1.3)
    debugLog(`[MediaStore] Generated ID for ${newItem.name}:`, {
      id: newItem.id,
      hasFile: !!newItem.file,
      providedId: item.id,
      generatedNew: !item.id && item.file,
    });

    // Add to local state immediately for UI responsiveness
    set((state) => ({
      mediaItems: [...state.mediaItems, newItem],
    }));

    // Save to persistent storage in background
    try {
      await storageService.saveMediaItem(projectId, newItem);
      console.log("[MediaStore.addMediaItem] Saved to storage", {
        projectId,
        id: newItem.id,
        name: newItem.name,
        type: newItem.type,
      });
      return newItem.id;
    } catch (error) {
      console.error(
        "[MediaStore.addMediaItem] Storage save FAILED, keeping item unsaved",
        {
          projectId,
          id: newItem.id,
          name: newItem.name,
          type: newItem.type,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      handleStorageError(error, "Add media item to storage", {
        projectId,
        itemId: newItem.id,
        itemType: newItem.type,
        itemName: newItem.name,
        operation: "saveMediaItem",
      });

      // Keep the item visible; mark as unsaved for UI/toast handling
      set((state) => ({
        mediaItems: state.mediaItems.map((media) =>
          media.id === newItem.id
            ? {
                ...media,
                metadata: {
                  ...media.metadata,
                  unsaved: true,
                  storageError:
                    error instanceof Error ? error.message : String(error),
                },
              }
            : media
        ),
      }));
      throw error;
    }
  },

  addGeneratedImages: async (items) => {
    // Import utilities for COEP-safe image loading
    const { convertToBlob, needsBlobConversion, downloadImageAsFile } =
      await import("@/lib/image-utils");

    const newItems: MediaItem[] = await Promise.all(
      items.map(async (item) => {
        let processedUrl = item.url;
        let file: File;

        try {
          // Convert fal.media URLs to blob URLs to bypass COEP restrictions
          if (needsBlobConversion(item.url)) {
            processedUrl = await convertToBlob(item.url);
          }

          // Download the image as a proper File object for storage
          file = await downloadImageAsFile(item.url, item.name);
        } catch (error) {
          handleMediaProcessingError(error, "Process generated image", {
            imageName: item.name,
            imageUrl: item.url,
            operation: "downloadGeneratedImage",
            showToast: false, // Don't spam users during batch operations
          });

          // Create empty file as fallback
          file = new File([], item.name, { type: "image/jpeg" });
          // Keep original URL as fallback
          processedUrl = item.url;
        }

        // Create URL for immediate display - use data URL for SVGs to avoid blob URL issues in Electron
        let displayUrl = processedUrl;
        if (file.size > 0) {
          // Special handling for SVG files - use data URL instead of blob URL
          if (
            file.type === "image/svg+xml" ||
            file.name.toLowerCase().endsWith(".svg")
          ) {
            try {
              const text = await file.text();
              displayUrl = `data:image/svg+xml;base64,${btoa(text)}`;
            } catch (error) {
              displayUrl = createObjectURL(file, "addMediaItem-svg-fallback");
            }
          } else {
            displayUrl = createObjectURL(file, "addMediaItem-display");
          }
        }

        return {
          id: item.id ?? generateUUID(), // Preserve existing ID if provided
          name: item.name,
          type: item.type,
          file, // Now contains actual image data
          url: displayUrl, // Use object URL created from the actual file
          duration: item.duration,
          metadata: {
            ...item.metadata,
            originalUrl: item.url, // Keep original URL for reference
          },
        };
      })
    );

    // Add to local state immediately
    set((state) => ({
      mediaItems: [...state.mediaItems, ...newItems],
    }));

    // Save each generated image to persistent storage
    // Get the current project ID from the store
    try {
      const { useProjectStore } = await import("@/stores/project-store");
      const currentProject = useProjectStore.getState().activeProject;

      if (currentProject) {
        await Promise.all(
          newItems.map(async (item) => {
            try {
              await storageService.saveMediaItem(currentProject.id, item);
            } catch (error) {
              handleStorageError(error, "Save generated image to storage", {
                projectId: currentProject.id,
                itemId: item.id,
                itemName: item.name,
                operation: "saveGeneratedImage",
                showToast: false, // Don't spam during batch save
              });
            }
          })
        );
      } else {
      }
    } catch (error) {}
  },

  removeMediaItem: async (projectId: string, id: string) => {
    const state = get();
    const item = state.mediaItems.find((media) => media.id === id);

    // For generated images with fal.media origins, clean up using the cache
    if (item?.metadata?.originalUrl) {
      const { revokeBlobUrl } = await import("@/lib/image-utils");
      revokeBlobUrl(item.metadata.originalUrl);
    }
    // For other blob URLs (like video thumbnails), revoke directly
    else if (
      item?.url &&
      item.url.startsWith("blob:") &&
      !item.metadata?.originalUrl
    ) {
      revokeObjectURL(item.url);
    }
    if (item?.thumbnailUrl && item.thumbnailUrl.startsWith("blob:")) {
      revokeObjectURL(item.thumbnailUrl);
    }

    // 1) Remove from local state immediately
    set((state) => ({
      mediaItems: state.mediaItems.filter((media) => media.id !== id),
    }));

    // 2) Cascade into the timeline: remove any elements using this media ID
    const timeline = useTimelineStore.getState();
    const {
      tracks,
      removeElementFromTrack,
      removeElementFromTrackWithRipple,
      rippleEditingEnabled,
      pushHistory,
    } = timeline;

    // Find all elements that reference this media
    const elementsToRemove: Array<{ trackId: string; elementId: string }> = [];
    for (const track of tracks) {
      for (const el of track.elements) {
        if (el.type === "media" && el.mediaId === id) {
          elementsToRemove.push({ trackId: track.id, elementId: el.id });
        }
      }
    }

    // If there are elements to remove, push history once before batch removal
    if (elementsToRemove.length > 0) {
      pushHistory();

      // Remove all elements without pushing additional history entries
      for (const { trackId, elementId } of elementsToRemove) {
        if (rippleEditingEnabled) {
          removeElementFromTrackWithRipple(trackId, elementId, false);
        } else {
          removeElementFromTrack(trackId, elementId, false);
        }
      }
    }

    // 3) Remove from persistent storage
    try {
      await storageService.deleteMediaItem(projectId, id);
    } catch (error) {
      debugError("[MediaStore] deleteMediaItem failed", {
        projectId,
        id,
        error,
      });
    }
  },

  loadProjectMedia: async (projectId) => {
    set({ isLoading: true });
    debugLog(`[MediaStore] Loading media for project: ${projectId}`);

    try {
      const mediaItems = await storageService.loadAllMediaItems(projectId);
      debugLog(
        `[MediaStore] Loaded ${mediaItems.length} media items from storage`
      );

      // Process media items with enhanced error handling
      const updatedMediaItems = await Promise.all(
        mediaItems.map(async (item) => {
          if (item.type === "video" && item.file) {
            try {
              const processResult = await processVideoFile(item.file);

              return {
                ...item,
                thumbnailUrl: processResult.thumbnailUrl || item.thumbnailUrl,
                width: processResult.width || item.width,
                height: processResult.height || item.height,
                duration: processResult.duration || item.duration,
                fps: processResult.fps || item.fps,
                metadata: {
                  ...item.metadata,
                  processingMethod: processResult.processingMethod,
                },
              };
            } catch (error) {
              handleMediaProcessingError(
                error,
                "Process video during project load",
                {
                  videoName: item.name,
                  itemId: item.id,
                  operation: "processVideoOnLoad",
                  showToast: false, // Don't spam during batch loading
                }
              );

              // Return item with error metadata to prevent complete failure
              return {
                ...item,
                metadata: {
                  ...item.metadata,
                  processingError: `Video processing failed: ${error instanceof Error ? error.message : String(error)}`,
                  processingMethod: "failed",
                },
              };
            }
          }
          return item;
        })
      );

      set({ mediaItems: updatedMediaItems, hasInitialized: true });
      debugLog(
        `[MediaStore] ✅ Media loading complete: ${updatedMediaItems.length} items`
      );
    } catch (error) {
      handleStorageError(error, "Load project media items", {
        projectId,
        operation: "loadAllMediaItems",
      });

      // Set empty array to prevent undefined state
      set({ mediaItems: [], hasInitialized: true });
    } finally {
      set({ isLoading: false });
    }
  },

  clearProjectMedia: async (projectId) => {
    const state = get();
    let revokedCount = 0;

    // Enhanced cleanup with better URL tracking and logging
    state.mediaItems.forEach((item) => {
      if (item.url && item.url.startsWith("blob:")) {
        revokeObjectURL(item.url);
        debugLog(
          `[Cleanup] Revoked blob URL for ${item.name} (project: ${projectId}): ${item.url}`
        );
        revokedCount++;
      }
      if (item.thumbnailUrl && item.thumbnailUrl.startsWith("blob:")) {
        revokeObjectURL(item.thumbnailUrl);

        revokedCount++;
      }
    });

    // Clear local state
    set({ mediaItems: [] });

    // Also clean up orphaned stickers when media is cleared
    try {
      const { useStickersOverlayStore } = await import(
        "@/stores/stickers-overlay-store"
      );
      const stickerStore = useStickersOverlayStore.getState();
      if (stickerStore.overlayStickers.size > 0) {
        debugLog(
          `[MediaStore] Media cleared, cleaning up ${stickerStore.overlayStickers.size} orphaned stickers`
        );
        stickerStore.cleanupInvalidStickers([]); // Empty array = all stickers are invalid
      }
    } catch (error) {
      debugError(
        "[MediaStore] Failed to cleanup stickers after media clear:",
        error
      );
    }

    // Clear persistent storage
    try {
      const mediaIds = state.mediaItems.map((item) => item.id);
      await Promise.all(
        mediaIds.map((id) => storageService.deleteMediaItem(projectId, id))
      );
      debugLog(
        `[Cleanup] Cleared ${mediaIds.length} media items from persistent storage for project ${projectId}`
      );
    } catch (error) {}
  },

  clearAllMedia: () => {
    const state = get();
    let revokedCount = 0;

    // Enhanced cleanup with better URL tracking and logging
    state.mediaItems.forEach((item) => {
      if (item.url && item.url.startsWith("blob:")) {
        revokeObjectURL(item.url);
        debugLog(`[Cleanup] Revoked blob URL for ${item.name}: ${item.url}`);
        revokedCount++;
      }
      if (item.thumbnailUrl && item.thumbnailUrl.startsWith("blob:")) {
        revokeObjectURL(item.thumbnailUrl);
        debugLog(
          `[Cleanup] Revoked thumbnail blob URL for ${item.name}: ${item.thumbnailUrl}`
        );
        revokedCount++;
      }
    });

    debugLog(
      `[Cleanup] Revoked ${revokedCount} blob URLs from ${state.mediaItems.length} media items`
    );

    // Clear local state
    set({ mediaItems: [] });
  },
}));
