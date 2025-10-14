/**
 * Video Edit Processing Hook
 *
 * WHY this hook:
 * - Separates business logic from UI components
 * - Manages complex async state transitions
 * - Reusable across all three video edit tabs
 *
 * Pattern follows use-ai-generation.ts for consistency
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useAsyncMediaStoreActions } from "@/hooks/use-async-media-store";
import { debugLog, debugError } from "@/lib/debug-config";
import type {
  VideoEditTab,
  VideoEditResult,
  VideoEditProcessingState,
  UseVideoEditProcessingProps,
  KlingVideoToAudioParams,
  MMAudioV2Params,
  TopazUpscaleParams,
} from "./video-edit-types";
import {
  VIDEO_EDIT_ERROR_MESSAGES,
  VIDEO_EDIT_STATUS_MESSAGES,
  VIDEO_EDIT_PROCESSING_CONSTANTS,
  VIDEO_EDIT_HELPERS,
} from "./video-edit-constants";

/**
 * Main processing hook for video edit features
 *
 * WHY this structure:
 * - Unified interface for all three models
 * - Consistent error handling and progress tracking
 * - Automatic media store integration
 */
export function useVideoEditProcessing(props: UseVideoEditProcessingProps) {
  const {
    sourceVideo,
    activeTab,
    activeProject,
    onSuccess,
    onError,
    onProgress,
  } = props;

  // Core state
  const [state, setState] = useState<VideoEditProcessingState>({
    isProcessing: false,
    progress: 0,
    statusMessage: "",
    elapsedTime: 0,
    estimatedTime: undefined,
    currentStage: "complete",
    result: null,
    error: null,
  });

  // Media store integration
  const {
    addMediaItem,
    loading: mediaStoreLoading,
    error: mediaStoreError,
  } = useAsyncMediaStoreActions();

  // Polling management
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  const processingStartTime = useRef<number | null>(null);

  // Elapsed time tracking
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (state.isProcessing && processingStartTime.current) {
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - processingStartTime.current!) / 1000);
        setState((prev) => ({ ...prev, elapsedTime: elapsed }));
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [state.isProcessing]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, []);

  // Progress callback
  useEffect(() => {
    if (onProgress) {
      onProgress(state.progress, state.statusMessage);
    }
  }, [state.progress, state.statusMessage, onProgress]);

  /**
   * Convert video file to data URL
   * WHY: FAL AI accepts base64 data URLs
   * Performance: Shows encoding progress for large files
   */
  const encodeVideoToDataURL = useCallback(async (file: File): Promise<string> => {
    setState((prev) => ({
      ...prev,
      currentStage: "uploading",
      statusMessage: VIDEO_EDIT_STATUS_MESSAGES.ENCODING,
      progress: 5,
    }));

    try {
      const dataUrl = await VIDEO_EDIT_HELPERS.fileToDataURL(file);

      setState((prev) => ({
        ...prev,
        progress: 10,
      }));

      return dataUrl;
    } catch (error) {
      throw new Error("Failed to encode video file");
    }
  }, []);

  /**
   * Poll job status
   * WHY: FAL AI uses queue system, must poll for completion
   * Edge case: Some models return video_url immediately (skip polling)
   */
  const pollJobStatus = useCallback(
    async (jobId: string, modelId: string): Promise<VideoEditResult> => {
      return new Promise((resolve, reject) => {
        let attempts = 0;

        const poll = async () => {
          try {
            attempts++;

            // Check max attempts
            if (attempts > VIDEO_EDIT_PROCESSING_CONSTANTS.MAX_POLL_ATTEMPTS) {
              clearInterval(pollingInterval.current!);
              reject(new Error("Processing timeout"));
              return;
            }

            // TODO: Call actual status endpoint
            // const status = await videoEditClient.getStatus(jobId);

            // Mock status for skeleton
            const mockProgress = Math.min(10 + attempts * 5, 90);
            setState((prev) => ({
              ...prev,
              progress: mockProgress,
              currentStage: "processing",
              statusMessage: `${VIDEO_EDIT_STATUS_MESSAGES.PROCESSING} ${mockProgress}%`,
            }));

            // Mock completion after 5 attempts
            if (attempts >= 5) {
              clearInterval(pollingInterval.current!);

              const result: VideoEditResult = {
                modelId,
                jobId,
                videoUrl: "https://example.com/processed-video.mp4",
                duration: 10,
                fileSize: 5 * 1024 * 1024,
              };

              resolve(result);
            }
          } catch (error) {
            clearInterval(pollingInterval.current!);
            reject(error);
          }
        };

        // Start polling
        poll();
        pollingInterval.current = setInterval(
          poll,
          VIDEO_EDIT_PROCESSING_CONSTANTS.POLLING_INTERVAL_MS
        );
      });
    },
    []
  );

  /**
   * Add result to media store
   * WHY: Automatically adds processed video to timeline
   * Edge case: activeProject might be null
   */
  const addToMediaStore = useCallback(
    async (result: VideoEditResult) => {
      if (!activeProject || !addMediaItem || !result.videoUrl) {
        debugLog("Cannot add to media store: missing requirements");
        return;
      }

      try {
        setState((prev) => ({
          ...prev,
          currentStage: "downloading",
          statusMessage: VIDEO_EDIT_STATUS_MESSAGES.DOWNLOADING,
          progress: 95,
        }));

        // Download video
        const response = await fetch(result.videoUrl);
        if (!response.ok) {
          throw new Error("Failed to download processed video");
        }

        const blob = await response.blob();
        const filename = `video-edit-${result.modelId}-${Date.now()}.mp4`;
        const file = new File([blob], filename, { type: "video/mp4" });

        // Add to media store
        const mediaItem = {
          name: `Edited: ${sourceVideo?.name || "video"}`,
          type: "video" as const,
          file,
          url: result.videoUrl,
          duration: result.duration || 10,
          width: 1920,
          height: 1080,
        };

        const newItemId = await addMediaItem(activeProject.id, mediaItem);
        debugLog(`Added processed video to media store: ${newItemId}`);
      } catch (error) {
        debugError("Failed to add to media store:", error);
      }
    },
    [activeProject, addMediaItem, sourceVideo]
  );

  /**
   * Process Kling Video to Audio
   */
  const processKlingVideoToAudio = useCallback(
    async (params: Partial<KlingVideoToAudioParams>) => {
      if (!sourceVideo) {
        throw new Error(VIDEO_EDIT_ERROR_MESSAGES.NO_VIDEO);
      }

      debugLog("Processing Kling Video to Audio:", params);

      // Encode video
      const videoDataUrl = await encodeVideoToDataURL(sourceVideo);

      // TODO: Call actual API
      // const response = await videoEditClient.generateKlingAudio({
      //   video_url: videoDataUrl,
      //   ...params,
      // });

      // Mock response
      const jobId = `kling-${Date.now()}`;

      // Poll for completion
      const result = await pollJobStatus(jobId, "kling_video_to_audio");

      return result;
    },
    [sourceVideo, encodeVideoToDataURL, pollJobStatus]
  );

  /**
   * Process MMAudio V2
   */
  const processMMAudioV2 = useCallback(
    async (params: Partial<MMAudioV2Params>) => {
      if (!sourceVideo) {
        throw new Error(VIDEO_EDIT_ERROR_MESSAGES.NO_VIDEO);
      }

      if (!params.prompt) {
        throw new Error(VIDEO_EDIT_ERROR_MESSAGES.NO_PROMPT);
      }

      debugLog("Processing MMAudio V2:", params);

      // Encode video
      const videoDataUrl = await encodeVideoToDataURL(sourceVideo);

      // TODO: Call actual API
      // const response = await videoEditClient.generateMMAudio({
      //   video_url: videoDataUrl,
      //   ...params,
      // });

      // Mock response
      const jobId = `mmaudio-${Date.now()}`;

      // Poll for completion
      const result = await pollJobStatus(jobId, "mmaudio_v2");

      // Calculate cost
      if (result.duration) {
        result.cost = VIDEO_EDIT_HELPERS.calculateMMAudioCost(result.duration);
      }

      return result;
    },
    [sourceVideo, encodeVideoToDataURL, pollJobStatus]
  );

  /**
   * Process Topaz Upscale
   */
  const processTopazUpscale = useCallback(
    async (params: Partial<TopazUpscaleParams>) => {
      if (!sourceVideo) {
        throw new Error(VIDEO_EDIT_ERROR_MESSAGES.NO_VIDEO);
      }

      debugLog("Processing Topaz Upscale:", params);

      // Encode video
      const videoDataUrl = await encodeVideoToDataURL(sourceVideo);

      // TODO: Call actual API
      // const response = await videoEditClient.upscaleTopaz({
      //   video_url: videoDataUrl,
      //   ...params,
      // });

      // Mock response
      const jobId = `topaz-${Date.now()}`;

      // Estimate processing time based on upscale factor
      const factor = params.upscale_factor || 2.0;
      const estimatedSeconds = factor <= 2 ? 60 : factor <= 4 ? 180 : 600;
      setState((prev) => ({ ...prev, estimatedTime: estimatedSeconds }));

      // Poll for completion
      const result = await pollJobStatus(jobId, "topaz_upscale");

      // Estimate cost
      result.cost = VIDEO_EDIT_HELPERS.estimateTopazCost(factor);

      return result;
    },
    [sourceVideo, encodeVideoToDataURL, pollJobStatus]
  );

  /**
   * Main process function
   * WHY: Unified entry point for all processing
   * Handles model-specific logic and error handling
   */
  const handleProcess = useCallback(
    async (params: Record<string, any>) => {
      try {
        // Reset state
        setState({
          isProcessing: true,
          progress: 0,
          statusMessage: VIDEO_EDIT_STATUS_MESSAGES.UPLOADING,
          elapsedTime: 0,
          estimatedTime: undefined,
          currentStage: "uploading",
          result: null,
          error: null,
        });

        processingStartTime.current = Date.now();

        let result: VideoEditResult;

        // Route to appropriate processor
        switch (activeTab) {
          case "audio-gen":
            result = await processKlingVideoToAudio(params);
            break;
          case "audio-sync":
            result = await processMMAudioV2(params);
            break;
          case "upscale":
            result = await processTopazUpscale(params);
            break;
          default:
            throw new Error("Invalid tab selected");
        }

        // Add to media store
        await addToMediaStore(result);

        // Update state
        setState((prev) => ({
          ...prev,
          isProcessing: false,
          progress: 100,
          statusMessage: VIDEO_EDIT_STATUS_MESSAGES.COMPLETE,
          currentStage: "complete",
          result,
        }));

        // Notify parent
        if (onSuccess) {
          onSuccess(result);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Processing failed";

        setState((prev) => ({
          ...prev,
          isProcessing: false,
          progress: 0,
          statusMessage: VIDEO_EDIT_STATUS_MESSAGES.FAILED,
          currentStage: "failed",
          error: errorMessage,
        }));

        if (onError) {
          onError(errorMessage);
        }
      }
    },
    [
      activeTab,
      processKlingVideoToAudio,
      processMMAudioV2,
      processTopazUpscale,
      addToMediaStore,
      onSuccess,
      onError,
    ]
  );

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setState({
      isProcessing: false,
      progress: 0,
      statusMessage: "",
      elapsedTime: 0,
      estimatedTime: undefined,
      currentStage: "complete",
      result: null,
      error: null,
    });

    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
    }

    processingStartTime.current = null;
  }, []);

  return {
    // State
    ...state,

    // Actions
    handleProcess,
    reset,

    // Media store state
    mediaStoreLoading,
    mediaStoreError,

    // Computed
    canProcess: !state.isProcessing && sourceVideo !== null && !mediaStoreLoading,
  };
}
