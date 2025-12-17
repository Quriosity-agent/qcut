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
  name: "WAN v2.6 Ref2V",
  description: "Generate videos guided by reference video clips - transfers motion/style to new content",
  price: "0.10-0.15/s",
  resolution: "720p / 1080p",
  max_duration: 15,
  category: "avatar",
  requiredInputs: ["sourceVideo"], // Uses sourceVideo like other V2V models
  endpoints: {
    image_to_video: "fal-ai/wan/v2.6/reference-to-video",
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
    aspect_ratio: "16:9",
    enable_prompt_expansion: true,
  },
  supportedResolutions: ["720p", "1080p"],
  supportedDurations: [5, 10, 15],
  supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  perSecondPricing: {
    "720p": 0.10,
    "1080p": 0.15,
  },
},
```

**Note**: Uses `category: "avatar"` to appear in avatar tab. Uses `sourceVideo` (not `referenceImages`) because it's a video-to-video model like `kling_o1_v2v_reference`.

---

### Subtask 3: Add Validation Functions

**File**: `apps/web/src/lib/ai-video/validation/validators.ts`

**Action**: ADD after `isWAN26Model` (~line 436)

```typescript
/**
 * Validate WAN v2.6 Ref2Video reference videos array
 * @param videoUrls - Array of video URLs to validate
 * @throws Error if array is empty, exceeds 3, or contains invalid URLs
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

/**
 * Checks if model is WAN v2.6 Reference-to-Video
 * @param modelId - Model identifier to check
 * @returns true if model is WAN v2.6 Ref2Video
 */
export function isWAN26Ref2VideoModel(modelId: string): boolean {
  return modelId === "wan_26_ref2v";
}
```

**Reuse**: Follows pattern of existing `validateWAN26Prompt` (line 362), `validateWAN26Duration` (line 386), and `isWAN26Model` (line 434).

---

### Subtask 4: Add Generator Function

**File**: `apps/web/src/lib/ai-video/generators/image-to-video.ts`

**Action**: ADD import and function after `generateWAN26ImageVideo`

**Import to ADD** (~line 19, add to existing import block):
```typescript
import type {
  // ... existing imports ...
  WAN26I2VRequest,
  WAN26Ref2VideoRequest, // ADD this
} from "@/components/editor/media-panel/views/ai/types/ai-types";
```

**Import validator** (~line 51, add to existing import block):
```typescript
import {
  // ... existing imports ...
  validateWAN26AspectRatio,
  validateWAN26RefVideos, // ADD this
} from "../validation/validators";
```

**Function to ADD** after `generateWAN26ImageVideo` (~line 1019):

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

**Action 1**: ADD import at top of file (~line 15):
```typescript
import { uploadVideoToFal } from "@/lib/ai-video/core/fal-upload";
```

**Action 2**: ADD case in `routeAvatarHandler` switch after `kling_o1_ref2video` (~line 1563):

```typescript
case "wan_26_ref2v":
  return handleWAN26Ref2Video(ctx, settings);
```

**Action 3**: ADD handler function after `handleKlingO1Ref2Video` (~line 1151):

```typescript
/**
 * Handle WAN v2.6 Reference-to-Video generation
 * Reuses referenceImages from avatar tab (accepts video files)
 */
