/**
 * AI View Types and Interfaces
 *
 * Extracted from ai.tsx as part of safe refactoring process.
 * This file contains all TypeScript interfaces and types used by the AI video generation feature.
 *
 * @see ai-view-refactoring-guide.md for refactoring plan
 * @see ai-refactoring-subtasks.md for implementation tracking
 *
 * ## Frame-to-Video (F2V) Support
 * Added firstFrame/lastFrame props to support Veo 3.1 Frame-to-Video models.
 * - firstFrame: Required for F2V models, used as single image for I2V models
 * - lastFrame: Optional - when provided, enables frame-to-frame animation
 * - Backward compatible: existing I2V code continues to work with firstFrame only
 * - See docs/development/migrations/frame-to-video-support.md for rollout details
 */

import { AIVideoOutputManager } from "@/lib/ai-video-output";
import type { TProject } from "@/types/project";

// Model Configuration Interfaces
export interface AIModelEndpoints {
  text_to_video?: string;
  image_to_video?: string;
  upscale_video?: string;
}

/**
 * API endpoints for image upscaling models
 * Simple structure since upscale models only have one endpoint type
 */
export interface UpscaleModelEndpoints {
  /** FAL.ai API endpoint path for upscaling operations */
  upscale: string;
}

/**
 * Parameters for AI video generation models
 * These vary by model but share common properties like duration and resolution
 */
export interface AIModelParameters {
  duration?: number;
  resolution?: string;
  cfg_scale?: number;
  aspect_ratio?: string;
  quality?: string;
  style_preset?: string;
  enhance_prompt?: boolean;
  [key: string]: any;
}

/**
 * Parameters for AI image upscaling operations
 *
 * These control the quality, scale, and processing method for upscaling images.
 * Different models support different subsets of these parameters.
 */
export interface UpscaleModelParameters {
  /** Multiplier for image dimensions (2x, 4x, 8x, etc.) */
  scale_factor?: number;
  /** Noise reduction amount (0-1 or 0-100 depending on model) */
  denoise?: number;
  /** Creative detail synthesis level (SeedVR models only, 0-1 or 0-100) */
  creativity?: number;
  /** Enable tile overlap processing to avoid seam artifacts (Topaz models only) */
  overlapping_tiles?: boolean;
  /** Output image format */
  output_format?: "png" | "jpeg" | "webp";
  /** Allow additional model-specific parameters */
  [key: string]: any;
}

/**
 * Category classification for AI models
 *
 * Determines which UI tab the model appears in and what inputs it requires.
 * - text: Text-to-video generation
 * - image: Image-to-video or image animation
 * - video: Video-to-video transformation
 * - avatar: Character animation from image + audio
 * - upscale: Image quality enhancement
 */
export type ModelCategory = "text" | "image" | "video" | "avatar" | "upscale";

// Core AI Model Interface
export interface AIModel {
  id: string;
  name: string;
  description: string;
  price: string;
  resolution: string;
  max_duration: number;
  endpoints: AIModelEndpoints;
  default_params?: AIModelParameters;
  category?: ModelCategory;
  requiredInputs?: string[];
  pricingModel?: string;
  supportedResolutions?: string[]; // For models supporting multiple resolutions (e.g., Pro models)
  supportedFPS?: string[];
  supportedDurations?: number[];
  supportedAspectRatios?: string[];
  perSecondPricing?: Record<string, number>;
  supportedUpscaleFactors?:
    | number[]
    | {
        min: number;
        max: number;
        step?: number;
      };
  supportedAcceleration?: string[];
  supportedOutputFormats?: string[];
  supportedOutputQuality?: string[];
  supportedWriteModes?: string[];
  /** Audio constraints for avatar models (Kling Avatar v2) */
  audioConstraints?: {
    minDurationSec: number;
    maxDurationSec: number;
    maxFileSizeBytes: number;
  };
}

// Generated Video Interfaces
export interface GeneratedVideo {
  jobId: string;
  videoUrl: string;
  videoPath?: string;
  localPath?: string; // Local file path on disk (for AI videos saved locally)
  fileSize?: number;
  duration?: number;
  prompt: string;
  model: string;
}

export interface GeneratedVideoResult {
  modelId: string;
  video: GeneratedVideo;
}

