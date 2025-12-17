import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Test validators
describe("WAN v2.6 Ref2Video Validators", () => {
  let isWAN26Ref2VideoModel: typeof import("@/lib/ai-video")["isWAN26Ref2VideoModel"];
  let validateWAN26RefVideoUrl: typeof import("@/lib/ai-video")["validateWAN26RefVideoUrl"];
  let isWAN26Model: typeof import("@/lib/ai-video")["isWAN26Model"];

  beforeEach(async () => {
    vi.resetModules();
    const validators = await import("@/lib/ai-video");
    isWAN26Ref2VideoModel = validators.isWAN26Ref2VideoModel;
    validateWAN26RefVideoUrl = validators.validateWAN26RefVideoUrl;
    isWAN26Model = validators.isWAN26Model;
  });

  describe("isWAN26Ref2VideoModel", () => {
    it("should return true for wan_26_ref2v model", () => {
      expect(isWAN26Ref2VideoModel("wan_26_ref2v")).toBe(true);
    });

    it("should return false for other WAN v2.6 models", () => {
      expect(isWAN26Ref2VideoModel("wan_26_t2v")).toBe(false);
      expect(isWAN26Ref2VideoModel("wan_26_i2v")).toBe(false);
    });

    it("should return false for non-WAN models", () => {
      expect(isWAN26Ref2VideoModel("sora2_text_to_video")).toBe(false);
      expect(isWAN26Ref2VideoModel("kling_o1_v2v_reference")).toBe(false);
      expect(isWAN26Ref2VideoModel("unknown_model")).toBe(false);
    });
  });

  describe("isWAN26Model", () => {
    it("should include wan_26_ref2v as a WAN v2.6 model", () => {
      expect(isWAN26Model("wan_26_ref2v")).toBe(true);
    });

    it("should return true for all WAN v2.6 variants", () => {
      expect(isWAN26Model("wan_26_t2v")).toBe(true);
      expect(isWAN26Model("wan_26_i2v")).toBe(true);
      expect(isWAN26Model("wan_26_ref2v")).toBe(true);
    });

    it("should return false for WAN v2.5 models", () => {
      expect(isWAN26Model("wan_25_1080p")).toBe(false);
      expect(isWAN26Model("wan_25_720p")).toBe(false);
    });
  });

  describe("validateWAN26RefVideoUrl", () => {
    it("should throw error when reference video URL is undefined", () => {
      expect(() => validateWAN26RefVideoUrl(undefined)).toThrow(
        "Reference video is required for WAN v2.6 reference-to-video generation"
      );
    });

    it("should throw error when reference video URL is empty string", () => {
      expect(() => validateWAN26RefVideoUrl("")).toThrow(
        "Reference video is required for WAN v2.6 reference-to-video generation"
      );
    });

    it("should not throw for valid reference video URL", () => {
      expect(() =>
        validateWAN26RefVideoUrl("https://example.com/video.mp4")
      ).not.toThrow();
    });

    it("should accept data URLs", () => {
      expect(() =>
        validateWAN26RefVideoUrl("data:video/mp4;base64,AAAA")
      ).not.toThrow();
    });
  });
});

