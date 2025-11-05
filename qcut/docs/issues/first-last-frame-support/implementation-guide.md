# First Frame + Last Frame Support - Implementation Guide

This guide provides detailed step-by-step instructions for implementing Frame-to-Video (F2V) support for Veo 3.1 models.

**Related Documents:**
- [Image-to-Video Models Overview](./image-to-video-models.md) - Model specifications and UI design
- [Main Issue Tracker](./README.md) - Project overview and progress tracking

---

## Implementation Subtasks (Estimated: 4-6 hours)

### Phase 1: Foundation (60-90 minutes)

#### Task 1.1: Update `ai-types.ts` with new interfaces (15 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`
**Read:** Lines 79-122 (UseAIGenerationProps interface)
**Location to Modify:** After line 122 (after `ltxv2ImageGenerateAudio?: boolean;`)

**CODE TO ADD:**
```typescript
// First + Last Frame support for Frame-to-Video models (Veo 3.1)
/** First frame image file for F2V models. Required when F2V model selected. */
firstFrame?: File | null;
/** Last frame image file for F2V models. Optional - enables frame-to-frame animation. */
lastFrame?: File | null;
/** Callback when first frame changes. */
onFirstFrameChange?: (file: File | null, preview?: string | null) => void;
/** Callback when last frame changes. */
onLastFrameChange?: (file: File | null, preview?: string | null) => void;
```

**Exact Change:**
- Find line 122: `ltxv2ImageGenerateAudio?: boolean;`
- Add the above 8 lines immediately after line 122
- Verify closing brace `}` is still on the next line (should be line 131 after insertion)

---

#### Task 1.2: Add helper functions to `ai-constants.ts` (20 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
**Read:** Lines 836-885 (MODEL_HELPERS section)
**Location to Modify:** After line 884 (after `getModelDisplayName` function, before closing brace)

**CURRENT CODE (line 882-885):**
```typescript
getModelDisplayName: (model: AIModel): string => {
  return `${model.name} ($${model.price})`;
},
} as const;
```

