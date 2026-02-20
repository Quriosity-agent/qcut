/**
 * Generation Utilities
 *
 * Barrel file for generation-related utilities extracted from use-ai-generation.ts.
 */

export {
	integrateVideoToMediaStore,
	updateVideoWithLocalPaths,
	canIntegrateMedia,
	type MediaIntegrationResult,
	type MediaIntegrationOptions,
} from "./media-integration";

export {
	// Router functions
	routeTextToVideoHandler,
	routeImageToVideoHandler,
	routeUpscaleHandler,
	routeAvatarHandler,
	// Constants
	VEO31_FRAME_MODELS,
	// Types
	type ModelHandlerContext,
	type ModelHandlerResult,
	type TextToVideoSettings,
	type ImageToVideoSettings,
	type AvatarSettings,
	type UpscaleSettings,
} from "./model-handlers";
