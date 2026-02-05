import { describe, it, expect } from "vitest";
import {
  T2V_MODELS,
  T2V_MODEL_CAPABILITIES,
  T2V_MODEL_ORDER,
} from "../text2video-models-config";
import { I2V_MODELS, I2V_MODEL_ORDER } from "../image2video-models-config";

describe("Kling v3 Model Configurations", () => {
  describe("Text-to-Video Models", () => {
    it.each([
      { id: "kling_v3_pro_t2v", name: "Kling v3 Pro T2V", endpoint: "fal-ai/kling-video/v3/pro/text-to-video" },
      { id: "kling_v3_standard_t2v", name: "Kling v3 Standard T2V", endpoint: "fal-ai/kling-video/v3/standard/text-to-video" },
    ])("should have $id configuration", ({ id, name, endpoint }) => {
      const model = T2V_MODELS[id as keyof typeof T2V_MODELS];
      expect(model).toBeDefined();
      expect(model.id).toBe(id);
      expect(model.name).toBe(name);
      expect(model.endpoints.text_to_video).toBe(endpoint);
    });

    it("should have correct capabilities for kling_v3_pro_t2v", () => {
      expect(T2V_MODEL_CAPABILITIES.kling_v3_pro_t2v).toEqual({
        supportsAspectRatio: true,
        supportedAspectRatios: ["16:9", "9:16", "1:1"],
        supportsResolution: false,
        supportsDuration: true,
        supportedDurations: [5, 10, 15],
        supportsNegativePrompt: false,
        supportsPromptExpansion: false,
        supportsSeed: false,
        supportsSafetyChecker: false,
        defaultAspectRatio: "16:9",
        defaultDuration: 5,
      });
    });

    it("should have correct capabilities for kling_v3_standard_t2v", () => {
      expect(T2V_MODEL_CAPABILITIES.kling_v3_standard_t2v).toEqual({
        supportsAspectRatio: true,
        supportedAspectRatios: ["16:9", "9:16", "1:1"],
        supportsResolution: false,
        supportsDuration: true,
        supportedDurations: [3, 5, 10, 15],
        supportsNegativePrompt: false,
        supportsPromptExpansion: false,
        supportsSeed: false,
        supportsSafetyChecker: false,
        defaultAspectRatio: "16:9",
        defaultDuration: 5,
      });
    });

    it("should support audio generation for T2V models", () => {
      expect(T2V_MODELS.kling_v3_pro_t2v.default_params.generate_audio).toBe(
        true
      );
      expect(
        T2V_MODELS.kling_v3_standard_t2v.default_params.generate_audio
      ).toBe(true);
    });

    it("should have T2V models in the correct order", () => {
      expect(T2V_MODEL_ORDER[0]).toBe("kling_v3_pro_t2v");
      expect(T2V_MODEL_ORDER[1]).toBe("kling_v3_standard_t2v");
    });

    it("should have correct max duration for T2V models", () => {
      expect(T2V_MODELS.kling_v3_pro_t2v.max_duration).toBe(15);
      expect(T2V_MODELS.kling_v3_standard_t2v.max_duration).toBe(15);
    });

    it("should have correct pricing for T2V models", () => {
      expect(T2V_MODELS.kling_v3_pro_t2v.price).toBe("0.336");
      expect(T2V_MODELS.kling_v3_standard_t2v.price).toBe("0.252");
    });
  });

  describe("Image-to-Video Models", () => {
    it.each([
      { id: "kling_v3_pro_i2v", name: "Kling v3 Pro I2V", endpoint: "fal-ai/kling-video/v3/pro/image-to-video" },
      { id: "kling_v3_standard_i2v", name: "Kling v3 Standard I2V", endpoint: "fal-ai/kling-video/v3/standard/image-to-video" },
    ])("should have $id configuration", ({ id, name, endpoint }) => {
      const model = I2V_MODELS[id as keyof typeof I2V_MODELS];
      expect(model).toBeDefined();
      expect(model.id).toBe(id);
      expect(model.name).toBe(name);
      expect(model.endpoints.image_to_video).toBe(endpoint);
    });

    it("should support audio generation for I2V models", () => {
      expect(I2V_MODELS.kling_v3_pro_i2v.default_params.generate_audio).toBe(
        true
      );
      expect(
        I2V_MODELS.kling_v3_standard_i2v.default_params.generate_audio
      ).toBe(true);
    });

    it("should have I2V models in the correct order", () => {
      expect(I2V_MODEL_ORDER[0]).toBe("kling_v3_pro_i2v");
      expect(I2V_MODEL_ORDER[1]).toBe("kling_v3_standard_i2v");
    });

    it("should have correct max duration for I2V models", () => {
      expect(I2V_MODELS.kling_v3_pro_i2v.max_duration).toBe(12);
      expect(I2V_MODELS.kling_v3_standard_i2v.max_duration).toBe(12);
    });

    it("should have correct pricing for I2V models", () => {
      expect(I2V_MODELS.kling_v3_pro_i2v.price).toBe("0.336");
      expect(I2V_MODELS.kling_v3_standard_i2v.price).toBe("0.252");
    });

    it("should have correct supported durations for I2V models", () => {
      expect(I2V_MODELS.kling_v3_pro_i2v.supportedDurations).toEqual([
        5, 10, 12,
      ]);
      expect(I2V_MODELS.kling_v3_standard_i2v.supportedDurations).toEqual([
        5, 10, 12,
      ]);
    });

    it("should have correct supported aspect ratios for I2V models", () => {
      expect(I2V_MODELS.kling_v3_pro_i2v.supportedAspectRatios).toEqual([
        "16:9",
        "9:16",
        "1:1",
      ]);
      expect(I2V_MODELS.kling_v3_standard_i2v.supportedAspectRatios).toEqual([
        "16:9",
        "9:16",
        "1:1",
      ]);
    });
  });

  describe("Pricing Structure", () => {
    it("Pro tier should be more expensive than Standard for T2V", () => {
      const proPrice = parseFloat(T2V_MODELS.kling_v3_pro_t2v.price);
      const standardPrice = parseFloat(T2V_MODELS.kling_v3_standard_t2v.price);
      expect(proPrice).toBeGreaterThan(standardPrice);
    });

    it("Pro tier should be more expensive than Standard for I2V", () => {
      const proPrice = parseFloat(I2V_MODELS.kling_v3_pro_i2v.price);
      const standardPrice = parseFloat(I2V_MODELS.kling_v3_standard_i2v.price);
      expect(proPrice).toBeGreaterThan(standardPrice);
    });

    it("T2V and I2V Pro prices should match", () => {
      expect(T2V_MODELS.kling_v3_pro_t2v.price).toBe(
        I2V_MODELS.kling_v3_pro_i2v.price
      );
    });

    it("T2V and I2V Standard prices should match", () => {
      expect(T2V_MODELS.kling_v3_standard_t2v.price).toBe(
        I2V_MODELS.kling_v3_standard_i2v.price
      );
    });
  });

  describe("FAL Endpoint Format", () => {
    it("should have valid FAL endpoint format for all Kling v3 models", () => {
      const endpoints = [
        T2V_MODELS.kling_v3_pro_t2v.endpoints.text_to_video,
        T2V_MODELS.kling_v3_standard_t2v.endpoints.text_to_video,
        I2V_MODELS.kling_v3_pro_i2v.endpoints.image_to_video,
        I2V_MODELS.kling_v3_standard_i2v.endpoints.image_to_video,
      ];

      for (const endpoint of endpoints) {
        expect(endpoint).toMatch(
          /^fal-ai\/kling-video\/v3\/(pro|standard)\/(text|image)-to-video$/
        );
      }
    });
  });
});
