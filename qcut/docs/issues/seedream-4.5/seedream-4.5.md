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

## Implementation Plan

### Subtask 1: Add Seedream 4.5 Model Definitions to `text2image-models.ts`

**File:** `qcut/apps/web/src/lib/text2image-models.ts`

**Estimated Time:** 10 minutes

**Action:** ADD two new model entries to `TEXT2IMAGE_MODELS` object

```typescript
// ADD after line 676 (after seeddream-v4 entry)
// NOTE: Model ID uses "seeddream" (double 'e') to match existing v3/v4 pattern
// API endpoint uses "seedream" (single 'e') as per FAL API

"seeddream-v4-5": {
  id: "seeddream-v4-5",
  name: "SeedDream v4.5",
  description:
    "ByteDance's latest unified image generation model with up to 4K resolution",
  provider: "ByteDance",
  endpoint: "https://fal.run/fal-ai/bytedance/seedream/v4.5/text-to-image",

  qualityRating: 5,
  speedRating: 4,

  estimatedCost: "$0.04-0.08",
  costPerImage: 5, // cents

  maxResolution: "4096x4096",
  supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

  defaultParams: {
    image_size: "auto_2K",
    max_images: 1,
    num_images: 1,
    sync_mode: false,
    enable_safety_checker: true,
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
        "auto_2K",
        "auto_4K",
      ],
      default: "auto_2K",
      description: "Output image resolution and aspect ratio",
    },
    {
      name: "num_images",
      type: "number",
      min: 1,
      max: 6,
      default: 1,
      description: "Number of images to generate",
    },
    {
      name: "seed",
      type: "number",
      min: 0,
      max: 2_147_483_647,
      default: null,
      description: "Random seed for reproducible results",
    },
    {
      name: "enable_safety_checker",
      type: "boolean",
      default: true,
      description: "Enable content safety filtering",
    },
  ],

  bestFor: [
    "High-resolution image generation",
    "Commercial content creation",
    "Product photography",
    "Artistic illustrations",
    "Up to 4K output",
  ],

  strengths: [
    "Up to 4K resolution output",
    "Unified generation architecture",
    "Commercial license",
    "No cold starts",
    "Fast generation speed",
  ],

  limitations: [
    "Higher cost for 4K output",
    "May require specific prompt formatting",
  ],
},

"seeddream-v4-5-edit": {
  id: "seeddream-v4-5-edit",
  name: "SeedDream v4.5 Edit",
  description:
    "ByteDance's image editing model with multi-image compositing support (up to 10 images)",
  provider: "ByteDance",
  endpoint: "https://fal.run/fal-ai/bytedance/seedream/v4.5/edit",

  qualityRating: 5,
  speedRating: 4,

  estimatedCost: "$0.04-0.08",
  costPerImage: 5, // cents

  maxResolution: "4096x4096",
  supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

  defaultParams: {
    image_size: "auto_2K",
    num_images: 1,
    sync_mode: false,
    enable_safety_checker: true,
  },

  availableParams: [
    {
      name: "image_urls",
      type: "string", // Array handled specially in UI
      default: [],
      description: "URLs of input images to edit (max 10)",
    },
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
        "auto_2K",
        "auto_4K",
      ],
      default: "auto_2K",
      description: "Output image resolution",
    },
    {
      name: "num_images",
      type: "number",
      min: 1,
      max: 6,
      default: 1,
      description: "Number of output images",
    },
    {
      name: "seed",
      type: "number",
      min: 0,
      max: 2_147_483_647,
      default: null,
      description: "Random seed for reproducible results",
    },
  ],

  bestFor: [
    "Image editing and adjustment",
    "Multi-image compositing",
    "Background replacement",
    "Object manipulation",
    "Style transfer",
  ],

  strengths: [
    "Supports up to 10 input images",
    "Multi-image compositing",
    "Up to 4K output",
    "Unified architecture with generation",
    "Commercial license",
  ],

  limitations: [
    "Requires image upload to FAL",
    "Higher latency for multiple images",
  ],
},
```

**MODIFY** `TEXT2IMAGE_MODEL_ORDER` array (around line 1038):
```typescript
export const TEXT2IMAGE_MODEL_ORDER = [
  "gemini-3-pro",
  "nano-banana",
  "z-image-turbo",
  "flux-2-flex",
  "seeddream-v4",
  "seeddream-v4-5",      // ADD (double 'e' to match existing pattern)
  "seeddream-v4-5-edit", // ADD (double 'e' to match existing pattern)
  "reve-text-to-image",
  "wan-v2-2",
  "imagen4-ultra",
  "qwen-image",
  "flux-pro-v11-ultra",
  "seeddream-v3",
] as const;
```

