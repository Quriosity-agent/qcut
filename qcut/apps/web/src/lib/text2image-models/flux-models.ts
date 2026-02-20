import type { Text2ImageModel } from "./types";

export const FLUX_MODELS: Record<string, Text2ImageModel> = {
	"flux-pro-v11-ultra": {
		id: "flux-pro-v11-ultra",
		name: "FLUX Pro v1.1 Ultra",
		description:
			"Latest FLUX model with enhanced detail and professional versatility",
		provider: "Black Forest Labs",
		endpoint: "https://fal.run/fal-ai/flux-pro/v1.1-ultra",

		qualityRating: 4,
		speedRating: 4,

		estimatedCost: "$0.05-0.09",
		costPerImage: 7, // cents

		maxResolution: "2048x2048",
		supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"],

		defaultParams: {
			aspect_ratio: "16:9",
			num_images: 1,
			safety_tolerance: "2",
			enable_safety_checker: true,
		},

		availableParams: [
			{
				name: "aspect_ratio",
				type: "select",
				options: [
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
				default: "16:9",
				description: "Output image aspect ratio",
			},
			{
				name: "num_images",
				type: "number",
				min: 1,
				max: 4,
				default: 1,
				description: "Number of images to generate",
			},
			{
				name: "safety_tolerance",
				type: "select",
				options: ["1", "2", "3", "4", "5", "6"],
				default: "2",
				description: "Safety filtering tolerance (1=strict, 6=permissive)",
			},
			{
				name: "enable_safety_checker",
				type: "boolean",
				default: true,
				description: "Enable content safety filtering",
			},
		],

		bestFor: [
			"Professional content creation",
			"Versatile image generation",
			"Balanced realism and creativity",
			"Commercial applications",
			"High-resolution outputs",
		],

		strengths: [
			"Excellent balance of quality and speed",
			"Professional-grade output",
			"Versatile across many styles",
			"Good prompt understanding",
			"High maximum resolution",
		],

		limitations: [
			"Not as creative as SeedDream",
			"Not as photorealistic as Imagen4",
			"Mid-range pricing",
			"May require prompt engineering",
		],
	},

	"flux-2-flex": {
		id: "flux-2-flex",
		name: "FLUX 2 Flex",
		description:
			"Text-to-image with adjustable inference steps, guidance scale, and enhanced typography",
		provider: "Black Forest Labs",
		endpoint: "https://fal.run/fal-ai/flux-2-flex",

		qualityRating: 4,
		speedRating: 4,

		estimatedCost: "$0.06/MP",
		costPerImage: 6, // cents per megapixel

		maxResolution: "2048x2048",
		supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

		defaultParams: {
			image_size: "landscape_4_3",
			num_images: 1,
			guidance_scale: 3.5,
			num_inference_steps: 28,
			enable_prompt_expansion: true,
			safety_tolerance: "2",
			enable_safety_checker: true,
			output_format: "jpeg",
			sync_mode: false,
		},

		availableParams: [
			{
				name: "image_size",
				type: "select",
				options: [
					"square_hd",
					"square",
					"portrait_3_4",
					"portrait_9_16",
					"landscape_4_3",
					"landscape_16_9",
				],
				default: "landscape_4_3",
				description: "Output image size preset",
			},
			{
				name: "guidance_scale",
				type: "number",
				min: 1.5,
				max: 10,
				default: 3.5,
				description: "Controls adherence to prompt",
			},
			{
				name: "num_inference_steps",
				type: "number",
				min: 2,
				max: 50,
				default: 28,
				description: "Number of denoising steps",
			},
			{
				name: "enable_prompt_expansion",
				type: "boolean",
				default: true,
				description: "Auto-expand prompt using model knowledge",
			},
			{
				name: "output_format",
				type: "select",
				options: ["jpeg", "png"],
				default: "jpeg",
				description: "Output image format",
			},
		],

		bestFor: [
			"Fine-tuned control over generation",
			"Typography and text rendering",
			"Professional content creation",
		],

		strengths: [
			"Adjustable inference steps for quality/speed tradeoff",
			"Enhanced typography capabilities",
			"Cost-effective per megapixel pricing",
		],

		limitations: [
			"Pricing scales with resolution",
			"Limited aspect ratio options vs FLUX Pro Ultra",
		],
	},
};
