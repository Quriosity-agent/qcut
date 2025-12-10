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
import {
  uploadFileToFal as uploadFileToFalCore,
  type FalUploadFileType,
} from "./ai-video/core/fal-upload";
import {
  normalizeAspectRatio,
  imageSizeToAspectRatio,
  normalizeOutputFormat,
  clampReveNumImages,
  truncateRevePrompt,
  validateRevePrompt,
  validateReveNumImages,
  VALID_OUTPUT_FORMATS,
  DEFAULT_ASPECT_RATIO,
  IMAGE_SIZE_TO_ASPECT_RATIO,
  MIN_REVE_IMAGES,
  MAX_REVE_IMAGES,
  MAX_REVE_PROMPT_LENGTH,
  type OutputFormat,
} from "./ai-video/validation/validators";
import {
  convertV3Parameters,
  convertV4Parameters,
  convertNanoBananaParameters,
  convertFluxParameters,
  detectModelVersion,
} from "./fal-ai/model-handlers";

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

export interface GenerationSettings {
  imageSize: string | number;
  seed?: number;
  outputFormat?: OutputFormat;
}

const FAL_LOG_COMPONENT = "FalAIClient";

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

  /**
   * Upload a file to FAL.ai storage.
   * Delegates to shared upload module which handles Electron IPC fallback.
   */
  private async uploadFileToFal(
    file: File,
    fileType: FalUploadFileType = "asset"
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error(
        "FAL API key is required for asset upload. Please set the VITE_FAL_API_KEY environment variable."
      );
    }
    return uploadFileToFalCore(file, fileType, this.apiKey);
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

      case "flux-2-flex":
        // FLUX 2 Flex uses image_size enum directly (like WAN v2.2)
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

      case "seeddream-v4-5":
        // SeedDream V4.5 uses string image_size values including auto_2K/auto_4K
        if (typeof settings.imageSize === "string") {
          const validV45Sizes = [
            "square",
            "square_hd",
            "portrait_4_3",
            "portrait_16_9",
            "landscape_4_3",
            "landscape_16_9",
            "auto_2K",
            "auto_4K",
          ];
          if (validV45Sizes.includes(settings.imageSize)) {
            params.image_size = settings.imageSize;
          } else {
            debugLogger.warn(
              FAL_LOG_COMPONENT,
              "SEEDDREAM_V45_INVALID_IMAGE_SIZE",
              {
                requestedSize: settings.imageSize,
                fallback: "auto_2K",
              }
            );
            params.image_size = "auto_2K";
          }
        } else {
          params.image_size = "auto_2K";
        }
        break;

      case "seeddream-v4-5-edit":
        // SeedDream V4.5 Edit - same image_size handling as v4.5
        // Note: image_urls are handled separately by the edit function
        if (typeof settings.imageSize === "string") {
          const validV45Sizes = [
            "square",
            "square_hd",
            "portrait_4_3",
            "portrait_16_9",
            "landscape_4_3",
            "landscape_16_9",
            "auto_2K",
            "auto_4K",
          ];
          if (validV45Sizes.includes(settings.imageSize)) {
            params.image_size = settings.imageSize;
          } else {
            params.image_size = "auto_2K";
          }
        } else {
          params.image_size = "auto_2K";
        }
        break;

      case "nano-banana":
        // Nano Banana expects aspect_ratio instead of image_size
        params.aspect_ratio = imageSizeToAspectRatio(settings.imageSize);
        params.image_size = undefined;
        params.seed = undefined;
        break;

      case "gemini-3-pro":
        // Gemini 3 Pro uses aspect_ratio (like Imagen4) + resolution
        params.aspect_ratio = imageSizeToAspectRatio(settings.imageSize);
        // Remove image_size if set (Gemini uses aspect_ratio)
        params.image_size = undefined;
        // Note: resolution param is passed through defaultParams
        break;

      case "z-image-turbo":
        // Z-Image Turbo uses image_size presets directly (like SeedDream)
        // Note: Z-Image uses portrait_4_3/portrait_16_9 (not portrait_3_4/portrait_9_16)
        if (typeof settings.imageSize === "string") {
          // Map app's standard size tokens to Z-Image's format
          const sizeMapping: Record<string, string> = {
            portrait_3_4: "portrait_4_3",
            portrait_9_16: "portrait_16_9",
          };
          params.image_size =
            sizeMapping[settings.imageSize] || settings.imageSize;
        } else {
          params.image_size = "landscape_4_3";
        }
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
    if (potentialFormat) {
      if (supportsOutputFormat) {
        // Normalize the format and assign it, falling back to the default if none is found.
        params.output_format = normalizeOutputFormat(potentialFormat);
      } else {
        // Model doesn't support output_format but user provided it; warn and drop it to avoid 422s.
        debugLogger.warn(FAL_LOG_COMPONENT, "OUTPUT_FORMAT_NOT_SUPPORTED", {
          modelId: model.id,
          requestedFormat: potentialFormat,
        });
      }
      // Ensure the camelCase version is removed to avoid sending both.
      (params as Record<string, unknown>).outputFormat = undefined;
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

// Re-export detectModelVersion for backward compatibility
export { detectModelVersion } from "./fal-ai/model-handlers";
