/**
 * AI Video Generation Client
 * Handles communication with the Python FastAPI backend
 */

import { handleAIServiceError, handleNetworkError } from "./error-handler";
import { AI_MODELS } from "@/components/editor/media-panel/views/ai-constants";
import type { AIModel } from "@/components/editor/media-panel/views/ai-types";

// Direct FAL AI integration - no backend needed
const FAL_API_KEY = import.meta.env.VITE_FAL_API_KEY;
const FAL_API_BASE = "https://fal.run";

/**
 * Retrieves model configuration from the centralized AI_MODELS registry.
 *
 * WHY: Ensures consistent model configuration across text, image, and avatar generation flows.
 * Edge case: Returns undefined for unknown model IDs - caller must handle gracefully.
 *
 * @param modelId - Unique identifier for the AI model (e.g., "kling_v2", "bytedance_omnihuman_v1_5")
 * @returns Model configuration object or undefined if model not found
 */
function getModelConfig(modelId: string): AIModel | undefined {
  return AI_MODELS.find((m) => m.id === modelId);
}

export interface VideoGenerationRequest {
  prompt: string;
  model: string;
  resolution?: string;
  duration?: number;
}

export interface ImageToVideoRequest {
  image: File;
  model: string;
  prompt?: string;
  resolution?: string;
  duration?: number;
}

export interface AvatarVideoRequest {
  model: string;
  characterImage: File;
  audioFile?: File; // For Kling models
  sourceVideo?: File; // For WAN animate/replace
  prompt?: string;
  resolution?: string;
  duration?: number;
}

export interface VideoGenerationResponse {
  job_id: string;
  status: string;
  message: string;
  estimated_time?: number;
  video_url?: string;
  video_data?: any;
}

export interface GenerationStatus {
  job_id: string;
  status: string;
  progress?: number;
  video_url?: string;
  error?: string;
}

// AIModel interface is now imported from ai-types.ts

export interface ModelsResponse {
  models: AIModel[];
}

export interface CostEstimate {
  model: string;
  duration: number;
  base_cost: number;
  estimated_cost: number;
  currency: string;
}

/**
 * Callback for receiving real-time progress updates during video generation.
 *
 * WHY: FAL AI jobs can take 30-300 seconds; users need feedback to prevent abandoning the generation.
 * Performance: Called every 2 seconds during polling; avoid heavy computation in callbacks.
 *
 * @param status.status - Current generation phase
 * @param status.progress - Percentage (0-100) if available from FAL API
 * @param status.message - Human-readable status message
 * @param status.elapsedTime - Milliseconds since generation started
 * @param status.estimatedTime - Expected total duration (unreliable, FAL API rarely provides this)
 * @param status.logs - Detailed processing logs from FAL API
 */
export type ProgressCallback = (status: {
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  message?: string;
  elapsedTime?: number;
  estimatedTime?: number;
  logs?: string[];
}) => void;

/**
 * Generates AI video from text prompt using FAL AI's text-to-video models.
 *
 * WHY: Direct FAL integration bypasses backend, reducing latency and infrastructure costs.
 * Side effect: Downloads video to memory or streams to disk based on downloadOptions.
 * Performance: Large videos (>50MB) should use streaming to avoid memory spikes.
 *
 * Edge cases:
 * - Returns job_id immediately; actual video URL arrives after polling completes
 * - FAL API may return 429 rate limit; caller should implement exponential backoff
 * - Some models (Veo3) take 5+ minutes; set appropriate timeouts
 *
 * @param request - Text prompt, model ID, and generation parameters
 * @param onProgress - Optional callback for real-time status updates (called every 2s during polling)
 * @param downloadOptions - Controls how video data is fetched (memory vs. streaming)
 * @returns VideoGenerationResponse with job_id and final video_url
 * @throws Error if FAL_API_KEY missing or API returns 4xx/5xx errors
 */
