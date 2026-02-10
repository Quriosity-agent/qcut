/**
 * Model Handler Implementations
 *
 * All handle* functions for AI video generation models.
 * Extracted from model-handlers.ts to keep the public surface thin.
 */

import { falAIClient } from "@/lib/fal-ai-client";
import { debugLogger } from "@/lib/debug-logger";
import {
  generateVideo,
  generateVideoFromImage,
  generateVideoFromText,
  generateAvatarVideo,
  generateLTXV2Video,
  generateLTXV2ImageVideo,
  generateViduQ2Video,
  generateViduQ3TextVideo,
  generateViduQ3ImageVideo,
  generateSeedanceVideo,
  generateKlingImageVideo,
  generateKling26ImageVideo,
  generateWAN25ImageVideo,
  generateWAN26ImageVideo,
  generateWAN26TextVideo,
  generateWAN26RefVideo,
  generateKlingO1Video,
  upscaleByteDanceVideo,
  upscaleFlashVSRVideo,
} from "@/lib/ai-video";
import type {
  ModelHandlerContext,
  ModelHandlerResult,
  TextToVideoSettings,
  ImageToVideoSettings,
  UpscaleSettings,
  AvatarSettings,
} from "./model-handlers";

// ============================================================================
// TYPE COERCION HELPERS
// These ensure runtime values are cast to the strict literal types expected by generators
// ============================================================================

type LTXV2Duration = 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20;
type LTXV2Resolution = "1080p" | "1440p" | "2160p";
type LTXV2FPS = 25 | 50;
type HailuoDuration = 6 | 10;
type ViduQ2Duration = 2 | 3 | 4 | 5 | 6 | 7 | 8;
type ViduQ2Resolution = "720p" | "1080p";
type ViduQ2MovementAmplitude = "auto" | "small" | "medium" | "large";
type ViduQ3Duration = 5;
type ViduQ3Resolution = "360p" | "540p" | "720p" | "1080p";
type ViduQ3AspectRatio = "16:9" | "9:16" | "4:3" | "3:4" | "1:1";
type SeedanceDuration = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
type SeedanceResolution = "480p" | "720p" | "1080p";
type SeedanceAspectRatio =
  | "16:9"
  | "9:16"
  | "1:1"
  | "4:3"
  | "3:4"
  | "21:9"
  | "auto";
type KlingDuration = 5 | 10;
type KlingAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
type WAN25Duration = 5 | 10;
type WAN25Resolution = "480p" | "720p" | "1080p";
type WAN26Duration = 5 | 10 | 15;
type WAN26Resolution = "720p" | "1080p";
type WAN26T2VResolution = "720p" | "1080p";
type WAN26AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
type ByteDanceResolution = "1080p" | "2k" | "4k";
type ByteDanceFPS = "30fps" | "60fps";
type FlashVSRAcceleration = "regular" | "high" | "full";
type FlashVSROutputFormat = "X264" | "VP9" | "PRORES4444" | "GIF";
type FlashVSROutputQuality = "low" | "medium" | "high" | "maximum";
type FlashVSRWriteMode = "fast" | "balanced" | "small";

// ============================================================================
// TEXT-TO-VIDEO HANDLERS
// ============================================================================

/**
 * Handle Veo 3.1 Fast text-to-video generation
 */
export async function handleVeo31FastT2V(
  ctx: ModelHandlerContext,
  settings: TextToVideoSettings
): Promise<ModelHandlerResult> {
  const response = await falAIClient.generateVeo31FastTextToVideo({
    prompt: ctx.prompt,
    aspect_ratio: (() => {
      const ar = settings.veo31Settings.aspectRatio;
      return ar === "auto" ? undefined : ar;
    })(),
    duration: settings.veo31Settings.duration,
    resolution: settings.veo31Settings.resolution,
    generate_audio: settings.veo31Settings.generateAudio,
    enhance_prompt: settings.veo31Settings.enhancePrompt,
    auto_fix: settings.veo31Settings.autoFix,
  });
  return { response };
}

/**
 * Handle Veo 3.1 Standard text-to-video generation
 */
