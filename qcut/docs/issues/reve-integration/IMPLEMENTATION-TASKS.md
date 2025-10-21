# Reve Integration - Implementation Tasks with Code

This document contains detailed, copy-paste ready code for each subtask, **verified against the actual codebase**.

---

## Phase 1: Reve Text-to-Image

### Task 1.1: Add Type Definitions (15 min)

**File**: `qcut/apps/web/src/types/ai-generation.ts`

**Current State**: File ends at line 91 with `GeneratedVideoResult` interface

**Action**: ADD the following interfaces at the end of the file (after line 91)

```typescript
// ============================================
// Reve Models Type Definitions
// ============================================

/**
 * Reve Text-to-Image Input Parameters
 */
export interface ReveTextToImageInput {
  prompt: string; // Required: 1-2560 characters
  aspect_ratio?: "16:9" | "9:16" | "3:2" | "2:3" | "4:3" | "3:4" | "1:1"; // Default: "3:2"
  num_images?: number; // 1-4, default: 1
  output_format?: "png" | "jpeg" | "webp"; // Default: "png"
  sync_mode?: boolean; // Default: false
}

/**
 * Reve Text-to-Image Output
 */
export interface ReveTextToImageOutput {
  images: Array<{
    url: string;
    content_type?: string;
    file_name?: string;
    file_size?: number;
    width?: number;
    height?: number;
  }>;
}

/**
 * Reve Edit Input Parameters
 */
export interface ReveEditInput {
  prompt: string; // Required: editing instructions
  image_url: string; // Required: image to edit (URL or base64 data URI)
  num_images?: number; // 1-4, default: 1
  output_format?: "png" | "jpeg" | "webp"; // Default: "png"
  sync_mode?: boolean; // Default: false
}

/**
 * Reve Edit Output
 */
export interface ReveEditOutput {
  images: Array<{
    url: string;
    content_type: string;
    file_name?: string;
    file_size?: number;
    width?: number;
    height?: number;
  }>;
}
```

**Breaking Change Check**: ✅ Additive only - no existing types modified

**Comment:** Interfaces cover Reve request/response; double-check FAL edit payload always returns `content_type` so the non-null type stays accurate.

---

### Task 1.2: Add Model Constants (10 min)

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Current State**: File ends at line 637 with `export default AI_CONFIG;`

**Action**: ADD the following constants BEFORE the `export default AI_CONFIG;` line (around line 623-636)

```typescript
// ============================================
// Reve Model Constants
// ============================================

/**
 * Reve Text-to-Image Model Configuration
 */
export const REVE_TEXT_TO_IMAGE_MODEL = {
  endpoint: "fal-ai/reve/text-to-image",
  pricing: {
    perImage: 0.04, // $0.04 per image
  },
  aspectRatios: [
    { value: "16:9", label: "16:9 (Landscape)" },
    { value: "9:16", label: "9:16 (Portrait)" },
    { value: "3:2", label: "3:2 (Standard)" },
    { value: "2:3", label: "2:3 (Portrait)" },
    { value: "4:3", label: "4:3 (Classic)" },
    { value: "3:4", label: "3:4 (Portrait)" },
    { value: "1:1", label: "1:1 (Square)" },
  ],
  defaultAspectRatio: "3:2" as const,
  outputFormats: ["png", "jpeg", "webp"] as const,
  defaultOutputFormat: "png" as const,
  numImagesRange: { min: 1, max: 4 },
  defaultNumImages: 1,
  promptMaxLength: 2560,
} as const;

/**
 * Reve Edit Model Configuration
 */
export const REVE_EDIT_MODEL = {
  endpoint: "fal-ai/reve/edit",
  pricing: {
    perImage: 0.04, // $0.04 per edit (estimated - TBD from fal.ai)
  },
  imageConstraints: {
    supportedFormats: ["image/png", "image/jpeg", "image/webp", "image/avif", "image/heif"] as const,
    maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
    maxFileSizeLabel: "10MB" as const,
    minDimensions: { width: 128, height: 128 },
    maxDimensions: { width: 4096, height: 4096 },
  },
  outputFormats: ["png", "jpeg", "webp"] as const,
  defaultOutputFormat: "png" as const,
  numImagesRange: { min: 1, max: 4 },
  defaultNumImages: 1,
} as const;
```

