# Kling-01

Integration of Kling Video APIs from fal.ai into QCut.

## Overview

This document covers the integration of Kling Video endpoints from fal.ai, as implemented in QCut's AI Video Generation dialog.

### UI Structure

The AI Video Generation dialog (`ai.tsx`) contains four tabs:
- **Text** - Text-to-video generation
- **Image** - Image-to-video generation (includes V2V models)
- **Avatar** - Audio-driven avatar video generation
- **Upscale** - Video upscaling and enhancement

### Implemented Kling Models

From `ai-constants.ts`, the following Kling models are configured:

**Text Tab:**
- `kling_v2_5_turbo` - Kling v2.5 Turbo Pro (text-to-video and image-to-video)
- `kling_v2` - Kling v2.1 Master

**Image Tab:**
- `kling_v2_5_turbo_i2v` - Kling v2.5 Turbo Pro I2V
- `kling_o1_v2v_reference` - Kling O1 Video Reference (V2V)
- `kling_o1_v2v_edit` - Kling O1 Video Edit (V2V)
- `kling_o1_i2v` - Kling O1 Image-to-Video

**Avatar Tab:**
- `kling_avatar_pro` - Kling Avatar Pro
- `kling_avatar_standard` - Kling Avatar Standard
- `kling_o1_ref2video` - Kling O1 Reference-to-Video (uses reference images)

---

## Kling O1 Models

### Video-to-Video Reference
```typescript
// From ai-constants.ts
{
  id: "kling_o1_v2v_reference",
  name: "Kling O1 Video Reference",
  description: "Generate new shots guided by input reference video, preserving motion and camera style",
  price: "0.112",
  resolution: "1080p",
  max_duration: 10,
  category: "image",
  requiredInputs: ["sourceVideo"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o1/video-to-video/reference",
  },
  default_params: {
    duration: 5,
    aspect_ratio: "auto",
  },
  supportedDurations: [5, 10],
  supportedAspectRatios: ["auto", "16:9", "9:16", "1:1"],
}
```

### Video-to-Video Edit
```typescript
{
  id: "kling_o1_v2v_edit",
  name: "Kling O1 Video Edit",
  description: "Edit videos through natural language instructions while preserving motion structure",
  price: "0.168",
  resolution: "1080p",
  max_duration: 10,
  category: "image",
  requiredInputs: ["sourceVideo"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o1/video-to-video/edit",
  },
  default_params: {
    duration: 5,
  },
  supportedDurations: [5, 10],
}
```

### Reference-to-Video
```typescript
{
  id: "kling_o1_ref2video",
  name: "Kling O1 Reference-to-Video",
  description: "Transform reference images and elements into consistent video scenes",
  price: "0.112",
  resolution: "1080p",
  max_duration: 10,
  category: "avatar", // Avatar tab - uses reference images
  requiredInputs: ["referenceImages"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o1/reference-to-video",
  },
  default_params: {
    duration: 5,
    aspect_ratio: "16:9",
    cfg_scale: 0.5,
    negative_prompt: "blur, distort, low quality",
  },
  supportedDurations: [5, 10],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
}
```

### Image-to-Video (First/Last Frame)
```typescript
{
  id: "kling_o1_i2v",
  name: "Kling O1 Image-to-Video",
  description: "Animate transitions between start and end frames with cinematic motion",
  price: "0.112",
  resolution: "1080p",
  max_duration: 10,
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
```

---

## Kling O1 API Client Functions

### generateKlingO1Video
For video-to-video transformations (Reference and Edit models).

```typescript
export interface KlingO1V2VRequest {
  model: string;
  prompt: string;
  sourceVideo: File;
  duration?: 5 | 10;
  aspect_ratio?: "auto" | "16:9" | "9:16" | "1:1";
  keep_audio?: boolean;
}

export async function generateKlingO1Video(
  request: KlingO1V2VRequest
): Promise<VideoGenerationResponse>
```

**Flow:**
1. Validates FAL API key is configured
2. Validates prompt (max 2500 chars)
3. Converts source video to base64 data URL
4. Builds payload with `video_url`, `prompt`, `duration`, `aspect_ratio`
5. Sends request to FAL API with 3-minute timeout
6. Returns `VideoGenerationResponse` with job_id and video URL

