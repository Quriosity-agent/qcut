/**
 * Image Editing API Client for FAL.ai Models
 * Supports SeedEdit v3, FLUX Pro Kontext, FLUX Pro Kontext Max, FLUX 2 Flex Edit,
 * SeedDream v4, Nano Banana, Reve Edit, and Gemini 3 Pro Edit
 */

import { handleAIServiceError } from "./error-handler";
import { UPSCALE_MODEL_ENDPOINTS, type UpscaleModelId } from "./upscale-models";
import {
  getModelCapabilities,
  type ImageEditModelId,
  type ModelCapability,
  MODEL_CAPABILITIES,
  IMAGE_EDIT_MODEL_IDS,
} from "./image-edit-capabilities";

// Re-export capabilities for convenience
export {
  getModelCapabilities,
  type ImageEditModelId,
  type ModelCapability,
  MODEL_CAPABILITIES,
  IMAGE_EDIT_MODEL_IDS,
} from "./image-edit-capabilities";

const FAL_API_KEY = import.meta.env.VITE_FAL_API_KEY;
const FAL_API_BASE = "https://fal.run";

// Environment check removed for production

export interface ImageEditRequest {
  /** @deprecated Use imageUrls instead for multi-image support */
  imageUrl?: string;
  /** Array of image URLs - supports multi-image models */
  imageUrls?: string[];
  prompt: string;
  model: ImageEditModelId;
  guidanceScale?: number;
  steps?: number;
  seed?: number;
  safetyTolerance?: number;
  numImages?: number;

  // New V4-specific parameters
  imageSize?: string | number; // String presets ("square_hd", "square", etc.) or custom pixel values for V4
  maxImages?: number; // 1-10 for V4
  syncMode?: boolean; // V4, Nano Banana, Reve Edit, and Gemini 3 Pro Edit
  enableSafetyChecker?: boolean; // V4
  outputFormat?: "jpeg" | "png" | "webp"; // Nano Banana, Reve Edit, and Gemini 3 Pro Edit (lowercase required by FAL API)

  // Gemini 3 Pro Edit specific parameters
  resolution?: "1K" | "2K" | "4K";
  aspectRatio?: string; // auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16

  // GPT Image 1.5 Edit specific parameters
  background?: "auto" | "transparent" | "opaque";
  inputFidelity?: "low" | "high";
  quality?: "low" | "medium" | "high";
}

export interface ImageUpscaleRequest {
  imageUrl: string;
  model: UpscaleModelId;
  scaleFactor?: number;
  denoise?: number;
  creativity?: number;
  overlappingTiles?: boolean;
  outputFormat?: "png" | "jpeg" | "webp";
}

export interface ImageEditResponse {
  job_id: string;
  status: "processing" | "completed" | "failed";
  message: string;
  result_url?: string;
  seed_used?: number;
  processing_time?: number;
}

export type ImageEditProgressCallback = (status: {
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  message?: string;
  elapsedTime?: number;
  estimatedTime?: number;
}) => void;

interface ModelEndpoint {
  endpoint: string;
  defaultParams: Record<string, any>;
}

