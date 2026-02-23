/**
 * Prompt generation model definitions
 * @module electron/native-pipeline/registry-data/prompt-generation
 */

import { ModelRegistry } from "../registry.js";

export function registerPromptGenerationModels(): void {
	ModelRegistry.register({
		key: "openrouter_video_prompt",
		name: "OpenRouter Video Prompt",
		provider: "OpenRouter",
		endpoint: "openrouter/video-prompt",
		categories: ["prompt_generation"],
		description: "General video prompt generation",
		pricing: { per_request: 0.002 },
		defaults: {},
		features: ["prompt_generation", "general"],
		costEstimate: 0.002,
		processingTime: 4,
	});

	ModelRegistry.register({
		key: "openrouter_video_cinematic",
		name: "OpenRouter Video Cinematic",
		provider: "OpenRouter",
		endpoint: "openrouter/video-cinematic",
		categories: ["prompt_generation"],
		description: "Cinematic style video prompt generation",
		pricing: { per_request: 0.002 },
		defaults: {},
		features: ["prompt_generation", "cinematic"],
		costEstimate: 0.002,
		processingTime: 5,
	});

	ModelRegistry.register({
		key: "openrouter_video_realistic",
		name: "OpenRouter Video Realistic",
		provider: "OpenRouter",
		endpoint: "openrouter/video-realistic",
		categories: ["prompt_generation"],
		description: "Realistic style video prompt generation",
		pricing: { per_request: 0.002 },
		defaults: {},
		features: ["prompt_generation", "realistic"],
		costEstimate: 0.002,
		processingTime: 4,
	});

	ModelRegistry.register({
		key: "openrouter_video_artistic",
		name: "OpenRouter Video Artistic",
		provider: "OpenRouter",
		endpoint: "openrouter/video-artistic",
		categories: ["prompt_generation"],
		description: "Artistic style video prompt generation",
		pricing: { per_request: 0.002 },
		defaults: {},
		features: ["prompt_generation", "artistic"],
		costEstimate: 0.002,
		processingTime: 5,
	});

	ModelRegistry.register({
		key: "openrouter_video_dramatic",
		name: "OpenRouter Video Dramatic",
		provider: "OpenRouter",
		endpoint: "openrouter/video-dramatic",
		categories: ["prompt_generation"],
		description: "Dramatic style video prompt generation",
		pricing: { per_request: 0.002 },
		defaults: {},
		features: ["prompt_generation", "dramatic"],
		costEstimate: 0.002,
		processingTime: 5,
	});
}
