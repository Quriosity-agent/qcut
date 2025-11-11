# Adding Seedance Image-to-Video Models to QCut

## Overview
This document describes how to add the ByteDance Seedance v1 Pro image-to-video models to QCut's AI video generation panel. These models animate static images based on text descriptions, generating high-quality videos with flexible resolution and duration options.

**Model Positioning**: The Seedance image-to-video models should be placed **after the LTX models** in the `ai-constants.ts` file (specifically after `ltxv2_fast_i2v`).

## Quick Implementation Summary

This implementation adds **two Seedance models** to the image-to-video workflow:
1. **Seedance v1 Pro Fast I2V** - Fast generation (~$0.24/5s)
2. **Seedance v1 Pro I2V** - Premium quality (~$0.62/5s)

**Files to modify**: 4 main files
- `ai-constants.ts` - Add model definitions
- `use-ai-generation.ts` - Add generation handlers
- `ai-video-client.ts` - Add API client function
- `ai-types.ts` - Add TypeScript types

**Estimated implementation time**: 2-3 hours

## Model Information

### Two Model Variants

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

### Image Requirements
- **Formats**: JPEG, PNG, WebP (standard image formats)
- **Input Method**: URL (publicly accessible) or file upload
- **Aspect Ratio**: Auto-detection or manual specification

## Current Implementation Status

### ✅ Already Implemented
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

### ❌ Missing Implementation
- **No image-to-video category entries**: Need to add Pro Fast and Pro models with `category: "image"`
- **Missing in UI**: The image-to-video tab doesn't show Seedance models as options

## Implementation Plan

### Step 1: Add Image-to-Video Model Entries

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Location**: After line 252 (after the `ltxv2_fast_i2v` model definition ends)

**Action**: Add two new model configurations:

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
```

### Step 2: Add Generation Handler in use-ai-generation.ts

**File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**Location**: In the `handleGenerate` function, within the `activeTab === "image"` section, after the existing LTX Video 2.0 Fast image-to-video handler (around line 985)

**Action**: Add Seedance image-to-video handling logic following the pattern of existing models:

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

2. **Destructure new props** (around line 94):
```typescript
seedanceDuration = 5,
seedanceResolution = "1080p",
seedanceAspectRatio = "16:9",
seedanceCameraFixed = false,
seedanceEndFrameUrl,
```

### Step 3: Add API Client Function

**File**: `qcut/apps/web/src/lib/ai-video-client.ts`

**Location**: After the `generateLTXV2ImageVideo` function (around line 1900+)

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
```

**Import Addition**: At the top of the file where imports are (around line 13), add to the import from use-ai-generation.ts:
```typescript
import { generateSeedanceVideo } from "@/lib/ai-video-client";
```

### Step 4: Update Type Definitions

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`

**Location**: In the `UseAIGenerationProps` interface (around line 175)

**Action**: Add Seedance-specific prop types:

```typescript
// Seedance options
seedanceDuration?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
seedanceResolution?: "480p" | "720p" | "1080p";
seedanceAspectRatio?: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "auto";
seedanceCameraFixed?: boolean;
seedanceEndFrameUrl?: string; // For Pro model only
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
   - **Line ~252**: Add two new model entries with `category: "image"` after `ltxv2_fast_i2v`
   - Models: `seedance_pro_fast_i2v` and `seedance_pro_i2v`

### 2. `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
   - **Line ~13**: Import `generateSeedanceVideo` from `@/lib/ai-video-client`
   - **Line ~57-94**: Add Seedance props to `UseAIGenerationProps` interface
   - **Line ~94**: Destructure new Seedance props with defaults
   - **Line ~985**: Add Seedance image-to-video generation handlers in `handleGenerate` function

### 3. `qcut/apps/web/src/lib/ai-video-client.ts`
   - **Line ~1900**: Add `SeedanceI2VRequest` interface
   - **Line ~1900**: Add `generateSeedanceVideo` function implementation
   - **Exports**: Export the new `generateSeedanceVideo` function

### 4. `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`
   - **Line ~175**: Add Seedance prop types to `UseAIGenerationProps` interface

### 5. `qcut/apps/web/src/test/integration/new-video-models.test.ts` (Optional)
   - Add test cases for Seedance Pro Fast and Pro image-to-video models

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

- [FAL.ai Seedance v1 Pro Fast Image-to-Video API](https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/fast/image-to-video/api)
- [FAL.ai Seedance v1 Pro Image-to-Video API](https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/image-to-video/api)
- [QCut AI Constants](../../apps/web/src/components/editor/media-panel/views/ai-constants.ts)
- [QCut AI Video Client](../../apps/web/src/lib/ai-video-client.ts)

## Status

- **Created**: 2025-11-11
- **Updated**: 2025-11-11
- **Status**: Pending Implementation
- **Priority**: Medium
- **Estimated Effort**: 3-4 hours (two models)