export const MODEL_ENDPOINTS: Record<string, ModelEndpoint> = {
  "seededit": {
    endpoint: "fal-ai/bytedance/seededit/v3/edit-image",
    defaultParams: {
      guidance_scale: 1.0,
    },
  },
  "flux-kontext": {
    endpoint: "fal-ai/flux-pro/kontext",
    defaultParams: {
      guidance_scale: 3.5,
      num_inference_steps: 28,
      safety_tolerance: 2,
      num_images: 1,
    },
  },
  "flux-kontext-max": {
    endpoint: "fal-ai/flux-pro/kontext/max",
    defaultParams: {
      guidance_scale: 3.5,
      num_inference_steps: 28,
      safety_tolerance: 2,
      num_images: 1,
    },
  },

  // Add new SeedDream V4 endpoint
  "seeddream-v4": {
    endpoint: "fal-ai/bytedance/seedream/v4/edit",
    defaultParams: {
      image_size: "square_hd",
      max_images: 1,
      sync_mode: false,
      enable_safety_checker: true,
      num_images: 1,
    },
  },

  // Add SeedDream V4.5 Edit endpoint
  "seeddream-v4-5-edit": {
    endpoint: "fal-ai/bytedance/seedream/v4.5/edit",
    defaultParams: {
      image_size: "auto_2K",
      max_images: 1,
      sync_mode: false,
      enable_safety_checker: true,
      num_images: 1,
    },
  },

  // Add Nano Banana endpoint
  "nano-banana": {
    endpoint: "fal-ai/nano-banana/edit",
    defaultParams: {
      num_images: 1,
      output_format: "png",
      sync_mode: false,
    },
  },

  // Add Reve Edit endpoint
  "reve-edit": {
    endpoint: "fal-ai/reve/edit",
    defaultParams: {
      num_images: 1,
      output_format: "png",
      sync_mode: false,
    },
  },

  // Add Gemini 3 Pro Edit endpoint
  "gemini-3-pro-edit": {
    endpoint: "fal-ai/gemini-3-pro-image-preview/edit",
    defaultParams: {
      num_images: 1,
      output_format: "png",
      resolution: "1K",
      aspect_ratio: "auto",
      sync_mode: false,
    },
  },

  // Add FLUX 2 Flex Edit endpoint
  "flux-2-flex-edit": {
    endpoint: "fal-ai/flux-2-flex/edit",
    defaultParams: {
      guidance_scale: 3.5,
      num_inference_steps: 28,
      safety_tolerance: 2,
      enable_prompt_expansion: true,
      num_images: 1,
      output_format: "jpeg",
      sync_mode: false,
    },
  },

  // GPT Image 1.5 Edit endpoint
  "gpt-image-1-5-edit": {
    endpoint: "fal-ai/gpt-image-1.5/edit",
    defaultParams: {
      image_size: "auto",
      background: "auto",
      quality: "high",
      input_fidelity: "high",
      num_images: 1,
      output_format: "png",
      sync_mode: false,
    },
  },

  // Upscale models
  "crystal-upscaler": {
    endpoint: UPSCALE_MODEL_ENDPOINTS["crystal-upscaler"],
    defaultParams: {
      scale_factor: 4,
      denoise: 0.45,
      output_format: "png",
    },
  },
  "seedvr-upscale": {
    endpoint: UPSCALE_MODEL_ENDPOINTS["seedvr-upscale"],
    defaultParams: {
      scale_factor: 6,
      denoise: 0.35,
      creativity: 0.4,
      output_format: "png",
    },
  },
  "topaz-upscale": {
    endpoint: UPSCALE_MODEL_ENDPOINTS["topaz-upscale"],
    defaultParams: {
      scale_factor: 6,
      denoise: 0.25,
      overlapping_tiles: true,
      output_format: "png",
    },
  },
};

/**
 * Upload image to FAL.ai and get URL
 */
export async function uploadImageToFAL(imageFile: File): Promise<string> {
  if (!FAL_API_KEY) {
    throw new Error("FAL API key not configured");
  }

  console.log("📤 UPLOAD: Starting upload process for:", {
    fileName: imageFile.name,
    fileSize: imageFile.size,
    fileType: imageFile.type,
  });

  // Use base64 data URL as primary method (reliable and fast)
  console.log("🔄 UPLOAD: Using base64 data URL (primary method)...");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result) {
        let dataUrl = reader.result as string;

        // Fix malformed MIME type if needed
        if (dataUrl.startsWith("data:image;base64,")) {
          // Determine proper MIME type from file type or default to PNG
          const mimeType = imageFile.type || "image/png";
          const base64Data = dataUrl.split(",")[1];
          dataUrl = `data:${mimeType};base64,${base64Data}`;
          console.log("🔧 UPLOAD: Fixed MIME type in data URL");
        }

        console.log(
          "✅ UPLOAD: Image successfully converted to base64 data URL for FAL API"
        );
        console.log("🔍 UPLOAD: Data URL format:", {
          type: typeof dataUrl,
          length: dataUrl.length,
          startsWithData: dataUrl.startsWith("data:"),
          prefix: dataUrl.substring(0, 30),
          mimeType: dataUrl.split(";")[0],
        });
        resolve(dataUrl);
      } else {
        reject(new Error("Failed to convert image to base64"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(imageFile);
  });
}