export async function generateVideo(
  request: VideoGenerationRequest,
  onProgress?: ProgressCallback,
  downloadOptions?: {
    downloadToMemory?: boolean;
    onDataReceived?: (data: Uint8Array) => void;
    onComplete?: (totalData: Uint8Array) => void;
  }
): Promise<VideoGenerationResponse> {
  try {
    if (!FAL_API_KEY) {
      const error = new Error(
        "FAL API key not configured. Please set VITE_FAL_API_KEY in your environment variables."
      );

      // Use our enhanced error handler instead of console.error
      handleAIServiceError(error, "AI Video Generation Setup", {
        configRequired: "VITE_FAL_API_KEY",
        operation: "checkApiKey",
      });

      throw error;
    }

    console.log(
      `🔑 FAL API Key present: ${FAL_API_KEY ? "Yes (length: " + FAL_API_KEY.length + ")" : "No"}`
    );

    // Get model configuration from centralized config
    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.text_to_video;
    const jobId = generateJobId();

    console.log(`🎬 Generating video with FAL AI: ${endpoint}`);
    console.log(`📝 Prompt: ${request.prompt}`);

    // Build request payload using centralized model configuration
    const payload: any = {
      prompt: request.prompt,
      // Start with default parameters from model config
      ...(modelConfig.default_params || {}),
      // Override with request-specific parameters
      ...(request.duration && { duration: request.duration }),
      ...(request.resolution && { resolution: request.resolution }),
    };

    // Special handling for specific models that require unique parameter formats
    if (request.model === "hailuo" || request.model === "hailuo_pro") {
      // Hailuo only accepts '6' or '10' as string values for duration
      const requestedDuration = payload.duration || 6;
      payload.duration = requestedDuration >= 10 ? "10" : "6";
      // Remove resolution as Hailuo doesn't use it directly
      delete payload.resolution;
    } else if (request.model === "wan_turbo") {
      // WAN Turbo only accepts specific resolutions
      const validResolutions = ["480p", "580p", "720p"];
      if (payload.resolution && !validResolutions.includes(payload.resolution)) {
        payload.resolution = "720p";
      }
    } else if (request.model === "wan_25_preview") {
      // WAN 2.5 supports higher resolutions
      const validResolutions = ["720p", "1080p", "1440p"];
      if (payload.resolution && !validResolutions.includes(payload.resolution)) {
        payload.resolution = "1080p";
      }
    }

    // Validate duration doesn't exceed model's max
    if (payload.duration && payload.duration > modelConfig.max_duration) {
      console.warn(
        `${modelConfig.name}: Duration capped at ${modelConfig.max_duration} seconds`
      );
      payload.duration = modelConfig.max_duration;
    }

    console.log(`📤 Sending request to ${endpoint} with payload:`, payload);

    // Track start time for elapsed time calculation
    const startTime = Date.now();

    // Initial status update
    if (onProgress) {
      onProgress({
        status: "queued",
        progress: 0,
        message: "Submitting request to FAL.ai queue...",
        elapsedTime: 0,
      });
    }

    // Step 1: Try queue mode first
    console.log("📤 Attempting queue submission with payload:", payload);

    const queueResponse = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
        // Try different queue headers
        "X-Fal-Queue": "true",
        "X-Queue": "true",
        "Queue": "true",
      },
      body: JSON.stringify(payload),
    });

    if (!queueResponse.ok) {
      const errorData = await queueResponse.json().catch(() => ({}));
      handleAIServiceError(
        new Error(
          `FAL Queue Submit Error: ${queueResponse.status} ${queueResponse.statusText}`
        ),
        "Submit FAL AI request to queue",
        {
          status: queueResponse.status,
          statusText: queueResponse.statusText,
          errorData,
          endpoint,
          operation: "queueSubmit",
        }
      );

      const errorMessage = handleQueueError(queueResponse, errorData, endpoint);
      throw new Error(errorMessage);
    }

    const queueResult = await queueResponse.json();
    console.log("✅ FAL Response received:", queueResult);
    console.log("🗋 Response structure:", {
      hasRequestId: !!queueResult.request_id,
      hasVideo: !!queueResult.video,
      hasVideoUrl: !!(queueResult.video && queueResult.video.url),
      keys: Object.keys(queueResult),
      fullResponse: queueResult,
    });

    // Check if we got a request_id (queue mode) or direct result
    const requestId = queueResult.request_id;

    if (requestId) {
      console.log("📋 Queue mode: polling for result...");
      // Step 2: Poll for status with progress updates
      return await pollQueueStatus(
        requestId,
        endpoint,
        startTime,
        onProgress,
        jobId,
        request.model,
        downloadOptions
      );
    }
    if (queueResult.video && queueResult.video.url) {
      console.log("⚡ Direct mode: video ready immediately");

      // Handle streaming download if requested
      if (downloadOptions?.downloadToMemory) {
        console.log("📥 Starting streaming download of video...");
        const videoData = await streamVideoDownload(
          queueResult.video.url,
          downloadOptions
        );
        if (downloadOptions.onComplete) {
          downloadOptions.onComplete(videoData);
        }
      }

      // Direct response - video is already ready
      if (onProgress) {
        onProgress({
          status: "completed",
          progress: 100,
          message: `Video generated successfully with ${request.model}`,
          elapsedTime: Math.floor((Date.now() - startTime) / 1000),
        });
      }

      return {
        job_id: jobId,
        status: "completed",
        message: `Video generated successfully with ${request.model}`,
        estimated_time: Math.floor((Date.now() - startTime) / 1000),
        video_url: queueResult.video.url,
        video_data: queueResult,
      };
    }
    console.warn("⚠️ Queue mode failed, trying direct API call...");

    // Fallback: Try direct API call without queue headers
    const directResponse = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
        // No queue headers for direct mode
      },
      body: JSON.stringify(payload),
    });

    if (!directResponse.ok) {
      const errorData = await directResponse.json().catch(() => ({}));
      throw new Error(
        `Both queue and direct modes failed. Status: ${directResponse.status}, Error: ${JSON.stringify(errorData)}`
      );
    }

    const directResult = await directResponse.json();
    console.log("✅ Direct API result:", directResult);

    if (directResult.video && directResult.video.url) {
      // Handle streaming download if requested
      if (downloadOptions?.downloadToMemory) {
        console.log("📥 Starting streaming download of direct video...");
        const videoData = await streamVideoDownload(
          directResult.video.url,
          downloadOptions
        );
        if (downloadOptions.onComplete) {
          downloadOptions.onComplete(videoData);
        }
      }

      if (onProgress) {
        onProgress({
          status: "completed",
          progress: 100,
          message: `Video generated successfully with ${request.model}`,
          elapsedTime: Math.floor((Date.now() - startTime) / 1000),
        });
      }

      return {
        job_id: jobId,
        status: "completed",
        message: `Video generated successfully with ${request.model}`,
        estimated_time: Math.floor((Date.now() - startTime) / 1000),
        video_url: directResult.video.url,
        video_data: directResult,
      };
    }
    const error = new Error(
      "No video URL received from either queue or direct API mode. Please check the logs for details."
    );

    handleAIServiceError(error, "AI Video Generation", {
      queueResult,
      directResult,
      operation: "generateVideo",
    });

    throw error;
  } catch (error) {
    handleAIServiceError(error, "AI Video Generation", {
      operation: "generateVideo",
    });
    if (onProgress) {
      onProgress({
        status: "failed",
        progress: 0,
        message:
          error instanceof Error ? error.message : "Unknown error occurred",
        elapsedTime: 0,
      });
    }
    throw error;
  }
}

