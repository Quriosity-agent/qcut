# Adding Image-to-Video Models to QCut

## Overview
This document describes how to add new image-to-video models to QCut's AI video generation panel. It uses **Seedance v1 Pro** and **Kling v2.5 Turbo Pro** as reference implementations, showing the complete workflow for integrating image-to-video models that animate static images based on text descriptions.

**Model Positioning**: New image-to-video models should be placed **after the LTX models** in the `ai-constants.ts` file (specifically after `ltxv2_fast_i2v`) to maintain logical grouping.

## Quick Implementation Summary

This guide covers adding **four image-to-video models**:

### Seedance Models (Pending Implementation)
1. **Seedance v1 Pro Fast I2V** - Fast generation (~$0.24/5s, 2-12s duration)
2. **Seedance v1 Pro I2V** - Premium quality (~$0.62/5s, 2-12s duration)

### Models with Existing Endpoints (Partially Implemented)
3. **Kling v2.5 Turbo Pro I2V** - Endpoint defined, needs handler ($0.35/5s, 5-10s duration)
4. **WAN 2.5 Preview I2V** - Endpoint defined, needs handler ($0.05-$0.15/s, 5-10s duration)

**Files to modify**: 4 main files
- `ai-constants.ts` - Add model definitions (or update existing)
- `use-ai-generation.ts` - Add generation handlers
- `ai-video-client.ts` - Add API client function
- `ai-types.ts` - Add TypeScript types

**Estimated implementation time**: 5-6 hours (all four models)

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
- **Description**: Premium quality image-to-video with highest fidelity and frame-to-frame animation

### Capabilities
- **Input**: Image URL + text prompt describing desired animation
- **Resolution Options**: 480p, 720p, 1080p
- **Duration Options**: 2-12 seconds (in 1-second increments, default: 5s)
- **Aspect Ratios**: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16, auto (maintains original image aspect ratio)
- **Camera Control**: Fixed camera position option
- **Seed Support**: Reproducible results with seed parameter
- **Frame-to-Frame Animation**:
  - **First Frame** (`image_url`): Required starting frame
  - **Last Frame** (`end_image_url`): Optional ending frame for controlled transitions (Pro only)
  - When both frames provided, generates smooth transition video between them
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

---

### WAN 2.5 Preview Model

#### Model Details
- **Model ID**: `fal-ai/wan-25-preview/image-to-video`
- **Documentation**: https://fal.ai/models/fal-ai/wan-25-preview/image-to-video/api
- **Description**: Next-generation WAN model with improved quality and subject-consistent motion synthesis

#### Capabilities
- **Input**: Image URL + text prompt (max 800 characters)
- **Resolution Options**: 480p, 720p, 1080p (default: 1080p)
- **Duration Options**: 5s, 10s (default: 5s)
- **Audio Support**: Optional background music (WAV/MP3, 3-30 seconds, max 15MB)
- **Prompt Expansion**: LLM-based prompt enhancement (enabled by default)
- **Negative Prompt**: Content to avoid (max 500 characters)
- **Seed Support**: Reproducible results with seed parameter
- **Safety Checker**: Content filtering (enabled by default)

#### Pricing (Per Second Basis)
- **480p**: $0.05/second
- **720p**: $0.10/second
- **1080p**: $0.15/second

**Cost Examples:**
- 5s @ 480p = $0.25
- 5s @ 720p = $0.50
- 5s @ 1080p = $0.75
- 10s @ 1080p = $1.50

#### Image Requirements (WAN 2.5)
- **Formats**: JPEG, JPG, PNG (no alpha channel), BMP, WEBP
- **Resolution Range**: 360-2000 pixels (width and height)
- **Max File Size**: 10MB
- **Input Method**: URL (publicly accessible) or base64 data URI

#### Processing Time
- **5-second video**: 1-3 minutes
- **10-second video**: 3-5 minutes

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

#### WAN 2.5 Preview - Partially Implemented
The WAN 2.5 Preview model **also has the image-to-video endpoint defined** in `ai-constants.ts` (line 69-85):

