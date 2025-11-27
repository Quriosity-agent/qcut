# Z-Image Turbo Model Integration

## Status: PENDING

**Created:** 2025-11-27

## Summary

Add support for the Z-Image Turbo model from fal.ai as a new text-to-image generation option. Z-Image Turbo is a super fast text-to-image model with 6B parameters developed by Tongyi-MAI.

## Model Information

| Property | Value |
|----------|-------|
| Model Name | Z-Image Turbo |
| Model ID | `fal-ai/z-image/turbo` |
| Provider | fal.ai |
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

## Implementation Code Example

```typescript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/z-image/turbo", {
  input: {
    prompt: "A beautiful sunset over mountains",
    image_size: "landscape_4_3",
    num_inference_steps: 8,
    num_images: 1,
    output_format: "png",
    enable_safety_checker: true
  },
  logs: true,
  onQueueUpdate: (update) => {
    if (update.status === "IN_PROGRESS") {
      console.log("Generating...", update.logs);
    }
  }
});

console.log(result.data.images[0].url);
```

## Files to Modify

1. **Model Configuration**
   - Add Z-Image Turbo to available models list
   - Location: `apps/web/src/components/editor/media-panel/views/` (model configs)

2. **API Integration**
   - Add handler for z-image/turbo endpoint
   - Ensure fal.ai client is properly configured

3. **UI Updates**
   - Add model option to Generation model selector
   - Consider adding acceleration toggle for speed vs quality tradeoff

## Key Features to Highlight

- **Speed:** Turbo variant optimized for fast generation
- **Quality:** 6B parameter model for high-quality outputs
- **Flexibility:** Multiple image size presets and custom dimensions
- **Safety:** Built-in safety checker option

## Considerations

### Acceleration Modes

The model supports three acceleration levels:
- `none` - Default quality
- `regular` - Faster with minor quality tradeoff
- `high` - Fastest generation

Consider exposing this as a "Speed vs Quality" toggle in the UI.

### Inference Steps

Default is 8 steps which is optimized for the turbo model. Higher values (up to 30) may improve quality at the cost of speed.

## Priority

Medium - Adds variety to text-to-image generation options

## Related Components

- Model type selector (`model-type-selector.tsx`)
- AI Images panel
- fal.ai client integration

## References

- [fal.ai Z-Image Turbo API](https://fal.ai/models/fal-ai/z-image/turbo/api)
- [fal.ai Documentation](https://fal.ai/docs)
