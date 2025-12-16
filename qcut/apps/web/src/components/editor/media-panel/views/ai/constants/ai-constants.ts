/**
 * AI View Constants
 *
 * Extracted from ai.tsx as part of safe refactoring process.
 * This file contains all constants and configuration used by the AI video generation feature.
 */

import type { AIModel, APIConfiguration } from "../types/ai-types";
import { UPSCALE_MODEL_ENDPOINTS as UPSCALE_MODEL_ENDPOINT_MAP } from "@/lib/upscale-models";

// FAL API Configuration
/** FAL.ai API key from environment variables */
export const FAL_API_KEY = import.meta.env.VITE_FAL_API_KEY;
/** Base URL for FAL.ai API endpoints */
export const FAL_API_BASE = "https://fal.run";
/**
 * Map of upscale model IDs to their FAL.ai endpoint paths
 * Re-exported from @/lib/upscale-models for convenient access alongside AI model constants
 */
export const UPSCALE_MODEL_ENDPOINTS = UPSCALE_MODEL_ENDPOINT_MAP;

// API Configuration
export const API_CONFIG: APIConfiguration = {
  falApiKey: FAL_API_KEY,
  falApiBase: FAL_API_BASE,
  maxRetries: 3,
  timeoutMs: 30_000, // 30 seconds
};

