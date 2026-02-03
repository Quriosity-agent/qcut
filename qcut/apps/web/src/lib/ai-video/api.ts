/**
 * AI Video API Utilities
 *
 * High-level API functions for checking availability, getting models,
 * estimating costs, and handling errors.
 */

import { AI_MODELS } from "@/components/editor/media-panel/views/ai/constants/ai-constants";
import type {
  GenerationStatus,
  ModelsResponse,
  CostEstimate,
  VideoGenerationRequest,
} from "@/components/editor/media-panel/views/ai/types/ai-types";
import { getFalApiKey, getFalApiKeyAsync } from "./core/fal-request";
import { getModelConfig } from "./generators/base-generator";

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
  _jobId: string
): Promise<GenerationStatus> {
  // Since we're doing direct FAL API calls, generation is synchronous
  // This function is kept for compatibility with existing UI polling logic
  return {
    status: "completed",
    progress: 100,
    completed: true,
    videoUrl: undefined, // Will be set by the actual generation response
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
  const apiKey = await getFalApiKeyAsync();
  return !!apiKey;
}
