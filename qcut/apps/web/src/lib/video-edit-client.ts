/**
 * Video Edit FAL AI Client
 *
 * WHY this client:
 * - Centralized FAL API integration for video edit models
 * - Handles authentication, polling, and error recovery
 * - Uses direct HTTP requests to avoid @fal-ai/client initialization issues in Electron
 *
 * Performance: Direct client-to-FAL reduces latency by ~500ms vs backend proxy
 */

import { debugLog, debugError } from "@/lib/debug-config";
import type {
	KlingVideoToAudioParams,
	MMAudioV2Params,
	TopazUpscaleParams,
	VideoEditResult,
} from "@/components/editor/media-panel/views/video-edit-types";
import { VIDEO_EDIT_MODELS } from "@/components/editor/media-panel/views/video-edit-constants";
import {
	getFalApiKeyAsync,
	FAL_UPLOAD_URL,
} from "@/lib/ai-video/core/fal-request";

const FAL_API_BASE = "https://fal.run";
const FAL_QUEUE_BASE = "https://queue.fal.run";

/**
 * FAL API Response Types
 */
interface FalQueueResponse {
	request_id: string;
	status_url?: string;
}

interface FalStatusResponse {
	status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
	progress?: number;
	logs?: string[];
	error?: string;
	// Result fields when completed
	video_url?: string;
	audio_url?: string;
	video?: {
		url: string;
		duration?: number;
		width?: number;
		height?: number;
		size?: number;
	};
}

interface FalDirectResponse {
	video_url?: string;
	audio_url?: string;
	video?: {
		url: string;
		duration?: number;
		width?: number;
		height?: number;
		size?: number;
	};
	audio?: {
		url: string;
		duration?: number;
	};
	// Some FAL models wrap response in data property
	data?: {
		video_url?: string;
		audio_url?: string;
		video?: {
			url: string;
			duration?: number;
			width?: number;
			height?: number;
			size?: number;
		};
		audio?: {
			url: string;
			duration?: number;
		};
	};
}

type FalDirectResult = FalDirectResponse & {
	request_id?: string;
	requestId?: string; // Some responses use camelCase
};

type KlingInputPayload = {
	video_url: string;
	sound_effect_prompt?: string;
	background_music_prompt?: string;
	asmr_mode?: boolean;
};

/**
 * Video Edit Client Class
 * Uses direct HTTP requests instead of @fal-ai/client to avoid Electron issues
 */
class VideoEditClient {
	private initialized = false;
	private apiKey: string | null = null;

	/**
	 * Initialize with API key
	 */
	private async initializeApiKey() {
		try {
			this.apiKey = (await getFalApiKeyAsync()) || null;
			if (this.apiKey) {
				this.initialized = true;
				debugLog("Video Edit Client: API key loaded");
			} else {
				debugError("Video Edit Client: No FAL API key found");
			}
		} catch (error) {
			debugError("Video Edit Client: Failed to initialize", error);
		}
	}

	/**
	 * Ensure client is ready
	 */
	private async ensureInitialized(): Promise<void> {
		if (this.initialized) return;
		await this.initializeApiKey();
		if (!this.initialized) {
			throw new Error("FAL AI API key not configured");
		}
	}

	/**
	 * Handle FAL API errors
	 */
	private handleApiError(error: unknown): string {
		const err = error as Record<string, unknown>;
		if (err?.status === 429) {
			return "Rate limit exceeded. Please wait a moment and try again.";
		}
		if (err?.status === 402) {
			return "Insufficient credits. Please check your FAL account.";
		}
		if (err?.status === 413) {
			return "File too large. Please use a smaller video.";
		}
		if (err?.message && typeof err.message === "string") {
			return err.message;
		}
		return "An unexpected error occurred. Please try again.";
	}

