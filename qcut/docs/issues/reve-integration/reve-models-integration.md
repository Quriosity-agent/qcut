# Reve Models Integration Plan

This document outlines the integration of two Reve models from fal.ai into QCut:
1. **Reve Edit** - Image adjustment/editing model
2. **Reve Text-to-Image** - AI image generation model

---

## 1. Reve Edit Model (Image Adjustment)

### Overview
- **Category**: Image Adjustment/Editing
- **Purpose**: Edit existing images based on text prompts
- **Endpoint**: `https://fal.run/fal-ai/reve/edit`
- **Pricing**: TBD (check `/pricing` endpoint)

### API Specification

#### Required Input Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | string | Text description of how to edit the provided image |
| `image_url` | string | URL of the reference image to edit (must be publicly accessible or base64 data URI) |

#### Optional Input Parameters
| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `num_images` | integer | 1 | 1-4 | Number of edited variations to generate |
| `output_format` | enum | png | png, jpeg, webp | Output image format |
| `sync_mode` | boolean | false | — | Return media as data URI without request history |

#### Image Constraints
- **Supported formats**: PNG, JPEG, WebP, AVIF, HEIF
- **Maximum file size**: 10 MB
- **Minimum dimensions**: 128×128 px
- **Maximum dimensions**: 4096×4096 px

#### Output Format
```json
{
  "images": [
    {
      "url": "https://v3b.fal.media/files/...",
      "content_type": "image/png",
      "file_name": "string",
      "file_size": 0,
      "width": 1024,
      "height": 1024
    }
  ]
}
```

#### Example Request
```javascript
const result = await fal.subscribe("fal-ai/reve/edit", {
  input: {
    prompt: "Give him a friend",
    image_url: "https://v3b.fal.media/files/b/koala/sZE6zNTKjOKc4kcUdVlu__26bac54c-3e94-43e9-aeff-f2efc2631ef0.webp"
  }
});
```

### Integration Points for QCut

#### Where to Add
- **UI Location**: Image Adjustment/Effects panel
- **Feature Category**: Image editing tools alongside existing filters and effects

#### Files to Modify
1. **`apps/web/src/lib/fal-ai-client.ts`**
   - Add `generateReveEdit()` method
   - Handle image upload/URL conversion

2. **`apps/web/src/types/ai-generation.ts`**
   - Add `ReveEditInput` interface
   - Add `ReveEditOutput` interface

3. **UI Component** (create new or extend existing)
   - Image upload component
   - Text prompt input for edit instructions
   - Number of variations selector (1-4)
   - Output format selector
   - Preview and download results

#### Type Definitions
```typescript
interface ReveEditInput {
  prompt: string;
  image_url: string;
  num_images?: number; // 1-4
  output_format?: "png" | "jpeg" | "webp";
  sync_mode?: boolean;
}

interface ReveEditOutput {
  images: Array<{
    url: string;
    content_type: string;
    file_name?: string;
    file_size?: number;
    width?: number;
    height?: number;
  }>;
}
```

---

## 2. Reve Text-to-Image Model (AI Images)

### Overview
- **Category**: AI Image Generation
- **Purpose**: Generate images from text descriptions
- **Endpoint**: `https://fal.run/fal-ai/reve/text-to-image`
- **Pricing**: **$0.04 per image**

### API Specification

#### Input Parameters
| Parameter | Type | Default | Options | Description |
|-----------|------|---------|---------|-------------|
| `prompt` | string | *required* | 1-2560 chars | Text description of the desired image |
| `aspect_ratio` | enum | `3:2` | `16:9`, `9:16`, `3:2`, `2:3`, `4:3`, `3:4`, `1:1` | Output aspect ratio |
| `num_images` | integer | 1 | 1-4 | Number of images to generate |
| `output_format` | enum | png | png, jpeg, webp | Output image format |
| `sync_mode` | boolean | false | — | Return media as data URI |

#### Output Format
```json
{
  "images": [
    {
      "url": "https://...",
      "content_type": "image/png",
      "file_name": "string",
      "file_size": 0,
      "width": 1024,
      "height": 1024
    }
  ]
}
```

#### Example Request
```json
{
  "prompt": "A serene mountain landscape at sunset with snow-capped peaks",
  "aspect_ratio": "16:9",
  "num_images": 1,
  "output_format": "png"
}
```

### Key Features
- Strong aesthetic quality with accurate text rendering
- Commercial use permitted
- Multiple image generation (up to 4 per request)
- Flexible output formats and aspect ratios

### Integration Points for QCut

#### Where to Add
- **UI Location**: AI Images panel (existing text2image view)
- **Add to Model List**: `TEXT2IMAGE_MODELS` in `lib/text2image-models.ts`

