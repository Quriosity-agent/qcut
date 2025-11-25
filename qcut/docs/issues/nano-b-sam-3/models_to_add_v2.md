# FLUX 2 Flex Model Integration Plan

## API Sources
- https://fal.ai/models/fal-ai/flux-2-flex/api
- https://fal.ai/models/fal-ai/flux-2-flex/edit/api

---

## Model 1: FLUX 2 Flex (Text-to-Image)

### API Details
- **Endpoint**: `fal-ai/flux-2-flex`
- **Type**: Text-to-Image Generation
- **Provider**: Black Forest Labs
- **Pricing**: $0.06/megapixel (input + output)

### Input Parameters
| Parameter | Type | Default | Constraints |
|-----------|------|---------|-------------|
| `prompt` | string | required | - |
| `image_size` | enum | `landscape_4_3` | square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9 |
| `enable_prompt_expansion` | boolean | `true` | - |
| `seed` | integer | - | optional |
| `safety_tolerance` | enum | `"2"` | 1-5 |
| `enable_safety_checker` | boolean | `true` | - |
| `output_format` | enum | `"jpeg"` | jpeg, png |
| `sync_mode` | boolean | `false` | - |
| `guidance_scale` | float | `3.5` | 1.5-10 |
| `num_inference_steps` | integer | `28` | 2-50 |

### Output Schema
```json
{
  "images": [{ "url": "string", "width": "integer", "height": "integer" }],
  "seed": "integer"
}
```

---

## Model 2: FLUX 2 Flex Edit (Image-to-Image)

### API Details
- **Endpoint**: `fal-ai/flux-2-flex/edit`
- **Type**: Image Editing
- **Provider**: Black Forest Labs
- **Pricing**: $0.06/megapixel (input + output)

### Input Parameters
| Parameter | Type | Default | Constraints |
|-----------|------|---------|-------------|
| `prompt` | string | required | - |
| `image_urls` | list[string] | required | - |
| `image_size` | enum | `auto` | auto, square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9 |
| `num_inference_steps` | integer | `28` | 2-50 |
| `guidance_scale` | float | `3.5` | 1.5-10 |
| `enable_prompt_expansion` | boolean | `true` | - |
| `seed` | integer | - | optional |
| `safety_tolerance` | enum | `"2"` | 1-5 |
| `enable_safety_checker` | boolean | `true` | - |
| `output_format` | enum | `"jpeg"` | jpeg, png |
| `sync_mode` | boolean | `false` | - |

### Output Schema
```json
{
  "images": [{ "url": "string", "width": "integer", "height": "integer" }],
  "seed": "integer"
}
```

---

# Implementation Subtasks

## Subtask 1: Add FLUX 2 Flex Text-to-Image Model ⏱️ ~10 min

### File: `qcut/apps/web/src/lib/text2image-models.ts`

#### 1.1 Add model configuration (after line 277, following flux-pro-v11-ultra pattern)

