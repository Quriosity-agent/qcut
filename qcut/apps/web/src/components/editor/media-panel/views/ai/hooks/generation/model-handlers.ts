/**
 * Model-specific Generation Handlers
 *
 * Public surface: types, constants, and router functions.
 * Handler implementations live in handlers/*-handlers.ts.
 * Shared types live in model-handler-types.ts.
 */

import {
	handleVeo31FastT2V,
	handleVeo31T2V,
	handleHailuo23T2V,
	handleLTXV2ProT2V,
	handleLTXV2FastT2V,
	handleViduQ3T2V,
	handleWAN26T2V,
	handleGenericT2V,
} from "./handlers/text-to-video-handlers";
import {
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
} from "./handlers/image-to-video-handlers";
import {
	handleByteDanceUpscale,
	handleFlashVSRUpscale,
} from "./handlers/upscale-handlers";
import {
	handleKlingO1Ref2Video,
	handleWAN26Ref2Video,
	handleKlingO1V2V,
	handleKlingAvatarV2,
	handleGenericAvatar,
	handleSyncLipsyncReact1,
	handleVeo31FastExtendVideo,
	handleVeo31ExtendVideo,
} from "./handlers/avatar-handlers";
export type {
	AvatarSettings,
	ImageToVideoSettings,
	ModelHandlerContext,
	ModelHandlerResult,
	TextToVideoSettings,
	UpscaleSettings,
} from "./model-handler-types";
import type {
	AvatarSettings,
	ImageToVideoSettings,
	ModelHandlerContext,
	ModelHandlerResult,
	TextToVideoSettings,
	UpscaleSettings,
} from "./model-handler-types";

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
