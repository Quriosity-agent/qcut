# GPT Image 1.5 Integration Plan

## Overview

Integrate OpenAI's GPT Image 1.5 model via FAL.ai:
- **Text-to-Image Panel**: Generate images from text prompts (`fal-ai/gpt-image-1.5`)
- **Adjustments Panel**: Edit/modify existing images with prompts (`fal-ai/gpt-image-1.5/edit`)

## Design Principles

1. **Long-term Maintainability**: Follow existing patterns, use centralized configurations
2. **Code Reuse**: Leverage existing FAL request utilities, upload functions, and UI components
3. **Type Safety**: Extend existing type definitions rather than creating duplicates

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

---

## Implementation Subtasks

### Subtask 1: Add Type Definitions

**File**: `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`

**Action**: ADD to existing types

```typescript
// Add after existing Seeddream45 types (around line 467)

// ============================================
// GPT Image 1.5 Types
// ============================================

/**
 * GPT Image 1.5 image size options
 */
export type GptImage15ImageSize = "1024x1024" | "1536x1024" | "1024x1536";

/**
 * GPT Image 1.5 background options
 */
export type GptImage15Background = "auto" | "transparent" | "opaque";

/**
 * GPT Image 1.5 quality options
 */
export type GptImage15Quality = "low" | "medium" | "high";

/**
 * GPT Image 1.5 input fidelity for edit mode
 */
export type GptImage15InputFidelity = "low" | "high";

/**
 * Parameters for GPT Image 1.5 text-to-image generation
 */
export interface GptImage15TextToImageParams {
  prompt: string;
  image_size?: GptImage15ImageSize;
  background?: GptImage15Background;
  quality?: GptImage15Quality;
  num_images?: number;
  output_format?: "jpeg" | "png" | "webp";
  sync_mode?: boolean;
}

/**
 * Parameters for GPT Image 1.5 image editing
 */
export interface GptImage15EditParams {
  prompt: string;
  image_urls: string[];
  image_size?: GptImage15ImageSize | "auto";
  background?: GptImage15Background;
  quality?: GptImage15Quality;
  input_fidelity?: GptImage15InputFidelity;
  num_images?: number;
  output_format?: "jpeg" | "png" | "webp";
  sync_mode?: boolean;
}
```

---

### Subtask 2: Add Image Edit Model Capabilities

**File**: `apps/web/src/lib/image-edit-capabilities.ts`

**Action**: MODIFY existing constants

```typescript
// Line 12-22: Add to IMAGE_EDIT_MODEL_IDS array
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

// Line 41-54: Add to MODEL_CAPABILITIES
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

### Subtask 3: Add Image Edit Model Endpoint

**File**: `apps/web/src/lib/image-edit-client.ts`

**Action**: MODIFY MODEL_ENDPOINTS (add after line 168)

```typescript
// Add GPT Image 1.5 Edit endpoint (after gemini-3-pro-edit)
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

**Action**: MODIFY getImageEditModels() function (add to array around line 933)

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

### Subtask 4: Add Text-to-Image Generator

**File**: `apps/web/src/lib/ai-video/generators/image.ts`

**Action**: ADD new functions (after existing Seeddream45 functions)

```typescript
// ============================================
// GPT Image 1.5 Text-to-Image
// ============================================

import type {
  GptImage15TextToImageParams,
} from "@/components/editor/media-panel/views/ai/types/ai-types";

/**
 * GPT Image 1.5 image generation result
 */
export interface GptImage15ImageResult {
  images: Array<{
    url: string;
    height: number;
    width: number;
    file_name: string;
    content_type: string;
    file_size?: number;
  }>;
}

/**
 * Generate images using GPT Image 1.5 text-to-image model
 *
 * @example
 * ```typescript
 * const result = await generateGptImage15({
 *   prompt: "A futuristic cityscape at sunset",
 *   image_size: "1536x1024",
 *   quality: "high",
 * });
 * ```
 */
export async function generateGptImage15(
  params: GptImage15TextToImageParams
): Promise<GptImage15ImageResult> {
  try {
    const apiKey = getFalApiKey();
    if (!apiKey) {
      throw new Error("FAL API key not configured");
    }

    const endpoint = "fal-ai/gpt-image-1.5";

    const input = {
      prompt: params.prompt,
      image_size: params.image_size ?? "1024x1024",
      background: params.background ?? "auto",
      quality: params.quality ?? "high",
      num_images: params.num_images ?? 1,
      output_format: params.output_format ?? "png",
      sync_mode: params.sync_mode ?? false,
    };

    console.log("🎨 [GPT Image 1.5] Starting text-to-image generation...");
    console.log(`📝 Prompt: ${params.prompt.slice(0, 50)}...`);

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `GPT Image 1.5 generation failed: ${response.status} - ${errorText}`
      );
    }

    const result = await response.json();
    console.log(
      `✅ [GPT Image 1.5] Generation complete: ${result.images?.length || 0} images`
    );

    return result;
  } catch (error) {
    handleAIServiceError(error, "Generate GPT Image 1.5 image", {
      operation: "generateGptImage15",
      prompt: params.prompt.slice(0, 100),
    });
    throw error;
  }
}
```

---

### Subtask 5: Handle Edit-Specific Parameters in image-edit-client

**File**: `apps/web/src/lib/image-edit-client.ts`

**Action**: MODIFY editImage function to handle GPT Image 1.5 specific params

Add to the parameter handling section in editImage() (around line 368-394):