**ADD** new model config:
```typescript
"flux-2-flex": {
  id: "flux-2-flex",
  name: "FLUX 2 Flex",
  description: "Text-to-image with adjustable inference steps, guidance scale, and enhanced typography",
  provider: "Black Forest Labs",
  endpoint: "https://fal.run/fal-ai/flux-2-flex",

  qualityRating: 4,
  speedRating: 4,

  estimatedCost: "$0.06/MP",
  costPerImage: 6, // cents per megapixel

  maxResolution: "2048x2048",
  supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

  defaultParams: {
    image_size: "landscape_4_3",
    num_images: 1,
    guidance_scale: 3.5,
    num_inference_steps: 28,
    enable_prompt_expansion: true,
    safety_tolerance: "2",
    enable_safety_checker: true,
    output_format: "jpeg",
    sync_mode: false,
  },

  availableParams: [
    {
      name: "image_size",
      type: "select",
      options: ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"],
      default: "landscape_4_3",
      description: "Output image size preset",
    },
    {
      name: "guidance_scale",
      type: "slider",
      min: 1.5,
      max: 10,
      step: 0.1,
      default: 3.5,
      description: "Controls adherence to prompt",
    },
    {
      name: "num_inference_steps",
      type: "slider",
      min: 2,
      max: 50,
      step: 1,
      default: 28,
      description: "Number of denoising steps",
    },
    {
      name: "enable_prompt_expansion",
      type: "toggle",
      default: true,
      description: "Auto-expand prompt using model knowledge",
    },
    {
      name: "output_format",
      type: "select",
      options: ["jpeg", "png"],
      default: "jpeg",
      description: "Output image format",
    },
  ],

  bestFor: [
    "Fine-tuned control over generation",
    "Typography and text rendering",
    "Professional content creation",
  ],
  strengths: [
    "Adjustable inference steps for quality/speed tradeoff",
    "Enhanced typography capabilities",
    "Cost-effective per megapixel pricing",
  ],
  limitations: [
    "Pricing scales with resolution",
    "Limited aspect ratio options",
  ],
},
```

#### 1.2 Update TEXT2IMAGE_MODEL_ORDER (line ~841)

**MODIFY** array to include new model:
```typescript
export const TEXT2IMAGE_MODEL_ORDER = [
  "gemini-3-pro",
  "nano-banana",
  "flux-2-flex",  // ADD this line
  "seeddream-v4",
  "reve-text-to-image",
  // ... rest unchanged
] as const;
```

#### 1.3 Update MODEL_CATEGORIES (line ~919)

**MODIFY** to include flux-2-flex:
```typescript
export const MODEL_CATEGORIES = {
  PHOTOREALISTIC: ["imagen4-ultra", "wan-v2-2", "gemini-3-pro"],
  ARTISTIC: ["seeddream-v3", "seeddream-v4", "qwen-image"],
  VERSATILE: ["qwen-image", "flux-pro-v11-ultra", "nano-banana", "reve-text-to-image", "flux-2-flex"],  // ADD
  FAST: ["seeddream-v3", "nano-banana", "qwen-image", "reve-text-to-image", "flux-2-flex"],  // ADD
  HIGH_QUALITY: ["imagen4-ultra", "wan-v2-2", "flux-pro-v11-ultra", "seeddream-v4", "gemini-3-pro", "flux-2-flex"],  // ADD
  COST_EFFECTIVE: ["seeddream-v3", "nano-banana", "qwen-image", "reve-text-to-image", "flux-2-flex"],  // ADD
};
```

### File: `qcut/apps/web/src/lib/fal-ai-client.ts`

#### 1.4 Add parameter conversion case (after line 494, following flux-pro-v11-ultra)

**ADD** in `convertSettingsToParams` switch statement:
```typescript
case "flux-2-flex":
  // FLUX 2 Flex uses image_size enum directly (not aspect_ratio)
  // Settings are passed through defaultParams
  // No special conversion needed - image_size is already in correct format
  break;
```

---

## Subtask 2: Add FLUX 2 Flex Edit Model ⏱️ ~10 min

### File: `qcut/apps/web/src/lib/image-edit-client.ts`

#### 2.1 Add to ImageEditRequest type union (line ~24)

**MODIFY** model type:
```typescript
export interface ImageEditRequest {
  imageUrl: string;
  prompt: string;
  model:
    | "seededit"
    | "flux-kontext"
    | "flux-kontext-max"
    | "flux-2-flex-edit"  // ADD this line
    | "seeddream-v4"
    | "nano-banana"
    | "reve-edit"
    | "gemini-3-pro-edit";
```

#### 2.2 Add endpoint configuration (after line 99, following flux-kontext-max)

**ADD** new endpoint config:
```typescript
"flux-2-flex-edit": {
  endpoint: "fal-ai/flux-2-flex/edit",
  defaultParams: {
    guidance_scale: 3.5,
    num_inference_steps: 28,
    safety_tolerance: 2,
    enable_prompt_expansion: true,
    num_images: 1,
    output_format: "jpeg",
    sync_mode: false,
  },
},
```

