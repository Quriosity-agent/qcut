# Kling-01

Integration of Kling Video APIs from fal.ai into QCut.

## Overview

This document covers the integration of Kling Video endpoints from fal.ai, organized by the UI tabs in QCut's AI Video Generation dialog.

### UI Structure

The AI Video Generation dialog contains four tabs:
- **Text** - Text-to-video generation
- **Image** - Image-to-video generation and video editing
- **Avatar** - Audio-driven avatar video generation (Kling Avatar)
- **Upscale** - Video upscaling and enhancement

### Supported Endpoints

**Image Tab:**
1. **Video-to-Video Reference** - Generate new shots guided by input reference video
2. **Video-to-Video Edit** - Edit videos through natural language instructions
3. **Reference-to-Video** - Transform images and elements into video scenes
4. **Image-to-Video** - Animate transitions between start and end frames

**Avatar Tab:**
5. **AI Avatar Standard** - Create avatar videos with audio synchronization
6. **AI Avatar Pro** - Premium avatar video generation with enhanced quality

---

## 1. Video-to-Video Reference API

### Overview
Generates new shots guided by an input reference video, preserving cinematic language such as motion and camera style to produce seamless scene continuity.

### Endpoint Details
- **Model ID**: `fal-ai/kling-video/o1/video-to-video/reference`
- **Base URL**: `https://fal.run/fal-ai/kling-video/o1/video-to-video/reference`
- **Type**: Inference API (non-blocking queue-based)
- **Commercial Use**: Supported

### Installation

```bash
npm install --save @fal-ai/client
```

### Authentication

Set the `FAL_KEY` environment variable:
```bash
export FAL_KEY="YOUR_API_KEY"
```

Or configure programmatically:
```javascript
import { fal } from "@fal-ai/client";

fal.config({
  credentials: "YOUR_FAL_KEY"
});
```

### Basic Usage

```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/kling-video/o1/video-to-video/reference", {
  input: {
    prompt: "Based on @Video1, generate the next shot. keep the style",
    video_url: "https://example.com/video.mp4"
  },
  logs: true
});
```

### Input Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Use @Element1, @Element2 for elements; @Image1, @Image2 for images |
| `video_url` | string | Yes | Video reference (MP4/MOV, 3-10s, 720-2160px, max 200MB) |
| `keep_audio` | boolean | No | Preserve original video audio |
| `image_urls` | array | No | Reference images (max 4 total with elements) |
| `elements` | array | No | Character/object definitions with reference images |
| `aspect_ratio` | enum | No | `auto`, `16:9`, `9:16`, `1:1` (default: auto) |
| `duration` | enum | No | `5` or `10` seconds (default: 5) |

### Output Schema

```javascript
{
  "video": {
    "file_size": 28472159,
    "file_name": "output.mp4",
    "content_type": "video/mp4",
    "url": "https://v3b.fal.media/files/..."
  }
}
```

### Queue Operations

#### Submit Request
```javascript
const { request_id } = await fal.queue.submit(
  "fal-ai/kling-video/o1/video-to-video/reference",
  { input: {...}, webhookUrl: "https://your.webhook/url" }
);
```

#### Check Status
```javascript
const status = await fal.queue.status(
  "fal-ai/kling-video/o1/video-to-video/reference",
  { requestId: "764cabcf-b745-4b3e-ae38-1200304cf45b", logs: true }
);
```

#### Get Results
```javascript
const result = await fal.queue.result(
  "fal-ai/kling-video/o1/video-to-video/reference",
  { requestId: "764cabcf-b745-4b3e-ae38-1200304cf45b" }
);
```

### File Handling

**Data URI (Base64)**:
```javascript
const dataUri = "data:video/mp4;base64,...";
```

**Upload Files**:
```javascript
const file = new File(["content"], "video.mp4", { type: "video/mp4" });
const url = await fal.storage.upload(file);
```

### OmniVideoElementInput Schema

```javascript
{
  "reference_image_urls": ["https://..."],
  "frontal_image_url": "https://..."
}
```

---

## 2. Video-to-Video Edit API

### Overview
Enables video editing through natural language instructions, allowing transformation of subjects, settings, and styles while preserving original motion structure.

### Endpoint Details
- **Path**: `/o1/video-to-video/edit`
- **Method**: POST
- **Base URL**: `https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/edit`
- **Pricing**: $0.168 per second of video generated

### Request Parameters

#### Required Fields
| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | string | Natural language instruction (max 2500 chars). Use `@` references for images, elements, or videos |
| `video_url` | string | URL of source video (formats: mp4, mov, webm, m4v, gif) |