### generateKlingO1RefVideo
For reference-to-video generation.

```typescript
export interface KlingO1Ref2VideoRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 5 | 10;
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  cfg_scale?: number;
  negative_prompt?: string;
}

export async function generateKlingO1RefVideo(
  request: KlingO1Ref2VideoRequest
): Promise<VideoGenerationResponse>
```

**Payload:**
```typescript
{
  prompt: trimmedPrompt,
  image_urls: [request.image_url], // API expects array
  duration,
  aspect_ratio,
  cfg_scale,
  negative_prompt,
}
```

---

## UI Components

### Video-to-Video Mode in Image Tab

The `AIImageUploadSection` component (`ai-image-upload.tsx`) now supports three modes:

1. **I2V Mode** - Single image upload for image-to-video models
2. **F2V Mode** - Dual frame upload for frame-to-video models
3. **V2V Mode** - Source video upload for video-to-video models

Mode detection uses `MODEL_HELPERS`:
```typescript
// Check if V2V mode
const requiresSourceVideo = selectedModels.some((id) =>
  MODEL_HELPERS.requiresSourceVideo(id)
);

// Check if F2V mode
const requiresFrameToFrame = selectedModels.some((id) =>
  MODEL_HELPERS.requiresFrameToFrame(id)
);
```

### V2V Upload UI
```typescript
<FileUpload
  id="ai-source-video-input"
  label="Upload Source Video"
  helperText="Required for video-to-video transformation"
  fileType="video"
  acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_VIDEO_TYPES}
  maxSizeBytes={UPLOAD_CONSTANTS.MAX_VIDEO_SIZE_BYTES}
  // ...
/>
```

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

## Avatar Models

### Kling Avatar Pro

```typescript
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
}
```

---

## Upload Constants

```typescript
export const UPLOAD_CONSTANTS = {
  // Image uploads
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  MAX_IMAGE_SIZE_LABEL: "10MB",

  // Audio uploads
  ALLOWED_AUDIO_TYPES: ["audio/mpeg", "audio/wav", "audio/aac"],
  MAX_AUDIO_SIZE_BYTES: 50 * 1024 * 1024, // 50MB
  AUDIO_FORMATS_LABEL: "MP3, WAV, AAC",

  // Video uploads
  ALLOWED_VIDEO_TYPES: ["video/mp4", "video/quicktime", "video/x-msvideo"],
  MAX_VIDEO_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
  VIDEO_FORMATS_LABEL: "MP4, MOV, AVI",
} as const;
```

---

## Bug Fix: kling_o1_ref2video Generation Failed (2025-12-03) ✅ RESOLVED

### 问题描述 (Issue Description)
用户在 Avatar 标签页选择 `kling_o1_ref2video` 模型后点击生成，返回 `undefined` 响应，生成失败。

### 错误日志分析 (Error Log Analysis)
```
step 5: sending generation request for kling_o1_ref2video (avatar tab)
step 5a: post-API response analysis
   - response received: false
   - response is undefined/null
⚠️ Response has neither job_id nor video_url: undefined
```

关键线索：
```
hasSelectedImage: false
imageFile: null
```

### 根本原因 (Root Cause) - 两个问题

**问题 1: `generateAvatarVideo` 函数缺少处理逻辑**
1. 模型 `kling_o1_ref2video` 在 `ai-constants.ts` 中配置为 `category: "avatar"`
2. 用户从 Avatar 标签页选择该模型时，调用 `generateAvatarVideo` 函数
3. 但该函数只处理以下模型：
   - `wan_animate_replace`
   - `kling_avatar_pro` / `kling_avatar_standard`
   - `bytedance_omnihuman_v1_5`
4. `kling_o1_ref2video` 没有对应处理逻辑，进入 `else` 分支抛出 `Error: Unsupported avatar model`

**问题 2: 验证逻辑跳过了图片检查** ⚠️
```typescript
// 原代码 (错误)
if (modelId === "kling_o1_ref2video") {
  // Reference images are optional enhancement, no validation needed
  continue;  // 这里跳过了验证！
}
```
验证代码错误地认为 "reference images are optional"，导致没有检查 `avatarImage`。

