/**
 * Image Tab UI Component
 *
 * Renders the Image-to-Video tab UI including:
 * - Frame upload grid section
 * - Motion prompt section
 * - Model-specific settings (Vidu Q2, LTX I2V, Seedance, Kling, WAN 2.5)
 *
 * @see ai-tsx-refactoring.md - Subtask 3.4
 */

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
import { Checkbox } from "@/components/ui/checkbox";
import { FileUpload } from "@/components/ui/file-upload";

import { AIImageUploadSection } from "../components/ai-image-upload";
import {
  AI_MODELS,
  LTXV2_FAST_CONFIG,
  UPLOAD_CONSTANTS,
  ERROR_MESSAGES,
} from "../constants/ai-constants";
import {
  LTXV2_FAST_RESOLUTION_LABELS,
  LTXV2_FAST_RESOLUTION_PRICE_SUFFIX,
  LTXV2_FAST_FPS_LABELS,
  SEEDANCE_DURATION_OPTIONS,
  SEEDANCE_RESOLUTIONS,
  SEEDANCE_ASPECT_RATIOS,
  KLING_ASPECT_RATIOS,
  KLING26_ASPECT_RATIOS,
  WAN25_DURATIONS,
  WAN25_RESOLUTIONS,
  type LTXV2FastDuration,
  type LTXV2FastResolution,
  type LTXV2FastFps,
  type SeedanceDuration,
  type SeedanceResolution,
  type SeedanceAspectRatio,
  type KlingAspectRatio,
  type Kling26AspectRatio,
  type Wan25Duration,
  type Wan25Resolution,
} from "../constants/ai-model-options";
import {
  calculateSeedanceCost,
  calculateKlingCost,
  calculateKling26Cost,
  calculateLTXV2Cost,
} from "../utils/ai-cost-calculators";

// ============================================
// Types
// ============================================

export interface AIImageTabProps {
  /** Current prompt value */
  prompt: string;
  /** Callback when prompt changes */
  onPromptChange: (value: string) => void;
  /** Maximum character limit for prompt */
  maxChars: number;
  /** Selected AI models */
  selectedModels: string[];
  /** Whether compact mode is active */
  isCompact: boolean;
  /** Callback for errors */
  onError: (error: string | null) => void;

  // Frame uploads
  firstFrame: File | null;
  firstFramePreview: string | null;
  lastFrame: File | null;
  lastFramePreview: string | null;
  imageTabSourceVideo: File | null;
  onFirstFrameChange: (file: File | null, preview: string | null) => void;
  onLastFrameChange: (file: File | null, preview: string | null) => void;
  onSourceVideoChange: (file: File | null) => void;

  // Vidu Q2 settings
  viduQ2Duration: 2 | 3 | 4 | 5 | 6 | 7 | 8;
  onViduQ2DurationChange: (value: 2 | 3 | 4 | 5 | 6 | 7 | 8) => void;
  viduQ2Resolution: "720p" | "1080p";
  onViduQ2ResolutionChange: (value: "720p" | "1080p") => void;
  viduQ2MovementAmplitude: "auto" | "small" | "medium" | "large";
  onViduQ2MovementAmplitudeChange: (
    value: "auto" | "small" | "medium" | "large"
  ) => void;
  viduQ2EnableBGM: boolean;
  onViduQ2EnableBGMChange: (value: boolean) => void;

  // LTX I2V settings
  ltxv2I2VDuration: 6 | 8 | 10;
  onLTXV2I2VDurationChange: (value: 6 | 8 | 10) => void;
  ltxv2I2VResolution: "1080p" | "1440p" | "2160p";
  onLTXV2I2VResolutionChange: (value: "1080p" | "1440p" | "2160p") => void;
  ltxv2I2VFPS: 25 | 50;
  onLTXV2I2VFPSChange: (value: 25 | 50) => void;
  ltxv2I2VGenerateAudio: boolean;
  onLTXV2I2VGenerateAudioChange: (value: boolean) => void;

