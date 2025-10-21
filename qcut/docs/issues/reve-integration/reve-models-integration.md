# Reve Models Integration Plan

This document outlines the integration of two Reve models from fal.ai into QCut:
1. **Reve Edit** - Image adjustment/editing model
2. **Reve Text-to-Image** - AI image generation model

## Quick Summary

### What We're Building
- **Reve Text-to-Image**: Add $0.04/image AI generation model to existing AI panel
- **Reve Edit**: Add image editing capabilities (upload image + text prompt → edited variations)

### Key Constraints
- ✅ **No Breaking Changes**: All modifications are additive
- ⏱️ **20-Minute Tasks**: Every subtask is ≤ 20 minutes for focused work
- 🔄 **Reuse Existing Code**: Leverage Veo 3.1 patterns and existing UI components
- 📝 **Type Safety**: Full TypeScript coverage for all new features

### Files to Modify (Quick Reference)

| File | Changes | Breaking? |
|------|---------|-----------|
| `apps/web/src/types/ai-generation.ts` | Add 4 new interfaces (Reve*Input/Output) | ✅ No - additive only |
| `apps/web/src/components/editor/media-panel/views/ai-constants.ts` | Add 2 model constants + validation rules | ✅ No - new exports |
| `apps/web/src/lib/fal-ai-client.ts` | Add 3 new methods (generateReve*, uploadImage*) | ✅ No - new methods |
| `apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` | Add image upload state management | ✅ No - new state |
| `apps/web/src/components/editor/media-panel/views/ai.tsx` | Add Reve UI sections (conditional rendering) | ✅ No - new sections |
| `apps/web/src/lib/image-validation.ts` | Create new validation utilities | ✅ No - new file |

### Estimated Effort
- **Phase 1 (Reve Text-to-Image)**: 2-3 hours → 8 subtasks
- **Phase 2 (Reve Edit)**: 4-6 hours → 13 subtasks
- **Phase 3 (Polish)**: 1-2 hours → 4 subtasks
- **Total**: 6-11 hours across 25 subtasks

---

## 1. Reve Edit Model (Image Adjustment)

### Overview
- **Category**: Image Adjustment/Editing
- **Purpose**: Edit existing images based on text prompts
- **Endpoint**: `https://fal.run/fal-ai/reve/edit`
- **Pricing**: TBD (check `/pricing` endpoint)

### API Specification

#### Required Input Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | string | Text description of how to edit the provided image |
| `image_url` | string | URL of the reference image to edit (must be publicly accessible or base64 data URI) |

#### Optional Input Parameters
| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `num_images` | integer | 1 | 1-4 | Number of edited variations to generate |
| `output_format` | enum | png | png, jpeg, webp | Output image format |
| `sync_mode` | boolean | false | — | Return media as data URI without request history |

#### Image Constraints
- **Supported formats**: PNG, JPEG, WebP, AVIF, HEIF
- **Maximum file size**: 10 MB
- **Minimum dimensions**: 128×128 px
- **Maximum dimensions**: 4096×4096 px

#### Output Format
```json
{
  "images": [
    {
      "url": "https://v3b.fal.media/files/...",
      "content_type": "image/png",
      "file_name": "string",
      "file_size": 0,
      "width": 1024,
      "height": 1024
    }
  ]
}
```

#### Example Request
```javascript
const result = await fal.subscribe("fal-ai/reve/edit", {
  input: {
    prompt: "Give him a friend",
    image_url: "https://v3b.fal.media/files/b/koala/sZE6zNTKjOKc4kcUdVlu__26bac54c-3e94-43e9-aeff-f2efc2631ef0.webp"
  }
});
```

### Integration Points for QCut

#### Where to Add
- **UI Location**: Image Adjustment/Effects panel
- **Feature Category**: Image editing tools alongside existing filters and effects

#### Files to Modify
1. **`apps/web/src/lib/fal-ai-client.ts`**
   - Add `generateReveEdit()` method
   - Handle image upload/URL conversion

2. **`apps/web/src/types/ai-generation.ts`**
   - Add `ReveEditInput` interface
   - Add `ReveEditOutput` interface

