# WAN v2.6 Reference-to-Video Integration Plan

## Overview

Integrate the WAN v2.6 Reference-to-Video model which generates videos from 1-3 reference video clips. This maintains character/subject consistency across generated videos using the `@Video1`, `@Video2`, `@Video3` prompt syntax.

**FAL Endpoint**: `fal-ai/wan/v2.6/reference-to-video`

**Key Differentiator**: Unlike image-to-video models, this takes **video clips** as references (not images).

**UI Approach**: Reuse existing `referenceImages` UI from avatar tab, extended to accept both images and videos based on model requirements.

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
// WAN v2.6 Reference-to-Video (Avatar tab - reuses referenceImages UI)
{
  id: "wan_26_ref2v",
  name: "WAN v2.6 Ref2Video",
  description: "Generate videos from 1-3 reference video clips with character consistency",
  price: "0.75", // 5s @ $0.15/s for 1080p
  resolution: "720p / 1080p",
  max_duration: 10,
  category: "avatar", // Avatar tab - reuses referenceImages UI
  requiredInputs: ["referenceMedia"], // Accepts both images and videos
  endpoints: {
    image_to_video: "fal-ai/wan/v2.6/reference-to-video",
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
  /** Model accepts video files as references (not images) */
  acceptsVideoReferences: true,
},
```

**Note**: Uses `category: "avatar"` to appear in avatar tab alongside `kling_o1_ref2video`.

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
// WAN v2.6 Reference-to-Video options (reuses referenceImages from avatar state)
wan26RefDuration?: 5 | 10;
wan26RefResolution?: "720p" | "1080p";
wan26RefAspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
wan26RefNegativePrompt?: string;
wan26RefEnablePromptExpansion?: boolean;
wan26RefMultiShots?: boolean;
```

**Note**: No new file props needed - reuses existing `referenceImages` from avatar tab state.

---

### Subtask 7: Add Model Handler

**File**: `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts`

**Action**: ADD handler in `handleAvatarModels` switch after `kling_o1_ref2video` case (~line 1563)

```typescript
case "wan_26_ref2v": {
  return handleWAN26Ref2Video(ctx, settings);
}
```

**Action**: ADD handler function after `handleKlingO1Ref2Video` (~line 1150)

```typescript
/**
 * Handle WAN v2.6 Reference-to-Video generation
 * Reuses referenceImages from avatar tab (accepts video files)
 */
async function handleWAN26Ref2Video(
  ctx: ModelHandlerContext,
  settings: AvatarSettings
): Promise<ModelHandlerResult> {
  // Reuse referenceImages - for this model they contain video files
  const referenceFiles = settings.referenceImages?.filter((f) => f !== null) ?? [];

  if (referenceFiles.length === 0) {
    return {
      success: false,
      error: "At least one reference video is required",
    };
  }

  if (referenceFiles.length > 3) {
    return {
      success: false,
      error: "Maximum 3 reference videos allowed",
    };
  }

  // Upload video files to FAL
  const videoUrls: string[] = [];
  for (const file of referenceFiles) {
    if (file) {
      const url = await uploadVideoToFal(file, ctx.falApiKey);
      videoUrls.push(url);
    }
  }

  const { generateWAN26RefVideo } = await import("@/lib/ai-video");

  return generateWAN26RefVideo({
    model: ctx.modelId,
    prompt: ctx.prompt,
    video_urls: videoUrls,
    duration: ctx.props.wan26RefDuration,
    resolution: ctx.props.wan26RefResolution,
    aspect_ratio: ctx.props.wan26RefAspectRatio,
    negative_prompt: ctx.props.wan26RefNegativePrompt,
    enable_prompt_expansion: ctx.props.wan26RefEnablePromptExpansion,
    multi_shots: ctx.props.wan26RefMultiShots,
    seed: ctx.props.t2vSeed,
    enable_safety_checker: ctx.props.t2vSafetyChecker,
  });
}
```

**Reuse**: Follows exact pattern of `handleKlingO1Ref2Video`, reusing `referenceImages` from avatar state.

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

## Subtask 9: Extend Reference Upload UI to Accept Videos

**File**: `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-avatar-tab.tsx`

**Action**: MODIFY the reference upload section to accept both images and videos based on model

**Approach**: Extend the existing `FileUpload` component usage to dynamically accept video files when `wan_26_ref2v` is selected.

```typescript
// Add helper to determine accepted file types based on selected model
const getAcceptedReferenceTypes = (selectedModels: string[]) => {
  const hasVideoRefModel = selectedModels.includes("wan_26_ref2v");
  if (hasVideoRefModel) {
    return "video/mp4,video/mov,video/webm"; // Videos for WAN v2.6 Ref2Video
  }
  return "image/*"; // Images for Kling O1 Ref2Video
};

// Modify FileUpload accept prop dynamically
<FileUpload
  accept={getAcceptedReferenceTypes(selectedModels)}
  // ... rest of props
/>
```

**Action**: Update labels/hints when video model is selected

```typescript
// Dynamic label based on model
const getReferenceLabel = (selectedModels: string[]) => {
  if (selectedModels.includes("wan_26_ref2v")) {
    return "Reference Videos (1-3)";
  }
  return "Reference Images (1-7)";
};

const getReferenceHint = (selectedModels: string[]) => {
  if (selectedModels.includes("wan_26_ref2v")) {
    return "Use @Video1, @Video2, @Video3 in your prompt";
  }
  return "Upload character reference images";
};
```

**Reuse**: 100% reuses existing `referenceImages` state and upload UI - only changes `accept` attribute and labels.

---

## Subtask 10: Update Validation in use-ai-generation.ts

**File**: `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts`

**Action**: ADD validation case for `wan_26_ref2v` after `kling_o1_ref2video` (~line 1794)

```typescript
// Reference-to-video models require at least one reference
if (modelId === "kling_o1_ref2video" || modelId === "wan_26_ref2v") {
  const hasReferenceMedia = referenceImages?.some(
    (item) => item !== null
  );
  if (!hasReferenceMedia) {
    const mediaType = modelId === "wan_26_ref2v" ? "video" : "image";
    throw new Error(`Please upload at least one reference ${mediaType}`);
  }
}
```

**Reuse**: Extends existing validation pattern, shared with `kling_o1_ref2video`.

---

## File Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `ai-types.ts` | ADD | ~20 lines |
| `ai-constants.ts` | ADD | ~32 lines |
| `validators.ts` | ADD | ~15 lines |
| `image-to-video.ts` | ADD | ~80 lines |
| `index.ts` | ADD | ~1 line |
| `model-handlers.ts` | ADD | ~50 lines |
| `ai-cost-calculators.ts` | ADD | ~6 lines |
| `ai-avatar-tab.tsx` | MODIFY | ~15 lines |
| `use-ai-generation.ts` | MODIFY | ~8 lines |

**Total**: ~227 lines of new/modified code

---

## Testing Checklist

- [ ] Model appears in AI panel when "avatar" tab active
- [ ] Reference upload accepts video files (MP4, MOV) when WAN v2.6 Ref2Video selected
- [ ] Reference upload accepts image files when Kling O1 Ref2Video selected
- [ ] Cost estimation shows correct pricing ($0.10/s 720p, $0.15/s 1080p)
- [ ] Validation rejects 0 or 4+ videos
- [ ] Validation shows correct error message mentioning "video" not "image"
- [ ] Prompt with `@Video1` syntax works
- [ ] Video generation completes successfully
- [ ] Error handling shows meaningful messages

---

## Long-term Maintainability Notes

1. **Reuse existing UI**: Uses same `referenceImages` state and upload components from avatar tab
2. **Reuse existing validators**: Uses same `validateWAN26Prompt`, `validateWAN26Duration`, etc.
3. **Consistent naming**: `wan_26_ref2v` follows pattern of `wan_26_t2v`, `wan_26_i2v`
4. **Shared pricing logic**: Same per-second calculation as other WAN v2.6 variants
5. **Type safety**: Full TypeScript interface with proper optional parameters
6. **Modular generator**: Self-contained function following `handleKlingO1Ref2Video` pattern
7. **Dynamic UI**: Single upload UI adapts accept types based on selected model
8. **Category alignment**: Uses `category: "avatar"` for proper tab placement
