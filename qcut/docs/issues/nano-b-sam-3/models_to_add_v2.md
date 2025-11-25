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

# Architecture Review

## Existing Patterns (must follow for long-term maintainability)

### Text-to-Image Models (`text2image-models.ts`)
- Model configs use `TEXT2IMAGE_MODELS` object keyed by model ID
- Model order defined in `TEXT2IMAGE_MODEL_ORDER` array (affects UI display order)
- Categories in `MODEL_CATEGORIES` object for filtering/grouping
- Pattern: FLUX Pro v1.1 Ultra uses `aspect_ratio` param (not `image_size`)
- Pattern: WAN v2.2 uses `image_size` param directly

### FAL Client (`fal-ai-client.ts`)
- `convertSettingsToParams()` switch handles model-specific parameter conversion
- Pattern: Models using `image_size` enum directly need no conversion (e.g., WAN v2.2)
- Pattern: Models using `aspect_ratio` need conversion from `settings.imageSize` (e.g., FLUX Pro)

### Image Edit Client (`image-edit-client.ts`)
- `ImageEditRequest` interface defines model union type
- `MODEL_ENDPOINTS` object maps model IDs to endpoints + defaultParams
- Image URL handling: models using `image_urls` array vs `image_url` string
- `getImageEditModels()` returns UI model list for selection

### Model Utils (`model-utils.ts`)
- `getModelCapabilities()` switch returns capability objects
- `modelCategories` object for grouping
- `getModelDisplayInfo()` switch returns display metadata
- `convertParametersBetweenModels()` for parameter conversion when switching models
- `validateModelParameters()` for model-specific validation

---

# Implementation Subtasks

## Subtask 1: Add FLUX 2 Flex Text-to-Image Model ⏱️ ~10 min

### File: `qcut/apps/web/src/lib/text2image-models.ts`

#### 1.1 Add model configuration (line ~278, after flux-pro-v11-ultra)

**ADD** to `TEXT2IMAGE_MODELS` object:
```typescript
  "flux-2-flex": {
    id: "flux-2-flex",
    name: "FLUX 2 Flex",
    description:
      "Text-to-image with adjustable inference steps, guidance scale, and enhanced typography",
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
        options: [
          "square_hd",
          "square",
          "portrait_4_3",
          "portrait_16_9",
          "landscape_4_3",
          "landscape_16_9",
        ],
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
        type: "boolean",
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
      "Limited aspect ratio options vs FLUX Pro Ultra",
    ],
  },
```

#### 1.2 Update TEXT2IMAGE_MODEL_ORDER (line ~841)

**MODIFY** to add after nano-banana:
```typescript
export const TEXT2IMAGE_MODEL_ORDER = [
  "gemini-3-pro",
  "nano-banana",
  "flux-2-flex",  // ADD
  "seeddream-v4",
  "reve-text-to-image",
  "wan-v2-2",
  "imagen4-ultra",
  "qwen-image",
  "flux-pro-v11-ultra",
  "seeddream-v3",
] as const;
```

#### 1.3 Update MODEL_CATEGORIES (line ~919)

**MODIFY** to include flux-2-flex in appropriate categories:
```typescript
export const MODEL_CATEGORIES = {
  PHOTOREALISTIC: ["imagen4-ultra", "wan-v2-2", "gemini-3-pro"],
  ARTISTIC: ["seeddream-v3", "seeddream-v4", "qwen-image"],
  VERSATILE: [
    "qwen-image",
    "flux-pro-v11-ultra",
    "flux-2-flex",  // ADD
    "nano-banana",
    "reve-text-to-image",
  ],
  FAST: ["seeddream-v3", "nano-banana", "qwen-image", "reve-text-to-image", "flux-2-flex"],  // ADD
  HIGH_QUALITY: [
    "imagen4-ultra",
    "wan-v2-2",
    "flux-pro-v11-ultra",
    "flux-2-flex",  // ADD
    "seeddream-v4",
    "gemini-3-pro",
  ],
  COST_EFFECTIVE: [
    "seeddream-v3",
    "nano-banana",
    "qwen-image",
    "reve-text-to-image",
    "flux-2-flex",  // ADD
  ],
} as const;
```

### File: `qcut/apps/web/src/lib/fal-ai-client.ts`

#### 1.4 Add parameter conversion case (line ~465, after wan-v2-2)

**ADD** in `convertSettingsToParams` switch statement:
```typescript
      case "flux-2-flex":
        // FLUX 2 Flex uses image_size enum directly (like WAN v2.2)
        params.image_size = settings.imageSize;
        break;
```

**Rationale**: Unlike FLUX Pro Ultra which uses `aspect_ratio`, FLUX 2 Flex API accepts `image_size` enum directly (same pattern as WAN v2.2).

---

## Subtask 2: Add FLUX 2 Flex Edit Model ⏱️ ~10 min

### File: `qcut/apps/web/src/lib/image-edit-client.ts`

#### 2.1 Add to ImageEditRequest model union (line ~24)

**MODIFY** type union:
```typescript
export interface ImageEditRequest {
  imageUrl: string;
  prompt: string;
  model:
    | "seededit"
    | "flux-kontext"
    | "flux-kontext-max"
    | "flux-2-flex-edit"  // ADD
    | "seeddream-v4"
    | "nano-banana"
    | "reve-edit"
    | "gemini-3-pro-edit";
```

#### 2.2 Add endpoint configuration (line ~143, after gemini-3-pro-edit)

