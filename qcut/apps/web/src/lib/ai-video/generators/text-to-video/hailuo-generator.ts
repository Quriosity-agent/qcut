/**
 * Hailuo 2.3 Text-to-Video Generator
 *
 * Generates videos from text prompts using FAL AI's Hailuo 2.3 models.
 */

import {
	isHailuo23TextToVideo,
	validateHailuo23Duration,
	validateHailuo23Prompt,
} from "../../validation/validators";
import {
	withErrorHandling,
	getFalApiKeyAsync,
	generateJobId,
	makeFalRequest,
	handleFalResponse,
	getModelConfig,
	type TextToVideoRequest,
	type VideoGenerationResponse,
} from "./shared";

/**
 * Generates AI video from text prompt using FAL AI's Hailuo 2.3 text-to-video models.
 *
 * @param request - Text prompt, model ID, and generation parameters
 * @returns VideoGenerationResponse with job_id and final video_url
 * @throws Error if FAL_API_KEY missing or model doesn't support text-to-video
 */
export async function generateVideoFromText(
	request: TextToVideoRequest
): Promise<VideoGenerationResponse> {
	return withErrorHandling(
		"Generate video from text",
		{ operation: "generateVideoFromText", model: request.model },
		async () => {
			const falApiKey = await getFalApiKeyAsync();
			if (!falApiKey) {
				throw new Error(
					"FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
				);
			}

			const trimmedPrompt = request.prompt.trim();

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

			if (!trimmedPrompt) {
				throw new Error("Text prompt is required for text-to-video generation");
			}

			if (isHailuo23TextToVideo(request.model)) {
				validateHailuo23Prompt(trimmedPrompt, request.model);
				if (request.duration !== undefined) {
					validateHailuo23Duration(request.duration);
				}
			}

			// Build request payload for Hailuo 2.3 models
			const payload: Record<string, unknown> = {
				prompt: trimmedPrompt,
				...(modelConfig.default_params || {}),
			};

			if (request.resolution) {
				payload.resolution = request.resolution;
			}

			if (
				request.model === "hailuo23_standard_t2v" ||
				request.model === "hailuo23_pro_t2v"
			) {
				const requestedDuration = request.duration ?? 6;
				payload.duration = requestedDuration >= 10 ? "10" : "6";
			}

			if (request.prompt_optimizer !== undefined) {
				payload.prompt_optimizer = request.prompt_optimizer;
			}

			const jobId = generateJobId();

			const response = await makeFalRequest(endpoint, payload);

			if (!response.ok) {
				await handleFalResponse(response, "Generate video from text");
			}

			const result = await response.json();

			return {
				job_id: jobId,
				status: "completed",
				message: `Video generated successfully from text with ${request.model}`,
				estimated_time: 0,
				video_url: result.video?.url || result.video,
				video_data: result,
			};
		}
	);
}