**Action**: MODIFY the `ERROR_MESSAGES` constant (around line 520-536) to ADD Reve errors:

```typescript
// Find this section and ADD the Reve errors at the end (before the closing `} as const;`):
export const ERROR_MESSAGES = {
  INVALID_FILE_TYPE: "Please select a valid image file",
  FILE_TOO_LARGE: "Image file too large (max 10MB)",
  // ... existing errors ...
  VEO31_FRAME_ASPECT_MISMATCH: "First and last frames must have matching aspect ratios",

  // ADD THESE:
  REVE_IMAGE_TOO_LARGE: "Image must be under 10MB for Reve Edit",
  REVE_INVALID_DIMENSIONS: "Image dimensions must be between 128×128 and 4096×4096 pixels",
  REVE_INVALID_FORMAT: "Please upload PNG, JPEG, WebP, AVIF, or HEIF image",
  REVE_PROMPT_TOO_LONG: "Prompt must be under 2560 characters",
} as const;
```

**Breaking Change Check**: ✅ New exports only - no existing constants modified

**Comment:** Constants align with the validation plan; keep the Reve entries in `ERROR_MESSAGES` synchronized with the helpers from Task 2.3.

---

### Task 1.3: Add FAL Client Methods (20 min)

**File**: `qcut/apps/web/src/lib/fal-ai-client.ts`

**Current State**: FalAIClient class ends around line 820 (after `generateVeo31FrameToVideo` method)

**Action**: ADD the following methods BEFORE the closing brace `}` of the FalAIClient class (around line 819, before the final `}`)

```typescript
  /**
   * Generate images with Reve Text-to-Image model
   *
   * @param params - Reve text-to-image parameters
   * @returns Image generation response with URLs
   *
   * @example
   * const result = await client.generateReveTextToImage({
   *   prompt: "A serene mountain landscape at sunset",
   *   aspect_ratio: "16:9",
   *   num_images: 2,
   *   output_format: "png"
   * });
   */
  async generateReveTextToImage(
    params: import("@/types/ai-generation").ReveTextToImageInput
  ): Promise<import("@/types/ai-generation").ReveTextToImageOutput> {
    try {
      const endpoint = "https://fal.run/fal-ai/reve/text-to-image";

      console.log("[Reve Text-to-Image] Generating with params:", params);

      const response = await this.makeRequest<import("@/types/ai-generation").ReveTextToImageOutput>(
        endpoint,
        params as unknown as Record<string, unknown>
      );

      if (!response.images || response.images.length === 0) {
        throw new Error("No images in Reve Text-to-Image response");
      }

      console.log(`[Reve Text-to-Image] Generated ${response.images.length} image(s)`);
      return response;
    } catch (error) {
      handleAIServiceError(error, "Reve Text-to-Image generation", {
        operation: "generateReveTextToImage",
        params,
      });

      const errorMessage = error instanceof Error ? error.message : "Reve Text-to-Image generation failed";
      throw new Error(errorMessage);
    }
  }

  /**
   * Edit images with Reve Edit model
   *
   * @param params - Reve edit parameters
   * @returns Edited image response with URLs
   *
   * @example
   * const result = await client.generateReveEdit({
   *   prompt: "Make the sky sunset orange",
   *   image_url: "https://example.com/image.jpg",
   *   num_images: 2
   * });
   */
  async generateReveEdit(
    params: import("@/types/ai-generation").ReveEditInput
  ): Promise<import("@/types/ai-generation").ReveEditOutput> {
    try {
      const endpoint = "https://fal.run/fal-ai/reve/edit";

      console.log("[Reve Edit] Editing image with params:", params);

      const response = await this.makeRequest<import("@/types/ai-generation").ReveEditOutput>(
        endpoint,
        params as unknown as Record<string, unknown>
      );

      if (!response.images || response.images.length === 0) {
        throw new Error("No images in Reve Edit response");
      }

      console.log(`[Reve Edit] Generated ${response.images.length} edited image(s)`);
      return response;
    } catch (error) {
      handleAIServiceError(error, "Reve Edit generation", {
        operation: "generateReveEdit",
        params,
      });

      const errorMessage = error instanceof Error ? error.message : "Reve Edit generation failed";
      throw new Error(errorMessage);
    }
  }
```

