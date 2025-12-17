# WAN v2.6 Reference-to-Video Integration Plan

## Overview

Integrate the WAN v2.6 Reference-to-Video model which generates videos from 1-3 reference video clips. This maintains character/subject consistency across generated videos using the `@Video1`, `@Video2`, `@Video3` prompt syntax.

**FAL Endpoint**: `fal-ai/wan/v2.6/reference-to-video`

**Key Differentiator**: Unlike image-to-video models, this takes **video clips** as references (not images).

---

## API Specification

### Input Parameters

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| `prompt` | string | - | Yes | Max 800 chars. Use `@Video1`, `@Video2`, `@Video3` to reference subjects |
| `video_urls` | string[] | - | Yes | 1-3 reference video URLs (16+ FPS, 2-30s each, max 30MB) |
| `aspect_ratio` | enum | "16:9" | No | 16:9, 9:16, 1:1, 4:3, 3:4 |
| `resolution` | enum | "1080p" | No | 720p, 1080p (no 480p) |
| `duration` | enum | "5" | No | 5 or 10 seconds only |
| `negative_prompt` | string | "" | No | Max 500 chars |
| `enable_prompt_expansion` | boolean | true | No | LLM-based prompt rewriting |
| `multi_shots` | boolean | true | No | Intelligent scene segmentation |
| `seed` | integer | null | No | For reproducibility |
| `enable_safety_checker` | boolean | true | No | Safety filtering |

### Output

```json
{
  "video": { "url": "string", "content_type": "video/mp4" },
  "seed": "integer",
  "actual_prompt": "string"
}
```

### Pricing
- 720p: $0.10/second
- 1080p: $0.15/second

---

## Subtasks

### Subtask 1: Add Type Definition

**File**: `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`

**Action**: ADD after `WAN26I2VRequest` interface (~line 723)

```typescript
/**
 * WAN v2.6 Reference-to-Video request parameters
 * Uses 1-3 reference videos for character/subject consistency
 */
export interface WAN26Ref2VideoRequest {
  model: string;
  prompt: string;
  video_urls: string[];
  duration?: 5 | 10;
  resolution?: "720p" | "1080p";
  aspect_ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  negative_prompt?: string;
  enable_prompt_expansion?: boolean;
  multi_shots?: boolean;
  seed?: number;
  enable_safety_checker?: boolean;
}
```

**Reuse**: Follows exact pattern of existing `WAN26I2VRequest` and `WAN26T2VRequest`.

---

### Subtask 2: Add Model Configuration

**File**: `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

**Action**: ADD to `AI_MODELS` array after `wan_26_i2v` entry (~line 460)

```typescript
// WAN v2.6 Reference-to-Video
{
  id: "wan_26_ref2v",
  name: "WAN v2.6 Ref2Video",
  description: "Generate videos from 1-3 reference video clips with character consistency",
  price: "0.75", // 5s @ $0.15/s for 1080p
  resolution: "720p / 1080p",
  max_duration: 10,
  category: "video", // Uses video inputs
  requiredInputs: ["referenceVideos"], // New input type
  endpoints: {
    image_to_video: "fal-ai/wan/v2.6/reference-to-video", // Reuse I2V slot
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
    aspect_ratio: "16:9",
    enable_prompt_expansion: true,
    multi_shots: true,
    enable_safety_checker: true,
  },
  supportedResolutions: ["720p", "1080p"],
  supportedDurations: [5, 10],
  supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  perSecondPricing: {
    "720p": 0.10,
    "1080p": 0.15,
  },
},
```

**Note**: Uses `category: "video"` since it requires video inputs, not images.

---

### Subtask 3: Add Validation Functions

**File**: `apps/web/src/lib/ai-video/validation/validators.ts`

**Action**: ADD after existing WAN26 validators

```typescript
/**
 * Validate WAN v2.6 Ref2Video reference videos array
 */