**MODIFY** `MODEL_CATEGORIES` (around line 1118):
```typescript
export const MODEL_CATEGORIES = {
  PHOTOREALISTIC: ["imagen4-ultra", "wan-v2-2", "gemini-3-pro"],
  ARTISTIC: ["seeddream-v3", "seeddream-v4", "seeddream-v4-5", "qwen-image"], // ADD seeddream-v4-5
  VERSATILE: [
    "qwen-image",
    "flux-pro-v11-ultra",
    "flux-2-flex",
    "nano-banana",
    "reve-text-to-image",
    "z-image-turbo",
    "seeddream-v4-5-edit", // ADD
  ],
  // ... rest unchanged
  HIGH_QUALITY: [
    "imagen4-ultra",
    "wan-v2-2",
    "flux-pro-v11-ultra",
    "flux-2-flex",
    "seeddream-v4",
    "seeddream-v4-5", // ADD
    "gemini-3-pro",
  ],
  // ... rest unchanged
} as const;
```

**Review Checklist:**
- ✅ Model IDs use `seeddream-v4-5` (double 'e') to match existing `seeddream-v3` and `seeddream-v4` pattern
- ✅ API endpoints use `seedream/v4.5` (single 'e') as per FAL API specification
- ✅ Defaults match API limits: `auto_2K` default, `num_images` 1-6, `max_images` 1-6, safety checker enabled
- ✅ Cost ($0.04-0.08) and resolution (4K) metadata aligns with other ByteDance models

---

### Subtask 2: Add FAL Client Functions for Seedream 4.5

**File:** `qcut/apps/web/src/lib/ai-video-client.ts`

**Estimated Time:** 15 minutes

**Action:** ADD two new functions at the end of the file (before final export)

```typescript
// ============================================
// Seedream 4.5 Text-to-Image
// ============================================

/**
 * Generate images using Seedream 4.5 text-to-image model
 *
 * @example
 * ```typescript
 * const result = await generateSeedream45Image({
 *   prompt: "A serene mountain landscape at sunset",
 *   image_size: "auto_2K",
 *   num_images: 1,
 * });
 * ```
 */
export async function generateSeedream45Image(params: {
  prompt: string;
  image_size?:
    | "square_hd"
    | "square"
    | "portrait_4_3"
    | "portrait_16_9"
    | "landscape_4_3"
    | "landscape_16_9"
    | "auto_2K"
    | "auto_4K"
    | { width: number; height: number };
  num_images?: number;
  max_images?: number;
  seed?: number;
  sync_mode?: boolean;
  enable_safety_checker?: boolean;
}): Promise<{
  images: Array<{
    url: string;
    content_type: string;
    file_name: string;
    file_size: number;
    width: number;
    height: number;
  }>;
  seed: number;
}> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("FAL API key not configured");
  }

  const endpoint = "fal-ai/bytedance/seedream/v4.5/text-to-image";

  const input = {
    prompt: params.prompt,
    image_size: params.image_size ?? "auto_2K",
    num_images: params.num_images ?? 1,
    max_images: params.max_images ?? 1,
    sync_mode: params.sync_mode ?? false,
    enable_safety_checker: params.enable_safety_checker ?? true,
    ...(params.seed !== undefined && { seed: params.seed }),
  };

  const response = await fetch(`https://fal.run/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Seedream 4.5 generation failed: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// ============================================
// Seedream 4.5 Image Edit
// ============================================

/**
 * Edit images using Seedream 4.5 edit model
 * Supports up to 10 input images for multi-image compositing
 *
 * @example
 * ```typescript
 * // Single image edit
 * const result = await editSeedream45Image({
 *   prompt: "Replace the background with a beach sunset",
 *   image_urls: ["https://fal.ai/storage/uploaded-image.png"],
 * });
 *
 * // Multi-image compositing
 * const result = await editSeedream45Image({
 *   prompt: "Replace the product in Figure 1 with the product from Figure 2",
 *   image_urls: [
 *     "https://fal.ai/storage/scene.png",
 *     "https://fal.ai/storage/product.png"
 *   ],
 * });
 * ```
 */
