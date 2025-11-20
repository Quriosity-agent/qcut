import { TEXT2IMAGE_MODELS, type Text2ImageModel } from "./text2image-models";
import { debugLogger } from "./debug-logger";
import {
  handleAIServiceError,
  handleError,
  ErrorCategory,
  ErrorSeverity,
} from "./error-handler";
import type {
  Veo31TextToVideoInput,
  Veo31ImageToVideoInput,
  Veo31FrameToVideoInput,
  Veo31Response,
  ReveTextToImageInput,
  ReveTextToImageOutput,
  ReveEditInput,
  ReveEditOutput,
} from "@/types/ai-generation";
import type { VideoGenerationResponse } from "./ai-video-client";

// Types for API responses
interface FalImageResponse {
  // Most models return images array
  images?: Array<{
    url: string;
    width: number;
    height: number;
    content_type: string;
  }>;
  // WAN v2.2 returns single image object
  image?: {
    url: string;
    width: number;
    height: number;
    content_type?: string;
  };
  timings?: Record<string, number>;
  seed?: number;
  has_nsfw_concepts?: boolean[];
}

interface GenerationResult {
  success: boolean;
  imageUrl?: string;
  error?: string;
  metadata?: {
    seed?: number;
    timings?: Record<string, number>;
    dimensions?: { width: number; height: number };
  };
}

interface UploadError extends Error {
  status?: number;
  statusText?: string;
  errorData?: unknown;
}

const VALID_OUTPUT_FORMATS = ["jpeg", "png", "webp"] as const;
type OutputFormat = (typeof VALID_OUTPUT_FORMATS)[number];
const DEFAULT_OUTPUT_FORMAT: OutputFormat = "jpeg";

const DEFAULT_ASPECT_RATIO = "1:1";
const IMAGE_SIZE_TO_ASPECT_RATIO: Record<string, string> = {
  square: "1:1",
  square_hd: "1:1",
  portrait_3_4: "3:4",
  portrait_9_16: "9:16",
  landscape_4_3: "4:3",
  landscape_16_9: "16:9",
};
const ASPECT_RATIO_PATTERN = /^\d+:\d+$/;

const normalizeAspectRatio = (value?: string | null): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, "");
  if (ASPECT_RATIO_PATTERN.test(normalized)) {
    return normalized;
  }

  return undefined;
};

const imageSizeToAspectRatio = (
  imageSize: string | number | undefined
): string => {
  if (typeof imageSize === "string") {
    if (IMAGE_SIZE_TO_ASPECT_RATIO[imageSize]) {
      return IMAGE_SIZE_TO_ASPECT_RATIO[imageSize];
    }

    const ratio = normalizeAspectRatio(imageSize);
    if (ratio) {
      return ratio;
    }

    const converted = normalizeAspectRatio(imageSize.replace(/_/g, ":"));
    if (converted) {
      return converted;
    }
  }

  return DEFAULT_ASPECT_RATIO;
};

export interface GenerationSettings {
  imageSize: string | number;
  seed?: number;
  outputFormat?: OutputFormat;
}

const FAL_LOG_COMPONENT = "FalAIClient";
const MIN_REVE_IMAGES = 1;
const MAX_REVE_IMAGES = 4;
const MAX_REVE_PROMPT_LENGTH = 2560;

const normalizeOutputFormat = (
  format?: string | null,
  fallback: OutputFormat = DEFAULT_OUTPUT_FORMAT
): OutputFormat => {
  if (!format) {
    return fallback;
  }

  const normalized = format.toString().toLowerCase() as OutputFormat;
  if (VALID_OUTPUT_FORMATS.includes(normalized)) {
    return normalized;
  }

  debugLogger.warn(FAL_LOG_COMPONENT, "OUTPUT_FORMAT_INVALID", {
    requestedFormat: format,
    fallback,
  });

  return fallback;
};

const clampReveNumImages = (value?: number): number => {
  if (value === undefined || value === null) {
    return MIN_REVE_IMAGES;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    debugLogger.warn(FAL_LOG_COMPONENT, "REVE_NUM_IMAGES_INVALID", {
      input: value,
      defaultValue: MIN_REVE_IMAGES,
    });
    return MIN_REVE_IMAGES;
  }

  const rounded = Math.floor(value);
  const clamped = Math.min(Math.max(rounded, MIN_REVE_IMAGES), MAX_REVE_IMAGES);

  if (rounded !== value || clamped !== rounded) {
    debugLogger.warn(FAL_LOG_COMPONENT, "REVE_NUM_IMAGES_ADJUSTED", {
      originalValue: value,
      roundedValue: rounded,
      clampedValue: clamped,
      min: MIN_REVE_IMAGES,
      max: MAX_REVE_IMAGES,
    });
  }

  return clamped;
};

const truncateRevePrompt = (prompt: string): string => {
  if (prompt.length > MAX_REVE_PROMPT_LENGTH) {
    debugLogger.warn(FAL_LOG_COMPONENT, "REVE_PROMPT_TRUNCATED", {
      originalLength: prompt.length,
      maxLength: MAX_REVE_PROMPT_LENGTH,
    });
  }

  return prompt.length > MAX_REVE_PROMPT_LENGTH
    ? prompt.slice(0, MAX_REVE_PROMPT_LENGTH)
    : prompt;
};

const validateRevePrompt = (prompt: string): void => {
  if (typeof prompt !== "string") {
    throw new Error("Prompt must be provided as a string.");
  }

  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    throw new Error("Prompt cannot be empty.");
  }

  if (trimmedPrompt.length > MAX_REVE_PROMPT_LENGTH) {
    throw new Error(
      `Prompt must be ${MAX_REVE_PROMPT_LENGTH} characters or fewer.`
    );
  }
};

