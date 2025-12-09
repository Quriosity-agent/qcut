/**
 * Base Video Generator
 *
 * Provides common functionality for all video generators.
 * Contains shared utilities used across text-to-video, image-to-video, and avatar generators.
 */

import { AI_MODELS } from "@/components/editor/media-panel/views/ai/constants/ai-constants";
import type {
  AIModel,
  VideoGenerationResponse,
} from "@/components/editor/media-panel/views/ai/types/ai-types";
import { handleAIServiceError } from "@/lib/error-handler";
import { generateJobId } from "../core/fal-request";

/**
 * Gets model configuration from centralized AI_MODELS registry.
 *
 * WHY: Ensures consistent model configuration across text, image, and avatar generation flows.
 * Edge case: Returns undefined for unknown model IDs - caller must handle gracefully.
 *
 * @param modelId - Unique identifier for the AI model (e.g., "kling_v2", "bytedance_omnihuman_v1_5")
 * @returns Model configuration object or undefined if model not found
 */
export function getModelConfig(modelId: string): AIModel | undefined {
  return AI_MODELS.find((m) => m.id === modelId);
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
export async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Extracts video URL from various FAL API response formats.
 *
 * FAL API returns video URLs in different locations depending on the model:
 * - result.video.url (most common)
 * - result.video_url (some older models)
 * - result.url (fallback)
 *
 * @param result - Raw API response object
 * @returns Video URL if found, undefined otherwise
 */
function extractVideoUrl(result: Record<string, unknown>): string | undefined {
  const video = result.video as Record<string, unknown> | undefined;
  return (
    (video?.url as string | undefined) ??
    (result.video_url as string | undefined) ??
    (result.url as string | undefined)
  );
}

/**
 * Builds a standard video generation response.
 *
 * @param jobId - Unique job identifier
 * @param modelId - Model that generated the video
 * @param result - Raw API response
 * @param elapsedTime - Time taken for generation in seconds
 * @returns Formatted VideoGenerationResponse
 */
export function buildVideoResponse(
  jobId: string,
  modelId: string,
  result: Record<string, unknown>,
  elapsedTime?: number
): VideoGenerationResponse {
  return {
    job_id: jobId,
    status: "completed",
    message: `Video generated successfully with ${modelId}`,
    estimated_time: elapsedTime ?? 0,
    video_url: extractVideoUrl(result),
    video_data: result,
  };
}

/**
 * Wraps generator execution with error handling.
 *
 * @param operation - Name of the operation for error context
 * @param metadata - Additional metadata for error logging
 * @param fn - Async function to execute
 * @returns Result of fn()
 * @throws Re-throws error after logging
 */
export async function withErrorHandling<T>(
  operation: string,
  metadata: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    handleAIServiceError(error, operation, metadata);
    throw error;
  }
}

/**
 * Creates a simple video generation result for quick completions.
 *
 * @param modelId - Model that generated the video
 * @param result - Raw API response
 * @returns VideoGenerationResponse
 */
export function createSimpleResponse(
  modelId: string,
  result: Record<string, unknown>
): VideoGenerationResponse {
  return {
    job_id: generateJobId(),
    status: "completed",
    message: `Video generated successfully with ${modelId}`,
    estimated_time: 0,
    video_url: extractVideoUrl(result),
    video_data: result,
  };
}
