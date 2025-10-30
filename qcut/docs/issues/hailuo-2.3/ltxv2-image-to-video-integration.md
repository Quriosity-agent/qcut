# LTX Video 2.0 Image-to-Video Integration Guide

Documentation for integrating **LTX Video 2.0 Image-to-Video** (standard version) into QCut.

**Model:** LTX Video 2.0 Pro - Image-to-Video with Audio Generation
**Provider:** Fal.ai
**Endpoint:** `fal-ai/ltxv-2/image-to-video`
**Category:** Image-to-Video with Audio

---

## Overview

LTX Video 2.0 Image-to-Video transforms static images into high-quality videos with synchronized audio generation. Unlike the "Fast" variant documented elsewhere, this standard version offers more flexibility in duration and resolution options.

### Key Features
- **High Resolution:** Up to 4K (2160p) output
- **Audio Generation:** Synchronized background audio
- **Flexible Duration:** 6, 8, or 10 seconds
- **High Frame Rate:** 25 or 50 FPS options
- **Commercial License:** Suitable for commercial use

### Differences from Fast I2V Variant

| Feature | Standard I2V | Fast I2V |
|---------|--------------|----------|
| Endpoint | `fal-ai/ltxv-2/image-to-video` | `fal-ai/ltxv-2/image-to-video/fast` |
| Duration | 6, 8, 10 seconds | 2-6 seconds |
| Max Resolution | 2160p (4K) | 1080p |
| Processing Speed | Slower, higher quality | Faster, optimized |
| Use Case | Final output, high-quality | Quick previews, iterations |

---

## Model Specifications

### API Parameters

| Parameter | Type | Required | Default | Options | Description |
|-----------|------|----------|---------|---------|-------------|
| `image_url` | string | Yes | - | Valid URL | Input image (PNG, JPEG, WebP, AVIF, HEIF, max 7MB) |
| `prompt` | string | Yes | - | Text | Natural language description of desired motion/action |
| `duration` | integer | Optional | 6 | 6, 8, 10 | Video length in seconds |
| `resolution` | string | Optional | 1080p | 1080p, 1440p, 2160p | Output quality |
| `aspect_ratio` | string | Optional | 16:9 | 16:9 | Video aspect ratio (currently only 16:9) |
| `fps` | integer | Optional | 25 | 25, 50 | Frames per second |
| `generate_audio` | boolean | Optional | true | true/false | Generate synchronized audio |

### Response Format
```typescript
{
  video: {
    file_name: string;      // Generated filename
    content_type: string;   // "video/mp4"
    url: string;            // Direct download URL
    width: number;          // Video width in pixels (1920, 2560, or 3840)
    height: number;         // Video height in pixels (1080, 1440, or 2160)
    fps: number;            // Frames per second
    duration: number;       // Length in seconds
    num_frames: number;     // Total frame count
  }
}

```
### Supported Image Formats
- PNG
- JPEG
- WebP
- AVIF
- HEIF
- **Max file size:** 7.0 MB

### Image Upload Methods
1. **Publicly accessible URL** (direct link)
2. **Base64 data URI** (embedded image data)
3. **Fal.ai storage** (via `fal.storage.upload()`)

---

## Pricing

| Resolution | Cost per Second | 6s Video | 8s Video | 10s Video |
|------------|----------------|----------|----------|-----------|
| 1080p | $0.06 | $0.36 | $0.48 | $0.60 |
| 1440p | $0.12 | $0.72 | $0.96 | $1.20 |
| 2160p (4K) | $0.24 | $1.44 | $1.92 | $2.40 |

**Note:** Audio generation is included in the base price.

---

## Implementation

### Subtask 1: Add Model Configuration

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

Add to the `AI_MODELS` array:

```typescript
{
  id: "ltxv2_i2v",
  name: "LTX Video 2.0 I2V",
  description: "Image-to-video with audio generation (6-10s, up to 4K)",
  price: "0.36", // 6 second baseline @ $0.06/sec (UI expects display-ready total)
  resolution: "1080p",
  max_duration: 10,
  category: "image",
  endpoints: {
    image_to_video: "fal-ai/ltxv-2/image-to-video",
  },
  default_params: {
    duration: 6,
    resolution: "1080p",
    aspect_ratio: "16:9",
    fps: 25,
    generate_audio: true,
  },
  supportedResolutions: ["1080p", "1440p", "2160p"],
  supportedDurations: [6, 8, 10],
},
```
> NOTE: Keep the existing `ltxv2_fast_i2v` entry unchanged. The UI presents both variants, so do not overwrite the fast model configuration.

Update `AIModel` in `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts` to include an optional `supportedDurations?: number[];` property so the new metadata type-checks.

Add error messages to `ERROR_MESSAGES`:

```typescript
LTXV2_STD_I2V_EMPTY_PROMPT: "Please enter a prompt describing the desired video motion",
LTXV2_STD_I2V_MISSING_IMAGE: "Image is required for LTX Video 2.0 image-to-video generation",
LTXV2_STD_I2V_INVALID_DURATION: "Duration must be 6, 8, or 10 seconds for LTX Video 2.0",
LTXV2_STD_I2V_INVALID_RESOLUTION: "Resolution must be 1080p, 1440p, or 2160p for LTX Video 2.0",
LTXV2_STD_I2V_IMAGE_TOO_LARGE: "Image file must be under 7MB for LTX Video 2.0",
LTXV2_STD_I2V_INVALID_FORMAT: "Image must be PNG, JPEG, WebP, AVIF, or HEIF format",
```
Keep the existing fast-model error keys (`LTXV2_I2V_*`) as-is so current validations continue to work.


---

### Subtask 2: Implement Client Function

**File:** `qcut/apps/web/src/lib/ai-video-client.ts`

#### A) Add TypeScript Interface

```typescript
export interface LTXV2I2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 2 | 3 | 4 | 5 | 6 | 8 | 10;
  resolution?: "720p" | "1080p" | "1440p" | "2160p";
  aspect_ratio?: "16:9";
  fps?: 25 | 50;
  generate_audio?: boolean;
}
```

#### B) Add Validation Helpers

```typescript
const LTXV2_STANDARD_DURATIONS = [6, 8, 10] as const;
const LTXV2_STANDARD_RESOLUTIONS = ["1080p", "1440p", "2160p"] as const;
const LTXV2_FAST_DURATIONS = [2, 3, 4, 5, 6] as const;
const LTXV2_FAST_RESOLUTIONS = ["720p", "1080p"] as const;

function isStandardLTXV2I2V(modelId: string): boolean {
  return modelId === "ltxv2_i2v";
}

function validateLTXV2I2VDuration(duration: number, modelId: string): void {
  const allowedDurations = isStandardLTXV2I2V(modelId)
    ? LTXV2_STANDARD_DURATIONS
    : LTXV2_FAST_DURATIONS;

  if (!allowedDurations.includes(duration)) {
    throw new Error(
      isStandardLTXV2I2V(modelId)
        ? "Duration must be 6, 8, or 10 seconds for LTX Video 2.0"
        : "Duration must be between 2 and 6 seconds for LTX Video 2.0 Fast"
    );
  }
}

function validateLTXV2I2VResolution(resolution: string, modelId: string): void {
  const allowedResolutions = isStandardLTXV2I2V(modelId)
    ? LTXV2_STANDARD_RESOLUTIONS
    : LTXV2_FAST_RESOLUTIONS;

  if (!allowedResolutions.includes(resolution)) {
    throw new Error(
      isStandardLTXV2I2V(modelId)
        ? "Resolution must be 1080p, 1440p, or 2160p for LTX Video 2.0"
        : "Resolution must be 720p or 1080p for LTX Video 2.0 Fast"
    );
  }
}

#### C) Implement Main Function

```typescript
/**
 * Generate video with audio from image using LTX Video 2.0
 */
