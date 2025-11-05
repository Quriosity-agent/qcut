# Image-to-Video AI Models

This document lists all available image-to-video AI models in the application, including models that support first frame and last frame input.

## Models Overview

### Sora 2 Models

#### Sora 2 Image-to-Video
- **Price**: $0.10/s
- **Resolution**: 720p
- **Description**: Convert images to dynamic videos with Sora 2 (720p)
- **Duration**: 4-12 seconds

#### Sora 2 Image-to-Video Pro
- **Price**: $0.30-0.50
- **Resolution**: 720p / 1080p
- **Description**: High-quality image-to-video with 1080p support
- **Duration**: 4-12 seconds

---

### LTX Video 2.0 Models

#### LTX Video 2.0 I2V
- **Price**: $0.36
- **Resolution**: 1080p (up to 4K)
- **Description**: Image-to-video with audio generation (6-10s, up to 4K)
- **Duration**: 6-10 seconds
- **Features**: Audio generation

#### LTX Video 2.0 Fast I2V
- **Price**: $0.04-0.16
- **Resolution**: 1080p (up to 4K)
- **Description**: Image-to-video with audio generation (6-20s, up to 4K)
- **Duration**: 6-20 seconds
- **Features**: Audio generation, extended duration support

---

### Veo 3.1 Models

#### Veo 3.1 Fast Image-to-Video
- **Price**: $1.20
- **Resolution**: 720p / 1080p
- **Description**: Google's Veo 3.1 Fast - Animate static images with motion (faster, budget-friendly)
- **Duration**: 8 seconds
- **Features**: Fast processing, audio generation

#### Veo 3.1 Fast Frame-to-Video
- **Price**: $1.20
- **Resolution**: 720p / 1080p
- **Description**: Google's Veo 3.1 Fast - Animate between first and last frames (faster, budget-friendly)
- **Duration**: 8 seconds
- **Features**: **First frame + Last frame input support**, audio generation
- **Required Inputs**: First frame image, Last frame image

#### Veo 3.1 Image-to-Video
- **Price**: $3.20
- **Resolution**: 720p / 1080p
- **Description**: Google's Veo 3.1 - Premium quality image animation with motion
- **Duration**: 8 seconds
- **Features**: Premium quality, audio generation

#### Veo 3.1 Frame-to-Video
- **Price**: $3.20
- **Resolution**: 720p / 1080p
- **Description**: Google's Veo 3.1 - Premium quality animation between first and last frames
- **Duration**: 8 seconds
- **Features**: **First frame + Last frame input support**, premium quality, audio generation
- **Required Inputs**: First frame image, Last frame image

---

### Hailuo 2.3 Models

#### Hailuo 2.3 Standard
- **Price**: $0.28-0.56
- **Resolution**: 768p
- **Description**: Budget-friendly image-to-video with 768p quality
- **Duration**: 6-10 seconds

#### Hailuo 2.3 Fast Pro
- **Price**: $0.33
- **Resolution**: 1080p
- **Description**: Balanced 1080p image-to-video with faster generation
- **Duration**: 6-10 seconds

#### Hailuo 2.3 Pro
- **Price**: $0.49
- **Resolution**: 1080p
- **Description**: Premium 1080p image-to-video with highest fidelity
- **Duration**: 6-10 seconds

---

### Vidu Q2 Model

#### Vidu Q2 Turbo I2V
- **Price**: $0.05
- **Resolution**: 720p
- **Description**: High-quality image-to-video with motion control (2-8s)
- **Duration**: 2-8 seconds
- **Features**: Motion control with movement amplitude settings

---

## Models Supporting First Frame + Last Frame

The following models specifically support both first frame and last frame inputs to create smooth transitions:

1. **Veo 3.1 Fast Frame-to-Video** - $1.20, 720p/1080p
2. **Veo 3.1 Frame-to-Video** - $3.20, 720p/1080p

### Implementation Requirements

