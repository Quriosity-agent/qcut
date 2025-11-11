# Adding Image-to-Video Models to QCut

## Overview
This document describes how to add new image-to-video models to QCut's AI video generation panel. It uses **Seedance v1 Pro** and **Kling v2.5 Turbo Pro** as reference implementations, showing the complete workflow for integrating image-to-video models that animate static images based on text descriptions.

**Model Positioning**: New image-to-video models should be placed **after the LTX models** in the `ai-constants.ts` file (specifically after `ltxv2_fast_i2v`) to maintain logical grouping.

## Quick Implementation Summary

This guide covers adding **three image-to-video models**:

### Seedance Models (Pending Implementation)
1. **Seedance v1 Pro Fast I2V** - Fast generation (~$0.24/5s, 2-12s duration)
2. **Seedance v1 Pro I2V** - Premium quality (~$0.62/5s, 2-12s duration)

### Kling Model (Partially Implemented)
3. **Kling v2.5 Turbo Pro I2V** - Already has endpoint defined, needs handler implementation ($0.35/5s, 5-10s duration)

**Files to modify**: 4 main files
- `ai-constants.ts` - Add model definitions (or update existing)
- `use-ai-generation.ts` - Add generation handlers
- `ai-video-client.ts` - Add API client function
- `ai-types.ts` - Add TypeScript types

**Estimated implementation time**: 3-4 hours (all three models)

## Architecture Considerations

### Design Pattern
This implementation follows the **existing LTX Video 2.0 pattern** established in the codebase:
- Declarative model configuration in `ai-constants.ts`
- Model-specific handler functions in `ai-video-client.ts`
- Type-safe parameter passing through interfaces
- Centralized error handling and logging

### Scalability Concern
⚠️ **Current Limitation**: Each new model requires adding model-specific props (e.g., `seedanceDuration`, `ltxv2Duration`, `viduQ2Duration`), which doesn't scale well.

**Future Improvement**: Consider refactoring to a generic `modelOptions` object that can accept dynamic parameters based on `selectedModels`. This would eliminate the need for model-specific props and make adding new models trivial.

```typescript
// Future pattern (not implemented yet):
modelOptions?: Record<string, {
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  [key: string]: unknown;
}>;
```

## Model Information

### Seedance Models (ByteDance)

#### 1. Seedance v1 Pro Fast I2V
- **Model ID**: `fal-ai/bytedance/seedance/v1/pro/fast/image-to-video`
- **Documentation**: https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/fast/image-to-video/api
- **Description**: Fast image-to-video generation with balanced quality and speed

#### 2. Seedance v1 Pro I2V
- **Model ID**: `fal-ai/bytedance/seedance/v1/pro/image-to-video`
- **Documentation**: https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/image-to-video/api
- **Description**: Premium quality image-to-video with highest fidelity

### Capabilities
- **Input**: Image URL + text prompt describing desired animation
- **Resolution Options**: 480p, 720p, 1080p
- **Duration Options**: 2-12 seconds (in 1-second increments, default: 5s)
- **Aspect Ratios**: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16, auto (maintains original image aspect ratio)
- **Camera Control**: Fixed camera position option
- **Seed Support**: Reproducible results with seed parameter
- **End Frame**: Optional end-frame image for specific video conclusions (Pro only)
- **Safety Checker**: Content filtering (enabled by default)

### Pricing

#### Seedance v1 Pro Fast
- **Calculation**: $1.00 per million video tokens
- **Formula**: tokens = (height × width × FPS × duration) / 1024
- **Example**: ~$0.243 per 1080p 5-second video

#### Seedance v1 Pro
- **Calculation**: $2.50 per million video tokens
- **Formula**: tokens = (height × width × FPS × duration) / 1024
- **Example**: ~$0.62 per 1080p 5-second video

#### Image Requirements (Seedance)
- **Formats**: JPEG, PNG, WebP (standard image formats)
- **Input Method**: URL (publicly accessible) or file upload
- **Aspect Ratio**: Auto-detection or manual specification

