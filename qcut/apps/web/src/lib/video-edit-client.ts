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

import { fal } from "@fal-ai/client";
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
        const keys = await window.electronAPI.apiKeys.get();
        if (keys?.falApiKey) {
          this.apiKey = keys.falApiKey;
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
   * - Generates sound effects and background music for videos
   * - Works with 3-20 second videos
   * - Can enhance videos with ASMR mode
   *
   * Edge cases:
   * - Videos must be 3-20 seconds
   * - Max 200 characters for prompts
   */
  async generateKlingAudio(params: KlingVideoToAudioParams): Promise<VideoEditResult> {
    await this.ensureInitialized();

    console.log("=== KLING VIDEO TO AUDIO DEBUG START ===");
    console.log("1. Input params received:", params);
    console.log("2. Video URL type:", typeof params.video_url);
    console.log("3. Video URL length:", params.video_url?.length);
    console.log("4. Video URL preview:", params.video_url?.substring(0, 100) + "...");

    debugLog("Generating audio with Kling:", {
      hasVideo: !!params.video_url,
      soundEffect: params.sound_effect_prompt,
      bgMusic: params.background_music_prompt,
      asmrMode: params.asmr_mode,
    });

    try {
      const model = VIDEO_EDIT_MODELS.find(m => m.id === "kling_video_to_audio");
      if (!model) throw new Error("Model configuration not found");

      // Build the input payload
      const inputPayload: any = {
        video_url: params.video_url,
      };

      // Add optional parameters only if they have values
      if (params.sound_effect_prompt && params.sound_effect_prompt.trim()) {
        inputPayload.sound_effect_prompt = params.sound_effect_prompt;
      }
      if (params.background_music_prompt && params.background_music_prompt.trim()) {
        inputPayload.background_music_prompt = params.background_music_prompt;
      }
      if (params.asmr_mode !== undefined) {
        inputPayload.asmr_mode = params.asmr_mode;
      }

      console.log("5. Final payload being sent to FAL:", JSON.stringify(inputPayload, null, 2));
      console.log("6. Endpoint:", model.endpoints.process);
      console.log("7. FAL initialized?", this.initialized);
      console.log("8. API Key available?", !!this.apiKey);

      // Call FAL API
      const result = await fal.subscribe(model.endpoints.process, {
        input: inputPayload,
        logs: true,
        onQueueUpdate: (update) => {
          console.log("9. Queue update received:", update);
          debugLog("Kling queue update:", update);
        },
      }) as any;

      // Parse response
      const videoUrl = result.video_url || result.video?.url;
      const audioUrl = result.audio_url || result.audio?.url;

      if (!videoUrl) {
        throw new Error("No video URL in response");
      }

      console.log("10. Result received:", result);
      console.log("=== KLING VIDEO TO AUDIO DEBUG END ===");

      return {
        modelId: "kling_video_to_audio",
        jobId: result.request_id || `kling-${Date.now()}`,
        videoUrl,
        audioUrl,
        duration: result.video?.duration,
      };
    } catch (error: any) {
      console.error("=== KLING ERROR DEBUG ===");
      console.error("Error type:", error?.constructor?.name);
      console.error("Error message:", error?.message);
      console.error("Error status:", error?.status);
      console.error("Error statusText:", error?.statusText);
      console.error("Error body:", error?.body);
      console.error("Full error object:", error);
      console.error("Error response:", error?.response);
      if (error?.response) {
        try {
          const responseText = await error.response.text();
          console.error("Response text:", responseText);
        } catch (e) {
          console.error("Could not read response text");
        }
      }
      console.error("=== END ERROR DEBUG ===");

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
   *
   * NOTE: Currently disabled as fal.subscribe handles polling internally.
   * The onQueueUpdate callback in subscribe provides real-time status updates.
   */
  // async getJobStatus(jobId: string): Promise<FalStatusResponse> {
  //   await this.ensureInitialized();
  //   try {
  //     // fal.status may not be available in current client version
  //     // Use fal.subscribe with request_id instead
  //     throw new Error("Method not implemented - use fal.subscribe instead");
  //   } catch (error) {
  //     debugError("Failed to get job status:", error);
  //     throw new Error(this.handleApiError(error));
  //   }
  // }

  /**
   * Cancel job
   * WHY: Allow users to cancel long-running operations
   *
   * NOTE: Currently disabled as fal.subscribe handles the entire lifecycle.
   * To cancel, the component should abort the subscribe promise.
   */
  // async cancelJob(jobId: string): Promise<void> {
  //   await this.ensureInitialized();
  //   try {
  //     // fal.cancel may not be available in current client version
  //     throw new Error("Method not implemented - abort the subscribe promise instead");
  //   } catch (error) {
  //     debugError("Failed to cancel job:", error);
  //     // Don't throw - cancellation errors are non-critical
  //   }
  // }
}

// Export singleton instance
export const videoEditClient = new VideoEditClient();

// Export types for convenience
export type { VideoEditClient };