  // LTX Image settings (Fast I2V)
  ltxv2ImageDuration: LTXV2FastDuration;
  onLTXV2ImageDurationChange: (value: LTXV2FastDuration) => void;
  ltxv2ImageResolution: LTXV2FastResolution;
  onLTXV2ImageResolutionChange: (value: LTXV2FastResolution) => void;
  ltxv2ImageFPS: LTXV2FastFps;
  onLTXV2ImageFPSChange: (value: LTXV2FastFps) => void;
  ltxv2ImageGenerateAudio: boolean;
  onLTXV2ImageGenerateAudioChange: (value: boolean) => void;

  // Seedance settings
  seedanceDuration: SeedanceDuration;
  onSeedanceDurationChange: (value: SeedanceDuration) => void;
  seedanceResolution: SeedanceResolution;
  onSeedanceResolutionChange: (value: SeedanceResolution) => void;
  seedanceAspectRatio: SeedanceAspectRatio;
  onSeedanceAspectRatioChange: (value: SeedanceAspectRatio) => void;
  seedanceCameraFixed: boolean;
  onSeedanceCameraFixedChange: (value: boolean) => void;
  seedanceEndFrameUrl: string | undefined;
  onSeedanceEndFrameUrlChange: (value: string | undefined) => void;
  seedanceEndFrameFile: File | null;
  seedanceEndFramePreview: string | null;
  onSeedanceEndFrameFileChange: (
    file: File | null,
    preview: string | null
  ) => void;

  // Kling v2.5 settings
  klingDuration: 5 | 10;
  onKlingDurationChange: (value: 5 | 10) => void;
  klingCfgScale: number;
  onKlingCfgScaleChange: (value: number) => void;
  klingAspectRatio: KlingAspectRatio;
  onKlingAspectRatioChange: (value: KlingAspectRatio) => void;
  klingEnhancePrompt: boolean;
  onKlingEnhancePromptChange: (value: boolean) => void;
  klingNegativePrompt: string;
  onKlingNegativePromptChange: (value: string) => void;

  // Kling v2.6 settings
  kling26Duration: 5 | 10;
  onKling26DurationChange: (value: 5 | 10) => void;
  kling26CfgScale: number;
  onKling26CfgScaleChange: (value: number) => void;
  kling26AspectRatio: Kling26AspectRatio;
  onKling26AspectRatioChange: (value: Kling26AspectRatio) => void;
  kling26GenerateAudio: boolean;
  onKling26GenerateAudioChange: (value: boolean) => void;
  kling26NegativePrompt: string;
  onKling26NegativePromptChange: (value: string) => void;

  // WAN 2.5 settings
  wan25Duration: Wan25Duration;
  onWan25DurationChange: (value: Wan25Duration) => void;
  wan25Resolution: Wan25Resolution;
  onWan25ResolutionChange: (value: Wan25Resolution) => void;
  wan25EnablePromptExpansion: boolean;
  onWan25EnablePromptExpansionChange: (value: boolean) => void;
  wan25NegativePrompt: string;
  onWan25NegativePromptChange: (value: string) => void;
  wan25AudioUrl: string | undefined;
  onWan25AudioUrlChange: (value: string | undefined) => void;
  wan25AudioFile: File | null;
  wan25AudioPreview: string | null;
  onWan25AudioFileChange: (file: File | null, preview: string | null) => void;

  // Advanced options
  imageSeed: number | undefined;
  onImageSeedChange: (value: number | undefined) => void;

  // Generation hook (for frame sync)
  generation?: {
    setFirstFrame?: (file: File | null) => void;
    setLastFrame?: (file: File | null) => void;
  };
}

// ============================================
// Component
// ============================================

/**
 * Image tab component for AI image-to-video generation.
 */