---

### Kling v2.5 Turbo Pro Model

#### Model Details
- **Model ID**: `fal-ai/kling-video/v2.5-turbo/pro/image-to-video`
- **Documentation**: https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video/api
- **Description**: Top-tier image-to-video generation with unparalleled motion fluidity and cinematic visuals

#### Capabilities
- **Input**: Image URL + text prompt (max 2,500 characters)
- **Resolution**: 1080p
- **Duration Options**: 5s, 10s (default: 5s)
- **Aspect Ratios**: 16:9 (default), 9:16, 1:1, 4:3, 3:4
- **CFG Scale**: 0-1 range (default: 0.5) - controls prompt adherence
- **Negative Prompt**: Custom quality directives (default: "blur, distort, and low quality")
- **Prompt Enhancement**: Available via `enhance_prompt` parameter

#### Pricing
- **5-second video**: $0.35
- **10-second video**: $0.70 ($0.35 + $0.35)
- **Per second**: $0.07/second beyond base 5s
- **Commercial Use**: Permitted

#### Image Requirements (Kling)
- **Input Method**: URL-based or base64 data URI format
- **Formats**: Standard image formats (JPEG, PNG, WebP)
- **File Hosting**: Supports fal.storage uploads or hosted files

## Current Implementation Status

### ✅ Already Implemented

#### Seedance Text-to-Video
The Seedance Lite and Pro models are already defined in the constants but only for **text-to-video**:

```typescript
// File: qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts
{
  id: "seedance",
  name: "Seedance v1 Lite",
  description: "Fast and efficient text-to-video generation",
  price: "0.18",
  resolution: "720p",
  max_duration: 10,
  category: "text",
  endpoints: {
    text_to_video: "fal-ai/bytedance/seedance/v1/lite/text-to-video",
  },
  default_params: {
    duration: 5,
    resolution: "720p",
  },
},
{
  id: "seedance_pro",
  name: "Seedance v1 Pro",
  description: "High quality 1080p video generation",
  price: "0.62",
  resolution: "1080p",
  max_duration: 10,
  endpoints: {
    text_to_video: "fal-ai/bytedance/seedance/v1/pro/text-to-video",
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
  },
}
```

#### Kling v2.5 Turbo Pro - Partially Implemented
The Kling v2.5 Turbo Pro model **already has the image-to-video endpoint defined** in `ai-constants.ts` (line 474-492):

```typescript
{
  id: "kling_v2_5_turbo",
  name: "Kling v2.5 Turbo Pro",
  description: "Latest Kling model with enhanced turbo performance",
  price: "0.18", // ⚠️ Note: This is text-to-video price, I2V is $0.35
  resolution: "1080p",
  max_duration: 10,
  category: "text", // ⚠️ Currently set as text, but has I2V endpoint
  endpoints: {
    text_to_video: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    image_to_video: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", // ✅ Endpoint exists
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
    cfg_scale: 0.5,
    aspect_ratio: "16:9",
    enhance_prompt: true,
  },
}
```

**Status**: The model definition exists with the image-to-video endpoint, but it's categorized as "text" only. We can either:
1. **Option A**: Add a separate `kling_v2_5_turbo_i2v` entry with `category: "image"`
2. **Option B**: Update the handler to support both text and image inputs for the same model ID

### ❌ Missing Implementation

#### Seedance Models
- **No image-to-video category entries**: Need to add Pro Fast and Pro models with `category: "image"`
- **Missing in UI**: The image-to-video tab doesn't show Seedance models as options

#### Kling v2.5 Turbo Pro I2V
- **No image-to-video handler**: `use-ai-generation.ts` needs an image-to-video handler
- **No API client function**: Need `generateKlingImageVideo()` function in `ai-video-client.ts`
- **Missing in UI**: Not appearing in image-to-video tab (due to `category: "text"`)

## Implementation Plan