const validateReveNumImages = (value?: number): void => {
  if (value === undefined || value === null) {
    return;
  }

  if (!Number.isFinite(value)) {
    throw new Error("Number of images must be a finite value.");
  }

  if (!Number.isInteger(value)) {
    throw new Error("Number of images must be a whole number.");
  }

  if (value < MIN_REVE_IMAGES || value > MAX_REVE_IMAGES) {
    throw new Error(
      `Reve supports between ${MIN_REVE_IMAGES} and ${MAX_REVE_IMAGES} images per request. You requested ${value}.`
    );
  }
};

// Multi-model generation result
export type MultiModelGenerationResult = Record<string, GenerationResult>;

class FalAIClient {
  private apiKey: string | null = null;
  private baseUrl = "https://fal.run";

  constructor() {
    // Try to get API key from environment variables
    // TODO: Move API key retrieval to a secure backend/Electron IPC channel so the key never ships to the browser bundle.
    // Short-term mitigation: avoid logging the key and rely on server-side rate limiting as documented in ops runbook.
    this.apiKey =
      import.meta.env.VITE_FAL_API_KEY ||
      (typeof window !== "undefined" &&
        (window as any).process?.env?.FAL_API_KEY) ||
      null;

    if (!this.apiKey) {
      debugLogger.error(
        FAL_LOG_COMPONENT,
        "API_KEY_MISSING",
        "FAL API key not found at initialization. Set VITE_FAL_API_KEY or configure it in Settings."
      );
    }
  }

