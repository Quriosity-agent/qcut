import { beforeEach, describe, expect, it } from "vitest";
import { ModelRegistry } from "../native-pipeline/registry.js";
import {
  parseChainConfig,
  validateChain,
  getDataTypeForCategory,
} from "../native-pipeline/chain-parser.js";

describe("chain-parser", () => {
  beforeEach(() => {
    ModelRegistry.clear();

    ModelRegistry.register({
      key: "kling-v2",
      name: "Kling v2",
      provider: "fal",
      endpoint: "fal-ai/kling-video/v2/master/text-to-video",
      categories: ["text_to_video"],
      description: "Text to video",
      pricing: 0.05,
      costEstimate: 0.05,
    });

    ModelRegistry.register({
      key: "topaz-video-upscale",
      name: "Topaz Video Upscale",
      provider: "fal",
      endpoint: "fal-ai/topaz/video",
      categories: ["upscale_video"],
      description: "Upscale video",
      pricing: 0.05,
      costEstimate: 0.05,
    });

    ModelRegistry.register({
      key: "flux-pro",
      name: "Flux Pro",
      provider: "fal",
      endpoint: "fal-ai/flux-pro",
      categories: ["text_to_image"],
      description: "Text to image",
      pricing: 0.05,
      costEstimate: 0.05,
    });
  });

  describe("parseChainConfig", () => {
    it("parses a valid YAML pipeline", () => {
      const yaml = `
name: test-pipeline
steps:
  - type: text_to_video
    model: kling-v2
    params:
      duration: "5s"
  - type: upscale_video
    model: topaz-video-upscale
`;
      const chain = parseChainConfig(yaml);
      expect(chain.name).toBe("test-pipeline");
      expect(chain.steps).toHaveLength(2);
      expect(chain.steps[0].type).toBe("text_to_video");
      expect(chain.steps[0].model).toBe("kling-v2");
      expect(chain.steps[0].params).toEqual({ duration: "5s" });
      expect(chain.steps[0].enabled).toBe(true);
      expect(chain.steps[1].type).toBe("upscale_video");
    });

    it("respects enabled: false", () => {
      const yaml = `
name: disabled-step
steps:
  - type: text_to_video
    model: kling-v2
    enabled: false
  - type: upscale_video
    model: topaz-video-upscale
`;
      const chain = parseChainConfig(yaml);
      expect(chain.steps[0].enabled).toBe(false);
      expect(chain.steps[1].enabled).toBe(true);
    });

    it("parses retry_count", () => {
      const yaml = `
name: retry-pipeline
steps:
  - type: text_to_video
    model: kling-v2
    retry_count: 3
`;
      const chain = parseChainConfig(yaml);
      expect(chain.steps[0].retryCount).toBe(3);
    });

    it("parses config section", () => {
      const yaml = `
name: configured-pipeline
config:
  output_dir: /tmp/output
  save_intermediates: true
  input_type: text
steps:
  - type: text_to_video
    model: kling-v2
`;
      const chain = parseChainConfig(yaml);
      expect(chain.config.outputDir).toBe("/tmp/output");
      expect(chain.config.saveIntermediates).toBe(true);
      expect(chain.config.inputType).toBe("text");
    });

    it("throws on invalid YAML", () => {
      expect(() => parseChainConfig("")).toThrow("Invalid YAML");
    });

    it("throws when name is missing", () => {
      const yaml = `
steps:
  - type: text_to_video
    model: kling-v2
`;
      expect(() => parseChainConfig(yaml)).toThrow("must have a 'name' field");
    });

    it("throws when steps is empty", () => {
      const yaml = `
name: empty
steps: []
`;
      expect(() => parseChainConfig(yaml)).toThrow(
        "must have at least one step"
      );
    });

    it("throws when step is missing type", () => {
      const yaml = `
name: missing-type
steps:
  - model: kling-v2
`;
      expect(() => parseChainConfig(yaml)).toThrow("Step 1: missing 'type'");
    });

    it("throws when step is missing model", () => {
      const yaml = `
name: missing-model
steps:
  - type: text_to_video
`;
      expect(() => parseChainConfig(yaml)).toThrow("Step 1: missing 'model'");
    });
  });

  describe("validateChain", () => {
    it("validates a correct pipeline", () => {
      const yaml = `
name: valid-pipeline
steps:
  - type: text_to_video
    model: kling-v2
  - type: upscale_video
    model: topaz-video-upscale
`;
      const chain = parseChainConfig(yaml);
      const result = validateChain(chain);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects unknown model", () => {
      const yaml = `
name: unknown-model
steps:
  - type: text_to_video
    model: nonexistent-model
`;
      const chain = parseChainConfig(yaml);
      const result = validateChain(chain);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("unknown model");
    });

    it("detects category mismatch", () => {
      const yaml = `
name: cat-mismatch
steps:
  - type: text_to_image
    model: kling-v2
`;
      const chain = parseChainConfig(yaml);
      const result = validateChain(chain);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("does not support category");
    });

    it("detects incompatible data types between steps", () => {
      const yaml = `
name: type-mismatch
steps:
  - type: text_to_image
    model: flux-pro
  - type: upscale_video
    model: topaz-video-upscale
`;
      const chain = parseChainConfig(yaml);
      const result = validateChain(chain);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("expects");
    });

    it("fails when all steps are disabled", () => {
      const yaml = `
name: all-disabled
steps:
  - type: text_to_video
    model: kling-v2
    enabled: false
`;
      const chain = parseChainConfig(yaml);
      const result = validateChain(chain);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("no enabled steps");
    });
  });

  describe("getDataTypeForCategory", () => {
    it("returns video for text_to_video", () => {
      expect(getDataTypeForCategory("text_to_video")).toBe("video");
    });

    it("returns image for text_to_image", () => {
      expect(getDataTypeForCategory("text_to_image")).toBe("image");
    });

    it("returns audio for text_to_speech", () => {
      expect(getDataTypeForCategory("text_to_speech")).toBe("audio");
    });

    it("returns text for prompt_generation", () => {
      expect(getDataTypeForCategory("prompt_generation")).toBe("text");
    });
  });
});
