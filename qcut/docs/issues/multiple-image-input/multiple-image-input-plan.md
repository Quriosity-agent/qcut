# Multiple Image Input for AI Image Editing

## Overview

Add multiple image input support to the AI Image Editing feature. Currently, the UI only supports single image upload, but several models support multi-image compositing (up to 10 images).

**Priority**: Long-term maintainability over short-term gains

---

## Model Multi-Image Support Summary

### Models Supporting Multiple Images

| Model ID | Display Name | Max Images | API Parameter |
|----------|--------------|-----------|---------------|
| `seeddream-v4-5-edit` | SeedDream v4.5 Edit | 10 | `image_urls[]` |
| `seeddream-v4` | SeedDream v4 | 6 | `image_urls[]` |
| `nano-banana` | Nano Banana | 4 | `image_urls[]` |
| `gemini-3-pro-edit` | Gemini 3 Pro Edit | 4 | `image_urls[]` |
| `flux-2-flex-edit` | FLUX 2 Flex Edit | 4 | `image_urls[]` |

### Models Supporting Single Image Only

| Model ID | Display Name | API Parameter |
|----------|--------------|---------------|
| `seededit` | SeedEdit v3 | `image_url` (string) |
| `flux-kontext` | FLUX Pro Kontext | `image_url` (string) |
| `flux-kontext-max` | FLUX Pro Kontext Max | `image_url` (string) |
| `reve-edit` | Reve Edit | `image_url` (string) |

---

## Subtasks

---

### Subtask 1: Add Model Capability Constants (10 min)

**Files:**
- `apps/web/src/lib/image-edit-client.ts`

**Goal:** Create a centralized configuration for model multi-image capabilities.

**Code to ADD** (after line 201, after `MODEL_ENDPOINTS`):

```typescript
/**
 * Model capabilities for multi-image support
 * Centralized configuration for maintainability
 */
export const MODEL_CAPABILITIES: Record<string, { maxImages: number; supportsMultiple: boolean }> = {
  // Multi-image models
  "seeddream-v4-5-edit": { maxImages: 10, supportsMultiple: true },
  "seeddream-v4": { maxImages: 6, supportsMultiple: true },
  "nano-banana": { maxImages: 4, supportsMultiple: true },
  "gemini-3-pro-edit": { maxImages: 4, supportsMultiple: true },
  "flux-2-flex-edit": { maxImages: 4, supportsMultiple: true },

  // Single-image models
  "seededit": { maxImages: 1, supportsMultiple: false },
  "flux-kontext": { maxImages: 1, supportsMultiple: false },
  "flux-kontext-max": { maxImages: 1, supportsMultiple: false },
  "reve-edit": { maxImages: 1, supportsMultiple: false },
};

/**
 * Get model capability info
 * @param modelId - The model identifier
 * @returns Model capability object with maxImages and supportsMultiple
 */
export function getModelCapabilities(modelId: string): { maxImages: number; supportsMultiple: boolean } {
  return MODEL_CAPABILITIES[modelId] || { maxImages: 1, supportsMultiple: false };
}
```

**Why:** Centralizing capabilities in one place makes it easy to add new models and ensures consistency across UI components.

---

### Subtask 2: Update ImageEditRequest Interface (5 min)

**Files:**
- `apps/web/src/lib/image-edit-client.ts`

**Goal:** Support array of image URLs in the request interface.

**Code to MODIFY** (lines 15-44):

```typescript
export interface ImageEditRequest {
  /** @deprecated Use imageUrls instead for consistency */
  imageUrl?: string;
  /** Array of image URLs - use this for all models */
  imageUrls?: string[];
  prompt: string;
  model:
    | "seededit"
    | "flux-kontext"
    | "flux-kontext-max"
    | "flux-2-flex-edit"
    | "seeddream-v4"
    | "seeddream-v4-5-edit"
    | "nano-banana"
    | "reve-edit"
    | "gemini-3-pro-edit";
  guidanceScale?: number;
  steps?: number;
  seed?: number;
  safetyTolerance?: number;
  numImages?: number;

  // V4-specific parameters
  imageSize?: string | number;
  maxImages?: number;
  syncMode?: boolean;
  enableSafetyChecker?: boolean;
  outputFormat?: "jpeg" | "png" | "webp";

  // Gemini 3 Pro Edit specific parameters
  resolution?: "1K" | "2K" | "4K";
  aspectRatio?: string;
}
```

