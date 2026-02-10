/**
 * Model-specific Generation Handlers
 *
 * Public surface: types, constants, and router functions.
 * All handler implementations live in model-handler-implementations.ts.
 */

import type { ProgressCallback } from "@/lib/ai-video-client";
import type {
  SyncLipsyncEmotion,
  SyncLipsyncModelMode,
  SyncLipsyncSyncMode,
} from "../../types/ai-types";
import {
  // Text-to-Video handlers
  handleVeo31FastT2V,
  handleVeo31T2V,
  handleHailuo23T2V,
  handleLTXV2ProT2V,
  handleLTXV2FastT2V,
  handleViduQ3T2V,
  handleWAN26T2V,
  handleGenericT2V,
  // Image-to-Video handlers
  handleVeo31FastI2V,
  handleVeo31I2V,
  handleVeo31FastF2V,
  handleVeo31F2V,
  handleViduQ2I2V,
  handleLTXV2I2V,
  handleLTXV2FastI2V,
  handleSeedanceProFastI2V,
  handleSeedanceProI2V,
  handleKlingV25I2V,
  handleKlingV26I2V,
  handleWAN25I2V,
  handleWAN26I2V,
  handleViduQ3I2V,
  handleGenericI2V,
  // Upscale handlers
  handleByteDanceUpscale,
  handleFlashVSRUpscale,
  // Avatar handlers
  handleKlingO1Ref2Video,
  handleWAN26Ref2Video,
  handleKlingO1V2V,
  handleKlingAvatarV2,
  handleGenericAvatar,
  handleSyncLipsyncReact1,
  handleVeo31FastExtendVideo,
  handleVeo31ExtendVideo,
} from "./model-handler-implementations";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Common context passed to all model handlers
 */
export interface ModelHandlerContext {
  prompt: string;
  modelId: string;
  modelName: string;
  progressCallback: ProgressCallback;
}

/**
 * Text-to-Video specific settings
 */
export interface TextToVideoSettings {
  veo31Settings: {
    aspectRatio: "9:16" | "16:9" | "1:1" | "auto";
    duration: "4s" | "6s" | "8s";
    resolution: "720p" | "1080p";
    generateAudio: boolean;
    enhancePrompt: boolean;
    autoFix: boolean;
  };
  hailuoT2VDuration: number;
  ltxv2Duration: number;
  ltxv2Resolution: string;
  ltxv2FPS: number;
  ltxv2GenerateAudio: boolean;
  ltxv2FastDuration: number;
  ltxv2FastResolution: string;
  ltxv2FastFPS: number;
  ltxv2FastGenerateAudio: boolean;
  unifiedParams: Record<string, unknown>;
  duration?: number;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
  resolution?: "720p" | "1080p" | "auto";
  // WAN v2.6 T2V settings
  wan26T2VDuration: number;
  wan26T2VResolution: string;
  wan26T2VAspectRatio: string;
  wan26T2VNegativePrompt: string;
  wan26T2VEnablePromptExpansion: boolean;
  wan26T2VMultiShots: boolean;
}

/**
 * Image-to-Video specific settings
 */
export interface ImageToVideoSettings {
  selectedImage: File | null;
  firstFrame: File | null;
  lastFrame: File | null;
  veo31Settings: {
    aspectRatio: "9:16" | "16:9" | "1:1" | "auto";
    duration: "4s" | "6s" | "8s";
    resolution: "720p" | "1080p";
    generateAudio: boolean;
    enhancePrompt: boolean;
    autoFix: boolean;
  };
  viduQ2Duration: number;
  viduQ2Resolution: string;
  viduQ2MovementAmplitude: number | string;
  viduQ2EnableBGM: boolean;
  ltxv2I2VDuration: number;
  ltxv2I2VResolution: string;
  ltxv2I2VFPS: number;
  ltxv2I2VGenerateAudio: boolean;
  ltxv2ImageDuration: number;
  ltxv2ImageResolution: string;
  ltxv2ImageFPS: number;
  ltxv2ImageGenerateAudio: boolean;
  seedanceDuration: number;
  seedanceResolution: string;
  seedanceAspectRatio: string;
  seedanceCameraFixed: boolean;
  seedanceEndFrameUrl: string | null;
  seedanceEndFrameFile: File | null;
  klingDuration: number;
  klingCfgScale: number;
  klingAspectRatio: string;
  klingEnhancePrompt: boolean;
  klingNegativePrompt: string;
  kling26Duration: number;
  kling26GenerateAudio: boolean;
  kling26NegativePrompt: string;
  wan25Duration: number;
  wan25Resolution: string;
  wan25AudioUrl: string | null;
  wan25AudioFile: File | null;
  wan25NegativePrompt: string;
  wan25EnablePromptExpansion: boolean;
  // WAN v2.6 I2V settings
  wan26Duration: number;
  wan26Resolution: string;
  wan26AspectRatio: string;
  wan26AudioUrl: string | null;
  wan26AudioFile: File | null;
  wan26NegativePrompt: string;
  wan26EnablePromptExpansion: boolean;
  imageSeed: number | null;
  duration?: number;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
  resolution?: "720p" | "1080p" | "auto";
  uploadImageToFal: (file: File) => Promise<string>;
  uploadAudioToFal: (file: File) => Promise<string>;
}

