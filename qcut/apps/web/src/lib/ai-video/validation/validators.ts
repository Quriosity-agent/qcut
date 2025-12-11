/**
 * AI Video/Image Generation Validators
 *
 * Centralized validation for all AI generation parameters.
 * Each validator throws descriptive errors on failure.
 *
 * Includes validators for:
 * - Video generation (Hailuo, Vidu, LTX, Kling, WAN)
 * - Image generation (Reve, output format, aspect ratio)
 */

import {
  ERROR_MESSAGES,
  LTXV2_FAST_CONFIG,
} from "@/components/editor/media-panel/views/ai/constants/ai-constants";
import { debugLogger } from "@/lib/debug-logger";

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

// ============================================
// Image Generation Constants
// ============================================

const VALIDATOR_LOG_COMPONENT = "Validators";

/**
 * Valid output formats for FAL.ai image generation.
 */
export const VALID_OUTPUT_FORMATS = ["jpeg", "png", "webp"] as const;
export type OutputFormat = (typeof VALID_OUTPUT_FORMATS)[number];
export const DEFAULT_OUTPUT_FORMAT: OutputFormat = "jpeg";

/**
 * Default aspect ratio for image generation.
 */
export const DEFAULT_ASPECT_RATIO = "1:1";

/**
 * Mapping from image size presets to aspect ratios.
 */
export const IMAGE_SIZE_TO_ASPECT_RATIO: Record<string, string> = {
  square: "1:1",
  square_hd: "1:1",
  portrait_3_4: "3:4",
  portrait_9_16: "9:16",
  landscape_4_3: "4:3",
  landscape_16_9: "16:9",
};

/**
 * Pattern for validating aspect ratio strings (e.g., "16:9").
 */
const ASPECT_RATIO_PATTERN = /^\d+:\d+$/;

/**
 * Reve model constraints.
 */
export const MIN_REVE_IMAGES = 1;
export const MAX_REVE_IMAGES = 4;
export const MAX_REVE_PROMPT_LENGTH = 2560;

// ============================================
// Aspect Ratio Validators
// ============================================

/**
 * Normalizes an aspect ratio string by removing whitespace.
 * Returns undefined if the input is not a valid aspect ratio format.
 *
 * @param value - Aspect ratio string to normalize (e.g., "16:9", "16 : 9")
 * @returns Normalized aspect ratio string or undefined
 *
 * @example
 * normalizeAspectRatio("16:9")    // "16:9"
 * normalizeAspectRatio("16 : 9")  // "16:9"
 * normalizeAspectRatio("square")  // undefined
 */
export function normalizeAspectRatio(
  value?: string | null
): string | undefined {
  if (!value) {
    return;
  }

  const normalized = value.replace(/\s+/g, "");
  if (ASPECT_RATIO_PATTERN.test(normalized)) {
    return normalized;
  }

  return;
}

/**
 * Converts an image size preset or string to an aspect ratio.
 *
 * @param imageSize - Image size preset (e.g., "square_hd") or aspect ratio string
 * @returns Aspect ratio string (e.g., "1:1", "16:9")
 *
 * @example
 * imageSizeToAspectRatio("square_hd")      // "1:1"
 * imageSizeToAspectRatio("landscape_16_9") // "16:9"
 * imageSizeToAspectRatio("16:9")           // "16:9"
 * imageSizeToAspectRatio(1024)             // "1:1" (default)
 */
export function imageSizeToAspectRatio(
  imageSize: string | number | undefined
): string {
  if (typeof imageSize === "string") {
    // Check preset mapping first
    if (IMAGE_SIZE_TO_ASPECT_RATIO[imageSize]) {
      return IMAGE_SIZE_TO_ASPECT_RATIO[imageSize];
    }

    // Try to normalize as aspect ratio
    const ratio = normalizeAspectRatio(imageSize);
    if (ratio) {
      return ratio;
    }

    // Try converting underscore format (e.g., "16_9" -> "16:9")
    const converted = normalizeAspectRatio(imageSize.replace(/_/g, ":"));
    if (converted) {
      return converted;
    }
  }

  return DEFAULT_ASPECT_RATIO;
}

