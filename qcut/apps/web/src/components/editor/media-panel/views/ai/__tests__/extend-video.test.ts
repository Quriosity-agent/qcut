import { describe, it, expect } from "vitest";
import {
  AI_MODELS,
  UPLOAD_CONSTANTS,
  ERROR_MESSAGES,
} from "../constants/ai-constants";
import { calculateVeo31ExtendCost } from "../utils/ai-cost-calculators";

describe("Veo 3.1 Extend-Video Integration", () => {
  describe("Model Definitions", () => {
    it("should have veo31_fast_extend_video model defined", () => {
      const model = AI_MODELS.find((m) => m.id === "veo31_fast_extend_video");
      expect(model).toBeDefined();
      expect(model?.name).toBe("Veo 3.1 Fast Extend");
      expect(model?.category).toBe("avatar");
      expect(model?.max_duration).toBe(7);
    });

    it("should have veo31_extend_video model defined", () => {
      const model = AI_MODELS.find((m) => m.id === "veo31_extend_video");
      expect(model).toBeDefined();
      expect(model?.name).toBe("Veo 3.1 Extend");
      expect(model?.category).toBe("avatar");
      expect(model?.max_duration).toBe(7);
    });

    it("should have correct endpoints for extend-video models", () => {
      const fastModel = AI_MODELS.find(
        (m) => m.id === "veo31_fast_extend_video"
      );
      const stdModel = AI_MODELS.find((m) => m.id === "veo31_extend_video");

      expect(fastModel?.endpoints.image_to_video).toBe(
        "fal-ai/veo3.1/fast/extend-video"
      );
      expect(stdModel?.endpoints.image_to_video).toBe(
        "fal-ai/veo3.1/extend-video"
      );
    });

    it("should require sourceVideo input", () => {
      const fastModel = AI_MODELS.find(
        (m) => m.id === "veo31_fast_extend_video"
      );
      const stdModel = AI_MODELS.find((m) => m.id === "veo31_extend_video");

      expect(fastModel?.requiredInputs).toContain("sourceVideo");
      expect(stdModel?.requiredInputs).toContain("sourceVideo");
    });

    it("should support auto, 16:9, and 9:16 aspect ratios", () => {
      const model = AI_MODELS.find((m) => m.id === "veo31_fast_extend_video");
      expect(model?.supportedAspectRatios).toEqual(["auto", "16:9", "9:16"]);
    });
  });

  describe("Cost Calculator", () => {
    it("should calculate fast model cost with audio correctly", () => {
      const cost = calculateVeo31ExtendCost("fast", true);
      // 7 seconds * $0.15/second = $1.05
      expect(cost).toBe("$1.05");
    });

    it("should calculate fast model cost without audio correctly", () => {
      const cost = calculateVeo31ExtendCost("fast", false);
      // 7 seconds * $0.10/second = $0.70
      expect(cost).toBe("$0.70");
    });

    it("should calculate standard model cost with audio correctly", () => {
      const cost = calculateVeo31ExtendCost("standard", true);
      // 7 seconds * $0.40/second = $2.80
      expect(cost).toBe("$2.80");
    });

    it("should calculate standard model cost without audio correctly", () => {
      const cost = calculateVeo31ExtendCost("standard", false);
      // 7 seconds * $0.20/second = $1.40
      expect(cost).toBe("$1.40");
    });

    it("should default to audio enabled if not specified", () => {
      const costWithDefault = calculateVeo31ExtendCost("fast");
      const costWithAudio = calculateVeo31ExtendCost("fast", true);
      expect(costWithDefault).toBe(costWithAudio);
    });
  });

  describe("Validation Constants", () => {
    it("should have max extend video duration set to 8 seconds", () => {
      expect(UPLOAD_CONSTANTS.MAX_EXTEND_VIDEO_DURATION_SECONDS).toBe(8);
    });

    it("should have correct supported formats", () => {
      expect(UPLOAD_CONSTANTS.EXTEND_VIDEO_SUPPORTED_FORMATS).toEqual([
        "mp4",
        "mov",
        "webm",
        "m4v",
        "gif",
      ]);
    });

    it("should have correct supported resolutions", () => {
      expect(UPLOAD_CONSTANTS.EXTEND_VIDEO_SUPPORTED_RESOLUTIONS).toEqual([
        "720p",
        "1080p",
      ]);
    });

    it("should have correct supported aspect ratios", () => {
      expect(UPLOAD_CONSTANTS.EXTEND_VIDEO_SUPPORTED_ASPECT_RATIOS).toEqual([
        "16:9",
        "9:16",
      ]);
    });

    it("should have output duration set to 7 seconds", () => {
      expect(UPLOAD_CONSTANTS.EXTEND_VIDEO_OUTPUT_DURATION_SECONDS).toBe(7);
    });
  });

  describe("Error Messages", () => {
    it("should have error message for video too long", () => {
      expect(ERROR_MESSAGES.EXTEND_VIDEO_TOO_LONG).toBe(
        "Input video must be 8 seconds or less for Veo 3.1 extend-video"
      );
    });

    it("should have error message for invalid resolution", () => {
      expect(ERROR_MESSAGES.EXTEND_VIDEO_INVALID_RESOLUTION).toBe(
        "Video must be 720p or 1080p for Veo 3.1 extend-video"
      );
    });

    it("should have error message for invalid aspect ratio", () => {
      expect(ERROR_MESSAGES.EXTEND_VIDEO_INVALID_ASPECT_RATIO).toBe(
        "Video must be 16:9 or 9:16 for Veo 3.1 extend-video"
      );
    });

    it("should have error message for missing video", () => {
      expect(ERROR_MESSAGES.EXTEND_VIDEO_MISSING).toBe(
        "Please upload a source video to extend"
      );
    });

    it("should have error message for invalid format", () => {
      expect(ERROR_MESSAGES.EXTEND_VIDEO_INVALID_FORMAT).toBe(
        "Video format must be MP4, MOV, WebM, M4V, or GIF for Veo 3.1 extend-video"
      );
    });
  });
});
