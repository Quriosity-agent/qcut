import { useCallback } from "react";
import { useEffectsStore } from "@/stores/effects-store";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { PropertyGroup } from "@/components/editor/properties-panel/property-item";
import { Trash2, Copy } from "lucide-react";
import type { EffectInstance, EffectParameters } from "@/types/effects";

interface EffectsPropertiesProps {
  elementId: string;
}

export function EffectsProperties({ elementId }: EffectsPropertiesProps) {
  const {
    getElementEffects,
    updateEffectParameters,
    toggleEffect,
    removeEffect,
    duplicateEffect,
  } = useEffectsStore();

  const effects = getElementEffects(elementId);

  const handleParameterChange = useCallback(
    (effectId: string, parameter: keyof EffectParameters, value: number) => {
      updateEffectParameters(elementId, effectId, { [parameter]: value });
    },
    [elementId, updateEffectParameters]
  );

  const renderParameterControl = (
    effect: EffectInstance,
    parameter: keyof EffectParameters,
    label: string,
    min: number,
    max: number
  ) => {
    const value = effect.parameters[parameter] as number | undefined;
    if (value === undefined) return null;

    return (
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>{label}</span>
          <span className="text-muted-foreground">{value}</span>
        </div>
        <Slider
          value={[value]}
          onValueChange={([newValue]) =>
            handleParameterChange(effect.id, parameter, newValue)
          }
          min={min}
          max={max}
          step={1}
          className="w-full"
        />
      </div>
    );
  };

  if (effects.length === 0) {
    return (
      <div className="p-4 text-muted-foreground text-center">
        No effects applied to this element.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {effects.map((effect) => (
        <PropertyGroup key={effect.id} title={effect.name}>
          {/* Effect Controls */}
          <div className="flex items-center justify-between mb-4">
            <Switch
              checked={effect.enabled}
              onCheckedChange={() => toggleEffect(elementId, effect.id)}
              aria-label={`Toggle ${effect.name} effect`}
            />
            <div className="flex gap-2">
              <Button
                variant="text"
                size="icon"
                onClick={() => duplicateEffect(elementId, effect.id)}
              >
                <Copy className="w-4 h-4" />
              </Button>
              <Button
                variant="text"
                size="icon"
                onClick={() => removeEffect(elementId, effect.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Parameter Controls */}
          <div className="space-y-4">
            {renderParameterControl(effect, "brightness", "Brightness", -100, 100)}
            {renderParameterControl(effect, "contrast", "Contrast", -100, 100)}
            {renderParameterControl(effect, "saturation", "Saturation", -100, 200)}
            {renderParameterControl(effect, "hue", "Hue Rotation", 0, 360)}
            {renderParameterControl(effect, "blur", "Blur", 0, 20)}
            {renderParameterControl(effect, "sepia", "Sepia", 0, 100)}
            {renderParameterControl(effect, "grayscale", "Grayscale", 0, 100)}
            {renderParameterControl(effect, "invert", "Invert", 0, 100)}
            {renderParameterControl(effect, "vintage", "Vintage", 0, 100)}
            {renderParameterControl(effect, "dramatic", "Dramatic", 0, 100)}
            {renderParameterControl(effect, "warm", "Warm", 0, 100)}
            {renderParameterControl(effect, "cool", "Cool", 0, 100)}
            {renderParameterControl(effect, "cinematic", "Cinematic", 0, 100)}
            {renderParameterControl(effect, "vignette", "Vignette", 0, 100)}
            {renderParameterControl(effect, "grain", "Grain", 0, 100)}
            {renderParameterControl(effect, "sharpen", "Sharpen", 0, 100)}
            {renderParameterControl(effect, "emboss", "Emboss", 0, 100)}
            {renderParameterControl(effect, "edge", "Edge Detection", 0, 100)}
            {renderParameterControl(effect, "pixelate", "Pixelate", 0, 50)}
          </div>
        </PropertyGroup>
      ))}
    </div>
  );
}