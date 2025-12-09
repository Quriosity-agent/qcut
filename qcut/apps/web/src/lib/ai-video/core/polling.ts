/**
 * FAL Queue Polling Utilities
 *
 * Handles long-running FAL AI job status polling with progress updates.
 */

import { getFalApiKey, FAL_API_BASE, sleep, generateJobId } from "./fal-request";
import type {
  VideoGenerationResponse,
  ProgressCallback,
  ProgressUpdate,
} from "@/components/editor/media-panel/views/ai/types/ai-types";
import { handleAIServiceError } from "@/lib/error-handler";
import { streamVideoDownload, type StreamOptions } from "./streaming";

/**
 * FAL queue status response structure
 */
interface QueueStatus {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  queue_position?: number;
  estimated_time?: number;
  error?: string;
  logs?: string[];
}

// Re-export ProgressUpdate from ai-types for convenience
export type { ProgressUpdate };

/**
 * Options for queue polling
 */
export interface PollOptions {
  /** FAL endpoint that was used for submission */
  endpoint: string;
  /** Timestamp when generation started (ms) */
  startTime: number;
  /** Optional progress callback */
  onProgress?: ProgressCallback;
  /** Optional job ID (will generate if not provided) */
  jobId?: string;
  /** Model name for status messages */
  modelName?: string;
  /** Maximum polling attempts (default: 60 = 5 minutes) */
  maxAttempts?: number;
  /** Polling interval in ms (default: 5000) */
  pollIntervalMs?: number;
  /** Download options for streaming */
  downloadOptions?: StreamOptions;
}

/**
 * Polls FAL queue until job completes or fails.
 *
 * @param requestId - FAL request ID from queue submission
 * @param options - Polling configuration
 * @returns Final generation result
 */
export async function pollQueueStatus(
  requestId: string,
  options: PollOptions
): Promise<VideoGenerationResponse> {
  const {
    endpoint,
    startTime,
    onProgress,
    jobId = generateJobId(),
    modelName = "AI Model",
    maxAttempts = 60,
    pollIntervalMs = 5000,
    downloadOptions,
  } = options;

  const falApiKey = getFalApiKey();
  if (!falApiKey) {
    throw new Error("FAL API key not configured");
  }

  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    const elapsedTime = Math.floor((Date.now() - startTime) / 1000);

    try {
      // Check queue status
      const statusResponse = await fetch(
        `${FAL_API_BASE}/queue/requests/${requestId}/status`,
        {
          headers: {
            Authorization: `Key ${falApiKey}`,
          },
        }
      );

      if (!statusResponse.ok) {
        console.warn(
          `Queue status check failed (attempt ${attempts}):`,
          statusResponse.status
        );
        await sleep(pollIntervalMs);
        continue;
      }

      const status = (await statusResponse.json()) as QueueStatus;
      console.log(`Queue status (${elapsedTime}s):`, status);

      // Update progress based on status
      if (onProgress) {
        const progressUpdate = mapQueueStatusToProgress(status, elapsedTime);
        onProgress(progressUpdate);
      }

      // Check if completed
      if (status.status === "COMPLETED") {
        // Get the result
        const resultResponse = await fetch(
          `${FAL_API_BASE}/queue/requests/${requestId}`,
          {
            headers: {
              Authorization: `Key ${falApiKey}`,
            },
          }
        );

        if (!resultResponse.ok) {
          const errorMessage = `Failed to fetch completed result: ${resultResponse.status} ${resultResponse.statusText}`;
          console.error(errorMessage);
          if (onProgress) {
            onProgress({
              status: "failed",
              progress: 0,
              message: errorMessage,
              elapsedTime,
            });
          }
          throw new Error(errorMessage);
        }

        const result = await resultResponse.json();
        console.log("FAL Queue completed:", result);

        // Handle streaming download if requested
        if (downloadOptions?.downloadToMemory && result.video?.url) {
          console.log("Starting streaming download of queued video...");
          const videoData = await streamVideoDownload(
            result.video.url,
            downloadOptions
          );
          if (downloadOptions.onComplete) {
            downloadOptions.onComplete(videoData);
          }
        }

        if (onProgress) {
          onProgress({
            status: "completed",
            progress: 100,
            message: `Video generated successfully with ${modelName}`,
            elapsedTime,
          });
        }

        return {
          job_id: jobId,
          status: "completed",
          message: `Video generated successfully with ${modelName}`,
          estimated_time: elapsedTime,
          video_url: result.video?.url || result.video,
          video_data: result,
        };
      }

      // Check if failed
      if (status.status === "FAILED") {
        const errorMessage = status.error || "Video generation failed";
        if (onProgress) {
          onProgress({
            status: "failed",
            progress: 0,
            message: errorMessage,
            elapsedTime,
          });
        }
        throw new Error(errorMessage);
      }

      // Continue polling for IN_PROGRESS or IN_QUEUE
      await sleep(pollIntervalMs);
    } catch (error) {
      handleAIServiceError(error, "Poll FAL AI queue status", {
        attempts,
        requestId,
        elapsedTime,
        operation: "statusPolling",
      });

      if (attempts >= maxAttempts) {
        const errorMessage = `Timeout: Video generation took longer than expected (${Math.floor((maxAttempts * pollIntervalMs) / 60000)} minutes)`;
        if (onProgress) {
          onProgress({
            status: "failed",
            progress: 0,
            message: errorMessage,
            elapsedTime,
          });
        }
        throw new Error(errorMessage);
      }

      // Wait before retry
      await sleep(pollIntervalMs);
    }
  }

  throw new Error("Maximum polling attempts reached");
}