export async function handleVeo31T2V(
  ctx: ModelHandlerContext,
  settings: TextToVideoSettings
): Promise<ModelHandlerResult> {
  const response = await falAIClient.generateVeo31TextToVideo({
    prompt: ctx.prompt,
    aspect_ratio: (() => {
      const ar = settings.veo31Settings.aspectRatio;
      return ar === "auto" ? undefined : ar;
    })(),
    duration: settings.veo31Settings.duration,
    resolution: settings.veo31Settings.resolution,
    generate_audio: settings.veo31Settings.generateAudio,
    enhance_prompt: settings.veo31Settings.enhancePrompt,
    auto_fix: settings.veo31Settings.autoFix,
  });
  return { response };
}

/**
 * Handle Hailuo 2.3 text-to-video generation
 */
export async function handleHailuo23T2V(
  ctx: ModelHandlerContext,
  settings: TextToVideoSettings
): Promise<ModelHandlerResult> {
  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateVideoFromText({
    model: ctx.modelId,
    prompt: ctx.prompt,
    duration: settings.hailuoT2VDuration as HailuoDuration,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle LTX Video 2.0 Pro text-to-video generation
 */
export async function handleLTXV2ProT2V(
  ctx: ModelHandlerContext,
  settings: TextToVideoSettings
): Promise<ModelHandlerResult> {
  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateLTXV2Video({
    model: ctx.modelId,
    prompt: ctx.prompt,
    duration: settings.ltxv2Duration as LTXV2Duration,
    resolution: settings.ltxv2Resolution as LTXV2Resolution,
    fps: settings.ltxv2FPS as LTXV2FPS,
    generate_audio: settings.ltxv2GenerateAudio,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video with audio generated using ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle LTX Video 2.0 Fast text-to-video generation
 */
export async function handleLTXV2FastT2V(
  ctx: ModelHandlerContext,
  settings: TextToVideoSettings
): Promise<ModelHandlerResult> {
  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateLTXV2Video({
    model: ctx.modelId,
    prompt: ctx.prompt,
    duration: settings.ltxv2FastDuration as LTXV2Duration,
    resolution: settings.ltxv2FastResolution as LTXV2Resolution,
    fps: settings.ltxv2FastFPS as LTXV2FPS,
    generate_audio: settings.ltxv2FastGenerateAudio,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video with audio generated using ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle Vidu Q3 text-to-video generation
 */
export async function handleViduQ3T2V(
  ctx: ModelHandlerContext,
  settings: TextToVideoSettings
): Promise<ModelHandlerResult> {
  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  // Normalize resolution to Vidu Q3 supported values (360p, 540p, 720p, 1080p)
  // "auto" is not supported by Vidu Q3
  const normalizedResolution: ViduQ3Resolution = [
    "360p",
    "540p",
    "720p",
    "1080p",
  ].includes(settings.resolution ?? "")
    ? (settings.resolution as ViduQ3Resolution)
    : "720p";

  // Normalize aspect ratio to Vidu Q3 supported values (16:9, 9:16, 4:3, 3:4, 1:1)
  // "21:9" is not supported by Vidu Q3
  const normalizedAspectRatio: ViduQ3AspectRatio = [
    "16:9",
    "9:16",
    "4:3",
    "3:4",
    "1:1",
  ].includes(settings.aspectRatio ?? "")
    ? (settings.aspectRatio as ViduQ3AspectRatio)
    : "16:9";

  try {
    const response = await generateViduQ3TextVideo(
      {
        model: ctx.modelId,
        prompt: ctx.prompt,
        duration: 5 as ViduQ3Duration,
        resolution: normalizedResolution,
        aspect_ratio: normalizedAspectRatio,
        audio: true,
      },
      ctx.progressCallback
    );

    ctx.progressCallback({
      status: "completed",
      progress: 100,
      message: `Video generated with ${ctx.modelName}`,
    });

    return { response };
  } catch (error) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: `${ctx.modelName} generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Handle WAN v2.6 text-to-video generation
 */
export async function handleWAN26T2V(
  ctx: ModelHandlerContext,
  settings: TextToVideoSettings
): Promise<ModelHandlerResult> {
  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateWAN26TextVideo({
    model: ctx.modelId,
    prompt: ctx.prompt,
    duration: settings.wan26T2VDuration as WAN26Duration,
    resolution: settings.wan26T2VResolution as WAN26T2VResolution,
    aspect_ratio: settings.wan26T2VAspectRatio as WAN26AspectRatio,
    negative_prompt: settings.wan26T2VNegativePrompt || undefined,
    enable_prompt_expansion: settings.wan26T2VEnablePromptExpansion,
    multi_shots: settings.wan26T2VMultiShots,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle generic text-to-video generation (fallback)
 */
export async function handleGenericT2V(
  ctx: ModelHandlerContext,
  settings: TextToVideoSettings
): Promise<ModelHandlerResult> {
  const response = await generateVideo(
    {
      prompt: ctx.prompt,
      model: ctx.modelId,
      ...settings.unifiedParams,
      ...(ctx.modelId.startsWith("sora2_") && {
        duration:
          (settings.unifiedParams.duration as number | undefined) ??
          settings.duration,
        aspect_ratio:
          (settings.unifiedParams.aspect_ratio as
            | "16:9"
            | "9:16"
            | "1:1"
            | "4:3"
            | "3:4"
            | "21:9"
            | undefined) ?? settings.aspectRatio,
        resolution:
          (settings.unifiedParams.resolution as
            | "720p"
            | "1080p"
            | "auto"
            | undefined) ?? settings.resolution,
      }),
    },
    ctx.progressCallback
  );
  return { response };
}

// ============================================================================
// IMAGE-TO-VIDEO HANDLERS
// ============================================================================

/**
 * Handle Veo 3.1 Fast image-to-video generation
 */
export async function handleVeo31FastI2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "image-to-video requires a selected image",
    };
  }

  const imageUrl = await settings.uploadImageToFal(settings.selectedImage);
  const imageAspectRatio =
    settings.veo31Settings.aspectRatio === "16:9" ||
    settings.veo31Settings.aspectRatio === "9:16"
      ? settings.veo31Settings.aspectRatio
      : "16:9";

  const response = await falAIClient.generateVeo31FastImageToVideo({
    prompt: ctx.prompt,
    image_url: imageUrl,
    aspect_ratio: imageAspectRatio,
    duration: "8s",
    resolution: settings.veo31Settings.resolution,
    generate_audio: settings.veo31Settings.generateAudio,
  });
  return { response };
}

/**
 * Handle Veo 3.1 Standard image-to-video generation
 */
export async function handleVeo31I2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "image-to-video requires a selected image",
    };
  }

  const imageUrl = await settings.uploadImageToFal(settings.selectedImage);
  const imageAspectRatio =
    settings.veo31Settings.aspectRatio === "16:9" ||
    settings.veo31Settings.aspectRatio === "9:16"
      ? settings.veo31Settings.aspectRatio
      : "16:9";

  const response = await falAIClient.generateVeo31ImageToVideo({
    prompt: ctx.prompt,
    image_url: imageUrl,
    aspect_ratio: imageAspectRatio,
    duration: "8s",
    resolution: settings.veo31Settings.resolution,
    generate_audio: settings.veo31Settings.generateAudio,
  });
  return { response };
}

/**
 * Handle Veo 3.1 Fast frame-to-video generation
 */
export async function handleVeo31FastF2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.firstFrame || !settings.lastFrame) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "frame-to-video requires selected first and last frames",
    };
  }

  const firstFrameUrl = await settings.uploadImageToFal(settings.firstFrame);
  const lastFrameUrl = await settings.uploadImageToFal(settings.lastFrame);
  const frameAspectRatio =
    settings.veo31Settings.aspectRatio === "16:9" ||
    settings.veo31Settings.aspectRatio === "9:16"
      ? settings.veo31Settings.aspectRatio
      : "16:9";

  const response = await falAIClient.generateVeo31FastFrameToVideo({
    prompt: ctx.prompt,
    first_frame_url: firstFrameUrl,
    last_frame_url: lastFrameUrl,
    aspect_ratio: frameAspectRatio,
    duration: "8s",
    resolution: settings.veo31Settings.resolution,
    generate_audio: settings.veo31Settings.generateAudio,
  });
  return { response };
}

/**
 * Handle Veo 3.1 Standard frame-to-video generation
 */
export async function handleVeo31F2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.firstFrame || !settings.lastFrame) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "frame-to-video requires selected first and last frames",
    };
  }

  const firstFrameUrl = await settings.uploadImageToFal(settings.firstFrame);
  const lastFrameUrl = await settings.uploadImageToFal(settings.lastFrame);
  const frameAspectRatio =
    settings.veo31Settings.aspectRatio === "16:9" ||
    settings.veo31Settings.aspectRatio === "9:16"
      ? settings.veo31Settings.aspectRatio
      : "16:9";

  const response = await falAIClient.generateVeo31FrameToVideo({
    prompt: ctx.prompt,
    first_frame_url: firstFrameUrl,
    last_frame_url: lastFrameUrl,
    aspect_ratio: frameAspectRatio,
    duration: "8s",
    resolution: settings.veo31Settings.resolution,
    generate_audio: settings.veo31Settings.generateAudio,
  });
  return { response };
}

/**
 * Handle Vidu Q2 Turbo image-to-video generation
 */
export async function handleViduQ2I2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Vidu Q2 requires a selected image",
    };
  }

  const imageUrl = await settings.uploadImageToFal(settings.selectedImage);

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateViduQ2Video({
    model: ctx.modelId,
    prompt: ctx.prompt,
    image_url: imageUrl,
    duration: settings.viduQ2Duration as ViduQ2Duration,
    resolution: settings.viduQ2Resolution as ViduQ2Resolution,
    movement_amplitude:
      settings.viduQ2MovementAmplitude as ViduQ2MovementAmplitude,
    bgm: settings.viduQ2EnableBGM,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle LTX V2 Standard image-to-video generation
 */
export async function handleLTXV2I2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "LTX V2 standard requires a selected image",
    };
  }

  const imageUrl = await settings.uploadImageToFal(settings.selectedImage);

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateLTXV2ImageVideo({
    model: ctx.modelId,
    prompt: ctx.prompt,
    image_url: imageUrl,
    duration: settings.ltxv2I2VDuration as LTXV2Duration,
    resolution: settings.ltxv2I2VResolution as LTXV2Resolution,
    fps: settings.ltxv2I2VFPS as LTXV2FPS,
    generate_audio: settings.ltxv2I2VGenerateAudio,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video with audio generated using ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle LTX V2 Fast image-to-video generation
 */
export async function handleLTXV2FastI2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "LTX V2 Fast requires a selected image",
    };
  }

  const imageUrl = await settings.uploadImageToFal(settings.selectedImage);

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateLTXV2ImageVideo({
    model: ctx.modelId,
    prompt: ctx.prompt,
    image_url: imageUrl,
    duration: settings.ltxv2ImageDuration as LTXV2Duration,
    resolution: settings.ltxv2ImageResolution as LTXV2Resolution,
    fps: settings.ltxv2ImageFPS as LTXV2FPS,
    generate_audio: settings.ltxv2ImageGenerateAudio,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video with audio generated using ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle Seedance Pro Fast image-to-video generation
 */
export async function handleSeedanceProFastI2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Seedance Pro Fast requires a selected image",
    };
  }

  const imageUrl = await settings.uploadImageToFal(settings.selectedImage);

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateSeedanceVideo({
    model: ctx.modelId,
    prompt: ctx.prompt,
    image_url: imageUrl,
    duration: settings.seedanceDuration as SeedanceDuration,
    resolution: settings.seedanceResolution as SeedanceResolution,
    aspect_ratio: settings.seedanceAspectRatio as SeedanceAspectRatio,
    camera_fixed: settings.seedanceCameraFixed,
    seed: settings.imageSeed ?? undefined,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle Seedance Pro image-to-video generation (with optional end frame)
 */
export async function handleSeedanceProI2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Seedance Pro requires a selected image",
    };
  }

  const imageUrl = await settings.uploadImageToFal(settings.selectedImage);
  const endFrameUrl = settings.seedanceEndFrameFile
    ? await settings.uploadImageToFal(settings.seedanceEndFrameFile)
    : settings.seedanceEndFrameUrl;

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateSeedanceVideo({
    model: ctx.modelId,
    prompt: ctx.prompt,
    image_url: imageUrl,
    duration: settings.seedanceDuration as SeedanceDuration,
    resolution: settings.seedanceResolution as SeedanceResolution,
    aspect_ratio: settings.seedanceAspectRatio as SeedanceAspectRatio,
    camera_fixed: settings.seedanceCameraFixed,
    end_image_url: endFrameUrl ?? undefined,
    seed: settings.imageSeed ?? undefined,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle Kling v2.5 Turbo image-to-video generation
 */
export async function handleKlingV25I2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Kling v2.5 requires a selected image",
    };
  }

  const imageUrl = await settings.uploadImageToFal(settings.selectedImage);

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateKlingImageVideo({
    model: ctx.modelId,
    prompt: ctx.prompt,
    image_url: imageUrl,
    duration: settings.klingDuration as KlingDuration,
    cfg_scale: settings.klingCfgScale,
    aspect_ratio: settings.klingAspectRatio as KlingAspectRatio,
    enhance_prompt: settings.klingEnhancePrompt,
    negative_prompt: settings.klingNegativePrompt,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle Kling v2.6 Pro image-to-video generation
 */
export async function handleKlingV26I2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Kling v2.6 requires a selected image",
    };
  }

  const imageUrl = await settings.uploadImageToFal(settings.selectedImage);

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateKling26ImageVideo({
    model: ctx.modelId,
    prompt: ctx.prompt,
    image_url: imageUrl,
    duration: settings.kling26Duration as KlingDuration,
    generate_audio: settings.kling26GenerateAudio,
    negative_prompt: settings.kling26NegativePrompt,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle WAN 2.5 Preview image-to-video generation
 */
export async function handleWAN25I2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "WAN 2.5 requires a selected image",
    };
  }

  const imageUrl = await settings.uploadImageToFal(settings.selectedImage);
  const audioUrl = settings.wan25AudioFile
    ? await settings.uploadAudioToFal(settings.wan25AudioFile)
    : settings.wan25AudioUrl;

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateWAN25ImageVideo({
    model: ctx.modelId,
    prompt: ctx.prompt,
    image_url: imageUrl,
    duration: settings.wan25Duration as WAN25Duration,
    resolution: settings.wan25Resolution as WAN25Resolution,
    audio_url: audioUrl ?? undefined,
    negative_prompt: settings.wan25NegativePrompt,
    enable_prompt_expansion: settings.wan25EnablePromptExpansion,
    seed: settings.imageSeed ?? undefined,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle WAN v2.6 image-to-video generation
 */
export async function handleWAN26I2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "WAN v2.6 requires a selected image",
    };
  }

  const imageUrl = await settings.uploadImageToFal(settings.selectedImage);
  const audioUrl = settings.wan26AudioFile
    ? await settings.uploadAudioToFal(settings.wan26AudioFile)
    : settings.wan26AudioUrl;

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  const response = await generateWAN26ImageVideo({
    model: ctx.modelId,
    prompt: ctx.prompt,
    image_url: imageUrl,
    duration: settings.wan26Duration as WAN26Duration,
    resolution: settings.wan26Resolution as WAN26Resolution,
    aspect_ratio: settings.wan26AspectRatio as WAN26AspectRatio,
    audio_url: audioUrl ?? undefined,
    negative_prompt: settings.wan26NegativePrompt,
    enable_prompt_expansion: settings.wan26EnablePromptExpansion,
    seed: settings.imageSeed ?? undefined,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${ctx.modelName}`,
  });

  return { response };
}

/**
 * Handle Vidu Q3 image-to-video generation
 */
export async function handleViduQ3I2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Vidu Q3 requires a selected image",
    };
  }

  const imageUrl = await settings.uploadImageToFal(settings.selectedImage);

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${ctx.modelName} request...`,
  });

  // Normalize resolution to Vidu Q3 supported values (360p, 540p, 720p, 1080p)
  // "auto" is not supported by Vidu Q3
  const normalizedResolution: ViduQ3Resolution = [
    "360p",
    "540p",
    "720p",
    "1080p",
  ].includes(settings.resolution ?? "")
    ? (settings.resolution as ViduQ3Resolution)
    : "720p";

  try {
    const response = await generateViduQ3ImageVideo({
      model: ctx.modelId,
      prompt: ctx.prompt,
      image_url: imageUrl,
      duration: 5 as ViduQ3Duration,
      resolution: normalizedResolution,
      audio: true,
      seed: settings.imageSeed ?? undefined,
    });

    ctx.progressCallback({
      status: "completed",
      progress: 100,
      message: `Video generated with ${ctx.modelName}`,
    });

    return { response };
  } catch (error) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: `${ctx.modelName} generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Handle generic image-to-video generation (fallback)
 */
export async function handleGenericI2V(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  if (!settings.selectedImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "image-to-video requires a selected image",
    };
  }

  const response = await generateVideoFromImage({
    image: settings.selectedImage,
    prompt: ctx.prompt,
    model: ctx.modelId,
    ...(ctx.modelId.startsWith("sora2_") && {
      duration: settings.duration,
      aspect_ratio: settings.aspectRatio,
      resolution: settings.resolution,
    }),
  });
  return { response };
}

// ============================================================================
// UPSCALE HANDLERS
// ============================================================================

/**
 * Handle ByteDance video upscaler
 */
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
export async function handleKlingO1Ref2Video(
  ctx: ModelHandlerContext,
  settings: AvatarSettings
): Promise<ModelHandlerResult> {
  const firstRefImage = settings.referenceImages?.find((img) => img !== null);
  if (!firstRefImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Reference-to-video requires at least one reference image",
    };
  }

  debugLogger.log("model-handlers", "AVATAR_GENERATE_START", {
    modelId: ctx.modelId,
    hasReferenceImage: true,
  });
  const response = await generateAvatarVideo({
    model: ctx.modelId,
    characterImage: firstRefImage,
    prompt: ctx.prompt || undefined,
  });
  debugLogger.log("model-handlers", "AVATAR_GENERATE_COMPLETE", {
    modelId: ctx.modelId,
    hasResponse: !!response,
  });

  return { response };
}

/**
 * Handle WAN v2.6 Reference-to-Video generation
 *
 * Uses a reference video to guide motion/style for the generated video.
 */
export async function handleWAN26Ref2Video(
  ctx: ModelHandlerContext,
  settings: AvatarSettings
): Promise<ModelHandlerResult> {
  if (!settings.sourceVideo) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "WAN v2.6 Ref2Video requires a reference video",
    };
  }

  // Upload the reference video via falAIClient (handles API key + Electron IPC internally)
  let referenceVideoUrl: string;
  try {
    referenceVideoUrl = await falAIClient.uploadVideoToFal(
      settings.sourceVideo
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to upload reference video";
    debugLogger.error(
      "model-handlers",
      "WAN26_REF_VIDEO_UPLOAD_FAILED",
      error instanceof Error ? error : new Error(String(error))
    );
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: errorMessage,
    };
  }

  debugLogger.log("model-handlers", "WAN26_REF_VIDEO_START", {
    modelId: ctx.modelId,
  });
  const response = await generateWAN26RefVideo({
    model: ctx.modelId,
    prompt: ctx.prompt,
    reference_video_url: referenceVideoUrl,
    duration: settings.wan26RefDuration ?? 5,
    resolution: settings.wan26RefResolution ?? "1080p",
    aspect_ratio: settings.wan26RefAspectRatio ?? "16:9",
    negative_prompt: settings.wan26RefNegativePrompt,
    enable_prompt_expansion: settings.wan26RefEnablePromptExpansion ?? true,
    seed: settings.wan26RefSeed,
    enable_safety_checker: settings.wan26RefEnableSafetyChecker,
  });
  debugLogger.log("model-handlers", "WAN26_REF_VIDEO_COMPLETE", {
    modelId: ctx.modelId,
    hasResponse: !!response,
  });

  return { response };
}

/**
 * Handle Kling O1 V2V (Video-to-Video) generation
 */
export async function handleKlingO1V2V(
  ctx: ModelHandlerContext,
  settings: AvatarSettings
): Promise<ModelHandlerResult> {
  if (!settings.sourceVideo) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "V2V model requires source video",
    };
  }

  debugLogger.log("model-handlers", "KLING_O1_V2V_START", {
    modelId: ctx.modelId,
    hasSourceVideo: true,
  });
  const response = await generateKlingO1Video({
    model: ctx.modelId,
    prompt: ctx.prompt,
    sourceVideo: settings.sourceVideo,
    duration: 5,
  });
  debugLogger.log("model-handlers", "KLING_O1_V2V_COMPLETE", {
    modelId: ctx.modelId,
    hasResponse: !!response,
  });

  return { response };
}

