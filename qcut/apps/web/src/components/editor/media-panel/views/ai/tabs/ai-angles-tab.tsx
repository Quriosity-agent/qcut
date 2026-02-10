/**
 * AI Angles Tab
 *
 * Upload a source image and generate 9 cinematic camera perspectives.
 * Results are shown in a 3×3 grid with click-to-toggle selection.
 */

import { Loader2, Download, CheckCircle2, ImagePlus } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload } from "@/components/ui/file-upload";
import { UPLOAD_CONSTANTS } from "../constants/ai-constants";
import {
  CINEMATIC_ANGLES,
  ANGLE_BATCH_SIZE,
  type CinematicAngleId,
} from "../constants/angles-config";
import { generateCinematicAngles } from "@/lib/ai-video/generators/angles";
import type { useAnglesTabState } from "../hooks/use-ai-angles-tab-state";

interface AIAnglesTabProps {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  isCompact: boolean;
  onError: (error: string | null) => void;
  anglesState: ReturnType<typeof useAnglesTabState>;
}

export function AIAnglesTab({
  prompt,
  onPromptChange,
  isCompact,
  onError,
  anglesState,
}: AIAnglesTabProps) {
  const { state, setters, actions } = anglesState;

  const handleGenerate = useCallback(async () => {
    if (!state.sourceImage) {
      onError("Please upload a source image first");
      return;
    }

    setters.setIsGenerating(true);
    onError(null);

    try {
      await generateCinematicAngles(
        {
          sourceImage: state.sourceImage,
          prompt: prompt.trim(),
        },
        (angleId, status, url) => {
          if (status === "generating") {
            setters.markAngleGenerating(angleId, true);
          } else if (status === "complete" && url) {
            setters.markAngleGenerating(angleId, false);
            setters.setAngleResult(angleId, url);
          } else if (status === "error") {
            setters.markAngleGenerating(angleId, false);
          }
        }
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Angle generation failed");
    } finally {
      setters.setIsGenerating(false);
    }
  }, [state.sourceImage, prompt, setters, onError]);

  const handleDownloadSelected = useCallback(() => {
    for (const { id, url } of state.selectedUrls) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `angle-${id}.png`;
      a.click();
      a.remove();
    }
  }, [state.selectedUrls]);

  return (
    <div className="space-y-4">
      {/* Source Image Upload */}
      <FileUpload
        id="ai-angles-source-image"
        label={isCompact ? "Source" : "Upload Source Image"}
        helperText="One image generates 9 cinematic angles"
        fileType="image"
        acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_IMAGE_TYPES}
        maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
        maxSizeLabel={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
        formatsLabel={UPLOAD_CONSTANTS.IMAGE_FORMATS_LABEL}
        file={state.sourceImage}
        preview={state.sourceImagePreview}
        onFileChange={(file, preview) =>
          setters.setSourceImage(file, preview ?? null)
        }
        onError={(err) => onError(err)}
        isCompact={isCompact}
      />

      {/* Optional Prompt */}
      <div className="space-y-1">
        <Label className="text-xs">Describe the subject (optional)</Label>
        <Textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="e.g. a red sports car, a character in medieval armor..."
          className="min-h-[60px] text-xs resize-none"
          maxLength={500}
        />
      </div>

      {/* Generate Button */}
      <Button
        type="button"
        className="w-full"
        disabled={!state.sourceImage || state.isGenerating}
        onClick={handleGenerate}
      >
        {state.isGenerating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Generating {state.generatingAngles.size} of 9...
          </>
        ) : (
          <>
            <ImagePlus className="mr-2 h-4 w-4" />
            Generate All Angles
          </>
        )}
      </Button>

      {/* 3×3 Angle Grid */}
      {(state.generatedCount > 0 || state.isGenerating) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">
              Generated Angles ({state.generatedCount}/9)
            </Label>
            {state.generatedCount > 0 && (
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="text"
                  onClick={actions.selectAllAngles}
                  className="h-6 px-2 text-xs"
                >
                  All
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="text"
                  onClick={actions.deselectAllAngles}
                  className="h-6 px-2 text-xs"
                >
                  None
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {CINEMATIC_ANGLES.map((angle) => {
              const result = state.generatedAngles[angle.id];
              const isGeneratingThis = state.generatingAngles.has(angle.id);

              return (
                <button
                  key={angle.id}
                  type="button"
                  className={`relative aspect-square rounded-md border-2 overflow-hidden transition-all ${
                    result?.selected
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-muted hover:border-muted-foreground/30"
                  } ${result ? "cursor-pointer" : "cursor-default"}`}
                  onClick={() =>
                    result && actions.toggleAngleSelection(angle.id)
                  }
                  disabled={!result}
                  aria-label={`${angle.label}${result?.selected ? " (selected)" : ""}`}
                >
                  {/* Generated image */}
                  {result && (
                    <img
                      src={result.url}
                      alt={angle.label}
                      className="w-full h-full object-cover"
                    />
                  )}

                  {/* Loading spinner */}
                  {isGeneratingThis && !result && (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  )}

                  {/* Empty placeholder */}
                  {!result && !isGeneratingThis && (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
                      <span className="text-xs text-muted-foreground">
                        {angle.angle >= 0 ? `${angle.angle}°` : "Top"}
                      </span>
                    </div>
                  )}

                  {/* Selection check */}
                  {result?.selected && (
                    <div className="absolute top-1 right-1">
                      <CheckCircle2 className="h-4 w-4 text-primary fill-primary/20" />
                    </div>
                  )}

                  {/* Label */}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                    <span className="text-[10px] text-white leading-tight">
                      {angle.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions for selected angles */}
      {state.selectedCount > 0 && (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="flex-1 text-xs"
            onClick={handleDownloadSelected}
          >
            <Download className="mr-1 h-3 w-3" />
            Download ({state.selectedCount})
          </Button>
        </div>
      )}
    </div>
  );
}
