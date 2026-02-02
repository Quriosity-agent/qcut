# Vidu Q3 Integration Plan

## Overview

Add support for **Vidu Q3 Text-to-Video** and **Vidu Q3 Image-to-Video** models to QCut's AI video generation system.

### API Documentation Summary

| Model | Endpoint | Pricing |
|-------|----------|---------|
| Vidu Q3 T2V | `fal-ai/vidu/q3/text-to-video` | $0.07/s (360p/540p), 2.2x for 720p/1080p |
| Vidu Q3 I2V | `fal-ai/vidu/q3/image-to-video` | $0.07/s (360p/540p), 2.2x for 720p/1080p |

### Common Parameters

| Parameter | Type | Required | Default | Options |
|-----------|------|----------|---------|---------|
| `prompt` | string | ✅ | - | Max 2000 chars |
| `duration` | integer | ❌ | 5 | 5 (seconds) |
| `seed` | integer | ❌ | - | For reproducibility |
| `aspect_ratio` | string | ❌ | "16:9" | "16:9", "9:16", "4:3", "3:4", "1:1" |
| `resolution` | string | ❌ | "720p" | "360p", "540p", "720p", "1080p" |
| `audio` | boolean | ❌ | true | Direct audio-video generation |

### I2V-Specific Parameter

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image_url` | string | ✅ | URL or base64-encoded image for starting frame |

### Response Format

```json
{
  "video": {
    "url": "https://v3b.fal.media/files/..."
  }
}
```

---

## Implementation Plan

### Subtask 1: Add Validators for Vidu Q3

**File:** `apps/web/src/lib/ai-video/validation/validators.ts`

Add validation functions following the existing Vidu Q2 pattern:

```typescript
// ============================================
// Vidu Q3 Validators
// ============================================

/**
 * Validates prompt length for Vidu Q3 models (max 2000 chars)
 */
export function validateViduQ3Prompt(prompt: string): void {
  if (prompt.length > 2000) {
    throw new Error(
      `Prompt too long for Vidu Q3. Maximum 2000 characters allowed (current: ${prompt.length})`
    );
  }
}

/**
 * Validates duration for Vidu Q3 models (only 5 seconds supported)
 */
export function validateViduQ3Duration(duration: number): void {
  if (duration !== 5) {
    throw new Error("Vidu Q3 currently only supports 5-second duration");
  }
}

/**
 * Validates resolution for Vidu Q3 models
 */
export function validateViduQ3Resolution(resolution: string): void {
  const validResolutions = ["360p", "540p", "720p", "1080p"];
  if (!validResolutions.includes(resolution)) {
    throw new Error(
      `Invalid resolution for Vidu Q3. Supported: ${validResolutions.join(", ")}`
    );
  }
}

/**
 * Validates aspect ratio for Vidu Q3 models
 */
export function validateViduQ3AspectRatio(aspectRatio: string): void {
  const validRatios = ["16:9", "9:16", "4:3", "3:4", "1:1"];
  if (!validRatios.includes(aspectRatio)) {
    throw new Error(
      `Invalid aspect ratio for Vidu Q3. Supported: ${validRatios.join(", ")}`
    );
  }
}

/**
 * Checks if model is a Vidu Q3 model
 */
export function isViduQ3Model(modelId: string): boolean {
  return modelId === "vidu_q3_t2v" || modelId === "vidu_q3_i2v";
}
```

**Export in index.ts:**
- `validateViduQ3Prompt`
- `validateViduQ3Duration`
- `validateViduQ3Resolution`
- `validateViduQ3AspectRatio`
- `isViduQ3Model`

---

### Subtask 2: Add Model Configurations

#### 2A: Text-to-Video Model Config

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts`

Add to `T2V_MODELS`:

```typescript
vidu_q3_t2v: {
  id: "vidu_q3_t2v",
  name: "Vidu Q3 Text-to-Video",
  description: "High-quality text-to-video with audio generation and multi-resolution support",
  price: "0.07-0.15/s",
  resolution: "720p",
  max_duration: 5,
  category: "text",
  endpoints: {
    text_to_video: "fal-ai/vidu/q3/text-to-video",
  },
  default_params: {
    duration: 5,
    resolution: "720p",
    aspect_ratio: "16:9",
    audio: true,
  },
  supportedResolutions: ["360p", "540p", "720p", "1080p"],
  supportedDurations: [5],
  supportedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
  perSecondPricing: {
    "360p": 0.07,
    "540p": 0.07,
    "720p": 0.154,  // 0.07 * 2.2
    "1080p": 0.154, // 0.07 * 2.2
  },
},
```

