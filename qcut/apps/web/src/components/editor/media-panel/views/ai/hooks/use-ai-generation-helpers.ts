/**
 * AI Generation Helpers
 *
 * Pure/helper functions extracted from use-ai-generation.ts.
 * These have no React hook dependencies and can be tested independently.
 */

import { debugLogger } from "@/lib/debug-logger";
import { debugLog, debugError } from "@/lib/debug-config";
import { falAIClient } from "@/lib/fal-ai-client";

import {
	integrateVideoToMediaStore,
	updateVideoWithLocalPaths,
	canIntegrateMedia,
	VEO31_FRAME_MODELS,
	type ModelHandlerResult,
	type MediaIntegrationOptions,
} from "./generation";
import {
	T2V_MODEL_CAPABILITIES,
	type T2VModelCapabilities,
	type T2VModelId,
} from "../constants/text2video-models-config";
import type { GeneratedVideo } from "../types/ai-types";

// ---------------------------------------------------------------------------
// Group 1: Pure Utility Functions
// ---------------------------------------------------------------------------

/**
 * Clamp/snap requested duration to model-supported values.
 * Returns undefined when the model doesn't support duration.
 */
export function getSafeDuration(
	requestedDuration: number,
	capabilities?: T2VModelCapabilities
): number | undefined {
	if (!capabilities?.supportsDuration) return;

	const allowedDurations = capabilities.supportedDurations;
	const fallbackDuration =
		capabilities.defaultDuration ??
		(allowedDurations && allowedDurations.length > 0
			? allowedDurations[0]
			: undefined);

	if (!allowedDurations || allowedDurations.length === 0) {
		return requestedDuration;
	}

	if (allowedDurations.includes(requestedDuration)) {
		return requestedDuration;
	}

	return fallbackDuration ?? allowedDurations[0];
}

/** Download a video URL into an in-memory Uint8Array. */
export async function downloadVideoToMemory(
	videoUrl: string
): Promise<Uint8Array> {
	debugLog("Starting video download from:", videoUrl);

	const response = await fetch(videoUrl);
	if (!response.ok) {
		throw new Error(
			`Failed to download video: ${response.status} ${response.statusText}`
		);
	}

	const buffer = await response.arrayBuffer();
	const result = new Uint8Array(buffer);

	debugLog(`Download complete: ${result.length} bytes`);
	return result;
}

/** Upload an image file to FAL storage and return the URL. */
export async function uploadImageToFal(file: File): Promise<string> {
	debugLog("Uploading image to FAL:", file.name);
	try {
		const url = await falAIClient.uploadImageToFal(file);
		debugLog(`Upload complete: ${url}`);
		return url;
	} catch (error) {
		debugError("Failed to upload image to FAL", error);
		throw error instanceof Error ? error : new Error(String(error));
	}
}

/** Upload an audio file to FAL storage and return the URL. */
export async function uploadAudioToFal(file: File): Promise<string> {
	debugLog("Uploading audio to FAL:", file.name);
	try {
		const url = await falAIClient.uploadAudioToFal(file);
		debugLog("Audio upload complete:", url);
		return url;
	} catch (error) {
		debugError("Failed to upload audio to FAL", error);
		throw error instanceof Error ? error : new Error(String(error));
	}
}

// ---------------------------------------------------------------------------
// Group 2: Validation Logic
// ---------------------------------------------------------------------------

/** All the inputs that validation needs to inspect. */
export interface ValidationContext {
	prompt: string;
	selectedModels: string[];
	selectedImage: File | string | null;
	firstFrame: File | null | undefined;
	lastFrame: File | null | undefined;
	sourceVideo: File | null | undefined;
	audioFile: File | null | undefined;
	avatarImage: File | null | undefined;
	referenceImages: (File | null)[];
}

export function validateTextTab(
	prompt: string,
	selectedModels: string[]
): string | null {
	if (!prompt.trim()) return "Missing prompt for text tab";
	if (selectedModels.length === 0) return "No models selected for text tab";
	return null;
}

export function validateImageTab(
	selectedModels: string[],
	selectedImage: File | string | null,
	firstFrame: File | null | undefined,
	lastFrame: File | null | undefined
): string | null {
	if (selectedModels.length === 0) return "Missing models for image tab";

	const hasFrameModel = selectedModels.some((id) => VEO31_FRAME_MODELS.has(id));
	const hasImageModel = selectedModels.some(
		(id) => !VEO31_FRAME_MODELS.has(id)
	);

	if (hasFrameModel && (!firstFrame || !lastFrame)) {
		return "Frame-to-video models require first and last frames";
	}

	if (hasImageModel && !selectedImage) {
		return "Image-to-video models require an image";
	}

	return null;
}