```typescript
// Add GPT Image 1.5 Edit specific parameters
if (request.model === "gpt-image-1-5-edit") {
  // Handle background parameter
  if (request.background !== undefined) {
    payload.background = request.background;
  }
  // Handle input_fidelity parameter (GPT Image 1.5 Edit specific)
  if (request.inputFidelity !== undefined) {
    payload.input_fidelity = request.inputFidelity;
  }
}
```

Also update the ImageEditRequest interface (around line 31):

```typescript
export interface ImageEditRequest {
  // ... existing properties ...

  // GPT Image 1.5 Edit specific parameters
  background?: "auto" | "transparent" | "opaque";
  inputFidelity?: "low" | "high";
}
```

---

### Subtask 6: Add Constants for UI Controls

**File**: `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

**Action**: ADD configuration constants (add after REVE_EDIT_MODEL around line 1567)

```typescript
// ============================================
// GPT Image 1.5 Model Constants
// ============================================

/**
 * GPT Image 1.5 Text-to-Image Model Configuration
 */
export const GPT_IMAGE_1_5_T2I_MODEL = {
  endpoint: "fal-ai/gpt-image-1.5",
  pricing: {
    perImage: 0.04, // Estimated $0.04 per image
  },
  imageSizes: [
    { value: "1024x1024", label: "1024×1024 (Square)" },
    { value: "1536x1024", label: "1536×1024 (Landscape 3:2)" },
    { value: "1024x1536", label: "1024×1536 (Portrait 2:3)" },
  ],
  defaultImageSize: "1024x1024" as const,
  backgrounds: [
    { value: "auto", label: "Auto" },
    { value: "transparent", label: "Transparent" },
    { value: "opaque", label: "Opaque" },
  ],
  defaultBackground: "auto" as const,
  qualities: [
    { value: "low", label: "Low (Faster)" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High (Best)" },
  ],
  defaultQuality: "high" as const,
  outputFormats: ["png", "jpeg", "webp"] as const,
  defaultOutputFormat: "png" as const,
  numImagesRange: { min: 1, max: 4 },
  defaultNumImages: 1,
} as const;

/**
 * GPT Image 1.5 Edit Model Configuration
 */
export const GPT_IMAGE_1_5_EDIT_MODEL = {
  endpoint: "fal-ai/gpt-image-1.5/edit",
  pricing: {
    perImage: 0.04, // Estimated $0.04 per edit
  },
  imageSizes: [
    { value: "auto", label: "Auto (Match Input)" },
    { value: "1024x1024", label: "1024×1024 (Square)" },
    { value: "1536x1024", label: "1536×1024 (Landscape 3:2)" },
    { value: "1024x1536", label: "1024×1536 (Portrait 2:3)" },
  ],
  defaultImageSize: "auto" as const,
  backgrounds: [
    { value: "auto", label: "Auto" },
    { value: "transparent", label: "Transparent" },
    { value: "opaque", label: "Opaque" },
  ],
  defaultBackground: "auto" as const,
  qualities: [
    { value: "low", label: "Low (Faster)" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High (Best)" },
  ],
  defaultQuality: "high" as const,
  inputFidelities: [
    { value: "low", label: "Low (More Creative)" },
    { value: "high", label: "High (Preserve Input)" },
  ],
  defaultInputFidelity: "high" as const,
  outputFormats: ["png", "jpeg", "webp"] as const,
  defaultOutputFormat: "png" as const,
  numImagesRange: { min: 1, max: 4 },
  defaultNumImages: 1,
  maxInputImages: 4,
} as const;
```

---

### Subtask 7: Export New Functions from Index

**File**: `apps/web/src/lib/ai-video/index.ts`

**Action**: ADD exports for GPT Image 1.5

```typescript
// Add to existing exports from generators/image.ts
export {
  generateSeeddream45Image,
  editSeeddream45Image,
  uploadImageForSeeddream45Edit,
  generateGptImage15,  // ADD this
  type Seeddream45ImageResult,
  type GptImage15ImageResult,  // ADD this
} from "./generators/image";
```

---

### Subtask 8: Update Adjustment Store Types (if needed)

**File**: `apps/web/src/stores/adjustment-store.ts`

**Action**: VERIFY the store already supports the new model via getModelCapabilities()

The existing store uses `getModelCapabilities(selectedModel)` which will automatically work once the model is added to `image-edit-capabilities.ts`. No changes needed if the store is already model-agnostic.

---

## Testing Checklist

- [ ] Text-to-image generation works with all image_size options
- [ ] Background options (auto, transparent, opaque) work correctly
- [ ] Quality levels produce expected results
- [ ] Multiple image generation (1-4) works
- [ ] Image edit with single input image works
- [ ] Image edit with multiple input images works
- [ ] Input fidelity (low/high) affects output appropriately
- [ ] Error handling displays user-friendly messages
- [ ] Progress callbacks update UI correctly

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `ai-types.ts` | ADD | Type definitions for GPT Image 1.5 |
| `image-edit-capabilities.ts` | MODIFY | Add model to capability registry |
| `image-edit-client.ts` | MODIFY | Add endpoint config and model info |
| `generators/image.ts` | ADD | Text-to-image generator function |
| `ai-constants.ts` | ADD | UI configuration constants |
| `ai-video/index.ts` | MODIFY | Export new functions |

---

## Notes

- Both endpoints support queue-based processing (polling handled by existing infrastructure)
- Images hosted on FAL's CDN (`v3b.fal.media`)
- Transparent background useful for compositing in video editor
- Edit API requires pre-uploaded images (reuse existing `uploadImageToFAL` function)
- Uses existing FAL API key from `VITE_FAL_API_KEY` environment variable