// AI Models Configuration with centralized endpoints and parameters
export const AI_MODELS: AIModel[] = [
  // Sora 2 Models - placed at top as requested
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
    id: "kling_v26_pro_t2v",
    name: "Kling v2.6 Pro T2V",
    description:
      "Top-tier text-to-video with cinematic visuals and native audio generation",
    price: "0.70", // 5s @ $0.14/s with audio (default); $0.35 without audio
    resolution: "1080p",
    max_duration: 10,
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/kling-video/v2.6/pro/text-to-video",
    },
    default_params: {
      duration: 5,
      aspect_ratio: "16:9",
      cfg_scale: 0.5,
      generate_audio: true,
      negative_prompt: "blur, distort, and low quality",
    },
    supportedDurations: [5, 10],
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
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
  // LTX Video 2.0 Pro Text-to-Video
  {
    id: "ltxv2_pro_t2v",
    name: "LTX Video 2.0 Pro T2V",
    description: "Text-to-video with audio generation (6-10s, up to 4K)",
    price: "0.06", // $0.06/second for 1080p
    resolution: "1080p",
    max_duration: 10,
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/ltxv-2/text-to-video",
    },
    default_params: {
      duration: 6,
      resolution: "1080p",
      aspect_ratio: "16:9",
      fps: 25,
      generate_audio: true,
    },
    supportedResolutions: ["1080p", "1440p", "2160p"],
  },
  // LTX Video 2.0 Fast Text-to-Video
  {
    id: "ltxv2_fast_t2v",
    name: "LTX Video 2.0 Fast T2V",
    description: "Text-to-video with audio generation (6-20s, up to 4K)",
    price: "0.04-0.16", // $0.04/$0.08/$0.16 per second for 1080p/1440p/2160p
    resolution: "1080p",
    max_duration: 20,
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/ltxv-2/text-to-video/fast",
    },
    default_params: {
      duration: 6,
      resolution: "1080p",
      aspect_ratio: "16:9",
      fps: 25,
      generate_audio: true,
    },
    supportedResolutions: ["1080p", "1440p", "2160p"],
    supportedDurations: [6, 8, 10, 12, 14, 16, 18, 20],
  },
  // Veo 3.1 Models - Fast and Standard Text-to-Video
  {
    id: "veo31_fast_text_to_video",
    name: "Veo 3.1 Fast Text-to-Video",
    description:
      "Google's Veo 3.1 Fast - Generate videos from text prompts (faster, budget-friendly)",
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
    id: "veo31_text_to_video",
    name: "Veo 3.1 Text-to-Video",
    description:
      "Google's Veo 3.1 - Premium quality video generation from text prompts",
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
  // Sora 2 Image-to-Video Models
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
    id: "kling_v26_pro_i2v",
    name: "Kling v2.6 Pro I2V",
    description:
      "Top-tier image-to-video with cinematic visuals and native audio generation",
    price: "0.70", // 5s @ $0.14/s with audio (default); $0.35 without audio
    resolution: "1080p",
    max_duration: 10,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/kling-video/v2.6/pro/image-to-video",
    },
    default_params: {
      duration: 5,
      aspect_ratio: "16:9",
      cfg_scale: 0.5,
      generate_audio: true,
      negative_prompt: "blur, distort, and low quality",
    },
    supportedDurations: [5, 10],
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
  },
  // LTX Video 2.0 Image-to-Video Models
  {
    id: "ltxv2_i2v",
    name: "LTX Video 2.0 I2V",
    description: "Image-to-video with audio generation (6-10s, up to 4K)",
    price: "0.36", // 6 second baseline @ $0.06/sec to match UI expectation
    resolution: "1080p",
    max_duration: 10,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/ltxv-2/image-to-video",
    },
    default_params: {
      duration: 6,
      resolution: "1080p",
      aspect_ratio: "16:9",
      fps: 25,
      generate_audio: true,
    },
    supportedResolutions: ["1080p", "1440p", "2160p"],
    supportedDurations: [6, 8, 10],
  },
  {
    id: "ltxv2_fast_i2v",
    name: "LTX Video 2.0 Fast I2V",
    description: "Image-to-video with audio generation (6-20s, up to 4K)",
    price: "0.04-0.16", // $0.04/$0.08/$0.16 per second for 1080p/1440p/2160p
    resolution: "1080p",
    max_duration: 20,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/ltxv-2/image-to-video/fast",
    },
    default_params: {
      duration: 6,
      resolution: "1080p",
      aspect_ratio: "16:9",
      fps: 25,
      generate_audio: true,
    },
    supportedResolutions: ["1080p", "1440p", "2160p"],
    supportedDurations: [6, 8, 10, 12, 14, 16, 18, 20],
  },
  // Seedance Image-to-Video Models
  {
    id: "seedance_pro_fast_i2v",
    name: "Seedance v1 Pro Fast I2V",
    description:
      "Fast image-to-video generation with balanced quality and speed (2-12s)",
    price: "0.24", // ~$0.24 per 1080p 5-second video
    resolution: "480p / 720p / 1080p",
    max_duration: 12,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
      aspect_ratio: "16:9",
      camera_fixed: false,
      enable_safety_checker: false,
    },
    supportedResolutions: ["480p", "720p", "1080p"],
    supportedDurations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    supportedAspectRatios: [
      "21:9",
      "16:9",
      "4:3",
      "1:1",
      "3:4",
      "9:16",
      "auto",
    ],
  },
  {
    id: "seedance_pro_i2v",
    name: "Seedance v1 Pro I2V",
    description: "Premium quality image-to-video with highest fidelity (2-12s)",
    price: "0.62", // ~$0.62 per 1080p 5-second video
    resolution: "480p / 720p / 1080p",
    max_duration: 12,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/bytedance/seedance/v1/pro/image-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
      aspect_ratio: "16:9",
      camera_fixed: false,
      enable_safety_checker: false,
    },
    supportedResolutions: ["480p", "720p", "1080p"],
    supportedDurations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    supportedAspectRatios: [
      "21:9",
      "16:9",
      "4:3",
      "1:1",
      "3:4",
      "9:16",
      "auto",
    ],
  },
  // Kling & WAN Image-to-Video Models
  {
    id: "kling_v2_5_turbo_i2v",
    name: "Kling v2.5 Turbo Pro I2V",
    description:
      "Top-tier Kling model with cinematic motion and multi-ratio output",
    price: "0.35", // $0.35 per 5s clip
    resolution: "1080p",
    max_duration: 10,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
      aspect_ratio: "16:9",
      cfg_scale: 0.5,
      enhance_prompt: true,
      negative_prompt: "blur, distort, low quality",
    },
    supportedResolutions: ["1080p"],
    supportedDurations: [5, 10],
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  },
  {
    id: "wan_25_preview_i2v",
    name: "WAN v2.5 Preview I2V",
    description:
      "Animate images with WAN 2.5 Preview, optional music + prompt expansion",
    price: "0.05-0.15/s",
    resolution: "480p / 720p / 1080p",
    max_duration: 10,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/wan-25-preview/image-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
      enable_prompt_expansion: true,
    },
    supportedResolutions: ["480p", "720p", "1080p"],
    supportedDurations: [5, 10],
    perSecondPricing: {
      "480p": 0.05,
      "720p": 0.1,
      "1080p": 0.15,
    },
  },
  // Veo 3.1 Image-to-Video Models
  {
    id: "veo31_fast_image_to_video",
    name: "Veo 3.1 Fast Image-to-Video",
    description:
      "Google's Veo 3.1 Fast - Animate static images with motion (faster, budget-friendly)",
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
    description:
      "Google's Veo 3.1 Fast - Animate between first and last frames (faster, budget-friendly)",
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
  {
    id: "veo31_image_to_video",
    name: "Veo 3.1 Image-to-Video",
    description:
      "Google's Veo 3.1 - Premium quality image animation with motion",
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
    description:
      "Google's Veo 3.1 - Premium quality animation between first and last frames",
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
  // Hailuo 2.3 Image-to-Video Models
  {
    id: "hailuo23_standard",
    name: "Hailuo 2.3 Standard",
    description: "Budget-friendly image-to-video with 768p quality",
    price: "0.28-0.56", // 6s: $0.28, 10s: $0.56
    resolution: "768p",
    max_duration: 10,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
    },
    default_params: {
      duration: 6,
      resolution: "768p",
      prompt_optimizer: true,
    },
  },
  {
    id: "hailuo23_fast_pro",
    name: "Hailuo 2.3 Fast Pro",
    description: "Balanced 1080p image-to-video with faster generation",
    price: "0.33",
    resolution: "1080p",
    max_duration: 10,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video",
    },
    default_params: {
      duration: 6,
      resolution: "1080p",
      prompt_optimizer: true,
    },
  },
  {
    id: "hailuo23_pro",
    name: "Hailuo 2.3 Pro",
    description: "Premium 1080p image-to-video with highest fidelity",
    price: "0.49",
    resolution: "1080p",
    max_duration: 10,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/minimax/hailuo-2.3/pro/image-to-video",
    },
    default_params: {
      duration: 6,
      resolution: "1080p",
      prompt_optimizer: true,
    },
  },
  // Vidu Q2 Image-to-Video
  {
    id: "vidu_q2_turbo_i2v",
    name: "Vidu Q2 Turbo I2V",
    description: "High-quality image-to-video with motion control (2-8s)",
    price: "0.05", // $0.05/second for 720p
    resolution: "720p",
    max_duration: 8,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/vidu/q2/image-to-video/turbo",
    },
    default_params: {
      duration: 4,
      resolution: "720p",
      movement_amplitude: "auto",
    },
  },
  // Hailuo 2.3 Text-to-Video Models
  {
    id: "hailuo23_standard_t2v",
    name: "Hailuo 2.3 Standard T2V",
    description: "Budget-friendly text-to-video with 768p quality",
    price: "0.28-0.56", // 6s: $0.28, 10s: $0.56
    resolution: "768p",
    max_duration: 10,
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/minimax/hailuo-2.3/standard/text-to-video",
    },
    default_params: {
      duration: 6,
      resolution: "768p",
      prompt_optimizer: true,
    },
  },
  {
    id: "hailuo23_pro_t2v",
    name: "Hailuo 2.3 Pro T2V",
    description:
      "Premium 1080p text-to-video with cinematic camera control (use [Pan left], [Zoom in] in prompts)",
    price: "0.49",
    resolution: "1080p",
    max_duration: 10,
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/minimax/hailuo-2.3/pro/text-to-video",
    },
    default_params: {
      duration: 6,
      resolution: "1080p",
      prompt_optimizer: true,
    },
  },
  {
    id: "seedance",
    name: "Seedance v1 Lite",
    description: "Fast and efficient text-to-video generation",
    price: "0.18",
    resolution: "720p",
    max_duration: 10,
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/bytedance/seedance/v1/lite/text-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "720p",
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
    id: "kling_v2_5_turbo",
    name: "Kling v2.5 Turbo Pro",
    description: "Latest Kling model with enhanced turbo performance",
    price: "0.18",
    resolution: "1080p",
    max_duration: 10,
    category: "text",
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
  // Video Upscale Models
  {
    id: "bytedance_video_upscaler",
    name: "ByteDance Video Upscaler",
    description:
      "AI-powered video upscaling to 1080p, 2K, or 4K with optional 60fps",
    price: "0.072", // Base price per 10s @ 1080p
    resolution: "1080p / 2K / 4K",
    max_duration: 120, // 2 minutes max
    category: "upscale",
    endpoints: {
      upscale_video: "fal-ai/bytedance-upscaler/upscale/video",
    },
    default_params: {
      target_resolution: "1080p",
      target_fps: "30fps",
    },
    supportedResolutions: ["1080p", "2k", "4k"],
    supportedFPS: ["30fps", "60fps"],
    perSecondPricing: {
      "1080p_30fps": 0.0072,
      "2k_30fps": 0.0144,
      "4k_30fps": 0.0288,
      "1080p_60fps": 0.0144,
      "2k_60fps": 0.0288,
      "4k_60fps": 0.0576,
    },
  },
  {
    id: "flashvsr_video_upscaler",
    name: "FlashVSR Video Upscaler",
    description:
      "Fastest video upscaling (1-4x) with customizable quality and format options",
    price: "0.125", // Base estimate for ~121 frames @ 1080p
    pricingModel: "megapixel", // $0.0005 per megapixel
    resolution: "1x to 4x upscaling",
    max_duration: 120, // Estimated practical limit
    category: "upscale",
    endpoints: {
      upscale_video: "fal-ai/flashvsr/upscale/video",
    },
    default_params: {
      upscale_factor: 4,
      acceleration: "regular",
      quality: "70",
      color_fix: true,
      preserve_audio: false,
      output_format: "X264",
      output_quality: "high",
      output_write_mode: "balanced",
    },
    supportedUpscaleFactors: { min: 1, max: 4, step: 0.1 },
    supportedAcceleration: ["regular", "high", "full"],
    supportedOutputFormats: ["X264", "VP9", "PRORES4444", "GIF"],
    supportedOutputQuality: ["low", "medium", "high", "maximum"],
    supportedWriteModes: ["fast", "balanced", "small"],
  },
  {
    id: "topaz_video_upscale",
    name: "Topaz Video Upscale",
    description: "Professional upscaling up to 8x with AI enhancement",
    price: "0.50", // Base price for 2x upscale
    resolution: "Up to 8x upscaling",
    max_duration: 120, // 2 minutes max
    category: "upscale",
    endpoints: {
      upscale_video: "topaz/video-upscale", // Placeholder - needs actual endpoint
    },
    default_params: {
      upscale_factor: 2.0,
      target_fps: "original",
      h264_output: false,
    },
    supportedUpscaleFactors: [2.0, 3.0, 4.0, 6.0, 8.0],
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
  // Kling Avatar v2 Models - Enhanced lip-sync and animation quality
  {
    id: "kling_avatar_v2_standard",
    name: "Kling Avatar v2 Standard",
    description:
      "Create talking avatar videos with realistic humans, animals, cartoons, or stylized characters. Audio-synchronized lip-sync.",
    price: "0.0562", // Per second pricing
    resolution: "1080p",
    max_duration: 60,
    category: "avatar",
    requiredInputs: ["characterImage", "audioFile"],
    endpoints: {
      text_to_video: "fal-ai/kling-video/ai-avatar/v2/standard",
    },
    default_params: {
      prompt: "",
      resolution: "1080p",
    },
    perSecondPricing: {
      "1080p": 0.0562,
    },
    audioConstraints: {
      minDurationSec: 2,
      maxDurationSec: 60,
      maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
    },
  },
  {
    id: "kling_avatar_v2_pro",
    name: "Kling Avatar v2 Pro",
    description:
      "Premium avatar video generation with enhanced quality and realism. Ideal for professional productions.",
    price: "0.115", // Per second pricing
    resolution: "1080p",
    max_duration: 60,
    category: "avatar",
    requiredInputs: ["characterImage", "audioFile"],
    endpoints: {
      text_to_video: "fal-ai/kling-video/ai-avatar/v2/pro",
    },
    default_params: {
      prompt: "",
      resolution: "1080p",
    },
    perSecondPricing: {
      "1080p": 0.115,
    },
    audioConstraints: {
      minDurationSec: 2,
      maxDurationSec: 60,
      maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
    },
  },
  // Sync Lipsync React-1 - Emotion-aware lip-sync
  {
    id: "sync_lipsync_react1",
    name: "Sync Lipsync React-1",
    description:
      "Emotion-aware lip-sync: sync video to audio with expressions (happy, sad, angry, etc.)",
    price: "0.10", // 5 credits per request
    resolution: "Preserves source",
    max_duration: 15, // 15 second limit for both inputs
    category: "avatar",
    requiredInputs: ["sourceVideo", "audioFile"],
    endpoints: {
      text_to_video: "fal-ai/sync-lipsync/react-1",
    },
    default_params: {
      emotion: "neutral",
      model_mode: "face",
      lipsync_mode: "bounce",
      temperature: 0.5,
    },
    supportedEmotions: [
      "happy",
      "angry",
      "sad",
      "neutral",
      "disgusted",
      "surprised",
    ],
    supportedModelModes: ["lips", "face", "head"],
    supportedLipsyncModes: ["cut_off", "loop", "bounce", "silence", "remap"],
  },
  // Kling O1 Models - Advanced video generation with cinematic understanding
  {
    id: "kling_o1_v2v_reference",
    name: "Kling O1 Video Reference",
    description:
      "Generate new shots guided by input reference video, preserving motion and camera style",
    price: "0.112", // Per second pricing
    resolution: "1080p",
    max_duration: 10,
    category: "avatar", // Avatar tab for video-to-video models
    requiredInputs: ["sourceVideo"],
    endpoints: {
      image_to_video: "fal-ai/kling-video/o1/video-to-video/reference",
    },
    default_params: {
      duration: 5,
      aspect_ratio: "auto",
    },
    supportedDurations: [5, 10],
    supportedAspectRatios: ["auto", "16:9", "9:16", "1:1"],
  },
  {
    id: "kling_o1_v2v_edit",
    name: "Kling O1 Video Edit",
    description:
      "Edit videos through natural language instructions while preserving motion structure",
    price: "0.168", // Per second pricing
    resolution: "1080p",
    max_duration: 10,
    category: "avatar", // Avatar tab for video-to-video models
    requiredInputs: ["sourceVideo"],
    endpoints: {
      image_to_video: "fal-ai/kling-video/o1/video-to-video/edit",
    },
    default_params: {
      duration: 5,
    },
    supportedDurations: [5, 10],
  },
  {
    id: "kling_o1_ref2video",
    name: "Kling O1 Reference-to-Video",
    description:
      "Transform reference images and elements into consistent video scenes",
    price: "0.112", // Per second pricing
    resolution: "1080p",
    max_duration: 10,
    category: "avatar", // Avatar tab - uses reference images
    requiredInputs: ["referenceImages"],
    endpoints: {
      image_to_video: "fal-ai/kling-video/o1/reference-to-video",
    },
    default_params: {
      duration: 5,
      aspect_ratio: "16:9",
      cfg_scale: 0.5,
      negative_prompt: "blur, distort, low quality",
    },
    supportedDurations: [5, 10],
    supportedAspectRatios: ["16:9", "9:16", "1:1"],
  },
  {
    id: "kling_o1_i2v",
    name: "Kling O1 Image-to-Video",
    description:
      "Animate transitions between start and end frames with cinematic motion",
    price: "0.112", // Per second pricing
    resolution: "1080p",
    max_duration: 10,
    category: "image", // Keep in Image tab - uses images
    requiredInputs: ["firstFrame"],
    endpoints: {
      image_to_video: "fal-ai/kling-video/o1/image-to-video",
    },
    default_params: {
      duration: 5,
    },
    supportedDurations: [5, 10],
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
  // Veo 3.1 Extend-Video Models - Extend videos by 7 seconds
  {
    id: "veo31_fast_extend_video",
    name: "Veo 3.1 Fast Extend",
    description:
      "Extend videos by 7s with motion continuation (faster, budget-friendly)",
    price: "0.15/s", // $0.15/second with audio, $0.10/s without
    resolution: "720p",
    max_duration: 7,
    category: "avatar", // Avatar tab has Source Video upload
    requiredInputs: ["sourceVideo"],
    endpoints: {
      image_to_video: "fal-ai/veo3.1/fast/extend-video",
    },
    default_params: {
      duration: 7, // 7 seconds (API accepts "7s" but type requires number)
      resolution: "720p",
      aspect_ratio: "auto",
      generate_audio: true,
      auto_fix: false,
    },
    supportedAspectRatios: ["auto", "16:9", "9:16"],
  },
  {
    id: "veo31_extend_video",
    name: "Veo 3.1 Extend",
    description:
      "Extend videos by 7s with premium quality motion continuation",
    price: "0.40/s", // $0.40/second with audio, $0.20/s without
    resolution: "720p",
    max_duration: 7,
    category: "avatar",
    requiredInputs: ["sourceVideo"],
    endpoints: {
      image_to_video: "fal-ai/veo3.1/extend-video",
    },
    default_params: {
      duration: 7, // 7 seconds (API accepts "7s" but type requires number)
      resolution: "720p",
      aspect_ratio: "auto",
      generate_audio: true,
      auto_fix: false,
    },
    supportedAspectRatios: ["auto", "16:9", "9:16"],
  },
  // Kling Avatar v1 Models (Legacy)
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
    id: "sora2_video_to_video_remix",
    name: "Sora 2 Video-to-Video Remix",
    description:
      "Transform Sora-generated videos with style changes (requires existing Sora video)",
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

  // Video uploads (WAN + Upscale)
  ALLOWED_VIDEO_TYPES: ["video/mp4", "video/quicktime", "video/x-msvideo"],
  MAX_VIDEO_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
  MAX_VIDEO_SIZE_LABEL: "100MB",
  SUPPORTED_VIDEO_FORMATS: [".mp4", ".mov", ".avi"],
  VIDEO_FORMATS_LABEL: "MP4, MOV, AVI",

  // Upscale overrides (ByteDance/Topaz allow 500MB)
  UPSCALE_MAX_VIDEO_SIZE_BYTES: 500 * 1024 * 1024,
  UPSCALE_MAX_VIDEO_SIZE_LABEL: "500MB",

  // Veo 3.1 frame uploads (for frame-to-video model)
  MAX_VEO31_FRAME_SIZE_BYTES: 8 * 1024 * 1024, // 8MB (Veo 3.1 limit)
  MAX_VEO31_FRAME_SIZE_LABEL: "8MB",
  ALLOWED_VEO31_ASPECT_RATIOS: ["16:9", "9:16"],

  // Seeddream 4.5 edit image uploads
  MAX_SEEDDREAM45_IMAGES: 10,
  MAX_SEEDDREAM45_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB per image
  MAX_SEEDDREAM45_IMAGE_SIZE_LABEL: "10MB",

  // Veo 3.1 extend-video constraints
  MAX_EXTEND_VIDEO_DURATION_SECONDS: 8,
  EXTEND_VIDEO_SUPPORTED_FORMATS: ["mp4", "mov", "webm", "m4v", "gif"],
  EXTEND_VIDEO_SUPPORTED_RESOLUTIONS: ["720p", "1080p"],
  EXTEND_VIDEO_SUPPORTED_ASPECT_RATIOS: ["16:9", "9:16"],
  EXTEND_VIDEO_OUTPUT_DURATION_SECONDS: 7,
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
  VEO31_INVALID_ASPECT_RATIO:
    "Veo 3.1 requires 16:9 or 9:16 aspect ratio for images",
  VEO31_MISSING_FIRST_FRAME:
    "First frame is required for Veo 3.1 frame-to-video",
  VEO31_MISSING_LAST_FRAME: "Last frame is required for Veo 3.1 frame-to-video",
  VEO31_FRAME_ASPECT_MISMATCH:
    "First and last frames must have matching aspect ratios",

  // Hailuo 2.3 Text-to-Video errors
  HAILUO23_T2V_PROMPT_TOO_LONG_STANDARD:
    "Prompt exceeds 1500 character limit for Hailuo 2.3 Standard",
  HAILUO23_T2V_PROMPT_TOO_LONG_PRO:
    "Prompt exceeds 2000 character limit for Hailuo 2.3 Pro",
  HAILUO23_T2V_EMPTY_PROMPT: "Please enter a text prompt for video generation",
  HAILUO23_T2V_INVALID_DURATION:
    "Duration must be either 6 or 10 seconds for Hailuo 2.3 models",

  // Reve specific errors
  REVE_IMAGE_TOO_LARGE: "Image must be under 10MB for Reve Edit",
  REVE_INVALID_DIMENSIONS:
    "Image dimensions must be between 128×128 and 4096×4096 pixels",
  REVE_INVALID_FORMAT: "Please upload PNG, JPEG, WebP, AVIF, or HEIF image",
  REVE_PROMPT_TOO_LONG: "Prompt must be under 2560 characters",
  // Vidu Q2 errors
  VIDU_Q2_PROMPT_TOO_LONG: "Prompt exceeds 3000 character limit for Vidu Q2",
  VIDU_Q2_INVALID_DURATION:
    "Duration must be between 2 and 8 seconds for Vidu Q2",
  VIDU_Q2_MISSING_IMAGE:
    "Image is required for Vidu Q2 image-to-video generation",
  // LTX Video 2.0 errors
  LTXV2_INVALID_DURATION:
    "Duration must be 6, 8, or 10 seconds for LTX Video 2.0",
  LTXV2_INVALID_RESOLUTION:
    "Resolution must be 1080p, 1440p, or 2160p for LTX Video 2.0",
  LTXV2_EMPTY_PROMPT: "Please enter a text prompt for LTX Video 2.0",
  LTXV2_FAST_T2V_INVALID_DURATION:
    "Duration must be 6, 8, 10, 12, 14, 16, 18, or 20 seconds for LTX Video 2.0 Fast Text-to-Video",
  LTXV2_FAST_T2V_EXTENDED_DURATION_CONSTRAINT:
    "Videos longer than 10 seconds require 1080p resolution and 25 FPS for LTX Video 2.0 Fast",
  LTXV2_STD_I2V_EMPTY_PROMPT:
    "Please enter a prompt describing the desired video motion",
  LTXV2_STD_I2V_MISSING_IMAGE:
    "Image URL is required for LTX Video 2.0 image-to-video generation",
  LTXV2_STD_I2V_INVALID_DURATION:
    "Duration must be 6, 8, or 10 seconds for LTX Video 2.0",
  LTXV2_STD_I2V_INVALID_RESOLUTION:
    "Resolution must be 1080p (1920x1080), 1440p (2560x1440), or 2160p (3840x2160) for LTX Video 2.0 Standard",
  LTXV2_STD_I2V_IMAGE_TOO_LARGE:
    "Image file must be under 7MB for LTX Video 2.0 image-to-video",
  LTXV2_STD_I2V_INVALID_FORMAT:
    "Image must be PNG, JPEG, WebP, AVIF, or HEIF for LTX Video 2.0 image-to-video",
  LTXV2_I2V_INVALID_DURATION:
    "Duration must be 6, 8, 10, 12, 14, 16, 18, or 20 seconds for LTX Video 2.0 Fast",
  LTXV2_I2V_INVALID_RESOLUTION:
    "Resolution must be 1080p (1920x1080), 1440p (2560x1440), or 2160p (3840x2160) for LTX Video 2.0 Fast I2V",
  LTXV2_I2V_EXTENDED_DURATION_CONSTRAINT:
    "Videos longer than 10 seconds require 1080p resolution and 25 FPS for LTX Video 2.0 Fast",
  LTXV2_I2V_MISSING_IMAGE:
    "Image is required for LTX Video 2.0 Fast image-to-video generation",

  // Seeddream 4.5 errors
  SEEDDREAM45_EMPTY_PROMPT: "Please enter a prompt for image generation",
  SEEDDREAM45_EDIT_NO_IMAGES: "Please select at least one image to edit",
  SEEDDREAM45_EDIT_TOO_MANY_IMAGES:
    "Maximum 10 images allowed for Seeddream 4.5 edit",
  SEEDDREAM45_UPLOAD_FAILED: "Failed to upload image for editing",
  SEEDDREAM45_GENERATION_FAILED: "Seeddream 4.5 image generation failed",

  // Kling 2.6 specific errors
  KLING26_EMPTY_PROMPT: "Please enter a prompt for Kling 2.6 video generation",
  KLING26_INVALID_DURATION: "Duration must be 5 or 10 seconds for Kling 2.6",
  KLING26_INVALID_ASPECT_RATIO:
    "Aspect ratio must be 16:9, 9:16, or 1:1 for Kling 2.6",
  KLING26_I2V_MISSING_IMAGE:
    "Image is required for Kling 2.6 image-to-video generation",
  KLING26_PROMPT_TOO_LONG:
    "Prompt exceeds maximum length of 2,500 characters for Kling 2.6",

  // Kling Avatar v2 specific errors
  KLING_AVATAR_V2_MISSING_IMAGE:
    "Character image is required for Kling Avatar v2",
  KLING_AVATAR_V2_MISSING_AUDIO: "Audio file is required for Kling Avatar v2",
  KLING_AVATAR_V2_AUDIO_TOO_SHORT:
    "Audio must be at least 2 seconds for Kling Avatar v2",
  KLING_AVATAR_V2_AUDIO_TOO_LONG:
    "Audio must be under 60 seconds for Kling Avatar v2",
  KLING_AVATAR_V2_AUDIO_TOO_LARGE:
    "Audio file must be under 5MB for Kling Avatar v2",

  // Sync Lipsync React-1 specific errors
  SYNC_LIPSYNC_REACT1_MISSING_VIDEO:
    "Video is required for Sync Lipsync React-1",
  SYNC_LIPSYNC_REACT1_MISSING_AUDIO:
    "Audio is required for Sync Lipsync React-1",
  SYNC_LIPSYNC_REACT1_VIDEO_TOO_LONG:
    "Video must be 15 seconds or shorter for Sync Lipsync React-1",
  SYNC_LIPSYNC_REACT1_AUDIO_TOO_LONG:
    "Audio must be 15 seconds or shorter for Sync Lipsync React-1",
  SYNC_LIPSYNC_REACT1_MISSING_EMOTION:
    "Emotion is required for Sync Lipsync React-1",
  SYNC_LIPSYNC_REACT1_INVALID_EMOTION:
    "Invalid emotion for Sync Lipsync React-1. Must be one of: happy, angry, sad, neutral, disgusted, surprised",
  SYNC_LIPSYNC_REACT1_INVALID_TEMPERATURE:
    "Temperature must be between 0 and 1 for Sync Lipsync React-1",

  // Video file fallback errors
  VIDEO_FILE_TOO_LARGE_FOR_FALLBACK:
    "Video file too large for browser fallback (max 50MB). Please use the desktop app for larger files.",

  // Veo 3.1 Extend-Video specific errors
  EXTEND_VIDEO_TOO_LONG:
    "Input video must be 8 seconds or less for Veo 3.1 extend-video",
  EXTEND_VIDEO_INVALID_RESOLUTION:
    "Video must be 720p or 1080p for Veo 3.1 extend-video",
  EXTEND_VIDEO_INVALID_ASPECT_RATIO:
    "Video must be 16:9 or 9:16 for Veo 3.1 extend-video",
  EXTEND_VIDEO_MISSING:
    "Please upload a source video to extend",
  EXTEND_VIDEO_INVALID_FORMAT:
    "Video format must be MP4, MOV, WebM, M4V, or GIF for Veo 3.1 extend-video",
} as const;

// LTX Video 2.0 Fast Configuration
export const LTXV2_FAST_CONFIG = {
  DURATIONS: [6, 8, 10, 12, 14, 16, 18, 20] as const,
  RESOLUTIONS: {
    STANDARD: ["1080p", "1440p", "2160p"] as const,
    EXTENDED: ["1080p"] as const, // For videos > 10 seconds
  },
  FPS_OPTIONS: {
    STANDARD: [25, 50] as const,
    EXTENDED: [25] as const, // For videos > 10 seconds
  },
  EXTENDED_DURATION_THRESHOLD: 10,
  MAX_IMAGE_SIZE_MB: 7,
  SUPPORTED_FORMATS: ["PNG", "JPEG", "WebP", "AVIF", "HEIF"] as const,
  PRICING: {
    "1080p": 0.04, // per second
    "1440p": 0.08, // per second
    "2160p": 0.16, // per second
  },
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

  /**
   * Check if model requires first + last frame inputs
   * Used to determine if F2V upload UI should be shown
   * @param modelId - Model ID to check
   * @returns true if model supports frame-to-frame animation
   */
  requiresFrameToFrame: (modelId: string): boolean => {
    const model = AI_MODELS.find((m) => m.id === modelId);
    return model?.requiredInputs?.includes("firstFrame") ?? false;
  },

  /**
   * Check if model requires source video input
   * Used to determine if V2V (video-to-video) upload UI should be shown
   * @param modelId - Model ID to check
   * @returns true if model requires source video for transformation
   */
  requiresSourceVideo: (modelId: string): boolean => {
    const model = AI_MODELS.find((m) => m.id === modelId);
    return model?.requiredInputs?.includes("sourceVideo") ?? false;
  },

  /**
   * Get required inputs for a model
   * Centralizes input requirements for maintainability
   * @param modelId - Model ID to check
   * @returns Array of required input keys (e.g., ['firstFrame', 'lastFrame'])
   */
  getRequiredInputs: (modelId: string): string[] => {
    const model = AI_MODELS.find((m) => m.id === modelId);
    return model?.requiredInputs || [];
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
    supportedFormats: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
      "image/heif",
    ] as const,
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