Add to `T2V_MODEL_ORDER` (after "vidu_q2_turbo" or similar budget models):

```typescript
"vidu_q3_t2v",
```

Add to `T2V_MODEL_CAPABILITIES`:

```typescript
vidu_q3_t2v: {
  supportsAspectRatio: true,
  supportedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
  supportsResolution: true,
  supportedResolutions: ["360p", "540p", "720p", "1080p"],
  supportsDuration: true,
  supportedDurations: [5],
  supportsNegativePrompt: false,
  supportsPromptExpansion: false,
  supportsSeed: true,
  supportsSafetyChecker: false,
  defaultAspectRatio: "16:9",
  defaultResolution: "720p",
  defaultDuration: 5,
},
```

#### 2B: Image-to-Video Model Config

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts`

Add to `I2V_MODELS`:

```typescript
vidu_q3_i2v: {
  id: "vidu_q3_i2v",
  name: "Vidu Q3 Image-to-Video",
  description: "Animate images with audio generation and multi-resolution support",
  price: "0.07-0.15/s",
  resolution: "720p",
  max_duration: 5,
  category: "image",
  endpoints: {
    image_to_video: "fal-ai/vidu/q3/image-to-video",
  },
  default_params: {
    duration: 5,
    resolution: "720p",
    audio: true,
  },
  supportedResolutions: ["360p", "540p", "720p", "1080p"],
  supportedDurations: [5],
  perSecondPricing: {
    "360p": 0.07,
    "540p": 0.07,
    "720p": 0.154,
    "1080p": 0.154,
  },
},
```

Add to `I2V_MODEL_ORDER` (after "vidu_q2_turbo_i2v"):

```typescript
"vidu_q3_i2v",
```

---

### Subtask 3: Add Request Type Interfaces

**File:** `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`

Add new request interfaces:

```typescript
/**
 * Request parameters for Vidu Q3 text-to-video
 */
export interface ViduQ3T2VRequest {
  model: string;
  prompt: string;
  duration?: number;
  resolution?: "360p" | "540p" | "720p" | "1080p";
  aspect_ratio?: "16:9" | "9:16" | "4:3" | "3:4" | "1:1";
  audio?: boolean;
  seed?: number;
}

/**
 * Request parameters for Vidu Q3 image-to-video
 */
export interface ViduQ3I2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: number;
  resolution?: "360p" | "540p" | "720p" | "1080p";
  audio?: boolean;
  seed?: number;
}
```

---

### Subtask 4: Implement Generator Functions

#### 4A: Text-to-Video Generator

**File:** `apps/web/src/lib/ai-video/generators/text-to-video.ts`

Add new generator function:

```typescript
import {
  validateViduQ3Prompt,
  validateViduQ3Duration,
  validateViduQ3Resolution,
  validateViduQ3AspectRatio,
} from "../validation/validators";

/**
 * Generate video from text using Vidu Q3.
 *
 * Features: Multi-resolution (360p-1080p), aspect ratio control, audio generation.
 *
 * @param request - Prompt, duration, resolution, aspect ratio
 * @param onProgress - Optional callback for progress updates
 * @returns VideoGenerationResponse with job_id and video_url
 * @throws Error if FAL_API_KEY missing or validation fails
 */
