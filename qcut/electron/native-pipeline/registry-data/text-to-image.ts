/**
 * Text-to-image model definitions
 * @module electron/native-pipeline/registry-data/text-to-image
 */

import { ModelRegistry } from "../registry.js";

export function registerTextToImageModels(): void {
	ModelRegistry.register({
		key: "flux_dev",
		name: "FLUX.1 Dev",
		provider: "Black Forest Labs",
		endpoint: "fal-ai/flux/dev",
		categories: ["text_to_image"],
		description: "Highest quality 12B parameter text-to-image model",
		pricing: { per_image: 0.003 },
		aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
		defaults: { aspect_ratio: "16:9", style: "cinematic" },
		features: ["high_quality", "12B_parameters"],
		costEstimate: 0.003,
		processingTime: 15,
	});

	ModelRegistry.register({
		key: "flux_schnell",
		name: "FLUX.1 Schnell",
		provider: "Black Forest Labs",
		endpoint: "fal-ai/flux/schnell",
		categories: ["text_to_image"],
		description: "Fastest inference speed text-to-image model",
		pricing: { per_image: 0.001 },
		aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
		defaults: { aspect_ratio: "16:9" },
		features: ["fast_inference", "cost_effective"],
		costEstimate: 0.001,
		processingTime: 5,
	});

	ModelRegistry.register({
		key: "imagen4",
		name: "Google Imagen 4",
		provider: "Google (via FAL)",
		endpoint: "fal-ai/imagen4/preview",
		categories: ["text_to_image"],
		description: "Google's photorealistic text-to-image model",
		pricing: { per_image: 0.004 },
		aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
		defaults: { aspect_ratio: "16:9" },
		features: ["photorealistic", "high_quality"],
		costEstimate: 0.004,
		processingTime: 20,
	});

	ModelRegistry.register({
		key: "seedream_v3",
		name: "Seedream v3",
		provider: "ByteDance",
		endpoint: "fal-ai/seedream-3",
		categories: ["text_to_image"],
		description: "Multilingual text-to-image model",
		pricing: { per_image: 0.002 },
		aspectRatios: ["1:1", "16:9", "9:16"],
		defaults: { aspect_ratio: "16:9" },
		features: ["multilingual", "cost_effective"],
		costEstimate: 0.002,
		processingTime: 10,
	});

	ModelRegistry.register({
		key: "seedream3",
		name: "Seedream-3",
		provider: "ByteDance (via Replicate)",
		endpoint: "replicate/seedream-3",
		categories: ["text_to_image"],
		description: "High-resolution text-to-image model",
		pricing: { per_image: 0.003 },
		aspectRatios: ["1:1", "16:9", "9:16"],
		defaults: { aspect_ratio: "16:9" },
		features: ["high_resolution"],
		costEstimate: 0.003,
		processingTime: 15,
	});

	ModelRegistry.register({
		key: "gen4",
		name: "Runway Gen-4",
		provider: "Runway (via Replicate)",
		endpoint: "replicate/gen4",
		categories: ["text_to_image"],
		description: "Multi-reference guided image generation",
		pricing: { per_image: 0.08 },
		aspectRatios: ["1:1", "16:9", "9:16"],
		defaults: { aspect_ratio: "16:9" },
		features: ["reference_guided", "cinematic"],
		costEstimate: 0.08,
		processingTime: 20,
	});

	ModelRegistry.register({
		key: "nano_banana_pro",
		name: "Nano Banana Pro",
		provider: "FAL AI",
		endpoint: "fal-ai/nano-banana-pro",
		categories: ["text_to_image"],
		description: "Fast, high-quality text-to-image generation",
		pricing: { per_image: 0.002 },
		aspectRatios: ["1:1", "16:9", "9:16"],
		defaults: { aspect_ratio: "16:9" },
		features: ["fast_processing", "high_quality"],
		costEstimate: 0.002,
		processingTime: 5,
	});

	ModelRegistry.register({
		key: "gpt_image_1_5",
		name: "GPT Image 1.5",
		provider: "OpenAI (via FAL)",
		endpoint: "fal-ai/gpt-image-1.5",
		categories: ["text_to_image"],
		description: "GPT-powered image generation",
		pricing: { per_image: 0.003 },
		aspectRatios: ["1:1", "16:9", "9:16"],
		defaults: { aspect_ratio: "16:9" },
		features: ["gpt_powered", "natural_language"],
		costEstimate: 0.003,
		processingTime: 10,
	});
}