/**
 * Avatar generation specific settings
 */
export interface AvatarSettings {
  avatarImage: File | null;
  audioFile: File | null;
  sourceVideo: File | null;
  referenceImages: (File | null)[];
  klingAvatarV2Prompt: string;
  audioDuration: number | null;
  uploadImageToFal: (file: File) => Promise<string>;
  uploadAudioToFal: (file: File) => Promise<string>;
  // Sync Lipsync React-1 specific settings
  syncLipsyncEmotion?: SyncLipsyncEmotion;
  syncLipsyncModelMode?: SyncLipsyncModelMode;
  syncLipsyncLipsyncMode?: SyncLipsyncSyncMode;
  syncLipsyncTemperature?: number;
  videoDuration?: number | null;
  // Veo 3.1 Extend-Video specific settings
  extendVideoAspectRatio?: "auto" | "16:9" | "9:16";
  extendVideoGenerateAudio?: boolean;
  // WAN v2.6 Ref2Video specific settings
  wan26RefDuration?: 5 | 10 | 15;
  wan26RefResolution?: "720p" | "1080p";
  wan26RefAspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  wan26RefNegativePrompt?: string;
  wan26RefEnablePromptExpansion?: boolean;
  wan26RefSeed?: number;
  wan26RefEnableSafetyChecker?: boolean;
}

/**
 * Upscale specific settings
 */
export interface UpscaleSettings {
  sourceVideoFile: File | null;
  sourceVideoUrl: string | null;
  bytedanceTargetResolution: string;
  bytedanceTargetFPS: number | string;
  flashvsrUpscaleFactor: number | null;
  flashvsrAcceleration: string;
  flashvsrQuality: number;
  flashvsrColorFix: boolean;
  flashvsrPreserveAudio: boolean;
  flashvsrOutputFormat: string;
  flashvsrOutputQuality: string;
  flashvsrOutputWriteMode: string;
  flashvsrSeed: number | null;
}

/**
 * Video generation response from AI services
 */
interface VideoResponse {
  video_url?: string;
  job_id?: string;
  status?: string;
  video_data?: unknown;
}

/**
 * Handler result type
 */