export async function editSeedream45Image(params: {
  prompt: string;
  image_urls: string[];
  image_size?:
    | "square_hd"
    | "square"
    | "portrait_4_3"
    | "portrait_16_9"
    | "landscape_4_3"
    | "landscape_16_9"
    | "auto_2K"
    | "auto_4K"
    | { width: number; height: number };
  num_images?: number;
  max_images?: number;
  seed?: number;
  sync_mode?: boolean;
  enable_safety_checker?: boolean;
}): Promise<{
  images: Array<{
    url: string;
    content_type: string;
    file_name: string;
    file_size: number;
    width: number;
    height: number;
  }>;
}> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("FAL API key not configured");
  }

  // Validate image_urls
  if (!params.image_urls || params.image_urls.length === 0) {
    throw new Error("At least one image URL is required for editing");
  }
  if (params.image_urls.length > 10) {
    throw new Error("Maximum 10 images allowed for Seedream 4.5 edit");
  }

  const endpoint = "fal-ai/bytedance/seedream/v4.5/edit";

  const input = {
    prompt: params.prompt,
    image_urls: params.image_urls,
    image_size: params.image_size ?? "auto_2K",
    num_images: params.num_images ?? 1,
    max_images: params.max_images ?? 1,
    sync_mode: params.sync_mode ?? false,
    enable_safety_checker: params.enable_safety_checker ?? true,
    ...(params.seed !== undefined && { seed: params.seed }),
  };

  const response = await fetch(`https://fal.run/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Seedream 4.5 edit failed: ${response.status} - ${errorText}`);
  }

  return response.json();
}

/**
 * Upload image to FAL storage for use with Seedream 4.5 edit
 * Uses existing two-step upload via Electron IPC
 *
 * @param imageFile - Image file to upload
 * @returns FAL storage URL for use in image_urls
 */
export async function uploadImageForSeedream45Edit(
  imageFile: File
): Promise<string> {
  // Use existing Electron IPC upload if available
  if (window.electronAPI?.fal?.uploadImage) {
    const arrayBuffer = await imageFile.arrayBuffer();
    const result = await window.electronAPI.fal.uploadImage(
      new Uint8Array(arrayBuffer),
      imageFile.name,
      await getApiKey()
    );

    if (!result.success || !result.url) {
      throw new Error(result.error ?? "Failed to upload image to FAL");
    }

    return result.url;
  }

  // Fallback: Direct upload (may hit CORS in browser)
  throw new Error(
    "Image upload requires Electron. Please run in the desktop app."
  );
}
```

**Review Checklist:**
- Confirm both endpoints hit `fal-ai/bytedance/seedream/v4.5/...` with the API key header and proper POST body.
- Validate optional params (seed, num/max images, safety) send only when defined and use sensible defaults.
- Ensure image URL validation enforces 1-10 inputs with clear error messages.
- Verify `uploadImageForSeedream45Edit` goes through Electron IPC and fails loudly when the bridge is unavailable to prevent silent upload issues.

---

### Subtask 3: Add Electron IPC Handler for Image Upload

**File:** `qcut/electron/main.ts`

**Estimated Time:** 10 minutes

**Action:** ADD new IPC handler (near existing `fal:upload-video` handler)

```typescript
// ADD after the existing fal:upload-video handler

/**
 * IPC Handler: Upload image to FAL storage
 * Uses two-step upload process:
 * 1. Initiate upload to get signed URL
 * 2. PUT image to signed URL
 * 3. Return file_url for API use
 */