#### Files to Modify
1. **`apps/web/src/lib/text2image-models.ts`**
   - Add Reve model configuration

2. **`apps/web/src/lib/fal-ai-client.ts`**
   - Reve should work with existing `generateWithModel()` method
   - May need parameter conversion for aspect ratio

3. **`apps/web/src/components/editor/media-panel/views/text2image.tsx`**
   - Add aspect ratio selector if not already present
   - Update UI to support Reve-specific settings

#### Model Configuration
```typescript
{
  id: "reve-text-to-image",
  name: "Reve",
  description: "Strong aesthetic quality with accurate text rendering",
  endpoint: "fal-ai/reve/text-to-image",
  price: 0.04,
  category: "general",
  params: {
    aspect_ratio: {
      type: "select",
      default: "3:2",
      options: ["16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "1:1"]
    },
    num_images: {
      type: "number",
      default: 1,
      min: 1,
      max: 4
    },
    output_format: {
      type: "select",
      default: "png",
      options: ["png", "jpeg", "webp"]
    }
  }
}
```

#### Type Definitions
```typescript
interface ReveTextToImageInput {
  prompt: string; // 1-2560 characters
  aspect_ratio?: "16:9" | "9:16" | "3:2" | "2:3" | "4:3" | "3:4" | "1:1";
  num_images?: number; // 1-4
  output_format?: "png" | "jpeg" | "webp";
  sync_mode?: boolean;
}

interface ReveTextToImageOutput {
  images: Array<{
    url: string;
    content_type?: string;
    file_name?: string;
    file_size?: number;
    width?: number;
    height?: number;
  }>;
}
```

---

## Implementation Strategy

### Phase 1: Reve Text-to-Image (Easier)
**Effort**: 2-3 hours

1. Add model configuration to `text2image-models.ts`
2. Add type definitions to `ai-generation.ts`
3. Test with existing UI (may work out of the box)
4. Add aspect ratio selector if needed
5. Update pricing display

### Phase 2: Reve Edit (Moderate)
**Effort**: 4-6 hours

1. Add type definitions
2. Implement `generateReveEdit()` in `fal-ai-client.ts`
3. Create or extend image adjustment UI component
4. Add image upload functionality
5. Implement edit preview and download
6. Test with various image formats and sizes

### Testing Checklist

#### Reve Text-to-Image
- [ ] Generate single image with default settings
- [ ] Generate multiple images (2-4)
- [ ] Test all aspect ratios (16:9, 9:16, 3:2, 2:3, 4:3, 3:4, 1:1)
- [ ] Test all output formats (png, jpeg, webp)
- [ ] Verify pricing calculation ($0.04/image)
- [ ] Test long prompts (up to 2560 characters)

#### Reve Edit
- [ ] Upload and edit PNG image
- [ ] Upload and edit JPEG image
- [ ] Upload and edit WebP image
- [ ] Test image size limits (128×128 to 4096×4096)
- [ ] Test 10 MB file size limit
- [ ] Generate multiple variations (2-4)
- [ ] Test different output formats
- [ ] Verify edit quality and accuracy

---

## Cost Analysis

### Reve Text-to-Image
- **Single image**: $0.04
- **4 images (max)**: $0.16
- **Comparison**: Very affordable compared to other models (e.g., Veo 3.1 at $1.20-3.20)

### Reve Edit
- **Pricing**: TBD - Check fal.ai pricing page
- **Estimated**: Likely similar to text-to-image (~$0.04-0.08 per edit)

---

## Notes

### Authentication
Both models require FAL API key:
- Set `VITE_FAL_API_KEY` environment variable
- Or configure via `@fal-ai/client` package

### Commercial Use
Both models permit commercial use, making them suitable for QCut's professional video editing use case.

### Advantages
1. **Cost-effective**: Reve text-to-image is one of the cheapest models at $0.04/image
2. **Quality**: Strong aesthetic quality with accurate text rendering
3. **Flexibility**: Multiple aspect ratios and output formats
4. **Fast**: Reve Edit supports sync_mode for immediate results
5. **Multiple outputs**: Can generate up to 4 variations per request

### Potential Challenges
1. **Image Upload**: Reve Edit requires public URLs or base64 encoding
2. **File Size Limits**: Need to validate image size before upload
3. **Aspect Ratio Handling**: May need UI adjustments for Reve's aspect ratio options
4. **Error Handling**: Implement proper validation for image constraints

---

## Conclusion

Both Reve models are excellent additions to QCut:
- **Reve Text-to-Image** enhances the AI image generation capabilities with a cost-effective, high-quality option
- **Reve Edit** adds powerful image adjustment features that complement the existing editing tools

Recommended implementation order: Text-to-Image first (easier), then Edit (requires more UI work).
