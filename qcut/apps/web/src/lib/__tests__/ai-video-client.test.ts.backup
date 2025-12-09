import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TextToVideoRequest } from "@/lib/ai-video-client";

const originalFetch = globalThis.fetch;

describe("generateVideoFromText - Hailuo 2.3 Text-to-Video", () => {
  // Module-level variable to hold dynamically imported function
  let generateVideoFromText: typeof import("@/lib/ai-video-client")["generateVideoFromText"];

  beforeEach(async () => {
    // Clear and restore all mocks first
    vi.restoreAllMocks();
    vi.clearAllMocks();

    // Set environment variable BEFORE importing the module
    // Using import.meta.env directly since vi.stubEnv is not available
    (import.meta.env as any).VITE_FAL_API_KEY = "test-api-key";

    // Dynamically import the module AFTER setting the environment
    const aiVideoClient = await import("@/lib/ai-video-client");
    generateVideoFromText = aiVideoClient.generateVideoFromText;

    globalThis.fetch = originalFetch as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch as typeof globalThis.fetch;
  });

  describe("Prompt Validation", () => {
    it("should reject prompts exceeding 1500 chars for Standard model", async () => {
      const longPrompt = "A".repeat(1501);
      const request: TextToVideoRequest = {
        model: "hailuo23_standard_t2v",
        prompt: longPrompt,
        duration: 6,
      };

      await expect(generateVideoFromText(request)).rejects.toThrow(
        /Prompt too long.*Maximum 1500 characters/
      );
    });

    it("should reject prompts exceeding 2000 chars for Pro model", async () => {
      const longPrompt = "A".repeat(2001);
      const request: TextToVideoRequest = {
        model: "hailuo23_pro_t2v",
        prompt: longPrompt,
        duration: 6,
      };

      await expect(generateVideoFromText(request)).rejects.toThrow(
        /Prompt too long.*Maximum 2000 characters/
      );
    });

    it("should accept prompts within limit for Standard model", async () => {
      const validPrompt = "A".repeat(1500);
      const request: TextToVideoRequest = {
        model: "hailuo23_standard_t2v",
        prompt: validPrompt,
        duration: 6,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const result = await generateVideoFromText(request);
      expect(result.status).toBe("completed");
      expect(result.video_url).toBeTruthy();
    });

    it("should reject empty prompts", async () => {
      const request: TextToVideoRequest = {
        model: "hailuo23_standard_t2v",
        prompt: "",
        duration: 6,
      };

      await expect(generateVideoFromText(request)).rejects.toThrow(
        /Text prompt is required/
      );
    });
  });

  describe("Duration Handling", () => {
    it('should use "6" string for 6-second duration on Standard model', async () => {
      const request: TextToVideoRequest = {
        model: "hailuo23_standard_t2v",
        prompt: "A mountain biker on a forest trail",
        duration: 6,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateVideoFromText(request);

      const [, options] = fetchMock.mock.calls[0];
      const callPayload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(callPayload.duration).toBe("6");
    });

    it('should use "10" string for 10-second duration on Standard model', async () => {
      const request: TextToVideoRequest = {
        model: "hailuo23_standard_t2v",
        prompt: "A mountain biker on a forest trail",
        duration: 10,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateVideoFromText(request);

      const [, options] = fetchMock.mock.calls[0];
      const callPayload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(callPayload.duration).toBe("10");
    });
  });

  describe("Model Configuration", () => {
    it("should use correct endpoint for Standard T2V model", async () => {
      const request: TextToVideoRequest = {
        model: "hailuo23_standard_t2v",
        prompt: "A serene landscape at sunset",
        duration: 6,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateVideoFromText(request);

      const [callUrl] = fetchMock.mock.calls[0];
      expect(callUrl).toContain(
        "fal-ai/minimax/hailuo-2.3/standard/text-to-video"
      );
    });

    it("should use correct endpoint for Pro T2V model", async () => {
      const request: TextToVideoRequest = {
        model: "hailuo23_pro_t2v",
        prompt: "[Pan left] A serene landscape at sunset [Zoom in]",
        duration: 6,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateVideoFromText(request);

      const [callUrl] = fetchMock.mock.calls[0];
      expect(callUrl).toContain("fal-ai/minimax/hailuo-2.3/pro/text-to-video");
    });

    it("should include prompt_optimizer in payload when specified", async () => {
      const request: TextToVideoRequest = {
        model: "hailuo23_pro_t2v",
        prompt: "A mountain scene",
        prompt_optimizer: false,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateVideoFromText(request);

      const [, options] = fetchMock.mock.calls[0];
      const callPayload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(callPayload.prompt_optimizer).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should throw error when FAL API returns 401", async () => {
      const request: TextToVideoRequest = {
        model: "hailuo23_standard_t2v",
        prompt: "Test prompt",
        duration: 6,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ detail: "Invalid API key" }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await expect(generateVideoFromText(request)).rejects.toThrow(
        /Invalid FAL.ai API key/
      );
    });

    it("should throw error when model does not support text-to-video", async () => {
      const request: TextToVideoRequest = {
        model: "hailuo23_standard",
        prompt: "Test prompt",
        duration: 6,
      };

      await expect(generateVideoFromText(request)).rejects.toThrow(
        /does not support text-to-video generation/
      );
    });
  });
});
