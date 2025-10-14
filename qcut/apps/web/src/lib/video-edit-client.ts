/**
 * Video Edit FAL AI Client
 *
 * WHY this client:
 * - Centralized FAL API integration for video edit models
 * - Handles authentication, polling, and error recovery
 * - Follows pattern from ai-video-client.ts
 *
 * Performance: Direct client-to-FAL reduces latency by ~500ms vs backend proxy
 */

import * as fal from "@fal-ai/client";
import { debugLog, debugError } from "@/lib/debug-config";
import type {
  KlingVideoToAudioParams,
  MMAudioV2Params,
  TopazUpscaleParams,
  VideoEditResult,
} from "@/components/editor/media-panel/views/video-edit-types";
import { VIDEO_EDIT_MODELS } from "@/components/editor/media-panel/views/video-edit-constants";

/**
 * FAL API Response Types
 */
interface FalQueueResponse {
  request_id: string;
  status_url?: string;
}

interface FalStatusResponse {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  progress?: number;
  logs?: string[];
  error?: string;
  // Result fields when completed
  video_url?: string;
  audio_url?: string;
  video?: {
    url: string;
    duration?: number;
    width?: number;
    height?: number;
  };
}

interface FalDirectResponse {
  video_url?: string;
  audio_url?: string;
  video?: {
    url: string;
    duration?: number;
  };
}

/**
 * Video Edit Client Class
 * Singleton pattern for consistent FAL configuration
 */
class VideoEditClient {
  private initialized = false;
  private apiKey: string | null = null;

  constructor() {
    this.initializeFalClient();
  }

  /**
   * Initialize FAL client with API key
   * WHY: FAL requires authentication for all requests
   * Edge case: API key might be loaded async from Electron
   */
  private async initializeFalClient() {
    try {
      // Try environment variable first
      this.apiKey = import.meta.env.VITE_FAL_API_KEY || null;

      // Try Electron API if available
      if (!this.apiKey && window.electronAPI?.apiKeys) {
        const apiKeyData = await window.electronAPI.apiKeys.get("fal");
        if (apiKeyData?.value) {
          this.apiKey = apiKeyData.value;
        }
      }

      if (this.apiKey) {
        fal.config({
          credentials: this.apiKey,
        });
        this.initialized = true;
        debugLog("Video Edit Client: FAL API initialized");
      } else {
        debugError("Video Edit Client: No FAL API key found");
      }
    } catch (error) {
      debugError("Video Edit Client: Failed to initialize", error);
    }
  }

  /**
   * Ensure client is ready
   * WHY: API key might load async, need to wait
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Retry initialization
    await this.initializeFalClient();

    if (!this.initialized) {
      throw new Error("FAL AI API key not configured");
    }
  }

  /**
   * Handle FAL API errors
   * WHY: Consistent error messages across all models
   */
  private handleApiError(error: any): string {
    if (error?.status === 429) {
      return "Rate limit exceeded. Please wait a moment and try again.";
    }
    if (error?.status === 402) {
      return "Insufficient credits. Please check your FAL account.";
    }
    if (error?.status === 413) {
      return "File too large. Please use a smaller video.";
    }
    if (error?.message) {
      return error.message;
    }
    return "An unexpected error occurred. Please try again.";
  }

  /**
   * Generate audio from video using Kling
   *
   * WHY this model:
   * - Generates realistic sound effects from silent video
   * - Useful for AI-generated videos that lack audio
   *
   * Edge cases:
   * - ASMR mode ignored for videos >10 seconds
   * - Videos must be 3-20 seconds
   */
  async generateKlingAudio(params: KlingVideoToAudioParams): Promise<VideoEditResult> {
    await this.ensureInitialized();

    debugLog("Generating Kling audio:", {
      hasVideo: !!params.video_url,
      asmrMode: params.asmr_mode,
    });

    try {
      const model = VIDEO_EDIT_MODELS.find(m => m.id === "kling_video_to_audio");
      if (!model) throw new Error("Model configuration not found");

      // Call FAL API
      const result = await fal.subscribe(model.endpoints.process, {
        input: {
          video_url: params.video_url,
          sound_effect_prompt: params.sound_effect_prompt,
          background_music_prompt: params.background_music_prompt,
          asmr_mode: params.asmr_mode || false,
        },
        logs: true,
        onQueueUpdate: (update) => {
          debugLog("Kling queue update:", update);
        },
      }) as any;

      // Parse response
      const videoUrl = result.video_url || result.video?.url;
      const audioUrl = result.audio_url || result.audio?.url;

      if (!videoUrl) {
        throw new Error("No video URL in response");
      }

      return {
        modelId: "kling_video_to_audio",
        jobId: result.request_id || `kling-${Date.now()}`,
        videoUrl,
        audioUrl,
        duration: result.video?.duration,
      };
    } catch (error) {
      debugError("Kling audio generation failed:", error);
      throw new Error(this.handleApiError(error));
    }
  }