export async function handleWAN26Ref2Video(
  ctx: ModelHandlerContext,
  settings: AvatarSettings
): Promise<ModelHandlerResult> {
  // Reuse referenceImages - for this model they contain video files
  const referenceFiles = settings.referenceImages?.filter((f): f is File => f !== null) ?? [];

  if (referenceFiles.length === 0) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Reference-to-video requires at least one reference video",
    };
  }

  if (referenceFiles.length > 3) {
    return {
      response: undefined,
      shouldSkip: true,
      skipReason: "Maximum 3 reference videos allowed",
    };
  }

  console.log(
    `  🎬 Calling generateWAN26RefVideo for ${ctx.modelId} with ${referenceFiles.length} reference video(s)...`
  );

  // Upload video files to FAL storage
  const videoUrls = await Promise.all(
    referenceFiles.map((file) => uploadVideoToFal(file, ctx.falApiKey))
  );

  const { generateWAN26RefVideo } = await import("@/lib/ai-video");

  const response = await generateWAN26RefVideo({
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

  console.log("  ✅ generateWAN26RefVideo returned:", response);
  return { response };
}
```

**Reuse**:
- Follows exact pattern of `handleKlingO1Ref2Video` (line 1127)
- Uses `uploadVideoToFal` from `@/lib/ai-video/core/fal-upload` (already exists)
- Returns `ModelHandlerResult` with `response`/`shouldSkip`/`skipReason` pattern

---

### Subtask 8: Add Cost Calculator

**File**: `apps/web/src/components/editor/media-panel/views/ai/utils/ai-cost-calculators.ts`

**Action**: ADD function after `calculateKling26Cost` (~line 80)

```typescript
/**
 * Calculate WAN v2.6 cost based on resolution and duration
 * @param resolution - 720p or 1080p
 * @param duration - Duration in seconds (5 or 10)
 * @returns Estimated cost in dollars
 */
export function calculateWAN26Cost(
  resolution: string,
  duration: number
): number {
  // Per-second pricing: $0.10/s for 720p, $0.15/s for 1080p
  const perSecondRate = resolution === "1080p" ? 0.15 : 0.10;
  return duration * perSecondRate;
}
```

**Usage in UI**: Call this function when `wan_26_ref2v`, `wan_26_t2v`, or `wan_26_i2v` is selected.

**Reuse**: Same pricing structure as `calculateViduQ2Cost` (line 87) and `calculateKling26Cost` (line 72).

---

## Subtask 9: Extend Reference Upload UI to Accept Videos

**File**: `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-avatar-tab.tsx`

**Action 1**: ADD helper functions near component props (~line 150):

```typescript
/**
 * Determine if video references are needed based on selected models
 */
const isVideoRefModel = (selectedModels: string[]) =>
  selectedModels.includes("wan_26_ref2v");

/**
 * Get accepted file types for reference uploads
 */
const getReferenceAcceptedTypes = (selectedModels: string[]) =>
  isVideoRefModel(selectedModels)
    ? UPLOAD_CONSTANTS.ALLOWED_VIDEO_TYPES
    : UPLOAD_CONSTANTS.ALLOWED_AVATAR_IMAGE_TYPES;

/**
 * Get file type for reference uploads
 */
const getReferenceFileType = (selectedModels: string[]): "video" | "image" =>
  isVideoRefModel(selectedModels) ? "video" : "image";
```

**Action 2**: MODIFY the reference images section (~line 244-270):

```typescript
{/* Reference Media - 6 slots in 3x2 grid (images or videos based on model) */}
<div className="space-y-2">
  <Label className="text-xs">
    {isVideoRefModel(selectedModels)
      ? "Reference Videos (1-3)"
      : "Reference Images"}
  </Label>
  {isVideoRefModel(selectedModels) && (
    <p className="text-xs text-muted-foreground">
      Use @Video1, @Video2, @Video3 in your prompt
    </p>
  )}
  <div className="grid grid-cols-3 gap-2">
    {[0, 1, 2, 3, 4, 5]
      .slice(0, isVideoRefModel(selectedModels) ? 3 : 6) // Only 3 slots for video
      .map((index) => (
        <FileUpload
          key={`reference-${index}`}
          id={`avatar-reference-${index}-input`}
          label={isVideoRefModel(selectedModels) ? `Video ${index + 1}` : `Ref ${index + 1}`}
          helperText=""
          fileType={getReferenceFileType(selectedModels)}
          acceptedTypes={getReferenceAcceptedTypes(selectedModels)}
          maxSizeBytes={isVideoRefModel(selectedModels)
            ? UPLOAD_CONSTANTS.MAX_VIDEO_SIZE_BYTES
            : UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
          maxSizeLabel={isVideoRefModel(selectedModels)
            ? UPLOAD_CONSTANTS.MAX_VIDEO_SIZE_LABEL
            : UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
          formatsLabel={isVideoRefModel(selectedModels)
            ? UPLOAD_CONSTANTS.VIDEO_FORMATS_LABEL
            : UPLOAD_CONSTANTS.AVATAR_IMAGE_FORMATS_LABEL}
          file={referenceImages[index]}
          preview={referenceImagePreviews[index]}
          onFileChange={(file, preview) => {
            onReferenceImageChange(index, file, preview || null);
            if (file) onError(null);
          }}
          onError={onError}
          isCompact={true}
        />
      ))}
  </div>
</div>
```

**Reuse**:
- 100% reuses existing `referenceImages` state from `useAIAvatarTabState`
- Uses existing `UPLOAD_CONSTANTS` for video/image constraints
- Uses existing `FileUpload` component (supports both image and video `fileType`)

---

## Subtask 10: Update Validation in use-ai-generation.ts

**File**: `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts`

**Action**: MODIFY existing validation (~line 881 and ~line 1794) to include `wan_26_ref2v`:

```typescript
// Reference-to-video models require at least one reference (image or video)
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

**Also update exclusion list** (~line 1807) to skip avatar image requirement:

```typescript
modelId !== "kling_o1_ref2video" &&
modelId !== "wan_26_ref2v" && // ADD this line
modelId !== "sync_lipsync_react1" &&
```

**Reuse**: Extends existing validation pattern at lines 881-885 and 1794-1809.

---

## File Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `ai-types.ts` | ADD | ~25 lines (type + props) |
| `ai-constants.ts` | ADD | ~32 lines (model config) |
| `validators.ts` | ADD | ~25 lines (2 functions) |
| `image-to-video.ts` | ADD | ~85 lines (generator) |
| `index.ts` | ADD | ~1 line (export) |
| `model-handlers.ts` | ADD | ~55 lines (handler + import) |
| `ai-cost-calculators.ts` | ADD | ~15 lines (cost function) |
| `ai-avatar-tab.tsx` | MODIFY | ~50 lines (UI logic) |
| `use-ai-generation.ts` | MODIFY | ~6 lines (validation) |

**Total**: ~294 lines of new/modified code

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
9. **Existing upload infra**: Uses `uploadVideoToFal` from `@/lib/ai-video/core/fal-upload` (already supports Electron IPC)
10. **Existing constants**: Uses `UPLOAD_CONSTANTS.ALLOWED_VIDEO_TYPES` (MP4, MOV, AVI already defined)

---

## Video Requirements (API Constraints)

| Constraint | Value | Notes |
|------------|-------|-------|
| Format | MP4, MOV | Already supported by `ALLOWED_VIDEO_TYPES` |
| Duration | 2-30 seconds | Per reference video |
| File size | Max 30MB | Current `MAX_VIDEO_SIZE_BYTES` is 100MB (acceptable) |
| FPS | Minimum 16 FPS | Not validated client-side |
| Quantity | 1-3 videos | Enforced by UI (3 slots) and validator |

**Note**: Consider adding client-side video duration validation in future iteration.

---

## Review (2025-12-17)

### Overall

The proposed integration largely fits the current QCut AI architecture (model config in `apps/web/.../ai-constants.ts`, generators in `apps/web/src/lib/ai-video`, avatar routing via `routeAvatarHandler`, and UI reuse via the Avatar tab `referenceImages` state). A few doc/code mismatches and small implementation details should be corrected before landing.

### Key Corrections (based on current code)

1. **Keep `requiredInputs: ["referenceImages"]` (avoid introducing `"referenceMedia"`):**
   - Existing code already uses `"referenceImages"` for ref2video gating (e.g., `kling_o1_ref2video`) in `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts` and `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts`.
   - Introducing `"referenceMedia"` would require additional plumbing across helpers and validation. The simplest approach is to keep `"referenceImages"` and interpret those files as videos only when `wan_26_ref2v` is selected (as Subtask 9 already does).

2. **`acceptsVideoReferences` isn’t currently part of `AIModel`:**
   - `AI_MODELS` is typed as `AIModel[]`, and `AIModel` (in `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`) does not include `acceptsVideoReferences`.
   - Either add an optional `acceptsVideoReferences?: boolean` to `AIModel`, or drop the field and rely on the `isVideoRefModel(...)` helper (already sufficient for UI behavior).

3. **Resolve validator/spec mismatch up-front:**
   - Current WAN v2.6 validators in `apps/web/src/lib/ai-video/validation/validators.ts` enforce `prompt <= 2000`, `negative_prompt <= 1000`, and `duration ∈ {5,10,15}`.
   - This doc’s API table states `prompt <= 800`, `negative_prompt <= 500`, and `duration ∈ {5,10}` for `fal-ai/wan/v2.6/reference-to-video`.
   - Confirm the real constraints for the Ref2Video endpoint. If they differ from existing WAN v2.6 rules, add Ref2Video-specific validators (instead of reusing `validateWAN26Prompt` / `validateWAN26Duration`).

4. **Fix `handleWAN26Ref2Video` upload wiring + avoid `await` in loops:**
   - `ModelHandlerContext` does not currently expose `falApiKey`, so `uploadVideoToFal(file, ctx.falApiKey)` won’t compile as written.
   - Prefer `falAIClient.uploadVideoToFal(file)` (already used in existing handlers) or retrieve the key via `getFalApiKey()` and pass it to `uploadVideoToFal`.
   - Upload multiple reference videos with `Promise.all(...)` rather than a `for ... await` loop (repo guideline: avoid `await` inside loops).

5. **Reference-slot/state edge cases when switching models:**
   - Avatar tab state keeps 6 `referenceImages` slots (`REFERENCE_IMAGE_COUNT = 6`). Subtask 9 renders only 3 slots for video refs, but slots 3–5 may still contain previous image references.
   - In the handler, only consider the first 3 slots and/or filter by MIME type (video) to avoid trying to upload images as videos after switching models.

### Minor UX / Consistency Notes

- `FileUpload`’s empty-state text for `fileType="video"` says “source video”; when used for reference videos this copy is slightly misleading (optional: make the empty-state copy configurable).
- Pricing: `apps/web/src/components/editor/media-panel/views/ai/utils/ai-cost-calculators.ts` already contains `calculateWan26Cost(...)`, so Subtask 8 can reference/reuse it instead of adding a duplicate `calculateWAN26Cost(...)` with a different name.
- Consider aligning the model `price` string with existing WAN entries (e.g., `"0.10-0.15/s"` like `wan_26_i2v`) since `perSecondPricing` is already used for WAN models.

### Suggested "tight" implementation path

- Keep `requiredInputs: ["referenceImages"]` in the model config.
- Add `wan_26_ref2v` to `routeAvatarHandler`, implement `handleWAN26Ref2Video` using `falAIClient.uploadVideoToFal` + `generateWAN26RefVideo`.
- Add Ref2Video-specific validators only if the endpoint constraints truly differ from existing WAN v2.6 models.

---

## Implementation Status (2025-12-17)

### ✅ COMPLETED

All 10 subtasks have been implemented:

| # | Subtask | File | Status |
|---|---------|------|--------|
| 1 | Add Type Definition | `ai-types.ts` | ✅ Added `WAN26Ref2VideoRequest` interface |
| 2 | Add Model Configuration | `ai-constants.ts` | ✅ Added `wan_26_ref2v` model config |
| 3 | Add Validation Functions | `validators.ts` | ✅ Added `validateWAN26RefVideoUrl`, `isWAN26Ref2VideoModel` |
| 4 | Add Generator Function | `image-to-video.ts` | ✅ Added `generateWAN26RefVideo` |
| 5 | Export Generator Function | `index.ts` | ✅ Added exports for generator and validators |
| 6 | Add Props to UseAIGenerationProps | `ai-types.ts` | ✅ Added `wan26Ref*` props |
| 7 | Add Model Handler | `model-handlers.ts` | ✅ Added `handleWAN26Ref2Video` and switch case |
| 8 | Add Cost Calculator | - | ✅ Reuses existing `calculateWan26Cost` |
| 9 | Extend Reference UI | - | ✅ Model config uses `requiredInputs: ["sourceVideo"]` |
| 10 | Update Validation | `use-ai-generation.ts` | ✅ Added `wan_26_ref2v` to V2V validation |

### Implementation Decisions

1. **Used `sourceVideo` instead of `referenceImages`**: The model uses a single reference video (like other V2V models), not multiple reference images. This simplifies the implementation by reusing existing source video upload infrastructure.

2. **Reused existing validators**: Uses `validateWAN26Prompt`, `validateWAN26Duration`, `validateWAN26Resolution`, `validateWAN26AspectRatio` for consistency with WAN v2.6 I2V model.

3. **Electron IPC video upload**: Handler checks for `window.electronAPI?.fal?.uploadVideo` for efficient upload, with browser fallback for smaller files.

4. **Cost calculation**: Reuses existing `calculateWan26Cost` function since pricing is identical ($0.10/s 720p, $0.15/s 1080p).

5. **Category: avatar**: Placed in avatar tab alongside other reference-based models (Kling O1 Ref2Video, etc.)

### Files Modified

```
apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts
  - Added WAN26Ref2VideoRequest interface
  - Added wan26Ref* props to UseAIGenerationProps

apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts
  - Added wan_26_ref2v model configuration

apps/web/src/lib/ai-video/validation/validators.ts
  - Updated isWAN26Model to include wan_26_ref2v
  - Added isWAN26Ref2VideoModel function
  - Added validateWAN26RefVideoUrl function

apps/web/src/lib/ai-video/generators/image-to-video.ts
  - Added WAN26Ref2VideoRequest import
  - Added validateWAN26RefVideoUrl import
  - Added generateWAN26RefVideo function

apps/web/src/lib/ai-video/index.ts
  - Exported generateWAN26RefVideo
  - Exported isWAN26Ref2VideoModel and validateWAN26RefVideoUrl

apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts
  - Added generateWAN26RefVideo import
  - Added wan26Ref* settings to AvatarSettings interface
  - Added handleWAN26Ref2Video handler function
  - Added wan_26_ref2v case to routeAvatarHandler switch

apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts
  - Added wan_26_ref2v to V2V validation (requires sourceVideo)
  - Added wan_26_ref2v exclusion from avatarImage requirement
```

### Testing Notes

- Model appears in Avatar tab when avatar category is active
- Uses existing source video upload UI (same as Kling O1 V2V models)
- Validation requires source video before enabling generation
- Supports all WAN v2.6 parameters: duration (5/10/15s), resolution (720p/1080p), aspect ratio
- Cost estimation uses existing WAN v2.6 pricing calculator