ipcMain.handle(
  "fal:upload-image",
  async (
    _event: IpcMainInvokeEvent,
    imageData: Uint8Array,
    filename: string,
    apiKey: string
  ): Promise<{ success: boolean; url?: string; error?: string }> => {
    try {
      logger.info(`[FAL Upload] Starting image upload: ${filename}`);
      logger.info(`[FAL Upload] File size: ${imageData.length} bytes`);

      // Determine content type from filename
      const ext = filename.toLowerCase().split(".").pop();
      const contentTypeMap: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        gif: "image/gif",
      };
      const contentType = contentTypeMap[ext ?? ""] ?? "image/png";

      // Step 1: Initiate upload to get signed URL
      const initiateUrl =
        "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3";

      logger.info(`[FAL Upload] Step 1: Initiating upload...`);
      const initResponse = await fetch(initiateUrl, {
        method: "POST",
        headers: {
          Authorization: `Key ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          file_name: filename,
          content_type: contentType,
        }),
      });

      if (!initResponse.ok) {
        const errorText = await initResponse.text();
        logger.error(`[FAL Upload] Initiate failed: ${initResponse.status}`);
        return {
          success: false,
          error: `Upload initiate failed: ${initResponse.status} - ${errorText}`,
        };
      }

      const initData = (await initResponse.json()) as {
        upload_url?: string;
        file_url?: string;
      };
      const { upload_url, file_url } = initData;

      if (!upload_url || !file_url) {
        logger.error("[FAL Upload] No upload URLs in response");
        return {
          success: false,
          error: "FAL API did not return upload URLs",
        };
      }

      logger.info(`[FAL Upload] Step 2: Uploading to signed URL...`);

      // Step 2: Upload image to the signed URL
      const uploadResponse = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: Buffer.from(imageData),
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        logger.error(`[FAL Upload] Upload failed: ${uploadResponse.status}`);
        return {
          success: false,
          error: `Upload failed: ${uploadResponse.status} - ${errorText}`,
        };
      }

      logger.info(`[FAL Upload] ✅ Upload successful: ${file_url}`);
      return { success: true, url: file_url };
    } catch (error: any) {
      logger.error(`[FAL Upload] Error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
);
```

**MODIFY** `electron/preload.ts` to expose the new IPC:

```typescript
// ADD to the fal object in contextBridge.exposeInMainWorld

fal: {
  uploadVideo: (videoData: Uint8Array, filename: string, apiKey: string) =>
    ipcRenderer.invoke("fal:upload-video", videoData, filename, apiKey),
  // ADD this line:
  uploadImage: (imageData: Uint8Array, filename: string, apiKey: string) =>
    ipcRenderer.invoke("fal:upload-image", imageData, filename, apiKey),
},
```

**MODIFY** `qcut/apps/web/src/types/electron.d.ts` to add type:

```typescript
// ADD to the ElectronAPI interface under fal:

fal?: {
  uploadVideo?: (
    videoData: Uint8Array,
    filename: string,
    apiKey: string
  ) => Promise<{ success: boolean; url?: string; error?: string }>;
  // ADD this:
  uploadImage?: (
    imageData: Uint8Array,
    filename: string,
    apiKey: string
  ) => Promise<{ success: boolean; url?: string; error?: string }>;
};
```

**Review Checklist:**
- Ensure the `fal:upload-image` handler mirrors the `uploadVideo` pattern and is registered in the same lifecycle area.
- Confirm content-type detection covers common formats and defaults to PNG, and that the initiate URL uses `fal-cdn-v3`.
- Verify preload exposure and `electron.d.ts` signatures match the IPC contract (params + return shape) to avoid runtime type gaps.

---

### Subtask 4: Add Type Definitions for Seedream 4.5

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`

**Estimated Time:** 5 minutes

**Action:** ADD new interface and modify `UseAIGenerationProps`

```typescript
// ADD new interface after line 113 (after AIModel interface)

/**
 * Seedream 4.5 image size options
 * Supports both preset strings and custom dimensions
 */
export type Seedream45ImageSize =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9"
  | "auto_2K"
  | "auto_4K"
  | { width: number; height: number };

/**
 * Parameters for Seedream 4.5 text-to-image generation
 */
export interface Seedream45TextToImageParams {
  prompt: string;
  image_size?: Seedream45ImageSize;
  num_images?: number;
  max_images?: number;
  seed?: number;
  sync_mode?: boolean;
  enable_safety_checker?: boolean;
}

/**
 * Parameters for Seedream 4.5 image editing
 */
export interface Seedream45EditParams {
  prompt: string;
  image_urls: string[];
  image_size?: Seedream45ImageSize;
  num_images?: number;
  max_images?: number;
  seed?: number;
  sync_mode?: boolean;
  enable_safety_checker?: boolean;
}
```

**MODIFY** `UseAIGenerationProps` interface (around line 149):

```typescript
// ADD these props to UseAIGenerationProps interface:

// Seedream 4.5 options
seedream45ImageSize?: Seedream45ImageSize;
seedream45NumImages?: number;
seedream45Seed?: number;
seedream45SafetyChecker?: boolean;
/** Images selected for Seedream 4.5 edit (up to 10) */
seedream45EditImages?: (File | null)[];
```

**Review Checklist:**
- Confirm `Seedream45ImageSize` is exported and supports both preset strings and custom dimensions.
- Ensure the params interfaces align with the client functions (prompt required, image_urls required for edit, optional safety/seed/image_size).
- Verify `UseAIGenerationProps` additions remain optional and naming matches how the UI/hook will read/write these values.

---

### Subtask 5: Add Constants and Error Messages

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Estimated Time:** 10 minutes

**Action:** ADD model entries and error messages

**ADD to `AI_MODELS` array** (after line 870, near other ByteDance models):

```typescript
// Seedream 4.5 Text-to-Image
{
  id: "seedream_45_t2i",
  name: "Seedream 4.5 Text-to-Image",
  description: "ByteDance's latest unified image generation with up to 4K resolution",
  price: "0.04",
  resolution: "Up to 4K",
  max_duration: 0, // Not applicable for image generation
  category: "text", // Uses text tab for prompt-based generation
  endpoints: {
    text_to_video: "fal-ai/bytedance/seedream/v4.5/text-to-image", // Reuse endpoint type
  },
  default_params: {
    image_size: "auto_2K",
    num_images: 1,
    enable_safety_checker: true,
  },
  supportedResolutions: ["auto_2K", "auto_4K"],
},

// Seedream 4.5 Image Edit
{
  id: "seedream_45_edit",
  name: "Seedream 4.5 Edit",
  description: "Edit and composite up to 10 images with natural language instructions",
  price: "0.04",
  resolution: "Up to 4K",
  max_duration: 0,
  category: "image", // Uses image tab for image editing
  requiredInputs: ["editImages"], // New input type for multi-image
  endpoints: {
    image_to_video: "fal-ai/bytedance/seedream/v4.5/edit",
  },
  default_params: {
    image_size: "auto_2K",
    num_images: 1,
    enable_safety_checker: true,
  },
  supportedResolutions: ["auto_2K", "auto_4K"],
},
```

**ADD to `ERROR_MESSAGES`** (around line 1030):

```typescript
// Seedream 4.5 errors
SEEDREAM45_EMPTY_PROMPT: "Please enter a prompt for image generation",
SEEDREAM45_EDIT_NO_IMAGES: "Please select at least one image to edit",
SEEDREAM45_EDIT_TOO_MANY_IMAGES: "Maximum 10 images allowed for Seedream 4.5 edit",
SEEDREAM45_UPLOAD_FAILED: "Failed to upload image for editing",
SEEDREAM45_GENERATION_FAILED: "Seedream 4.5 image generation failed",
```

**ADD to `UPLOAD_CONSTANTS`** (around line 973):

```typescript
// Seedream 4.5 edit image uploads
MAX_SEEDREAM45_IMAGES: 10,
MAX_SEEDREAM45_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB per image
MAX_SEEDREAM45_IMAGE_SIZE_LABEL: "10MB",
```

**Review Checklist:**
- Validate the new `AI_MODELS` entries surface the right endpoints, categories, and default params so the UI picks them up.
- Confirm `ERROR_MESSAGES` keys match those referenced in the hook/UI and are distinct from existing Seedream versions.
- Check upload limits (10 images, 10MB) align with FAL constraints and are enforced consistently alongside the UI controls.

---

### Subtask 6: Add UI Components for Seedream 4.5 Panel

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Estimated Time:** 15 minutes

**Action:** ADD UI controls for Seedream 4.5 models

This requires identifying where model-specific controls are rendered and adding:

1. **Image size dropdown** for both T2I and Edit models
2. **Num images slider** (1-6)
3. **Seed input** for reproducibility
4. **Multi-image upload** for Edit model (up to 10 images)

```typescript
// ADD helper function (near other model-specific render functions)

/**
 * Render Seedream 4.5 specific controls
 */
function renderSeedream45Controls(
  selectedModel: string,
  seedream45ImageSize: Seedream45ImageSize,
  setSeedream45ImageSize: (size: Seedream45ImageSize) => void,
  seedream45NumImages: number,
  setSeedream45NumImages: (num: number) => void,
  seedream45Seed: number | undefined,
  setSeedream45Seed: (seed: number | undefined) => void,
) {
  const isSeedream45 = selectedModel.startsWith("seedream_45");
  if (!isSeedream45) return null;

  return (
    <div className="space-y-4">
      {/* Image Size */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">
          Image Size
        </Label>
        <Select
          value={typeof seedream45ImageSize === "string" ? seedream45ImageSize : "custom"}
          onValueChange={(value) => setSeedream45ImageSize(value as Seedream45ImageSize)}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto_2K">Auto 2K (Default)</SelectItem>
            <SelectItem value="auto_4K">Auto 4K</SelectItem>
            <SelectItem value="square_hd">Square HD</SelectItem>
            <SelectItem value="square">Square</SelectItem>
            <SelectItem value="portrait_4_3">Portrait 4:3</SelectItem>
            <SelectItem value="portrait_16_9">Portrait 16:9</SelectItem>
            <SelectItem value="landscape_4_3">Landscape 4:3</SelectItem>
            <SelectItem value="landscape_16_9">Landscape 16:9</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Number of Images */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">
          Number of Images: {seedream45NumImages}
        </Label>
        <Slider
          min={1}
          max={6}
          step={1}
          value={[seedream45NumImages]}
          onValueChange={([value]) => setSeedream45NumImages(value)}
          className="py-2"
        />
      </div>

      {/* Seed (Optional) */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">
          Seed (Optional)
        </Label>
        <Input
          type="number"
          placeholder="Random"
          value={seedream45Seed ?? ""}
          onChange={(e) =>
            setSeedream45Seed(e.target.value ? parseInt(e.target.value) : undefined)
          }
          className="h-8"
        />
      </div>
    </div>
  );
}
```

**ADD Multi-Image Upload Component** for Edit model:

```typescript
// ADD new component for multi-image selection

/**
 * Multi-image upload for Seedream 4.5 Edit
 * Allows selecting up to 10 images for compositing
 */
function Seedream45EditImageUpload({
  images,
  onImagesChange,
  maxImages = 10,
}: {
  images: (File | null)[];
  onImagesChange: (images: (File | null)[]) => void;
  maxImages?: number;
}) {
  const handleFileSelect = (index: number, file: File | null) => {
    const newImages = [...images];
    newImages[index] = file;
    onImagesChange(newImages);
  };

  const handleAddSlot = () => {
    if (images.length < maxImages) {
      onImagesChange([...images, null]);
    }
  };

  const handleRemoveSlot = (index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    onImagesChange(newImages);
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">
        Images for Editing ({images.filter(Boolean).length}/{maxImages})
      </Label>

      <div className="grid grid-cols-5 gap-2">
        {images.map((image, index) => (
          <div
            key={index}
            className="relative aspect-square border rounded-md overflow-hidden"
          >
            {image ? (
              <>
                <img
                  src={URL.createObjectURL(image)}
                  alt={`Image ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveSlot(index)}
                  className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs"
                >
                  ×
                </button>
              </>
            ) : (
              <label className="w-full h-full flex items-center justify-center cursor-pointer hover:bg-muted/50">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFileSelect(index, e.target.files?.[0] ?? null)}
                />
                <span className="text-2xl text-muted-foreground">+</span>
              </label>
            )}
          </div>
        ))}

        {images.length < maxImages && (
          <button
            type="button"
            onClick={handleAddSlot}
            className="aspect-square border border-dashed rounded-md flex items-center justify-center hover:bg-muted/50"
          >
            <span className="text-muted-foreground">Add</span>
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Upload images for multi-image compositing. Use prompts like "Replace the product in Figure 1 with Figure 2"
      </p>
    </div>
  );
}
```

**Review Checklist:**
- Ensure Seedream 4.5 controls render only when a `seedream_45...` model is selected and respect the current state defaults.
- Confirm image size/num/seed inputs propagate via setters and the slider stays within 1-6.
- Verify the multi-image upload enforces the max slot count, supports remove/add flows, and restricts selection to images while showing an accurate count.

---

### Subtask 7: Update `use-ai-generation.ts` Hook

**File:** `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**Estimated Time:** 15 minutes

