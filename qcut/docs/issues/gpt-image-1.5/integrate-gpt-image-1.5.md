# GPT Image 1.5 Integration Plan

## Overview

Integrate OpenAI's GPT Image 1.5 model via FAL.ai:
- **Text-to-Image Panel**: Generate images from text prompts (`fal-ai/gpt-image-1.5`)
- **Adjustments Panel**: Edit/modify existing images with prompts (`fal-ai/gpt-image-1.5/edit`)

## Design Principles

1. **Long-term Maintainability**: Follow existing patterns, use centralized configurations
2. **Code Reuse**: Leverage existing FAL request utilities, upload functions, and UI components
3. **Type Safety**: Extend existing type definitions rather than creating duplicates

## Review (Maintainability & Reuse)

### What's strong

- Extending existing type/config files (instead of creating parallel "GPT Image" copies) is the right direction for long-term maintenance.
- Reusing the existing FAL upload + queue/polling infrastructure keeps the integration small and predictable.
- Separating "capabilities" (max images, multi-image support) from "endpoint config" fits how this codebase already evolves model support.

### Risks & recommendations

- **Single source of truth**: avoid repeating model IDs, endpoints, defaults, and UI option arrays across multiple files. Prefer a single model registry (id -> endpoint + defaults + UI labels) that `capabilities`, `client`, and `generators` consume.
- **Naming consistency**: choose one internal ID style (e.g. `gpt-image-1-5` / `gpt-image-1-5-edit`) and keep the dotted version (`gpt-image-1.5`) only in the FAL endpoint string to prevent drift.
- **Reuse generator plumbing**: implement GPT Image 1.5 as a thin config wrapper around the existing image generator/edit helpers (request -> poll -> normalize result), rather than adding a bespoke request path.
- **Docs vs types alignment**: keep the API table and the TypeScript params in lockstep (e.g. if `sync_mode` is supported, document it; if not, don't type it).
- **Doc completeness**: subtasks currently jump from 3 -> 7; either renumber or add the missing generator/UI subtasks so a future maintainer can follow the sequence without context switching.

### Resolution

After code review, the plan has been revised to address these concerns:

1. **Single source of truth**:
   - T2I model → Add to `text2image-models.ts` (existing unified registry)
   - Edit model → Add to `image-edit-client.ts` `MODEL_ENDPOINTS` only (existing pattern)
   - **Removed**: Duplicate constants from `ai-constants.ts`

2. **Naming consistency**: Use `gpt-image-1-5` / `gpt-image-1-5-edit` internally; FAL endpoint keeps original `gpt-image-1.5`

3. **Reuse generator plumbing**:
   - T2I: Uses existing generic FAL request flow (no custom generator)
   - Edit: Uses existing `editImage()` function via `MODEL_ENDPOINTS` (no custom generator)
   - **Removed**: Custom `generateGptImage15()` function

4. **Docs/types alignment**: Added `sync_mode` to API tables

5. **Subtask numbering**: Verified sequential 1-6 (reduced from 8 after removing unnecessary tasks)

---

## API Reference

### Text-to-Image Endpoint
```
POST https://fal.run/fal-ai/gpt-image-1.5
```

| Parameter | Type | Required | Default | Options |
|-----------|------|----------|---------|---------|
| `prompt` | string | Yes | - | - |
| `image_size` | enum | No | `1024x1024` | `1024x1024`, `1536x1024`, `1024x1536` |
| `background` | enum | No | `auto` | `auto`, `transparent`, `opaque` |
| `quality` | enum | No | `high` | `low`, `medium`, `high` |
| `num_images` | integer | No | `1` | 1-4 |
| `output_format` | enum | No | `png` | `jpeg`, `png`, `webp` |
| `sync_mode` | boolean | No | `false` | Return as data URI |

### Image Edit Endpoint
```
POST https://fal.run/fal-ai/gpt-image-1.5/edit
```

| Parameter | Type | Required | Default | Options |
|-----------|------|----------|---------|---------|
| `prompt` | string | Yes | - | - |
| `image_urls` | array[string] | Yes | - | - |
| `image_size` | enum | No | `auto` | `auto`, `1024x1024`, `1536x1024`, `1024x1536` |
| `background` | enum | No | `auto` | `auto`, `transparent`, `opaque` |
| `quality` | enum | No | `high` | `low`, `medium`, `high` |
| `input_fidelity` | enum | No | `high` | `low`, `high` |
| `num_images` | integer | No | `1` | 1-4 |
| `output_format` | enum | No | `png` | `jpeg`, `png`, `webp` |
| `sync_mode` | boolean | No | `false` | Return as data URI |

---

## Implementation Subtasks

### Subtask 1: Add Text-to-Image Model to Registry (Single Source of Truth) - DONE

**File**: `apps/web/src/lib/text2image-models.ts`

**Status**: Implemented

**Action**: ADD to `TEXT2IMAGE_MODELS` object (after `gemini-3-pro`, around line 1205)

```typescript
"gpt-image-1-5": {
  id: "gpt-image-1-5",
  name: "GPT Image 1.5",
  description:
    "OpenAI's GPT Image 1.5 for high-fidelity image generation with strong prompt adherence",
  provider: "OpenAI",
  endpoint: "https://fal.run/fal-ai/gpt-image-1.5",

  qualityRating: 5,
  speedRating: 4,

  estimatedCost: "$0.04-0.08",
  costPerImage: 4, // cents

  maxResolution: "1536x1536",
  supportedAspectRatios: ["1:1", "3:2", "2:3"],

  defaultParams: {
    image_size: "1024x1024",
    background: "auto",
    quality: "high",
    num_images: 1,
    output_format: "png",
    sync_mode: false,
  },

  availableParams: [
    {
      name: "image_size",
      type: "select",
      options: ["1024x1024", "1536x1024", "1024x1536"],
      default: "1024x1024",
      description: "Output image resolution",
    },
    {
      name: "background",
      type: "select",
      options: ["auto", "transparent", "opaque"],
      default: "auto",
      description: "Background type (transparent for compositing)",
    },
    {
      name: "quality",
      type: "select",
      options: ["low", "medium", "high"],
      default: "high",
      description: "Output quality level",
    },
    {
      name: "num_images",
      type: "number",
      min: 1,
      max: 4,
      default: 1,
      description: "Number of images to generate",
    },
    {
      name: "output_format",
      type: "select",
      options: ["jpeg", "png", "webp"],
      default: "png",
      description: "Output image format",
    },
  ],

  bestFor: [
    "High-fidelity image generation",
    "Strong prompt adherence",
    "Transparent backgrounds for compositing",
    "Commercial content creation",
  ],

  strengths: [
    "Excellent prompt adherence",
    "Transparent background support",
    "Multiple output formats (png, jpeg, webp)",
    "Consistent quality across styles",
  ],

  limitations: [
    "Limited resolution options (3 sizes)",
    "No guidance scale control",
    "No seed for reproducibility",
  ],
},
```

**Action**: ADD to `TEXT2IMAGE_MODEL_ORDER` array (around line 1211)

```typescript
export const TEXT2IMAGE_MODEL_ORDER = [
  "gemini-3-pro",
  "gpt-image-1-5",  // ADD this line
  "nano-banana",
  // ... rest of existing models
] as const;
```

**Action**: ADD to `MODEL_CATEGORIES` (around line 1292)

```typescript
export const MODEL_CATEGORIES = {
  PHOTOREALISTIC: ["imagen4-ultra", "wan-v2-2", "gemini-3-pro", "gpt-image-1-5"],  // ADD
  // ... existing categories
  HIGH_QUALITY: [
    "imagen4-ultra",
    "wan-v2-2",
    "flux-pro-v11-ultra",
    "flux-2-flex",
    "seeddream-v4",
    "seeddream-v4-5",
    "gemini-3-pro",
    "gpt-image-1-5",  // ADD
  ],
  // ...
} as const;
```

---

### Subtask 2: Add Image Edit Model Capabilities - DONE

**File**: `apps/web/src/lib/image-edit-capabilities.ts`

**Status**: Implemented

**Action**: MODIFY `IMAGE_EDIT_MODEL_IDS` array (line 12-22)

```typescript
export const IMAGE_EDIT_MODEL_IDS = [
  "seededit",
  "flux-kontext",
  "flux-kontext-max",
  "flux-2-flex-edit",
  "seeddream-v4",
  "seeddream-v4-5-edit",
  "nano-banana",
  "reve-edit",
  "gemini-3-pro-edit",
  "gpt-image-1-5-edit",  // ADD this line
] as const;
```

**Action**: MODIFY `MODEL_CAPABILITIES` object (line 41-54)

```typescript
export const MODEL_CAPABILITIES: Record<ImageEditModelId, ModelCapability> = {
  // Multi-image models
  "seeddream-v4-5-edit": { maxImages: 10, supportsMultiple: true },
  "seeddream-v4": { maxImages: 6, supportsMultiple: true },
  "nano-banana": { maxImages: 4, supportsMultiple: true },
  "gemini-3-pro-edit": { maxImages: 4, supportsMultiple: true },
  "flux-2-flex-edit": { maxImages: 4, supportsMultiple: true },
  "gpt-image-1-5-edit": { maxImages: 4, supportsMultiple: true },  // ADD this line

  // Single-image models
  "seededit": { maxImages: 1, supportsMultiple: false },
  "flux-kontext": { maxImages: 1, supportsMultiple: false },
  "flux-kontext-max": { maxImages: 1, supportsMultiple: false },
  "reve-edit": { maxImages: 1, supportsMultiple: false },
};
```

---

### Subtask 3: Add Image Edit Model Endpoint and Config - DONE

**File**: `apps/web/src/lib/image-edit-client.ts`

**Status**: Implemented

**Action**: ADD to `MODEL_ENDPOINTS` (after `gemini-3-pro-edit`, around line 168)

```typescript
"gpt-image-1-5-edit": {
  endpoint: "fal-ai/gpt-image-1.5/edit",
  defaultParams: {
    image_size: "auto",
    background: "auto",
    quality: "high",
    input_fidelity: "high",
    num_images: 1,
    output_format: "png",
    sync_mode: false,
  },
},
```

**Action**: ADD to `ImageEditRequest` interface (around line 31)

```typescript
export interface ImageEditRequest {
  // ... existing properties ...

  // GPT Image 1.5 Edit specific parameters
  background?: "auto" | "transparent" | "opaque";
  inputFidelity?: "low" | "high";
  quality?: "low" | "medium" | "high";
}
```

**Action**: ADD to `getImageEditModels()` return array (around line 933)

```typescript
{
  id: "gpt-image-1-5-edit",
  name: "GPT Image 1.5 Edit",
  description: "OpenAI's GPT Image 1.5 for high-fidelity image editing with strong prompt adherence",
  provider: "OpenAI",
  estimatedCost: "$0.04-0.08",
  features: [
    "High prompt adherence",
    "Transparent background support",
    "Input fidelity control",
    "Multiple output formats",
  ],
  parameters: {
    imageSize: {
      type: "select",
      options: ["auto", "1024x1024", "1536x1024", "1024x1536"],
      default: "auto",
    },
    background: {
      type: "select",
      options: ["auto", "transparent", "opaque"],
      default: "auto",
    },
    quality: {
      type: "select",
      options: ["low", "medium", "high"],
      default: "high",
    },
    inputFidelity: {
      type: "select",
      options: ["low", "high"],
      default: "high",
    },
    numImages: { min: 1, max: 4, default: 1, step: 1 },
    outputFormat: {
      type: "select",
      options: ["jpeg", "png", "webp"],
      default: "png",
    },
    syncMode: { type: "boolean", default: false },
  },
},
```

---

### Subtask 4: Handle GPT Image 1.5 Edit Parameters in editImage() - DONE

**File**: `apps/web/src/lib/image-edit-client.ts`

**Status**: Implemented

**Action**: ADD parameter handling in `editImage()` function (around line 368-394)

```typescript
// Add GPT Image 1.5 Edit specific parameters
if (request.model === "gpt-image-1-5-edit") {
  if (request.background !== undefined) {
    payload.background = request.background;
  }
  if (request.inputFidelity !== undefined) {
    payload.input_fidelity = request.inputFidelity;
  }
  if (request.quality !== undefined) {
    payload.quality = request.quality;
  }
}
```

---

### Subtask 5: Update Adjustment Panel Parameter Controls - DONE

**File**: `apps/web/src/components/editor/adjustment/parameter-controls.tsx`

**Status**: Implemented - Added GPT Image 1.5 Edit specific controls block

**Action**: VERIFY existing controls support the new parameters

The existing `ParameterControls` component should dynamically render controls based on `getImageEditModels()` parameters. Verify:

1. `imageSize` select control renders for GPT Image 1.5 Edit
2. `background` select control renders (new parameter)
3. `quality` select control renders (new parameter)
4. `inputFidelity` select control renders (new parameter)

If the component uses static parameter mapping, add handling for:
- `background` → select dropdown
- `quality` → select dropdown
- `inputFidelity` → select dropdown

---

### Subtask 6: Update Adjustment Store Default Parameters

**File**: `apps/web/src/stores/adjustment-store.ts`

**Action**: VERIFY/ADD default parameter handling

The store should already support new models via `getModelCapabilities()`. Verify the `parameters` state includes defaults for:

```typescript
parameters: {
  // ... existing params ...
  background: "auto",
  quality: "high",
  inputFidelity: "high",
}
```

If not present, add to the initial state and reset functions.

---

## Testing Checklist

### Text-to-Image (via text2image-models.ts)
- [ ] Model appears in T2I model selector dropdown
- [ ] Generation works with all `image_size` options (1024x1024, 1536x1024, 1024x1536)
- [ ] Background options (auto, transparent, opaque) work correctly
- [ ] Transparent background produces PNG with alpha channel
- [ ] Quality levels (low, medium, high) produce expected results
- [ ] Multiple image generation (1-4) works
- [ ] Output format options (png, jpeg, webp) work

### Image Edit (via image-edit-client.ts)
- [ ] Model appears in Adjustment panel model selector
- [ ] Edit with single input image works
- [ ] Edit with multiple input images (up to 4) works
- [ ] `image_size: "auto"` preserves input dimensions
- [ ] Input fidelity (low/high) affects output appropriately
- [ ] Background and quality parameters apply correctly
- [ ] Progress callbacks update UI correctly
- [ ] Error handling displays user-friendly messages

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `text2image-models.ts` | ADD | T2I model config (single source of truth) |
| `image-edit-capabilities.ts` | MODIFY | Add edit model to capability registry |
| `image-edit-client.ts` | MODIFY | Add edit endpoint, interface, model info |
| `parameter-controls.tsx` | VERIFY | Ensure UI renders new parameters |
| `adjustment-store.ts` | VERIFY | Ensure defaults include new params |

**Files NOT modified** (avoiding duplication):
- `ai-constants.ts` - Not needed; T2I config lives in `text2image-models.ts`
- `generators/image.ts` - Not needed; uses existing FAL request flow
- `ai-types.ts` - Not needed; types inferred from model config

---

## Notes

- **Single source of truth**: T2I model defined in `text2image-models.ts`, Edit model in `image-edit-client.ts`
- **No custom generator**: Both T2I and Edit use existing FAL request/polling infrastructure
- **Naming convention**: Internal ID uses hyphens (`gpt-image-1-5`), FAL endpoint uses dots (`gpt-image-1.5`)
- **Queue-based processing**: Handled by existing polling infrastructure
- **Images hosted**: FAL CDN (`v3b.fal.media`)
- **Transparent background**: Useful for compositing in video editor timeline
- **Edit image upload**: Reuses existing `uploadImageToFAL()` function
- **API key**: Uses existing `VITE_FAL_API_KEY` environment variable
