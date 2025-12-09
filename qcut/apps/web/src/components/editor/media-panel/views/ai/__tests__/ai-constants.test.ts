import { describe, it, expect } from "vitest";
import { MODEL_HELPERS } from "../constants/ai-constants";

describe("MODEL_HELPERS", () => {
  describe("requiresFrameToFrame", () => {
    it("should return true for Veo 3.1 Fast Frame-to-Video", () => {
      expect(
        MODEL_HELPERS.requiresFrameToFrame("veo31_fast_frame_to_video")
      ).toBe(true);
    });

    it("should return true for Veo 3.1 Frame-to-Video", () => {
      expect(MODEL_HELPERS.requiresFrameToFrame("veo31_frame_to_video")).toBe(
        true
      );
    });

    it("should return false for standard image-to-video models", () => {
      expect(
        MODEL_HELPERS.requiresFrameToFrame("veo31_fast_image_to_video")
      ).toBe(false);
      expect(MODEL_HELPERS.requiresFrameToFrame("sora2_image_to_video")).toBe(
        false
      );
      expect(MODEL_HELPERS.requiresFrameToFrame("ltxv2_i2v")).toBe(false);
    });

    it("should return false for text-to-video models", () => {
      expect(MODEL_HELPERS.requiresFrameToFrame("sora2_text_to_video")).toBe(
        false
      );
      expect(MODEL_HELPERS.requiresFrameToFrame("ltxv2_pro_t2v")).toBe(false);
    });

    it("should return false for unknown model IDs", () => {
      expect(MODEL_HELPERS.requiresFrameToFrame("unknown_model")).toBe(false);
    });
  });

  describe("getRequiredInputs", () => {
    it("should return firstFrame and lastFrame for F2V models", () => {
      const inputs = MODEL_HELPERS.getRequiredInputs(
        "veo31_fast_frame_to_video"
      );
      expect(inputs).toEqual(["firstFrame", "lastFrame"]);
    });

    it("should return empty array for models without required inputs", () => {
      const inputs = MODEL_HELPERS.getRequiredInputs("sora2_image_to_video");
      expect(inputs).toEqual([]);
    });

    it("should return empty array for unknown model IDs", () => {
      const inputs = MODEL_HELPERS.getRequiredInputs("unknown_model");
      expect(inputs).toEqual([]);
    });
  });
});
