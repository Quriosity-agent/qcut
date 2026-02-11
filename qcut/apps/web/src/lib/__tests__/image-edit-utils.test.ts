import { describe, it, expect } from "vitest";
import { generateJobId } from "../image-edit-utils";

describe("image-edit-utils", () => {
  describe("generateJobId", () => {
    it("returns unique strings on successive calls", () => {
      const id1 = generateJobId();
      const id2 = generateJobId();
      expect(id1).not.toBe(id2);
    });

    it("defaults to 'edit' prefix", () => {
      const id = generateJobId();
      expect(id).toMatch(/^edit_/);
    });

    it("uses 'upscale' prefix when specified", () => {
      const id = generateJobId("upscale");
      expect(id).toMatch(/^upscale_/);
    });

    it("contains random segment and timestamp", () => {
      const id = generateJobId();
      // Format: {prefix}_{random}_{timestamp}
      const parts = id.split("_");
      expect(parts.length).toBe(3);
      expect(parts[1].length).toBeGreaterThan(0);
      expect(Number(parts[2])).toBeGreaterThan(0);
    });
  });
});
