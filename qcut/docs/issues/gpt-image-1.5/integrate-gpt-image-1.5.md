# GPT Image 1.5 Integration Plan

## Overview

Integrate OpenAI's GPT Image 1.5 model via FAL.ai for:
- **Text-to-Image Panel**: Generate images from text prompts
- **Adjustments Panel**: Edit/modify existing images with prompts

## Model Information

- **Provider**: FAL.ai (OpenAI GPT Image 1.5)
- **Commercial Use**: Supported
- **Streaming**: Available
- **Key Feature**: High-fidelity images with strong prompt adherence, preserving composition, lighting, and fine-grained detail

---

## Text-to-Image API

### Endpoint
```
POST https://fal.run/fal-ai/gpt-image-1.5
```

### Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | The prompt for image generation |
| `image_size` | enum | No | `1024x1024` | Output image size |
| `background` | enum | No | `auto` | Background type |
| `quality` | enum | No | `high` | Output quality level |
| `num_images` | integer | No | `1` | Number of images to generate (1-4) |
| `output_format` | enum | No | `png` | Image file format |
| `sync_mode` | boolean | No | `false` | Return as data URI |

### Image Size Options
- `1024x1024` (1:1 square)
- `1536x1024` (3:2 landscape)
- `1024x1536` (2:3 portrait)

### Background Options
- `auto` - Automatic selection
- `transparent` - Transparent background
- `opaque` - Solid background

### Quality Options
- `low` - Faster generation, lower quality
- `medium` - Balanced
- `high` - Best quality (default)

### Output Format Options
- `png` (default)
- `jpeg`
- `webp`

### Example Request
```json
{
  "prompt": "A futuristic cityscape at sunset with flying cars",
  "image_size": "1536x1024",
  "background": "opaque",
  "quality": "high",
  "num_images": 1,
  "output_format": "png"
}
```

### Response Schema
```typescript
interface TextToImageResponse {
  images: Array<{
    url: string;        // Required - URL to generated image
    height: number;     // Image height in pixels
    width: number;      // Image width in pixels
    file_name: string;  // Generated filename
    content_type: string; // MIME type (e.g., "image/png")
    file_size?: number; // File size in bytes
  }>;
}
```

### Example Response
```json
{
  "images": [
    {
      "url": "https://v3b.fal.media/files/b/0a869129/EnWrO3XWjPE0nxBDpaQrj.png",
      "height": 1024,
      "width": 1536,
      "file_name": "EnWrO3XWjPE0nxBDpaQrj.png",
      "content_type": "image/png"
    }
  ]
}
```

---

## Image Edit API (Adjustments Panel)

### Endpoint
```
POST https://fal.run/fal-ai/gpt-image-1.5/edit
```

### Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | The prompt describing desired edits |
| `image_urls` | array[string] | Yes | - | URLs of images to use as reference |
| `image_size` | enum | No | `auto` | Output image size |
| `background` | enum | No | `auto` | Background type |
| `quality` | enum | No | `high` | Output quality level |
| `input_fidelity` | enum | No | `high` | How closely to follow input image |
| `num_images` | integer | No | `1` | Number of images to generate (1-4) |
| `output_format` | enum | No | `png` | Image file format |
| `sync_mode` | boolean | No | `false` | Return as data URI |

### Image Size Options
- `auto` (default - matches input)
- `1024x1024`
- `1536x1024`
- `1024x1536`

### Input Fidelity Options
- `low` - More creative freedom, less adherence to input
- `high` - Closely follows input image (default)

### Example Request
```json
{
  "prompt": "Change the sky to a dramatic sunset with orange and purple clouds",
  "image_urls": ["https://example.com/original-image.png"],
  "image_size": "auto",
  "quality": "high",
  "input_fidelity": "high",
  "num_images": 1,
  "output_format": "png"
}
```

### Response Schema
```typescript
interface ImageEditResponse {
  images: Array<{
    url: string;        // Required - URL to edited image
    height: number;     // Image height in pixels
    width: number;      // Image width in pixels
    file_name: string;  // Generated filename
    content_type: string; // MIME type
  }>;
}
```

### Example Response
```json
{
  "images": [
    {
      "url": "https://v3b.fal.media/files/b/0a8691b0/yUt7tifLSbg1WzWWgfj2o.png",
      "height": 1024,
      "width": 1024,
      "file_name": "yUt7tifLSbg1WzWWgfj2o.png",
      "content_type": "image/png"
    }
  ]
}
```

---

## Implementation Tasks

### Phase 1: Text-to-Image Panel

- [ ] Add `gpt_image_1_5` model configuration to `ai-constants.ts`
- [ ] Create generator function in `src/lib/ai-image/generators/`
- [ ] Add UI controls for:
  - Image size selector (1024x1024, 1536x1024, 1024x1536)
  - Background type (auto, transparent, opaque)
  - Quality level (low, medium, high)
  - Number of images (1-4)
  - Output format (png, jpeg, webp)
- [ ] Add input validation for prompt
- [ ] Handle response and display generated images

### Phase 2: Adjustments Panel (Image Edit)

- [ ] Add `gpt_image_1_5_edit` model configuration
- [ ] Create edit generator function
- [ ] Add UI controls for:
  - Image upload/URL input
  - Edit prompt input
  - Image size (auto or specific)
  - Input fidelity (low, high)
  - Quality and format options
- [ ] Implement image URL handling (upload to FAL or use existing URL)
- [ ] Handle response and display edited images

### Phase 3: Integration

- [ ] Add to model selector dropdowns
- [ ] Implement progress/loading states
- [ ] Add error handling and user feedback
- [ ] Test with various prompts and settings

---

## Model Configuration Example

```typescript
// For ai-constants.ts
export const GPT_IMAGE_1_5_CONFIG = {
  id: "gpt_image_1_5",
  name: "GPT Image 1.5",
  provider: "fal-ai",
  endpoint: "fal-ai/gpt-image-1.5",
  type: "text-to-image",
  commercial_use: true,
  default_params: {
    image_size: "1024x1024",
    background: "auto",
    quality: "high",
    num_images: 1,
    output_format: "png",
  },
};

export const GPT_IMAGE_1_5_EDIT_CONFIG = {
  id: "gpt_image_1_5_edit",
  name: "GPT Image 1.5 Edit",
  provider: "fal-ai",
  endpoint: "fal-ai/gpt-image-1.5/edit",
  type: "image-edit",
  commercial_use: true,
  default_params: {
    image_size: "auto",
    background: "auto",
    quality: "high",
    input_fidelity: "high",
    num_images: 1,
    output_format: "png",
  },
};
```

---

## Authentication

Uses the existing FAL.ai API key configured in the project:
- Environment variable: `VITE_FAL_API_KEY`
- Header: `Authorization: Key ${FAL_API_KEY}`

---

## Notes

- Both endpoints support queue-based processing with polling
- Images are hosted on FAL's CDN (`v3b.fal.media`)
- Transparent background useful for compositing in video editor
- Edit API requires pre-uploaded images (use FAL storage or public URLs)
