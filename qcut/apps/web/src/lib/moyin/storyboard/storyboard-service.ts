/**
 * Storyboard Generation Service
 *
 * Handles generation of storyboard contact sheet images and scene videos
 * using AI image/video APIs. For Electron desktop app.
 *
 * Ported from moyin-creator. Adapted to use QCut's existing prompt-builder
 * and grid-calculator modules.
 */

import {
	buildStoryboardPrompt,
	getDefaultNegativePrompt,
	type StoryboardPromptConfig,
	type CharacterInfo,
} from "./prompt-builder";
import {
	calculateGrid,
	type AspectRatio,
	type Resolution,
	RESOLUTION_PRESETS,
} from "./grid-calculator";
import { retryOperation } from "../utils/retry";
import { delay, RATE_LIMITS } from "../utils/rate-limiter";

// ==================== Types ====================

export interface StoryboardGenerationConfig {
	storyPrompt: string;
	sceneCount: number;
	aspectRatio: AspectRatio;
	resolution: Resolution;
	styleId?: string;
	styleTokens?: string[];
	characterDescriptions?: string[];
	characterReferenceImages?: string[];
	apiKey: string;
	provider?: string;
	model?: string;
	baseUrl?: string;
	mockMode?: boolean;
}

export interface StoryboardGenerationResult {
	imageUrl: string;
	gridConfig: {
		cols: number;
		rows: number;
		cellWidth: number;
		cellHeight: number;
	};
}

// ==================== Helpers ====================

const buildEndpoint = (baseUrl: string, path: string) => {
	const normalized = baseUrl.replace(/\/+$/, "");
	return /\/v\d+$/.test(normalized)
		? `${normalized}/${path}`
		: `${normalized}/v1/${path}`;
};

// ==================== Task Polling ====================

async function pollTaskCompletion(
	taskId: string,
	apiKey: string,
	onProgress: ((progress: number) => void) | undefined,
	type: "image" | "video",
	baseUrl: string
): Promise<string> {
	const maxAttempts = 120;
	const pollInterval = 2000;

	if (taskId.startsWith("mock_") || taskId.startsWith("sync_")) {
		return "";
	}

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
					"Cache-Control": "no-cache, no-store, must-revalidate",
					Pragma: "no-cache",
				},
			});

			if (!response.ok) {
				if (response.status === 404) {
					throw new Error("Task not found");
				}
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
				const errorMsg = rawError
					? typeof rawError === "string"
						? rawError
						: JSON.stringify(rawError)
					: "Task failed";
				throw new Error(errorMsg);
			}

			await new Promise((resolve) => setTimeout(resolve, pollInterval));
		} catch (error) {
			if (
				error instanceof Error &&
				(error.message.includes("Task failed") ||
					error.message.includes("Task completed") ||
					error.message.includes("Task not found") ||
					error.message.includes("no URL"))
			) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, pollInterval));
		}
	}

	throw new Error(
		`Task ${taskId} timed out after ${(maxAttempts * pollInterval) / 1000}s`
	);
}

// ==================== Image Generation ====================

async function submitImageGenTask(
	prompt: string,
	aspectRatio: string,
	resolution: string,
	apiKey: string,
	referenceImages: string[] | undefined,
	model: string,
	baseUrl: string
): Promise<{ taskId?: string; imageUrl?: string }> {
	const requestData: Record<string, unknown> = {
		model,
		prompt,
		n: 1,
		size: aspectRatio,
		resolution,
	};

	if (referenceImages && referenceImages.length > 0) {
		requestData.image_urls = referenceImages;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 120_000);

	try {
		const data = await retryOperation(
			async () => {
				const endpoint = buildEndpoint(baseUrl, "images/generations");
				const response = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(requestData),
					signal: controller.signal,
				});

				if (!response.ok) {
					const errorText = await response.text();
					let errorMessage = `Image API error: ${response.status}`;
					try {
						const errorJson = JSON.parse(errorText);
						errorMessage =
							errorJson.error?.message || errorJson.message || errorMessage;
					} catch {
						if (errorText && errorText.length < 200) {
							errorMessage = errorText;
						}
					}

					if (response.status === 401 || response.status === 403) {
						throw new Error("API Key invalid or expired");
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

		clearTimeout(timeoutId);

		// Check for synchronous result
		const directUrl = data.data?.[0]?.url || data.url;
		if (directUrl) {
			return { imageUrl: directUrl };
		}

		// Get task ID
		let taskId: string | undefined;
		const dataList = data.data;
		if (Array.isArray(dataList) && dataList.length > 0) {
			taskId = dataList[0].task_id?.toString();
		}
		taskId = taskId || data.task_id?.toString();

		if (!taskId) {
			throw new Error("No task_id or image URL in response");
		}

		return { taskId };
	} catch (error) {
		clearTimeout(timeoutId);
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				throw new Error("Image generation timed out");
			}
			throw error;
		}
		throw new Error("Unknown error calling image API");
	}
}