For first frame + last frame support implementation:
- File upload component for first frame image
- File upload component for last frame image
- Aspect ratio validation (frames must match)
- Maximum file size: 8MB per frame
- Supported formats: PNG, JPEG, WebP, AVIF, HEIF
- Aspect ratio constraints: 16:9 or 9:16

### UI Design Proposal

**Current State:**
- Single "Upload Image for Video Generation" area
- Works for standard image-to-video models (I2V)

**Proposed Design:**
The image upload section should be divided into two separate upload areas:

1. **First Frame** (Required)
   - Label: "Upload First Frame"
   - Upload button/dropzone for the starting frame
   - File format: JPG, PNG, WebP, GIF (max 10MB)
   - This field is always required for Frame-to-Video models

2. **Last Frame** (Optional)
   - Label: "Upload Last Frame (optional)"
   - Upload button/dropzone for the ending frame
   - File format: JPG, PNG, WebP, GIF (max 10MB)
   - This field is optional - when provided, enables frame-to-frame animation
   - When empty, models behave as standard image-to-video

**Dynamic Behavior:**
- When a Frame-to-Video model is selected (Veo 3.1 Frame-to-Video models):
  - Show both "First Frame" and "Last Frame" upload sections
  - Last frame section displays "(optional)" label
  - Validate aspect ratio matching between frames if both are provided

- When a standard Image-to-Video model is selected:
  - Show single "Upload Image" section (current behavior)
  - Hide the last frame upload section

**Benefits:**
- Backward compatible with existing single-image models
- Clear visual distinction between required and optional inputs
- Enables advanced frame-to-frame animation capabilities
- Maintains simple UX for users who only need basic I2V functionality

---

## Implementation Plan

### 1. Relevant File Paths

**Core Files to Modify:**
```
qcut/apps/web/src/components/editor/media-panel/views/
├── ai.tsx                    # Main AI generation UI component
├── ai-types.ts               # TypeScript interfaces and types
├── ai-constants.ts           # Model configurations (already contains Veo 3.1 models)
└── ai-history-panel.tsx      # History panel (may need updates for frame display)

qcut/apps/web/src/components/ui/
└── file-upload.tsx           # Reusable file upload component

qcut/apps/web/src/lib/
└── ai-video-output.ts        # Video output manager (may need frame handling)
```

**Files to Review (No Changes Expected):**
```
qcut/apps/web/src/types/
└── project.ts                # Project type definitions

qcut/apps/web/src/stores/
└── (AI-related stores if they exist)
```

### 2. Code Modifications Required

#### A. Type Definitions (`ai-types.ts`)
**Location:** Lines 79-100 (UseAIGenerationProps interface)

**Add new properties:**
```typescript
export interface UseAIGenerationProps {
  // ... existing properties ...

  // First + Last Frame support (NEW)
  firstFrame?: File | null;      // Required for F2V models
  lastFrame?: File | null;       // Optional for F2V models
  onFirstFrameChange?: (file: File | null) => void;
  onLastFrameChange?: (file: File | null) => void;
}
```

**Maintainability Notes:**
- Keep properties optional to maintain backward compatibility
- Use descriptive names (`firstFrame`/`lastFrame` vs generic `frame1`/`frame2`)
- Include JSDoc comments for future developers

#### B. Model Detection Logic (`ai-constants.ts`)
**Location:** Already contains Veo 3.1 Frame-to-Video models (lines ~330-415)

**Add helper function:**
```typescript
export const MODEL_HELPERS = {
  // ... existing helpers ...

  /**
   * Check if model requires first + last frame inputs
   * Long-term: Extend this for other F2V models as they're added
   */
  requiresFrameToFrame: (modelId: string): boolean => {
    const frameToVideoModels = [
      'veo31_fast_frame_to_video',
      'veo31_frame_to_video',
      // Add future F2V models here
    ];
    return frameToVideoModels.includes(modelId);
  },

  /**
   * Get required inputs for a model
   * Centralizes input requirements for maintainability
   */
  getRequiredInputs: (modelId: string): string[] => {
    const model = AI_MODELS.find(m => m.id === modelId);
    return model?.requiredInputs || [];
  },
};
```

