/**
 * Upscale Tab UI Component
 *
 * Renders the Upscale tab UI including:
 * - Video upload section
 * - Video URL input
 * - ByteDance upscaler settings
 * - FlashVSR upscaler settings
 * - Topaz upscaler settings
 *
 * @see ai-tsx-refactoring.md - Subtask 3.6
 */

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
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";

import { UPLOAD_CONSTANTS } from "../constants/ai-constants";
import { calculateTopazUpscaleCost } from "../utils/ai-cost-calculators";
import type { VideoMetadata } from "@/lib/video-metadata";

// ============================================
// Types
// ============================================

export type ByteDanceResolution = "1080p" | "2k" | "4k";
export type ByteDanceFPS = "30fps" | "60fps";
export type FlashVSRAcceleration = "regular" | "high" | "full";
export type FlashVSROutputFormat = "X264" | "VP9" | "PRORES4444" | "GIF";
export type FlashVSROutputQuality = "low" | "medium" | "high" | "maximum";
export type FlashVSRWriteMode = "fast" | "balanced" | "small";
export type TopazTargetFPS = "original" | "interpolated";

export interface AIUpscaleTabProps {
  /** Selected AI models */
  selectedModels: string[];
  /** Whether compact mode is active */
  isCompact: boolean;
  /** Callback for errors */
  onError: (error: string | null) => void;

  // Source video
  sourceVideoFile: File | null;
  sourceVideoUrl: string;
  videoMetadata: VideoMetadata | null;
  onSourceVideoFileChange: (file: File | null) => Promise<void>;
  onSourceVideoUrlChange: (url: string) => void;
  onVideoUrlBlur: () => Promise<void>;
  setVideoMetadata: (metadata: VideoMetadata | null) => void;

  // ByteDance settings
  bytedanceTargetResolution: ByteDanceResolution;
  onBytedanceTargetResolutionChange: (value: ByteDanceResolution) => void;
  bytedanceTargetFPS: ByteDanceFPS;
  onBytedanceTargetFPSChange: (value: ByteDanceFPS) => void;
  bytedanceEstimatedCost: string;

  // FlashVSR settings
  flashvsrUpscaleFactor: number;
  onFlashvsrUpscaleFactorChange: (value: number) => void;
  flashvsrAcceleration: FlashVSRAcceleration;
  onFlashvsrAccelerationChange: (value: FlashVSRAcceleration) => void;
  flashvsrQuality: number;
  onFlashvsrQualityChange: (value: number) => void;
  flashvsrColorFix: boolean;
  onFlashvsrColorFixChange: (value: boolean) => void;
  flashvsrPreserveAudio: boolean;
  onFlashvsrPreserveAudioChange: (value: boolean) => void;
  flashvsrOutputFormat: FlashVSROutputFormat;
  onFlashvsrOutputFormatChange: (value: FlashVSROutputFormat) => void;
  flashvsrOutputQuality: FlashVSROutputQuality;
  onFlashvsrOutputQualityChange: (value: FlashVSROutputQuality) => void;
  flashvsrOutputWriteMode: FlashVSRWriteMode;
  onFlashvsrOutputWriteModeChange: (value: FlashVSRWriteMode) => void;
  flashvsrSeed: number | undefined;
  onFlashvsrSeedChange: (value: number | undefined) => void;
  flashvsrEstimatedCost: string;

  // Topaz settings
  topazUpscaleFactor: number;
  onTopazUpscaleFactorChange: (value: number) => void;
  topazTargetFPS: TopazTargetFPS;
  onTopazTargetFPSChange: (value: TopazTargetFPS) => void;
  topazH264Output: boolean;
  onTopazH264OutputChange: (value: boolean) => void;
}

// ============================================
// Component
// ============================================

/**
 * Upscale tab component for video upscaling.
 *
 * @example
 * ```tsx
 * <AIUpscaleTab
 *   selectedModels={selectedModels}
 *   isCompact={isCompact}
 *   onError={setError}
 *   sourceVideoFile={sourceVideoFile}
 *   sourceVideoUrl={sourceVideoUrl}
 *   videoMetadata={videoMetadata}
 *   onSourceVideoFileChange={handleUpscaleVideoChange}
 *   // ... other props
 * />
 * ```
 */
