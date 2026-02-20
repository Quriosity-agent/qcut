/**
 * Text-to-Video Model Configuration
 * Defines text-to-video models and their capabilities.
 */

import type { AIModel } from "../types/ai-types";
import {
	validateAliasMapTargetsExist,
	validateModelOrderInvariant,
} from "./model-config-validation";

/**
 * Text-to-video model definitions.
 *
 * Models that generate videos from text prompts, including:
 * - Multiple quality tiers (standard, pro, turbo)
 * - Various resolutions (480p to 4K)
 * - Different duration options (2-20 seconds)
 * - Advanced features (audio generation, negative prompts, etc.)
 *
 * Single source of truth for all T2V model configurations.
 */
export const T2V_MODELS = {
	sora2_text_to_video: {
		id: "sora2_text_to_video",
		name: "Sora 2 Text-to-Video",
		description: "OpenAI's state-of-the-art text-to-video generation (720p)",
		price: "0.10/s",
		resolution: "720p",
		max_duration: 12,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/sora-2/text-to-video",
		},
		default_params: {
			duration: 4,
			resolution: "720p",
			aspect_ratio: "16:9",
		},
	},
	sora2_text_to_video_pro: {
		id: "sora2_text_to_video_pro",
		name: "Sora 2 Text-to-Video Pro",
		badge: "⭐ Recommended",
		description: "High-quality text-to-video with 1080p support",
		price: "0.30-0.50",
		resolution: "720p / 1080p",
		supportedResolutions: ["720p", "1080p"],
		max_duration: 12,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/sora-2/text-to-video/pro",
		},
		default_params: {
			duration: 4,
			resolution: "1080p",
			aspect_ratio: "16:9",
		},
	},
	kling_v3_pro_t2v: {
		id: "kling_v3_pro_t2v",
		name: "Kling v3 Pro T2V",
		description:
			"Top-tier text-to-video with cinematic visuals, fluid motion, and native audio generation with multi-shot support",
		price: "0.336",
		resolution: "1080p",
		max_duration: 15,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/kling-video/v3/pro/text-to-video",
		},
		default_params: {
			duration: 5,
			aspect_ratio: "16:9",
			generate_audio: true,
		},
		supportedDurations: [5, 10, 15],
		supportedAspectRatios: ["16:9", "9:16", "1:1"],
	},
	kling_v3_standard_t2v: {
		id: "kling_v3_standard_t2v",
		name: "Kling v3 Standard T2V",
		badge: "🎬 Cinematic",
		description:
			"High-quality text-to-video with cinematic visuals and native audio generation, cost-effective option",
		price: "0.252",
		resolution: "1080p",
		max_duration: 15,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/kling-video/v3/standard/text-to-video",
		},
		default_params: {
			duration: 5,
			aspect_ratio: "16:9",
			generate_audio: true,
		},
		supportedDurations: [3, 5, 10, 15],
		supportedAspectRatios: ["16:9", "9:16", "1:1"],
	},
	kling_v26_pro_t2v: {
		id: "kling_v26_pro_t2v",
		name: "Kling v2.6 Pro T2V",
		description:
			"Top-tier text-to-video with cinematic visuals and native audio generation",
		price: "0.70",
		resolution: "1080p",
		max_duration: 10,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/kling-video/v2.6/pro/text-to-video",
		},
		default_params: {
			duration: 5,
			aspect_ratio: "16:9",
			cfg_scale: 0.5,
			generate_audio: true,
			negative_prompt: "blur, distort, and low quality",
		},
		supportedDurations: [5, 10],
		supportedAspectRatios: ["16:9", "9:16", "1:1"],
	},
	wan_26_t2v: {
		id: "wan_26_t2v",
		name: "WAN v2.6 T2V",
		badge: "💰 Budget",
		description:
			"Latest WAN model with 15s duration, multi-shot support, and audio sync",
		price: "0.75",
		resolution: "720p / 1080p",
		max_duration: 15,
		category: "text",
		endpoints: {
			text_to_video: "wan/v2.6/text-to-video",
		},
		default_params: {
			duration: 5,
			resolution: "1080p",
			aspect_ratio: "16:9",
			enable_prompt_expansion: true,
			multi_shots: false,
		},
		supportedResolutions: ["720p", "1080p"],
		supportedDurations: [5, 10, 15],
		supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
		perSecondPricing: {
			"720p": 0.1,
			"1080p": 0.15,
		},
	},
	ltxv2_pro_t2v: {
		id: "ltxv2_pro_t2v",
		name: "LTX Video 2.0 Pro T2V",
		description: "Text-to-video with audio generation (6-10s, up to 4K)",
		price: "0.06",
		resolution: "1080p",
		max_duration: 10,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/ltxv-2/text-to-video",
		},
		default_params: {
			duration: 6,
			resolution: "1080p",
			aspect_ratio: "16:9",
			fps: 25,
			generate_audio: true,
		},
		supportedResolutions: ["1080p", "1440p", "2160p"],
	},
	ltxv2_fast_t2v: {
		id: "ltxv2_fast_t2v",
		name: "LTX Video 2.0 Fast T2V",
		badge: "⚡ Fast",
		description: "Text-to-video with audio generation (6-20s, up to 4K)",
		price: "0.04-0.16",
		resolution: "1080p",
		max_duration: 20,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/ltxv-2/text-to-video/fast",
		},
		default_params: {
			duration: 6,
			resolution: "1080p",
			aspect_ratio: "16:9",
			fps: 25,
			generate_audio: true,
		},
		supportedResolutions: ["1080p", "1440p", "2160p"],
		supportedDurations: [6, 8, 10, 12, 14, 16, 18, 20],
	},
	veo31_fast_text_to_video: {
		id: "veo31_fast_text_to_video",
		name: "Veo 3.1 Fast Text-to-Video",
		description:
			"Google's Veo 3.1 Fast - Generate videos from text prompts (faster, budget-friendly)",
		price: "1.20",
		resolution: "720p / 1080p",
		supportedResolutions: ["720p", "1080p"],
		max_duration: 8,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/veo3.1/fast",
		},
		default_params: {
			duration: 8,
			resolution: "720p",
			aspect_ratio: "16:9",
			generate_audio: true,
			enhance_prompt: true,
			auto_fix: true,
		},
	},
	veo31_text_to_video: {
		id: "veo31_text_to_video",
		name: "Veo 3.1 Text-to-Video",
		description:
			"Google's Veo 3.1 - Premium quality video generation from text prompts",
		price: "3.20",
		resolution: "720p / 1080p",
		supportedResolutions: ["720p", "1080p"],
		max_duration: 8,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/veo3.1",
		},
		default_params: {
			duration: 8,
			resolution: "720p",
			aspect_ratio: "16:9",
			generate_audio: true,
			enhance_prompt: true,
			auto_fix: true,
		},
	},
	hailuo23_standard_t2v: {
		id: "hailuo23_standard_t2v",
		name: "Hailuo 2.3 Standard T2V",
		description: "Budget-friendly text-to-video with 768p quality",
		price: "0.28-0.56",
		resolution: "768p",
		max_duration: 10,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/minimax/hailuo-2.3/standard/text-to-video",
		},
		default_params: {
			duration: 6,
			resolution: "768p",
			prompt_optimizer: true,
		},
	},
	hailuo23_pro_t2v: {
		id: "hailuo23_pro_t2v",
		name: "Hailuo 2.3 Pro T2V",
		description:
			"Premium 1080p text-to-video with cinematic camera control (use [Pan left], [Zoom in] in prompts)",
		price: "0.49",
		resolution: "1080p",
		max_duration: 10,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/minimax/hailuo-2.3/pro/text-to-video",
		},
		default_params: {
			duration: 6,
			resolution: "1080p",
			prompt_optimizer: true,
		},
	},
	seedance: {
		id: "seedance",
		name: "Seedance v1 Lite",
		description: "Fast and efficient text-to-video generation",
		price: "0.18",
		resolution: "720p",
		max_duration: 10,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/bytedance/seedance/v1/lite/text-to-video",
		},
		default_params: {
			duration: 5,
			resolution: "720p",
		},
	},
	seedance_pro: {
		id: "seedance_pro",
		name: "Seedance v1 Pro",
		description: "High quality 1080p video generation",
		price: "0.62",
		resolution: "1080p",
		max_duration: 10,
		endpoints: {
			text_to_video: "fal-ai/bytedance/seedance/v1/pro/text-to-video",
		},
		default_params: {
			duration: 5,
			resolution: "1080p",
		},
	},
	wan_25_preview: {
		id: "wan_25_preview",
		name: "WAN v2.5 Preview",
		description: "Next-generation WAN model with improved quality",
		price: "0.12",
		resolution: "1080p",
		max_duration: 10,
		endpoints: {
			text_to_video: "wan-25-preview/text-to-video",
			image_to_video: "wan-25-preview/image-to-video",
		},
		default_params: {
			duration: 5,
			resolution: "1080p",
			quality: "high",
			style_preset: "cinematic",
		},
	},
	kling_v2_5_turbo: {
		id: "kling_v2_5_turbo",
		name: "Kling v2.5 Turbo Pro",
		description: "Latest Kling model with enhanced turbo performance",
		price: "0.18",
		resolution: "1080p",
		max_duration: 10,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
			image_to_video: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
		},
		default_params: {
			duration: 5,
			resolution: "1080p",
			cfg_scale: 0.5,
			aspect_ratio: "16:9",
			enhance_prompt: true,
		},
	},
	kling_v2_5_turbo_standard: {
		id: "kling_v2_5_turbo_standard",
		name: "Kling v2.5 Turbo Standard",
		description: "Standard Kling model for efficient text-to-video",
		price: "0.10",
		resolution: "720p",
		max_duration: 10,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/kling-video/v2.5-turbo/standard/text-to-video",
		},
		default_params: {
			duration: 5,
			resolution: "720p",
			aspect_ratio: "16:9",
		},
	},
	vidu_q3_t2v: {
		id: "vidu_q3_t2v",
		name: "Vidu Q3 Text-to-Video",
		description:
			"High-quality text-to-video with audio generation and multi-resolution support",
		price: "0.07-0.154/s",
		resolution: "720p",
		max_duration: 16,
		category: "text",
		endpoints: {
			text_to_video: "fal-ai/vidu/q3/text-to-video",
		},
		default_params: {
			duration: 5,
			resolution: "720p",
			aspect_ratio: "16:9",
		},
		supportedResolutions: ["360p", "540p", "720p", "1080p"],
		supportedDurations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
		supportedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
		perSecondPricing: {
			"360p": 0.07,
			"540p": 0.07,
			"720p": 0.154,
			"1080p": 0.154,
		},
	},
} as const satisfies Record<string, AIModel>;