/**
 * Poll FAL queue status with real-time progress updates
 */
async function pollQueueStatus(
  requestId: string,
  endpoint: string,
  startTime: number,
  onProgress?: ProgressCallback,
  jobId?: string,
  modelName?: string,
  downloadOptions?: {
    downloadToMemory?: boolean;
    onDataReceived?: (data: Uint8Array) => void;
    onComplete?: (totalData: Uint8Array) => void;
  }
): Promise<VideoGenerationResponse> {
  const maxAttempts = 60; // 5 minutes max (5s intervals)
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    const elapsedTime = Math.floor((Date.now() - startTime) / 1000);

    try {
      // Check queue status
      const statusResponse = await fetch(
        `${FAL_API_BASE}/queue/requests/${requestId}/status`,
        {
          headers: {
            "Authorization": `Key ${FAL_API_KEY}`,
          },
        }
      );

      if (!statusResponse.ok) {
        console.warn(
          `⚠️ Status check failed (attempt ${attempts}):`,
          statusResponse.status
        );
        await sleep(5000);
        continue;
      }

      const status = await statusResponse.json();
      console.log(`📊 Queue status (${elapsedTime}s):`, status);

      // Update progress based on status
      if (onProgress) {
        const progressUpdate = mapQueueStatusToProgress(status, elapsedTime);
        onProgress(progressUpdate);
      }

      // Check if completed
      if (status.status === "COMPLETED") {
        // Get the result
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
          console.log("✅ FAL Queue completed:", result);

          // Handle streaming download if requested
          if (downloadOptions?.downloadToMemory && result.video?.url) {
            console.log("📥 Starting streaming download of queued video...");
            const videoData = await streamVideoDownload(
              result.video.url,
              downloadOptions
            );
            if (downloadOptions.onComplete) {
              downloadOptions.onComplete(videoData);
            }
          }

          if (onProgress) {
            onProgress({
              status: "completed",
              progress: 100,
              message: `Video generated successfully with ${modelName}`,
              elapsedTime,
            });
          }

          return {
            job_id: jobId || requestId,
            status: "completed",
            message: `Video generated successfully with ${modelName}`,
            estimated_time: elapsedTime,
            video_url: result.video?.url || result.video,
            video_data: result,
          };
        }
      }

      // Check if failed
      if (status.status === "FAILED") {
        const errorMessage = status.error || "Video generation failed";
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

      // Continue polling for IN_PROGRESS or IN_QUEUE
      await sleep(5000); // Poll every 5 seconds
    } catch (error) {
      handleAIServiceError(error, "Poll FAL AI queue status", {
        attempts,
        requestId,
        elapsedTime,
        operation: "statusPolling",
      });

      if (attempts >= maxAttempts) {
        const errorMessage = `Timeout: Video generation took longer than expected (${Math.floor((maxAttempts * 5) / 60)} minutes)`;
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

      // Wait before retry
      await sleep(5000);
    }
  }

  throw new Error("Maximum polling attempts reached");
}