### Step 1: Add Image-to-Video Model Entries

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Location**: In the `AI_MODELS` array, after the LTX Video 2.0 Fast I2V model (`ltxv2_fast_i2v`)

**Why this location?**: Image-to-video models are grouped together by category. Placing new models after LTX maintains logical grouping and makes the codebase easier to navigate.

**Action**: Add model configurations (choose implementation approach):

#### Approach A: Add Separate I2V Entries (Recommended)
Add dedicated image-to-video entries for both Seedance and Kling models:

```typescript
// Seedance Image-to-Video Models - Added after LTX models
// Seedance v1 Pro Fast I2V
{
  id: "seedance_pro_fast_i2v",
  name: "Seedance v1 Pro Fast I2V",
  description: "Fast image-to-video with balanced quality and speed (2-12s)",
  price: "0.24", // ~$0.243 per 1080p 5-second video
  resolution: "480p / 720p / 1080p",
  supportedResolutions: ["480p", "720p", "1080p"],
  max_duration: 12,
  category: "image", // ⭐ Key: This makes it appear in image-to-video tab
  endpoints: {
    image_to_video: "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video",
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
    aspect_ratio: "16:9",
    camera_fixed: false,
    enable_safety_checker: true,
  },
  supportedDurations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
},
// Seedance v1 Pro I2V
{
  id: "seedance_pro_i2v",
  name: "Seedance v1 Pro I2V",
  description: "Premium quality image-to-video with highest fidelity (2-12s)",
  price: "0.62", // ~$0.62 per 1080p 5-second video
  resolution: "480p / 720p / 1080p",
  supportedResolutions: ["480p", "720p", "1080p"],
  max_duration: 12,
  category: "image",
  endpoints: {
    image_to_video: "fal-ai/bytedance/seedance/v1/pro/image-to-video",
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
    aspect_ratio: "16:9",
    camera_fixed: false,
    enable_safety_checker: true,
  },
  supportedDurations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
},
// Kling v2.5 Turbo Pro I2V
{
  id: "kling_v2_5_turbo_i2v",
  name: "Kling v2.5 Turbo Pro I2V",
  description: "Top-tier image-to-video with cinematic motion fluidity (5-10s)",
  price: "0.35", // $0.35 for 5s, $0.07 per additional second
  resolution: "1080p",
  supportedResolutions: ["1080p"],
  max_duration: 10,
  category: "image", // ⭐ Key: Makes it appear in image-to-video tab
  endpoints: {
    image_to_video: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
    aspect_ratio: "16:9",
    cfg_scale: 0.5,
    enhance_prompt: true,
    negative_prompt: "blur, distort, and low quality",
  },
  supportedDurations: [5, 10],
},
```

#### Approach B: Update Existing Kling Entry
Alternatively, change the existing `kling_v2_5_turbo` model's category from `"text"` to support both:

```typescript
// Update existing entry (line 474)
{
  id: "kling_v2_5_turbo",
  name: "Kling v2.5 Turbo Pro",
  description: "Latest Kling model with enhanced turbo performance",
  price: "0.18 (T2V) / 0.35 (I2V)",
  resolution: "1080p",
  max_duration: 10,
  category: "text", // Keep as text, but add I2V handler logic
  endpoints: {
    text_to_video: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    image_to_video: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  },
  // ... rest of config
}
```

**Note**: This requires additional handler logic to check which tab is active and route accordingly.

**Recommendation**: Use **Approach A** (separate entries) for cleaner separation and easier maintenance.

### Step 2: Add Generation Handler in use-ai-generation.ts

**File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**Location**: In the `handleGenerate` function, within the `else if (activeTab === "image")` block, after the LTX Video 2.0 Fast I2V handler (`else if (modelId === "ltxv2_fast_i2v")`)

**Why here?**: The `handleGenerate` function uses a series of `if/else if` statements to route to model-specific handlers. Placing Seedance handlers after LTX maintains consistency with the model ordering in `ai-constants.ts`.

