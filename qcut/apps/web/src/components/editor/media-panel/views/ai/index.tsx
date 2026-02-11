"use client";

import {
  BotIcon,
  Loader2,
  Play,
  Download,
  History,
  TypeIcon,
  ImageIcon,
  Upload,
  X,
  UserIcon,
  ApertureIcon,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { useProjectStore } from "@/stores/project-store";
import { usePanelStore } from "@/stores/panel-store";
import { useMediaPanelStore } from "../../store";
import { AIHistoryPanel } from "./components/ai-history-panel";
import { debugLogger } from "@/lib/debug-logger";

// Import extracted hooks
import { useAIGeneration } from "./hooks/use-ai-generation";
import { useAIHistory } from "./hooks/use-ai-history";
import { useTextTabState, T2V_DEFAULTS } from "./hooks/use-ai-text-tab-state";
import { useImageTabState } from "./hooks/use-ai-image-tab-state";
import { useAvatarTabState } from "./hooks/use-ai-avatar-tab-state";
import { useUpscaleTabState } from "./hooks/use-ai-upscale-tab-state";
import { useAnglesTabState } from "./hooks/use-ai-angles-tab-state";

// Import extracted UI components
import { AITextTab } from "./tabs/ai-text-tab";
import { AIImageTab } from "./tabs/ai-image-tab";
import { AIAvatarTab } from "./tabs/ai-avatar-tab";
import { AIUpscaleTab } from "./tabs/ai-upscale-tab";
import { AIAnglesTab } from "./tabs/ai-angles-tab";
import { AISora2Settings } from "./settings/ai-sora-settings";
import { AIVeo31Settings } from "./settings/ai-veo-settings";
import {
  AIReveTextToImageSettings,
  AIReveEditSettings,
} from "./settings/ai-reve-settings";

// Import constants and types
import {
  AI_MODELS,
  LTXV2_FAST_CONFIG,
  REVE_TEXT_TO_IMAGE_MODEL,
} from "./constants/ai-constants";
import { getProviderLogo } from "./constants/model-provider-logos";
import {
  getCombinedCapabilities,
  resolveT2VModelId,
  type T2VModelId,
} from "./constants/text2video-models-config";
import type { AIActiveTab } from "./types/ai-types";

// Import model options
import {
  type ReveAspectRatioOption,
  type ReveOutputFormatOption,
  REVE_NUM_IMAGE_OPTIONS,
} from "./constants/ai-model-options";

// Import cost calculators
import {
  calculateByteDanceUpscaleCost,
  calculateFlashVSRUpscaleCost,
} from "./utils/ai-cost-calculators";

/**
 * Render the AI features panel including tabs for Text, Image, Avatar, and Upscale,
 * model selection, per-model settings, cost estimates, media uploads, generation controls,
 * and generated results/history integration.
 *
 * Refactored to use extracted state hooks and UI components (Phase 5).
 *
 * @returns The JSX element for the AI features panel.
 */
export function AiView() {
  // ============================================
  // Shared State
  // ============================================
  const [prompt, setPrompt] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reve Text-to-Image state (kept in main component for cross-tab usage)
  const [reveAspectRatio, setReveAspectRatio] = useState<ReveAspectRatioOption>(
    REVE_TEXT_TO_IMAGE_MODEL.defaultAspectRatio
  );
  const [reveNumImages, setReveNumImages] = useState<number>(
    REVE_TEXT_TO_IMAGE_MODEL.defaultNumImages
  );
  const [reveOutputFormat, setReveOutputFormat] =
    useState<ReveOutputFormatOption>(
      REVE_TEXT_TO_IMAGE_MODEL.defaultOutputFormat
    );

  // Use global AI tab state
  const { aiActiveTab: activeTab, setAiActiveTab: setActiveTab } =
    useMediaPanelStore();

  // Get project store
  const { activeProject } = useProjectStore();

  // ============================================
  // Tab State Hooks
  // ============================================
  const textTabState = useTextTabState({ selectedModels });
  const imageTabState = useImageTabState({ selectedModels });
  const avatarTabState = useAvatarTabState();
  const upscaleTabState = useUpscaleTabState();
  const anglesTabState = useAnglesTabState();

  // Destructure text tab state for easier access
  const {
    state: textState,
    setters: textSetters,
    helpers: textHelpers,
  } = textTabState;

  // Destructure image tab state
  const {
    state: imageState,
    setters: imageSetters,
    helpers: imageHelpers,
  } = imageTabState;

  // Destructure avatar tab state
  const {
    state: avatarState,
    setters: avatarSetters,
    helpers: avatarHelpers,
  } = avatarTabState;

  // Destructure upscale tab state
  const {
    state: upscaleState,
    setters: upscaleSetters,
    handlers: upscaleHandlers,
    costs: upscaleCosts,
  } = upscaleTabState;

  // ============================================
  // Computed Values
  // ============================================
  const combinedCapabilities = useMemo(() => {
    const textVideoModelIds = Array.from(
      new Set(
        selectedModels
          .map((modelId) => resolveT2VModelId(modelId))
          .filter((id): id is T2VModelId => Boolean(id))
      )
    );
    return getCombinedCapabilities(textVideoModelIds);
  }, [selectedModels]);

  // Clamp unified settings when selected models change
  useEffect(() => {
    if (
      combinedCapabilities.supportedAspectRatios &&
      combinedCapabilities.supportedAspectRatios.length > 0 &&
      !combinedCapabilities.supportedAspectRatios.includes(
        textState.t2vAspectRatio
      )
    ) {
      textSetters.setT2vAspectRatio(
        combinedCapabilities.supportedAspectRatios[0]
      );
    }

    if (
      combinedCapabilities.supportedResolutions &&
      combinedCapabilities.supportedResolutions.length > 0 &&
      !combinedCapabilities.supportedResolutions.includes(
        textState.t2vResolution
      )
    ) {
      textSetters.setT2vResolution(
        combinedCapabilities.supportedResolutions[0]
      );
    }

    if (
      combinedCapabilities.supportedDurations &&
      combinedCapabilities.supportedDurations.length > 0 &&
      !combinedCapabilities.supportedDurations.includes(textState.t2vDuration)
    ) {
      textSetters.setT2vDuration(combinedCapabilities.supportedDurations[0]);
    }
  }, [
    combinedCapabilities,
    textState.t2vAspectRatio,
    textState.t2vResolution,
    textState.t2vDuration,
    textSetters,
  ]);

  // Reset Reve state when model is deselected
  useEffect(() => {
    if (!selectedModels.some((id) => id === "reve-text-to-image")) {
      setReveAspectRatio("3:2");
      setReveNumImages(1);
      setReveOutputFormat("png");
    }
  }, [selectedModels]);

  // Sync firstFrame with selectedImage for backward compatibility
  useEffect(() => {
    if (imageState.firstFrame && !imageState.lastFrame) {
      setSelectedImage(imageState.firstFrame);
      setImagePreview(imageState.firstFramePreview);
    } else if (imageState.firstFrame && imageState.lastFrame) {
      setSelectedImage(null);
      setImagePreview(null);
    } else {
      setSelectedImage(null);
      setImagePreview(null);
    }
  }, [
    imageState.firstFrame,
    imageState.lastFrame,
    imageState.firstFramePreview,
  ]);

  // ============================================
  // Generation Hook
  // ============================================
  const generation = useAIGeneration({
    prompt,
    selectedModels,
    selectedImage,
    activeTab,
    activeProject,
    // Avatar-specific props
    avatarImage: avatarState.avatarImage,
    audioFile: avatarState.audioFile,
    sourceVideo: avatarState.sourceVideo,
    sourceVideoFile: upscaleState.sourceVideoFile,
    sourceVideoUrl: upscaleState.sourceVideoUrl,
    referenceImages: avatarState.referenceImages,
    // Text tab settings
    hailuoT2VDuration: textState.hailuoT2VDuration,
    t2vAspectRatio: textState.t2vAspectRatio,
    t2vResolution: textState.t2vResolution,
    t2vDuration: textState.t2vDuration,
    t2vNegativePrompt: textState.t2vNegativePrompt,
    t2vPromptExpansion: textState.t2vPromptExpansion,
    t2vSeed: textState.t2vSeed,
    t2vSafetyChecker: textState.t2vSafetyChecker,
    // Image tab settings - Vidu Q2
    viduQ2Duration: imageState.viduQ2.duration,
    viduQ2Resolution: imageState.viduQ2.resolution,
    viduQ2MovementAmplitude: imageState.viduQ2.movementAmplitude,
    viduQ2EnableBGM: imageState.viduQ2.enableBGM,
    // LTX Pro Text
    ltxv2Duration: textState.ltxv2Duration,
    ltxv2Resolution: textState.ltxv2Resolution,
    ltxv2FPS: textState.ltxv2FPS,
    ltxv2GenerateAudio: textState.ltxv2GenerateAudio,
    // LTX Fast Text
    ltxv2FastDuration: textState.ltxv2FastDuration,
    ltxv2FastResolution: textState.ltxv2FastResolution,
    ltxv2FastFPS: textState.ltxv2FastFPS,
    ltxv2FastGenerateAudio: textState.ltxv2FastGenerateAudio,
    // LTX I2V
    ltxv2I2VDuration: imageState.ltxv2I2V.duration,
    ltxv2I2VResolution: imageState.ltxv2I2V.resolution,
    ltxv2I2VFPS: imageState.ltxv2I2V.fps,
    ltxv2I2VGenerateAudio: imageState.ltxv2I2V.generateAudio,
    // LTX Fast I2V
    ltxv2ImageDuration: imageState.ltxv2Image.duration,
    ltxv2ImageResolution: imageState.ltxv2Image.resolution,
    ltxv2ImageFPS: imageState.ltxv2Image.fps,
    ltxv2ImageGenerateAudio: imageState.ltxv2Image.generateAudio,
    // Seedance
    seedanceDuration: imageState.seedance.duration,
    seedanceResolution: imageState.seedance.resolution,
    seedanceAspectRatio: imageState.seedance.aspectRatio,
    seedanceCameraFixed: imageState.seedance.cameraFixed,
    seedanceEndFrameUrl: imageHelpers.cleanedSeedanceEndFrameUrl,
    seedanceEndFrameFile: imageState.seedance.endFrameFile,
    imageSeed: imageState.imageSeed,
    // Kling v2.5
    klingDuration: imageState.kling.duration,
    klingCfgScale: imageState.kling.cfgScale,
    klingAspectRatio: imageState.kling.aspectRatio,
    klingEnhancePrompt: imageState.kling.enhancePrompt,
    klingNegativePrompt: imageHelpers.cleanedKlingNegativePrompt,
    // Kling v2.6
    kling26Duration: imageState.kling26.duration,
    kling26CfgScale: imageState.kling26.cfgScale,
    kling26AspectRatio: imageState.kling26.aspectRatio,
    kling26GenerateAudio: imageState.kling26.generateAudio,
    kling26NegativePrompt:
      imageState.kling26.negativePrompt.trim() || undefined,
    // WAN 2.5
    wan25Duration: imageState.wan25.duration,
    wan25Resolution: imageState.wan25.resolution,
    wan25AudioUrl: imageHelpers.cleanedWan25AudioUrl,
    wan25AudioFile: imageState.wan25.audioFile,
    wan25NegativePrompt: imageHelpers.cleanedWan25NegativePrompt,
    wan25EnablePromptExpansion: imageState.wan25.enablePromptExpansion,
    // Avatar - Kling Avatar v2
    klingAvatarV2Prompt: avatarState.klingAvatarV2Prompt,
    audioDuration: avatarState.audioDuration,
    // Avatar - Sync Lipsync React-1
    syncLipsyncEmotion: avatarState.syncLipsyncEmotion,
    syncLipsyncModelMode: avatarState.syncLipsyncModelMode,
    syncLipsyncSyncMode: avatarState.syncLipsyncLipsyncMode,
    syncLipsyncTemperature: avatarState.syncLipsyncTemperature,
    videoDuration: avatarState.syncLipsyncVideoDuration,
    // Avatar - Veo 3.1 Extend-Video
    extendVideoAspectRatio: avatarState.extendVideoAspectRatio,
    extendVideoGenerateAudio: avatarState.extendVideoGenerateAudio,
    // Upscale - ByteDance
    bytedanceTargetResolution: upscaleState.bytedance.targetResolution,
    bytedanceTargetFPS: upscaleState.bytedance.targetFPS,
    // Upscale - FlashVSR
    flashvsrUpscaleFactor: upscaleState.flashvsr.upscaleFactor,
    flashvsrAcceleration: upscaleState.flashvsr.acceleration,
    flashvsrQuality: upscaleState.flashvsr.quality,
    flashvsrColorFix: upscaleState.flashvsr.colorFix,
    flashvsrPreserveAudio: upscaleState.flashvsr.preserveAudio,
    flashvsrOutputFormat: upscaleState.flashvsr.outputFormat,
    flashvsrOutputQuality: upscaleState.flashvsr.outputQuality,
    flashvsrOutputWriteMode: upscaleState.flashvsr.outputWriteMode,
    flashvsrSeed: upscaleState.flashvsr.seed,
    // Upscale - Topaz
    topazUpscaleFactor: upscaleState.topaz.upscaleFactor,
    topazTargetFPS: upscaleState.topaz.targetFPS,
    topazH264Output: upscaleState.topaz.h264Output,
    onProgress: (status) => {
      console.log(
        `[AI View] Progress: ${status.progress ?? 0}% - ${status.message ?? status.status}`
      );
    },
    onError: (err) => {
      console.error("[AI View] Error occurred:", err);
      setError(err);
    },
    onComplete: (videos) => {
      console.log("\n[AI View] GENERATION COMPLETE");
      console.log(`[AI View] Received ${videos.length} videos:`, videos);
      debugLogger.log("AiView", "GENERATION_COMPLETE", {
        videoCount: videos.length,
        models: selectedModels,
      });
    },
  });

  const history = useAIHistory();

  // ============================================
  // UI State
  // ============================================
  const aiPanelWidth = usePanelStore((s) => s.aiPanelWidth);
  const aiPanelMinWidth = usePanelStore((s) => s.aiPanelMinWidth);

  const safeAiPanelWidth = typeof aiPanelWidth === "number" ? aiPanelWidth : 22;
  const safeAiPanelMinWidth =
    typeof aiPanelMinWidth === "number" ? aiPanelMinWidth : 4;
  const isCollapsed = safeAiPanelWidth <= safeAiPanelMinWidth + 2;
  const isCompact = safeAiPanelWidth < 18;

  // ============================================
  // Model Selection Helpers
  // ============================================
  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId]
    );
  };

  const isModelSelected = (modelId: string) => selectedModels.includes(modelId);

  // ============================================
  // Cost Calculation
  // ============================================
  const videoDurationSeconds = upscaleState.videoMetadata?.duration ?? 10;

  const bytedanceEstimatedCost = useMemo(
    () =>
      calculateByteDanceUpscaleCost(
        upscaleState.bytedance.targetResolution,
        upscaleState.bytedance.targetFPS,
        videoDurationSeconds
      ),
    [
      upscaleState.bytedance.targetResolution,
      upscaleState.bytedance.targetFPS,
      videoDurationSeconds,
    ]
  );

  const flashvsrEstimatedCost = useMemo(() => {
    if (!upscaleState.videoMetadata) return "$0.000";
    const { width, height, frames, duration, fps } = upscaleState.videoMetadata;
    const frameCount =
      frames ?? Math.max(1, Math.round((duration ?? 0) * (fps ?? 30)));

    return calculateFlashVSRUpscaleCost(
      width,
      height,
      frameCount,
      upscaleState.flashvsr.upscaleFactor
    );
  }, [upscaleState.videoMetadata, upscaleState.flashvsr.upscaleFactor]);

  const totalCost = selectedModels.reduce((total, modelId) => {
    const model = AI_MODELS.find((m) => m.id === modelId);
    let modelCost = model ? parseFloat(model.price) : 0;

    // Adjust for Sora 2 duration and resolution
    if (modelId.startsWith("sora2_")) {
      if (modelId === "sora2_video_to_video_remix") {
        modelCost = 0;
      } else if (
        modelId === "sora2_text_to_video_pro" ||
        modelId === "sora2_image_to_video_pro"
      ) {
        if (generation.resolution === "1080p") {
          modelCost = generation.duration * 0.5;
        } else if (generation.resolution === "720p") {
          modelCost = generation.duration * 0.3;
        } else {
          modelCost = generation.duration * 0.3;
        }
      } else {
        modelCost = generation.duration * 0.1;
      }
    } else if (modelId.startsWith("veo31_")) {
      const durationSeconds = Number.parseInt(
        generation.veo31Settings.duration,
        10
      );
      const isFastModel = modelId.includes("_fast_");
      const pricePerSecond = isFastModel
        ? generation.veo31Settings.generateAudio
          ? 0.15
          : 0.1
        : generation.veo31Settings.generateAudio
          ? 0.4
          : 0.2;
      modelCost = durationSeconds * pricePerSecond;
    } else if (modelId === "reve-text-to-image") {
      modelCost = REVE_TEXT_TO_IMAGE_MODEL.pricing.perImage * reveNumImages;
    } else if (modelId === "hailuo23_standard_t2v") {
      modelCost = textState.hailuoT2VDuration === 10 ? 0.56 : 0.28;
    } else if (modelId === "ltxv2_fast_i2v") {
      const pricePerSecond =
        LTXV2_FAST_CONFIG.PRICING[imageState.ltxv2Image.resolution] ?? 0;
      modelCost = imageState.ltxv2Image.duration * pricePerSecond;
    } else if (modelId === "ltxv2_fast_t2v") {
      const pricePerSecond =
        LTXV2_FAST_CONFIG.PRICING[textState.ltxv2FastResolution] ?? 0;
      modelCost = textState.ltxv2FastDuration * pricePerSecond;
    }

    return total + modelCost;
  }, 0);

  const hasRemixSelected = selectedModels.includes(
    "sora2_video_to_video_remix"
  );

  // ============================================
  // Render Helpers
  // ============================================
  const maxChars = generation.isSora2Selected ? 5000 : 500;

  // Handle media store loading/error states
  if (generation.mediaStoreError) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-center">
          <div className="text-red-500 mb-2">Failed to load media store</div>
          <div className="text-sm text-muted-foreground">
            {generation.mediaStoreError.message}
          </div>
        </div>
      </div>
    );
  }

  if (generation.mediaStoreLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading AI features...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`h-full flex flex-col transition-all duration-200 ${isCollapsed ? "p-2" : isCompact ? "p-3" : "p-4"}`}
      data-testid="ai-features-panel"
    >
      {/* Header */}
      <div
        className={`flex items-center mb-4 ${isCollapsed ? "justify-center" : isCompact ? "flex-col gap-1" : "justify-between"}`}
      >
        <div
          className={`flex items-center ${isCompact && !isCollapsed ? "flex-col" : ""}`}
          style={{ marginLeft: "5px", gap: "7px" }}
        >
          <BotIcon className="size-5 text-primary" />
          {!isCollapsed && (
            <h3
              className={`text-sm font-medium ${isCompact ? "text-center text-xs" : ""}`}
            >
              {isCompact ? "AI" : "AI Video Generation"}
            </h3>
          )}
        </div>
        {history.hasHistory && !isCollapsed && (
          <Button
            type="button"
            size="sm"
            variant="text"
            onClick={history.openHistoryPanel}
            className={`h-8 ${isCompact ? "px-1" : "px-2"}`}
          >
            <History className="size-4 mr-1" />
            {!isCompact && `History (${history.historyCount})`}
            {isCompact && history.historyCount}
          </Button>
        )}
      </div>

      {/* Collapsed State */}
      {isCollapsed ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <BotIcon className="size-8 text-muted-foreground" />
          <div className="text-xs text-muted-foreground text-center">
            AI Video
          </div>
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto space-y-4"
          data-testid="ai-enhancement-panel"
        >
          {/* Tab Selector */}
          <Tabs
            value={activeTab}
            onValueChange={(value: string) =>
              setActiveTab(value as AIActiveTab)
            }
          >
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger
                value="text"
                className="text-xs"
                data-testid="ai-tab-text"
              >
                <TypeIcon className="size-3 mr-1" />
                {!isCompact && "Text"}
              </TabsTrigger>
              <TabsTrigger
                value="image"
                className="text-xs"
                data-testid="ai-tab-image"
              >
                <ImageIcon className="size-3 mr-1" />
                {!isCompact && "Image"}
              </TabsTrigger>
              <TabsTrigger
                value="avatar"
                className="text-xs"
                data-testid="ai-tab-avatar"
              >
                <UserIcon className="size-3 mr-1" />
                {!isCompact && "Avatar"}
              </TabsTrigger>
              <TabsTrigger
                value="upscale"
                className="text-xs"
                data-testid="ai-tab-upscale"
              >
                <Upload className="size-3 mr-1" />
                {!isCompact && "Upscale"}
              </TabsTrigger>
              <TabsTrigger
                value="angles"
                className="text-xs"
                data-testid="ai-tab-angles"
              >
                <ApertureIcon className="size-3 mr-1" />
                {!isCompact && "Angles"}
              </TabsTrigger>
            </TabsList>

            {/* Text Tab */}
            <TabsContent value="text" className="space-y-4">
              <AITextTab
                prompt={prompt}
                onPromptChange={setPrompt}
                maxChars={maxChars}
                selectedModels={selectedModels}
                isCompact={isCompact}
                combinedCapabilities={combinedCapabilities}
                isSora2Selected={generation.isSora2Selected}
                t2vSettingsExpanded={textState.t2vSettingsExpanded}
                onT2vSettingsExpandedChange={textSetters.setT2vSettingsExpanded}
                t2vAspectRatio={textState.t2vAspectRatio}
                onT2vAspectRatioChange={textSetters.setT2vAspectRatio}
                t2vResolution={textState.t2vResolution}
                onT2vResolutionChange={textSetters.setT2vResolution}
                t2vDuration={textState.t2vDuration}
                onT2vDurationChange={textSetters.setT2vDuration}
                t2vNegativePrompt={textState.t2vNegativePrompt}
                onT2vNegativePromptChange={textSetters.setT2vNegativePrompt}
                t2vPromptExpansion={textState.t2vPromptExpansion}
                onT2vPromptExpansionChange={textSetters.setT2vPromptExpansion}
                t2vSeed={textState.t2vSeed}
                onT2vSeedChange={textSetters.setT2vSeed}
                t2vSafetyChecker={textState.t2vSafetyChecker}
                onT2vSafetyCheckerChange={textSetters.setT2vSafetyChecker}
                activeSettingsCount={textHelpers.activeSettingsCount}
                hailuoT2VDuration={textState.hailuoT2VDuration}
                onHailuoT2VDurationChange={textSetters.setHailuoT2VDuration}
                ltxv2Duration={textState.ltxv2Duration}
                onLTXV2DurationChange={textSetters.setLTXV2Duration}
                ltxv2Resolution={textState.ltxv2Resolution}
                onLTXV2ResolutionChange={textSetters.setLTXV2Resolution}
                ltxv2FPS={textState.ltxv2FPS}
                onLTXV2FPSChange={textSetters.setLTXV2FPS}
                ltxv2GenerateAudio={textState.ltxv2GenerateAudio}
                onLTXV2GenerateAudioChange={textSetters.setLTXV2GenerateAudio}
                ltxv2FastDuration={textState.ltxv2FastDuration}
                onLTXV2FastDurationChange={textSetters.setLTXV2FastDuration}
                ltxv2FastResolution={textState.ltxv2FastResolution}
                onLTXV2FastResolutionChange={textSetters.setLTXV2FastResolution}
                ltxv2FastFPS={textState.ltxv2FastFPS}
                onLTXV2FastFPSChange={textSetters.setLTXV2FastFPS}
                ltxv2FastGenerateAudio={textState.ltxv2FastGenerateAudio}
                onLTXV2FastGenerateAudioChange={
                  textSetters.setLTXV2FastGenerateAudio
                }
              />
            </TabsContent>

            {/* Image Tab */}
            <TabsContent value="image" className="space-y-4">
              <AIImageTab
                prompt={prompt}
                onPromptChange={setPrompt}
                maxChars={maxChars}
                selectedModels={selectedModels}
                isCompact={isCompact}
                onError={setError}
                firstFrame={imageState.firstFrame}
                firstFramePreview={imageState.firstFramePreview}
                lastFrame={imageState.lastFrame}
                lastFramePreview={imageState.lastFramePreview}
                imageTabSourceVideo={imageState.imageTabSourceVideo}
                onFirstFrameChange={(file, preview) => {
                  imageSetters.setFirstFrame(file);
                  if (generation.setFirstFrame) {
                    generation.setFirstFrame(file);
                  }
                }}
                onLastFrameChange={(file, preview) => {
                  imageSetters.setLastFrame(file);
                  if (generation.setLastFrame) {
                    generation.setLastFrame(file);
                  }
                }}
                onSourceVideoChange={(file) => {
                  imageSetters.setImageTabSourceVideo(file);
                  if (file) setError(null);
                }}
                viduQ2Duration={imageState.viduQ2.duration}
                onViduQ2DurationChange={imageSetters.setViduQ2Duration}
                viduQ2Resolution={imageState.viduQ2.resolution}
                onViduQ2ResolutionChange={imageSetters.setViduQ2Resolution}
                viduQ2MovementAmplitude={imageState.viduQ2.movementAmplitude}
                onViduQ2MovementAmplitudeChange={
                  imageSetters.setViduQ2MovementAmplitude
                }
                viduQ2EnableBGM={imageState.viduQ2.enableBGM}
                onViduQ2EnableBGMChange={imageSetters.setViduQ2EnableBGM}
                ltxv2I2VDuration={imageState.ltxv2I2V.duration}
                onLTXV2I2VDurationChange={imageSetters.setLTXV2I2VDuration}
                ltxv2I2VResolution={imageState.ltxv2I2V.resolution}
                onLTXV2I2VResolutionChange={imageSetters.setLTXV2I2VResolution}
                ltxv2I2VFPS={imageState.ltxv2I2V.fps}
                onLTXV2I2VFPSChange={imageSetters.setLTXV2I2VFPS}
                ltxv2I2VGenerateAudio={imageState.ltxv2I2V.generateAudio}
                onLTXV2I2VGenerateAudioChange={
                  imageSetters.setLTXV2I2VGenerateAudio
                }
                ltxv2ImageDuration={imageState.ltxv2Image.duration}
                onLTXV2ImageDurationChange={imageSetters.setLTXV2ImageDuration}
                ltxv2ImageResolution={imageState.ltxv2Image.resolution}
                onLTXV2ImageResolutionChange={
                  imageSetters.setLTXV2ImageResolution
                }
                ltxv2ImageFPS={imageState.ltxv2Image.fps}
                onLTXV2ImageFPSChange={imageSetters.setLTXV2ImageFPS}
                ltxv2ImageGenerateAudio={imageState.ltxv2Image.generateAudio}
                onLTXV2ImageGenerateAudioChange={
                  imageSetters.setLTXV2ImageGenerateAudio
                }
                seedanceDuration={imageState.seedance.duration}
                onSeedanceDurationChange={imageSetters.setSeedanceDuration}
                seedanceResolution={imageState.seedance.resolution}
                onSeedanceResolutionChange={imageSetters.setSeedanceResolution}
                seedanceAspectRatio={imageState.seedance.aspectRatio}
                onSeedanceAspectRatioChange={
                  imageSetters.setSeedanceAspectRatio
                }
                seedanceCameraFixed={imageState.seedance.cameraFixed}
                onSeedanceCameraFixedChange={
                  imageSetters.setSeedanceCameraFixed
                }
                seedanceEndFrameUrl={imageState.seedance.endFrameUrl}
                onSeedanceEndFrameUrlChange={
                  imageSetters.setSeedanceEndFrameUrl
                }
                seedanceEndFrameFile={imageState.seedance.endFrameFile}
                seedanceEndFramePreview={imageState.seedance.endFramePreview}
                onSeedanceEndFrameFileChange={(file, preview) => {
                  imageSetters.setSeedanceEndFrameFile(file);
                  if (file) {
                    imageSetters.setSeedanceEndFrameUrl(undefined);
                  }
                }}
                klingDuration={imageState.kling.duration}
                onKlingDurationChange={imageSetters.setKlingDuration}
                klingCfgScale={imageState.kling.cfgScale}
                onKlingCfgScaleChange={imageSetters.setKlingCfgScale}
                klingAspectRatio={imageState.kling.aspectRatio}
                onKlingAspectRatioChange={imageSetters.setKlingAspectRatio}
                klingEnhancePrompt={imageState.kling.enhancePrompt}
                onKlingEnhancePromptChange={imageSetters.setKlingEnhancePrompt}
                klingNegativePrompt={imageState.kling.negativePrompt}
                onKlingNegativePromptChange={
                  imageSetters.setKlingNegativePrompt
                }
                kling26Duration={imageState.kling26.duration}
                onKling26DurationChange={imageSetters.setKling26Duration}
                kling26CfgScale={imageState.kling26.cfgScale}
                onKling26CfgScaleChange={imageSetters.setKling26CfgScale}
                kling26AspectRatio={imageState.kling26.aspectRatio}
                onKling26AspectRatioChange={imageSetters.setKling26AspectRatio}
                kling26GenerateAudio={imageState.kling26.generateAudio}
                onKling26GenerateAudioChange={
                  imageSetters.setKling26GenerateAudio
                }
                kling26NegativePrompt={imageState.kling26.negativePrompt}
                onKling26NegativePromptChange={
                  imageSetters.setKling26NegativePrompt
                }
                wan25Duration={imageState.wan25.duration}
                onWan25DurationChange={imageSetters.setWan25Duration}
                wan25Resolution={imageState.wan25.resolution}
                onWan25ResolutionChange={imageSetters.setWan25Resolution}
                wan25EnablePromptExpansion={
                  imageState.wan25.enablePromptExpansion
                }
                onWan25EnablePromptExpansionChange={
                  imageSetters.setWan25EnablePromptExpansion
                }
                wan25NegativePrompt={imageState.wan25.negativePrompt}
                onWan25NegativePromptChange={
                  imageSetters.setWan25NegativePrompt
                }
                wan25AudioUrl={imageState.wan25.audioUrl}
                onWan25AudioUrlChange={imageSetters.setWan25AudioUrl}
                wan25AudioFile={imageState.wan25.audioFile}
                wan25AudioPreview={imageState.wan25.audioPreview}
                onWan25AudioFileChange={(file, preview) => {
                  imageSetters.setWan25AudioFile(file);
                  if (file) {
                    imageSetters.setWan25AudioUrl(undefined);
                  }
                }}
                imageSeed={imageState.imageSeed}
                onImageSeedChange={imageSetters.setImageSeed}
                generation={{
                  setFirstFrame: generation.setFirstFrame,
                  setLastFrame: generation.setLastFrame,
                }}
              />
            </TabsContent>

            {/* Avatar Tab */}
            <TabsContent value="avatar" className="space-y-4">
              <AIAvatarTab
                prompt={prompt}
                onPromptChange={setPrompt}
                maxChars={maxChars}
                selectedModels={selectedModels}
                isCompact={isCompact}
                onError={setError}
                avatarImage={avatarState.avatarImage}
                avatarImagePreview={avatarState.avatarImagePreview}
                onAvatarImageChange={(file, preview) => {
                  avatarSetters.setAvatarImage(file);
                  if (file) setError(null);
                }}
                avatarLastFrame={avatarState.avatarLastFrame}
                avatarLastFramePreview={avatarState.avatarLastFramePreview}
                onAvatarLastFrameChange={(file, preview) => {
                  avatarSetters.setAvatarLastFrame(file);
                  if (file) setError(null);
                }}
                referenceImages={avatarState.referenceImages}
                referenceImagePreviews={avatarState.referenceImagePreviews}
                onReferenceImageChange={(index, file, preview) => {
                  avatarSetters.setReferenceImage(index, file);
                  if (file) setError(null);
                }}
                audioFile={avatarState.audioFile}
                onAudioFileChange={(file) => {
                  avatarSetters.setAudioFile(file);
                  if (file) setError(null);
                }}
                sourceVideo={avatarState.sourceVideo}
                onSourceVideoChange={(file) => {
                  avatarSetters.setSourceVideo(file);
                  if (file) setError(null);
                }}
                klingAvatarV2Prompt={avatarState.klingAvatarV2Prompt}
                onKlingAvatarV2PromptChange={
                  avatarSetters.setKlingAvatarV2Prompt
                }
                audioDuration={avatarState.audioDuration}
                // Sync Lipsync React-1 props
                syncLipsyncSourceVideo={avatarState.syncLipsyncSourceVideo}
                syncLipsyncSourceVideoPreview={
                  avatarState.syncLipsyncSourceVideoPreview
                }
                syncLipsyncVideoDuration={avatarState.syncLipsyncVideoDuration}
                syncLipsyncEmotion={avatarState.syncLipsyncEmotion}
                syncLipsyncModelMode={avatarState.syncLipsyncModelMode}
                syncLipsyncLipsyncMode={avatarState.syncLipsyncLipsyncMode}
                syncLipsyncTemperature={avatarState.syncLipsyncTemperature}
                onSyncLipsyncSourceVideoChange={(file) => {
                  avatarSetters.setSyncLipsyncSourceVideo(file);
                  if (file) setError(null);
                }}
                onSyncLipsyncEmotionChange={avatarSetters.setSyncLipsyncEmotion}
                onSyncLipsyncModelModeChange={
                  avatarSetters.setSyncLipsyncModelMode
                }
                onSyncLipsyncLipsyncModeChange={
                  avatarSetters.setSyncLipsyncLipsyncMode
                }
                onSyncLipsyncTemperatureChange={
                  avatarSetters.setSyncLipsyncTemperature
                }
                // Veo 3.1 Extend-Video props
                extendVideoAspectRatio={avatarState.extendVideoAspectRatio}
                onExtendVideoAspectRatioChange={
                  avatarSetters.setExtendVideoAspectRatio
                }
                extendVideoGenerateAudio={avatarState.extendVideoGenerateAudio}
                onExtendVideoGenerateAudioChange={
                  avatarSetters.setExtendVideoGenerateAudio
                }
              />
            </TabsContent>

            {/* Upscale Tab */}
            <TabsContent value="upscale" className="space-y-4">
              <AIUpscaleTab
                selectedModels={selectedModels}
                isCompact={isCompact}
                onError={setError}
                sourceVideoFile={upscaleState.sourceVideoFile}
                sourceVideoUrl={upscaleState.sourceVideoUrl}
                videoMetadata={upscaleState.videoMetadata}
                onSourceVideoFileChange={
                  upscaleHandlers.handleUpscaleVideoChange
                }
                onSourceVideoUrlChange={upscaleSetters.setSourceVideoUrl}
                onVideoUrlBlur={upscaleHandlers.handleUpscaleVideoUrlBlur}
                setVideoMetadata={(metadata) => {
                  // Video metadata is set via handlers
                }}
                bytedanceTargetResolution={
                  upscaleState.bytedance.targetResolution
                }
                onBytedanceTargetResolutionChange={
                  upscaleSetters.setBytedanceTargetResolution
                }
                bytedanceTargetFPS={upscaleState.bytedance.targetFPS}
                onBytedanceTargetFPSChange={
                  upscaleSetters.setBytedanceTargetFPS
                }
                bytedanceEstimatedCost={bytedanceEstimatedCost}
                flashvsrUpscaleFactor={upscaleState.flashvsr.upscaleFactor}
                onFlashvsrUpscaleFactorChange={
                  upscaleSetters.setFlashvsrUpscaleFactor
                }
                flashvsrAcceleration={upscaleState.flashvsr.acceleration}
                onFlashvsrAccelerationChange={
                  upscaleSetters.setFlashvsrAcceleration
                }
                flashvsrQuality={upscaleState.flashvsr.quality}
                onFlashvsrQualityChange={upscaleSetters.setFlashvsrQuality}
                flashvsrColorFix={upscaleState.flashvsr.colorFix}
                onFlashvsrColorFixChange={upscaleSetters.setFlashvsrColorFix}
                flashvsrPreserveAudio={upscaleState.flashvsr.preserveAudio}
                onFlashvsrPreserveAudioChange={
                  upscaleSetters.setFlashvsrPreserveAudio
                }
                flashvsrOutputFormat={upscaleState.flashvsr.outputFormat}
                onFlashvsrOutputFormatChange={
                  upscaleSetters.setFlashvsrOutputFormat
                }
                flashvsrOutputQuality={upscaleState.flashvsr.outputQuality}
                onFlashvsrOutputQualityChange={
                  upscaleSetters.setFlashvsrOutputQuality
                }
                flashvsrOutputWriteMode={upscaleState.flashvsr.outputWriteMode}
                onFlashvsrOutputWriteModeChange={
                  upscaleSetters.setFlashvsrOutputWriteMode
                }
                flashvsrSeed={upscaleState.flashvsr.seed}
                onFlashvsrSeedChange={upscaleSetters.setFlashvsrSeed}
                flashvsrEstimatedCost={flashvsrEstimatedCost}
                topazUpscaleFactor={upscaleState.topaz.upscaleFactor}
                onTopazUpscaleFactorChange={
                  upscaleSetters.setTopazUpscaleFactor
                }
                topazTargetFPS={upscaleState.topaz.targetFPS}
                onTopazTargetFPSChange={upscaleSetters.setTopazTargetFPS}
                topazH264Output={upscaleState.topaz.h264Output}
                onTopazH264OutputChange={upscaleSetters.setTopazH264Output}
              />
            </TabsContent>

            {/* Angles Tab */}
            <TabsContent value="angles" className="space-y-4">
              <AIAnglesTab
                prompt={prompt}
                onPromptChange={setPrompt}
                isCompact={isCompact}
                onError={setError}
                anglesState={anglesTabState}
              />
            </TabsContent>
          </Tabs>

          {/* Model Selection Grid */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Select AI Models</Label>
            <div className="grid grid-cols-2 gap-2">
              {AI_MODELS.filter((model) => {
                // Filter models based on active tab
                if (activeTab === "avatar") {
                  return model.category === "avatar";
                }
                if (activeTab === "text") {
                  // Show text-to-video models (excluding avatar and image-to-video)
                  return (
                    model.category === "text" ||
                    (!model.category && model.category !== "avatar")
                  );
                }
                if (activeTab === "image") {
                  // Show image-to-video models
                  return model.category === "image";
                }
                if (activeTab === "upscale") {
                  return model.category === "upscale";
                }
                if (activeTab === "angles") {
                  return model.category === "angles";
                }
                return false;
              }).map((model) => (
                <Button
                  key={model.id}
                  type="button"
                  size="sm"
                  variant={isModelSelected(model.id) ? "default" : "outline"}
                  onClick={() => toggleModel(model.id)}
                  className={`h-auto min-h-[44px] py-2 px-2 text-xs justify-start items-start ${isCompact ? "flex-col" : "flex-row"}`}
                >
                  <div className="flex items-center gap-1.5 text-left leading-tight flex-1 min-w-0">
                    {(() => {
                      const logo = getProviderLogo(model.id);
                      return logo ? (
                        <img
                          src={logo}
                          alt=""
                          className="w-4 h-4 shrink-0 rounded-sm"
                        />
                      ) : null;
                    })()}
                    <span className="truncate">{model.name}</span>
                  </div>
                  {!isCompact && (
                    <span className="ml-2 text-muted-foreground whitespace-nowrap shrink-0">
                      ${model.price}
                    </span>
                  )}
                </Button>
              ))}
            </div>
          </div>

          {/* Cost Summary */}
          {selectedModels.length > 0 && (
            <div className="p-3 bg-muted/30 rounded-md">
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium">Estimated Cost:</span>
                <span className="text-xs font-semibold">
                  ${totalCost.toFixed(2)}
                  {hasRemixSelected && " + remix varies"}
                </span>
              </div>
            </div>
          )}

          {/* Sora 2 Settings */}
          {generation.isSora2Selected && (
            <AISora2Settings
              duration={generation.duration as 4 | 8 | 12}
              onDurationChange={(v) => generation.setDuration(v)}
              aspectRatio={generation.aspectRatio as "16:9" | "9:16"}
              onAspectRatioChange={(v) => generation.setAspectRatio(v)}
              resolution={generation.resolution as "auto" | "720p" | "1080p"}
              onResolutionChange={(v) => generation.setResolution(v)}
              hasSora2Pro={generation.hasSora2Pro}
            />
          )}

          {/* Veo 3.1 Settings */}
          {generation.isVeo31Selected && (
            <AIVeo31Settings
              settings={generation.veo31Settings}
              onResolutionChange={(v) => generation.setVeo31Resolution(v)}
              onDurationChange={(v) => generation.setVeo31Duration(v)}
              onAspectRatioChange={(v) => generation.setVeo31AspectRatio(v)}
              onGenerateAudioChange={(v) => generation.setVeo31GenerateAudio(v)}
              onEnhancePromptChange={(v) => generation.setVeo31EnhancePrompt(v)}
              onAutoFixChange={(v) => generation.setVeo31AutoFix(v)}
            />
          )}

          {/* Reve Text-to-Image Settings */}
          {selectedModels.some((id) => id === "reve-text-to-image") && (
            <AIReveTextToImageSettings
              aspectRatio={reveAspectRatio}
              onAspectRatioChange={setReveAspectRatio}
              numImages={reveNumImages}
              onNumImagesChange={setReveNumImages}
              outputFormat={reveOutputFormat}
              onOutputFormatChange={setReveOutputFormat}
            />
          )}

          {/* Reve Edit (Image Tab only) */}
          {activeTab === "image" &&
            selectedModels.some((id) => id === "reve-text-to-image") && (
              <AIReveEditSettings
                uploadedImage={generation.uploadedImageForEdit}
                uploadedImagePreview={generation.uploadedImagePreview}
                onImageUpload={generation.handleImageUploadForEdit}
                onClearImage={generation.clearUploadedImageForEdit}
                editPrompt={prompt}
                onEditPromptChange={setPrompt}
                onError={setError}
              />
            )}

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <div className="text-xs text-destructive">{error}</div>
            </div>
          )}

          {/* Progress Display */}
          {generation.isGenerating && (
            <div className="space-y-3 p-3 bg-muted/50 rounded-md">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Generating...</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round(generation.generationProgress)}%
                </div>
              </div>
              <div className="w-full bg-muted-foreground/20 rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${generation.generationProgress}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {generation.statusMessage}
              </div>
              {generation.elapsedTime > 0 && (
                <div className="text-xs text-muted-foreground">
                  Elapsed: {Math.floor(generation.elapsedTime / 60)}:
                  {(generation.elapsedTime % 60).toString().padStart(2, "0")}
                </div>
              )}
            </div>
          )}

          {/* Generated Videos Results */}
          {generation.hasResults && (
            <div className="space-y-2">
              <Label className="text-xs">Generated Videos</Label>
              <div className="space-y-2">
                {generation.generatedVideos.map((result) => {
                  const model = AI_MODELS.find((m) => m.id === result.modelId);
                  return (
                    <div
                      key={result.video.jobId}
                      className="flex items-center justify-between p-2 bg-muted/30 rounded-md"
                    >
                      <div className="flex items-center space-x-2">
                        <Play className="size-4 text-primary" />
                        <div>
                          <div className="text-xs font-medium">
                            {model?.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {result.video.prompt.substring(0, 30)}...
                          </div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const downloadUrl =
                            result.video.videoUrl || result.video.videoPath;

                          if (!downloadUrl) {
                            console.warn("Missing downloadUrl", {
                              jobId: result.video.jobId,
                            });
                            return;
                          }

                          const isBlob = downloadUrl.startsWith("blob:");
                          let filename = `ai-video-${result.video.jobId}.mp4`;

                          if (!isBlob) {
                            try {
                              const parsed = new URL(downloadUrl);
                              const lastPart =
                                parsed.pathname.split("/").pop() || "";
                              filename = lastPart || filename;
                            } catch {
                              // fall back to default filename
                            }
                          }

                          const a = document.createElement("a");
                          a.href = downloadUrl;
                          a.download = filename;
                          a.click();
                          a.remove();
                        }}
                        className="h-6 px-2"
                        aria-label="Download video"
                      >
                        <Download className="size-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Validation Messages */}
          {!generation.canGenerate && selectedModels.length > 0 && (
            <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-md">
              <div className="text-xs text-orange-600 dark:text-orange-400 space-y-1">
                {activeTab === "text" && !prompt.trim() && (
                  <div>Please enter a prompt to generate video</div>
                )}
                {activeTab === "image" &&
                  !selectedImage &&
                  !generation.hasVeo31FrameToVideo && (
                    <div>Please upload an image for video generation</div>
                  )}
                {activeTab === "image" &&
                  generation.hasVeo31FrameToVideo &&
                  !imageState.firstFrame && (
                    <div>
                      Please upload the first frame (required for
                      frame-to-video)
                    </div>
                  )}
                {activeTab === "image" &&
                  generation.hasVeo31FrameToVideo &&
                  !imageState.lastFrame && (
                    <div>
                      Please upload the last frame (required for frame-to-video)
                    </div>
                  )}
                {activeTab === "avatar" &&
                  !avatarState.avatarImage &&
                  !selectedModels.includes("sync_lipsync_react1") &&
                  !selectedModels.some(
                    (id) =>
                      id === "kling_o1_v2v_reference" ||
                      id === "kling_o1_v2v_edit" ||
                      id === "kling_o1_ref2video"
                  ) && <div>Please upload a character image</div>}
                {activeTab === "avatar" &&
                  selectedModels.includes("sync_lipsync_react1") &&
                  !avatarState.syncLipsyncSourceVideo && (
                    <div>Please upload a source video</div>
                  )}
                {activeTab === "avatar" &&
                  selectedModels.includes("sync_lipsync_react1") &&
                  !avatarState.audioFile && (
                    <div>Please upload an audio file</div>
                  )}
              </div>
            </div>
          )}

          {/* Generate Button */}
          <Button
            type="button"
            className="w-full"
            disabled={!generation.canGenerate || generation.isGenerating}
            onClick={generation.handleGenerate}
          >
            {generation.isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>Generate ({selectedModels.length} models)</>
            )}
          </Button>
        </div>
      )}

      {/* History Panel */}
      <AIHistoryPanel
        isOpen={history.isHistoryPanelOpen}
        onClose={history.closeHistoryPanel}
        generationHistory={history.generationHistory}
        onSelectVideo={(video) => {
          generation.setGeneratedVideo(video);
          history.closeHistoryPanel();
        }}
        onRemoveFromHistory={history.removeFromHistory}
        aiModels={AI_MODELS}
      />
    </div>
  );
}