/**
 * Generate a storyboard contact sheet image
 */
export async function generateStoryboardImage(
	config: StoryboardGenerationConfig,
	onProgress?: (progress: number) => void
): Promise<StoryboardGenerationResult> {
	const {
		storyPrompt,
		sceneCount,
		aspectRatio,
		resolution,
		styleTokens = [],
		characterDescriptions = [],
		apiKey,
		mockMode = false,
	} = config;

	const gridConfig = calculateGrid({ sceneCount, aspectRatio, resolution });

	const characters: CharacterInfo[] = characterDescriptions.map((desc, i) => ({
		name: `Character ${i + 1}`,
		visualTraits: desc,
	}));

	const promptConfig: StoryboardPromptConfig = {
		story: storyPrompt,
		sceneCount,
		aspectRatio,
		resolution,
		styleTokens,
		characters: characters.length > 0 ? characters : undefined,
	};

	const prompt = buildStoryboardPrompt(promptConfig);
	const outputSize = RESOLUTION_PRESETS[resolution][aspectRatio];

	if (mockMode) {
		onProgress?.(100);
		return {
			imageUrl: `https://placehold.co/${outputSize.width}x${outputSize.height}/333/fff?text=Storyboard+Mock+(${gridConfig.cols}x${gridConfig.rows})`,
			gridConfig: {
				cols: gridConfig.cols,
				rows: gridConfig.rows,
				cellWidth: gridConfig.cellWidth,
				cellHeight: gridConfig.cellHeight,
			},
		};
	}

	if (!apiKey) throw new Error("Please configure an API key in Settings");

	const baseUrl = config.baseUrl?.replace(/\/+$/, "");
	if (!baseUrl) throw new Error("Please configure image generation base URL");
	const model = config.model;
	if (!model) throw new Error("Please configure image generation model");

	onProgress?.(10);

	const result = await submitImageGenTask(
		prompt,
		aspectRatio,
		resolution,
		apiKey,
		config.characterReferenceImages,
		model,
		baseUrl
	);

	onProgress?.(30);

	if (result.imageUrl) {
		onProgress?.(100);
		return {
			imageUrl: result.imageUrl,
			gridConfig: {
				cols: gridConfig.cols,
				rows: gridConfig.rows,
				cellWidth: gridConfig.cellWidth,
				cellHeight: gridConfig.cellHeight,
			},
		};
	}

	if (result.taskId) {
		const imageUrl = await pollTaskCompletion(
			result.taskId,
			apiKey,
			(progress) => {
				onProgress?.(30 + Math.floor(progress * 0.7));
			},
			"image",
			baseUrl
		);

		return {
			imageUrl,
			gridConfig: {
				cols: gridConfig.cols,
				rows: gridConfig.rows,
				cellWidth: gridConfig.cellWidth,
				cellHeight: gridConfig.cellHeight,
			},
		};
	}

	throw new Error("Invalid API response: no taskId or imageUrl");
}

// ==================== Video Generation ====================

