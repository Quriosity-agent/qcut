# Models to Add - Implementation Plan

> **Priority**: Long-term maintainability > scalability > performance > short-term gains

## Source URLs
- https://fal.ai/models/fal-ai/gemini-3-pro-image-preview/api
- https://fal.ai/models/fal-ai/gemini-3-pro-image-preview/edit/api
- https://fal.ai/models/fal-ai/sam-3/image/api

---

## Architecture Overview

### Existing Patterns to Follow

The codebase has established patterns for AI model integration:

1. **Type Definitions** (`src/types/`)
   - `ai-generation.ts` - Video/image generation types (Veo3.1, Reve)
   - `nano-edit.ts` - Nano-banana specific types
   - Each domain has dedicated type files

2. **Model Catalogs** (`src/lib/`)
   - `text2image-models.ts` - Text-to-image model registry with `Text2ImageModel` interface
   - `upscale-models.ts` - Upscale model registry with `UpscaleModel` interface
   - Single source of truth pattern with priority ordering

3. **API Clients** (`src/lib/`)
   - `fal-ai-client.ts` - Main FAL client (singleton, direct REST calls)
   - `image-edit-client.ts` - Image editing with queue polling
   - `video-edit-client.ts` - Video editing (class-based singleton)
   - `ai-video-client.ts` - Video generation

4. **Services** (`src/services/ai/`)
   - `fal-ai-service.ts` - Uses `@fal-ai/client` SDK with `fal.subscribe()`

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Use existing `fal-ai-client.ts` for Gemini 3 Pro | Consistent with text2image pattern, avoids duplication |
| Use existing `image-edit-client.ts` for Gemini 3 Pro Edit | Consistent with existing edit models |
| Create new `sam3-client.ts` for SAM-3 | Segmentation is a new domain, needs dedicated client |
| Create new `sam3.ts` types file | Follows `sora2.ts`, `nano-edit.ts` pattern |
| Follow `upscale-models.ts` pattern for SAM-3 | Comprehensive model catalog with feature flags |

---

## Model 1: Gemini 3 Pro Image Preview (Text-to-Image)

### API Details
- **Endpoint**: `https://fal.run/fal-ai/gemini-3-pro-image-preview`
- **Cost**: $0.15 per image (4K outputs cost 2x)
- **Provider**: Google

### Input Parameters
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | Text prompt (3-50,000 chars) |
| `num_images` | integer | No | 1 | 1-4 images |
| `aspect_ratio` | enum | No | "1:1" | auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16 |
| `resolution` | enum | No | "1K" | 1K, 2K, 4K |
| `output_format` | enum | No | "png" | jpeg, png, webp |
| `sync_mode` | boolean | No | false | Returns data URI if true |

### Output Format
```json
{
  "images": [{ "url": "string", "file_name": "string", "content_type": "image/png", "width": int, "height": int }],
  "description": "string"
}
```

### Implementation Subtasks

#### Subtask 1.1: ADD model config to text2image-models.ts
- **File**: `qcut/apps/web/src/lib/text2image-models.ts`
- **Action**: ADD
- **Location**: After `nano-banana` model (line ~657), before closing brace of `TEXT2IMAGE_MODELS`
- **Pattern**: Follow `imagen4-ultra` structure (same provider: Google)
- **Details**:
```typescript
"gemini-3-pro": {
  id: "gemini-3-pro",
  name: "Gemini 3 Pro",
  description: "Google's state-of-the-art image generation with exceptional photorealism and long prompt support",
  provider: "Google",
  endpoint: "https://fal.run/fal-ai/gemini-3-pro-image-preview",

  qualityRating: 5,
  speedRating: 3,

  estimatedCost: "$0.15-0.30",
  costPerImage: 15, // cents (4K costs 2x)

  maxResolution: "4096x4096",
  supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21", "3:2", "2:3", "5:4", "4:5"],

  defaultParams: {
    aspect_ratio: "1:1",
    num_images: 1,
    resolution: "1K",
    output_format: "png",
  },

  availableParams: [
    {
      name: "aspect_ratio",
      type: "select",
      options: ["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21", "3:2", "2:3", "5:4", "4:5"],
      default: "1:1",
      description: "Image aspect ratio (auto matches input for editing)",
    },
    {
      name: "resolution",
      type: "select",
      options: ["1K", "2K", "4K"],
      default: "1K",
      description: "Output resolution (4K costs 2x)",
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
    "Photorealistic images",
    "Long detailed prompts (up to 50K chars)",
    "High-resolution outputs",
    "Commercial photography",
    "Product visualization",
  ],

  strengths: [
    "Exceptional photorealism (Google's latest)",
    "Supports extremely long prompts (50,000 chars)",
    "Multiple resolution options (1K/2K/4K)",
    "Wide aspect ratio support (11 options)",
    "Consistent quality across styles",
  ],

  limitations: [
    "Higher cost than budget models ($0.15/image)",
    "4K outputs double the cost",
    "Slower generation (quality focus)",
    "No seed control for reproducibility",
  ],
},
```

