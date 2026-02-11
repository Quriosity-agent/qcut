import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  KLING26_ASPECT_RATIOS,
  type Kling26AspectRatio,
} from "../constants/ai-model-options";
import { calculateKling26Cost } from "../utils/ai-cost-calculators";

export interface AiKlingV26SettingsProps {
  duration: 5 | 10;
  onDurationChange: (value: 5 | 10) => void;
  aspectRatio: Kling26AspectRatio;
  onAspectRatioChange: (value: Kling26AspectRatio) => void;
  cfgScale: number;
  onCfgScaleChange: (value: number) => void;
  generateAudio: boolean;
  onGenerateAudioChange: (value: boolean) => void;
  negativePrompt: string;
  onNegativePromptChange: (value: string) => void;
  isCompact: boolean;
}

export function AiKlingV26Settings({
  duration,
  onDurationChange,
  aspectRatio,
  onAspectRatioChange,
  cfgScale,
  onCfgScaleChange,
  generateAudio,
  onGenerateAudioChange,
  negativePrompt,
  onNegativePromptChange,
  isCompact: _isCompact,
}: AiKlingV26SettingsProps) {
  const estimatedCost = calculateKling26Cost(duration, generateAudio);

  return (
    <div className="space-y-3 text-left border-t pt-3">
      <Label className="text-sm font-semibold">Kling v2.6 Pro Settings</Label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="kling26-duration" className="text-xs">
            Duration
          </Label>
          <Select
            value={duration.toString()}
            onValueChange={(value) => onDurationChange(Number(value) as 5 | 10)}
          >
            <SelectTrigger id="kling26-duration" className="h-8 text-xs">
              <SelectValue placeholder="Select duration" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">
                5 seconds (${generateAudio ? "0.70" : "0.35"})
              </SelectItem>
              <SelectItem value="10">
                10 seconds (${generateAudio ? "1.40" : "0.70"})
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="kling26-aspect" className="text-xs">
            Aspect Ratio
          </Label>
          <Select
            value={aspectRatio}
            onValueChange={(value) =>
              onAspectRatioChange(value as Kling26AspectRatio)
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
          Prompt Adherence ({cfgScale.toFixed(1)})
        </Label>
        <input
          id="kling26-cfg"
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={cfgScale}
          onChange={(event) => onCfgScaleChange(Number(event.target.value))}
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
          checked={generateAudio}
          onCheckedChange={(checked) => onGenerateAudioChange(Boolean(checked))}
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
          value={negativePrompt}
          onChange={(event) => onNegativePromptChange(event.target.value)}
          placeholder="blur, distort, and low quality"
          className="min-h-[60px] text-xs"
          maxLength={2500}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        Estimated cost: ${estimatedCost.toFixed(2)}
        {generateAudio ? " (with audio)" : " (no audio)"}
      </div>
      <div className="text-xs text-muted-foreground">
        Kling v2.6 Pro supports native audio generation and offers cinematic
        visual quality.
      </div>
    </div>
  );
}
