/**
 * MMAudio V2 Audio Sync Tab Component
 *
 * WHY this component:
 * - Creates synchronized audio based on video content
 * - Text prompt control over style/mood
 * - $0.001 per second pricing model
 */

import { useId, useState } from "react";
import { Loader2, Music2, Settings, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { FileUpload } from "@/components/ui/file-upload";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useVideoEditProcessing } from "./use-video-edit-processing";
import { useProjectStore } from "@/stores/project-store";
import {
  VIDEO_EDIT_UPLOAD_CONSTANTS,
  VIDEO_EDIT_HELPERS,
  VIDEO_EDIT_ERROR_MESSAGES,
} from "./video-edit-constants";
import type { MMAudioV2Params } from "./video-edit-types";
import { openInNewTab } from "@/lib/utils";

export function AudioSyncTab() {
  // State
  const [sourceVideo, setSourceVideo] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [numSteps, setNumSteps] = useState(25);
  const [cfgStrength, setCfgStrength] = useState(4.5);
  const [seed, setSeed] = useState<number | undefined>();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioDescriptionId = useId();

  // Store hooks
  const { activeProject } = useProjectStore();

  // Processing hook
  const {
    isProcessing,
    progress,
    statusMessage,
    elapsedTime,
    result,
    handleProcess,
    reset,
    canProcess,
  } = useVideoEditProcessing({
    sourceVideo,
    activeTab: "audio-sync",
    activeProject,
    onSuccess: (result) => {
      console.log("Audio sync complete:", result);
    },
    onError: (error) => {
      setError(error);
    },
  });

  /**
   * Handle video file change
   */
  const handleVideoChange = (file: File | null, preview: string | undefined | null) => {
    if (file) {
      const validation = VIDEO_EDIT_HELPERS.validateVideoFile(file);
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

    if (!prompt.trim()) {
      setError(VIDEO_EDIT_ERROR_MESSAGES.NO_PROMPT);
      return;
    }

    const params: Partial<MMAudioV2Params> = {
      prompt: prompt.trim(),
      negative_prompt: negativePrompt.trim() || undefined,
      num_steps: numSteps,
      cfg_strength: cfgStrength,
      seed: seed,
    };

    await handleProcess(params);
  };

  /**
   * Estimate cost based on video duration
   * WHY: Show cost before processing
   */
  const estimateCost = () => {
    // Rough estimate: assume 10 second video
    const estimatedDuration = 10;
    return VIDEO_EDIT_HELPERS.calculateMMAudioCost(estimatedDuration);
  };

  // Audio description for accessibility
  const audioDescription = [
    "Generated audio preview",
    prompt.trim() && `Based on prompt: ${prompt.trim()}`,
    negativePrompt.trim() && `Negative prompt: ${negativePrompt.trim()}`
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <div className="space-y-4">
      {/* Model Info */}
      <Card className="p-3 bg-primary/5 border-primary/20">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-primary">MMAudio V2</p>
            <p className="text-xs text-muted-foreground mt-0.5">Synchronized audio generation with prompt control</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold">$0.001/sec</p>
            <p className="text-xs text-muted-foreground">~$0.01 for 10s</p>
          </div>
        </div>
      </Card>

      {/* Video Upload */}
      <FileUpload
        id="mmaudio-video-input"
        label="Source Video"
        helperText="Up to 60 seconds"
        fileType="video"
        acceptedTypes={VIDEO_EDIT_UPLOAD_CONSTANTS.ALLOWED_VIDEO_TYPES}
        maxSizeBytes={VIDEO_EDIT_UPLOAD_CONSTANTS.MAX_VIDEO_SIZE_BYTES}
        maxSizeLabel={VIDEO_EDIT_UPLOAD_CONSTANTS.MAX_VIDEO_SIZE_LABEL}
        formatsLabel={VIDEO_EDIT_UPLOAD_CONSTANTS.VIDEO_FORMATS_LABEL}
        file={sourceVideo}
        preview={videoPreview}
        onFileChange={handleVideoChange}
        onError={setError}
      />

      {/* Audio Prompt */}
      <div className="space-y-2">
        <Label className="flex items-center text-xs">
          <Music2 className="size-3 mr-1" />
          Audio Prompt (Required)
        </Label>
        <Textarea
          placeholder="e.g., cinematic orchestral score with rising tension, upbeat electronic dance music, peaceful ambient nature sounds"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-[80px] text-xs"
          disabled={isProcessing}
        />
      </div>

      {/* Negative Prompt */}
      <div className="space-y-2">
        <Label className="text-xs">Negative Prompt (Optional)</Label>
        <Textarea
          placeholder="e.g., no vocals, no speech, no silence, no distortion"
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          className="min-h-[60px] text-xs"
          disabled={isProcessing}
        />
      </div>

      {/* Advanced Settings */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <Settings className="size-3 mr-1" />
            Advanced Settings
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 mt-4">
          {/* Steps */}
          <div className="space-y-2">
            <Label className="text-xs">
              Generation Steps: {numSteps}
            </Label>
            <Slider
              value={[numSteps]}
              onValueChange={([v]) => setNumSteps(v)}
              min={10}
              max={50}
              step={5}
              disabled={isProcessing}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher = better quality, slower processing
            </p>
          </div>

          {/* CFG Strength */}
          <div className="space-y-2">
            <Label className="text-xs">
              Prompt Strength: {cfgStrength.toFixed(1)}
            </Label>
            <Slider
              value={[cfgStrength]}
              onValueChange={([v]) => setCfgStrength(v)}
              min={1.0}
              max={7.0}
              step={0.5}
              disabled={isProcessing}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Lower = follows video, Higher = follows prompt
            </p>
          </div>

          {/* Seed */}
          <div className="space-y-2">
            <Label className="text-xs">Seed (Optional)</Label>
            <Input
              type="number"
              placeholder="Random"
              value={seed || ""}
              onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : undefined)}
              disabled={isProcessing}
              className="text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Use same seed for reproducible results
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Cost Estimate */}
      <Card className="p-3 bg-primary/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center text-xs">
            <DollarSign className="size-3 mr-1" />
            <span>Estimated Cost:</span>
          </div>
          <span className="text-xs font-medium">
            {VIDEO_EDIT_HELPERS.formatCost(estimateCost())} ($0.001/sec)
          </span>
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
            <span>{elapsedTime}s</span>
          </div>
        </div>
      )}

      {/* Result Display */}
      {result && !isProcessing && (
        <Card className="p-3 bg-primary/5">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <p className="text-xs font-medium text-primary">
                ✓ Audio sync complete!
              </p>
              {result.cost && (
                <span className="text-xs">
                  Cost: {VIDEO_EDIT_HELPERS.formatCost(result.cost)}
                </span>
              )}
            </div>
            {result.audioUrl && (
              <>
                <p id={audioDescriptionId} className="sr-only">
                  {audioDescription}
                </p>
                <audio
                  controls
                  className="w-full h-8"
                  src={result.audioUrl}
                  aria-describedby={audioDescriptionId}
                />
              </>
            )}
            <div className="flex gap-2">
              {result.videoUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => openInNewTab(result.videoUrl!)}
                  className="text-xs"
                >
                  Download Video
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Process Button */}
      <Button
        onClick={handleProcessClick}
        disabled={!canProcess || !prompt.trim()}
        className="w-full"
        size="sm"
      >
        {isProcessing ? (
          <>
            <Loader2 className="size-4 mr-2 animate-spin" />
            Processing... {progress}%
          </>
        ) : (
          <>
            <Music2 className="size-4 mr-2" />
            Generate Synchronized Audio
          </>
        )}
      </Button>

      {/* Info */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p>• Videos up to 60 seconds supported</p>
        <p>• Audio will match video timing and events</p>
        <p>• Use negative prompt to avoid unwanted sounds</p>
      </div>
    </div>
  );
}