#### Subtask 1.2: UPDATE model order array
- **File**: `qcut/apps/web/src/lib/text2image-models.ts`
- **Action**: MODIFY
- **Location**: `TEXT2IMAGE_MODEL_ORDER` array (line ~736)
- **Rationale**: Insert after `imagen4-ultra` (same provider/price tier)
- **Change**:
```typescript
export const TEXT2IMAGE_MODEL_ORDER = [
  "nano-banana",
  "seeddream-v4",
  "reve-text-to-image",
  "wan-v2-2",
  "imagen4-ultra",
  "gemini-3-pro",      // ADD: After imagen4-ultra (same Google provider)
  "qwen-image",
  "flux-pro-v11-ultra",
  "seeddream-v3",
] as const;
```

#### Subtask 1.3: UPDATE model categories
- **File**: `qcut/apps/web/src/lib/text2image-models.ts`
- **Action**: MODIFY
- **Location**: `MODEL_CATEGORIES` object (line ~813)
- **Changes**:
```typescript
export const MODEL_CATEGORIES = {
  PHOTOREALISTIC: ["imagen4-ultra", "wan-v2-2", "gemini-3-pro"],  // ADD gemini-3-pro
  ARTISTIC: ["seeddream-v3", "seeddream-v4", "qwen-image"],
  VERSATILE: ["qwen-image", "flux-pro-v11-ultra", "nano-banana", "reve-text-to-image"],
  FAST: ["seeddream-v3", "nano-banana", "qwen-image", "reve-text-to-image"],
  HIGH_QUALITY: ["imagen4-ultra", "wan-v2-2", "flux-pro-v11-ultra", "seeddream-v4", "gemini-3-pro"],  // ADD gemini-3-pro
  COST_EFFECTIVE: ["seeddream-v3", "nano-banana", "qwen-image", "reve-text-to-image"],
} as const;
```

#### Subtask 1.4: ADD parameter conversion in fal-ai-client.ts
- **File**: `qcut/apps/web/src/lib/fal-ai-client.ts`
- **Action**: MODIFY
- **Location**: `convertSettingsToParams` switch statement (line ~432)
- **Pattern**: Follow `imagen4-ultra` case (same provider)
- **Add case**:
```typescript
case "gemini-3-pro":
  // Gemini 3 Pro uses aspect_ratio (like Imagen4) + resolution
  params.aspect_ratio = imageSizeToAspectRatio(settings.imageSize);
  // Remove image_size if set (Gemini uses aspect_ratio)
  params.image_size = undefined;
  // Note: resolution param is passed through defaultParams
  break;
```

---

## Model 2: Gemini 3 Pro Image Edit

### API Details
- **Endpoint**: `https://fal.run/fal-ai/gemini-3-pro-image-preview/edit`
- **Cost**: $0.15 per image
- **Provider**: Google

### Input Parameters
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | Edit instructions (3-50,000 chars) |
| `image_urls` | array | Yes | - | URLs of images to edit |
| `num_images` | integer | No | 1 | 1-4 images |
| `aspect_ratio` | enum | No | auto | auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16 |
| `resolution` | enum | No | "1K" | 1K, 2K, 4K |
| `output_format` | enum | No | "png" | jpeg, png, webp |
| `sync_mode` | boolean | No | false | Returns data URI if true |