// ⚠️ CRITICAL ADDITION: Polling state interface (identified in validation)
export interface PollingState {
  interval: NodeJS.Timeout | null;
  jobId: string | null;
  isPolling: boolean;
}

// ⚠️ CRITICAL ADDITION: Service manager interface (identified in validation)
export interface AIServiceManager {
  outputManager: AIVideoOutputManager;
  cleanup: () => void;
}

// Hook Interface Definitions (Enhanced based on validation findings)

// ⚠️ ENHANCED: Include ALL state variables identified in source validation
export interface UseAIGenerationProps {
  prompt: string;
  selectedModels: string[];
  selectedImage: File | null;
  activeTab: "text" | "image" | "avatar" | "upscale";
  activeProject: TProject | null;
  onProgress: (progress: number, message: string) => void;
  onError: (error: string) => void;
  onComplete: (videos: GeneratedVideoResult[]) => void;
  // ⚠️ CRITICAL ADDITIONS: Include missing dependencies from validation
  onJobIdChange?: (jobId: string | null) => void;
  // Avatar-specific props
  avatarImage?: File | null;
  audioFile?: File | null;
  sourceVideo?: File | null;
  referenceImages?: (File | null)[];
  onGeneratedVideoChange?: (video: GeneratedVideo | null) => void;
  // Hailuo text-to-video options
  hailuoT2VDuration?: 6 | 10;
  // Unified text-to-video controls
  t2vAspectRatio?: string;
  t2vResolution?: string;
  t2vDuration?: number;
  t2vNegativePrompt?: string;
  t2vPromptExpansion?: boolean;
  t2vSeed?: number;
  t2vSafetyChecker?: boolean;
  // Vidu Q2 Turbo options
  viduQ2Duration?: 2 | 3 | 4 | 5 | 6 | 7 | 8;
  viduQ2Resolution?: "720p" | "1080p";
  viduQ2MovementAmplitude?: "auto" | "small" | "medium" | "large";
  viduQ2EnableBGM?: boolean;
  // LTX Video 2.0 options
  ltxv2Duration?: 6 | 8 | 10;
  ltxv2Resolution?: "1080p" | "1440p" | "2160p";
  ltxv2FPS?: 25 | 50;
  ltxv2GenerateAudio?: boolean;
  // LTX Video 2.0 Fast text-to-video options
  ltxv2FastDuration?: 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
  ltxv2FastResolution?: "1080p" | "1440p" | "2160p";
  ltxv2FastFPS?: 25 | 50;
  ltxv2FastGenerateAudio?: boolean;
  // LTX Video 2.0 standard image-to-video options
  ltxv2I2VDuration?: 6 | 8 | 10;
  ltxv2I2VResolution?: "1080p" | "1440p" | "2160p";
  ltxv2I2VFPS?: 25 | 50;
  ltxv2I2VGenerateAudio?: boolean;
  // LTX Video 2.0 Fast image-to-video options
  ltxv2ImageDuration?: 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
  ltxv2ImageResolution?: "1080p" | "1440p" | "2160p"; // Fast I2V supports 1080p/1440p/2160p, not 720p
  ltxv2ImageFPS?: 25 | 50;
  ltxv2ImageGenerateAudio?: boolean;
  // Seedance image-to-video options
  seedanceDuration?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  seedanceResolution?: "480p" | "720p" | "1080p";
  seedanceAspectRatio?:
    | "21:9"
    | "16:9"
    | "4:3"
    | "1:1"
    | "3:4"
    | "9:16"
    | "auto";
  seedanceCameraFixed?: boolean;
  seedanceEndFrameUrl?: string;
  seedanceEndFrameFile?: File | null;
  imageSeed?: number;
  // Kling v2.5 Turbo Pro I2V options
  klingDuration?: 5 | 10;
  klingCfgScale?: number;
  klingAspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  klingEnhancePrompt?: boolean;
  klingNegativePrompt?: string;
  // Kling v2.6 Pro options
  kling26Duration?: 5 | 10;
  kling26AspectRatio?: "16:9" | "9:16" | "1:1";
  kling26CfgScale?: number;
  kling26GenerateAudio?: boolean;
  kling26NegativePrompt?: string;
  // WAN 2.5 Preview I2V options
  wan25Duration?: 5 | 10;
  wan25Resolution?: "480p" | "720p" | "1080p";
  wan25AudioUrl?: string;
  wan25AudioFile?: File | null;
  wan25NegativePrompt?: string;
  wan25EnablePromptExpansion?: boolean;

