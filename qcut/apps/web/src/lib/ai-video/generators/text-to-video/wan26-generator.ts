/**
 * WAN v2.6 Text-to-Video Generator
 *
 * Supports 15-second duration, aspect ratio control, multi-shot mode, and audio sync.
 */

import {
	validateWAN26Prompt,
	validateWAN26NegativePrompt,
	validateWAN26Duration,
	validateWAN26T2VResolution,
	validateWAN26AspectRatio,
} from "../../validation/validators";
import {
	withErrorHandling,
	getFalApiKeyAsync,
	generateJobId,
	makeFalRequest,
	pollQueueStatus,
	handleQueueError,
	getModelConfig,
	ERROR_MESSAGES,
	type WAN26T2VRequest,
	type VideoGenerationResponse,
	type ProgressCallback,
} from "./shared";

/**
 * Generate video from text using WAN v2.6.
 *
 * Supports 15-second duration, aspect ratio control, multi-shot mode, and audio sync.
 *
 * @param request - Prompt, model ID, and generation parameters
 * @param onProgress - Optional callback for real-time status updates
 * @returns VideoGenerationResponse with job_id and final video_url
 * @throws Error if FAL_API_KEY missing or validation fails
 */
export async function generateWAN26TextVideo(
	request: WAN26T2VRequest,
	onProgress?: ProgressCallback
): Promise<VideoGenerationResponse> {
	return withErrorHandling(
		"Generate WAN v2.6 text-to-video",
		{ operation: "generateWAN26TextVideo", model: request.model },
		async () => {
			const falApiKey = await getFalApiKeyAsync();
			if (!falApiKey) {
				throw new Error(
					"FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
				);
			}

			const trimmedPrompt = request.prompt?.trim() ?? "";
			if (!trimmedPrompt) {
				throw new Error(ERROR_MESSAGES.WAN26_EMPTY_PROMPT);
			}

			// Validate prompt
			validateWAN26Prompt(trimmedPrompt);

			// Validate negative prompt if provided
			if (request.negative_prompt) {
				validateWAN26NegativePrompt(request.negative_prompt);
			}

			const modelConfig = getModelConfig(request.model);
			if (!modelConfig) {
				throw new Error(`Unknown model: ${request.model}`);
			}

			const endpoint = modelConfig.endpoints.text_to_video;
			if (!endpoint) {
				throw new Error(
					`Model ${request.model} does not support text-to-video generation`
				);
			}

			// Apply defaults
			const duration =
				request.duration ??
				(modelConfig.default_params?.duration as number) ??
				5;
			const resolution =
				request.resolution ??
				(modelConfig.default_params?.resolution as string) ??
				"1080p";
			const aspectRatio =
				request.aspect_ratio ??
				(modelConfig.default_params?.aspect_ratio as string) ??
				"16:9";

			// Validate parameters
			validateWAN26Duration(duration);
			validateWAN26T2VResolution(resolution);
			validateWAN26AspectRatio(aspectRatio);

			const payload: Record<string, unknown> = {
				prompt: trimmedPrompt,
				duration,
				resolution,
				aspect_ratio: aspectRatio,
				enable_prompt_expansion:
					request.enable_prompt_expansion ??
					modelConfig.default_params?.enable_prompt_expansion ??
					true,
				multi_shots:
					request.multi_shots ??
					modelConfig.default_params?.multi_shots ??
					false,
				enable_safety_checker: request.enable_safety_checker ?? true,
			};

			// Optional parameters
			if (request.negative_prompt) {
				payload.negative_prompt = request.negative_prompt;
			}
			if (request.audio_url) {
				payload.audio_url = request.audio_url;
			}
			if (request.seed !== undefined) {
				payload.seed = request.seed;
			}

			const jobId = generateJobId();
			const startTime = Date.now();

			// Initial status update
			if (onProgress) {
				onProgress({
					status: "queued",
					progress: 0,
					message: "Submitting WAN v2.6 text-to-video request...",
					elapsedTime: 0,
				});
			}

			// Submit to queue
			const queueResponse = await makeFalRequest(endpoint, payload, {
				queueMode: true,
			});

			if (!queueResponse.ok) {
				const errorData = await queueResponse.json().catch(() => ({}));
				const errorMessage = handleQueueError(
					queueResponse,
					errorData,
					endpoint
				);
				throw new Error(errorMessage);
			}

			const queueResult = await queueResponse.json();
			const requestId = queueResult.request_id;

			if (requestId) {
				return await pollQueueStatus(requestId, {
					endpoint,
					startTime,
					onProgress,
					jobId,
					modelName: request.model,
					statusUrl: queueResult.status_url,
					responseUrl: queueResult.response_url,
				});
			}

			// Direct result
			if (queueResult.video && queueResult.video.url) {
				if (onProgress) {
					onProgress({
						status: "completed",
						progress: 100,
						message: "WAN v2.6 video generated successfully",
						elapsedTime: Math.floor((Date.now() - startTime) / 1000),
					});
				}

				return {
					job_id: jobId,
					status: "completed",
					message: "Video generated successfully with WAN v2.6",
					estimated_time: Math.floor((Date.now() - startTime) / 1000),
					video_url: queueResult.video.url,
					video_data: queueResult,
				};
			}

			throw new Error("No video URL received from WAN v2.6 API");
		}
	);
}