**ADD** new endpoint config:
```typescript
  // Add FLUX 2 Flex Edit endpoint
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

**MODIFY** to include flux-2-flex-edit (uses image_urls array like V4/Nano Banana):
```typescript
  // Handle image URL(s) based on model
  if (
    request.model === "seeddream-v4" ||
    request.model === "nano-banana" ||
    request.model === "gemini-3-pro-edit" ||
    request.model === "flux-2-flex-edit"  // ADD
  ) {
    // V4, Nano Banana, Gemini 3 Pro Edit, and FLUX 2 Flex Edit use image_urls array
    payload.image_urls = [request.imageUrl];
  } else {
```

#### 2.4 Add model info to getImageEditModels() (after flux-kontext-max entry)

**ADD** new model info object in the return array:
```typescript
    {
      id: "flux-2-flex-edit",
      name: "FLUX 2 Flex Edit",
      description:
        "Flexible image editing with adjustable parameters and enhanced control",
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

#### 2.5 Add capability definition (line ~79, after flux-kontext-max case)

**ADD** case in `getModelCapabilities` switch:
```typescript
    case "flux-2-flex-edit":
      return {
        multiImage: false,
        flexibleSizing: true,
        enhancedPrompts: true,
        outputFormats: ["JPEG", "PNG"],
        maxImages: 1,
        sizeOptions: [
          "auto",
          "square_hd",
          "square",
          "portrait_4_3",
          "portrait_16_9",
          "landscape_4_3",
          "landscape_16_9",
        ],
      };
```

#### 2.6 Add to modelCategories (line ~176)

**MODIFY** modelCategories object:
```typescript
export const modelCategories = {
  stable: ["seededit", "seeddream-v3", "flux-kontext", "flux-2-flex-edit"],  // ADD
  advanced: ["seeddream-v4", "flux-kontext-max"],
  smart: ["nano-banana"],
  cost_effective: ["nano-banana", "seeddream-v3", "flux-2-flex-edit"],  // ADD
  high_quality: ["seeddream-v4", "flux-kontext-max"],
};
```

#### 2.7 Add display information (line ~269, after flux-kontext-max case)

**ADD** case in `getModelDisplayInfo` switch:
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

#### 2.8 Add parameter conversion support (line ~151, after seeddream-v4 case)

**ADD** case in `convertParametersBetweenModels`:
```typescript
  if (toModel === "flux-2-flex-edit") {
    return {
      ...baseParams,
      outputFormat:
        params.outputFormat === "JPEG" || params.outputFormat === "PNG"
          ? params.outputFormat
          : "JPEG",
      syncMode: false,
      image_urls: params.image_urls || [],
      guidanceScale: params.guidanceScale || params.guidance_scale || 3.5,
      steps: params.steps || params.num_inference_steps || 28,
    };
  }
```

#### 2.9 Add parameter validation (line ~344, after nano-banana validation)

**ADD** validation case in `validateModelParameters`:
```typescript
  if (modelId === "flux-2-flex-edit") {
    if (params.outputFormat && !["JPEG", "PNG"].includes(params.outputFormat)) {
      errors.push("Output format must be JPEG or PNG for FLUX 2 Flex Edit");
    }
    if (params.numImages && (params.numImages < 1 || params.numImages > 4)) {
      errors.push("Number of images must be between 1-4 for FLUX 2 Flex Edit");
    }
  }
```

---

## Implementation Status

- [ ] Subtask 1: FLUX 2 Flex Text-to-Image
  - [ ] 1.1 Add model configuration to TEXT2IMAGE_MODELS
  - [ ] 1.2 Update TEXT2IMAGE_MODEL_ORDER
  - [ ] 1.3 Update MODEL_CATEGORIES
  - [ ] 1.4 Add parameter conversion case in fal-ai-client.ts
- [ ] Subtask 2: FLUX 2 Flex Edit
  - [ ] 2.1 Add to ImageEditRequest type union
  - [ ] 2.2 Add endpoint configuration
  - [ ] 2.3 Update image_urls handling condition
  - [ ] 2.4 Add model info to getImageEditModels()
  - [ ] 2.5 Add capability definition in model-utils.ts
  - [ ] 2.6 Add to modelCategories
  - [ ] 2.7 Add display information
  - [ ] 2.8 Add parameter conversion support
  - [ ] 2.9 Add parameter validation

---

## Design Decisions (Long-term Maintainability)

1. **Parameter conversion pattern**: FLUX 2 Flex uses `image_size` enum directly (like WAN v2.2), not `aspect_ratio` conversion (like FLUX Pro Ultra). This follows the existing pattern for models that accept FAL's standard image_size presets.

2. **Image URL format**: FLUX 2 Flex Edit uses `image_urls` array format (like V4/Nano Banana/Gemini), consistent with newer FAL model APIs.

3. **Model naming**: Using `flux-2-flex` and `flux-2-flex-edit` to distinguish from existing `flux-pro-v11-ultra` and `flux-kontext` families.

4. **Category placement**: Added to VERSATILE, FAST, HIGH_QUALITY, and COST_EFFECTIVE categories based on API characteristics (adjustable steps, decent quality, megapixel pricing).

5. **Capability flags**: `flexibleSizing: true` and `enhancedPrompts: true` for edit model since it supports `auto` sizing and `enable_prompt_expansion`.

---

## Estimated Total Time: ~20 minutes

Both subtasks are under 20 minutes individually, no further breakdown needed.
