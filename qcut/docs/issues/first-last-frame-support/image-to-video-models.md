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
  - **Read:** Lines 79-100 (UseAIGenerationProps interface)
  - **Modify:** Add new properties after line 100:
    ```typescript
    firstFrame?: File | null;
    lastFrame?: File | null;
    onFirstFrameChange?: (file: File | null) => void;
    onLastFrameChange?: (file: File | null) => void;
    ```
  - **Action:** Insert new properties with JSDoc comments explaining their purpose

- [ ] **Task 1.2: Add helper functions to `ai-constants.ts`** (20 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
  - **Read:** Lines 836-885 (MODEL_HELPERS section)
  - **Modify:** Add two new helper functions after line 885:
    - `requiresFrameToFrame(modelId: string): boolean`
    - `getRequiredInputs(modelId: string): string[]`
  - **Action:** Implement helper methods for F2V model detection

- [ ] **Task 1.3: Write unit tests for helper functions** (25 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/__tests__/ai-constants.test.ts` (NEW)
  - **Read:** Existing test files in `__tests__` directory for patterns
  - **Create:** New test file with test cases:
    - Test `requiresFrameToFrame()` returns true for veo31 F2V models
    - Test `requiresFrameToFrame()` returns false for I2V models
    - Test `getRequiredInputs()` returns correct inputs for each model type
  - **Action:** Use Vitest framework (already configured)

- [ ] **Task 1.4: Document type changes in inline comments** (10 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`
  - **Read:** Lines 1-10 (file header comments)
  - **Modify:** Update header comment to document F2V support
  - **Action:** Add JSDoc comments above new properties explaining:
    - When firstFrame is required vs optional
    - That lastFrame being null falls back to I2V behavior
    - Migration notes for existing code

---

**Phase 2: Component Extraction (90-120 minutes)**

- [ ] **Task 2.1: Create `ai-image-upload.tsx` component** (30 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-image-upload.tsx` (NEW)
  - **Read:**
    - `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` lines 873-920 (current image upload section)
    - `qcut/apps/web/src/components/ui/file-upload.tsx` (understand FileUpload API)
  - **Create:** New component file with:
    - Interface `AIImageUploadSectionProps`
    - Component `AIImageUploadSection`
    - Conditional rendering for F2V vs I2V models
  - **Action:** Extract and refactor existing upload UI into reusable component

- [ ] **Task 2.2: Implement conditional rendering logic** (25 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-image-upload.tsx`
  - **Read:** `ai-constants.ts` MODEL_HELPERS section (to use helper functions)
  - **Modify:** Inside component body:
    - Check if selected models require F2V via `MODEL_HELPERS.requiresFrameToFrame()`
    - Render two FileUpload components for F2V
    - Render single FileUpload for standard I2V
  - **Action:** Implement branching logic with clear separation

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
  - **Read:** Lines 200-300 (state declarations section)
  - **Modify:** Add after existing image state variables:
    ```typescript
    const [firstFrame, setFirstFrame] = useState<File | null>(null);
    const [lastFrame, setLastFrame] = useState<File | null>(null);
    ```
  - **Add:** useEffect hook to sync firstFrame with selectedImage for backward compatibility
  - **Action:** Insert state management for frame uploads

- [ ] **Task 3.2: Integrate `AIImageUploadSection` component** (20 min)
  - **File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
  - **Read:** Lines 873-920 (current image upload JSX)
  - **Replace:** Entire `<div className="space-y-2">` section with:
    ```typescript
    <AIImageUploadSection
      selectedModels={selectedModels}
      firstFrame={firstFrame}
      lastFrame={lastFrame}
      onFirstFrameChange={setFirstFrame}
      onLastFrameChange={setLastFrame}
      isCompact={isCompact}
    />
    ```
  - **Action:** Replace inline upload UI with extracted component

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
