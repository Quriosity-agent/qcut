/**
 * AI Generation Management Hook
 *
 * Extracted from ai.tsx as part of safe refactoring process.
 * Manages AI video generation, progress tracking, and API integration.
 *
 * @see ai-view-refactoring-guide.md for refactoring plan
 * @see ai-refactoring-subtasks.md for implementation tracking
 */

import { useState, useEffect, useCallback } from "react";
import {
  handleApiError,
  getGenerationStatus,
  ProgressCallback,
} from "@/lib/ai-video-client";
import { AIVideoOutputManager } from "@/lib/ai-video-output";
import { debugLogger } from "@/lib/debug-logger";
import { getMediaStoreUtils } from "@/stores/media-store-loader";
import { debugLog, debugError, debugWarn } from "@/lib/debug-config";
import { useAsyncMediaStoreActions } from "@/hooks/use-async-media-store";
import { falAIClient } from "@/lib/fal-ai-client";
import { validateReveEditImage } from "@/lib/image-validation";

import {
  integrateVideoToMediaStore,
  updateVideoWithLocalPaths,
  canIntegrateMedia,
  routeTextToVideoHandler,
  routeImageToVideoHandler,
  routeUpscaleHandler,
  routeAvatarHandler,
  VEO31_FRAME_MODELS as FRAME_MODELS,
  type TextToVideoSettings,
  type ImageToVideoSettings,
  type AvatarSettings,
  type UpscaleSettings,
  type ModelHandlerContext,
} from "./generation";
import {
  AI_MODELS,
  UI_CONSTANTS,
  PROGRESS_CONSTANTS,
  STATUS_MESSAGES,
  ERROR_MESSAGES,
  REVE_EDIT_MODEL,
} from "../constants/ai-constants";
import {
  T2V_MODEL_CAPABILITIES,
  type T2VModelCapabilities,
  type T2VModelId,
} from "../constants/text2video-models-config";
import type {
  GeneratedVideo,
  GeneratedVideoResult,
  AIGenerationState,
  UseAIGenerationProps,
  ProgressCallback as AIProgressCallback,
} from "../types/ai-types";

// Re-export frame models constant for local use
const VEO31_FRAME_MODELS = FRAME_MODELS;

function getSafeDuration(
  requestedDuration: number,
  capabilities?: T2VModelCapabilities
): number | undefined {
  if (!capabilities?.supportsDuration) return;

  const allowedDurations = capabilities.supportedDurations;
  const fallbackDuration =
    capabilities.defaultDuration ??
    (allowedDurations && allowedDurations.length > 0
      ? allowedDurations[0]
      : undefined);

  if (!allowedDurations || allowedDurations.length === 0) {
    return requestedDuration;
  }

  if (allowedDurations.includes(requestedDuration)) {
    return requestedDuration;
  }

  return fallbackDuration ?? allowedDurations[0];
}

/**
 * Custom hook for managing AI video generation
 * Handles generation logic, progress tracking, polling, and API integration
 */
