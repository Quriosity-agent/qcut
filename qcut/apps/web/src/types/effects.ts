// Video Effects Type Definitions
// Safe integration with existing timeline system

export type EffectType =
  // Basic effects
  | "blur"
  | "brightness"
  | "contrast"
  | "saturation"
  | "hue"
  | "gamma"
  | "sepia"
  | "grayscale"
  | "invert"
  // Style effects
  | "vintage"
  | "dramatic"
  | "warm"
  | "cool"
  | "cinematic"
  | "vignette"
  | "grain"
  | "sharpen"
  | "emboss"
  | "edge"
  | "pixelate"
  // Distortion effects
  | "wave"
  | "twist"
  | "bulge"
  | "fisheye"
  // Artistic effects
  | "oil-painting"
  | "watercolor"
  | "pencil-sketch"
  | "halftone"
  // Transition effects
  | "fade-in"
  | "fade-out"
  | "dissolve"
  | "wipe"
  // Composite effects
  | "overlay"
  | "multiply"
  | "screen"
  | "color-dodge";

export interface EffectPreset {
  id: string;
  name: string;
  description: string;
  category: EffectCategory;
  icon: string;
  parameters: EffectParameters;
  preview?: string;
}

export type EffectCategory =
  | "basic"
  | "color"
  | "artistic"
  | "vintage"
  | "cinematic"
  | "distortion"
  | "transition"
  | "composite";

export interface EffectParameters {
  // Transform parameters
  opacity?: number;
  scale?: number;
  rotate?: number;
  skewX?: number;
  skewY?: number;

  // Basic parameters
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  gamma?: number;

  // Blur parameters
  blur?: number;
  blurType?: "gaussian" | "box" | "motion";

  // Color effects
  sepia?: number;
  grayscale?: number;
  invert?: number;

  // Style effects
  vintage?: number;
  dramatic?: number;
  warm?: number;
  cool?: number;
  cinematic?: number;

  // Enhancement effects
  vignette?: number;
  grain?: number;
  sharpen?: number;
  emboss?: number;
  edge?: number;
  pixelate?: number;
  chromatic?: number;
  radiance?: number;

  // Distortion effects
  wave?: number;
  waveFrequency?: number;
  waveAmplitude?: number;
  twist?: number;
  twistAngle?: number;
  bulge?: number;
  bulgeRadius?: number;
  fisheye?: number;
  fisheyeStrength?: number;
  ripple?: number;
  swirl?: number;

  // Artistic effects
  oilPainting?: number;
  brushSize?: number;
  watercolor?: number;
  wetness?: number;
  pencilSketch?: number;
  strokeWidth?: number;
  halftone?: number;
  dotSize?: number;

  // Transition effects
  fadeIn?: number;
  fadeOut?: number;
  dissolve?: number;
  dissolveProgress?: number;
  wipe?: number;
  wipeDirection?: "left" | "right" | "up" | "down";
  wipeProgress?: number;

  // Composite effects
  overlay?: number;
  overlayOpacity?: number;
  multiply?: number;
  screen?: number;
  colorDodge?: number;
  blendMode?:
    | "normal"
    | "multiply"
    | "screen"
    | "overlay"
    | "darken"
    | "lighten"
    | "color-dodge"
    | "color-burn";
}

// Keyframe support for animations
export interface EffectKeyframe {
  time: number; // in seconds relative to element start
  value: number;
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "cubic-bezier";
  controlPoints?: [number, number, number, number]; // for cubic-bezier
}

export interface AnimatedParameter {
  parameter: keyof EffectParameters;
  keyframes: EffectKeyframe[];
  interpolation?: "linear" | "step" | "smooth";
}

export interface TimelineEffect {
  id: string;
  elementId: string;
  trackId: string;
  effectType: EffectType;
  parameters: EffectParameters;
  startTime: number;
  endTime: number;
  enabled: boolean;
  animations?: AnimatedParameter[]; // Optional animated parameters
}

export interface EffectInstance {
  id: string;
  name: string;
  effectType: EffectType;
  parameters: EffectParameters;
  duration: number;
  enabled: boolean;
  animations?: AnimatedParameter[]; // Optional animated parameters
}

// Type augmentation to add effects support to existing timeline elements
// This safely extends the existing types without modifying them
declare module "@/types/timeline" {
  interface BaseTimelineElement {
    effectIds?: string[];
  }
}