3. **UI Component** (create new or extend existing)
   - Image upload component
   - Text prompt input for edit instructions
   - Number of variations selector (1-4)
   - Output format selector
   - Preview and download results

#### Type Definitions
```typescript
interface ReveEditInput {
  prompt: string;
  image_url: string;
  num_images?: number; // 1-4
  output_format?: "png" | "jpeg" | "webp";
  sync_mode?: boolean;
}

interface ReveEditOutput {
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

---

## 2. Reve Text-to-Image Model (AI Images)

### Overview
- **Category**: AI Image Generation
- **Purpose**: Generate images from text descriptions
- **Endpoint**: `https://fal.run/fal-ai/reve/text-to-image`
- **Pricing**: **$0.04 per image**

### API Specification

#### Input Parameters
| Parameter | Type | Default | Options | Description |
|-----------|------|---------|---------|-------------|
| `prompt` | string | *required* | 1-2560 chars | Text description of the desired image |
| `aspect_ratio` | enum | `3:2` | `16:9`, `9:16`, `3:2`, `2:3`, `4:3`, `3:4`, `1:1` | Output aspect ratio |
| `num_images` | integer | 1 | 1-4 | Number of images to generate |
| `output_format` | enum | png | png, jpeg, webp | Output image format |
| `sync_mode` | boolean | false | — | Return media as data URI |

#### Output Format
```json
{
  "images": [
    {
      "url": "https://...",
      "content_type": "image/png",
      "file_name": "string",
      "file_size": 0,
      "width": 1024,
      "height": 1024
    }
  ]
}
```

#### Example Request
```json
{
  "prompt": "A serene mountain landscape at sunset with snow-capped peaks",
  "aspect_ratio": "16:9",
  "num_images": 1,
  "output_format": "png"
}
```

### Key Features
- Strong aesthetic quality with accurate text rendering
- Commercial use permitted
- Multiple image generation (up to 4 per request)
- Flexible output formats and aspect ratios

### Integration Points for QCut

#### Where to Add
- **UI Location**: AI Images panel (existing text2image view)
- **Add to Model List**: `TEXT2IMAGE_MODELS` in `lib/text2image-models.ts`

#### Files to Modify
1. **`apps/web/src/lib/text2image-models.ts`**
   - Add Reve model configuration

2. **`apps/web/src/lib/fal-ai-client.ts`**
   - Reve should work with existing `generateWithModel()` method
   - May need parameter conversion for aspect ratio

3. **`apps/web/src/components/editor/media-panel/views/text2image.tsx`**
   - Add aspect ratio selector if not already present
   - Update UI to support Reve-specific settings

#### Model Configuration
```typescript
{
  id: "reve-text-to-image",
  name: "Reve",
  description: "Strong aesthetic quality with accurate text rendering",
  endpoint: "fal-ai/reve/text-to-image",
  price: 0.04,
  category: "general",
  params: {
    aspect_ratio: {
      type: "select",
      default: "3:2",
      options: ["16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "1:1"]
    },
    num_images: {
      type: "number",
      default: 1,
      min: 1,
      max: 4
    },
    output_format: {
      type: "select",
      default: "png",
      options: ["png", "jpeg", "webp"]
    }
  }
}
```

#### Type Definitions
```typescript
interface ReveTextToImageInput {
  prompt: string; // 1-2560 characters
  aspect_ratio?: "16:9" | "9:16" | "3:2" | "2:3" | "4:3" | "3:4" | "1:1";
  num_images?: number; // 1-4
  output_format?: "png" | "jpeg" | "webp";
  sync_mode?: boolean;
}

interface ReveTextToImageOutput {
  images: Array<{
    url: string;
    content_type?: string;
    file_name?: string;
    file_size?: number;
    width?: number;
    height?: number;
  }>;
}
```

---

## Implementation Strategy

### Design Principles
- **Long-term Maintainability**: Reuse existing patterns, follow established conventions
- **Backward Compatibility**: All changes are additive - no breaking changes to existing features
- **Type Safety**: Comprehensive TypeScript interfaces for all new functionality
- **Separation of Concerns**: Keep API client, state management, and UI layers decoupled

