/**
 * AI Video Generation Validators
 *
 * Centralized validation for all AI video parameters.
 * Each validator throws descriptive errors on failure.
 */

import {
  ERROR_MESSAGES,
  LTXV2_FAST_CONFIG,
} from "@/components/editor/media-panel/views/ai/constants/ai-constants";

// ============================================
// Duration/Resolution Constants
// ============================================

export const LTXV2_STANDARD_T2V_DURATIONS = [6, 8, 10] as const;
export const LTXV2_FAST_T2V_DURATIONS = LTXV2_FAST_CONFIG.DURATIONS;
export const LTXV2_STANDARD_I2V_DURATIONS = [6, 8, 10] as const;
export const LTXV2_STANDARD_I2V_RESOLUTIONS = [
  "1080p",
  "1440p",
  "2160p",
] as const;
export const LTXV2_FAST_I2V_DURATIONS = LTXV2_FAST_CONFIG.DURATIONS;
export const LTXV2_FAST_I2V_RESOLUTIONS =
  LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD;
export const LTXV2_FAST_EXTENDED_THRESHOLD =
  LTXV2_FAST_CONFIG.EXTENDED_DURATION_THRESHOLD;
export const LTXV2_FAST_EXTENDED_RESOLUTIONS =
  LTXV2_FAST_CONFIG.RESOLUTIONS.EXTENDED;
export const LTXV2_FAST_EXTENDED_FPS = LTXV2_FAST_CONFIG.FPS_OPTIONS.EXTENDED;
export const LTXV2_FAST_I2V_FPS = LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD;

// ============================================
// Hailuo 2.3 Validators
// ============================================

/**
 * Validates duration for Hailuo 2.3 models
 *
 * @param duration - Duration in seconds
 * @throws Error if duration is not 6 or 10 seconds
 */
export function validateHailuo23Duration(duration: number): void {
  if (duration !== 6 && duration !== 10) {
    throw new Error(
      "Duration must be either 6 or 10 seconds for Hailuo 2.3 models"
    );
  }
}

/**
 * Validates prompt length for Hailuo 2.3 models
 *
 * @param prompt - Text prompt to validate
 * @param modelId - Model identifier (standard vs pro)
 * @throws Error if prompt exceeds model's character limit
 */
export function validateHailuo23Prompt(prompt: string, modelId: string): void {
  const maxLengths: Record<string, number> = {
    hailuo23_standard_t2v: 1500,
    hailuo23_pro_t2v: 2000,
  };

  const maxLength = maxLengths[modelId];
  if (maxLength && prompt.length > maxLength) {
    throw new Error(
      `Prompt too long for ${modelId}. Maximum ${maxLength} characters allowed (current: ${prompt.length})`
    );
  }
}

/**
 * Checks if model is a Hailuo 2.3 text-to-video model
 *
 * @param modelId - Model identifier to check
 * @returns true if model is Hailuo 2.3 T2V
 */
export function isHailuo23TextToVideo(modelId: string): boolean {
  return modelId === "hailuo23_standard_t2v" || modelId === "hailuo23_pro_t2v";
}

// ============================================
// Vidu Q2 Validators
// ============================================

/**
 * Validates prompt length for Vidu Q2 models
 *
 * @param prompt - Text prompt to validate
 * @throws Error if prompt exceeds 3000 character limit
 */
export function validateViduQ2Prompt(prompt: string): void {
  if (prompt.length > 3000) {
    throw new Error(
      `Prompt too long for Vidu Q2. Maximum 3000 characters allowed (current: ${prompt.length})`
    );
  }
}

/**
 * Validates duration for Vidu Q2 video generation
 *
 * @param duration - Duration in seconds
 * @throws Error if duration is not between 2 and 8 seconds
 */
export function validateViduQ2Duration(duration: number): void {
  if (duration < 2 || duration > 8) {
    throw new Error(ERROR_MESSAGES.VIDU_Q2_INVALID_DURATION);
  }
}

// ============================================
// LTX Video 2.0 Validators
// ============================================

/**
 * Validates resolution for LTX Video 2.0 generation
 *
 * @param resolution - Video resolution (e.g., "1080p")
 * @throws Error if resolution is not 1080p, 1440p, or 2160p
 */
export function validateLTXV2Resolution(resolution: string): void {
  if (!["1080p", "1440p", "2160p"].includes(resolution)) {
    throw new Error(ERROR_MESSAGES.LTXV2_INVALID_RESOLUTION);
  }
}

/**
 * Checks if model is a fast LTX Video 2.0 text-to-video variant
 *
 * @param modelId - Model identifier to check
 * @returns true if model is LTX V2 fast text-to-video
 */
export function isFastLTXV2TextModel(modelId: string): boolean {
  return modelId === "ltxv2_fast_t2v";
}

/**
 * Validates duration for LTX Video 2.0 text-to-video generation
 *
 * @param duration - Duration in seconds
 * @param modelId - Model identifier (pro vs fast variants)
 * @throws Error if duration is invalid for the specified model
 */
export function validateLTXV2T2VDuration(
  duration: number,
  modelId: string
): void {
  const isFast = isFastLTXV2TextModel(modelId);

  if (isFast) {
    if (
      !LTXV2_FAST_T2V_DURATIONS.includes(
        duration as (typeof LTXV2_FAST_T2V_DURATIONS)[number]
      )
    ) {
      throw new Error(ERROR_MESSAGES.LTXV2_FAST_T2V_INVALID_DURATION);
    }
  } else {
    if (
      !LTXV2_STANDARD_T2V_DURATIONS.includes(
        duration as (typeof LTXV2_STANDARD_T2V_DURATIONS)[number]
      )
    ) {
      throw new Error(ERROR_MESSAGES.LTXV2_INVALID_DURATION);
    }
  }
}

