import { describe, it, expect } from "vitest";
import {
  CINEMATIC_ANGLES,
  ANGLE_COUNT,
  ANGLE_BATCH_SIZE,
  ANGLES_MODEL,
  type CinematicAngleId,
} from "../constants/angles-config";
import { AI_MODELS } from "../constants/ai-constants";

describe("CINEMATIC_ANGLES", () => {
  it("should define exactly 9 angles", () => {
    expect(CINEMATIC_ANGLES).toHaveLength(9);
    expect(ANGLE_COUNT).toBe(9);
  });

  it("should have unique IDs", () => {
    const ids = CINEMATIC_ANGLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should have unique labels", () => {
    const labels = CINEMATIC_ANGLES.map((a) => a.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("should have unique prompt suffixes", () => {
    const suffixes = CINEMATIC_ANGLES.map((a) => a.prompt_suffix);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });

  it("should include all expected angle IDs", () => {
    const ids = CINEMATIC_ANGLES.map((a) => a.id);
    const expectedIds: CinematicAngleId[] = [
      "front",
      "front_left_45",
      "left_90",
      "back_left_135",
      "back_180",
      "back_right_225",
      "right_270",
      "front_right_315",
      "top_down",
    ];
    expect(ids).toEqual(expectedIds);
  });

  it("should have non-empty prompt suffixes", () => {
    for (const angle of CINEMATIC_ANGLES) {
      expect(angle.prompt_suffix.length).toBeGreaterThan(0);
    }
  });
});

describe("ANGLE_BATCH_SIZE", () => {
  it("should be a positive integer", () => {
    expect(ANGLE_BATCH_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(ANGLE_BATCH_SIZE)).toBe(true);
  });

  it("should evenly divide 9 angles into 3 batches", () => {
    expect(Math.ceil(9 / ANGLE_BATCH_SIZE)).toBe(3);
  });
});

describe("ANGLES_MODEL", () => {
  it("should have category 'angles'", () => {
    expect(ANGLES_MODEL.category).toBe("angles");
  });

  it("should require sourceImage input", () => {
    expect(ANGLES_MODEL.requiredInputs).toContain("sourceImage");
  });

  it("should be registered in AI_MODELS", () => {
    const found = AI_MODELS.find((m) => m.id === "shots_cinematic_angles");
    expect(found).toBeDefined();
    expect(found?.category).toBe("angles");
  });
});
