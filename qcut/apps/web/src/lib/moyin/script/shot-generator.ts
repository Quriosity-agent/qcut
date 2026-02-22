/**
 * Shot Generator Service
 * Generates images and videos for individual shots using AI APIs.
 *
 * Ported from moyin-creator. Uses retryOperation from moyin utils
 * and delay/RATE_LIMITS for batch rate limiting.
 */

import type { Shot } from "@/types/moyin-script";
import { retryOperation } from "../utils/retry";
import { delay, RATE_LIMITS } from "../utils/rate-limiter";

const buildEndpoint = (baseUrl: string, path: string) => {
	const normalized = baseUrl.replace(/\/+$/, "");
	return /\/v\d+$/.test(normalized)
		? `${normalized}/${path}`
		: `${normalized}/v1/${path}`;
};

export interface ShotGenerationConfig {
	apiKey: string;
	provider?: string;
	baseUrl: string;
	model: string;
	aspectRatio?: "16:9" | "9:16";
	styleTokens?: string[];
	referenceImages?: string[];
	imageResolution?: "1K" | "2K" | "4K";
	videoResolution?: "480p" | "720p" | "1080p";
}

export interface ShotGenerationResult {
	imageUrl?: string;
	videoUrl?: string;
}

// ==================== Task Polling ====================

async function pollTaskStatus(
	taskId: string,
	apiKey: string,
	baseUrl: string,
	type: "image" | "video",
	onProgress?: (progress: number) => void
): Promise<string> {
	const maxAttempts = 120;
	const pollInterval = 2000;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const progress = Math.min(Math.floor((attempt / maxAttempts) * 100), 99);
		onProgress?.(progress);

		try {
			const url = new URL(buildEndpoint(baseUrl, `tasks/${taskId}`));
			url.searchParams.set("_ts", Date.now().toString());

			const response = await fetch(url.toString(), {
				method: "GET",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Cache-Control": "no-cache",
				},
			});

			if (!response.ok) {
				throw new Error(`Failed to check task status: ${response.status}`);
			}

			const data = await response.json();
			const status = (data.status ?? data.data?.status ?? "unknown")
				.toString()
				.toLowerCase();

			const statusMap: Record<string, string> = {
				pending: "pending",
				submitted: "pending",
				queued: "pending",
				processing: "processing",
				running: "processing",
				in_progress: "processing",
				completed: "completed",
				succeeded: "completed",
				success: "completed",
				failed: "failed",
				error: "failed",
			};

			const mappedStatus = statusMap[status] || "processing";

			if (mappedStatus === "completed") {
				onProgress?.(100);

				let resultUrl: string | undefined;
				if (type === "image") {
					const images = data.result?.images ?? data.data?.result?.images;
					if (images?.[0]) {
						const urlField = images[0].url;
						resultUrl = Array.isArray(urlField) ? urlField[0] : urlField;
					}
				} else {
					const videos = data.result?.videos ?? data.data?.result?.videos;
					if (videos?.[0]) {
						const urlField = videos[0].url;
						resultUrl = Array.isArray(urlField) ? urlField[0] : urlField;
					}
				}
				resultUrl = resultUrl || data.output_url || data.result_url || data.url;

				if (!resultUrl) {
					throw new Error("Task completed but no URL in result");
				}
				return resultUrl;
			}

			if (mappedStatus === "failed") {
				const rawError = data.error || data.error_message || data.data?.error;
				throw new Error(rawError || "Task failed");
			}

			await new Promise((resolve) => setTimeout(resolve, pollInterval));
		} catch (error) {
			if (
				error instanceof Error &&
				(error.message.includes("Task failed") ||
					error.message.includes("no URL"))
			) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, pollInterval));
		}
	}

	throw new Error(`Task ${taskId} timed out`);
}

// ==================== Image Generation ====================

/**
 * Generate image for a shot
 */