/**
 * Upload multiple images to FAL.ai in parallel
 * @param imageFiles - Array of File objects to upload
 * @param onProgress - Optional callback for upload progress
 * @returns Promise resolving to array of uploaded image URLs
 */
export async function uploadImagesToFAL(
  imageFiles: File[],
  onProgress?: (completed: number, total: number) => void
): Promise<string[]> {
  if (imageFiles.length === 0) {
    return [];
  }

  const total = imageFiles.length;
  let completed = 0;

  const uploadPromises = imageFiles.map(async (file) => {
    const url = await uploadImageToFAL(file);
    completed++;
    onProgress?.(completed, total);
    return url;
  });

  // Upload in parallel for better performance
  const results = await Promise.all(uploadPromises);

  console.log(`✅ UPLOAD: Successfully uploaded ${results.length} images`);
  return results;
}

/**
 * Edit image using specified model
 */
export async function editImage(
  request: ImageEditRequest,
  onProgress?: ImageEditProgressCallback
): Promise<ImageEditResponse> {
  if (!FAL_API_KEY) {
    throw new Error("FAL API key not configured");
  }

  const modelConfig = MODEL_ENDPOINTS[request.model];
  if (!modelConfig) {
    throw new Error(`Unsupported model: ${request.model}`);
  }

  const startTime = Date.now();
  const jobId = generateJobId();

  // Build request payload
  const payload: any = {
    prompt: request.prompt,
    ...modelConfig.defaultParams,
  };

  // Handle image URL(s) based on model capabilities
  const capabilities = getModelCapabilities(request.model);

  // Normalize to array format (support both imageUrl and imageUrls)
  const imageUrlsArray: string[] = request.imageUrls
    ? request.imageUrls
    : request.imageUrl
      ? [request.imageUrl]
      : [];

  // Validate image count
  if (imageUrlsArray.length === 0) {
    throw new Error("At least one image URL is required");
  }

  if (imageUrlsArray.length > capabilities.maxImages) {
    console.warn(
      `Model ${request.model} supports max ${capabilities.maxImages} images, ` +
        `but ${imageUrlsArray.length} provided. Using first ${capabilities.maxImages}.`
    );
  }

  // Apply model-appropriate payload format
  if (capabilities.supportsMultiple) {
    // Multi-image models use image_urls array
    payload.image_urls = imageUrlsArray.slice(0, capabilities.maxImages);
  } else {
    // Single-image models use image_url string
    payload.image_url = imageUrlsArray[0];
  }

  // Override with user-specified parameters
  if (request.guidanceScale !== undefined) {
    payload.guidance_scale = request.guidanceScale;
  }
  if (request.steps !== undefined) {
    payload.num_inference_steps = request.steps;
  }
  if (request.seed !== undefined) {
    payload.seed = request.seed;
  }
  if (request.safetyTolerance !== undefined) {
    payload.safety_tolerance = request.safetyTolerance;
  }
  if (request.numImages !== undefined) {
    payload.num_images = request.numImages;
  }

  // Add new V4-specific parameters
  if (request.imageSize !== undefined) {
    payload.image_size = request.imageSize;
  }
  if (request.maxImages !== undefined) {
    payload.max_images = request.maxImages;
  }
  if (request.syncMode !== undefined) {
    payload.sync_mode = request.syncMode;
  }
  if (request.enableSafetyChecker !== undefined) {
    payload.enable_safety_checker = request.enableSafetyChecker;
  }

  // Add Nano Banana-specific parameters
  if (request.outputFormat !== undefined) {
    payload.output_format = request.outputFormat;
  }

  // Gemini 3 Pro Edit specific parameters
  if (request.resolution !== undefined) {
    payload.resolution = request.resolution;
  }
  if (request.aspectRatio !== undefined) {
    payload.aspect_ratio = request.aspectRatio;
  }

  // GPT Image 1.5 Edit specific parameters
  if (request.model === "gpt-image-1-5-edit") {
    if (request.background !== undefined) {
      payload.background = request.background;
    }
    if (request.inputFidelity !== undefined) {
      payload.input_fidelity = request.inputFidelity;
    }
    if (request.quality !== undefined) {
      payload.quality = request.quality;
    }
  }

  console.log(`🎨 Editing image with ${request.model}:`, {
    ...payload,
    image_url: payload.image_url?.substring(0, 50) + "..." || "N/A", // Truncate for readability
    image_urls:
      payload.image_urls?.map((url: string) => url.substring(0, 50) + "...") ||
      "N/A", // For V4/Nano Banana
  });

  // Debug: Check the actual format of the image URL(s)
  const imageUrl = payload.image_url || payload.image_urls?.[0];
  console.log("🔍 DEBUG: Image URL details:", {
    type: typeof imageUrl,
    length: imageUrl?.length,
    startsWithData: imageUrl?.startsWith("data:"),
    startsWithHttps: imageUrl?.startsWith("https:"),
    firstChars: imageUrl?.substring(0, 20),
    hasImageUrls: !!payload.image_urls,
    imageUrlsLength: payload.image_urls?.length || 0,
  });

  if (onProgress) {
    onProgress({
      status: "queued",
      progress: 0,
      message: "Submitting to FAL.ai...",
      elapsedTime: 0,
    });
  }

  try {
    // Try queue mode first
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 180_000); // 3 minute timeout

    const response = await fetch(`${FAL_API_BASE}/${modelConfig.endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
        "X-Fal-Queue": "true",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      handleAIServiceError(
        new Error(`FAL API Error: ${response.status}`),
        "FAL AI image edit request",
        {
          status: response.status,
          statusText: response.statusText,
          errorData,
          endpoint: modelConfig.endpoint,
          model: request.model,
          operation: "editImage",
        }
      );

      // Handle content policy violations (422 errors) with user-friendly messages
      if (
        response.status === 422 &&
        errorData.detail &&
        Array.isArray(errorData.detail)
      ) {
        const contentPolicyError = errorData.detail.find(
          (error: any) => error.type === "content_policy_violation"
        );

        if (contentPolicyError) {
          throw new Error(
            "Content policy violation: Please use appropriate language for image descriptions"
          );
        }
      }

      // Handle other error types with original logic
      const errorMessage = errorData.detail
        ? typeof errorData.detail === "string"
          ? errorData.detail
          : JSON.stringify(errorData.detail)
        : errorData.message || response.statusText;
      throw new Error(`API error: ${response.status} - ${errorMessage}`);
    }

    const result = await response.json();
    console.log("✅ FAL API response:", JSON.stringify(result, null, 2));

    // Check if we got a direct result or need to poll
    if (result.request_id) {
      // Queue mode - poll for results
      console.log("📋 Using queue mode with request_id:", result.request_id);
      return await pollImageEditStatus(
        result.request_id,
        modelConfig.endpoint,
        startTime,
        onProgress,
        jobId,
        request.model
      );
    }
    if (result.images && result.images.length > 0) {
      // Direct mode - return immediately
      console.log("🎯 Using direct mode with images:", result.images.length);
      if (onProgress) {
        onProgress({
          status: "completed",
          progress: 100,
          message: "Image editing completed!",
          elapsedTime: Math.floor((Date.now() - startTime) / 1000),
        });
      }

      return {
        job_id: jobId,
        status: "completed",
        message: "Image edited successfully",
        result_url: result.images[0].url,
        seed_used: result.seed,
        processing_time: Math.floor((Date.now() - startTime) / 1000),
      };
    }
    if (result.image && result.image.url) {
      // Alternative direct mode format - single image object
      console.log("🎯 Using direct mode with single image object");
      if (onProgress) {
        onProgress({
          status: "completed",
          progress: 100,
          message: "Image editing completed!",
          elapsedTime: Math.floor((Date.now() - startTime) / 1000),
        });
      }

      return {
        job_id: jobId,
        status: "completed",
        message: "Image edited successfully",
        result_url: result.image.url,
        seed_used: result.seed,
        processing_time: Math.floor((Date.now() - startTime) / 1000),
      };
    }
    if (result.url) {
      // Alternative direct mode format - URL at root level
      console.log("🎯 Using direct mode with root URL");
      if (onProgress) {
        onProgress({
          status: "completed",
          progress: 100,
          message: "Image editing completed!",
          elapsedTime: Math.floor((Date.now() - startTime) / 1000),
        });
      }

      return {
        job_id: jobId,
        status: "completed",
        message: "Image edited successfully",
        result_url: result.url,
        seed_used: result.seed,
        processing_time: Math.floor((Date.now() - startTime) / 1000),
      };
    }
    const error = new Error(
      `Unexpected response format from FAL API. Response keys: ${Object.keys(result).join(", ")}`
    );
    handleAIServiceError(error, "Parse FAL AI image edit response", {
      hasRequestId: !!result.request_id,
      hasImages: !!result.images,
      hasImageObject: !!result.image,
      hasUrlRoot: !!result.url,
      keys: Object.keys(result),
      model: request.model,
      operation: "parseEditResponse",
    });
    throw new Error(
      `Unexpected response format from FAL API. Response keys: ${Object.keys(result).join(", ")}`
    );
  } catch (error) {
    // Handle timeout errors specifically
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMessage =
          "Request timeout - the image editing service took too long to respond";
      } else {
        errorMessage = error.message;
      }
    }

    if (onProgress) {
      onProgress({
        status: "failed",
        progress: 0,
        message: errorMessage,
        elapsedTime: Math.floor((Date.now() - startTime) / 1000),
      });
    }
    throw error;
  }
}

/**
 * Upscale image using dedicated upscale models
 */
export async function upscaleImage(
  request: ImageUpscaleRequest,
  onProgress?: ImageEditProgressCallback
): Promise<ImageEditResponse> {
  if (!FAL_API_KEY) {
    throw new Error("FAL API key not configured");
  }

  const modelConfig = MODEL_ENDPOINTS[request.model];
  if (!modelConfig) {
    throw new Error(`Unsupported upscale model: ${request.model}`);
  }

  const startTime = Date.now();
  const jobId = generateJobId("upscale");

  const payload: Record<string, any> = {
    image_url: request.imageUrl,
    ...modelConfig.defaultParams,
  };

  if (request.scaleFactor !== undefined) {
    payload.scale_factor = request.scaleFactor;
  }
  if (request.denoise !== undefined) {
    payload.denoise = request.denoise;
  }
  if (request.creativity !== undefined) {
    payload.creativity = request.creativity;
  }
  if (request.overlappingTiles !== undefined) {
    payload.overlapping_tiles = request.overlappingTiles;
  }
  if (request.outputFormat) {
    payload.output_format = request.outputFormat;
  }

  if (onProgress) {
    onProgress({
      status: "queued",
      progress: 0,
      message: "Submitting upscale request to FAL.ai...",
      elapsedTime: 0,
    });
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 60_000);

    const response = await fetch(`${FAL_API_BASE}/${modelConfig.endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
        "X-Fal-Queue": "true",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      handleAIServiceError(
        new Error(`FAL API Error: ${response.status}`),
        "FAL AI image upscale request",
        {
          status: response.status,
          statusText: response.statusText,
          errorData,
          endpoint: modelConfig.endpoint,
          model: request.model,
          operation: "upscaleImage",
        }
      );

      const errorMessage =
        errorData.detail && typeof errorData.detail === "string"
          ? errorData.detail
          : errorData.message || response.statusText;
      throw new Error(
        `Upscale API error: ${response.status} - ${errorMessage}`
      );
    }

    const result = await response.json();
    if (result.request_id) {
      return await pollImageEditStatus(
        result.request_id,
        modelConfig.endpoint,
        startTime,
        onProgress,
        jobId,
        request.model
      );
    }

    const completedImage =
      result.images?.[0]?.url || result.image?.url || result.result_url;
    if (completedImage) {
      if (onProgress) {
        onProgress({
          status: "completed",
          progress: 100,
          message: "Upscale completed",
          elapsedTime: Math.floor((Date.now() - startTime) / 1000),
        });
      }

      return {
        job_id: jobId,
        status: "completed",
        message: "Upscale completed",
        result_url: completedImage,
        processing_time: Math.floor((Date.now() - startTime) / 1000),
      };
    }

    throw new Error("Upscale response did not include an image URL");
  } catch (error) {
    handleAIServiceError(error, "FAL AI image upscaling", {
      model: request.model,
      endpoint: modelConfig.endpoint,
      operation: "upscaleImage",
    });

    if (onProgress) {
      onProgress({
        status: "failed",
        progress: 0,
        message:
          error instanceof Error
            ? error.message
            : "Upscaling failed unexpectedly",
        elapsedTime: Math.floor((Date.now() - startTime) / 1000),
      });
    }

    throw error;
  }
}