**Action:** ADD handling for Seedream 4.5 models in the generation flow

```typescript
// ADD imports at top of file
import {
  generateSeedream45Image,
  editSeedream45Image,
  uploadImageForSeedream45Edit,
} from "@/lib/ai-video-client";

// ADD to handleGenerate function (in the model processing loop)

// Handle Seedream 4.5 Text-to-Image
if (modelId === "seedream_45_t2i") {
  console.log("🎨 Generating with Seedream 4.5 Text-to-Image...");

  const result = await generateSeedream45Image({
    prompt,
    image_size: seedream45ImageSize,
    num_images: seedream45NumImages,
    seed: seedream45Seed,
    enable_safety_checker: seedream45SafetyChecker,
  });

  // Process generated images
  for (const image of result.images) {
    // Download and add to media library
    await downloadAndAddToMediaLibrary(image.url, `seedream45_${Date.now()}.png`);
  }

  onProgress(100, "Seedream 4.5 generation complete!");
  return;
}

// Handle Seedream 4.5 Edit
if (modelId === "seedream_45_edit") {
  console.log("🎨 Editing with Seedream 4.5 Edit...");

  // Validate images
  const validImages = seedream45EditImages?.filter(Boolean) as File[];
  if (!validImages || validImages.length === 0) {
    throw new Error(ERROR_MESSAGES.SEEDREAM45_EDIT_NO_IMAGES);
  }
  if (validImages.length > 10) {
    throw new Error(ERROR_MESSAGES.SEEDREAM45_EDIT_TOO_MANY_IMAGES);
  }

  // Upload images to FAL
  onProgress(10, "Uploading images to FAL...");
  const uploadedUrls: string[] = [];

  for (let i = 0; i < validImages.length; i++) {
    onProgress(
      10 + (i / validImages.length) * 30,
      `Uploading image ${i + 1}/${validImages.length}...`
    );
    const url = await uploadImageForSeedream45Edit(validImages[i]);
    uploadedUrls.push(url);
  }

  // Call edit API
  onProgress(50, "Processing edit...");
  const result = await editSeedream45Image({
    prompt,
    image_urls: uploadedUrls,
    image_size: seedream45ImageSize,
    num_images: seedream45NumImages,
    seed: seedream45Seed,
    enable_safety_checker: seedream45SafetyChecker,
  });

  // Process results
  onProgress(90, "Downloading edited images...");
  for (const image of result.images) {
    await downloadAndAddToMediaLibrary(image.url, `seedream45_edit_${Date.now()}.png`);
  }

  onProgress(100, "Seedream 4.5 edit complete!");
  return;
}
```

