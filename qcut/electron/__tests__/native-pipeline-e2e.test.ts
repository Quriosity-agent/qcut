import { beforeEach, describe, expect, it } from "vitest";
import { ModelRegistry } from "../native-pipeline/registry.js";
import {
	registerTextToVideoModels,
	registerImageToVideoModels,
	registerImageToImageModels,
	registerAllPart2Models,
} from "../native-pipeline/registry-data/index.js";
import {
	estimateCost,
	listModels,
} from "../native-pipeline/cost-calculator.js";
import {
	parseChainConfig,
	validateChain,
} from "../native-pipeline/chain-parser.js";
import {
	getInputDataType,
	getOutputDataType,
} from "../native-pipeline/step-executors.js";

describe("native-pipeline end-to-end", () => {
	beforeEach(() => {
		ModelRegistry.clear();
		registerTextToVideoModels();
		registerImageToVideoModels();
		registerImageToImageModels();
		registerAllPart2Models();
	});

	describe("full registry initialization", () => {
		it("registers all expected models", () => {
			const count = ModelRegistry.count();
			expect(count).toBeGreaterThanOrEqual(70);
		});

		it("has models in all expected categories", () => {
			const supported = ModelRegistry.getSupportedModels();
			const expectedCategories = [
				"text_to_video",
				"image_to_video",
				"text_to_image",
				"image_to_image",
				"avatar",
				"video_to_video",
				"upscale_video",
				"add_audio",
				"text_to_speech",
				"speech_to_text",
				"image_understanding",
				"prompt_generation",
			];

			for (const cat of expectedCategories) {
				expect(supported[cat]).toBeDefined();
				expect(supported[cat].length).toBeGreaterThan(0);
			}
		});

		it("all models have valid endpoints", () => {
			const allKeys = ModelRegistry.allKeys();
			for (const key of allKeys) {
				const model = ModelRegistry.get(key);
				expect(model.endpoint).toBeTruthy();
				expect(typeof model.endpoint).toBe("string");
			}
		});

		it("all models have a description", () => {
			const allKeys = ModelRegistry.allKeys();
			for (const key of allKeys) {
				const model = ModelRegistry.get(key);
				expect(model.description).toBeTruthy();
			}
		});
	});

	describe("specific model lookups", () => {
		it("finds kling_2_6_pro", () => {
			expect(ModelRegistry.has("kling_2_6_pro")).toBe(true);
			const model = ModelRegistry.get("kling_2_6_pro");
			expect(model.categories).toContain("text_to_video");
		});

		it("finds flux_dev", () => {
			expect(ModelRegistry.has("flux_dev")).toBe(true);
			const model = ModelRegistry.get("flux_dev");
			expect(model.categories).toContain("text_to_image");
		});

		it("finds veo3", () => {
			expect(ModelRegistry.has("veo3")).toBe(true);
			const model = ModelRegistry.get("veo3");
			expect(model.categories).toContain("text_to_video");
		});

		it("finds scribe_v2 (speech_to_text)", () => {
			expect(ModelRegistry.has("scribe_v2")).toBe(true);
			const model = ModelRegistry.get("scribe_v2");
			expect(model.categories).toContain("speech_to_text");
		});
	});

	describe("cost estimation with real models", () => {
		it("estimates cost for kling_2_6_pro", () => {
			const estimate = estimateCost("kling_2_6_pro");
			expect(estimate.totalCost).toBeGreaterThan(0);
			expect(estimate.currency).toBe("USD");
		});

		it("estimates cost for flux_dev", () => {
			const estimate = estimateCost("flux_dev");
			expect(estimate.totalCost).toBeGreaterThan(0);
		});

		it("validates pipeline for text-to-video + upscale", () => {
			const yaml = `
name: video-upscale-pipeline
steps:
  - type: text_to_video
    model: kling_2_6_pro
  - type: upscale_video
    model: topaz
`;
			const chain = parseChainConfig(yaml);
			const validation = validateChain(chain);
			expect(validation.valid).toBe(true);
		});
	});

	describe("model listing", () => {
		it("lists all models", () => {
			const models = listModels();
			expect(models.length).toBeGreaterThanOrEqual(70);
		});

		it("lists text_to_video models", () => {
			const models = listModels({ category: "text_to_video" });
			expect(models.length).toBeGreaterThan(0);
			for (const m of models) {
				expect(m.categories).toContain("text_to_video");
			}
		});

		it("lists avatar models", () => {
			const models = listModels({ category: "avatar" });
			expect(models.length).toBeGreaterThan(0);
			for (const m of models) {
				expect(m.categories).toContain("avatar");
			}
		});
	});

	describe("data type flow validation", () => {
		it("text_to_video -> upscale_video is valid", () => {
			const out = getOutputDataType("text_to_video");
			const inp = getInputDataType("upscale_video");
			expect(out).toBe("video");
			expect(inp).toBe("video");
		});

		it("text_to_image -> image_to_video is valid", () => {
			const out = getOutputDataType("text_to_image");
			const inp = getInputDataType("image_to_video");
			expect(out).toBe("image");
			expect(inp).toBe("image");
		});

		it("text_to_speech outputs audio", () => {
			expect(getOutputDataType("text_to_speech")).toBe("audio");
		});

		it("prompt_generation -> text_to_video is valid (text->text)", () => {
			const out = getOutputDataType("prompt_generation");
			const inp = getInputDataType("text_to_video");
			expect(out).toBe("text");
			expect(inp).toBe("text");
		});
	});
});
