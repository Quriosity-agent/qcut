# FAL Service Failure Analysis - Nano Banana Model

**Generated**: 2025-11-14
**Status**: Critical Bug
**Priority**: High
**Affected Feature**: Text-to-Image Generation

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Error Overview](#error-overview)
3. [Detailed Error Analysis](#detailed-error-analysis)
4. [Root Cause Analysis](#root-cause-analysis)
5. [Request/Response Flow](#requestresponse-flow)
6. [Console Messages Breakdown](#console-messages-breakdown)
7. [Code Analysis](#code-analysis)
8. [How to Fix](#how-to-fix)
9. [Prevention Strategies](#prevention-strategies)

---

## Executive Summary

**The Problem**: The "Nano Banana" model is failing with HTTP 422 errors when users attempt to generate images from text prompts.

**Root Cause**: **Nano Banana is an image EDITING model**, not a text-to-image generation model. It requires input images (`image_urls` parameter) to edit, but the text-to-image generation flow doesn't provide any input images, causing the FAL API to reject the request.

**Impact**:
- Users cannot generate images using the Nano Banana model
- Misleading error messages ("Field required" without specifying which field)
- Poor user experience with failed generations

**Fix Required**: Either:
1. **Remove Nano Banana from text-to-image model list** (recommended)
2. **Create separate UI for image editing** using Nano Banana
3. **Add validation** to prevent selecting edit models for text-to-image generation

---

## Error Overview

### Error Signature

**From console2.md:**

```
Line 83:  POST https://fal.run/fal-ai/nano-banana/edit 422 (Unprocessable Content)

Line 108-120: 🚨 Error ERR-1763096447978-K9Q9E5 [MEDIUM]
              Operation: FAL AI API request
              Category: ai_service
              Original Error: Error: FAL AI API request failed: 422

Line 186-198: 🚨 Error ERR-1763096447980-8TJUMG [MEDIUM]
              Operation: Generate image with FAL AI model
              Original Error: Error: Field required

Line 185: Metadata: {
            status: 422,
            statusText: '',
            errorData: {...},
            endpoint: 'https://fal.run/fal-ai/nano-banana/edit',
            operation: 'makeRequest'
          }

Line 261: Metadata: {
            modelKey: 'nano-banana',
            operation: 'generateWithModel'
          }
```

### Error Characteristics

| Property | Value |
|----------|-------|
| **HTTP Status** | 422 Unprocessable Content |
| **Endpoint** | `https://fal.run/fal-ai/nano-banana/edit` |
| **Error Type** | Validation Error |
| **Error Message** | "Field required" |
| **Missing Field** | `image_urls` (not explicitly stated in error) |
| **Operation** | Text-to-Image Generation (incorrect usage) |

---

## Detailed Error Analysis

### What is HTTP 422?

**422 Unprocessable Content** means:
- The server understood the request syntax (not a 400 Bad Request)
- The request payload structure is valid JSON
- **BUT the semantic validation failed** - required fields are missing or invalid

### The "Field Required" Error

The error message "Field required" is vague and doesn't specify which field. By analyzing the Nano Banana API specification and code:

**Required Field for Nano Banana Edit Endpoint:**
```typescript
{
  image_urls: string[];  // ❌ MISSING - This is the problem!
  prompt: string;         // ✅ Provided
  num_images?: number;    // ✅ Provided (default: 1)
  output_format?: string; // ✅ Provided (default: "png")
  sync_mode?: boolean;    // ✅ Provided (default: false)
}
```

**What the code is sending:**
```typescript
{
  prompt: "user's text prompt",
  num_images: 1,
  output_format: "png",
  sync_mode: false,
  image_size: "square_hd",  // ⚠️ Not used by edit endpoint
  seed: 12345               // ⚠️ Optional parameter
  // ❌ image_urls is MISSING!
}
```

---

## Root Cause Analysis

### Model Categorization Error

**Nano Banana Model Configuration** (`text2image-models.ts:581-640`):

```typescript
"nano-banana": {
  id: "nano-banana",
  name: "Nano Banana",
  description: "Google/Gemini-powered smart image editing with cost-effective pricing",
  provider: "Google",
  endpoint: "https://fal.run/fal-ai/nano-banana/edit",  // ⚠️ EDIT endpoint!

  // ... more config

  availableParams: [
    {
      name: "num_images",
      type: "number",
      min: 1,
      max: 4,
      default: 1,
      description: "Number of output images to generate",
    },
    {
      name: "output_format",
      type: "select",
      options: ["jpeg", "png"],
      default: "png",
      description: "Output image format",
    },
    // ⚠️ NOTICE: No "image_urls" parameter listed, but it's required!
  ],

  bestFor: [
    "Multi-image editing",           // ← Image EDITING
    "Complex image transformations", // ← Image EDITING
    "Advanced content modification", // ← Image EDITING
    "Batch image processing",        // ← Image EDITING
  ],
}
```

### The Fundamental Problem

**Nano Banana is listed in `TEXT2IMAGE_MODELS`** but:
- ❌ It's NOT a text-to-image model
- ✅ It IS an image-to-image editing model
- ❌ The endpoint URL clearly says `/edit`
- ❌ The `bestFor` list describes EDITING use cases

**This is a model categorization error.**

---

## Request/Response Flow

### Call Stack Analysis (from console2.md)

```
User Action: Click "Generate" button in Text2Image UI
  ↓
text2image.tsx:161 - Z() function called
  ↓
text2image-store.ts:361 - generateImages() called
  ↓
fal-ai-client.ts:1487 - zx() function (unknown purpose)
  ↓
fal-ai-client.ts:604 - generateWithMultipleModels()
  ↓
fal-ai-client.ts:605 - Promise.allSettled() for parallel generation
  ↓
fal-ai-client.ts:548 - generateWithModel(modelKey: "nano-banana", ...)
  ↓
fal-ai-client.ts:538 - convertSettingsToParams() - Creates request params
  ↓
fal-ai-client.ts:223 - makeRequest(endpoint, params)
  ↓
Line 223-230: fetch() POST to "https://fal.run/fal-ai/nano-banana/edit"
  ↓
❌ HTTP 422 Response - Field required (image_urls missing)
  ↓
Line 237-249: Error handling - logs error and throws
  ↓
Line 580: catch block in generateWithModel()
  ↓
handleAIServiceError() logs error ERR-1763096447980-8TJUMG
```

### Timeline of Events

1. **0ms** - User enters prompt and clicks Generate
2. **~50ms** - Text2Image store calls FAL AI client with selected models
3. **~100ms** - generateWithMultipleModels creates parallel promises
4. **~150ms** - For nano-banana model:
   - convertSettingsToParams creates params object
   - Params include: `{prompt, num_images, output_format, sync_mode, image_size, seed}`
   - **Missing**: `image_urls` field
5. **~200ms** - HTTP POST sent to FAL API
6. **~500ms** - FAL API validates request, finds missing required field
7. **~550ms** - HTTP 422 response returned
8. **~600ms** - Error handler catches and logs two errors:
   - ERR-1763096447978-K9Q9E5: "FAL AI API request failed: 422"
   - ERR-1763096447980-8TJUMG: "Field required"

---

## Console Messages Breakdown

### Initialization Messages (Lines 1-17)

```
[BlobUrlDebug] Blob URL debugging enabled
[BlobUrlCleanup] Starting blob URL cleanup migration...
🐛 Sticker overlay debug utilities loaded
config.js:67 The fal credentials are exposed in the browser's environment.
```

**Status**: ✅ Normal startup - no issues

---

### React Warning (Lines 18-82)

```
Warning: Function components cannot be given refs.
Check the render method of `Primitive.button.SlotClone`.
```

**Status**: ⚠️ UI library issue - not related to FAL failure (see console-errors-analysis.md)

---

### First FAL API Error (Lines 83-148)

**Line 83:** The actual HTTP request failure
```
POST https://fal.run/fal-ai/nano-banana/edit 422 (Unprocessable Content)
```

**Lines 108-120:** Error handler logs the failure
```javascript
// error-handler.ts:145
🚨 Error ERR-1763096447978-K9Q9E5 [MEDIUM]
Timestamp: 2025-11-14T05:00:47.978Z
Operation: FAL AI API request
Category: ai_service
Severity: medium
Original Error: Error: FAL AI API request failed: 422
```

**Stack trace** (lines 114-120):
```
at Vx.makeRequest (fal-ai-client.ts:240:9)
at async Vx.generateWithModel (fal-ai-client.ts:548:24)
at async fal-ai-client.ts:605:22
at async Promise.allSettled (index 0)
at async Vx.generateWithMultipleModels (fal-ai-client.ts:611:23)
at async generateImages (text2image-store.ts:361:27)
at async Z (text2image.tsx:161:7)
```

**Line 185:** Error metadata reveals details
```javascript
Metadata: {
  status: 422,
  statusText: '',
  errorData: {...},  // Contains the "Field required" message
  endpoint: 'https://fal.run/fal-ai/nano-banana/edit',
  operation: 'makeRequest'
}
```

---

### Second FAL API Error (Lines 186-260)

**Lines 186-198:** Second error handler invocation
```javascript
🚨 Error ERR-1763096447980-8TJUMG [MEDIUM]
Timestamp: 2025-11-14T05:00:47.980Z
Operation: Generate image with FAL AI model
Category: ai_service
Severity: medium
Original Error: Error: Field required  // ← This is the actual API error message
```

**Line 261:** Model-specific metadata
```javascript
Metadata: {
  modelKey: 'nano-banana',
  operation: 'generateWithModel'
}
```

**Why two errors?**
1. **First error**: Thrown by `makeRequest()` when HTTP 422 is received
2. **Second error**: Caught and re-logged by `generateWithModel()` catch block with additional context

---

### Generation Completed (Line 262)

```
text2image.tsx:162 Generation completed
```

**Status**: ⚠️ Misleading - generation "completed" with failures, not success

---

## Code Analysis

### File: `fal-ai-client.ts`

#### Issue 1: convertSettingsToParams() - Missing image_urls

**Location**: `fal-ai-client.ts:374-524`

```typescript
private convertSettingsToParams(
  model: Text2ImageModel,
  prompt: string,
  settings: GenerationSettings
): Record<string, any> {
  const params: Record<string, any> = {
    prompt,
    ...model.defaultParams,  // Spreads: {num_images: 1, output_format: "png", sync_mode: false}
  };

  // Add seed if provided
  if (settings.seed !== undefined && settings.seed !== null) {
    params.seed = settings.seed;
  }

  // Convert generic settings to model-specific parameters
  switch (model.id) {
    // ... other models ...

    case "nano-banana":
      // ❌ PROBLEM: Only sets image_size, doesn't add image_urls
      params.image_size = settings.imageSize;
      break;
  }

  // Add output_format
  const supportsOutputFormat = model.availableParams.some(
    (param) => param.name === "output_format"
  );
  if (supportsOutputFormat) {
    params.output_format = normalizeOutputFormat(settings.outputFormat);
  }

  return params;
  // ❌ Result for nano-banana: {prompt, num_images, output_format, sync_mode, image_size, seed}
  // ❌ Missing: image_urls (REQUIRED by edit endpoint)
}
```

**Problem**: The function is designed for text-to-image models, not image editing models.

---

#### Issue 2: makeRequest() - Generic error message

**Location**: `fal-ai-client.ts:237-274`

```typescript
if (!response.ok) {
  const errorData = await response.json().catch(() => ({}));

  handleAIServiceError(
    new Error(`FAL AI API request failed: ${response.status}`),
    "FAL AI API request",
    { status: response.status, statusText: response.statusText, errorData }
  );

  // Handle different error response formats
  let errorMessage = `API request failed: ${response.status}`;

  if (errorData.error) {
    errorMessage = /* parse error */;
  } else if (errorData.detail) {
    if (Array.isArray(errorData.detail)) {
      // ⚠️ Validation errors are typically here
      errorMessage = errorData.detail
        .map((d: any) => d.msg || JSON.stringify(d))
        .join(", ");
    }
  }

  throw new Error(errorMessage);  // ← Throws "Field required" (not very helpful)
}
```

**Problem**: The error message doesn't specify WHICH field is required.

**Better error message would be**:
```
Error: Field 'image_urls' is required for nano-banana edit endpoint.
This model performs image editing, not text-to-image generation.
```

---

#### Issue 3: convertNanoBananaParameters() - Designed for editing

**Location**: `fal-ai-client.ts:1349-1396`

```typescript
function convertNanoBananaParameters(params: any) {
  // Sanitize and validate image URLs - limit to max 10 URLs
  const urls = (params.image_urls ??
    (params.imageUrl ? [params.imageUrl] : [])) as string[];
  const imageUrls = Array.isArray(urls) ? urls.slice(0, 10) : [];
  // ⚠️ If no image_urls provided, imageUrls = []

  const numImages = Math.max(1, Math.min(4, Number(params.num_images ?? 1)));
  const outputFormat = normalizeOutputFormat(params.output_format, "png");
  const syncMode = Boolean(params.sync_mode ?? false);
  const prompt = params.prompt || "";

  return {
    image_urls: imageUrls,  // ← Returns empty array [] if no images provided
    prompt,
    num_images: numImages,
    output_format: outputFormat,
    sync_mode: syncMode,
  };
}
```

**Problem**: This function IS designed for image editing (expects `image_urls`), but it's never called in the text-to-image generation flow.

**Where it's called**: Line 1242 in `convertParametersForModel()`, which is likely used for a different feature (actual image editing).

---

### File: `text2image-models.ts`

#### Issue 4: Nano Banana in TEXT2IMAGE_MODELS

**Location**: `text2image-models.ts:581-640`

```typescript
export const TEXT2IMAGE_MODELS: Record<string, Text2ImageModel> = {
  // ... other models ...

  "nano-banana": {  // ❌ WRONG CATEGORY
    id: "nano-banana",
    name: "Nano Banana",
    description: "Google/Gemini-powered smart image editing",  // ← Says "EDITING"
    endpoint: "https://fal.run/fal-ai/nano-banana/edit",        // ← /edit endpoint

    bestFor: [
      "Multi-image editing",           // ← All EDITING use cases
      "Complex image transformations",
      "Advanced content modification",
      "Batch image processing",
    ],
  },
};
```

**Problem**: This model should be in an `IMAGE_EDIT_MODELS` collection, not `TEXT2IMAGE_MODELS`.

---

### File: `text2image-store.ts`

#### Issue 5: No model validation

**Location**: `text2image-store.ts:355-365`

```typescript
// Generate with all selected models in parallel
const results = await generateWithMultipleModels(
  selectedModels,  // ← No validation that these are text-to-image models
  prompt,
  settings
);
```

**Problem**: No validation to ensure selected models support text-to-image generation.

**Should add**:
```typescript
// Filter out image-editing models
const validModels = selectedModels.filter(modelKey => {
  const model = TEXT2IMAGE_MODELS[modelKey];
  return !model.endpoint.includes('/edit');  // Exclude editing endpoints
});

if (validModels.length === 0) {
  throw new Error("No valid text-to-image models selected");
}

const results = await generateWithMultipleModels(validModels, prompt, settings);
```

---

## How to Fix

### Solution 1: Remove Nano Banana from Text2Image Models (RECOMMENDED)

**Effort**: Low (10 minutes)
**Impact**: High (fixes user-facing bug immediately)

**Step 1**: Create a new model collection for image editing

**File**: `qcut/apps/web/src/lib/image-edit-models.ts` (NEW FILE)

```typescript
export interface ImageEditModel {
  id: string;
  name: string;
  description: string;
  provider: string;
  endpoint: string;

  qualityRating: number;
  speedRating: number;
  estimatedCost: string;
  costPerImage: number;

  maxResolution: string;
  supportedAspectRatios: string[];

  defaultParams: Record<string, any>;
  availableParams: Array<{
    name: string;
    type: "number" | "string" | "boolean" | "select";
    min?: number;
    max?: number;
    options?: string[];
    default: any;
    description: string;
  }>;

  bestFor: string[];
  strengths: string[];
  limitations: string[];
}

export const IMAGE_EDIT_MODELS: Record<string, ImageEditModel> = {
  "nano-banana": {
    // Move the nano-banana config here from TEXT2IMAGE_MODELS
    id: "nano-banana",
    name: "Nano Banana",
    description: "Google/Gemini-powered smart image editing with cost-effective pricing",
    provider: "Google",
    endpoint: "https://fal.run/fal-ai/nano-banana/edit",

    qualityRating: 4,
    speedRating: 5,
    estimatedCost: "$0.039",
    costPerImage: 3.9,
    maxResolution: "2048x2048",
    supportedAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],

    defaultParams: {
      num_images: 1,
      output_format: "png",
      sync_mode: false,
    },

    availableParams: [
      {
        name: "image_urls",  // ← ADD THIS!
        type: "array",
        min: 1,
        max: 10,
        default: [],
        description: "Input images to edit (required)",
      },
      {
        name: "num_images",
        type: "number",
        min: 1,
        max: 4,
        default: 1,
        description: "Number of output images to generate",
      },
      {
        name: "output_format",
        type: "select",
        options: ["jpeg", "png"],
        default: "png",
        description: "Output image format",
      },
      {
        name: "sync_mode",
        type: "boolean",
        default: false,
        description: "Wait for all images to complete before returning",
      },
    ],

    bestFor: [
      "Multi-image editing",
      "Complex image transformations",
      "Advanced content modification",
      "Batch image processing",
    ],

    strengths: [
      "Cost-effective pricing",
      "Fast processing",
      "High-quality results",
      "Batch processing support",
    ],

    limitations: [
      "Requires input images",
      "Not suitable for text-to-image generation",
      "Limited to 10 input images max",
    ],
  },
};
```

**Step 2**: Remove nano-banana from TEXT2IMAGE_MODELS

**File**: `qcut/apps/web/src/lib/text2image-models.ts`

```typescript
export const TEXT2IMAGE_MODELS: Record<string, Text2ImageModel> = {
  "imagen4-ultra": { /* ... */ },
  "seeddream-v3": { /* ... */ },
  "seeddream-v4": { /* ... */ },
  // ... other text-to-image models ...

  // ❌ REMOVE THIS:
  // "nano-banana": { /* ... */ },
};
```

**Step 3**: Update UI to only show text-to-image models

**File**: `qcut/apps/web/src/components/editor/media-panel/views/text2image.tsx`

Ensure the model selector only shows models from `TEXT2IMAGE_MODELS`:

```typescript
import { TEXT2IMAGE_MODELS } from "@/lib/text2image-models";
// Don't import IMAGE_EDIT_MODELS here

const availableModels = Object.entries(TEXT2IMAGE_MODELS).map(([key, model]) => ({
  value: key,
  label: model.name,
  description: model.description,
}));
```

---

### Solution 2: Add Validation to Prevent Editing Models in Text2Image Flow

**Effort**: Medium (30 minutes)
**Impact**: Medium (prevents future categorization errors)

**File**: `qcut/apps/web/src/lib/fal-ai-client.ts`

Add validation in `generateWithModel()`:

```typescript
async generateWithModel(
  modelKey: string,
  prompt: string,
  settings: GenerationSettings
): Promise<GenerationResult> {
  try {
    const model = TEXT2IMAGE_MODELS[modelKey];
    if (!model) {
      throw new Error(`Unknown model: ${modelKey}`);
    }

    // ✅ ADD THIS VALIDATION:
    if (model.endpoint.includes('/edit')) {
      throw new Error(
        `Model "${model.name}" is an image editing model, not a text-to-image model. ` +
        `Please use the image editor to use this model.`
      );
    }

    const params = this.convertSettingsToParams(model, prompt, settings);
    // ... rest of function
  }
}
```

---

### Solution 3: Create Dedicated Image Editing UI

**Effort**: High (4-8 hours)
**Impact**: High (unlocks new feature - image editing)

**Create new component**: `qcut/apps/web/src/components/editor/media-panel/views/image-edit.tsx`

```typescript
import { IMAGE_EDIT_MODELS } from "@/lib/image-edit-models";
import { useImageEditStore } from "@/stores/image-edit-store";

export function ImageEditPanel() {
  const {
    selectedImages,
    selectedModel,
    prompt,
    setPrompt,
    editImages,
  } = useImageEditStore();

  const handleEdit = async () => {
    if (selectedImages.length === 0) {
      toast.error("Please select at least one image to edit");
      return;
    }

    if (!prompt.trim()) {
      toast.error("Please enter an edit prompt");
      return;
    }

    await editImages(selectedModel, prompt, selectedImages);
  };

  return (
    <div className="flex flex-col gap-4">
      <h2>Image Editor</h2>

      {/* Image selector */}
      <ImageSelector
        selected={selectedImages}
        onSelect={setSelectedImages}
        maxImages={10}
      />

      {/* Model selector */}
      <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
        {Object.entries(IMAGE_EDIT_MODELS).map(([key, model]) => (
          <option key={key} value={key}>{model.name}</option>
        ))}
      </select>

      {/* Edit prompt */}
      <textarea
        placeholder="Describe the changes you want to make..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {/* Edit button */}
      <button onClick={handleEdit}>
        Edit Images
      </button>
    </div>
  );
}
```

---

### Solution 4: Enhanced Error Messages

**Effort**: Low (15 minutes)
**Impact**: Medium (better developer debugging)

**File**: `qcut/apps/web/src/lib/fal-ai-client.ts:237-274`

```typescript
if (!response.ok) {
  const errorData = await response.json().catch(() => ({}));

  // ✅ Enhanced error parsing
  let errorMessage = `API request failed: ${response.status}`;
  let missingFields: string[] = [];

  if (errorData.detail && Array.isArray(errorData.detail)) {
    // Parse validation errors to extract field names
    missingFields = errorData.detail
      .filter((d: any) => d.type === "missing" || d.msg?.includes("required"))
      .map((d: any) => d.loc?.[d.loc.length - 1] || d.field)
      .filter(Boolean);

    errorMessage = errorData.detail
      .map((d: any) => {
        if (d.loc && d.msg) {
          const field = d.loc[d.loc.length - 1];
          return `Field '${field}': ${d.msg}`;
        }
        return d.msg || JSON.stringify(d);
      })
      .join(", ");
  }

  // ✅ Add helpful context for image editing models
  if (missingFields.includes("image_urls")) {
    const model = TEXT2IMAGE_MODELS[modelKey];
    if (model?.endpoint.includes('/edit')) {
      errorMessage += `\n\nℹ️ "${model.name}" is an image editing model, not a text-to-image model. ` +
        `It requires input images (image_urls) to edit. ` +
        `Please use a different model for text-to-image generation, or use the image editor.`;
    }
  }

  handleAIServiceError(
    new Error(errorMessage),
    "FAL AI API request",
    {
      status: response.status,
      statusText: response.statusText,
      errorData,
      endpoint: requestUrl,
      operation: "makeRequest",
      missingFields,  // ← Add this for debugging
    }
  );

  throw new Error(errorMessage);
}
```

---

## Prevention Strategies

### 1. Model Categorization System

Create a type-safe model categorization system:

```typescript
// model-types.ts
export type ModelCategory = "text-to-image" | "image-edit" | "text-to-video" | "image-to-video";

export interface BaseModel {
  id: string;
  name: string;
  category: ModelCategory;  // ← Force explicit categorization
  endpoint: string;
  // ... other common fields
}

export interface Text2ImageModel extends BaseModel {
  category: "text-to-image";
  requiredInputs: ["prompt"];
}

export interface ImageEditModel extends BaseModel {
  category: "image-edit";
  requiredInputs: ["image_urls", "prompt"];
}
```

### 2. Runtime Validation

Add runtime checks to ensure models are used correctly:

```typescript
function validateModelForOperation(
  model: BaseModel,
  operation: "generate" | "edit" | "animate"
): void {
  const validCategories: Record<string, ModelCategory[]> = {
    generate: ["text-to-image", "text-to-video"],
    edit: ["image-edit"],
    animate: ["image-to-video"],
  };

  if (!validCategories[operation].includes(model.category)) {
    throw new Error(
      `Model "${model.name}" (category: ${model.category}) cannot be used for ${operation} operation. ` +
      `Valid categories: ${validCategories[operation].join(", ")}`
    );
  }
}
```

### 3. TypeScript Strict Types

Use TypeScript to prevent wrong model usage at compile time:

```typescript
// Only accept text-to-image models
async function generateFromText(
  model: Text2ImageModel,  // ← Type constraint
  prompt: string
): Promise<GenerationResult> {
  // TypeScript will prevent passing ImageEditModel here
}

// Only accept image-edit models
async function editImage(
  model: ImageEditModel,  // ← Type constraint
  imageUrls: string[],
  prompt: string
): Promise<GenerationResult> {
  // TypeScript will prevent passing Text2ImageModel here
}
```

### 4. Automated Testing

Add tests to catch categorization errors:

```typescript
// fal-ai-client.test.ts
describe("Model categorization", () => {
  it("should only allow text-to-image models in TEXT2IMAGE_MODELS", () => {
    Object.entries(TEXT2IMAGE_MODELS).forEach(([key, model]) => {
      // Check endpoint doesn't contain /edit
      expect(model.endpoint).not.toContain("/edit");

      // Check bestFor doesn't mention editing
      const bestForText = model.bestFor.join(" ").toLowerCase();
      expect(bestForText).not.toContain("edit");
      expect(bestForText).not.toContain("transform");
      expect(bestForText).not.toContain("modify");
    });
  });

  it("should reject image-edit models in generateWithModel", async () => {
    const client = new FalAIClient("test-key");

    // Try to use nano-banana for text-to-image
    await expect(
      client.generateWithModel("nano-banana", "test prompt", { imageSize: "square" })
    ).rejects.toThrow(/image editing model/);
  });
});
```

### 5. Documentation

Add clear documentation to model files:

```typescript
/**
 * TEXT2IMAGE_MODELS
 *
 * ✅ DO include models that:
 * - Generate images from text prompts alone
 * - Don't require input images
 * - Have endpoints like /generate, /create, /text-to-image
 *
 * ❌ DON'T include models that:
 * - Require input images (image editing, img2img)
 * - Have endpoints containing /edit, /transform, /modify
 * - Are designed for image-to-image workflows
 *
 * If a model requires image_urls as input, it belongs in IMAGE_EDIT_MODELS instead.
 */
export const TEXT2IMAGE_MODELS: Record<string, Text2ImageModel> = {
  // ...
};
```

---

## Summary

### Quick Reference Table

| Aspect | Details |
|--------|---------|
| **Error Code** | HTTP 422 Unprocessable Content |
| **Error Message** | "Field required" |
| **Missing Field** | `image_urls` (required for edit endpoint) |
| **Root Cause** | Nano Banana is an image EDITING model in text-to-image model list |
| **Impact** | Users cannot generate images with Nano Banana |
| **Recommended Fix** | Remove from TEXT2IMAGE_MODELS, create IMAGE_EDIT_MODELS |
| **Effort** | 10-30 minutes depending on solution |
| **Priority** | High - user-facing feature broken |

### Action Items

**Immediate (High Priority)**:
1. ✅ Remove nano-banana from TEXT2IMAGE_MODELS
2. ✅ Add validation to reject editing models in text-to-image flow
3. ✅ Improve error messages to specify missing fields

**Short-term (Medium Priority)**:
4. ✅ Create IMAGE_EDIT_MODELS collection
5. ✅ Add tests for model categorization
6. ✅ Document model categorization rules

**Long-term (Low Priority)**:
7. ✅ Build dedicated image editing UI
8. ✅ Implement type-safe model categories
9. ✅ Add runtime validation system

---

## Related Files

**Primary Issue Files**:
- `qcut/apps/web/src/lib/text2image-models.ts:581-640` - Nano Banana miscategorized
- `qcut/apps/web/src/lib/fal-ai-client.ts:374-524` - convertSettingsToParams missing image_urls
- `qcut/apps/web/src/lib/fal-ai-client.ts:237-274` - Generic error messages

**Supporting Files**:
- `qcut/apps/web/src/stores/text2image-store.ts:361` - No model validation
- `qcut/apps/web/src/lib/fal-ai-client.ts:1349-1396` - convertNanoBananaParameters (not used)
- `qcut/docs/issues/error-fix/console2.md` - Console error logs

**Testing Files**:
- `qcut/apps/web/src/lib/__tests__/fal-ai-client.test.ts` - Add tests here

---

**Document Version**: 1.0
**Last Updated**: 2025-11-14
**Author**: AI Analysis of console2.md errors