	/**
	 * Make a direct FAL API request
	 */
	private async makeFalRequest<T>(
		endpoint: string,
		input: Record<string, unknown>
	): Promise<T> {
		if (!this.apiKey) {
			throw new Error("API key not initialized");
		}

		const url = endpoint.startsWith("https://")
			? endpoint
			: `${FAL_API_BASE}/${endpoint}`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Key ${this.apiKey}`,
			},
			body: JSON.stringify(input),
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			const err = errorData as Record<string, unknown>;

			// Handle validation errors
			if (response.status === 422 && err.detail) {
				const details = Array.isArray(err.detail)
					? err.detail
							.map((d: unknown) =>
								typeof d === "object" && d !== null && "msg" in d
									? (d as { msg: string }).msg
									: JSON.stringify(d)
							)
							.join(", ")
					: String(err.detail);
				throw new Error(`Validation error: ${details}`);
			}

			throw new Error(
				`FAL API error: ${err.detail || err.error || response.statusText}`
			);
		}

		return response.json();
	}

	/**
	 * Upload video file to FAL storage
	 */
	async uploadVideo(file: File | Blob): Promise<string> {
		await this.ensureInitialized();

		try {
			debugLog("Uploading video to FAL storage:", {
				size: file.size,
				type: file.type,
			});

			const formData = new FormData();
			formData.append("file", file);

			const response = await fetch(FAL_UPLOAD_URL, {
				method: "POST",
				headers: {
					Authorization: `Key ${this.apiKey}`,
				},
				body: formData,
			});

			if (!response.ok) {
				throw new Error(
					`Upload failed: ${response.status} ${response.statusText}`
				);
			}

			const data = (await response.json()) as { url?: string };
			if (!data.url) {
				throw new Error("Upload response missing URL");
			}

			debugLog("Video uploaded successfully:", data.url);
			return data.url;
		} catch (error) {
			debugError("Failed to upload video:", error);
			throw new Error(this.handleApiError(error));
		}
	}

	/**
	 * Parse FAL API response defensively
	 */
	private parseResponse(result: FalDirectResult): {
		videoUrl: string | null;
		audioUrl: string | null;
		duration: number | undefined;
		fileSize: number | undefined;
		width: number | undefined;
		height: number | undefined;
		jobId: string;
	} {
		console.log("[FAL Response Parser] Raw result:", result);

		let videoUrl: string | null = null;
		let audioUrl: string | null = null;

		// Check direct properties first
		if (result.video_url) {
			videoUrl = result.video_url;
		} else if (result.video?.url) {
			videoUrl = result.video.url;
		} else if (result.data?.video_url) {
			videoUrl = result.data.video_url;
		} else if (result.data?.video?.url) {
			videoUrl = result.data.video.url;
		}

		// Check audio URL
		if (result.audio_url) {
			audioUrl = result.audio_url;
		} else if (result.audio?.url) {
			audioUrl = result.audio.url;
		} else if (result.data?.audio_url) {
			audioUrl = result.data.audio_url;
		} else if (result.data?.audio?.url) {
			audioUrl = result.data.audio.url;
		}

		const duration = result.video?.duration || result.data?.video?.duration;
		const fileSize = result.video?.size || result.data?.video?.size;
		const width = result.video?.width || result.data?.video?.width;
		const height = result.video?.height || result.data?.video?.height;
		const jobId = result.requestId || result.request_id || `fal-${Date.now()}`;

		console.log("[FAL Response Parser] Parsed:", {
			videoUrl,
			audioUrl,
			duration,
			fileSize,
			width,
			height,
			jobId,
		});

		return { videoUrl, audioUrl, duration, fileSize, width, height, jobId };
	}

	/**
	 * Generate audio from video using Kling
	 */
	async generateKlingAudio(
		params: KlingVideoToAudioParams
	): Promise<VideoEditResult> {
		await this.ensureInitialized();

		console.log("=== KLING VIDEO TO AUDIO DEBUG START ===");
		console.log("1. Input params received:", params);

		// Validate video URL
		if (!params.video_url) {
			throw new Error("Video URL is required");
		}
		if (params.video_url.startsWith("blob:")) {
			throw new Error(
				"Blob URLs are not supported. Upload the video to FAL storage first."
			);
		}
		if (params.video_url.startsWith("data:")) {
			throw new Error(
				"Data URLs are not supported. Upload the video to FAL storage first."
			);
		}
		if (
			!params.video_url.startsWith("http://") &&
			!params.video_url.startsWith("https://")
		) {
			throw new Error(
				`Invalid video URL format: ${params.video_url.substring(0, 50)}...`
			);
		}

		debugLog("Generating audio with Kling:", {
			hasVideo: !!params.video_url,
			soundEffect: params.sound_effect_prompt,
			bgMusic: params.background_music_prompt,
			asmrMode: params.asmr_mode,
		});

		try {
			const model = VIDEO_EDIT_MODELS.find(
				(m) => m.id === "kling_video_to_audio"
			);
			if (!model) throw new Error("Model configuration not found");

			const inputPayload: KlingInputPayload = {
				video_url: params.video_url,
			};

			if (params.sound_effect_prompt?.trim()) {
				inputPayload.sound_effect_prompt = params.sound_effect_prompt;
			}
			if (params.background_music_prompt?.trim()) {
				inputPayload.background_music_prompt = params.background_music_prompt;
			}
			if (params.asmr_mode !== undefined) {
				inputPayload.asmr_mode = params.asmr_mode;
			}

			console.log("5. Final payload:", JSON.stringify(inputPayload, null, 2));

			const result = await this.makeFalRequest<FalDirectResult>(
				model.endpoints.process,
				inputPayload
			);

			const parsed = this.parseResponse(result);

			if (!parsed.videoUrl) {
				throw new Error("No video URL in response");
			}

			console.log("10. Result received:", result);
			console.log("=== KLING VIDEO TO AUDIO DEBUG END ===");

			return {
				modelId: "kling_video_to_audio",
				jobId: parsed.jobId,
				videoUrl: parsed.videoUrl,
				audioUrl: parsed.audioUrl || undefined,
				duration: parsed.duration,
				width: parsed.width,
				height: parsed.height,
			};
		} catch (error) {
			console.error("=== KLING ERROR DEBUG ===", error);
			debugError("Kling audio generation failed:", error);
			throw new Error(this.handleApiError(error));
		}
	}

	/**
	 * Generate synchronized audio using MMAudio V2
	 */
	async generateMMAudio(params: MMAudioV2Params): Promise<VideoEditResult> {
		await this.ensureInitialized();

		debugLog("Generating MMAudio:", {
			hasVideo: !!params.video_url,
			prompt: params.prompt?.substring(0, 50),
			numSteps: params.num_steps,
		});

		try {
			const model = VIDEO_EDIT_MODELS.find((m) => m.id === "mmaudio_v2");
			if (!model) throw new Error("Model configuration not found");

			const result = await this.makeFalRequest<FalDirectResult>(
				model.endpoints.process,
				{
					video_url: params.video_url,
					prompt: params.prompt,
					negative_prompt: params.negative_prompt,
					seed: params.seed,
					num_steps: params.num_steps || 25,
					duration: params.duration,
					cfg_strength: params.cfg_strength || 4.5,
					mask_away_clip: params.mask_away_clip || false,
				}
			);

			const parsed = this.parseResponse(result);

			if (!parsed.videoUrl) {
				throw new Error("No video URL in response");
			}

			const duration = parsed.duration || params.duration || 10;
			const cost = duration * 0.001;

			return {
				modelId: "mmaudio_v2",
				jobId: parsed.jobId,
				videoUrl: parsed.videoUrl,
				audioUrl: parsed.audioUrl || undefined,
				duration,
				width: parsed.width,
				height: parsed.height,
				cost,
			};
		} catch (error) {
			debugError("MMAudio generation failed:", error);
			throw new Error(this.handleApiError(error));
		}
	}

	/**
	 * Upscale video using Topaz
	 */
	async upscaleTopaz(params: TopazUpscaleParams): Promise<VideoEditResult> {
		await this.ensureInitialized();

		debugLog("Upscaling with Topaz:", {
			hasVideo: !!params.video_url,
			factor: params.upscale_factor,
			targetFps: params.target_fps,
		});

		try {
			const model = VIDEO_EDIT_MODELS.find((m) => m.id === "topaz_upscale");
			if (!model) throw new Error("Model configuration not found");

			const result = await this.makeFalRequest<FalDirectResult>(
				model.endpoints.process,
				{
					video_url: params.video_url,
					upscale_factor: params.upscale_factor || 2.0,
					target_fps: params.target_fps,
					H264_output: params.H264_output || false,
				}
			);

			const parsed = this.parseResponse(result);

			if (!parsed.videoUrl) {
				throw new Error("No video URL in response");
			}

			const factor = params.upscale_factor || 2.0;
			const cost = factor <= 2 ? 0.5 : factor <= 4 ? 2.0 : 5.0;

			return {
				modelId: "topaz_upscale",
				jobId: parsed.jobId,
				videoUrl: parsed.videoUrl,
				duration: parsed.duration,
				fileSize: parsed.fileSize,
				width: parsed.width,
				height: parsed.height,
				cost,
			};
		} catch (error) {
			debugError("Topaz upscale failed:", error);
			throw new Error(this.handleApiError(error));
		}
	}
}

// Lazy singleton to avoid module initialization issues
let _videoEditClientInstance: VideoEditClient | null = null;

function getVideoEditClientInstance(): VideoEditClient {
	if (!_videoEditClientInstance) {
		_videoEditClientInstance = new VideoEditClient();
	}
	return _videoEditClientInstance;
}

// Export a proxy that lazily creates the instance on first access
export const videoEditClient: VideoEditClient = new Proxy(
	{} as VideoEditClient,
	{
		get(_target, prop) {
			const instance = getVideoEditClientInstance();
			const value = (instance as unknown as Record<string | symbol, unknown>)[
				prop
			];
			if (typeof value === "function") {
				return (value as (...args: unknown[]) => unknown).bind(instance);
			}
			return value;
		},
		set(_target, prop, value) {
			const instance = getVideoEditClientInstance();
			(instance as unknown as Record<string | symbol, unknown>)[prop] = value;
			return true;
		},
	}
);

// Export types for convenience
export type { VideoEditClient };
