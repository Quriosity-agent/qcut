/**
 * AI View Constants
 *
 * Extracted from ai.tsx as part of safe refactoring process.
 * This file contains all constants and configuration used by the AI video generation feature.
 *
 * @see ai-view-refactoring-guide.md for refactoring plan
 * @see ai-refactoring-subtasks.md for implementation tracking
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
   */
  getModelsByResolution: (resolution: string): AIModel[] => {
    return AI_MODELS.filter((model) => model.resolution === resolution);
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