/**
 * Handle Kling Avatar v2 generation
 */
export async function handleKlingAvatarV2(
  ctx: ModelHandlerContext,
  settings: AvatarSettings
): Promise<ModelHandlerResult> {
  if (!settings.avatarImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Avatar model requires avatar image",
    };
  }

  if (!settings.audioFile) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Audio file is required for Kling Avatar v2",
    };
  }

  debugLogger.log("model-handlers", "KLING_AVATAR_V2_START", {
    modelId: ctx.modelId,
    hasAudioFile: !!settings.audioFile,
  });

  const [characterImageUrl, audioUrl] = await Promise.all([
    settings.uploadImageToFal(settings.avatarImage),
    settings.uploadAudioToFal(settings.audioFile),
  ]);

  debugLogger.log("model-handlers", "KLING_AVATAR_V2_FILES_UPLOADED", {
    modelId: ctx.modelId,
  });

  const response = await generateAvatarVideo({
    model: ctx.modelId,
    characterImage: settings.avatarImage,
    audioFile: settings.audioFile || undefined,
    prompt: settings.klingAvatarV2Prompt.trim() || undefined,
    audioDuration: settings.audioDuration ?? undefined,
    characterImageUrl,
    audioUrl,
  });

  debugLogger.log("model-handlers", "KLING_AVATAR_V2_COMPLETE", {
    modelId: ctx.modelId,
    hasResponse: !!response,
  });
  return { response };
}

