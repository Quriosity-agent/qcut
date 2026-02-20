import { beforeEach, describe, expect, it } from "vitest";
import type {
	ModelCategory,
	ModelDefinitionInput,
} from "../native-pipeline/registry.js";
import { ModelRegistry } from "../native-pipeline/registry.js";

describe("ModelRegistry", () => {
	beforeEach(() => {
		ModelRegistry.clear();
	});

	const sampleModel: ModelDefinitionInput = {
		key: "test-model",
		name: "Test Model",
		provider: "fal",
		endpoint: "fal-ai/test-model",
		categories: ["text_to_video"] as ModelCategory[],
		description: "A test model",
		pricing: { type: "per_video", cost: 0.05 },
		costEstimate: 0.05,
		processingTime: 60,
	};

	it("registers and retrieves a model", () => {
		ModelRegistry.register(sampleModel);
		expect(ModelRegistry.has("test-model")).toBe(true);
		const model = ModelRegistry.get("test-model");
		expect(model.name).toBe("Test Model");
		expect(model.provider).toBe("fal");
		expect(model.endpoint).toBe("fal-ai/test-model");
	});

	it("throws for unknown model key", () => {
		expect(() => ModelRegistry.get("nonexistent")).toThrow(
			"Model not found: nonexistent"
		);
	});

	it("returns false for unknown model in has()", () => {
		expect(ModelRegistry.has("nonexistent")).toBe(false);
	});

	it("lists models by category", () => {
		ModelRegistry.register(sampleModel);
		ModelRegistry.register({
			...sampleModel,
			key: "image-model",
			name: "Image Model",
			categories: ["text_to_image"],
		});

		const videoModels = ModelRegistry.listByCategory("text_to_video");
		expect(videoModels).toHaveLength(1);
		expect(videoModels[0].key).toBe("test-model");

		const imageModels = ModelRegistry.listByCategory("text_to_image");
		expect(imageModels).toHaveLength(1);
		expect(imageModels[0].key).toBe("image-model");
	});

	it("returns all keys", () => {
		ModelRegistry.register(sampleModel);
		ModelRegistry.register({ ...sampleModel, key: "model-2", name: "Model 2" });
		const keys = ModelRegistry.allKeys();
		expect(keys).toContain("test-model");
		expect(keys).toContain("model-2");
		expect(keys).toHaveLength(2);
	});

	it("returns keys for category", () => {
		ModelRegistry.register(sampleModel);
		ModelRegistry.register({
			...sampleModel,
			key: "other",
			categories: ["text_to_image"],
		});
		const keys = ModelRegistry.keysForCategory("text_to_video");
		expect(keys).toEqual(["test-model"]);
	});

	it("builds supported models map", () => {
		ModelRegistry.register(sampleModel);
		ModelRegistry.register({
			...sampleModel,
			key: "multi",
			categories: ["text_to_video", "image_to_video"],
		});
		const supported = ModelRegistry.getSupportedModels();
		expect(supported.text_to_video).toContain("test-model");
		expect(supported.text_to_video).toContain("multi");
		expect(supported.image_to_video).toContain("multi");
	});

	it("normalizes defaults for missing optional fields", () => {
		ModelRegistry.register({
			key: "minimal",
			name: "Minimal",
			provider: "fal",
			endpoint: "fal-ai/minimal",
			categories: ["text_to_image"],
			description: "Minimal model",
			pricing: 0.01,
		});
		const model = ModelRegistry.get("minimal");
		expect(model.durationOptions).toEqual([]);
		expect(model.aspectRatios).toEqual([]);
		expect(model.resolutions).toEqual([]);
		expect(model.defaults).toEqual({});
		expect(model.features).toEqual([]);
		expect(model.maxDuration).toBe(0);
		expect(model.extendedParams).toEqual([]);
		expect(model.extendedFeatures).toEqual({});
		expect(model.inputRequirements).toEqual({ required: [], optional: [] });
		expect(model.modelInfo).toEqual({});
		expect(model.costEstimate).toBe(0);
		expect(model.processingTime).toBe(0);
	});

	it("maps providerKey correctly", () => {
		ModelRegistry.register({
			...sampleModel,
			key: "my-model",
			providerKey: "provider-key-123",
		});
		const byProvider = ModelRegistry.getByProviderKey("provider-key-123");
		expect(byProvider).not.toBeNull();
		expect(byProvider!.key).toBe("my-model");
	});

	it("returns cost estimates and processing times", () => {
		ModelRegistry.register({
			...sampleModel,
			costEstimate: 0.1,
			processingTime: 30,
		});
		const costs = ModelRegistry.getCostEstimates();
		expect(costs.text_to_video["test-model"]).toBe(0.1);

		const times = ModelRegistry.getProcessingTimes();
		expect(times.text_to_video["test-model"]).toBe(30);
	});

	it("reports correct count", () => {
		expect(ModelRegistry.count()).toBe(0);
		ModelRegistry.register(sampleModel);
		expect(ModelRegistry.count()).toBe(1);
	});

	it("clears all models", () => {
		ModelRegistry.register(sampleModel);
		expect(ModelRegistry.count()).toBe(1);
		ModelRegistry.clear();
		expect(ModelRegistry.count()).toBe(0);
		expect(ModelRegistry.has("test-model")).toBe(false);
	});
});