**Maintainability Notes:**
- Centralize F2V model detection in one place
- Use array-based approach for easy extension
- Document why each model is included

#### C. UI Component (`ai.tsx`)
**Location:** Line 873-879 (Image upload section in "image" tab)

**Current Code Structure:**
```typescript
<TabsContent value="image" className="space-y-4">
  {/* Image upload */}
  <div className="space-y-2">
    <Label className="text-xs">
      {!isCompact && "Upload "}Image
      {!isCompact && " for Video Generation"}
    </Label>
    {/* FileUpload component */}
  </div>
</TabsContent>
```

**Proposed Refactoring:**
Extract to separate component for maintainability:
```typescript
// NEW FILE: ai-image-upload.tsx
export function AIImageUploadSection({
  selectedModels,
  firstFrame,
  lastFrame,
  onFirstFrameChange,
  onLastFrameChange,
  isCompact = false,
}: AIImageUploadSectionProps) {
  const requiresFrameToFrame = selectedModels.some(id =>
    MODEL_HELPERS.requiresFrameToFrame(id)
  );

  if (requiresFrameToFrame) {
    return (
      <>
        {/* First Frame Upload (Required) */}
        <FileUpload
          label="Upload First Frame"
          file={firstFrame}
          onChange={onFirstFrameChange}
          required
        />

        {/* Last Frame Upload (Optional) */}
        <FileUpload
          label="Upload Last Frame (optional)"
          file={lastFrame}
          onChange={onLastFrameChange}
          helpText="Leave empty to use as standard image-to-video"
        />
      </>
    );
  }

  // Standard single-image upload
  return (
    <FileUpload
      label={!isCompact ? "Upload Image for Video Generation" : "Image"}
      file={firstFrame} // Reuse firstFrame for backward compatibility
      onChange={onFirstFrameChange}
    />
  );
}
```

**Maintainability Notes:**
- Separate component reduces complexity in main `ai.tsx`
- Conditional rendering keeps logic clear
- Reuse `firstFrame` state for single-image models (no migration needed)
- Easy to extend for future upload types

#### D. State Management (`ai.tsx`)
**Location:** Component state declarations (top of component)

**Add new state variables:**
```typescript
const [firstFrame, setFirstFrame] = useState<File | null>(null);
const [lastFrame, setLastFrame] = useState<File | null>(null);

// Update existing selectedImage logic:
// For backward compatibility, sync firstFrame with selectedImage
useEffect(() => {
  if (firstFrame && !lastFrame) {
    // Single image mode - maintain backward compatibility
    setSelectedImage(firstFrame);
  }
}, [firstFrame, lastFrame]);
```

**Maintainability Notes:**
- Keep backward compatibility with `selectedImage` for existing code
- Document the relationship between `firstFrame` and `selectedImage`
- Plan migration path to eventually deprecate `selectedImage`

#### E. Validation Logic
**Location:** Form validation section in `ai.tsx`

**Add validation:**
```typescript
// Validate frame-to-frame inputs
if (selectedModels.some(id => MODEL_HELPERS.requiresFrameToFrame(id))) {
  if (!firstFrame) {
    setError("First frame is required for Frame-to-Video models");
    return;
  }

  // Optional: Validate aspect ratio matching if both frames provided
  if (lastFrame) {
    const aspectRatioMatch = await validateFrameAspectRatio(
      firstFrame,
      lastFrame
    );
    if (!aspectRatioMatch) {
      setError("First and last frames must have matching aspect ratios");
      return;
    }
  }
}
```

### 3. Implementation Subtasks (Estimated: 4-6 hours)

**Phase 1: Foundation (60-90 minutes)**