### Implementation Subtasks

#### Subtask 2.1: ADD model to ImageEditRequest type
- **File**: `qcut/apps/web/src/lib/image-edit-client.ts`
- **Action**: MODIFY
- **Location**: `ImageEditRequest` interface, `model` type union (line ~17)
- **Change**:
```typescript
model:
  | "seededit"
  | "flux-kontext"
  | "flux-kontext-max"
  | "seeddream-v4"
  | "nano-banana"
  | "reve-edit"
  | "gemini-3-pro-edit";  // ADD
```

#### Subtask 2.2: ADD resolution parameter to ImageEditRequest
- **File**: `qcut/apps/web/src/lib/image-edit-client.ts`
- **Action**: MODIFY
- **Location**: `ImageEditRequest` interface (after line ~35)
- **Add**:
```typescript
resolution?: "1K" | "2K" | "4K"; // Gemini 3 Pro Edit
aspectRatio?: string; // Gemini 3 Pro Edit (auto, 21:9, 16:9, etc.)
```

#### Subtask 2.3: ADD model endpoint config
- **File**: `qcut/apps/web/src/lib/image-edit-client.ts`
- **Action**: ADD
- **Location**: `MODEL_ENDPOINTS` object, after `reve-edit` (line ~126)
- **Add**:
```typescript
"gemini-3-pro-edit": {
  endpoint: "fal-ai/gemini-3-pro-image-preview/edit",
  defaultParams: {
    num_images: 1,
    output_format: "png",
    resolution: "1K",
    aspect_ratio: "auto",
    sync_mode: false,
  },
},
```

#### Subtask 2.4: UPDATE editImage function for image_urls handling
- **File**: `qcut/apps/web/src/lib/image-edit-client.ts`
- **Action**: MODIFY
- **Location**: Image URL handling conditional (line ~234)
- **Change from**:
```typescript
if (request.model === "seeddream-v4" || request.model === "nano-banana") {
```
- **Change to**:
```typescript
if (request.model === "seeddream-v4" || request.model === "nano-banana" || request.model === "gemini-3-pro-edit") {
```

#### Subtask 2.5: ADD resolution and aspectRatio payload handling
- **File**: `qcut/apps/web/src/lib/image-edit-client.ts`
- **Action**: ADD
- **Location**: After `outputFormat` handling (line ~276)
- **Add**:
```typescript
// Gemini 3 Pro Edit specific parameters
if (request.resolution !== undefined) {
  payload.resolution = request.resolution;
}
if (request.aspectRatio !== undefined) {
  payload.aspect_ratio = request.aspectRatio;
}
```

#### Subtask 2.6: ADD to getImageEditModels list
- **File**: `qcut/apps/web/src/lib/image-edit-client.ts`
- **Action**: ADD
- **Location**: `getImageEditModels()` return array, after `nano-banana` (line ~838)
- **Add**:
```typescript
{
  id: "gemini-3-pro-edit",
  name: "Gemini 3 Pro Edit",
  description: "Google's advanced image editing with exceptional context understanding",
  provider: "Google",
  estimatedCost: "$0.15",
  features: [
    "Long prompt support (50K chars)",
    "Resolution options (1K/2K/4K)",
    "Smart context understanding",
    "Multiple aspect ratios",
  ],
  parameters: {
    numImages: { min: 1, max: 4, default: 1, step: 1 },
    resolution: {
      type: "select",
      options: ["1K", "2K", "4K"],
      default: "1K",
    },
    aspectRatio: {
      type: "select",
      options: ["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "3:2", "2:3", "5:4", "4:5"],
      default: "auto",
    },
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

## Model 3: SAM-3 (Segment Anything Model 3)

### API Details
- **Endpoint**: `https://fal.run/fal-ai/sam-3/image`
- **Cost**: $0.005 per request
- **Provider**: fal.ai (Meta SAM)

