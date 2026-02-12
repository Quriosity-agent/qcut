// Location: electron/__tests__/ffmpeg-args-builder.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildFFmpegArgs } from "../ffmpeg-args-builder";

// Mock fs — all file existence checks pass
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    writeFileSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  writeFileSync: vi.fn(),
}));

// Mock electron app (needed by ffmpeg/utils)
vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp") },
}));

describe("buildFFmpegArgs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Mode 2: Direct video input with filters", () => {
    it("builds args for video input with filter chain", () => {
      const args = buildFFmpegArgs(
        "/frames",
        "/output.mp4",
        1920,
        1080,
        30,
        "medium",
        10,
        [],
        "eq=brightness=0.1",
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        true,
        "/input.mp4"
      );

      expect(args).toContain("-y");
      expect(args).toContain("-i");
      expect(args).toContain("/input.mp4");
      expect(args).toContain("-vf");
      expect(args).toContain("eq=brightness=0.1");
      expect(args).toContain("-c:v");
      expect(args).toContain("libx264");
      expect(args).toContain("-pix_fmt");
      expect(args).toContain("yuv420p");
      expect(args).toContain("/output.mp4");
    });

    it("includes trim start when provided", () => {
      const args = buildFFmpegArgs(
        "/frames",
        "/output.mp4",
        1920,
        1080,
        30,
        "medium",
        10,
        [],
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        true,
        "/input.mp4",
        2.5
      );

      const ssIndex = args.indexOf("-ss");
      expect(ssIndex).toBeGreaterThan(-1);
      expect(args[ssIndex + 1]).toBe("2.5");
    });

    it("includes duration flag", () => {
      const args = buildFFmpegArgs(
        "/frames",
        "/output.mp4",
        1920,
        1080,
        30,
        "medium",
        10,
        [],
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        true,
        "/input.mp4"
      );

      const tIndex = args.indexOf("-t");
      expect(tIndex).toBeGreaterThan(-1);
      expect(args[tIndex + 1]).toBe("10");
    });

    it("includes audio codec when audio files provided", () => {
      const args = buildFFmpegArgs(
        "/frames",
        "/output.mp4",
        1920,
        1080,
        30,
        "medium",
        10,
        [{ path: "/audio.mp3", startTime: 0 }],
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        true,
        "/input.mp4"
      );

      expect(args).toContain("-c:a");
      expect(args).toContain("aac");
      expect(args).toContain("-b:a");
      expect(args).toContain("128k");
    });

    it("uses filter_complex for sticker overlays", () => {
      const args = buildFFmpegArgs(
        "/frames",
        "/output.mp4",
        1920,
        1080,
        30,
        "medium",
        10,
        [],
        undefined,
        undefined,
        false,
        undefined,
        "[0:v][1:v]overlay",
        [
          {
            id: "s1",
            path: "/sticker.png",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            startTime: 0,
            endTime: 5,
            zIndex: 1,
          },
        ],
        true,
        "/input.mp4"
      );

      expect(args).toContain("-filter_complex");
      expect(args).toContain("-loop");
    });
  });

  describe("Mode 1: Direct copy", () => {
    it("builds args for single video direct copy", () => {
      const args = buildFFmpegArgs(
        "/frames",
        "/output.mp4",
        1920,
        1080,
        30,
        "medium",
        10,
        [],
        undefined,
        undefined,
        true,
        [
          {
            path: "/video.mp4",
            startTime: 0,
            duration: 10,
          },
        ]
      );

      expect(args).toContain("-y");
      expect(args).toContain("-c:v");
      expect(args).toContain("copy");
      expect(args).toContain("-movflags");
      expect(args).toContain("+faststart");
      expect(args).toContain("/output.mp4");
    });

    it("includes quality flag for high quality", () => {
      // Mode 1 uses -c:v copy, so CRF isn't used.
      // But Mode 2 uses quality settings.
      const args = buildFFmpegArgs(
        "/frames",
        "/output.mp4",
        1920,
        1080,
        30,
        "high",
        10,
        [],
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        true,
        "/input.mp4"
      );

      expect(args).toContain("-crf");
      expect(args).toContain("18");
      expect(args).toContain("-preset");
      expect(args).toContain("slow");
    });

    it("handles single video with trim", () => {
      const args = buildFFmpegArgs(
        "/frames",
        "/output.mp4",
        1920,
        1080,
        30,
        "medium",
        10,
        [],
        undefined,
        undefined,
        true,
        [
          {
            path: "/video.mp4",
            startTime: 0,
            duration: 10,
            trimStart: 2,
            trimEnd: 1,
          },
        ]
      );

      expect(args).toContain("-ss");
      expect(args).toContain("2");
      // Effective duration = 10 - 2 - 1 = 7
      const tIndex = args.indexOf("-t");
      expect(args[tIndex + 1]).toBe("7");
    });

    it("handles audio with delay", () => {
      const args = buildFFmpegArgs(
        "/frames",
        "/output.mp4",
        1920,
        1080,
        30,
        "medium",
        10,
        [{ path: "/audio.mp3", startTime: 3.5 }],
        undefined,
        undefined,
        true,
        [
          {
            path: "/video.mp4",
            startTime: 0,
            duration: 10,
          },
        ]
      );

      expect(args).toContain("-filter_complex");
      // Delay should be 3500ms
      const fcIndex = args.indexOf("-filter_complex");
      expect(args[fcIndex + 1]).toContain("adelay=3500|3500");
    });

    it("uses concat demuxer for multiple videos", () => {
      const args = buildFFmpegArgs(
        "/frames",
        "/output.mp4",
        1920,
        1080,
        30,
        "medium",
        10,
        [],
        undefined,
        undefined,
        true,
        [
          {
            path: "/video1.mp4",
            startTime: 0,
            duration: 5,
          },
          {
            path: "/video2.mp4",
            startTime: 5,
            duration: 5,
          },
        ]
      );

      expect(args).toContain("-f");
      expect(args).toContain("concat");
      expect(args).toContain("-safe");
      expect(args).toContain("0");
    });
  });

  describe("error handling", () => {
    it("throws for invalid config (no mode matched)", () => {
      expect(() =>
        buildFFmpegArgs("/frames", "/output.mp4", 1920, 1080, 30, "medium", 10)
      ).toThrow("Invalid export configuration");
    });

    it("throws for multi-video with trim values", () => {
      expect(() =>
        buildFFmpegArgs(
          "/frames",
          "/output.mp4",
          1920,
          1080,
          30,
          "medium",
          10,
          [],
          undefined,
          undefined,
          true,
          [
            {
              path: "/video1.mp4",
              startTime: 0,
              duration: 5,
              trimStart: 1,
            },
            {
              path: "/video2.mp4",
              startTime: 5,
              duration: 5,
            },
          ]
        )
      ).toThrow("trim values");
    });
  });
});