- [ ] **Task 1.1: Update `ai-types.ts` with new interfaces** (15 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`
  - **Read:** Lines 79-122 (UseAIGenerationProps interface)
  - **Location to Modify:** After line 122 (after `ltxv2ImageGenerateAudio?: boolean;`)

  **CODE TO ADD:**
  ```typescript
  // First + Last Frame support for Frame-to-Video models (Veo 3.1)
  /** First frame image file for F2V models. Required when F2V model selected. */
  firstFrame?: File | null;
  /** Last frame image file for F2V models. Optional - enables frame-to-frame animation. */
  lastFrame?: File | null;
  /** Callback when first frame changes. */
  onFirstFrameChange?: (file: File | null) => void;
  /** Callback when last frame changes. */
  onLastFrameChange?: (file: File | null) => void;
  ```

  **Exact Change:**
  - Find line 122: `ltxv2ImageGenerateAudio?: boolean;`
  - Add the above 8 lines immediately after line 122
  - Verify closing brace `}` is still on the next line (should be line 131 after insertion)

- [ ] **Task 1.2: Add helper functions to `ai-constants.ts`** (20 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
  - **Read:** Lines 836-885 (MODEL_HELPERS section)
  - **Location to Modify:** After line 884 (after `getModelDisplayName` function, before closing brace)

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
    const frameToVideoModels = [
      'veo31_fast_frame_to_video',
      'veo31_frame_to_video',
      // Add future F2V models here as they become available
    ];
    return frameToVideoModels.includes(modelId);
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
    const frameToVideoModels = [
      'veo31_fast_frame_to_video',
      'veo31_frame_to_video',
    ];
    return frameToVideoModels.includes(modelId);
  },

  getRequiredInputs: (modelId: string): string[] => {
    const model = AI_MODELS.find(m => m.id === modelId);
    return model?.requiredInputs || [];
  },
} as const;
  ```

