/**
 * Video-to-video, audio, and upscale model definitions
 * @module electron/native-pipeline/registry-data/video-to-video
 */

import { ModelRegistry } from "../infra/registry.js";

export function registerVideoToVideoModels(): void {
	ModelRegistry.register({
		key: "thinksound",
		name: "ThinkSound",
		provider: "FAL AI",
		endpoint: "fal-ai/thinksound",
		categories: ["add_audio"],
		description:
			"AI-powered video audio generation that creates realistic sound effects",
		pricing: { per_second: 0.001 },
		defaults: { seed: null, prompt: null },
		features: [
			"Automatic sound effect generation",
			"Text prompt guidance",
			"Video context understanding",
			"High-quality audio synthesis",
			"Commercial use license",
		],
		maxDuration: 300,
		costEstimate: 0.05,
		processingTime: 45,
	});

	ModelRegistry.register({
		key: "topaz",
		name: "Topaz Video Upscale",
		provider: "Topaz Labs (via FAL)",
		endpoint: "fal-ai/topaz/upscale/video",
		categories: ["upscale_video"],
		description: "Professional-grade video upscaling with frame interpolation",
		pricing: { per_video: "commercial" },
		defaults: { upscale_factor: 2, target_fps: null },
		features: [
			"Up to 4x upscaling",
			"Frame rate enhancement up to 120 FPS",
			"Proteus v4 upscaling engine",
			"Apollo v8 frame interpolation",
			"Professional quality enhancement",
			"Commercial use license",
		],
		costEstimate: 1.5,
		processingTime: 120,
	});

	ModelRegistry.register({
		key: "kling_o3_standard_edit",
		name: "Kling O3 Standard Video Edit",
		provider: "Kuaishou",
		endpoint: "fal-ai/kling-video/o3/standard/video-to-video/edit",
		categories: ["video_to_video"],
		description:
			"O3 video editing with element replacement and @ reference syntax",
		pricing: { per_second: 0.252 },
		durationOptions: ["3", "5", "10", "15"],
		aspectRatios: ["16:9", "9:16", "1:1"],
		defaults: {
			duration: "5",
			elements: [],
			image_urls: [],
			aspect_ratio: "16:9",
		},
		features: [
			"Element-based object/character replacement",
			"Environment modification",
			"@ reference syntax",
			"Reference image integration",
		],
		maxDuration: 15,
		costEstimate: 1.26,
		processingTime: 60,
	});

	ModelRegistry.register({
		key: "kling_o3_pro_edit",
		name: "Kling O3 Pro Video Edit",
		provider: "Kuaishou",
		endpoint: "fal-ai/kling-video/o3/pro/video-to-video/edit",
		categories: ["video_to_video"],
		description:
			"Professional O3 video editing with enhanced quality and element replacement",
		pricing: { per_second: 0.336 },
		durationOptions: ["3", "5", "10", "15"],
		aspectRatios: ["16:9", "9:16", "1:1"],
		defaults: {
			duration: "5",
			elements: [],
			image_urls: [],
			aspect_ratio: "16:9",
		},
		features: [
			"Professional-tier quality",
			"Element-based object/character replacement",
			"Environment modification",
			"@ reference syntax",
			"Reference image integration",
		],
		maxDuration: 15,
		costEstimate: 1.68,
		processingTime: 60,
	});

	ModelRegistry.register({
		key: "kling_o3_standard_v2v_ref",
		name: "Kling O3 Standard V2V Reference",
		provider: "Kuaishou",
		endpoint: "fal-ai/kling-video/o3/standard/video-to-video/reference",
		categories: ["video_to_video"],
		description:
			"O3 video-to-video with style transfer and element consistency",
		pricing: { per_second: 0.252 },
		durationOptions: ["3", "5", "10", "15"],
		aspectRatios: ["16:9", "9:16", "1:1"],
		defaults: {
			duration: "5",
			elements: [],
			image_urls: [],
			aspect_ratio: "16:9",
			keep_audio: false,
		},
		features: [
			"Style transfer from reference images",
			"Element integration with consistency",
			"@ reference syntax",
			"Optional audio preservation",
		],
		maxDuration: 15,
		costEstimate: 1.26,
		processingTime: 60,
	});

	ModelRegistry.register({
		key: "kling_o3_pro_v2v_ref",
		name: "Kling O3 Pro V2V Reference",
		provider: "Kuaishou",
		endpoint: "fal-ai/kling-video/o3/pro/video-to-video/reference",
		categories: ["video_to_video"],
		description:
			"Professional O3 video-to-video with style transfer and enhanced quality",
		pricing: { per_second: 0.336 },
		durationOptions: ["3", "5", "10", "15"],
		aspectRatios: ["16:9", "9:16", "1:1"],
		defaults: {
			duration: "5",
			elements: [],
			image_urls: [],
			aspect_ratio: "16:9",
			keep_audio: false,
		},
		features: [
			"Professional-tier quality",
			"Style transfer from reference images",
			"Element integration with consistency",
			"@ reference syntax",
			"Optional audio preservation",
		],
		maxDuration: 15,
		costEstimate: 1.68,
		processingTime: 60,
	});
}