由于 `avatarImage` 为 `null`，API 调用条件 `activeTab === "avatar" && avatarImage` 为 `false`，导致 `generateAvatarVideo` 从未被调用，`response` 保持 `undefined`。

### 修复方案 (Fixes Applied) ✅

**修复 1: 添加 API 处理逻辑** (`ai-video-client.ts`)
```typescript
} else if (request.model === "kling_o1_ref2video") {
  // Kling O1 Reference-to-Video: transforms reference images into video scenes
  // Uses the image_to_video endpoint with image_urls array and prompt
  endpoint = modelConfig.endpoints.image_to_video || "";

  // Upload character image to get URL (FAL expects URLs for this endpoint)
  console.log("📤 Uploading reference image to FAL...");
  const imageUrl = await falAIClient.uploadImageToFal(request.characterImage);
  console.log("✅ Reference image uploaded:", imageUrl);

  // Build prompt with @Image1 reference syntax
  let enhancedPrompt = request.prompt || "";
  if (!enhancedPrompt.includes("@Image")) {
    enhancedPrompt = `Use @Image1 as the reference. ${enhancedPrompt}`.trim();
  }

  payload = {
    prompt: enhancedPrompt,
    image_urls: [imageUrl],
    duration: String(request.duration || modelConfig.default_params?.duration || 5),
    aspect_ratio: modelConfig.default_params?.aspect_ratio || "16:9",
    ...(modelConfig.default_params?.cfg_scale && { cfg_scale: modelConfig.default_params.cfg_scale }),
    ...(modelConfig.default_params?.negative_prompt && { negative_prompt: modelConfig.default_params.negative_prompt }),
  };
}
```

**修复 2: 添加验证逻辑** (`use-ai-generation.ts`)
```typescript
// 修复后的代码
// Reference-to-video model requires avatar/reference image
if (modelId === "kling_o1_ref2video" && !avatarImage) {
  validationError =
    "Kling O1 Reference-to-Video requires a reference image";
  break;
}
```

### 文件修改 (Files Modified)
- `qcut/apps/web/src/lib/ai-video-client.ts`
  - 添加 `import { falAIClient } from "./fal-ai-client";` (line 7)
  - 添加 `kling_o1_ref2video` 处理分支 (lines 2881-2909)
- `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
  - 修复验证逻辑，要求 `avatarImage` (lines 819-824)

### 技术细节 (Technical Details)
- FAL API `reference-to-video` 端点期望 `image_urls` 为 URL 数组，不是 base64
- 使用 `falAIClient.uploadImageToFal()` 上传图片获取 URL
- 需要使用 `@Image1` 语法在 prompt 中引用上传的图片
- 自动添加 `cfg_scale` 和 `negative_prompt` 从 default_params
- 用户必须先上传参考图片才能使用此模型

### 验证清单 (Verification Checklist)
- [x] Import `falAIClient` added to ai-video-client.ts
- [x] Handler for `kling_o1_ref2video` added in `generateAvatarVideo`
- [x] Model category correctly set to `"avatar"` in ai-constants.ts
- [x] Documentation updated to reflect correct model placement
- [x] **Validation logic fixed** to require `avatarImage` for `kling_o1_ref2video`

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
- [x] `kling_o1_v2v_reference` model config
- [x] `kling_o1_v2v_edit` model config
- [x] `kling_o1_ref2video` model config
- [x] `kling_o1_i2v` model config
- [x] `generateKlingO1Video()` function
- [x] `generateKlingO1RefVideo()` function
- [x] `MODEL_HELPERS.requiresSourceVideo()` helper
- [x] V2V mode in `AIImageUploadSection`
- [x] Source video state in Image tab
- [x] **BUG FIX (2025-12-03)**: `kling_o1_ref2video` handler in `generateAvatarVideo` function
- [x] **BUG FIX (2025-12-03)**: Validation logic to require `avatarImage` for `kling_o1_ref2video`

### File References
- UI Component: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
- Image Upload: `qcut/apps/web/src/components/editor/media-panel/views/ai-image-upload.tsx`
- Constants: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
- API Client: `qcut/apps/web/src/lib/ai-video-client.ts`
