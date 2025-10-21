/**
 * AI View Constants
 *
 * Extracted from ai.tsx as part of safe refactoring process.
 * This file contains all constants and configuration used by the AI video generation feature.
 */

import type { AIModel, APIConfiguration } from "./ai-types";

// FAL API Configuration
export const FAL_API_KEY = import.meta.env.VITE_FAL_API_KEY;
export const FAL_API_BASE = "https://fal.run";

// API Configuration
export const API_CONFIG: APIConfiguration = {
  falApiKey: FAL_API_KEY,
  falApiBase: FAL_API_BASE,
  maxRetries: 3,
  timeoutMs: 30_000, // 30 seconds
};

// AI Models Configuration with centralized endpoints and parameters
export const AI_MODELS: AIModel[] = [
  {
    id: "kling_v2",
    name: "Kling v2.1",
    description: "Premium model with unparalleled motion fluidity",
    price: "0.15",
    resolution: "1080p",
    max_duration: 10,
    endpoints: {
      text_to_video: "fal-ai/kling-video/v2.1/master",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
    },
  },
  {
    id: "seedance",
    name: "Seedance v1 Lite",
    description: "Fast and efficient text-to-video generation",
    price: "0.18",
    resolution: "720p",
    max_duration: 10,
    endpoints: {
      text_to_video: "fal-ai/bytedance/seedance/v1/lite/text-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "720p",
    },
  },
  {
    id: "hailuo",
    name: "Hailuo 02",
    description: "Standard quality with realistic physics",
    price: "0.27",
    resolution: "768p",
    max_duration: 6,
    endpoints: {
      text_to_video: "fal-ai/minimax/hailuo-02/standard/text-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "768p",
    },
  },
  {
    id: "hailuo_pro",
    name: "Hailuo 02 Pro",
    description: "Premium 1080p with ultra-realistic physics",
    price: "0.48",
    resolution: "1080p",
    max_duration: 6,
    endpoints: {
      text_to_video: "fal-ai/minimax/hailuo-02/pro/text-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
    },
  },
  {
    id: "seedance_pro",
    name: "Seedance v1 Pro",
    description: "High quality 1080p video generation",
    price: "0.62",
    resolution: "1080p",
    max_duration: 10,
    endpoints: {
      text_to_video: "fal-ai/bytedance/seedance/v1/pro/text-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
    },
  },
  {
    id: "veo3_fast",
    name: "Veo3 Fast",
    description: "High quality, faster generation",
    price: "2.00",
    resolution: "1080p",
    max_duration: 30,
    endpoints: {
      text_to_video: "fal-ai/google/veo3/fast",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
    },
  },
  {
    id: "veo3",
    name: "Veo3",
    description: "Highest quality, slower generation",
    price: "3.00",
    resolution: "1080p",
    max_duration: 30,
    endpoints: {
      text_to_video: "fal-ai/google/veo3",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
    },
  },
  {
    id: "wan_turbo",
    name: "WAN v2.2 Turbo",
    description: "High-speed photorealistic video generation",
    price: "0.10",
    resolution: "720p",
    max_duration: 5,
    endpoints: {
      text_to_video: "fal-ai/wan/v2.2-a14b/text-to-video/turbo",
    },
    default_params: {
      duration: 5,
      resolution: "720p",
    },
  },
  {
    id: "kling_v2_5_turbo",
    name: "Kling v2.5 Turbo Pro",
    description: "Latest Kling model with enhanced turbo performance",
    price: "0.18",
    resolution: "1080p",
    max_duration: 10,
    endpoints: {
      text_to_video: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
      image_to_video: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
      cfg_scale: 0.5,
      aspect_ratio: "16:9",
      enhance_prompt: true,
    },
  },
  {
    id: "wan_25_preview",
    name: "WAN v2.5 Preview",
    description: "Next-generation WAN model with improved quality",
    price: "0.12",
    resolution: "1080p",
    max_duration: 10,
    endpoints: {
      text_to_video: "fal-ai/wan-25-preview/text-to-video",
      image_to_video: "fal-ai/wan-25-preview/image-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
      quality: "high",
      style_preset: "cinematic",
    },
  },

  // Avatar Models
  {
    id: "wan_animate_replace",
    name: "WAN Animate/Replace",
    description: "Replace characters in existing videos",
    price: "0.075", // Base price for 480p
    resolution: "480p-720p",
    max_duration: 30, // Supports longer videos for character replacement
    category: "avatar",
    requiredInputs: ["characterImage", "sourceVideo"],
    endpoints: {
      text_to_video: "fal-ai/wan/v2.2-14b/animate/replace",
    },
    default_params: {
      resolution: "480p",
      video_quality: "high",
    },
  },
  {
    id: "kling_avatar_pro",
    name: "Kling Avatar Pro",
    description: "Premium avatar video generation from image + audio",
    price: "0.25", // Estimated pricing
    resolution: "1080p",
    max_duration: 10,
    category: "avatar",
    requiredInputs: ["characterImage", "audioFile"],
    endpoints: {
      text_to_video: "fal-ai/kling-video/v1/pro/ai-avatar",
    },
    default_params: {
      resolution: "1080p",
    },
  },
  {
    id: "kling_avatar_standard",
    name: "Kling Avatar Standard",
    description: "Standard avatar video generation from image + audio",
    price: "0.15", // Estimated pricing
    resolution: "720p",
    max_duration: 10,
    category: "avatar",
    requiredInputs: ["characterImage", "audioFile"],
    endpoints: {
      text_to_video: "fal-ai/kling-video/v1/standard/ai-avatar",
    },
    default_params: {
      resolution: "720p",
    },
  },
  {
    id: "bytedance_omnihuman_v1_5",
    name: "ByteDance OmniHuman v1.5",
    description: "Realistic human avatar with emotion-synced audio",
    price: "0.20", // Estimated pricing
    resolution: "1080p",
    max_duration: 30, // 30 second audio limit
    category: "avatar",
    requiredInputs: ["characterImage", "audioFile"],
    endpoints: {
      text_to_video: "fal-ai/bytedance/omnihuman/v1.5",
    },
    default_params: {
      resolution: "1080p",
    },
  },

  // Sora 2 Models
  {
    id: "sora2_text_to_video",
    name: "Sora 2 Text-to-Video",
    description: "OpenAI's state-of-the-art text-to-video generation (720p)",
    price: "0.10/s", // $0.10 per second (4s = $0.40, 8s = $0.80, 12s = $1.20)
    resolution: "720p",
    max_duration: 12, // 4, 8, or 12 seconds
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/sora-2/text-to-video",
    },
    default_params: {
      duration: 4,
      resolution: "720p",
      aspect_ratio: "16:9",
    },
  },
  {
    id: "sora2_text_to_video_pro",
    name: "Sora 2 Text-to-Video Pro",
    description: "High-quality text-to-video with 1080p support",
    price: "0.30-0.50", // 720p: $0.30/4s ($0.075/s), 1080p: $0.50/4s ($0.125/s)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"], // For programmatic filtering
    max_duration: 12,
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/sora-2/text-to-video/pro",
    },
    default_params: {
      duration: 4,
      resolution: "1080p", // Pro defaults to 1080p
      aspect_ratio: "16:9",
    },
  },
  {
    id: "sora2_image_to_video",
    name: "Sora 2 Image-to-Video",
    description: "Convert images to dynamic videos with Sora 2 (720p)",
    price: "0.10/s", // $0.10 per second (4s = $0.40, 8s = $0.80, 12s = $1.20)
    resolution: "720p",
    max_duration: 12,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/sora-2/image-to-video",
    },
    default_params: {
      duration: 4,
      resolution: "auto",
      aspect_ratio: "auto", // Auto-detect from image
    },
  },
  {
    id: "sora2_image_to_video_pro",
    name: "Sora 2 Image-to-Video Pro",
    description: "High-quality image-to-video with 1080p support",
    price: "0.30-0.50", // 720p: $0.30/4s ($0.075/s), 1080p: $0.50/4s ($0.125/s)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"], // For programmatic filtering
    max_duration: 12,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/sora-2/image-to-video/pro",
    },
    default_params: {
      duration: 4,
      resolution: "auto",
      aspect_ratio: "auto",
    },
  },
  {
    id: "sora2_video_to_video_remix",
    name: "Sora 2 Video-to-Video Remix",
    description: "Transform Sora-generated videos with style changes (requires existing Sora video)",
    price: "0.00", // Price calculated dynamically based on source video duration
    resolution: "Preserves source",
    max_duration: 12, // Inherits from source video
    category: "avatar", // Video-to-video remix is a transformation feature, similar to avatar models
    requiredInputs: ["videoId"], // Prevent selection until source Sora video is chosen
    endpoints: {
      text_to_video: "fal-ai/sora-2/video-to-video/remix", // Reuses text_to_video endpoint type
    },
    default_params: {
      // No duration/resolution - inherited from source video
    },
  },

  // Veo 3.1 Models - Fast Variants (50% cheaper, faster processing)
  {
    id: "veo31_fast_text_to_video",
    name: "Veo 3.1 Fast Text-to-Video",
    description: "Google's Veo 3.1 Fast - Generate videos from text prompts (faster, budget-friendly)",
    price: "1.20", // 8s @ $0.15/s with audio (default)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"],
    max_duration: 8, // 4s, 6s, or 8s
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/veo3.1/fast",
    },
    default_params: {
      duration: 8, // Numeric to match existing pattern (Sora 2, etc.)
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: true,
      enhance_prompt: true,
      auto_fix: true,
    },
  },
  {
    id: "veo31_fast_image_to_video",
    name: "Veo 3.1 Fast Image-to-Video",
    description: "Google's Veo 3.1 Fast - Animate static images with motion (faster, budget-friendly)",
    price: "1.20", // 8s @ $0.15/s with audio (default)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"],
    max_duration: 8, // Currently only 8s supported
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/veo3.1/fast/image-to-video",
    },
    default_params: {
      duration: 8, // Numeric to match existing pattern
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: true,
    },
  },
  {
    id: "veo31_fast_frame_to_video",
    name: "Veo 3.1 Fast Frame-to-Video",
    description: "Google's Veo 3.1 Fast - Animate between first and last frames (faster, budget-friendly)",
    price: "1.20", // 8s @ $0.15/s with audio (default)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"],
    max_duration: 8, // Currently only 8s supported
    category: "image", // Uses image tab (requires frame uploads)
    requiredInputs: ["firstFrame", "lastFrame"],
    endpoints: {
      image_to_video: "fal-ai/veo3.1/fast/first-last-frame-to-video",
    },
    default_params: {
      duration: 8, // Numeric to match existing pattern
      resolution: "720p",
      aspect_ratio: "auto",
      generate_audio: true,
    },
  },

  // Veo 3.1 Models - Standard Variants (premium quality)
  {
    id: "veo31_text_to_video",
    name: "Veo 3.1 Text-to-Video",
    description: "Google's Veo 3.1 - Premium quality video generation from text prompts",
    price: "3.20", // 8s @ $0.40/s with audio (default)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"],
    max_duration: 8, // 4s, 6s, or 8s
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/veo3.1", // No /fast suffix
    },
    default_params: {
      duration: 8, // Numeric to match existing pattern
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: true,
      enhance_prompt: true,
      auto_fix: true,
    },
  },
  {
    id: "veo31_image_to_video",
    name: "Veo 3.1 Image-to-Video",
    description: "Google's Veo 3.1 - Premium quality image animation with motion",
    price: "3.20", // 8s @ $0.40/s with audio (default)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"],
    max_duration: 8, // Currently only 8s supported
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/veo3.1/image-to-video", // No /fast
    },
    default_params: {
      duration: 8, // Numeric to match existing pattern
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: true,
    },
  },
  {
    id: "veo31_frame_to_video",
    name: "Veo 3.1 Frame-to-Video",
    description: "Google's Veo 3.1 - Premium quality animation between first and last frames",
    price: "3.20", // 8s @ $0.40/s with audio (default)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"],
    max_duration: 8, // Currently only 8s supported
    category: "image", // Uses image tab (requires frame uploads)
    requiredInputs: ["firstFrame", "lastFrame"],
    endpoints: {
      image_to_video: "fal-ai/veo3.1/first-last-frame-to-video", // No /fast
    },
    default_params: {
      duration: 8, // Numeric to match existing pattern
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: true,
    },
  },
];