export function validateWAN26RefVideos(videoUrls: string[]): void {
  if (!videoUrls || videoUrls.length === 0) {
    throw new Error("At least one reference video is required");
  }
  if (videoUrls.length > 3) {
    throw new Error("Maximum 3 reference videos allowed");
  }
  for (const url of videoUrls) {
    if (!url || typeof url !== "string" || url.trim() === "") {
      throw new Error("Invalid video URL in reference videos");
    }
  }
}
```

**Reuse**: Follows pattern of `validateWAN26Prompt`, `validateWAN26Duration` etc.

---

### Subtask 4: Add Generator Function

**File**: `apps/web/src/lib/ai-video/generators/image-to-video.ts`

**Action**: ADD import and function after `generateWAN26ImageVideo`

**Import to ADD** (~line 19):
```typescript
import type {
  // ... existing imports ...
  WAN26Ref2VideoRequest,
} from "@/components/editor/media-panel/views/ai/types/ai-types";
```

**Import validator** (~line 51):
```typescript
import {
  // ... existing imports ...
  validateWAN26RefVideos,
} from "../validation/validators";
```

**Function to ADD** after `generateWAN26ImageVideo` (~line 1020):

```typescript
/**
 * Generate video from reference videos using WAN v2.6.
 *
 * Takes 1-3 reference video clips for character/subject consistency.
 * Use @Video1, @Video2, @Video3 in prompt to reference subjects.
 *
 * @param request - Video URLs, prompt, and generation parameters
 * @returns VideoGenerationResponse with job_id and final video_url
 * @throws Error if FAL_API_KEY missing or validation fails
 */