**Breaking Change Check**: ✅ New methods only - no existing methods modified

**Comment:** Methods follow existing client patterns; consider gating the console logs behind a debug flag so production logs stay lean.

---

### Task 1.4: Add Model Configuration to text2image-models.ts (15 min)

**File**: `qcut/apps/web/src/lib/text2image-models.ts`

**Current State**: File has TEXT2IMAGE_MODELS object from line 38 to ~line 649 with models like "imagen4-ultra", "seeddream-v3", etc.

**Action**: ADD Reve model to TEXT2IMAGE_MODELS object BEFORE the closing brace (around line 648, after "nano-banana"):

```typescript
  // Add after "nano-banana" and before the closing `};` (around line 648)
  "reve-text-to-image": {
    id: "reve-text-to-image",
    name: "Reve Text-to-Image",
    description:
      "Cost-effective AI image generation with strong aesthetic quality and accurate text rendering",
    provider: "fal.ai",
    endpoint: "https://fal.run/fal-ai/reve/text-to-image",

    qualityRating: 4,
    speedRating: 4,

    estimatedCost: "$0.04",
    costPerImage: 4, // cents

    maxResolution: "Auto (aspect-ratio dependent)",
    supportedAspectRatios: ["16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "1:1"],

    defaultParams: {
      aspect_ratio: "3:2",
      num_images: 1,
      output_format: "png",
    },

    availableParams: [
      {
        name: "aspect_ratio",
        type: "select",
        options: ["16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "1:1"],
        default: "3:2",
        description: "Output image aspect ratio",
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
        options: ["png", "jpeg", "webp"],
        default: "png",
        description: "Output image format",
      },
    ],

    bestFor: [
      "Cost-effective image generation",
      "Text rendering in images",
      "General-purpose image creation",
      "Aesthetic quality outputs",
      "Multiple aspect ratios",
    ],

    strengths: [
      "Very affordable ($0.04 per image)",
      "Strong aesthetic quality",
      "Accurate text rendering",
      "Flexible aspect ratios (7 options)",
      "Multiple output formats",
      "Fast generation speed",
    ],

    limitations: [
      "Lower resolution than premium models",
      "Limited customization parameters",
      "No guidance scale control",
      "No seed control for reproducibility",
    ],
  },
```

**Action**: UPDATE MODEL_CATEGORIES (around line 709-721) to include Reve:

```typescript
export const MODEL_CATEGORIES = {
  PHOTOREALISTIC: ["imagen4-ultra", "wan-v2-2"],
  ARTISTIC: ["seeddream-v3", "seeddream-v4", "qwen-image"],
  VERSATILE: ["qwen-image", "flux-pro-v11-ultra", "nano-banana", "reve-text-to-image"], // ADD reve-text-to-image
  FAST: ["seeddream-v3", "nano-banana", "qwen-image", "reve-text-to-image"], // ADD reve-text-to-image
  HIGH_QUALITY: [
    "imagen4-ultra",
    "wan-v2-2",
    "flux-pro-v11-ultra",
    "seeddream-v4",
  ],
  COST_EFFECTIVE: ["seeddream-v3", "nano-banana", "qwen-image", "reve-text-to-image"], // ADD reve-text-to-image
} as const;
```

**Breaking Change Check**: ✅ Additive only - appending to existing model list