// UI Constants
export const UI_CONSTANTS = {
  MAX_PROMPT_CHARS: 500,
  MAX_IMAGE_SIZE_MB: 10,
  MAX_HISTORY_ITEMS: 10,
  POLLING_INTERVAL_MS: 2000,
  GENERATION_TIMEOUT_MS: 300_000, // 5 minutes
} as const;

// File Upload Constants
export const UPLOAD_CONSTANTS = {
  // Image uploads (for image-to-video and avatar character images)
  ALLOWED_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  MAX_IMAGE_SIZE_LABEL: "10MB",
  SUPPORTED_FORMATS: [".jpg", ".jpeg", ".png", ".webp", ".gif"],
  IMAGE_FORMATS_LABEL: "JPG, PNG, WebP, GIF",

  // Avatar-specific image uploads (character images only, no GIF for consistency)
  ALLOWED_AVATAR_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp"],
  AVATAR_IMAGE_FORMATS_LABEL: "JPG, PNG, WebP",

  // Audio uploads (for Kling and ByteDance avatar models)
  ALLOWED_AUDIO_TYPES: ["audio/mpeg", "audio/wav", "audio/aac"], // audio/mpeg is the correct MIME type for MP3
  MAX_AUDIO_SIZE_BYTES: 50 * 1024 * 1024, // 50MB
  MAX_AUDIO_SIZE_LABEL: "50MB",
  SUPPORTED_AUDIO_FORMATS: [".mp3", ".wav", ".aac"],
  AUDIO_FORMATS_LABEL: "MP3, WAV, AAC",

  // Video uploads (for WAN animate/replace model)
  ALLOWED_VIDEO_TYPES: ["video/mp4", "video/quicktime", "video/x-msvideo"],
  MAX_VIDEO_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
  MAX_VIDEO_SIZE_LABEL: "100MB",
  SUPPORTED_VIDEO_FORMATS: [".mp4", ".mov", ".avi"],
  VIDEO_FORMATS_LABEL: "MP4, MOV, AVI",

  // Veo 3.1 frame uploads (for frame-to-video model)
  MAX_VEO31_FRAME_SIZE_BYTES: 8 * 1024 * 1024, // 8MB (Veo 3.1 limit)
  MAX_VEO31_FRAME_SIZE_LABEL: "8MB",
  ALLOWED_VEO31_ASPECT_RATIOS: ["16:9", "9:16"],
} as const;