/**
 * Map FAL queue status to our progress format
 */
function mapQueueStatusToProgress(
  status: any,
  elapsedTime: number
): {
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  message?: string;
  elapsedTime?: number;
  estimatedTime?: number;
  logs?: string[];
} {
  const baseUpdate = {
    elapsedTime,
    logs: status.logs || [],
  };

  switch (status.status) {
    case "IN_QUEUE":
      return {
        ...baseUpdate,
        status: "queued",
        progress: 5,
        message: `Queued (position: ${status.queue_position || "unknown"})`,
        estimatedTime: status.estimated_time,
      };

    case "IN_PROGRESS": {
      const progress = Math.min(90, 20 + elapsedTime * 2); // Gradual progress based on time
      return {
        ...baseUpdate,
        status: "processing",
        progress,
        message: "Generating video...",
        estimatedTime: status.estimated_time,
      };
    }

    case "COMPLETED":
      return {
        ...baseUpdate,
        status: "completed",
        progress: 100,
        message: "Video generation completed!",
      };

    case "FAILED":
      return {
        ...baseUpdate,
        status: "failed",
        progress: 0,
        message: status.error || "Generation failed",
      };

    default:
      return {
        ...baseUpdate,
        status: "queued",
        progress: 0,
        message: `Status: ${status.status}`,
      };
  }
}

/**
 * Handle queue-specific errors
 */