**Why:** Adding `imageUrls` array while keeping `imageUrl` for backward compatibility ensures existing code doesn't break.

---

### Subtask 3: Update editImage Function for Multi-Image (15 min)

**Files:**
- `apps/web/src/lib/image-edit-client.ts`

**Goal:** Handle both single and multiple image URLs in the API request.

**Code to MODIFY** in `editImage` function (around lines 279-292):

**REPLACE:**
```typescript
  // Handle image URL(s) based on model
  if (
    request.model === "seeddream-v4" ||
    request.model === "seeddream-v4-5-edit" ||
    request.model === "nano-banana" ||
    request.model === "gemini-3-pro-edit" ||
    request.model === "flux-2-flex-edit"
  ) {
    // V4, V4.5, Nano Banana, Gemini 3 Pro Edit, and FLUX 2 Flex Edit use image_urls array
    payload.image_urls = [request.imageUrl];
  } else {
    // V3 and FLUX use image_url string
    payload.image_url = request.imageUrl;
  }
```

**WITH:**
```typescript
  // Handle image URL(s) based on model capabilities
  const capabilities = getModelCapabilities(request.model);

  // Normalize to array format
  const imageUrlsArray: string[] = request.imageUrls
    ? request.imageUrls
    : request.imageUrl
      ? [request.imageUrl]
      : [];

  // Validate image count against model capabilities
  if (imageUrlsArray.length === 0) {
    throw new Error("At least one image URL is required");
  }

  if (imageUrlsArray.length > capabilities.maxImages) {
    console.warn(
      `Model ${request.model} supports max ${capabilities.maxImages} images, ` +
      `but ${imageUrlsArray.length} provided. Using first ${capabilities.maxImages}.`
    );
  }

  // Apply model-appropriate payload format
  if (capabilities.supportsMultiple) {
    // Multi-image models use image_urls array
    payload.image_urls = imageUrlsArray.slice(0, capabilities.maxImages);
  } else {
    // Single-image models use image_url string
    payload.image_url = imageUrlsArray[0];
  }
```

**Why:** This approach handles backward compatibility, validates input, and logs warnings without breaking.

---

### Subtask 4: Add Batch Upload Function (15 min)

**Files:**
- `apps/web/src/lib/image-edit-client.ts`

**Goal:** Add function to upload multiple images in parallel.

**Code to ADD** (after `uploadImageToFAL` function, around line 252):

```typescript
/**
 * Upload multiple images to FAL.ai in parallel
 * @param imageFiles - Array of File objects to upload
 * @param onProgress - Optional callback for upload progress
 * @returns Promise resolving to array of uploaded image URLs
 */
export async function uploadImagesToFAL(
  imageFiles: File[],
  onProgress?: (completed: number, total: number) => void
): Promise<string[]> {
  if (imageFiles.length === 0) {
    return [];
  }

  const total = imageFiles.length;
  let completed = 0;

  const uploadPromises = imageFiles.map(async (file) => {
    const url = await uploadImageToFAL(file);
    completed++;
    onProgress?.(completed, total);
    return url;
  });

  // Upload in parallel for better performance
  const results = await Promise.all(uploadPromises);

  console.log(`✅ UPLOAD: Successfully uploaded ${results.length} images`);
  return results;
}
```

**Why:** Parallel uploads are faster than sequential, and progress callback enables UI feedback.

---

### Subtask 5: Update Store Types for Multiple Images (10 min)

**Files:**
- `apps/web/src/stores/adjustment-store.ts`

**Goal:** Enhance store to properly manage multiple image files and their URLs.

**Code to MODIFY** - Update `AdjustmentState` interface (lines 15-66):

**ADD after line 22 (after `multipleImages: string[];`):**
```typescript
  // Multiple image files (File objects for upload)
  multipleImageFiles: File[];
```