/** Models that require source video (video-to-video). */
const V2V_MODELS = new Set([
	"wan_animate_replace",
	"kling_o1_v2v_reference",
	"kling_o1_v2v_edit",
	"wan_26_ref2v",
]);

/** Models that require avatar image + audio file. */
const AUDIO_AVATAR_MODELS = new Set([
	"kling_avatar_pro",
	"kling_avatar_standard",
	"bytedance_omnihuman_v1_5",
]);

export function validateAvatarTab(
	selectedModels: string[],
	sourceVideo: File | null | undefined,
	audioFile: File | null | undefined,
	avatarImage: File | null | undefined,
	referenceImages: (File | null)[]
): string | null {
	if (selectedModels.length === 0) return "Missing models for avatar tab";

	for (const modelId of selectedModels) {
		if (V2V_MODELS.has(modelId) && !sourceVideo) {
			return "Video-to-video model requires source video";
		}
		if (AUDIO_AVATAR_MODELS.has(modelId)) {
			if (!audioFile) return "Audio-based avatar model requires audio file";
			if (!avatarImage) return "Audio-based avatar model requires avatar image";
		}
		// Reference-to-video model
		if (modelId === "kling_o1_ref2video") {
			const hasReferenceImage = referenceImages?.some((img) => img !== null);
			if (!hasReferenceImage) {
				return "Kling O1 Reference-to-Video requires at least one reference image";
			}
		}
		// WAN Animate/Replace requires avatar image
		if (modelId === "wan_animate_replace" && !avatarImage) {
			return "WAN model requires character image";
		}
	}

	return null;
}

/**
 * Validate all generation inputs based on the active tab.
 * Returns an error string if invalid, or null if valid.
 */
export function validateGenerationInputs(
	activeTab: string,
	ctx: ValidationContext
): string | null {
	if (activeTab === "text") {
		return validateTextTab(ctx.prompt, ctx.selectedModels);
	}
	if (activeTab === "image") {
		return validateImageTab(
			ctx.selectedModels,
			ctx.selectedImage,
			ctx.firstFrame,
			ctx.lastFrame
		);
	}
	if (activeTab === "avatar") {
		return validateAvatarTab(
			ctx.selectedModels,
			ctx.sourceVideo,
			ctx.audioFile,
			ctx.avatarImage,
			ctx.referenceImages
		);
	}
	// Upscale and other tabs have no pre-generation validation here
	return null;
}

// ---------------------------------------------------------------------------
// Group 3: Settings Builders
// ---------------------------------------------------------------------------

export interface UnifiedParams {
	[key: string]: unknown;
}

/**
 * Build unified model params from T2V settings and model capabilities.
 * Handles aspect ratio, resolution, duration clamping, negative prompt, etc.
 */
export function buildUnifiedParams(opts: {
	modelId: string;
	modelCapabilities: T2VModelCapabilities | undefined;
	isSora2TextModel: boolean;
	t2vAspectRatio: string;
	t2vResolution: string;
	t2vDuration: number;
	t2vNegativePrompt: string;
	t2vPromptExpansion: boolean;
	t2vSeed: number;
	t2vSafetyChecker: boolean;
}): UnifiedParams {
	const {
		modelId,
		modelCapabilities,
		isSora2TextModel,
		t2vAspectRatio,
		t2vResolution,
		t2vDuration,
		t2vNegativePrompt,
		t2vPromptExpansion,
		t2vSeed,
		t2vSafetyChecker,
	} = opts;

	const params: UnifiedParams = {};

	if (
		modelCapabilities?.supportsAspectRatio &&
		t2vAspectRatio &&
		!isSora2TextModel
	) {
		params.aspect_ratio = t2vAspectRatio;
	}
	if (
		modelCapabilities?.supportsResolution &&
		t2vResolution &&
		!isSora2TextModel
	) {
		params.resolution = t2vResolution;
	}
	if (modelCapabilities?.supportsDuration && t2vDuration && !isSora2TextModel) {
		const safeDuration = getSafeDuration(t2vDuration, modelCapabilities);
		if (safeDuration !== undefined) {
			if (
				safeDuration !== t2vDuration &&
				modelCapabilities.supportedDurations?.length
			) {
				debugLogger.log("AIGeneration", "T2V_DURATION_SANITIZED", {
					modelId,
					requestedDuration: t2vDuration,
					appliedDuration: safeDuration,
					allowedDurations: modelCapabilities.supportedDurations,
				});
			}
			params.duration = safeDuration;
		}
	}

	const trimmedNegativePrompt = t2vNegativePrompt?.trim();
	if (modelCapabilities?.supportsNegativePrompt && trimmedNegativePrompt) {
		params.negative_prompt = trimmedNegativePrompt;
	}
	if (modelCapabilities?.supportsPromptExpansion && t2vPromptExpansion) {
		params.prompt_expansion = true;
	}
	if (
		modelCapabilities?.supportsSeed &&
		typeof t2vSeed === "number" &&
		t2vSeed !== -1
	) {
		params.seed = t2vSeed;
	}
	if (modelCapabilities?.supportsSafetyChecker) {
		params.enable_safety_checker = t2vSafetyChecker;
	}

	return params;
}

