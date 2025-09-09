import { useCallback } from "react";
import { useEffectsStore } from "@/stores/effects-store";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { PropertyGroup } from "@/components/editor/properties-panel/property-item";
import { Trash2, Copy } from "lucide-react";
import type { EffectInstance, EffectParameters } from "@/types/effects";

// Configuration for effect parameter controls
const PARAMETER_CONFIG: Record<keyof EffectParameters, {
  label: string;
  min: number;
  max: number;
  step?: number;
}> = {
  // Basic color adjustments
  brightness: { label: "Brightness", min: -100, max: 100 },
  contrast: { label: "Contrast", min: -100, max: 100 },
  saturation: { label: "Saturation", min: -100, max: 200 },
  hue: { label: "Hue Rotation", min: 0, max: 360 },
  temperature: { label: "Temperature", min: -100, max: 100 },
  tint: { label: "Tint", min: -100, max: 100 },
  exposure: { label: "Exposure", min: -100, max: 100 },
  gamma: { label: "Gamma", min: 0, max: 200 },
  opacity: { label: "Opacity", min: 0, max: 100 },
  
  // Blur and sharpness
  blur: { label: "Blur", min: 0, max: 20 },
  radialBlur: { label: "Radial Blur", min: 0, max: 100 },
  motionBlur: { label: "Motion Blur", min: 0, max: 100 },
  sharpen: { label: "Sharpen", min: 0, max: 100 },
  unsharpMask: { label: "Unsharp Mask", min: 0, max: 100 },
  
  // Stylistic effects
  sepia: { label: "Sepia", min: 0, max: 100 },
  grayscale: { label: "Grayscale", min: 0, max: 100 },
  invert: { label: "Invert", min: 0, max: 100 },
  vintage: { label: "Vintage", min: 0, max: 100 },
  dramatic: { label: "Dramatic", min: 0, max: 100 },
  warm: { label: "Warm", min: 0, max: 100 },
  cool: { label: "Cool", min: 0, max: 100 },
  cinematic: { label: "Cinematic", min: 0, max: 100 },
  glitch: { label: "Glitch", min: 0, max: 100 },
  
  // Enhancement effects
  vignette: { label: "Vignette", min: 0, max: 100 },
  grain: { label: "Grain", min: 0, max: 100 },
  denoise: { label: "Denoise", min: 0, max: 100 },
  
  // Processing effects
  emboss: { label: "Emboss", min: 0, max: 100 },
  edge: { label: "Edge Detection", min: 0, max: 100 },
  pixelate: { label: "Pixelate", min: 0, max: 50 },
  
  // Distortion effects
  wave: { label: "Wave", min: 0, max: 100 },
  waveFrequency: { label: "Wave Frequency", min: 1, max: 20 },
  waveAmplitude: { label: "Wave Amplitude", min: 0, max: 50 },
  twist: { label: "Twist", min: 0, max: 100 },
  twistAngle: { label: "Twist Angle", min: -180, max: 180 },
  bulge: { label: "Bulge", min: -100, max: 100 },
  bulgeRadius: { label: "Bulge Radius", min: 50, max: 500 },
  fisheye: { label: "Fisheye", min: 0, max: 100 },
  fisheyeStrength: { label: "Fisheye Strength", min: 1, max: 5, step: 0.1 },
  
  // Artistic effects
  oilPainting: { label: "Oil Painting", min: 0, max: 100 },
  brushSize: { label: "Brush Size", min: 1, max: 10 },
  watercolor: { label: "Watercolor", min: 0, max: 100 },
  wetness: { label: "Wetness", min: 0, max: 100 },
  pencilSketch: { label: "Pencil Sketch", min: 0, max: 100 },
  strokeWidth: { label: "Stroke Width", min: 1, max: 5 },
  halftone: { label: "Halftone", min: 0, max: 100 },
  dotSize: { label: "Dot Size", min: 1, max: 10 },
  
  // Transition effects
  fadeIn: { label: "Fade In", min: 0, max: 100 },
  fadeOut: { label: "Fade Out", min: 0, max: 100 },
  dissolve: { label: "Dissolve", min: 0, max: 100 },
  dissolveProgress: { label: "Dissolve Progress", min: 0, max: 100 },
  wipe: { label: "Wipe", min: 0, max: 100 },
  wipeDirection: { label: "Wipe Direction", min: 0, max: 360 },
  wipeProgress: { label: "Wipe Progress", min: 0, max: 100 },
  
  // Composite effects
  overlay: { label: "Overlay", min: 0, max: 100 },
  overlayOpacity: { label: "Overlay Opacity", min: 0, max: 100 },
  multiply: { label: "Multiply", min: 0, max: 100 },
  screen: { label: "Screen", min: 0, max: 100 },
  colorDodge: { label: "Color Dodge", min: 0, max: 100 },
  blendMode: { label: "Blend Mode", min: 0, max: 100 },
};

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
    parameter: keyof EffectParameters
  ) => {
    const value = effect.parameters[parameter] as number | undefined;
    const config = PARAMETER_CONFIG[parameter];
    
    // Skip if parameter value is undefined or no config exists
    if (value === undefined || !config) return null;

    return (
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>{config.label}</span>
          <span className="text-muted-foreground">{value}</span>
        </div>
        <Slider
          value={[value]}
          onValueChange={([newValue]) =>
            handleParameterChange(effect.id, parameter, newValue)
          }
          min={config.min}
          max={config.max}
          step={config.step || 1}
          className="w-full"
          aria-label={config.label}
        />
      </div>
    );
  };
  
  const renderEffectParameters = (effect: EffectInstance) => {
    // Dynamically render only the parameters that exist in the effect
    const parameters = Object.keys(effect.parameters) as Array<keyof EffectParameters>;
    
    return (
      <div className="space-y-4">
        {parameters.map((param) => (
          <div key={param}>
            {renderParameterControl(effect, param)}
          </div>
        ))}
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
                type="button"
                variant="text"
                size="icon"
                aria-label="Duplicate effect"
                onClick={() => duplicateEffect(elementId, effect.id)}
              >
                <Copy className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                variant="text"
                size="icon"
                aria-label="Remove effect"
                onClick={() => removeEffect(elementId, effect.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Parameter Controls - Dynamically rendered based on effect parameters */}
          {renderEffectParameters(effect)}
        </PropertyGroup>
      ))}
    </div>
  );
}