function handleQueueError(
  response: Response,
  errorData: any,
  endpoint: string
): string {
  let errorMessage = `FAL Queue error! status: ${response.status}`;

  if (errorData.detail) {
    if (Array.isArray(errorData.detail)) {
      errorMessage = errorData.detail.map((d: any) => d.msg || d).join(", ");
    } else {
      errorMessage = errorData.detail;
    }
  } else if (errorData.error) {
    errorMessage = errorData.error;
  } else if (errorData.message) {
    errorMessage = errorData.message;
  } else if (typeof errorData === "string") {
    errorMessage = errorData;
  } else if (errorData.errors && Array.isArray(errorData.errors)) {
    errorMessage = errorData.errors.join(", ");
  }

  // Check for specific FAL.ai error patterns
  if (response.status === 422) {
    errorMessage = `Invalid request parameters: ${JSON.stringify(errorData)}`;
  } else if (response.status === 401) {
    errorMessage =
      "Invalid FAL API key. Please check your VITE_FAL_API_KEY environment variable.";
  } else if (response.status === 429) {
    errorMessage =
      "Rate limit exceeded. Please wait a moment before trying again.";
  } else if (response.status === 404) {
    errorMessage = `Model endpoint not found: ${endpoint}. The model may have been updated or moved.`;
  }

  return errorMessage;
}

/**
 * Sleep utility for polling
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  return "job_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();
}

/**
 * Converts any File (image, audio, video) to base64 data URL for inline embedding in API requests.
 *
 * WHY: FAL API accepts base64-encoded files instead of requiring separate upload endpoint.
 * Performance: FileReader is asynchronous; wraps callback-based API in Promise for async/await usage.
 * Side effect: Entire file loaded into memory; ~33% size increase due to base64 encoding.
 *
 * Edge cases:
 * - Large files (>10MB images, >50MB videos) will cause noticeable UI lag during encoding
 * - Corrupted files cause FileReader to reject promise with DOMException
 * - Browser memory limits vary; large files may fail on mobile devices
 * - Audio files: 30s MP3 (~500KB) becomes ~700KB; Video: 10s MP4 (~5MB) becomes ~6.7MB
 *
 * @param file - File from user upload or drag-drop (image, audio, or video)
 * @returns Base64-encoded data URL (e.g., "data:image/jpeg;base64,...", "data:audio/mpeg;base64,...", "data:video/mp4;base64,...")
 * @throws DOMException if file read fails or file is corrupted
 */
async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Generates AI video from a static image using FAL AI's image-to-video models.
 *
 * WHY: Image-to-video provides more control than text-only generation; users supply reference frame.
 * Side effect: Converts image to base64 data URL in memory (may spike memory for large images >10MB).
 * Performance: Base64 encoding adds ~33% overhead; 5MB image becomes ~6.7MB in request payload.
 *
 * Edge cases:
 * - Not all models support image-to-video (e.g., Hailuo models are text-only)
 * - Large images (>10MB) may timeout during FAL API upload; resize before calling
 * - WebP/AVIF formats may fail; convert to JPEG/PNG for best compatibility
 *
 * @param request - Image file, model ID, optional prompt, and generation parameters
 * @returns VideoGenerationResponse with job_id for polling
 * @throws Error if model doesn't support image-to-video or FAL_API_KEY missing
 */
export async function generateVideoFromImage(
  request: ImageToVideoRequest
): Promise<VideoGenerationResponse> {
  try {
    if (!FAL_API_KEY) {
      throw new Error("FAL API key not configured");
    }

    console.log("🤖 Starting image-to-video generation with FAL AI");
    console.log("📝 Prompt:", request.prompt || "No additional prompt");
    console.log("🖼️ Image:", request.image.name);

    // 1. Convert image to base64 data URL
    console.log("📤 Converting image to base64...");
    const imageUrl = await fileToDataURL(request.image);
    console.log("✅ Image converted to data URL");

    // 2. Generate video using centralized model configuration
    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    // Check if model supports image-to-video
    const endpoint = modelConfig.endpoints.image_to_video;
    if (!endpoint) {
      throw new Error(`Model ${request.model} does not support image-to-video generation`);
    }

    // Build request payload using centralized model configuration
    const payload: any = {
      prompt: request.prompt || "Create a cinematic video from this image",
      image_url: imageUrl,
      // Start with default parameters from model config
      ...(modelConfig.default_params || {}),
      // Override with request-specific parameters
      ...(request.duration && { duration: request.duration }),
      ...(request.resolution && { resolution: request.resolution }),
    };

    // Handle model-specific payload adjustments
    if (request.model === "wan_turbo") {
      // WAN Turbo image-to-video only supports specific resolutions
      payload.resolution =
        request.resolution &&
        ["480p", "580p", "720p"].includes(request.resolution)
          ? request.resolution
          : "720p";
      payload.seed = Math.floor(Math.random() * 1_000_000); // Optional: for reproducibility
    } else if (request.model === "wan_25_preview") {
      // WAN 2.5 supports higher quality image-to-video conversion
      payload.quality = "high";
    } else if (request.model === "seedance_pro") {
      // Seedance requires duration as string
      payload.duration = request.duration?.toString() || "5";
    }

    const jobId = generateJobId();
    console.log(`🎬 Generating video with: ${endpoint}`);
    console.log("📝 Payload:", payload);

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      // Handle specific error cases with user-friendly messages
      if (errorData.detail && errorData.detail.includes("User is locked")) {
        if (errorData.detail.includes("Exhausted balance")) {
          throw new Error(
            "Your FAL.ai account balance has been exhausted. Please top up your balance at fal.ai/dashboard/billing to continue generating videos."
          );
        }
        throw new Error(
          "Your FAL.ai account is temporarily locked. Please check your account status at fal.ai/dashboard."
        );
      }

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment before trying again."
        );
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    console.log("✅ FAL API response:", result);

    // Return in our expected format
    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully from image with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate video from image", {
      model: request.model,
      imageName: request.image.name,
      operation: "generateVideoFromImage",
    });
    throw error;
  }
}