- [ ] **Task 1.3: Write unit tests for helper functions** (25 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/__tests__/ai-constants.test.ts` (NEW)
  - **Create:** New test file

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

- [ ] **Task 1.4: Document type changes in inline comments** (10 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`
  - **Read:** Lines 1-9 (file header comments)
  - **Location to Modify:** Lines 1-9 (update header documentation)

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
   * ## Frame-to-Video (F2V) Support (Added 2025-11)
   * Added firstFrame/lastFrame props to support Veo 3.1 Frame-to-Video models.
   * - firstFrame: Required for F2V models, used as single image for I2V models
   * - lastFrame: Optional - when provided, enables frame-to-frame animation
   * - Backward compatible: existing I2V code continues to work with firstFrame only
   */
  ```

  **Action:** Replace lines 1-9 with updated header

---

**Phase 2: Component Extraction (90-120 minutes)**

- [ ] **Task 2.1: Create `ai-image-upload.tsx` component** (30 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-image-upload.tsx` (NEW)
  - **Read:**
    - `ai.tsx` lines 873-940 (current image upload JSX)
    - `file-upload.tsx` lines 11-38 (FileUploadConfig interface)
    - `ai-constants.ts` lines 836-885 (MODEL_HELPERS)
  - **Create:** New component file

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

- [ ] **Task 2.2: Implement conditional rendering logic** (25 min)
  - **Note:** ✅ Already completed in Task 2.1 (lines 614-677 of new component)
  - The component already includes:
    - `MODEL_HELPERS.requiresFrameToFrame()` check (line 614-616)
    - Dual FileUpload for F2V mode (lines 618-657)
    - Single FileUpload for I2V mode (lines 660-676)

- [ ] **Task 2.3: Add component prop validation** (15 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-image-upload.tsx`
  - **Read:** Lines where props are destructured
  - **Modify:** Add PropTypes or TypeScript validation:
    - Ensure callbacks are functions
    - Validate file types are File | null
    - Check selectedModels is string array
  - **Action:** Add runtime validation for development mode

- [ ] **Task 2.4: Create Storybook stories for testing** (20 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-image-upload.stories.tsx` (NEW)
  - **Read:** Existing `.stories.tsx` files in codebase for patterns
  - **Create:** Stories for:
    - Standard I2V mode (single upload)
    - F2V mode (dual upload)
    - F2V with only first frame provided
    - F2V with both frames provided
  - **Action:** Create visual test cases for all states

- [ ] **Task 2.5: Write component unit tests** (30 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/__tests__/ai-image-upload.test.tsx` (NEW)
  - **Read:**
    - `qcut/apps/web/src/components/ui/__tests__/` for test patterns
    - Vitest and React Testing Library docs
  - **Create:** Tests for:
    - Renders single upload for I2V models
    - Renders dual upload for F2V models
    - Calls onChange handlers correctly
    - Shows/hides optional label appropriately
  - **Action:** Achieve >90% code coverage for component

---

**Phase 3: Integration (90-120 minutes)**

- [ ] **Task 3.1: Add state variables to `ai.tsx`** (15 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
  - **Read:** Lines 89-98 (state declarations section at component start)
  - **Location to Modify:** After line 95 (after `const [imagePreview, setImagePreview]`)

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

- [ ] **Task 3.2: Integrate `AIImageUploadSection` component** (20 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
  - **Read:** Lines 873-940 (current image upload JSX)
  - **Location to Modify:** Lines 874-940 (entire image upload section)

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

- [ ] **Task 3.3: Implement validation logic** (30 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
  - **Read:** Lines searching for "validation" or form submit handler
  - **Modify:** In form validation section (before API calls):
    - Add check for F2V models requiring firstFrame
    - Add optional aspect ratio validation if both frames provided
    - Add file size validation (8MB limit for Veo 3.1)
  - **Create:** Helper function `validateFrameAspectRatio(file1, file2)` if needed
  - **Action:** Add validation rules before generation starts

- [ ] **Task 3.4: Update API calls to handle frame data** (25 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
  - **Read:** Search for API call functions (likely around "fal.run" or generation logic)
  - **Modify:** In generation function:
    - Detect if model requires F2V
    - Send firstFrame/lastFrame to API instead of single image
    - Handle FormData construction for dual frame upload
  - **Reference:** Check Veo 3.1 API docs for frame upload format
  - **Action:** Update payload construction for F2V models

- [ ] **Task 3.5: Test with Veo 3.1 models** (30 min)
  - **File:** Manual testing in development environment
  - **Test Cases:**
    1. Select Veo 3.1 Fast Frame-to-Video → verify dual upload appears
    2. Upload only first frame → verify error or fallback behavior
    3. Upload both frames with matching aspect ratio → verify generation succeeds
    4. Upload frames with mismatched aspect ratio → verify validation error
    5. Switch to standard I2V model → verify UI switches to single upload
  - **Action:** End-to-end testing of feature workflow

---

**Phase 4: Polish & Documentation (45-60 minutes)**

- [ ] **Task 4.1: Update history panel to display frames** (20 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-history-panel.tsx`
  - **Read:** Entire file (understand current history display logic)
  - **Modify:** In history item rendering:
    - Show thumbnail for firstFrame if available
    - Show thumbnail for lastFrame if available (with label)
    - Add visual indicator for F2V generations vs I2V
  - **Action:** Enhance history UI to distinguish frame-based generations

- [ ] **Task 4.2: Add error handling for edge cases** (15 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
  - **Read:** Error handling section and error state management
  - **Add:** Error messages for:
    - "First frame required for Frame-to-Video models"
    - "Frame aspect ratios must match"
    - "Frame file size exceeds 8MB limit"
    - "Invalid frame format (must be PNG, JPEG, WebP, AVIF, HEIF)"
  - **Reference:** `ai-constants.ts` lines 719-791 (ERROR_MESSAGES)
  - **Action:** Add new error constants and handling logic

- [ ] **Task 4.3: Write user-facing documentation** (10 min)
  - **File:** `qcut/docs/features/first-last-frame-support.md` (NEW)
  - **Create:** User guide with:
    - Overview of F2V feature
    - Which models support it
    - Step-by-step usage instructions
    - Tips for best results
    - Troubleshooting common issues
  - **Action:** Write clear, non-technical documentation for end users

- [ ] **Task 4.4: Create migration guide for developers** (15 min)
  - **File:** `qcut/docs/development/migrations/frame-to-video-support.md` (NEW)
  - **Create:** Developer guide with:
    - Changes to `ai-types.ts` interfaces
    - New helper functions in `ai-constants.ts`
    - Component extraction rationale
    - Backward compatibility notes
    - How to add future F2V models
  - **Action:** Document architectural changes for future maintainers

---

**Total Estimated Time:** 4-6 hours (245-390 minutes)

**Note:** Each task is designed to be completed independently. Read the specified file sections first to understand the context before making modifications.

### 4. Long-Term Maintainability Strategy

**Design Principles:**
1. **Separation of Concerns**
   - Extract upload UI to dedicated component
   - Keep model logic in constants/helpers
   - Isolate validation rules

2. **Backward Compatibility**
   - Reuse `firstFrame` for single-image workflows
   - Keep `selectedImage` temporarily for existing code
   - Gradual migration path (not breaking changes)

3. **Extensibility**
   - Helper functions in `ai-constants.ts` make adding new F2V models trivial
   - Component props allow easy feature additions
   - Type system enforces correct usage

4. **Testing**
   - Unit tests for helper functions
   - Component tests for UI logic
   - Integration tests for full workflow
   - Maintain test coverage >80%

5. **Documentation**
   - Inline JSDoc comments for all new functions
   - User-facing guide in `/docs/features/`
   - Developer migration guide for future refactoring
   - API documentation for frame upload format

**Future-Proofing Considerations:**
- When new F2V models are added, only update `MODEL_HELPERS.requiresFrameToFrame()`
- If multiple frame inputs needed (>2), extend component with array-based approach
- Plan for drag-and-drop reordering of frames
- Consider adding frame preview thumbnails
- Support for frame extraction from video (future feature)

**Code Review Checklist:**
- [ ] All new functions have JSDoc comments
- [ ] TypeScript strict mode passes
- [ ] No `any` types used
- [ ] Backward compatibility maintained
- [ ] Tests cover edge cases
- [ ] Error messages are user-friendly
- [ ] Accessibility standards met (ARIA labels, keyboard navigation)

---

## Model Comparison

| Model | Price | Resolution | Duration | First+Last Frame |
|-------|-------|------------|----------|------------------|
| Sora 2 I2V | $0.10/s | 720p | 4-12s | No |
| Sora 2 I2V Pro | $0.30-0.50 | 720p/1080p | 4-12s | No |
| LTX 2.0 I2V | $0.36 | 1080p-4K | 6-10s | No |
| LTX 2.0 Fast I2V | $0.04-0.16 | 1080p-4K | 6-20s | No |
| Veo 3.1 Fast I2V | $1.20 | 720p/1080p | 8s | No |
| Veo 3.1 Fast F2V | $1.20 | 720p/1080p | 8s | **Yes** |
| Veo 3.1 I2V | $3.20 | 720p/1080p | 8s | No |
| Veo 3.1 F2V | $3.20 | 720p/1080p | 8s | **Yes** |
| Hailuo 2.3 Standard | $0.28-0.56 | 768p | 6-10s | No |
| Hailuo 2.3 Fast Pro | $0.33 | 1080p | 6-10s | No |
| Hailuo 2.3 Pro | $0.49 | 1080p | 6-10s | No |
| Vidu Q2 Turbo | $0.05 | 720p | 2-8s | No |

---

## Notes

- F2V = Frame-to-Video (supports first + last frame)
- I2V = Image-to-Video (single image input)
- All prices are subject to change based on provider updates
- Models with audio generation capability are marked in their feature lists