export async function generateWAN26RefVideo(
  request: WAN26Ref2VideoRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate WAN v2.6 Ref2Video",
    { operation: "generateWAN26RefVideo", model: request.model },
    async () => {
      const falApiKey = getFalApiKey();
      if (!falApiKey) {
        throw new Error("FAL API key not configured");
      }

      const trimmedPrompt = request.prompt?.trim() ?? "";
      if (!trimmedPrompt) {
        throw new Error("Please enter a prompt describing the desired video");
      }
      validateWAN26Prompt(trimmedPrompt);

      validateWAN26RefVideos(request.video_urls);

      if (request.negative_prompt) {
        validateWAN26NegativePrompt(request.negative_prompt);
      }

      const modelConfig = getModelConfig(request.model);
      if (!modelConfig) {
        throw new Error(`Unknown model: ${request.model}`);
      }

      const endpoint = modelConfig.endpoints.image_to_video;
      if (!endpoint) {
        throw new Error(
          `Model ${request.model} does not support reference-to-video generation`
        );
      }

      // Apply defaults
      const duration =
        request.duration ??
        (modelConfig.default_params?.duration as number) ??
        5;
      const resolution =
        request.resolution ??
        (modelConfig.default_params?.resolution as string) ??
        "1080p";
      const aspectRatio =
        request.aspect_ratio ??
        (modelConfig.default_params?.aspect_ratio as string) ??
        "16:9";

      // Validate parameters
      validateWAN26Duration(duration);
      validateWAN26Resolution(resolution);
      validateWAN26AspectRatio(aspectRatio);

      const payload: Record<string, unknown> = {
        prompt: trimmedPrompt,
        video_urls: request.video_urls,
        duration,
        resolution,
        aspect_ratio: aspectRatio,
        enable_prompt_expansion:
          request.enable_prompt_expansion ??
          modelConfig.default_params?.enable_prompt_expansion ??
          true,
        multi_shots:
          request.multi_shots ??
          modelConfig.default_params?.multi_shots ??
          true,
        enable_safety_checker: request.enable_safety_checker ?? true,
      };

      // Optional parameters
      if (request.negative_prompt) {
        payload.negative_prompt = request.negative_prompt;
      }

      if (request.seed !== undefined) {
        payload.seed = request.seed;
      }

      const jobId = generateJobId();

      const response = await makeFalRequest(endpoint, payload);

      if (!response.ok) {
        await handleFalResponse(response, "Generate WAN v2.6 Ref2Video");
      }

      const result = await response.json();

      return {
        job_id: jobId,
        status: "completed",
        message: "Video generated successfully with WAN v2.6 Reference-to-Video",
        estimated_time: 0,
        video_url: result.video?.url || result.video || result.url,
        video_data: result,
      };
    }
  );
}
```

**Reuse**: 90% identical to `generateWAN26ImageVideo`, changed `image_url` to `video_urls`.

---

### Subtask 5: Export Generator Function

**File**: `apps/web/src/lib/ai-video/index.ts`

**Action**: ADD export

```typescript
export { generateWAN26RefVideo } from "./generators/image-to-video";
```

---

### Subtask 6: Add Props to UseAIGenerationProps

**File**: `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`

**Action**: ADD after WAN v2.6 I2V options block (~line 262)

```typescript
// WAN v2.6 Reference-to-Video options
wan26RefDuration?: 5 | 10;
wan26RefResolution?: "720p" | "1080p";
wan26RefAspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
wan26RefNegativePrompt?: string;
wan26RefEnablePromptExpansion?: boolean;
wan26RefMultiShots?: boolean;
/** Reference video files for WAN v2.6 Ref2Video (1-3 videos) */
referenceVideoFiles?: (File | null)[];
/** Uploaded reference video URLs */
referenceVideoUrls?: string[];
```

---

### Subtask 7: Add Model Handler

**File**: `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts`

**Action**: ADD handler in appropriate switch case for "video" category models

```typescript
case "wan_26_ref2v": {
  const { generateWAN26RefVideo } = await import("@/lib/ai-video");

  // Upload reference videos if not already URLs
  const videoUrls: string[] = [];
  if (props.referenceVideoUrls && props.referenceVideoUrls.length > 0) {
    videoUrls.push(...props.referenceVideoUrls);
  } else if (props.referenceVideoFiles) {
    for (const file of props.referenceVideoFiles) {
      if (file) {
        const url = await uploadVideoToFal(file, falApiKey);
        videoUrls.push(url);
      }
    }
  }

  if (videoUrls.length === 0) {
    throw new Error("At least one reference video is required");
  }

  return generateWAN26RefVideo({
    model: modelId,
    prompt,
    video_urls: videoUrls,
    duration: props.wan26RefDuration,
    resolution: props.wan26RefResolution,
    aspect_ratio: props.wan26RefAspectRatio,
    negative_prompt: props.wan26RefNegativePrompt,
    enable_prompt_expansion: props.wan26RefEnablePromptExpansion,
    multi_shots: props.wan26RefMultiShots,
    seed: props.t2vSeed,
    enable_safety_checker: props.t2vSafetyChecker,
  });
}
```

---

### Subtask 8: Add Cost Calculator

**File**: `apps/web/src/components/editor/media-panel/views/ai/utils/ai-cost-calculators.ts`

**Action**: ADD case in cost calculation switch

```typescript
case "wan_26_ref2v": {
  const resolution = options.resolution || "1080p";
  const duration = options.duration || 5;
  const pricePerSecond = resolution === "1080p" ? 0.15 : 0.10;
  return duration * pricePerSecond;
}
```

**Reuse**: Same pricing logic as `wan_26_t2v` and `wan_26_i2v`.

---

## UI Components (Future Phase)

The UI for selecting reference videos will require:

1. **Video upload zone** accepting 1-3 video files
2. **Video preview thumbnails** with remove buttons
3. **Prompt hint** showing `@Video1`, `@Video2`, `@Video3` syntax
4. **Validation UI** for video format/duration requirements

This can reuse patterns from:
- `referenceImages` handling in Kling O1 Ref2Video
- Video upload in Kling O1 V2V model
- Multi-file upload in Seeddream 4.5 Edit

---

## File Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `ai-types.ts` | ADD | ~25 lines |
| `ai-constants.ts` | ADD | ~30 lines |
| `validators.ts` | ADD | ~15 lines |
| `image-to-video.ts` | ADD | ~80 lines |
| `index.ts` | ADD | ~1 line |
| `model-handlers.ts` | ADD | ~25 lines |
| `ai-cost-calculators.ts` | ADD | ~6 lines |

**Total**: ~182 lines of new code

---

## Testing Checklist

- [ ] Model appears in AI panel when "video" tab active
- [ ] Cost estimation shows correct pricing
- [ ] Validation rejects 0 or 4+ videos
- [ ] Prompt with `@Video1` syntax works
- [ ] Video generation completes successfully
- [ ] Error handling shows meaningful messages

---

## Long-term Maintainability Notes

1. **Reuse existing validators**: Uses same `validateWAN26Prompt`, `validateWAN26Duration`, etc.
2. **Consistent naming**: `wan_26_ref2v` follows pattern of `wan_26_t2v`, `wan_26_i2v`
3. **Shared pricing logic**: Same per-second calculation as other WAN v2.6 variants
4. **Type safety**: Full TypeScript interface with proper optional parameters
5. **Modular generator**: Self-contained function following established patterns
