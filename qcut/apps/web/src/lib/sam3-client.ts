/**
 * SAM-3 Segmentation Client
 *
 * WHY this client:
 * - Centralized FAL API integration for SAM-3 segmentation
 * - Handles authentication, queue polling, and error recovery
 * - Follows pattern from video-edit-client.ts and image-edit-client.ts
 *
 * Performance: Direct client-to-FAL reduces latency vs backend proxy
 *
 * @module Sam3Client
 */

import { handleAIServiceError } from "./error-handler";
import { debugLogger } from "./debug-logger";
import type {
  Sam3Input,
  Sam3Output,
  Sam3PointPrompt,
  Sam3BoxPrompt,
  Sam3ProgressCallback,
} from "@/types/sam3";

const FAL_API_KEY = import.meta.env.VITE_FAL_API_KEY;
const FAL_API_BASE = "https://fal.run";
const SAM3_ENDPOINT = "fal-ai/sam-3/image";
const SAM3_LOG_COMPONENT = "Sam3Client";

/**
 * SAM-3 Segmentation Client
 * Singleton pattern for consistent FAL configuration
 */
class Sam3Client {
  private apiKey: string | null = null;

  constructor() {
    this.initializeApiKey();
  }

  /**
   * Initialize API key from environment or Electron storage
   */
  private async initializeApiKey(): Promise<void> {
    // Try environment variable first
    this.apiKey = FAL_API_KEY || null;

    // Try Electron API if available
    if (
      !this.apiKey &&
      typeof window !== "undefined" &&
      window.electronAPI?.apiKeys
    ) {
      try {
        const keys = await window.electronAPI.apiKeys.get();
        if (keys?.falApiKey) {
          this.apiKey = keys.falApiKey;
        }
      } catch (error) {
        debugLogger.error(
          SAM3_LOG_COMPONENT,
          "API_KEY_LOAD_FAILED",
          error as Error
        );
      }
    }
  }

  /**
   * Ensure API key is available
   */
  private async ensureApiKey(): Promise<void> {
    if (!this.apiKey) {
      await this.initializeApiKey();
    }
    if (!this.apiKey) {
      throw new Error(
        "FAL API key not configured. Set VITE_FAL_API_KEY or configure in Settings."
      );
    }
  }

