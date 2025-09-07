import type { EffectParameters } from "@/types/effects";
import { generateUUID } from "@/lib/utils";

/**
 * Converts effect parameters to CSS filter string
 * This is used for real-time preview of effects in the video editor
 */
export function parametersToCSSFilters(parameters: EffectParameters): string {
  const filters: string[] = [];

  // Brightness
  if (parameters.brightness !== undefined) {
    const brightness = 1 + parameters.brightness / 100;
    filters.push(`brightness(${brightness})`);
  }

  // Contrast
  if (parameters.contrast !== undefined) {
    const contrast = 1 + parameters.contrast / 100;
    filters.push(`contrast(${contrast})`);
  }

  // Saturation
  if (parameters.saturation !== undefined) {
    const saturation = 1 + parameters.saturation / 100;
    filters.push(`saturate(${saturation})`);
  }

  // Hue rotation
  if (parameters.hue !== undefined) {
    filters.push(`hue-rotate(${parameters.hue}deg)`);
  }

  // Blur
  if (parameters.blur !== undefined) {
    filters.push(`blur(${parameters.blur}px)`);
  }

  // Sepia
  if (parameters.sepia !== undefined) {
    const sepia = parameters.sepia / 100;
    filters.push(`sepia(${sepia})`);
  }

  // Grayscale
  if (parameters.grayscale !== undefined) {
    const grayscale = parameters.grayscale / 100;
    filters.push(`grayscale(${grayscale})`);
  }

  // Invert
  if (parameters.invert !== undefined) {
    const invert = parameters.invert / 100;
    filters.push(`invert(${invert})`);
  }

  // Combined effects that need custom implementation
  if (parameters.vintage !== undefined) {
    // Vintage effect combines multiple filters
    const vintageStrength = parameters.vintage / 100;
    filters.push(`sepia(${vintageStrength * 0.5})`);
    filters.push(`contrast(${1.2})`);
    filters.push(`brightness(${0.9})`);
  }

  if (parameters.dramatic !== undefined) {
    // Dramatic effect with high contrast and slight desaturation
    const dramaticStrength = parameters.dramatic / 100;
    filters.push(`contrast(${1 + dramaticStrength * 0.5})`);
    filters.push(`saturate(${1 - dramaticStrength * 0.2})`);
    filters.push(`brightness(${1 - dramaticStrength * 0.1})`);
  }

  if (parameters.warm !== undefined) {
    // Warm filter adjusts hue towards orange/red
    const warmStrength = parameters.warm / 100;
    filters.push(`hue-rotate(${warmStrength * -10}deg)`);
    filters.push(`saturate(${1 + warmStrength * 0.2})`);
  }

  if (parameters.cool !== undefined) {
    // Cool filter adjusts hue towards blue
    const coolStrength = parameters.cool / 100;
    filters.push(`hue-rotate(${coolStrength * 10}deg)`);
    filters.push(`saturate(${1 + coolStrength * 0.1})`);
    filters.push(`brightness(${1 + coolStrength * 0.05})`);
  }

  if (parameters.cinematic !== undefined) {
    // Cinematic look with adjusted contrast and slight teal/orange
    const cinematicStrength = parameters.cinematic / 100;
    filters.push(`contrast(${1 + cinematicStrength * 0.3})`);
    filters.push(`saturate(${1 - cinematicStrength * 0.1})`);
    filters.push(`hue-rotate(${cinematicStrength * 5}deg)`);
  }

  return filters.join(" ");
}

/**
 * Applies effects to a canvas context
 * Used during export/rendering process
 */
export function applyEffectsToCanvas(
  ctx: CanvasRenderingContext2D,
  parameters: EffectParameters
): void {
  const filterString = parametersToCSSFilters(parameters);
  if (filterString) {
    ctx.filter = filterString;
  }
}

/**
 * Resets canvas filters
 */
export function resetCanvasFilters(ctx: CanvasRenderingContext2D): void {
  ctx.filter = "none";
}

/**
 * Validates effect parameters
 */
export function validateEffectParameters(parameters: EffectParameters): boolean {
  // Check brightness range
  if (parameters.brightness !== undefined) {
    if (parameters.brightness < -100 || parameters.brightness > 100) {
      return false;
    }
  }

  // Check contrast range
  if (parameters.contrast !== undefined) {
    if (parameters.contrast < -100 || parameters.contrast > 100) {
      return false;
    }
  }

  // Check saturation range
  if (parameters.saturation !== undefined) {
    if (parameters.saturation < -100 || parameters.saturation > 200) {
      return false;
    }
  }

  // Check other percentage-based parameters
  const percentageParams = ["sepia", "grayscale", "invert", "vintage", "dramatic", "warm", "cool", "cinematic"];
  for (const param of percentageParams) {
    const value = parameters[param as keyof EffectParameters];
    if (value !== undefined && typeof value === "number") {
      if (value < 0 || value > 100) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Merges multiple effect parameters
 */
export function mergeEffectParameters(
  ...parameterSets: EffectParameters[]
): EffectParameters {
  const merged: EffectParameters = {};

  for (const params of parameterSets) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        // For additive effects, sum them up
        if (["brightness", "contrast", "saturation", "hue"].includes(key)) {
          (merged as any)[key] = 
            ((merged[key as keyof EffectParameters] as number) || 0) + (value as number);
        } else {
          // For other effects, take the last value
          (merged as any)[key] = value;
        }
      }
    }
  }

  return merged;
}

/**
 * Gets default parameters for an effect type
 */
export function getDefaultParameters(effectType: string): EffectParameters {
  const defaults: Record<string, EffectParameters> = {
    brightness: { brightness: 0 },
    contrast: { contrast: 0 },
    saturation: { saturation: 0 },
    hue: { hue: 0 },
    blur: { blur: 0 },
    sepia: { sepia: 50 },
    grayscale: { grayscale: 100 },
    invert: { invert: 100 },
    vintage: { vintage: 70 },
    dramatic: { dramatic: 60 },
    warm: { warm: 50 },
    cool: { cool: 50 },
    cinematic: { cinematic: 70 },
  };

  return defaults[effectType] || {};
}

/**
 * Creates a unique effect ID
 */
export function createEffectId(): string {
  return generateUUID();
}