/**
 * Maps FAL queue status to user-friendly progress format.
 */
export function mapQueueStatusToProgress(
  status: QueueStatus,
  elapsedTime: number
): ProgressUpdate {
  const baseUpdate = {
    elapsedTime,
    logs: status.logs || [],
  };

  switch (status.status) {
    case "IN_QUEUE":
      return {
        ...baseUpdate,
        status: "queued",
        progress: 5,
        message: `Queued (position: ${status.queue_position || "unknown"})`,
        estimatedTime: status.estimated_time,
      };

    case "IN_PROGRESS": {
      // Gradual progress based on time (caps at 90%)
      const progress = Math.min(90, 20 + elapsedTime * 2);
      return {
        ...baseUpdate,
        status: "processing",
        progress,
        message: "Generating video...",
        estimatedTime: status.estimated_time,
      };
    }

    case "COMPLETED":
      return {
        ...baseUpdate,
        status: "completed",
        progress: 100,
        message: "Video generation completed!",
      };

    case "FAILED":
      return {
        ...baseUpdate,
        status: "failed",
        progress: 0,
        message: status.error || "Generation failed",
      };

    default:
      return {
        ...baseUpdate,
        status: "queued",
        progress: 0,
        message: `Status: ${status.status}`,
      };
  }
}

/**
 * Handles queue-specific errors and returns user-friendly messages.
 *
 * @param response - Fetch Response object
 * @param errorData - Parsed error data from response
 * @param endpoint - FAL endpoint for context
 * @returns User-friendly error message
 */
export function handleQueueError(
  response: Response,
  errorData: unknown,
  endpoint: string
): string {
  const data = errorData as Record<string, unknown>;
  let errorMessage = `FAL Queue error! status: ${response.status}`;

  if (data.detail) {
    if (Array.isArray(data.detail)) {
      errorMessage = data.detail
        .map((d: unknown) => {
          if (typeof d === "object" && d !== null) {
            return (d as Record<string, unknown>).msg || String(d);
          }
          return String(d);
        })
        .join(", ");
    } else {
      errorMessage = String(data.detail);
    }
  } else if (data.error) {
    errorMessage = String(data.error);
  } else if (data.message) {
    errorMessage = String(data.message);
  } else if (typeof errorData === "string") {
    errorMessage = errorData;
  } else if (data.errors && Array.isArray(data.errors)) {
    errorMessage = data.errors.join(", ");
  }

  // Check for specific FAL.ai error patterns
  if (response.status === 422) {
    errorMessage = `Invalid request parameters: ${JSON.stringify(errorData)}`;
  } else if (response.status === 401) {
    errorMessage =
      "Invalid FAL API key. Please check your VITE_FAL_API_KEY environment variable.";
  } else if (response.status === 429) {
    errorMessage =
      "Rate limit exceeded. Please wait a moment before trying again.";
  } else if (response.status === 404) {
    errorMessage = `Model endpoint not found: ${endpoint}. The model may have been updated or moved.`;
  }

  return errorMessage;
}