### Task Time Limits
- **All subtasks**: ≤ 20 minutes each
- **Rationale**: Small, focused tasks reduce cognitive load, enable frequent commits, and make code review easier
- **Estimated total time**: 6-11 hours (Phase 1 + Phase 2 + Phase 3)

### Risk Mitigation
| Risk | Mitigation Strategy |
|------|---------------------|
| **Breaking existing AI features** | Each subtask includes "Breaking Change Check" verification |
| **Code duplication** | Actively reuse Veo 3.1 patterns and existing UI components |
| **Type safety issues** | Define comprehensive TypeScript interfaces before implementation |
| **Poor maintainability** | Follow existing naming conventions and code structure |
| **UI/UX inconsistency** | Reuse existing components from UI library and AI panel |

### Implementation Order
1. **Phase 1**: Reve Text-to-Image (easier, 2-3 hours) - Can ship independently
2. **Phase 2**: Reve Edit (moderate, 4-6 hours) - Requires Phase 1 for consistent UX
3. **Phase 3**: Polish & Documentation (optional, 1-2 hours) - Do after user feedback

---

### Phase 1: Reve Text-to-Image (Easier)
**Total Effort**: 2-3 hours | **All subtasks**: <20 minutes each

> **📝 Detailed Implementation Guide**: See [`IMPLEMENTATION-TASKS.md`](./IMPLEMENTATION-TASKS.md) for complete, copy-paste ready code for all tasks

