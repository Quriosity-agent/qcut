# Adding WAN 2.5 Image-to-Video Model to QCut

## Overview
This document describes how to add the WAN 2.5 Preview image-to-video model to QCut's AI video generation panel. The model is already partially configured but needs to be exposed in the image-to-video category UI.

## Model Information

### API Endpoint
- **Model ID**: `fal-ai/wan-25-preview/image-to-video`
- **Documentation**: https://fal.ai/models/fal-ai/wan-25-preview/image-to-video/api
- **Base URL**: `https://fal.run/fal-ai/wan-25-preview/image-to-video`

### Capabilities
- **Input**: Image URL + text prompt describing motion
- **Resolution Options**: 480p, 720p, 1080p (default: 1080p)
- **Duration Options**: 5s, 10s (default: 5s)
- **Audio Support**: Yes (WAV/MP3, 3-30s, max 15MB)
- **Prompt Expansion**: LLM-based prompt enhancement (enabled by default)
- **Safety Checker**: Content filtering (enabled by default)

### Pricing
- **480p**: $0.05/second
- **720p**: $0.10/second
- **1080p**: $0.15/second

### Image Requirements
- **Formats**: JPEG, JPG, PNG (no alpha channel), BMP, WEBP
- **Resolution Range**: 360-2000 pixels (width/height)
- **Max File Size**: 10MB

## Current Implementation Status

### ✅ Already Implemented
The WAN 2.5 model is already defined in the constants but only for **text-to-video**:

```typescript
// File: qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts
{
  id: "wan_25_preview",
  name: "WAN v2.5 Preview",
  description: "Next-generation WAN model with improved quality",
  price: "0.12",
  resolution: "1080p",
  max_duration: 10,
  endpoints: {
    text_to_video: "fal-ai/wan-25-preview/text-to-video",
    image_to_video: "fal-ai/wan-25-preview/image-to-video", // ✅ Endpoint defined
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
    quality: "high",
    style_preset: "cinematic",
  },
}
```

### ❌ Missing Implementation
- **No image-to-video category entry**: The model needs to be added as a separate entry with `category: "image"`
- **Missing in UI**: The image-to-video tab doesn't show WAN 2.5 as an option

## Implementation Plan

### Step 1: Add Image-to-Video Model Entry
Add a new model configuration to `ai-constants.ts` in the image category section:

```typescript
// File: qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts
// Add after the existing wan_25_preview (text-to-video) entry

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
   - Add new model entry with `category: "image"`

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
