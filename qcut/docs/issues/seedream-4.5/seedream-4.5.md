# Seedream 4.5 - ByteDance AI Image Generation & Editing

## Overview

Seedream 4.5 is ByteDance's unified image generation and editing model available through FAL AI. It supports both text-to-image generation and image editing/adjustment capabilities.

**Key Features:**
- Commercial use license
- No cold starts
- Unified architecture for generation and editing
- Supports resolutions up to 4K
- Up to 10 input images for editing

---

## 1. Text-to-Image Panel

### API Endpoint
- **Model ID**: `fal-ai/bytedance/seedream/v4.5/text-to-image`
- **Documentation**: https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image/api

### Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | ✓ | — | Text description for image generation |
| `image_size` | object/enum | ✗ | `auto_2K` | Output dimensions (see presets below) |
| `num_images` | integer | ✗ | 1 | Number of generation iterations (1-6) |
| `max_images` | integer | ✗ | 1 | Max images per generation (1-6) |
| `seed` | integer | ✗ | — | Random seed for reproducibility |
| `sync_mode` | boolean | ✗ | false | Return as data URI; disables request history |
| `enable_safety_checker` | boolean | ✗ | true | Enable content filtering |

### Image Size Presets
- `square_hd` - Square high definition
- `square` - Standard square
- `portrait_4_3` - Portrait 4:3 ratio
- `portrait_16_9` - Portrait 16:9 ratio
- `landscape_4_3` - Landscape 4:3 ratio
- `landscape_16_9` - Landscape 16:9 ratio
- `auto_2K` - Automatic 2K resolution (default)
- `auto_4K` - Automatic 4K resolution

Or use custom dimensions: `{ width: 1920, height: 1080 }` (range: 1920-4096)

### Output Format
```json
{
  "images": [
    {
      "url": "string",
      "content_type": "string",
      "file_name": "string",
      "file_size": "integer",
      "width": "integer",
      "height": "integer"
    }
  ],
  "seed": "integer"
}
```

### Code Example
```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/bytedance/seedream/v4.5/text-to-image", {
  input: {
    prompt: "A professional photograph of a mountain landscape at sunset",
    image_size: "auto_2K",
    num_images: 1
  },
  logs: true,
  onQueueUpdate: (update) => {
    if (update.status === "IN_PROGRESS") {
      console.log("Progress:", update.logs);
    }
  }
});

console.log(result.data.images[0].url);
```

---

## 2. Image Edit / Adjustment Panel

### API Endpoint
- **Model ID**: `fal-ai/bytedance/seedream/v4.5/edit`
- **Documentation**: https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit/api

### Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | ✓ | — | Text instructions for editing the image |
| `image_urls` | array[string] | ✓ | — | URLs of input images (max 10 allowed) |
| `image_size` | string/object | ✗ | 2048×2048 | Output dimensions (see presets) |
| `num_images` | integer | ✗ | 1 | Number of generation iterations (1-6) |
| `max_images` | integer | ✗ | 1 | Max images per generation (1-6) |
| `seed` | integer | ✗ | — | Random seed for reproducibility |
| `sync_mode` | boolean | ✗ | false | Return as data URI instead of URL |
| `enable_safety_checker` | boolean | ✗ | true | Enable content filtering |

### Output Format
```json
{
  "images": [
    {
      "url": "string",
      "content_type": "string",
      "file_name": "string",
      "file_size": "integer",
      "width": "integer",
      "height": "integer"
    }
  ]
}
```

### Code Example
```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/bytedance/seedream/v4.5/edit", {
  input: {
    prompt: "Replace the background with a beach sunset",
    image_urls: ["https://example.com/my-image.png"]
  },
  logs: true,
  onQueueUpdate: (update) => {
    if (update.status === "IN_PROGRESS") {
      console.log("Progress:", update.logs);
    }
  }
});

console.log(result.data.images[0].url);
```

### Multi-Image Editing Example
```javascript
// Use multiple images for compositing/replacement
const result = await fal.subscribe("fal-ai/bytedance/seedream/v4.5/edit", {
  input: {
    prompt: "Replace the product in Figure 1 with the product from Figure 2, maintaining the original lighting and perspective",
    image_urls: [
      "https://example.com/scene.png",    // Figure 1: Base scene
      "https://example.com/product.png"   // Figure 2: Product to insert
    ]
  }
});
```

---

## Implementation Notes for QCut

### Panel Integration

**Text-to-Image Panel:**
- Add to AI tab with prompt input
- Include image size dropdown with presets
- Add seed input for reproducibility
- Show generation progress via `onQueueUpdate`

**Image Edit Panel:**
- Allow users to select existing media from timeline
- Upload selected media to FAL via Electron IPC
- Provide editing prompt input
- Support multiple image selection (up to 10)

### FAL Upload Integration
Use the existing two-step upload process from `electron/main.ts`:
1. Initiate upload: `POST https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3`
2. Upload file: `PUT` to signed URL
3. Use returned `file_url` in `image_urls` array

### Error Handling
- Handle FAL API rate limits
- Implement retry logic for transient failures
- Validate image URLs before submission
- Check safety checker rejections

---

## Status

| Feature | Status | Notes |
|---------|--------|-------|
| Text-to-Image API Research | ✅ Complete | API documented |
| Image Edit API Research | ✅ Complete | API documented |
| UI Panel Design | ⬜ Pending | |
| Frontend Implementation | ⬜ Pending | |
| FAL Client Integration | ⬜ Pending | |
| Testing | ⬜ Pending | |

---

## References

- [Seedream 4.5 Text-to-Image API](https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image/api)
- [Seedream 4.5 Edit API](https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit/api)
- [FAL AI Client Documentation](https://fal.ai/docs)