// Test generator function
describe("generateWAN26RefVideo", () => {
  const originalFetch = globalThis.fetch;
  let generateWAN26RefVideo: typeof import("@/lib/ai-video")["generateWAN26RefVideo"];

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    // Set environment variable BEFORE importing
    (import.meta.env as Record<string, string>).VITE_FAL_API_KEY =
      "test-api-key";

    // Dynamically import after setting env
    const aiVideo = await import("@/lib/ai-video");
    generateWAN26RefVideo = aiVideo.generateWAN26RefVideo;

    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  describe("Input Validation", () => {
    it("should throw error when reference_video_url is missing", async () => {
      await expect(
        generateWAN26RefVideo({
          model: "wan_26_ref2v",
          prompt: "A person walking",
          reference_video_url: "",
        })
      ).rejects.toThrow(/Reference video is required/);
    });

    it("should throw error when prompt is empty", async () => {
      await expect(
        generateWAN26RefVideo({
          model: "wan_26_ref2v",
          prompt: "",
          reference_video_url: "https://example.com/video.mp4",
        })
      ).rejects.toThrow(/prompt/i);
    });

    it("should throw error when prompt is only whitespace", async () => {
      await expect(
        generateWAN26RefVideo({
          model: "wan_26_ref2v",
          prompt: "   ",
          reference_video_url: "https://example.com/video.mp4",
        })
      ).rejects.toThrow(/prompt/i);
    });
  });

  describe("Default Parameters", () => {
    it("should apply default duration of 5 seconds", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          video: { url: "https://example.com/output.mp4" },
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateWAN26RefVideo({
        model: "wan_26_ref2v",
        prompt: "A person walking in the park",
        reference_video_url: "https://example.com/ref.mp4",
      });

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(payload.duration).toBe(5);
    });

    it("should apply default resolution of 1080p", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          video: { url: "https://example.com/output.mp4" },
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateWAN26RefVideo({
        model: "wan_26_ref2v",
        prompt: "A person walking in the park",
        reference_video_url: "https://example.com/ref.mp4",
      });

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(payload.resolution).toBe("1080p");
    });

    it("should apply default aspect_ratio of 16:9", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          video: { url: "https://example.com/output.mp4" },
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateWAN26RefVideo({
        model: "wan_26_ref2v",
        prompt: "A person walking in the park",
        reference_video_url: "https://example.com/ref.mp4",
      });

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(payload.aspect_ratio).toBe("16:9");
    });
  });

  describe("Custom Parameters", () => {
    it("should accept custom duration values", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          video: { url: "https://example.com/output.mp4" },
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateWAN26RefVideo({
        model: "wan_26_ref2v",
        prompt: "A person running",
        reference_video_url: "https://example.com/ref.mp4",
        duration: 10,
      });

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(payload.duration).toBe(10);
    });

    it("should accept custom resolution values", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          video: { url: "https://example.com/output.mp4" },
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateWAN26RefVideo({
        model: "wan_26_ref2v",
        prompt: "A scenic view",
        reference_video_url: "https://example.com/ref.mp4",
        resolution: "720p",
      });

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(payload.resolution).toBe("720p");
    });

    it("should include negative_prompt when provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          video: { url: "https://example.com/output.mp4" },
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateWAN26RefVideo({
        model: "wan_26_ref2v",
        prompt: "A beautiful sunset",
        reference_video_url: "https://example.com/ref.mp4",
        negative_prompt: "blurry, low quality",
      });

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(payload.negative_prompt).toBe("blurry, low quality");
    });

    it("should include audio_url when provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          video: { url: "https://example.com/output.mp4" },
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateWAN26RefVideo({
        model: "wan_26_ref2v",
        prompt: "A music video",
        reference_video_url: "https://example.com/ref.mp4",
        audio_url: "https://example.com/audio.mp3",
      });

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(payload.audio_url).toBe("https://example.com/audio.mp3");
    });
  });

  describe("API Endpoint", () => {
    it("should use correct FAL endpoint for WAN v2.6 Ref2Video", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          video: { url: "https://example.com/output.mp4" },
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateWAN26RefVideo({
        model: "wan_26_ref2v",
        prompt: "Test prompt",
        reference_video_url: "https://example.com/ref.mp4",
      });

      const [callUrl] = fetchMock.mock.calls[0];
      expect(callUrl).toContain("fal-ai/wan/v2.6/reference-to-video");
    });
  });

  describe("Response Handling", () => {
    it("should return completed status on success", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          video: { url: "https://example.com/output.mp4" },
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const result = await generateWAN26RefVideo({
        model: "wan_26_ref2v",
        prompt: "A scenic view",
        reference_video_url: "https://example.com/ref.mp4",
      });

      expect(result.status).toBe("completed");
      expect(result.video_url).toBe("https://example.com/output.mp4");
    });

    it("should include job_id in response", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          video: { url: "https://example.com/output.mp4" },
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const result = await generateWAN26RefVideo({
        model: "wan_26_ref2v",
        prompt: "A scenic view",
        reference_video_url: "https://example.com/ref.mp4",
      });

      expect(result.job_id).toBeDefined();
      expect(typeof result.job_id).toBe("string");
    });
  });

  describe("Error Handling", () => {
    it("should throw error when FAL API returns 401", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ detail: "Invalid API key" }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await expect(
        generateWAN26RefVideo({
          model: "wan_26_ref2v",
          prompt: "Test prompt",
          reference_video_url: "https://example.com/ref.mp4",
        })
      ).rejects.toThrow(/Invalid FAL.ai API key/);
    });

    it("should throw error when FAL API returns 500", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ detail: "Server error" }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await expect(
        generateWAN26RefVideo({
          model: "wan_26_ref2v",
          prompt: "Test prompt",
          reference_video_url: "https://example.com/ref.mp4",
        })
      ).rejects.toThrow();
    });
  });
});