/**
 * Poll for image edit status
 */
async function pollImageEditStatus(
  requestId: string,
  endpoint: string,
  startTime: number,
  onProgress?: ImageEditProgressCallback,
  jobId?: string,
  modelName?: string
): Promise<ImageEditResponse> {
  const maxAttempts = 30; // 2.5 minutes max
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    const elapsedTime = Math.floor((Date.now() - startTime) / 1000);

    try {
      const pollCtrl = new AbortController();
      const pollTimeout = setTimeout(() => pollCtrl.abort(), 15_000); // 15 second timeout per poll

      const statusResponse = await fetch(
        `${FAL_API_BASE}/queue/requests/${requestId}/status`,
        {
          headers: {
            "Authorization": `Key ${FAL_API_KEY}`,
          },
          signal: pollCtrl.signal,
        }
      );

      clearTimeout(pollTimeout);

      if (!statusResponse.ok) {
        console.warn(
          `Status check failed (attempt ${attempts}):`,
          statusResponse.status
        );
        await sleep(5000);
        continue;
      }

      const status = await statusResponse.json();
      console.log(`📊 Edit status (${elapsedTime}s):`, status);

      if (onProgress) {
        const progressUpdate = mapEditStatusToProgress(status, elapsedTime);
        onProgress(progressUpdate);
      }

      if (status.status === "COMPLETED") {
        const resultResponse = await fetch(
          `${FAL_API_BASE}/queue/requests/${requestId}`,
          {
            headers: {
              "Authorization": `Key ${FAL_API_KEY}`,
            },
          }
        );

        if (resultResponse.ok) {
          const result = await resultResponse.json();
          // Edit completed successfully

          if (onProgress) {
            onProgress({
              status: "completed",
              progress: 100,
              message: `Image edited successfully with ${modelName}`,
              elapsedTime,
            });
          }

          return {
            job_id: jobId || requestId,
            status: "completed",
            message: `Image edited successfully with ${modelName}`,
            result_url: result.images?.[0]?.url || result.image?.url,
            seed_used: result.seed,
            processing_time: elapsedTime,
          };
        }
      }

      if (status.status === "FAILED") {
        const errorMessage = status.error || "Image editing failed";
        if (onProgress) {
          onProgress({
            status: "failed",
            progress: 0,
            message: errorMessage,
            elapsedTime,
          });
        }
        throw new Error(errorMessage);
      }

      await sleep(5000);
    } catch (error) {
      // Handle specific timeout errors
      if (error instanceof Error && error.name === "AbortError") {
        console.warn(
          `⏰ Poll request timeout (attempt ${attempts}): Status check took longer than 15 seconds`
        );
      } else {
        handleAIServiceError(error, "Poll FAL AI image edit status", {
          attempts,
          requestId,
          elapsedTime,
          modelName,
          operation: "pollImageEditStatus",
        });
      }

      if (attempts >= maxAttempts) {
        throw new Error(
          "Image editing timeout - maximum polling attempts reached"
        );
      }
      await sleep(5000);
    }
  }

  throw new Error("Maximum polling attempts reached");
}