**Pattern to Follow**: Look for the LTX Video 2.0 Fast I2V handler as a reference - it shows the complete pattern for:
- Image validation
- Image upload to FAL
- Progress callbacks
- Error handling
- Response processing

**Action**: Add Seedance image-to-video handling logic following this established pattern:

```typescript
// Seedance v1 Pro Fast I2V
else if (modelId === "seedance_pro_fast_i2v") {
  if (!selectedImage) {
    console.log("  ⚠️ Skipping model - Seedance Pro Fast requires a selected image");
    continue;
  }

  const imageUrl = await uploadImageToFal(selectedImage);
  const friendlyName = modelName || modelId;
  progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${friendlyName} request...`,
  });

  response = await generateSeedanceVideo({
    model: modelId,
    prompt: prompt.trim(),
    image_url: imageUrl,
    duration: seedanceDuration, // Add new state variable
    resolution: seedanceResolution, // Add new state variable
    aspect_ratio: seedanceAspectRatio, // Add new state variable
    camera_fixed: seedanceCameraFixed, // Add new state variable
  });

  progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${friendlyName}`,
  });
}
// Seedance v1 Pro I2V
else if (modelId === "seedance_pro_i2v") {
  if (!selectedImage) {
    console.log("  ⚠️ Skipping model - Seedance Pro requires a selected image");
    continue;
  }

  const imageUrl = await uploadImageToFal(selectedImage);
  const friendlyName = modelName || modelId;
  progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${friendlyName} request...`,
  });

  response = await generateSeedanceVideo({
    model: modelId,
    prompt: prompt.trim(),
    image_url: imageUrl,
    duration: seedanceDuration,
    resolution: seedanceResolution,
    aspect_ratio: seedanceAspectRatio,
    camera_fixed: seedanceCameraFixed,
    end_frame_url: seedanceEndFrameUrl, // Optional, Pro only
  });

  progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${friendlyName}`,
  });
}
// Kling v2.5 Turbo Pro I2V
else if (modelId === "kling_v2_5_turbo_i2v") {
  if (!selectedImage) {
    console.log("  ⚠️ Skipping model - Kling v2.5 Turbo Pro requires a selected image");
    continue;
  }

  const imageUrl = await uploadImageToFal(selectedImage);
  const friendlyName = modelName || modelId;
  progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${friendlyName} request...`,
  });

  response = await generateKlingImageVideo({
    model: modelId,
    prompt: prompt.trim(),
    image_url: imageUrl,
    duration: klingDuration, // Add new state variable
    cfg_scale: klingCfgScale, // Add new state variable
    aspect_ratio: klingAspectRatio, // Add new state variable
    enhance_prompt: klingEnhancePrompt, // Add new state variable
    negative_prompt: klingNegativePrompt, // Add new state variable
  });

  progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${friendlyName}`,
  });
}
```

**Additional Changes in same file**:

1. **Add props to UseAIGenerationProps** (around line 57-94):
```typescript
// Seedance options
seedanceDuration?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
seedanceResolution?: "480p" | "720p" | "1080p";
seedanceAspectRatio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "auto";
seedanceCameraFixed?: boolean;
seedanceEndFrameUrl?: string; // For Pro model only
```

2. **Destructure new props**:
```typescript
// Seedance defaults
seedanceDuration = 5,
seedanceResolution = "1080p",
seedanceAspectRatio = "16:9",
seedanceCameraFixed = false,
seedanceEndFrameUrl,

// Kling defaults
klingDuration = 5,
klingCfgScale = 0.5,
klingAspectRatio = "16:9",
klingEnhancePrompt = true,
klingNegativePrompt = "blur, distort, and low quality",
```

### Step 3: Add API Client Function

**File**: `qcut/apps/web/src/lib/ai-video-client.ts`

**Location**: After the `generateLTXV2ImageVideo` function (search for "Generate video from image using LTX Video 2.0")

