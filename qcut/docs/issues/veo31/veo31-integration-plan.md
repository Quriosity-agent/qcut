# Veo 3.1 Integration Plan

**Version:** 1.0
**Date:** 2025-10-20
**Branch:** `veo31`
**Status:** Planning Phase

## Executive Summary

This document outlines the integration plan for adding three Google Veo 3.1 AI video generation models to the QCut video editor. The integration will extend the existing AI features panel to support Google's latest video generation capabilities while maintaining backward compatibility with existing features.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [API Documentation](#api-documentation)
3. [Architecture Analysis](#architecture-analysis)
4. [Files to Modify](#files-to-modify)
5. [Implementation Tasks](#implementation-tasks)
6. [Testing Strategy](#testing-strategy)
7. [Migration & Rollback Plan](#migration--rollback-plan)

---

## Overview

### What is Veo 3.1?

Google's Veo 3.1 Fast is a video generation model that produces high-quality 720p or 1080p videos at 24 FPS. The integration will add three distinct capabilities:

1. **Text-to-Video**: Generate videos from text prompts
2. **Image-to-Video**: Animate static images with motion
3. **Frame-to-Video**: Create videos by animating between first and last frames

### Integration Goals

- ✅ Add Veo 3.1 models to existing AI panel without breaking current features
- ✅ Reuse existing fal.ai client infrastructure
- ✅ Follow established patterns from Sora 2, Kling, and WAN integrations
- ✅ Maintain type safety and error handling standards
- ✅ Support all Veo 3.1 parameters (resolution, duration, aspect ratio, audio)

---

## API Documentation

### 1. Veo 3.1 Fast (Text-to-Video)

**Endpoint:** `fal-ai/veo3.1/fast`

**Input Parameters:**
```typescript
interface Veo31TextToVideoInput {
  prompt: string;                    // Required: Text description
  aspect_ratio?: "9:16" | "16:9" | "1:1";  // Default: "16:9"
  duration?: "4s" | "6s" | "8s";    // Default: "8s"
  resolution?: "720p" | "1080p";    // Default: "720p"
  generate_audio?: boolean;          // Default: true
  negative_prompt?: string;          // Optional guidance refinement
  enhance_prompt?: boolean;          // Default: true
  seed?: number;                     // For reproducibility
  auto_fix?: boolean;                // Policy compliance, default: true
}
```

**Output:**
```typescript
interface Veo31Response {
  video: {
    url: string;
    content_type: "video/mp4";
    file_name: "output.mp4";
  };
}
```

**Pricing:**
- Audio ON: $0.15/second
- Audio OFF: $0.10/second
- Example: 8s video with audio = $1.20

---

### 2. Veo 3.1 Fast Image-to-Video

**Endpoint:** `fal-ai/veo3.1/fast/image-to-video`

**Input Parameters:**
```typescript
interface Veo31ImageToVideoInput {
  prompt: string;                    // Required: Animation description
  image_url: string;                 // Required: Input image (720p+, 16:9 or 9:16)
  aspect_ratio?: "16:9" | "9:16";   // Default: "16:9"
  duration?: "8s";                   // Currently only "8s" supported
  resolution?: "720p" | "1080p";    // Default: "720p"
  generate_audio?: boolean;          // Default: true
}
```

**Output:** Same as text-to-video

**Pricing:** Same as text-to-video

**Constraints:**
- Images up to 8MB
- 16:9 or 9:16 aspect ratios only
- Currently supports 8-second duration only

---

### 3. Veo 3.1 Fast First-Last-Frame-to-Video

**Endpoint:** `fal-ai/veo3.1/fast/first-last-frame-to-video`

**Input Parameters:**
```typescript
interface Veo31FrameToVideoInput {
  prompt: string;                    // Required: Animation description
  first_frame_url: string;           // Required: Opening frame
  last_frame_url: string;            // Required: Closing frame
  aspect_ratio?: "auto" | "9:16" | "16:9" | "1:1"; // Default: "auto"
  duration?: "8s";                   // Currently only "8s" supported
  resolution?: "720p" | "1080p";    // Default: "720p"
  generate_audio?: boolean;          // Default: true
}
```

**Output:** Same as text-to-video

**Pricing:** Same as text-to-video

**Constraints:**
- Images up to 8MB each
- 16:9 or 9:16 aspect ratios
- Currently supports 8-second duration only

---

## Architecture Analysis

### Current AI Panel Architecture

The QCut AI panel follows a modular architecture:

```
┌─────────────────────────────────────────┐
│     AI Features Panel (ai.tsx)          │
│  ┌───────────────────────────────────┐  │
│  │  Tab Selector (Text/Image/Avatar) │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  Model Selection (Multi-select)   │  │
│  │  - Filtered by active tab         │  │
│  │  - Shows price & resolution       │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  Model-Specific Settings          │  │
│  │  - Sora 2: duration, resolution   │  │
│  │  - Veo 3.1: (to be added)         │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  Generation Hook                  │  │
│  │  (use-ai-generation.ts)           │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│   FAL AI Client (fal-ai-client.ts)      │
│   - API key management                  │
│   - Request/response handling           │
│   - Error handling                      │
└─────────────────────────────────────────┘
```

### Existing Integration Patterns

Based on analysis of existing code:

1. **Model Definition Pattern** (`ai-constants.ts`):
   - Each model has: id, name, description, price, resolution, category
   - Models are filtered by category (text/image/avatar)
   - Multi-model selection supported

2. **Client Pattern** (`fal-ai-client.ts`, `fal-ai-service.ts`):
   - Centralized API key configuration
   - Type-safe request/response interfaces
   - Standardized error handling
   - Support for both direct API calls and @fal-ai/client SDK

3. **UI Pattern** (`ai.tsx`):
   - Tab-based organization (Text, Image, Avatar)
   - Model-specific settings panels (conditional rendering)
   - Progress tracking with elapsed time
   - Results display with download buttons

---

## Files to Modify

### Core Implementation Files

#### 1. Model Configuration
**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
- **Purpose:** Add Veo 3.1 model definitions
- **Changes:**
  - Add 3 new model entries to `AI_MODELS` array
  - Set `category: "veo31"` or reuse existing categories
  - Define pricing, resolution, and feature flags

**Example Addition:**
```typescript
{
  id: "veo31_text_to_video",
  name: "Veo 3.1 Text-to-Video",
  description: "Google's Veo 3.1 Fast - Text to video generation",
  price: "1.20", // 8s @ $0.15/s with audio
  resolution: "720p/1080p",
  category: "text", // Reuse existing text category
  features: ["audio", "enhance_prompt", "auto_fix"]
}
```

---

#### 2. Type Definitions
**File:** `qcut/apps/web/src/types/ai-generation.ts` (new file or add to existing)
- **Purpose:** Define TypeScript interfaces for Veo 3.1
- **Changes:**
  - Create interfaces for all three endpoints
  - Add response types
  - Export for use in client and hooks

**New Types:**
```typescript
export interface Veo31TextToVideoInput {
  prompt: string;
  aspect_ratio?: "9:16" | "16:9" | "1:1";
  duration?: "4s" | "6s" | "8s";
  resolution?: "720p" | "1080p";
  generate_audio?: boolean;
  negative_prompt?: string;
  enhance_prompt?: boolean;
  seed?: number;
  auto_fix?: boolean;
}

export interface Veo31ImageToVideoInput {
  prompt: string;
  image_url: string;
  aspect_ratio?: "16:9" | "9:16";
  duration?: "8s";
  resolution?: "720p" | "1080p";
  generate_audio?: boolean;
}

export interface Veo31FrameToVideoInput {
  prompt: string;
  first_frame_url: string;
  last_frame_url: string;
  aspect_ratio?: "auto" | "9:16" | "16:9" | "1:1";
  duration?: "8s";
  resolution?: "720p" | "1080p";
  generate_audio?: boolean;
}

export interface Veo31Response {
  video: {
    url: string;
    content_type: string;
    file_name: string;
  };
}
```

---

#### 3. FAL AI Client Extension
**File:** `qcut/apps/web/src/lib/fal-ai-client.ts`
- **Purpose:** Add Veo 3.1 API methods
- **Changes:**
  - Add three new methods for each Veo 3.1 endpoint
  - Reuse existing `makeRequest` infrastructure
  - Follow existing error handling patterns

**New Methods:**
```typescript
class FalAIClient {
  // Existing methods...

  async generateVeo31TextToVideo(
    params: Veo31TextToVideoInput
  ): Promise<GenerationResult> {
    try {
      const endpoint = "https://fal.run/fal-ai/veo3.1/fast";
      const response = await this.makeRequest(endpoint, params);

      return {
        success: true,
        videoUrl: response.video.url,
        metadata: {
          duration: params.duration || "8s",
          resolution: params.resolution || "720p",
          aspectRatio: params.aspect_ratio || "16:9"
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }

  async generateVeo31ImageToVideo(
    params: Veo31ImageToVideoInput
  ): Promise<GenerationResult> {
    // Similar implementation
  }

  async generateVeo31FrameToVideo(
    params: Veo31FrameToVideoInput
  ): Promise<GenerationResult> {
    // Similar implementation
  }
}
```

---

#### 4. Generation Hook Extension
**File:** `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Purpose:** Handle Veo 3.1 generation logic
- **Changes:**
  - Add Veo 3.1 settings state (resolution, audio, etc.)
  - Add detection for Veo 3.1 models
  - Integrate Veo 3.1 API calls into generation flow

**New State:**
```typescript
// Add to useAIGeneration hook
const [veo31Settings, setVeo31Settings] = useState({
  resolution: "720p" as "720p" | "1080p",
  duration: "8s" as "4s" | "6s" | "8s",
  aspectRatio: "16:9" as "9:16" | "16:9" | "1:1",
  generateAudio: true,
  enhancePrompt: true,
  autoFix: true
});

// Add detection helper
const hasVeo31Selected = selectedModels.some(id => id.startsWith("veo31_"));
```

---

#### 5. UI Component Updates
**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
- **Purpose:** Add Veo 3.1 settings panel and frame upload UI
- **Changes:**
  - Add Veo 3.1 settings panel (similar to Sora 2 panel)
  - Add first/last frame upload components for frame-to-video
  - Update cost calculation to include Veo 3.1 pricing
  - Add new tab or reuse existing tabs based on model types

**Settings Panel:**
```tsx
{/* Veo 3.1 Settings Panel - Only shows when Veo 3.1 models selected */}
{generation.hasVeo31Selected && (
  <div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
    <Label className="text-xs font-medium">Veo 3.1 Settings</Label>

    {/* Resolution selector */}
    <div className="space-y-1">
      <Label htmlFor="veo31-resolution" className="text-xs">Resolution</Label>
      <Select
        value={generation.veo31Settings.resolution}
        onValueChange={(v) => generation.setVeo31Resolution(v as "720p" | "1080p")}
      >
        <SelectTrigger id="veo31-resolution" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="720p">720p</SelectItem>
          <SelectItem value="1080p">1080p</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* Duration selector */}
    <div className="space-y-1">
      <Label htmlFor="veo31-duration" className="text-xs">Duration</Label>
      <Select
        value={generation.veo31Settings.duration}
        onValueChange={(v) => generation.setVeo31Duration(v as "4s" | "6s" | "8s")}
      >
        <SelectTrigger id="veo31-duration" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="4s">4 seconds ($0.60 - $0.40)</SelectItem>
          <SelectItem value="6s">6 seconds ($0.90 - $0.60)</SelectItem>
          <SelectItem value="8s">8 seconds ($1.20 - $0.80)</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* Audio toggle */}
    <div className="flex items-center justify-between">
      <Label htmlFor="veo31-audio" className="text-xs">Generate Audio</Label>
      <input
        id="veo31-audio"
        type="checkbox"
        checked={generation.veo31Settings.generateAudio}
        onChange={(e) => generation.setVeo31GenerateAudio(e.target.checked)}
        className="h-4 w-4"
      />
    </div>
  </div>
)}
```

---

### Supporting Files (Optional Enhancement)

#### 6. Service Layer (Alternative Pattern)
**File:** `qcut/apps/web/src/services/ai/veo31-service.ts` (new file)
- **Purpose:** Dedicated service for Veo 3.1 (alternative to extending fal-ai-client.ts)
- **Changes:**
  - Create isolated service following fal-ai-service.ts pattern
  - Easier to test and maintain
  - Better separation of concerns

---

#### 7. Error Messages
**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
- **Purpose:** Add Veo 3.1-specific error messages
- **Changes:**
  - Add to `ERROR_MESSAGES` constant
  - Include validation messages for image size, aspect ratio

**Example:**
```typescript
export const ERROR_MESSAGES = {
  // Existing messages...
  VEO31_IMAGE_TOO_LARGE: "Image must be under 8MB for Veo 3.1",
  VEO31_INVALID_ASPECT_RATIO: "Veo 3.1 requires 16:9 or 9:16 aspect ratio",
  VEO31_MISSING_FRAMES: "Both first and last frames required for frame-to-video"
};
```

---

## Implementation Tasks

### Phase 1: Foundation (Non-Breaking)
**Estimated Time:** 2-3 hours

- [ ] **Task 1.1:** Create type definitions
  - File: `qcut/apps/web/src/types/ai-generation.ts`
  - Add all Veo 3.1 interfaces
  - Export types for client use
  - **Validation:** TypeScript compilation passes

- [ ] **Task 1.2:** Add model definitions to constants
  - File: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
  - Add 3 model entries (text, image, frame-to-video)
  - Set correct pricing and categories
  - **Validation:** Models appear in AI panel (but won't work yet)

- [ ] **Task 1.3:** Add Veo 3.1 error messages
  - File: `ai-constants.ts`
  - Add validation error messages
  - **Validation:** Error constants exported correctly

### Phase 2: Client Integration
**Estimated Time:** 3-4 hours

- [ ] **Task 2.1:** Extend FAL AI Client
  - File: `qcut/apps/web/src/lib/fal-ai-client.ts`
  - Add `generateVeo31TextToVideo` method
  - Add `generateVeo31ImageToVideo` method
  - Add `generateVeo31FrameToVideo` method
  - **Validation:** Methods callable, return proper types

- [ ] **Task 2.2:** Add unit tests for client methods
  - File: `qcut/apps/web/src/lib/__tests__/fal-ai-client.test.ts` (new)
  - Mock fal.ai responses
  - Test success and error cases
  - **Validation:** All tests pass

### Phase 3: Hook Integration
**Estimated Time:** 2-3 hours

- [ ] **Task 3.1:** Add Veo 3.1 state to generation hook
  - File: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
  - Add settings state (resolution, duration, audio)
  - Add detection helper `hasVeo31Selected`
  - **Validation:** State updates correctly

- [ ] **Task 3.2:** Integrate Veo 3.1 into generation flow
  - File: `use-ai-generation.ts`
  - Add Veo 3.1 API calls to `handleGenerate`
  - Handle image/frame uploads
  - **Validation:** Generation flow executes without errors

### Phase 4: UI Updates
**Estimated Time:** 4-5 hours

- [ ] **Task 4.1:** Add Veo 3.1 settings panel
  - File: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
  - Add conditional panel (similar to Sora 2)
  - Add resolution, duration, audio controls
  - **Validation:** Panel appears when Veo 3.1 models selected

- [ ] **Task 4.2:** Add frame upload UI for frame-to-video
  - File: `ai.tsx`
  - Add first frame upload component
  - Add last frame upload component
  - Add preview thumbnails
  - **Validation:** File upload works, previews display

- [ ] **Task 4.3:** Update cost calculation
  - File: `ai.tsx`
  - Add Veo 3.1 pricing logic (audio on/off)
  - Update total cost display
  - **Validation:** Correct pricing shown

- [ ] **Task 4.4:** Add validation logic
  - File: `ai.tsx`
  - Validate image sizes (< 8MB)
  - Validate aspect ratios (16:9, 9:16)
  - Show error messages
  - **Validation:** Invalid inputs rejected with clear messages

### Phase 5: Testing & Polish
**Estimated Time:** 3-4 hours

- [ ] **Task 5.1:** End-to-end testing
  - Test all three Veo 3.1 models
  - Test with/without audio
  - Test different resolutions
  - Test error scenarios
  - **Validation:** All workflows complete successfully

- [ ] **Task 5.2:** Integration testing with existing features
  - Test alongside Sora 2 models
  - Test multi-model generation
  - Test history panel
  - **Validation:** No regressions

- [ ] **Task 5.3:** Performance testing
  - Monitor API response times
  - Check for memory leaks
  - Test with large images
  - **Validation:** Acceptable performance

- [ ] **Task 5.4:** Documentation updates
  - Update code comments
  - Add JSDoc for new methods
  - Update this integration plan with lessons learned
  - **Validation:** Documentation complete

### Phase 6: Deployment
**Estimated Time:** 1-2 hours

- [ ] **Task 6.1:** Code review
  - Self-review all changes
  - Check for type safety
  - Verify error handling
  - **Validation:** Code passes quality standards

- [ ] **Task 6.2:** Create pull request
  - Write comprehensive PR description
  - Link to this integration plan
  - Add screenshots/video demos
  - **Validation:** PR approved

- [ ] **Task 6.3:** Merge and monitor
  - Merge to main branch
  - Monitor for user feedback
  - Watch for errors in logs
  - **Validation:** Successful deployment

---

## Testing Strategy

### Unit Tests

**File:** `qcut/apps/web/src/lib/__tests__/fal-ai-client-veo31.test.ts`

```typescript
describe("FalAIClient - Veo 3.1", () => {
  it("should generate text-to-video with Veo 3.1", async () => {
    const result = await falAIClient.generateVeo31TextToVideo({
      prompt: "A dog running in a park",
      resolution: "720p",
      duration: "8s"
    });

    expect(result.success).toBe(true);
    expect(result.videoUrl).toBeDefined();
  });

  it("should handle image-to-video with valid image", async () => {
    // Test implementation
  });

  it("should reject oversized images", async () => {
    // Test implementation
  });
});
```

### Integration Tests

**File:** `qcut/apps/web/src/components/editor/media-panel/views/__tests__/ai-veo31-integration.test.tsx`

```typescript
describe("AI Panel - Veo 3.1 Integration", () => {
  it("should show Veo 3.1 settings when model selected", () => {
    // Test implementation
  });

  it("should calculate correct pricing for audio on/off", () => {
    // Test implementation
  });

  it("should validate image aspect ratios", () => {
    // Test implementation
  });
});
```

### Manual Testing Checklist

- [ ] Generate text-to-video at 720p with audio
- [ ] Generate text-to-video at 1080p without audio
- [ ] Generate image-to-video with 16:9 image
- [ ] Generate image-to-video with 9:16 image
- [ ] Generate frame-to-video with first/last frames
- [ ] Test with oversized image (should reject)
- [ ] Test with invalid aspect ratio (should reject)
- [ ] Test multi-model generation (Veo + Sora)
- [ ] Test history panel with Veo results
- [ ] Test cost calculation updates
- [ ] Test progress tracking during generation
- [ ] Test error handling for API failures

---

## Migration & Rollback Plan

### Migration Strategy

**Approach:** Additive integration (no breaking changes)

1. **Phase 1:** Add new code alongside existing features
2. **Phase 2:** Feature flag (optional, for gradual rollout)
3. **Phase 3:** Monitor usage and errors
4. **Phase 4:** Full deployment

**Feature Flag (Optional):**
```typescript
// In ai-constants.ts
export const FEATURE_FLAGS = {
  ENABLE_VEO31: import.meta.env.VITE_ENABLE_VEO31 === "true"
};

// In ai.tsx
const veo31Models = FEATURE_FLAGS.ENABLE_VEO31
  ? AI_MODELS.filter(m => m.id.startsWith("veo31_"))
  : [];
```

### Rollback Plan

**If issues occur:**

1. **Immediate:** Set `VITE_ENABLE_VEO31=false` (if using feature flag)
2. **Code Rollback:** Revert commits on branch `veo31`
3. **Data Safety:** No database changes required (all state is ephemeral)
4. **User Impact:** Minimal - users just won't see Veo 3.1 models

**Rollback Commands:**
```bash
# Option 1: Feature flag disable
VITE_ENABLE_VEO31=false bun run build

# Option 2: Git revert
git revert <commit-hash>
git push origin veo31

# Option 3: Full branch reset
git reset --hard origin/master
```

### Backward Compatibility Checklist

- [x] No changes to existing model definitions
- [x] No changes to existing API methods
- [x] No changes to database schema
- [x] No changes to existing UI components (only additions)
- [x] No changes to existing hooks (only additions)
- [x] All new code is opt-in (requires selecting Veo 3.1 models)

---

## Cost Estimation

### Development Time

| Phase | Hours | Notes |
|-------|-------|-------|
| Phase 1: Foundation | 2-3 | Types, constants, error messages |
| Phase 2: Client Integration | 3-4 | API methods, unit tests |
| Phase 3: Hook Integration | 2-3 | State management, generation flow |
| Phase 4: UI Updates | 4-5 | Settings panel, file uploads, validation |
| Phase 5: Testing & Polish | 3-4 | E2E, integration, performance testing |
| Phase 6: Deployment | 1-2 | Review, PR, merge |
| **Total** | **15-21 hours** | ~2-3 developer days |

### API Usage Costs (Estimates)

| Duration | Audio ON | Audio OFF |
|----------|----------|-----------|
| 4 seconds | $0.60 | $0.40 |
| 6 seconds | $0.90 | $0.60 |
| 8 seconds | $1.20 | $0.80 |

**Development Testing Budget:** $20-50 (assuming 20-50 test generations)

---

## Success Criteria

### Technical Success

- ✅ All 3 Veo 3.1 models functional
- ✅ Zero regressions in existing features
- ✅ TypeScript compilation passes
- ✅ All tests pass (unit + integration)
- ✅ No console errors during generation

### User Experience Success

- ✅ Clear model selection UI
- ✅ Intuitive settings panel
- ✅ Accurate cost estimates
- ✅ Helpful error messages
- ✅ Responsive progress tracking

### Performance Success

- ✅ API response time < 60s for 8s video
- ✅ No memory leaks during generation
- ✅ Smooth UI during async operations

---

## Known Limitations & Future Enhancements

### Current Limitations

1. **Duration Constraints:**
   - Image-to-video: Only 8s supported currently
   - Frame-to-video: Only 8s supported currently
   - (Text-to-video supports 4s, 6s, 8s)

2. **Aspect Ratio Constraints:**
   - Image-to-video: Only 16:9 and 9:16
   - Frame-to-video: Supports auto, but best results with 16:9/9:16

3. **File Size Limits:**
   - Images: Max 8MB
   - No batch processing (one image at a time)

### Future Enhancements

1. **Batch Processing:**
   - Allow uploading multiple images for bulk image-to-video
   - Queue system for sequential generation

2. **Advanced Settings:**
   - Negative prompt support
   - Seed control for reproducibility
   - Enhanced prompt engineering UI

3. **Preview & Editing:**
   - Preview first/last frames before generation
   - Edit generated videos (trim, add effects)

4. **Cost Optimization:**
   - Warn users before expensive operations
   - Budget tracking for API usage
   - Option to disable audio by default

---

## Appendix

### Reference Links

- [Veo 3.1 Fast API Docs](https://fal.ai/models/fal-ai/veo3.1/fast/api)
- [Veo 3.1 Image-to-Video API Docs](https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video/api)
- [Veo 3.1 Frame-to-Video API Docs](https://fal.ai/models/fal-ai/veo3.1/fast/first-last-frame-to-video/api)
- [fal.ai Client SDK](https://github.com/fal-ai/fal-js)
- [QCut AI Panel Docs](../../../apps/web/src/components/editor/media-panel/views/README.md)

### Glossary

- **fal.ai**: AI model hosting platform (similar to Replicate, RunPod)
- **Veo 3.1**: Google's latest video generation model
- **Frame-to-video**: Video generation by animating between two keyframes
- **Aspect ratio**: Width-to-height ratio (e.g., 16:9 = widescreen)
- **720p/1080p**: Video resolution (1280x720 vs 1920x1080 pixels)

---

## Changelog

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-10-20 | 1.0 | Initial integration plan created | Claude Code |

---

**End of Integration Plan**
