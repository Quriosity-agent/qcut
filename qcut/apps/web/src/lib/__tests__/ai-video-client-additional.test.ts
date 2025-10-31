import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  ViduQ2I2VRequest,
  LTXV2T2VRequest,
  LTXV2I2VRequest,
} from "@/lib/ai-video-client";

const originalFetch = globalThis.fetch;

describe("AI video client – additional models", () => {
  // Module-level variables to hold dynamically imported functions
  let generateViduQ2Video: typeof import("@/lib/ai-video-client")["generateViduQ2Video"];
  let generateLTXV2Video: typeof import("@/lib/ai-video-client")["generateLTXV2Video"];
  let generateLTXV2ImageVideo: typeof import("@/lib/ai-video-client")["generateLTXV2ImageVideo"];

  beforeEach(async () => {
    // Clear all mocks first
    vi.clearAllMocks();

    // Set environment variable BEFORE importing the module
    // Using import.meta.env directly since vi.stubEnv is not available
    (import.meta.env as any).VITE_FAL_API_KEY = "test-api-key";

    // Dynamically import the module AFTER setting the environment
    const aiVideoClient = await import("@/lib/ai-video-client");
    generateViduQ2Video = aiVideoClient.generateViduQ2Video;
    generateLTXV2Video = aiVideoClient.generateLTXV2Video;
    generateLTXV2ImageVideo = aiVideoClient.generateLTXV2ImageVideo;
  });

  afterEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = originalFetch;
  });

  describe("generateViduQ2Video", () => {
    it("rejects prompts longer than 3000 characters", async () => {
      const longPrompt = "A".repeat(3001);
      const request: ViduQ2I2VRequest = {
        model: "vidu_q2_turbo_i2v",
        prompt: longPrompt,
        image_url: "https://example.com/image.png",
      };

      await expect(generateViduQ2Video(request)).rejects.toThrow(
        /Prompt too long for Vidu Q2/i
      );
    });

    it("requires an image url", async () => {
      const request: ViduQ2I2VRequest = {
        model: "vidu_q2_turbo_i2v",
        prompt: "A cinematic shot of a city skyline",
        image_url: "",
      };

      await expect(generateViduQ2Video(request)).rejects.toThrow(
        /Image is required for Vidu Q2/i
      );
    });

    it("sends expected payload including duration, resolution and BGM", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ video: { url: "https://example.com/video.mp4" } }) });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const request: ViduQ2I2VRequest = {
        model: "vidu_q2_turbo_i2v",
        prompt: "A peaceful waterfall flowing through lush forest",
        image_url: "https://example.com/image.png",
        duration: 4,
        resolution: "1080p",
        movement_amplitude: "large",
        bgm: true,
      };

      await generateViduQ2Video(request);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      expect(options?.method).toBe("POST");

      const payload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(payload.prompt).toContain("waterfall");
      expect(payload.duration).toBe(4);
      expect(payload.resolution).toBe("1080p");
      expect(payload.movement_amplitude).toBe("large");
      expect(payload.bgm).toBe(true);
    });

    it("omits BGM flag when duration is not 4 seconds", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ video: { url: "https://example.com/video.mp4" } }) });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const request: ViduQ2I2VRequest = {
        model: "vidu_q2_turbo_i2v",
        prompt: "Evening lights over the city skyline",
        image_url: "https://example.com/image.png",
        duration: 6,
        bgm: true,
      };

      await generateViduQ2Video(request);
      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(payload.duration).toBe(6);
      expect(payload).not.toHaveProperty("bgm");
    });
  });

  describe("generateLTXV2Video", () => {
    it("rejects empty prompts", async () => {
      const request: LTXV2T2VRequest = {
        model: "ltxv2_pro_t2v",
        prompt: "",
      };

      await expect(generateLTXV2Video(request)).rejects.toThrow(
        /Please enter a text prompt/i
      );
    });

    it("rejects invalid resolutions", async () => {
      const request: LTXV2T2VRequest = {
        model: "ltxv2_pro_t2v",
        prompt: "A drone shot over snowy mountains",
        resolution: "720p" as any,
      };

      await expect(generateLTXV2Video(request)).rejects.toThrow(
        /Resolution must be 1080p, 1440p, or 2160p/i
      );
    });

    it("sends expected payload with duration, resolution and fps", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ video: { url: "https://example.com/video.mp4" } }) });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const request: LTXV2T2VRequest = {
        model: "ltxv2_pro_t2v",
        prompt: "A cinematic tracking shot through neon-lit streets",
        duration: 8,
        resolution: "1440p",
        fps: 50,
        generate_audio: false,
      };

      await generateLTXV2Video(request);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );
      expect(payload.duration).toBe(8);
      expect(payload.resolution).toBe("1440p");
      expect(payload.fps).toBe(50);
      expect(payload.generate_audio).toBe(false);
    });
  });

  describe("generateLTXV2ImageVideo", () => {
    it("requires a prompt", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_fast_i2v",
        prompt: "",
        image_url: "https://example.com/frame.png",
      };

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Please enter a text prompt/i
      );
    });

    it("requires an image url", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_fast_i2v",
        prompt: "A nighttime aerial shot over a futuristic city",
        image_url: "",
      };

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Image is required/i
      );
    });

    it("rejects invalid duration", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_fast_i2v",
        prompt: "A drone shot over the coast",
        image_url: "https://example.com/frame.png",
        duration: 8 as any,
      };

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Duration must be between 2 and 6 seconds/i
      );
    });

    it("sends expected payload", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ video: { url: "https://example.com/video.mp4" } }) });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const request: LTXV2I2VRequest = {
        model: "ltxv2_fast_i2v",
        prompt: "Slow cinematic dolly forward through a forest",
        image_url: "https://example.com/frame.png",
        duration: 5,
        resolution: "1080p",  // Fixed: 720p is not supported by LTX Video 2.0 Fast I2V
        fps: 50,
        generate_audio: false,
      };

      await generateLTXV2ImageVideo(request);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );

      expect(payload.duration).toBe(5);
      expect(payload.resolution).toBe("1080p");  // Fixed: expecting correct resolution
      expect(payload.fps).toBe(50);
      expect(payload.generate_audio).toBe(false);
      expect(payload.image_url).toBe("https://example.com/frame.png");
    });

    it("rejects unsupported 720p resolution for fast model", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_fast_i2v",
        prompt: "Camera pans across a landscape",
        image_url: "https://example.com/frame.png",
        resolution: "720p" as any,  // Intentionally using unsupported resolution
      };

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Resolution must be 1080p, 1440p, or 2160p for LTX Video 2.0 Fast/i
      );
    });

    it("requires a prompt for the standard model", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "",
        image_url: "https://example.com/frame.png",
      };

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /video motion/i
      );
    });

    it("requires an image url for the standard model", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "A sweeping aerial shot of a coastal city",
        image_url: "",
      };

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Image URL is required/i
      );
    });

    it("sends expected payload for the standard model", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ video: { url: "https://example.com/video.mp4" } }) });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "A slow cinematic reveal of a futuristic skyline at sunset",
        image_url: "https://example.com/frame.png",
        duration: 10,
        resolution: "2160p",
        fps: 50,
        generate_audio: false,
      };

      await generateLTXV2ImageVideo(request);

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(
        (options as Record<string, unknown>).body as string
      );

      expect(payload.duration).toBe(10);
      expect(payload.resolution).toBe("2160p");
      expect(payload.fps).toBe(50);
      expect(payload.generate_audio).toBe(false);
    });

    it("rejects invalid duration for the standard model", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "A smooth orbit around a mountain peak",
        image_url: "https://example.com/frame.png",
        duration: 4 as any,
      };

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Duration must be 6, 8, or 10 seconds/i
      );
    });

    it("rejects invalid resolution for the standard model", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "A steady glide through a neon alley",
        image_url: "https://example.com/frame.png",
        resolution: "720p" as any,
      };

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Resolution must be 1080p, 1440p, or 2160p/i
      );
    });

    it("surfaces 413 errors with helpful guidance for the standard model", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "A tranquil lakeside scene with gentle camera movement",
        image_url: "https://example.com/large-image.png",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        statusText: "Payload Too Large",
        json: async () => ({ detail: "Image exceeds limit" }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Maximum size is 7MB/i
      );
    });
  });
});
