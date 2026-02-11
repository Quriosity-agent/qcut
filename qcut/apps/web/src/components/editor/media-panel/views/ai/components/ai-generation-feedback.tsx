import { Play, Download } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AI_MODELS } from "../constants/ai-constants";

interface GeneratedVideoResult {
  modelId: string;
  video: {
    jobId: string;
    prompt: string;
    videoUrl?: string;
    videoPath?: string;
  };
}

interface AIGenerationFeedbackProps {
  error: string | null;
  isGenerating: boolean;
  generationProgress: number;
  statusMessage: string;
  elapsedTime: number;
  hasResults: boolean;
  generatedVideos: GeneratedVideoResult[];
}

export function AIGenerationFeedback({
  error,
  isGenerating,
  generationProgress,
  statusMessage,
  elapsedTime,
  hasResults,
  generatedVideos,
}: AIGenerationFeedbackProps) {
  return (
    <>
      {/* Error Display */}
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
          <div className="text-xs text-destructive">{error}</div>
        </div>
      )}

      {/* Progress Display */}
      {isGenerating && (
        <div className="space-y-3 p-3 bg-muted/50 rounded-md">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium">Generating...</div>
            <div className="text-xs text-muted-foreground">
              {Math.round(generationProgress)}%
            </div>
          </div>
          <div className="w-full bg-muted-foreground/20 rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${generationProgress}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">{statusMessage}</div>
          {elapsedTime > 0 && (
            <div className="text-xs text-muted-foreground">
              Elapsed: {Math.floor(elapsedTime / 60)}:
              {(elapsedTime % 60).toString().padStart(2, "0")}
            </div>
          )}
        </div>
      )}

      {/* Generated Videos Results */}
      {hasResults && (
        <div className="space-y-2">
          <Label className="text-xs">Generated Videos</Label>
          <div className="space-y-2">
            {generatedVideos.map((result) => {
              const model = AI_MODELS.find((m) => m.id === result.modelId);
              return (
                <div
                  key={result.video.jobId}
                  className="flex items-center justify-between p-2 bg-muted/30 rounded-md"
                >
                  <div className="flex items-center space-x-2">
                    <Play className="size-4 text-primary" />
                    <div>
                      <div className="text-xs font-medium">{model?.name}</div>
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
    </>
  );
}