  private async makeRequest<T = FalImageResponse>(
    endpoint: string,
    params: Record<string, unknown>
  ): Promise<T> {
    // Check if API key is available
    if (!this.apiKey) {
      throw new Error(
        "FAL API key is required for text-to-image generation. Please set VITE_FAL_API_KEY environment variable."
      );
    }

    // The endpoint already contains the full URL, so use it directly
    const requestUrl = endpoint.startsWith("https://")
      ? endpoint
      : `${this.baseUrl}${endpoint}`;

    debugLogger.log(FAL_LOG_COMPONENT, "REQUEST_START", {
      endpoint: requestUrl,
      params,
    });

    // Make direct API call to fal.run instead of proxy
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${this.apiKey}`,
      },
      body: JSON.stringify(params),
    });

    debugLogger.log(FAL_LOG_COMPONENT, "REQUEST_STATUS", {
      endpoint: requestUrl,
      status: response.status,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      handleAIServiceError(
        new Error(`FAL AI API request failed: ${response.status}`),
        "FAL AI API request",
        {
          status: response.status,
          statusText: response.statusText,
          errorData,
          endpoint: requestUrl,
          operation: "makeRequest",
        }
      );

      // Handle different error response formats
      let errorMessage = `API request failed: ${response.status}`;

      if (errorData.error) {
        if (typeof errorData.error === "string") {
          errorMessage = errorData.error;
        } else if (typeof errorData.error === "object") {
          errorMessage = JSON.stringify(errorData.error, null, 2);
        }
      } else if (errorData.detail) {
        if (typeof errorData.detail === "string") {
          errorMessage = errorData.detail;
        } else if (Array.isArray(errorData.detail)) {
          errorMessage = errorData.detail
            .map((d: any) => d.msg || JSON.stringify(d))
            .join(", ");
        } else {
          errorMessage = JSON.stringify(errorData.detail, null, 2);
        }
      } else if (errorData.message) {
        errorMessage = errorData.message;
      }

      throw new Error(errorMessage);
    }

    const result = (await response.json()) as T;
    debugLogger.log(FAL_LOG_COMPONENT, "REQUEST_SUCCESS", {
      endpoint: requestUrl,
      responseType: typeof result,
    });
    return result;
  }

  private async uploadFileToFal(
    file: File,
    fileType: "image" | "audio" | "video" | "asset" = "asset"
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error(
        "FAL API key is required for asset upload. Please set the VITE_FAL_API_KEY environment variable."
      );
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("https://fal.run/upload", {
        method: "POST",
        headers: {
          Authorization: `Key ${this.apiKey}`,
        },
        body: formData,
      });

      const data = (await response.json().catch(() => null)) as {
        url?: string;
      } | null;

      if (!response.ok) {
        const errorMessage = `FAL ${fileType} upload failed: ${response.status} ${response.statusText}`;
        const error = new Error(errorMessage) as UploadError;
        error.status = response.status;
        error.statusText = response.statusText;
        error.errorData = data;
        throw error;
      }

      if (!data || typeof data.url !== "string") {
        const error = new Error(
          `FAL ${fileType} upload response is missing a url field.`
        ) as UploadError;
        error.errorData = data;
        throw error;
      }

      return data.url;
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      const metadata: Record<string, unknown> = {
        filename: file.name,
        fileSize: file.size,
        fileType: file.type,
        uploadType: fileType,
      };

      const uploadError = normalizedError as UploadError;
      if (uploadError.status) metadata.status = uploadError.status;
      if (uploadError.statusText) metadata.statusText = uploadError.statusText;
      if (uploadError.errorData) metadata.errorData = uploadError.errorData;

      handleAIServiceError(
        normalizedError,
        `FAL ${fileType} upload`,
        metadata
      );
      throw normalizedError;
    }
  }

  /**
   * Uploads an image file to FAL storage and returns the resulting URL.
   */
  async uploadImageToFal(file: File): Promise<string> {
    return this.uploadFileToFal(file, "image");
  }

  /**
   * Uploads an audio file (MP3/WAV) to FAL storage and returns the resulting URL.
   */
  async uploadAudioToFal(file: File): Promise<string> {
    return this.uploadFileToFal(file, "audio");
  }

  /**
   * Uploads an MP4/MOV/AVI asset to FAL storage and returns the URL.
   */
  async uploadVideoToFal(file: File): Promise<string> {
    return this.uploadFileToFal(file, "video");
  }

  private convertSettingsToParams(
    model: Text2ImageModel,
    prompt: string,
    settings: GenerationSettings
  ): Record<string, any> {
    const params: Record<string, any> = {
      prompt,
      ...model.defaultParams,
    };

    // Add seed if provided
    if (settings.seed !== undefined && settings.seed !== null) {
      params.seed = settings.seed;
    }

    // Convert generic settings to model-specific parameters
    switch (model.id) {
      case "imagen4-ultra":
        // Imagen4 uses aspect_ratio - map from size format to aspect ratio
        switch (settings.imageSize) {
          case "square":
          case "square_hd":
            params.aspect_ratio = "1:1";
            break;
          case "portrait_3_4":
            params.aspect_ratio = "3:4";
            break;
          case "portrait_9_16":
            params.aspect_ratio = "9:16";
            break;
          case "landscape_4_3":
            params.aspect_ratio = "4:3";
            break;
          case "landscape_16_9":
            params.aspect_ratio = "16:9";
            break;
          default:
            params.aspect_ratio = "1:1";
        }
        break;

      case "seeddream-v3":
        // SeedDream v3 uses image_size (predefined values or custom)
        params.image_size = settings.imageSize;
        break;

      case "wan-v2-2":
        // WAN v2.2 uses image_size like SeedDream v3
        params.image_size = settings.imageSize;
        break;

      case "qwen-image":
        // Qwen Image uses image_size parameter
        params.image_size = settings.imageSize;
        break;

      case "flux-pro-v11-ultra":
        // FLUX Pro uses aspect_ratio
        switch (settings.imageSize) {
          case "square":
          case "square_hd":
            params.aspect_ratio = "1:1";
            break;
          case "portrait_3_4":
            params.aspect_ratio = "3:4";
            break;
          case "portrait_9_16":
            params.aspect_ratio = "9:16";
            break;
          case "landscape_4_3":
            params.aspect_ratio = "4:3";
            break;
          case "landscape_16_9":
            params.aspect_ratio = "16:9";
            break;
          default:
            params.aspect_ratio = "16:9"; // Default for FLUX
        }
        break;

      case "seeddream-v4":
        // SeedDream V4 uses string image_size values like "square_hd", "square", etc.
        if (typeof settings.imageSize === "string") {
          // Validate and use string values directly for V4
          const validV4Sizes = [
            "square",
            "square_hd",
            "portrait_3_4",
            "landscape_4_3",
            "portrait_9_16",
            "landscape_16_9",
          ];
          if (validV4Sizes.includes(settings.imageSize)) {
            params.image_size = settings.imageSize;
          } else {
            debugLogger.warn(
              FAL_LOG_COMPONENT,
              "SEEDDREAM_V4_INVALID_IMAGE_SIZE",
              {
                requestedSize: settings.imageSize,
                fallback: "square_hd",
              }
            );
            params.image_size = "square_hd";
          }
        } else if (typeof settings.imageSize === "number") {
          // Convert numeric size to closest V4 string equivalent
          const clampedSize = Math.min(
            Math.max(Math.round(settings.imageSize), 1024),
            4096
          );
          if (clampedSize >= 1536) {
            params.image_size = "square_hd"; // 1536x1536
          } else if (clampedSize >= 1280) {
            params.image_size = "portrait_3_4"; // ~1280px
          } else {
            params.image_size = "square"; // 1024x1024
          }
          debugLogger.log(FAL_LOG_COMPONENT, "SEEDDREAM_V4_SIZE_COERCED", {
            inputSize: settings.imageSize,
            coercedSize: params.image_size,
          });
        } else {
          // Default fallback
          params.image_size = "square_hd";
        }
        break;

      case "nano-banana":
        // Nano Banana expects aspect_ratio instead of image_size
        params.aspect_ratio = imageSizeToAspectRatio(settings.imageSize);
        delete params.image_size;
        delete params.seed;
        break;
    }

    const supportsOutputFormat = model.availableParams.some(
      (param) => param.name === "output_format"
    );
    // Consolidate potential format values from settings or params (snake_case or camelCase).
    const potentialFormat =
      settings.outputFormat ??
      (params.output_format as string | undefined) ??
      ((params as Record<string, unknown>).outputFormat as string | undefined);
    if (supportsOutputFormat) {
      // Normalize the format and assign it, falling back to the default if none is found.
      params.output_format = normalizeOutputFormat(potentialFormat);
      // Ensure the camelCase version is removed to avoid sending both.
      delete (params as Record<string, unknown>).outputFormat;
    } else if (potentialFormat) {
      // Model doesn't support output_format but user provided it; warn and drop it to avoid 422s.
      debugLogger.warn(FAL_LOG_COMPONENT, "OUTPUT_FORMAT_NOT_SUPPORTED", {
        modelId: model.id,
        requestedFormat: potentialFormat,
      });
      delete (params as Record<string, unknown>).outputFormat;
    }

    return params;
  }

  async generateWithModel(
    modelKey: string,
    prompt: string,
    settings: GenerationSettings
  ): Promise<GenerationResult> {
    try {
      const model = TEXT2IMAGE_MODELS[modelKey];
      if (!model) {
        throw new Error(`Unknown model: ${modelKey}`);
      }

      const params = this.convertSettingsToParams(model, prompt, settings);

      debugLogger.log(FAL_LOG_COMPONENT, "MODEL_GENERATION_START", {
        model: model.name,
        modelKey,
        promptPreview: prompt.slice(0, 120),
        promptLength: prompt.length,
        params,
      });

      const response = await this.makeRequest(model.endpoint, params);

      let image: { url: string; width: number; height: number };

      // Handle different response formats
      if (modelKey === "wan-v2-2") {
        // WAN v2.2 returns {image: {...}, seed: ...}
        if (!response.image) {
          throw new Error("No image returned from API");
        }
        image = response.image;
      } else {
        // Other models return {images: [...], seed: ...}
        if (!response.images || response.images.length === 0) {
          throw new Error("No images returned from API");
        }
        image = response.images[0];
      }

      return {
        success: true,
        imageUrl: image.url,
        metadata: {
          seed: response.seed,
          timings: response.timings,
          dimensions: {
            width: image.width,
            height: image.height,
          },
        },
      };
    } catch (error) {
      handleAIServiceError(error, "Generate image with FAL AI model", {
        modelKey,
        operation: "generateWithModel",
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  async generateWithMultipleModels(
    modelKeys: string[],
    prompt: string,
    settings: GenerationSettings
  ): Promise<MultiModelGenerationResult> {
    debugLogger.log(FAL_LOG_COMPONENT, "MULTI_MODEL_GENERATION_START", {
      modelKeys,
      modelCount: modelKeys.length,
    });

    // Create promises for all model generations
    const generationPromises = modelKeys.map(async (modelKey) => {
      const result = await this.generateWithModel(modelKey, prompt, settings);
      return [modelKey, result] as [string, GenerationResult];
    });

    try {
      // Wait for all generations to complete (or fail)
      const results = await Promise.allSettled(generationPromises);

      const finalResults: MultiModelGenerationResult = {};

      results.forEach((result, index) => {
        const modelKey = modelKeys[index];

        if (result.status === "fulfilled") {
          finalResults[modelKey] = result.value[1];
        } else {
          handleAIServiceError(result.reason, "Multi-model image generation", {
            modelKey,
            operation: "generateWithMultipleModels",
          });
          finalResults[modelKey] = {
            success: false,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : "Generation failed",
          };
        }
      });

      return finalResults;
    } catch (error) {
      handleAIServiceError(error, "Multi-model image generation", {
        modelCount: modelKeys.length,
        operation: "generateWithMultipleModels",
      });

      // Return error results for all models
      const errorResults: MultiModelGenerationResult = {};
      modelKeys.forEach((modelKey) => {
        errorResults[modelKey] = {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Multi-model generation failed",
        };
      });

      return errorResults;
    }
  }

  // API key management
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    debugLogger.log(FAL_LOG_COMPONENT, "API_KEY_UPDATED", {
      keyLength: apiKey?.length ?? 0,
    });
  }

  hasApiKey(): boolean {
    return !!this.apiKey;
  }

  getApiKeyStatus(): { hasKey: boolean; source: string } {
    if (!this.apiKey) {
      return { hasKey: false, source: "none" };
    }

    // Determine source of API key
    let source = "unknown";
    if (import.meta.env.VITE_FAL_API_KEY) source = "VITE_FAL_API_KEY";
    else if (
      typeof window !== "undefined" &&
      (window as any).process?.env?.FAL_API_KEY
    )
      source = "window.process.env.FAL_API_KEY";
    else source = "manually_set";

    return { hasKey: true, source };
  }

  // Utility methods
  async testModelAvailability(modelKey: string): Promise<boolean> {
    try {
      // Check API key first
      if (!this.hasApiKey()) {
        debugLogger.warn(FAL_LOG_COMPONENT, "MODEL_TEST_SKIPPED_NO_KEY", {
          modelKey,
        });
        return false;
      }

      const model = TEXT2IMAGE_MODELS[modelKey];
      if (!model) return false;

      // Test with a simple prompt
      const result = await this.generateWithModel(modelKey, "test image", {
        imageSize: "square",
      });

      return result.success;
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)), {
        operation: "Test FAL AI model availability",
        category: ErrorCategory.AI_SERVICE,
        severity: ErrorSeverity.MEDIUM,
        metadata: { modelKey, operation: "testModelAvailability" },
        showToast: false, // Don't spam users with test failures
      });
      return false;
    }
  }

  async estimateGenerationTime(
    modelKeys: string[],
    prompt: string
  ): Promise<Record<string, number>> {
    const estimates: Record<string, number> = {};

    modelKeys.forEach((modelKey) => {
      const model = TEXT2IMAGE_MODELS[modelKey];
      if (model) {
        // Rough estimation based on model speed rating and prompt complexity
        const baseTime = 15; // seconds
        const speedMultiplier = (6 - model.speedRating) * 0.5; // 0.5 to 2.5
        const promptComplexity = Math.min(prompt.split(" ").length / 10, 2); // 0 to 2

        estimates[modelKey] = Math.round(
          baseTime * speedMultiplier * (1 + promptComplexity)
        );
      }
    });

    return estimates;
  }

  async getModelCapabilities(modelKey: string): Promise<{
    available: boolean;
    maxResolution: string;
    estimatedCost: string;
    features: string[];
  } | null> {
    const model = TEXT2IMAGE_MODELS[modelKey];
    if (!model) return null;

    return {
      available: true, // Would check with actual API in real implementation
      maxResolution: model.maxResolution,
      estimatedCost: model.estimatedCost,
      features: model.strengths,
    };
  }

  // ============================================
  // Veo 3.1 FAST Methods (budget-friendly, faster)
  // ============================================

  /**
   * Generate video from text using Veo 3.1 Fast
   * @param params Veo 3.1 text-to-video parameters
   * @returns Video generation response with video URL or error
   */
  async generateVeo31FastTextToVideo(
    params: Veo31TextToVideoInput
  ): Promise<VideoGenerationResponse> {
    try {
      const endpoint = "https://fal.run/fal-ai/veo3.1/fast";

      debugLogger.log(FAL_LOG_COMPONENT, "VEO31_FAST_TEXT_TO_VIDEO_REQUEST", {
        params,
      });

      const response = await this.makeRequest<Veo31Response>(
        endpoint,
        params as unknown as Record<string, unknown>
      );

      if (!response.video?.url) {
        throw new Error("No video URL in Veo 3.1 Fast response");
      }

      return {
        job_id: `veo31_fast_${Date.now()}`, // Generate unique ID
        status: "completed",
        message: "Video generated successfully",
        video_url: response.video.url,
      };
    } catch (error) {
      handleAIServiceError(error, "Veo 3.1 Fast text-to-video generation", {
        operation: "generateVeo31FastTextToVideo",
      });

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Veo 3.1 Fast generation failed";
      return {
        job_id: `veo31_fast_error_${Date.now()}`,
        status: "failed",
        message: errorMessage,
      };
    }
  }

  /**
   * Generate video from image using Veo 3.1 Fast
   * @param params Veo 3.1 image-to-video parameters
   * @returns Generation result with video URL or error
   */
  async generateVeo31FastImageToVideo(
    params: Veo31ImageToVideoInput
  ): Promise<VideoGenerationResponse> {
    try {
      const endpoint = "https://fal.run/fal-ai/veo3.1/fast/image-to-video";

      debugLogger.log(FAL_LOG_COMPONENT, "VEO31_FAST_IMAGE_TO_VIDEO_REQUEST", {
        params,
      });

      const response = await this.makeRequest<Veo31Response>(
        endpoint,
        params as unknown as Record<string, unknown>
      );

      if (!response.video?.url) {
        throw new Error("No video URL in Veo 3.1 Fast response");
      }

      return {
        job_id: `veo31_fast_img2vid_${Date.now()}`,
        status: "completed",
        message: "Video generated successfully",
        video_url: response.video.url,
      };
    } catch (error) {
      handleAIServiceError(error, "Veo 3.1 Fast image-to-video generation", {
        operation: "generateVeo31FastImageToVideo",
      });

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Veo 3.1 Fast generation failed";
      return {
        job_id: `veo31_fast_img2vid_error_${Date.now()}`,
        status: "failed",
        message: errorMessage,
      };
    }
  }

  /**
   * Generate video from first and last frames using Veo 3.1 Fast
   * @param params Veo 3.1 frame-to-video parameters
   * @returns Generation result with video URL or error
   */
  async generateVeo31FastFrameToVideo(
    params: Veo31FrameToVideoInput
  ): Promise<VideoGenerationResponse> {
    try {
      const endpoint =
        "https://fal.run/fal-ai/veo3.1/fast/first-last-frame-to-video";

      debugLogger.log(FAL_LOG_COMPONENT, "VEO31_FAST_FRAME_TO_VIDEO_REQUEST", {
        params,
      });

      const response = await this.makeRequest<Veo31Response>(
        endpoint,
        params as unknown as Record<string, unknown>
      );

      if (!response.video?.url) {
        throw new Error("No video URL in Veo 3.1 Fast response");
      }

      return {
        job_id: `veo31_fast_frame2vid_${Date.now()}`,
        status: "completed",
        message: "Video generated successfully",
        video_url: response.video.url,
      };
    } catch (error) {
      handleAIServiceError(error, "Veo 3.1 Fast frame-to-video generation", {
        operation: "generateVeo31FastFrameToVideo",
      });

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Veo 3.1 Fast generation failed";
      return {
        job_id: `veo31_fast_frame2vid_error_${Date.now()}`,
        status: "failed",
        message: errorMessage,
      };
    }
  }

  // ============================================
  // Veo 3.1 STANDARD Methods (premium quality)
  // ============================================

  /**
   * Generate video from text using Veo 3.1 Standard
   * @param params Veo 3.1 text-to-video parameters
   * @returns Generation result with video URL or error
   */
  async generateVeo31TextToVideo(
    params: Veo31TextToVideoInput
  ): Promise<VideoGenerationResponse> {
    try {
      const endpoint = "https://fal.run/fal-ai/veo3.1"; // No /fast suffix

      debugLogger.log(
        FAL_LOG_COMPONENT,
        "VEO31_STANDARD_TEXT_TO_VIDEO_REQUEST",
        {
          params,
        }
      );

      const response = await this.makeRequest<Veo31Response>(
        endpoint,
        params as unknown as Record<string, unknown>
      );

      if (!response.video?.url) {
        throw new Error("No video URL in Veo 3.1 Standard response");
      }

      return {
        job_id: `veo31_std_${Date.now()}`,
        status: "completed",
        message: "Video generated successfully",
        video_url: response.video.url,
      };
    } catch (error) {
      handleAIServiceError(error, "Veo 3.1 Standard text-to-video generation", {
        operation: "generateVeo31TextToVideo",
      });

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Veo 3.1 Standard generation failed";
      return {
        job_id: `veo31_std_error_${Date.now()}`,
        status: "failed",
        message: errorMessage,
      };
    }
  }

  /**
   * Generate video from image using Veo 3.1 Standard
   * @param params Veo 3.1 image-to-video parameters
   * @returns Generation result with video URL or error
   */
  async generateVeo31ImageToVideo(
    params: Veo31ImageToVideoInput
  ): Promise<VideoGenerationResponse> {
    try {
      const endpoint = "https://fal.run/fal-ai/veo3.1/image-to-video"; // No /fast

      debugLogger.log(
        FAL_LOG_COMPONENT,
        "VEO31_STANDARD_IMAGE_TO_VIDEO_REQUEST",
        {
          params,
        }
      );

      const response = await this.makeRequest<Veo31Response>(
        endpoint,
        params as unknown as Record<string, unknown>
      );

      if (!response.video?.url) {
        throw new Error("No video URL in Veo 3.1 Standard response");
      }

      return {
        job_id: `veo31_std_img2vid_${Date.now()}`,
        status: "completed",
        message: "Video generated successfully",
        video_url: response.video.url,
      };
    } catch (error) {
      handleAIServiceError(
        error,
        "Veo 3.1 Standard image-to-video generation",
        {
          operation: "generateVeo31ImageToVideo",
        }
      );

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Veo 3.1 Standard generation failed";
      return {
        job_id: `veo31_std_img2vid_error_${Date.now()}`,
        status: "failed",
        message: errorMessage,
      };
    }
  }

  /**
   * Generate video from first and last frames using Veo 3.1 Standard
   * @param params Veo 3.1 frame-to-video parameters
   * @returns Video generation response with video URL or error
   */
  async generateVeo31FrameToVideo(
    params: Veo31FrameToVideoInput
  ): Promise<VideoGenerationResponse> {
    try {
      const endpoint =
        "https://fal.run/fal-ai/veo3.1/first-last-frame-to-video"; // No /fast

      debugLogger.log(
        FAL_LOG_COMPONENT,
        "VEO31_STANDARD_FRAME_TO_VIDEO_REQUEST",
        {
          params,
        }
      );

      const response = await this.makeRequest<Veo31Response>(
        endpoint,
        params as unknown as Record<string, unknown>
      );

      if (!response.video?.url) {
        throw new Error("No video URL in Veo 3.1 Standard response");
      }

      return {
        job_id: `veo31_std_frame2vid_${Date.now()}`,
        status: "completed",
        message: "Video generated successfully",
        video_url: response.video.url,
      };
    } catch (error) {
      handleAIServiceError(
        error,
        "Veo 3.1 Standard frame-to-video generation",
        {
          operation: "generateVeo31FrameToVideo",
        }
      );

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Veo 3.1 Standard generation failed";
      return {
        job_id: `veo31_std_frame2vid_error_${Date.now()}`,
        status: "failed",
        message: errorMessage,
      };
    }
  }

  /**
   * Generate images with Reve Text-to-Image model
   *
   * @param params - Reve text-to-image parameters
   * @returns Image generation response with URLs
   *
   * @example
   * const result = await client.generateReveTextToImage({
   *   prompt: "A serene mountain landscape at sunset",
   *   aspect_ratio: "16:9",
   *   num_images: 2,
   *   output_format: "png"
   * });
   */
  async generateReveTextToImage(
    params: ReveTextToImageInput
  ): Promise<ReveTextToImageOutput> {
    let sanitizedParams: ReveTextToImageInput | null = null;

    try {
      sanitizedParams = {
        ...params,
        prompt: truncateRevePrompt(params.prompt),
        num_images: clampReveNumImages(params.num_images),
      };
      sanitizedParams.output_format = normalizeOutputFormat(
        sanitizedParams.output_format ?? params.output_format,
        "png"
      );

      // Retrieve endpoint from single source of truth
      const model = TEXT2IMAGE_MODELS["reve-text-to-image"];
      if (!model) {
        throw new Error("Reve text-to-image model not found in configuration");
      }
      const endpoint = model.endpoint;

      debugLogger.log(FAL_LOG_COMPONENT, "REVE_TEXT_TO_IMAGE_REQUEST", {
        promptLength: sanitizedParams.prompt.length,
        promptPreview: sanitizedParams.prompt.slice(0, 120),
        num_images: sanitizedParams.num_images,
        aspect_ratio: sanitizedParams.aspect_ratio,
        output_format: sanitizedParams.output_format,
      });

      const response = await this.makeRequest<ReveTextToImageOutput>(
        endpoint,
        sanitizedParams as unknown as Record<string, unknown>
      );

      if (!response.images || response.images.length === 0) {
        throw new Error("No images in Reve Text-to-Image response");
      }

      debugLogger.log(FAL_LOG_COMPONENT, "REVE_TEXT_TO_IMAGE_COMPLETED", {
        imageCount: response.images.length,
      });
      return response;
    } catch (error) {
      handleAIServiceError(error, "Reve Text-to-Image generation", {
        operation: "generateReveTextToImage",
        promptLength: sanitizedParams?.prompt.length ?? params.prompt?.length,
        num_images: sanitizedParams?.num_images ?? params.num_images,
        aspect_ratio: sanitizedParams?.aspect_ratio ?? params.aspect_ratio,
        output_format: sanitizedParams?.output_format ?? params.output_format,
      });

      throw error instanceof Error
        ? error
        : new Error("Reve Text-to-Image generation failed");
    }
  }

  /**
   * Edit images with Reve Edit model
   *
   * @param params - Reve edit parameters
   * @returns Edited image response with URLs
   *
   * @example
   * const result = await client.generateReveEdit({
   *   prompt: "Make the sky sunset orange",
   *   image_url: "https://example.com/image.jpg",
   *   num_images: 2
   * });
   */
  async generateReveEdit(params: ReveEditInput): Promise<ReveEditOutput> {
    let sanitizedParams: ReveEditInput | null = null;

    try {
      sanitizedParams = {
        ...params,
        prompt: truncateRevePrompt(params.prompt.trim()),
        num_images: clampReveNumImages(params.num_images),
      };
      sanitizedParams.output_format = normalizeOutputFormat(
        sanitizedParams.output_format ?? params.output_format,
        "png"
      );

      // Validate sanitized inputs before issuing the request
      validateRevePrompt(sanitizedParams.prompt);
      validateReveNumImages(sanitizedParams.num_images);

      const trimmedImageUrl = sanitizedParams.image_url?.trim();
      if (!trimmedImageUrl || !/^(https?:|data:)/i.test(trimmedImageUrl)) {
        throw new Error("image_url must be http(s) or data: URI");
      }
      sanitizedParams = {
        ...sanitizedParams,
        image_url: trimmedImageUrl,
      };

      // Retrieve endpoint from single source of truth
      const { MODEL_ENDPOINTS } = await import("@/lib/image-edit-client");
      const modelConfig = MODEL_ENDPOINTS["reve-edit"];
      if (!modelConfig) {
        throw new Error("Reve edit model not found in configuration");
      }
      const endpoint = `https://fal.run/${modelConfig.endpoint}`;

      {
        const { prompt, image_url, ...rest } = sanitizedParams;
        debugLogger.log(FAL_LOG_COMPONENT, "REVE_EDIT_REQUEST", {
          ...rest,
          hasImage: !!image_url,
          promptLength: prompt.length,
          promptPreview: prompt.slice(0, 120),
        });
      }

      const response = await this.makeRequest<ReveEditOutput>(
        endpoint,
        sanitizedParams as unknown as Record<string, unknown>
      );

      if (!response.images || response.images.length === 0) {
        throw new Error("No images in Reve Edit response");
      }

      debugLogger.log(FAL_LOG_COMPONENT, "REVE_EDIT_COMPLETED", {
        imageCount: response.images.length,
      });
      return response;
    } catch (error) {
      handleAIServiceError(error, "Reve Edit generation", {
        operation: "generateReveEdit",
        promptLength: sanitizedParams?.prompt.length ?? params.prompt.length,
        num_images: sanitizedParams?.num_images ?? params.num_images,
        hasImage: !!(sanitizedParams?.image_url ?? params.image_url),
      });

      throw error instanceof Error
        ? error
        : new Error("Reve Edit generation failed");
    }
  }
}