// ============================================
// Output Format Validators
// ============================================

/**
 * Normalizes an output format string with fallback.
 *
 * @param format - Format string to normalize
 * @param fallback - Fallback format if invalid (default: "jpeg")
 * @returns Normalized output format
 *
 * @example
 * normalizeOutputFormat("PNG")     // "png"
 * normalizeOutputFormat("invalid") // "jpeg" (fallback)
 * normalizeOutputFormat(null)      // "jpeg" (fallback)
 */
export function normalizeOutputFormat(
  format?: string | null,
  fallback: OutputFormat = DEFAULT_OUTPUT_FORMAT
): OutputFormat {
  if (!format) {
    return fallback;
  }

  const normalized = format.toString().toLowerCase() as OutputFormat;
  if (VALID_OUTPUT_FORMATS.includes(normalized)) {
    return normalized;
  }

  debugLogger.warn(VALIDATOR_LOG_COMPONENT, "OUTPUT_FORMAT_INVALID", {
    requestedFormat: format,
    fallback,
  });

  return fallback;
}

// ============================================
// Reve Model Validators
// ============================================

/**
 * Clamps number of images to valid Reve range (1-4).
 * Returns 1 for invalid inputs.
 *
 * @param value - Number of images requested
 * @returns Clamped number of images (1-4)
 */
export function clampReveNumImages(value?: number): number {
  if (value === undefined || value === null) {
    return MIN_REVE_IMAGES;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    debugLogger.warn(VALIDATOR_LOG_COMPONENT, "REVE_NUM_IMAGES_INVALID", {
      input: value,
      defaultValue: MIN_REVE_IMAGES,
    });
    return MIN_REVE_IMAGES;
  }

  const rounded = Math.floor(value);
  const clamped = Math.min(Math.max(rounded, MIN_REVE_IMAGES), MAX_REVE_IMAGES);

  if (rounded !== value || clamped !== rounded) {
    debugLogger.warn(VALIDATOR_LOG_COMPONENT, "REVE_NUM_IMAGES_ADJUSTED", {
      originalValue: value,
      roundedValue: rounded,
      clampedValue: clamped,
      min: MIN_REVE_IMAGES,
      max: MAX_REVE_IMAGES,
    });
  }

  return clamped;
}

/**
 * Truncates a prompt to the Reve maximum length (2560 chars).
 * Logs a warning if truncation occurs.
 *
 * @param prompt - Prompt text to truncate
 * @returns Truncated prompt (max 2560 chars)
 */
export function truncateRevePrompt(prompt: string): string {
  if (prompt.length > MAX_REVE_PROMPT_LENGTH) {
    debugLogger.warn(VALIDATOR_LOG_COMPONENT, "REVE_PROMPT_TRUNCATED", {
      originalLength: prompt.length,
      maxLength: MAX_REVE_PROMPT_LENGTH,
    });
  }

  return prompt.length > MAX_REVE_PROMPT_LENGTH
    ? prompt.slice(0, MAX_REVE_PROMPT_LENGTH)
    : prompt;
}

/**
 * Validates a Reve prompt (throws on invalid).
 *
 * @param prompt - Prompt to validate
 * @throws Error if prompt is empty or exceeds max length
 */
export function validateRevePrompt(prompt: string): void {
  if (typeof prompt !== "string") {
    throw new Error("Prompt must be provided as a string.");
  }

  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    throw new Error("Prompt cannot be empty.");
  }

  if (trimmedPrompt.length > MAX_REVE_PROMPT_LENGTH) {
    throw new Error(
      `Prompt must be ${MAX_REVE_PROMPT_LENGTH} characters or fewer.`
    );
  }
}

/**
 * Validates number of images for Reve (throws on invalid).
 *
 * @param value - Number of images to validate
 * @throws Error if value is not a valid integer between 1-4
 */
