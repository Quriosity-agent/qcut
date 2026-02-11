// Location: apps/web/src/lib/__tests__/export-engine-recorder.test.ts

import { describe, it, expect, vi } from "vitest";
import { getVideoBitrate } from "../export-engine-recorder";

vi.mock("@/lib/debug-config", () => ({
  debugLog: vi.fn(),
  debugWarn: vi.fn(),
}));

describe("Export Engine Recorder", () => {
  describe("getVideoBitrate", () => {
    it("returns correct bitrate for 1080p", () => {
      expect(getVideoBitrate("1080p")).toBe(8_000_000);
    });

    it("returns correct bitrate for 720p", () => {
      expect(getVideoBitrate("720p")).toBe(5_000_000);
    });

    it("returns correct bitrate for 480p", () => {
      expect(getVideoBitrate("480p")).toBe(2_500_000);
    });

    it("defaults to 720p for unknown quality", () => {
      expect(getVideoBitrate("360p")).toBe(5_000_000);
      expect(getVideoBitrate("unknown")).toBe(5_000_000);
    });
  });
});
