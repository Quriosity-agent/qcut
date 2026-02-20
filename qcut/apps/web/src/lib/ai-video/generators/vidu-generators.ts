/**
 * Vidu Image-to-Video Generators
 */

import type {
	VideoGenerationResponse,
	ViduQ2I2VRequest,
	ViduQ3I2VRequest,
} from "@/components/editor/media-panel/views/ai/types/ai-types";
import {
	generateJobId,
	getFalApiKeyAsync,
	handleFalResponse,
	makeFalRequest,
} from "../core/fal-request";
import {
	validateViduQ2Duration,
	validateViduQ2Prompt,
	validateViduQ3Duration,
	validateViduQ3Prompt,
	validateViduQ3Resolution,
} from "../validation/validators";
import { getModelConfig, withErrorHandling } from "./base-generator";

/**
 * Generate video from image using Vidu Q2 Turbo.
 */
export async function generateViduQ2Video(
	request: ViduQ2I2VRequest
): Promise<VideoGenerationResponse> {
	return withErrorHandling(
		"Generate Vidu Q2 video",
		{ operation: "generateViduQ2Video", model: request.model },
		async () => {
			const falApiKey = await getFalApiKeyAsync();
			if (!falApiKey) {
				throw new Error(
					"FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
				);
			}

			const trimmedPrompt = request.prompt?.trim() ?? "";
			if (!trimmedPrompt) {
				throw new Error("Text prompt is required for Vidu Q2 video generation");
			}
			validateViduQ2Prompt(trimmedPrompt);

			if (!request.image_url) {
				throw new Error(
					"Image is required for Vidu Q2 image-to-video generation"
				);
			}

			const modelConfig = getModelConfig(request.model);
			if (!modelConfig) {
				throw new Error(`Unknown model: ${request.model}`);
			}

			const endpoint = modelConfig.endpoints.image_to_video;
			if (!endpoint) {
				throw new Error(
					`Model ${request.model} does not support image-to-video generation`
				);
			}

			const defaultDuration =
				typeof modelConfig.default_params?.duration === "number"
					? modelConfig.default_params.duration
					: 4;
			const duration = request.duration ?? defaultDuration;
			validateViduQ2Duration(duration);

			// Build payload
			const defaults = { ...(modelConfig.default_params || {}) };
			const { bgm: _bgm, ...defaultsSansBgm } = defaults;

			const payload: Record<string, unknown> = {
				...defaultsSansBgm,
				prompt: trimmedPrompt,
				image_url: request.image_url,
				duration,
			};

			if (request.resolution) {
				payload.resolution = request.resolution;
			}

			if (request.movement_amplitude) {
				payload.movement_amplitude = request.movement_amplitude;
			} else if (!payload.movement_amplitude) {
				payload.movement_amplitude = "auto";
			}

			if (request.seed !== undefined) {
				payload.seed = request.seed;
			}

			const shouldIncludeBgm =
				request.bgm !== undefined &&
				(request.duration ?? defaultDuration) === 4;
			if (shouldIncludeBgm) {
				payload.bgm = request.bgm;
			}

			const jobId = generateJobId();

			const response = await makeFalRequest(endpoint, payload);

			if (!response.ok) {
				await handleFalResponse(response, "Generate Vidu Q2 video");
			}

			const result = await response.json();

			return {
				job_id: jobId,
				status: "completed",
				message: `Video generated successfully with ${request.model}`,
				estimated_time: 0,
				video_url: result.video?.url || result.video || result.url,
				video_data: result,
			};
		}
	);
}

/**
 * Generate video from image using Vidu Q3.
 *
 * Features: Multi-resolution (360p-1080p), audio generation.
 *
 * @param request - Image URL, prompt, and generation parameters
 * @returns VideoGenerationResponse with job_id and video_url
 * @throws Error if FAL_API_KEY missing or validation fails
 */
export async function generateViduQ3ImageVideo(
	request: ViduQ3I2VRequest
): Promise<VideoGenerationResponse> {
	return withErrorHandling(
		"Generate Vidu Q3 image-to-video",
		{ operation: "generateViduQ3ImageVideo", model: request.model },
		async () => {
			const falApiKey = await getFalApiKeyAsync();
			if (!falApiKey) {
				throw new Error(
					"FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
				);
			}

			const trimmedPrompt = request.prompt?.trim() ?? "";
			if (!trimmedPrompt) {
				throw new Error(
					"Text prompt is required for Vidu Q3 image-to-video generation"
				);
			}
			validateViduQ3Prompt(trimmedPrompt);

			if (!request.image_url) {
				throw new Error(
					"Image is required for Vidu Q3 image-to-video generation"
				);
			}

			const modelConfig = getModelConfig(request.model);
			if (!modelConfig) {
				throw new Error(`Unknown model: ${request.model}`);
			}

			const endpoint = modelConfig.endpoints.image_to_video;
			if (!endpoint) {
				throw new Error(
					`Model ${request.model} does not support image-to-video generation`
				);
			}

			// Apply defaults
			const duration = request.duration ?? 5;
			const resolution =
				request.resolution ??
				(modelConfig.default_params?.resolution as string) ??
				"720p";
			const audio = request.audio ?? true;

			// Validate parameters
			validateViduQ3Duration(duration);
			validateViduQ3Resolution(resolution);

			const payload: Record<string, unknown> = {
				prompt: trimmedPrompt,
				image_url: request.image_url,
				duration,
				resolution,
				audio,
			};

			if (request.seed !== undefined) {
				payload.seed = request.seed;
			}

			const jobId = generateJobId();

			const response = await makeFalRequest(endpoint, payload);

			if (!response.ok) {
				await handleFalResponse(response, "Generate Vidu Q3 image-to-video");
			}

			const result = await response.json();

			return {
				job_id: jobId,
				status: "completed",
				message: `Video generated successfully with ${request.model}`,
				estimated_time: 0,
				video_url: result.video?.url || result.video || result.url,
				video_data: result,
			};
		}
	);
}