  // Kling Avatar v2 options
  /** Optional prompt for animation guidance (Kling Avatar v2) */
  klingAvatarV2Prompt?: string;
  /** Audio duration in seconds for cost calculation */
  audioDuration?: number | null;

  // Video upscaling options
  // ByteDance Upscaler options
  bytedanceTargetResolution?: "1080p" | "2k" | "4k";
  bytedanceTargetFPS?: "30fps" | "60fps";
  // FlashVSR Upscaler options
  flashvsrUpscaleFactor?: number; // 1.0 to 4.0
  flashvsrAcceleration?: "regular" | "high" | "full";
  flashvsrQuality?: number; // 0 to 100
  flashvsrColorFix?: boolean;
  flashvsrPreserveAudio?: boolean;
  flashvsrOutputFormat?: "X264" | "VP9" | "PRORES4444" | "GIF";
  flashvsrOutputQuality?: "low" | "medium" | "high" | "maximum";
  flashvsrOutputWriteMode?: "fast" | "balanced" | "small";
  flashvsrSeed?: number;
  // Topaz Upscaler options
  topazUpscaleFactor?: number; // 2.0 to 8.0
  topazTargetFPS?: "original" | "interpolated";
  topazH264Output?: boolean;
  // Shared video upscaling inputs
  sourceVideoFile?: File | null;
  sourceVideoUrl?: string;

  // First + Last Frame support for Frame-to-Video models (Veo 3.1)
  /** First frame image file for F2V models. Required when F2V model selected. */
  firstFrame?: File | null;
  /** Last frame image file for F2V models. Optional - enables frame-to-frame animation. */
  lastFrame?: File | null;
  /** Callback when first frame changes. */
  onFirstFrameChange?: (file: File | null, preview?: string | null) => void;
  /** Callback when last frame changes. */
  onLastFrameChange?: (file: File | null, preview?: string | null) => void;

  // Seeddream 4.5 options (text-to-image and image edit)
  /** Image size for Seeddream 4.5 models */
  seeddream45ImageSize?: Seeddream45ImageSize;
  /** Number of images to generate (1-6) */
  seeddream45NumImages?: number;
  /** Seed for reproducible results */
  seeddream45Seed?: number;
  /** Enable safety checker */
  seeddream45SafetyChecker?: boolean;
  /** Images selected for Seeddream 4.5 edit (up to 10) */
  seeddream45EditImages?: (File | null)[];
}

// ⚠️ ENHANCED: Complete generation state interface
export interface AIGenerationState {
  // Core generation state
  isGenerating: boolean;
  generationProgress: number;
  statusMessage: string;
  elapsedTime: number;
  estimatedTime?: number;
  currentModelIndex: number;
  progressLogs: string[];
  generationStartTime: number | null;

  // ⚠️ CRITICAL ADDITIONS: Missing state variables from validation
  jobId: string | null;
  generatedVideo: GeneratedVideo | null;
  generatedVideos: GeneratedVideoResult[];

  // ⚠️ CRITICAL: Polling state management
  pollingInterval: NodeJS.Timeout | null;
}

export type UseAIHistoryProps = Record<string, never>;

export interface AIHistoryState {
  generationHistory: GeneratedVideo[];
  isHistoryPanelOpen: boolean;
}

// UI State Types
export type AIActiveTab = "text" | "image" | "avatar" | "upscale";

// Avatar-specific types
export interface AvatarUploadState {
  characterImage: File | null;
  characterImagePreview: string | null;
  audioFile: File | null;
  audioPreview: string | null;
  sourceVideo: File | null;
  sourceVideoPreview: string | null;
}

/**
 * Progress update passed to ProgressCallback during video generation.
 * Contains status, progress percentage, message, and timing information.
 */
export interface ProgressUpdate {
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  message?: string;
  elapsedTime?: number;
  estimatedTime?: number;
  logs?: string[];
}