// Progress Constants
export const PROGRESS_CONSTANTS = {
  INITIAL_PROGRESS: 0,
  POLLING_START_PROGRESS: 10,
  DOWNLOAD_START_PROGRESS: 90,
  COMPLETE_PROGRESS: 100,
} as const;

// Local Storage Keys
export const STORAGE_KEYS = {
  GENERATION_HISTORY: "ai-generation-history",
  USER_PREFERENCES: "ai-user-preferences",
  LAST_USED_MODELS: "ai-last-used-models",
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  INVALID_FILE_TYPE: "Please select a valid image file",
  FILE_TOO_LARGE: "Image file too large (max 10MB)",
  NO_MODELS_SELECTED: "Please select at least one AI model",
  EMPTY_PROMPT: "Please enter a prompt for video generation",
  GENERATION_FAILED: "Video generation failed. Please try again.",
  DOWNLOAD_FAILED: "Failed to download video. Please try again.",
  HISTORY_SAVE_FAILED: "Failed to save generation history",
  HISTORY_LOAD_FAILED: "Failed to load generation history",

  // Veo 3.1 specific errors
  VEO31_IMAGE_TOO_LARGE: "Image must be under 8MB for Veo 3.1",
  VEO31_INVALID_ASPECT_RATIO: "Veo 3.1 requires 16:9 or 9:16 aspect ratio for images",
  VEO31_MISSING_FIRST_FRAME: "First frame is required for Veo 3.1 frame-to-video",
  VEO31_MISSING_LAST_FRAME: "Last frame is required for Veo 3.1 frame-to-video",
  VEO31_FRAME_ASPECT_MISMATCH: "First and last frames must have matching aspect ratios",

  // Reve specific errors
  REVE_IMAGE_TOO_LARGE: "Image must be under 10MB for Reve Edit",
  REVE_INVALID_DIMENSIONS: "Image dimensions must be between 128×128 and 4096×4096 pixels",
  REVE_INVALID_FORMAT: "Please upload PNG, JPEG, WebP, AVIF, or HEIF image",
  REVE_PROMPT_TOO_LONG: "Prompt must be under 2560 characters",
} as const;