#### 1.1 Type Definitions (15 min)
**File**: `apps/web/src/types/ai-generation.ts` (ADD after line 91)
- [ ] Add `ReveTextToImageInput` interface
- [ ] Add `ReveTextToImageOutput` interface
- [ ] Add `ReveEditInput` interface
- [ ] Add `ReveEditOutput` interface
- [ ] Export all types for use in client and UI components
- [ ] **Code**: See [IMPLEMENTATION-TASKS.md - Task 1.1](./IMPLEMENTATION-TASKS.md#task-11-add-type-definitions-15-min)
- [ ] **Maintainability**: Follow existing naming conventions (e.g., `Veo31*Input/Output`)
- [ ] **Breaking Change Check**: ✅ Additive only - no existing types modified

#### 1.2 Model Constants (10 min)
**File**: `apps/web/src/components/editor/media-panel/views/ai-constants.ts` (ADD after line 637)
- [ ] Add `REVE_TEXT_TO_IMAGE_MODEL` constant with endpoint, pricing, aspect ratios
- [ ] Add `REVE_EDIT_MODEL` constant with endpoint, pricing, image constraints
- [ ] Add Reve error messages to `ERROR_MESSAGES` object
- [ ] **Code**: See [IMPLEMENTATION-TASKS.md - Task 1.2](./IMPLEMENTATION-TASKS.md#task-12-add-model-constants-10-min)
- [ ] **Maintainability**: Use same structure as existing model constants
- [ ] **Breaking Change Check**: ✅ No changes to existing constants

#### 1.3 FAL Client Methods (20 min)
**File**: `apps/web/src/lib/fal-ai-client.ts` (ADD at end of class, ~line 820)
- [ ] Add `generateReveTextToImage()` method
- [ ] Add `generateReveEdit()` method
- [ ] Add JSDoc comments with usage examples
- [ ] Handle parameter mapping and error responses
- [ ] **Code**: See [IMPLEMENTATION-TASKS.md - Task 1.3](./IMPLEMENTATION-TASKS.md#task-13-add-fal-client-method-20-min)
- [ ] **Maintainability**: Follow existing `generateVeo31*()` method patterns
- [ ] **Breaking Change Check**: ✅ New methods only - no existing methods touched

#### 1.4 Model Configuration (15 min)
**Files**: Check `apps/web/src/lib/text2image-models.ts` OR `ai-constants.ts`
- [ ] If text2image-models.ts exists: Add Reve model configuration
- [ ] If doesn't exist: Add to AI_MODELS array in ai-constants.ts
- [ ] Configure default parameters (aspect_ratio: "3:2", num_images: 1, price: 0.04)
- [ ] **Code**: See [IMPLEMENTATION-TASKS.md - Task 1.4](./IMPLEMENTATION-TASKS.md#task-14-check-for-text2image-modelsts-15-min)
- [ ] **Maintainability**: Follow existing model configuration schema
- [ ] **Breaking Change Check**: ✅ Additive only - appending to model list

#### 1.5 UI Integration Test (15 min)
**Goal**: Verify existing AI UI works with Reve model
- [ ] Run app: `cd qcut/apps/web && bun dev`
- [ ] Check if Reve model appears in model selector
- [ ] Verify num_images selector works (1-4)
- [ ] Check if aspect ratio selector exists (may need to add)
- [ ] Test output format selector
- [ ] **Checklist**: See [IMPLEMENTATION-TASKS.md - Task 1.5](./IMPLEMENTATION-TASKS.md#task-15-test-ui-integration-15-min)
- [ ] **Maintainability**: Maximize reuse of existing UI components
- [ ] **Breaking Change Check**: ✅ No UI changes yet - testing only

#### 1.6 Aspect Ratio UI Enhancement (20 min) - *If needed from 1.5*
**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx` (Model-specific settings section)
- [ ] Add aspect ratio Select component with 7 options (16:9, 9:16, 3:2, 2:3, 4:3, 3:4, 1:1)
- [ ] Add state: `const [reveAspectRatio, setReveAspectRatio] = useState("3:2")`
- [ ] Use conditional rendering: `{selectedModel === "reve_text_to_image" && ...}`
- [ ] **Code**: See [IMPLEMENTATION-TASKS.md - Task 1.6](./IMPLEMENTATION-TASKS.md#task-16-add-aspect-ratio-ui-20-min---conditional-on-task-15)
- [ ] **Maintainability**: Component should work for future aspect-ratio models
- [ ] **Breaking Change Check**: ✅ Conditional - only shows for Reve model

#### 1.7 Pricing Display Update (10 min)
**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx` (Pricing section)
- [ ] Modify `calculateCost()` to handle "reve_text_to_image" and "reve_edit"
- [ ] Display: "$0.04 × {numImages} images" format
- [ ] Use `REVE_TEXT_TO_IMAGE_MODEL.pricing.perImage` constant
- [ ] **Code**: See [IMPLEMENTATION-TASKS.md - Task 1.7](./IMPLEMENTATION-TASKS.md#task-17-update-pricing-display-10-min)
- [ ] **Maintainability**: Use centralized pricing constants
- [ ] **Breaking Change Check**: ✅ Additive - extends existing pricing display

#### 1.8 Manual Testing (20 min)
**Checklist**: 7 test scenarios to verify Phase 1 works
- [ ] Test 1: Generate 1 image with defaults (3:2, PNG)
- [ ] Test 2: Generate 4 images (max batch)
- [ ] Test 3: All aspect ratios (16:9, 9:16, 3:2, 2:3, 4:3, 3:4, 1:1)
- [ ] Test 4: All formats (PNG, JPEG, WebP)
- [ ] Test 5: Pricing ($0.04, $0.08, $0.16)
- [ ] Test 6: Long prompt (2560 chars)
- [ ] Test 7: Verify existing models unaffected
- [ ] **Checklist**: See [IMPLEMENTATION-TASKS.md - Task 1.8](./IMPLEMENTATION-TASKS.md#task-18-manual-testing-checklist-20-min)
- [ ] **Breaking Change Check**: ✅ Verify existing models still work

---

### Phase 2: Reve Edit (Image Editing)
**Total Effort**: 4-6 hours | **All subtasks**: <20 minutes each

> **📝 Detailed Implementation Guide**: See [`IMPLEMENTATION-TASKS.md`](./IMPLEMENTATION-TASKS.md) for complete code (Tasks 2.1-2.6)

#### 2.1 Type Definitions (10 min)
**Status**: ✅ COMPLETED in Task 1.1
- [x] `ReveEditInput` interface already added
- [x] `ReveEditOutput` interface already added
- [ ] **Verification**: Confirm interfaces exist in ai-generation.ts
- [ ] **Code**: See [IMPLEMENTATION-TASKS.md - Task 2.1](./IMPLEMENTATION-TASKS.md#task-21-type-definitions-10-min)
- [ ] **Breaking Change Check**: ✅ Already verified as additive

#### 2.2 Image Upload Helper (20 min)
**Status**: ✅ EXISTS - Reuse existing method
- [x] `uploadImageToFal()` method exists (line 161-219)
- [ ] **Verification**: Confirm method signature matches Reve Edit needs
- [ ] **Code**: See [IMPLEMENTATION-TASKS.md - Task 2.2](./IMPLEMENTATION-TASKS.md#task-22-image-upload-helper-20-min)
- [ ] **Maintainability**: Reuse existing upload infrastructure
- [ ] **Breaking Change Check**: ✅ No changes needed

#### 2.3 Image Validation Utilities (15 min)
**File**: `apps/web/src/lib/image-validation.ts` (CREATE NEW FILE)
- [ ] Create `validateImageUpload()` generic function
- [ ] Create `getImageDimensions()` helper
- [ ] Create `validateReveEditImage()` specific validator
- [ ] Check: MIME type, file size (10MB), dimensions (128-4096px)
- [ ] **Code**: See [IMPLEMENTATION-TASKS.md - Task 2.3](./IMPLEMENTATION-TASKS.md#task-23-image-validation-utilities-15-min)
- [ ] **Maintainability**: Generic design for future image models
- [ ] **Breaking Change Check**: ✅ New file - no existing code modified

#### 2.4 FAL Client Method (20 min)
**Status**: ✅ COMPLETED in Task 1.3
- [x] `generateReveEdit()` method already added (~line 850-890)
- [ ] **Verification**: Confirm method exists and handles all parameters
- [ ] **Code**: See [IMPLEMENTATION-TASKS.md - Task 2.4](./IMPLEMENTATION-TASKS.md#task-24-fal-client-method-20-min)
- [ ] **Breaking Change Check**: ✅ Already verified as additive

#### 2.5 Model Constants (10 min)
**Status**: ✅ COMPLETED in Task 1.2
- [x] `REVE_EDIT_MODEL` constant already added (~line 670-690)
- [x] Validation constraints, error messages, pricing defined
- [ ] **Verification**: Confirm constant exists with all required fields
- [ ] **Code**: See [IMPLEMENTATION-TASKS.md - Task 2.5](./IMPLEMENTATION-TASKS.md#task-25-model-constants-10-min)
- [ ] **Breaking Change Check**: ✅ Already verified as additive

#### 2.6 State Management (15 min)
**File**: `apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- [ ] Add `uploadedImageForEdit`, `uploadedImagePreview`, `uploadedImageUrl` state
- [ ] Add `handleImageUploadForEdit()` function with validation
- [ ] Add `clearUploadedImage()` cleanup function
- [ ] Add import: `validateReveEditImage` from image-validation.ts
- [ ] Update return object with new state/functions
- [ ] **Code**: See [IMPLEMENTATION-TASKS.md - Task 2.6](./IMPLEMENTATION-TASKS.md#task-26-state-management-15-min)
- [ ] **Maintainability**: Follow Veo 3.1 frame upload pattern
- [ ] **Breaking Change Check**: ✅ New state only - no existing state modified

#### 2.7-2.13: UI Implementation (Remaining 2-3 hours)

> **⚠️ TODO**: These UI tasks need detailed implementation guide with code examples
>
> **Status**: Documented in main plan but need copy-paste ready code like Tasks 1.1-2.6
>
> **Summary of remaining tasks**:
> - 2.7: Image Upload UI Component (20 min) - File input, preview, clear button
> - 2.8: Image Validation UI (15 min) - Error display, tooltip constraints
> - 2.9: Edit Prompt Input (10 min) - Text input with examples
> - 2.10: Variations & Format Selector (10 min) - Dropdowns for num_images and format
> - 2.11: Result Preview & Download (20 min) - Image grid, download, add to timeline
> - 2.12: Integration Testing (20 min) - Upload/edit various formats
> - 2.13: End-to-End Testing (20 min) - Complete workflow validation

**File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

**Actions Needed**:
- [ ] Add Reve Edit tab/section with conditional rendering (`selectedModel === "reve_edit"`)
- [ ] Reuse Veo 3.1 frame upload UI patterns for image upload
- [ ] Add validation error display using validation utilities from Task 2.3
- [ ] Add edit prompt input (similar to text-to-video prompt)
- [ ] Add num_images selector (1-4) and output_format selector (png/jpeg/webp)
- [ ] Add result preview grid (similar to Veo 3.1 results)
- [ ] Add download and "Add to Timeline" buttons

**Testing Checklists**:
- [ ] Upload PNG, JPEG, WebP images (valid formats)
- [ ] Test file size limits (reject >10MB)
- [ ] Test dimension limits (reject <128px or >4096px)
- [ ] Generate 1-4 variations per edit
- [ ] Verify all output formats work
- [ ] Confirm existing AI features unaffected

**Maintainability**:
- Reuse existing UI components (Select, Input, Button, etc.)
- Follow Veo 3.1 frame upload UI patterns
- Use validation utilities from `image-validation.ts`

**Breaking Change Check**: ✅ All changes are conditional/additive

---

### Phase 3: Polish & Documentation (Optional)
**Total Effort**: 1-2 hours

#### 3.1 Error Handling Enhancement (15 min)
- [ ] Add user-friendly error messages for API failures
- [ ] Add retry logic for transient errors
- [ ] Log errors for debugging (console.error)
- [ ] **Maintainability**: Centralized error handling

#### 3.2 Loading States & Progress (15 min)
- [ ] Add loading spinner during image generation
- [ ] Add progress indicator for multi-image generation
- [ ] Disable UI controls during processing
- [ ] **Maintainability**: Reuse existing loading components

#### 3.3 Code Documentation (20 min)
- [ ] Add JSDoc comments to all new functions
- [ ] Document type interfaces with examples
- [ ] Add inline comments for complex logic
- [ ] **Maintainability**: Future developers can understand code

#### 3.4 User Documentation (20 min) - *Optional*
- [ ] Add Reve models to help/documentation
- [ ] Create usage examples for Reve Edit
- [ ] Document pricing for both models
- [ ] **Maintainability**: Keep docs in sync with code

### Testing Checklist

#### Reve Text-to-Image
- [ ] Generate single image with default settings
- [ ] Generate multiple images (2-4)
- [ ] Test all aspect ratios (16:9, 9:16, 3:2, 2:3, 4:3, 3:4, 1:1)
- [ ] Test all output formats (png, jpeg, webp)
- [ ] Verify pricing calculation ($0.04/image)
- [ ] Test long prompts (up to 2560 characters)

#### Reve Edit
- [ ] Upload and edit PNG image
- [ ] Upload and edit JPEG image
- [ ] Upload and edit WebP image
- [ ] Test image size limits (128×128 to 4096×4096)
- [ ] Test 10 MB file size limit
- [ ] Generate multiple variations (2-4)
- [ ] Test different output formats
- [ ] Verify edit quality and accuracy

---

## Cost Analysis

### Reve Text-to-Image
- **Single image**: $0.04
- **4 images (max)**: $0.16
- **Comparison**: Very affordable compared to other models (e.g., Veo 3.1 at $1.20-3.20)

### Reve Edit
- **Pricing**: TBD - Check fal.ai pricing page
- **Estimated**: Likely similar to text-to-image (~$0.04-0.08 per edit)

---

## Notes

### Authentication
Both models require FAL API key:
- Set `VITE_FAL_API_KEY` environment variable
- Or configure via `@fal-ai/client` package

### Commercial Use
Both models permit commercial use, making them suitable for QCut's professional video editing use case.

### Advantages
1. **Cost-effective**: Reve text-to-image is one of the cheapest models at $0.04/image
2. **Quality**: Strong aesthetic quality with accurate text rendering
3. **Flexibility**: Multiple aspect ratios and output formats
4. **Fast**: Reve Edit supports sync_mode for immediate results
5. **Multiple outputs**: Can generate up to 4 variations per request

### Potential Challenges
1. **Image Upload**: Reve Edit requires public URLs or base64 encoding
2. **File Size Limits**: Need to validate image size before upload
3. **Aspect Ratio Handling**: May need UI adjustments for Reve's aspect ratio options
4. **Error Handling**: Implement proper validation for image constraints

---

## Long-Term Maintenance Considerations

### Code Patterns to Follow
1. **Naming Conventions**
   - Functions: `generateReve*()`, `uploadImageFor*()`, `validateReve*Image()`
   - Types: `Reve*Input`, `Reve*Output` (matching existing `Veo31*Input/Output`)
   - Constants: `REVE_*_MODEL`, `REVE_*_PRICING` (uppercase with underscores)

2. **State Management Pattern**
   - Follow existing Zustand store patterns from Veo 3.1
   - Keep state in `use-ai-generation.ts` hook, not in UI components
   - Use descriptive state variable names: `uploadedImageForEdit`, `uploadedImagePreview`

3. **Error Handling Pattern**
   ```typescript
   // Consistent error handling across all new methods
   try {
     const result = await fal.subscribe("fal-ai/reve/...", { input });
     return result;
   } catch (error) {
     console.error("[Reve API Error]", error);
     throw new Error(`Failed to generate with Reve: ${error.message}`);
   }
   ```

4. **UI Component Pattern**
   - Use conditional rendering for model-specific UI
   - Reuse existing Select, Input, Button components
   - Match existing AI panel styling and layout
   ```tsx
   {selectedModel === "reve-text-to-image" && (
     <div className="reve-specific-settings">
       {/* Reve-specific UI */}
     </div>
   )}
   ```

### Future Extensibility

#### Adding More Reve Models (Future)
If fal.ai releases more Reve models, follow this pattern:
1. Add type definitions to `ai-generation.ts`
2. Add model constant to `ai-constants.ts`
3. Add client method to `fal-ai-client.ts`
4. Add UI section to `ai.tsx` (conditional rendering)

#### Adding More Image Upload Models (Future)
The image validation utilities in `image-validation.ts` are designed to be generic:
```typescript
// Reusable for future models
export function validateImageUpload(
  file: File,
  constraints: {
    maxSizeMB: number;
    minDimensions: { width: number; height: number };
    maxDimensions: { width: number; height: number };
    allowedFormats: string[];
  }
): { valid: boolean; error?: string }
```

### Testing Strategy for Future Changes
When modifying Reve integration code:
1. **Unit Tests**: Test client methods with mocked fal.ai API
2. **Integration Tests**: Test UI interaction with state management
3. **Regression Tests**: Verify existing AI features still work
4. **Manual Tests**: Follow testing checklists in Phase 1 & 2

### Debugging Tips
- **API Errors**: Check console for `[Reve API Error]` logs
- **Image Upload Failures**: Verify file size/dimensions in browser DevTools
- **UI Not Showing**: Check conditional rendering logic (model selection)
- **Type Errors**: Ensure all interfaces are properly exported from `ai-generation.ts`

### Performance Considerations
- **Image Upload**: Use base64 for small images (<1 MB), URLs for larger files
- **Multi-Image Generation**: Show progress indicator for num_images > 1
- **Result Caching**: Consider caching generated images to avoid re-generating

### Security Considerations
- **Input Validation**: Always validate file size/dimensions client-side before upload
- **API Key Protection**: Use environment variables (`VITE_FAL_API_KEY`)
- **MIME Type Enforcement**: Validate file type beyond HTML accept attribute
- **Error Messages**: Don't expose API keys or internal paths in error messages

---

## Conclusion

Both Reve models are excellent additions to QCut:
- **Reve Text-to-Image** enhances the AI image generation capabilities with a cost-effective, high-quality option
- **Reve Edit** adds powerful image adjustment features that complement the existing editing tools

### Implementation Approach
- ✅ **All subtasks ≤ 20 minutes** for focused, manageable work
- ✅ **No breaking changes** - all modifications are additive
- ✅ **Reuses existing patterns** from Veo 3.1 integration for consistency
- ✅ **Type-safe** with comprehensive TypeScript interfaces

### Recommended Order
1. **Phase 1**: Reve Text-to-Image first (easier, 2-3 hours)
2. **Phase 2**: Reve Edit second (moderate, 4-6 hours)
3. **Phase 3**: Polish & Documentation (optional, 1-2 hours)

### Success Metrics
- [ ] Both models work without breaking existing AI features
- [ ] Code follows existing patterns and conventions
- [ ] All TypeScript types are properly defined
- [ ] UI is consistent with existing AI panel design
- [ ] All testing checklists completed
