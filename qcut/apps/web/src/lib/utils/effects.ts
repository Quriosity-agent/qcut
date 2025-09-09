import type { EffectParameters, EffectType } from "@/types/effects";

/**
 * Map from parameter key to EffectType for comprehensive type inference
 */
const PARAM_TO_TYPE: ReadonlyArray<[keyof EffectParameters, EffectType]> = [
  // Basic effects
  ['brightness', 'brightness'],
  ['contrast', 'contrast'],
  ['saturation', 'saturation'],
  ['hue', 'hue'],
  ['gamma', 'gamma'],
  ['blur', 'blur'],
  ['blurType', 'blur'],
  
  // Color effects
  ['sepia', 'sepia'],
  ['grayscale', 'grayscale'],
  ['invert', 'invert'],
  
  // Style effects
  ['vintage', 'vintage'],
  ['dramatic', 'dramatic'],
  ['warm', 'warm'],
  ['cool', 'cool'],
  ['cinematic', 'cinematic'],
  
  // Enhancement effects
  ['vignette', 'vignette'],
  ['grain', 'grain'],
  ['sharpen', 'sharpen'],
  ['emboss', 'emboss'],
  ['edge', 'edge'],
  ['pixelate', 'pixelate'],
  
  // Distortion effects
  ['wave', 'wave'],
  ['waveFrequency', 'wave'],
  ['waveAmplitude', 'wave'],
  ['twist', 'twist'],
  ['twistAngle', 'twist'],
  ['bulge', 'bulge'],
  ['bulgeRadius', 'bulge'],
  ['fisheye', 'fisheye'],
  ['fisheyeStrength', 'fisheye'],
  
  // Artistic effects
  ['oilPainting', 'oil-painting'],
  ['brushSize', 'oil-painting'],
  ['watercolor', 'watercolor'],
  ['wetness', 'watercolor'],
  ['pencilSketch', 'pencil-sketch'],
  ['strokeWidth', 'pencil-sketch'],
  ['halftone', 'halftone'],
  ['dotSize', 'halftone'],
  
  // Transition effects
  ['fadeIn', 'fade-in'],
  ['fadeOut', 'fade-out'],
  ['dissolve', 'dissolve'],
  ['dissolveProgress', 'dissolve'],
  ['wipe', 'wipe'],
  ['wipeDirection', 'wipe'],
  ['wipeProgress', 'wipe'],
  
  // Composite effects
  ['overlay', 'overlay'],
  ['overlayOpacity', 'overlay'],
  ['multiply', 'multiply'],
  ['screen', 'screen'],
  ['colorDodge', 'color-dodge'],
  ['blendMode', 'overlay'],
];

/**
 * Infer the effect type from the parameters object
 * Returns the first matching effect type based on parameter presence
 */
export function inferEffectType(params: EffectParameters): EffectType {
  for (const [paramKey, effectType] of PARAM_TO_TYPE) {
    if (params[paramKey] !== undefined) {
      return effectType;
    }
  }
  // Default fallback if no parameters match
  return 'brightness';
}

/**
 * Helper to strip " (Copy)" suffix from effect names
 */
const COPY_SUFFIX_RE = /\s+\(Copy\)$/;
export function stripCopySuffix(name: string): string {
  return name.replace(COPY_SUFFIX_RE, '');
}