  /**
   * Segment image with SAM-3
   *
   * @param input - SAM-3 input parameters
   * @param onProgress - Optional progress callback
   * @returns Segmentation output with masks
   */
  async segmentImage(
    input: Sam3Input,
    onProgress?: Sam3ProgressCallback
  ): Promise<Sam3Output> {
    await this.ensureApiKey();

    const startTime = Date.now();

    debugLogger.log(SAM3_LOG_COMPONENT, "SEGMENT_START", {
      hasTextPrompt: !!input.text_prompt,
      pointCount: input.prompts?.length || 0,
      boxCount: input.box_prompts?.length || 0,
    });

    if (onProgress) {
      onProgress({
        status: "queued",
        progress: 0,
        message: "Submitting to SAM-3...",
        elapsedTime: 0,
      });
    }

    try {
      const response = await fetch(`${FAL_API_BASE}/${SAM3_ENDPOINT}`, {
        method: "POST",
        headers: {
          Authorization: `Key ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-Fal-Queue": "true",
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        handleAIServiceError(
          new Error(`SAM-3 API Error: ${response.status}`),
          "SAM-3 segmentation request",
          { status: response.status, errorData }
        );
        throw new Error(
          `API error: ${response.status} - ${errorData.detail || response.statusText}`
        );
      }

      const result = await response.json();

      // Handle queue mode
      if (result.request_id) {
        return await this.pollForResult(
          result.request_id,
          startTime,
          onProgress
        );
      }

      // Direct result
      if (onProgress) {
        onProgress({
          status: "completed",
          progress: 100,
          message: "Segmentation complete",
          elapsedTime: Math.floor((Date.now() - startTime) / 1000),
        });
      }

      return result as Sam3Output;
    } catch (error) {
      handleAIServiceError(error, "SAM-3 segmentation", {
        operation: "segmentImage",
      });
      throw error;
    }
  }

  /**
   * Poll for queued job result
   */
  private async pollForResult(
    requestId: string,
    startTime: number,
    onProgress?: Sam3ProgressCallback
  ): Promise<Sam3Output> {
    const maxAttempts = 60; // 5 minutes max
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      const elapsedTime = Math.floor((Date.now() - startTime) / 1000);

      try {
        const statusResponse = await fetch(
          `${FAL_API_BASE}/queue/requests/${requestId}/status`,
          {
            headers: { Authorization: `Key ${this.apiKey}` },
          }
        );

        if (!statusResponse.ok) {
          await this.sleep(5000);
          continue;
        }

        const status = await statusResponse.json();

        if (onProgress) {
          onProgress({
            status: status.status === "IN_PROGRESS" ? "processing" : "queued",
            progress: Math.min(90, 10 + attempts * 3),
            message:
              status.status === "IN_PROGRESS"
                ? "Processing..."
                : `Queued (position: ${status.queue_position || "unknown"})`,
            elapsedTime,
          });
        }

        if (status.status === "COMPLETED") {
          const resultResponse = await fetch(
            `${FAL_API_BASE}/queue/requests/${requestId}`,
            {
              headers: { Authorization: `Key ${this.apiKey}` },
            }
          );

          if (resultResponse.ok) {
            const result = await resultResponse.json();

            if (onProgress) {
              onProgress({
                status: "completed",
                progress: 100,
                message: "Segmentation complete",
                elapsedTime,
              });
            }

            return result as Sam3Output;
          }
        }

        if (status.status === "FAILED") {
          throw new Error(status.error || "Segmentation failed");
        }

        await this.sleep(5000);
      } catch (error) {
        if (attempts >= maxAttempts) {
          throw new Error(
            "Segmentation timeout - maximum polling attempts reached"
          );
        }
        await this.sleep(5000);
      }
    }

    throw new Error("Maximum polling attempts reached");
  }

  /**
   * Convenience: Segment with text prompt
   */
  async segmentWithText(
    imageUrl: string,
    textPrompt: string,
    options?: Partial<Omit<Sam3Input, "image_url" | "text_prompt">>
  ): Promise<Sam3Output> {
    return this.segmentImage({
      image_url: imageUrl,
      text_prompt: textPrompt,
      ...options,
    });
  }

  /**
   * Convenience: Segment with point prompts
   */
  async segmentWithPoints(
    imageUrl: string,
    points: Sam3PointPrompt[],
    options?: Partial<Omit<Sam3Input, "image_url" | "prompts">>
  ): Promise<Sam3Output> {
    return this.segmentImage({
      image_url: imageUrl,
      prompts: points,
      ...options,
    });
  }

  /**
   * Convenience: Segment with box prompt
   */
  async segmentWithBox(
    imageUrl: string,
    box: Sam3BoxPrompt,
    options?: Partial<Omit<Sam3Input, "image_url" | "box_prompts">>
  ): Promise<Sam3Output> {
    return this.segmentImage({
      image_url: imageUrl,
      box_prompts: [box],
      ...options,
    });
  }

  /**
   * Check if client is configured
   */
  async isAvailable(): Promise<boolean> {
    await this.initializeApiKey();
    return !!this.apiKey;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const sam3Client = new Sam3Client();

// Export convenience functions
export async function segmentImage(
  input: Sam3Input,
  onProgress?: Sam3ProgressCallback
): Promise<Sam3Output> {
  return sam3Client.segmentImage(input, onProgress);
}

export async function segmentWithText(
  imageUrl: string,
  textPrompt: string,
  options?: Partial<Omit<Sam3Input, "image_url" | "text_prompt">>
): Promise<Sam3Output> {
  return sam3Client.segmentWithText(imageUrl, textPrompt, options);
}

export async function segmentWithPoints(
  imageUrl: string,
  points: Sam3PointPrompt[],
  options?: Partial<Omit<Sam3Input, "image_url" | "prompts">>
): Promise<Sam3Output> {
  return sam3Client.segmentWithPoints(imageUrl, points, options);
}

export async function segmentWithBox(
  imageUrl: string,
  box: Sam3BoxPrompt,
  options?: Partial<Omit<Sam3Input, "image_url" | "box_prompts">>
): Promise<Sam3Output> {
  return sam3Client.segmentWithBox(imageUrl, box, options);
}
