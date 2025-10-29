import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateViduQ2Video,
  generateLTXV2Video,
  generateLTXV2ImageVideo,
} from "@/lib/ai-video-client";
import type {
  ViduQ2I2VRequest,
  LTXV2T2VRequest,
  LTXV2I2VRequest,
} from "@/lib/ai-video-client";

const originalFetch = globalThis.fetch;

describe("AI video client – additional models", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_FAL_API_KEY", "test-api-key");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
        resolution: "720p",
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
      expect(payload.resolution).toBe("720p");
      expect(payload.fps).toBe(50);
      expect(payload.generate_audio).toBe(false);
      expect(payload.image_url).toBe("https://example.com/frame.png");
    });
  });
});