/**
 * Text-to-Video model identifier type derived from T2V_MODELS keys.
 * Ensures type safety when referencing T2V models throughout the application.
 */
export type T2VModelId = keyof typeof T2V_MODELS;

/**
 * Priority order for displaying T2V models in the UI.
 * Models are ordered by quality/capability (highest first) to guide user selection.
 */
export const T2V_MODEL_ORDER: readonly T2VModelId[] = [
	// Badged picks — always on top
	"sora2_text_to_video_pro", // ⭐ Recommended
	"ltxv2_fast_t2v", // ⚡ Fast
	"wan_26_t2v", // 💰 Budget
	"kling_v3_standard_t2v", // 🎬 Cinematic
	// Everything else
	"kling_v3_pro_t2v",
	"kling_v26_pro_t2v",
	"veo31_text_to_video",
	"ltxv2_pro_t2v",
	"hailuo23_pro_t2v",
	"veo31_fast_text_to_video",
	"seedance_pro",
	"sora2_text_to_video",
	"hailuo23_standard_t2v",
	"kling_v2_5_turbo",
	"kling_v2_5_turbo_standard",
	"seedance",
	"vidu_q3_t2v",
	"wan_25_preview",
] as const;

/**
 * Maps legacy/alternative AI model IDs to canonical T2VModelIds.
 *
 * Maintains backward compatibility by ensuring models with varying IDs
 * across different parts of the codebase still resolve to the correct
 * capability definitions when computing combined settings.
 */