/**
 * Handle generic avatar generation (fallback for other avatar models)
 */
export async function handleGenericAvatar(
  ctx: ModelHandlerContext,
  settings: AvatarSettings
): Promise<ModelHandlerResult> {
  if (!settings.avatarImage) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Avatar model requires avatar image",
    };
  }

  debugLogger.log("model-handlers", "GENERIC_AVATAR_START", {
    modelId: ctx.modelId,
  });

  const response = await generateAvatarVideo({
    model: ctx.modelId,
    characterImage: settings.avatarImage,
    audioFile: settings.audioFile || undefined,
    sourceVideo: settings.sourceVideo || undefined,
    prompt: ctx.prompt || undefined,
    audioDuration: settings.audioDuration ?? undefined,
  });

  debugLogger.log("model-handlers", "GENERIC_AVATAR_COMPLETE", {
    modelId: ctx.modelId,
    hasResponse: !!response,
  });
  return { response };
}

/**
 * Handle Sync Lipsync React-1 generation
 * Emotion-aware lip-sync with video and audio inputs
 */
export async function handleSyncLipsyncReact1(
  ctx: ModelHandlerContext,
  settings: AvatarSettings
): Promise<ModelHandlerResult> {
  if (!settings.sourceVideo) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Sync Lipsync React-1 requires a source video",
    };
  }

  if (!settings.audioFile) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Sync Lipsync React-1 requires an audio file",
    };
  }

  debugLogger.log("model-handlers", "SYNC_LIPSYNC_START", {
    modelId: ctx.modelId,
  });

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: "Uploading video and audio files...",
  });

  // Upload video and audio to FAL storage using falAIClient
  const [videoUrl, audioUrl] = await Promise.all([
    falAIClient.uploadVideoToFal(settings.sourceVideo),
    falAIClient.uploadAudioToFal(settings.audioFile),
  ]);

  debugLogger.log("model-handlers", "SYNC_LIPSYNC_FILES_UPLOADED", {
    modelId: ctx.modelId,
  });

  ctx.progressCallback({
    status: "processing",
    progress: 30,
    message: "Generating lip-synced video...",
  });

  const response = await generateAvatarVideo({
    model: ctx.modelId,
    videoUrl,
    audioUrl,
    videoDuration: settings.videoDuration ?? undefined,
    audioDuration: settings.audioDuration ?? undefined,
    emotion: settings.syncLipsyncEmotion,
    modelMode: settings.syncLipsyncModelMode,
    lipsyncMode: settings.syncLipsyncLipsyncMode,
    temperature: settings.syncLipsyncTemperature,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Lip-synced video generated with ${ctx.modelName}`,
  });

  debugLogger.log("model-handlers", "SYNC_LIPSYNC_COMPLETE", {
    modelId: ctx.modelId,
    hasResponse: !!response,
  });
  return { response };
}

/**
 * Handle Veo 3.1 Fast Extend-Video generation
 * Extends an existing video by 7 seconds
 */
export async function handleVeo31FastExtendVideo(
  ctx: ModelHandlerContext,
  settings: AvatarSettings
): Promise<ModelHandlerResult> {
  if (!settings.sourceVideo) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Veo 3.1 Fast Extend requires a source video",
    };
  }

  debugLogger.log("model-handlers", "VEO31_FAST_EXTEND_START", {
    modelId: ctx.modelId,
  });

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: "Uploading source video...",
  });

  const videoUrl = await falAIClient.uploadVideoToFal(settings.sourceVideo);

  debugLogger.log("model-handlers", "VEO31_FAST_EXTEND_VIDEO_UPLOADED", {
    modelId: ctx.modelId,
  });

  ctx.progressCallback({
    status: "processing",
    progress: 30,
    message: "Extending video with Veo 3.1 Fast...",
  });

  const response = await falAIClient.generateVeo31FastExtendVideo({
    prompt: ctx.prompt,
    video_url: videoUrl,
    aspect_ratio: settings.extendVideoAspectRatio ?? "auto",
    duration: "7s",
    resolution: "720p",
    generate_audio: settings.extendVideoGenerateAudio ?? true,
    auto_fix: false,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video extended with ${ctx.modelName}`,
  });

  debugLogger.log("model-handlers", "VEO31_FAST_EXTEND_COMPLETE", {
    modelId: ctx.modelId,
    hasResponse: !!response,
  });
  return { response };
}