  /**
   * Generate synchronized audio using MMAudio V2
   *
   * WHY this model:
   * - Creates audio that matches video content
   * - Text prompt control over style/mood
   *
   * Business logic: $0.001 per second of output
   * Performance: num_steps linearly affects processing time
   */
  async generateMMAudio(params: MMAudioV2Params): Promise<VideoEditResult> {
    await this.ensureInitialized();

    debugLog("Generating MMAudio:", {
      hasVideo: !!params.video_url,
      prompt: params.prompt?.substring(0, 50),
      numSteps: params.num_steps,
    });

    try {
      const model = VIDEO_EDIT_MODELS.find(m => m.id === "mmaudio_v2");
      if (!model) throw new Error("Model configuration not found");

      // Call FAL API
      const result = await fal.subscribe(model.endpoints.process, {
        input: {
          video_url: params.video_url,
          prompt: params.prompt,
          negative_prompt: params.negative_prompt,
          seed: params.seed,
          num_steps: params.num_steps || 25,
          duration: params.duration,
          cfg_strength: params.cfg_strength || 4.5,
          mask_away_clip: params.mask_away_clip || false,
        },
        logs: true,
        onQueueUpdate: (update) => {
          debugLog("MMAudio queue update:", update);
        },
      }) as any;

      // Parse response
      const videoUrl = result.video_url || result.video?.url;
      const audioUrl = result.audio_url || result.audio?.url;

      if (!videoUrl) {
        throw new Error("No video URL in response");
      }

      // Calculate cost
      const duration = result.video?.duration || params.duration || 10;
      const cost = duration * 0.001;  // $0.001 per second

      return {
        modelId: "mmaudio_v2",
        jobId: result.request_id || `mmaudio-${Date.now()}`,
        videoUrl,
        audioUrl,
        duration,
        cost,
      };
    } catch (error) {
      debugError("MMAudio generation failed:", error);
      throw new Error(this.handleApiError(error));
    }
  }

  /**
   * Upscale video using Topaz
   *
   * WHY this model:
   * - Professional quality upscaling up to 8x
   * - Frame interpolation for smoother playback
   *
   * Edge cases:
   * - 8x upscale may fail for 720p+ sources (8K limit)
   * - Processing time increases exponentially with factor
   */
  async upscaleTopaz(params: TopazUpscaleParams): Promise<VideoEditResult> {
    await this.ensureInitialized();

    debugLog("Upscaling with Topaz:", {
      hasVideo: !!params.video_url,
      factor: params.upscale_factor,
      targetFps: params.target_fps,
    });

    try {
      const model = VIDEO_EDIT_MODELS.find(m => m.id === "topaz_upscale");
      if (!model) throw new Error("Model configuration not found");

      // Call FAL API
      const result = await fal.subscribe(model.endpoints.process, {
        input: {
          video_url: params.video_url,
          upscale_factor: params.upscale_factor || 2.0,
          target_fps: params.target_fps,
          H264_output: params.H264_output || false,
        },
        logs: true,
        onQueueUpdate: (update) => {
          debugLog("Topaz queue update:", update);
        },
      }) as any;

      // Parse response
      const videoUrl = result.video_url || result.video?.url;

      if (!videoUrl) {
        throw new Error("No video URL in response");
      }

      // Estimate cost based on upscale factor
      const factor = params.upscale_factor || 2.0;
      const cost = factor <= 2 ? 0.50 : factor <= 4 ? 2.00 : 5.00;

      return {
        modelId: "topaz_upscale",
        jobId: result.request_id || `topaz-${Date.now()}`,
        videoUrl,
        duration: result.video?.duration,
        fileSize: result.video?.size,
        cost,
      };
    } catch (error) {
      debugError("Topaz upscale failed:", error);
      throw new Error(this.handleApiError(error));
    }
  }

  /**
   * Get job status (for manual polling if needed)
   * WHY: Some integrations may need custom polling logic
   */
  async getJobStatus(jobId: string): Promise<FalStatusResponse> {
    await this.ensureInitialized();

    try {
      const result = await fal.status(jobId) as any;
      return result;
    } catch (error) {
      debugError("Failed to get job status:", error);
      throw new Error(this.handleApiError(error));
    }
  }

  /**
   * Cancel job
   * WHY: Allow users to cancel long-running operations
   */
  async cancelJob(jobId: string): Promise<void> {
    await this.ensureInitialized();

    try {
      await fal.cancel(jobId);
      debugLog(`Cancelled job: ${jobId}`);
    } catch (error) {
      debugError("Failed to cancel job:", error);
      // Don't throw - cancellation errors are non-critical
    }
  }
}

// Export singleton instance
export const videoEditClient = new VideoEditClient();

// Export types for convenience
export type { VideoEditClient };
