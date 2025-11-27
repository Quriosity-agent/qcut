# Z-Image Turbo Model Integration

## Status: IMPLEMENTED

**Created:** 2025-11-27
**Implemented:** 2025-11-27

## Summary

Add support for the Z-Image Turbo model from fal.ai as a new text-to-image generation option. Z-Image Turbo is a super fast text-to-image model with 6B parameters developed by Tongyi-MAI.

## Model Information

| Property | Value |
|----------|-------|
| Model Name | Z-Image Turbo |
| Model ID | `fal-ai/z-image/turbo` |
| Internal Key | `z-image-turbo` |
| Provider | Tongyi-MAI (via fal.ai) |
| Category | Text-to-Image |
| Machine Type | GPU-H100 |
| Parameters | 6B |
| Commercial Use | Permitted |

## API Endpoint

- **Base URL:** `https://fal.run/fal-ai/z-image/turbo`
- **Method:** POST
- **Timeout:** 3600 seconds

## Input Parameters

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| `prompt` | string | — | Yes | The prompt to generate an image from |
| `image_size` | ImageSize \| Enum | `landscape_4_3` | No | Image dimensions or preset |
| `num_inference_steps` | integer | 8 | No | Number of inference steps (1-30) |
| `seed` | integer | — | No | Seed for reproducible results |
| `sync_mode` | boolean | false | No | Returns media as data URI |
| `num_images` | integer | 1 | No | Number of images to generate (1-4) |
| `enable_safety_checker` | boolean | true | No | Activates safety filtering |
| `output_format` | Enum | `png` | No | Output format: jpeg, png, webp |
| `acceleration` | Enum | `none` | No | Processing speed: none, regular, high |

### Image Size Presets

- `square_hd`
- `square`
- `portrait_4_3`
- `portrait_16_9`
- `landscape_4_3`
- `landscape_16_9`

### Custom Image Size Object

```typescript
interface ImageSize {
  width: number;  // default: 512, max: 14142
  height: number; // default: 512, max: 14142
}
```

## Output Schema

```typescript
interface ZImageTurboOutput {
  images: Array<{
    url: string;
    width: number;
    height: number;
    content_type: string; // default: "image/jpeg"
  }>;
  timings: object;
  seed: number;
  has_nsfw_concepts: boolean[];
  prompt: string;
}
```

## Review Notes (2025-11-27)

The following review concerns were addressed during implementation:

| Concern | Resolution |
|---------|------------|
| `output_format` not in `availableParams` | Added `output_format` to `availableParams` with options: jpeg, png, webp |
| Size preset mismatch (`portrait_4_3` vs `portrait_3_4`) | Added size mapping in `fal-ai-client.ts` to convert app tokens to Z-Image format |
| `acceleration` not in GenerationSettings | Deferred - not exposed in UI (uses default `none`) |
| `maxResolution: "14142x14142"` unrealistic | Changed to `"2048x2048"` to match typical model limits |

---

## Implementation Details

### Files Modified

1. **`apps/web/src/lib/text2image-models.ts`**
   - Added `z-image-turbo` model definition (lines 829-927)
   - Added to `TEXT2IMAGE_MODEL_ORDER` array (line 1041)
   - Added to `MODEL_CATEGORIES.VERSATILE`, `FAST`, and `COST_EFFECTIVE`

2. **`apps/web/src/lib/fal-ai-client.ts`**
   - Added parameter conversion case for `z-image-turbo` (lines 564-578)
   - Includes size mapping from app tokens (`portrait_3_4` → `portrait_4_3`)

### Model Definition (as implemented)

```typescript
"z-image-turbo": {
  id: "z-image-turbo",
  name: "Z-Image Turbo",
  description: "Super fast 6B parameter text-to-image model by Tongyi-MAI, optimized for speed",
  provider: "Tongyi-MAI",
  endpoint: "https://fal.run/fal-ai/z-image/turbo",
  qualityRating: 4,
  speedRating: 5,
  estimatedCost: "$0.03-0.05",
  costPerImage: 4,
  maxResolution: "2048x2048",
  supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
  defaultParams: {
    image_size: "landscape_4_3",
    num_inference_steps: 8,
    num_images: 1,
    enable_safety_checker: true,
  },
  availableParams: [
    { name: "image_size", type: "select", options: [...], default: "landscape_4_3" },
    { name: "num_inference_steps", type: "number", min: 1, max: 30, default: 8 },
    { name: "num_images", type: "number", min: 1, max: 4, default: 1 },
    { name: "output_format", type: "select", options: ["jpeg", "png", "webp"], default: "png" },
    { name: "enable_safety_checker", type: "boolean", default: true },
    { name: "seed", type: "number", min: 0, max: 2_147_483_647, default: null },
  ],
  bestFor: ["Fast generation", "Quick iterations", "Prototyping", "Cost-effective generation"],
  strengths: ["Very fast generation speed", "6B parameter model", "H100 GPU acceleration", "Cost-effective", "Good for rapid prototyping"],
  limitations: ["Newer model with less community testing", "May not match photorealistic models", "Limited advanced customization"],
}
```

### Parameter Conversion Logic (as implemented)

```typescript
case "z-image-turbo":
  // Z-Image Turbo uses image_size presets directly (like SeedDream)
  // Note: Z-Image uses portrait_4_3/portrait_16_9 (not portrait_3_4/portrait_9_16)
  if (typeof settings.imageSize === "string") {
    // Map app's standard size tokens to Z-Image's format
    const sizeMapping: Record<string, string> = {
      portrait_3_4: "portrait_4_3",
      portrait_9_16: "portrait_16_9",
    };
    params.image_size = sizeMapping[settings.imageSize] || settings.imageSize;
  } else {
    params.image_size = "landscape_4_3";
  }
  break;
```

---

## Progress Tracking

| Subtask | Status | Notes |
|---------|--------|-------|
| 1. Model Definition | Completed | Added to TEXT2IMAGE_MODELS |
| 2. MODEL_ORDER Update | Completed | Added after nano-banana |
| 3. MODEL_CATEGORIES Update | Completed | Added to VERSATILE, FAST, COST_EFFECTIVE |
| 4. Parameter Conversion | Completed | Added size mapping for portrait presets |
| 5. Testing | Pending | Manual testing required |

**Total Progress:** 4/5 subtasks completed

---

## Testing Checklist

- [ ] Model appears in model selection dropdown
- [ ] Model can be selected in single-model mode
- [ ] Model can be selected in multi-model comparison mode
- [ ] Generation request succeeds with default parameters
- [ ] Generated image displays correctly
- [ ] Image can be downloaded
- [ ] Image can be added to media library
- [ ] Seed reproducibility works (same seed = same image)
- [ ] Different image_size presets work correctly

**Test Commands:**
```bash
# Start dev server
cd apps/web && bun dev

# Navigate to Editor > AI Images panel > Generation tab
# Select Z-Image Turbo from model dropdown
# Enter test prompt and generate
```

---

## Future Enhancements

1. **Acceleration Mode UI** - Add toggle for `acceleration` parameter (none/regular/high)
2. **Inference Steps Slider** - Expose `num_inference_steps` in advanced settings
3. **Custom Resolution** - Support custom width/height for advanced users

---

## References

- [fal.ai Z-Image Turbo API](https://fal.ai/models/fal-ai/z-image/turbo/api)
- [fal.ai Documentation](https://fal.ai/docs)
- Existing model patterns in `text2image-models.ts`
