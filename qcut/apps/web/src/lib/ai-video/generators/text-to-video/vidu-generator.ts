/**
 * Vidu Q3 Text-to-Video Generator
 *
 * Features: Multi-resolution (360p-1080p), aspect ratio control, audio generation.
 */

import {
	validateViduQ3Prompt,
	validateViduQ3Duration,
	validateViduQ3Resolution,
	validateViduQ3AspectRatio,
} from "../../validation/validators";
import {
	withErrorHandling,
	getFalApiKeyAsync,
	generateJobId,
	makeFalRequest,
	pollQueueStatus,
	handleQueueError,
	getModelConfig,
	type ViduQ3T2VRequest,
	type VideoGenerationResponse,
	type ProgressCallback,
} from "./shared";

/**
 * Generate video from text using Vidu Q3.
 *
 * Features: Multi-resolution (360p-1080p), aspect ratio control, audio generation.
 *
 * @param request - Prompt, duration, resolution, aspect ratio
 * @param onProgress - Optional callback for progress updates
 * @returns VideoGenerationResponse with job_id and video_url
 * @throws Error if FAL_API_KEY missing or validation fails
 */
export async function generateViduQ3TextVideo(
	request: ViduQ3T2VRequest,
	onProgress?: ProgressCallback
): Promise<VideoGenerationResponse> {
	return withErrorHandling(
		"Generate Vidu Q3 text-to-video",
		{ operation: "generateViduQ3TextVideo", model: request.model },
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
					"Text prompt is required for Vidu Q3 text-to-video generation"
				);
			}
			validateViduQ3Prompt(trimmedPrompt);

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
			const duration = request.duration ?? 5;
			const resolution =
				request.resolution ??
				(modelConfig.default_params?.resolution as string) ??
				"720p";
			const aspectRatio =
				request.aspect_ratio ??
				(modelConfig.default_params?.aspect_ratio as string) ??
				"16:9";
			const audio = request.audio ?? true;

			// Validate parameters
			validateViduQ3Duration(duration);
			validateViduQ3Resolution(resolution);
			validateViduQ3AspectRatio(aspectRatio);

			const payload: Record<string, unknown> = {
				prompt: trimmedPrompt,
				duration,
				resolution,
				aspect_ratio: aspectRatio,
				audio,
			};

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
					message: "Submitting Vidu Q3 text-to-video request...",
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
						message: "Vidu Q3 video generated successfully",
						elapsedTime: Math.floor((Date.now() - startTime) / 1000),
					});
				}

				return {
					job_id: jobId,
					status: "completed",
					message: "Video generated successfully with Vidu Q3",
					estimated_time: Math.floor((Date.now() - startTime) / 1000),
					video_url: queueResult.video.url,
					video_data: queueResult,
				};
			}

			throw new Error("No video URL received from Vidu Q3 API");
		}
	);
}
