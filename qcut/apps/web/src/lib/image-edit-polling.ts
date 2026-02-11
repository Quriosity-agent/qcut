/**
 * Polling logic for FAL.ai image edit queue requests
 * Extracted from image-edit-client.ts for modularity
 */

import { handleAIServiceError } from "./error-handler";
import { getFalApiKey, FAL_API_BASE } from "./image-edit-utils";
import type {
  ImageEditResponse,
  ImageEditProgressCallback,
} from "./image-edit-client";

/**
 * Poll for image edit status
 */
export async function pollImageEditStatus(
  requestId: string,
  endpoint: string,
  startTime: number,
  onProgress?: ImageEditProgressCallback,
  jobId?: string,
  modelName?: string
): Promise<ImageEditResponse> {
  const apiKey = await getFalApiKey();
  if (!apiKey) {
    throw new Error(
      "FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
    );
  }

  const maxAttempts = 30; // 2.5 minutes max
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    const elapsedTime = Math.floor((Date.now() - startTime) / 1000);

    try {
      const pollCtrl = new AbortController();
      const pollTimeout = setTimeout(() => pollCtrl.abort(), 15_000); // 15 second timeout per poll

      const statusResponse = await fetch(
        `${FAL_API_BASE}/queue/requests/${requestId}/status`,
        {
          headers: {
            "Authorization": `Key ${apiKey}`,
          },
          signal: pollCtrl.signal,
        }
      );

      clearTimeout(pollTimeout);

      if (!statusResponse.ok) {
        console.warn(
          `Status check failed (attempt ${attempts}):`,
          statusResponse.status
        );
        await sleep(5000);
        continue;
      }

      const status = await statusResponse.json();
      console.log(`📊 Edit status (${elapsedTime}s):`, status);

      if (onProgress) {
        const progressUpdate = mapEditStatusToProgress(status, elapsedTime);
        onProgress(progressUpdate);
      }

      if (status.status === "COMPLETED") {
        const resultResponse = await fetch(
          `${FAL_API_BASE}/queue/requests/${requestId}`,
          {
            headers: {
              "Authorization": `Key ${apiKey}`,
            },
          }
        );

        if (resultResponse.ok) {
          const result = await resultResponse.json();
          // Edit completed successfully

          if (onProgress) {
            onProgress({
              status: "completed",
              progress: 100,
              message: `Image edited successfully with ${modelName}`,
              elapsedTime,
            });
          }

          return {
            job_id: jobId || requestId,
            status: "completed",
            message: `Image edited successfully with ${modelName}`,
            result_url: result.images?.[0]?.url || result.image?.url,
            seed_used: result.seed,
            processing_time: elapsedTime,
          };
        }
      }

      if (status.status === "FAILED") {
        const errorMessage = status.error || "Image editing failed";
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

      await sleep(5000);
    } catch (error) {
      // Handle specific timeout errors
      if (error instanceof Error && error.name === "AbortError") {
        console.warn(
          `⏰ Poll request timeout (attempt ${attempts}): Status check took longer than 15 seconds`
        );
      } else {
        handleAIServiceError(error, "Poll FAL AI image edit status", {
          attempts,
          requestId,
          elapsedTime,
          modelName,
          operation: "pollImageEditStatus",
        });
      }

      if (attempts >= maxAttempts) {
        throw new Error(
          "Image editing timeout - maximum polling attempts reached"
        );
      }
      await sleep(5000);
    }
  }

  throw new Error("Maximum polling attempts reached");
}

/**
 * Maps FAL API status response to a normalized progress update object.
 * @param status - The status response from FAL API
 * @param elapsedTime - Time elapsed since the request started (in seconds)
 * @returns Normalized progress update with status, progress percentage, and message
 */
export function mapEditStatusToProgress(status: any, elapsedTime: number) {
  const baseUpdate = { elapsedTime };

  switch (status.status) {
    case "IN_QUEUE":
      return {
        ...baseUpdate,
        status: "queued" as const,
        progress: 10,
        message: `Queued (position: ${status.queue_position || "unknown"})`,
        estimatedTime: status.estimated_time,
      };
    case "IN_PROGRESS":
      return {
        ...baseUpdate,
        status: "processing" as const,
        progress: Math.min(90, 20 + elapsedTime * 3),
        message: "Processing image...",
        estimatedTime: status.estimated_time,
      };
    case "COMPLETED":
      return {
        ...baseUpdate,
        status: "completed" as const,
        progress: 100,
        message: "Image editing completed!",
      };
    case "FAILED":
      return {
        ...baseUpdate,
        status: "failed" as const,
        progress: 0,
        message: status.error || "Processing failed",
      };
    default:
      return {
        ...baseUpdate,
        status: "processing" as const,
        progress: 5,
        message: `Status: ${status.status}`,
      };
  }
}

/**
 * Pauses execution for a specified duration.
 * @param ms - Duration to sleep in milliseconds
 * @returns Promise that resolves after the specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