export function useAIGeneration(props: UseAIGenerationProps) {
  const {
    prompt,
    selectedModels,
    selectedImage,
    activeTab,
    activeProject,
    onProgress,
    onError,
    onComplete,
    onJobIdChange,
    onGeneratedVideoChange,
    // Avatar-specific props
    avatarImage,
    audioFile,
    sourceVideo,
    referenceImages,
    hailuoT2VDuration = 6,
    t2vAspectRatio = "16:9",
    t2vResolution = "1080p",
    t2vDuration = 4,
    t2vNegativePrompt = "low resolution, error, worst quality, low quality, defects",
    t2vPromptExpansion = false,
    t2vSeed = -1,
    t2vSafetyChecker = false,
    viduQ2Duration = 4,
    viduQ2Resolution = "720p",
    viduQ2MovementAmplitude = "auto",
    viduQ2EnableBGM = false,
    ltxv2Duration = 6,
    ltxv2Resolution = "1080p",
    ltxv2FPS = 25,
    ltxv2GenerateAudio = true,
    ltxv2FastDuration = 6,
    ltxv2FastResolution = "1080p",
    ltxv2FastFPS = 25,
    ltxv2FastGenerateAudio = true,
    ltxv2I2VDuration = 6,
    ltxv2I2VResolution = "1080p",
    ltxv2I2VFPS = 25,
    ltxv2I2VGenerateAudio = true,
    ltxv2ImageDuration = 6,
    ltxv2ImageResolution = "1080p",
    ltxv2ImageFPS = 25,
    ltxv2ImageGenerateAudio = true,
    seedanceDuration = 5,
    seedanceResolution = "1080p",
    seedanceAspectRatio = "16:9",
    seedanceCameraFixed = false,
    seedanceEndFrameUrl,
    seedanceEndFrameFile = null,
    imageSeed,
    klingDuration = 5,
    klingCfgScale = 0.5,
    klingAspectRatio = "16:9",
    klingEnhancePrompt = true,
    klingNegativePrompt,
    kling26Duration = 5,
    kling26CfgScale = 0.5,
    kling26AspectRatio = "16:9",
    kling26GenerateAudio = true,
    kling26NegativePrompt,
    wan25Duration = 5,
    wan25Resolution = "1080p",
    wan25AudioUrl,
    wan25AudioFile = null,
    wan25NegativePrompt,
    wan25EnablePromptExpansion = true,
    // WAN v2.6 T2V props
    wan26T2VDuration = 5,
    wan26T2VResolution = "1080p",
    wan26T2VAspectRatio = "16:9",
    wan26T2VNegativePrompt,
    wan26T2VEnablePromptExpansion = true,
    wan26T2VMultiShots = false,
    // WAN v2.6 I2V props
    wan26Duration = 5,
    wan26Resolution = "1080p",
    wan26AspectRatio = "16:9",
    wan26AudioUrl,
    wan26AudioFile = null,
    wan26NegativePrompt,
    wan26EnablePromptExpansion = true,
    // Kling Avatar v2 props
    klingAvatarV2Prompt = "",
    audioDuration = null,
    // Sync Lipsync React-1 props
    syncLipsyncEmotion = "neutral",
    syncLipsyncModelMode = "face",
    syncLipsyncSyncMode = "bounce",
    syncLipsyncTemperature = 0.5,
    videoDuration = null,
    // Veo 3.1 Extend-Video props
    extendVideoAspectRatio = "auto",
    extendVideoGenerateAudio = true,
    bytedanceTargetResolution = "1080p",
    bytedanceTargetFPS = "30fps",
    flashvsrUpscaleFactor = 4,
    flashvsrAcceleration = "regular",
    flashvsrQuality = 70,
    flashvsrColorFix = true,
    flashvsrPreserveAudio = false,
    flashvsrOutputFormat = "X264",
    flashvsrOutputQuality = "high",
    flashvsrOutputWriteMode = "balanced",
    flashvsrSeed,
    sourceVideoFile = null,
    sourceVideoUrl = "",
  } = props;

  // Core generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [estimatedTime, setEstimatedTime] = useState<number | undefined>();
  const [currentModelIndex, setCurrentModelIndex] = useState(0);
  const [progressLogs, setProgressLogs] = useState<string[]>([]);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(
    null
  );

  // Critical state variables identified in validation
  const [jobId, setJobId] = useState<string | null>(null);
  const [generatedVideo, setGeneratedVideo] = useState<GeneratedVideo | null>(
    null
  );
  const [generatedVideos, setGeneratedVideos] = useState<
    GeneratedVideoResult[]
  >([]);

  // Polling lifecycle management
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(
    null
  );

  // Service instance management
  const [outputManager] = useState(
    () => new AIVideoOutputManager("./ai-generated-videos")
  );

  // Sora 2 specific state
  const [duration, setDuration] = useState<4 | 8 | 12>(4);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [resolution, setResolution] = useState<"auto" | "720p" | "1080p">(
    "720p"
  );

  // Veo 3.1 specific state
  const [veo31Settings, setVeo31Settings] = useState<{
    resolution: "720p" | "1080p";
    duration: "4s" | "6s" | "8s";
    aspectRatio: "9:16" | "16:9" | "1:1" | "auto";
    generateAudio: boolean;
    enhancePrompt: boolean;
    autoFix: boolean;
  }>({
    resolution: "720p",
    duration: "8s",
    aspectRatio: "16:9",
    generateAudio: true,
    enhancePrompt: true,
    autoFix: true,
  });

  // Veo 3.1 frame state (for frame-to-video model)
  const [firstFrame, setFirstFrame] = useState<File | null>(null);
  const [lastFrame, setLastFrame] = useState<File | null>(null);

  // Reve Edit state
  const [uploadedImageForEdit, setUploadedImageForEdit] = useState<File | null>(
    null
  );
  const [uploadedImagePreview, setUploadedImagePreview] = useState<
    string | null
  >(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);

  // Sora 2 detection flags
  const isSora2Selected = selectedModels.some((id) => id.startsWith("sora2_"));
  const hasSora2Pro =
    selectedModels.includes("sora2_text_to_video_pro") ||
    selectedModels.includes("sora2_image_to_video_pro");

  // Veo 3.1 detection flags
  const isVeo31Selected = selectedModels.some((id) => id.startsWith("veo31_"));
  const hasVeo31FrameToVideo = selectedModels.some((id) =>
    VEO31_FRAME_MODELS.has(id)
  );

  // Store hooks
  const {
    addMediaItem,
    loading: mediaStoreLoading,
    error: mediaStoreError,
  } = useAsyncMediaStoreActions();

  // Client-side elapsed time timer
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isGenerating && generationStartTime) {
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - generationStartTime) / 1000);
        setElapsedTime(elapsed);
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGenerating, generationStartTime]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  // Notify parent of state changes
  useEffect(() => {
    if (onJobIdChange) {
      onJobIdChange(jobId);
    }
  }, [jobId, onJobIdChange]);

  useEffect(() => {
    if (onGeneratedVideoChange) {
      onGeneratedVideoChange(generatedVideo);
    }
  }, [generatedVideo, onGeneratedVideoChange]);

  useEffect(() => {
    if (onProgress) {
      // Derive status from generation state
      let status: "queued" | "processing" | "completed" | "failed" =
        "processing";
      if (generationProgress === 100) {
        status = "completed";
      } else if (generationProgress === 0 && !isGenerating) {
        status =
          statusMessage.toLowerCase().includes("error") ||
          statusMessage.toLowerCase().includes("failed")
            ? "failed"
            : "queued";
      }

      onProgress({
        status,
        progress: generationProgress,
        message: statusMessage,
        elapsedTime,
      });
    }
  }, [
    generationProgress,
    statusMessage,
    elapsedTime,
    isGenerating,
    onProgress,
  ]);

  // Helper function to download video to memory
  const downloadVideoToMemory = useCallback(
    async (videoUrl: string): Promise<Uint8Array> => {
      debugLog("📥 Starting video download from:", videoUrl);

      const response = await fetch(videoUrl);
      if (!response.ok) {
        throw new Error(
          `Failed to download video: ${response.status} ${response.statusText}`
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const chunks: Uint8Array[] = [];
      let receivedLength = 0;

      // Read the stream
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        if (value) {
          chunks.push(value);
          receivedLength += value.length;
        }
      }

      // Concatenate chunks into single Uint8Array
      const result = new Uint8Array(receivedLength);
      let position = 0;

      for (const chunk of chunks) {
        result.set(chunk, position);
        position += chunk.length;
      }

      debugLog(`📥 Download complete: ${result.length} bytes`);
      return result;
    },
    []
  );

  // Helper function to upload image to FAL and get URL (for Veo 3.1)
  const uploadImageToFal = useCallback(async (file: File): Promise<string> => {
    debugLog("📤 Uploading image to FAL:", file.name);

    try {
      const url = await falAIClient.uploadImageToFal(file);
      debugLog(`📤 Upload complete: ${url}`);
      return url;
    } catch (error) {
      debugError("❌ Failed to upload image to FAL", error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }, []);

  // Helper function to upload audio for WAN 2.5 background music support
  const uploadAudioToFal = useCallback(async (file: File): Promise<string> => {
    debugLog("?? Uploading audio to FAL:", file.name);

    try {
      const url = await falAIClient.uploadAudioToFal(file);
      debugLog("?? Audio upload complete:", url);
      return url;
    } catch (error) {
      debugError("? Failed to upload audio to FAL", error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }, []); // Status polling function
  const startStatusPolling = useCallback(
    (jobId: string): Promise<void> => {
      let hasResolved = false;
      const resolveOnce = (resolve: () => void) => {
        if (!hasResolved) {
          hasResolved = true;
          resolve();
        }
      };

      // Clear any existing polling interval before starting a new one
      setPollingInterval((current) => {
        if (current) clearInterval(current);
        return null;
      });

      setGenerationProgress(PROGRESS_CONSTANTS.POLLING_START_PROGRESS);
      setStatusMessage(STATUS_MESSAGES.STARTING);

      return new Promise<void>((resolve) => {
        const pollStatus = async () => {
          try {
            const status = await getGenerationStatus(jobId);

            if (status.progress) {
              setGenerationProgress(status.progress);
            }

            if (status.status === "processing") {
              setStatusMessage(
                `${STATUS_MESSAGES.PROCESSING} ${status.progress || 0}%`
              );
            } else if (
              status.status === "completed" &&
              (status.videoUrl ?? status.video_url)
            ) {
              // Clear polling (avoid stale closure)
              setPollingInterval((current) => {
                if (current) clearInterval(current);
                return null;
              });

              setGenerationProgress(PROGRESS_CONSTANTS.COMPLETE_PROGRESS);
              setStatusMessage(STATUS_MESSAGES.COMPLETE);

              const newVideo: GeneratedVideo = {
                jobId,
                videoUrl: status.videoUrl ?? status.video_url ?? "",
                videoPath: undefined,
                fileSize: undefined,
                duration: undefined,
                prompt: prompt.trim(),
                model: selectedModels[0] || "unknown",
              };

              setGeneratedVideo(newVideo);

              // Automatically add to media store
              if (activeProject) {
                try {
                  console.log(
                    "[AI Generation] Downloading generated video for media store...",
                    {
                      projectId: activeProject.id,
                      modelId: selectedModels[0] || "unknown",
                      videoUrl: newVideo.videoUrl,
                    }
                  );

                  const response = await fetch(newVideo.videoUrl);
                  const blob = await response.blob();
                  const file = new File(
                    [blob],
                    `generated-video-${newVideo.jobId.substring(0, 8)}.mp4`,
                    { type: "video/mp4" }
                  );

                  if (!addMediaItem) {
                    throw new Error("Media store not ready");
                  }

                  console.log(
                    "[AI Generation] Adding video to media store...",
                    {
                      projectId: activeProject.id,
                      name: `AI: ${newVideo.prompt.substring(0, 30)}...`,
                      duration: newVideo.duration || 5,
                      width: 1920,
                      height: 1080,
                      fileSize: file.size,
                    }
                  );

                  const newItemId = await addMediaItem(activeProject.id, {
                    name: `AI: ${newVideo.prompt.substring(0, 30)}...`,
                    type: "video",
                    file,
                    url: newVideo.videoUrl,
                    duration: newVideo.duration || 5,
                    width: 1920,
                    height: 1080,
                  });

                  console.log("[AI Generation] addMediaItem succeeded", {
                    mediaItemId: newItemId,
                    projectId: activeProject.id,
                  });

                  debugLogger.log(
                    "AIGeneration",
                    `Added AI video to media with ID: ${newItemId}`
                  );

                  debugLogger.log(
                    "AIGeneration",
                    "VIDEO_ADDED_TO_MEDIA_STORE",
                    {
                      videoUrl: newVideo.videoUrl,
                      projectId: activeProject.id,
                    }
                  );
                } catch (error) {
                  console.error("[AI Generation] addMediaItem failed", {
                    projectId: activeProject?.id,
                    modelId: selectedModels[0] || "unknown",
                    videoUrl: newVideo.videoUrl,
                    error:
                      error instanceof Error ? error.message : String(error),
                  });

                  debugLogger.log(
                    "AIGeneration",
                    "VIDEO_ADD_TO_MEDIA_STORE_FAILED",
                    {
                      error:
                        error instanceof Error
                          ? error.message
                          : "Unknown error",
                      projectId: activeProject.id,
                    }
                  );
                }
              }

              setIsGenerating(false);
              resolveOnce(resolve);
            } else if (status.status === "failed") {
              // Clear polling (avoid stale closure)
              setPollingInterval((current) => {
                if (current) clearInterval(current);
                return null;
              });

              const errorMessage =
                status.error || ERROR_MESSAGES.GENERATION_FAILED;
              onError?.(errorMessage);
              setIsGenerating(false);
              resolveOnce(resolve);
            }
          } catch (error) {
            debugLogger.log("AIGeneration", "STATUS_POLLING_ERROR", {
              error: error instanceof Error ? error.message : "Unknown error",
              jobId,
            });
            setGenerationProgress((prev) => Math.min(prev + 5, 90));
          }
        };

        // Poll immediately, then every interval
        pollStatus();
        const interval = setInterval(
          pollStatus,
          UI_CONSTANTS.POLLING_INTERVAL_MS
        );
        setPollingInterval(interval);
      });
    },
    [prompt, selectedModels, activeProject, addMediaItem, onError]
  );

  // Mock generation function for testing
  const handleMockGenerate = useCallback(async () => {
    if (activeTab === "text") {
      if (!prompt.trim() || selectedModels.length === 0) return;
    } else if (activeTab === "image") {
      if (selectedModels.length === 0) return;

      const hasFrameModel = selectedModels.some((id) =>
        VEO31_FRAME_MODELS.has(id)
      );
      const hasImageModel = selectedModels.some(
        (id) => !VEO31_FRAME_MODELS.has(id)
      );

      if (hasFrameModel && (!firstFrame || !lastFrame)) return;
      if (hasImageModel && !selectedImage) return;
    } else if (activeTab === "upscale") {
      if (selectedModels.length === 0) {
        console.log("? Validation failed - missing models for upscale tab");
        return;
      }

      if (!sourceVideoFile && !sourceVideoUrl) {
        console.log(
          "? Validation failed - video source required for upscaling"
        );
        return;
      }
    } else if (activeTab === "avatar") {
      if (!avatarImage || selectedModels.length === 0) return;
    }

    setIsGenerating(true);
    setJobId(null);
    setGeneratedVideos([]);

    // Start the client-side timer
    const startTime = Date.now();
    setGenerationStartTime(startTime);
    setElapsedTime(0);

    try {
      const mockGenerations: GeneratedVideoResult[] = [];

      for (let i = 0; i < selectedModels.length; i++) {
        console.log(
          "------------------------------------------------------------"
        );
        console.log(
          `Model ${i + 1}/${selectedModels.length} - processing:`,
          selectedModels[i]
        );
        console.log(
          "------------------------------------------------------------"
        );

        const modelId = selectedModels[i];
        const modelName = AI_MODELS.find((m) => m.id === modelId)?.name;
        const modelCapabilities =
          modelId in T2V_MODEL_CAPABILITIES
            ? T2V_MODEL_CAPABILITIES[modelId as T2VModelId]
            : undefined;

        const unifiedParams: Record<string, unknown> = {};
        if (modelCapabilities?.supportsAspectRatio && t2vAspectRatio) {
          unifiedParams.aspect_ratio = t2vAspectRatio;
        }
        if (modelCapabilities?.supportsResolution && t2vResolution) {
          unifiedParams.resolution = t2vResolution;
        }
        if (modelCapabilities?.supportsDuration && t2vDuration) {
          const safeDuration = getSafeDuration(t2vDuration, modelCapabilities);
          if (safeDuration !== undefined) {
            if (
              safeDuration !== t2vDuration &&
              modelCapabilities.supportedDurations?.length
            ) {
              debugLogger.log("AIGeneration", "T2V_DURATION_SANITIZED", {
                modelId,
                requestedDuration: t2vDuration,
                appliedDuration: safeDuration,
                allowedDurations: modelCapabilities.supportedDurations,
              });
            }
            unifiedParams.duration = safeDuration;
          }
        }
        const trimmedNegativePrompt = t2vNegativePrompt?.trim();
        if (
          modelCapabilities?.supportsNegativePrompt &&
          trimmedNegativePrompt
        ) {
          unifiedParams.negative_prompt = trimmedNegativePrompt;
        }
        if (modelCapabilities?.supportsPromptExpansion && t2vPromptExpansion) {
          unifiedParams.prompt_expansion = true;
        }
        if (
          modelCapabilities?.supportsSeed &&
          typeof t2vSeed === "number" &&
          t2vSeed !== -1
        ) {
          unifiedParams.seed = t2vSeed;
        }
        if (modelCapabilities?.supportsSafetyChecker) {
          unifiedParams.enable_safety_checker = t2vSafetyChecker;
        }

        setStatusMessage(
          `🧪 Mock generating with ${modelName} (${i + 1}/${selectedModels.length})`
        );

        // Simulate API delay
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const mockVideo: GeneratedVideo = {
          jobId: `mock-job-${Date.now()}-${i}`,
          videoUrl:
            "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          videoPath:
            "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          fileSize: 2_097_152,
          duration: 15,
          prompt: prompt.trim(),
          model: modelId,
        };

        mockGenerations.push({ modelId, video: mockVideo });

        debugLogger.log("AIGeneration", "MOCK_VIDEO_GENERATED", {
          modelName,
          mockJobId: mockVideo.jobId,
          modelId,
        });
      }

      setGeneratedVideos(mockGenerations);
      setStatusMessage(
        `🧪 Mock generated ${mockGenerations.length} videos successfully!`
      );
      onComplete?.(mockGenerations);
    } catch (error) {
      const errorMessage =
        "Mock generation error: " +
        (error instanceof Error ? error.message : "Unknown error");
      onError?.(errorMessage);
      debugLogger.log("AIGeneration", "MOCK_GENERATION_FAILED", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsGenerating(false);
    }
  }, [
    activeTab,
    prompt,
    selectedImage,
    avatarImage,
    selectedModels,
    onError,
    onComplete,
    firstFrame,
    lastFrame,
    sourceVideoFile,
    sourceVideoUrl,
    t2vAspectRatio,
    t2vResolution,
    t2vDuration,
    t2vNegativePrompt,
    t2vPromptExpansion,
    t2vSeed,
    t2vSafetyChecker,
  ]);

  // Main generation function
  const handleGenerate = useCallback(async () => {
    const startTimestamp = new Date().toISOString();
    console.log("step 3: handleGenerate invoked (AI video flow)");
    console.log("============================================================");
    console.log("=== handleGenerate CALLED ===");
    console.log("============================================================");
    console.log("Timestamp:", startTimestamp);
    console.log("Input parameters:");
    console.log("  - activeTab:", activeTab);
    console.log(
      "  - prompt:",
      prompt?.substring(0, 100) + (prompt && prompt.length > 100 ? "..." : "")
    );
    console.log("  - prompt length:", prompt?.length ?? 0);
    console.log("  - selectedModels:", selectedModels);
    console.log("  - hasSelectedImage:", !!selectedImage);
    console.log(
      "  - imageFile:",
      selectedImage
        ? (selectedImage as File).name
          ? `${(selectedImage as File).name} (${(selectedImage as File).size} bytes)`
          : "[image provided]"
        : "null"
    );
    console.log("  - activeProject:", activeProject?.id ?? "none");
    console.log("  - activeProject name:", activeProject?.name ?? "n/a");
    console.log(
      "  - addMediaItem available:",
      typeof addMediaItem === "function"
    );
    console.log("");

    let validationError: string | null = null;

    if (activeTab === "text") {
      if (!prompt.trim()) {
        validationError = "Missing prompt for text tab";
      } else if (selectedModels.length === 0) {
        validationError = "No models selected for text tab";
      }
    } else if (activeTab === "image") {
      if (selectedModels.length === 0) {
        validationError = "Missing models for image tab";
      } else {
        const hasFrameModel = selectedModels.some((id) =>
          VEO31_FRAME_MODELS.has(id)
        );
        const hasImageModel = selectedModels.some(
          (id) => !VEO31_FRAME_MODELS.has(id)
        );

        if (hasFrameModel && (!firstFrame || !lastFrame)) {
          validationError =
            "Frame-to-video models require first and last frames";
        }

        if (!validationError && hasImageModel && !selectedImage) {
          validationError = "Image-to-video models require an image";
        }
      }
    } else if (activeTab === "avatar") {
      if (selectedModels.length === 0) {
        validationError = "Missing models for avatar tab";
      } else {
        // Check model-specific requirements
        for (const modelId of selectedModels) {
          // V2V models require source video only
          if (
            (modelId === "wan_animate_replace" ||
              modelId === "kling_o1_v2v_reference" ||
              modelId === "kling_o1_v2v_edit") &&
            !sourceVideo
          ) {
            validationError = "Video-to-video model requires source video";
            break;
          }
          // Audio-based avatar models require avatar image + audio
          if (
            (modelId === "kling_avatar_pro" ||
              modelId === "kling_avatar_standard" ||
              modelId === "bytedance_omnihuman_v1_5") &&
            !audioFile
          ) {
            validationError = "Audio-based avatar model requires audio file";
            break;
          }
          if (
            (modelId === "kling_avatar_pro" ||
              modelId === "kling_avatar_standard" ||
              modelId === "bytedance_omnihuman_v1_5") &&
            !avatarImage
          ) {
            validationError = "Audio-based avatar model requires avatar image";
            break;
          }
          // Reference-to-video model requires at least one reference image
          if (modelId === "kling_o1_ref2video") {
            const hasReferenceImage = referenceImages?.some(
              (img) => img !== null
            );
            if (!hasReferenceImage) {
              validationError =
                "Kling O1 Reference-to-Video requires at least one reference image";
              break;
            }
          }
          // WAN Animate/Replace requires avatar image
          if (modelId === "wan_animate_replace" && !avatarImage) {
            validationError = "WAN model requires character image";
            break;
          }
        }
      }
    }

    if (validationError) {
      console.error("❌ Validation failed!");
      console.error("  - Reason:", validationError);
      console.error("  - Missing prompt:", !prompt);
      console.error("  - No models selected:", selectedModels.length === 0);
      console.error("  - No active project:", !activeProject);
      return;
    }

    console.log("✅ Validation passed, starting generation...");
    console.log("  - Models to process:", selectedModels.length);
    console.log("  - Active project:", !!activeProject);
    console.log("  - Media store available:", !!addMediaItem);
    setIsGenerating(true);
    setJobId(null);

    // Start the client-side timer
    const startTime = Date.now();
    setGenerationStartTime(startTime);
    setElapsedTime(0);

    // Reset any existing generated videos
    setGeneratedVideos([]);

    try {
      console.log("step 3a: pre-generation state check");
      console.log("   - activeProject:", !!activeProject, activeProject?.id);
      console.log(
        "   - addMediaItem available:",
        !!addMediaItem,
        typeof addMediaItem
      );
      console.log("   - mediaStoreLoading:", mediaStoreLoading);
      console.log("   - mediaStoreError:", mediaStoreError);

      const generations: GeneratedVideoResult[] = [];
      console.log(
        `\n📦 Starting generation for ${selectedModels.length} models`
      );

      // Sequential generation to avoid rate limits
      for (let i = 0; i < selectedModels.length; i++) {
        const modelId = selectedModels[i];
        const modelName = AI_MODELS.find((m) => m.id === modelId)?.name;
        const modelCapabilities =
          modelId in T2V_MODEL_CAPABILITIES
            ? T2V_MODEL_CAPABILITIES[modelId as T2VModelId]
            : undefined;

        const isSora2TextModel =
          activeTab === "text" && modelId.startsWith("sora2_");

        // Build unified params based on model capabilities
        const unifiedParams: Record<string, unknown> = {};
        if (
          modelCapabilities?.supportsAspectRatio &&
          t2vAspectRatio &&
          !isSora2TextModel
        ) {
          unifiedParams.aspect_ratio = t2vAspectRatio;
        }
        if (
          modelCapabilities?.supportsResolution &&
          t2vResolution &&
          !isSora2TextModel
        ) {
          unifiedParams.resolution = t2vResolution;
        }
        if (
          modelCapabilities?.supportsDuration &&
          t2vDuration &&
          !isSora2TextModel
        ) {
          const safeDuration = getSafeDuration(t2vDuration, modelCapabilities);
          if (safeDuration !== undefined) {
            if (
              safeDuration !== t2vDuration &&
              modelCapabilities.supportedDurations?.length
            ) {
              debugLogger.log("AIGeneration", "T2V_DURATION_SANITIZED", {
                modelId,
                requestedDuration: t2vDuration,
                appliedDuration: safeDuration,
                allowedDurations: modelCapabilities.supportedDurations,
              });
            }
            unifiedParams.duration = safeDuration;
          }
        }
        const trimmedNegativePrompt = t2vNegativePrompt?.trim();
        if (
          modelCapabilities?.supportsNegativePrompt &&
          trimmedNegativePrompt
        ) {
          unifiedParams.negative_prompt = trimmedNegativePrompt;
        }
        if (modelCapabilities?.supportsPromptExpansion && t2vPromptExpansion) {
          unifiedParams.prompt_expansion = true;
        }
        if (
          modelCapabilities?.supportsSeed &&
          typeof t2vSeed === "number" &&
          t2vSeed !== -1
        ) {
          unifiedParams.seed = t2vSeed;
        }
        if (modelCapabilities?.supportsSafetyChecker) {
          unifiedParams.enable_safety_checker = t2vSafetyChecker;
        }

        console.log(`step 4: sanitized params for ${modelId}`, {
          unifiedParams,
          requestedDuration: t2vDuration,
        });

        console.log(
          `\n🎬 [${i + 1}/${selectedModels.length}] Processing model: ${modelId} (${modelName})`
        );

        setStatusMessage(
          `Generating with ${modelName} (${i + 1}/${selectedModels.length})`
        );

        let response;
        setCurrentModelIndex(i);

        // Create progress callback for this model
        const progressCallback: ProgressCallback = (status) => {
          console.log(`  📊 Progress for ${modelId}:`, status);
          setGenerationProgress(status.progress || 0);
          setStatusMessage(status.message || `Generating with ${modelName}...`);

          // Add to progress logs
          if (status.message) {
            setProgressLogs((prev) => [...prev.slice(-4), status.message!]);
          }
        };

        console.log(
          `step 5: sending generation request for ${modelId} (${activeTab} tab)`,
          unifiedParams
        );

        // Build handler context
        const handlerCtx: ModelHandlerContext = {
          prompt: prompt.trim(),
          modelId,
          modelName: modelName || modelId,
          progressCallback,
        };

        // Route to appropriate handler based on tab
        let handlerResult;

        if (activeTab === "text") {
          console.log(`  📝 Processing text-to-video model ${modelId}...`);

          const t2vSettings: TextToVideoSettings = {
            veo31Settings,
            hailuoT2VDuration,
            ltxv2Duration,
            ltxv2Resolution,
            ltxv2FPS,
            ltxv2GenerateAudio,
            ltxv2FastDuration,
            ltxv2FastResolution,
            ltxv2FastFPS,
            ltxv2FastGenerateAudio,
            unifiedParams,
            duration,
            aspectRatio,
            resolution,
            // WAN v2.6 T2V settings
            wan26T2VDuration,
            wan26T2VResolution,
            wan26T2VAspectRatio,
            wan26T2VNegativePrompt: wan26T2VNegativePrompt ?? "",
            wan26T2VEnablePromptExpansion,
            wan26T2VMultiShots,
          };

          handlerResult = await routeTextToVideoHandler(
            handlerCtx,
            t2vSettings
          );
          response = handlerResult.response;
          console.log("  ✅ Text-to-video response:", response);
        } else if (activeTab === "image") {
          console.log(`  🖼️ Calling generateVideoFromImage for ${modelId}...`);

          const i2vSettings: ImageToVideoSettings = {
            selectedImage,
            firstFrame,
            lastFrame,
            veo31Settings,
            viduQ2Duration,
            viduQ2Resolution,
            viduQ2MovementAmplitude,
            viduQ2EnableBGM,
            ltxv2I2VDuration,
            ltxv2I2VResolution,
            ltxv2I2VFPS,
            ltxv2I2VGenerateAudio,
            ltxv2ImageDuration,
            ltxv2ImageResolution,
            ltxv2ImageFPS,
            ltxv2ImageGenerateAudio,
            seedanceDuration,
            seedanceResolution,
            seedanceAspectRatio,
            seedanceCameraFixed,
            seedanceEndFrameUrl: seedanceEndFrameUrl ?? null,
            seedanceEndFrameFile,
            klingDuration,
            klingCfgScale,
            klingAspectRatio,
            klingEnhancePrompt,
            klingNegativePrompt: klingNegativePrompt ?? "",
            kling26Duration,
            kling26GenerateAudio,
            kling26NegativePrompt: kling26NegativePrompt ?? "",
            wan25Duration,
            wan25Resolution,
            wan25AudioUrl: wan25AudioUrl ?? null,
            wan25AudioFile,
            wan25NegativePrompt: wan25NegativePrompt ?? "",
            wan25EnablePromptExpansion,
            // WAN v2.6 I2V settings
            wan26Duration,
            wan26Resolution,
            wan26AspectRatio,
            wan26AudioUrl: wan26AudioUrl ?? null,
            wan26AudioFile,
            wan26NegativePrompt: wan26NegativePrompt ?? "",
            wan26EnablePromptExpansion,
            imageSeed: imageSeed ?? null,
            duration,
            aspectRatio,
            resolution,
            uploadImageToFal,
            uploadAudioToFal,
          };

          handlerResult = await routeImageToVideoHandler(
            handlerCtx,
            i2vSettings
          );

          if (handlerResult.shouldSkip) {
            console.log(`  ⚠️ Skipping model - ${handlerResult.skipReason}`);
            continue;
          }

          response = handlerResult.response;
          console.log("  ✅ generateVideoFromImage returned:", response);
        } else if (activeTab === "upscale") {
          const upscaleSettings: UpscaleSettings = {
            sourceVideoFile,
            sourceVideoUrl: sourceVideoUrl || null,
            bytedanceTargetResolution,
            bytedanceTargetFPS,
            flashvsrUpscaleFactor: flashvsrUpscaleFactor ?? null,
            flashvsrAcceleration,
            flashvsrQuality,
            flashvsrColorFix,
            flashvsrPreserveAudio,
            flashvsrOutputFormat,
            flashvsrOutputQuality,
            flashvsrOutputWriteMode,
            flashvsrSeed: flashvsrSeed ?? null,
          };

          handlerResult = await routeUpscaleHandler(
            handlerCtx,
            upscaleSettings
          );

          if (handlerResult.shouldSkip) {
            console.log(`  ⚠️ Skipping model - ${handlerResult.skipReason}`);
            continue;
          }

          response = handlerResult.response;
        } else if (activeTab === "avatar") {
          const avatarSettings: AvatarSettings = {
            avatarImage: avatarImage ?? null,
            audioFile: audioFile ?? null,
            sourceVideo: sourceVideo ?? null,
            referenceImages: referenceImages ?? [],
            klingAvatarV2Prompt,
            audioDuration,
            uploadImageToFal,
            uploadAudioToFal,
            // Sync Lipsync React-1 settings
            syncLipsyncEmotion,
            syncLipsyncModelMode,
            syncLipsyncLipsyncMode: syncLipsyncSyncMode,
            syncLipsyncTemperature,
            videoDuration,
            // Veo 3.1 Extend-Video settings
            extendVideoAspectRatio,
            extendVideoGenerateAudio,
          };

          handlerResult = await routeAvatarHandler(handlerCtx, avatarSettings);

          if (handlerResult.shouldSkip) {
            console.log(`  ⚠️ Skipping model - ${handlerResult.skipReason}`);
            continue;
          }

          response = handlerResult.response;
        }

        console.log("step 5a: post-API response analysis");
        console.log("   - response received:", !!response);
        if (response) {
          console.log(
            "   - response.video_url:",
            !!response.video_url,
            response.video_url?.substring(0, 50) + "..."
          );
          console.log(
            "   - response.job_id:",
            !!response.job_id,
            response.job_id
          );
          console.log("   - response keys:", Object.keys(response));
          console.log("   - response.status:", response.status);
        } else {
          console.log("   - response is undefined/null");
        }

        console.log(`\n  🔍 Response analysis for ${modelId}:`);
        console.log("    - response exists:", !!response);
        console.log("    - response.job_id:", response?.job_id);
        console.log("    - response.video_url:", response?.video_url);
        console.log("    - response.status:", response?.status);
        console.log("    - Full response:", JSON.stringify(response, null, 2));

        if (response?.job_id) {
          console.log("🔍 FIX VERIFICATION: Processing job_id response");
          console.log("   - job_id exists:", !!response.job_id);
          console.log("   - video_url exists:", !!response.video_url);

          if (response?.video_url) {
            // 🎯 OPTION 1 FIX: Direct mode with job_id - video is ready immediately
            console.log("🎉 FIX SUCCESS: Direct mode with job_id detected!");
            console.log(
              "🎯 DIRECT MODE WITH JOB_ID - Video URL:",
              response.video_url
            );

            debugLogger.log("AIGeneration", "DIRECT_VIDEO_WITH_JOB_ID", {
              model: modelId,
              jobId: response.job_id,
              videoUrl: response.video_url,
            });

            const videoData = response.video_data as
              | { video?: { duration?: number } }
              | undefined;
            const newVideo: GeneratedVideo = {
              jobId: response.job_id,
              videoUrl: response.video_url,
              videoPath: undefined,
              fileSize: undefined,
              duration: videoData?.video?.duration,
              prompt: prompt.trim(),
              model: modelId,
            };

            // Add to generations array
            generations.push({ modelId, video: newVideo });
            console.log("📦 Added to generations array:", generations.length);

            // Media integration using extracted function
            const { canIntegrate: canDoIntegration, missing } =
              canIntegrateMedia(
                activeProject?.id,
                addMediaItem,
                response.video_url
              );
            console.log(
              "   - WILL EXECUTE MEDIA INTEGRATION:",
              canDoIntegration
            );
            if (!canDoIntegration) {
              console.log("   - missing for integration:", missing);
            }

            if (activeProject && addMediaItem && response.video_url) {
              const integrationResult = await integrateVideoToMediaStore({
                videoUrl: response.video_url,
                modelId,
                prompt: newVideo.prompt,
                projectId: activeProject.id,
                addMediaItem,
                duration: newVideo.duration || 5,
                sourceType:
                  activeTab === "text"
                    ? "text2video"
                    : activeTab === "image"
                      ? "image2video"
                      : activeTab,
                onError: (error) => {
                  setIsGenerating(false);
                  setGenerationProgress(0);
                  setStatusMessage(error);
                  onError(error);
                },
              });

              if (integrationResult.success) {
                // Update video with local paths
                Object.assign(
                  newVideo,
                  updateVideoWithLocalPaths(
                    newVideo,
                    integrationResult,
                    response.video_url
                  )
                );
              } else if (integrationResult.error) {
                // Critical error - abort generation
                return;
              }
            } else {
              console.warn("⚠️ Cannot add to media store:", missing);
            }
          } else {
            // Traditional polling mode: no video_url yet
            console.log("step 6: polling mode - deferring download");

            const newVideo: GeneratedVideo = {
              jobId: response.job_id,
              videoUrl: "", // Will be filled when polling completes
              videoPath: undefined,
              fileSize: undefined,
              duration: undefined,
              prompt: prompt.trim(),
              model: modelId,
            };

            // Add to generations array so results are properly tracked
            generations.push({ modelId, video: newVideo });

            // Start status polling for this job
            startStatusPolling(response.job_id);

            debugLogger.log("AIGeneration", "GENERATION_STARTED", {
              jobId: response.job_id,
              model: modelId,
              modelName,
            });
          }
        } else if (response?.video_url) {
          // Direct mode: video is ready immediately
          console.log(
            "🎯 DIRECT MODE TRIGGERED - Video URL:",
            response.video_url
          );
          debugLogger.log("AIGeneration", "DIRECT_VIDEO_READY", {
            model: modelId,
            videoUrl: response.video_url,
          });

          const newVideo: GeneratedVideo = {
            jobId: `direct-${Date.now()}`,
            videoUrl: response.video_url,
            videoPath: undefined,
            fileSize: undefined,
            duration: undefined,
            prompt: prompt.trim(),
            model: modelId,
          };

          // Add to generations array
          generations.push({ modelId, video: newVideo });
          console.log("📦 Added to generations array:", generations.length);

          // Media integration using extracted function
          const { canIntegrate: canDoIntegration, missing } = canIntegrateMedia(
            activeProject?.id,
            addMediaItem,
            response.video_url
          );
          console.log("   - WILL EXECUTE MEDIA INTEGRATION:", canDoIntegration);
          if (!canDoIntegration) {
            console.log("   - missing for integration:", missing);
          }

          if (activeProject && addMediaItem && response.video_url) {
            const integrationResult = await integrateVideoToMediaStore({
              videoUrl: response.video_url,
              modelId,
              prompt: newVideo.prompt,
              projectId: activeProject.id,
              addMediaItem,
              duration: newVideo.duration || 5,
              sourceType:
                activeTab === "text"
                  ? "text2video"
                  : activeTab === "image"
                    ? "image2video"
                    : activeTab,
              onError: (error) => {
                setIsGenerating(false);
                setGenerationProgress(0);
                setStatusMessage(error);
                onError(error);
              },
            });

            if (integrationResult.success) {
              // Update video with local paths
              Object.assign(
                newVideo,
                updateVideoWithLocalPaths(
                  newVideo,
                  integrationResult,
                  response.video_url
                )
              );
            } else if (integrationResult.error) {
              // Critical error - abort generation
              return;
            }
          } else {
            console.warn("⚠️ Cannot add to media store:", missing);
          }
        } else {
          console.warn(
            "⚠️ Response has neither job_id nor video_url:",
            response
          );
        }
      }

      console.log("\n✅✅✅ GENERATION LOOP COMPLETE ✅✅✅");
      console.log("  - Total generations created:", generations.length);
      console.log("  - Generations:", generations);

      setGeneratedVideos(generations);
      setStatusMessage(`Generated ${generations.length} videos successfully!`);

      console.log(
        "step 7: generation flow complete; updating UI and callbacks"
      );

      console.log(
        `📤 Calling onComplete callback with ${generations.length} videos`
      );
      onComplete?.(generations);
      console.log("✅ onComplete callback finished");
    } catch (error) {
      console.error("❌❌❌ GENERATION FAILED ❌❌❌", error);
      const errorMessage = handleApiError(error);
      onError?.(errorMessage);
      debugLogger.log("AIGeneration", "GENERATION_FAILED", {
        error: errorMessage,
        activeTab,
        selectedModelsCount: selectedModels.length,
      });
    } finally {
      setIsGenerating(false);
    }
  }, [
    activeTab,
    prompt,
    selectedImage,
    avatarImage,
    audioFile,
    sourceVideo,
    sourceVideoFile,
    sourceVideoUrl,
    referenceImages,
    selectedModels,
    activeProject,
    addMediaItem,
    mediaStoreLoading,
    mediaStoreError,
    onError,
    onComplete,
    startStatusPolling,
    veo31Settings,
    t2vAspectRatio,
    t2vResolution,
    t2vDuration,
    t2vNegativePrompt,
    t2vPromptExpansion,
    t2vSeed,
    t2vSafetyChecker,
    aspectRatio,
    duration,
    resolution,
    firstFrame,
    lastFrame,
    uploadImageToFal,
    seedanceDuration,
    seedanceResolution,
    seedanceAspectRatio,
    seedanceCameraFixed,
    seedanceEndFrameUrl,
    seedanceEndFrameFile,
    klingDuration,
    klingCfgScale,
    klingAspectRatio,
    klingEnhancePrompt,
    klingNegativePrompt,
    kling26Duration,
    kling26GenerateAudio,
    kling26NegativePrompt,
    wan25Duration,
    wan25Resolution,
    wan25AudioUrl,
    wan25AudioFile,
    wan25NegativePrompt,
    wan25EnablePromptExpansion,
    imageSeed,
    uploadAudioToFal,
    klingAvatarV2Prompt,
    audioDuration,
    syncLipsyncEmotion,
    syncLipsyncModelMode,
    syncLipsyncSyncMode,
    syncLipsyncTemperature,
    videoDuration,
    bytedanceTargetResolution,
    bytedanceTargetFPS,
    flashvsrUpscaleFactor,
    flashvsrAcceleration,
    flashvsrQuality,
    flashvsrColorFix,
    flashvsrPreserveAudio,
    flashvsrOutputFormat,
    flashvsrOutputQuality,
    flashvsrOutputWriteMode,
    flashvsrSeed,
    hailuoT2VDuration,
    ltxv2Duration,
    ltxv2FPS,
    ltxv2FastDuration,
    ltxv2FastFPS,
    ltxv2FastGenerateAudio,
    ltxv2FastResolution,
    ltxv2GenerateAudio,
    ltxv2I2VDuration,
    ltxv2I2VFPS,
    ltxv2I2VGenerateAudio,
    ltxv2I2VResolution,
    ltxv2ImageDuration,
    ltxv2ImageFPS,
    ltxv2ImageGenerateAudio,
    ltxv2ImageResolution,
    ltxv2Resolution,
    viduQ2Duration,
    viduQ2EnableBGM,
    viduQ2MovementAmplitude,
    viduQ2Resolution,
    // WAN v2.6 T2V dependencies
    wan26T2VDuration,
    wan26T2VResolution,
    wan26T2VAspectRatio,
    wan26T2VNegativePrompt,
    wan26T2VEnablePromptExpansion,
    wan26T2VMultiShots,
    // WAN v2.6 I2V dependencies
    wan26Duration,
    wan26Resolution,
    wan26AspectRatio,
    wan26AudioUrl,
    wan26AudioFile,
    wan26NegativePrompt,
    wan26EnablePromptExpansion,
    // Veo 3.1 Extend-Video dependencies
    extendVideoAspectRatio,
    extendVideoGenerateAudio,
  ]);

  // Reset generation state
  const resetGenerationState = useCallback(() => {
    setIsGenerating(false);
    setGenerationProgress(PROGRESS_CONSTANTS.INITIAL_PROGRESS);
    setStatusMessage("");
    setElapsedTime(0);
    setEstimatedTime(undefined);
    setCurrentModelIndex(0);
    setProgressLogs([]);
    setGenerationStartTime(null);
    setJobId(null);
    setGeneratedVideo(null);
    setGeneratedVideos([]);

    // Reset Veo 3.1 state
    setVeo31Settings({
      resolution: "720p",
      duration: "8s",
      aspectRatio: "16:9",
      generateAudio: true,
      enhancePrompt: true,
      autoFix: true,
    });
    setFirstFrame(null);
    setLastFrame(null);

    // Critical: Cleanup polling interval
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
  }, [pollingInterval]);

  // Veo 3.1 setter functions
  const setVeo31Resolution = useCallback((resolution: "720p" | "1080p") => {
    setVeo31Settings((prev) => ({ ...prev, resolution }));
  }, []);

  const setVeo31Duration = useCallback((duration: "4s" | "6s" | "8s") => {
    setVeo31Settings((prev) => ({ ...prev, duration }));
  }, []);

  const setVeo31AspectRatio = useCallback(
    (aspectRatio: "9:16" | "16:9" | "1:1" | "auto") => {
      setVeo31Settings((prev) => ({ ...prev, aspectRatio }));
    },
    []
  );

  const setVeo31GenerateAudio = useCallback((generateAudio: boolean) => {
    setVeo31Settings((prev) => ({ ...prev, generateAudio }));
  }, []);

  const setVeo31EnhancePrompt = useCallback((enhancePrompt: boolean) => {
    setVeo31Settings((prev) => ({ ...prev, enhancePrompt }));
  }, []);

  const setVeo31AutoFix = useCallback((autoFix: boolean) => {
    setVeo31Settings((prev) => ({ ...prev, autoFix }));
  }, []);

  /**
   * Clear uploaded image for Reve Edit
   */
  const clearUploadedImageForEdit = useCallback(() => {
    if (uploadedImagePreview) {
      URL.revokeObjectURL(uploadedImagePreview);
    }
    setUploadedImageForEdit(null);
    setUploadedImagePreview(null);
    setUploadedImageUrl(null);
  }, [uploadedImagePreview]);

  /**
   * Handle image upload for Reve Edit
   */
  const handleImageUploadForEdit = useCallback(
    async (file: File) => {
      try {
        // Validate image first
        const validation = await validateReveEditImage(file);

        if (!validation.valid) {
          const errorMessage = validation.error || "Invalid image file";
          console.error("[Reve Edit] Validation failed:", errorMessage);
          // Note: Error should be handled by parent component
          throw new Error(errorMessage);
        }

        // Create preview
        const preview = URL.createObjectURL(file);
        setUploadedImagePreview(preview);
        setUploadedImageForEdit(file);

        // Upload to FAL storage
        const imageUrl = await falAIClient.uploadImageToFal(file);
        setUploadedImageUrl(imageUrl);

        console.log("[Reve Edit] Image uploaded successfully:", {
          fileName: file.name,
          fileSize: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
          dimensions: validation.dimensions,
          url: imageUrl,
        });
      } catch (err) {
        console.error("[Reve Edit] Image upload failed:", err);
        clearUploadedImageForEdit();
        throw err;
      }
    },
    [clearUploadedImageForEdit]
  );

  // Export the complete generation state
  const generationState: AIGenerationState = {
    isGenerating,
    generationProgress,
    statusMessage,
    elapsedTime,
    estimatedTime,
    currentModelIndex,
    progressLogs,
    generationStartTime,
    jobId,
    generatedVideo,
    generatedVideos,
    pollingInterval,
  };

  return {
    // State
    isGenerating,
    generationProgress,
    statusMessage,
    elapsedTime,
    estimatedTime,
    currentModelIndex,
    progressLogs,
    generationStartTime,
    jobId,
    setJobId,
    generatedVideo,
    setGeneratedVideo,
    generatedVideos,
    setGeneratedVideos,
    pollingInterval,
    setPollingInterval,

    // Service instance
    outputManager,

    // Actions
    handleGenerate,
    handleMockGenerate,
    resetGenerationState,
    startStatusPolling,
    downloadVideoToMemory,

    // Complete state object
    generationState,

    // Computed values
    canGenerate: (() => {
      if (selectedModels.length === 0) return false;

      if (activeTab === "text") {
        return prompt.trim().length > 0;
      }
      if (activeTab === "image") {
        // Check if frame-to-video models are selected
        const hasFrameToVideoModel = selectedModels.some(
          (id) =>
            id === "veo31_fast_frame_to_video" || id === "veo31_frame_to_video"
        );

        // If frame-to-video models are selected, both frames are required
        if (hasFrameToVideoModel) {
          if (!firstFrame || !lastFrame) return false;
        } else {
          // For regular image-to-video, require at least one image
          if (!selectedImage) return false;
        }

        return true;
      }
      if (activeTab === "upscale") {
        return Boolean(sourceVideoFile || sourceVideoUrl);
      }
      if (activeTab === "avatar") {
        // Check model-specific requirements
        for (const modelId of selectedModels) {
          // Models requiring source video (V2V models)
          if (
            (modelId === "wan_animate_replace" ||
              modelId === "kling_o1_v2v_reference" ||
              modelId === "kling_o1_v2v_edit") &&
            !sourceVideo
          )
            return false;

          // Models requiring audio file
          if (
            (modelId === "kling_avatar_pro" ||
              modelId === "kling_avatar_standard" ||
              modelId === "bytedance_omnihuman_v1_5" ||
              modelId === "sync_lipsync_react1") &&
            !audioFile
          )
            return false;

          // Sync Lipsync React-1 requires source video (but NOT character image)
          if (modelId === "sync_lipsync_react1" && !sourceVideo) return false;

          // Models requiring reference images (check if at least one reference image exists)
          if (modelId === "kling_o1_ref2video") {
            const hasReferenceImage = referenceImages?.some(
              (img) => img !== null
            );
            if (!hasReferenceImage) return false;
            continue;
          }

          // For other avatar models, require avatarImage
          // (except video-to-video models and sync_lipsync_react1 which uses sourceVideo instead)
          if (
            modelId !== "kling_o1_v2v_reference" &&
            modelId !== "kling_o1_v2v_edit" &&
            modelId !== "kling_o1_ref2video" &&
            modelId !== "sync_lipsync_react1" &&
            !avatarImage
          )
            return false;
        }
        return true;
      }

      return false;
    })(),
    isPolling: pollingInterval !== null,
    hasResults: generatedVideos.length > 0,

    // Media store state
    mediaStoreLoading,
    mediaStoreError,

    // Sora 2 state
    duration,
    setDuration,
    aspectRatio,
    setAspectRatio,
    resolution,
    setResolution,
    isSora2Selected,
    hasSora2Pro,

    // Veo 3.1 state
    veo31Settings,
    setVeo31Settings,
    setVeo31Resolution,
    setVeo31Duration,
    setVeo31AspectRatio,
    setVeo31GenerateAudio,
    setVeo31EnhancePrompt,
    setVeo31AutoFix,
    isVeo31Selected,
    hasVeo31FrameToVideo,
    firstFrame,
    setFirstFrame,
    lastFrame,
    setLastFrame,

    // Reve Edit state
    uploadedImageForEdit,
    uploadedImagePreview,
    uploadedImageUrl,
    handleImageUploadForEdit,
    clearUploadedImageForEdit,
  };
}

export type UseAIGenerationReturn = ReturnType<typeof useAIGeneration>;
