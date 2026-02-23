import { beforeEach, describe, expect, it } from "vitest";
import { ModelRegistry } from "../native-pipeline/infra/registry.js";
import {
	estimateCost,
	estimatePipelineCost,
	listModels,
} from "../native-pipeline/infra/cost-calculator.js";
import type { PipelineChain } from "../native-pipeline/execution/executor.js";

describe("cost-calculator", () => {
	beforeEach(() => {
		ModelRegistry.clear();
	});

	describe("estimateCost", () => {
		it("estimates cost for a per_video pricing model", () => {
			ModelRegistry.register({
				key: "test-video",
				name: "Test Video",
				provider: "fal",
				endpoint: "fal-ai/test",
				categories: ["text_to_video"],
				description: "Test",
				pricing: { type: "per_video", cost: 0.08 },
				costEstimate: 0.08,
			});

			const estimate = estimateCost("test-video");
			expect(estimate.model).toBe("test-video");
			expect(estimate.totalCost).toBe(0.08);
			expect(estimate.currency).toBe("USD");
			expect(estimate.breakdown.length).toBeGreaterThan(0);
		});

		it("estimates cost for per_image pricing", () => {
			ModelRegistry.register({
				key: "test-image",
				name: "Test Image",
				provider: "fal",
				endpoint: "fal-ai/test",
				categories: ["text_to_image"],
				description: "Test",
				pricing: { per_image: 0.03 },
				costEstimate: 0.03,
			});

			const estimate = estimateCost("test-image", { num_images: 4 });
			expect(estimate.totalCost).toBe(0.12);
		});

		it("estimates cost for per_second pricing", () => {
			ModelRegistry.register({
				key: "test-per-sec",
				name: "Test Per Second",
				provider: "fal",
				endpoint: "fal-ai/test",
				categories: ["text_to_video"],
				description: "Test",
				pricing: {
					type: "per_second",
					cost_no_audio: 0.01,
					cost_with_audio: 0.02,
				},
				costEstimate: 0.05,
				defaults: { duration: "5s" },
			});

			const estimate = estimateCost("test-per-sec");
			expect(estimate.totalCost).toBe(0.05);
		});

		it("estimates cost for per_character pricing", () => {
			ModelRegistry.register({
				key: "test-tts",
				name: "Test TTS",
				provider: "elevenlabs",
				endpoint: "elevenlabs/text-to-speech",
				categories: ["text_to_speech"],
				description: "Test TTS",
				pricing: { per_character: 0.0003 },
				costEstimate: 0.15,
			});

			const estimate = estimateCost("test-tts", { text: "Hello world" });
			expect(estimate.totalCost).toBeCloseTo(0.0033, 3);
		});

		it("uses numeric pricing as flat cost", () => {
			ModelRegistry.register({
				key: "flat-cost",
				name: "Flat Cost",
				provider: "fal",
				endpoint: "fal-ai/test",
				categories: ["text_to_video"],
				description: "Test",
				pricing: 0.25,
				costEstimate: 0.25,
			});

			const estimate = estimateCost("flat-cost");
			expect(estimate.totalCost).toBe(0.25);
		});

		it("throws for unknown model", () => {
			expect(() => estimateCost("nonexistent")).toThrow("Model not found");
		});
	});

	describe("estimatePipelineCost", () => {
		it("sums costs of all enabled steps", () => {
			ModelRegistry.register({
				key: "step-a",
				name: "Step A",
				provider: "fal",
				endpoint: "fal-ai/a",
				categories: ["text_to_video"],
				description: "Step A",
				pricing: 0.1,
				costEstimate: 0.1,
			});
			ModelRegistry.register({
				key: "step-b",
				name: "Step B",
				provider: "fal",
				endpoint: "fal-ai/b",
				categories: ["upscale_video"],
				description: "Step B",
				pricing: 0.05,
				costEstimate: 0.05,
			});

			const chain: PipelineChain = {
				name: "test-chain",
				steps: [
					{
						type: "text_to_video",
						model: "step-a",
						params: {},
						enabled: true,
						retryCount: 0,
					},
					{
						type: "upscale_video",
						model: "step-b",
						params: {},
						enabled: true,
						retryCount: 0,
					},
					{
						type: "text_to_video",
						model: "step-a",
						params: {},
						enabled: false,
						retryCount: 0,
					},
				],
				config: {},
			};

			const estimate = estimatePipelineCost(chain);
			expect(estimate.totalCost).toBe(0.15);
			expect(estimate.breakdown).toHaveLength(2);
		});
	});

	describe("listModels", () => {
		it("returns all models when no filter", () => {
			ModelRegistry.register({
				key: "m1",
				name: "M1",
				provider: "fal",
				endpoint: "fal-ai/m1",
				categories: ["text_to_video"],
				description: "M1",
				pricing: 0.01,
			});
			ModelRegistry.register({
				key: "m2",
				name: "M2",
				provider: "fal",
				endpoint: "fal-ai/m2",
				categories: ["text_to_image"],
				description: "M2",
				pricing: 0.01,
			});

			const all = listModels();
			expect(all).toHaveLength(2);
		});

		it("filters by category", () => {
			ModelRegistry.register({
				key: "m1",
				name: "M1",
				provider: "fal",
				endpoint: "fal-ai/m1",
				categories: ["text_to_video"],
				description: "M1",
				pricing: 0.01,
			});
			ModelRegistry.register({
				key: "m2",
				name: "M2",
				provider: "fal",
				endpoint: "fal-ai/m2",
				categories: ["text_to_image"],
				description: "M2",
				pricing: 0.01,
			});

			const videoModels = listModels({ category: "text_to_video" });
			expect(videoModels).toHaveLength(1);
			expect(videoModels[0].key).toBe("m1");
		});
	});
});