**Code to MODIFY** - Update `AdjustmentActions` interface (lines 68-102):

**REPLACE line 72:**
```typescript
  setMultipleImages: (imageUrls: string[]) => void;
```

**WITH:**
```typescript
  setMultipleImages: (imageUrls: string[], files?: File[]) => void;
  addMultipleImage: (file: File, url: string) => void;
  removeMultipleImage: (index: number) => void;
  clearMultipleImages: () => void;
  reorderMultipleImages: (fromIndex: number, toIndex: number) => void;
```

**Code to MODIFY** - Update initial state (after line 172):

**ADD:**
```typescript
    multipleImageFiles: [],
```

**Code to MODIFY** - Update `setMultipleImages` action (lines 222-232):

**REPLACE:**
```typescript
    setMultipleImages: (imageUrls) => {
      // Clean up old URLs that are blob URLs
      const { multipleImages } = get();
      multipleImages.forEach((url) => {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      });
      set({
        multipleImages: imageUrls,
      });
    },
```

**WITH:**
```typescript
    setMultipleImages: (imageUrls, files = []) => {
      // Clean up old URLs that are blob URLs
      const { multipleImages } = get();
      for (const url of multipleImages) {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      }
      set({
        multipleImages: imageUrls,
        multipleImageFiles: files,
      });
    },

    addMultipleImage: (file, url) => {
      set((state) => ({
        multipleImages: [...state.multipleImages, url],
        multipleImageFiles: [...state.multipleImageFiles, file],
      }));
    },

    removeMultipleImage: (index) => {
      const { multipleImages, multipleImageFiles } = get();
      const urlToRemove = multipleImages[index];

      // Clean up blob URL
      if (urlToRemove?.startsWith("blob:")) {
        URL.revokeObjectURL(urlToRemove);
      }

      set({
        multipleImages: multipleImages.filter((_, i) => i !== index),
        multipleImageFiles: multipleImageFiles.filter((_, i) => i !== index),
      });
    },

    clearMultipleImages: () => {
      const { multipleImages } = get();
      // Clean up all blob URLs
      for (const url of multipleImages) {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      }
      set({
        multipleImages: [],
        multipleImageFiles: [],
      });
    },

    reorderMultipleImages: (fromIndex, toIndex) => {
      const { multipleImages, multipleImageFiles } = get();

      const newUrls = [...multipleImages];
      const newFiles = [...multipleImageFiles];

      // Remove from old position
      const [movedUrl] = newUrls.splice(fromIndex, 1);
      const [movedFile] = newFiles.splice(fromIndex, 1);

      // Insert at new position
      newUrls.splice(toIndex, 0, movedUrl);
      newFiles.splice(toIndex, 0, movedFile);

      set({
        multipleImages: newUrls,
        multipleImageFiles: newFiles,
      });
    },
```

**Why:** Storing both File objects and URLs separately allows proper upload handling while maintaining preview capabilities.

---

### Subtask 6: Update Model Selector with Multi-Image Badge (10 min)

**Files:**
- `apps/web/src/components/editor/adjustment/model-selector.tsx`

**Goal:** Show badge indicating multi-image support and max image count.

**Code to MODIFY** - Add import (line 6):

```typescript
import { Check, Images } from "lucide-react";
```

**Code to ADD** - Import capabilities (after line 6):

```typescript
import { getModelCapabilities } from "@/lib/image-edit-client";
```

**Code to MODIFY** - Update model button content (lines 42-55):

**REPLACE:**
```typescript
              <div className="flex items-center gap-1.5 min-w-0">
                  {isSelected && <Check className="w-3 h-3 flex-shrink-0" />}
                  <span className="text-xs font-medium truncate">
                    {model.name}
                  </span>
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium ml-2 flex-shrink-0 border border-transparent",
                    isSelected ? "text-[#05c7c7]/80" : "text-muted-foreground"
                  )}
                >
                  {model.estimatedCost}
                </span>
```