#### Optional Fields
| Parameter | Type | Description |
|-----------|------|-------------|
| `image_urls` | array | Reference images, referenced as `@Image1`, `@Image2`, etc. |
| `elements` | array | Character/object definitions |

### Element Configuration

```javascript
{
  "frontal_image_url": "https://...",  // Required: front-facing image
  "reference_image_urls": ["https://..."]  // Optional: additional references
}
```

### Response Format

```json
{
  "video": {
    "file_size": 28472159,
    "file_name": "output.mp4",
    "content_type": "video/mp4",
    "url": "https://[storage-url]/output.mp4"
  }
}
```

### Key Features
- Retains original motion and camera angles
- Supports complex scene transformations
- Accepts multiple reference images for consistent styling
- Commercial use enabled

---

## 3. Reference-to-Video API

### Overview
Transforms images, elements, and text into consistent, high-quality video scenes.

### Endpoint Details
- **Model ID**: `fal-ai/kling-video/o1/reference-to-video`
- **URL**: `https://fal.run/fal-ai/kling-video/o1/reference-to-video`
- **Type**: Inference API (Commercial use)
- **Pricing**: $0.112 per second

### Request Parameters

#### Main Inputs

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Text description referencing images and elements using `@Image1`, `@Element1`, etc. (max 2500 chars) |
| `image_urls` | array | Yes | Reference image URLs for scene composition |
| `duration` | string | Yes | Video length: "5" or "10" seconds |
| `aspect_ratio` | string | Yes | Format options: "16:9", "9:16", or "1:1" |

#### Optional Parameters

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `negative_prompt` | string | "blur, distort, and low quality" | Specify unwanted traits |
| `cfg_scale` | number (0-1) | 0.5 | Guidance strength for prompt adherence |

### Element Configuration

Each element supports:
- `frontal_image_url` - Primary character/object image
- `reference_image_urls` - Optional style/appearance references

### Response Format

```json
{
  "video": {
    "file_size": 47359974,
    "file_name": "output.mp4",
    "content_type": "video/mp4",
    "url": "https://v3b.fal.media/files/..."
  }
}
```

### Key Features
- Maintains stable character identity, object details, and environments
- Supports complex cinematography including camera movements
- Smooth transitions and style preservation across generated frames

---

## 4. Image-to-Video API (First Frame / Last Frame)

### Overview
Generates videos by animating transitions between a start frame and end frame, following text-driven style guidance.

### Endpoint Details
- **Model ID**: `fal-ai/kling-video/o1/image-to-video`
- **Endpoint**: `POST /omni/pro/image-to-video`

### Request Parameters

| Parameter | Type | Required | Details |
|-----------|------|----------|---------|
| `prompt` | string | Yes | Use @Image1 for start frame, @Image2 for end frame |
| `start_image_url` | string | Yes | Max 10MB, 300-2500px dimensions |
| `end_image_url` | string | No | Same size constraints as start image |
| `duration` | enum | No | Options: `5` or `10` seconds (default: `5`) |

### Response Format

```json
{
  "video": {
    "file_size": 28472159,
    "file_name": "output.mp4",
    "content_type": "video/mp4",
    "url": "https://..."
  }
}
```

### Basic Usage Example

```javascript
const result = await fal.subscribe(
  "fal-ai/kling-video/o1/image-to-video",
  {
    input: {
      prompt: "Smooth transition with magical effects",
      start_image_url: "https://...",
      end_image_url: "https://..."
    }
  }
);
```

### Queue Operations

- **Submit**: `fal.queue.submit()` - returns `request_id`
- **Status**: `fal.queue.status(request_id)` - check progress
- **Result**: `fal.queue.result(request_id)` - retrieve output

### File Handling

- Data URI (base64) supported
- Publicly accessible URLs accepted
- Auto-upload via `fal.storage.upload(file)`

---

## 5. AI Avatar Standard API

### Overview
Creates avatar videos featuring realistic humans, animals, cartoons, or stylized characters with synchronized audio-driven animation.