/**
 * Handle Veo 3.1 Standard Extend-Video generation
 * Extends an existing video by 7 seconds with premium quality
 */
export async function handleVeo31ExtendVideo(
  ctx: ModelHandlerContext,
  settings: AvatarSettings
): Promise<ModelHandlerResult> {
  if (!settings.sourceVideo) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Veo 3.1 Extend requires a source video",
    };
  }

  debugLogger.log("model-handlers", "VEO31_EXTEND_START", {
    modelId: ctx.modelId,
  });

  ctx.progressCallback({
    status: "processing",
    progress: 10,
    message: "Uploading source video...",
  });

  const videoUrl = await falAIClient.uploadVideoToFal(settings.sourceVideo);

  debugLogger.log("model-handlers", "VEO31_EXTEND_VIDEO_UPLOADED", {
    modelId: ctx.modelId,
  });

  ctx.progressCallback({
    status: "processing",
    progress: 30,
    message: "Extending video with Veo 3.1...",
  });

  const response = await falAIClient.generateVeo31ExtendVideo({
    prompt: ctx.prompt,
    video_url: videoUrl,
    aspect_ratio: settings.extendVideoAspectRatio ?? "auto",
    duration: "7s",
    resolution: "720p",
    generate_audio: settings.extendVideoGenerateAudio ?? true,
    auto_fix: false,
  });

  ctx.progressCallback({
    status: "completed",
    progress: 100,
    message: `Video extended with ${ctx.modelName}`,
  });

  debugLogger.log("model-handlers", "VEO31_EXTEND_COMPLETE", {
    modelId: ctx.modelId,
    hasResponse: !!response,
  });
  return { response };
}