export const T2V_MODEL_ID_ALIASES: Record<string, T2VModelId> = {
	// Short aliases for convenience
	veo31_fast: "veo31_fast_text_to_video",
	veo31: "veo31_text_to_video",
	hailuo_v2: "hailuo23_standard_t2v",
	hailuo: "hailuo23_standard_t2v",
	hailuo_pro: "hailuo23_pro_t2v",
	seedance_t2v: "seedance",
	seedance_pro: "seedance_pro",
	kling1_6_pro: "kling_v2_5_turbo",
	kling_v2: "kling_v2_5_turbo",
	kling1_6_standard: "kling_v2_5_turbo_standard",
	kling_v26_pro: "kling_v26_pro_t2v",
};

validateModelOrderInvariant({
	category: "T2V",
	models: T2V_MODELS,
	order: T2V_MODEL_ORDER,
});

validateAliasMapTargetsExist({
	category: "T2V",
	models: T2V_MODELS,
	aliases: T2V_MODEL_ID_ALIASES,
});

/**
 * Defines the capabilities and supported parameters for a text-to-video model.
 * Used to dynamically show/hide UI controls and validate user input.
 */
export interface T2VModelCapabilities {
	supportsAspectRatio: boolean;
	supportedAspectRatios?: string[];
	supportsResolution: boolean;
	supportedResolutions?: string[];
	supportsDuration: boolean;
	supportedDurations?: number[];
	supportsNegativePrompt: boolean;
	supportsPromptExpansion: boolean;
	supportsSeed: boolean;
	supportsSafetyChecker: boolean;
	defaultAspectRatio?: string;
	defaultResolution?: string;
	defaultDuration?: number;
}

