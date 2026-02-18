/**
 * Unified Audio Panel
 *
 * Combines Kling Video-to-Audio and MMAudio V2 into a single panel
 * with a model selector at the top.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { AudioGenTab } from "./video-edit-audio-gen";
import { AudioSyncTab } from "./video-edit-audio-sync";

type AudioModel = "kling" | "mmaudio";

const AUDIO_MODELS: Array<{
  id: AudioModel;
  label: string;
  description: string;
}> = [
  {
    id: "kling",
    label: "Kling Audio",
    description: "Auto-generate audio from video — $0.035/video",
  },
  {
    id: "mmaudio",
    label: "MMAudio V2",
    description: "Prompt-controlled sync — $0.001/sec",
  },
];

export function AudioPanel() {
  const [selectedModel, setSelectedModel] = useState<AudioModel>("kling");

  return (
    <div className="space-y-4">
      {/* Model Selector */}
      <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 p-1.5">
        {AUDIO_MODELS.map((model) => (
          <button
            key={model.id}
            type="button"
            title={model.description}
            aria-pressed={selectedModel === model.id}
            onClick={() => setSelectedModel(model.id)}
            className={cn(
              "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              selectedModel === model.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
            )}
          >
            {model.label}
          </button>
        ))}
      </div>

      {/* Model-specific content */}
      {selectedModel === "kling" && <AudioGenTab />}
      {selectedModel === "mmaudio" && <AudioSyncTab />}
    </div>
  );
}
