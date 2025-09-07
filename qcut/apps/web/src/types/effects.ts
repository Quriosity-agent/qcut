// Video Effects Type Definitions
// Safe integration with existing timeline system

export type EffectType =
  | "blur"
  | "brightness"
  | "contrast"
  | "saturation"
  | "hue"
  | "gamma"
  | "sepia"
  | "grayscale"
  | "invert"
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
  | "pixelate";

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
  | "distortion";

export interface EffectParameters {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  gamma?: number;

  blur?: number;
  blurType?: "gaussian" | "box" | "motion";

  sepia?: number;
  grayscale?: number;
  invert?: number;

  vintage?: number;
  dramatic?: number;
  warm?: number;
  cool?: number;
  cinematic?: number;

  vignette?: number;
  grain?: number;
  sharpen?: number;
  emboss?: number;
  edge?: number;
  pixelate?: number;
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
}

export interface EffectInstance {
  id: string;
  name: string;
  effectType: EffectType;
  parameters: EffectParameters;
  duration: number;
  enabled: boolean;
}

// Type augmentation to add effects support to existing timeline elements
// This safely extends the existing types without modifying them
declare module "@/types/timeline" {
  interface BaseTimelineElement {
    effectIds?: string[];
  }
}