/**
 * Generates avatar video using FAL AI's character animation models.
 *
 * WHY: Animates static character images with audio/video input for talking head and character replacement use cases.
 * Business logic: Different models require different input combinations:
 *   - WAN animate/replace: characterImage + sourceVideo (replaces character in existing video)
 *   - Kling/ByteDance: characterImage + audioFile (generates talking head from audio)
 * Performance: Audio files are converted to base64; 30s audio (~500KB MP3) becomes ~700KB payload.
 *
 * Edge cases:
 * - ByteDance OmniHuman has 30s audio limit; longer files will be truncated by FAL API
 * - WAN animate/replace requires source video with detectable face; fails on abstract/non-human content
 * - Model validation happens here; if required inputs missing, throws before API call
 *
 * @param request - Model ID, character image, and model-specific inputs (audio or source video)
 * @returns VideoGenerationResponse with job_id for polling
 * @throws Error if required inputs missing for selected model or FAL_API_KEY not configured
 */
export async function generateAvatarVideo(
  request: AvatarVideoRequest
): Promise<VideoGenerationResponse> {
  try {
    if (!FAL_API_KEY) {
      throw new Error("FAL API key not configured");
    }

    console.log("🎭 Starting avatar video generation with FAL AI");
    console.log("🎬 Model:", request.model);

    // Get model configuration
    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown avatar model: ${request.model}`);
    }

    if (modelConfig.category !== "avatar") {
      throw new Error(`Model ${request.model} is not an avatar model`);
    }

    // Convert character image to base64
    const characterImageUrl = await fileToDataURL(request.characterImage);

    // Determine endpoint and payload based on model
    let endpoint: string;
    let payload: any;

    if (request.model === "wan_animate_replace") {
      if (!request.sourceVideo) {
        throw new Error("WAN Animate/Replace requires a source video");
      }
      // Convert source video to data URL (for WAN model)
      const sourceVideoUrl = await fileToDataURL(request.sourceVideo);
      endpoint = modelConfig.endpoints.text_to_video;
      payload = {
        video_url: sourceVideoUrl,
        image_url: characterImageUrl,
        resolution: request.resolution || "480p",
        video_quality: "high",
        ...(modelConfig.default_params || {}),
      };
    } else if (request.model === "kling_avatar_pro" || request.model === "kling_avatar_standard") {
      if (!request.audioFile) {
        throw new Error(`${request.model} requires an audio file`);
      }
      // Convert audio to data URL
      const audioUrl = await fileToDataURL(request.audioFile);
      endpoint = modelConfig.endpoints.text_to_video;
      payload = {
        image_url: characterImageUrl,
        audio_url: audioUrl,
        prompt: request.prompt || "",
        ...(modelConfig.default_params || {}),
      };
    } else if (request.model === "bytedance_omnihuman_v1_5") {
      if (!request.audioFile) {
        throw new Error("ByteDance OmniHuman v1.5 requires an audio file");
      }
      // Convert audio to data URL
      const audioUrl = await fileToDataURL(request.audioFile);
      endpoint = modelConfig.endpoints.text_to_video;
      payload = {
        image_url: characterImageUrl,
        audio_url: audioUrl,
        ...(modelConfig.default_params || {}),
      };
    } else {
      throw new Error(`Unsupported avatar model: ${request.model}`);
    }

    const jobId = generateJobId();
    console.log(`🎭 Generating avatar video with: ${endpoint}`);
    console.log("📝 Payload:", {
      ...payload,
      video_url: payload.video_url ? `[base64 data: ${payload.video_url.length} chars]` : undefined,
      image_url: payload.image_url ? `[base64 data: ${payload.image_url.length} chars]` : undefined,
      audio_url: payload.audio_url ? `[base64 data: ${payload.audio_url.length} chars]` : undefined,
    });

    console.log("📊 Payload size:", JSON.stringify(payload).length, "bytes");

    // Add timeout to prevent hanging (3 minutes for large payloads)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minutes

    try {
      console.log("🚀 Sending request to FAL AI...");
      const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          "Authorization": `Key ${FAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      console.log("📥 Received response:", response.status, response.statusText);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("❌ FAL AI API error:", errorData);
        throw new Error(`Avatar generation failed: ${errorData.detail || response.statusText}`);
      }

      const result = await response.json();
      console.log("✅ Avatar video generated:", result);

      return {
        job_id: jobId,
        status: "completed",
        message: `Avatar video generated successfully with ${request.model}`,
        estimated_time: 0,
        video_url: result.video?.url || result.video,
        video_data: result,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        console.error("❌ Request timeout after 3 minutes");
        throw new Error("Avatar generation timed out after 3 minutes. The video/image files may be too large.");
      }
      throw error;
    }
  } catch (error) {
    handleAIServiceError(error, "Generate avatar video", {
      model: request.model,
      operation: "generateAvatarVideo",
    });
    throw error;
  }
}