#### 2.3 Update image_urls handling condition (line ~251)

**MODIFY** the condition to include flux-2-flex-edit:
```typescript
if (
  request.model === "seeddream-v4" ||
  request.model === "nano-banana" ||
  request.model === "gemini-3-pro-edit" ||
  request.model === "flux-2-flex-edit"  // ADD this condition
) {
  // These models use image_urls array format
  payload.image_urls = [request.imageUrl];
}
```

#### 2.4 Add model info to getImageEditModels() (after flux-kontext-max, line ~1007)

**ADD** new model info:
```typescript
{
  id: "flux-2-flex-edit",
  name: "FLUX 2 Flex Edit",
  description: "Flexible image editing with adjustable parameters and enhanced control",
  provider: "Black Forest Labs",
  estimatedCost: "$0.06/MP",
  features: [
    "Auto image size detection",
    "Adjustable inference steps",
    "Prompt expansion",
    "Fine-tuned guidance control",
  ],
  parameters: {
    guidanceScale: { min: 1.5, max: 10, default: 3.5, step: 0.1 },
    steps: { min: 2, max: 50, default: 28, step: 1 },
    safetyTolerance: { min: 1, max: 5, default: 2, step: 1 },
    numImages: { min: 1, max: 4, default: 1, step: 1 },
    outputFormat: {
      type: "select",
      options: ["jpeg", "png"],
      default: "jpeg",
    },
    enablePromptExpansion: { type: "boolean", default: true },
  },
},
```

### File: `qcut/apps/web/src/lib/model-utils.ts`

#### 2.5 Add capability definition (after line 79, following flux-kontext-max)

**ADD** case in getModelCapabilities:
```typescript
case "flux-2-flex-edit":
  return {
    multiImage: false,
    flexibleSizing: true,
    enhancedPrompts: true,
    outputFormats: ["JPEG", "PNG"],
    maxImages: 1,
    sizeOptions: ["auto", "square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"],
  };
```

#### 2.6 Add to model categories (line ~177)

**MODIFY** modelCategories:
```typescript
export const modelCategories = {
  stable: ["seededit", "seeddream-v3", "flux-kontext", "flux-2-flex-edit"],  // ADD
  advanced: ["seeddream-v4", "flux-kontext-max"],
  smart: ["nano-banana"],
  cost_effective: ["nano-banana", "seeddream-v3", "flux-2-flex-edit"],  // ADD
  high_quality: ["seeddream-v4", "flux-kontext-max"],
};
```

#### 2.7 Add display information (after line 269, following flux-kontext-max)

**ADD** case in getModelDisplayInfo:
```typescript
case "flux-2-flex-edit":
  return {
    name: "FLUX 2 Flex Edit",
    description: "Flexible editing with fine control",
    badge: "Versatile",
    technology: "FLUX 2",
    features: ["Auto sizing", "Prompt expansion", "Adjustable steps"],
  };
```

---

## Implementation Status

- [ ] Subtask 1: FLUX 2 Flex Text-to-Image
  - [ ] 1.1 Add model configuration
  - [ ] 1.2 Update TEXT2IMAGE_MODEL_ORDER
  - [ ] 1.3 Update MODEL_CATEGORIES
  - [ ] 1.4 Add parameter conversion case
- [ ] Subtask 2: FLUX 2 Flex Edit
  - [ ] 2.1 Add to ImageEditRequest type
  - [ ] 2.2 Add endpoint configuration
  - [ ] 2.3 Update image_urls handling
  - [ ] 2.4 Add model info
  - [ ] 2.5 Add capability definition
  - [ ] 2.6 Add to model categories
  - [ ] 2.7 Add display information

---

## Estimated Total Time: ~20 minutes

Both subtasks are under 20 minutes individually, no further breakdown needed.