/**
 * Complete capability definitions for all text-to-video models.
 * Maps each T2V model ID to its supported features and parameter ranges.
 */
export const T2V_MODEL_CAPABILITIES: Record<T2VModelId, T2VModelCapabilities> =
	{
		sora2_text_to_video: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
			supportsResolution: true,
			supportedResolutions: ["720p", "1080p"],
			supportsDuration: true,
			supportedDurations: [4, 8, 12],
			supportsNegativePrompt: true,
			supportsPromptExpansion: true,
			supportsSeed: true,
			supportsSafetyChecker: true,
			defaultAspectRatio: "16:9",
			defaultResolution: "720p",
			defaultDuration: 4,
		},

		sora2_text_to_video_pro: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
			supportsResolution: true,
			supportedResolutions: ["720p", "1080p"],
			supportsDuration: true,
			supportedDurations: [2, 3, 4, 5, 6, 8, 10],
			supportsNegativePrompt: true,
			supportsPromptExpansion: true,
			supportsSeed: true,
			supportsSafetyChecker: true,
			defaultAspectRatio: "16:9",
			defaultResolution: "1080p",
			defaultDuration: 5,
		},

		wan_25_preview: {
			supportsAspectRatio: false,
			supportsResolution: true,
			supportedResolutions: ["480p", "720p", "1080p"], // FAL Wan v2.5 supports 480p, 720p, 1080p
			supportsDuration: true,
			supportedDurations: [5, 10],
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: true,
			supportsSafetyChecker: true,
			defaultResolution: "1080p",
			defaultDuration: 5,
		},

		wan_26_t2v: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
			supportsResolution: true,
			supportedResolutions: ["720p", "1080p"], // T2V doesn't support 480p
			supportsDuration: true,
			supportedDurations: [5, 10, 15],
			supportsNegativePrompt: true,
			supportsPromptExpansion: true,
			supportsSeed: true,
			supportsSafetyChecker: true,
			defaultAspectRatio: "16:9",
			defaultResolution: "1080p",
			defaultDuration: 5,
		},

		ltxv2_pro_t2v: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9"], // FAL LTX Video 2.0 Pro supports only 16:9
			supportsResolution: true,
			supportedResolutions: ["1080p", "1440p", "2160p"],
			supportsDuration: true,
			supportedDurations: [2, 3, 4, 5, 6, 8, 10],
			supportsNegativePrompt: true,
			supportsPromptExpansion: false,
			supportsSeed: true,
			supportsSafetyChecker: false,
			defaultAspectRatio: "16:9",
			defaultResolution: "1080p",
			defaultDuration: 6,
		},

		ltxv2_fast_t2v: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9"], // FAL LTX Video 2.0 Fast supports only 16:9
			supportsResolution: true,
			supportedResolutions: ["1080p", "1440p", "2160p"],
			supportsDuration: true,
			supportedDurations: [2, 3, 4, 5, 6, 8, 10],
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: true,
			supportsSafetyChecker: false,
			defaultAspectRatio: "16:9",
			defaultResolution: "1080p",
			defaultDuration: 6,
		},

		veo31_fast_text_to_video: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1"], // FAL Veo 3.1 supports 16:9, 9:16, and 1:1 (outpainting)
			supportsResolution: true,
			supportedResolutions: ["720p", "1080p"],
			supportsDuration: true,
			supportedDurations: [5, 6, 8], // Veo 3.1 supports 5-8s
			supportsNegativePrompt: true,
			supportsPromptExpansion: true,
			supportsSeed: true,
			supportsSafetyChecker: true,
			defaultAspectRatio: "16:9",
			defaultResolution: "720p",
			defaultDuration: 8,
		},

		veo31_text_to_video: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1"], // FAL Veo 3.1 supports 16:9, 9:16, and 1:1 (outpainting)
			supportsResolution: true,
			supportedResolutions: ["720p", "1080p"],
			supportsDuration: true,
			supportedDurations: [5, 6, 8], // Veo 3.1 supports 5-8s
			supportsNegativePrompt: true,
			supportsPromptExpansion: true,
			supportsSeed: true,
			supportsSafetyChecker: true,
			defaultAspectRatio: "16:9",
			defaultResolution: "1080p",
			defaultDuration: 8,
		},

		hailuo23_standard_t2v: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
			supportsResolution: true,
			supportedResolutions: ["720p", "1080p"],
			supportsDuration: true,
			supportedDurations: [2, 3, 4, 5],
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: true,
			supportsSafetyChecker: false,
			defaultAspectRatio: "16:9",
			defaultResolution: "720p",
			defaultDuration: 5,
		},

		seedance: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
			supportsResolution: true,
			supportedResolutions: ["480p", "720p", "1080p"],
			supportsDuration: true,
			supportedDurations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: true,
			supportsSafetyChecker: false,
			defaultAspectRatio: "16:9",
			defaultResolution: "720p",
			defaultDuration: 5,
		},

		kling_v2_5_turbo: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
			supportsResolution: true,
			supportedResolutions: ["720p", "1080p"],
			supportsDuration: true,
			supportedDurations: [5, 10],
			supportsNegativePrompt: true,
			supportsPromptExpansion: false,
			supportsSeed: true,
			supportsSafetyChecker: false,
			defaultAspectRatio: "16:9",
			defaultResolution: "1080p",
			defaultDuration: 5,
		},

		kling_v2_5_turbo_standard: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
			supportsResolution: true,
			supportedResolutions: ["720p", "1080p"],
			supportsDuration: true,
			supportedDurations: [5, 10],
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: true,
			supportsSafetyChecker: false,
			defaultAspectRatio: "16:9",
			defaultResolution: "720p",
			defaultDuration: 5,
		},

		kling_v3_pro_t2v: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1"],
			supportsResolution: false,
			supportsDuration: true,
			supportedDurations: [5, 10, 15],
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: false,
			supportsSafetyChecker: false,
			defaultAspectRatio: "16:9",
			defaultDuration: 5,
		},

		kling_v3_standard_t2v: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1"],
			supportsResolution: false,
			supportsDuration: true,
			supportedDurations: [3, 5, 10, 15],
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: false,
			supportsSafetyChecker: false,
			defaultAspectRatio: "16:9",
			defaultDuration: 5,
		},

		kling_v26_pro_t2v: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1"],
			supportsResolution: false,
			supportsDuration: true,
			supportedDurations: [5, 10],
			supportsNegativePrompt: true,
			supportsPromptExpansion: false,
			supportsSeed: false,
			supportsSafetyChecker: false,
			defaultAspectRatio: "16:9",
			defaultDuration: 5,
		},

		seedance_pro: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
			supportsResolution: true,
			supportedResolutions: ["480p", "720p", "1080p"],
			supportsDuration: true,
			supportedDurations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: true,
			supportsSafetyChecker: false,
			defaultAspectRatio: "16:9",
			defaultResolution: "1080p",
			defaultDuration: 5,
		},

		hailuo23_pro_t2v: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
			supportsResolution: true,
			supportedResolutions: ["720p", "1080p"],
			supportsDuration: true,
			supportedDurations: [2, 3, 4, 5],
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: true,
			supportsSafetyChecker: false,
			defaultAspectRatio: "16:9",
			defaultResolution: "1080p",
			defaultDuration: 6,
		},

		vidu_q3_t2v: {
			supportsAspectRatio: true,
			supportedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
			supportsResolution: true,
			supportedResolutions: ["360p", "540p", "720p", "1080p"],
			supportsDuration: true,
			supportedDurations: [
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
			],
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: true,
			supportsSafetyChecker: false,
			defaultAspectRatio: "16:9",
			defaultResolution: "720p",
			defaultDuration: 5,
		},
	};