**Why separate function?**: Following the established pattern:
- `generateVideo()` - Generic text-to-video
- `generateVideoFromImage()` - Generic image-to-video
- `generateLTXV2Video()` - LTX-specific text-to-video
- `generateLTXV2ImageVideo()` - LTX-specific image-to-video
- `generateViduQ2Video()` - Vidu-specific
- **`generateSeedanceVideo()`** - Seedance-specific (new)
- **`generateKlingImageVideo()`** - Kling I2V-specific (new)

Each model-specific function provides:
- Type-safe parameter interfaces
- Model-specific validation
- Consistent error handling
- API endpoint configuration

**Action**: Add the Seedance video generation function following the LTX pattern:

```typescript
/**
 * Seedance Image-to-Video Request Interface
 */
export interface SeedanceI2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  resolution?: "480p" | "720p" | "1080p";
  aspect_ratio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "auto";
  camera_fixed?: boolean;
  seed?: number;
  enable_safety_checker?: boolean;
  end_frame_url?: string; // Pro model only
}

/**
 * Generate video from image using Seedance v1 Pro models.
 *
 * @param request - Prompt, model ID, image URL, and optional parameters
 */
export async function generateSeedanceVideo(
  request: SeedanceI2VRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt?.trim() ?? "";
    if (!trimmedPrompt) {
      throw new Error("Please enter a prompt describing the desired animation");
    }

    if (!request.image_url) {
      throw new Error("Image URL is required for Seedance image-to-video generation");
    }

    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.image_to_video;
    if (!endpoint) {
      throw new Error(`Model ${request.model} does not support image-to-video generation`);
    }

    const duration = request.duration ?? 5;
    const resolution = request.resolution ?? "1080p";
    const aspectRatio = request.aspect_ratio ?? "16:9";
    const cameraFixed = request.camera_fixed ?? false;

    const payload: Record<string, unknown> = {
      prompt: trimmedPrompt,
      image_url: request.image_url,
      duration,
      resolution,
      aspect_ratio: aspectRatio,
      camera_fixed: cameraFixed,
      enable_safety_checker: request.enable_safety_checker ?? true,
    };

    // Add optional parameters
    if (request.seed !== undefined) {
      payload.seed = request.seed;
    }

    // Pro model only: end frame support
    if (request.end_frame_url && request.model === "seedance_pro_i2v") {
      payload.end_frame_url = request.end_frame_url;
    }

    const jobId = `seedance-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error("Invalid FAL.ai API key. Please check your API key configuration.");
      }

      if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please wait a moment before trying again.");
      }

      throw new Error(`FAL API error: ${errorData.detail || response.statusText}`);
    }

    const result = await response.json();
    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video || result.url,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate Seedance video", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateSeedanceVideo",
    });
    throw error;
  }
}

/**
 * Kling v2.5 Turbo Pro Image-to-Video Request Interface
 */
export interface KlingI2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 5 | 10;
  cfg_scale?: number; // 0-1 range
  aspect_ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  enhance_prompt?: boolean;
  negative_prompt?: string;
}

/**
 * Generate video from image using Kling v2.5 Turbo Pro.
 *
 * @param request - Prompt, model ID, image URL, and optional parameters
 */
