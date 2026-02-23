/**
 * Cost Calculator & Model Listing
 *
 * Implements cost estimation and model listing that replaces
 * `aicp estimate-cost` and `aicp list-models` commands.
 *
 * @module electron/native-pipeline/cost-calculator
 */

import type { ModelCategory, ModelDefinition } from "../infra/registry.js";
import { ModelRegistry } from "../infra/registry.js";
import type { PipelineChain } from "../execution/executor.js";

export interface CostEstimate {
	model: string;
	baseCost: number;
	totalCost: number;
	breakdown: { item: string; cost: number }[];
	currency: "USD";
}

export function estimateCost(
	modelKey: string,
	params: Record<string, unknown> = {}
): CostEstimate {
	const model = ModelRegistry.get(modelKey);
	const breakdown: { item: string; cost: number }[] = [];
	let totalCost = model.costEstimate;

	const pricing = model.pricing;

	if (typeof pricing === "number") {
		breakdown.push({ item: "Base cost", cost: pricing });
		totalCost = pricing;
	} else if (typeof pricing === "object") {
		const pricingType = pricing.type as string | undefined;

		if (pricingType === "per_second") {
			const duration = parseDuration(
				params.duration ?? model.defaults.duration
			);
			const generateAudio =
				params.generate_audio ?? model.defaults.generate_audio;
			const voiceIds = params.voice_ids as unknown[] | undefined;
			const hasVoiceControl = voiceIds && voiceIds.length > 0;

			let costPerSecond: number;
			if (hasVoiceControl && typeof pricing.cost_voice_control === "number") {
				costPerSecond = pricing.cost_voice_control;
				breakdown.push({ item: "Voice control rate", cost: costPerSecond });
			} else if (generateAudio && typeof pricing.cost_with_audio === "number") {
				costPerSecond = pricing.cost_with_audio;
				breakdown.push({ item: "With audio rate", cost: costPerSecond });
			} else if (typeof pricing.cost_no_audio === "number") {
				costPerSecond = pricing.cost_no_audio;
				breakdown.push({ item: "Base rate", cost: costPerSecond });
			} else if (typeof pricing.cost === "number") {
				costPerSecond = pricing.cost;
				breakdown.push({ item: "Per second rate", cost: costPerSecond });
			} else {
				costPerSecond = 0;
			}

			totalCost = duration * costPerSecond;
			breakdown.push({ item: `${duration}s duration`, cost: totalCost });
		} else if (pricingType === "per_video") {
			totalCost = (pricing.cost as number) || model.costEstimate;
			breakdown.push({ item: "Per video", cost: totalCost });
		} else {
			if (typeof pricing.per_image === "number") {
				const numImages = (params.num_images as number) || 1;
				totalCost = (pricing.per_image as number) * numImages;
				breakdown.push({ item: `${numImages} image(s)`, cost: totalCost });
			} else if (typeof pricing.per_request === "number") {
				totalCost = pricing.per_request as number;
				breakdown.push({ item: "Per request", cost: totalCost });
			} else if (typeof pricing.per_character === "number") {
				const text = params.text as string;
				const charCount = text ? text.length : 500;
				totalCost = (pricing.per_character as number) * charCount;
				breakdown.push({ item: `${charCount} characters`, cost: totalCost });
			} else if (typeof pricing.per_minute === "number") {
				const minutes = (params.duration as number) || 1;
				totalCost = (pricing.per_minute as number) * minutes;
				breakdown.push({ item: `${minutes} minute(s)`, cost: totalCost });
			} else if (typeof pricing.per_megapixel === "number") {
				totalCost = model.costEstimate;
				breakdown.push({ item: "Estimated per megapixel", cost: totalCost });
			} else if (typeof pricing.no_audio === "number") {
				const duration = parseDuration(
					params.duration ?? model.defaults.duration
				);
				const generateAudio =
					params.generate_audio ?? model.defaults.generate_audio;
				const costPerSecond = generateAudio
					? (pricing.audio as number) || pricing.no_audio
					: (pricing.no_audio as number);
				totalCost = duration * costPerSecond;
				breakdown.push({
					item: `${duration}s @ $${costPerSecond}/s`,
					cost: totalCost,
				});
			} else if (typeof pricing.per_second === "number") {
				const duration = parseDuration(
					params.duration ?? model.defaults.duration
				);
				totalCost = (pricing.per_second as number) * duration;
				breakdown.push({ item: `${duration}s duration`, cost: totalCost });
			} else {
				totalCost = model.costEstimate;
				breakdown.push({ item: "Estimated cost", cost: totalCost });
			}
		}
	}

	return {
		model: modelKey,
		baseCost: model.costEstimate,
		totalCost: Math.round(totalCost * 1000) / 1000,
		breakdown,
		currency: "USD",
	};
}

export function estimatePipelineCost(chain: PipelineChain): CostEstimate {
	const breakdown: { item: string; cost: number }[] = [];
	let totalCost = 0;

	for (const step of chain.steps) {
		if (!step.enabled) continue;
		const stepEstimate = estimateCost(step.model, step.params);
		totalCost += stepEstimate.totalCost;
		breakdown.push({
			item: `${step.type} (${step.model})`,
			cost: stepEstimate.totalCost,
		});
	}

	return {
		model: chain.name,
		baseCost: totalCost,
		totalCost: Math.round(totalCost * 1000) / 1000,
		breakdown,
		currency: "USD",
	};
}

export function listModels(options?: {
	category?: ModelCategory;
	format?: "json" | "table";
}): ModelDefinition[] {
	if (options?.category) {
		return ModelRegistry.listByCategory(options.category);
	}
	return ModelRegistry.allKeys().map((key) => ModelRegistry.get(key));
}

function parseDuration(value: unknown): number {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const num = parseFloat(value.replace(/s$/, ""));
		return Number.isFinite(num) ? num : 5;
	}
	return 5;
}
