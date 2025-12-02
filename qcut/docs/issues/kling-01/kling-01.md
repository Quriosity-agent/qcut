# Kling-01

Integration of Kling Video APIs from fal.ai into QCut.

## Overview

This document covers the integration of Kling Video endpoints from fal.ai, as implemented in QCut's AI Video Generation dialog.

### UI Structure

The AI Video Generation dialog (`ai.tsx`) contains four tabs:
- **Text** - Text-to-video generation
- **Image** - Image-to-video generation
- **Avatar** - Audio-driven avatar video generation
- **Upscale** - Video upscaling and enhancement

### Implemented Kling Models

From `ai-constants.ts`, the following Kling models are configured:

**Text Tab:**
- `kling_v2_5_turbo` - Kling v2.5 Turbo Pro (text-to-video and image-to-video)
- `kling_v2` - Kling v2.1 Master

**Image Tab:**
- `kling_v2_5_turbo_i2v` - Kling v2.5 Turbo Pro I2V

**Avatar Tab:**
- `kling_avatar_pro` - Kling Avatar Pro
- `kling_avatar_standard` - Kling Avatar Standard

---

## Text-to-Video Models

### Kling v2.5 Turbo Pro

```typescript
// From ai-constants.ts
{
  id: "kling_v2_5_turbo",
  name: "Kling v2.5 Turbo Pro",
  description: "Latest Kling model with enhanced turbo performance",
  price: "0.18",
  resolution: "1080p",
  max_duration: 10,
  category: "text",
  endpoints: {
    text_to_video: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    image_to_video: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
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

### Kling v2.1 Master

```typescript
{
  id: "kling_v2",
  name: "Kling v2.1",
  description: "Premium model with unparalleled motion fluidity",
  price: "0.15",
  resolution: "1080p",
  max_duration: 10,
  endpoints: {
    text_to_video: "fal-ai/kling-video/v2.1/master",
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
  },
}
```

---

## Image-to-Video Models

### Kling v2.5 Turbo Pro I2V

```typescript
// From ai-constants.ts
{
  id: "kling_v2_5_turbo_i2v",
  name: "Kling v2.5 Turbo Pro I2V",
  description: "Top-tier Kling model with cinematic motion and multi-ratio output",
  price: "0.35",
  resolution: "1080p",
  max_duration: 10,
  category: "image",
  endpoints: {
    image_to_video: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
    aspect_ratio: "16:9",
    cfg_scale: 0.5,
    enhance_prompt: true,
    negative_prompt: "blur, distort, low quality",
  },
  supportedResolutions: ["1080p"],
  supportedDurations: [5, 10],
  supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
}
```

---

## Avatar Models

### Kling Avatar Pro

```typescript
// From ai-constants.ts
{
  id: "kling_avatar_pro",
  name: "Kling Avatar Pro",
  description: "Premium avatar video generation from image + audio",
  price: "0.25",
  resolution: "1080p",
  max_duration: 10,
  category: "avatar",
  requiredInputs: ["characterImage", "audioFile"],
  endpoints: {
    text_to_video: "fal-ai/kling-video/v1/pro/ai-avatar",
  },
  default_params: {
    resolution: "1080p",
  },
}
```

### Kling Avatar Standard

```typescript
{
  id: "kling_avatar_standard",
  name: "Kling Avatar Standard",
  description: "Standard avatar video generation from image + audio",
  price: "0.15",
  resolution: "720p",
  max_duration: 10,
  category: "avatar",
  requiredInputs: ["characterImage", "audioFile"],
  endpoints: {
    text_to_video: "fal-ai/kling-video/v1/standard/ai-avatar",
  },
  default_params: {
    resolution: "720p",
  },
}
```

---

## Avatar Tab UI Components

From `ai.tsx` (lines 2525-2604), the Avatar tab includes:

### Character Image Upload (Required)
```typescript
<FileUpload
  id="avatar-image-input"
  label="Character Image"
  helperText="Required"
  fileType="image"
  acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_AVATAR_IMAGE_TYPES}
  maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
  // ...
/>
```

### Audio File Upload (For Kling Avatar models)
```typescript
<FileUpload
  id="avatar-audio-input"
  label="Audio File"
  helperText="For Kling Avatar models"
  fileType="audio"
  acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_AUDIO_TYPES}
  maxSizeBytes={UPLOAD_CONSTANTS.MAX_AUDIO_SIZE_BYTES}
  // ...
/>
```

### Source Video Upload (For WAN Animate/Replace)
```typescript
<FileUpload
  id="avatar-video-input"
  label="Source Video"
  helperText="For WAN Animate/Replace"
  fileType="video"
  acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_VIDEO_TYPES}
  maxSizeBytes={UPLOAD_CONSTANTS.MAX_VIDEO_SIZE_BYTES}
  // ...
