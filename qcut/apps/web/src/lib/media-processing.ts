import { toast } from "sonner";
import {
  getMediaStoreUtils,
  type MediaItem,
} from "@/stores/media-store-loader";
import { getFFmpegUtilFunctions } from "@/lib/ffmpeg-utils-loader";
import { debugLog, debugError, debugWarn } from "@/lib/debug-config";

export interface ProcessedMediaItem extends Omit<MediaItem, "id"> {}

export async function processMediaFiles(
  files: FileList | File[],
  onProgress?: (progress: number) => void
): Promise<ProcessedMediaItem[]> {
  console.log("[Media Processing] 🚀 Starting processMediaFiles with", files.length, "files");
  
  try {
  debugLog(
    "[Media Processing] 🚀 Starting processMediaFiles with",
    files.length,
    "files"
  );
  const fileArray = Array.from(files);
  const processedItems: ProcessedMediaItem[] = [];

  console.log("[Media Processing] 📊 Initial processedItems array length:", processedItems.length);
  debugLog("[Media Processing] 📊 Initial processedItems array length:", processedItems.length);

  // Load utilities dynamically
  console.log("[Media Processing] 📦 Loading media store utilities...");
  debugLog("[Media Processing] 📦 Loading media store utilities...");
  const mediaUtils = await getMediaStoreUtils();
  console.log("[Media Processing] ✅ Media store utilities loaded");
  debugLog("[Media Processing] ✅ Media store utilities loaded");
  
  console.log("[Media Processing] 📦 Loading FFmpeg utilities...");
  debugLog("[Media Processing] 📦 Loading FFmpeg utilities...");
  const ffmpegUtils = await getFFmpegUtilFunctions();
  console.log("[Media Processing] ✅ FFmpeg utilities loaded");
  debugLog("[Media Processing] ✅ FFmpeg utilities loaded");

  const total = fileArray.length;
  let completed = 0;

  for (const file of fileArray) {
    debugLog(
      `[Media Processing] 🎬 Processing file: ${file.name} (${file.type}, ${(file.size / 1024 / 1024).toFixed(2)} MB)`
    );

    console.log("[Media Processing] 🔍 About to call getFileType for:", file.name, "Type:", typeof mediaUtils.getFileType);
    debugLog("[Media Processing] 🔍 About to call getFileType for:", file.name, "Type:", typeof mediaUtils.getFileType);
    const fileType = mediaUtils.getFileType(file);
    console.log(`[Media Processing] 📝 Detected file type: ${fileType} for file: ${file.name} (${file.type})`);
    debugLog(`[Media Processing] 📝 Detected file type: ${fileType} for file: ${file.name} (${file.type})`);

    if (!fileType) {
      debugWarn(
        `[Media Processing] ❌ Unsupported file type: ${file.name} (${file.type})`
      );
      toast.error(`Unsupported file type: ${file.name}`);
      debugLog("[Media Processing] 📊 Skipping file, processedItems length:", processedItems.length);
      continue;
    }

    debugLog("[Media Processing] ✅ File type detected successfully, proceeding with processing");

    // Create URL that works in both web and Electron environments
    let url: string;
    const isFileProtocol =
      typeof window !== "undefined" && window.location.protocol === "file:";
    if (isFileProtocol && fileType === "image") {
      // For images in Electron, use data URL for better compatibility
      debugLog(
        `[Media Processing] Using data URL for image in Electron: ${file.name}`
      );
      url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
          } else {
            reject(new Error("Failed to read file as data URL"));
          }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    } else {
      // Use blob URL for web environment or non-image files
      debugLog(
        `[Media Processing] Using blob URL for ${fileType}: ${file.name}`
      );
      url = URL.createObjectURL(file);
    }

    let thumbnailUrl: string | undefined;
    let duration: number | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let fps: number | undefined;

    try {
      if (fileType === "image") {
        debugLog(`[Media Processing] 🖼️ Processing image: ${file.name}`);
        // Get image dimensions
        const dimensions = await mediaUtils.getImageDimensions(file);
        width = dimensions.width;
        height = dimensions.height;
        debugLog(`[Media Processing] ✅ Image processed: ${width}x${height}`);
      } else if (fileType === "video") {
        debugLog(`[Media Processing] 🎥 Processing video: ${file.name}`);
        try {
          debugLog(
            "[Media Processing] 🌐 Using browser APIs for video processing (primary method)..."
          );
          const videoResult = await mediaUtils.generateVideoThumbnail(file);
          debugLog(
            "[Media Processing] ✅ Browser thumbnail generated:",
            videoResult
          );
          thumbnailUrl = videoResult.thumbnailUrl;
          width = videoResult.width;
          height = videoResult.height;

          debugLog("[Media Processing] ⏱️ Getting video duration...");
          duration = await mediaUtils.getMediaDuration(file);

          // Set default FPS for browser processing (FFmpeg can override later if needed)
          fps = 30;

          // Optionally try to enhance with FFmpeg data if available (non-blocking)
          try {
            debugLog(
              "[Media Processing] 🔧 Attempting to enhance with FFmpeg data..."
            );
            const videoInfo = await Promise.race([
              ffmpegUtils.getVideoInfo(file),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error("FFmpeg enhancement timeout")),
                  5000
                )
              ),
            ]);
            debugLog(
              "[Media Processing] ✅ FFmpeg enhancement successful:",
              videoInfo
            );
            // Only override FPS from FFmpeg, keep browser-generated thumbnail and dimensions
            fps = videoInfo.fps || fps;
          } catch (ffmpegError) {
            debugLog(
              "[Media Processing] ℹ️ FFmpeg enhancement failed (using browser data):",
              ffmpegError instanceof Error
                ? ffmpegError.message
                : String(ffmpegError)
            );
            // Continue with browser-generated data - this is not an error
          }
        } catch (error) {
          debugWarn(
            "[Media Processing] Browser processing failed, falling back to FFmpeg:",
            error
          );

          // Fallback to FFmpeg processing
          try {
            debugLog(
              "[Media Processing] 🔧 Attempting FFmpeg fallback processing..."
            );
            const videoInfo = await ffmpegUtils.getVideoInfo(file);
            debugLog(
              "[Media Processing] ✅ FFmpeg getVideoInfo successful:",
              videoInfo
            );
            duration = videoInfo.duration;
            width = videoInfo.width;
            height = videoInfo.height;
            fps = videoInfo.fps;

            debugLog(
              "[Media Processing] 🖼️ Generating thumbnail with FFmpeg..."
            );
            // Skip FFmpeg thumbnail generation if video dimensions are invalid
            if (width === 0 || height === 0) {
              debugWarn(
                `[Media Processing] ⚠️ Skipping FFmpeg thumbnail due to invalid dimensions (${width}x${height})`
              );
              throw new Error(
                "Invalid video dimensions for thumbnail generation"
              );
            }
            // Generate thumbnail using FFmpeg
            thumbnailUrl = await ffmpegUtils.generateThumbnail(file, 1);
            debugLog(
              "[Media Processing] ✅ FFmpeg fallback processing successful"
            );
          } catch (ffmpegError) {
            debugWarn(
              "[Media Processing] ⚠️ FFmpeg fallback also failed, using minimal processing:",
              ffmpegError
            );

            // Minimal processing - just basic file info
            try {
              duration = await mediaUtils.getMediaDuration(file);
            } catch (durationError) {
              debugWarn(
                "[Media Processing] ⚠️ Duration extraction failed:",
                durationError
              );
              duration = 0; // Default duration
            }

            // Set default dimensions for failed processing
            width = 1920;
            height = 1080;
            fps = 30;
            thumbnailUrl = undefined;

            debugLog("[Media Processing] ✅ Minimal processing completed");
          }
        }
      } else if (fileType === "audio") {
        debugLog(`[Media Processing] 🎵 Processing audio: ${file.name}`);
        // For audio, we don't set width/height/fps (they'll be undefined)
        duration = await mediaUtils.getMediaDuration(file);
        debugLog("[Media Processing] ✅ Audio duration extracted:", duration);
      }

      const processedItem = {
        name: file.name,
        type: fileType,
        file,
        url,
        thumbnailUrl,
        duration,
        width,
        height,
        fps,
      };

      debugLog("[Media Processing] ➕ Adding processed item:", {
        name: processedItem.name,
        type: processedItem.type,
        url: processedItem.url ? "SET" : "UNSET",
        thumbnailUrl: processedItem.thumbnailUrl ? "SET" : "UNSET",
        duration: processedItem.duration,
        width: processedItem.width,
        height: processedItem.height,
        fps: processedItem.fps,
      });

      processedItems.push(processedItem);
      debugLog("[Media Processing] 📊 After adding item, processedItems length:", processedItems.length);

      // Yield back to the event loop to keep the UI responsive
      await new Promise((resolve) => setTimeout(resolve, 0));

      completed += 1;
      if (onProgress) {
        const percent = Math.round((completed / total) * 100);
        onProgress(percent);
        debugLog(
          `[Media Processing] 📊 Progress: ${percent}% (${completed}/${total})`
        );
      }
    } catch (error) {
      debugError(
        "[Media Processing] ❌ Critical error processing file:",
        file.name,
        error
      );

      // Don't completely abort - try to add the file with minimal info
      try {
        debugLog("[Media Processing] 🔧 Attempting to add file with minimal processing:", file.name);
        const minimalItem = {
          name: file.name,
          type: fileType,
          file,
          url,
          thumbnailUrl: undefined,
          duration:
            fileType === "video" || fileType === "audio" ? 0 : undefined,
          width:
            fileType === "video" || fileType === "image" ? 1920 : undefined,
          height:
            fileType === "video" || fileType === "image" ? 1080 : undefined,
          fps: fileType === "video" ? 30 : undefined,
        };
        
        processedItems.push(minimalItem);
        debugLog("[Media Processing] 📊 After minimal processing, processedItems length:", processedItems.length);

        debugLog(
          "[Media Processing] ✅ Added file with minimal processing:",
          file.name
        );
        toast.warning(`${file.name} added with limited processing`);
      } catch (addError) {
        debugError(
          "[Media Processing] ❌ Failed to add file even with minimal processing:",
          addError
        );
        toast.error(`Failed to process ${file.name}`);
        URL.revokeObjectURL(url); // Clean up on complete failure
      }
    }
  }

  console.log("[Media Processing] 🏁 Final processedItems length before return:", processedItems.length);
  console.log("[Media Processing] 📋 Final processedItems:", processedItems.map(item => ({ name: item.name, type: item.type })));
  debugLog("[Media Processing] 🏁 Final processedItems length before return:", processedItems.length);
  debugLog("[Media Processing] 📋 Final processedItems:", processedItems.map(item => ({ name: item.name, type: item.type })));
  return processedItems;
  
  } catch (globalError) {
    console.error("[Media Processing] 🚨 GLOBAL ERROR in processMediaFiles:", globalError);
    debugError("[Media Processing] 🚨 GLOBAL ERROR in processMediaFiles:", globalError);
    return [];
  }
}

/**
 * Convert FAL.ai media URLs to blob URLs to avoid CORS/COEP issues
 */
export async function convertFalImageToBlob(imageUrl: string): Promise<string> {
  if (!imageUrl.includes("fal.media")) {
    debugLog("[FAL Image] URL is not a fal.media URL, returning as-is");
    return imageUrl;
  }

  try {
    debugLog("[FAL Image] Converting fal.media URL to blob:", imageUrl);
    const response = await fetch(imageUrl, {
      mode: "cors",
      headers: {
        "Accept": "image/*",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    debugLog("[FAL Image] ✅ Successfully converted to blob URL:", blobUrl);
    return blobUrl;
  } catch (error) {
    debugError("[FAL Image] ❌ Failed to convert to blob:", error);
    // Fallback to original URL - better to try than completely fail
    return imageUrl;
  }
}
