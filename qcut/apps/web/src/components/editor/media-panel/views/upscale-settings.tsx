/**
 * Upscale Settings Panel Component
 *
 * Provides a comprehensive settings interface for AI image upscaling models.
 * Dynamically renders controls based on the selected upscale model's capabilities:
 * - Scale factor selection (2x-16x depending on model)
 * - Denoise slider (0-100%)
 * - Creativity slider (for models that support it)
 * - Overlapping tiles toggle (for premium models)
 * - Output format selector (PNG/JPEG/WebP)
 *
 * Each upscale model has different features and pricing tiers, and this panel
 * adapts to show only the relevant controls for the selected model.
 *
 * @module UpscaleSettingsPanel
 */

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  UPSCALE_MODELS,
  type UpscaleModelId,
  type UpscaleScaleFactor,
} from "@/lib/upscale-models";
import {
  type UpscaleSettings,
  useText2ImageStore,
} from "@/stores/text2image-store";

/**
 * Props for the UpscaleSettingsPanel component
 */
interface UpscaleSettingsProps {
  /** Optional CSS class names for styling */
  className?: string;
}

/**
 * Renders the upscale settings panel, a model-aware UI for configuring AI image upscaling options.
 *
 * The panel reflects the currently selected upscale model's capabilities and syncs user changes
 * with the central text-to-image store (scale factor, denoise, creativity, overlapping tiles, and output format).
 *
 * @param className - Optional additional CSS class names applied to the panel container
 * @returns The rendered settings panel element
 */
export function UpscaleSettingsPanel({ className }: UpscaleSettingsProps) {
  const upscaleSettings = useText2ImageStore((state) => state.upscaleSettings);
  const setUpscaleSettings = useText2ImageStore(
    (state) => state.setUpscaleSettings
  );

  const model = UPSCALE_MODELS[upscaleSettings.selectedModel as UpscaleModelId];
  const scaleOptions: UpscaleScaleFactor[] =
    model.controls.scaleFactor.options ?? model.supportedScales;

  /**
   * Handles slider value changes and updates the store
   *
   * Extracts the first value from the slider array and updates the corresponding
   * setting in the upscale settings store.
   *
   * @param key - The settings key to update (denoise or creativity)
   * @param value - Array containing the new slider value
   */
  const handleSliderChange = (key: keyof UpscaleSettings, value: number[]) => {
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
            value={[upscaleSettings.creativity ?? 0]}
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

      <section className="space-y-2" data-testid="upscale-setting-format">
        <Label className="text-xs">Output Format</Label>
        <Select
          value={upscaleSettings.outputFormat}
          onValueChange={(value) =>
            setUpscaleSettings({
              outputFormat: value as "png" | "jpeg" | "webp",
            })
          }
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="png">PNG (Lossless, larger file)</SelectItem>
            <SelectItem value="jpeg">
              JPEG (Compressed, smaller file)
            </SelectItem>
            <SelectItem value="webp">
              WebP (Modern format, best compression)
            </SelectItem>
          </SelectContent>
        </Select>
      </section>
    </div>
  );
}
