import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  UPSCALE_MODELS,
  type UpscaleModelId,
} from "@/lib/upscale-models";
import {
  type UpscaleSettings,
  useText2ImageStore,
} from "@/stores/text2image-store";

interface UpscaleSettingsProps {
  className?: string;
}

export function UpscaleSettings({ className }: UpscaleSettingsProps) {
  const upscaleSettings = useText2ImageStore((state) => state.upscaleSettings);
  const setUpscaleSettings = useText2ImageStore((state) => state.setUpscaleSettings);

  const model = UPSCALE_MODELS[upscaleSettings.selectedModel as UpscaleModelId];
  const scaleOptions =
    model.controls.scaleFactor.options ?? model.supportedScales;

  const handleSliderChange = (
    key: keyof UpscaleSettings,
    value: number[]
  ) => {
    setUpscaleSettings({ [key]: value[0] } as Partial<UpscaleSettings>);
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{model.name}</p>
          <p className="text-xs text-muted-foreground">{model.description}</p>
        </div>
        <Badge variant="secondary" className="text-xs">
          {model.estimatedCost}
        </Badge>
      </div>

      <section className="space-y-2" data-testid="upscale-setting-scale">
        <Label className="text-xs">Scale Factor</Label>
        <div className="flex flex-wrap gap-2">
          {scaleOptions.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={
                option === upscaleSettings.scaleFactor ? "default" : "outline"
              }
              onClick={() => setUpscaleSettings({ scaleFactor: option })}
              className="px-3 py-1 text-xs"
            >
              {option}x
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-2" data-testid="upscale-setting-denoise">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Denoise</Label>
          <span className="text-xs text-muted-foreground">
            {upscaleSettings.denoise}%
          </span>
        </div>
        <Slider
          max={100}
          min={0}
          step={1}
          value={[upscaleSettings.denoise]}
          onValueChange={(value) => handleSliderChange("denoise", value)}
        />
      </section>

      {model.features.creativity && (
        <section className="space-y-2" data-testid="upscale-setting-creativity">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Creativity</Label>
            <span className="text-xs text-muted-foreground">
              {upscaleSettings.creativity}%
            </span>
          </div>
          <Slider
            max={100}
            min={0}
            step={1}
            value={[upscaleSettings.creativity]}
            onValueChange={(value) => handleSliderChange("creativity", value)}
          />
        </section>
      )}

      {model.features.overlappingTiles && (
        <section
          className="flex items-center justify-between rounded-lg border px-3 py-2"
          data-testid="upscale-setting-tiles"
        >
          <div>
            <Label className="text-xs">Overlapping Tiles</Label>
            <p className="text-[10px] text-muted-foreground">
              Prevents seams on high-res outputs
            </p>
          </div>
          <Switch
            checked={upscaleSettings.overlappingTiles}
            onCheckedChange={(checked) =>
              setUpscaleSettings({ overlappingTiles: checked })
            }
          />
        </section>
      )}
    </div>
  );
}
