"use client";

import {
  BotIcon,
  Loader2,
  Play,
  Download,
  History,
  Trash2,
  ImageIcon,
  TypeIcon,
  Upload,
  X,
  Check,
  UserIcon,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
import { FileUpload } from "@/components/ui/file-upload";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronDown } from "lucide-react";

import { useTimelineStore } from "@/stores/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { usePanelStore } from "@/stores/panel-store";
import { useMediaPanelStore } from "../store";
import { AIHistoryPanel } from "./ai-history-panel";
import { AIImageUploadSection } from "./ai-image-upload";
import { debugLogger } from "@/lib/debug-logger";
import {
  extractVideoMetadataFromFile,
  extractVideoMetadataFromUrl,
  type VideoMetadata,
} from "@/lib/video-metadata";

// Import extracted hooks and types
import { useAIGeneration } from "./use-ai-generation";
import { useAIHistory } from "./use-ai-history";
import {
  AI_MODELS,
  ERROR_MESSAGES,
  LTXV2_FAST_CONFIG,
  REVE_TEXT_TO_IMAGE_MODEL,
  UPLOAD_CONSTANTS,
} from "./ai-constants";
import {
  T2V_MODEL_CAPABILITIES,
  getCombinedCapabilities,
  type T2VModelId,
} from "./text2video-models-config";
import type { AIActiveTab } from "./ai-types";

type ReveAspectRatioOption =
  (typeof REVE_TEXT_TO_IMAGE_MODEL.aspectRatios)[number]["value"];
type ReveOutputFormatOption =
  (typeof REVE_TEXT_TO_IMAGE_MODEL.outputFormats)[number];
type LTXV2FastDuration = (typeof LTXV2_FAST_CONFIG.DURATIONS)[number];
type LTXV2FastResolution =
  (typeof LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD)[number];
type LTXV2FastFps = (typeof LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD)[number];
type SeedanceDuration = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
type SeedanceResolution = "480p" | "720p" | "1080p";
type SeedanceAspectRatio =
  | "21:9"
  | "16:9"
  | "4:3"
  | "1:1"
  | "3:4"
  | "9:16"
  | "auto";
type KlingAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
type Wan25Resolution = "480p" | "720p" | "1080p";
type Wan25Duration = 5 | 10;
const SEEDANCE_DURATION_OPTIONS: SeedanceDuration[] = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
];
const SEEDANCE_RESOLUTIONS: SeedanceResolution[] = ["480p", "720p", "1080p"];
const SEEDANCE_ASPECT_RATIOS: SeedanceAspectRatio[] = [
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
  "auto",
];
const KLING_ASPECT_RATIOS: KlingAspectRatio[] = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
];
const WAN25_DURATIONS: Wan25Duration[] = [5, 10];
const WAN25_RESOLUTIONS: Wan25Resolution[] = ["480p", "720p", "1080p"];

const LTXV2_FAST_RESOLUTION_LABELS: Record<LTXV2FastResolution, string> = {
  "1080p": "1080p (Full HD)",
  "1440p": "1440p (QHD)",
  "2160p": "2160p (4K)",
};

const LTXV2_FAST_RESOLUTION_PRICE_SUFFIX: Partial<
  Record<LTXV2FastResolution, string>
> = {
  "1080p": " ($0.04/sec)",
  "1440p": " ($0.08/sec)",
  "2160p": " ($0.16/sec)",
};

const LTXV2_FAST_FPS_LABELS: Record<LTXV2FastFps, string> = {
  25: "25 FPS (Standard)",
  50: "50 FPS (High)",
};

const REVE_NUM_IMAGE_OPTIONS = Array.from(
  {
    length:
      REVE_TEXT_TO_IMAGE_MODEL.numImagesRange.max -
      REVE_TEXT_TO_IMAGE_MODEL.numImagesRange.min +
      1,
  },
  (_, index) => REVE_TEXT_TO_IMAGE_MODEL.numImagesRange.min + index
);

/**
 * Render the AI features panel including tabs for Text, Image, Avatar, and Upscale,
 * model selection, per-model settings, cost estimates, media uploads, generation controls,
 * and generated results/history integration.
 *
 * The component manages local UI state for prompts, media inputs, per-model options,
 * and responsive layout, and wires user input into the AI generation workflow.
 *
 * @returns The JSX element for the AI features panel.
 */