**WITH:**
```typescript
              <div className="flex items-center gap-1.5 min-w-0">
                  {isSelected && <Check className="w-3 h-3 flex-shrink-0" />}
                  <span className="text-xs font-medium truncate">
                    {model.name}
                  </span>
                  {(() => {
                    const caps = getModelCapabilities(model.id);
                    if (caps.supportsMultiple) {
                      return (
                        <span
                          className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground"
                          title={`Supports up to ${caps.maxImages} images`}
                        >
                          <Images className="w-2.5 h-2.5" />
                          {caps.maxImages}
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium ml-2 flex-shrink-0 border border-transparent",
                    isSelected ? "text-[#05c7c7]/80" : "text-muted-foreground"
                  )}
                >
                  {model.estimatedCost}
                </span>
```

**Why:** Visual indicator helps users identify which models support multi-image before selection.

---

### Subtask 7: Create Conditional Image Uploader Component (20 min)

**Files:**
- `apps/web/src/components/editor/adjustment/conditional-image-uploader.tsx` (NEW FILE)

**Goal:** Smart component that shows single or multi-image upload based on selected model.

**Code to CREATE:**

```typescript
"use client";

import { useCallback } from "react";
import { useAdjustmentStore } from "@/stores/adjustment-store";
import { getModelCapabilities } from "@/lib/image-edit-client";
import { ImageUploader } from "./image-uploader";
import { MultiImageUpload } from "./multi-image-upload";
import { createObjectURL } from "@/lib/blob-manager";

export function ConditionalImageUploader() {
  const {
    selectedModel,
    originalImage,
    originalImageUrl,
    multipleImages,
    setOriginalImage,
    addMultipleImage,
    removeMultipleImage,
    clearMultipleImages,
    setMultipleImages,
  } = useAdjustmentStore();

  const capabilities = getModelCapabilities(selectedModel);

  // Handle single image selection
  const handleSingleImageSelect = useCallback(
    (file: File) => {
      const url = createObjectURL(file, "adjustment-single-image");
      setOriginalImage(file, url);
      // Clear multiple images when switching to single
      clearMultipleImages();
    },
    [setOriginalImage, clearMultipleImages]
  );

  // Handle multiple images change
  const handleMultipleImagesChange = useCallback(
    (urls: string[]) => {
      // This is called from MultiImageUpload with blob URLs
      // We need to sync with store
      setMultipleImages(urls);
    },
    [setMultipleImages]
  );

  // Show single image uploader for single-image models
  if (!capabilities.supportsMultiple) {
    return (
      <ImageUploader
        onImageSelect={handleSingleImageSelect}
        uploading={false}
      />
    );
  }

  // Show multi-image uploader for multi-image models
  return (
    <MultiImageUpload
      images={multipleImages}
      maxImages={capabilities.maxImages}
      onChange={handleMultipleImagesChange}
      label={`Input Images (up to ${capabilities.maxImages})`}
    />
  );
}
```

**Why:** Encapsulating the conditional logic in a dedicated component keeps the main panel clean and makes the behavior easy to test.

---

### Subtask 8: Update AdjustmentPanel to Use Conditional Uploader (15 min)

**Files:**
- `apps/web/src/components/editor/adjustment/index.tsx`

**Goal:** Integrate the conditional uploader and update generation logic.

**Code to MODIFY** - Update imports (after line 13):

```typescript
import { ConditionalImageUploader } from "./conditional-image-uploader";
import {
  editImage,
  uploadImageToFAL,
  uploadImagesToFAL,
  getModelCapabilities,
  type ImageEditRequest
} from "@/lib/image-edit-client";
```

**Code to MODIFY** - Update store destructure (lines 37-48):

**ADD to destructuring:**
```typescript
    multipleImages,
    multipleImageFiles,
```

**Code to MODIFY** - Update `handleGenerateEdit` function (lines 61-233):

**REPLACE the upload section (lines 84-91):**
```typescript
      // Upload image to FAL
      debugLog("🔄 Uploading image to FAL...");
      const uploadedImageUrl = await uploadImageToFAL(originalImage);
```