// Add model-specific parameter conversion for image editing
export function convertParametersForModel(modelId: string, params: any) {
  switch (modelId) {
    case "seededit":
      // Keep existing V3 conversion unchanged
      return convertV3Parameters(params);

    case "seeddream-v4":
      return convertV4Parameters(params);

    case "nano-banana":
      return convertNanoBananaParameters(params);

    case "flux-kontext":
    case "flux-kontext-max":
      // Keep existing flux conversion unchanged
      return convertFluxParameters(params);

    default:
      throw new Error(`Unknown model: ${modelId}`);
  }
}

function convertV3Parameters(params: any) {
  // Keep existing V3 parameter structure
  return {
    prompt: params.prompt || "",
    image_url: params.image_url || params.imageUrl,
    guidance_scale: params.guidance_scale || params.guidanceScale || 1.0,
    num_inference_steps: params.num_inference_steps || params.steps || 20,
    seed: params.seed,
    safety_tolerance: params.safety_tolerance || params.safetyTolerance || 2,
    num_images: params.num_images || params.numImages || 1,
  };
}

/**
 * Converts and sanitizes V4 API parameters with proper validation
 * Enforces documented limits to prevent invalid requests
 * @param params - Raw parameters from the user
 * @returns Sanitized parameters for V4 API
 */