/**
 * Get combined (intersected) capabilities for selected models.
 */
export function getCombinedCapabilities(
	selectedModelIds: T2VModelId[]
): T2VModelCapabilities {
	if (selectedModelIds.length === 0) {
		return {
			supportsAspectRatio: false,
			supportsResolution: false,
			supportsDuration: false,
			supportsNegativePrompt: false,
			supportsPromptExpansion: false,
			supportsSeed: false,
			supportsSafetyChecker: false,
		};
	}

	const capabilities = selectedModelIds.map((id) => T2V_MODEL_CAPABILITIES[id]);

	return {
		supportsAspectRatio: capabilities.every((c) => c.supportsAspectRatio),
		supportedAspectRatios: getCommonAspectRatios(capabilities),
		supportsResolution: capabilities.every((c) => c.supportsResolution),
		supportedResolutions: getCommonResolutions(capabilities),
		supportsDuration: capabilities.every((c) => c.supportsDuration),
		supportedDurations: getCommonDurations(capabilities),
		supportsNegativePrompt: capabilities.every((c) => c.supportsNegativePrompt),
		supportsPromptExpansion: capabilities.every(
			(c) => c.supportsPromptExpansion
		),
		supportsSeed: capabilities.every((c) => c.supportsSeed),
		supportsSafetyChecker: capabilities.every((c) => c.supportsSafetyChecker),
	};
}