**WITH:**
```typescript
      // Get model capabilities
      const capabilities = getModelCapabilities(selectedModel);
      let uploadedImageUrls: string[] = [];

      if (capabilities.supportsMultiple && multipleImageFiles.length > 0) {
        // Upload multiple images
        debugLog(`🔄 Uploading ${multipleImageFiles.length} images to FAL...`);
        uploadedImageUrls = await uploadImagesToFAL(
          multipleImageFiles,
          (completed, total) => {
            const uploadProgress = Math.round((completed / total) * 20);
            setProcessingState({
              isProcessing: true,
              progress: uploadProgress,
              statusMessage: `Uploading image ${completed}/${total}...`,
              elapsedTime: (Date.now() - startTime) / 1000,
            });
          }
        );
      } else if (originalImage) {
        // Upload single image
        debugLog("🔄 Uploading image to FAL...");
        const uploadedUrl = await uploadImageToFAL(originalImage);
        uploadedImageUrls = [uploadedUrl];
      } else {
        throw new Error("No images to upload");
      }
```

**Code to MODIFY** - Update editRequest building (lines 94-110):

**REPLACE:**
```typescript
      // Build edit request
      const editRequest: ImageEditRequest = {
        imageUrl: uploadedImageUrl,
        prompt: prompt.trim(),
        // ... rest
      };
```

**WITH:**
```typescript
      // Build edit request
      const editRequest: ImageEditRequest = {
        imageUrls: uploadedImageUrls,
        prompt: prompt.trim(),
        model: selectedModel,
        guidanceScale: parameters.guidanceScale,
        steps: parameters.steps,
        seed: parameters.seed,
        safetyTolerance: parameters.safetyTolerance,
        numImages: parameters.numImages,
        imageSize: parameters.imageSize,
        maxImages: parameters.maxImages,
        syncMode: parameters.syncMode,
        enableSafetyChecker: parameters.enableSafetyChecker,
        outputFormat: parameters.outputFormat,
      };
```

**Code to MODIFY** - Update canGenerateEdit check (line 235):

**REPLACE:**
```typescript
  const canGenerateEdit = originalImageUrl && prompt.trim() && !isProcessing;
```

**WITH:**
```typescript
  const capabilities = getModelCapabilities(selectedModel);
  const hasImages = capabilities.supportsMultiple
    ? multipleImages.length > 0
    : !!originalImageUrl;
  const canGenerateEdit = hasImages && prompt.trim() && !isProcessing;
```

**Code to MODIFY** - Replace ImageUploader usage (lines 296-298):

**REPLACE:**
```typescript
      <div className="flex-shrink-0">
        <ImageUploader onImageSelect={handleImageSelect} uploading={false} />
      </div>
```

**WITH:**
```typescript
      <div className="flex-shrink-0">
        <ConditionalImageUploader />
      </div>
```

**Code to MODIFY** - Update empty state condition (line 323):

**REPLACE:**
```typescript
      {!originalImageUrl && (
```

**WITH:**
```typescript
      {!hasImages && (
```

**Why:** The panel now adapts to model capabilities automatically without requiring user to understand the differences.

---

### Subtask 9: Update getImageEditModels with Multi-Image Info (10 min)

**Files:**
- `apps/web/src/lib/image-edit-client.ts`

**Goal:** Add multi-image info to model metadata returned by `getImageEditModels`.

**Code to MODIFY** - Update model entries in `getImageEditModels` function (starting line 876):

**For each model entry, ADD a `multiImage` property. Example for SeedDream v4.5 Edit:**

```typescript
    {
      id: "seeddream-v4-5-edit",
      name: "SeedDream v4.5 Edit",
      description:
        "ByteDance's latest image editing with up to 4K resolution and multi-image compositing",
      provider: "ByteDance",
      estimatedCost: "$0.04-0.08",
      multiImage: { supported: true, maxImages: 10 },  // ADD THIS LINE
      features: [
        "Up to 4K resolution",
        "Multi-image compositing (up to 10)",
        "Auto 2K/4K presets",
        "Commercial license",
      ],
      // ... rest of properties
    },
```