### Input Parameters
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `image_url` | string | Yes | - | URL of image to segment |
| `text_prompt` | string | No | "" | Text cue for segmentation |
| `prompts` | array | No | - | Point prompts [{x, y, label, object_id}] |
| `box_prompts` | array | No | - | Box prompts [{x_min, y_min, x_max, y_max}] |
| `apply_mask` | boolean | No | true | Apply mask to output image |
| `sync_mode` | boolean | No | false | Return as data URI |
| `output_format` | enum | No | "png" | jpeg, png, webp |
| `return_multiple_masks` | boolean | No | false | Return multiple mask options |
| `max_masks` | integer | No | 3 | Max masks to return |
| `include_scores` | boolean | No | false | Include confidence scores |
| `include_boxes` | boolean | No | false | Include bounding boxes |

### Output Format
```json
{
  "image": { "url": "string", "width": int, "height": int },
  "masks": [{ "url": "string", "width": int, "height": int }],
  "metadata": [{ "scores": [float], "boxes": [[cx, cy, w, h]] }],
  "scores": [[float]],
  "boxes": [[[cx, cy, w, h]]]
}
```

### Implementation Subtasks

#### Subtask 3.1: CREATE SAM-3 types file
- **File**: `qcut/apps/web/src/types/sam3.ts`
- **Action**: CREATE
- **Pattern**: Follow `sora2.ts`, `nano-edit.ts` structure
- **Content**:
```typescript
/**
 * SAM-3 (Segment Anything Model 3) Type Definitions
 *
 * Provides image segmentation with multiple prompt types:
 * - Text prompts: Natural language object descriptions
 * - Point prompts: Click coordinates with foreground/background labels
 * - Box prompts: Bounding box regions
 *
 * @module SAM3Types
 */

// ============================================
// Input Types
// ============================================

/**
 * Point prompt for SAM-3 segmentation
 * Represents a click point on the image with a label
 */
export interface Sam3PointPrompt {
  /** X coordinate (0-1 normalized or pixel value) */
  x: number;
  /** Y coordinate (0-1 normalized or pixel value) */
  y: number;
  /** 0 = background (exclude), 1 = foreground (include) */
  label: 0 | 1;
  /** Optional object ID for multi-object segmentation */
  object_id?: number;
}

/**
 * Box prompt for SAM-3 segmentation
 * Represents a bounding box region
 */
export interface Sam3BoxPrompt {
  /** Left edge X coordinate */
  x_min: number;
  /** Top edge Y coordinate */
  y_min: number;
  /** Right edge X coordinate */
  x_max: number;
  /** Bottom edge Y coordinate */
  y_max: number;
  /** Optional object ID for multi-object segmentation */
  object_id?: number;
}

/**
 * SAM-3 API input parameters
 */
export interface Sam3Input {
  /** URL of image to segment (required) */
  image_url: string;
  /** Text description of object to segment */
  text_prompt?: string;
  /** Point prompts for click-based segmentation */
  prompts?: Sam3PointPrompt[];
  /** Box prompts for region-based segmentation */
  box_prompts?: Sam3BoxPrompt[];
  /** Apply mask overlay to output image (default: true) */
  apply_mask?: boolean;
  /** Return as data URI instead of URL (default: false) */
  sync_mode?: boolean;
  /** Output image format (default: "png") */
  output_format?: "jpeg" | "png" | "webp";
  /** Return multiple mask options (default: false) */
  return_multiple_masks?: boolean;
  /** Maximum masks to return when return_multiple_masks=true (default: 3) */
  max_masks?: number;
  /** Include confidence scores in response (default: false) */
  include_scores?: boolean;
  /** Include bounding boxes in response (default: false) */
  include_boxes?: boolean;
}

// ============================================
// Output Types
// ============================================

/**
 * Image output from SAM-3
 */
export interface Sam3ImageOutput {
  /** URL to the image */
  url: string;
  /** Original filename */
  file_name?: string;
  /** MIME type (e.g., "image/png") */
  content_type?: string;
  /** Image width in pixels */
  width?: number;
  /** Image height in pixels */
  height?: number;
  /** File size in bytes */
  file_size?: number;
}

/**
 * Per-mask metadata (scores and boxes)
 */
export interface Sam3MaskMetadata {
  /** Confidence scores for each mask */
  scores?: number[];
  /** Bounding boxes in [cx, cy, w, h] normalized format */
  boxes?: number[][];
}

/**
 * SAM-3 API response
 */
export interface Sam3Output {
  /** Composite image with mask overlay (when apply_mask=true) */
  image?: Sam3ImageOutput;
  /** Individual segmentation masks */
  masks: Sam3ImageOutput[];
  /** Per-mask metadata */
  metadata?: Sam3MaskMetadata[];
  /** Confidence scores (when include_scores=true) */
  scores?: number[][];
  /** Bounding boxes (when include_boxes=true) */
  boxes?: number[][][];
}

// ============================================
// Convenience Types
// ============================================

/**
 * Segmentation mode for UI selection
 */
export type Sam3SegmentationMode = "text" | "point" | "box" | "auto";

/**
 * Simplified result for UI consumption
 */
export interface Sam3SegmentationResult {
  /** Job/request ID */
  jobId: string;
  /** Status of the operation */
  status: "processing" | "completed" | "failed";
  /** Error message if failed */
  error?: string;
  /** Masked image URL */
  maskedImageUrl?: string;
  /** Individual mask URLs */
  maskUrls: string[];
  /** Confidence scores per mask */
  scores?: number[];
  /** Processing time in ms */
  processingTime?: number;
}

/**
 * Progress callback for segmentation operations
 */
export type Sam3ProgressCallback = (status: {
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  message?: string;
  elapsedTime?: number;
}) => void;
```