/>
```

### Additional Prompt (Optional)
```typescript
<Textarea
  id="avatar-prompt"
  placeholder="Describe the desired avatar style or motion..."
  // ...
/>
```

---

## Upload Constants

From `ai-constants.ts`:

```typescript
export const UPLOAD_CONSTANTS = {
  // Avatar-specific image uploads (character images only, no GIF)
  ALLOWED_AVATAR_IMAGE_TYPES: ["image/jpeg", "image/png", "image/webp"],
  AVATAR_IMAGE_FORMATS_LABEL: "JPG, PNG, WebP",

  // Image uploads
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  MAX_IMAGE_SIZE_LABEL: "10MB",

  // Audio uploads (for Kling and ByteDance avatar models)
  ALLOWED_AUDIO_TYPES: ["audio/mpeg", "audio/wav", "audio/aac"],
  MAX_AUDIO_SIZE_BYTES: 50 * 1024 * 1024, // 50MB
  MAX_AUDIO_SIZE_LABEL: "50MB",
  SUPPORTED_AUDIO_FORMATS: [".mp3", ".wav", ".aac"],
  AUDIO_FORMATS_LABEL: "MP3, WAV, AAC",

  // Video uploads (WAN + Upscale)
  ALLOWED_VIDEO_TYPES: ["video/mp4", "video/quicktime", "video/x-msvideo"],
  MAX_VIDEO_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
  MAX_VIDEO_SIZE_LABEL: "100MB",
  SUPPORTED_VIDEO_FORMATS: [".mp4", ".mov", ".avi"],
  VIDEO_FORMATS_LABEL: "MP4, MOV, AVI",
} as const;
```

---

## Avatar Video Generation API

From `ai-video-client.ts`:

### AvatarVideoRequest Interface

```typescript
export interface AvatarVideoRequest {
  model: string;
  characterImage: File;
  audioFile?: File; // For Kling models
  sourceVideo?: File; // For WAN animate/replace
  prompt?: string;
  resolution?: string;
}
```

### generateAvatarVideo Function

The `generateAvatarVideo` function in `ai-video-client.ts` handles avatar video generation:

1. Validates FAL API key is configured
2. Gets model configuration from `AI_MODELS` registry
3. Verifies model category is "avatar"
4. Converts character image to base64 data URL
5. For Kling Avatar models (`kling_avatar_pro`, `kling_avatar_standard`):
   - Requires `audioFile`
   - Converts audio to data URL
   - Builds payload with `image_url` and `audio_url`
6. Submits request to FAL API endpoint
7. Returns `VideoGenerationResponse` with job_id, status, and video URL

### Kling Avatar Payload Structure

```typescript
// For kling_avatar_pro or kling_avatar_standard
{
  image_url: characterImageUrl,  // base64 data URL
  audio_url: audioUrl,           // base64 data URL
  resolution: request.resolution // optional override
}
```

---

## FAL API Configuration

From `ai-constants.ts`:

```typescript
export const FAL_API_KEY = import.meta.env.VITE_FAL_API_KEY;
export const FAL_API_BASE = "https://fal.run";

