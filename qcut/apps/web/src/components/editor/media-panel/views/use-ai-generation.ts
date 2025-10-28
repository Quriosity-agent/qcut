/**
 * AI Generation Management Hook
 *
 * Extracted from ai.tsx as part of safe refactoring process.
 * Manages AI video generation, progress tracking, and API integration.
 *
 * @see ai-view-refactoring-guide.md for refactoring plan
 * @see ai-refactoring-subtasks.md for implementation tracking
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  generateVideo,
  generateVideoFromImage,
  generateAvatarVideo,
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
  AI_MODELS,
  UI_CONSTANTS,
  PROGRESS_CONSTANTS,
  STATUS_MESSAGES,
  ERROR_MESSAGES,
  REVE_EDIT_MODEL,
} from "./ai-constants";
import type {
  GeneratedVideo,
  GeneratedVideoResult,
  AIGenerationState,
  UseAIGenerationProps,
  ProgressCallback as AIProgressCallback,
} from "./ai-types";

const VEO31_FRAME_MODELS = new Set([
  "veo31_fast_frame_to_video",
  "veo31_frame_to_video",
]);

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
      onProgress(generationProgress, statusMessage);
    }
  }, [generationProgress, statusMessage, onProgress]);

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

  // Status polling function
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
            } else if (status.status === "completed" && status.video_url) {
              // Clear polling (avoid stale closure)
              setPollingInterval((current) => {
                if (current) clearInterval(current);
                return null;
              });

              setGenerationProgress(PROGRESS_CONSTANTS.COMPLETE_PROGRESS);
              setStatusMessage(STATUS_MESSAGES.COMPLETE);

              const newVideo: GeneratedVideo = {
                jobId,
                videoUrl: status.video_url,
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

                  const newItemId = await addMediaItem(activeProject.id, {
                    name: `AI: ${newVideo.prompt.substring(0, 30)}...`,
                    type: "video",
                    file,
                    url: newVideo.videoUrl,
                    duration: newVideo.duration || 5,
                    width: 1920,
                    height: 1080,
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
        const modelId = selectedModels[i];
        const modelName = AI_MODELS.find((m) => m.id === modelId)?.name;

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
  ]);

  // Main generation function
  const handleGenerate = useCallback(async () => {
    console.log("\n🚀🚀🚀 handleGenerate CALLED 🚀🚀🚀");
    console.log("Input parameters:");
    console.log("  - activeTab:", activeTab);
    console.log("  - prompt:", prompt?.substring(0, 100));
    console.log("  - selectedModels:", selectedModels);
    console.log("  - hasSelectedImage:", !!selectedImage);
    console.log("  - activeProject:", activeProject?.id);
    console.log("  - addMediaItem available:", !!addMediaItem);

    if (activeTab === "text") {
      if (!prompt.trim() || selectedModels.length === 0) {
        console.log("❌ Validation failed - missing prompt or models");
        return;
      }
    } else if (activeTab === "image") {
      if (selectedModels.length === 0) {
        console.log("❌ Validation failed - missing models for image tab");
        return;
      }

      const hasFrameModel = selectedModels.some((id) =>
        VEO31_FRAME_MODELS.has(id)
      );
      const hasImageModel = selectedModels.some(
        (id) => !VEO31_FRAME_MODELS.has(id)
      );

      if (hasFrameModel && (!firstFrame || !lastFrame)) {
        console.log(
          "❌ Validation failed - frame-to-video models require first and last frames"
        );
        return;
      }

      if (hasImageModel && !selectedImage) {
        console.log(
          "❌ Validation failed - image-to-video models require an image"
        );
        return;
      }
    } else if (activeTab === "avatar") {
      if (!avatarImage || selectedModels.length === 0) {
        console.log("❌ Validation failed - missing avatar image or models");
        return;
      }
      // Check model-specific requirements
      for (const modelId of selectedModels) {
        if (modelId === "wan_animate_replace" && !sourceVideo) {
          console.log("❌ Validation failed - WAN model requires source video");
          return;
        }
        if (
          (modelId === "kling_avatar_pro" ||
            modelId === "kling_avatar_standard" ||
            modelId === "bytedance_omnihuman_v1_5") &&
          !audioFile
        ) {
          console.log(
            "❌ Validation failed - Audio-based avatar model requires audio file"
          );
          return;
        }
      }
    }

    console.log("✅ Validation passed, starting generation...");
    setIsGenerating(true);
    setJobId(null);

    // Start the client-side timer
    const startTime = Date.now();
    setGenerationStartTime(startTime);
    setElapsedTime(0);

    // Reset any existing generated videos
    setGeneratedVideos([]);

    try {
      console.log("🔍 DEBUG STEP 1: Pre-Generation State Check");
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

        if (activeTab === "text") {
          console.log(`  📝 Calling generateVideo for ${modelId}...`);

          // Veo 3.1 Fast text-to-video
          if (modelId === "veo31_fast_text_to_video") {
            response = await falAIClient.generateVeo31FastTextToVideo({
              prompt: prompt.trim(),
              aspect_ratio: (() => {
                const ar = veo31Settings.aspectRatio;
                return ar === "auto" ? undefined : ar; // "16:9" | "9:16" | "1:1" | undefined
              })(),
              duration: veo31Settings.duration,
              resolution: veo31Settings.resolution,
              generate_audio: veo31Settings.generateAudio,
              enhance_prompt: veo31Settings.enhancePrompt,
              auto_fix: veo31Settings.autoFix,
            });
          }
          // Veo 3.1 Standard text-to-video
          else if (modelId === "veo31_text_to_video") {
            response = await falAIClient.generateVeo31TextToVideo({
              prompt: prompt.trim(),
              aspect_ratio: (() => {
                const ar = veo31Settings.aspectRatio;
                return ar === "auto" ? undefined : ar; // "16:9" | "9:16" | "1:1" | undefined
              })(),
              duration: veo31Settings.duration,
              resolution: veo31Settings.resolution,
              generate_audio: veo31Settings.generateAudio,
              enhance_prompt: veo31Settings.enhancePrompt,
              auto_fix: veo31Settings.autoFix,
            });
          }
          // Regular text-to-video generation
          else {
            response = await generateVideo(
              {
                prompt: prompt.trim(),
                model: modelId,
                // Add Sora 2 specific parameters if Sora 2 model
                ...(modelId.startsWith("sora2_") && {
                  duration,
                  aspect_ratio: aspectRatio,
                  resolution,
                }),
              },
              progressCallback
            );
          }
          console.log("  ✅ generateVideo returned:", response);
        } else if (activeTab === "image") {
          console.log(`  🖼️ Calling generateVideoFromImage for ${modelId}...`);

          // Veo 3.1 Fast image-to-video
          if (modelId === "veo31_fast_image_to_video") {
            if (!selectedImage) {
              console.log(
                "  ⚠️ Skipping model - image-to-video requires a selected image"
              );
              continue;
            }

            // Upload image to get URL first
            const imageFile = selectedImage;
            const imageUrl = await uploadImageToFal(imageFile);
            const imageAspectRatio =
              veo31Settings.aspectRatio === "16:9" ||
              veo31Settings.aspectRatio === "9:16"
                ? veo31Settings.aspectRatio
                : "16:9";

            response = await falAIClient.generateVeo31FastImageToVideo({
              prompt: prompt.trim(),
              image_url: imageUrl,
              aspect_ratio: imageAspectRatio,
              duration: "8s",
              resolution: veo31Settings.resolution,
              generate_audio: veo31Settings.generateAudio,
            });
          }
          // Veo 3.1 Standard image-to-video
          else if (modelId === "veo31_image_to_video") {
            if (!selectedImage) {
              console.log(
                "  ⚠️ Skipping model - image-to-video requires a selected image"
              );
              continue;
            }

            // Upload image to get URL first
            const imageFile = selectedImage;
            const imageUrl = await uploadImageToFal(imageFile);
            const imageAspectRatio =
              veo31Settings.aspectRatio === "16:9" ||
              veo31Settings.aspectRatio === "9:16"
                ? veo31Settings.aspectRatio
                : "16:9";

            response = await falAIClient.generateVeo31ImageToVideo({
              prompt: prompt.trim(),
              image_url: imageUrl,
              aspect_ratio: imageAspectRatio,
              duration: "8s",
              resolution: veo31Settings.resolution,
              generate_audio: veo31Settings.generateAudio,
            });
          }
          // Veo 3.1 Fast frame-to-video
          else if (
            modelId === "veo31_fast_frame_to_video" &&
            firstFrame &&
            lastFrame
          ) {
            // Upload both frames to get URLs
            const frameStart = firstFrame;
            const frameEnd = lastFrame;
            const firstFrameUrl = await uploadImageToFal(frameStart);
            const lastFrameUrl = await uploadImageToFal(frameEnd);
            const frameAspectRatio =
              veo31Settings.aspectRatio === "16:9" ||
              veo31Settings.aspectRatio === "9:16"
                ? veo31Settings.aspectRatio
                : "16:9";

            response = await falAIClient.generateVeo31FastFrameToVideo({
              prompt: prompt.trim(),
              first_frame_url: firstFrameUrl,
              last_frame_url: lastFrameUrl,
              aspect_ratio: frameAspectRatio,
              duration: "8s",
              resolution: veo31Settings.resolution,
              generate_audio: veo31Settings.generateAudio,
            });
          }
          // Veo 3.1 Standard frame-to-video
          else if (
            modelId === "veo31_frame_to_video" &&
            firstFrame &&
            lastFrame
          ) {
            // Upload both frames to get URLs
            const frameStart = firstFrame;
            const frameEnd = lastFrame;
            const firstFrameUrl = await uploadImageToFal(frameStart);
            const lastFrameUrl = await uploadImageToFal(frameEnd);
            const frameAspectRatio =
              veo31Settings.aspectRatio === "16:9" ||
              veo31Settings.aspectRatio === "9:16"
                ? veo31Settings.aspectRatio
                : "16:9";

            response = await falAIClient.generateVeo31FrameToVideo({
              prompt: prompt.trim(),
              first_frame_url: firstFrameUrl,
              last_frame_url: lastFrameUrl,
              aspect_ratio: frameAspectRatio,
              duration: "8s",
              resolution: veo31Settings.resolution,
              generate_audio: veo31Settings.generateAudio,
            });
          } else if (VEO31_FRAME_MODELS.has(modelId)) {
            console.log(
              "  ⚠️ Skipping model - frame-to-video requires selected first and last frames"
            );
            continue;
          }
          // Regular image-to-video generation
          else {
            if (!selectedImage) {
              console.log(
                "  ⚠️ Skipping model - image-to-video requires a selected image"
              );
              continue;
            }

            response = await generateVideoFromImage({
              image: selectedImage,
              prompt: prompt.trim(),
              model: modelId,
              // Add Sora 2 specific parameters if Sora 2 model
              ...(modelId.startsWith("sora2_") && {
                duration,
                aspect_ratio: aspectRatio,
                resolution,
              }),
            });
          }
          console.log("  ✅ generateVideoFromImage returned:", response);
        } else if (activeTab === "avatar" && avatarImage) {
          console.log(`  🎭 Calling generateAvatarVideo for ${modelId}...`);
          response = await generateAvatarVideo({
            model: modelId,
            characterImage: avatarImage,
            audioFile: audioFile || undefined,
            sourceVideo: sourceVideo || undefined,
            prompt: prompt.trim() || undefined,
          });
          console.log("  ✅ generateAvatarVideo returned:", response);
        }

        console.log("🔍 DEBUG STEP 2: Post-API Response Analysis");
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

            const newVideo: GeneratedVideo = {
              jobId: response.job_id,
              videoUrl: response.video_url,
              videoPath: undefined,
              fileSize: undefined,
              duration: response.video_data?.video?.duration || undefined,
              prompt: prompt.trim(),
              model: modelId,
            };

            // Add to generations array
            generations.push({ modelId, video: newVideo });
            console.log("📦 Added to generations array:", generations.length);

            // 🔥 MOVED MEDIA INTEGRATION HERE - Steps 3-8
            console.log("🔍 DEBUG STEP 3: Media Integration Condition Check");
            console.log(
              "   - activeProject check:",
              !!activeProject,
              "→",
              activeProject?.id
            );
            console.log(
              "   - addMediaItem check:",
              !!addMediaItem,
              "→",
              typeof addMediaItem
            );
            console.log(
              "   - response.video_url check:",
              !!response.video_url,
              "→",
              response.video_url ? "EXISTS" : "MISSING"
            );
            console.log(
              "   - WILL EXECUTE MEDIA INTEGRATION:",
              !!(activeProject && addMediaItem && response.video_url)
            );

            if (activeProject && addMediaItem) {
              console.log(
                "🔍 DEBUG STEP 4: ✅ EXECUTING Media Integration Block"
              );
              console.log(
                "   - About to download from URL:",
                response.video_url
              );
              console.log("   - Project ID for media:", activeProject.id);
              console.log(
                "   - addMediaItem function type:",
                typeof addMediaItem
              );

              console.log("🔄 Attempting to add to media store...");
              console.log("   - Project ID:", activeProject.id);
              console.log("   - addMediaItem available:", !!addMediaItem);

              try {
                // Download video and create file
                console.log(
                  "📥 Downloading video from URL:",
                  response.video_url
                );
                const videoResponse = await fetch(response.video_url);

                console.log("🔍 DEBUG STEP 5: Video Download Progress");
                console.log("   - videoResponse.ok:", videoResponse.ok);
                console.log("   - videoResponse.status:", videoResponse.status);
                console.log(
                  "   - videoResponse.headers content-type:",
                  videoResponse.headers.get("content-type")
                );

                if (!videoResponse.ok) {
                  throw new Error(
                    `Failed to download video: ${videoResponse.status} ${videoResponse.statusText}`
                  );
                }

                const blob = await videoResponse.blob();
                console.log("✅ Downloaded video blob, size:", blob.size);

                const filename = `AI-Video-${modelId}-${Date.now()}.mp4`;
                const file = new File([blob], filename, { type: "video/mp4" });
                console.log("📄 Created file:", filename);

                console.log("🔍 DEBUG STEP 6: File Creation Complete");
                console.log("   - blob.size:", blob.size, "bytes");
                console.log("   - blob.type:", blob.type);
                console.log("   - file.name:", file.name);
                console.log("   - file.size:", file.size);

                // Add to media store
                const mediaItem = {
                  name: `AI: ${newVideo.prompt.substring(0, 30)}...`,
                  type: "video" as const,
                  file,
                  url: newVideo.videoUrl,
                  duration: newVideo.duration || 5,
                  width: 1920,
                  height: 1080,
                };

                console.log("📤 Adding to media store with item:", mediaItem);

                console.log("🔍 DEBUG STEP 7: About to Call addMediaItem");
                console.log(
                  "   - mediaItem structure:",
                  JSON.stringify(mediaItem, null, 2)
                );
                console.log("   - projectId:", activeProject.id);
                console.log(
                  "   - addMediaItem is function:",
                  typeof addMediaItem === "function"
                );

                const newItemId = await addMediaItem(
                  activeProject.id,
                  mediaItem
                );

                console.log("🔍 DEBUG STEP 8: ✅ addMediaItem COMPLETED");
                console.log("   - newItemId:", newItemId);
                console.log("   - SUCCESS: Video added to media store!");

                console.log("✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!");
                console.log("   - Item ID:", newItemId);

                debugLogger.log("AIGeneration", "VIDEO_ADDED_TO_MEDIA", {
                  itemId: newItemId,
                  model: modelId,
                  videoUrl: response.video_url,
                  projectId: activeProject.id,
                });
              } catch (error) {
                console.error("❌ Media integration failed:", error);
                debugLogger.log("AIGeneration", "MEDIA_INTEGRATION_FAILED", {
                  error: error instanceof Error ? error.message : String(error),
                  model: modelId,
                  videoUrl: response.video_url,
                });
              }
            } else {
              console.warn("⚠️ Cannot add to media store:");
              console.warn("   - activeProject:", !!activeProject);
              console.warn("   - addMediaItem:", !!addMediaItem);
            }
          } else {
            // Traditional polling mode: no video_url yet
            console.log(
              "🔍 FIX VERIFICATION: Polling mode - no video_url, starting polling"
            );

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

          // Automatically add to media store
          console.log("🔍 DEBUG STEP 3: Media Integration Condition Check");
          console.log(
            "   - activeProject check:",
            !!activeProject,
            "→",
            activeProject?.id
          );
          console.log(
            "   - addMediaItem check:",
            !!addMediaItem,
            "→",
            typeof addMediaItem
          );
          console.log(
            "   - response.video_url check:",
            !!response.video_url,
            "→",
            response.video_url ? "EXISTS" : "MISSING"
          );
          console.log(
            "   - WILL EXECUTE MEDIA INTEGRATION:",
            !!(activeProject && addMediaItem && response.video_url)
          );

          if (activeProject && addMediaItem) {
            console.log(
              "🔍 DEBUG STEP 4: ✅ EXECUTING Media Integration Block"
            );
            console.log("   - About to download from URL:", response.video_url);
            console.log("   - Project ID for media:", activeProject.id);
            console.log(
              "   - addMediaItem function type:",
              typeof addMediaItem
            );

            console.log("🔄 Attempting to add to media store...");
            console.log("   - Project ID:", activeProject.id);
            console.log("   - addMediaItem available:", !!addMediaItem);

            try {
              // Download video and create file
              console.log("📥 Downloading video from URL:", response.video_url);
              const videoResponse = await fetch(response.video_url);

              console.log("🔍 DEBUG STEP 5: Video Download Progress");
              console.log("   - videoResponse.ok:", videoResponse.ok);
              console.log("   - videoResponse.status:", videoResponse.status);
              console.log(
                "   - videoResponse.headers content-type:",
                videoResponse.headers.get("content-type")
              );

              if (!videoResponse.ok) {
                throw new Error(
                  `Failed to download video: ${videoResponse.status} ${videoResponse.statusText}`
                );
              }

              const blob = await videoResponse.blob();
              console.log("✅ Downloaded video blob, size:", blob.size);

              const filename = `AI-Video-${modelId}-${Date.now()}.mp4`;
              const file = new File([blob], filename, { type: "video/mp4" });
              console.log("📄 Created file:", filename);

              console.log("🔍 DEBUG STEP 6: File Creation Complete");
              console.log("   - blob.size:", blob.size, "bytes");
              console.log("   - blob.type:", blob.type);
              console.log("   - file.name:", file.name);
              console.log("   - file.size:", file.size);

              // Add to media store
              const mediaItem = {
                name: `AI: ${newVideo.prompt.substring(0, 30)}...`,
                type: "video" as const,
                file,
                url: newVideo.videoUrl,
                duration: newVideo.duration || 5,
                width: 1920,
                height: 1080,
              };

              console.log("📤 Adding to media store with item:", mediaItem);

              console.log("🔍 DEBUG STEP 7: About to Call addMediaItem");
              console.log(
                "   - mediaItem structure:",
                JSON.stringify(mediaItem, null, 2)
              );
              console.log("   - projectId:", activeProject.id);
              console.log(
                "   - addMediaItem is function:",
                typeof addMediaItem === "function"
              );

              const newItemId = await addMediaItem(activeProject.id, mediaItem);

              console.log("🔍 DEBUG STEP 8: ✅ addMediaItem COMPLETED");
              console.log("   - newItemId:", newItemId);
              console.log("   - SUCCESS: Video added to media store!");

              console.log("✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!");
              console.log("   - Item ID:", newItemId);

              debugLogger.log("AIGeneration", "VIDEO_ADDED_TO_MEDIA", {
                itemId: newItemId,
                model: modelId,
                prompt: newVideo.prompt.substring(0, 50),
              });
            } catch (error) {
              console.error("❌ FAILED TO ADD VIDEO TO MEDIA STORE:", error);
              debugLogger.log("AIGeneration", "MEDIA_ADD_FAILED", {
                error: error instanceof Error ? error.message : "Unknown error",
                model: modelId,
              });
            }
          } else {
            console.warn("⚠️ Cannot add to media store:");
            console.warn("   - activeProject:", !!activeProject);
            console.warn("   - addMediaItem:", !!addMediaItem);
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
    selectedModels,
    activeProject,
    addMediaItem,
    mediaStoreLoading,
    mediaStoreError,
    onError,
    onComplete,
    startStatusPolling,
    veo31Settings,
    firstFrame,
    lastFrame,
    uploadImageToFal,
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
    [falAIClient]
  );

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
      if (activeTab === "avatar") {
        if (!avatarImage) return false;

        // Check model-specific requirements
        for (const modelId of selectedModels) {
          if (modelId === "wan_animate_replace" && !sourceVideo) return false;
          if (
            (modelId === "kling_avatar_pro" ||
              modelId === "kling_avatar_standard" ||
              modelId === "bytedance_omnihuman_v1_5") &&
            !audioFile
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