### Endpoint Details
- **Model ID**: `fal-ai/kling-video/v1/standard/ai-avatar`
- **Base URL**: `https://fal.run/fal-ai/kling-video/v1/standard/ai-avatar`
- **Type**: Image-to-Video (Avatar Generation)
- **Commercial Use**: Supported

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image_url` | string | Yes | The URL of the image to use as your avatar |
| `audio_url` | string | Yes | The URL of the audio file |
| `prompt` | string | No | Custom prompt for video generation (default: ".") |

### Supported File Formats

**Image (Character)**:
- Formats: JPG, JPEG, PNG, WebP, GIF, AVIF
- Max size: 10MB

**Audio**:
- Formats: MP3, OGG, WAV, M4A, AAC
- Max size: 50MB

### Response Format

```json
{
  "video": {
    "url": "https://v3.fal.media/files/.../output.mp4"
  },
  "duration": 5.0
}
```

### Basic Usage

```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe(
  "fal-ai/kling-video/v1/standard/ai-avatar",
  {
    input: {
      image_url: "https://example.com/avatar.jpg",
      audio_url: "https://example.com/speech.mp3",
      prompt: "Natural speaking motion"
    }
  }
);
```

### Queue Operations

```javascript
// Submit request
const { request_id } = await fal.queue.submit(
  "fal-ai/kling-video/v1/standard/ai-avatar",
  { input: { image_url: "...", audio_url: "..." } }
);

// Check status
const status = await fal.queue.status(
  "fal-ai/kling-video/v1/standard/ai-avatar",
  { requestId: request_id }
);

// Get result
const result = await fal.queue.result(
  "fal-ai/kling-video/v1/standard/ai-avatar",
  { requestId: request_id }
);
```

---

## 6. AI Avatar Pro API

### Overview
Premium endpoint for creating high-quality avatar videos with enhanced realism and better audio synchronization.

### Endpoint Details
- **Model ID**: `fal-ai/kling-video/v1/pro/ai-avatar`
- **Base URL**: `https://fal.run/fal-ai/kling-video/v1/pro/ai-avatar`
- **Type**: Image-to-Video (Avatar Generation)
- **Commercial Use**: Supported
- **Pricing**: $0.115 per second of video generated

### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `image_url` | string | Yes | The URL of the image to use as your avatar |
| `audio_url` | string | Yes | The URL of the audio file |
| `prompt` | string | No | Custom prompt for video generation (default: ".") |

### Supported File Formats

Same as Standard:
- **Image**: JPG, JPEG, PNG, WebP, GIF, AVIF (max 10MB)
- **Audio**: MP3, OGG, WAV, M4A, AAC (max 50MB)

### Response Format

```json
{
  "video": {
    "url": "https://v3.fal.media/files/.../output.mp4"
  },
  "duration": 5.0
}
```

### Basic Usage

```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe(
  "fal-ai/kling-video/v1/pro/ai-avatar",
  {
    input: {
      image_url: "https://example.com/avatar.jpg",
      audio_url: "https://example.com/speech.mp3"
    }
  }
);
```

### Key Differences from Standard
- Higher quality output with enhanced realism
- Better lip-sync accuracy
- More natural facial expressions and movements
- Premium pricing ($0.115/second)

---

## Common Patterns

### SDK Installation
```bash
npm install --save @fal-ai/client
```

### Authentication Setup
```javascript
import { fal } from "@fal-ai/client";

fal.config({
  credentials: process.env.FAL_KEY
});
```

### Async Queue Pattern
```javascript
// 1. Submit request
const { request_id } = await fal.queue.submit(modelId, { input: {...} });

// 2. Poll for status
const status = await fal.queue.status(modelId, { requestId: request_id });

// 3. Get result when complete
const result = await fal.queue.result(modelId, { requestId: request_id });
```

### Webhook Integration
```javascript
const { request_id } = await fal.queue.submit(modelId, {
  input: {...},
  webhookUrl: "https://your-server.com/webhook"
});
```

---

## Integration TODO

### Core Setup
- [ ] Add fal.ai client dependency
- [ ] Set up FAL_KEY in environment/Electron secure storage

### UI Implementation
- [ ] Create AI Video Generation dialog with tab structure
- [ ] Implement Text tab (text-to-video)
- [ ] Implement Image tab (video-to-video, reference-to-video, image-to-video)
- [ ] Implement Avatar tab (ai-avatar standard/pro)
- [ ] Implement Upscale tab (video enhancement)

### Avatar Tab Components
- [ ] Character Image upload (Required) - JPG, PNG, WebP (max 10MB)
- [ ] Audio File upload (For Kling Avatar models) - MP3, WAV, AAC (max 50MB)
- [ ] Source Video upload (For WAN Animate/Replace) - MP4, MOV, AVI (max 100MB)
- [ ] Additional Prompt input (optional)
- [ ] Standard/Pro quality selector

### Backend Integration
- [ ] Implement queue-based progress tracking
- [ ] Handle file upload via fal.storage
- [ ] Add result video to timeline
- [ ] Error handling and retry logic