/**
 * Checks if model is a standard LTX Video 2.0 image-to-video model
 *
 * @param modelId - Model identifier to check
 * @returns true if model is standard LTX V2 I2V (not Fast variant)
 */
export function isStandardLTXV2ImageModel(modelId: string): boolean {
  return modelId === "ltxv2_i2v";
}

/**
 * Validates duration for LTX Video 2.0 image-to-video generation
 *
 * @param duration - Duration in seconds
 * @param modelId - Model identifier (standard vs fast variant)
 * @throws Error if duration is invalid for the specified model
 */
export function validateLTXV2I2VDuration(
  duration: number,
  modelId: string
): void {
  const isStandard = isStandardLTXV2ImageModel(modelId);

  if (isStandard) {
    const allowedDurations = LTXV2_STANDARD_I2V_DURATIONS;
    if (
      !allowedDurations.includes(duration as (typeof allowedDurations)[number])
    ) {
      throw new Error(ERROR_MESSAGES.LTXV2_STD_I2V_INVALID_DURATION);
    }
  } else {
    const allowedDurations = LTXV2_FAST_I2V_DURATIONS;
    if (
      !allowedDurations.includes(duration as (typeof allowedDurations)[number])
    ) {
      throw new Error(ERROR_MESSAGES.LTXV2_I2V_INVALID_DURATION);
    }
  }
}

/**
 * Validates resolution for LTX Video 2.0 image-to-video generation
 *
 * @param resolution - Video resolution (e.g., "1080p")
 * @param modelId - Model identifier (standard vs fast variant)
 * @throws Error if resolution is invalid for the specified model
 */
export function validateLTXV2I2VResolution(
  resolution: string,
  modelId: string
): void {
  const allowedResolutions = isStandardLTXV2ImageModel(modelId)
    ? LTXV2_STANDARD_I2V_RESOLUTIONS
    : LTXV2_FAST_I2V_RESOLUTIONS;

  if (
    !allowedResolutions.includes(
      resolution as (typeof allowedResolutions)[number]
    )
  ) {
    throw new Error(
      isStandardLTXV2ImageModel(modelId)
        ? ERROR_MESSAGES.LTXV2_STD_I2V_INVALID_RESOLUTION
        : ERROR_MESSAGES.LTXV2_I2V_INVALID_RESOLUTION
    );
  }
}

/**
 * Validates extended duration constraints for LTX Video 2.0 Fast
 *
 * For videos > 10 seconds, only 1080p resolution and 25fps are allowed.
 *
 * @param duration - Duration in seconds
 * @param resolution - Video resolution
 * @param fps - Frames per second
 * @param errorMessage - Custom error message (optional)
 * @throws Error if constraints are violated for extended durations
 */
export function validateLTXV2FastExtendedConstraints(
  duration: number,
  resolution: string,
  fps: number,
  errorMessage: string = ERROR_MESSAGES.LTXV2_I2V_EXTENDED_DURATION_CONSTRAINT
): void {
  if (duration <= LTXV2_FAST_EXTENDED_THRESHOLD) {
    return;
  }

  const hasAllowedResolution = LTXV2_FAST_EXTENDED_RESOLUTIONS.includes(
    resolution as (typeof LTXV2_FAST_EXTENDED_RESOLUTIONS)[number]
  );

  const hasAllowedFps = LTXV2_FAST_EXTENDED_FPS.includes(
    fps as (typeof LTXV2_FAST_EXTENDED_FPS)[number]
  );

  if (!hasAllowedResolution || !hasAllowedFps) {
    throw new Error(errorMessage);
  }
}

// ============================================
// Kling Avatar v2 Validators
// ============================================

/**
 * Validates audio file against Kling Avatar v2 constraints.
 *
 * @param audioFile - Audio file to validate
 * @param audioDuration - Duration in seconds (from audio element or metadata)
 * @throws Error if audio file exceeds 5MB or duration is outside 2-60 seconds
 */
export function validateKlingAvatarV2Audio(
  audioFile: File,
  audioDuration?: number
): void {
  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
  const MIN_DURATION_SEC = 2;
  const MAX_DURATION_SEC = 60;

  if (audioFile.size > MAX_SIZE_BYTES) {
    throw new Error(ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LARGE);
  }

  if (audioDuration !== undefined) {
    if (audioDuration < MIN_DURATION_SEC) {
      throw new Error(ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_SHORT);
    }
    if (audioDuration > MAX_DURATION_SEC) {
      throw new Error(ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LONG);
    }
  }
}

// ============================================
// Generic Prompt Validators
// ============================================

/**
 * Validates prompt length for Kling models (2500 char max)
 *
 * @param prompt - Text prompt to validate
 * @throws Error if prompt exceeds 2500 characters
 */
export function validateKlingPrompt(prompt: string): void {
  if (prompt.length > 2500) {
    throw new Error("Prompt exceeds maximum length of 2,500 characters");
  }
}

/**
 * Validates prompt length for WAN 2.5 models (800 char max)
 *
 * @param prompt - Text prompt to validate
 * @throws Error if prompt exceeds 800 characters
 */
export function validateWAN25Prompt(prompt: string): void {
  if (prompt.length > 800) {
    throw new Error("Prompt exceeds maximum length of 800 characters");
  }
}

/**
 * Validates negative prompt length for WAN 2.5 models (500 char max)
 *
 * @param negativePrompt - Negative prompt to validate
 * @throws Error if negative prompt exceeds 500 characters
 */
export function validateWAN25NegativePrompt(negativePrompt: string): void {
  if (negativePrompt.length > 500) {
    throw new Error("Negative prompt exceeds maximum length of 500 characters");
  }
}
