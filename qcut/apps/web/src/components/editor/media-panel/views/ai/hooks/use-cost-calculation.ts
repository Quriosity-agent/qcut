import { useMemo } from "react";
import {
	AI_MODELS,
	LTXV2_FAST_CONFIG,
	REVE_TEXT_TO_IMAGE_MODEL,
} from "../constants/ai-constants";
import {
	calculateByteDanceUpscaleCost,
	calculateFlashVSRUpscaleCost,
} from "../utils/ai-cost-calculators";

interface CostCalculationInput {
	selectedModels: string[];
	reveNumImages: number;
	// Generation state (Sora2 / Veo3.1)
	generationDuration: number;
	generationResolution: string;
	veo31Duration: string;
	veo31GenerateAudio: boolean;
	// Text tab
	hailuoT2VDuration: number;
	ltxv2FastDuration: number;
	ltxv2FastResolution: string;
	// Image tab
	ltxv2ImageDuration: number;
	ltxv2ImageResolution: string;
	// Upscale tab
	bytedanceTargetResolution: string;
	bytedanceTargetFPS: string;
	flashvsrUpscaleFactor: number;
	videoMetadata: {
		duration?: number;
		width: number;
		height: number;
		frames?: number;
		fps?: number;
	} | null;
}

interface CostCalculationResult {
	totalCost: number;
	bytedanceEstimatedCost: string;
	flashvsrEstimatedCost: string;
	hasRemixSelected: boolean;
}

export function useCostCalculation(
	input: CostCalculationInput
): CostCalculationResult {
	const videoDurationSeconds = input.videoMetadata?.duration ?? 10;

	const bytedanceEstimatedCost = useMemo(
		() =>
			calculateByteDanceUpscaleCost(
				input.bytedanceTargetResolution,
				input.bytedanceTargetFPS,
				videoDurationSeconds
			),
		[
			input.bytedanceTargetResolution,
			input.bytedanceTargetFPS,
			videoDurationSeconds,
		]
	);

	const flashvsrEstimatedCost = useMemo(() => {
		if (!input.videoMetadata) return "$0.000";
		const { width, height, frames, duration, fps } = input.videoMetadata;
		const frameCount =
			frames ?? Math.max(1, Math.round((duration ?? 0) * (fps ?? 30)));

		return calculateFlashVSRUpscaleCost(
			width,
			height,
			frameCount,
			input.flashvsrUpscaleFactor
		);
	}, [input.videoMetadata, input.flashvsrUpscaleFactor]);

	const totalCost = input.selectedModels.reduce((total, modelId) => {
		const model = AI_MODELS.find((m) => m.id === modelId);
		let modelCost = model ? Number.parseFloat(model.price) : 0;

		// Adjust for Sora 2 duration and resolution
		if (modelId.startsWith("sora2_")) {
			if (modelId === "sora2_video_to_video_remix") {
				modelCost = 0;
			} else if (
				modelId === "sora2_text_to_video_pro" ||
				modelId === "sora2_image_to_video_pro"
			) {
				if (input.generationResolution === "1080p") {
					modelCost = input.generationDuration * 0.5;
				} else if (input.generationResolution === "720p") {
					modelCost = input.generationDuration * 0.3;
				} else {
					modelCost = input.generationDuration * 0.3;
				}
			} else {
				modelCost = input.generationDuration * 0.1;
			}
		} else if (modelId.startsWith("veo31_")) {
			const durationSeconds = Number.parseInt(input.veo31Duration, 10);
			const isFastModel = modelId.includes("_fast_");
			const pricePerSecond = isFastModel
				? input.veo31GenerateAudio
					? 0.15
					: 0.1
				: input.veo31GenerateAudio
					? 0.4
					: 0.2;
			modelCost = durationSeconds * pricePerSecond;
		} else if (modelId === "reve-text-to-image") {
			modelCost =
				REVE_TEXT_TO_IMAGE_MODEL.pricing.perImage * input.reveNumImages;
		} else if (modelId === "hailuo23_standard_t2v") {
			modelCost = input.hailuoT2VDuration === 10 ? 0.56 : 0.28;
		} else if (modelId === "ltxv2_fast_i2v") {
			const key =
				input.ltxv2ImageResolution as keyof typeof LTXV2_FAST_CONFIG.PRICING;
			const pricePerSecond = LTXV2_FAST_CONFIG.PRICING[key] ?? 0;
			modelCost = input.ltxv2ImageDuration * pricePerSecond;
		} else if (modelId === "ltxv2_fast_t2v") {
			const key =
				input.ltxv2FastResolution as keyof typeof LTXV2_FAST_CONFIG.PRICING;
			const pricePerSecond = LTXV2_FAST_CONFIG.PRICING[key] ?? 0;
			modelCost = input.ltxv2FastDuration * pricePerSecond;
		}

		return total + modelCost;
	}, 0);

	const hasRemixSelected = input.selectedModels.includes(
		"sora2_video_to_video_remix"
	);

	return {
		totalCost,
		bytedanceEstimatedCost,
		flashvsrEstimatedCost,
		hasRemixSelected,
	};
}
