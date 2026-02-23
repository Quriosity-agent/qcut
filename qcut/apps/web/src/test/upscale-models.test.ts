import { describe, expect, it } from "vitest";
import {
	UPSCALE_MODELS,
	UPSCALE_MODEL_ORDER,
	UPSCALE_MODEL_ENDPOINTS,
	getUpscaleModelEntriesInPriorityOrder,
} from "@/lib/ai-models/upscale-models";

describe("Upscale model catalog", () => {
	it("keeps the catalog in sync with the curated order", () => {
		expect(Object.keys(UPSCALE_MODELS)).toEqual(UPSCALE_MODEL_ORDER.slice());
		expect(getUpscaleModelEntriesInPriorityOrder().map(([id]) => id)).toEqual(
			UPSCALE_MODEL_ORDER
		);
	});

	it("exposes required metadata for each model", () => {
		for (const [modelId, model] of Object.entries(UPSCALE_MODELS)) {
			expect(model.id).toBe(modelId);
			expect(typeof model.name).toBe("string");
			expect(model.supportedScales.length).toBeGreaterThan(0);
			expect(model.defaultParams.scale_factor).toBeGreaterThan(0);
			expect(model.features.denoising).toBe(true);
			expect(model.controls.scaleFactor.options?.length ?? 0).toBeGreaterThan(
				0
			);
			expect(model.bestFor.length).toBeGreaterThan(0);
		}
	});

	it("shares endpoint definitions between catalog and API client", () => {
		for (const modelId of UPSCALE_MODEL_ORDER) {
			expect(UPSCALE_MODEL_ENDPOINTS[modelId]).toBe(
				UPSCALE_MODELS[modelId].endpoint
			);
		}
	});
});
