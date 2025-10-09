/**
 * Sora 2 Type Definitions
 * OpenAI's Sora 2 video generation models via FAL AI
 */

/**
 * Sora 2 Text-to-Video Standard API Input
 */
export interface Sora2TextToVideoInput {
  prompt: string;
  resolution?: "720p";
  aspect_ratio?: "9:16" | "16:9";
  duration?: 4 | 8 | 12;
  api_key?: string;
}

/**
 * Sora 2 Text-to-Video Pro API Input
 * Extends standard with 1080p support
 */
export interface Sora2TextToVideoProInput {
  prompt: string;
  resolution?: "720p" | "1080p"; // Pro adds 1080p
  aspect_ratio?: "9:16" | "16:9";
  duration?: 4 | 8 | 12;
  api_key?: string;
}

/**
 * Sora 2 Image-to-Video Standard API Input
 */
export interface Sora2ImageToVideoInput {
  prompt: string;
  image_url: string;
  resolution?: "auto" | "720p";
  aspect_ratio?: "auto" | "9:16" | "16:9";
  duration?: 4 | 8 | 12;
  api_key?: string;
}

/**
 * Sora 2 Image-to-Video Pro API Input
 * Extends standard with 1080p support
 */
export interface Sora2ImageToVideoProInput {
  prompt: string;
  image_url: string;
  resolution?: "auto" | "720p" | "1080p"; // Pro adds 1080p
  aspect_ratio?: "auto" | "9:16" | "16:9";
  duration?: 4 | 8 | 12;
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
 */
export interface Sora2Response {
  video: string | { url: string; content_type: string };
  video_id: string;
}

/**
 * Parsed Sora 2 Video Result
 */
export interface Sora2VideoResult {
  videoUrl: string;
  videoId: string;
  duration: 4 | 8 | 12;
  resolution: string;
  aspectRatio: string;
}

/**
 * Type guard for Sora 2 models
 */
export type Sora2ModelType =
  | 'sora2-text-to-video'
  | 'sora2-text-to-video-pro'
  | 'sora2-image-to-video'
  | 'sora2-image-to-video-pro'
  | 'sora2-video-to-video-remix';

/**
 * Sora 2 generation settings
 */
export interface Sora2Settings {
  duration: 4 | 8 | 12;
  aspectRatio: "9:16" | "16:9";
  resolution: "auto" | "720p" | "1080p";
}