/**
 * Callback for receiving progress updates during video generation.
 * Called periodically (every ~2s) during polling with the current status.
 */
export type ProgressCallback = (status: ProgressUpdate) => void;

// Image handling types
export interface ImageUploadState {
  selectedImage: File | null;
  imagePreview: string | null;
  isValidImage: boolean;
  uploadError?: string;
}

// Generation status types (from API client)
export interface GenerationStatus {
  progress?: number;
  status?: string;
  completed?: boolean;
  error?: string;
  videoUrl?: string;
}

// API Configuration types
export interface APIConfiguration {
  falApiKey?: string;
  falApiBase: string;
  maxRetries: number;
  timeoutMs: number;
}

// Error types
export type AIError = string | null;

// ============================================
// Seedream 4.5 Types
// ============================================

/**
 * Seedream 4.5 image size options
 * Supports both preset strings and custom dimensions
 */
export type Seeddream45ImageSize =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9"
  | "auto_2K"
  | "auto_4K"
  | { width: number; height: number };

/**
 * Parameters for Seedream 4.5 text-to-image generation
 */
export interface Seeddream45TextToImageParams {
  prompt: string;
  image_size?: Seeddream45ImageSize;
  num_images?: number;
  max_images?: number;
  seed?: number;
  sync_mode?: boolean;
  enable_safety_checker?: boolean;
}

/**
 * Parameters for Seedream 4.5 image editing
 */
export interface Seeddream45EditParams {
  prompt: string;
  image_urls: string[];
  image_size?: Seeddream45ImageSize;
  num_images?: number;
  max_images?: number;
  seed?: number;
  sync_mode?: boolean;
  enable_safety_checker?: boolean;
}

// ============================================
// Video Generation Request/Response Types
// (Moved from ai-video-client.ts for centralization)
// ============================================

/**
 * Request parameters for text-to-video generation
 */
export interface VideoGenerationRequest {
  prompt: string;
  model: string;
  resolution?: string;
  duration?: number;
  aspect_ratio?: string;
}

/**
 * Request parameters for image-to-video generation
 */
export interface ImageToVideoRequest {
  image: File;
  model: string;
  prompt?: string;
  resolution?: string;
  duration?: number;
  aspect_ratio?: string;
}

/**
 * Request parameters for Hailuo text-to-video models
 */
export interface TextToVideoRequest {
  model: string;
  prompt: string;
  duration?: 6 | 10;
  prompt_optimizer?: boolean;
  resolution?: string;
}

/**
 * Request parameters for Vidu Q2 Turbo image-to-video
 */
export interface ViduQ2I2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 2 | 3 | 4 | 5 | 6 | 7 | 8;
  resolution?: "720p" | "1080p";
  movement_amplitude?: "auto" | "small" | "medium" | "large";
  bgm?: boolean;
  seed?: number;
}

/**
 * Request parameters for LTX Video 2.0 text-to-video
 */
export interface LTXV2T2VRequest {
  model: string;
  prompt: string;
  duration?: 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
  resolution?: "1080p" | "1440p" | "2160p";
  aspect_ratio?: "16:9";
  fps?: 25 | 50;
  generate_audio?: boolean;
}

/**
 * Request parameters for LTX Video 2.0 image-to-video
 */
export interface LTXV2I2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
  resolution?: "1080p" | "1440p" | "2160p";
  aspect_ratio?: "16:9";
  fps?: 25 | 50;
  generate_audio?: boolean;
}

/**
 * Request parameters for avatar video generation
 */
export interface AvatarVideoRequest {
  model: string;
  characterImage: File;
  audioFile?: File;
  sourceVideo?: File;
  prompt?: string;
  resolution?: string;
  duration?: number;
  audioDuration?: number;
  characterImageUrl?: string;
  audioUrl?: string;
}

/**
 * Response from video generation APIs
 */
export interface VideoGenerationResponse {
  job_id: string;
  status: string;
  message: string;
  estimated_time?: number;
  video_url?: string;
  video_data?: unknown;
}

/**
 * Response for model listing
 */
export interface ModelsResponse {
  models: AIModel[];
}

/**
 * Cost estimation response
 */
export interface CostEstimate {
  model: string;
  duration: number;
  base_cost: number;
  estimated_cost: number;
  currency: string;
}