/**
 * Finds the intersection of supported aspect ratios across multiple models.
 * @param capabilities - Array of model capabilities to intersect
 * @returns Common aspect ratios supported by all models, or undefined if none
 */
function getCommonAspectRatios(
	capabilities: T2VModelCapabilities[]
): string[] | undefined {
	const allRatios = capabilities
		.filter((c) => c.supportsAspectRatio && c.supportedAspectRatios)
		.map((c) => c.supportedAspectRatios!);

	if (allRatios.length === 0) return;
	if (allRatios.length === 1) return allRatios[0];

	return allRatios.reduce((common, ratios) =>
		common.filter((r) => ratios.includes(r))
	);
}

/**
 * Finds the intersection of supported resolutions across multiple models.
 * @param capabilities - Array of model capabilities to intersect
 * @returns Common resolutions supported by all models, or undefined if none
 */
function getCommonResolutions(
	capabilities: T2VModelCapabilities[]
): string[] | undefined {
	const allResolutions = capabilities
		.filter((c) => c.supportsResolution && c.supportedResolutions)
		.map((c) => c.supportedResolutions!);

	if (allResolutions.length === 0) return;
	if (allResolutions.length === 1) return allResolutions[0];

	return allResolutions.reduce((common, resolutions) =>
		common.filter((r) => resolutions.includes(r))
	);
}

/**
 * Finds the intersection of supported durations across multiple models.
 * @param capabilities - Array of model capabilities to intersect
 * @returns Common durations (in seconds) supported by all models, or undefined if none
 */
function getCommonDurations(
	capabilities: T2VModelCapabilities[]
): number[] | undefined {
	const allDurations = capabilities
		.filter((c) => c.supportsDuration && c.supportedDurations)
		.map((c) => c.supportedDurations!);

	if (allDurations.length === 0) return;
	if (allDurations.length === 1) return allDurations[0];

	return allDurations.reduce((common, durations) =>
		common.filter((d) => durations.includes(d))
	);
}

/**
 * Get T2V models in priority order for UI rendering.
 */
export function getT2VModelsInOrder(): Array<[T2VModelId, AIModel]> {
	return T2V_MODEL_ORDER.map((id) => [id, T2V_MODELS[id]]);
}

/**
 * Normalize an AI model id to the canonical T2VModelId used by capability lookups.
 */
export function resolveT2VModelId(modelId: string): T2VModelId | undefined {
	if (modelId in T2V_MODEL_CAPABILITIES) {
		return modelId as T2VModelId;
	}

	return T2V_MODEL_ID_ALIASES[modelId];
}