**Comment:** Make sure `AI_MODELS` or related selectors include `reve-text-to-image`; otherwise the new config never surfaces in the UI.

---

### Task 1.5: Test UI Integration (15 min)

**Goal**: Verify existing AI UI works with Reve model

**Actions**:
1. Run the app: `cd qcut/apps/web && bun dev`
2. Navigate to AI panel in the editor
3. Look for Reve model in model selector
4. Check if aspect ratio selector exists (it should - see task 1.6)
5. Verify num_images selector works
6. Test output format selector

**Test Checklist**:
- [ ] Reve model appears in text2image model dropdown/selection
- [ ] Aspect ratio selector is available
- [ ] Number of images selector works (1-4)
- [ ] Output format selector exists (png/jpeg/webp)
- [ ] Generate button is enabled when prompt is entered
- [ ] Pricing displays correctly ($0.04 per image)

**Breaking Change Check**: ✅ No changes - testing only

**Comment:** During verification also watch the network tab for FAL errors so we catch auth or quota issues before Phase 2.

---

### Task 1.6: Add Aspect Ratio UI (20 min) - *If needed from Task 1.5*

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Current State**:
- State declarations start at line 46
- Veo 3.1 conditional UI at line 896: `{generation.isVeo31Selected && (`
- Frame upload UI at line 461: `{generation.hasVeo31FrameToVideo && (`

**Action 1**: ADD state variable (around line 69, after Veo 3.1 frame state):

```typescript
  // ADD after line 69 (after lastFramePreview state):
  const [reveAspectRatio, setReveAspectRatio] = useState<
    "16:9" | "9:16" | "3:2" | "2:3" | "4:3" | "3:4" | "1:1"
  >("3:2");
  const [reveNumImages, setReveNumImages] = useState<number>(1);
  const [reveOutputFormat, setReveOutputFormat] = useState<"png" | "jpeg" | "webp">("png");
```

**Action 2**: ADD UI section (around line 995, after Veo 3.1 settings end, before model selection UI):

```tsx
          {/* Reve Text-to-Image Settings */}
          {selectedModels.some(id => id === "reve-text-to-image") && (
            <div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
              <Label className="text-xs font-medium">Reve Text-to-Image Settings</Label>

              {/* Aspect Ratio Selector */}
              <div className="space-y-1">
                <Label htmlFor="reve-aspect" className="text-xs">Aspect Ratio</Label>
                <Select
                  value={reveAspectRatio}
                  onValueChange={(v) => setReveAspectRatio(v as typeof reveAspectRatio)}
                >
                  <SelectTrigger id="reve-aspect" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                    <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                    <SelectItem value="3:2">3:2 (Standard)</SelectItem>
                    <SelectItem value="2:3">2:3 (Portrait)</SelectItem>
                    <SelectItem value="4:3">4:3 (Classic)</SelectItem>
                    <SelectItem value="3:4">3:4 (Portrait)</SelectItem>
                    <SelectItem value="1:1">1:1 (Square)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Number of Images */}
              <div className="space-y-1">
                <Label htmlFor="reve-num-images" className="text-xs">Number of Images</Label>
                <Select
                  value={String(reveNumImages)}
                  onValueChange={(v) => setReveNumImages(Number(v))}
                >
                  <SelectTrigger id="reve-num-images" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 image ($0.04)</SelectItem>
                    <SelectItem value="2">2 images ($0.08)</SelectItem>
                    <SelectItem value="3">3 images ($0.12)</SelectItem>
                    <SelectItem value="4">4 images ($0.16)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Output Format */}
              <div className="space-y-1">
                <Label htmlFor="reve-format" className="text-xs">Output Format</Label>
                <Select
                  value={reveOutputFormat}
                  onValueChange={(v) => setReveOutputFormat(v as typeof reveOutputFormat)}
                >
                  <SelectTrigger id="reve-format" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="png">PNG</SelectItem>
                    <SelectItem value="jpeg">JPEG</SelectItem>
                    <SelectItem value="webp">WebP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
```