/**
 * Seedance image-to-video request parameters
 */
export interface SeedanceI2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  resolution?: "480p" | "720p" | "1080p";
  aspect_ratio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "auto";
  camera_fixed?: boolean;
  seed?: number;
  enable_safety_checker?: boolean;
  end_image_url?: string;
}

/**
 * Kling v2.5 Turbo Pro image-to-video request parameters
 */
export interface KlingI2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 5 | 10;
  cfg_scale?: number;
  aspect_ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  enhance_prompt?: boolean;
  negative_prompt?: string;
}

/**
 * Kling v2.6 Pro image-to-video request parameters
 */
export interface Kling26I2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 5 | 10;
  generate_audio?: boolean;
  negative_prompt?: string;
}

/**
 * Kling O1 video-to-video request parameters
 */
export interface KlingO1V2VRequest {
  model: string;
  prompt: string;
  sourceVideo: File;
  duration?: 5 | 10;
  aspect_ratio?: "auto" | "16:9" | "9:16" | "1:1";
  keep_audio?: boolean;
}

/**
 * Kling O1 reference-to-video request parameters
 */
export interface KlingO1Ref2VideoRequest {
  model: string;
  prompt: string;
  image_urls: string[];
  duration?: 5 | 10;
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  cfg_scale?: number;
  negative_prompt?: string;
}

/**
 * WAN 2.5 Preview image-to-video request parameters
 */
export interface WAN25I2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 5 | 10;
  resolution?: "480p" | "720p" | "1080p";
  audio_url?: string;
  negative_prompt?: string;
  enable_prompt_expansion?: boolean;
  seed?: number;
}

/**
 * ByteDance video upscaler request parameters
 */
export interface ByteDanceUpscaleRequest {
  video_url: string;
  target_resolution?: "1080p" | "2k" | "4k";
  target_fps?: "30fps" | "60fps";
}

/**
 * FlashVSR video upscaler request parameters
 */
export interface FlashVSRUpscaleRequest {
  video_url: string;
  upscale_factor?: number;
  acceleration?: "regular" | "high" | "full";
  quality?: number;
  color_fix?: boolean;
  preserve_audio?: boolean;
  output_format?: "X264" | "VP9" | "PRORES4444" | "GIF";
  output_quality?: "low" | "medium" | "high" | "maximum";
  output_write_mode?: "fast" | "balanced" | "small";
  seed?: number;
}

/**
 * Topaz video upscaler request parameters
 */
export interface TopazUpscaleRequest {
  video_url: string;
  upscale_factor?: number;
  target_fps?: "original" | "interpolated";
  h264_output?: boolean;
}

// ============================================
// Sora 2 Types
// ============================================

/**
 * Sora 2 model type variants
 */
export type Sora2ModelType =
  | "text-to-video"
  | "text-to-video-pro"
  | "image-to-video"
  | "image-to-video-pro"
  | "video-to-video-remix";

/**
 * Base payload type for all Sora 2 models
 */
export type Sora2BasePayload = {
  prompt: string;
  duration: number;
  aspect_ratio: string;
};

/**
 * Discriminated union for Sora 2 payloads
 */
export type Sora2Payload =
  | {
      type: "text-to-video";
      prompt: string;
      duration: number;
      aspect_ratio: string;
      resolution: "720p";
    }
  | {
      type: "text-to-video-pro";
      prompt: string;
      duration: number;
      aspect_ratio: string;
      resolution: string;
    }
  | {
      type: "image-to-video";
      prompt: string;
      duration: number;
      aspect_ratio: string;
      resolution: string;
      image_url: string;
    }
  | {
      type: "image-to-video-pro";
      prompt: string;
      duration: number;
      aspect_ratio: string;
      resolution: string;
      image_url: string;
    }
  | { type: "video-to-video-remix"; prompt: string; video_id: string };

// Export all as named exports for easy importing
export type {
  // Re-export main interfaces for convenience
  AIModel as Model,
  GeneratedVideo as Video,
  GeneratedVideoResult as VideoResult,
  PollingState as Polling,
  AIServiceManager as ServiceManager,
  AIGenerationState as GenerationState,
  AIHistoryState as HistoryState,
};