function convertV4Parameters(params: any) {
  // Helper function to clamp numeric values
  const clamp = (value: number, min: number, max: number): number => {
    return Math.min(Math.max(value, min), max);
  };

  // Sanitize image URLs - limit to max 10 URLs
  let imageUrls =
    params.image_urls || (params.imageUrl ? [params.imageUrl] : []);
  if (Array.isArray(imageUrls) && imageUrls.length > 10) {
    debugLogger.warn(FAL_LOG_COMPONENT, "FAL_V4_IMAGE_URLS_TRUNCATED", {
      originalCount: imageUrls.length,
      maxAllowed: 10,
    });
    imageUrls = imageUrls.slice(0, 10);
  }

  // Sanitize prompt - truncate to 5000 characters max
  let prompt = params.prompt || "";
  if (prompt.length > 5000) {
    debugLogger.warn(FAL_LOG_COMPONENT, "FAL_V4_PROMPT_TRUNCATED", {
      originalLength: prompt.length,
      maxLength: 5000,
    });
    prompt = prompt.substring(0, 5000);
  }

  // Validate image_size - must be valid preset or numeric value between 256-4096
  let imageSize = params.image_size || params.imageSize || "square_hd";
  const validPresets = [
    "square_hd",
    "square",
    "portrait_3_4",
    "portrait_9_16",
    "landscape_4_3",
    "landscape_16_9",
  ];
  if (typeof imageSize === "number") {
    imageSize = clamp(imageSize, 256, 4096);
  } else if (
    typeof imageSize === "string" &&
    !validPresets.includes(imageSize)
  ) {
    debugLogger.warn(FAL_LOG_COMPONENT, "FAL_V4_IMAGE_SIZE_INVALID", {
      requestedSize: imageSize,
      fallback: "square_hd",
    });
    imageSize = "square_hd";
  }

  // Clamp num_images to valid range (1-4)
  const numImages = clamp(params.num_images || params.numImages || 1, 1, 4);

  // Clamp max_images to valid range (1-4)
  const maxImages = clamp(params.max_images || params.maxImages || 1, 1, 4);

  return {
    image_urls: imageUrls,
    prompt,
    image_size: imageSize,
    max_images: maxImages,
    num_images: numImages,
    sync_mode: params.sync_mode || params.syncMode || false,
    enable_safety_checker:
      params.enable_safety_checker === true ||
      params.enableSafetyChecker === true,
    seed: params.seed,
  };
}

