/**
 * AI Model Options and Type Definitions
 *
 * Extracted from ai.tsx to centralize model-specific option arrays and type aliases.
 * These are used for UI dropdowns and validation across the AI panel.
 *
 * @see ai-tsx-refactoring.md for refactoring plan
 */

import { LTXV2_FAST_CONFIG, REVE_TEXT_TO_IMAGE_MODEL } from "./ai-constants";

// ============================================
// Type Definitions
// ============================================

export type ReveAspectRatioOption =
  (typeof REVE_TEXT_TO_IMAGE_MODEL.aspectRatios)[number]["value"];
export type ReveOutputFormatOption =
  (typeof REVE_TEXT_TO_IMAGE_MODEL.outputFormats)[number];

export type LTXV2FastDuration = (typeof LTXV2_FAST_CONFIG.DURATIONS)[number];
export type LTXV2FastResolution =
  (typeof LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD)[number];
export type LTXV2FastFps = (typeof LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD)[number];

export type SeedanceDuration = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type SeedanceResolution = "480p" | "720p" | "1080p";
export type SeedanceAspectRatio =
  | "21:9"
  | "16:9"
  | "4:3"
  | "1:1"
  | "3:4"
  | "9:16"
  | "auto";

export type KlingAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
export type Kling26AspectRatio = "16:9" | "9:16" | "1:1";

export type Wan25Resolution = "480p" | "720p" | "1080p";
export type Wan25Duration = 5 | 10;

// ============================================
// Option Arrays
// ============================================

export const SEEDANCE_DURATION_OPTIONS: SeedanceDuration[] = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
];

export const SEEDANCE_RESOLUTIONS: SeedanceResolution[] = ["480p", "720p", "1080p"];

export const SEEDANCE_ASPECT_RATIOS: SeedanceAspectRatio[] = [
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
  "auto",
];

export const KLING_ASPECT_RATIOS: KlingAspectRatio[] = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
];

export const KLING26_ASPECT_RATIOS: Kling26AspectRatio[] = ["16:9", "9:16", "1:1"];

export const WAN25_DURATIONS: Wan25Duration[] = [5, 10];

export const WAN25_RESOLUTIONS: Wan25Resolution[] = ["480p", "720p", "1080p"];

// ============================================
// Label Mappings
// ============================================

export const LTXV2_FAST_RESOLUTION_LABELS: Record<LTXV2FastResolution, string> = {
  "1080p": "1080p (Full HD)",
  "1440p": "1440p (QHD)",
  "2160p": "2160p (4K)",
};

export const LTXV2_FAST_RESOLUTION_PRICE_SUFFIX: Partial<
  Record<LTXV2FastResolution, string>
> = {
  "1080p": " ($0.04/sec)",
  "1440p": " ($0.08/sec)",
  "2160p": " ($0.16/sec)",
};

export const LTXV2_FAST_FPS_LABELS: Record<LTXV2FastFps, string> = {
  25: "25 FPS (Standard)",
  50: "50 FPS (High)",
};

export const REVE_NUM_IMAGE_OPTIONS = Array.from(
  {
    length:
      REVE_TEXT_TO_IMAGE_MODEL.numImagesRange.max -
      REVE_TEXT_TO_IMAGE_MODEL.numImagesRange.min +
      1,
  },
  (_, index) => REVE_TEXT_TO_IMAGE_MODEL.numImagesRange.min + index
);
