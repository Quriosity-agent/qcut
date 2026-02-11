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
import { AI_MODELS } from "../constants/ai-constants";
import {
  KLING_ASPECT_RATIOS,
  type KlingAspectRatio,
} from "../constants/ai-model-options";
import { calculateKlingCost } from "../utils/ai-cost-calculators";

export interface AiKlingV25SettingsProps {
  duration: 5 | 10;
  onDurationChange: (value: 5 | 10) => void;
  aspectRatio: KlingAspectRatio;
  onAspectRatioChange: (value: KlingAspectRatio) => void;
  cfgScale: number;
  onCfgScaleChange: (value: number) => void;
  enhancePrompt: boolean;
  onEnhancePromptChange: (value: boolean) => void;
  negativePrompt: string;
  onNegativePromptChange: (value: string) => void;
  isCompact: boolean;
}

export function AiKlingV25Settings({
  duration,
  onDurationChange,
  aspectRatio,
  onAspectRatioChange,
  cfgScale,
  onCfgScaleChange,
  enhancePrompt,
  onEnhancePromptChange,
  negativePrompt,
  onNegativePromptChange,
  isCompact: _isCompact,
}: AiKlingV25SettingsProps) {
  const klingModelConfig = AI_MODELS.find(
    (model) => model.id === "kling_v2_5_turbo_i2v"
  );
  const aspectRatios =
    klingModelConfig?.supportedAspectRatios ?? KLING_ASPECT_RATIOS;
  const estimatedCost = calculateKlingCost(duration);

  return (
    <div className="space-y-3 text-left border-t pt-3">
      <Label className="text-sm font-semibold">Kling v2.5 Turbo Settings</Label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="kling-duration" className="text-xs">
            Duration
          </Label>
          <Select
            value={duration.toString()}
            onValueChange={(value) => onDurationChange(Number(value) as 5 | 10)}
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
            value={aspectRatio}
            onValueChange={(value) =>
              onAspectRatioChange(value as KlingAspectRatio)
            }
          >
            <SelectTrigger id="kling-aspect" className="h-8 text-xs">
              <SelectValue placeholder="Select aspect ratio" />
            </SelectTrigger>
            <SelectContent>
              {aspectRatios.map((ratio) => (
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
          Prompt Adherence ({cfgScale.toFixed(1)})
        </Label>
        <input
          id="kling-cfg"
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
          id="kling-enhance-prompt"
          checked={enhancePrompt}
          onCheckedChange={(checked) => onEnhancePromptChange(Boolean(checked))}
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
          value={negativePrompt}
          onChange={(event) => onNegativePromptChange(event.target.value)}
          placeholder="blur, distort, low quality"
          className="min-h-[60px] text-xs"
          maxLength={2500}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        Estimated cost: ${estimatedCost.toFixed(2)}
      </div>
    </div>
  );
}