export async function generateLTXV2ImageVideo(
  request: LTXV2I2VRequest
): Promise<VideoGenerationResponse> {
  try {
    if (!FAL_API_KEY) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt?.trim() ?? "";
    const isStandard = isStandardLTXV2I2V(request.model);

    if (!trimmedPrompt) {
      throw new Error(
        isStandard
          ? "Please enter a prompt describing the desired video motion"
          : "Please enter a text prompt for LTX Video 2.0 Fast image-to-video"
      );
    }

    if (!request.image_url) {
      throw new Error(
        isStandard
          ? "Image URL is required for LTX Video 2.0 image-to-video generation"
          : "Image is required for LTX Video 2.0 Fast image-to-video generation"
      );
    }

    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.image_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support image-to-video generation`
      );
    }

    const duration =
      request.duration ??
      (typeof modelConfig.default_params?.duration === "number"
        ? (modelConfig.default_params.duration as number)
        : isStandard
          ? 6
          : 4);
    validateLTXV2I2VDuration(duration, request.model);

    const resolution =
      request.resolution ??
      (modelConfig.default_params?.resolution as string | undefined) ??
      (isStandard ? "1080p" : "1080p");
    validateLTXV2I2VResolution(resolution, request.model);

    const fps =
      request.fps ??
      (modelConfig.default_params?.fps as number | undefined) ??
      25;
    if (![25, 50].includes(fps)) {
      throw new Error("FPS must be either 25 or 50 for LTX Video 2.0");
    }

    const payload: Record<string, any> = {
      ...(modelConfig.default_params || {}),
      image_url: request.image_url,
      prompt: trimmedPrompt,
      duration,
      resolution,
      aspect_ratio: request.aspect_ratio ?? "16:9",
      fps,
      generate_audio:
        request.generate_audio !== undefined
          ? request.generate_audio
          : modelConfig.default_params?.generate_audio ?? true,
    };

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }

      if (response.status === 413) {
        throw new Error(
          "Image file too large. Maximum size is 7MB for LTX Video 2.0 image-to-video."
        );
      }

      throw new Error(`FAL API error: ${errorData.detail || response.statusText}`);
    }

    const result = await response.json();
    return {
      job_id: generateJobId(),
      status: "completed",
      message: `Video with audio generated from image using ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.url,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate LTX Video 2.0 I2V", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateLTXV2ImageVideo",
    });
    throw error;
  }
}

```
---

### Subtask 3: Update UI Components

#### A) Add Type Definitions

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`

```typescript
export interface UseAIGenerationProps {
  // ... existing props ...

  // LTX Video 2.0 I2V options
  ltxv2I2VDuration?: 6 | 8 | 10;
  ltxv2I2VResolution?: "1080p" | "1440p" | "2160p";
  ltxv2I2VFPS?: 25 | 50;
  ltxv2I2VGenerateAudio?: boolean;
}
```

#### B) Update Hook Logic