export function AIImageTab({
  prompt,
  onPromptChange,
  maxChars,
  selectedModels,
  isCompact,
  onError,
  firstFrame,
  firstFramePreview,
  lastFrame,
  lastFramePreview,
  imageTabSourceVideo,
  onFirstFrameChange,
  onLastFrameChange,
  onSourceVideoChange,
  viduQ2Duration,
  onViduQ2DurationChange,
  viduQ2Resolution,
  onViduQ2ResolutionChange,
  viduQ2MovementAmplitude,
  onViduQ2MovementAmplitudeChange,
  viduQ2EnableBGM,
  onViduQ2EnableBGMChange,
  ltxv2I2VDuration,
  onLTXV2I2VDurationChange,
  ltxv2I2VResolution,
  onLTXV2I2VResolutionChange,
  ltxv2I2VFPS,
  onLTXV2I2VFPSChange,
  ltxv2I2VGenerateAudio,
  onLTXV2I2VGenerateAudioChange,
  ltxv2ImageDuration,
  onLTXV2ImageDurationChange,
  ltxv2ImageResolution,
  onLTXV2ImageResolutionChange,
  ltxv2ImageFPS,
  onLTXV2ImageFPSChange,
  ltxv2ImageGenerateAudio,
  onLTXV2ImageGenerateAudioChange,
  seedanceDuration,
  onSeedanceDurationChange,
  seedanceResolution,
  onSeedanceResolutionChange,
  seedanceAspectRatio,
  onSeedanceAspectRatioChange,
  seedanceCameraFixed,
  onSeedanceCameraFixedChange,
  seedanceEndFrameUrl,
  onSeedanceEndFrameUrlChange,
  seedanceEndFrameFile,
  seedanceEndFramePreview,
  onSeedanceEndFrameFileChange,
  klingDuration,
  onKlingDurationChange,
  klingCfgScale,
  onKlingCfgScaleChange,
  klingAspectRatio,
  onKlingAspectRatioChange,
  klingEnhancePrompt,
  onKlingEnhancePromptChange,
  klingNegativePrompt,
  onKlingNegativePromptChange,
  kling26Duration,
  onKling26DurationChange,
  kling26CfgScale,
  onKling26CfgScaleChange,
  kling26AspectRatio,
  onKling26AspectRatioChange,
  kling26GenerateAudio,
  onKling26GenerateAudioChange,
  kling26NegativePrompt,
  onKling26NegativePromptChange,
  wan25Duration,
  onWan25DurationChange,
  wan25Resolution,
  onWan25ResolutionChange,
  wan25EnablePromptExpansion,
  onWan25EnablePromptExpansionChange,
  wan25NegativePrompt,
  onWan25NegativePromptChange,
  wan25AudioUrl,
  onWan25AudioUrlChange,
  wan25AudioFile,
  wan25AudioPreview,
  onWan25AudioFileChange,
  imageSeed,
  onImageSeedChange,
  generation,
}: AIImageTabProps) {
  // Model selection helpers
  const viduQ2Selected = selectedModels.includes("vidu_q2_turbo_i2v");
  const ltxv2I2VSelected = selectedModels.includes("ltxv2_i2v");
  const ltxv2ImageSelected = selectedModels.includes("ltxv2_fast_i2v");
  const ltxv2FastTextSelected = selectedModels.includes("ltxv2_fast_t2v");
  const seedanceFastSelected = selectedModels.includes("seedance_pro_fast_i2v");
  const seedanceProSelected = selectedModels.includes("seedance_pro_i2v");
  const seedanceSelected = seedanceFastSelected || seedanceProSelected;
  const klingI2VSelected = selectedModels.includes("kling_v2_5_turbo_i2v");
  const kling26I2VSelected = selectedModels.includes("kling_v26_pro_i2v");
  const wan25Selected = selectedModels.includes("wan_25_preview_i2v");

  // LTX Fast extended duration constraints
  const ltxv2FastExtendedResolutions = LTXV2_FAST_CONFIG.RESOLUTIONS.EXTENDED;
  const ltxv2FastExtendedFps = LTXV2_FAST_CONFIG.FPS_OPTIONS.EXTENDED;
  const isExtendedLTXV2FastImageDuration =
    ltxv2ImageDuration > LTXV2_FAST_CONFIG.EXTENDED_DURATION_THRESHOLD;

  // Model config lookups
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

  // Kling v2.6 cost calculation
  const kling26EstimatedCost = calculateKling26Cost(
    kling26Duration,
    kling26GenerateAudio
  );

  // WAN 2.5 config
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

  return (
    <div className="space-y-4">
      {/* Image upload - supports both I2V and F2V modes */}
      <AIImageUploadSection
        selectedModels={selectedModels}
        firstFrame={firstFrame}
        firstFramePreview={firstFramePreview}
        lastFrame={lastFrame}
        lastFramePreview={lastFramePreview}
        sourceVideo={imageTabSourceVideo}
        onFirstFrameChange={(file, preview) => {
          onFirstFrameChange(file, preview || null);
          if (generation?.setFirstFrame) {
            generation.setFirstFrame(file);
          }
        }}
        onLastFrameChange={(file, preview) => {
          onLastFrameChange(file, preview || null);
          if (generation?.setLastFrame) {
            generation.setLastFrame(file);
          }
        }}
        onSourceVideoChange={(file) => {
          onSourceVideoChange(file);
          if (file) onError(null);
        }}
        onError={onError}
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
          onChange={(e) => onPromptChange(e.target.value)}
          className="min-h-[40px] text-xs resize-none"
          maxLength={maxChars}
        />
      </div>

      {/* Vidu Q2 Settings */}
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
                onViduQ2DurationChange(
                  Number(value) as 2 | 3 | 4 | 5 | 6 | 7 | 8
                )
              }
            >
              <SelectTrigger id="vidu-duration" className="h-8 text-xs">
                <SelectValue placeholder="Select duration" />
              </SelectTrigger>
              <SelectContent>
                {[2, 3, 4, 5, 6, 7, 8].map((d) => (
                  <SelectItem key={d} value={d.toString()}>
                    {d} seconds
                  </SelectItem>
                ))}
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
                onViduQ2ResolutionChange(value as "720p" | "1080p")
              }
            >
              <SelectTrigger id="vidu-resolution" className="h-8 text-xs">
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
                onViduQ2MovementAmplitudeChange(
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
                  onViduQ2EnableBGMChange(Boolean(checked))
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

      {/* LTX I2V Settings */}
      {ltxv2I2VSelected && (
        <div className="space-y-3 text-left border-t pt-3">
          <Label className="text-sm font-semibold">
            LTX Video 2.0 Settings
          </Label>

          <div className="space-y-1">
            <Label htmlFor="ltxv2-i2v-duration" className="text-xs font-medium">
              Duration
            </Label>
            <Select
              value={ltxv2I2VDuration.toString()}
              onValueChange={(value) =>
                onLTXV2I2VDurationChange(Number(value) as 6 | 8 | 10)
              }
            >
              <SelectTrigger id="ltxv2-i2v-duration" className="h-8 text-xs">
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
                onLTXV2I2VResolutionChange(
                  value as "1080p" | "1440p" | "2160p"
                )
              }
            >
              <SelectTrigger id="ltxv2-i2v-resolution" className="h-8 text-xs">
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
              {calculateLTXV2Cost(ltxv2I2VResolution, ltxv2I2VDuration, "pro").toFixed(2)}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ltxv2-i2v-fps" className="text-xs font-medium">
              Frame Rate
            </Label>
            <Select
              value={ltxv2I2VFPS.toString()}
              onValueChange={(value) =>
                onLTXV2I2VFPSChange(Number(value) as 25 | 50)
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
                onLTXV2I2VGenerateAudioChange(Boolean(checked))
              }
            />
            <Label htmlFor="ltxv2-i2v-audio" className="text-xs">
              Generate synchronized audio
            </Label>
          </div>

          <div className="text-xs text-muted-foreground">
            Transforms your image into a high-quality video with matching audio.
          </div>
        </div>
      )}

      {/* LTX Fast I2V Settings */}
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
                onLTXV2ImageDurationChange(Number(value) as LTXV2FastDuration)
              }
            >
              <SelectTrigger id="ltxv2-image-duration" className="h-8 text-xs">
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
                onLTXV2ImageResolutionChange(value as LTXV2FastResolution)
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
                        {LTXV2_FAST_RESOLUTION_PRICE_SUFFIX[resolutionOption] ??
                          ""}
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
                onLTXV2ImageFPSChange(Number(value) as LTXV2FastFps)
              }
            >
              <SelectTrigger id="ltxv2-image-fps" className="h-8 text-xs">
                <SelectValue placeholder="Select frame rate" />
              </SelectTrigger>
              <SelectContent>
                {LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD.map((fpsOption) => {
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
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="ltxv2-image-audio"
              checked={ltxv2ImageGenerateAudio}
              onCheckedChange={(checked) =>
                onLTXV2ImageGenerateAudioChange(Boolean(checked))
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
            6-20 second clips with optional audio at up to 4K. Longer clips
            automatically use 1080p at 25 FPS.
          </div>
        </div>
      )}

      {/* LTX Fast T2V Settings (shown in Image tab when selected) */}
      {ltxv2FastTextSelected && (
        <div className="space-y-3 text-left border-t pt-3">
          <Label className="text-sm font-semibold">
            LTX Video 2.0 Fast Settings
          </Label>
          <div className="text-xs text-muted-foreground">
            Configure LTX Fast settings in the Text tab.
          </div>
        </div>
      )}

      {/* Seedance Settings */}
      {seedanceSelected && (
        <div className="space-y-3 text-left border-t pt-3">
          <Label className="text-sm font-semibold">Seedance Settings</Label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="seedance-duration" className="text-xs">
                Duration
              </Label>
              <Select
                value={seedanceDuration.toString()}
                onValueChange={(value) =>
                  onSeedanceDurationChange(Number(value) as SeedanceDuration)
                }
              >
                <SelectTrigger id="seedance-duration" className="h-8 text-xs">
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
                  onSeedanceResolutionChange(value as SeedanceResolution)
                }
              >
                <SelectTrigger id="seedance-resolution" className="h-8 text-xs">
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
                onSeedanceAspectRatioChange(value as SeedanceAspectRatio)
              }
            >
              <SelectTrigger id="seedance-aspect" className="h-8 text-xs">
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
                onSeedanceCameraFixedChange(Boolean(checked))
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
                  onSeedanceEndFrameUrlChange(
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
                  onSeedanceEndFrameFileChange(file, preview || null);
                  if (file) {
                    onSeedanceEndFrameUrlChange(undefined);
                  }
                }}
                onError={onError}
                isCompact={isCompact}
              />
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Estimated cost: ${seedanceEstimatedCost.toFixed(2)}
          </div>
          <div className="text-xs text-muted-foreground">
            Seedance animates 2-12 second clips with reproducible seeds and
            optional end frames (Pro only).
          </div>
        </div>
      )}

      {/* Kling v2.5 Settings */}
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
                  onKlingDurationChange(Number(value) as 5 | 10)
                }
              >
                <SelectTrigger id="kling-duration" className="h-8 text-xs">
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
                  onKlingAspectRatioChange(value as KlingAspectRatio)
                }
              >
                <SelectTrigger id="kling-aspect" className="h-8 text-xs">
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
                onKlingCfgScaleChange(Number(event.target.value))
              }
              className="w-full cursor-pointer"
            />
            <div className="text-xs text-muted-foreground">
              Lower values add more freedom, higher values follow the prompt
              closely.
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="kling-enhance-prompt"
              checked={klingEnhancePrompt}
              onCheckedChange={(checked) =>
                onKlingEnhancePromptChange(Boolean(checked))
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
              onChange={(event) =>
                onKlingNegativePromptChange(event.target.value)
              }
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

      {/* Kling v2.6 Settings */}
      {kling26I2VSelected && (
        <div className="space-y-3 text-left border-t pt-3">
          <Label className="text-sm font-semibold">
            Kling v2.6 Pro Settings
          </Label>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="kling26-duration" className="text-xs">
                Duration
              </Label>
              <Select
                value={kling26Duration.toString()}
                onValueChange={(value) =>
                  onKling26DurationChange(Number(value) as 5 | 10)
                }
              >
                <SelectTrigger id="kling26-duration" className="h-8 text-xs">
                  <SelectValue placeholder="Select duration" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">
                    5 seconds (${kling26GenerateAudio ? "0.70" : "0.35"})
                  </SelectItem>
                  <SelectItem value="10">
                    10 seconds (${kling26GenerateAudio ? "1.40" : "0.70"})
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="kling26-aspect" className="text-xs">
                Aspect Ratio
              </Label>
              <Select
                value={kling26AspectRatio}
                onValueChange={(value) =>
                  onKling26AspectRatioChange(value as Kling26AspectRatio)
                }
              >
                <SelectTrigger id="kling26-aspect" className="h-8 text-xs">
                  <SelectValue placeholder="Select aspect ratio" />
                </SelectTrigger>
                <SelectContent>
                  {KLING26_ASPECT_RATIOS.map((ratio) => (
                    <SelectItem key={ratio} value={ratio}>
                      {ratio.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="kling26-cfg" className="text-xs">
              Prompt Adherence ({kling26CfgScale.toFixed(1)})
            </Label>
            <input
              id="kling26-cfg"
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={kling26CfgScale}
              onChange={(event) =>
                onKling26CfgScaleChange(Number(event.target.value))
              }
              className="w-full cursor-pointer"
            />
            <div className="text-xs text-muted-foreground">
              Lower values add more freedom, higher values follow the prompt
              closely.
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="kling26-generate-audio"
              checked={kling26GenerateAudio}
              onCheckedChange={(checked) =>
                onKling26GenerateAudioChange(Boolean(checked))
              }
            />
            <Label htmlFor="kling26-generate-audio" className="text-xs">
              Generate native audio (Chinese/English)
            </Label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="kling26-negative-prompt" className="text-xs">
              Negative Prompt (optional)
            </Label>
            <Textarea
              id="kling26-negative-prompt"
              value={kling26NegativePrompt}
              onChange={(event) =>
                onKling26NegativePromptChange(event.target.value)
              }
              placeholder="blur, distort, and low quality"
              className="min-h-[60px] text-xs"
              maxLength={2500}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Estimated cost: ${kling26EstimatedCost.toFixed(2)}
            {kling26GenerateAudio ? " (with audio)" : " (no audio)"}
          </div>
          <div className="text-xs text-muted-foreground">
            Kling v2.6 Pro supports native audio generation and offers cinematic
            visual quality.
          </div>
        </div>
      )}

      {/* WAN 2.5 Settings */}
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
                  onWan25DurationChange(Number(value) as Wan25Duration)
                }
              >
                <SelectTrigger id="wan25-duration" className="h-8 text-xs">
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
                  onWan25ResolutionChange(value as Wan25Resolution)
                }
              >
                <SelectTrigger id="wan25-resolution" className="h-8 text-xs">
                  <SelectValue placeholder="Select resolution" />
                </SelectTrigger>
                <SelectContent>
                  {wan25ResolutionOptions.map((resolutionOption) => (
                    <SelectItem key={resolutionOption} value={resolutionOption}>
                      {resolutionOption.toUpperCase()} ( $
                      {wan25ModelConfig?.perSecondPricing?.[resolutionOption] ??
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
                onWan25EnablePromptExpansionChange(Boolean(checked))
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
                onWan25NegativePromptChange(event.target.value.slice(0, 500))
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
                onWan25AudioUrlChange(
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
                onWan25AudioFileChange(file, preview || null);
                if (file) {
                  onWan25AudioUrlChange(undefined);
                }
              }}
              onError={onError}
              isCompact={isCompact}
            />
          </div>

          <div className="text-xs text-muted-foreground">
            Estimated cost: ${wan25EstimatedCost.toFixed(2)} ( $
            {wan25PricePerSecond.toFixed(2)}/sec)
          </div>
        </div>
      )}

      {/* Advanced Options (Seed) */}
      {(seedanceSelected || wan25Selected) && (
        <div className="space-y-2 text-left border-t pt-3">
          <Label className="text-sm font-semibold">Advanced Options</Label>
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
                  onImageSeedChange(undefined);
                  return;
                }
                const parsed = Number(nextValue);
                if (!Number.isNaN(parsed)) {
                  onImageSeedChange(parsed);
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
    </div>
  );
}
