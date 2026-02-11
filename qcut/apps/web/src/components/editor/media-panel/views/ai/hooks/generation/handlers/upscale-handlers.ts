/**
 * Split from model-handler-implementations.ts by handler category.
 */

import { falAIClient } from "@/lib/fal-ai-client";
import { upscaleByteDanceVideo, upscaleFlashVSRVideo } from "@/lib/ai-video";
import type {
  ModelHandlerContext,
  ModelHandlerResult,
  UpscaleSettings,
} from "../model-handler-types";

// These aliases map UI values to generator literal unions.
type ByteDanceResolution = "1080p" | "2k" | "4k";
type ByteDanceFPS = "30fps" | "60fps";
type FlashVSRAcceleration = "regular" | "high" | "full";
type FlashVSROutputFormat = "X264" | "VP9" | "PRORES4444" | "GIF";
type FlashVSROutputQuality = "low" | "medium" | "high" | "maximum";
type FlashVSRWriteMode = "fast" | "balanced" | "small";

export async function handleByteDanceUpscale(
  ctx: ModelHandlerContext,
  settings: UpscaleSettings
): Promise<ModelHandlerResult> {
  if (!settings.sourceVideoFile && !settings.sourceVideoUrl) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Video source required",
    };
  }

  const videoUrl = settings.sourceVideoFile
    ? await falAIClient.uploadVideoToFal(settings.sourceVideoFile)
    : settings.sourceVideoUrl;

  if (!videoUrl) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Video URL could not be determined",
    };
  }

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Uploading video for ${ctx.modelName}...`,
  });

  ctx.progressCallback({
    status: "processing",
    progress: 30,
    message: `Upscaling video to ${settings.bytedanceTargetResolution}...`,
  });

  const response = await upscaleByteDanceVideo({
    video_url: videoUrl,
    target_resolution:
      settings.bytedanceTargetResolution as ByteDanceResolution,
    target_fps: settings.bytedanceTargetFPS as ByteDanceFPS,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video upscaled with ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle FlashVSR video upscaler
 */

export async function handleFlashVSRUpscale(
  ctx: ModelHandlerContext,
  settings: UpscaleSettings
): Promise<ModelHandlerResult> {
  if (!settings.sourceVideoFile && !settings.sourceVideoUrl) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Video source required",
    };
  }

  const videoUrl = settings.sourceVideoFile
    ? await falAIClient.uploadVideoToFal(settings.sourceVideoFile)
    : settings.sourceVideoUrl;

  if (!videoUrl) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Video URL could not be determined",
    };
  }

  const upscaleFactor = settings.flashvsrUpscaleFactor ?? 4;

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Uploading video for ${ctx.modelName}...`,
  });

  ctx.progressCallback({
    status: "processing",
    progress: 30,
    message: `Upscaling video with FlashVSR (${upscaleFactor}x)...`,
  });

  const response = await upscaleFlashVSRVideo({
    video_url: videoUrl,
    upscale_factor: upscaleFactor,
    acceleration: settings.flashvsrAcceleration as FlashVSRAcceleration,
    quality: settings.flashvsrQuality,
    color_fix: settings.flashvsrColorFix,
    preserve_audio: settings.flashvsrPreserveAudio,
    output_format: settings.flashvsrOutputFormat as FlashVSROutputFormat,
    output_quality: settings.flashvsrOutputQuality as FlashVSROutputQuality,
    output_write_mode: settings.flashvsrOutputWriteMode as FlashVSRWriteMode,
    seed: settings.flashvsrSeed ?? undefined,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video upscaled with ${ctx.modelName}`,
  });

  return { response };
}

// ============================================================================
// AVATAR HANDLERS
// ============================================================================

/**
 * Handle Kling O1 Reference-to-Video generation
 */