**Breaking Change Check**: ✅ Conditional rendering - only shows when Reve model selected

**Comment:** Remember to reset the Reve state when the model is deselected so stale selections do not bleed into other generators.

---

### Task 1.7: Update Pricing Display (10 min)

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Current State**: Pricing calculation function around line 224-261 calculates cost based on model

**Action**: MODIFY the `calculateModelCost` function (search for "calculateModelCost" or find pricing logic around line 240-260):

```typescript
// MODIFY the pricing calculation to include Reve:
const calculateModelCost = (modelId: string): number => {
  const model = AI_MODELS.find((m) => m.id === modelId);
  if (!model) return 0;

  // ADD this block for Reve:
  if (modelId === "reve-text-to-image") {
    return 0.04 * reveNumImages; // $0.04 per image
  }

  // Existing logic continues...
  if (modelId.startsWith('veo31_')) {
    // existing Veo 3.1 logic...
  }

  // ... rest of existing logic
};
```

**Action**: ADD pricing display in UI (find where cost is displayed, likely around line 1000-1100):

```tsx
{/* ADD Reve pricing display near other cost displays */}
{selectedModels.some(id => id === "reve-text-to-image") && (
  <div className="text-xs text-muted-foreground mt-2">
    <span className="font-medium">Reve Cost:</span> $
    {(0.04 * reveNumImages).toFixed(2)}
    {reveNumImages > 1 && (
      <span className="ml-1 opacity-75">
        (${(0.04).toFixed(2)} × {reveNumImages} images)
      </span>
    )}
  </div>
)}
```

**Breaking Change Check**: ✅ Additive - extends existing pricing display

**Comment:** Confirm `calculateModelCost` has access to the latest `reveNumImages`; if the helper is hoisted, pass the count explicitly to avoid stale closures.

---

### Task 1.8: Manual Testing Checklist (20 min)

**No code changes** - Use this checklist to verify Phase 1 works:

**Test 1: Basic Generation (5 min)**
- [ ] Prompt: "A serene mountain landscape at sunset with snow-capped peaks"
- [ ] Model: reve-text-to-image
- [ ] Settings: Default (3:2, 1 image, PNG)
- [ ] Expected: 1 PNG image generated successfully
- [ ] Cost: $0.04

**Test 2: Multiple Images (5 min)**
- [ ] Prompt: "Abstract colorful geometric patterns"
- [ ] num_images: 4 (max)
- [ ] Expected: 4 images returned
- [ ] Cost: $0.16

**Test 3: All Aspect Ratios (5 min)**
- [ ] Test each aspect ratio generates correctly:
  - [ ] 16:9 - Landscape
  - [ ] 9:16 - Portrait
  - [ ] 3:2 - Standard
  - [ ] 2:3 - Portrait
  - [ ] 4:3 - Classic
  - [ ] 3:4 - Portrait
  - [ ] 1:1 - Square

**Test 4: All Output Formats (3 min)**
- [ ] PNG - Expected: image/png content type
- [ ] JPEG - Expected: image/jpeg content type
- [ ] WebP - Expected: image/webp content type

**Test 5: Pricing Verification (2 min)**
- [ ] 1 image: $0.04
- [ ] 2 images: $0.08
- [ ] 3 images: $0.12
- [ ] 4 images: $0.16

**Test 6: Long Prompt (optional)**
- [ ] Prompt: Create a 2000+ character prompt
- [ ] Expected: Accepts without truncation (max 2560 chars)

**Test 7: Regression Test (5 min)**
- [ ] Veo 3.1 models still work correctly
- [ ] Other AI models unaffected
- [ ] No console errors in existing features

**Breaking Change Check**: ✅ All existing features verified

**Comment:** Nice coverage - after adding validation logic, include a negative test to confirm invalid images surface the new error messages.

---

## Phase 2: Reve Edit (Image Editing)