// Status Messages
export const STATUS_MESSAGES = {
  STARTING: "Starting generation...",
  PROCESSING: "Processing video...",
  DOWNLOADING: "Downloading video...",
  COMPLETE: "Generation complete!",
  CANCELLED: "Generation cancelled",
  FAILED: "Generation failed",
} as const;

// Default Values
export const DEFAULTS = {
  PROMPT: "",
  SELECTED_MODELS: [] as string[],
  ACTIVE_TAB: "text" as const,
  GENERATION_PROGRESS: 0,
  STATUS_MESSAGE: "",
  ELAPSED_TIME: 0,
  CURRENT_MODEL_INDEX: 0,
  PROGRESS_LOGS: [] as string[],
} as const;

// Model Helper Functions
export const MODEL_HELPERS = {
  /**
   * Get model by ID
   */
  getModelById: (id: string): AIModel | undefined => {
    return AI_MODELS.find((model) => model.id === id);
  },

  /**
   * Get models by resolution
   * Checks both the main resolution field and supportedResolutions array for Pro models
   */
  getModelsByResolution: (resolution: string): AIModel[] => {
    return AI_MODELS.filter((model) => {
      // Check supportedResolutions array first (for Pro models)
      if (model.supportedResolutions?.includes(resolution)) {
        return true;
      }
      // Fallback to exact resolution match
      return model.resolution === resolution;
    });
  },

  /**
   * Get models by price range
   */
  getModelsByPriceRange: (min: number, max: number): AIModel[] => {
    return AI_MODELS.filter((model) => {
      const price = parseFloat(model.price);
      return price >= min && price <= max;
    });
  },

  /**
   * Sort models by price (ascending)
   */
  sortModelsByPrice: (): AIModel[] => {
    return [...AI_MODELS].sort(
      (a, b) => parseFloat(a.price) - parseFloat(b.price)
    );
  },

  /**
   * Get model display name with price
   */
  getModelDisplayName: (model: AIModel): string => {
    return `${model.name} ($${model.price})`;
  },
} as const;