/**
 * Look up model capabilities for a model ID.
 * Returns undefined if the model is not in the T2V capabilities map.
 */
export function getModelCapabilities(
	modelId: string
): T2VModelCapabilities | undefined {
	return modelId in T2V_MODEL_CAPABILITIES
		? T2V_MODEL_CAPABILITIES[modelId as T2VModelId]
		: undefined;
}

// ---------------------------------------------------------------------------
// Group 4: Response Handlers
// ---------------------------------------------------------------------------

/** Callbacks that response handlers need to interact with the hook. */
export interface ResponseHandlerContext {
	prompt: string;
	modelId: string;
	activeTab: string;
	activeProject: { id: string; name?: string } | null;
	addMediaItem: MediaIntegrationOptions["addMediaItem"] | undefined;
	onError: (error: string) => void;
	setIsGenerating: (val: boolean) => void;
	setGenerationProgress: (val: number) => void;
	setStatusMessage: (val: string) => void;
	startStatusPolling: (jobId: string) => Promise<void>;
}

/**
 * Determine the source type label from the active tab.
 */
function getSourceType(
	activeTab: string
): MediaIntegrationOptions["sourceType"] {
	if (activeTab === "text") return "text2video";
	if (activeTab === "image" || activeTab === "angles") return "image2video";
	if (activeTab === "avatar") return "avatar";
	if (activeTab === "upscale") return "upscale";
	return;
}

/**
 * Handle a response that has both job_id and video_url (direct mode with job).
 * Returns the GeneratedVideo and whether media integration failed fatally.
 */
export async function handleDirectWithJobResponse(
	response: ModelHandlerResult["response"],
	ctx: ResponseHandlerContext
): Promise<{ video: GeneratedVideo; fatal: boolean }> {
	const videoUrl = response!.video_url!;
	const jobId = response!.job_id!;

	debugLogger.log("AIGeneration", "DIRECT_VIDEO_WITH_JOB_ID", {
		model: ctx.modelId,
		jobId,
		videoUrl,
	});

	const videoData = response!.video_data as
		| { video?: { duration?: number } }
		| undefined;
	const newVideo: GeneratedVideo = {
		jobId,
		videoUrl,
		videoPath: undefined,
		fileSize: undefined,
		duration: videoData?.video?.duration,
		prompt: ctx.prompt,
		model: ctx.modelId,
	};

	let fatal = false;

	const { canIntegrate, missing } = canIntegrateMedia(
		ctx.activeProject?.id,
		ctx.addMediaItem,
		videoUrl
	);

	if (ctx.activeProject && ctx.addMediaItem && videoUrl) {
		const integrationResult = await integrateVideoToMediaStore({
			videoUrl,
			modelId: ctx.modelId,
			prompt: newVideo.prompt,
			projectId: ctx.activeProject.id,
			addMediaItem: ctx.addMediaItem,
			duration: newVideo.duration || 5,
			sourceType: getSourceType(ctx.activeTab),
			onError: (error) => {
				ctx.setIsGenerating(false);
				ctx.setGenerationProgress(0);
				ctx.setStatusMessage(error);
				ctx.onError(error);
			},
		});

		if (integrationResult.success) {
			Object.assign(
				newVideo,
				updateVideoWithLocalPaths(newVideo, integrationResult, videoUrl)
			);
		} else if (integrationResult.error) {
			fatal = true;
		}
	} else if (!canIntegrate) {
		debugLogger.warn("AIGeneration", "MEDIA_STORE_MISSING_FIELDS", { missing });
	}

	return { video: newVideo, fatal };
}