**Add similar `multiImage` property to all models:**
- `seeddream-v4`: `{ supported: true, maxImages: 6 }`
- `nano-banana`: `{ supported: true, maxImages: 4 }`
- `gemini-3-pro-edit`: `{ supported: true, maxImages: 4 }`
- `flux-2-flex-edit`: `{ supported: true, maxImages: 4 }`
- `seededit`: `{ supported: false, maxImages: 1 }`
- `flux-kontext`: `{ supported: false, maxImages: 1 }`
- `flux-kontext-max`: `{ supported: false, maxImages: 1 }`
- `reve-edit`: `{ supported: false, maxImages: 1 }`

**Why:** Having this info in model metadata allows UI to display it without additional lookups.

---

### Subtask 10: Add Export and Update Index (5 min)

**Files:**
- `apps/web/src/components/editor/adjustment/index.tsx`

**Goal:** Export the new component for external use.

**Code to ADD** (after line 23):

```typescript
export { ConditionalImageUploader } from "./conditional-image-uploader";
```

**Why:** Proper exports maintain API consistency for the module.

---

### Subtask 11: Handle Model Switch with Existing Images (15 min)

**Files:**
- `apps/web/src/stores/adjustment-store.ts`

**Goal:** When user switches model, handle incompatible image counts gracefully.

**Code to MODIFY** - Update `setSelectedModel` action (lines 235-240):

**REPLACE:**
```typescript
    setSelectedModel: (model) => {
      set({
        selectedModel: model,
        parameters: getDefaultParameters(model),
      });
    },
```

**WITH:**
```typescript
    setSelectedModel: (model) => {
      const { multipleImages, multipleImageFiles } = get();

      // Import dynamically to avoid circular dependency
      const capabilities = getModelCapabilitiesSync(model);

      // If switching to single-image model with multiple images, keep only first
      if (!capabilities.supportsMultiple && multipleImages.length > 1) {
        // Clean up extra blob URLs
        for (let i = 1; i < multipleImages.length; i++) {
          const url = multipleImages[i];
          if (url.startsWith("blob:")) {
            URL.revokeObjectURL(url);
          }
        }

        set({
          selectedModel: model,
          parameters: getDefaultParameters(model),
          multipleImages: multipleImages.slice(0, 1),
          multipleImageFiles: multipleImageFiles.slice(0, 1),
        });
        return;
      }

      // If exceeding new model's max, trim to max
      if (multipleImages.length > capabilities.maxImages) {
        // Clean up extra blob URLs
        for (let i = capabilities.maxImages; i < multipleImages.length; i++) {
          const url = multipleImages[i];
          if (url.startsWith("blob:")) {
            URL.revokeObjectURL(url);
          }
        }

        set({
          selectedModel: model,
          parameters: getDefaultParameters(model),
          multipleImages: multipleImages.slice(0, capabilities.maxImages),
          multipleImageFiles: multipleImageFiles.slice(0, capabilities.maxImages),
        });
        return;
      }

      // Normal case - just switch model
      set({
        selectedModel: model,
        parameters: getDefaultParameters(model),
      });
    },
```

**Code to ADD** - Helper function at top of file (after imports):

```typescript
// Sync version of capabilities lookup to avoid async in store
function getModelCapabilitiesSync(modelId: string): { maxImages: number; supportsMultiple: boolean } {
  const capabilities: Record<string, { maxImages: number; supportsMultiple: boolean }> = {
    "seeddream-v4-5-edit": { maxImages: 10, supportsMultiple: true },
    "seeddream-v4": { maxImages: 6, supportsMultiple: true },
    "nano-banana": { maxImages: 4, supportsMultiple: true },
    "gemini-3-pro-edit": { maxImages: 4, supportsMultiple: true },
    "flux-2-flex-edit": { maxImages: 4, supportsMultiple: true },
    "seededit": { maxImages: 1, supportsMultiple: false },
    "flux-kontext": { maxImages: 1, supportsMultiple: false },
    "flux-kontext-max": { maxImages: 1, supportsMultiple: false },
    "reve-edit": { maxImages: 1, supportsMultiple: false },
  };
  return capabilities[modelId] || { maxImages: 1, supportsMultiple: false };
}
```

