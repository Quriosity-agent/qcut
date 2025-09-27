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

import { useTimelineStore } from "@/stores/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import { usePanelStore } from "@/stores/panel-store";
import { useMediaPanelStore } from "../store";
import { AIHistoryPanel } from "./ai-history-panel";
import { debugLogger } from "@/lib/debug-logger";

// Import extracted hooks and types
import { useAIGeneration } from "./use-ai-generation";
import { useAIHistory } from "./use-ai-history";
import { AI_MODELS, ERROR_MESSAGES, UPLOAD_CONSTANTS } from "./ai-constants";
import type { AIActiveTab } from "./ai-types";

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
  const [avatarImagePreview, setAvatarImagePreview] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreview, setAudioPreview] = useState<string | null>(null);
  const [sourceVideo, setSourceVideo] = useState<File | null>(null);
  const [sourceVideoPreview, setSourceVideoPreview] = useState<string | null>(null);

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
    onProgress: (progress, message) => {
      console.log(`[AI View] Progress: ${progress}% - ${message}`);
      // Progress is handled internally by the hook
    },
    onError: (error) => {
      console.error(`[AI View] Error occurred:`, error);
      setError(error);
    },
    onComplete: (videos) => {
      console.log(`\n🎉🎉🎉 [AI View] GENERATION COMPLETE 🎉🎉🎉`);
      console.log(`[AI View] Received ${videos.length} videos:`, videos);
      debugLogger.log("AiView", "GENERATION_COMPLETE", {
        videoCount: videos.length,
        models: selectedModels,
      });
      console.log(`[AI View] onComplete callback finished`);
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
  const maxChars = 500;
  const remainingChars = maxChars - prompt.length;

  const totalCost = selectedModels.reduce((total, modelId) => {
    const model = AI_MODELS.find((m) => m.id === modelId);
    return total + (model ? parseFloat(model.price) : 0);
  }, 0);

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
        <div className="flex-1 overflow-y-auto space-y-4">
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
                </div>
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
              </div>
            </TabsContent>

            <TabsContent value="avatar" className="space-y-4">
              {/* Avatar Image Upload */}
              <div className="space-y-2">
                <Label className="text-xs">
                  Character Image {!isCompact && "(Required)"}
                </Label>
                <label
                  htmlFor="avatar-image-input"
                  className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[120px] focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
                    avatarImage
                      ? "border-primary/50 bg-primary/5 p-2"
                      : "border-muted-foreground/25 hover:border-muted-foreground/50 p-4"
                  }`}
                  aria-label={avatarImage ? "Change avatar image" : "Click to upload avatar image"}
                >
                  {avatarImage && avatarImagePreview ? (
                    <div className="relative flex flex-col items-center justify-center h-full">
                      <img
                        src={avatarImagePreview}
                        alt={avatarImage?.name ?? "Avatar preview"}
                        className="max-w-full max-h-32 mx-auto rounded object-contain"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAvatarImage(null);
                          setAvatarImagePreview(null);
                          const input = document.getElementById('avatar-image-input') as HTMLInputElement;
                          if (input) input.value = '';
                        }}
                        className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                      <div className="mt-2 text-xs text-muted-foreground text-center">
                        {avatarImage.name}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full space-y-2 text-center">
                      <Upload className="size-8 text-muted-foreground" />
                      <div className="text-xs text-muted-foreground">
                        Click to upload character image
                      </div>
                      <div className="text-xs text-muted-foreground/70">
                        JPG, PNG, WebP (max 10MB)
                      </div>
                    </div>
                  )}
                  <input
                    id="avatar-image-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      // Validate file
                      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                        setError('Please select a valid image file (JPG, PNG, WebP)');
                        return;
                      }

                      if (file.size > 10 * 1024 * 1024) {
                        setError('Image file too large (max 10MB)');
                        return;
                      }

                      setAvatarImage(file);
                      setError(null);

                      // Create preview
                      const reader = new FileReader();
                      reader.onload = (e) => setAvatarImagePreview(e.target?.result as string);
                      reader.readAsDataURL(file);
                    }}
                    className="sr-only"
                  />
                </label>
              </div>

              {/* Audio File Upload (for Kling models) */}
              <div className="space-y-2">
                <Label className="text-xs">
                  Audio File {!isCompact && "(For Kling Avatar models)"}
                </Label>
                <label
                  htmlFor="avatar-audio-input"
                  className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[80px] focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
                    audioFile
                      ? "border-primary/50 bg-primary/5 p-2"
                      : "border-muted-foreground/25 hover:border-muted-foreground/50 p-4"
                  }`}
                  aria-label={audioFile ? "Change audio file" : "Click to upload audio file"}
                >
                  {audioFile ? (
                    <div className="relative flex flex-col items-center justify-center h-full">
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                          <span className="text-xs">🎵</span>
                        </div>
                        <div>
                          <div className="text-xs font-medium">{audioFile.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {(audioFile.size / 1024 / 1024).toFixed(1)} MB
                          </div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAudioFile(null);
                          const input = document.getElementById('avatar-audio-input') as HTMLInputElement;
                          if (input) input.value = '';
                        }}
                        className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full space-y-2 text-center">
                      <Upload className="size-6 text-muted-foreground" />
                      <div className="text-xs text-muted-foreground">
                        Click to upload audio file
                      </div>
                      <div className="text-xs text-muted-foreground/70">
                        MP3, WAV, AAC (max 50MB)
                      </div>
                    </div>
                  )}
                  <input
                    id="avatar-audio-input"
                    type="file"
                    accept="audio/mpeg,audio/wav,audio/aac,audio/mp3"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      // Validate file
                      if (!['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/mp3'].includes(file.type)) {
                        setError('Please select a valid audio file (MP3, WAV, AAC)');
                        return;
                      }

                      if (file.size > 50 * 1024 * 1024) {
                        setError('Audio file too large (max 50MB)');
                        return;
                      }

                      setAudioFile(file);
                      setError(null);
                    }}
                    className="sr-only"
                  />
                </label>
              </div>

              {/* Source Video Upload (for WAN animate/replace) */}
              <div className="space-y-2">
                <Label className="text-xs">
                  Source Video {!isCompact && "(For WAN Animate/Replace)"}
                </Label>
                <label
                  htmlFor="avatar-video-input"
                  className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[80px] focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
                    sourceVideo
                      ? "border-primary/50 bg-primary/5 p-2"
                      : "border-muted-foreground/25 hover:border-muted-foreground/50 p-4"
                  }`}
                  aria-label={sourceVideo ? "Change source video" : "Click to upload source video"}
                >
                  {sourceVideo ? (
                    <div className="relative flex flex-col items-center justify-center h-full">
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                          <span className="text-xs">🎬</span>
                        </div>
                        <div>
                          <div className="text-xs font-medium">{sourceVideo.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {(sourceVideo.size / 1024 / 1024).toFixed(1)} MB
                          </div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSourceVideo(null);
                          const input = document.getElementById('avatar-video-input') as HTMLInputElement;
                          if (input) input.value = '';
                        }}
                        className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full space-y-2 text-center">
                      <Upload className="size-6 text-muted-foreground" />
                      <div className="text-xs text-muted-foreground">
                        Click to upload source video
                      </div>
                      <div className="text-xs text-muted-foreground/70">
                        MP4, MOV, AVI (max 100MB)
                      </div>
                    </div>
                  )}
                  <input
                    id="avatar-video-input"
                    type="file"
                    accept="video/mp4,video/mov,video/avi"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      // Validate file
                      if (!['video/mp4', 'video/mov', 'video/avi'].includes(file.type)) {
                        setError('Please select a valid video file (MP4, MOV, AVI)');
                        return;
                      }

                      if (file.size > 100 * 1024 * 1024) {
                        setError('Video file too large (max 100MB)');
                        return;
                      }

                      setSourceVideo(file);
                      setError(null);
                    }}
                    className="sr-only"
                  />
                </label>
              </div>

              {/* Optional Prompt for Avatar */}
              <div className="space-y-2">
                <Label htmlFor="avatar-prompt" className="text-xs">
                  {!isCompact && "Additional "}Prompt {!isCompact && "(optional)"}
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
              {AI_MODELS
                .filter((model) => {
                  // Filter models based on active tab
                  if (activeTab === "avatar") {
                    return model.category === "avatar";
                  } else {
                    // Show non-avatar models for text/image tabs
                    return model.category !== "avatar";
                  }
                })
                .map((model) => {
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
              <div className="text-xs text-muted-foreground text-right">
                Total estimated cost:{" "}
                <span className="font-medium">${totalCost.toFixed(2)}</span>
              </div>
            )}
          </div>

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
                  {isCompact ? "Generating..." : "Generating Video..."}
                </>
              ) : (
                <>
                  <BotIcon className="size-4 mr-2" />
                  {isCompact ? "Generate" : "Generate Video"}
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