export function AiView() {
  // UI-only state (not related to generation logic)
  const [prompt, setPrompt] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Frame-to-Video state variables
  const [firstFrame, setFirstFrame] = useState<File | null>(null);
  const [firstFramePreview, setFirstFramePreview] = useState<string | null>(
    null
  );
  const [lastFrame, setLastFrame] = useState<File | null>(null);
  const [lastFramePreview, setLastFramePreview] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Avatar-specific state variables
  const [avatarImage, setAvatarImage] = useState<File | null>(null);
  const [avatarImagePreview, setAvatarImagePreview] = useState<string | null>(
    null
  );
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreview, setAudioPreview] = useState<string | null>(null);
  const [sourceVideo, setSourceVideo] = useState<File | null>(null);
  const [sourceVideoPreview, setSourceVideoPreview] = useState<string | null>(
    null
  );

  // Upscale tab state
  const [sourceVideoFile, setSourceVideoFile] = useState<File | null>(null);
  const [sourceVideoUrl, setSourceVideoUrl] = useState("");
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);

  const [bytedanceTargetResolution, setBytedanceTargetResolution] = useState<
    "1080p" | "2k" | "4k"
  >("1080p");
  const [bytedanceTargetFPS, setBytedanceTargetFPS] = useState<
    "30fps" | "60fps"
  >("30fps");

  const [flashvsrUpscaleFactor, setFlashvsrUpscaleFactor] = useState(4);
  const [flashvsrAcceleration, setFlashvsrAcceleration] = useState<
    "regular" | "high" | "full"
  >("regular");
  const [flashvsrQuality, setFlashvsrQuality] = useState(70);
  const [flashvsrColorFix, setFlashvsrColorFix] = useState(true);
  const [flashvsrPreserveAudio, setFlashvsrPreserveAudio] = useState(false);
  const [flashvsrOutputFormat, setFlashvsrOutputFormat] = useState<
    "X264" | "VP9" | "PRORES4444" | "GIF"
  >("X264");
  const [flashvsrOutputQuality, setFlashvsrOutputQuality] = useState<
    "low" | "medium" | "high" | "maximum"
  >("high");
  const [flashvsrOutputWriteMode, setFlashvsrOutputWriteMode] = useState<
    "fast" | "balanced" | "small"
  >("balanced");
  const [flashvsrSeed, setFlashvsrSeed] = useState<number | undefined>();

  const [topazUpscaleFactor, setTopazUpscaleFactor] = useState(2);
  const [topazTargetFPS, setTopazTargetFPS] = useState<
    "original" | "interpolated"
  >("original");
  const [topazH264Output, setTopazH264Output] = useState(false);

  // Veo 3.1 frame upload state - already declared above as Frame-to-Video state variables

  // Reve Text-to-Image state
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
  const [hailuoT2VDuration, setHailuoT2VDuration] = useState<6 | 10>(6);
  const [viduQ2Duration, setViduQ2Duration] = useState<
    2 | 3 | 4 | 5 | 6 | 7 | 8
  >(4);
  const [viduQ2Resolution, setViduQ2Resolution] = useState<"720p" | "1080p">(
    "720p"
  );
  const [viduQ2MovementAmplitude, setViduQ2MovementAmplitude] = useState<
    "auto" | "small" | "medium" | "large"
  >("auto");
  const [viduQ2EnableBGM, setViduQ2EnableBGM] = useState(false);

  // Unified text-to-video advanced settings
  const [t2vAspectRatio, setT2vAspectRatio] = useState<string>("16:9");
  const [t2vResolution, setT2vResolution] = useState<string>("1080p");
  const [t2vDuration, setT2vDuration] = useState<number>(5);
  const [t2vNegativePrompt, setT2vNegativePrompt] = useState<string>(
    "low resolution, error, worst quality, low quality, defects"
  );
  const [t2vPromptExpansion, setT2vPromptExpansion] = useState<boolean>(false);
  const [t2vSeed, setT2vSeed] = useState<number>(-1); // -1 = random
  const [t2vSafetyChecker, setT2vSafetyChecker] = useState<boolean>(false);
  const [t2vSettingsExpanded, setT2vSettingsExpanded] =
    useState<boolean>(false);
  const [ltxv2Duration, setLTXV2Duration] = useState<6 | 8 | 10>(6);
  const [ltxv2Resolution, setLTXV2Resolution] = useState<
    "1080p" | "1440p" | "2160p"
  >("1080p");
  const [ltxv2FPS, setLTXV2FPS] = useState<25 | 50>(25);
  const [ltxv2GenerateAudio, setLTXV2GenerateAudio] = useState(true);
  const [ltxv2FastDuration, setLTXV2FastDuration] = useState<LTXV2FastDuration>(
    LTXV2_FAST_CONFIG.DURATIONS[0]
  );
  const [ltxv2FastResolution, setLTXV2FastResolution] =
    useState<LTXV2FastResolution>(LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD[0]);
  const [ltxv2FastFPS, setLTXV2FastFPS] = useState<LTXV2FastFps>(
    LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD[0]
  );
  const [ltxv2FastGenerateAudio, setLTXV2FastGenerateAudio] = useState(true);
  const [ltxv2I2VDuration, setLTXV2I2VDuration] = useState<6 | 8 | 10>(6);
  const [ltxv2I2VResolution, setLTXV2I2VResolution] = useState<
    "1080p" | "1440p" | "2160p"
  >("1080p");
  const [ltxv2I2VFPS, setLTXV2I2VFPS] = useState<25 | 50>(25);
  const [ltxv2I2VGenerateAudio, setLTXV2I2VGenerateAudio] = useState(true);
  const [ltxv2ImageDuration, setLTXV2ImageDuration] =
    useState<LTXV2FastDuration>(LTXV2_FAST_CONFIG.DURATIONS[0]);
  const [ltxv2ImageResolution, setLTXV2ImageResolution] =
    useState<LTXV2FastResolution>(LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD[0]);
  const [ltxv2ImageFPS, setLTXV2ImageFPS] = useState<LTXV2FastFps>(
    LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD[0]
  );
  const [ltxv2ImageGenerateAudio, setLTXV2ImageGenerateAudio] = useState(true);
  const [seedanceDuration, setSeedanceDuration] =
    useState<SeedanceDuration>(5);
  const [seedanceResolution, setSeedanceResolution] =
    useState<SeedanceResolution>("1080p");
  const [seedanceAspectRatio, setSeedanceAspectRatio] =
    useState<SeedanceAspectRatio>("16:9");
  const [seedanceCameraFixed, setSeedanceCameraFixed] = useState(false);
  const [seedanceEndFrameUrl, setSeedanceEndFrameUrl] = useState<
    string | undefined
  >(undefined);
  const [seedanceEndFrameFile, setSeedanceEndFrameFile] = useState<File | null>(
    null
  );
  const [seedanceEndFramePreview, setSeedanceEndFramePreview] = useState<
    string | null
  >(null);
  const [klingDuration, setKlingDuration] = useState<5 | 10>(5);
  const [klingCfgScale, setKlingCfgScale] = useState(0.5);
  const [klingAspectRatio, setKlingAspectRatio] =
    useState<KlingAspectRatio>("16:9");
  const [klingEnhancePrompt, setKlingEnhancePrompt] = useState(true);
  const [klingNegativePrompt, setKlingNegativePrompt] = useState("");
  const [wan25Duration, setWan25Duration] = useState<Wan25Duration>(5);
  const [wan25Resolution, setWan25Resolution] =
    useState<Wan25Resolution>("1080p");
  const [wan25AudioUrl, setWan25AudioUrl] = useState<string | undefined>(
    undefined
  );
  const [wan25AudioFile, setWan25AudioFile] = useState<File | null>(null);
  const [wan25AudioPreview, setWan25AudioPreview] = useState<string | null>(
    null
  );
  const [wan25NegativePrompt, setWan25NegativePrompt] = useState("");
  const [wan25EnablePromptExpansion, setWan25EnablePromptExpansion] =
    useState(true);
  const [imageSeed, setImageSeed] = useState<number | undefined>(undefined);

  // Use global AI tab state (CRITICAL: preserve global state integration)
  const { aiActiveTab: activeTab, setAiActiveTab: setActiveTab } =
    useMediaPanelStore();

  // Get project store
  const { activeProject } = useProjectStore();

  // Check if current project is a fallback project
  const isFallbackProject =
    activeProject?.id?.startsWith("project-") &&
    /^project-\d{13}$/.test(activeProject?.id || "");

  const cleanedSeedanceEndFrameUrl = seedanceEndFrameUrl?.trim()
    ? seedanceEndFrameUrl.trim()
    : undefined;
  const cleanedKlingNegativePrompt = klingNegativePrompt.trim()
    ? klingNegativePrompt.trim()
    : undefined;
  const cleanedWan25AudioUrl = wan25AudioUrl?.trim()
    ? wan25AudioUrl.trim()
    : undefined;
  const cleanedWan25NegativePrompt = wan25NegativePrompt.trim()
    ? wan25NegativePrompt.trim()
    : undefined;

  // Calculate combined capabilities for selected text-to-video models
  const combinedCapabilities = useMemo(() => {
    const textVideoModelIds = selectedModels
      .filter((modelId) => modelId in T2V_MODEL_CAPABILITIES)
      .map((id) => id as T2VModelId);

    return getCombinedCapabilities(textVideoModelIds);
  }, [selectedModels]);

  // Helper to count active settings
  const getActiveSettingsCount = () => {
    let count = 0;
    if (t2vAspectRatio !== "16:9") count++;
    if (t2vResolution !== "1080p") count++;
    if (t2vDuration !== 5) count++;
    if (
      t2vNegativePrompt !==
      "low resolution, error, worst quality, low quality, defects"
    )
      count++;
    if (t2vPromptExpansion) count++;
    if (t2vSeed !== -1) count++;
    if (!t2vSafetyChecker) count++;
    return count;
  };

  // Clamp unified settings when selected models change
  useEffect(() => {
    if (
      combinedCapabilities.supportedAspectRatios &&
      combinedCapabilities.supportedAspectRatios.length > 0 &&
      !combinedCapabilities.supportedAspectRatios.includes(t2vAspectRatio)
    ) {
      setT2vAspectRatio(combinedCapabilities.supportedAspectRatios[0]);
    }

    if (
      combinedCapabilities.supportedResolutions &&
      combinedCapabilities.supportedResolutions.length > 0 &&
      !combinedCapabilities.supportedResolutions.includes(t2vResolution)
    ) {
      setT2vResolution(combinedCapabilities.supportedResolutions[0]);
    }

    if (
      combinedCapabilities.supportedDurations &&
      combinedCapabilities.supportedDurations.length > 0 &&
      !combinedCapabilities.supportedDurations.includes(t2vDuration)
    ) {
      setT2vDuration(combinedCapabilities.supportedDurations[0]);
    }
  }, [combinedCapabilities, t2vAspectRatio, t2vResolution, t2vDuration]);

  const handleUpscaleVideoChange = async (file: File | null) => {
    setSourceVideoFile(file);

    if (!file) {
      setVideoMetadata(null);
      return;
    }

    setSourceVideoUrl("");
    try {
      const metadata = await extractVideoMetadataFromFile(file);
      setVideoMetadata(metadata);
    } catch (error) {
      console.error("Failed to read video metadata", error);
      setVideoMetadata(null);
    }
  };

  const handleUpscaleVideoUrlBlur = async () => {
    if (!sourceVideoUrl) {
      setVideoMetadata(null);
      return;
    }

    try {
      const metadata = await extractVideoMetadataFromUrl(sourceVideoUrl);
      setVideoMetadata(metadata);
    } catch (error) {
      console.error("Failed to read video metadata", error);
      setVideoMetadata(null);
    }
  };

  // Use extracted hooks
  const generation = useAIGeneration({
    prompt,
    selectedModels,
    selectedImage,
    activeTab,
    activeProject,
    // Avatar-specific props
    avatarImage,
    audioFile,
    sourceVideo,
    sourceVideoFile,
    sourceVideoUrl,
    hailuoT2VDuration,
    viduQ2Duration,
    viduQ2Resolution,
    viduQ2MovementAmplitude,
    viduQ2EnableBGM,
    ltxv2Duration,
    ltxv2Resolution,
    ltxv2FPS,
    ltxv2GenerateAudio,
    ltxv2FastDuration,
    ltxv2FastResolution,
    ltxv2FastFPS,
    ltxv2FastGenerateAudio,
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
    seedanceEndFrameUrl: cleanedSeedanceEndFrameUrl,
    seedanceEndFrameFile,
    imageSeed,
    klingDuration,
    klingCfgScale,
    klingAspectRatio,
    klingEnhancePrompt,
    klingNegativePrompt: cleanedKlingNegativePrompt,
    wan25Duration,
    wan25Resolution,
    wan25AudioUrl: cleanedWan25AudioUrl,
    wan25AudioFile,
    wan25NegativePrompt: cleanedWan25NegativePrompt,
    wan25EnablePromptExpansion,
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
    topazUpscaleFactor,
    topazTargetFPS,
    topazH264Output,
    onProgress: (progress, message) => {
      console.log(`[AI View] Progress: ${progress}% - ${message}`);
      // Progress is handled internally by the hook
    },
    onError: (error) => {
      console.error("[AI View] Error occurred:", error);
      setError(error);
    },
    onComplete: (videos) => {
      console.log("\n🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉");
      console.log(`[AI View] Received ${videos.length} videos:`, videos);
      debugLogger.log("AiView", "GENERATION_COMPLETE", {
        videoCount: videos.length,
        models: selectedModels,
      });
      console.log("[AI View] onComplete callback finished");
    },
  });

  const history = useAIHistory();

  // Store hooks - use selector-based subscriptions to minimize re-renders
  const aiPanelWidth = usePanelStore((s) => s.aiPanelWidth);
  const aiPanelMinWidth = usePanelStore((s) => s.aiPanelMinWidth);

  // Responsive layout calculations with safe defaults
  const safeAiPanelWidth = typeof aiPanelWidth === "number" ? aiPanelWidth : 22;
  const safeAiPanelMinWidth =
    typeof aiPanelMinWidth === "number" ? aiPanelMinWidth : 4;
  const isCollapsed = safeAiPanelWidth <= safeAiPanelMinWidth + 2;
  const isCompact = safeAiPanelWidth < 18;
  const isExpanded = safeAiPanelWidth > 25;

  // Helper functions for multi-model selection
  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId]
    );
  };

  const isModelSelected = (modelId: string) => selectedModels.includes(modelId);
  const hailuoStandardSelected = selectedModels.includes(
    "hailuo23_standard_t2v"
  );
  const hailuoProSelected = selectedModels.includes("hailuo23_pro_t2v");
  const viduQ2Selected = selectedModels.includes("vidu_q2_turbo_i2v");
  const ltxv2ProTextSelected = selectedModels.includes("ltxv2_pro_t2v");
  const ltxv2FastTextSelected = selectedModels.includes("ltxv2_fast_t2v");
  const ltxv2TextSelected = ltxv2ProTextSelected || ltxv2FastTextSelected;
  const ltxv2I2VSelected = selectedModels.includes("ltxv2_i2v");
  const ltxv2ImageSelected = selectedModels.includes("ltxv2_fast_i2v");
  const ltxv2FastExtendedResolutions = LTXV2_FAST_CONFIG.RESOLUTIONS.EXTENDED;
  const ltxv2FastExtendedFps = LTXV2_FAST_CONFIG.FPS_OPTIONS.EXTENDED;
  const isExtendedLTXV2FastImageDuration =
    ltxv2ImageDuration > LTXV2_FAST_CONFIG.EXTENDED_DURATION_THRESHOLD;
  const isExtendedLTXV2FastTextDuration =
    ltxv2FastDuration > LTXV2_FAST_CONFIG.EXTENDED_DURATION_THRESHOLD;
  const seedanceFastSelected = selectedModels.includes(
    "seedance_pro_fast_i2v"
  );
  const seedanceProSelected = selectedModels.includes("seedance_pro_i2v");
  const seedanceSelected = seedanceFastSelected || seedanceProSelected;
  const klingI2VSelected = selectedModels.includes("kling_v2_5_turbo_i2v");
  const wan25Selected = selectedModels.includes("wan_25_preview_i2v");
  const bytedanceUpscalerSelected = selectedModels.includes(
    "bytedance_video_upscaler"
  );
  const flashvsrUpscalerSelected = selectedModels.includes(
    "flashvsr_video_upscaler"
  );
  const topazUpscalerSelected = selectedModels.includes(
    "topaz_video_upscale"
  );

  const videoDurationSeconds = videoMetadata?.duration ?? 10;

  const bytedanceEstimatedCost = useMemo(
    () =>
      calculateByteDanceUpscaleCost(
        bytedanceTargetResolution,
        bytedanceTargetFPS,
        videoDurationSeconds
      ),
    [bytedanceTargetResolution, bytedanceTargetFPS, videoDurationSeconds]
  );

  const flashvsrEstimatedCost = useMemo(() => {
    if (!videoMetadata) return "$0.000";
    const { width, height, frames, duration, fps } = videoMetadata;
    const frameCount =
      frames ??
      Math.max(1, Math.round((duration ?? 0) * (fps ?? 30)));

    return calculateFlashVSRUpscaleCost(
      width,
      height,
      frameCount,
      flashvsrUpscaleFactor
    );
  }, [videoMetadata, flashvsrUpscaleFactor]);
  const seedanceModelId = seedanceProSelected
    ? "seedance_pro_i2v"
    : "seedance_pro_fast_i2v";
  const seedanceModelConfig = AI_MODELS.find(
    (model) => model.id === seedanceModelId
  );
  const seedanceDurationOptions =
    seedanceModelConfig?.supportedDurations ?? SEEDANCE_DURATION_OPTIONS;
  const seedanceResolutionOptions =
    seedanceModelConfig?.supportedResolutions ?? SEEDANCE_RESOLUTIONS;
  const seedanceAspectRatioOptions =
    seedanceModelConfig?.supportedAspectRatios ?? SEEDANCE_ASPECT_RATIOS;
  const seedanceEstimatedCost = calculateSeedanceCost(
    seedanceModelId,
    seedanceResolution,
    seedanceDuration
  );
  const klingModelConfig = AI_MODELS.find(
    (model) => model.id === "kling_v2_5_turbo_i2v"
  );
  const klingAspectRatios =
    klingModelConfig?.supportedAspectRatios ?? KLING_ASPECT_RATIOS;
  const klingEstimatedCost = calculateKlingCost(klingDuration);
  const wan25ModelConfig = AI_MODELS.find(
    (model) => model.id === "wan_25_preview_i2v"
  );
  const wan25DurationOptions =
    wan25ModelConfig?.supportedDurations ?? WAN25_DURATIONS;
  const wan25ResolutionOptions =
    wan25ModelConfig?.supportedResolutions ?? WAN25_RESOLUTIONS;
  const wan25PricePerSecond =
    wan25ModelConfig?.perSecondPricing?.[wan25Resolution] ?? 0;
  const wan25EstimatedCost = wan25PricePerSecond * wan25Duration;

  // Reset Reve state when model is deselected
  useEffect(() => {
    if (!selectedModels.some((id) => id === "reve-text-to-image")) {
      setReveAspectRatio("3:2");
      setReveNumImages(1);
      setReveOutputFormat("png");
    }
  }, [selectedModels]);

  useEffect(() => {
    // Only reset duration if NEITHER Standard nor Pro is selected
    const hasHailuoT2VModel =
      selectedModels.includes("hailuo23_standard_t2v") ||
      selectedModels.includes("hailuo23_pro_t2v");

    if (!hasHailuoT2VModel && hailuoT2VDuration !== 6) {
      setHailuoT2VDuration(6);
    }
  }, [selectedModels, hailuoT2VDuration]);

  useEffect(() => {
    if (!viduQ2Selected) {
      setViduQ2Duration(4);
      setViduQ2Resolution("720p");
      setViduQ2MovementAmplitude("auto");
      setViduQ2EnableBGM(false);
    }
  }, [viduQ2Selected]);

  useEffect(() => {
    if (viduQ2Duration !== 4 && viduQ2EnableBGM) {
      setViduQ2EnableBGM(false);
    }
  }, [viduQ2Duration, viduQ2EnableBGM]);

  useEffect(() => {
    if (!ltxv2ProTextSelected) {
      setLTXV2Duration(6);
      setLTXV2Resolution("1080p");
      setLTXV2FPS(25);
      setLTXV2GenerateAudio(true);
    }
  }, [ltxv2ProTextSelected]);

  useEffect(() => {
    if (!ltxv2FastTextSelected) {
      setLTXV2FastDuration(LTXV2_FAST_CONFIG.DURATIONS[0]);
      setLTXV2FastResolution(LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD[0]);
      setLTXV2FastFPS(LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD[0]);
      setLTXV2FastGenerateAudio(true);
    }
  }, [ltxv2FastTextSelected]);

  useEffect(() => {
    if (!ltxv2I2VSelected) {
      setLTXV2I2VDuration(6);
      setLTXV2I2VResolution("1080p");
      setLTXV2I2VFPS(25);
      setLTXV2I2VGenerateAudio(true);
    }
  }, [ltxv2I2VSelected]);

  useEffect(() => {
    if (!ltxv2ImageSelected) {
      setLTXV2ImageDuration(LTXV2_FAST_CONFIG.DURATIONS[0]);
      setLTXV2ImageResolution(LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD[0]);
      setLTXV2ImageFPS(LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD[0]);
      setLTXV2ImageGenerateAudio(true);
    }
  }, [ltxv2ImageSelected]);

  useEffect(() => {
    if (!seedanceSelected) {
      setSeedanceDuration(5);
      setSeedanceResolution("1080p");
      setSeedanceAspectRatio("16:9");
      setSeedanceCameraFixed(false);
      setSeedanceEndFrameFile(null);
      setSeedanceEndFramePreview(null);
      setSeedanceEndFrameUrl(undefined);
    }
  }, [seedanceSelected]);

  useEffect(() => {
    if (!klingI2VSelected) {
      setKlingDuration(5);
      setKlingCfgScale(0.5);
      setKlingAspectRatio("16:9");
      setKlingEnhancePrompt(true);
      setKlingNegativePrompt("");
    }
  }, [klingI2VSelected]);

  useEffect(() => {
    if (!wan25Selected) {
      setWan25Duration(5);
      setWan25Resolution("1080p");
      setWan25AudioUrl(undefined);
      setWan25AudioFile(null);
      setWan25AudioPreview(null);
      setWan25NegativePrompt("");
      setWan25EnablePromptExpansion(true);
    }
  }, [wan25Selected]);

  useEffect(() => {
    if (!seedanceSelected && !wan25Selected) {
      setImageSeed(undefined);
    }
  }, [seedanceSelected, wan25Selected]);

  useEffect(() => {
    if (!ltxv2FastTextSelected && !ltxv2ImageSelected) {
      return;
    }

    const enforceFastConstraints = (
      duration: number,
      currentResolution: LTXV2FastResolution,
      setResolution: (value: LTXV2FastResolution) => void,
      currentFps: LTXV2FastFps,
      setFps: (value: LTXV2FastFps) => void
    ) => {
      if (duration <= LTXV2_FAST_CONFIG.EXTENDED_DURATION_THRESHOLD) {
        return;
      }

      const enforcedResolution =
        LTXV2_FAST_CONFIG.RESOLUTIONS.EXTENDED[0] ??
        LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD[0];
      const enforcedFps =
        LTXV2_FAST_CONFIG.FPS_OPTIONS.EXTENDED[0] ??
        LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD[0];

      if (currentResolution !== enforcedResolution) {
        setResolution(enforcedResolution);
      }

      if (currentFps !== enforcedFps) {
        setFps(enforcedFps);
      }
    };

    if (ltxv2FastTextSelected) {
      enforceFastConstraints(
        ltxv2FastDuration,
        ltxv2FastResolution,
        setLTXV2FastResolution,
        ltxv2FastFPS,
        setLTXV2FastFPS
      );
    }

    if (ltxv2ImageSelected) {
      enforceFastConstraints(
        ltxv2ImageDuration,
        ltxv2ImageResolution,
        setLTXV2ImageResolution,
        ltxv2ImageFPS,
        setLTXV2ImageFPS
      );
    }
  }, [
    ltxv2FastTextSelected,
    ltxv2FastDuration,
    ltxv2FastResolution,
    ltxv2FastFPS,
    ltxv2ImageSelected,
    ltxv2ImageDuration,
    ltxv2ImageResolution,
    ltxv2ImageFPS,
  ]);

  // Sync firstFrame with selectedImage for backward compatibility
  useEffect(() => {
    if (firstFrame && !lastFrame) {
      // Single image mode - maintain backward compatibility with I2V code
      setSelectedImage(firstFrame);
      setImagePreview(firstFramePreview);
    } else if (firstFrame && lastFrame) {
      // F2V mode - clear selectedImage to avoid confusion
      setSelectedImage(null);
      setImagePreview(null);
    } else {
      // Frames cleared - ensure legacy state is also cleared
      setSelectedImage(null);
      setImagePreview(null);
    }
  }, [firstFrame, lastFrame, firstFramePreview]);

  // Reset generation state
  const resetGenerationState = () => {
    generation.resetGenerationState();
    setError(null);
  };

  // Calculate cost helpers
  const maxChars = generation.isSora2Selected ? 5000 : 500;
  const remainingChars = maxChars - prompt.length;

  const totalCost = selectedModels.reduce((total, modelId) => {
    const model = AI_MODELS.find((m) => m.id === modelId);
    let modelCost = model ? parseFloat(model.price) : 0;

    // Adjust for Sora 2 duration and resolution
    if (modelId.startsWith("sora2_")) {
      // CRITICAL: Remix inherits duration from source video, not UI duration control
      // Cannot calculate accurate price without knowing source video duration
      if (modelId === "sora2_video_to_video_remix") {
        // Remix pricing: $0.10/s * (source video duration)
        // Since we don't track source video duration yet, return 0 and show "varies" message
        // TODO: Track source video duration from previously generated videos for accurate pricing
        modelCost = 0; // Will display "Price varies" in UI
      }
      // Pro models have resolution-based pricing
      else if (
        modelId === "sora2_text_to_video_pro" ||
        modelId === "sora2_image_to_video_pro"
      ) {
        if (generation.resolution === "1080p") {
          modelCost = generation.duration * 0.5; // $0.50/s for 1080p
        } else if (generation.resolution === "720p") {
          modelCost = generation.duration * 0.3; // $0.30/s for 720p
        } else {
          // auto resolution - use 720p pricing as default
          modelCost = generation.duration * 0.3;
        }
      } else {
        // Standard models: $0.10/s * (user-selected duration)
        modelCost = generation.duration * 0.1;
      }
    }
    // Veo 3.1 pricing calculation
    else if (modelId.startsWith("veo31_")) {
      const durationSeconds = Number.parseInt(
        generation.veo31Settings.duration,
        10
      ); // "4s" -> 4

      // Determine if this is a fast or standard model
      const isFastModel = modelId.includes("_fast_");

      // Fast models: $0.10/s (no audio) or $0.15/s (with audio)
      // Standard models: $0.20/s (no audio) or $0.40/s (with audio)
      const pricePerSecond = isFastModel
        ? generation.veo31Settings.generateAudio
          ? 0.15
          : 0.1
        : generation.veo31Settings.generateAudio
          ? 0.4
          : 0.2;

      modelCost = durationSeconds * pricePerSecond;
    }
    // Reve Text-to-Image pricing calculation
    else if (modelId === "reve-text-to-image") {
      modelCost = REVE_TEXT_TO_IMAGE_MODEL.pricing.perImage * reveNumImages; // Use configured per-image pricing
    }
    // Hailuo 2.3 Standard T2V dynamic pricing based on duration
    else if (modelId === "hailuo23_standard_t2v") {
      modelCost = hailuoT2VDuration === 10 ? 0.56 : 0.28;
    }
    // LTX Video 2.0 Fast I2V resolution-based pricing
    else if (modelId === "ltxv2_fast_i2v") {
      const pricePerSecond =
        LTXV2_FAST_CONFIG.PRICING[ltxv2ImageResolution] ?? 0;
      modelCost = ltxv2ImageDuration * pricePerSecond;
    }
    // LTX Video 2.0 Fast T2V resolution-based pricing
    else if (modelId === "ltxv2_fast_t2v") {
      const pricePerSecond =
        LTXV2_FAST_CONFIG.PRICING[ltxv2FastResolution] ?? 0;
      modelCost = ltxv2FastDuration * pricePerSecond;
    }
    // Seedance image-to-video pricing (scale relative to default duration)
    else if (
      modelId === "seedance_pro_fast_i2v" ||
      modelId === "seedance_pro_i2v"
    ) {
      const basePrice = model ? Number.parseFloat(model.price) : 0;
      const defaultDuration =
        (model?.default_params?.duration as number | undefined) ?? 5;
      modelCost = basePrice * (seedanceDuration / (defaultDuration || 5));
    }
    // Kling v2.5 Turbo Pro image-to-video pricing
    else if (modelId === "kling_v2_5_turbo_i2v") {
      const basePrice = model ? Number.parseFloat(model.price) : 0;
      const defaultDuration =
        (model?.default_params?.duration as number | undefined) ?? 5;
      modelCost = basePrice * (klingDuration / (defaultDuration || 5));
    }
    // WAN 2.5 Preview image-to-video pricing (per-second by resolution)
    else if (modelId === "wan_25_preview_i2v") {
      const perSecond =
        model?.perSecondPricing?.[wan25Resolution] ??
        Number.parseFloat(model?.price ?? "0");
      modelCost = perSecond * wan25Duration;
    }

    return total + modelCost;
  }, 0);

  // Check if remix model is selected to show special pricing note
  const hasRemixSelected = selectedModels.includes(
    "sora2_video_to_video_remix"
  );

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

      {/* Show collapsed state with just icon */}
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
          {/* Tab selector */}
          <Tabs
            value={activeTab}
            onValueChange={(value: string) =>
              setActiveTab(value as AIActiveTab)
            }
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="text" className="text-xs">
                <TypeIcon className="size-3 mr-1" />
                {!isCompact && "Text"}
              </TabsTrigger>
              <TabsTrigger value="image" className="text-xs">
                <ImageIcon className="size-3 mr-1" />
                {!isCompact && "Image"}
              </TabsTrigger>
              <TabsTrigger value="avatar" className="text-xs">
                <UserIcon className="size-3 mr-1" />
                {!isCompact && "Avatar"}
              </TabsTrigger>
              <TabsTrigger value="upscale" className="text-xs">
                <Upload className="size-3 mr-1" />
                {!isCompact && "Upscale"}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="space-y-4">
              {/* Prompt input */}
              <div className="space-y-2">
                <Label htmlFor="prompt" className="text-xs">
                  Prompt {!isCompact && "for Video Generation"}
                </Label>
                <Textarea
                  id="prompt"
                  placeholder={
                    isCompact
                      ? "Describe the video..."
                      : "Describe the video you want to generate..."
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[60px] text-xs resize-none"
                  maxLength={maxChars}
                />
                <div
                  className={`text-xs ${remainingChars < 50 ? "text-orange-500" : remainingChars < 20 ? "text-red-500" : "text-muted-foreground"} text-right`}
                >
                  {remainingChars} characters remaining
                  {generation.isSora2Selected && (
                    <span className="ml-2 text-primary">
                      (Sora 2: 5000 max)
                    </span>
                  )}
                </div>
                {hailuoProSelected && (
                  <>
                    <div className="text-xs text-muted-foreground text-left">
                      Tip: Add camera cues like [Pan left], [Zoom in], or [Track
                      forward] to guide Pro shots.
                    </div>
                    {/* Show duration selector for Pro if Standard is not selected */}
                    {!hailuoStandardSelected && (
                      <div className="space-y-1 text-left mt-2">
                        <Label
                          htmlFor="hailuo-pro-duration"
                          className="text-xs font-medium"
                        >
                          Hailuo 2.3 Pro Duration
                        </Label>
                        <Select
                          value={hailuoT2VDuration.toString()}
                          onValueChange={(value) =>
                            setHailuoT2VDuration(value === "10" ? 10 : 6)
                          }
                        >
                          <SelectTrigger
                            id="hailuo-pro-duration"
                            className="h-8 text-xs"
                          >
                            <SelectValue placeholder="Select duration" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="6">6 seconds ($0.49)</SelectItem>
                            <SelectItem value="10">
                              10 seconds ($0.49)
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="text-xs text-muted-foreground">
                          Pro: Fixed price $0.49 for 6s or 10s
                        </div>
                      </div>
                    )}
                  </>
                )}
                {hailuoStandardSelected && (
                  <div className="space-y-1 text-left">
                    <Label
                      htmlFor="hailuo-standard-duration"
                      className="text-xs font-medium"
                    >
                      Hailuo 2.3 {hailuoProSelected ? "Shared" : "Standard"}{" "}
                      Duration
                    </Label>
                    <Select
                      value={hailuoT2VDuration.toString()}
                      onValueChange={(value) =>
                        setHailuoT2VDuration(value === "10" ? 10 : 6)
                      }
                    >
                      <SelectTrigger
                        id="hailuo-standard-duration"
                        className="h-8 text-xs"
                      >
                        <SelectValue placeholder="Select duration" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="6">
                          6 seconds (
                          {hailuoProSelected
                            ? "Standard: $0.28, Pro: $0.49"
                            : "$0.28"}
                          )
                        </SelectItem>
                        <SelectItem value="10">
                          10 seconds (
                          {hailuoProSelected
                            ? "Standard: $0.56, Pro: $0.49"
                            : "$0.56"}
                          )
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="text-xs text-muted-foreground">
                      {hailuoProSelected
                        ? "Duration applies to both Standard and Pro models"
                        : "Standard: 6s: $0.28 | 10s: $0.56"}
                    </div>
                  </div>
                )}
                {ltxv2ProTextSelected && (
                  <div className="space-y-2 text-left border-t pt-3">
                    <Label className="text-xs font-medium">
                      LTX Video 2.0 Pro Settings
                    </Label>
                    <div className="space-y-1">
                      <Label htmlFor="ltxv2-duration" className="text-xs">
                        Duration
                      </Label>
                      <Select
                        value={ltxv2Duration.toString()}
                        onValueChange={(value) =>
                          setLTXV2Duration(Number(value) as 6 | 8 | 10)
                        }
                      >
                        <SelectTrigger
                          id="ltxv2-duration"
                          className="h-8 text-xs"
                        >
                          <SelectValue placeholder="Select duration" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="6">6 seconds</SelectItem>
                          <SelectItem value="8">8 seconds</SelectItem>
                          <SelectItem value="10">10 seconds</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="ltxv2-resolution" className="text-xs">
                        Resolution
                      </Label>
                      <Select
                        value={ltxv2Resolution}
                        onValueChange={(value) =>
                          setLTXV2Resolution(
                            value as "1080p" | "1440p" | "2160p"
                          )
                        }
                      >
                        <SelectTrigger
                          id="ltxv2-resolution"
                          className="h-8 text-xs"
                        >
                          <SelectValue placeholder="Select resolution" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1080p">1080p</SelectItem>
                          <SelectItem value="1440p">1440p</SelectItem>
                          <SelectItem value="2160p">2160p (4K)</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="text-xs text-muted-foreground">
                        Cost: $
                        {(
                          ltxv2Duration *
                          (ltxv2Resolution === "1080p"
                            ? 0.06
                            : ltxv2Resolution === "1440p"
                              ? 0.12
                              : 0.24)
                        ).toFixed(2)}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="ltxv2-fps" className="text-xs">
                        Frame Rate
                      </Label>
                      <Select
                        value={ltxv2FPS.toString()}
                        onValueChange={(value) =>
                          setLTXV2FPS(Number(value) as 25 | 50)
                        }
                      >
                        <SelectTrigger id="ltxv2-fps" className="h-8 text-xs">
                          <SelectValue placeholder="Select frame rate" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="25">25 FPS</SelectItem>
                          <SelectItem value="50">50 FPS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="ltxv2-audio"
                        checked={ltxv2GenerateAudio}
                        onCheckedChange={(checked) =>
                          setLTXV2GenerateAudio(Boolean(checked))
                        }
                      />
                      <Label htmlFor="ltxv2-audio" className="text-xs">
                        Generate audio
                      </Label>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="image" className="space-y-4">
              {/* Image upload - supports both I2V and F2V modes */}
              <AIImageUploadSection
                selectedModels={selectedModels}
                firstFrame={firstFrame}
                firstFramePreview={firstFramePreview}
                lastFrame={lastFrame}
                lastFramePreview={lastFramePreview}
                onFirstFrameChange={(file, preview) => {
                  setFirstFrame(file);
                  setFirstFramePreview(preview || null);
                  if (generation.setFirstFrame) {
                    generation.setFirstFrame(file);
                  }
                }}
                onLastFrameChange={(file, preview) => {
                  setLastFrame(file);
                  setLastFramePreview(preview || null);
                  if (generation.setLastFrame) {
                    generation.setLastFrame(file);
                  }
                }}
                onError={setError}
                isCompact={isCompact}
              />

              {/* Prompt for image-to-video */}
              <div className="space-y-2">
                <Label htmlFor="image-prompt" className="text-xs">
                  {!isCompact && "Additional "}Prompt
                  {!isCompact && " (optional)"}
                </Label>
                <Textarea
                  id="image-prompt"
                  placeholder={
                    isCompact
                      ? "Describe motion..."
                      : "Describe how the image should move..."
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[40px] text-xs resize-none"
                  maxLength={maxChars}
                />
              </div>
              {viduQ2Selected && (
                <div className="space-y-3 text-left border-t pt-3">
                  <Label className="text-sm font-semibold">
                    Vidu Q2 Turbo Settings
                  </Label>

                  <div className="space-y-1">
                    <Label htmlFor="vidu-duration" className="text-xs">
                      Duration
                    </Label>
                    <Select
                      value={viduQ2Duration.toString()}
                      onValueChange={(value) =>
                        setViduQ2Duration(
                          Number(value) as 2 | 3 | 4 | 5 | 6 | 7 | 8
                        )
                      }
                    >
                      <SelectTrigger id="vidu-duration" className="h-8 text-xs">
                        <SelectValue placeholder="Select duration" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="2">2 seconds</SelectItem>
                        <SelectItem value="3">3 seconds</SelectItem>
                        <SelectItem value="4">4 seconds</SelectItem>
                        <SelectItem value="5">5 seconds</SelectItem>
                        <SelectItem value="6">6 seconds</SelectItem>
                        <SelectItem value="7">7 seconds</SelectItem>
                        <SelectItem value="8">8 seconds</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="vidu-resolution" className="text-xs">
                      Resolution
                    </Label>
                    <Select
                      value={viduQ2Resolution}
                      onValueChange={(value) =>
                        setViduQ2Resolution(value as "720p" | "1080p")
                      }
                    >
                      <SelectTrigger
                        id="vidu-resolution"
                        className="h-8 text-xs"
                      >
                        <SelectValue placeholder="Select resolution" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="720p">720p ($0.05/sec)</SelectItem>
                        <SelectItem value="1080p">
                          1080p ($0.20 base + $0.05/sec)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="vidu-movement" className="text-xs">
                      Movement Amplitude
                    </Label>
                    <Select
                      value={viduQ2MovementAmplitude}
                      onValueChange={(value) =>
                        setViduQ2MovementAmplitude(
                          value as "auto" | "small" | "medium" | "large"
                        )
                      }
                    >
                      <SelectTrigger id="vidu-movement" className="h-8 text-xs">
                        <SelectValue placeholder="Select motion" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="small">Small</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="large">Large</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {viduQ2Duration === 4 && (
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="vidu-bgm"
                        checked={viduQ2EnableBGM}
                        onCheckedChange={(checked) =>
                          setViduQ2EnableBGM(Boolean(checked))
                        }
                      />
                      <Label htmlFor="vidu-bgm" className="text-xs">
                        Add background music (4-second videos only)
                      </Label>
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    Pricing: 720p @ $0.05/sec • 1080p adds $0.20 base fee
                  </div>
                </div>
              )}
              {ltxv2I2VSelected && (
                <div className="space-y-3 text-left border-t pt-3">
                  <Label className="text-sm font-semibold">
                    LTX Video 2.0 Settings
                  </Label>

                  <div className="space-y-1">
                    <Label
                      htmlFor="ltxv2-i2v-duration"
                      className="text-xs font-medium"
                    >
                      Duration
                    </Label>
                    <Select
                      value={ltxv2I2VDuration.toString()}
                      onValueChange={(value) =>
                        setLTXV2I2VDuration(Number(value) as 6 | 8 | 10)
                      }
                    >
                      <SelectTrigger
                        id="ltxv2-i2v-duration"
                        className="h-8 text-xs"
                      >
                        <SelectValue placeholder="Select duration" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="6">6 seconds</SelectItem>
                        <SelectItem value="8">8 seconds</SelectItem>
                        <SelectItem value="10">10 seconds</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor="ltxv2-i2v-resolution"
                      className="text-xs font-medium"
                    >
                      Resolution
                    </Label>
                    <Select
                      value={ltxv2I2VResolution}
                      onValueChange={(value) =>
                        setLTXV2I2VResolution(
                          value as "1080p" | "1440p" | "2160p"
                        )
                      }
                    >
                      <SelectTrigger
                        id="ltxv2-i2v-resolution"
                        className="h-8 text-xs"
                      >
                        <SelectValue placeholder="Select resolution" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1080p">1080p ($0.06/sec)</SelectItem>
                        <SelectItem value="1440p">1440p ($0.12/sec)</SelectItem>
                        <SelectItem value="2160p">4K ($0.24/sec)</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="text-xs text-muted-foreground">
                      Estimated cost: $
                      {(
                        ltxv2I2VDuration *
                        (ltxv2I2VResolution === "1080p"
                          ? 0.06
                          : ltxv2I2VResolution === "1440p"
                            ? 0.12
                            : 0.24)
                      ).toFixed(2)}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor="ltxv2-i2v-fps"
                      className="text-xs font-medium"
                    >
                      Frame Rate
                    </Label>
                    <Select
                      value={ltxv2I2VFPS.toString()}
                      onValueChange={(value) =>
                        setLTXV2I2VFPS(Number(value) as 25 | 50)
                      }
                    >
                      <SelectTrigger id="ltxv2-i2v-fps" className="h-8 text-xs">
                        <SelectValue placeholder="Select frame rate" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="25">25 FPS (Standard)</SelectItem>
                        <SelectItem value="50">50 FPS (High)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="ltxv2-i2v-audio"
                      checked={ltxv2I2VGenerateAudio}
                      onCheckedChange={(checked) =>
                        setLTXV2I2VGenerateAudio(Boolean(checked))
                      }
                    />
                    <Label htmlFor="ltxv2-i2v-audio" className="text-xs">
                      Generate synchronized audio
                    </Label>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Transforms your image into a high-quality video with
                    matching audio.
                  </div>
                </div>
              )}
              {ltxv2ImageSelected && (
                <div className="space-y-3 text-left border-t pt-3">
                  <Label className="text-sm font-semibold">
                    LTX Video 2.0 Fast Settings
                  </Label>

                  <div className="space-y-1">
                    <Label
                      htmlFor="ltxv2-image-duration"
                      className="text-xs font-medium"
                    >
                      Duration
                    </Label>
                    <Select
                      value={ltxv2ImageDuration.toString()}
                      onValueChange={(value) =>
                        setLTXV2ImageDuration(
                          Number(value) as LTXV2FastDuration
                        )
                      }
                    >
                      <SelectTrigger
                        id="ltxv2-image-duration"
                        className="h-8 text-xs"
                      >
                        <SelectValue placeholder="Select duration" />
                      </SelectTrigger>
                      <SelectContent>
                        {LTXV2_FAST_CONFIG.DURATIONS.map((durationOption) => (
                          <SelectItem
                            key={durationOption}
                            value={durationOption.toString()}
                          >
                            {durationOption} seconds
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor="ltxv2-image-resolution"
                      className="text-xs font-medium"
                    >
                      Resolution
                    </Label>
                    <Select
                      value={ltxv2ImageResolution}
                      onValueChange={(value) =>
                        setLTXV2ImageResolution(value as LTXV2FastResolution)
                      }
                    >
                      <SelectTrigger
                        id="ltxv2-image-resolution"
                        className="h-8 text-xs"
                      >
                        <SelectValue placeholder="Select resolution" />
                      </SelectTrigger>
                      <SelectContent>
                        {LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD.map(
                          (resolutionOption) => {
                            const disabled =
                              isExtendedLTXV2FastImageDuration &&
                              !ltxv2FastExtendedResolutions.includes(
                                resolutionOption as (typeof ltxv2FastExtendedResolutions)[number]
                              );

                            return (
                              <SelectItem
                                key={resolutionOption}
                                value={resolutionOption}
                                disabled={disabled}
                              >
                                {LTXV2_FAST_RESOLUTION_LABELS[resolutionOption]}
                                {LTXV2_FAST_RESOLUTION_PRICE_SUFFIX[
                                  resolutionOption
                                ] ?? ""}
                              </SelectItem>
                            );
                          }
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="ltxv2-image-fps" className="text-xs">
                      Frame Rate
                    </Label>
                    <Select
                      value={ltxv2ImageFPS.toString()}
                      onValueChange={(value) =>
                        setLTXV2ImageFPS(Number(value) as LTXV2FastFps)
                      }
                    >
                      <SelectTrigger
                        id="ltxv2-image-fps"
                        className="h-8 text-xs"
                      >
                        <SelectValue placeholder="Select frame rate" />
                      </SelectTrigger>
                      <SelectContent>
                        {LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD.map(
                          (fpsOption) => {
                            const disabled =
                              isExtendedLTXV2FastImageDuration &&
                              !ltxv2FastExtendedFps.includes(
                                fpsOption as (typeof ltxv2FastExtendedFps)[number]
                              );

                            return (
                              <SelectItem
                                key={fpsOption}
                                value={fpsOption.toString()}
                                disabled={disabled}
                              >
                                {LTXV2_FAST_FPS_LABELS[fpsOption]}
                              </SelectItem>
                            );
                          }
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="ltxv2-image-audio"
                      checked={ltxv2ImageGenerateAudio}
                      onCheckedChange={(checked) =>
                        setLTXV2ImageGenerateAudio(Boolean(checked))
                      }
                    />
                    <Label htmlFor="ltxv2-image-audio" className="text-xs">
                      Generate audio
                    </Label>
                  </div>

                  {isExtendedLTXV2FastImageDuration && (
                    <div className="text-xs text-muted-foreground">
                      {ERROR_MESSAGES.LTXV2_I2V_EXTENDED_DURATION_CONSTRAINT}
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    6-20 second clips with optional audio at up to 4K. Longer
                    clips automatically use 1080p at 25 FPS.
                  </div>
                </div>
              )}
              {ltxv2FastTextSelected && (
                <div className="space-y-3 text-left border-t pt-3">
                  <Label className="text-sm font-semibold">
                    LTX Video 2.0 Fast Settings
                  </Label>

                  <div className="space-y-1">
                    <Label
                      htmlFor="ltxv2-fast-duration"
                      className="text-xs font-medium"
                    >
                      Duration
                    </Label>
                    <Select
                      value={ltxv2FastDuration.toString()}
                      onValueChange={(value) =>
                        setLTXV2FastDuration(Number(value) as LTXV2FastDuration)
                      }
                    >
                      <SelectTrigger
                        id="ltxv2-fast-duration"
                        className="h-8 text-xs"
                      >
                        <SelectValue placeholder="Select duration" />
                      </SelectTrigger>
                      <SelectContent>
                        {LTXV2_FAST_CONFIG.DURATIONS.map((durationOption) => (
                          <SelectItem
                            key={durationOption}
                            value={durationOption.toString()}
                          >
                            {durationOption} seconds
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor="ltxv2-fast-resolution"
                      className="text-xs font-medium"
                    >
                      Resolution
                    </Label>
                    <Select
                      value={ltxv2FastResolution}
                      onValueChange={(value) =>
                        setLTXV2FastResolution(value as LTXV2FastResolution)
                      }
                    >
                      <SelectTrigger
                        id="ltxv2-fast-resolution"
                        className="h-8 text-xs"
                      >
                        <SelectValue placeholder="Select resolution" />
                      </SelectTrigger>
                      <SelectContent>
                        {LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD.map(
                          (resolutionOption) => {
                            const disabled =
                              isExtendedLTXV2FastTextDuration &&
                              !ltxv2FastExtendedResolutions.includes(
                                resolutionOption as (typeof ltxv2FastExtendedResolutions)[number]
                              );

                            return (
                              <SelectItem
                                key={resolutionOption}
                                value={resolutionOption}
                                disabled={disabled}
                              >
                                {LTXV2_FAST_RESOLUTION_LABELS[resolutionOption]}
                                {LTXV2_FAST_RESOLUTION_PRICE_SUFFIX[
                                  resolutionOption
                                ] ?? ""}
                              </SelectItem>
                            );
                          }
                        )}
                      </SelectContent>
                    </Select>
                    <div className="text-xs text-muted-foreground">
                      Estimated cost: $
                      {(
                        ltxv2FastDuration *
                        (LTXV2_FAST_CONFIG.PRICING[ltxv2FastResolution] ?? 0)
                      ).toFixed(2)}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor="ltxv2-fast-fps"
                      className="text-xs font-medium"
                    >
                      Frame Rate
                    </Label>
                    <Select
                      value={ltxv2FastFPS.toString()}
                      onValueChange={(value) =>
                        setLTXV2FastFPS(Number(value) as LTXV2FastFps)
                      }
                    >
                      <SelectTrigger
                        id="ltxv2-fast-fps"
                        className="h-8 text-xs"
                      >
                        <SelectValue placeholder="Select frame rate" />
                      </SelectTrigger>
                      <SelectContent>
                        {LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD.map(
                          (fpsOption) => {
                            const disabled =
                              isExtendedLTXV2FastTextDuration &&
                              !ltxv2FastExtendedFps.includes(
                                fpsOption as (typeof ltxv2FastExtendedFps)[number]
                              );

                            return (
                              <SelectItem
                                key={fpsOption}
                                value={fpsOption.toString()}
                                disabled={disabled}
                              >
                                {LTXV2_FAST_FPS_LABELS[fpsOption]}
                              </SelectItem>
                            );
                          }
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="ltxv2-fast-audio"
                      checked={ltxv2FastGenerateAudio}
                      onCheckedChange={(checked) =>
                        setLTXV2FastGenerateAudio(Boolean(checked))
                      }
                    />
                    <Label htmlFor="ltxv2-fast-audio" className="text-xs">
                      Generate audio
                    </Label>
                  </div>

                  {isExtendedLTXV2FastTextDuration && (
                    <div className="text-xs text-muted-foreground">
                      {
                        ERROR_MESSAGES.LTXV2_FAST_T2V_EXTENDED_DURATION_CONSTRAINT
                      }
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    6-20 second clips with optional audio at up to 4K. Longer
                    clips automatically use 1080p at 25 FPS.
                  </div>
                </div>
              )}
              {seedanceSelected && (
                <div className="space-y-3 text-left border-t pt-3">
                  <Label className="text-sm font-semibold">
                    Seedance Settings
                  </Label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="seedance-duration" className="text-xs">
                        Duration
                      </Label>
                      <Select
                        value={seedanceDuration.toString()}
                        onValueChange={(value) =>
                          setSeedanceDuration(Number(value) as SeedanceDuration)
                        }
                      >
                        <SelectTrigger
                          id="seedance-duration"
                          className="h-8 text-xs"
                        >
                          <SelectValue placeholder="Select duration" />
                        </SelectTrigger>
                        <SelectContent>
                          {seedanceDurationOptions.map((durationOption) => (
                            <SelectItem
                              key={durationOption}
                              value={durationOption.toString()}
                            >
                              {durationOption} seconds
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="seedance-resolution" className="text-xs">
                        Resolution
                      </Label>
                      <Select
                        value={seedanceResolution}
                        onValueChange={(value) =>
                          setSeedanceResolution(value as SeedanceResolution)
                        }
                      >
                        <SelectTrigger
                          id="seedance-resolution"
                          className="h-8 text-xs"
                        >
                          <SelectValue placeholder="Select resolution" />
                        </SelectTrigger>
                        <SelectContent>
                          {seedanceResolutionOptions.map((resolutionOption) => (
                            <SelectItem key={resolutionOption} value={resolutionOption}>
                              {resolutionOption.toUpperCase()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="seedance-aspect" className="text-xs">
                      Aspect Ratio
                    </Label>
                    <Select
                      value={seedanceAspectRatio}
                      onValueChange={(value) =>
                        setSeedanceAspectRatio(value as SeedanceAspectRatio)
                      }
                    >
                      <SelectTrigger
                        id="seedance-aspect"
                        className="h-8 text-xs"
                      >
                        <SelectValue placeholder="Select aspect ratio" />
                      </SelectTrigger>
                      <SelectContent>
                        {seedanceAspectRatioOptions.map((ratio) => (
                          <SelectItem key={ratio} value={ratio}>
                            {ratio.toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="seedance-camera-fixed"
                      checked={seedanceCameraFixed}
                      onCheckedChange={(checked) =>
                        setSeedanceCameraFixed(Boolean(checked))
                      }
                    />
                    <Label htmlFor="seedance-camera-fixed" className="text-xs">
                      Lock camera position
                    </Label>
                  </div>

                  {seedanceProSelected && (
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">
                        End Frame (optional)
                      </Label>
                      <Input
                        id="seedance-end-frame-url"
                        type="url"
                        value={seedanceEndFrameUrl ?? ""}
                        onChange={(event) =>
                          setSeedanceEndFrameUrl(
                            event.target.value ? event.target.value : undefined
                          )
                        }
                        placeholder="https://example.com/final-frame.png"
                        className="h-8 text-xs"
                      />
                      <FileUpload
                        id="seedance-end-frame-upload"
                        label="Upload End Frame"
                        helperText="Optional reference for the final frame"
                        fileType="image"
                        acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_IMAGE_TYPES}
                        maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
                        maxSizeLabel={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
                        formatsLabel={UPLOAD_CONSTANTS.IMAGE_FORMATS_LABEL}
                        file={seedanceEndFrameFile}
                        preview={seedanceEndFramePreview}
                        onFileChange={(file, preview) => {
                          setSeedanceEndFrameFile(file);
                          setSeedanceEndFramePreview(preview || null);
                          if (file) {
                            setSeedanceEndFrameUrl(undefined);
                          }
                        }}
                        onError={setError}
                        isCompact={isCompact}
                      />
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground">
                    Estimated cost: ${seedanceEstimatedCost.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Seedance animates 2-12 second clips with reproducible seeds
                    and optional end frames (Pro only).
                  </div>
                </div>
              )}
              {klingI2VSelected && (
                <div className="space-y-3 text-left border-t pt-3">
                  <Label className="text-sm font-semibold">
                    Kling v2.5 Turbo Settings
                  </Label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="kling-duration" className="text-xs">
                        Duration
                      </Label>
                      <Select
                        value={klingDuration.toString()}
                        onValueChange={(value) =>
                          setKlingDuration(Number(value) as 5 | 10)
                        }
                      >
                        <SelectTrigger
                          id="kling-duration"
                          className="h-8 text-xs"
                        >
                          <SelectValue placeholder="Select duration" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="5">5 seconds ($0.35)</SelectItem>
                          <SelectItem value="10">10 seconds ($0.70)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="kling-aspect" className="text-xs">
                        Aspect Ratio
                      </Label>
                      <Select
                        value={klingAspectRatio}
                        onValueChange={(value) =>
                          setKlingAspectRatio(value as KlingAspectRatio)
                        }
                      >
                        <SelectTrigger
                          id="kling-aspect"
                          className="h-8 text-xs"
                        >
                          <SelectValue placeholder="Select aspect ratio" />
                        </SelectTrigger>
                        <SelectContent>
                          {klingAspectRatios.map((ratio) => (
                            <SelectItem key={ratio} value={ratio}>
                              {ratio.toUpperCase()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="kling-cfg" className="text-xs">
                      Prompt Adherence ({klingCfgScale.toFixed(1)})
                    </Label>
                    <input
                      id="kling-cfg"
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={klingCfgScale}
                      onChange={(event) =>
                        setKlingCfgScale(Number(event.target.value))
                      }
                      className="w-full cursor-pointer"
                    />
                    <div className="text-xs text-muted-foreground">
                      Lower values add more freedom, higher values follow the
                      prompt closely.
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="kling-enhance-prompt"
                      checked={klingEnhancePrompt}
                      onCheckedChange={(checked) =>
                        setKlingEnhancePrompt(Boolean(checked))
                      }
                    />
                    <Label htmlFor="kling-enhance-prompt" className="text-xs">
                      Enhance prompt with AI
                    </Label>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="kling-negative-prompt" className="text-xs">
                      Negative Prompt (optional)
                    </Label>
                    <Textarea
                      id="kling-negative-prompt"
                      value={klingNegativePrompt}
                      onChange={(event) => setKlingNegativePrompt(event.target.value)}
                      placeholder="blur, distort, low quality"
                      className="min-h-[60px] text-xs"
                      maxLength={2500}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Estimated cost: ${klingEstimatedCost.toFixed(2)}
                  </div>
                </div>
              )}
              {wan25Selected && (
                <div className="space-y-3 text-left border-t pt-3">
                  <Label className="text-sm font-semibold">
                    WAN 2.5 Preview Settings
                  </Label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="wan25-duration" className="text-xs">
                        Duration
                      </Label>
                      <Select
                        value={wan25Duration.toString()}
                        onValueChange={(value) =>
                          setWan25Duration(Number(value) as Wan25Duration)
                        }
                      >
                        <SelectTrigger
                          id="wan25-duration"
                          className="h-8 text-xs"
                        >
                          <SelectValue placeholder="Select duration" />
                        </SelectTrigger>
                        <SelectContent>
                          {wan25DurationOptions.map((durationOption) => (
                            <SelectItem
                              key={durationOption}
                              value={durationOption.toString()}
                            >
                              {durationOption} seconds
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="wan25-resolution" className="text-xs">
                        Resolution
                      </Label>
                      <Select
                        value={wan25Resolution}
                        onValueChange={(value) =>
                          setWan25Resolution(value as Wan25Resolution)
                        }
                      >
                        <SelectTrigger
                          id="wan25-resolution"
                          className="h-8 text-xs"
                        >
                          <SelectValue placeholder="Select resolution" />
                        </SelectTrigger>
                        <SelectContent>
                          {wan25ResolutionOptions.map((resolutionOption) => (
                            <SelectItem key={resolutionOption} value={resolutionOption}>
                              {resolutionOption.toUpperCase()} (
                              ${wan25ModelConfig?.perSecondPricing?.[resolutionOption] ??
                              0}
                              /sec)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="wan25-enhance-prompt"
                      checked={wan25EnablePromptExpansion}
                      onCheckedChange={(checked) =>
                        setWan25EnablePromptExpansion(Boolean(checked))
                      }
                    />
                    <Label htmlFor="wan25-enhance-prompt" className="text-xs">
                      Enhance prompt with AI
                    </Label>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="wan25-negative" className="text-xs">
                      Negative Prompt (max 500 characters)
                    </Label>
                    <Textarea
                      id="wan25-negative"
                      value={wan25NegativePrompt}
                      onChange={(event) =>
                        setWan25NegativePrompt(event.target.value.slice(0, 500))
                      }
                      placeholder="Avoid blurry, shaky motion..."
                      className="min-h-[60px] text-xs"
                      maxLength={500}
                    />
                    <div className="text-xs text-muted-foreground">
                      {wan25NegativePrompt.length}/500 characters
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-medium">
                      Background Music (optional)
                    </Label>
                    <Input
                      type="url"
                      value={wan25AudioUrl ?? ""}
                      onChange={(event) =>
                        setWan25AudioUrl(
                          event.target.value ? event.target.value : undefined
                        )
                      }
                      placeholder="https://example.com/music.mp3"
                      className="h-8 text-xs"
                    />
                    <FileUpload
                      id="wan25-audio-upload"
                      label="Upload Audio"
                      helperText="MP3/WAV between 3-30 seconds (max 15MB)"
                      fileType="audio"
                      acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_AUDIO_TYPES}
                      maxSizeBytes={15 * 1024 * 1024}
                      maxSizeLabel="15MB"
                      formatsLabel={UPLOAD_CONSTANTS.AUDIO_FORMATS_LABEL}
                      file={wan25AudioFile}
                      preview={wan25AudioPreview}
                      onFileChange={(file, preview) => {
                        setWan25AudioFile(file);
                        setWan25AudioPreview(preview || null);
                        if (file) {
                          setWan25AudioUrl(undefined);
                        }
                      }}
                      onError={setError}
                      isCompact={isCompact}
                    />
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Estimated cost: ${wan25EstimatedCost.toFixed(2)} (
                    ${wan25PricePerSecond.toFixed(2)}/sec)
                  </div>
                </div>
              )}
              {(seedanceSelected || wan25Selected) && (
                <div className="space-y-2 text-left border-t pt-3">
                  <Label className="text-sm font-semibold">
                    Advanced Options
                  </Label>
                  <div className="space-y-1">
                    <Label htmlFor="image-seed" className="text-xs">
                      Seed (optional)
                    </Label>
                    <Input
                      id="image-seed"
                      type="number"
                      value={imageSeed ?? ""}
                      onChange={(event) => {
                        const nextValue = event.target.value.trim();
                        if (!nextValue) {
                          setImageSeed(undefined);
                          return;
                        }
                        const parsed = Number(nextValue);
                        if (!Number.isNaN(parsed)) {
                          setImageSeed(parsed);
                        }
                      }}
                      placeholder="Enter seed for reproducible animation"
                      className="h-8 text-xs"
                    />
                    <div className="text-xs text-muted-foreground">
                      Use the same seed to reproduce motion across runs.
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="avatar" className="space-y-4">
              {/* Avatar Image Upload */}
              <FileUpload
                id="avatar-image-input"
                label="Character Image"
                helperText="Required"
                fileType="image"
                acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_AVATAR_IMAGE_TYPES}
                maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
                maxSizeLabel={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
                formatsLabel={UPLOAD_CONSTANTS.AVATAR_IMAGE_FORMATS_LABEL}
                file={avatarImage}
                preview={avatarImagePreview}
                onFileChange={(file, preview) => {
                  setAvatarImage(file);
                  setAvatarImagePreview(preview || null);
                  if (file) setError(null);
                }}
                onError={setError}
                isCompact={isCompact}
              />

              {/* Audio File Upload (for Kling models) */}
              <FileUpload
                id="avatar-audio-input"
                label="Audio File"
                helperText="For Kling Avatar models"
                fileType="audio"
                acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_AUDIO_TYPES}
                maxSizeBytes={UPLOAD_CONSTANTS.MAX_AUDIO_SIZE_BYTES}
                maxSizeLabel={UPLOAD_CONSTANTS.MAX_AUDIO_SIZE_LABEL}
                formatsLabel={UPLOAD_CONSTANTS.AUDIO_FORMATS_LABEL}
                file={audioFile}
                onFileChange={(file) => {
                  setAudioFile(file);
                  if (file) setError(null);
                }}
                onError={setError}
                isCompact={isCompact}
              />

              {/* Source Video Upload (for WAN animate/replace) */}
              <FileUpload
                id="avatar-video-input"
                label="Source Video"
                helperText="For WAN Animate/Replace"
                fileType="video"
                acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_VIDEO_TYPES}
                maxSizeBytes={UPLOAD_CONSTANTS.MAX_VIDEO_SIZE_BYTES}
                maxSizeLabel={UPLOAD_CONSTANTS.MAX_VIDEO_SIZE_LABEL}
                formatsLabel={UPLOAD_CONSTANTS.VIDEO_FORMATS_LABEL}
                file={sourceVideo}
                onFileChange={(file) => {
                  setSourceVideo(file);
                  if (file) setError(null);
                }}
                onError={setError}
                isCompact={isCompact}
              />

              {/* Optional Prompt for Avatar */}
              <div className="space-y-2">
                <Label htmlFor="avatar-prompt" className="text-xs">
                  {!isCompact && "Additional "}Prompt{" "}
                  {!isCompact && "(optional)"}
                </Label>
                <Textarea
                  id="avatar-prompt"
                  placeholder={
                    isCompact
                      ? "Describe the avatar style..."
                      : "Describe the desired avatar style or motion..."
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[40px] text-xs resize-none"
                  maxLength={maxChars}
                />
              </div>
            </TabsContent>
            <TabsContent value="upscale" className="space-y-4">
              <div className="space-y-3 text-left">
                <Label className="text-sm font-semibold">
                  Upload Video for Upscaling
                </Label>
                <FileUpload
                  id="upscale-video-upload"
                  label="Upload Source Video"
                  helperText={`MP4, MOV, or AVI up to ${UPLOAD_CONSTANTS.UPSCALE_MAX_VIDEO_SIZE_LABEL}, max 2 minutes`}
                  fileType="video"
                  acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_VIDEO_TYPES}
                  maxSizeBytes={UPLOAD_CONSTANTS.UPSCALE_MAX_VIDEO_SIZE_BYTES}
                  maxSizeLabel={UPLOAD_CONSTANTS.UPSCALE_MAX_VIDEO_SIZE_LABEL}
                  formatsLabel={UPLOAD_CONSTANTS.VIDEO_FORMATS_LABEL}
                  file={sourceVideoFile}
                  preview={null}
                  onFileChange={(file) => {
                    handleUpscaleVideoChange(file).catch(() => {
                      // Error already handled within the function
                    });
                  }}
                  onError={setError}
                  isCompact={isCompact}
                />
                {videoMetadata && (
                  <div className="text-xs text-muted-foreground">
                    Detected: {videoMetadata.width}x{videoMetadata.height} ·{" "}
                    {(videoMetadata.duration ?? 0).toFixed(1)}s ·{" "}
                    {Math.round(videoMetadata.fps ?? 30)} FPS
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  Or provide video URL:
                </div>
                <Input
                  type="url"
                  value={sourceVideoUrl}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSourceVideoUrl(value);
                    if (value) {
                      setSourceVideoFile(null);
                    } else {
                      setVideoMetadata(null);
                    }
                  }}
                  onBlur={() => {
                    handleUpscaleVideoUrlBlur().catch(() => {
                      // Error already handled within the function
                    });
                  }}
                  placeholder="https://example.com/video.mp4"
                  className="h-8 text-xs"
                />
              </div>

              {bytedanceUpscalerSelected && (
                <div className="space-y-3 text-left border-t pt-3">
                  <Label className="text-sm font-semibold">
                    ByteDance Upscaler Settings
                  </Label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="bytedance-resolution" className="text-xs">
                        Target Resolution
                      </Label>
                      <Select
                        value={bytedanceTargetResolution}
                        onValueChange={(value) =>
                          setBytedanceTargetResolution(
                            value as "1080p" | "2k" | "4k"
                          )
                        }
                      >
                        <SelectTrigger
                          id="bytedance-resolution"
                          className="h-8 text-xs"
                        >
                          <SelectValue placeholder="Select resolution" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1080p">
                            1080p (Full HD)
                          </SelectItem>
                          <SelectItem value="2k">2K (2560x1440)</SelectItem>
                          <SelectItem value="4k">4K (3840x2160)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="bytedance-fps" className="text-xs">
                        Target Frame Rate
                      </Label>
                      <Select
                        value={bytedanceTargetFPS}
                        onValueChange={(value) =>
                          setBytedanceTargetFPS(value as "30fps" | "60fps")
                        }
                      >
                        <SelectTrigger
                          id="bytedance-fps"
                          className="h-8 text-xs"
                        >
                          <SelectValue placeholder="Select FPS" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="30fps">30 FPS</SelectItem>
                          <SelectItem value="60fps">
                            60 FPS (2x cost)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Estimated cost (per clip): {bytedanceEstimatedCost}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    AI-powered upscaling to 1080p, 2K, or 4K with optional 60fps
                    enhancement.
                  </div>
                </div>
              )}

              {flashvsrUpscalerSelected && (
                <Card className="space-y-4 border p-4">
                  <div>
                    <h4 className="text-sm font-semibold">
                      FlashVSR Upscaler Settings
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Fastest video upscaling with fine-grained quality control.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">
                      Upscale Factor: {flashvsrUpscaleFactor.toFixed(1)}x
                    </Label>
                    <Slider
                      min={1}
                      max={4}
                      step={0.1}
                      value={[flashvsrUpscaleFactor]}
                      onValueChange={(value) =>
                        setFlashvsrUpscaleFactor(
                          Number((value[0] ?? 1).toFixed(1))
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Continuous scale from 1x to 4x
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Acceleration Mode</Label>
                    <Select
                      value={flashvsrAcceleration}
                      onValueChange={(value) =>
                        setFlashvsrAcceleration(
                          value as "regular" | "high" | "full"
                        )
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select acceleration" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="regular">
                          Regular (Best quality)
                        </SelectItem>
                        <SelectItem value="high">
                          High (30-40% faster)
                        </SelectItem>
                        <SelectItem value="full">
                          Full (50-60% faster)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">
                      Quality: {flashvsrQuality}
                    </Label>
                    <Slider
                      min={0}
                      max={100}
                      step={5}
                      value={[flashvsrQuality]}
                      onValueChange={(value) =>
                        setFlashvsrQuality(Math.round(value[0] ?? 70))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Tile blending quality (0-100)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Output Format</Label>
                    <Select
                      value={flashvsrOutputFormat}
                      onValueChange={(value) =>
                        setFlashvsrOutputFormat(
                          value as "X264" | "VP9" | "PRORES4444" | "GIF"
                        )
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select format" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="X264">
                          X264 (.mp4) - Standard
                        </SelectItem>
                        <SelectItem value="VP9">
                          VP9 (.webm) - Modern codec
                        </SelectItem>
                        <SelectItem value="PRORES4444">
                          ProRes 4444 (.mov) - Professional
                        </SelectItem>
                        <SelectItem value="GIF">GIF (.gif) - Animated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Output Quality</Label>
                    <Select
                      value={flashvsrOutputQuality}
                      onValueChange={(value) =>
                        setFlashvsrOutputQuality(
                          value as "low" | "medium" | "high" | "maximum"
                        )
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select quality" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="maximum">Maximum</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Encoding Mode</Label>
                    <Select
                      value={flashvsrOutputWriteMode}
                      onValueChange={(value) =>
                        setFlashvsrOutputWriteMode(
                          value as "fast" | "balanced" | "small"
                        )
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select encoding profile" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fast">
                          Fast (Faster encoding)
                        </SelectItem>
                        <SelectItem value="balanced">
                          Balanced (Default)
                        </SelectItem>
                        <SelectItem value="small">
                          Small (Smaller file size)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="flashvsr-color-fix"
                        checked={flashvsrColorFix}
                        onCheckedChange={(checked) =>
                          setFlashvsrColorFix(Boolean(checked))
                        }
                      />
                      <Label htmlFor="flashvsr-color-fix" className="text-xs">
                        Apply color correction
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="flashvsr-preserve-audio"
                        checked={flashvsrPreserveAudio}
                        onCheckedChange={(checked) =>
                          setFlashvsrPreserveAudio(Boolean(checked))
                        }
                      />
                      <Label
                        htmlFor="flashvsr-preserve-audio"
                        className="text-xs"
                      >
                        Preserve audio track
                      </Label>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Seed (optional)</Label>
                    <Input
                      type="number"
                      value={flashvsrSeed ?? ""}
                      onChange={(e) =>
                        setFlashvsrSeed(
                          e.target.value
                            ? Number.parseInt(e.target.value, 10)
                            : undefined
                        )
                      }
                      placeholder="Random seed for reproducibility"
                      className="h-8 text-xs"
                    />
                  </div>

                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      Estimated cost:{" "}
                      <span className="font-semibold">
                        {flashvsrEstimatedCost}
                      </span>
                    </div>
                    <p>
                      Based on output megapixels: (width × factor) × (height ×
                      factor) × frames × $0.0005 / 1,000,000.
                    </p>
                  </div>
                </Card>
              )}

              {topazUpscalerSelected && (
                <Card className="space-y-4 border p-4">
                  <div>
                    <h4 className="text-sm font-semibold">
                      Topaz Video Upscale Settings
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Professional-grade upscaling up to 8x.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">
                      Upscale Factor: {topazUpscaleFactor}x
                    </Label>
                    <Slider
                      min={2}
                      max={8}
                      step={1}
                      value={[topazUpscaleFactor]}
                      onValueChange={(value) =>
                        setTopazUpscaleFactor(
                          Math.max(2, Math.min(8, Math.round(value[0] ?? 2)))
                        )
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Higher factor = better quality but longer processing
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="topaz-interpolated"
                      checked={topazTargetFPS === "interpolated"}
                      onCheckedChange={(checked) =>
                        setTopazTargetFPS(
                          checked ? "interpolated" : "original"
                        )
                      }
                    />
                    <Label htmlFor="topaz-interpolated" className="text-xs">
                      Enable frame interpolation
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="topaz-h264"
                      checked={topazH264Output}
                      onCheckedChange={(checked) =>
                        setTopazH264Output(Boolean(checked))
                      }
                    />
                    <Label htmlFor="topaz-h264" className="text-xs">
                      Export H.264 output
                    </Label>
                  </div>

                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      Estimated cost:{" "}
                      <span className="font-semibold">
                        {calculateTopazUpscaleCost(topazUpscaleFactor)}
                      </span>
                    </div>
                    <div>Processing time: 30-60 seconds</div>
                  </div>
                </Card>
              )}
        </TabsContent>
      </Tabs>

      {/* Primary action controls surfaced above model list for quicker access */}
      <div className="space-y-2 pt-2">
        <Button
          type="button"
          onClick={generation.handleGenerate}
          disabled={!generation.canGenerate}
          className="w-full"
          size={isCompact ? "sm" : "lg"}
        >
          {generation.isGenerating ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              {isCompact
                ? "Generating..."
                : activeTab === "avatar"
                  ? "Generating Avatar..."
                  : "Generating Video..."}
            </>
          ) : (
            <>
              <BotIcon className="size-4 mr-2" />
              {(() => {
                const count = selectedModels.length;
                const countLabel =
                  count > 0
                    ? `Generate with ${count} ${count === 1 ? "Model" : "Models"}`
                    : "Generate Video";
                if (isCompact) {
                  return count > 0 ? `Generate (${count})` : "Generate";
                }
                if (activeTab === "avatar") {
                  return count > 0
                    ? `Generate Avatar (${count})`
                    : "Generate Avatar";
                }
                return countLabel;
              })()}
            </>
          )}
        </Button>

        {/* Mock generation for testing */}
        {process.env.NODE_ENV === "development" && (
          <Button
            type="button"
            onClick={generation.handleMockGenerate}
            disabled={!generation.canGenerate}
            className="w-full"
            size="lg"
            variant="outline"
          >
            🧪 Mock Generate (Dev)
          </Button>
        )}

        {/* Reset button */}
        {(generation.hasResults || error) && (
          <Button
            type="button"
            onClick={resetGenerationState}
            variant="outline"
            size="sm"
            className="w-full"
          >
            <X className="size-3 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {/* AI Model Selection */}
      <div className="space-y-2">
        <Label className="text-xs">
          {!isCompact && "Select "}AI Models
          {!isCompact && " (multi-select)"}
            </Label>
            <div className="space-y-1">
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
                return false;
              }).map((model) => {
                const inputId = `ai-model-${model.id}`;
                const selected = isModelSelected(model.id);
                return (
                  <label
                    key={model.id}
                    htmlFor={inputId}
                    className={`w-full flex items-center justify-between p-2 rounded-md border transition-colors cursor-pointer focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/50"
                    }`}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      className="sr-only"
                      checked={selected}
                      onChange={() => toggleModel(model.id)}
                      aria-label={`Select ${model.name}`}
                    />
                    <div className="flex items-center space-x-2">
                      <div
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                          selected
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/30"
                        }`}
                      >
                        {selected && (
                          <Check className="w-2.5 h-2.5 text-primary-foreground" />
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-medium">{model.name}</div>
                        {!isCompact && (
                          <div className="text-xs text-muted-foreground">
                            {model.description}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-right">
                      <div>${model.price}</div>
                      {!isCompact && (
                        <div className="text-muted-foreground">
                          {model.resolution}
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Cost display */}
            {selectedModels.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground text-right">
                  Total estimated cost:{" "}
                  <span className="font-medium">${totalCost.toFixed(2)}</span>
                </div>
                {hasRemixSelected && (
                  <div className="text-xs text-orange-500 text-right">
                    Note: Remix pricing varies by source video duration
                  </div>
                )}
                {selectedModels.some((id) => id === "reve-text-to-image") && (
                  <div className="text-xs text-muted-foreground text-right">
                    <span className="font-medium">Reve Cost:</span> $
                    {(
                      REVE_TEXT_TO_IMAGE_MODEL.pricing.perImage * reveNumImages
                    ).toFixed(2)}
                    {reveNumImages > 1 && (
                      <span className="ml-1 opacity-75">
                        ({REVE_TEXT_TO_IMAGE_MODEL.pricing.perImage.toFixed(2)}{" "}
                        × {reveNumImages} images)
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sora 2 Settings Panel - Only shows when Sora 2 models selected */}
          {generation.isSora2Selected && (
            <div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
              <Label className="text-xs font-medium">Sora 2 Settings</Label>

              {/* Duration selector */}
              <div className="space-y-1">
                <Label htmlFor="sora2-duration" className="text-xs">
                  Duration
                </Label>
                <Select
                  value={generation.duration.toString()}
                  onValueChange={(v) =>
                    generation.setDuration(Number(v) as 4 | 8 | 12)
                  }
                >
                  <SelectTrigger id="sora2-duration" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">
                      4 seconds{" "}
                      {generation.hasSora2Pro
                        ? generation.resolution === "1080p"
                          ? "($0.50/s)"
                          : "($0.30/s)"
                        : "($0.10/s)"}
                    </SelectItem>
                    <SelectItem value="8">
                      8 seconds{" "}
                      {generation.hasSora2Pro
                        ? generation.resolution === "1080p"
                          ? "($0.50/s)"
                          : "($0.30/s)"
                        : "($0.10/s)"}
                    </SelectItem>
                    <SelectItem value="12">
                      12 seconds{" "}
                      {generation.hasSora2Pro
                        ? generation.resolution === "1080p"
                          ? "($0.50/s)"
                          : "($0.30/s)"
                        : "($0.10/s)"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Aspect ratio selector */}
              <div className="space-y-1">
                <Label htmlFor="sora2-aspect" className="text-xs">
                  Aspect Ratio
                </Label>
                <Select
                  value={generation.aspectRatio}
                  onValueChange={(v) =>
                    generation.setAspectRatio(v as "16:9" | "9:16")
                  }
                >
                  <SelectTrigger id="sora2-aspect" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                    <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Resolution selector - only for Pro models */}
              {generation.hasSora2Pro && (
                <div className="space-y-1">
                  <Label htmlFor="sora2-resolution" className="text-xs">
                    Resolution (Pro)
                  </Label>
                  <Select
                    value={generation.resolution}
                    onValueChange={(v) => generation.setResolution(v as any)}
                  >
                    <SelectTrigger
                      id="sora2-resolution"
                      className="h-8 text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="720p">720p ($0.30/s)</SelectItem>
                      <SelectItem value="1080p">1080p ($0.50/s)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Veo 3.1 Settings Panel - Only shows when Veo 3.1 models selected */}
          {generation.isVeo31Selected && (
            <div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
              <Label className="text-xs font-medium">Veo 3.1 Settings</Label>

              {/* Resolution selector */}
              <div className="space-y-1">
                <Label htmlFor="veo31-resolution" className="text-xs">
                  Resolution
                </Label>
                <Select
                  value={generation.veo31Settings.resolution}
                  onValueChange={(v) =>
                    generation.setVeo31Resolution(v as "720p" | "1080p")
                  }
                >
                  <SelectTrigger id="veo31-resolution" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="720p">720p</SelectItem>
                    <SelectItem value="1080p">1080p</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Duration selector */}
              <div className="space-y-1">
                <Label htmlFor="veo31-duration" className="text-xs">
                  Duration
                </Label>
                <Select
                  value={generation.veo31Settings.duration}
                  onValueChange={(v) =>
                    generation.setVeo31Duration(v as "4s" | "6s" | "8s")
                  }
                >
                  <SelectTrigger id="veo31-duration" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4s">
                      4 seconds (
                      {generation.veo31Settings.generateAudio
                        ? "$0.60 Fast / $1.60 Std"
                        : "$0.40 Fast / $0.80 Std"}
                      )
                    </SelectItem>
                    <SelectItem value="6s">
                      6 seconds (
                      {generation.veo31Settings.generateAudio
                        ? "$0.90 Fast / $2.40 Std"
                        : "$0.60 Fast / $1.20 Std"}
                      )
                    </SelectItem>
                    <SelectItem value="8s">
                      8 seconds (
                      {generation.veo31Settings.generateAudio
                        ? "$1.20 Fast / $3.20 Std"
                        : "$0.80 Fast / $1.60 Std"}
                      )
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Aspect ratio selector */}
              <div className="space-y-1">
                <Label htmlFor="veo31-aspect" className="text-xs">
                  Aspect Ratio
                </Label>
                <Select
                  value={generation.veo31Settings.aspectRatio}
                  onValueChange={(v) =>
                    generation.setVeo31AspectRatio(
                      v as "9:16" | "16:9" | "1:1" | "auto"
                    )
                  }
                >
                  <SelectTrigger id="veo31-aspect" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                    <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                    <SelectItem value="1:1">1:1 (Square)</SelectItem>
                    <SelectItem value="auto">Auto</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Audio toggle */}
              <div className="flex items-center justify-between">
                <Label htmlFor="veo31-audio" className="text-xs">
                  Generate Audio
                </Label>
                <input
                  id="veo31-audio"
                  type="checkbox"
                  checked={generation.veo31Settings.generateAudio}
                  onChange={(e) =>
                    generation.setVeo31GenerateAudio(e.target.checked)
                  }
                  className="h-4 w-4"
                />
              </div>

              {/* Enhance prompt toggle */}
              <div className="flex items-center justify-between">
                <Label htmlFor="veo31-enhance" className="text-xs">
                  Enhance Prompt
                </Label>
                <input
                  id="veo31-enhance"
                  type="checkbox"
                  checked={generation.veo31Settings.enhancePrompt}
                  onChange={(e) =>
                    generation.setVeo31EnhancePrompt(e.target.checked)
                  }
                  className="h-4 w-4"
                />
              </div>

              {/* Auto-fix toggle */}
              <div className="flex items-center justify-between">
                <Label htmlFor="veo31-autofix" className="text-xs">
                  Auto Fix (Policy Compliance)
                </Label>
                <input
                  id="veo31-autofix"
                  type="checkbox"
                  checked={generation.veo31Settings.autoFix}
                  onChange={(e) => generation.setVeo31AutoFix(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>
            </div>
          )}

          {/* Reve Text-to-Image Settings */}
          {selectedModels.some((id) => id === "reve-text-to-image") && (
            <div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
              <Label className="text-xs font-medium">
                Reve Text-to-Image Settings
              </Label>

              {/* Aspect Ratio Selector */}
              <div className="space-y-1">
                <Label htmlFor="reve-aspect" className="text-xs">
                  Aspect Ratio
                </Label>
                <Select
                  value={reveAspectRatio}
                  onValueChange={(value) =>
                    setReveAspectRatio(value as ReveAspectRatioOption)
                  }
                >
                  <SelectTrigger id="reve-aspect" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REVE_TEXT_TO_IMAGE_MODEL.aspectRatios.map(
                      ({ value, label }) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Number of Images */}
              <div className="space-y-1">
                <Label htmlFor="reve-num-images" className="text-xs">
                  Number of Images
                </Label>
                <Select
                  value={String(reveNumImages)}
                  onValueChange={(v) => setReveNumImages(Number(v))}
                >
                  <SelectTrigger id="reve-num-images" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REVE_NUM_IMAGE_OPTIONS.map((count) => {
                      const totalPrice =
                        REVE_TEXT_TO_IMAGE_MODEL.pricing.perImage * count;
                      return (
                        <SelectItem key={count} value={String(count)}>
                          {count} image{count > 1 ? "s" : ""} ($
                          {totalPrice.toFixed(2)})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              {/* Output Format */}
              <div className="space-y-1">
                <Label htmlFor="reve-format" className="text-xs">
                  Output Format
                </Label>
                <Select
                  value={reveOutputFormat}
                  onValueChange={(value) =>
                    setReveOutputFormat(value as ReveOutputFormatOption)
                  }
                >
                  <SelectTrigger id="reve-format" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REVE_TEXT_TO_IMAGE_MODEL.outputFormats.map((format) => (
                      <SelectItem key={format} value={format}>
                        {format.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Reve Edit Image Upload - Shows when Reve Edit functionality is needed */}
          {activeTab === "image" &&
            selectedModels.some((id) => id === "reve-text-to-image") && (
              <div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
                <Label className="text-xs font-medium">
                  Reve Edit (Optional)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Upload an image to edit it with Reve AI, or leave empty for
                  text-to-image generation.
                </p>

                {/* Image Upload */}
                <div className="space-y-2">
                  <Label className="text-xs">Source Image (Optional)</Label>
                  <label
                    htmlFor="reve-edit-image-input"
                    className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[100px] focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
                      generation.uploadedImageForEdit
                        ? "border-primary/50 bg-primary/5 p-2"
                        : "border-muted-foreground/25 hover:border-muted-foreground/50 p-3"
                    }`}
                    aria-label={
                      generation.uploadedImageForEdit
                        ? "Change image"
                        : "Upload image to edit"
                    }
                  >
                    {generation.uploadedImageForEdit &&
                    generation.uploadedImagePreview ? (
                      <div className="relative flex flex-col items-center justify-center h-full">
                        <img
                          src={generation.uploadedImagePreview}
                          alt={generation.uploadedImageForEdit.name}
                          className="max-w-full max-h-20 mx-auto rounded object-contain"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            generation.clearUploadedImageForEdit();
                          }}
                          className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
                          aria-label="Remove uploaded image"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                        <div className="mt-1 text-xs text-muted-foreground text-center">
                          {generation.uploadedImageForEdit.name}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full space-y-1 text-center">
                        <Upload className="size-6 text-muted-foreground" />
                        <div className="text-xs text-muted-foreground">
                          Upload image to edit
                        </div>
                        <div className="text-xs text-muted-foreground/70">
                          PNG, JPEG, WebP, AVIF, HEIF (max 10MB)
                        </div>
                        <div className="text-xs text-muted-foreground/70">
                          128×128 to 4096×4096 pixels
                        </div>
                      </div>
                    )}
                    <input
                      id="reve-edit-image-input"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/avif,image/heif"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        try {
                          await generation.handleImageUploadForEdit(file);
                          setError(null);
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Failed to upload image"
                          );
                        }
                      }}
                      className="sr-only"
                    />
                  </label>
                </div>

                {generation.uploadedImageForEdit && (
                  <div className="space-y-2">
                    <Label className="text-xs">Edit Instructions</Label>
                    <Textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Describe the edits you want to make (e.g., 'Make the sky sunset orange', 'Add snow to the ground')"
                      className="min-h-[80px] text-xs resize-none"
                      maxLength={2560}
                    />
                    <div className="text-xs text-muted-foreground text-right">
                      {prompt.length} / 2560 characters
                    </div>
                  </div>
                )}
              </div>
            )}

          {/* Error display */}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <div className="text-xs text-destructive">{error}</div>
            </div>
          )}

          {/* Progress display */}
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

          {/* Generated videos results */}
          {generation.hasResults && (
            <div className="space-y-2">
              <Label className="text-xs">Generated Videos</Label>
              <div className="space-y-2">
                {generation.generatedVideos.map((result, index) => {
                  const model = AI_MODELS.find((m) => m.id === result.modelId);
                  return (
                    <div
                      key={index}
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
                          const a = document.createElement("a");
                          a.href = result.video.videoUrl;
                          a.download = `ai-video-${result.video.jobId}.mp4`;
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

          {/* Validation messages - show when generation is blocked */}
          {!generation.canGenerate && selectedModels.length > 0 && (
            <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-md">
              <div className="text-xs text-orange-600 dark:text-orange-400 space-y-1">
                {activeTab === "text" && !prompt.trim() && (
                  <div>⚠️ Please enter a prompt to generate video</div>
                )}
                {activeTab === "image" &&
                  !selectedImage &&
                  !generation.hasVeo31FrameToVideo && (
                    <div>⚠️ Please upload an image for video generation</div>
                  )}
                {activeTab === "image" &&
                  generation.hasVeo31FrameToVideo &&
                  !firstFrame && (
                    <div>
                      ⚠️ Please upload the first frame (required for
                      frame-to-video)
                    </div>
                  )}
                {activeTab === "image" &&
                  generation.hasVeo31FrameToVideo &&
                  !lastFrame && (
                    <div>
                      ⚠️ Please upload the last frame (required for
                      frame-to-video)
                    </div>
                  )}
                {activeTab === "avatar" && !avatarImage && (
                  <div>⚠️ Please upload a character image</div>
                )}
              </div>
            </div>
          )}

        </div>
      )}

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

/**
 * Calculate Seedance video generation cost using token-based pricing
 * Formula: tokens = (height × width × FPS × duration) / 1024
 * @param modelId - seedance_pro_fast_i2v or seedance_pro_i2v
 * @param resolution - 480p, 720p, or 1080p
 * @param duration - Duration in seconds
 * @returns Estimated cost in dollars
 */
function calculateSeedanceCost(
  modelId: string,
  resolution: string,
  duration: number
): number {
  // Resolution dimensions
  const resolutionMap: Record<string, { width: number; height: number }> = {
    "480p": { width: 854, height: 480 },
    "720p": { width: 1280, height: 720 },
    "1080p": { width: 1920, height: 1080 },
  };

  const dimensions = resolutionMap[resolution] ?? resolutionMap["1080p"];
  const fps = 30; // Standard FPS for Seedance models

  // Calculate video tokens
  const tokens =
    (dimensions.height * dimensions.width * fps * duration) / 1024;

  // Price per million tokens
  const pricePerMillionTokens =
    modelId === "seedance_pro_fast_i2v" ? 1.0 : 2.5;

  // Calculate total cost
  const cost = (tokens * pricePerMillionTokens) / 1_000_000;

  return cost;
}

/**
 * Calculate Kling v2.5 Turbo Pro I2V cost using fixed duration-based pricing
 * @param duration - Duration in seconds (5 or 10)
 * @returns Estimated cost in dollars
 */
function calculateKlingCost(duration: number): number {
  // Fixed pricing tiers
  if (duration <= 5) {
    return 0.35;
  }
  if (duration <= 10) {
    return 0.7;
  }
  // Fallback: $0.07 per second beyond 10s (not officially supported but reasonable)
  return 0.7 + (duration - 10) * 0.07;
}

/**
 * Estimate the dollar cost to upscale a video using ByteDance per-second rates.
 *
 * @param resolution - Resolution identifier (e.g., "1080p", "2k", "4k")
 * @param fps - Frame rate identifier (e.g., "30fps", "60fps")
 * @param durationSeconds - Duration of the video segment in seconds
 * @returns Dollar cost as a string formatted with three decimal places (e.g., "$0.123"). Unknown resolution/fps combinations default to the 1080p_30fps rate.
 */
function calculateByteDanceUpscaleCost(
  resolution: string,
  fps: string,
  durationSeconds: number
): string {
  const rateKey = `${resolution}_${fps}`.toLowerCase();
  const rates: Record<string, number> = {
    "1080p_30fps": 0.0072,
    "2k_30fps": 0.0144,
    "4k_30fps": 0.0288,
    "1080p_60fps": 0.0144,
    "2k_60fps": 0.0288,
    "4k_60fps": 0.0576,
  };

  const rate = rates[rateKey] ?? rates["1080p_30fps"];
  const totalCost = rate * durationSeconds;
  return `$${totalCost.toFixed(3)}`;
}

/**
 * Estimate the cost to upscale a video using FlashVSR.
 *
 * Calculates cost from the output resolution (input width/height multiplied by `upscaleFactor`) across all frames and returns a dollar amount formatted with three decimal places.
 *
 * @param width - Input frame width in pixels
 * @param height - Input frame height in pixels
 * @param frames - Number of frames to process
 * @param upscaleFactor - Multiplier applied to width and height for the output resolution
 * @returns The estimated cost as a dollar string formatted to three decimal places (for example, "$0.123")
 */
function calculateFlashVSRUpscaleCost(
  width: number,
  height: number,
  frames: number,
  upscaleFactor: number
): string {
  if (!width || !height || !frames) {
    return "$0.000";
  }

  const outputWidth = width * upscaleFactor;
  const outputHeight = height * upscaleFactor;
  const megapixels = (outputWidth * outputHeight * frames) / 1_000_000;
  const totalCost = megapixels * 0.0005;
  return `$${totalCost.toFixed(3)}`;
}

/**
 * Compute the estimated Topaz upscaling cost for a requested upscale factor.
 *
 * @param factor - The requested upscale multiplier; if the exact factor is not supported, the nearest supported factor will be used.
 * @returns The estimated cost formatted as a dollar string (e.g., `$1.00`).
 */
function calculateTopazUpscaleCost(factor: number): string {
  const TOPAZ_COST_TABLE: Record<number, number> = {
    2: 0.5,
    3: 1.0,
    4: 2.0,
    6: 3.5,
    8: 5.0,
  };

  const supportedFactors = Object.keys(TOPAZ_COST_TABLE).map(Number);
  const closestFactor = supportedFactors.reduce(
    (closest, current) =>
      Math.abs(current - factor) < Math.abs(closest - factor)
        ? current
        : closest,
    supportedFactors[0]
  );

  return `$${TOPAZ_COST_TABLE[closestFactor].toFixed(2)}`;
}