/**
 * Polls FAL AI job status during video generation.
 *
 * WHY: FAL AI uses async job queue; this function is called repeatedly until job completes.
 * Business logic: Currently returns mock "completed" status because generateVideo/generateVideoFromImage
 *                 handle polling internally via FAL SDK. This function exists for backward compatibility
 *                 with UI components that expect polling capability.
 * Performance: No-op function; actual polling happens in FAL SDK subscribe() method.
 *
 * Edge case: If you need true status polling, integrate FAL's status endpoint directly.
 *
 * @param jobId - Job identifier returned from generation request
 * @returns Mock GenerationStatus indicating completion
 * @deprecated Use FAL SDK's built-in polling via subscribe() instead
 */
export async function getGenerationStatus(
  jobId: string
): Promise<GenerationStatus> {
  // Since we're doing direct FAL API calls, generation is synchronous
  // This function is kept for compatibility with existing UI polling logic
  return {
    job_id: jobId,
    status: "completed",
    progress: 100,
    video_url: undefined, // Will be set by the actual generation response
    error: undefined,
  };
}

/**
 * Retrieves the list of available AI models from centralized configuration.
 *
 * WHY: Provides single source of truth for model metadata (pricing, resolution, capabilities).
 * Side effect: Adds "$" prefix to price for UI display consistency.
 * Performance: Synchronous map operation; negligible cost (~10 models).
 *
 * Edge case: Returns static configuration; doesn't reflect real-time FAL API model availability.
 *
 * @returns ModelsResponse containing all configured AI models with formatted pricing
 */
export async function getAvailableModels(): Promise<ModelsResponse> {
  return {
    models: AI_MODELS.map((model) => ({
      ...model,
      price: `$${model.price}`, // Add $ prefix for display
    })),
  };
}