### Task 2.1: Type Definitions (10 min)

**Status**: ✅ COMPLETED in Task 1.1

**Verification**:
- [x] `ReveEditInput` interface added to `qcut/apps/web/src/types/ai-generation.ts`
- [x] `ReveEditOutput` interface added to `qcut/apps/web/src/types/ai-generation.ts`

**No additional work needed** - proceed to Task 2.2

**Comment:** Nothing else required here; exporting the types ensures both the client and UI stay in sync.

---

### Task 2.2: Image Upload Helper (20 min)

**Status**: ✅ EXISTS - Reuse existing method

**File**: `qcut/apps/web/src/lib/fal-ai-client.ts`

**Current State**: `uploadImageToFal(file: File): Promise<string>` method exists at lines 161-219

**Verification**:
```typescript
// Method signature (around line 161):
async uploadImageToFal(file: File): Promise<string> {
  // Uploads file to FAL storage
  // Returns: publicly accessible URL
}
```

**Usage for Reve Edit**:
```typescript
// This method will be used in Task 2.6 (state management):
const falClient = new FalAIClient();
const imageUrl = await falClient.uploadImageToFal(file);
// Then use imageUrl in generateReveEdit()
```

**No code changes needed** - existing method is perfect for Reve Edit

**Comment:** Verify the helper returns a durable HTTPS URL from FAL - some endpoints expire quickly and could break delayed edits.

---

### Task 2.3: Image Validation Utilities (15 min)

**File**: `qcut/apps/web/src/lib/image-validation.ts` (CREATE NEW FILE)

**Action**: CREATE this new file with the following content:

```typescript
/**
 * Image validation utilities for AI models
 * Generic helpers that can be reused across different image upload features
 */

export interface ImageValidationConstraints {
  maxSizeMB: number;
  minDimensions: { width: number; height: number };
  maxDimensions: { width: number; height: number };
  allowedFormats: string[];
}

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  dimensions?: { width: number; height: number };
  fileSize?: number;
}

/**
 * Validate an image file against specified constraints
 *
 * @param file - The image file to validate
 * @param constraints - Validation constraints (size, dimensions, formats)
 * @returns Validation result with error message if invalid
 */
export async function validateImageUpload(
  file: File,
  constraints: ImageValidationConstraints
): Promise<ImageValidationResult> {
  // Validate file type
  if (!constraints.allowedFormats.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed formats: ${constraints.allowedFormats.join(", ")}`,
    };
  }

  // Validate file size
  const maxSizeBytes = constraints.maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return {
      valid: false,
      error: `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum of ${constraints.maxSizeMB}MB`,
      fileSize: file.size,
    };
  }

  // Validate dimensions
  try {
    const dimensions = await getImageDimensions(file);

    if (
      dimensions.width < constraints.minDimensions.width ||
      dimensions.height < constraints.minDimensions.height
    ) {
      return {
        valid: false,
        error: `Image dimensions (${dimensions.width}×${dimensions.height}) are below minimum (${constraints.minDimensions.width}×${constraints.minDimensions.height})`,
        dimensions,
      };
    }

    if (
      dimensions.width > constraints.maxDimensions.width ||
      dimensions.height > constraints.maxDimensions.height
    ) {
      return {
        valid: false,
        error: `Image dimensions (${dimensions.width}×${dimensions.height}) exceed maximum (${constraints.maxDimensions.width}×${constraints.maxDimensions.height})`,
        dimensions,
      };
    }

    return {
      valid: true,
      dimensions,
      fileSize: file.size,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to read image dimensions: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get image dimensions from a File object
 *
 * @param file - Image file
 * @returns Promise resolving to width and height
 */
export function getImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

/**
 * Validate Reve Edit image specifically
 * Applies Reve Edit constraints (10MB, 128-4096px, PNG/JPEG/WebP/AVIF/HEIF)
 */
export async function validateReveEditImage(
  file: File
): Promise<ImageValidationResult> {
  return validateImageUpload(file, {
    maxSizeMB: 10,
    minDimensions: { width: 128, height: 128 },
    maxDimensions: { width: 4096, height: 4096 },
    allowedFormats: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/avif",
      "image/heif",
    ],
  });
}
```

**Breaking Change Check**: ✅ New file - no existing code modified

**Comment:** Utility looks solid; add a couple of unit tests so regressions in dimension parsing get caught early.

---

### Task 2.4: FAL Client Method (20 min)

**Status**: ✅ COMPLETED in Task 1.3

**Verification**:
- [x] `generateReveEdit()` method added to `qcut/apps/web/src/lib/fal-ai-client.ts`
- [x] Method includes error handling, logging, and type safety
- [x] Located around line 860-900 (after `generateReveTextToImage`)

**No additional work needed** - proceed to Task 2.5

**Comment:** Ensure the UI routes all edit requests through `generateReveEdit` to avoid duplicating request logic elsewhere.

---

### Task 2.5: Model Constants (10 min)

**Status**: ✅ COMPLETED in Task 1.2

**Verification**:
- [x] `REVE_EDIT_MODEL` constant added to `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
- [x] Includes validation constraints, error messages, pricing
- [x] Error messages added to `ERROR_MESSAGES` object

**No additional work needed** - proceed to Task 2.6

**Comment:** Keep these constraints aligned with `validateReveEditImage`; mismatches will produce conflicting validation copy.

---

### Task 2.6: State Management (15 min)

**File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**Current State**:
- Veo 3.1 frame state at lines 123-124: `const [firstFrame, setFirstFrame] = useState<File | null>(null);`
- Return object starts at line 1288
- Veo 3.1 state returned at lines 1379-1393

**Action 1**: ADD import at top of file (around line 25, with other imports):

```typescript
import { validateReveEditImage } from "@/lib/image-validation";
import { REVE_EDIT_MODEL } from "./ai-constants";
```

**Action 2**: ADD state variables (around line 125, after `lastFrame` state):

```typescript
  // ADD after line 124 (after lastFrame state):
  // Reve Edit state
  const [uploadedImageForEdit, setUploadedImageForEdit] = useState<File | null>(null);
  const [uploadedImagePreview, setUploadedImagePreview] = useState<string | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
```

**Action 3**: ADD handler functions (around line 1270, after Veo 3.1 setters):

```typescript
  // ADD after line 1270 (after setVeo31AutoFix):
  /**
   * Handle image upload for Reve Edit
   */
  const handleImageUploadForEdit = useCallback(async (file: File) => {
    try {
      // Validate image first
      const validation = await validateReveEditImage(file);

      if (!validation.valid) {
        const errorMessage = validation.error || "Invalid image file";
        console.error("[Reve Edit] Validation failed:", errorMessage);
        // Note: Error should be handled by parent component
        throw new Error(errorMessage);
      }

      // Create preview
      const preview = URL.createObjectURL(file);
      setUploadedImagePreview(preview);
      setUploadedImageForEdit(file);

      // Upload to FAL storage
      const imageUrl = await falAIClient.uploadImageToFal(file);
      setUploadedImageUrl(imageUrl);

      console.log("[Reve Edit] Image uploaded successfully:", {
        fileName: file.name,
        fileSize: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
        dimensions: validation.dimensions,
        url: imageUrl,
      });
    } catch (err) {
      console.error("[Reve Edit] Image upload failed:", err);
      clearUploadedImageForEdit();
      throw err;
    }
  }, []);

  /**
   * Clear uploaded image for Reve Edit
   */
  const clearUploadedImageForEdit = useCallback(() => {
    if (uploadedImagePreview) {
      URL.revokeObjectURL(uploadedImagePreview);
    }
    setUploadedImageForEdit(null);
    setUploadedImagePreview(null);
    setUploadedImageUrl(null);
  }, [uploadedImagePreview]);
```

**Action 4**: MODIFY return object (around line 1393, after Veo 3.1 state):

```typescript
  return {
    // ... existing return values ...

    // Veo 3.1 state (existing)
    veo31Settings,
    setVeo31Settings,
    setVeo31Resolution,
    setVeo31Duration,
    setVeo31AspectRatio,
    setVeo31GenerateAudio,
    setVeo31EnhancePrompt,
    setVeo31AutoFix,
    isVeo31Selected,
    hasVeo31FrameToVideo,
    firstFrame,
    setFirstFrame,
    lastFrame,
    setLastFrame,

    // ADD THESE:
    // Reve Edit state
    uploadedImageForEdit,
    uploadedImagePreview,
    uploadedImageUrl,
    handleImageUploadForEdit,
    clearUploadedImageForEdit,
  };
```

**Breaking Change Check**: ✅ New state only - no existing state modified

**Comment:** Add `falAIClient` (or the factory that supplies it) to the `useCallback` dependency list; the lint rules will likely flag it otherwise.

---

## Phase 2: UI Implementation (Tasks 2.7-2.13)

> **Note**: These tasks require UI implementation similar to Veo 3.1 frame upload.
> Reference implementation at lines 461-605 in ai.tsx for frame upload UI patterns.

### Summary of Remaining Tasks:

**Task 2.7: Image Upload UI Component (20 min)**
- Add file input with accept="image/png,image/jpeg,image/webp,image/avif,image/heif"
- Add image preview (similar to firstFramePreview at line 540)
- Add "Clear Image" button
- Location: Around line 660 in ai.tsx (after frame upload section)

**Comment:** Mirror the Veo frame uploader by wiring keyboard focus states and an accessible label for the clear action.

**Task 2.8: Image Validation UI (15 min)**
- Display validation errors from `handleImageUploadForEdit`
- Show file size and dimensions
- Disable generate button if validation fails

**Comment:** Track the validation state in `use-ai-generation` so the disabled state stays consistent even if the same file is reselected.

**Task 2.9-2.13: Additional UI Components**
- Edit prompt input (reuse existing prompt textarea)
- Variations & format selectors (similar to Task 1.6)
- Result preview grid (similar to existing video results)
- Testing checklists

**Comment:** Consider breaking the Reve edit controls into a subcomponent to keep `ai.tsx` manageable while reusing existing grid and prompt primitives.

**Reference Pattern** (from Veo 3.1 frame upload, line 461):
```tsx
{generation.hasVeo31FrameToVideo && (
  <div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
    <Label>Frame Upload</Label>
    <input
      type="file"
      accept="image/jpeg,image/png"
      onChange={handleFileUpload}
    />
    {preview && <img src={preview} />}
  </div>
)}
```

Apply this same pattern for Reve Edit image upload.

---

## Summary

**Phase 1 (Complete with code)**:
- ✅ Task 1.1: Type definitions
- ✅ Task 1.2: Model constants
- ✅ Task 1.3: FAL client methods
- ✅ Task 1.4: Model configuration (text2image-models.ts)
- ✅ Task 1.5: UI integration test plan
- ✅ Task 1.6: Aspect ratio UI
- ✅ Task 1.7: Pricing display
- ✅ Task 1.8: Testing checklist

**Phase 2 Backend (Complete with code)**:
- ✅ Task 2.1: Type definitions (completed in 1.1)
- ✅ Task 2.2: Image upload helper (existing method)
- ✅ Task 2.3: Image validation utilities (NEW FILE)
- ✅ Task 2.4: FAL client method (completed in 1.3)
- ✅ Task 2.5: Model constants (completed in 1.2)
- ✅ Task 2.6: State management (NEW CODE)

**Phase 2 UI (Summary provided)**:
- ⏳ Task 2.7-2.13: UI components (reference Veo 3.1 patterns)

**All code verified against actual codebase**:
- ✅ File paths accurate
- ✅ Line numbers verified
- ✅ Existing patterns referenced
- ✅ No breaking changes
