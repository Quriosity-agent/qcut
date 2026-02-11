import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT2IMAGE_MODELS } from "@/lib/text2image-models";
import {
  MAX_REVE_IMAGES,
  MAX_REVE_PROMPT_LENGTH,
} from "@/lib/ai-video/validation/validators";
import { convertSettingsToParams } from "@/lib/fal-ai-client-generation";
import { reveTextToImage } from "@/lib/fal-ai-client-reve";
import { veo31FastTextToVideo } from "@/lib/fal-ai-client-veo31";
import type { FalAIClientRequestDelegate } from "@/lib/fal-ai-client-internal-types";

const originalFetch = globalThis.fetch;

describe("fal-ai-client split compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.resetModules();
    (import.meta.env as Record<string, string>).VITE_FAL_API_KEY =
      "test-api-key";
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("fal-ai-client named exports remain available", async () => {
    const module = await import("@/lib/fal-ai-client");

    expect(typeof module.falAIClient).toBe("object");
    expect(typeof module.generateWithModel).toBe("function");
    expect(typeof module.generateWithMultipleModels).toBe("function");
    expect(typeof module.batchGenerate).toBe("function");
  });

  it("veo31FastTextToVideo is a function", () => {
    expect(typeof veo31FastTextToVideo).toBe("function");
  });

  it("generateWithModel delegates to extracted function", async () => {
    const mockGenerateWithModel = vi.fn().mockResolvedValue({
      success: true,
      imageUrl: "https://example.com/image.png",
    });

    vi.doMock("@/lib/fal-ai-client-generation", () => {
      return {
        generateWithModel: mockGenerateWithModel,
        generateWithMultipleModels: vi.fn(),
      };
    });

    const module = await import("@/lib/fal-ai-client");
    await module.generateWithModel("qwen-image", "delegate test", {
      imageSize: "square",
    });

    expect(mockGenerateWithModel).toHaveBeenCalledTimes(1);
    const [delegate] = mockGenerateWithModel.mock.calls[0] as [
      FalAIClientRequestDelegate,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(typeof delegate.makeRequest).toBe("function");

    vi.doUnmock("@/lib/fal-ai-client-generation");
  });

  it("reveTextToImage validates and sanitizes prompt inputs", async () => {
    const makeRequestMock = vi.fn().mockResolvedValue({
      images: [{ url: "https://example.com/reve.png", width: 1024, height: 1024 }],
    });
    const delegate: FalAIClientRequestDelegate = {
      makeRequest: makeRequestMock,
    };

    const longPrompt = "x".repeat(MAX_REVE_PROMPT_LENGTH + 128);
    await reveTextToImage(delegate, {
      prompt: longPrompt,
      num_images: MAX_REVE_IMAGES + 10,
    });

    const [, requestParams] = makeRequestMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];

    expect((requestParams.prompt as string).length).toBe(MAX_REVE_PROMPT_LENGTH);
    expect(requestParams.num_images).toBe(MAX_REVE_IMAGES);
  });

  it("convertSettingsToParams handles configured text-to-image models", () => {
    const modelEntries = Object.entries(TEXT2IMAGE_MODELS);

    for (const [, model] of modelEntries) {
      const params = convertSettingsToParams(model, "split refactor test", {
        imageSize: "square",
        outputFormat: "png",
      });
      expect(params.prompt).toBe("split refactor test");
    }

    expect(modelEntries.length).toBeGreaterThanOrEqual(14);
  });

  it("falAIClient proxy resolves methods correctly", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [
          {
            url: "https://example.com/proxy.png",
            width: 1024,
            height: 1024,
            content_type: "image/png",
          },
        ],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const module = await import("@/lib/fal-ai-client");
    const result = await module.falAIClient.generateWithModel(
      "qwen-image",
      "proxy generation",
      { imageSize: "square" }
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("batchGenerate export still works", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        images: [
          {
            url: "https://example.com/batch.png",
            width: 1024,
            height: 1024,
            content_type: "image/png",
          },
        ],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const module = await import("@/lib/fal-ai-client");
    const results = await module.batchGenerate(
      [
        {
          modelKey: "qwen-image",
          prompt: "batch prompt one",
          settings: { imageSize: "square" },
        },
        {
          modelKey: "flux-2-flex",
          prompt: "batch prompt two",
          settings: { imageSize: "square" },
        },
      ],
      {
        concurrency: 1,
        delayBetweenBatches: 0,
      }
    );

    expect(results).toHaveLength(2);
    expect(results[0].result.success).toBe(true);
    expect(results[1].result.success).toBe(true);
  });

  it("text2image-store dynamic import target generateWithMultipleModels still resolves", async () => {
    const module = await import("@/lib/fal-ai-client");
    expect(typeof module.generateWithMultipleModels).toBe("function");
  });
});