export async function generateViduQ3TextVideo(
  request: ViduQ3T2VRequest,
  onProgress?: ProgressCallback
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate Vidu Q3 text-to-video",
    { operation: "generateViduQ3TextVideo", model: request.model },
    async () => {
      const falApiKey = getFalApiKey();
      if (!falApiKey) {
        throw new Error("FAL API key not configured");
      }

      const trimmedPrompt = request.prompt?.trim() ?? "";
      if (!trimmedPrompt) {
        throw new Error("Text prompt is required for Vidu Q3 text-to-video generation");
      }
      validateViduQ3Prompt(trimmedPrompt);

      const modelConfig = getModelConfig(request.model);
      if (!modelConfig) {
        throw new Error(`Unknown model: ${request.model}`);
      }

      const endpoint = modelConfig.endpoints.text_to_video;
      if (!endpoint) {
        throw new Error(
          `Model ${request.model} does not support text-to-video generation`
        );
      }

      // Apply defaults
      const duration = request.duration ?? 5;
      const resolution = request.resolution ??
        (modelConfig.default_params?.resolution as string) ?? "720p";
      const aspectRatio = request.aspect_ratio ??
        (modelConfig.default_params?.aspect_ratio as string) ?? "16:9";
      const audio = request.audio ?? true;

      // Validate parameters
      validateViduQ3Duration(duration);
      validateViduQ3Resolution(resolution);
      validateViduQ3AspectRatio(aspectRatio);

      const payload: Record<string, unknown> = {
        prompt: trimmedPrompt,
        duration,
        resolution,
        aspect_ratio: aspectRatio,
        audio,
      };

      if (request.seed !== undefined) {
        payload.seed = request.seed;
      }

      const jobId = generateJobId();
      const startTime = Date.now();

      // Initial status update
      if (onProgress) {
        onProgress({
          status: "queued",
          progress: 0,
          message: "Submitting Vidu Q3 text-to-video request...",
          elapsedTime: 0,
        });
      }

      // Submit to queue
      const queueResponse = await makeFalRequest(endpoint, payload, {
        queueMode: true,
      });

      if (!queueResponse.ok) {
        const errorData = await queueResponse.json().catch(() => ({}));
        const errorMessage = handleQueueError(queueResponse, errorData, endpoint);
        throw new Error(errorMessage);
      }

      const queueResult = await queueResponse.json();
      const requestId = queueResult.request_id;

      if (requestId) {
        return await pollQueueStatus(requestId, {
          endpoint,
          startTime,
          onProgress,
          jobId,
          modelName: request.model,
        });
      }

      // Direct result
      if (queueResult.video && queueResult.video.url) {
        if (onProgress) {
          onProgress({
            status: "completed",
            progress: 100,
            message: "Vidu Q3 video generated successfully",
            elapsedTime: Math.floor((Date.now() - startTime) / 1000),
          });
        }

        return {
          job_id: jobId,
          status: "completed",
          message: "Video generated successfully with Vidu Q3",
          estimated_time: Math.floor((Date.now() - startTime) / 1000),
          video_url: queueResult.video.url,
          video_data: queueResult,
        };
      }

      throw new Error("No video URL received from Vidu Q3 API");
    }
  );
}
```

#### 4B: Image-to-Video Generator

**File:** `apps/web/src/lib/ai-video/generators/image-to-video.ts`

Add new generator function:

```typescript
import {
  validateViduQ3Prompt,
  validateViduQ3Duration,
  validateViduQ3Resolution,
} from "../validation/validators";

/**
 * Generate video from image using Vidu Q3.
 *
 * @param request - Image URL, prompt, and generation parameters
 * @returns VideoGenerationResponse with job_id and video_url
 * @throws Error if FAL_API_KEY missing or validation fails
 */
export async function generateViduQ3ImageVideo(
  request: ViduQ3I2VRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate Vidu Q3 image-to-video",
    { operation: "generateViduQ3ImageVideo", model: request.model },
    async () => {
      const falApiKey = getFalApiKey();
      if (!falApiKey) {
        throw new Error("FAL API key not configured");
      }

      const trimmedPrompt = request.prompt?.trim() ?? "";
      if (!trimmedPrompt) {
        throw new Error("Text prompt is required for Vidu Q3 image-to-video generation");
      }
      validateViduQ3Prompt(trimmedPrompt);

      if (!request.image_url) {
        throw new Error("Image is required for Vidu Q3 image-to-video generation");
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

      // Apply defaults
      const duration = request.duration ?? 5;
      const resolution = request.resolution ??
        (modelConfig.default_params?.resolution as string) ?? "720p";
      const audio = request.audio ?? true;

      // Validate parameters
      validateViduQ3Duration(duration);
      validateViduQ3Resolution(resolution);

      const payload: Record<string, unknown> = {
        prompt: trimmedPrompt,
        image_url: request.image_url,
        duration,
        resolution,
        audio,
      };

      if (request.seed !== undefined) {
        payload.seed = request.seed;
      }

      const jobId = generateJobId();

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate Vidu Q3 image-to-video");
      }

      const result = await response.json();

      return {
        job_id: jobId,
        status: "completed",
        message: `Video generated successfully with ${request.model}`,
        estimated_time: 0,
        video_url: result.video?.url || result.video,
        video_data: result,
      };
    }
  );
}
```

---

### Subtask 5: Export Generators in Index

**File:** `apps/web/src/lib/ai-video/index.ts`

Add exports:

```typescript
// ============================================
// Text-to-Video Generators
// ============================================
export {
  generateVideo,
  generateVideoFromText,
  generateLTXV2Video,
  generateWAN26TextVideo,
  generateViduQ3TextVideo,  // NEW
} from "./generators/text-to-video";