**CODE TO ADD (insert before line 885's closing brace):**
```typescript
/**
 * Check if model requires first + last frame inputs
 * Used to determine if F2V upload UI should be shown
 * @param modelId - Model ID to check
 * @returns true if model supports frame-to-frame animation
 */
requiresFrameToFrame: (modelId: string): boolean => {
  const model = AI_MODELS.find(m => m.id === modelId);
  return model?.requiredInputs?.includes('firstFrame') ?? false;
},

/**
 * Get required inputs for a model
 * Centralizes input requirements for maintainability
 * @param modelId - Model ID to check
 * @returns Array of required input keys (e.g., ['firstFrame', 'lastFrame'])
 */
getRequiredInputs: (modelId: string): string[] => {
  const model = AI_MODELS.find(m => m.id === modelId);
  return model?.requiredInputs || [];
},
```

**MODIFIED CODE (lines 882-885 become):**
```typescript
getModelDisplayName: (model: AIModel): string => {
  return `${model.name} ($${model.price})`;
},

requiresFrameToFrame: (modelId: string): boolean => {
  const model = AI_MODELS.find(m => m.id === modelId);
  return model?.requiredInputs?.includes('firstFrame') ?? false;
},

getRequiredInputs: (modelId: string): string[] => {
  const model = AI_MODELS.find(m => m.id === modelId);
  return model?.requiredInputs || [];
},
} as const;
```

**Note:** Confirm the Veo 3.1 Frame-to-Video entries in `AI_MODELS` declare `requiredInputs: ['firstFrame', 'lastFrame']`; update the dataset if new models are added.

---

#### Task 1.3: Write unit tests for helper functions (25 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/__tests__/ai-constants.test.ts` (NEW)
**Create:** New test file

**FULL FILE CONTENT:**
```typescript
import { describe, it, expect } from 'vitest';
import { MODEL_HELPERS } from '../ai-constants';

describe('MODEL_HELPERS', () => {
  describe('requiresFrameToFrame', () => {
    it('should return true for Veo 3.1 Fast Frame-to-Video', () => {
      expect(MODEL_HELPERS.requiresFrameToFrame('veo31_fast_frame_to_video')).toBe(true);
    });

    it('should return true for Veo 3.1 Frame-to-Video', () => {
      expect(MODEL_HELPERS.requiresFrameToFrame('veo31_frame_to_video')).toBe(true);
    });

    it('should return false for standard image-to-video models', () => {
      expect(MODEL_HELPERS.requiresFrameToFrame('veo31_fast_image_to_video')).toBe(false);
      expect(MODEL_HELPERS.requiresFrameToFrame('sora2_image_to_video')).toBe(false);
      expect(MODEL_HELPERS.requiresFrameToFrame('ltxv2_i2v')).toBe(false);
    });

    it('should return false for text-to-video models', () => {
      expect(MODEL_HELPERS.requiresFrameToFrame('sora2_text_to_video')).toBe(false);
      expect(MODEL_HELPERS.requiresFrameToFrame('ltxv2_pro_t2v')).toBe(false);
    });

    it('should return false for unknown model IDs', () => {
      expect(MODEL_HELPERS.requiresFrameToFrame('unknown_model')).toBe(false);
    });
  });

  describe('getRequiredInputs', () => {
    it('should return firstFrame and lastFrame for F2V models', () => {
      const inputs = MODEL_HELPERS.getRequiredInputs('veo31_fast_frame_to_video');
      expect(inputs).toEqual(['firstFrame', 'lastFrame']);
    });

    it('should return empty array for models without required inputs', () => {
      const inputs = MODEL_HELPERS.getRequiredInputs('sora2_image_to_video');
      expect(inputs).toEqual([]);
    });

    it('should return empty array for unknown model IDs', () => {
      const inputs = MODEL_HELPERS.getRequiredInputs('unknown_model');
      expect(inputs).toEqual([]);
    });
  });
});
```

**Action:** Create new file at specified path with above content

**Tip:** If additional F2V models are introduced, update `AI_MODELS` (or mock it within the test) so `MODEL_HELPERS` continues to surface the correct required inputs.

---

#### Task 1.4: Document type changes in inline comments (10 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`
**Read:** Lines 1-9 (file header comments)
**Location to Modify:** Lines 1-9 (update header documentation)

**CURRENT HEADER (lines 1-9):**
```typescript
/**
 * AI View Types and Interfaces
 *
 * Extracted from ai.tsx as part of safe refactoring process.
 * This file contains all TypeScript interfaces and types used by the AI video generation feature.
 *
 * @see ai-view-refactoring-guide.md for refactoring plan
 * @see ai-refactoring-subtasks.md for implementation tracking
 */
```

**UPDATED HEADER:**
```typescript
/**
 * AI View Types and Interfaces
 *
 * Extracted from ai.tsx as part of safe refactoring process.
 * This file contains all TypeScript interfaces and types used by the AI video generation feature.
 *
 * @see ai-view-refactoring-guide.md for refactoring plan
 * @see ai-refactoring-subtasks.md for implementation tracking
 *
 * ## Frame-to-Video (F2V) Support
 * Added firstFrame/lastFrame props to support Veo 3.1 Frame-to-Video models.
 * - firstFrame: Required for F2V models, used as single image for I2V models
 * - lastFrame: Optional - when provided, enables frame-to-frame animation
 * - Backward compatible: existing I2V code continues to work with firstFrame only
 * - See docs/development/migrations/frame-to-video-support.md for rollout details
 */
```

**Action:** Replace lines 1-9 with updated header

---

### Phase 2: Component Extraction (90-120 minutes)

#### Task 2.1: Create `ai-image-upload.tsx` component (30 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-image-upload.tsx` (NEW)
**Read:**
- `ai.tsx` lines 873-940 (current image upload JSX)
- `file-upload.tsx` lines 11-38 (FileUploadConfig interface)
- `ai-constants.ts` lines 836-885 (MODEL_HELPERS)

**Create:** New component file

**FULL FILE CONTENT:**
```typescript
/**
 * AI Image Upload Section Component
 * Handles both single-image (I2V) and dual-frame (F2V) upload modes
 */

import { FileUpload } from "@/components/ui/file-upload";
import { MODEL_HELPERS, UPLOAD_CONSTANTS } from "./ai-constants";

export interface AIImageUploadSectionProps {
  /** Array of selected model IDs to determine upload mode */
  selectedModels: string[];
  /** First frame file (required for F2V, used for single I2V) */
  firstFrame: File | null;
  /** First frame preview URL */
  firstFramePreview?: string | null;
  /** Last frame file (optional for F2V) */
  lastFrame: File | null;
  /** Last frame preview URL */
  lastFramePreview?: string | null;
  /** Callback when first frame changes */
  onFirstFrameChange: (file: File | null, preview?: string | null) => void;
  /** Callback when last frame changes */
  onLastFrameChange: (file: File | null, preview?: string | null) => void;
  /** Callback when validation error occurs */
  onError: (error: string) => void;
  /** Whether to show in compact mode */
  isCompact?: boolean;
}

export function AIImageUploadSection({
  selectedModels,
  firstFrame,
  firstFramePreview,
  lastFrame,
  lastFramePreview,
  onFirstFrameChange,
  onLastFrameChange,
  onError,
  isCompact = false,
}: AIImageUploadSectionProps) {
  // Check if any selected model requires F2V mode
  const requiresFrameToFrame = selectedModels.some((id) =>
    MODEL_HELPERS.requiresFrameToFrame(id)
  );

  if (requiresFrameToFrame) {
    // Dual-frame upload mode for F2V models
    return (
      <div className="space-y-4">
        <FileUpload
          id="ai-first-frame-input"
          label="First Frame"
          helperText="Required"
          fileType="image"
          acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_IMAGE_TYPES}
          maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
          maxSizeLabel={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
          formatsLabel={UPLOAD_CONSTANTS.IMAGE_FORMATS_LABEL}
          file={firstFrame}
          preview={firstFramePreview}
          onFileChange={onFirstFrameChange}
          onError={onError}
          isCompact={isCompact}
        />

        <FileUpload
          id="ai-last-frame-input"
          label="Last Frame"
          helperText="Optional"
          fileType="image"
          acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_IMAGE_TYPES}
          maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
          maxSizeLabel={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
          formatsLabel={UPLOAD_CONSTANTS.IMAGE_FORMATS_LABEL}
          file={lastFrame}
          preview={lastFramePreview}
          onFileChange={onLastFrameChange}
          onError={onError}
          isCompact={isCompact}
        />
        <p className="text-xs text-muted-foreground">
          Leave last frame empty to use as standard image-to-video
        </p>
      </div>
    );
  }

  // Standard single-image upload mode for I2V models
  return (
    <FileUpload
      id="ai-image-input"
      label={!isCompact ? "Upload Image for Video Generation" : "Image"}
      fileType="image"
      acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_IMAGE_TYPES}
      maxSizeBytes={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_BYTES}
      maxSizeLabel={UPLOAD_CONSTANTS.MAX_IMAGE_SIZE_LABEL}
      formatsLabel={UPLOAD_CONSTANTS.IMAGE_FORMATS_LABEL}
      file={firstFrame}
      preview={firstFramePreview}
      onFileChange={onFirstFrameChange}
      onError={onError}
      isCompact={isCompact}
    />
  );
}
```

**Action:** Create new file with above content

**Note:** The shared `FileUpload` component already exposes a remove button, so no additional `clearImage` helper is required in this component.

---

#### Task 2.2: Confirm conditional rendering logic (10 min)

**Action:** Use Storybook or a lightweight DOM test to confirm `AIImageUploadSection` toggles between single- and dual-upload layouts when `MODEL_HELPERS.requiresFrameToFrame` changes. Once verified, mark the legacy inline JSX in `ai.tsx` for removal.

---

#### Task 2.3: Finalize component prop typing (15 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-image-upload.tsx`
**Goal:** Keep validation in TypeScript by reusing shared types instead of runtime PropTypes.
**Action Items:**
- Export `AIImageUploadSectionProps` for reuse in consuming components/hooks.
- Ensure callbacks align with `UseAIGenerationProps` signatures (including optional preview string).
- Add JSDoc annotations where helpful so storybook/IDE hints stay accurate.

---

#### Task 2.4: Create Storybook stories for testing (20 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-image-upload.stories.tsx` (NEW)
**Read:** Existing `.stories.tsx` files in codebase for patterns
**Create:** Stories for:
- Standard I2V mode (single upload)
- F2V mode (dual upload)
- F2V with only first frame provided
- F2V with both frames provided

**Action:** Create visual test cases for all states

**Tip:** Stub file inputs by seeding mock `File` objects (via `new File([...], 'first.png', { type: 'image/png' })`) or static preview URLs so Storybook renders deterministic thumbnails.

---

#### Task 2.5: Write component unit tests (30 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/__tests__/ai-image-upload.test.tsx` (NEW)
**Read:**
- `qcut/apps/web/src/components/ui/__tests__/` for test patterns
- Vitest and React Testing Library docs

**Create:** Tests for:
- Renders single upload for I2V models
- Renders dual upload for F2V models
- Calls onChange handlers correctly
- Shows/hides optional label appropriately
- Emits validation errors via `onError` when the underlying `FileUpload` reports bad types/oversized files

**Action:** Achieve >90% code coverage for component

---

### Phase 3: Integration (90-120 minutes)

#### Task 3.1: Add state variables to `ai.tsx` (15 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
**Read:** Lines 89-98 (state declarations section at component start)
**Location to Modify:** After line 95 (after `const [imagePreview, setImagePreview]`)

**CURRENT CODE (lines 94-97):**
```typescript
const [selectedImage, setSelectedImage] = useState<File | null>(null);
const [imagePreview, setImagePreview] = useState<string | null>(null);
const [error, setError] = useState<string | null>(null);
const fileInputRef = useRef<HTMLInputElement>(null);
```

**CODE TO ADD (after line 95):**
```typescript
// Frame-to-Video state variables
const [firstFrame, setFirstFrame] = useState<File | null>(null);
const [firstFramePreview, setFirstFramePreview] = useState<string | null>(null);
const [lastFrame, setLastFrame] = useState<File | null>(null);
const [lastFramePreview, setLastFramePreview] = useState<string | null>(null);
```

**THEN ADD (around line 290, after other useEffect hooks):**
```typescript
// Sync firstFrame with selectedImage for backward compatibility
useEffect(() => {
  if (firstFrame && !lastFrame) {
    // Single image mode - maintain backward compatibility with I2V code
    setSelectedImage(firstFrame);
    setImagePreview(firstFramePreview);
  } else if (firstFrame && lastFrame) {
    // F2V mode - clear selectedImage to avoid confusion
    setSelectedImage(null);
    setImagePreview(null);
  } else {
    // Frames cleared - ensure legacy state is also cleared
    setSelectedImage(null);
    setImagePreview(null);
  }
}, [firstFrame, lastFrame, firstFramePreview]);
```

**MODIFIED CODE becomes:**
```typescript
const [selectedImage, setSelectedImage] = useState<File | null>(null);
const [imagePreview, setImagePreview] = useState<string | null>(null);
// Frame-to-Video state variables
const [firstFrame, setFirstFrame] = useState<File | null>(null);
const [firstFramePreview, setFirstFramePreview] = useState<string | null>(null);
const [lastFrame, setLastFrame] = useState<File | null>(null);
const [lastFramePreview, setLastFramePreview] = useState<string | null>(null);
const [error, setError] = useState<string | null>(null);
const fileInputRef = useRef<HTMLInputElement>(null);
```

---

#### Task 3.2: Integrate `AIImageUploadSection` component (20 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
**Read:** Lines 873-940 (current image upload JSX)
**Location to Modify:** Lines 874-940 (entire image upload section)

**STEP 1: Add import at top of file (after line 36):**
```typescript
import { AIImageUploadSection } from "./ai-image-upload";
```

**STEP 2: FIND AND DELETE (lines 874-940):**
```typescript
            {/* Image upload */}
            <div className="space-y-2">
              <Label className="text-xs">
                {!isCompact && "Upload "}Image
                {!isCompact && " for Video Generation"}
              </Label>

              <label
                htmlFor="ai-image-input"
                className={`block border-2 border-dashed rounded-lg cursor-pointer transition-colors min-h-[120px] focus-within:outline-none focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${
                  selectedImage
                    ? "border-primary/50 bg-primary/5 p-2"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50 p-4"
                }`}
                aria-label={
                  selectedImage
                    ? "Change selected image"
                    : "Click to upload an image"
                }
              >
                {selectedImage && imagePreview ? (
                  <div className="relative flex flex-col items-center justify-center h-full">
                    <img
                      src={imagePreview}
                      alt={selectedImage?.name ?? "File preview"}
                      className="max-w-full max-h-32 mx-auto rounded object-contain"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearImage();
                      }}
                      className="absolute top-1 right-1 h-6 w-6 p-0 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow-sm"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                    <div className="mt-2 text-xs text-muted-foreground text-center">
                      {selectedImage.name}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full space-y-2 text-center">
                    <Upload className="size-8 text-muted-foreground" />
                    <div className="text-xs text-muted-foreground">
                      Click to upload an image
                    </div>
                    <div className="text-xs text-muted-foreground/70">
                      JPG, PNG, WebP, GIF (max 10MB)
                    </div>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  id="ai-image-input"
                  type="file"
                  accept={UPLOAD_CONSTANTS.SUPPORTED_FORMATS.join(",")}
                  onChange={handleImageSelect}
                  className="sr-only"
                  aria-describedby="ai-image-help"
                />
              </label>
              <p id="ai-image-help" className="sr-only">
                JPG, PNG, WebP, GIF (max 10MB)
              </p>
```

**STEP 3: REPLACE with:**
```typescript
            {/* Image upload - supports both I2V and F2V modes */}
            <AIImageUploadSection
              selectedModels={selectedModels}
              firstFrame={firstFrame}
              firstFramePreview={firstFramePreview}
              lastFrame={lastFrame}
              lastFramePreview={lastFramePreview}
              onFirstFrameChange={(file, preview) => {
                setFirstFrame(file);
                setFirstFramePreview(preview || null);
              }}
              onLastFrameChange={(file, preview) => {
                setLastFrame(file);
                setLastFramePreview(preview || null);
              }}
              onError={setError}
              isCompact={isCompact}
            />
```

**Result:** Lines 874-940 reduced to ~15 lines with new component

**Cleanup:** Remove `fileInputRef`, `handleImageSelect`, and any `clearImage` helper now superseded by `FileUpload`'s internal remove button.

---

#### Task 3.3: Implement validation logic (30 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
**Read:** Lines searching for "validation" or form submit handler
**Modify:** In form validation section (before API calls):
- Add check for F2V models requiring firstFrame
- Add optional aspect ratio validation if both frames provided
- Add file size validation (8MB limit for Veo 3.1)

**Create:** Helper function `validateFrameAspectRatio(file1, file2)` if needed
**Action:** Add validation rules before generation starts (load images via `createImageBitmap`/`Image.decode` so width/height are available before comparing aspect ratios)

---

#### Task 3.4: Update API calls to handle frame data (25 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
**Read:** Search for API call functions (likely around "fal.run" or generation logic)
**Modify:** In generation function:
- Detect if model requires F2V
- Send firstFrame/lastFrame to API instead of single image
- Handle FormData construction for dual frame upload

**Reference:** Check Veo 3.1 API docs for frame upload format (field names: e.g., `first_frame`, `last_frame`)
**Action:** Update payload construction for F2V models and confirm multipart keys match the API spec

---

#### Task 3.5: Test with Veo 3.1 models (30 min)

**File:** Manual testing in development environment

**Test Cases:**
1. Select Veo 3.1 Fast Frame-to-Video — verify dual upload appears
2. Upload only first frame — verify error or fallback behavior
3. Upload both frames with matching aspect ratio — verify generation succeeds
4. Upload frames with mismatched aspect ratio — verify validation error
5. Switch between F2V and I2V models multiple times without reload — verify state resets and UI switches correctly

**Action:** End-to-end testing of feature workflow

---

### Phase 4: Polish & Documentation (45-60 minutes)

#### Task 4.1: Update history panel to display frames (20 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-history-panel.tsx`
**Read:** Entire file (understand current history display logic)
**Modify:** In history item rendering:
- Show thumbnail for firstFrame if available
- Show thumbnail for lastFrame if available (with label)
- Add visual indicator for F2V generations vs I2V

**Action:** Enhance history UI to distinguish frame-based generations and provide a placeholder when frame URLs are missing

---

#### Task 4.2: Add error handling for edge cases (15 min)

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
**Read:** Error handling section and error state management
**Add:** Error messages for:
- "First frame required for Frame-to-Video models"
- "Frame aspect ratios must match"
- "Frame file size exceeds 8MB limit"
- "Invalid frame format (must be PNG, JPEG, WebP, AVIF, HEIF)"

**Reference:** `ai-constants.ts` lines 719-791 (ERROR_MESSAGES) + any i18n/enum switch statements
**Action:** Add new error constants, wire them into the error enum/i18n tables, and display the strings in the UI

---

#### Task 4.3: Write user-facing documentation (10 min)
> **Review:** Sync terminology with product (they call it 'Frame Pair') and surface the 8MB limit here so support has a single source of truth.

**File:** `qcut/docs/features/first-last-frame-support.md` (NEW)
**Create:** User guide with:
- Overview of F2V feature
- Which models support it
- Step-by-step usage instructions
- Tips for best results
- Troubleshooting common issues

**Action:** Write clear, non-technical documentation for end users

---

#### Task 4.4: Create migration guide for developers (15 min)
> **Review:** Call out that folks need to regenerate Vitest snapshots or tests after adopting the new helpers; CI will fail otherwise.

**File:** `qcut/docs/development/migrations/frame-to-video-support.md` (NEW)
**Create:** Developer guide with:
- Changes to `ai-types.ts` interfaces
- New helper functions in `ai-constants.ts`
- Component extraction rationale
- Backward compatibility notes
- How to add future F2V models

**Action:** Document architectural changes for future maintainers

---

## Total Estimated Time: 4-6 hours (245-390 minutes)

**Note:** Each task is designed to be completed independently. Read the specified file sections first to understand the context before making modifications.

---

## Progress Tracking

Use this checklist to track implementation progress:

**Phase 1: Foundation**
- [ ] Task 1.1: Update ai-types.ts
- [ ] Task 1.2: Add helper functions
- [ ] Task 1.3: Write unit tests
- [ ] Task 1.4: Document changes

**Phase 2: Component Extraction**
- [ ] Task 2.1: Create component
- [ ] Task 2.2: Conditional rendering (✅ done in 2.1)
- [ ] Task 2.3: Prop validation
- [ ] Task 2.4: Storybook stories
- [ ] Task 2.5: Unit tests

**Phase 3: Integration**
- [ ] Task 3.1: Add state variables
- [ ] Task 3.2: Integrate component
- [ ] Task 3.3: Validation logic
- [ ] Task 3.4: API calls
- [ ] Task 3.5: End-to-end testing

**Phase 4: Polish & Documentation**
- [ ] Task 4.1: History panel
- [ ] Task 4.2: Error handling
- [ ] Task 4.3: User docs
- [ ] Task 4.4: Developer docs