export async function generateShotImage(
	shot: Shot,
	config: ShotGenerationConfig,
	onProgress?: (progress: number) => void
): Promise<string> {
	const {
		apiKey,
		baseUrl,
		model,
		aspectRatio = "16:9",
		styleTokens = [],
		referenceImages = [],
	} = config;

	if (!apiKey) throw new Error("API Key is required");
	if (!baseUrl) throw new Error("Base URL is required");
	if (!model) throw new Error("Model is required");

	// Build prompt (prefer calibrated imagePrompt from three-tier system)
	let prompt = shot.imagePrompt || shot.visualPrompt || shot.actionSummary;
	if (styleTokens.length > 0) {
		prompt = `${styleTokens.join(", ")}, ${prompt}`;
	}
	prompt = `cinematic, highly detailed, 8k resolution, professional lighting, ${prompt}`;

	const requestData: Record<string, unknown> = {
		model,
		prompt,
		n: 1,
		size: aspectRatio,
		resolution: config.imageResolution || "2K",
	};

	if (referenceImages.length > 0) {
		requestData.image_urls = referenceImages;
	}

	onProgress?.(10);

	const data = await retryOperation(
		async () => {
			const response = await fetch(
				buildEndpoint(baseUrl, "images/generations"),
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(requestData),
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				let errorMessage = `API error: ${response.status}`;
				try {
					const errorJson = JSON.parse(errorText);
					errorMessage =
						errorJson.error?.message || errorJson.message || errorMessage;
				} catch {
					// keep default message
				}

				const error = new Error(errorMessage) as Error & {
					status?: number;
				};
				error.status = response.status;
				throw error;
			}

			return response.json();
		},
		{ maxRetries: 3, baseDelay: 3000 }
	);

	onProgress?.(30);

	// Check for direct URL
	const directUrl = data.data?.[0]?.url || data.url;
	if (directUrl) {
		onProgress?.(100);
		return directUrl;
	}

	// Get task ID and poll
	const taskId =
		data.data?.[0]?.task_id?.toString() || data.task_id?.toString();
	if (!taskId) {
		throw new Error("No task_id or image URL in response");
	}

	return pollTaskStatus(taskId, apiKey, baseUrl, "image", (p) => {
		onProgress?.(30 + Math.floor(p * 0.7));
	});
}

// ==================== Video Generation ====================

/**
 * Generate video for a shot (image-to-video)
 */
export async function generateShotVideo(
	shot: Shot,
	imageUrl: string,
	config: ShotGenerationConfig,
	onProgress?: (progress: number) => void
): Promise<string> {
	const {
		apiKey,
		baseUrl,
		model,
		aspectRatio = "16:9",
		referenceImages = [],
	} = config;

	if (!apiKey) throw new Error("API Key is required");
	if (!baseUrl) throw new Error("Base URL is required");
	if (!model) throw new Error("Model is required");

	const prompt = shot.videoPrompt || shot.actionSummary;

	interface ImageWithRole {
		url: string;
		role: "first_frame" | "last_frame" | "reference_image";
	}

	const roles: ImageWithRole[] = [{ url: imageUrl, role: "first_frame" }];

	const maxRefs = Math.min(referenceImages.length, 4);
	for (let i = 0; i < maxRefs; i++) {
		roles.push({ url: referenceImages[i], role: "reference_image" });
	}

	const requestBody = {
		model,
		prompt,
		duration: shot.duration || 5,
		aspect_ratio: aspectRatio,
		resolution: config.videoResolution || "480p",
		audio: true,
		camerafixed: false,
		image_with_roles: roles,
	};

	onProgress?.(10);

	const data = await retryOperation(
		async () => {
			const response = await fetch(
				buildEndpoint(baseUrl, "videos/generations"),
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(requestBody),
				}
			);

			if (!response.ok) {
				const errorText = await response.text();
				let errorMessage = `API error: ${response.status}`;
				try {
					const errorJson = JSON.parse(errorText);
					errorMessage =
						errorJson.error?.message || errorJson.message || errorMessage;
				} catch {
					// keep default message
				}

				const error = new Error(errorMessage) as Error & {
					status?: number;
				};
				error.status = response.status;
				throw error;
			}

			return response.json();
		},
		{ maxRetries: 3, baseDelay: 5000 }
	);

	onProgress?.(30);

	// Get task ID
	let taskId: string | undefined;
	const dataField = data.data;
	if (Array.isArray(dataField) && dataField.length > 0) {
		taskId = dataField[0].task_id?.toString() || dataField[0].id?.toString();
	} else if (dataField && typeof dataField === "object") {
		taskId = dataField.task_id?.toString() || dataField.id?.toString();
	} else {
		taskId = data.task_id?.toString() || data.id?.toString();
	}

	if (!taskId) {
		throw new Error("No task ID in response");
	}

	return pollTaskStatus(taskId, apiKey, baseUrl, "video", (p) => {
		onProgress?.(30 + Math.floor(p * 0.7));
	});
}

// ==================== Batch Generation ====================

/**
 * Batch generate images for multiple shots with rate limiting
 */
export async function batchGenerateShotImages(
	shots: Shot[],
	config: ShotGenerationConfig,
	onShotProgress: (shotId: string, progress: number) => void,
	onShotComplete: (shotId: string, imageUrl: string) => void,
	onShotError: (shotId: string, error: string) => void
): Promise<void> {
	for (let i = 0; i < shots.length; i++) {
		const shot = shots[i];

		if (i > 0) {
			await delay(RATE_LIMITS.BATCH_ITEM_DELAY);
		}

		try {
			const imageUrl = await generateShotImage(shot, config, (progress) =>
				onShotProgress(shot.id, progress)
			);
			onShotComplete(shot.id, imageUrl);
		} catch (error) {
			const err = error as Error;
			onShotError(shot.id, err.message);
		}
	}
}