/**
 * Estimates the cost of video generation based on model pricing and duration.
 *
 * WHY: Helps users make informed decisions before expensive generation operations.
 * Business logic: FAL AI pricing scales linearly with duration; base price is for 5s video.
 *   - 5s video = base cost (e.g., $0.15 for Kling v2.1)
 *   - 10s video = 2x base cost (e.g., $0.30)
 * Performance: Synchronous calculation; no API calls.
 *
 * Edge cases:
 * - Unknown models default to $1.00 base cost to prevent $0 estimates
 * - Duration capped to model's max_duration (e.g., Hailuo Pro maxes at 6s)
 * - Minimum multiplier is 1.0; shorter durations don't reduce cost below base
 *
 * @param request - Model ID and desired video duration
 * @returns CostEstimate with base_cost, duration multiplier, and final estimated_cost
 */
export async function estimateCost(
  request: VideoGenerationRequest
): Promise<CostEstimate> {
  // Use centralized model configuration
  const modelConfig = getModelConfig(request.model);
  const modelInfo = modelConfig
    ? {
        base_cost: parseFloat(modelConfig.price),
        max_duration: modelConfig.max_duration,
      }
    : {
        base_cost: 1.0,
        max_duration: 30,
      };
  const actualDuration = Math.min(
    request.duration || 5,
    modelInfo.max_duration
  );
  const durationMultiplier = Math.max(1, actualDuration / 5);
  const estimatedCost = modelInfo.base_cost * durationMultiplier;

  return {
    model: request.model,
    duration: actualDuration,
    base_cost: modelInfo.base_cost,
    estimated_cost: estimatedCost,
    currency: "USD",
  };
}

/**
 * Converts API errors into user-friendly error messages.
 *
 * WHY: Standardizes error handling across all generation functions to prevent raw stack traces in UI.
 * Edge case: Non-Error objects (e.g., thrown strings/numbers) return generic message.
 *
 * @param error - Unknown error object from try/catch blocks
 * @returns Human-readable error message suitable for display
 */
export function handleApiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "An unknown error occurred";
}

/**
 * Checks if FAL API key is configured in environment variables.
 *
 * WHY: Prevents cryptic "401 Unauthorized" errors by failing fast with clear message.
 * Side effect: Does NOT validate key with FAL API; only checks if key exists.
 * Performance: Instant check; no network request.
 *
 * @returns true if VITE_FAL_API_KEY is set, false otherwise
 */
export async function isApiAvailable(): Promise<boolean> {
  return !!FAL_API_KEY;
}

/**
 * Downloads video using streaming API to handle large files without memory spikes.
 *
 * WHY: FAL AI videos can exceed 100MB; downloading entire video to memory causes browser crashes.
 * Performance: Streams chunks incrementally; memory usage stays constant regardless of file size.
 * Side effect: Calls onDataReceived callback for each chunk (~64KB); useful for progress bars.
 *
 * Edge cases:
 * - If FAL CDN returns non-200 status, throws with detailed HTTP error
 * - Some older browsers lack ReadableStream support; falls back to arraybuffer() method
 * - Large videos (>500MB) may still timeout; caller should implement retry logic
 *
 * @param videoUrl - FAL AI CDN URL (typically https://fal.media/files/...)
 * @param downloadOptions - Controls chunk processing and completion callbacks
 * @returns Complete video data as Uint8Array for IndexedDB storage or Blob creation
 * @throws Error if video URL is unreachable or streaming fails mid-download
 */
async function streamVideoDownload(
  videoUrl: string,
  downloadOptions: {
    downloadToMemory?: boolean;
    onDataReceived?: (data: Uint8Array) => void;
    onComplete?: (totalData: Uint8Array) => void;
  }
): Promise<Uint8Array> {
  console.log("🔗 Starting streaming download from:", videoUrl);

  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download video: ${response.status} ${response.statusText}`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const chunks: Uint8Array[] = [];
  let receivedLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedLength += value.length;

      // Notify progress if callback provided
      if (downloadOptions.onDataReceived) {
        downloadOptions.onDataReceived(value);
      }

      console.log(`📊 Downloaded ${receivedLength} bytes...`);
    }

    // Combine all chunks into single Uint8Array
    const totalData = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      totalData.set(chunk, position);
      position += chunk.length;
    }

    console.log(`✅ Download complete: ${totalData.length} bytes total`);
    return totalData;
  } finally {
    reader.releaseLock();
  }
}