**Review Checklist:**
- Confirm the Seedream 4.5 branches run before generic handlers and return early to avoid duplicate work.
- Validate progress messaging/order and error handling use the new constants for missing/too many images.
- Ensure uploaded URLs from `uploadImageForSeedream45Edit` feed directly into the edit call and outputs are saved with unique filenames.
- Check safety checker, seed, and image_size options flow through consistently for both generation and edit paths.

---

### Subtask 8: Add Tests for Seedream 4.5

**File:** `qcut/apps/web/src/lib/__tests__/seedream45.test.ts` (NEW FILE)

**Estimated Time:** 15 minutes

**Action:** CREATE new test file

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch
global.fetch = vi.fn();

// Mock Electron API
vi.mock("@/lib/ai-video-client", async () => {
  const actual = await vi.importActual("@/lib/ai-video-client");
  return {
    ...actual,
    getApiKey: vi.fn().mockResolvedValue("test-api-key"),
  };
});

describe("Seedream 4.5 API Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateSeedream45Image", () => {
    it("should call FAL API with correct parameters", async () => {
      const mockResponse = {
        images: [
          {
            url: "https://fal.ai/output/image.png",
            content_type: "image/png",
            file_name: "output.png",
            file_size: 1024000,
            width: 2048,
            height: 2048,
          },
        ],
        seed: 12345,
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const { generateSeedream45Image } = await import("@/lib/ai-video-client");

      const result = await generateSeedream45Image({
        prompt: "A beautiful sunset",
        image_size: "auto_2K",
        num_images: 1,
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://fal.run/fal-ai/bytedance/seedream/v4.5/text-to-image",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Key test-api-key",
          }),
        })
      );

      expect(result.images).toHaveLength(1);
      expect(result.images[0].url).toBe("https://fal.ai/output/image.png");
    });

    it("should throw error when API fails", async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      const { generateSeedream45Image } = await import("@/lib/ai-video-client");

      await expect(
        generateSeedream45Image({
          prompt: "Test prompt",
        })
      ).rejects.toThrow("Seedream 4.5 generation failed: 500");
    });
  });

  describe("editSeedream45Image", () => {
    it("should validate image_urls is not empty", async () => {
      const { editSeedream45Image } = await import("@/lib/ai-video-client");

      await expect(
        editSeedream45Image({
          prompt: "Edit this",
          image_urls: [],
        })
      ).rejects.toThrow("At least one image URL is required");
    });

    it("should validate max 10 images", async () => {
      const { editSeedream45Image } = await import("@/lib/ai-video-client");

      const tooManyUrls = Array(11).fill("https://example.com/image.png");

      await expect(
        editSeedream45Image({
          prompt: "Edit this",
          image_urls: tooManyUrls,
        })
      ).rejects.toThrow("Maximum 10 images allowed");
    });

    it("should call FAL API with correct parameters for multi-image edit", async () => {
      const mockResponse = {
        images: [
          {
            url: "https://fal.ai/output/edited.png",
            content_type: "image/png",
            file_name: "edited.png",
            file_size: 1024000,
            width: 2048,
            height: 2048,
          },
        ],
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const { editSeedream45Image } = await import("@/lib/ai-video-client");

      const result = await editSeedream45Image({
        prompt: "Replace background with sunset",
        image_urls: [
          "https://fal.ai/storage/image1.png",
          "https://fal.ai/storage/image2.png",
        ],
        image_size: "auto_2K",
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://fal.run/fal-ai/bytedance/seedream/v4.5/edit",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"image_urls"'),
        })
      );

      expect(result.images).toHaveLength(1);
    });
  });
});