export function validateReveNumImages(value?: number): void {
  if (value === undefined || value === null) {
    return;
  }

  if (!Number.isFinite(value)) {
    throw new Error("Number of images must be a finite value.");
  }

  if (!Number.isInteger(value)) {
    throw new Error("Number of images must be a whole number.");
  }

  if (value < MIN_REVE_IMAGES || value > MAX_REVE_IMAGES) {
    throw new Error(
      `Reve supports between ${MIN_REVE_IMAGES} and ${MAX_REVE_IMAGES} images per request. You requested ${value}.`
    );
  }
}

// ============================================
// Sync Lipsync React-1 Validators
// ============================================

/** Max duration in seconds for Sync Lipsync React-1 inputs */
export const SYNC_LIPSYNC_REACT1_MAX_DURATION = 15;

/** Valid emotions for Sync Lipsync React-1 */
export const SYNC_LIPSYNC_REACT1_EMOTIONS = [
  "happy",
  "angry",
  "sad",
  "neutral",
  "disgusted",
  "surprised",
] as const;

/** Valid model modes for Sync Lipsync React-1 */
export const SYNC_LIPSYNC_REACT1_MODEL_MODES = ["lips", "face", "head"] as const;

/** Valid lipsync modes for Sync Lipsync React-1 */
export const SYNC_LIPSYNC_REACT1_SYNC_MODES = [
  "cut_off",
  "loop",
  "bounce",
  "silence",
  "remap",
] as const;

/**
 * Validates video duration for Sync Lipsync React-1
 *
 * @param duration - Video duration in seconds
 * @throws Error if duration exceeds 15 seconds
 */
export function validateSyncLipsyncReact1VideoDuration(
  duration: number | null | undefined
): void {
  if (
    duration !== null &&
    duration !== undefined &&
    duration > SYNC_LIPSYNC_REACT1_MAX_DURATION
  ) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_VIDEO_TOO_LONG);
  }
}

/**
 * Validates audio duration for Sync Lipsync React-1
 *
 * @param duration - Audio duration in seconds
 * @throws Error if duration exceeds 15 seconds
 */
export function validateSyncLipsyncReact1AudioDuration(
  duration: number | null | undefined
): void {
  if (
    duration !== null &&
    duration !== undefined &&
    duration > SYNC_LIPSYNC_REACT1_MAX_DURATION
  ) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_AUDIO_TOO_LONG);
  }
}

/**
 * Validates emotion parameter for Sync Lipsync React-1
 *
 * @param emotion - Emotion string to validate
 * @throws Error if emotion is missing or invalid
 */
export function validateSyncLipsyncReact1Emotion(
  emotion: string | null | undefined
): void {
  if (!emotion) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_MISSING_EMOTION);
  }
  if (
    !SYNC_LIPSYNC_REACT1_EMOTIONS.includes(
      emotion as (typeof SYNC_LIPSYNC_REACT1_EMOTIONS)[number]
    )
  ) {
    throw new Error(
      `Invalid emotion: ${emotion}. Must be one of: ${SYNC_LIPSYNC_REACT1_EMOTIONS.join(", ")}`
    );
  }
}

/**
 * Validates temperature parameter for Sync Lipsync React-1
 *
 * @param temperature - Temperature value (0-1)
 * @throws Error if temperature is outside valid range
 */
export function validateSyncLipsyncReact1Temperature(
  temperature: number | undefined
): void {
  if (temperature !== undefined && (temperature < 0 || temperature > 1)) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_INVALID_TEMPERATURE);
  }
}

/**
 * Validates all Sync Lipsync React-1 inputs
 *
 * @param params - Validation parameters
 * @throws Error if any validation fails
 */
export function validateSyncLipsyncReact1Inputs(params: {
  videoUrl?: string;
  audioUrl?: string;
  videoDuration?: number | null;
  audioDuration?: number | null;
  emotion?: string | null;
  temperature?: number;
}): void {
  if (!params.videoUrl) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_MISSING_VIDEO);
  }
  if (!params.audioUrl) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_MISSING_AUDIO);
  }

  validateSyncLipsyncReact1VideoDuration(params.videoDuration);
  validateSyncLipsyncReact1AudioDuration(params.audioDuration);
  validateSyncLipsyncReact1Emotion(params.emotion);
  validateSyncLipsyncReact1Temperature(params.temperature);
}