export async function generateKlingImageVideo(
  request: KlingI2VRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt?.trim() ?? "";
    if (!trimmedPrompt) {
      throw new Error("Please enter a prompt describing the desired video motion");
    }

    if (!request.image_url) {
      throw new Error("Image URL is required for Kling image-to-video generation");
    }

    if (trimmedPrompt.length > 2500) {
      throw new Error("Prompt exceeds maximum length of 2,500 characters");
    }

    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    const endpoint = modelConfig.endpoints.image_to_video;
    if (!endpoint) {
      throw new Error(`Model ${request.model} does not support image-to-video generation`);
    }

    const duration = request.duration ?? 5;
    const cfgScale = request.cfg_scale ?? 0.5;
    const aspectRatio = request.aspect_ratio ?? "16:9";

    const payload: Record<string, unknown> = {
      prompt: trimmedPrompt,
      image_url: request.image_url,
      duration,
      cfg_scale: cfgScale,
      aspect_ratio: aspectRatio,
      enhance_prompt: request.enhance_prompt ?? true,
      negative_prompt: request.negative_prompt ?? "blur, distort, and low quality",
    };

    const jobId = `kling-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error("Invalid FAL.ai API key. Please check your API key configuration.");
      }

      if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please wait a moment before trying again.");
      }

      throw new Error(`FAL API error: ${errorData.detail || response.statusText}`);
    }

    const result = await response.json();
    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video || result.url,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate Kling v2.5 Turbo Pro video", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateKlingImageVideo",
    });
    throw error;
  }
}
```

**Import Addition**: In `use-ai-generation.ts`, find the imports section at the top of the file and add:
```typescript
import { generateSeedanceVideo, generateKlingImageVideo } from "@/lib/ai-video-client";
```

**Note**: The imports should be added alongside existing imports like `generateLTXV2ImageVideo`, `generateViduQ2Video`, etc. from the same module.

### Step 4: Update Type Definitions

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`

**Location**: In the `UseAIGenerationProps` interface, after the LTX Video 2.0 Fast I2V options section

**Why add props?**: Currently, the codebase uses model-specific props for configuration. While this pattern doesn't scale optimally (see Architecture Considerations above), it maintains consistency with existing code.

**Action**: Add model-specific prop types:

```typescript
// Seedance options
seedanceDuration?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
seedanceResolution?: "480p" | "720p" | "1080p";
seedanceAspectRatio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "auto";
seedanceCameraFixed?: boolean;
seedanceEndFrameUrl?: string; // For Pro model only

// Kling v2.5 Turbo Pro I2V options
klingDuration?: 5 | 10;
klingCfgScale?: number; // 0-1 range
klingAspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
klingEnhancePrompt?: boolean;
klingNegativePrompt?: string;
```

### Step 5: Add UI Controls (Optional - for full implementation)
The models should automatically appear in the image-to-video model selector. Additional controls to consider:

1. **Resolution Selector** (480p / 720p / 1080p)
2. **Duration Selector** (2-12 seconds in 1-second increments)
3. **Aspect Ratio Selector** (21:9, 16:9, 4:3, 1:1, 3:4, 9:16, auto)
4. **Camera Fixed Toggle** (locks camera position, default: off)
5. **Seed Input** (optional, for reproducible results)
6. **End Frame Upload** (optional, Pro model only)
7. **Safety Checker Toggle** (default: on)

### Step 6: API Request/Response Format

**Request (Pro Fast):**
```json
{
  "image_url": "https://example.com/image.jpg",
  "prompt": "The camera slowly zooms in on the subject",
  "resolution": "1080p",
  "duration": 5,
  "aspect_ratio": "16:9",
  "camera_fixed": false,
  "enable_safety_checker": true,
  "seed": 12345 // optional for reproducibility
}
```

**Request (Pro with End Frame):**
```json
{
  "image_url": "https://example.com/start.jpg",
  "end_frame_url": "https://example.com/end.jpg", // optional, Pro only
  "prompt": "The camera slowly zooms in on the subject",
  "resolution": "1080p",
  "duration": 5,
  "aspect_ratio": "16:9",
  "camera_fixed": false,
  "enable_safety_checker": true,
  "seed": 12345
}
```

**Response:**
```json
{
  "video": {
    "url": "https://v3.fal.media/files/.../video.mp4",
    "content_type": "video/mp4",
    "width": 1920,
    "height": 1080,
    "file_name": "video.mp4",
    "file_size": 15728640
  },
  "seed": 12345,
  "timings": {
    "inference": 45.2
  }
}
```

### Step 7: Testing Checklist

**Seedance Pro Fast I2V:**
- [ ] Model appears in image-to-video tab UI
- [ ] Image upload works correctly
- [ ] Prompt input is functional
- [ ] Resolution selector works (480p/720p/1080p)
- [ ] Duration selector works (2-12 seconds)
- [ ] Aspect ratio selector works (21:9, 16:9, 4:3, 1:1, 3:4, 9:16, auto)
- [ ] Camera fixed toggle works
- [ ] Seed input for reproducibility works
- [ ] Progress indicator shows during generation
- [ ] Generated video downloads correctly
- [ ] Video can be added to timeline
- [ ] Error handling works (invalid image, API errors)
- [ ] Cost calculation is accurate (~$0.24 per 1080p 5s video)
- [ ] Safety checker filters inappropriate content

**Seedance Pro I2V:**
- [ ] Model appears in image-to-video tab UI
- [ ] All Pro Fast features work
- [ ] End frame upload is optional and works (Pro exclusive)
- [ ] Cost calculation is accurate (~$0.62 per 1080p 5s video)

## Files to Modify Summary

### 1. `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
   - **Location**: `AI_MODELS` array, after `ltxv2_fast_i2v`
   - **Changes**: Add three model entries with `category: "image"`
   - **Models**:
     - `seedance_pro_fast_i2v` - Seedance Pro Fast
     - `seedance_pro_i2v` - Seedance Pro
     - `kling_v2_5_turbo_i2v` - Kling v2.5 Turbo Pro I2V

### 2. `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
   - **Import section**: Add `generateSeedanceVideo` and `generateKlingImageVideo` imports
   - **Props interface**: Add Seedance and Kling specific props
   - **Destructure section**: Add default values for new props
   - **handleGenerate function**: Add handlers for all three models in image tab section

### 3. `qcut/apps/web/src/lib/ai-video-client.ts`
   - **Interfaces section**:
     - Add `SeedanceI2VRequest` interface
     - Add `KlingI2VRequest` interface
   - **Functions section**:
     - Add `generateSeedanceVideo` function
     - Add `generateKlingImageVideo` function
   - **Exports**: Ensure both functions are exported

### 4. `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`
   - **UseAIGenerationProps interface**: Add prop types for Seedance and Kling models

### 5. `qcut/apps/web/src/test/integration/new-video-models.test.ts` (Optional)
   - Add test cases for all three models

## Maintenance Notes

### When Adding Future Models

This document serves as a template for adding new image-to-video models. Follow this checklist:

1. **Model Definition** → Add to `ai-constants.ts` with appropriate `category`
2. **Type Interface** → Create request interface in `ai-video-client.ts`
3. **API Function** → Implement model-specific generation function
4. **Handler Logic** → Add routing logic in `use-ai-generation.ts`
5. **Type Props** → Add prop types to `ai-types.ts` (if using current pattern)

### Code Smell Alert

⚠️ **Props Explosion**: If you find yourself adding more than 3 model-specific prop sets, consider refactoring to use a generic `modelOptions` parameter instead of individual props. This is a sign the current pattern isn't scaling.

### Breaking Changes to Watch For

- **FAL API Changes**: Monitor the FAL.ai API documentation for breaking changes to Seedance endpoints
- **Parameter Changes**: Resolution/duration options may change; update `supportedResolutions`/`supportedDurations` arrays
- **Pricing Updates**: Token-based pricing may change; update cost examples in documentation

## Example Usage

### JavaScript Client - Pro Fast
```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe(
  "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video",
  {
    input: {
      prompt: "The camera slowly zooms in on the subject",
      image_url: "https://example.com/photo.jpg",
      resolution: "1080p",
      duration: 5,
      aspect_ratio: "16:9",
      camera_fixed: false,
      enable_safety_checker: true
    },
    logs: true,
    onQueueUpdate: (update) => {
      console.log("Queue status:", update.status);
    }
  }
);

console.log("Video URL:", result.video.url);
```

### JavaScript Client - Pro with End Frame
```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe(
  "fal-ai/bytedance/seedance/v1/pro/image-to-video",
  {
    input: {
      prompt: "Smooth transition between frames",
      image_url: "https://example.com/start.jpg",
      end_frame_url: "https://example.com/end.jpg", // Optional
      resolution: "1080p",
      duration: 8,
      aspect_ratio: "16:9",
      camera_fixed: false,
      seed: 12345 // For reproducible results
    },
    logs: true,
    onQueueUpdate: (update) => {
      console.log("Queue status:", update.status);
    }
  }
);

console.log("Video URL:", result.video.url);
console.log("Seed used:", result.seed);
```

### Expected Processing Time
- **Pro Fast**: Faster generation, optimized for speed
- **Pro**: Higher quality, longer processing time
- **5-second video**: 1-3 minutes
- **12-second video**: 3-5 minutes

## Notes

1. **Token-Based Pricing**: Both models use video token calculation: `(height × width × FPS × duration) / 1024`
   - Pro Fast: $1.00 per million tokens
   - Pro: $2.50 per million tokens

2. **Aspect Ratio**: Supports multiple aspect ratios (21:9, 16:9, 4:3, 1:1, 3:4, 9:16) or auto-detection from input image.

3. **Camera Fixed**: When enabled, locks the camera position to prevent movement - useful for maintaining stable shots.

4. **Safety Checker**: Enabled by default for content filtering. Can be disabled but not recommended for production.

5. **Seed Support**: Use the same seed value for reproducible results across generations.

6. **End Frame (Pro Only)**: The Pro model supports an optional end frame image for more controlled video conclusions.

7. **Cost Examples**:
   - Pro Fast: 5s @ 1080p ≈ $0.24
   - Pro Fast: 12s @ 1080p ≈ $0.58
   - Pro: 5s @ 1080p ≈ $0.62
   - Pro: 12s @ 1080p ≈ $1.49

8. **Commercial Use**: Both models are licensed for commercial use.

## Related Documentation

### External API Documentation
- [FAL.ai Seedance v1 Pro Fast Image-to-Video API](https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/fast/image-to-video/api)
- [FAL.ai Seedance v1 Pro Image-to-Video API](https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/image-to-video/api)
- [FAL.ai Kling v2.5 Turbo Pro Image-to-Video API](https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video/api)

### Internal Codebase
- [QCut AI Constants](../../apps/web/src/components/editor/media-panel/views/ai-constants.ts)
- [QCut AI Video Client](../../apps/web/src/lib/ai-video-client.ts)
- [QCut AI Types](../../apps/web/src/components/editor/media-panel/views/ai-types.ts)

## Document Status

- **Created**: 2025-11-11
- **Last Updated**: 2025-11-11
- **Implementation Status**: Pending
- **Document Type**: Implementation Guide + Architecture Reference
- **Maintenance**: Review when FAL.ai API changes or when adding 3+ more models

## Implementation Status Tracker

Use this section to track progress when implementing:

### Seedance Pro Fast I2V
- [ ] Model definition added to `ai-constants.ts`
- [ ] Handler added to `use-ai-generation.ts`
- [ ] API client function implemented
- [ ] Type definitions added
- [ ] Integration testing completed

### Seedance Pro I2V
- [ ] Model definition added to `ai-constants.ts`
- [ ] Handler added to `use-ai-generation.ts`
- [ ] API client function implemented (shared with Fast)
- [ ] Type definitions added
- [ ] Integration testing completed

### Kling v2.5 Turbo Pro I2V
- [ ] Model definition added to `ai-constants.ts`
- [ ] Handler added to `use-ai-generation.ts`
- [ ] API client function implemented
- [ ] Type definitions added
- [ ] Integration testing completed

### Overall
- [ ] All three models appear in image-to-video tab UI
- [ ] Documentation updated with any deviations from plan
- [ ] Consider refactoring props pattern (see Future Refactoring Opportunity below)

## Future Refactoring Opportunity

When this implementation is complete, consider creating a GitHub issue for refactoring the props pattern to a more scalable approach. Suggested title: "Refactor model options to use generic modelOptions object instead of model-specific props"
