/**
 * Main Text-to-Video Generator
 *
 * Primary entry point for generating videos from text prompts using FAL AI.
 * Supports queue-based and direct API modes with automatic fallback.
 */

import { isSora2Model, parseSora2Response } from "../../models/sora2";
import {
	buildTextToVideoPayload,
	withErrorHandling,
	getFalApiKeyAsync,
	generateJobId,
	makeFalRequest,
	pollQueueStatus,
	handleQueueError,
	streamVideoDownload,
	handleAIServiceError,
	getModelConfig,
	type VideoGenerationRequest,
	type VideoGenerationResponse,
	type ProgressCallback,
	type StreamOptions,
	type Sora2Duration,
} from "./shared";

/**
 * Generates AI video from text prompt using FAL AI's text-to-video models.
 *
 * WHY: Direct FAL integration bypasses backend, reducing latency and infrastructure costs.
 * Side effect: Downloads video to memory or streams to disk based on downloadOptions.
 * Performance: Large videos (>50MB) should use streaming to avoid memory spikes.
 *
 * Edge cases:
 * - Returns job_id immediately; actual video URL arrives after polling completes
 * - FAL API may return 429 rate limit; caller should implement exponential backoff
 * - Some models (Veo3) take 5+ minutes; set appropriate timeouts
 *
 * @param request - Text prompt, model ID, and generation parameters
 * @param onProgress - Optional callback for real-time status updates (called every 2s during polling)
 * @param downloadOptions - Controls how video data is fetched (memory vs. streaming)
 * @returns VideoGenerationResponse with job_id and final video_url
 * @throws Error if FAL_API_KEY missing or API returns 4xx/5xx errors
 */
export async function generateVideo(
	request: VideoGenerationRequest,
	onProgress?: ProgressCallback,
	downloadOptions?: StreamOptions
): Promise<VideoGenerationResponse> {
	return withErrorHandling(
		"AI Video Generation",
		{ operation: "generateVideo", model: request.model },
		async () => {
			const falApiKey = await getFalApiKeyAsync();
			if (!falApiKey) {
				throw new Error(
					"FAL API key not configured. Please set VITE_FAL_API_KEY environment variable or configure it in Settings."
				);
			}

			// Get model configuration from centralized config
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

			const jobId = generateJobId();

			// Build request payload
			const payload = buildTextToVideoPayload(request, modelConfig);

			// Track start time for elapsed time calculation
			const startTime = Date.now();

			// Initial status update
			if (onProgress) {
				onProgress({
					status: "queued",
					progress: 0,
					message: "Submitting request to FAL.ai queue...",
					elapsedTime: 0,
				});
			}

			// Try queue mode first using centralized request helper
			const queueResponse = await makeFalRequest(endpoint, payload, {
				queueMode: true,
			});

			if (!queueResponse.ok) {
				const errorData = await queueResponse.json().catch(() => ({}));
				handleAIServiceError(
					new Error(
						`FAL Queue Submit Error: ${queueResponse.status} ${queueResponse.statusText}`
					),
					"Submit FAL AI request to queue",
					{
						status: queueResponse.status,
						statusText: queueResponse.statusText,
						errorData,
						endpoint,
						operation: "queueSubmit",
					}
				);

				const errorMessage = handleQueueError(
					queueResponse,
					errorData,
					endpoint
				);
				throw new Error(errorMessage);
			}

			const queueResult = await queueResponse.json();

			// Check if we got a request_id (queue mode) or direct result
			const requestId = queueResult.request_id;

			if (requestId) {
				return await pollQueueStatus(requestId, {
					endpoint,
					startTime,
					onProgress,
					jobId,
					modelName: request.model,
					downloadOptions,
					statusUrl: queueResult.status_url,
					responseUrl: queueResult.response_url,
				});
			}

			if (queueResult.video && queueResult.video.url) {
				// Parse Sora 2 response if needed
				let videoUrl = queueResult.video.url;
				if (isSora2Model(request.model)) {
					try {
						const parsed = parseSora2Response(
							queueResult,
							(request.duration || 4) as Sora2Duration,
							request.resolution,
							request.aspect_ratio
						);
						videoUrl = parsed.videoUrl;
					} catch {
						console.warn(
							"Failed to parse as Sora 2 response, using default format"
						);
					}
				}

				// Handle streaming download if requested
				if (downloadOptions?.downloadToMemory) {
					await streamVideoDownload(videoUrl, downloadOptions);
				}

				if (onProgress) {
					onProgress({
						status: "completed",
						progress: 100,
						message: `Video generated successfully with ${request.model}`,
						elapsedTime: Math.floor((Date.now() - startTime) / 1000),
					});
				}

				return {
					job_id: jobId,
					status: "completed",
					message: `Video generated successfully with ${request.model}`,
					estimated_time: Math.floor((Date.now() - startTime) / 1000),
					video_url: videoUrl,
					video_data: queueResult,
				};
			}

			// Fallback: Try direct API call without queue headers

			const directResponse = await makeFalRequest(endpoint, payload);

			if (!directResponse.ok) {
				const errorData = await directResponse.json().catch(() => ({}));
				throw new Error(
					`Both queue and direct modes failed. Status: ${directResponse.status}, Error: ${JSON.stringify(errorData)}`
				);
			}

			const directResult = await directResponse.json();

			if (directResult.video && directResult.video.url) {
				let videoUrl = directResult.video.url;
				if (isSora2Model(request.model)) {
					try {
						const parsed = parseSora2Response(
							directResult,
							(request.duration || 4) as Sora2Duration,
							request.resolution,
							request.aspect_ratio
						);
						videoUrl = parsed.videoUrl;
					} catch {
						console.warn(
							"Failed to parse as Sora 2 response, using default format"
						);
					}
				}

				if (downloadOptions?.downloadToMemory) {
					await streamVideoDownload(videoUrl, downloadOptions);
				}

				if (onProgress) {
					onProgress({
						status: "completed",
						progress: 100,
						message: `Video generated successfully with ${request.model}`,
						elapsedTime: Math.floor((Date.now() - startTime) / 1000),
					});
				}

				return {
					job_id: jobId,
					status: "completed",
					message: `Video generated successfully with ${request.model}`,
					estimated_time: Math.floor((Date.now() - startTime) / 1000),
					video_url: videoUrl,
					video_data: directResult,
				};
			}

			throw new Error(
				"No video URL received from either queue or direct API mode."
			);
		}
	);
}