**File:** `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

Add import:
```typescript
import {
  // ... existing imports ...
  generateLTXV2ImageVideo,
} from "@/lib/ai-video-client";
```

Add defaults in hook:
```typescript
export function useAIGeneration(props: UseAIGenerationProps) {
  const {
    // ... existing props ...
    ltxv2I2VDuration = 6,
    ltxv2I2VResolution = "1080p",
    ltxv2I2VFPS = 25,
    ltxv2I2VGenerateAudio = true,
  } = props;
```

Add logic in image-to-video section:
```typescript
// In the image-to-video section:
if (modelId === "ltxv2_i2v") {
  const friendlyName = modelName || modelId;
  progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${friendlyName} request...`,
  });

  const ltxRequest = {
    model: modelId,
    prompt: prompt.trim(),
    image_url: mediaUrl,
    duration: ltxv2I2VDuration,
    resolution: ltxv2I2VResolution,
    fps: ltxv2I2VFPS,
    generate_audio: ltxv2I2VGenerateAudio,
  };

  response = await generateLTXV2ImageVideo(ltxRequest);

  progressCallback({
    status: "completed",
    progress: 100,
    message: `Video with audio generated from image using ${friendlyName}`,
  });
}
```

#### C) Add UI Controls

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

Add state management:
```typescript
export function AiView() {
  // ... existing state ...

  // LTX Video 2.0 I2V state
  const [ltxv2I2VDuration, setLTXV2I2VDuration] = useState<6 | 8 | 10>(6);
  const [ltxv2I2VResolution, setLTXV2I2VResolution] = useState<"1080p" | "1440p" | "2160p">("1080p");
  const [ltxv2I2VFPS, setLTXV2I2VFPS] = useState<25 | 50>(25);
  const [ltxv2I2VGenerateAudio, setLTXV2I2VGenerateAudio] = useState(true);

  const ltxv2I2VSelected = selectedModels.includes("ltxv2_i2v");

  // Pass to hook
  const { isGenerating, /* ... */ } = useAIGeneration({
    // ... existing props ...
    ltxv2I2VDuration,
    ltxv2I2VResolution,
    ltxv2I2VFPS,
    ltxv2I2VGenerateAudio,
  });
```

Add UI controls:
```tsx
{ltxv2I2VSelected && (
  <div className="space-y-3 text-left border-t pt-3">
    <Label className="text-sm font-semibold">LTX Video 2.0 I2V Settings</Label>

    {/* Duration selector */}
    <div className="space-y-1">
      <Label htmlFor="ltxv2-i2v-duration" className="text-xs font-medium">
        Duration
      </Label>
      <Select
        value={ltxv2I2VDuration.toString()}
        onValueChange={(value) => setLTXV2I2VDuration(Number(value) as 6 | 8 | 10)}
      >
        <SelectTrigger id="ltxv2-i2v-duration" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="6">6 seconds</SelectItem>
          <SelectItem value="8">8 seconds</SelectItem>
          <SelectItem value="10">10 seconds</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* Resolution selector */}
    <div className="space-y-1">
      <Label htmlFor="ltxv2-i2v-resolution" className="text-xs font-medium">
        Resolution
      </Label>
      <Select
        value={ltxv2I2VResolution}
        onValueChange={(value) => setLTXV2I2VResolution(value as "1080p" | "1440p" | "2160p")}
      >
        <SelectTrigger id="ltxv2-i2v-resolution" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1080p">1080p ($0.06/sec)</SelectItem>
          <SelectItem value="1440p">1440p ($0.12/sec)</SelectItem>
          <SelectItem value="2160p">4K ($0.24/sec)</SelectItem>
        </SelectContent>
      </Select>
      <div className="text-xs text-muted-foreground">
        Estimated cost: ${(
          ltxv2I2VDuration *
          (ltxv2I2VResolution === "1080p" ? 0.06 :
           ltxv2I2VResolution === "1440p" ? 0.12 : 0.24)
        ).toFixed(2)}
      </div>
    </div>

    {/* Frame rate selector */}
    <div className="space-y-1">
      <Label htmlFor="ltxv2-i2v-fps" className="text-xs font-medium">
        Frame Rate
      </Label>
      <Select
        value={ltxv2I2VFPS.toString()}
        onValueChange={(value) => setLTXV2I2VFPS(Number(value) as 25 | 50)}
      >
        <SelectTrigger id="ltxv2-i2v-fps" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="25">25 FPS (Standard)</SelectItem>
          <SelectItem value="50">50 FPS (High)</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* Audio generation toggle */}
    <div className="flex items-center space-x-2">
      <Checkbox
        id="ltxv2-i2v-audio"
        checked={ltxv2I2VGenerateAudio}
        onCheckedChange={(checked) => setLTXV2I2VGenerateAudio(checked as boolean)}
      />
      <Label htmlFor="ltxv2-i2v-audio" className="text-xs cursor-pointer">
        Generate synchronized audio
      </Label>
    </div>

    <div className="text-xs text-muted-foreground">
      Transforms your image into a high-quality video with matching audio
    </div>
  </div>
)}
```

---

### Subtask 4: Write Tests

**File:** `qcut/apps/web/src/lib/__tests__/ai-video-client-ltxv2-i2v.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateLTXV2ImageVideo } from "@/lib/ai-video-client";
import type { LTXV2I2VRequest } from "@/lib/ai-video-client";

const originalFetch = globalThis.fetch;

describe("LTX Video 2.0 Image-to-Video", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_FAL_API_KEY", "test-api-key");
    globalThis.fetch = originalFetch as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch as typeof globalThis.fetch;
  });

  describe("Input Validation", () => {
    it("should reject empty prompts", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "",
        image_url: "https://example.com/image.jpg",
      };

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /video motion/
      );
    });

    it("should reject missing image URL", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "A woman walking through the city",
        image_url: "",
      };

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Image URL is required/
      );
    });

    it("should accept valid prompt and image", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "A woman walking through the city",
        image_url: "https://example.com/image.jpg",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          video: {
            url: "https://example.com/video.mp4",
            width: 1920,
            height: 1080,
            duration: 6,
            fps: 25
          }
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const result = await generateLTXV2ImageVideo(request);
      expect(result.status).toBe("completed");
      expect(result.video_url).toBeTruthy();
    });
  });

  describe("Duration Validation", () => {
    it("should accept valid durations (6, 8, 10)", async () => {
      const durations = [6, 8, 10] as const;

      for (const duration of durations) {
        const request: LTXV2I2VRequest = {
          model: "ltxv2_i2v",
          prompt: "Test motion",
          image_url: "https://example.com/image.jpg",
          duration,
        };

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
        });
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        const result = await generateLTXV2ImageVideo(request);
        expect(result.status).toBe("completed");

        const [, options] = fetchMock.mock.calls[0];
        const payload = JSON.parse((options as Record<string, unknown>).body as string);
        expect(payload.duration).toBe(duration);
      }
    });

    it("should reject invalid durations", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "Test motion",
        image_url: "https://example.com/image.jpg",
        duration: 5 as any,
      };

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Duration must be 6, 8, or 10 seconds/
      );
    });
  });

  describe("Resolution Validation", () => {
    it("should accept valid resolutions (1080p, 1440p, 2160p)", async () => {
      const resolutions = ["1080p", "1440p", "2160p"] as const;

      for (const resolution of resolutions) {
        const request: LTXV2I2VRequest = {
          model: "ltxv2_i2v",
          prompt: "Test motion",
          image_url: "https://example.com/image.jpg",
          resolution,
        };

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
        });
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        const result = await generateLTXV2ImageVideo(request);
        expect(result.status).toBe("completed");

        const [, options] = fetchMock.mock.calls[0];
        const payload = JSON.parse((options as Record<string, unknown>).body as string);
        expect(payload.resolution).toBe(resolution);
      }
    });

    it("should reject invalid resolutions", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "Test motion",
        image_url: "https://example.com/image.jpg",
        resolution: "720p" as any,
      };

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Resolution must be 1080p, 1440p, or 2160p/
      );
    });
  });

  describe("FPS and Audio Options", () => {
    it("should include FPS in payload", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "Test motion",
        image_url: "https://example.com/image.jpg",
        fps: 50,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateLTXV2ImageVideo(request);

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse((options as Record<string, unknown>).body as string);
      expect(payload.fps).toBe(50);
    });

    it("should include audio generation option", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "Test motion",
        image_url: "https://example.com/image.jpg",
        generate_audio: false,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateLTXV2ImageVideo(request);

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse((options as Record<string, unknown>).body as string);
      expect(payload.generate_audio).toBe(false);
    });
  });

  describe("API Endpoint", () => {
    it("should use correct endpoint for LTX Video 2.0 I2V", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "Test motion",
        image_url: "https://example.com/image.jpg",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateLTXV2ImageVideo(request);

      const [callUrl] = fetchMock.mock.calls[0];
      expect(callUrl).toContain("fal-ai/ltxv-2/image-to-video");
      expect(callUrl).not.toContain("/fast"); // Not the fast variant
    });
  });

  describe("Error Handling", () => {
    it("should handle 401 authentication errors", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "Test motion",
        image_url: "https://example.com/image.jpg",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ detail: "Invalid API key" }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Invalid FAL.ai API key/
      );
    });

    it("should handle 413 file size errors", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "Test motion",
        image_url: "https://example.com/huge-image.jpg",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        statusText: "Payload Too Large",
        json: async () => ({ detail: "Image too large" }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Image file too large.*7MB/
      );
    });

    it("should handle rate limit errors", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "Test motion",
        image_url: "https://example.com/image.jpg",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () => ({ detail: "Rate limit exceeded" }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await expect(generateLTXV2ImageVideo(request)).rejects.toThrow(
        /Rate limit exceeded/
      );
    });
  });

  describe("Default Values", () => {
    it("should use correct defaults when optional params omitted", async () => {
      const request: LTXV2I2VRequest = {
        model: "ltxv2_i2v",
        prompt: "Test motion",
        image_url: "https://example.com/image.jpg",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await generateLTXV2ImageVideo(request);

      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse((options as Record<string, unknown>).body as string);

      expect(payload.duration).toBe(6);
      expect(payload.resolution).toBe("1080p");
      expect(payload.aspect_ratio).toBe("16:9");
      expect(payload.fps).toBe(25);
      expect(payload.generate_audio).toBe(true);
    });
  });
});
```
Add mirrored coverage for `ltxv2_fast_i2v` to confirm existing 2-6 second, 720/1080p behaviour continues to pass.


---

## Technical Specifications

### Infrastructure
- **Machine Type:** L-grade GPU
- **Request Timeout:** 3600 seconds (1 hour)
- **Startup Timeout:** 600 seconds (10 minutes)
- **Max Concurrency:** 5 simultaneous requests
- **Keep Alive:** 300 seconds (5 minutes)

### Performance Metrics
- **Processing Time:** Varies by duration and resolution
  - 6s @ 1080p: ~45-60 seconds
  - 10s @ 2160p: ~120-180 seconds
- **Queue Time:** Depends on current server load
- **Total Turnaround:** Typically 1-3 minutes for standard requests

---

## Use Cases & Best Practices

### Recommended Use Cases
1. **Marketing Videos:** Product images transformed into promotional clips
2. **Social Media:** Static posts converted to engaging video content
3. **Presentations:** Static slides animated with motion
4. **E-commerce:** Product photos brought to life
5. **Art & Creative:** Digital artwork animated with context-aware motion

### Best Practices

#### Image Selection
- Use high-resolution input images (minimum 1920×1080 for best results)
- Ensure good lighting and clear subject focus
- Avoid heavily compressed or low-quality images
- Center important subjects in the frame

#### Prompt Writing
- Be specific about desired motion: "walks forward slowly" vs "walks"
- Describe the scene context for better audio generation
- Include environmental details: "in a busy city street at night"
- Specify camera movement if desired: "camera pans left"

#### Parameter Selection
- **Duration:**
  - 6s: Quick previews, social media stories
  - 8s: Standard promotional content
  - 10s: Detailed storytelling, cinematic shots

- **Resolution:**
  - 1080p: Social media, web content (cost-effective)
  - 1440p: High-quality presentations
  - 2160p: Premium content, large displays

- **FPS:**
  - 25 FPS: Standard video, most use cases
  - 50 FPS: Smooth motion, fast-moving subjects

#### Cost Optimization
- Start with 6s @ 1080p for testing ($0.36)
- Only upscale to 4K for final exports
- Use 25 FPS unless high frame rate is essential
- Disable audio generation if not needed

---

## Example Prompts

### Portrait Animation
```
Image: Professional headshot
Prompt: "Person smiles warmly and nods in agreement, soft office lighting in the background"
Settings: 6s, 1080p, 25 FPS, Audio ON
```

### Landscape Motion
```
Image: Mountain landscape
Prompt: "Camera slowly pans across the mountain range as morning mist rises from the valley"
Settings: 10s, 2160p, 25 FPS, Audio ON
```

### Product Showcase
```
Image: Product on white background
Prompt: "Product slowly rotates 360 degrees, studio lighting highlights the details"
Settings: 8s, 1440p, 50 FPS, Audio OFF
```

### Action Scene
```
Image: Person in running pose
Prompt: "Runner sprints forward through an urban environment, fast camera tracking motion"
Settings: 6s, 1080p, 50 FPS, Audio ON
```

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Image upload fails | File size > 7MB | Compress image or reduce dimensions |
| Video has unnatural motion | Vague prompt | Add specific motion descriptors |
| Audio doesn't match | Insufficient scene context | Include environmental details in prompt |
| Long processing time | High resolution + long duration | Start with 1080p for testing |
| 413 Error | Image file too large | Reduce to under 7MB |

### Quality Issues

**Problem:** Generated video has artifacts or glitches
**Solutions:**
- Use higher quality input image
- Avoid overly complex prompts
- Try different wording for the same concept
- Reduce duration if motion seems erratic

**Problem:** Audio doesn't fit the scene
**Solutions:**
- Add more environmental context to prompt
- Describe the mood/atmosphere explicitly
- Consider disabling audio and adding custom soundtrack

---

## Comparison with Other Models

### vs. LTX Fast I2V
- **Standard:** Better quality, slower processing, higher resolution options
- **Fast:** Faster processing, lower max resolution, better for iteration

### vs. Vidu Q2 I2V
- **LTX:** Audio generation, higher resolution, fixed durations
- **Vidu:** More duration flexibility (2-8s), motion amplitude control, optional BGM

### vs. Runway Gen-3
- **LTX:** Better pricing, audio generation included, commercial license
- **Runway:** More advanced motion control, longer durations available

---

## API Reference

### JavaScript/TypeScript Example

```typescript
import * as fal from "@fal-ai/client";

fal.config({
  credentials: process.env.FAL_KEY,
});

const result = await fal.subscribe("fal-ai/ltxv-2/image-to-video", {
  input: {
    image_url: "https://example.com/input-image.jpg",
    prompt: "A woman walks through a bustling neon-lit street at night",
    duration: 8,
    resolution: "1440p",
    fps: 25,
    generate_audio: true
  },
  logs: true,
  onQueueUpdate: (update) => {
    if (update.status === "IN_PROGRESS") {
      console.log("Processing:", update.logs);
    }
  },
});

console.log("Video URL:", result.data.video.url);
console.log("Resolution:", `${result.data.video.width}x${result.data.video.height}`);
console.log("Duration:", `${result.data.video.duration}s`);
console.log("FPS:", result.data.video.fps);
```

### cURL Example

```bash
curl -X POST https://fal.run/fal-ai/ltxv-2/image-to-video \
  -H "Authorization: Key YOUR_FAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/input.jpg",
    "prompt": "A peaceful landscape with gentle camera movement",
    "duration": 6,
    "resolution": "1080p",
    "fps": 25,
    "generate_audio": true
  }'
```

---

## Future Enhancements

### Planned Features
- Support for additional aspect ratios (1:1, 9:16, 4:3)
- Custom audio upload (replace generated audio)
- Motion intensity control (similar to Vidu's amplitude)
- Longer duration options (12s, 15s)
- Batch processing for multiple images

### Under Consideration
- Real-time preview during generation
- Style transfer options
- Camera path customization
- Audio prompt separate from visual prompt
- Background removal integration

---

## References

- [Fal.ai LTX Video 2.0 I2V API Documentation](https://fal.ai/models/fal-ai/ltxv-2/image-to-video/api)
- [Fal.ai JavaScript Client](https://github.com/fal-ai/fal-js)
- [LTX Video 2.0 Model Card](https://fal.ai/models/fal-ai/ltxv-2)
- [QCut AI Video Integration Guide](./vidu-ltxv2-integration.md)

---

## Changelog

### Version 1.0 (Current)
- Initial documentation
- Complete implementation guide
- Comprehensive test suite
- UI component specifications
- Best practices and examples