// ============================================
// Reve Model Constants
// ============================================

/**
 * Reve Text-to-Image Model Configuration
 */
export const REVE_TEXT_TO_IMAGE_MODEL = {
  endpoint: "fal-ai/reve/text-to-image",
  pricing: {
    perImage: 0.04, // $0.04 per image
  },
  aspectRatios: [
    { value: "16:9", label: "16:9 (Landscape)" },
    { value: "9:16", label: "9:16 (Portrait)" },
    { value: "3:2", label: "3:2 (Standard)" },
    { value: "2:3", label: "2:3 (Portrait)" },
    { value: "4:3", label: "4:3 (Classic)" },
    { value: "3:4", label: "3:4 (Portrait)" },
    { value: "1:1", label: "1:1 (Square)" },
  ],
  defaultAspectRatio: "3:2" as const,
  outputFormats: ["png", "jpeg", "webp"] as const,
  defaultOutputFormat: "png" as const,
  numImagesRange: { min: 1, max: 4 },
  defaultNumImages: 1,
  promptMaxLength: 2560,
} as const;

/**
 * Reve Edit Model Configuration
 */
export const REVE_EDIT_MODEL = {
  endpoint: "fal-ai/reve/edit",
  pricing: {
    perImage: 0.04, // $0.04 per edit (estimated - TBD from fal.ai)
  },
  imageConstraints: {
    supportedFormats: ["image/png", "image/jpeg", "image/webp", "image/avif", "image/heif"] as const,
    maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
    maxFileSizeLabel: "10MB" as const,
    minDimensions: { width: 128, height: 128 },
    maxDimensions: { width: 4096, height: 4096 },
  },
  outputFormats: ["png", "jpeg", "webp"] as const,
  defaultOutputFormat: "png" as const,
  numImagesRange: { min: 1, max: 4 },
  defaultNumImages: 1,
} as const;

// Export individual constants for convenience
export {
  AI_MODELS as MODELS,
  UI_CONSTANTS as UI,
  UPLOAD_CONSTANTS as UPLOAD,
  PROGRESS_CONSTANTS as PROGRESS,
  STORAGE_KEYS as STORAGE,
  ERROR_MESSAGES as ERRORS,
  STATUS_MESSAGES as STATUS,
};

// Export default configuration object
export const AI_CONFIG = {
  api: API_CONFIG,
  ui: UI_CONSTANTS,
  upload: UPLOAD_CONSTANTS,
  progress: PROGRESS_CONSTANTS,
  storage: STORAGE_KEYS,
  errors: ERROR_MESSAGES,
  status: STATUS_MESSAGES,
  defaults: DEFAULTS,
  models: AI_MODELS,
  helpers: MODEL_HELPERS,
} as const;

export default AI_CONFIG;