function mapEditStatusToProgress(status: any, elapsedTime: number) {
  const baseUpdate = { elapsedTime };

  switch (status.status) {
    case "IN_QUEUE":
      return {
        ...baseUpdate,
        status: "queued" as const,
        progress: 10,
        message: `Queued (position: ${status.queue_position || "unknown"})`,
        estimatedTime: status.estimated_time,
      };
    case "IN_PROGRESS":
      return {
        ...baseUpdate,
        status: "processing" as const,
        progress: Math.min(90, 20 + elapsedTime * 3),
        message: "Processing image...",
        estimatedTime: status.estimated_time,
      };
    case "COMPLETED":
      return {
        ...baseUpdate,
        status: "completed" as const,
        progress: 100,
        message: "Image editing completed!",
      };
    case "FAILED":
      return {
        ...baseUpdate,
        status: "failed" as const,
        progress: 0,
        message: status.error || "Processing failed",
      };
    default:
      return {
        ...baseUpdate,
        status: "processing" as const,
        progress: 5,
        message: `Status: ${status.status}`,
      };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateJobId(prefix: "edit" | "upscale" = "edit"): string {
  return (
    `${prefix}_` + Math.random().toString(36).substr(2, 9) + "_" + Date.now()
  );
}

/**
 * Get model information
 */
export function getImageEditModels() {
  return [
    {
      id: "gemini-3-pro-edit",
      name: "Gemini 3 Pro Edit",
      description:
        "Google's advanced image editing with exceptional context understanding",
      provider: "Google",
      estimatedCost: "$0.15",
      features: [
        "Long prompt support (50K chars)",
        "Resolution options (1K/2K/4K)",
        "Smart context understanding",
        "Multiple aspect ratios",
      ],
      parameters: {
        numImages: { min: 1, max: 4, default: 1, step: 1 },
        resolution: {
          type: "select",
          options: ["1K", "2K", "4K"],
          default: "1K",
        },
        aspectRatio: {
          type: "select",
          options: [
            "auto",
            "1:1",
            "4:3",
            "3:4",
            "16:9",
            "9:16",
            "21:9",
            "3:2",
            "2:3",
            "5:4",
            "4:5",
          ],
          default: "auto",
        },
        outputFormat: {
          type: "select",
          options: ["jpeg", "png", "webp"],
          default: "png",
        },
        syncMode: { type: "boolean", default: false },
      },
    },
    {
      id: "nano-banana",
      name: "Nano Banana",
      description: "Smart AI-powered editing with Google/Gemini technology",
      provider: "Google",
      estimatedCost: "$0.039",
      features: [
        "Smart understanding",
        "Cost effective",
        "Multiple formats",
        "Edit descriptions",
      ],
      parameters: {
        numImages: { min: 1, max: 4, default: 1, step: 1 },
        outputFormat: {
          type: "select",
          options: ["jpeg", "png"],
          default: "png",
        },
        syncMode: { type: "boolean", default: false },
      },
    },
    {
      id: "seeddream-v4-5-edit",
      name: "SeedDream v4.5 Edit",
      description:
        "ByteDance's latest image editing with up to 4K resolution and multi-image compositing",
      provider: "ByteDance",
      estimatedCost: "$0.04-0.08",
      features: [
        "Up to 4K resolution",
        "Multi-image compositing (up to 10)",
        "Auto 2K/4K presets",
        "Commercial license",
      ],
      parameters: {
        imageSize: {
          type: "select",
          options: [
            "square_hd",
            "square",
            "portrait_4_3",
            "portrait_16_9",
            "landscape_4_3",
            "landscape_16_9",
            "auto_2K",
            "auto_4K",
          ],
          default: "auto_2K",
        },
        maxImages: { min: 1, max: 10, default: 1, step: 1 },
        numImages: { min: 1, max: 6, default: 1, step: 1 },
        syncMode: { type: "boolean", default: false },
        enableSafetyChecker: { type: "boolean", default: true },
        seed: { optional: true },
      },
    },
    {
      id: "reve-edit",
      name: "Reve Edit",
      description: "Cost-effective image editing with strong aesthetic quality",
      provider: "fal.ai",
      estimatedCost: "$0.04",
      features: [
        "Cost-effective editing",
        "Strong aesthetics",
        "Fast processing",
        "Multiple formats",
      ],
      parameters: {
        numImages: { min: 1, max: 4, default: 1, step: 1 },
        outputFormat: {
          type: "select",
          options: ["png", "jpeg", "webp"],
          default: "png",
        },
        syncMode: { type: "boolean", default: false },
      },
    },
    {
      id: "seeddream-v4",
      name: "SeedDream v4",
      description: "Advanced multi-image editing with unified architecture",
      provider: "ByteDance",
      estimatedCost: "$0.04-0.08",
      features: [
        "Multi-image processing",
        "Flexible sizing",
        "Enhanced prompts",
        "Advanced controls",
      ],
      parameters: {
        imageSize: {
          type: "select",
          options: [
            "square_hd",
            "square",
            "portrait_3_4",
            "portrait_9_16",
            "landscape_4_3",
            "landscape_16_9",
          ],
          default: "square_hd",
          customRange: { min: 1024, max: 4096, step: 64 },
        },
        maxImages: { min: 1, max: 6, default: 1, step: 1 },
        numImages: { min: 1, max: 4, default: 1, step: 1 },
        syncMode: { type: "boolean", default: false },
        enableSafetyChecker: { type: "boolean", default: true },
        seed: { optional: true },
      },
    },
    {
      id: "seededit",
      name: "SeedEdit v3",
      description: "Precise photo editing with content preservation",
      provider: "ByteDance",
      estimatedCost: "$0.05-0.10",
      features: ["Photo retouching", "Object modification", "Realistic edits"],
      parameters: {
        guidanceScale: { min: 1, max: 10, default: 1.0, step: 0.1 },
        seed: { optional: true },
      },
    },
    {
      id: "flux-kontext",
      name: "FLUX Pro Kontext",
      description: "Context-aware editing with scene transformations",
      provider: "FLUX",
      estimatedCost: "$0.15-0.25",
      features: ["Style changes", "Object replacement", "Scene modification"],
      parameters: {
        guidanceScale: { min: 1, max: 20, default: 3.5, step: 0.5 },
        steps: { min: 1, max: 50, default: 28, step: 1 },
        safetyTolerance: { min: 1, max: 6, default: 2, step: 1 },
        numImages: { min: 1, max: 4, default: 1, step: 1 },
      },
    },
    {
      id: "flux-kontext-max",
      name: "FLUX Pro Kontext Max",
      description: "Advanced editing for complex tasks and typography",
      provider: "FLUX",
      estimatedCost: "$0.25-0.40",
      features: ["Complex edits", "Typography", "Professional adjustments"],
      parameters: {
        guidanceScale: { min: 1, max: 20, default: 3.5, step: 0.5 },
        steps: { min: 1, max: 50, default: 28, step: 1 },
        safetyTolerance: { min: 1, max: 6, default: 2, step: 1 },
        numImages: { min: 1, max: 4, default: 1, step: 1 },
      },
    },
    {
      id: "flux-2-flex-edit",
      name: "FLUX 2 Flex Edit",
      description:
        "Flexible image editing with adjustable parameters and enhanced control",
      provider: "Black Forest Labs",
      estimatedCost: "$0.06/MP",
      features: [
        "Auto image size detection",
        "Adjustable inference steps",
        "Prompt expansion",
        "Fine-tuned guidance control",
      ],
      parameters: {
        guidanceScale: { min: 1.5, max: 10, default: 3.5, step: 0.1 },
        steps: { min: 2, max: 50, default: 28, step: 1 },
        safetyTolerance: { min: 1, max: 5, default: 2, step: 1 },
        numImages: { min: 1, max: 1, default: 1, step: 1 },
        outputFormat: {
          type: "select",
          options: ["jpeg", "png"],
          default: "jpeg",
        },
        enablePromptExpansion: { type: "boolean", default: true },
      },
    },
    {
      id: "gpt-image-1-5-edit",
      name: "GPT Image 1.5 Edit",
      description:
        "OpenAI's GPT Image 1.5 for high-fidelity image editing with strong prompt adherence",
      provider: "OpenAI",
      estimatedCost: "$0.04-0.08",
      features: [
        "High prompt adherence",
        "Transparent background support",
        "Input fidelity control",
        "Multiple output formats",
      ],
      parameters: {
        imageSize: {
          type: "select",
          options: ["auto", "1024x1024", "1536x1024", "1024x1536"],
          default: "auto",
        },
        background: {
          type: "select",
          options: ["auto", "transparent", "opaque"],
          default: "auto",
        },
        quality: {
          type: "select",
          options: ["low", "medium", "high"],
          default: "high",
        },
        inputFidelity: {
          type: "select",
          options: ["low", "high"],
          default: "high",
        },
        numImages: { min: 1, max: 4, default: 1, step: 1 },
        outputFormat: {
          type: "select",
          options: ["jpeg", "png", "webp"],
          default: "png",
        },
        syncMode: { type: "boolean", default: false },
      },
    },
  ];
}
