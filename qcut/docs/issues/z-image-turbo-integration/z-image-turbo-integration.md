# Z-Image Turbo Model Integration

## Status: PENDING

**Created:** 2025-11-27
**Estimated Total Time:** 25-35 minutes
**Complexity:** Medium

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

---

## Implementation Subtasks

### Subtask 1: Add Model Definition (5-8 minutes)
**File:** `apps/web/src/lib/text2image-models.ts`

**Status:** [ ] Not Started

Add the Z-Image Turbo model to the `TEXT2IMAGE_MODELS` object:

```typescript
"z-image-turbo": {
  id: "z-image-turbo",
  name: "Z-Image Turbo",
  description: "Super fast 6B parameter text-to-image model by Tongyi-MAI. Optimized for speed with acceleration options.",
  provider: "Tongyi-MAI",
  endpoint: "https://fal.run/fal-ai/z-image/turbo",
  qualityRating: 4,
  speedRating: 5,
  estimatedCost: "$0.03-0.05",
  costPerImage: 4,
  maxResolution: "14142x14142",
  supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
  defaultParams: {
    image_size: "landscape_4_3",
    num_inference_steps: 8,
    num_images: 1,
    enable_safety_checker: true,
    output_format: "png"
  },
  availableParams: [
    {
      name: "image_size",
      type: "select",
      options: ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"],
      default: "landscape_4_3",
      description: "Image size preset"
    },
    {
      name: "num_inference_steps",
      type: "number",
      min: 1,
      max: 30,
      default: 8,
      description: "Number of inference steps (higher = better quality, slower)"
    },
    {
      name: "acceleration",
      type: "select",
      options: ["none", "regular", "high"],
      default: "none",
      description: "Processing acceleration level"
    }
  ],
  bestFor: ["Fast generation", "Quick iterations", "Prototyping"],
  strengths: ["Very fast generation", "H100 GPU acceleration", "Multiple acceleration modes", "Large max resolution"],
  limitations: ["Newer model with less community testing"]
}
```

**Changes:**
1. Add model object to `TEXT2IMAGE_MODELS` (~line 900)
2. Add `"z-image-turbo"` to `TEXT2IMAGE_MODEL_ORDER` array (~line 938)
3. Add to appropriate `MODEL_CATEGORIES` (~line 1017):
   - `FAST`: Add `"z-image-turbo"`
   - `COST_EFFECTIVE`: Add `"z-image-turbo"`

---

### Subtask 2: Add Parameter Conversion Logic (5-7 minutes)
**File:** `apps/web/src/lib/fal-ai-client.ts`

**Status:** [ ] Not Started

Add case in `convertSettingsToParams()` method (~line 416-589):

```typescript
case "z-image-turbo":
  // Z-Image Turbo uses image_size presets directly
  params.image_size = settings.imageSize || "landscape_4_3";
  params.num_inference_steps = 8;
  params.enable_safety_checker = true;
  if (settings.outputFormat) {
    params.output_format = settings.outputFormat;
  }
  break;
```

**Note:** Z-Image Turbo uses standard `image_size` parameter with preset strings (similar to SeedDream v3), and returns standard `images` array format, so minimal custom handling needed.

---

### Subtask 3: Verify Response Handling (3-5 minutes)
**File:** `apps/web/src/lib/fal-ai-client.ts`

**Status:** [ ] Not Started

Check `generateWithModel()` method (~line 614-630) to confirm Z-Image Turbo response format is handled:

**Z-Image Turbo Response Format:**
```json
{
  "images": [{"url": "...", "width": 1024, "height": 768}],
  "seed": 12345,
  "timings": {...}
}
```

This matches the standard format used by most models, so **no additional response handling should be needed**. The existing code should work:

```typescript
if (response.images && response.images.length > 0) {
  image = response.images[0];
}
```

**Verification:** Confirm the above logic handles Z-Image Turbo responses correctly.

---

### Subtask 4: Add Type Definitions (Optional) (2-3 minutes)
**File:** `apps/web/src/lib/text2image-models.ts`

**Status:** [ ] Not Started

If strict typing is needed, add Z-Image specific types:

```typescript
type ZImageAcceleration = "none" | "regular" | "high";

type ZImageSizePreset =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9";
```

---

### Subtask 5: Test Integration (10-12 minutes)
**Status:** [ ] Not Started

**Manual Testing Checklist:**

1. [ ] Model appears in model selection dropdown
2. [ ] Model can be selected in single-model mode
3. [ ] Model can be selected in multi-model comparison mode
4. [ ] Generation request succeeds with default parameters
5. [ ] Generated image displays correctly
6. [ ] Image can be downloaded
7. [ ] Image can be added to media library
8. [ ] Seed reproducibility works (same seed = same image)
9. [ ] Different image_size presets work correctly

**Test Commands:**
```bash
# Start dev server
cd apps/web && bun dev

# Navigate to Editor > AI Images panel > Generation tab
# Select Z-Image Turbo from model dropdown
# Enter test prompt and generate
```

---

## Files to Modify Summary

| File | Changes | Priority |
|------|---------|----------|
| `apps/web/src/lib/text2image-models.ts` | Add model definition, update MODEL_ORDER, update CATEGORIES | High |
| `apps/web/src/lib/fal-ai-client.ts` | Add parameter conversion case | High |

## Implementation Notes

### Why This Model Fits Well

1. **Speed Focus:** Complements slower, higher-quality models
2. **Standard Response:** Uses `images` array format (no custom parsing)
3. **Standard Parameters:** Uses `image_size` presets (similar to SeedDream)
4. **Acceleration Options:** Unique feature for speed/quality tradeoff

### Acceleration Mode Consideration

The `acceleration` parameter is unique to Z-Image Turbo:
- `none` - Full quality (default)
- `regular` - Faster with minor quality reduction
- `high` - Fastest, some quality loss

**Future Enhancement:** Consider adding a UI toggle for acceleration mode in the generation settings panel.

### Parameter Mapping

| Generic Setting | Z-Image Parameter |
|-----------------|-------------------|
| `imageSize` | `image_size` (preset string) |
| `seed` | `seed` |
| `outputFormat` | `output_format` |

---

## Progress Tracking

| Subtask | Status | Time Spent | Notes |
|---------|--------|------------|-------|
| 1. Model Definition | Not Started | - | - |
| 2. Parameter Conversion | Not Started | - | - |
| 3. Response Handling | Not Started | - | - |
| 4. Type Definitions | Not Started | - | Optional |
| 5. Testing | Not Started | - | - |

**Total Progress:** 0/5 subtasks completed

---

## References

- [fal.ai Z-Image Turbo API](https://fal.ai/models/fal-ai/z-image/turbo/api)
- [fal.ai Documentation](https://fal.ai/docs)
- Existing model patterns in `text2image-models.ts`
