/**
 * Kling Video to Audio Tab Component
 *
 * WHY this component:
 * - Generates audio for videos (3-20 seconds)
 * - Creates sound effects and background music
 * - Supports ASMR mode for enhanced audio
 */

import { useState } from "react";
import { Loader2, Volume2, Music, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import type { KlingVideoToAudioParams } from "./video-edit-types";
import { openInNewTab } from "@/lib/utils";

export function AudioGenTab() {
  // State
  const [sourceVideo, setSourceVideo] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [soundEffectPrompt, setSoundEffectPrompt] = useState("");
  const [backgroundMusicPrompt, setBackgroundMusicPrompt] = useState("");
  const [asmrMode, setAsmrMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    activeTab: "audio-gen",
    activeProject,
    onSuccess: (result) => {
      console.log("Audio generation complete:", result);
      // Could show success toast here
    },
    onError: (error) => {
      setError(error);
    },
  });

  /**
   * Handle video file change
   * WHY: Validate and preview video before processing
   */
  const handleVideoChange = (file: File | null, preview: string | undefined | null) => {
    if (file) {
      // Validate file
      const validation = VIDEO_EDIT_HELPERS.validateVideoFile(file);
      if (!validation.valid) {
        setError(validation.error!);
        return;
      }
    }

    setSourceVideo(file);
    setVideoPreview(preview ?? null);  // Coerce undefined to null for type safety
    setError(null);
    reset();  // Reset processing state
  };

  /**
   * Handle process click
   * WHY: Start audio generation with optional prompts
   */
  const handleProcessClick = async () => {
    if (!sourceVideo) {
      setError(VIDEO_EDIT_ERROR_MESSAGES.NO_VIDEO);
      return;
    }

    // Include optional prompts if provided
    const params: Partial<KlingVideoToAudioParams> = {
      sound_effect_prompt: soundEffectPrompt.trim() || undefined,
      background_music_prompt: backgroundMusicPrompt.trim() || undefined,
      asmr_mode: asmrMode,
    };

    await handleProcess(params);
  };

  return (
    <div className="space-y-4">
      {/* Model Info */}
      <Card className="p-3 bg-primary/5 border-primary/20">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-primary">Kling Video to Audio</p>
            <p className="text-xs text-muted-foreground mt-0.5">Generate audio from video content</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold">$0.035</p>
            <p className="text-xs text-muted-foreground">per video</p>
          </div>
        </div>
      </Card>

      {/* Video Upload */}
      <FileUpload
        id="kling-video-input"
        label="Source Video"
        helperText="3-20 seconds"
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

      {/* Sound Effect Prompt */}
      <div className="space-y-2">
        <Label className="flex items-center text-xs">
          <Volume2 className="size-3 mr-1" />
          Sound Effects (Optional)
        </Label>
        <Textarea
          placeholder="e.g., footsteps on gravel, birds chirping, wind rustling (max 200 chars)"
          value={soundEffectPrompt}
          onChange={(e) => setSoundEffectPrompt(e.target.value)}
          className="min-h-[60px] text-xs"
          disabled={isProcessing}
          maxLength={200}
        />
      </div>

      {/* Background Music Prompt */}
      <div className="space-y-2">
        <Label className="flex items-center text-xs">
          <Music className="size-3 mr-1" />
          Background Music (Optional)
        </Label>
        <Textarea
          placeholder="e.g., upbeat jazz piano, cinematic orchestral, lo-fi hip hop (max 200 chars)"
          value={backgroundMusicPrompt}
          onChange={(e) => setBackgroundMusicPrompt(e.target.value)}
          className="min-h-[60px] text-xs"
          disabled={isProcessing}
          maxLength={200}
        />
      </div>

      {/* ASMR Mode */}
      <Card className="p-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="flex items-center text-xs">
              <Sparkles className="size-3 mr-1" />
              ASMR Mode
            </Label>
            <p className="text-xs text-muted-foreground">
              Enhance detailed sound effects for immersive content
            </p>
          </div>
          <Switch
            checked={asmrMode}
            onCheckedChange={setAsmrMode}
            disabled={isProcessing}
          />
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
            <p className="text-xs font-medium text-primary">
              ✓ Audio generation complete!
            </p>
            {result.audioUrl && (
              <audio
                controls
                className="w-full h-8"
                src={result.audioUrl}
              />
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
              {result.audioUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => openInNewTab(result.audioUrl!)}
                  className="text-xs"
                >
                  Download Audio
                </Button>
              )}
            </div>
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
            Processing... {progress}%
          </>
        ) : (
          <>
            <Volume2 className="size-4 mr-2" />
            Generate Audio
          </>
        )}
      </Button>

      {/* Info */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p>• Videos must be 3-20 seconds long</p>
        <p>• Prompts are optional (max 200 characters each)</p>
        <p>• Generates sound effects and background music</p>
      </div>
    </div>
  );
}
