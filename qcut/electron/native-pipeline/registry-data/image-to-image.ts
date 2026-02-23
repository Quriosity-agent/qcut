/**
 * Image-to-image model definitions
 * @module electron/native-pipeline/registry-data/image-to-image
 */

import { ModelRegistry } from "../infra/registry.js";

export function registerImageToImageModels(): void {
	ModelRegistry.register({
		key: "photon",
		name: "Luma Photon Flash",
		provider: "Luma AI",
		endpoint: "fal-ai/luma-photon/flash/modify",
		categories: ["image_to_image"],
		description:
			"Creative, personalizable, and intelligent image modification model",
		pricing: { per_megapixel: 0.019 },
		aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21"],
		defaults: { strength: 0.8, aspect_ratio: "1:1" },
		features: [
			"Fast processing",
			"High-quality results",
			"Creative modifications",
			"Personalizable outputs",
			"Aspect ratio control",
		],
		costEstimate: 0.02,
		processingTime: 8,
	});

	ModelRegistry.register({
		key: "photon_base",
		name: "Luma Photon Base",
		provider: "Luma AI",
		endpoint: "fal-ai/luma-photon/modify",
		categories: ["image_to_image"],
		description:
			"Most creative, personalizable, and intelligent visual model for creatives",
		pricing: { per_megapixel: 0.019 },
		aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21"],
		defaults: { strength: 0.8, aspect_ratio: "1:1" },
		features: [
			"Step-function change in cost",
			"High-quality image generation",
			"Creative image editing",
			"Prompt-based modifications",
			"Commercial use ready",
		],
		costEstimate: 0.03,
		processingTime: 12,
	});

	ModelRegistry.register({
		key: "kontext",
		name: "FLUX Kontext Dev",
		provider: "Black Forest Labs",
		endpoint: "fal-ai/flux-kontext/dev",
		categories: ["image_to_image"],
		description:
			"Frontier image editing model focused on contextual understanding",
		pricing: { per_image: 0.025 },
		aspectRatios: ["auto"],
		defaults: {
			num_inference_steps: 28,
			guidance_scale: 2.5,
			resolution_mode: "auto",
		},
		features: [
			"Contextual understanding",
			"Nuanced modifications",
			"Style preservation",
			"Iterative editing",
			"Precise control",
		],
		costEstimate: 0.025,
		processingTime: 15,
	});

	ModelRegistry.register({
		key: "kontext_multi",
		name: "FLUX Kontext [max] Multi",
		provider: "Black Forest Labs",
		endpoint: "fal-ai/flux-pro/kontext/max/multi",
		categories: ["image_to_image"],
		description:
			"Experimental multi-image version of FLUX Kontext [max] with advanced capabilities",
		pricing: { per_image: 0.04 },
		aspectRatios: [
			"21:9",
			"16:9",
			"4:3",
			"3:2",
			"1:1",
			"2:3",
			"3:4",
			"9:16",
			"9:21",
		],
		defaults: {},
		features: [
			"Multi-image input support",
			"Advanced contextual understanding",
			"Experimental capabilities",
			"High-quality results",
			"Safety tolerance control",
			"Multiple output formats",
		],
		costEstimate: 0.04,
		processingTime: 25,
	});

	ModelRegistry.register({
		key: "seededit",
		name: "ByteDance SeedEdit v3",
		provider: "ByteDance",
		endpoint: "fal-ai/bytedance/seededit/v3/edit-image",
		categories: ["image_to_image"],
		description:
			"Accurate image editing model with excellent content preservation",
		pricing: { per_image: 0.02 },
		defaults: { guidance_scale: 0.5 },
		features: [
			"Accurate editing instruction following",
			"Effective content preservation",
			"Commercial use ready",
			"Simple parameter set",
			"High-quality results",
			"ByteDance developed",
		],
		costEstimate: 0.02,
		processingTime: 10,
	});

	ModelRegistry.register({
		key: "clarity",
		name: "Clarity Upscaler",
		provider: "FAL AI",
		endpoint: "fal-ai/clarity-upscaler",
		categories: ["image_to_image"],
		description:
			"High-quality image upscaling with optional creative enhancement",
		pricing: { per_image: 0.05 },
		defaults: { scale: 2, enable_enhancement: true },
		features: [
			"Up to 4x upscaling",
			"Optional creative enhancement",
			"Maintains image quality",
			"Fast processing",
			"Commercial use ready",
			"Prompt-based enhancement",
		],
		costEstimate: 0.05,
		processingTime: 30,
	});

	ModelRegistry.register({
		key: "nano_banana_pro_edit",
		name: "Nano Banana Pro Edit",
		provider: "FAL AI",
		endpoint: "fal-ai/nano-banana-pro/edit",
		categories: ["image_to_image"],
		description:
			"Multi-image editing and composition model with resolution control",
		pricing: { "1K_2K": 0.015, "4K": 0.03 },
		aspectRatios: [
			"auto",
			"21:9",
			"16:9",
			"3:2",
			"4:3",
			"5:4",
			"1:1",
			"4:5",
			"3:4",
			"2:3",
			"9:16",
		],
		resolutions: ["1K", "2K", "4K"],
		defaults: {
			aspect_ratio: "auto",
			resolution: "1K",
			output_format: "png",
			num_images: 1,
			sync_mode: true,
		},
		features: [
			"Multi-image input (up to 4)",
			"11 aspect ratio options",
			"Up to 4K resolution",
			"Optional web search enhancement",
			"Fast processing",
			"Commercial use ready",
		],
		costEstimate: 0.015,
		processingTime: 8,
	});

	ModelRegistry.register({
		key: "gpt_image_1_5_edit",
		name: "GPT Image 1.5 Edit",
		provider: "OpenAI (via FAL)",
		endpoint: "fal-ai/gpt-image-1.5/edit",
		categories: ["image_to_image"],
		description:
			"GPT-powered image editing with natural language understanding",
		pricing: { per_image: 0.02 },
		defaults: { strength: 0.75 },
		features: [
			"GPT-powered editing",
			"Natural language understanding",
			"High-quality results",
			"Creative modifications",
			"Commercial use ready",
		],
		costEstimate: 0.02,
		processingTime: 10,
	});
}