export interface ModelHandlerResult {
  response: VideoResponse | undefined;
  shouldSkip?: boolean;
  skipReason?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Frame-to-video model IDs */
export const VEO31_FRAME_MODELS = new Set([
  "veo31_fast_frame_to_video",
  "veo31_frame_to_video",
]);

// ============================================================================
// MODEL ROUTING
// ============================================================================

/**
 * Routes text-to-video generation to the appropriate handler
 */
export async function routeTextToVideoHandler(
  ctx: ModelHandlerContext,
  settings: TextToVideoSettings
): Promise<ModelHandlerResult> {
  switch (ctx.modelId) {
    case "veo31_fast_text_to_video":
      return handleVeo31FastT2V(ctx, settings);
    case "veo31_text_to_video":
      return handleVeo31T2V(ctx, settings);
    case "hailuo23_standard_t2v":
    case "hailuo23_pro_t2v":
      return handleHailuo23T2V(ctx, settings);
    case "ltxv2_pro_t2v":
      return handleLTXV2ProT2V(ctx, settings);
    case "ltxv2_fast_t2v":
      return handleLTXV2FastT2V(ctx, settings);
    case "wan_26_t2v":
      return handleWAN26T2V(ctx, settings);
    case "vidu_q3_t2v":
      return handleViduQ3T2V(ctx, settings);
    default:
      return handleGenericT2V(ctx, settings);
  }
}

/**
 * Routes image-to-video generation to the appropriate handler
 */
export async function routeImageToVideoHandler(
  ctx: ModelHandlerContext,
  settings: ImageToVideoSettings
): Promise<ModelHandlerResult> {
  switch (ctx.modelId) {
    case "veo31_fast_image_to_video":
      return handleVeo31FastI2V(ctx, settings);
    case "veo31_image_to_video":
      return handleVeo31I2V(ctx, settings);
    case "veo31_fast_frame_to_video":
      return handleVeo31FastF2V(ctx, settings);
    case "veo31_frame_to_video":
      return handleVeo31F2V(ctx, settings);
    case "vidu_q2_turbo_i2v":
      return handleViduQ2I2V(ctx, settings);
    case "vidu_q3_i2v":
      return handleViduQ3I2V(ctx, settings);
    case "ltxv2_i2v":
      return handleLTXV2I2V(ctx, settings);
    case "ltxv2_fast_i2v":
      return handleLTXV2FastI2V(ctx, settings);
    case "seedance_pro_fast_i2v":
      return handleSeedanceProFastI2V(ctx, settings);
    case "seedance_pro_i2v":
      return handleSeedanceProI2V(ctx, settings);
    case "kling_v2_5_turbo_i2v":
      return handleKlingV25I2V(ctx, settings);
    case "kling_v26_pro_i2v":
    case "kling_v3_pro_i2v":
    case "kling_v3_standard_i2v":
      return handleKlingV26I2V(ctx, settings);
    case "wan_25_preview_i2v":
      return handleWAN25I2V(ctx, settings);
    case "wan_26_i2v":
      return handleWAN26I2V(ctx, settings);
    default:
      if (
        VEO31_FRAME_MODELS.has(ctx.modelId) &&
        (!settings.firstFrame || !settings.lastFrame)
      ) {
        return {
          response: undefined,
          shouldSkip: true,
          skipReason: "frame-to-video requires selected first and last frames",
        };
      }
      return handleGenericI2V(ctx, settings);
  }
}

/**
 * Routes upscale generation to the appropriate handler
 */
export async function routeUpscaleHandler(
  ctx: ModelHandlerContext,
  settings: UpscaleSettings
): Promise<ModelHandlerResult> {
  switch (ctx.modelId) {
    case "bytedance_video_upscaler":
      return handleByteDanceUpscale(ctx, settings);
    case "flashvsr_video_upscaler":
      return handleFlashVSRUpscale(ctx, settings);
    case "topaz_video_upscale":
      throw new Error("Topaz Video Upscale not yet implemented");
    default:
      return {
        response: undefined,
        shouldSkip: true,
        skipReason: `Unknown upscale model: ${ctx.modelId}`,
      };
  }
}

/**
 * Routes avatar generation to the appropriate handler
 */
export async function routeAvatarHandler(
  ctx: ModelHandlerContext,
  settings: AvatarSettings
): Promise<ModelHandlerResult> {
  switch (ctx.modelId) {
    case "kling_o1_ref2video":
      return handleKlingO1Ref2Video(ctx, settings);
    case "wan_26_ref2v":
      return handleWAN26Ref2Video(ctx, settings);
    case "kling_o1_v2v_reference":
    case "kling_o1_v2v_edit":
      return handleKlingO1V2V(ctx, settings);
    case "kling_avatar_v2_standard":
    case "kling_avatar_v2_pro":
      return handleKlingAvatarV2(ctx, settings);
    case "sync_lipsync_react1":
      return handleSyncLipsyncReact1(ctx, settings);
    case "veo31_fast_extend_video":
      return handleVeo31FastExtendVideo(ctx, settings);
    case "veo31_extend_video":
      return handleVeo31ExtendVideo(ctx, settings);
    default:
      return handleGenericAvatar(ctx, settings);
  }
}