/**
 * Handle a response that has job_id only (polling mode).
 * Returns the GeneratedVideo placeholder.
 */
export async function handleJobIdOnlyResponse(
	response: ModelHandlerResult["response"],
	ctx: ResponseHandlerContext
): Promise<GeneratedVideo> {
	const jobId = response!.job_id!;

	const newVideo: GeneratedVideo = {
		jobId,
		videoUrl: "",
		videoPath: undefined,
		fileSize: undefined,
		duration: undefined,
		prompt: ctx.prompt,
		model: ctx.modelId,
	};

	ctx.startStatusPolling(jobId);

	debugLogger.log("AIGeneration", "GENERATION_STARTED", {
		jobId,
		model: ctx.modelId,
	});

	return newVideo;
}

/**
 * Handle a response that has video_url only (direct mode, no job_id).
 * Returns the GeneratedVideo and whether media integration failed fatally.
 */
export async function handleDirectVideoResponse(
	response: ModelHandlerResult["response"],
	ctx: ResponseHandlerContext
): Promise<{ video: GeneratedVideo; fatal: boolean }> {
	const videoUrl = response!.video_url!;

	debugLogger.log("AIGeneration", "DIRECT_VIDEO_READY", {
		model: ctx.modelId,
		videoUrl,
	});

	const newVideo: GeneratedVideo = {
		jobId: `direct-${Date.now()}`,
		videoUrl,
		videoPath: undefined,
		fileSize: undefined,
		duration: undefined,
		prompt: ctx.prompt,
		model: ctx.modelId,
	};

	let fatal = false;

	const { canIntegrate, missing } = canIntegrateMedia(
		ctx.activeProject?.id,
		ctx.addMediaItem,
		videoUrl
	);

	if (ctx.activeProject && ctx.addMediaItem && videoUrl) {
		const integrationResult = await integrateVideoToMediaStore({
			videoUrl,
			modelId: ctx.modelId,
			prompt: newVideo.prompt,
			projectId: ctx.activeProject.id,
			addMediaItem: ctx.addMediaItem,
			duration: newVideo.duration || 5,
			sourceType: getSourceType(ctx.activeTab),
			onError: (error) => {
				ctx.setIsGenerating(false);
				ctx.setGenerationProgress(0);
				ctx.setStatusMessage(error);
				ctx.onError(error);
			},
		});

		if (integrationResult.success) {
			Object.assign(
				newVideo,
				updateVideoWithLocalPaths(newVideo, integrationResult, videoUrl)
			);
		} else if (integrationResult.error) {
			fatal = true;
		}
	} else if (!canIntegrate) {
		debugLogger.warn("AIGeneration", "MEDIA_STORE_MISSING_FIELDS", { missing });
	}

	return { video: newVideo, fatal };
}

/** Response classification result. */
export type ResponseClassification =
	| { type: "direct_with_job" }
	| { type: "job_only" }
	| { type: "direct_video" }
	| { type: "empty" };

/**
 * Classify an API response to determine the handling path.
 */
export function classifyResponse(
	response: ModelHandlerResult["response"] | undefined
): ResponseClassification {
	if (response?.job_id && response?.video_url) {
		return { type: "direct_with_job" };
	}
	if (response?.job_id) {
		return { type: "job_only" };
	}
	if (response?.video_url) {
		return { type: "direct_video" };
	}
	return { type: "empty" };
}

/**
 * Process a single model's API response: classify, handle, and return the generated video.
 * Returns null when the response should be skipped or a fatal error occurred.
 */
export async function processModelResponse(
	response: ModelHandlerResult["response"] | undefined,
	ctx: ResponseHandlerContext
): Promise<{ video: GeneratedVideo; fatal: boolean } | null> {
	const classification = classifyResponse(response);

	switch (classification.type) {
		case "direct_with_job":
			return handleDirectWithJobResponse(response, ctx);
		case "job_only": {
			const video = await handleJobIdOnlyResponse(response, ctx);
			return { video, fatal: false };
		}
		case "direct_video":
			return handleDirectVideoResponse(response, ctx);
		case "empty":
			debugLogger.warn("AIGeneration", "EMPTY_RESPONSE", { response });
			return null;
	}
}
