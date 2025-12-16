# Multiple Image Input for AI Image Editing

## Overview

This document outlines the plan to add multiple image input support to the AI Image Editing feature. Currently, the UI only supports uploading a single image, but several models support multi-image compositing.

## Current Implementation

The image edit feature is located at:
- UI: `apps/web/src/components/editor/media-panel/views/adjustment/` (Adjustment tab)
- Client: `apps/web/src/lib/image-edit-client.ts`
- Models: `apps/web/src/lib/text2image-models.ts`

### Current Single Image Flow

1. User uploads one image via the UI
2. Image is converted to base64 or uploaded to FAL
3. API receives either `image_url` (string) or `image_urls` (array with 1 element)
4. Model processes and returns edited result

---

## Model Multi-Image Support Analysis

### Models That Support Multiple Image Input

| Model | Max Images | API Parameter | Use Case |
|-------|-----------|---------------|----------|
| **SeedDream v4.5 Edit** | 10 | `image_urls[]` | Multi-image compositing, combining elements from multiple sources |
| **SeedDream v4** | 6 | `image_urls[]` | Multi-image processing with unified architecture |
| **Nano Banana** | Multiple | `image_urls[]` | Smart editing with multiple reference images |
| **Gemini 3 Pro Edit** | Multiple | `image_urls[]` | Context-aware editing with multiple inputs |
| **FLUX 2 Flex Edit** | Multiple | `image_urls[]` | Flexible editing with multiple references |

### Models That Only Support Single Image Input

| Model | API Parameter | Notes |
|-------|---------------|-------|
| **SeedEdit v3** | `image_url` (string) | Photo retouching, precise edits - single image only |
| **FLUX Pro Kontext** | `image_url` (string) | Context-aware single image transformations |
| **FLUX Pro Kontext Max** | `image_url` (string) | Advanced single image editing |
| **Reve Edit** | `image_url` (string) | Cost-effective single image editing |

---

## Implementation Plan

### Phase 1: UI Updates

1. **Add Multi-Image Upload Component**
   - Create a reusable `MultiImageUploader` component
   - Support drag & drop for multiple files
   - Show image previews in a grid layout
   - Allow reordering images (order matters for compositing)
   - Max images indicator based on selected model

2. **Update Model Selector**
   - Show badge/indicator for models supporting multiple images
   - Display max image count for each model
   - Disable multi-image upload when single-image model is selected

3. **Image Preview Grid**
   - Thumbnail grid with remove/reorder buttons
   - Primary image indicator (first image in array)
   - File size and dimension info

### Phase 2: State Management

1. **Update Adjustment Store**
   - Change `selectedImage: File | null` to `selectedImages: File[]`
   - Add `imageOrder: string[]` for drag-reorder support
   - Add model capability detection

2. **Validation Logic**
   - Validate image count against model's max
   - Show warning when reducing images after exceeding limit
   - Handle model switch with incompatible image count

### Phase 3: API Integration

1. **Update `editImage()` function**
   ```typescript
   // Current (single image)
   payload.image_urls = [request.imageUrl];

   // Updated (multiple images)
   payload.image_urls = request.imageUrls; // string[]
   ```

2. **Update `uploadImageToFAL()` function**
   ```typescript
   // Add batch upload support
   async function uploadImagesToFAL(files: File[]): Promise<string[]>
   ```

3. **Update Request Interface**
   ```typescript
   export interface ImageEditRequest {
     imageUrl?: string;        // Deprecated, for backwards compatibility
     imageUrls?: string[];     // New: array of image URLs
     // ... rest of properties
   }
   ```

### Phase 4: Cost Calculation

- Update cost display to account for multiple images
- Some models may charge per-image, others may have flat rate
- Show clear pricing breakdown in UI

---

## File Changes Required

### Must Modify

| File | Changes |
|------|---------|
| `apps/web/src/lib/image-edit-client.ts` | Add multi-image upload, update request handling |
| `apps/web/src/stores/adjustment-store.ts` | Change to array-based image state |
| `apps/web/src/components/editor/adjustment/image-uploader.tsx` | Multi-image upload UI |
| `apps/web/src/components/editor/adjustment/model-selector.tsx` | Add multi-image indicators |
| `apps/web/src/components/editor/adjustment/index.tsx` | Wire up multi-image flow |

### May Need Updates

| File | Potential Changes |
|------|-------------------|
| `apps/web/src/components/editor/adjustment/preview-panel.tsx` | Multi-image preview |
| `apps/web/src/components/editor/adjustment/parameter-controls.tsx` | Image count controls |
| `apps/web/src/lib/image-validation.ts` | Batch validation |

---

## UI Mockup Concept

```
+------------------------------------------+
|  MODEL SELECTION                         |
|  [v] SeedDream v4.5 Edit    $0.04-0.08  |
|      Supports up to 10 images            |
+------------------------------------------+
|                                          |
|  Upload images to edit                   |
|  Drag & drop or click - JPEG, PNG, WebP  |
|                                          |
|  [+] [+] [+] [+] [+] [+] [+] [+] [+] [+] |
|  (placeholders for 10 images max)        |
|                                          |
|  Currently: 3/10 images                  |
|                                          |
|  +-------+ +-------+ +-------+           |
|  | img1  | | img2  | | img3  |           |
|  |  [x]  | |  [x]  | |  [x]  |           |
|  +-------+ +-------+ +-------+           |
|                                          |
+------------------------------------------+
|  Prompt: [Combine these into a collage] |
+------------------------------------------+
|  [ Generate Edit ]                       |
+------------------------------------------+
```

---

## Edge Cases to Handle

1. **Model Switch with Too Many Images**
   - User selects 8 images with SeedDream v4.5 (max 10)
   - User switches to SeedDream v4 (max 6)
   - Solution: Show warning, optionally auto-trim to last N images

2. **Single-Image Model Selected**
   - Hide multi-image UI entirely
   - Only show single image upload

3. **Order Matters**
   - First image is typically the "primary" reference
   - Allow drag-to-reorder functionality
   - Clearly indicate which image is primary

4. **Large File Handling**
   - Batch upload progress indicator
   - Parallel vs sequential upload options
   - Total size limit enforcement

---

## Testing Checklist

- [ ] Single image upload still works for all models
- [ ] Multi-image upload works for supported models
- [ ] Image count validation per model
- [ ] Model switching with images loaded
- [ ] Drag-to-reorder functionality
- [ ] Remove individual images
- [ ] Clear all images
- [ ] Cost calculation with multiple images
- [ ] Error handling for upload failures
- [ ] Progress indication for batch uploads

---

## References

- FAL.ai API Documentation: https://fal.ai/models
- Existing multi-image component: `apps/web/src/components/editor/adjustment/multi-image-upload.tsx`
- SeedDream 4.5 implementation: `apps/web/src/lib/__tests__/seeddream45.test.ts`