**Why:** Automatic image trimming prevents errors and provides smooth UX when switching models.

---

### Subtask 12: Add Unit Tests for Multi-Image Logic (20 min)

**Files:**
- `apps/web/src/lib/__tests__/image-edit-multi-image.test.ts` (NEW FILE)

**Goal:** Test multi-image upload and request building.

**Code to CREATE:**

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  getModelCapabilities,
  MODEL_CAPABILITIES
} from "../image-edit-client";

describe("Multi-Image Support", () => {
  describe("getModelCapabilities", () => {
    it("returns correct capabilities for multi-image models", () => {
      expect(getModelCapabilities("seeddream-v4-5-edit")).toEqual({
        maxImages: 10,
        supportsMultiple: true,
      });

      expect(getModelCapabilities("seeddream-v4")).toEqual({
        maxImages: 6,
        supportsMultiple: true,
      });

      expect(getModelCapabilities("nano-banana")).toEqual({
        maxImages: 4,
        supportsMultiple: true,
      });
    });

    it("returns correct capabilities for single-image models", () => {
      expect(getModelCapabilities("seededit")).toEqual({
        maxImages: 1,
        supportsMultiple: false,
      });

      expect(getModelCapabilities("reve-edit")).toEqual({
        maxImages: 1,
        supportsMultiple: false,
      });
    });

    it("returns default for unknown models", () => {
      expect(getModelCapabilities("unknown-model")).toEqual({
        maxImages: 1,
        supportsMultiple: false,
      });
    });
  });

  describe("MODEL_CAPABILITIES", () => {
    it("has entries for all known models", () => {
      const knownModels = [
        "seeddream-v4-5-edit",
        "seeddream-v4",
        "nano-banana",
        "gemini-3-pro-edit",
        "flux-2-flex-edit",
        "seededit",
        "flux-kontext",
        "flux-kontext-max",
        "reve-edit",
      ];

      for (const model of knownModels) {
        expect(MODEL_CAPABILITIES[model]).toBeDefined();
        expect(MODEL_CAPABILITIES[model].maxImages).toBeGreaterThan(0);
        expect(typeof MODEL_CAPABILITIES[model].supportsMultiple).toBe("boolean");
      }
    });
  });
});
```

**Why:** Tests ensure the capability logic works correctly and catches regressions.

---

## Testing Checklist

After completing all subtasks, verify:

- [ ] Single image upload works for SeedEdit v3, FLUX Kontext, Reve Edit
- [ ] Multi-image upload shows for SeedDream v4.5, SeedDream v4, Nano Banana, Gemini 3 Pro
- [ ] Max image count is enforced per model
- [ ] Switching from multi-image to single-image model trims images
- [ ] Switching from single-image to multi-image model enables multi-upload
- [ ] Image order is preserved during upload
- [ ] Remove individual images works
- [ ] Clear all images works
- [ ] Generation works with multiple images
- [ ] Progress shows correctly during batch upload
- [ ] Cost calculation accounts for multiple images (if applicable)
- [ ] All existing single-image functionality still works

---

## Files Summary

| File | Action | Subtask |
|------|--------|---------|
| `apps/web/src/lib/image-edit-client.ts` | MODIFY | 1, 2, 3, 4, 9 |
| `apps/web/src/stores/adjustment-store.ts` | MODIFY | 5, 11 |
| `apps/web/src/components/editor/adjustment/model-selector.tsx` | MODIFY | 6 |
| `apps/web/src/components/editor/adjustment/conditional-image-uploader.tsx` | CREATE | 7 |
| `apps/web/src/components/editor/adjustment/index.tsx` | MODIFY | 8, 10 |
| `apps/web/src/lib/__tests__/image-edit-multi-image.test.ts` | CREATE | 12 |

---

## Rollback Plan

If issues arise, revert in this order:
1. Remove `ConditionalImageUploader` usage from `index.tsx`
2. Restore original `ImageUploader` import
3. Remove new store actions
4. Remove `MODEL_CAPABILITIES` constant

The `imageUrls` array in `ImageEditRequest` is backward compatible and doesn't need rollback.
