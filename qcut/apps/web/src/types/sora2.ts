/**
 * Sora 2 Type Definitions
 * OpenAI's Sora 2 video generation models via FAL AI
 */

/**
 * Shared type definitions for Sora 2 parameters
 * These ensure consistency across all Sora 2 model interfaces
 */
export type Sora2Duration = 4 | 8 | 12;
export type Sora2AspectRatio = "9:16" | "16:9";
export type Sora2AspectRatioWithAuto = "auto" | Sora2AspectRatio;
export type Sora2Resolution = "720p" | "1080p";
export type Sora2ResolutionWithAuto = "auto" | Sora2Resolution;

/**
 * Sora 2 Text-to-Video Standard API Input
 */
export interface Sora2TextToVideoInput {
  prompt: string;
  resolution?: "720p"; // Standard only supports 720p
  aspect_ratio?: Sora2AspectRatio;
  duration?: Sora2Duration;
  api_key?: string;
}

/**
 * Sora 2 Text-to-Video Pro API Input
 * Extends standard with 1080p support
 */
export interface Sora2TextToVideoProInput {
  prompt: string;
  resolution?: Sora2Resolution; // Pro adds 1080p
  aspect_ratio?: Sora2AspectRatio;
  duration?: Sora2Duration;
  api_key?: string;
}

/**
 * Sora 2 Image-to-Video Standard API Input
 */
export interface Sora2ImageToVideoInput {
  prompt: string;
  image_url: string;
  resolution?: Sora2ResolutionWithAuto; // Supports auto or 720p
  aspect_ratio?: Sora2AspectRatioWithAuto;
  duration?: Sora2Duration;
  api_key?: string;
}

/**
 * Sora 2 Image-to-Video Pro API Input
 * Extends standard with 1080p support
 */
export interface Sora2ImageToVideoProInput {
  prompt: string;
  image_url: string;
  resolution?: Sora2ResolutionWithAuto; // Pro adds 1080p
  aspect_ratio?: Sora2AspectRatioWithAuto;
  duration?: Sora2Duration;
  api_key?: string;
}

/**
 * Sora 2 Video-to-Video Remix API Input
 * IMPORTANT: video_id must be from a previously generated Sora video
 * Cannot use arbitrary video uploads
 */
export interface Sora2VideoToVideoRemixInput {
  prompt: string;
  video_id: string; // MUST be from prior Sora generation
  api_key?: string;
}

/**
 * Sora 2 API Response Format
 * Confirmed from FAL API documentation: video is always an object, never a string
 */
export interface Sora2Response {
  video: {
    url: string;
    content_type: string;
    file_name?: string;
    file_size?: number;
    width?: number;
    height?: number;
    fps?: number;
    duration?: number;
    num_frames?: number;
  };
  video_id: string;
}

/**
 * Parsed Sora 2 Video Result
 */
export interface Sora2VideoResult {
  videoUrl: string;
  videoId: string;
  duration: Sora2Duration;
  resolution: string; // Keep as string since API may return various formats
  aspectRatio: string; // Keep as string for flexibility
}

/**
 * Type guard for Sora 2 models
 * NOTE: Uses underscores to match actual model IDs in ai-constants.ts
 */
export type Sora2ModelType =
  | "sora2_text_to_video"
  | "sora2_text_to_video_pro"
  | "sora2_image_to_video"
  | "sora2_image_to_video_pro"
  | "sora2_video_to_video_remix";

/**
 * Sora 2 generation settings
 */
export interface Sora2Settings {
  duration: Sora2Duration;
  aspectRatio: Sora2AspectRatio;
  resolution: Sora2ResolutionWithAuto;
}