```typescript
{
  id: "wan_25_preview",
  name: "WAN v2.5 Preview",
  description: "Next-generation WAN model with improved quality",
  price: "0.12", // ⚠️ Note: This is text-to-video price, I2V varies by resolution
  resolution: "1080p",
  max_duration: 10,
  endpoints: {
    text_to_video: "fal-ai/wan-25-preview/text-to-video",
    image_to_video: "fal-ai/wan-25-preview/image-to-video", // ✅ Endpoint exists
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
    quality: "high",
    style_preset: "cinematic",
  },
}
```

**Status**: Similar to Kling, the endpoint exists but the model is categorized as "text" only.

### ❌ Missing Implementation

#### Seedance Models
- **No image-to-video category entries**: Need to add Pro Fast and Pro models with `category: "image"`
- **Missing in UI**: The image-to-video tab doesn't show Seedance models as options

#### Kling v2.5 Turbo Pro I2V
- **No image-to-video handler**: `use-ai-generation.ts` needs an image-to-video handler
- **No API client function**: Need `generateKlingImageVideo()` function in `ai-video-client.ts`
- **Missing in UI**: Not appearing in image-to-video tab (due to `category: "text"`)

#### WAN 2.5 Preview I2V
- **No image-to-video handler**: `use-ai-generation.ts` needs an image-to-video handler
- **No API client function**: Need `generateWAN25ImageVideo()` function in `ai-video-client.ts`
- **Missing in UI**: Not appearing in image-to-video tab (due to no separate I2V entry)

## Implementation Plan

### Step 1: Add Image-to-Video Model Entries

Add enough metadata here so the UI never has to hard-code options:

- Include `supportedAspectRatios` arrays alongside `supportedResolutions`/`supportedDurations` (Seedance needs seven ratios plus `"auto"`, Kling five ratios, WAN can omit because it uses the source image).
- Keep the flat `price` string for consistency, but also add any extra pricing data the UI needs (e.g., `perSecondPricing` for WAN 2.5 with the 0.05/0.10/0.15 rates).

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
  supportedAspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "auto"],
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
  supportedAspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "auto"],
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
  supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
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
// WAN 2.5 Preview I2V
{
  id: "wan_25_preview_i2v",
  name: "WAN v2.5 Preview I2V",
  description: "Next-gen WAN with improved quality and motion synthesis (5-10s)",
  price: "0.75", // $0.75 for 5s @ 1080p (varies by resolution)
  perSecondPricing: { "480p": 0.05, "720p": 0.10, "1080p": 0.15 },
  resolution: "480p / 720p / 1080p",
  supportedResolutions: ["480p", "720p", "1080p"],
  max_duration: 10,
  category: "image", // ⭐ Key: Makes it appear in image-to-video tab
  endpoints: {
    image_to_video: "fal-ai/wan-25-preview/image-to-video",
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
    enable_prompt_expansion: true,
    enable_safety_checker: true,
  },
  supportedDurations: [5, 10],
},
```

#### Approach B: Update Existing Entries
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

**Note**: Approach B requires additional handler logic to check which tab is active and route accordingly.

**Recommendation**: Use **Approach A** (separate entries) for cleaner separation and easier maintenance.

### Step 2: Add Generation Handler in use-ai-generation.ts

While wiring the handlers, make sure the data flow is complete:

- Use a consistent local prop name (`seedanceEndFrameUrl`) and map it to the API's `end_frame_url`.
- If the user supplies a new end frame (or WAN audio track) as a `File`, upload it via a helper (`uploadImageToFal` / new `uploadAudioToFal`) before invoking the client so `end_frame_url`/`audio_url` are real URLs.
- Thread a `seed` prop through the hook (shared across models) and pass it to the model-specific request objects so the Seed control and reproducibility checklist work.

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
  const audioUrl = wan25AudioFile
    ? await uploadAudioToFal(wan25AudioFile)
    : wan25AudioUrl;
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
    seed: imageSeed ?? undefined,
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
  const endFrameUrl = seedanceEndFrameFile
    ? await uploadImageToFal(seedanceEndFrameFile)
    : seedanceEndFrameUrl;
  progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${friendlyName} request...`,
  });

  response = await generateSeedanceVideo({
    model: modelId,
    prompt: prompt.trim(),
    image_url: imageUrl, // First frame (required)
    duration: seedanceDuration,
    resolution: seedanceResolution,
    aspect_ratio: seedanceAspectRatio,
    camera_fixed: seedanceCameraFixed,
    end_frame_url: endFrameUrl ?? undefined, // Last frame (optional, Pro only)
    seed: imageSeed ?? undefined,
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
// WAN 2.5 Preview I2V
else if (modelId === "wan_25_preview_i2v") {
  if (!selectedImage) {
    console.log("  ⚠️ Skipping model - WAN 2.5 Preview requires a selected image");
    continue;
  }

  const imageUrl = await uploadImageToFal(selectedImage);
  const friendlyName = modelName || modelId;
  progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${friendlyName} request...`,
  });

  response = await generateWAN25ImageVideo({
    model: modelId,
    prompt: prompt.trim(),
    image_url: imageUrl,
    duration: wan25Duration, // Add new state variable
    resolution: wan25Resolution, // Add new state variable
    audio_url: audioUrl ?? undefined, // Optional music track
    negative_prompt: wan25NegativePrompt, // Add new state variable
    enable_prompt_expansion: wan25EnablePromptExpansion, // Add new state variable
    seed: imageSeed ?? undefined,
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
seedanceEndFrameFile,
imageSeed,

// Kling defaults
klingDuration = 5,
klingCfgScale = 0.5,
klingAspectRatio = "16:9",
klingEnhancePrompt = true,
klingNegativePrompt = "blur, distort, and low quality",

// WAN 2.5 defaults
wan25Duration = 5,
wan25Resolution = "1080p",
wan25AudioUrl, // Optional
wan25AudioFile, // Optional local upload
wan25NegativePrompt, // Optional
wan25EnablePromptExpansion = true,
```

### Step 3: Add API Client Function

Align the client interfaces with the FAL docs:

- Stick to the official parameter names (`end_frame_url` for Seedance Pro, `audio_url` for WAN 2.5) and pass through `seed` when provided.
- If you need to upload audio blobs, add a small `uploadAudioToFal` helper next to `uploadImageToFal` so UI code can turn `File` objects into URLs before invoking these functions.

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
- **`generateWAN25ImageVideo()`** - WAN 2.5 I2V-specific (new)

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

/**
 * WAN 2.5 Preview Image-to-Video Request Interface
 */
export interface WAN25I2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 5 | 10;
  resolution?: "480p" | "720p" | "1080p";
  audio_url?: string; // Optional background music
  negative_prompt?: string; // Max 500 characters
  enable_prompt_expansion?: boolean;
  seed?: number;
  enable_safety_checker?: boolean;
}

/**
 * Generate video from image using WAN 2.5 Preview.
 *
 * @param request - Prompt, model ID, image URL, and optional parameters
 */
export async function generateWAN25ImageVideo(
  request: WAN25I2VRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt?.trim() ?? "";
    if (!trimmedPrompt) {
      throw new Error("Please enter a prompt describing the desired motion");
    }

    if (trimmedPrompt.length > 800) {
      throw new Error("Prompt exceeds maximum length of 800 characters");
    }

    if (!request.image_url) {
      throw new Error("Image URL is required for WAN 2.5 image-to-video generation");
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

    const payload: Record<string, unknown> = {
      prompt: trimmedPrompt,
      image_url: request.image_url,
      duration,
      resolution,
      enable_prompt_expansion: request.enable_prompt_expansion ?? true,
      enable_safety_checker: request.enable_safety_checker ?? true,
    };

    // Add optional parameters
    if (request.audio_url) {
      payload.audio_url = request.audio_url;
    }

    if (request.negative_prompt) {
      if (request.negative_prompt.length > 500) {
        throw new Error("Negative prompt exceeds maximum length of 500 characters");
      }
      payload.negative_prompt = request.negative_prompt;
    }

    if (request.seed !== undefined) {
      payload.seed = request.seed;
    }

    const jobId = `wan25-${Date.now()}-${Math.random().toString(36).substring(7)}`;

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
    handleAIServiceError(error, "Generate WAN 2.5 Preview video", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateWAN25ImageVideo",
    });
    throw error;
  }
}
```

**Import Addition**: In `use-ai-generation.ts`, find the imports section at the top of the file and add:
```typescript
import {
  generateSeedanceVideo,
  generateKlingImageVideo,
  generateWAN25ImageVideo
} from "@/lib/ai-video-client";
```

**Note**: The imports should be added alongside existing imports like `generateLTXV2ImageVideo`, `generateViduQ2Video`, etc. from the same module.

### Step 4: Update Type Definitions

Keep the hook props and destructuring in sync:

- Use a single naming convention (`seedanceEndFrameUrl`) and pair it with a `seedanceEndFrameFile` so you can distinguish between an existing URL and a freshly uploaded file.
- Add shared props for the manual seed (`imageSeed?`) and WAN audio upload (`wan25AudioFile?`) so the UI controls have somewhere to store their state.

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
seedanceEndFrameUrl?: string; // Existing hosted URL
seedanceEndFrameFile?: File | null; // Newly uploaded file
imageSeed?: number; // Shared manual seed for reproducibility

// Kling v2.5 Turbo Pro I2V options
klingDuration?: 5 | 10;
klingCfgScale?: number; // 0-1 range
klingAspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
klingEnhancePrompt?: boolean;
klingNegativePrompt?: string;

// WAN 2.5 Preview I2V options
wan25Duration?: 5 | 10;
wan25Resolution?: "480p" | "720p" | "1080p";
wan25AudioUrl?: string; // Optional background music
wan25AudioFile?: File | null; // Local upload before sending
wan25NegativePrompt?: string; // Max 500 characters
wan25EnablePromptExpansion?: boolean;
```

### Step 5: Add UI Controls for User Selection

Back the controls with the new metadata/state:

- Drive resolution/duration/aspect-ratio pickers from `model.supportedResolutions`, `model.supportedDurations`, and `model.supportedAspectRatios` so every option Step 7 lists is selectable without hard-coded arrays.
- When the user selects a Seedance end frame or WAN audio track, store the `File` in `seedanceEndFrameFile` / `wan25AudioFile`, upload it via the helper, and update the corresponding URL prop so the handler/API receive a real `*_url`.
- Wire the “Seed” input to `imageSeed` and pass it through to every model handler that supports deterministic runs.

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` (or relevant UI component)

**Purpose**: Allow users to configure model-specific parameters through the UI before generating videos.

**Why Important**: Each model has different capabilities (resolutions, durations, aspect ratios). Users need UI controls to select these options rather than being limited to default values.

#### UI Controls to Implement

The following controls should be added to the image-to-video tab UI, with visibility controlled by the selected model:

##### 1. **Resolution Selector**
- **Type**: Dropdown/Select component
- **Options**: Model-dependent
  - Seedance: 480p, 720p, 1080p
  - Kling: 1080p only
  - WAN 2.5: 480p, 720p, 1080p
- **Default**: 1080p
- **Implementation**: Read from `model.supportedResolutions` array

##### 2. **Duration Selector**
- **Type**: Slider or Dropdown
- **Options**: Model-dependent
  - Seedance: 2-12 seconds (1s increments)
  - Kling: 5s, 10s
  - WAN 2.5: 5s, 10s
- **Default**: 5 seconds
- **Implementation**: Read from `model.supportedDurations` array
- **Display**: Show estimated cost based on selected duration

##### 3. **Aspect Ratio Selector**
- **Type**: Grid of ratio buttons or Dropdown
- **Options**: Model-dependent
  - Seedance: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16, auto
  - Kling: 16:9, 9:16, 1:1, 4:3, 3:4
  - WAN 2.5: Not supported (uses image aspect ratio)
- **Default**: 16:9
- **Visibility**: Show only for models that support aspect ratio selection

##### 4. **Camera Fixed Toggle** (Seedance Only)
- **Type**: Checkbox or Toggle Switch
- **Label**: "Lock Camera Position"
- **Description**: "Prevents camera movement for stable shots"
- **Default**: Off
- **Visibility**: Show only when Seedance model selected

##### 5. **CFG Scale Slider** (Kling Only)
- **Type**: Slider (0-1 range, step 0.1)
- **Label**: "Prompt Adherence"
- **Description**: "Controls how closely the video follows your prompt"
- **Default**: 0.5
- **Visibility**: Show only when Kling model selected

##### 6. **Prompt Expansion Toggle** (Kling, WAN 2.5)
- **Type**: Checkbox or Toggle Switch
- **Label**: "Enhance Prompt with AI"
- **Description**: "Uses LLM to improve prompt quality"
- **Default**: On
- **Visibility**: Show for Kling and WAN 2.5 models

##### 7. **Negative Prompt Input** (Kling, WAN 2.5)
- **Type**: Text input or Textarea
- **Label**: "Negative Prompt (Optional)"
- **Placeholder**: "blur, distort, low quality"
- **Max Length**:
  - Kling: No specific limit
  - WAN 2.5: 500 characters
- **Visibility**: Show for Kling and WAN 2.5 models

##### 8. **Audio Upload** (WAN 2.5 Only)
- **Type**: File upload component
- **Label**: "Background Music (Optional)"
- **Accepted Formats**: WAV, MP3
- **Duration Limit**: 3-30 seconds
- **File Size Limit**: 15MB
- **Visibility**: Show only when WAN 2.5 model selected

##### 9. **End Frame Upload** (Seedance Pro Only)
- **Type**: Image upload component
- **Label**: "End Frame (Optional)"
- **Description**: "Target final frame for controlled video conclusion"
- **Visibility**: Show only when `seedance_pro_i2v` model selected

##### 10. **Seed Input** (All Models)
- **Type**: Number input
- **Label**: "Seed (Optional)"
- **Description**: "Use same seed for reproducible results"
- **Visibility**: Show as advanced option (collapsible section)

#### Implementation Pattern

```typescript
// Example: Dynamic UI based on selected model
const selectedModel = AI_MODELS.find(m => m.id === selectedModelId);

return (
  <div className="model-controls">
    {/* Resolution Selector - Show if model supports multiple resolutions */}
    {selectedModel?.supportedResolutions && selectedModel.supportedResolutions.length > 1 && (
      <ResolutionSelector
        options={selectedModel.supportedResolutions}
        value={currentResolution}
        onChange={setResolution}
      />
    )}

    {/* Duration Selector - Always show */}
    {selectedModel?.supportedDurations && (
      <DurationSelector
        options={selectedModel.supportedDurations}
        value={currentDuration}
        onChange={setDuration}
        pricePerSecond={calculatePricePerSecond(selectedModel)}
      />
    )}

    {/* Aspect Ratio - Show only if supported */}
    {selectedModel?.default_params?.aspect_ratio && (
      <AspectRatioSelector
        value={currentAspectRatio}
        onChange={setAspectRatio}
      />
    )}

    {/* Model-specific controls */}
    {selectedModelId === "seedance_pro_fast_i2v" || selectedModelId === "seedance_pro_i2v" ? (
      <>
        <CameraFixedToggle value={cameraFixed} onChange={setCameraFixed} />
        {selectedModelId === "seedance_pro_i2v" && (
          <EndFrameUpload value={endFrame} onChange={setEndFrame} />
        )}
      </>
    ) : null}

    {selectedModelId === "kling_v2_5_turbo_i2v" ? (
      <>
        <CFGScaleSlider value={cfgScale} onChange={setCfgScale} />
        <PromptExpansionToggle value={enhancePrompt} onChange={setEnhancePrompt} />
        <NegativePromptInput value={negativePrompt} onChange={setNegativePrompt} />
      </>
    ) : null}

    {selectedModelId === "wan_25_preview_i2v" ? (
      <>
        <PromptExpansionToggle value={enablePromptExpansion} onChange={setEnablePromptExpansion} />
        <NegativePromptInput
          value={negativePrompt}
          onChange={setNegativePrompt}
          maxLength={500}
        />
        <AudioUpload
          value={audioFile}
          onChange={setAudioFile}
          acceptedFormats={["audio/wav", "audio/mp3"]}
          maxSize={15 * 1024 * 1024} // 15MB
        />
      </>
    ) : null}
  </div>
);
```

#### Cost Display

Add a cost estimator that updates in real-time based on user selections:

```typescript
function calculateEstimatedCost(model: AIModel, resolution: string, duration: number): string {
  if (model?.perSecondPricing) {
    const rate = model.perSecondPricing[resolution];
    if (rate != null) {
      return `$${(rate * duration).toFixed(2)}`;
    }
  }

  const basePrice = Number(model?.price ?? 0);
  const baseDuration = model?.default_params?.duration ?? 5;
  if (basePrice && baseDuration) {
    const scaled = (basePrice / baseDuration) * duration;
    return `$${scaled.toFixed(2)}`;
  }

  return "$0.00";
}

// In UI component
<CostEstimate>
  Estimated cost: {calculateEstimatedCost(selectedModel, resolution, duration)}
</CostEstimate>
```

#### User Experience Considerations

1. **Smart Defaults**: Pre-fill with model's `default_params` from `ai-constants.ts`
2. **Validation Feedback**: Show errors for invalid combinations (e.g., 20s duration on Kling)
3. **Help Text**: Include tooltips explaining what each parameter does
4. **Responsive Design**: Controls should work on mobile and desktop
5. **Cost Transparency**: Always show estimated cost before generation
6. **Save Preferences**: Remember user's last selections per model (localStorage)

#### Accessibility

- All controls should be keyboard navigable
- Use proper ARIA labels
- Provide screen reader descriptions for sliders and toggles
- Ensure sufficient color contrast for all UI elements

### Step 6: API Request/Response Format

Use the same parameter names across the narrative, code, and samples—`end_frame_url` for Seedance Pro and `audio_url` for WAN 2.5—so engineers don’t have to guess which field the API expects.

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

Before running through the checklist, verify the prerequisites:

- The cost estimator reads from `perSecondPricing` (WAN) or computes `(duration / defaultDuration) * price` for Seedance/Kling so the dollar amounts listed below are meaningful.
- Seedance Pro’s end-frame control performs an upload and sends `end_frame_url`, and WAN audio uploads produce a valid `audio_url`.
- The manual seed control populates `imageSeed` and propagates all the way to the model requests.

**Seedance Pro Fast I2V:**
- [ ] Model appears in image-to-video tab UI model selector dropdown
- [ ] Image upload works correctly
- [ ] Prompt input is functional
- [ ] **UI Control: Resolution selector** appears and allows user to choose 480p/720p/1080p
- [ ] **UI Control: Duration slider/selector** allows user to choose 2-12 seconds
- [ ] **UI Control: Aspect ratio selector** displays all 7 options + auto for user selection
- [ ] **UI Control: Camera fixed toggle** visible and functional (locks camera when enabled)
- [ ] **UI Control: Seed input** (advanced options) allows manual seed entry
- [ ] Real-time cost estimator updates based on user's duration selection
- [ ] Progress indicator shows during generation
- [ ] Generated video matches user-selected resolution and duration
- [ ] Generated video downloads correctly
- [ ] Video can be added to timeline
- [ ] Error handling works (invalid image, API errors)
- [ ] Cost calculation is accurate (~$0.24 per 1080p 5s video)
- [ ] Safety checker filters inappropriate content

**Seedance Pro I2V:**
- [ ] Model appears in image-to-video tab UI
- [ ] All Pro Fast UI controls work
- [ ] **UI Control: End frame upload** appears only for Pro model (optional image upload)
- [ ] Cost calculation is accurate (~$0.62 per 1080p 5s video)
- [ ] Generated video interpolates between start image and end frame when both provided

**Kling v2.5 Turbo Pro I2V:**
- [ ] Model appears in image-to-video tab UI
- [ ] Image upload works correctly
- [ ] Prompt input is functional (max 2,500 characters)
- [ ] **UI Control: Duration selector** allows user to choose 5s or 10s
- [ ] **UI Control: CFG scale slider** (0-1) for prompt adherence control
- [ ] **UI Control: Aspect ratio selector** displays 5 ratio options for user selection
- [ ] **UI Control: Prompt expansion toggle** enabled by default
- [ ] **UI Control: Negative prompt text input** for quality directives
- [ ] Cost updates correctly ($0.35 for 5s, $0.70 for 10s)
- [ ] Generated video matches user-selected parameters
- [ ] CFG scale affects how closely video follows prompt

**WAN 2.5 Preview I2V:**
- [ ] Model appears in image-to-video tab UI
- [ ] Image upload works correctly
- [ ] Prompt input is functional (max 800 characters)
- [ ] **UI Control: Resolution selector** allows user to choose 480p/720p/1080p
- [ ] **UI Control: Duration selector** allows user to choose 5s or 10s
- [ ] **UI Control: Audio file upload** (optional) accepts WAV/MP3 files (3-30s, max 15MB)
- [ ] **UI Control: Negative prompt input** (max 500 chars) for content to avoid
- [ ] **UI Control: Prompt expansion toggle** enabled by default
- [ ] **Dynamic cost display** updates based on resolution + duration selection:
  - [ ] 480p: $0.05/s
  - [ ] 720p: $0.10/s
  - [ ] 1080p: $0.15/s
- [ ] Audio synchronizes with generated video when provided
- [ ] Generated video matches user-selected resolution and duration

## Files to Modify Summary

### 1. `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
   - **Location**: `AI_MODELS` array, after `ltxv2_fast_i2v`
   - **Changes**: Add four model entries with `category: "image"`
   - **Models**:
     - `seedance_pro_fast_i2v` - Seedance Pro Fast
     - `seedance_pro_i2v` - Seedance Pro
     - `kling_v2_5_turbo_i2v` - Kling v2.5 Turbo Pro I2V
     - `wan_25_preview_i2v` - WAN 2.5 Preview I2V

### 2. `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
   - **Import section**: Add `generateSeedanceVideo`, `generateKlingImageVideo`, and `generateWAN25ImageVideo` imports
   - **Props interface**: Add Seedance, Kling, and WAN 2.5 specific props
   - **Destructure section**: Add default values for all new props
   - **handleGenerate function**: Add handlers for all four models in image tab section

### 3. `qcut/apps/web/src/lib/ai-video-client.ts`
   - **Interfaces section**:
     - Add `SeedanceI2VRequest` interface
     - Add `KlingI2VRequest` interface
     - Add `WAN25I2VRequest` interface
   - **Functions section**:
     - Add `generateSeedanceVideo` function
     - Add `generateKlingImageVideo` function
     - Add `generateWAN25ImageVideo` function
   - **Exports**: Ensure all three functions are exported

### 4. `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`
   - **UseAIGenerationProps interface**: Add prop types for Seedance, Kling, and WAN 2.5 models

### 5. `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` (UI Component)
   - **Add UI Controls**: Implement user-selectable controls for:
     - Resolution selector (dropdown)
     - Duration selector (slider/dropdown)
     - Aspect ratio selector (button grid)
     - Model-specific controls (toggles, sliders, file uploads)
   - **Dynamic visibility**: Show/hide controls based on selected model
   - **Cost estimator**: Real-time price calculation based on user selections
   - **Validation**: Ensure user selections are within model limits

### 6. `qcut/apps/web/src/test/integration/new-video-models.test.ts` (Optional)
   - Add test cases for all four models

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
- [FAL.ai WAN 2.5 Preview Image-to-Video API](https://fal.ai/models/fal-ai/wan-25-preview/image-to-video/api)

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

### WAN 2.5 Preview I2V
- [ ] Model definition added to `ai-constants.ts`
- [ ] Handler added to `use-ai-generation.ts`
- [ ] API client function implemented
- [ ] Type definitions added
- [ ] Integration testing completed

### Overall
- [ ] All four models appear in image-to-video tab UI
- [ ] Documentation updated with any deviations from plan
- [ ] Consider refactoring props pattern (see Future Refactoring Opportunity below)

## Future Refactoring Opportunity

When this implementation is complete, consider creating a GitHub issue for refactoring the props pattern to a more scalable approach. Suggested title: "Refactor model options to use generic modelOptions object instead of model-specific props"