// ============================================
// Image-to-Video Generators
// ============================================
export {
  generateVideoFromImage,
  generateViduQ2Video,
  generateLTXV2ImageVideo,
  generateSeedanceVideo,
  generateKlingImageVideo,
  generateKling26ImageVideo,
  generateKlingO1Video,
  generateKlingO1RefVideo,
  generateWAN25ImageVideo,
  generateWAN26ImageVideo,
  generateWAN26RefVideo,
  generateViduQ3ImageVideo,  // NEW
} from "./generators/image-to-video";

// ============================================
// Validation Functions
// ============================================
export {
  // ... existing exports ...
  // Vidu Q3 validators
  validateViduQ3Prompt,
  validateViduQ3Duration,
  validateViduQ3Resolution,
  validateViduQ3AspectRatio,
  isViduQ3Model,
} from "./validation/validators";
```

---

### Subtask 6: Add UI Integration (Model Handler Dispatch)

**File:** `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts` (or `use-ai-generation.ts`)

Add dispatch logic for new models:

```typescript
import {
  generateViduQ3TextVideo,
  generateViduQ3ImageVideo,
} from "@/lib/ai-video";

// In the model dispatch switch/if chain for text-to-video:
if (modelId === "vidu_q3_t2v") {
  return generateViduQ3TextVideo({
    model: modelId,
    prompt: context.prompt,
    duration: textSettings.duration,
    resolution: textSettings.resolution,
    aspect_ratio: textSettings.aspectRatio,
    audio: true,
    seed: textSettings.seed,
  }, context.progressCallback);
}

// In the model dispatch switch/if chain for image-to-video:
if (modelId === "vidu_q3_i2v") {
  return generateViduQ3ImageVideo({
    model: modelId,
    prompt: context.prompt,
    image_url: imageUrl,
    duration: imageSettings.duration,
    resolution: imageSettings.resolution,
    audio: true,
    seed: imageSettings.seed,
  });
}
```

---

### Subtask 7: Add Props to UseAIGenerationProps (Optional)

**File:** `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`

Add optional props for Vidu Q3-specific settings if needed:

```typescript
// In UseAIGenerationProps interface:

// Vidu Q3 options
viduQ3Duration?: 5;  // Only 5s supported currently
viduQ3Resolution?: "360p" | "540p" | "720p" | "1080p";
viduQ3AspectRatio?: "16:9" | "9:16" | "4:3" | "3:4" | "1:1";
viduQ3Audio?: boolean;
viduQ3Seed?: number;
```

---

### Subtask 8: Add Error Messages to Constants

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

Add error messages:

```typescript
export const ERROR_MESSAGES = {
  // ... existing messages ...

  // Vidu Q3 specific
  VIDU_Q3_EMPTY_PROMPT: "Please enter a text prompt for Vidu Q3 video generation",
  VIDU_Q3_PROMPT_TOO_LONG: "Prompt exceeds maximum length of 2000 characters for Vidu Q3",
  VIDU_Q3_INVALID_DURATION: "Vidu Q3 currently only supports 5-second duration",
  VIDU_Q3_INVALID_RESOLUTION: "Invalid resolution for Vidu Q3. Supported: 360p, 540p, 720p, 1080p",
  VIDU_Q3_INVALID_ASPECT_RATIO: "Invalid aspect ratio for Vidu Q3. Supported: 16:9, 9:16, 4:3, 3:4, 1:1",
  VIDU_Q3_I2V_MISSING_IMAGE: "Image is required for Vidu Q3 image-to-video generation",
};
```

---

### Subtask 9: Write Unit Tests

**File:** `apps/web/src/test/unit/ai-video/vidu-q3.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  validateViduQ3Prompt,
  validateViduQ3Duration,
  validateViduQ3Resolution,
  validateViduQ3AspectRatio,
  isViduQ3Model,
} from "@/lib/ai-video/validation/validators";