async function submitVideoGenTask(
	imageInput: string,
	prompt: string,
	aspectRatio: string,
	apiKey: string,
	referenceImages: string[] | undefined,
	model: string,
	baseUrl: string,
	videoResolution?: "480p" | "720p" | "1080p"
): Promise<{ taskId: string }> {
	interface ImageWithRole {
		url: string;
		role: "first_frame" | "last_frame" | "reference_image";
	}

	const roles: ImageWithRole[] = [{ url: imageInput, role: "first_frame" }];

	if (referenceImages && referenceImages.length > 0) {
		const maxRefs = Math.min(referenceImages.length, 4);
		for (let i = 0; i < maxRefs; i++) {
			roles.push({
				url: referenceImages[i],
				role: "reference_image",
			});
		}
	}

	const requestBody: Record<string, unknown> = {
		model,
		prompt,
		duration: 5,
		aspect_ratio: aspectRatio,
		resolution: videoResolution || "480p",
		audio: true,
		camerafixed: false,
		image_with_roles: roles,
	};

	const data = await retryOperation(
		async () => {
			const endpoint = buildEndpoint(baseUrl, "videos/generations");
			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				const errorText = await response.text();
				let errorMessage = `Video API error: ${response.status}`;
				try {
					const errorJson = JSON.parse(errorText);
					errorMessage =
						errorJson.error?.message || errorJson.message || errorMessage;
				} catch {
					if (errorText && errorText.length < 200) {
						errorMessage = errorText;
					}
				}

				if (response.status === 401 || response.status === 403) {
					throw new Error("API Key invalid or expired");
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
		throw new Error("API returned empty task ID");
	}

	return { taskId };
}

/**
 * Generate videos for split scenes
 */
export async function generateSceneVideos(
	scenes: Array<{
		id: number;
		imageDataUrl: string;
		videoPrompt: string;
	}>,
	config: {
		aspectRatio: AspectRatio;
		apiKey: string;
		provider?: string;
		model?: string;
		baseUrl?: string;
		mockMode?: boolean;
		characterReferenceImages?: string[];
		videoResolution?: "480p" | "720p" | "1080p";
	},
	onSceneProgress?: (sceneId: number, progress: number) => void,
	onSceneComplete?: (sceneId: number, videoUrl: string) => void,
	onSceneFailed?: (sceneId: number, error: string) => void
): Promise<Map<number, string>> {
	const results = new Map<number, string>();

	const {
		aspectRatio,
		apiKey,
		model,
		baseUrl,
		mockMode = false,
		characterReferenceImages = [],
	} = config;

	if (!apiKey && !mockMode) {
		throw new Error("Please configure an API key in Settings");
	}

	for (let i = 0; i < scenes.length; i++) {
		const scene = scenes[i];

		if (i > 0) {
			await delay(RATE_LIMITS.BATCH_ITEM_DELAY);
		}

		try {
			onSceneProgress?.(scene.id, 0);

			if (mockMode) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				const mockUrl = `https://example.com/mock-video-${scene.id}.mp4`;
				results.set(scene.id, mockUrl);
				onSceneProgress?.(scene.id, 100);
				onSceneComplete?.(scene.id, mockUrl);
				continue;
			}

			onSceneProgress?.(scene.id, 10);

			const resolvedBaseUrl = baseUrl?.replace(/\/+$/, "");
			if (!resolvedBaseUrl) {
				throw new Error("Please configure video generation base URL");
			}
			if (!model) {
				throw new Error("Please configure video generation model");
			}

			const result = await submitVideoGenTask(
				scene.imageDataUrl,
				scene.videoPrompt,
				aspectRatio,
				apiKey,
				characterReferenceImages,
				model,
				resolvedBaseUrl,
				config.videoResolution
			);

			onSceneProgress?.(scene.id, 30);

			const videoUrl = await pollTaskCompletion(
				result.taskId,
				apiKey,
				(progress) => {
					onSceneProgress?.(scene.id, 30 + Math.floor(progress * 0.7));
				},
				"video",
				resolvedBaseUrl
			);

			results.set(scene.id, videoUrl);
			onSceneProgress?.(scene.id, 100);
			onSceneComplete?.(scene.id, videoUrl);
		} catch (error) {
			const err = error as Error;
			console.error(
				`[StoryboardService] Scene ${scene.id} video generation failed:`,
				err
			);
			onSceneFailed?.(scene.id, err.message);
		}
	}

	return results;
}
