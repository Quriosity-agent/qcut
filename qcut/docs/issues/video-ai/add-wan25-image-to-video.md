# Adding Seedance Image-to-Video Models to QCut

## Overview
This document describes how to add the ByteDance Seedance v1 Pro image-to-video models to QCut's AI video generation panel. These models animate static images based on text descriptions, generating high-quality videos with flexible resolution and duration options.

**Model Positioning**: The Seedance image-to-video models should be placed **after the LTX models** in the `ai-constants.ts` file (specifically after `ltxv2_fast_i2v`).

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

### Step 1: Add Image-to-Video Model Entry
Add a new model configuration to `ai-constants.ts` in the image category section **after the LTX models** (after `ltxv2_fast_i2v` which ends around line 252):

```typescript
// File: qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts
// Add after the LTX Video 2.0 Fast I2V model (ltxv2_fast_i2v)

{
  id: "wan_25_preview_i2v",
  name: "WAN v2.5 Image-to-Video",
  description: "Next-generation WAN model - animate images with improved quality",
  price: "0.05-0.15", // $0.05 (480p), $0.10 (720p), $0.15 (1080p) per second
  resolution: "480p / 720p / 1080p",
  supportedResolutions: ["480p", "720p", "1080p"],
  max_duration: 10,
  category: "image", // ⭐ Key: This makes it appear in image-to-video tab
  endpoints: {
    image_to_video: "fal-ai/wan-25-preview/image-to-video",
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
    enable_prompt_expansion: true,
    enable_safety_checker: true,
  },
}
```

### Step 2: Update API Client Handler
Ensure the image-to-video handler in `use-ai-generation.ts` supports the WAN 2.5 parameters:

```typescript
// File: qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts

if (modelId === "wan_25_preview_i2v") {
  const requestBody = {
    image_url: uploadedImageUrl,
    prompt: prompt.trim(),
    resolution: resolution || "1080p",
    duration: duration || 5,
    enable_prompt_expansion: true,
    enable_safety_checker: true,
    ...(audioFile && { audio_url: uploadedAudioUrl }),
  };

  const response = await fal.subscribe(
    "fal-ai/wan-25-preview/image-to-video",
    {
      input: requestBody,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          onProgress?.(50);
        }
      },
    }
  );
}
```

### Step 3: Add UI Controls
The model should automatically appear in the image-to-video model selector. Additional controls to consider:

1. **Resolution Selector** (480p / 720p / 1080p)
2. **Duration Selector** (5s / 10s)
3. **Audio Upload** (optional)
4. **Prompt Expansion Toggle** (default: on)
5. **Negative Prompt** (optional, max 500 chars)

### Step 4: API Request/Response Format

**Request:**
```json
{
  "image_url": "https://example.com/image.jpg",
  "prompt": "Camera circles the subject, highlighting presence",
  "resolution": "1080p",
  "duration": 5,
  "audio_url": "https://example.com/audio.mp3", // optional
  "negative_prompt": "blurry, distorted", // optional
  "enable_prompt_expansion": true,
  "seed": 12345 // optional for reproducibility
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
    "duration": 5.0,
    "fps": 24.0,
    "num_frames": 120
  },
  "seed": 12345,
  "actual_prompt": "Enhanced prompt if expansion was enabled"
}
```

### Step 5: Testing Checklist

- [ ] Model appears in image-to-video tab UI
- [ ] Image upload works correctly
- [ ] Prompt input is functional
- [ ] Resolution selector works (480p/720p/1080p)
- [ ] Duration selector works (5s/10s)
- [ ] Audio upload is optional and works
- [ ] Progress indicator shows during generation
- [ ] Generated video downloads correctly
- [ ] Video can be added to timeline
- [ ] Error handling works (invalid image, API errors)
- [ ] Cost calculation is accurate
- [ ] Safety checker filters inappropriate content

## Files to Modify

1. **`qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`**
   - Add new model entry with `category: "image"` after the LTX models (after line ~252)

2. **`qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`**
   - Add/update image-to-video generation handler for WAN 2.5

3. **`qcut/apps/web/src/lib/ai-video-client.ts`** (if needed)
   - Add type definitions for WAN 2.5 parameters

4. **`qcut/apps/web/src/test/integration/new-video-models.test.ts`**
   - Add test cases for WAN 2.5 image-to-video

## Example Usage

### JavaScript Client
```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe(
  "fal-ai/wan-25-preview/image-to-video",
  {
    input: {
      prompt: "The camera slowly zooms in on the subject",
      image_url: "https://example.com/photo.jpg",
      resolution: "1080p",
      duration: 5,
      enable_prompt_expansion: true
    },
    logs: true,
    onQueueUpdate: (update) => {
      console.log("Queue status:", update.status);
    }
  }
);

console.log("Video URL:", result.video.url);
```

### Expected Processing Time
- **5-second video**: 1-2 minutes
- **10-second video**: 2-3 minutes

## Notes

1. **Prompt Expansion**: The model uses LLM to enhance prompts. The `actual_prompt` in the response shows what was actually used.

2. **Audio Handling**: If audio is longer than video duration, it will be truncated. If shorter, silence is added.

3. **Safety Checker**: Enabled by default. Can be disabled but not recommended for production.

4. **Seed Support**: Use the same seed for reproducible results.

5. **Cost Calculation**:
   - 5s @ 1080p = $0.75
   - 10s @ 1080p = $1.50
   - 5s @ 720p = $0.50
   - 10s @ 480p = $0.50

## Related Documentation

- [FAL.ai WAN 2.5 Image-to-Video API](https://fal.ai/models/fal-ai/wan-25-preview/image-to-video/api)
- [QCut AI Constants](../../apps/web/src/components/editor/media-panel/views/ai-constants.ts)
- [QCut AI Video Client](../../apps/web/src/lib/ai-video-client.ts)

## Status

- **Created**: 2025-11-11
- **Status**: Pending Implementation
- **Priority**: Medium
- **Estimated Effort**: 2-3 hours
