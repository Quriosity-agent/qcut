/**
 * Topaz Video Upscale Tab Component
 *
 * WHY this component:
 * - Professional quality upscaling up to 8x
 * - Frame interpolation for smoother playback
 * - Essential for improving low-res content
 */

import { useState } from "react";
import { Loader2, Maximize2, Film, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FileUpload } from "@/components/ui/file-upload";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { useVideoEditProcessing } from "./use-video-edit-processing";
import { useProjectStore } from "@/stores/project-store";
import {
  VIDEO_EDIT_UPLOAD_CONSTANTS,
  VIDEO_EDIT_HELPERS,
  VIDEO_EDIT_ERROR_MESSAGES,
} from "./video-edit-constants";
import type { TopazUpscaleParams } from "./video-edit-types";
import { openInNewTab } from "@/lib/utils";

export function UpscaleTab() {
  // State
  const [sourceVideo, setSourceVideo] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [upscaleFactor, setUpscaleFactor] = useState(2.0);
  const [targetFps, setTargetFps] = useState<number | undefined>();
  const [h264Output, setH264Output] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store hooks
  const { activeProject } = useProjectStore();

  // Processing hook
  const {
    isProcessing,
    progress,
    statusMessage,
    elapsedTime,
    estimatedTime,
    result,
    handleProcess,
    reset,
    canProcess,
  } = useVideoEditProcessing({
    sourceVideo,
    activeTab: "upscale",
    activeProject,
    onSuccess: (result) => {
      console.log("Upscale complete:", result);
    },
    onError: (error) => {
      setError(error);
    },
  });

  /**
   * Handle video file change
   * WHY: Topaz supports up to 500MB files (larger than default 100MB)
   */
  const handleVideoChange = (file: File | null, preview: string | undefined | null) => {
    if (file) {
      // Validate with Topaz's 500MB limit
      const validation = VIDEO_EDIT_HELPERS.validateVideoFile(
        file,
        VIDEO_EDIT_UPLOAD_CONSTANTS.TOPAZ_MAX_VIDEO_SIZE_BYTES
      );
      if (!validation.valid) {
        setError(validation.error!);
        return;
      }
    }

    setSourceVideo(file);
    setVideoPreview(preview ?? null);  // Coerce undefined to null for type safety
    setError(null);
    reset();
  };

  /**
   * Handle process click
   */
  const handleProcessClick = async () => {
    if (!sourceVideo) {
      setError(VIDEO_EDIT_ERROR_MESSAGES.NO_VIDEO);
      return;
    }

    const params: Partial<TopazUpscaleParams> = {
      upscale_factor: upscaleFactor,
      target_fps: targetFps,
      H264_output: h264Output,
    };

    await handleProcess(params);
  };

  /**
   * Get resolution label
   */
  const getResolutionLabel = () => {
    const baseRes = "720p";  // Assume 720p input
    const factor = upscaleFactor;

    if (factor <= 1.5) return "1080p";
    if (factor <= 2) return "1440p";
    if (factor <= 3) return "4K";
    if (factor <= 4) return "5K";
    return "8K";
  };

  /**
   * Get estimated processing time
   */
  const getEstimatedTime = () => {
    const factor = upscaleFactor;
    if (factor <= 2) return "30-60 seconds";
    if (factor <= 4) return "2-4 minutes";
    return "10-15 minutes";
  };

  return (
    <div className="space-y-4">
      {/* Model Info */}
      <Card className="p-3 bg-primary/5 border-primary/20">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-primary">Topaz Video Upscale</p>
            <p className="text-xs text-muted-foreground mt-0.5">Professional upscaling up to 8x with AI enhancement</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold">$0.50 - $5.00</p>
            <p className="text-xs text-muted-foreground">varies by factor</p>
          </div>
        </div>
      </Card>

      {/* Video Upload */}
      <FileUpload
        id="topaz-video-input"
        label="Source Video"
        helperText="Up to 2 minutes"
        fileType="video"
        acceptedTypes={VIDEO_EDIT_UPLOAD_CONSTANTS.ALLOWED_VIDEO_TYPES}
        maxSizeBytes={VIDEO_EDIT_UPLOAD_CONSTANTS.TOPAZ_MAX_VIDEO_SIZE_BYTES}
        maxSizeLabel={VIDEO_EDIT_UPLOAD_CONSTANTS.TOPAZ_MAX_VIDEO_SIZE_LABEL}
        formatsLabel={VIDEO_EDIT_UPLOAD_CONSTANTS.VIDEO_FORMATS_LABEL}
        file={sourceVideo}
        preview={videoPreview}
        onFileChange={handleVideoChange}
        onError={setError}
      />

      {/* Upscale Factor */}
      <div className="space-y-2">
        <Label className="flex items-center justify-between text-xs">
          <span className="flex items-center">
            <Maximize2 className="size-3 mr-1" />
            Upscale Factor: {upscaleFactor.toFixed(1)}x
          </span>
          <span className="text-primary">{getResolutionLabel()}</span>
        </Label>
        <Slider
          value={[upscaleFactor]}
          onValueChange={([v]) => setUpscaleFactor(v)}
          min={1.0}
          max={8.0}
          step={0.5}
          disabled={isProcessing}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          Higher factor = better quality but longer processing
        </p>
      </div>

      {/* Frame Interpolation */}
      <div className="space-y-2">
        <Label className="flex items-center text-xs">
          <Film className="size-3 mr-1" />
          Target FPS (Optional)
        </Label>
        <Select
          value={targetFps?.toString() || "none"}
          onValueChange={(v) => setTargetFps(v === "none" ? undefined : parseInt(v))}
          disabled={isProcessing}
        >
          <SelectTrigger className="text-xs">
            <SelectValue placeholder="Original FPS" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Original FPS</SelectItem>
            <SelectItem value="24">24 FPS (Cinema)</SelectItem>
            <SelectItem value="30">30 FPS (Standard)</SelectItem>
            <SelectItem value="60">60 FPS (Smooth)</SelectItem>
            <SelectItem value="120">120 FPS (Ultra Smooth)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Frame interpolation creates smoother motion
        </p>
      </div>

      {/* Codec Selection */}
      <Card className="p-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs">H.264 Output</Label>
            <p className="text-xs text-muted-foreground">
              Better compatibility but larger file size
            </p>
          </div>
          <Switch
            checked={h264Output}
            onCheckedChange={setH264Output}
            disabled={isProcessing}
          />
        </div>
      </Card>

      {/* Processing Estimate */}
      <Card className="p-3 bg-primary/5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center text-xs">
              <DollarSign className="size-3 mr-1" />
              <span>Estimated Cost:</span>
            </div>
            <span className="text-xs font-medium">
              {VIDEO_EDIT_HELPERS.formatCost(
                VIDEO_EDIT_HELPERS.estimateTopazCost(upscaleFactor)
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Processing Time:</span>
            <span className="text-xs">{getEstimatedTime()}</span>
          </div>
        </div>
      </Card>

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Progress Display */}
      {isProcessing && (
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{statusMessage}</span>
            <span>
              {elapsedTime}s
              {estimatedTime && ` / ~${Math.round(estimatedTime / 60)}min`}
            </span>
          </div>
        </div>
      )}

      {/* Result Display */}
      {result && !isProcessing && (
        <Card className="p-3 bg-primary/5">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <p className="text-xs font-medium text-primary">
                ✓ Upscale complete!
              </p>
              {result.cost && (
                <span className="text-xs">
                  Cost: {VIDEO_EDIT_HELPERS.formatCost(result.cost)}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {result.fileSize && (
                <p>Output size: {(result.fileSize / 1024 / 1024).toFixed(1)} MB</p>
              )}
            </div>
            {result.videoUrl && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openInNewTab(result.videoUrl)}
                className="w-full text-xs"
              >
                Download Upscaled Video
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Process Button */}
      <Button
        onClick={handleProcessClick}
        disabled={!canProcess}
        className="w-full"
        size="sm"
      >
        {isProcessing ? (
          <>
            <Loader2 className="size-4 mr-2 animate-spin" />
            Upscaling... {progress}%
          </>
        ) : (
          <>
            <Maximize2 className="size-4 mr-2" />
            Upscale Video
          </>
        )}
      </Button>

      {/* Info */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p>• Videos up to 2 minutes supported</p>
        <p>• 8x upscale may fail for 720p+ sources (8K limit)</p>
        <p>• H.265 produces smaller files but may have compatibility issues</p>
        <p>• Processing time increases exponentially with upscale factor</p>
      </div>
    </div>
  );
}
