/**
 * LTX Video 2.0 Text-to-Video Generator
 *
 * Generates video with audio from text using the LTX Video 2.0 model.
 */

import {
	validateLTXV2Resolution,
	validateLTXV2T2VDuration,
	validateLTXV2FastExtendedConstraints,
	isFastLTXV2TextModel,
} from "../../validation/validators";
import {
	withErrorHandling,
	getFalApiKeyAsync,
	generateJobId,
	makeFalRequest,
	handleFalResponse,
	getModelConfig,
	ERROR_MESSAGES,
	type LTXV2T2VRequest,
	type VideoGenerationResponse,
} from "./shared";

/**
 * Generate video with audio from text using LTX Video 2.0.
 *
 * @param request - Prompt, model ID, and generation parameters
 */
export async function generateLTXV2Video(
	request: LTXV2T2VRequest
): Promise<VideoGenerationResponse> {
	return withErrorHandling(
		"Generate LTX Video 2.0 video",
		{ operation: "generateLTXV2Video", model: request.model },
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
					"Please enter a text prompt for LTX Video 2.0 text-to-video generation"
				);
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

			// Validate and use defaults
			const duration =
				request.duration ??
				(modelConfig.default_params?.duration as number) ??
				6;
			const resolution =
				request.resolution ??
				(modelConfig.default_params?.resolution as string) ??
				"1080p";
			const fps =
				request.fps ?? (modelConfig.default_params?.fps as number) ?? 25;
			const generateAudio = request.generate_audio ?? true;

			validateLTXV2Resolution(resolution);
			validateLTXV2T2VDuration(duration, request.model);

			// For Fast T2V, validate extended constraints
			if (isFastLTXV2TextModel(request.model)) {
				validateLTXV2FastExtendedConstraints(
					duration,
					resolution,
					fps,
					ERROR_MESSAGES.LTXV2_FAST_T2V_EXTENDED_DURATION_CONSTRAINT
				);
			}

			const payload: Record<string, unknown> = {
				prompt: trimmedPrompt,
				duration,
				resolution,
				fps,
				generate_audio: generateAudio,
				...(request.aspect_ratio && { aspect_ratio: request.aspect_ratio }),
			};

			const jobId = generateJobId();

			const response = await makeFalRequest(endpoint, payload);

			if (!response.ok) {
				await handleFalResponse(response, "Generate LTX Video 2.0 video");
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