/**
 * Converts and sanitizes Nano Banana API parameters with proper validation
 * Enforces count limits and normalizes format specifications
 * @param params - Raw parameters from the user
 * @returns Sanitized parameters for Nano Banana API
 */
function convertNanoBananaParameters(params: any) {
  // Sanitize and validate image URLs - limit to max 10 URLs
  const urls = (params.image_urls ??
    (params.imageUrl ? [params.imageUrl] : [])) as string[];
  const imageUrls = Array.isArray(urls) ? urls.slice(0, 10) : [];

  if (Array.isArray(urls) && urls.length > 10) {
    debugLogger.warn(FAL_LOG_COMPONENT, "FAL_NANO_IMAGE_URLS_TRUNCATED", {
      originalCount: urls.length,
      maxAllowed: 10,
    });
  }

  // Clamp num_images to valid range (1-4)
  const numImages = Math.max(
    1,
    Math.min(4, Number(params.num_images ?? params.numImages ?? 1))
  );

  if (numImages !== (params.num_images ?? params.numImages ?? 1)) {
    debugLogger.warn(FAL_LOG_COMPONENT, "FAL_NANO_NUM_IMAGES_CLAMPED", {
      requested: params.num_images ?? params.numImages ?? 1,
      clamped: numImages,
      min: 1,
      max: 4,
    });
  }

  const requestedFormat =
    (params.output_format as string | undefined) ??
    (params.outputFormat as string | undefined) ??
    "png";
  const outputFormat = normalizeOutputFormat(requestedFormat, "png");

  // Ensure sync_mode is boolean
  const syncMode = Boolean(params.sync_mode ?? params.syncMode ?? false);

  // Sanitize prompt
  const prompt = params.prompt || "";

  return {
    image_urls: imageUrls,
    prompt,
    num_images: numImages,
    output_format: outputFormat,
    sync_mode: syncMode,
  };
}