#### Subtask 3.2: CREATE SAM-3 client service
- **File**: `qcut/apps/web/src/lib/sam3-client.ts`
- **Action**: CREATE
- **Pattern**: Follow `video-edit-client.ts` (class-based singleton with queue polling)
- **Content**:
```typescript
/**
 * SAM-3 Segmentation Client
 *
 * WHY this client:
 * - Centralized FAL API integration for SAM-3 segmentation
 * - Handles authentication, queue polling, and error recovery
 * - Follows pattern from video-edit-client.ts and image-edit-client.ts
 *
 * Performance: Direct client-to-FAL reduces latency vs backend proxy
 *
 * @module Sam3Client
 */

import { handleAIServiceError } from "./error-handler";
import { debugLogger } from "./debug-logger";
import type {
  Sam3Input,
  Sam3Output,
  Sam3PointPrompt,
  Sam3BoxPrompt,
  Sam3SegmentationResult,
  Sam3ProgressCallback,
} from "@/types/sam3";

const FAL_API_KEY = import.meta.env.VITE_FAL_API_KEY;
const FAL_API_BASE = "https://fal.run";
const SAM3_ENDPOINT = "fal-ai/sam-3/image";
const SAM3_LOG_COMPONENT = "Sam3Client";

/**
 * SAM-3 Segmentation Client
 * Singleton pattern for consistent FAL configuration
 */
class Sam3Client {
  private apiKey: string | null = null;

  constructor() {
    this.initializeApiKey();
  }

  /**
   * Initialize API key from environment or Electron storage
   */
  private async initializeApiKey(): Promise<void> {
    // Try environment variable first
    this.apiKey = FAL_API_KEY || null;

    // Try Electron API if available
    if (!this.apiKey && typeof window !== "undefined" && window.electronAPI?.apiKeys) {
      try {
        const keys = await window.electronAPI.apiKeys.get();
        if (keys?.falApiKey) {
          this.apiKey = keys.falApiKey;
        }
      } catch (error) {
        debugLogger.error(SAM3_LOG_COMPONENT, "API_KEY_LOAD_FAILED", error);
      }
    }
  }

  /**
   * Ensure API key is available
   */
  private async ensureApiKey(): Promise<void> {
    if (!this.apiKey) {
      await this.initializeApiKey();
    }
    if (!this.apiKey) {
      throw new Error("FAL API key not configured. Set VITE_FAL_API_KEY or configure in Settings.");
    }
  }

  /**
   * Segment image with SAM-3
   *
   * @param input - SAM-3 input parameters
   * @param onProgress - Optional progress callback
   * @returns Segmentation output with masks
   */
  async segmentImage(
    input: Sam3Input,
    onProgress?: Sam3ProgressCallback
  ): Promise<Sam3Output> {
    await this.ensureApiKey();

    const startTime = Date.now();

    debugLogger.log(SAM3_LOG_COMPONENT, "SEGMENT_START", {
      hasTextPrompt: !!input.text_prompt,
      pointCount: input.prompts?.length || 0,
      boxCount: input.box_prompts?.length || 0,
    });

    if (onProgress) {
      onProgress({
        status: "queued",
        progress: 0,
        message: "Submitting to SAM-3...",
        elapsedTime: 0,
      });
    }

    try {
      const response = await fetch(`${FAL_API_BASE}/${SAM3_ENDPOINT}`, {
        method: "POST",
        headers: {
          "Authorization": `Key ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-Fal-Queue": "true",
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        handleAIServiceError(
          new Error(`SAM-3 API Error: ${response.status}`),
          "SAM-3 segmentation request",
          { status: response.status, errorData }
        );
        throw new Error(`API error: ${response.status} - ${errorData.detail || response.statusText}`);
      }

      const result = await response.json();

      // Handle queue mode
      if (result.request_id) {
        return await this.pollForResult(result.request_id, startTime, onProgress);
      }

      // Direct result
      if (onProgress) {
        onProgress({
          status: "completed",
          progress: 100,
          message: "Segmentation complete",
          elapsedTime: Math.floor((Date.now() - startTime) / 1000),
        });
      }

      return result as Sam3Output;
    } catch (error) {
      handleAIServiceError(error, "SAM-3 segmentation", { operation: "segmentImage" });
      throw error;
    }
  }

  /**
   * Poll for queued job result
   */
  private async pollForResult(
    requestId: string,
    startTime: number,
    onProgress?: Sam3ProgressCallback
  ): Promise<Sam3Output> {
    const maxAttempts = 60; // 5 minutes max
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      const elapsedTime = Math.floor((Date.now() - startTime) / 1000);

      try {
        const statusResponse = await fetch(
          `${FAL_API_BASE}/queue/requests/${requestId}/status`,
          {
            headers: { "Authorization": `Key ${this.apiKey}` },
          }
        );

        if (!statusResponse.ok) {
          await this.sleep(5000);
          continue;
        }

        const status = await statusResponse.json();

        if (onProgress) {
          onProgress({
            status: status.status === "IN_PROGRESS" ? "processing" : "queued",
            progress: Math.min(90, 10 + attempts * 3),
            message: status.status === "IN_PROGRESS" ? "Processing..." : `Queued (position: ${status.queue_position || "unknown"})`,
            elapsedTime,
          });
        }

        if (status.status === "COMPLETED") {
          const resultResponse = await fetch(
            `${FAL_API_BASE}/queue/requests/${requestId}`,
            {
              headers: { "Authorization": `Key ${this.apiKey}` },
            }
          );

          if (resultResponse.ok) {
            const result = await resultResponse.json();

            if (onProgress) {
              onProgress({
                status: "completed",
                progress: 100,
                message: "Segmentation complete",
                elapsedTime,
              });
            }

            return result as Sam3Output;
          }
        }

        if (status.status === "FAILED") {
          throw new Error(status.error || "Segmentation failed");
        }

        await this.sleep(5000);
      } catch (error) {
        if (attempts >= maxAttempts) {
          throw new Error("Segmentation timeout - maximum polling attempts reached");
        }
        await this.sleep(5000);
      }
    }

    throw new Error("Maximum polling attempts reached");
  }

  /**
   * Convenience: Segment with text prompt
   */
  async segmentWithText(
    imageUrl: string,
    textPrompt: string,
    options?: Partial<Omit<Sam3Input, "image_url" | "text_prompt">>
  ): Promise<Sam3Output> {
    return this.segmentImage({
      image_url: imageUrl,
      text_prompt: textPrompt,
      ...options,
    });
  }

  /**
   * Convenience: Segment with point prompts
   */
  async segmentWithPoints(
    imageUrl: string,
    points: Sam3PointPrompt[],
    options?: Partial<Omit<Sam3Input, "image_url" | "prompts">>
  ): Promise<Sam3Output> {
    return this.segmentImage({
      image_url: imageUrl,
      prompts: points,
      ...options,
    });
  }

  /**
   * Convenience: Segment with box prompt
   */
  async segmentWithBox(
    imageUrl: string,
    box: Sam3BoxPrompt,
    options?: Partial<Omit<Sam3Input, "image_url" | "box_prompts">>
  ): Promise<Sam3Output> {
    return this.segmentImage({
      image_url: imageUrl,
      box_prompts: [box],
      ...options,
    });
  }

  /**
   * Check if client is configured
   */
  async isAvailable(): Promise<boolean> {
    await this.initializeApiKey();
    return !!this.apiKey;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const sam3Client = new Sam3Client();

// Export convenience functions
export async function segmentImage(
  input: Sam3Input,
  onProgress?: Sam3ProgressCallback
): Promise<Sam3Output> {
  return sam3Client.segmentImage(input, onProgress);
}

export async function segmentWithText(
  imageUrl: string,
  textPrompt: string,
  options?: Partial<Omit<Sam3Input, "image_url" | "text_prompt">>
): Promise<Sam3Output> {
  return sam3Client.segmentWithText(imageUrl, textPrompt, options);
}

export async function segmentWithPoints(
  imageUrl: string,
  points: Sam3PointPrompt[],
  options?: Partial<Omit<Sam3Input, "image_url" | "prompts">>
): Promise<Sam3Output> {
  return sam3Client.segmentWithPoints(imageUrl, points, options);
}

export async function segmentWithBox(
  imageUrl: string,
  box: Sam3BoxPrompt,
  options?: Partial<Omit<Sam3Input, "image_url" | "box_prompts">>
): Promise<Sam3Output> {
  return sam3Client.segmentWithBox(imageUrl, box, options);
}
```

#### Subtask 3.3: ADD SAM-3 model catalog (optional, for future UI)
- **File**: `qcut/apps/web/src/lib/sam3-models.ts`
- **Action**: CREATE (optional - for future model selection UI)
- **Pattern**: Follow `upscale-models.ts` structure
- **Content**:
```typescript
/**
 * SAM-3 Model Catalog
 *
 * Single source of truth for SAM-3 model configuration.
 * Follows upscale-models.ts pattern for consistency.
 *
 * @module Sam3Models
 */

export const SAM3_MODEL_INFO = {
  id: "sam-3",
  name: "SAM-3 (Segment Anything 3)",
  description: "Meta's state-of-the-art image segmentation model with text, point, and box prompts",
  provider: "fal.ai (Meta)",
  endpoint: "fal-ai/sam-3/image",

  priceTier: "budget" as const,
  estimatedCost: "$0.005 / request",
  costPerRequest: 0.005,

  qualityRating: 5,
  speedRating: 4,

  features: {
    textPrompt: true,
    pointPrompt: true,
    boxPrompt: true,
    multipleMasks: true,
    confidenceScores: true,
    boundingBoxes: true,
  },

  bestFor: [
    "Object isolation",
    "Background removal",
    "Interactive selection",
    "Batch segmentation",
  ],

  strengths: [
    "Extremely cost-effective ($0.005/request)",
    "Multiple prompt types (text, point, box)",
    "Returns multiple mask options",
    "Confidence scores for quality assessment",
  ],

  limitations: [
    "Requires clear object boundaries",
    "May struggle with heavily occluded objects",
    "Text prompts work best for common objects",
  ],
} as const;

export type Sam3ModelInfo = typeof SAM3_MODEL_INFO;
```

#### Subtask 3.4: EXPORT SAM-3 types from ai-generation.ts
- **File**: `qcut/apps/web/src/types/ai-generation.ts`
- **Action**: MODIFY
- **Location**: End of file (after line ~152)
- **Add**:
```typescript
// ============================================
// SAM-3 Segmentation Types (re-export)
// ============================================
export type {
  Sam3Input,
  Sam3Output,
  Sam3PointPrompt,
  Sam3BoxPrompt,
  Sam3ImageOutput,
  Sam3MaskMetadata,
  Sam3SegmentationMode,
  Sam3SegmentationResult,
  Sam3ProgressCallback,
} from "./sam3";
```

---

## Summary of Changes

### Files to CREATE (3 new files)
| File | Purpose | Pattern Followed |
|------|---------|------------------|
| `qcut/apps/web/src/types/sam3.ts` | SAM-3 TypeScript interfaces | `sora2.ts`, `nano-edit.ts` |
| `qcut/apps/web/src/lib/sam3-client.ts` | SAM-3 API client service | `video-edit-client.ts` |
| `qcut/apps/web/src/lib/sam3-models.ts` | SAM-3 model catalog (optional) | `upscale-models.ts` |

### Files to MODIFY (4 existing files)
| File | Changes | Lines Affected |
|------|---------|----------------|
| `qcut/apps/web/src/lib/text2image-models.ts` | Add Gemini 3 Pro config, update order & categories | ~657, ~736, ~813 |
| `qcut/apps/web/src/lib/image-edit-client.ts` | Add Gemini 3 Pro Edit endpoint & model info | ~17, ~35, ~126, ~234, ~276, ~838 |
| `qcut/apps/web/src/lib/fal-ai-client.ts` | Add Gemini 3 Pro parameter conversion | ~432 |
| `qcut/apps/web/src/types/ai-generation.ts` | Re-export SAM-3 types | ~152 |

---

## Implementation Order

### Phase 1: Gemini 3 Pro Text-to-Image (Subtasks 1.1-1.4) ✅ COMPLETED
**Estimated complexity**: Low (follows existing pattern exactly)
1. ✅ Add model config to `TEXT2IMAGE_MODELS` - Line 732-835
2. ✅ Update `TEXT2IMAGE_MODEL_ORDER` array - Line 847
3. ✅ Update `MODEL_CATEGORIES` object - Lines 920, 934
4. ✅ Add parameter conversion case - Lines 551-557

### Phase 2: Gemini 3 Pro Edit (Subtasks 2.1-2.6) ✅ COMPLETED
**Estimated complexity**: Low-Medium (minor type additions)
1. ✅ Add model to `ImageEditRequest` type union - Line 24
2. ✅ Add `resolution` and `aspectRatio` parameters - Lines 38-40
3. ✅ Add endpoint config to `MODEL_ENDPOINTS` - Lines 133-143
4. ✅ Update `image_urls` handling condition - Line 251
5. ✅ Add payload parameter handling - Lines 295-301
6. ✅ Add to `getImageEditModels()` list - Lines 864-908

### Phase 3: SAM-3 Segmentation (Subtasks 3.1-3.4)
**Estimated complexity**: Medium (new domain, but follows patterns)
1. Create `sam3.ts` types file
2. Create `sam3-client.ts` client service
3. Create `sam3-models.ts` catalog (optional)
4. Re-export types from `ai-generation.ts`

---

## Testing Checklist

### Gemini 3 Pro Text-to-Image
- [ ] Model appears in text-to-image model list
- [ ] Model appears in `PHOTOREALISTIC` and `HIGH_QUALITY` categories
- [ ] Generation works with default parameters
- [ ] Aspect ratio mapping works correctly
- [ ] Resolution parameter (1K/2K/4K) works
- [ ] Error handling for API failures

### Gemini 3 Pro Edit
- [ ] Model appears in image edit model list
- [ ] Editing works with `image_urls` array format
- [ ] Resolution parameter works
- [ ] Aspect ratio parameter works
- [ ] Error handling for API failures

### SAM-3 Segmentation
- [ ] `segmentWithText()` segments by text prompt
- [ ] `segmentWithPoints()` segments by click points
- [ ] `segmentWithBox()` segments by bounding box
- [ ] Queue polling works correctly
- [ ] Progress callback receives updates
- [ ] Multiple masks returned when requested
- [ ] Error handling for API failures
- [ ] API key validation works

---

## Long-term Maintainability Considerations

### Code Organization
- Types in `src/types/` with domain-specific files
- Clients in `src/lib/` following singleton pattern
- Model catalogs as single source of truth

### Extensibility
- SAM-3 client designed for future UI integration
- Model catalog ready for additional segmentation models
- Progress callbacks for UI feedback

### Testing Strategy
- Follow existing test patterns in `__tests__/` directories
- Mock FAL API responses
- Test error handling paths

### Documentation
- JSDoc comments on all public interfaces
- WHY comments explaining design decisions
- Module-level documentation blocks