describe("Vidu Q3 Validators", () => {
  describe("validateViduQ3Prompt", () => {
    it("should accept prompts within 2000 characters", () => {
      expect(() => validateViduQ3Prompt("A short prompt")).not.toThrow();
      expect(() => validateViduQ3Prompt("x".repeat(2000))).not.toThrow();
    });

    it("should reject prompts exceeding 2000 characters", () => {
      expect(() => validateViduQ3Prompt("x".repeat(2001))).toThrow(
        /Maximum 2000 characters/
      );
    });
  });

  describe("validateViduQ3Duration", () => {
    it("should accept 5 seconds", () => {
      expect(() => validateViduQ3Duration(5)).not.toThrow();
    });

    it("should reject other durations", () => {
      expect(() => validateViduQ3Duration(4)).toThrow(/5-second/);
      expect(() => validateViduQ3Duration(10)).toThrow(/5-second/);
    });
  });

  describe("validateViduQ3Resolution", () => {
    it("should accept valid resolutions", () => {
      for (const res of ["360p", "540p", "720p", "1080p"]) {
        expect(() => validateViduQ3Resolution(res)).not.toThrow();
      }
    });

    it("should reject invalid resolutions", () => {
      expect(() => validateViduQ3Resolution("480p")).toThrow(/Invalid resolution/);
      expect(() => validateViduQ3Resolution("4k")).toThrow(/Invalid resolution/);
    });
  });

  describe("validateViduQ3AspectRatio", () => {
    it("should accept valid aspect ratios", () => {
      for (const ratio of ["16:9", "9:16", "4:3", "3:4", "1:1"]) {
        expect(() => validateViduQ3AspectRatio(ratio)).not.toThrow();
      }
    });

    it("should reject invalid aspect ratios", () => {
      expect(() => validateViduQ3AspectRatio("21:9")).toThrow(/Invalid aspect ratio/);
    });
  });

  describe("isViduQ3Model", () => {
    it("should identify Vidu Q3 models", () => {
      expect(isViduQ3Model("vidu_q3_t2v")).toBe(true);
      expect(isViduQ3Model("vidu_q3_i2v")).toBe(true);
    });

    it("should not identify other models", () => {
      expect(isViduQ3Model("vidu_q2_turbo_i2v")).toBe(false);
      expect(isViduQ3Model("sora2_text_to_video")).toBe(false);
    });
  });
});
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `validators.ts` | Edit | Add Vidu Q3 validation functions |
| `text2video-models-config.ts` | Edit | Add `vidu_q3_t2v` model config |
| `image2video-models-config.ts` | Edit | Add `vidu_q3_i2v` model config |
| `ai-types.ts` | Edit | Add `ViduQ3T2VRequest` and `ViduQ3I2VRequest` interfaces |
| `text-to-video.ts` | Edit | Add `generateViduQ3TextVideo` function |
| `image-to-video.ts` | Edit | Add `generateViduQ3ImageVideo` function |
| `index.ts` (ai-video) | Edit | Export new generators and validators |
| `ai-constants.ts` | Edit | Add Vidu Q3 error messages |
| `model-handlers.ts` | Edit | Add dispatch for Vidu Q3 models |
| `vidu-q3.test.ts` | Create | Unit tests for validators |

---

## Key Considerations

### 1. Duration Limitation
Vidu Q3 currently only supports 5-second videos. The validators enforce this, and the UI should only show 5s as an option.

### 2. Audio Feature
Vidu Q3 includes native audio generation (`audio: true` by default). This is a differentiator from older models.

### 3. Per-Second Pricing
The pricing model uses per-second billing with a 2.2x multiplier for HD resolutions. The `perSecondPricing` config enables accurate cost estimation in the UI.

### 4. Aspect Ratio Support
Unlike some models, Vidu Q3 supports all common aspect ratios (16:9, 9:16, 4:3, 3:4, 1:1), making it versatile for different content types.

### 5. Queue Mode
Both endpoints should use queue mode for long-running requests, with the polling system handling job completion.

---

## Testing Checklist

- [ ] Validators reject invalid inputs
- [ ] Model configs load correctly
- [ ] T2V generation works with all resolutions
- [ ] I2V generation works with image upload
- [ ] Audio is generated by default
- [ ] Progress callbacks fire during queue polling
- [ ] Error messages are user-friendly
- [ ] Cost estimation is accurate

---

## Future Enhancements

1. **Duration Support**: When Vidu Q3 API supports more durations, update `supportedDurations` and validators
2. **Motion Control**: If the API adds motion amplitude options (like Vidu Q2), add corresponding parameters
3. **Reference Video**: Monitor for potential video-to-video capabilities