/**
 * Converts and sanitizes FLUX API parameters with proper validation
 * Ensures consistency with other model parameter converters
 * @param params - Raw parameters from the user
 * @returns Sanitized parameters for FLUX API
 */
function convertFluxParameters(params: any) {
  // Sanitize and validate image URLs - consistent with V4 and Nano Banana
  const urls = params.image_urls ?? (params.imageUrl ? [params.imageUrl] : []);
  const imageUrls = Array.isArray(urls) ? urls.slice(0, 10) : [];

  if (Array.isArray(urls) && urls.length > 10) {
    debugLogger.warn(FAL_LOG_COMPONENT, "FAL_FLUX_IMAGE_URLS_TRUNCATED", {
      originalCount: urls.length,
      maxAllowed: 10,
    });
  }

  // Clamp num_images to valid range (1-4) - consistent with other models
  const numImages = Math.max(
    1,
    Math.min(4, Number(params.num_images ?? params.numImages ?? 1))
  );

  if (numImages !== (params.num_images ?? params.numImages ?? 1)) {
    debugLogger.warn(FAL_LOG_COMPONENT, "FAL_FLUX_NUM_IMAGES_CLAMPED", {
      requested: params.num_images ?? params.numImages ?? 1,
      clamped: numImages,
      min: 1,
      max: 4,
    });
  }

  // Clamp guidance_scale to reasonable range
  const guidanceScale = Math.max(
    1,
    Math.min(20, Number(params.guidance_scale ?? params.guidanceScale ?? 3.5))
  );

  // Clamp inference steps to reasonable range
  const inferenceSteps = Math.max(
    1,
    Math.min(100, Number(params.num_inference_steps ?? params.steps ?? 28))
  );

  // Clamp safety tolerance to valid range
  const safetyTolerance = Math.max(
    1,
    Math.min(6, Number(params.safety_tolerance ?? params.safetyTolerance ?? 2))
  );

  return {
    prompt: params.prompt || "",
    image_urls: imageUrls, // Use array format for consistency
    guidance_scale: guidanceScale,
    num_inference_steps: inferenceSteps,
    seed: params.seed,
    safety_tolerance: safetyTolerance,
    num_images: numImages,
  };
}