export function AIUpscaleTab({
  selectedModels,
  isCompact,
  onError,
  sourceVideoFile,
  sourceVideoUrl,
  videoMetadata,
  onSourceVideoFileChange,
  onSourceVideoUrlChange,
  onVideoUrlBlur,
  setVideoMetadata,
  bytedanceTargetResolution,
  onBytedanceTargetResolutionChange,
  bytedanceTargetFPS,
  onBytedanceTargetFPSChange,
  bytedanceEstimatedCost,
  flashvsrUpscaleFactor,
  onFlashvsrUpscaleFactorChange,
  flashvsrAcceleration,
  onFlashvsrAccelerationChange,
  flashvsrQuality,
  onFlashvsrQualityChange,
  flashvsrColorFix,
  onFlashvsrColorFixChange,
  flashvsrPreserveAudio,
  onFlashvsrPreserveAudioChange,
  flashvsrOutputFormat,
  onFlashvsrOutputFormatChange,
  flashvsrOutputQuality,
  onFlashvsrOutputQualityChange,
  flashvsrOutputWriteMode,
  onFlashvsrOutputWriteModeChange,
  flashvsrSeed,
  onFlashvsrSeedChange,
  flashvsrEstimatedCost,
  topazUpscaleFactor,
  onTopazUpscaleFactorChange,
  topazTargetFPS,
  onTopazTargetFPSChange,
  topazH264Output,
  onTopazH264OutputChange,
}: AIUpscaleTabProps) {
  // Model selection helpers
  const bytedanceUpscalerSelected = selectedModels.includes(
    "bytedance_video_upscaler"
  );
  const flashvsrUpscalerSelected = selectedModels.includes(
    "flashvsr_video_upscaler"
  );
  const topazUpscalerSelected = selectedModels.includes("topaz_video_upscale");

  return (
    <div className="space-y-4">
      {/* Upload Video Section */}
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
            onSourceVideoFileChange(file).catch(() => {
              // Error already handled within the function
            });
          }}
          onError={onError}
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
            onSourceVideoUrlChange(value);
            if (!value) {
              setVideoMetadata(null);
            }
          }}
          onBlur={() => {
            onVideoUrlBlur().catch(() => {
              // Error already handled within the function
            });
          }}
          placeholder="https://example.com/video.mp4"
          className="h-8 text-xs"
        />
      </div>

      {/* ByteDance Upscaler Settings */}
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
                  onBytedanceTargetResolutionChange(
                    value as ByteDanceResolution
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
                  <SelectItem value="1080p">1080p (Full HD)</SelectItem>
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
                  onBytedanceTargetFPSChange(value as ByteDanceFPS)
                }
              >
                <SelectTrigger id="bytedance-fps" className="h-8 text-xs">
                  <SelectValue placeholder="Select FPS" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30fps">30 FPS</SelectItem>
                  <SelectItem value="60fps">60 FPS (2x cost)</SelectItem>
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

      {/* FlashVSR Upscaler Settings */}
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
                onFlashvsrUpscaleFactorChange(
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
                onFlashvsrAccelerationChange(value as FlashVSRAcceleration)
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select acceleration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="regular">Regular (Best quality)</SelectItem>
                <SelectItem value="high">High (30-40% faster)</SelectItem>
                <SelectItem value="full">Full (50-60% faster)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Quality: {flashvsrQuality}</Label>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[flashvsrQuality]}
              onValueChange={(value) =>
                onFlashvsrQualityChange(Math.round(value[0] ?? 70))
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
                onFlashvsrOutputFormatChange(value as FlashVSROutputFormat)
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="X264">X264 (.mp4) - Standard</SelectItem>
                <SelectItem value="VP9">VP9 (.webm) - Modern codec</SelectItem>
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
                onFlashvsrOutputQualityChange(value as FlashVSROutputQuality)
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
                onFlashvsrOutputWriteModeChange(value as FlashVSRWriteMode)
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select encoding profile" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast (Faster encoding)</SelectItem>
                <SelectItem value="balanced">Balanced (Default)</SelectItem>
                <SelectItem value="small">Small (Smaller file size)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="flashvsr-color-fix"
                checked={flashvsrColorFix}
                onCheckedChange={(checked) =>
                  onFlashvsrColorFixChange(Boolean(checked))
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
                  onFlashvsrPreserveAudioChange(Boolean(checked))
                }
              />
              <Label htmlFor="flashvsr-preserve-audio" className="text-xs">
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
                onFlashvsrSeedChange(
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
              <span className="font-semibold">{flashvsrEstimatedCost}</span>
            </div>
            <p>
              Based on output megapixels: (width × factor) × (height × factor) ×
              frames × $0.0005 / 1,000,000.
            </p>
          </div>
        </Card>
      )}

      {/* Topaz Upscaler Settings */}
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
                onTopazUpscaleFactorChange(
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
                onTopazTargetFPSChange(checked ? "interpolated" : "original")
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
                onTopazH264OutputChange(Boolean(checked))
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
    </div>
  );
}