export const API_CONFIG: APIConfiguration = {
  falApiKey: FAL_API_KEY,
  falApiBase: FAL_API_BASE,
  maxRetries: 3,
  timeoutMs: 30_000, // 30 seconds
};
```

---

## Other Avatar Models in QCut

The Avatar tab also supports non-Kling models:

### WAN Animate/Replace
```typescript
{
  id: "wan_animate_replace",
  name: "WAN Animate/Replace",
  description: "Replace characters in existing videos",
  price: "0.075",
  resolution: "480p-720p",
  max_duration: 30,
  category: "avatar",
  requiredInputs: ["characterImage", "sourceVideo"],
  endpoints: {
    text_to_video: "fal-ai/wan/v2.2-14b/animate/replace",
  },
}
```

### ByteDance OmniHuman v1.5
```typescript
{
  id: "bytedance_omnihuman_v1_5",
  name: "ByteDance OmniHuman v1.5",
  description: "Realistic human avatar with emotion-synced audio",
  price: "0.20",
  resolution: "1080p",
  max_duration: 30,
  category: "avatar",
  requiredInputs: ["characterImage", "audioFile"],
  endpoints: {
    text_to_video: "fal-ai/bytedance/omnihuman/v1.5",
  },
}
```

---

## Implementation Status

### Completed
- [x] FAL API client integration (`ai-video-client.ts`)
- [x] Model configuration in `AI_MODELS` registry (`ai-constants.ts`)
- [x] Avatar tab UI with file uploads (`ai.tsx`)
- [x] Upload constants for image/audio/video (`ai-constants.ts`)
- [x] `generateAvatarVideo` function for API calls
- [x] Support for Kling Avatar Standard and Pro
- [x] Support for WAN Animate/Replace
- [x] Support for ByteDance OmniHuman

### File References
- UI Component: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
- Constants: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
- API Client: `qcut/apps/web/src/lib/ai-video-client.ts`
- Types: `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`

---

## Future Work: Kling O1 APIs (Not Yet Implemented)

The following Kling O1 endpoints from fal.ai are available but not yet integrated into QCut. Each subtask is estimated at under 20 minutes.

### Subtask 1: Add Kling O1 Video-to-Video Reference Model Config
- **Endpoint**: `fal-ai/kling-video/o1/video-to-video/reference`
- **Description**: Generate new shots guided by input reference video
- **Tasks**:
  - [ ] Add model entry to `AI_MODELS` array in `ai-constants.ts`
  - [ ] Set category to appropriate tab (likely "image" or new "video" tab)
  - [ ] Define `requiredInputs: ["sourceVideo"]`

### Subtask 2: Add Kling O1 Video-to-Video Edit Model Config
- **Endpoint**: `fal-ai/kling-video/o1/video-to-video/edit`
- **Description**: Edit videos through natural language instructions
- **Pricing**: $0.168 per second
- **Tasks**:
  - [ ] Add model entry to `AI_MODELS` array
  - [ ] Define parameters: `prompt`, `video_url`, `image_urls`, `elements`

### Subtask 3: Add Kling O1 Reference-to-Video Model Config
- **Endpoint**: `fal-ai/kling-video/o1/reference-to-video`
- **Description**: Transform images and elements into video scenes
- **Pricing**: $0.112 per second
- **Tasks**:
  - [ ] Add model entry to `AI_MODELS` array
  - [ ] Define parameters: `prompt`, `image_urls`, `duration`, `aspect_ratio`

### Subtask 4: Add Kling O1 Image-to-Video Model Config
- **Endpoint**: `fal-ai/kling-video/o1/image-to-video`
- **Description**: Animate transitions between start and end frames
- **Tasks**:
  - [ ] Add model entry to `AI_MODELS` array
  - [ ] Define `requiredInputs: ["firstFrame"]` with optional `lastFrame`
  - [ ] Reuse existing F2V (frame-to-video) UI pattern from Veo 3.1

### Subtask 5: Implement O1 API Client Functions
- **File**: `ai-video-client.ts`
- **Tasks**:
  - [ ] Add `generateKlingO1Video()` function
  - [ ] Handle video-to-video payload construction
  - [ ] Handle reference-to-video payload with `image_urls` and `elements`
  - [ ] Support `@Image1`, `@Element1` prompt references

### Subtask 6: Update UI for O1 Video Inputs
- **File**: `ai.tsx`
- **Tasks**:
  - [ ] Add source video upload for video-to-video models
  - [ ] Add reference image multi-upload for reference-to-video
  - [ ] Add element configuration UI (frontal + reference images)

---

## Kling O1 API Reference (For Future Implementation)

### Video-to-Video Reference
```typescript
// Proposed model config
{
  id: "kling_o1_v2v_reference",
  name: "Kling O1 Video Reference",
  description: "Generate new shots guided by input reference video",
  category: "image", // or new "video" category
  requiredInputs: ["sourceVideo"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o1/video-to-video/reference",
  },
  default_params: {
    duration: 5,
    aspect_ratio: "auto",
  },
}
```

### Video-to-Video Edit
```typescript
{
  id: "kling_o1_v2v_edit",
  name: "Kling O1 Video Edit",
  description: "Edit videos through natural language instructions",
  price: "0.168/s",
  category: "image",
  requiredInputs: ["sourceVideo"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o1/video-to-video/edit",
  },
}
```

### Reference-to-Video
```typescript
{
  id: "kling_o1_ref2video",
  name: "Kling O1 Reference-to-Video",
  description: "Transform images and elements into video scenes",
  price: "0.112/s",
  category: "image",
  requiredInputs: ["referenceImages"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o1/reference-to-video",
  },
  default_params: {
    duration: 5,
    aspect_ratio: "16:9",
    cfg_scale: 0.5,
    negative_prompt: "blur, distort, and low quality",
  },
}
```

### Image-to-Video (First/Last Frame)
```typescript
{
  id: "kling_o1_i2v",
  name: "Kling O1 Image-to-Video",
  description: "Animate transitions between start and end frames",
  category: "image",
  requiredInputs: ["firstFrame"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o1/image-to-video",
  },
  default_params: {
    duration: 5,
  },
  supportedDurations: [5, 10],
}