// Model detection and routing
export function detectModelVersion(
  modelId: string
): "v3" | "v4" | "nano-banana" | "flux" {
  if (modelId === "seeddream-v4") return "v4";
  if (modelId === "nano-banana") return "nano-banana";
  if (modelId.includes("flux")) return "flux";
  return "v3"; // default to V3 for backward compatibility
}

// Export singleton instance
export const falAIClient = new FalAIClient();

// Export main functions for easy importing
export async function generateWithModel(
  modelKey: string,
  prompt: string,
  settings: GenerationSettings
): Promise<GenerationResult> {
  return falAIClient.generateWithModel(modelKey, prompt, settings);
}

export async function generateWithMultipleModels(
  modelKeys: string[],
  prompt: string,
  settings: GenerationSettings
): Promise<MultiModelGenerationResult> {
  return falAIClient.generateWithMultipleModels(modelKeys, prompt, settings);
}

export async function testModelAvailability(
  modelKey: string
): Promise<boolean> {
  return falAIClient.testModelAvailability(modelKey);
}

export async function estimateGenerationTime(
  modelKeys: string[],
  prompt: string
): Promise<Record<string, number>> {
  return falAIClient.estimateGenerationTime(modelKeys, prompt);
}

// Helper function to batch requests with rate limiting
export async function batchGenerate(
  requests: Array<{
    modelKey: string;
    prompt: string;
    settings: GenerationSettings;
  }>,
  options: {
    concurrency?: number;
    delayBetweenBatches?: number;
  } = {}
): Promise<Array<{ request: (typeof requests)[0]; result: GenerationResult }>> {
  const { concurrency = 3, delayBetweenBatches = 1000 } = options;
  const results: Array<{
    request: (typeof requests)[0];
    result: GenerationResult;
  }> = [];

  // Process requests in batches
  for (let i = 0; i < requests.length; i += concurrency) {
    const batch = requests.slice(i, i + concurrency);

    const batchPromises = batch.map(async (request) => {
      const result = await generateWithModel(
        request.modelKey,
        request.prompt,
        request.settings
      );
      return { request, result };
    });

    const batchResults = await Promise.allSettled(batchPromises);

    batchResults.forEach((settledResult) => {
      if (settledResult.status === "fulfilled") {
        results.push(settledResult.value);
      } else {
        // Handle rejected batch item
        handleError(
          settledResult.reason instanceof Error
            ? settledResult.reason
            : new Error(String(settledResult.reason)),
          {
            operation: "Batch image generation",
            category: ErrorCategory.AI_SERVICE,
            severity: ErrorSeverity.MEDIUM,
            metadata: { operation: "batchGenerate" },
            showToast: false, // Don't spam with batch failures
          }
        );
      }
    });

    // Delay between batches to respect rate limits
    if (i + concurrency < requests.length && delayBetweenBatches > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }
  }

  return results;
}
