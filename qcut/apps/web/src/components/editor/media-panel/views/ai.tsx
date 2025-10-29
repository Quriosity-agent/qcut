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
import { useState, useRef, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
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

import { useTimelineStore } from "@/stores/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { usePanelStore } from "@/stores/panel-store";
import { useMediaPanelStore } from "../store";
import { AIHistoryPanel } from "./ai-history-panel";
import { debugLogger } from "@/lib/debug-logger";

// Import extracted hooks and types
import { useAIGeneration } from "./use-ai-generation";
import { useAIHistory } from "./use-ai-history";
import {
  AI_MODELS,
  ERROR_MESSAGES,
  REVE_TEXT_TO_IMAGE_MODEL,
  UPLOAD_CONSTANTS,
} from "./ai-constants";
import type { AIActiveTab } from "./ai-types";

type ReveAspectRatioOption =
  (typeof REVE_TEXT_TO_IMAGE_MODEL.aspectRatios)[number]["value"];
type ReveOutputFormatOption =
  (typeof REVE_TEXT_TO_IMAGE_MODEL.outputFormats)[number];

const REVE_NUM_IMAGE_OPTIONS = Array.from(
  {
    length:
      REVE_TEXT_TO_IMAGE_MODEL.numImagesRange.max -
      REVE_TEXT_TO_IMAGE_MODEL.numImagesRange.min +
      1,
  },
  (_, index) => REVE_TEXT_TO_IMAGE_MODEL.numImagesRange.min + index
);

export function AiView() {
  // UI-only state (not related to generation logic)
  const [prompt, setPrompt] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Veo 3.1 frame upload state
  const [firstFrame, setFirstFrame] = useState<File | null>(null);
  const [firstFramePreview, setFirstFramePreview] = useState<string | null>(
    null
  );
  const [lastFrame, setLastFrame] = useState<File | null>(null);
  const [lastFramePreview, setLastFramePreview] = useState<string | null>(null);

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
const [viduQ2Duration, setViduQ2Duration] = useState<2 | 3 | 4 | 5 | 6 | 7 | 8>(4);
const [viduQ2Resolution, setViduQ2Resolution] = useState<"720p" | "1080p">(
  "720p"
);
const [viduQ2MovementAmplitude, setViduQ2MovementAmplitude] = useState<
  "auto" | "small" | "medium" | "large"
>("auto");
const [viduQ2EnableBGM, setViduQ2EnableBGM] = useState(false);
const [ltxv2Duration, setLTXV2Duration] = useState<6 | 8 | 10>(6);
const [ltxv2Resolution, setLTXV2Resolution] = useState<
  "1080p" | "1440p" | "2160p"
>("1080p");
const [ltxv2FPS, setLTXV2FPS] = useState<25 | 50>(25);
const [ltxv2GenerateAudio, setLTXV2GenerateAudio] = useState(true);
const [ltxv2ImageDuration, setLTXV2ImageDuration] = useState<2 | 3 | 4 | 5 | 6>(4);
const [ltxv2ImageResolution, setLTXV2ImageResolution] = useState<
  "720p" | "1080p"
>("1080p");
const [ltxv2ImageFPS, setLTXV2ImageFPS] = useState<25 | 50>(25);
const [ltxv2ImageGenerateAudio, setLTXV2ImageGenerateAudio] = useState(true);

  // Use global AI tab state (CRITICAL: preserve global state integration)
  const { aiActiveTab: activeTab, setAiActiveTab: setActiveTab } =
    useMediaPanelStore();

  // Get project store
  const { activeProject } = useProjectStore();

  // Check if current project is a fallback project
  const isFallbackProject =
    activeProject?.id?.startsWith("project-") &&
    /^project-\d{13}$/.test(activeProject?.id || "");

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
    hailuoT2VDuration,
    viduQ2Duration,
    viduQ2Resolution,
    viduQ2MovementAmplitude,
    viduQ2EnableBGM,
    ltxv2Duration,
    ltxv2Resolution,
    ltxv2FPS,
    ltxv2GenerateAudio,
    ltxv2ImageDuration,
    ltxv2ImageResolution,
    ltxv2ImageFPS,
    ltxv2ImageGenerateAudio,
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
  const ltxv2TextSelected = selectedModels.includes("ltxv2_pro_t2v");
  const ltxv2ImageSelected = selectedModels.includes("ltxv2_fast_i2v");

  // Track active FileReader for cleanup
  const fileReaderRef = useRef<FileReader | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (fileReaderRef.current) {
        fileReaderRef.current.abort();
      }
    };
  }, []);

  // Reset Reve state when model is deselected
  useEffect(() => {
    if (!selectedModels.some((id) => id === "reve-text-to-image")) {
      setReveAspectRatio("3:2");
      setReveNumImages(1);
      setReveOutputFormat("png");
    }
  }, [selectedModels]);

  useEffect(() => {
    if (
      !selectedModels.includes("hailuo23_standard_t2v") &&
      hailuoT2VDuration !== 6
    ) {
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
    if (!ltxv2TextSelected) {
      setLTXV2Duration(6);
      setLTXV2Resolution("1080p");
      setLTXV2FPS(25);
      setLTXV2GenerateAudio(true);
    }
  }, [ltxv2TextSelected]);

  useEffect(() => {
    if (!ltxv2ImageSelected) {
      setLTXV2ImageDuration(4);
      setLTXV2ImageResolution("1080p");
      setLTXV2ImageFPS(25);
      setLTXV2ImageGenerateAudio(true);
    }
  }, [ltxv2ImageSelected]);

  // Image handling
  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (
      !(UPLOAD_CONSTANTS.ALLOWED_IMAGE_TYPES as readonly string[]).includes(
        file.type
      )
    ) {
      setError(ERROR_MESSAGES.INVALID_FILE_TYPE);
      return;
    }

    // Validate file size
    if (file.size > UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES) {
      setError(ERROR_MESSAGES.FILE_TOO_LARGE);
      return;
    }

    setSelectedImage(file);
    setError(null);

    // Abort any previous reader
    if (fileReaderRef.current) {
      fileReaderRef.current.abort();
    }

    // Create preview with cleanup
    const reader = new FileReader();
    fileReaderRef.current = reader;

    reader.onload = (e) => {
      // Only update if this reader is still current
      if (fileReaderRef.current === reader) {
        setImagePreview(e.target?.result as string);
      }
    };

    reader.readAsDataURL(file);

    debugLogger.log("AiView", "IMAGE_SELECTED", {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    });
  };

  // Clear image selection
  const clearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

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
            <TabsList className="grid w-full grid-cols-3">
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
                  <div className="text-xs text-muted-foreground text-left">
                    Tip: Add camera cues like [Pan left], [Zoom in], or [Track forward] to guide Pro shots.
                  </div>
                )}
                {hailuoStandardSelected && (
                  <div className="space-y-1 text-left">
                    <Label
                      htmlFor="hailuo-standard-duration"
                      className="text-xs font-medium"
                    >
                      Hailuo 2.3 Duration
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
                        <SelectItem value="6">6 seconds ($0.28)</SelectItem>
                        <SelectItem value="10">10 seconds ($0.56)</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="text-xs text-muted-foreground">
                      6s: $0.28 | 10s: $0.56
                    </div>
                  </div>
                )}
                {ltxv2TextSelected && (
                  <div className="space-y-2 text-left border-t pt-3">
                    <Label className="text-xs font-medium">
                      LTX Video 2.0 Settings
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
              {/* Image upload */}
              <div className="space-y-2">
                <Label className="text-xs">
                  {!isCompact && "Upload "}Image
                  {!isCompact && " for Video Generation"}
                </Label>

                <label
                  htmlFor="ai-image-input"
                  className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[120px] focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
                    selectedImage
                      ? "border-primary/50 bg-primary/5 p-2"
                      : "border-muted-foreground/25 hover:border-muted-foreground/50 p-4"
                  }`}
                  aria-label={
                    selectedImage
                      ? "Change selected image"
                      : "Click to upload an image"
                  }
                >
                  {selectedImage && imagePreview ? (
                    <div className="relative flex flex-col items-center justify-center h-full">
                      <img
                        src={imagePreview}
                        alt={selectedImage?.name ?? "File preview"}
                        className="max-w-full max-h-32 mx-auto rounded object-contain"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearImage();
                        }}
                        className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                      <div className="mt-2 text-xs text-muted-foreground text-center">
                        {selectedImage.name}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full space-y-2 text-center">
                      <Upload className="size-8 text-muted-foreground" />
                      <div className="text-xs text-muted-foreground">
                        Click to upload an image
                      </div>
                      <div className="text-xs text-muted-foreground/70">
                        JPG, PNG, WebP, GIF (max 10MB)
                      </div>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    id="ai-image-input"
                    type="file"
                    accept={UPLOAD_CONSTANTS.SUPPORTED_FORMATS.join(",")}
                    onChange={handleImageSelect}
                    className="sr-only"
                    aria-describedby="ai-image-help"
                  />
                </label>
                <p id="ai-image-help" className="sr-only">
                  JPG, PNG, WebP, GIF (max 10MB)
                </p>

                {/* Veo 3.1 Frame Upload - Only shows when frame-to-video models selected */}
                {generation.hasVeo31FrameToVideo && (
                  <div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
                    <Label className="text-xs font-medium">
                      Frame-to-Video Frames
                    </Label>

                    {/* First Frame Upload */}
                    <div className="space-y-2">
                      <Label className="text-xs">First Frame (Required)</Label>
                      <label
                        htmlFor="first-frame-input"
                        className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[100px] focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
                          firstFrame
                            ? "border-primary/50 bg-primary/5 p-2"
                            : "border-muted-foreground/25 hover:border-muted-foreground/50 p-3"
                        }`}
                        aria-label={
                          firstFrame
                            ? "Change first frame"
                            : "Upload first frame"
                        }
                      >
                        {firstFrame && firstFramePreview ? (
                          <div className="relative flex flex-col items-center justify-center h-full">
                            <img
                              src={firstFramePreview}
                              alt={firstFrame.name}
                              className="max-w-full max-h-20 mx-auto rounded object-contain"
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFirstFrame(null);
                                setFirstFramePreview(null);
                                generation.setFirstFrame(null);
                              }}
                              className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                            <div className="mt-1 text-xs text-muted-foreground text-center">
                              {firstFrame.name}
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full space-y-1 text-center">
                            <Upload className="size-6 text-muted-foreground" />
                            <div className="text-xs text-muted-foreground">
                              Upload first frame
                            </div>
                            <div className="text-xs text-muted-foreground/70">
                              JPG, PNG (max 8MB)
                            </div>
                          </div>
                        )}
                        <input
                          id="first-frame-input"
                          type="file"
                          accept="image/jpeg,image/png"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;

                            // Validate file size (8MB for Veo 3.1)
                            if (
                              file.size >
                              UPLOAD_CONSTANTS.MAX_VEO31_FRAME_SIZE_BYTES
                            ) {
                              setError(ERROR_MESSAGES.VEO31_IMAGE_TOO_LARGE);
                              return;
                            }

                            setFirstFrame(file);
                            generation.setFirstFrame(file);
                            setError(null);

                            // Create preview
                            const reader = new FileReader();
                            reader.onload = (e) => {
                              setFirstFramePreview(e.target?.result as string);
                            };
                            reader.readAsDataURL(file);
                          }}
                          className="sr-only"
                        />
                      </label>
                    </div>

                    {/* Last Frame Upload */}
                    <div className="space-y-2">
                      <Label className="text-xs">Last Frame (Required)</Label>
                      <label
                        htmlFor="last-frame-input"
                        className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[100px] focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
                          lastFrame
                            ? "border-primary/50 bg-primary/5 p-2"
                            : "border-muted-foreground/25 hover:border-muted-foreground/50 p-3"
                        }`}
                        aria-label={
                          lastFrame ? "Change last frame" : "Upload last frame"
                        }
                      >
                        {lastFrame && lastFramePreview ? (
                          <div className="relative flex flex-col items-center justify-center h-full">
                            <img
                              src={lastFramePreview}
                              alt={lastFrame.name}
                              className="max-w-full max-h-20 mx-auto rounded object-contain"
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLastFrame(null);
                                setLastFramePreview(null);
                                generation.setLastFrame(null);
                              }}
                              className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                            <div className="mt-1 text-xs text-muted-foreground text-center">
                              {lastFrame.name}
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full space-y-1 text-center">
                            <Upload className="size-6 text-muted-foreground" />
                            <div className="text-xs text-muted-foreground">
                              Upload last frame
                            </div>
                            <div className="text-xs text-muted-foreground/70">
                              JPG, PNG (max 8MB)
                            </div>
                          </div>
                        )}
                        <input
                          id="last-frame-input"
                          type="file"
                          accept="image/jpeg,image/png"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;

                            // Validate file size (8MB for Veo 3.1)
                            if (
                              file.size >
                              UPLOAD_CONSTANTS.MAX_VEO31_FRAME_SIZE_BYTES
                            ) {
                              setError(ERROR_MESSAGES.VEO31_IMAGE_TOO_LARGE);
                              return;
                            }

                            setLastFrame(file);
                            generation.setLastFrame(file);
                            setError(null);

                            // Create preview
                            const reader = new FileReader();
                            reader.onload = (e) => {
                              setLastFramePreview(e.target?.result as string);
                            };
                            reader.readAsDataURL(file);
                          }}
                          className="sr-only"
                        />
                      </label>
                    </div>
                  </div>
                )}

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
                        <SelectTrigger
                          id="vidu-duration"
                          className="h-8 text-xs"
                        >
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
                        <SelectTrigger
                          id="vidu-movement"
                          className="h-8 text-xs"
                        >
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
                            Number(value) as 2 | 3 | 4 | 5 | 6
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
                          <SelectItem value="2">2 seconds</SelectItem>
                          <SelectItem value="3">3 seconds</SelectItem>
                          <SelectItem value="4">4 seconds</SelectItem>
                          <SelectItem value="5">5 seconds</SelectItem>
                          <SelectItem value="6">6 seconds</SelectItem>
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
                          setLTXV2ImageResolution(value as "720p" | "1080p")
                        }
                      >
                        <SelectTrigger
                          id="ltxv2-image-resolution"
                          className="h-8 text-xs"
                        >
                          <SelectValue placeholder="Select resolution" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="720p">720p ($0.05/sec)</SelectItem>
                          <SelectItem value="1080p">1080p ($0.05/sec)</SelectItem>
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
                          setLTXV2ImageFPS(Number(value) as 25 | 50)
                        }
                      >
                        <SelectTrigger
                          id="ltxv2-image-fps"
                          className="h-8 text-xs"
                        >
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

                    <div className="text-xs text-muted-foreground">
                      2-6 second clips with optional audio at up to 1080p.
                    </div>
                  </div>
                )}
              </div>
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
          </Tabs>

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

          {/* Action buttons */}
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
                  {isCompact
                    ? "Generate"
                    : activeTab === "avatar"
                      ? "Generate Avatar"
                      : "Generate Video"}
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