describe("Seedream 4.5 Model Configuration", () => {
  it("should have correct endpoints in TEXT2IMAGE_MODELS", async () => {
    const { TEXT2IMAGE_MODELS } = await import("@/lib/text2image-models");

    // Note: Model ID uses "seeddream" (double 'e'), endpoint uses "seedream" (single 'e')
    expect(TEXT2IMAGE_MODELS["seeddream-v4-5"]).toBeDefined();
    expect(TEXT2IMAGE_MODELS["seeddream-v4-5"].endpoint).toBe(
      "https://fal.run/fal-ai/bytedance/seedream/v4.5/text-to-image"
    );

    expect(TEXT2IMAGE_MODELS["seeddream-v4-5-edit"]).toBeDefined();
    expect(TEXT2IMAGE_MODELS["seeddream-v4-5-edit"].endpoint).toBe(
      "https://fal.run/fal-ai/bytedance/seedream/v4.5/edit"
    );
  });

  it("should include Seedream 4.5 in model order", async () => {
    const { TEXT2IMAGE_MODEL_ORDER } = await import("@/lib/text2image-models");

    expect(TEXT2IMAGE_MODEL_ORDER).toContain("seeddream-v4-5");
    expect(TEXT2IMAGE_MODEL_ORDER).toContain("seeddream-v4-5-edit");
  });
});
```

**Review Checklist:**
- Verify fetch mocks reset per test and cover both success and failure paths for generation and edit clients.
- Confirm endpoint strings asserted in tests match the actual client/config values to catch typos early.
- Ensure validation cases cover empty image lists and >10 images, and that tests remain network-free under Vitest.
- Consider extending with integration smoke tests once the API is available, but keep current unit scope green.

---

## Status

| Subtask | Status | Files | Notes |
|---------|--------|-------|-------|
| 1. Model Definitions | ✅ Complete | `text2image-models.ts` | Added `seeddream-v4-5` and `seeddream-v4-5-edit` to TEXT2IMAGE_MODELS, MODEL_ORDER, MODEL_CATEGORIES |
| 2. FAL Client Functions | ✅ Complete | `ai-video-client.ts` | Added `generateSeeddream45Image`, `editSeeddream45Image`, `uploadImageForSeeddream45Edit` |
| 3. Electron IPC Handler | ✅ Complete | `main.ts`, `preload.ts`, `electron.d.ts` | Added `fal:upload-image` IPC handler and types |
| 4. Type Definitions | ✅ Complete | `ai-types.ts` | Added `Seeddream45ImageSize`, params interfaces, `UseAIGenerationProps` |
| 5. Constants & Errors | ✅ Complete | `ai-constants.ts` | Added ERROR_MESSAGES (SEEDDREAM45_*), UPLOAD_CONSTANTS |
| 6. UI Components | ✅ Complete | `fal-ai-client.ts`, `text2image-models.ts` | Models auto-appear in Text2Image dropdown via TEXT2IMAGE_MODEL_ORDER |
| 7. Generation Hook | ✅ Complete | `fal-ai-client.ts` | Added switch cases for `seeddream-v4-5` and `seeddream-v4-5-edit` |
| 8. Tests | ⬜ Pending | `seeddream45.test.ts` | Unit tests for API client (optional) |

### Naming Convention Note
- **Model IDs**: `seeddream-v4-5`, `seeddream-v4-5-edit` (double 'e' - matches existing v3/v4)
- **API Endpoints**: `seedream/v4.5` (single 'e' - FAL API format)
- **Function names**: `generateSeedream45Image`, `editSeedream45Image` (single 'e' - matches API)

---

## Dependencies Between Subtasks

```
Subtask 1 (Models) ──┐
                     ├──► Subtask 6 (UI) ──► Subtask 7 (Hook)
Subtask 4 (Types) ───┘

Subtask 3 (IPC) ─────► Subtask 2 (Client) ──► Subtask 7 (Hook)

Subtask 5 (Constants) ──► Subtask 6 (UI)

Subtask 8 (Tests) requires: 1, 2, 4, 5
```

**Recommended Order:**
1. Subtask 4 (Types) - No dependencies
2. Subtask 1 (Models) - No dependencies
3. Subtask 5 (Constants) - No dependencies
4. Subtask 3 (IPC) - No dependencies
5. Subtask 2 (Client) - Depends on 3, 4
6. Subtask 6 (UI) - Depends on 1, 4, 5
7. Subtask 7 (Hook) - Depends on 2, 5, 6
8. Subtask 8 (Tests) - Depends on 1, 2, 4, 5

---

## References

- [Seedream 4.5 Text-to-Image API](https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/text-to-image/api)
- [Seedream 4.5 Edit API](https://fal.ai/models/fal-ai/bytedance/seedream/v4.5/edit/api)
- [FAL AI Client Documentation](https://fal.ai/docs)
