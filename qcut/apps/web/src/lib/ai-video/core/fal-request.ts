/**
 * Core FAL API Request Utilities
 *
 * Provides a consistent interface for making FAL AI API requests.
 * Centralizes authentication, error handling, and response parsing.
 */

import { handleAIServiceError } from "@/lib/error-handler";

// Direct FAL AI integration - no backend needed
export const FAL_API_BASE = "https://fal.run";

/**
 * Retrieves the current FAL API key from environment at call time.
 *
 * WHY: Tests stub environment variables after module load; reading lazily keeps
 * stubs in sync instead of freezing the value during import.
 */
export function getFalApiKey(): string | undefined {
  return import.meta.env.VITE_FAL_API_KEY;
}

/**
 * Generates a unique job ID for tracking video generation requests.
 *
 * Format: job_{random_string}_{timestamp}
 * Example: job_abc123xyz_1699876543210
 */
export function generateJobId(): string {
  return `job_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
}

/**
 * Options for FAL API requests
 */
export interface FalRequestOptions {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Enable queue mode for long-running jobs */
  queueMode?: boolean;
}

/**
 * Makes an authenticated request to FAL AI API.
 *
 * @param endpoint - FAL endpoint path (e.g., "fal-ai/kling-video/v2.6/pro/text-to-video")
 * @param payload - Request payload
 * @param options - Optional request configuration
 * @returns Raw Response object for flexible handling
 * @throws Error with user-friendly message if API key is missing
 */
export async function makeFalRequest(
  endpoint: string,
  payload: Record<string, unknown>,
  options?: FalRequestOptions
): Promise<Response> {
  const apiKey = getFalApiKey();
  if (!apiKey) {
    const error = new Error(
      "FAL API key not configured. Please set VITE_FAL_API_KEY in your environment variables."
    );
    handleAIServiceError(error, "FAL API Request", {
      configRequired: "VITE_FAL_API_KEY",
      operation: "checkApiKey",
    });
    throw error;
  }

  const headers: Record<string, string> = {
    Authorization: `Key ${apiKey}`,
    "Content-Type": "application/json",
  };

  // Add queue headers if queue mode requested
  if (options?.queueMode) {
    headers["X-Fal-Queue"] = "true";
    headers["X-Queue"] = "true";
    headers["Queue"] = "true";
  }

  const url = endpoint.startsWith("https://")
    ? endpoint
    : `${FAL_API_BASE}/${endpoint}`;

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: options?.signal,
  });
}

/**
 * Handles FAL API response and converts errors to user-friendly messages.
 *
 * @param response - Fetch Response object
 * @param operation - Name of the operation for error context
 * @throws Error with appropriate message for different error codes
 */
export async function handleFalResponse(
  response: Response,
  operation: string
): Promise<void> {
  if (response.ok) return;

  const errorData = await response.json().catch(() => ({}));

  if (response.status === 401) {
    throw new Error(
      "Invalid FAL.ai API key. Please check your API key configuration."
    );
  }

  if (response.status === 429) {
    throw new Error(
      "Rate limit exceeded. Please wait a moment before trying again."
    );
  }

  if (response.status === 413) {
    throw new Error(
      "Image file too large. Maximum size is 7MB for this model."
    );
  }

  throw new Error(
    `FAL API error: ${(errorData as Record<string, unknown>).detail || response.statusText}`
  );
}

/**
 * Formats error messages from FAL queue responses.
 *
 * @param errorData - Error data from FAL API
 * @returns User-friendly error message
 */
export function formatQueueError(errorData: unknown): string {
  if (typeof errorData === "object" && errorData !== null) {
    const data = errorData as Record<string, unknown>;
    if (data.error && typeof data.error === "string") {
      return data.error;
    }
    if (data.detail && typeof data.detail === "string") {
      return data.detail;
    }
    if (data.message && typeof data.message === "string") {
      return data.message;
    }
  }
  return "An unknown error occurred during video generation";
}

/**
 * Sleep utility for polling intervals.
 *
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
