# Video Model Update Documentation

This document tracks video model updates for QCut's AI video generation system.

## New Model URLs to Integrate

- https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/text-to-video/api
- https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video
- https://fal.ai/models/fal-ai/wan-25-preview/text-to-video/api
- https://fal.ai/models/fal-ai/wan-25-preview/image-to-video

## Current Video Generation Implementation

### AI Video Client API (`ai-video-client.ts`)

```typescript
// Model Endpoints Configuration
const modelEndpoints: { [key: string]: string } = {
  "seedance": "fal-ai/bytedance/seedance/v1/lite/text-to-video",
  "seedance_pro": "fal-ai/bytedance/seedance/v1/pro/text-to-video",
  "veo3": "fal-ai/google/veo3",
  "veo3_fast": "fal-ai/google/veo3/fast",
  "hailuo": "fal-ai/minimax/hailuo-02/standard/text-to-video",
  "hailuo_pro": "fal-ai/minimax/hailuo-02/pro/text-to-video",
  "kling_v2": "fal-ai/kling-video/v2.1/master",
  "wan_turbo": "fal-ai/wan/v2.2-a14b/text-to-video/turbo",
};

// Core Generation Function
export async function generateVideo(
  request: VideoGenerationRequest,
  onProgress?: ProgressCallback,
  downloadOptions?: {
    downloadToMemory?: boolean;
    onDataReceived?: (data: Uint8Array) => void;
    onComplete?: (totalData: Uint8Array) => void;
  }
): Promise<VideoGenerationResponse>
```

### Model Configuration (`ai-constants.ts`)

```typescript
export const AI_MODELS: AIModel[] = [
  {
    id: "kling_v2",
    name: "Kling v2.1",
    description: "Premium model with unparalleled motion fluidity",
    price: "0.15",
    resolution: "1080p",
  },
  {
    id: "wan_turbo",
    name: "WAN v2.2 Turbo",
    description: "High-speed photorealistic video generation",
    price: "0.10",
    resolution: "720p",
  },
  // ... other models
];
```

## Integration Plan for New Models

### 1. Add New Model Endpoints

Update `modelEndpoints` in `ai-video-client.ts`:

```typescript
const modelEndpoints: { [key: string]: string } = {
  // Existing models...
  "kling_v2_5_turbo": "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
  "kling_v2_5_turbo_image": "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  "wan_25_preview": "fal-ai/wan-25-preview/text-to-video",
  "wan_25_preview_image": "fal-ai/wan-25-preview/image-to-video",
};
```

### 2. Update Model Configuration

Add to `AI_MODELS` array in `ai-constants.ts`:

```typescript
{
  id: "kling_v2_5_turbo",
  name: "Kling v2.5 Turbo Pro",
  description: "Latest Kling model with enhanced turbo performance",
  price: "0.18", // Estimate - verify actual pricing
  resolution: "1080p",
},
{
  id: "wan_25_preview",
  name: "WAN v2.5 Preview",
  description: "Next-generation WAN model with improved quality",
  price: "0.12", // Estimate - verify actual pricing
  resolution: "1080p",
}
```

### 3. Model-Specific Parameter Handling

Update parameter handling in `generateVideo()` function:

```typescript
// Model-specific parameter requirements
if (request.model === "kling_v2_5_turbo") {
  payload = {
    prompt: request.prompt,
    duration: request.duration || 5,
    resolution: request.resolution || "1080p",
    cfg_scale: 0.5,
    // Add any v2.5 turbo specific parameters
  };
} else if (request.model === "wan_25_preview") {
  payload = {
    prompt: request.prompt,
    duration: request.duration || 5,
    resolution: request.resolution || "1080p",
    // Add any WAN 2.5 specific parameters
  };
}
```

### 4. Image-to-Video Support

Update `generateVideoFromImage()` function:

```typescript
if (request.model === "kling_v2_5_turbo") {
  endpoint = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
  payload = {
    prompt: request.prompt || "Create a cinematic video from this image",
    image_url: imageUrl,
    duration: request.duration || 5,
    cfg_scale: 0.5,
  };
} else if (request.model === "wan_25_preview") {
  endpoint = "fal-ai/wan-25-preview/image-to-video";
  payload = {
    prompt: request.prompt || "Create a cinematic video from this image",
    image_url: imageUrl,
    duration: request.duration || 5,
    resolution: request.resolution || "1080p",
  };
}
```

## File Locations to Update

1. **`apps/web/src/lib/ai-video-client.ts`**
   - Add new model endpoints
   - Update parameter handling
   - Update image-to-video generation

2. **`apps/web/src/components/editor/media-panel/views/ai-constants.ts`**
   - Add new model configurations
   - Update pricing information
   - Add model-specific constants

3. **`apps/web/src/services/ai/fal-ai-service.ts`** (if needed)
   - May need updates for consistency

## Testing Requirements

- Test text-to-video generation with new models
- Test image-to-video generation with new models
- Verify pricing and parameter handling
- Test error handling and edge cases
- Validate progress tracking and status updates

## API Key Configuration

The system uses `VITE_FAL_API_KEY` environment variable for authentication:

```typescript
const FAL_API_KEY = import.meta.env.VITE_FAL_API_KEY;
const FAL_API_BASE = "https://fal.run";
```

## Error Handling

Current implementation includes comprehensive error handling:

```typescript
function handleQueueError(response: Response, errorData: any, endpoint: string): string {
  // Handle specific FAL.ai error patterns
  if (response.status === 422) {
    return `Invalid request parameters: ${JSON.stringify(errorData)}`;
  } else if (response.status === 401) {
    return "Invalid FAL API key. Please check your VITE_FAL_API_KEY environment variable.";
  } else if (response.status === 429) {
    return "Rate limit exceeded. Please wait a moment before trying again.";
  }
  // ... more error handling
}
```

## Progress Tracking

The system supports real-time progress updates:

```typescript
export type ProgressCallback = (status: {
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  message?: string;
  elapsedTime?: number;
  estimatedTime?: number;
  logs?: string[];
}) => void;
```

## Compatibility Analysis ✅

After analyzing the existing codebase, the proposed video model updates are **SAFE** and will **NOT** break existing features:

### ✅ **Backward Compatibility Guaranteed**
- **Endpoint Mapping**: New models use separate keys in `modelEndpoints` object - no conflicts
- **Parameter Handling**: Model-specific logic uses conditional blocks - adding new conditions is safe
- **API Structure**: All models use same FAL.ai response format - consistent processing
- **Error Handling**: Existing error handling covers all FAL.ai response patterns
- **UI Constants**: Adding models to `AI_MODELS` array is purely additive

### ✅ **No Breaking Changes**
- **Existing Models**: All current models (`kling_v2`, `wan_turbo`, `seedance`, etc.) remain unchanged
- **Parameter Structure**: `VideoGenerationRequest` interface supports all required fields
- **Response Handling**: `VideoGenerationResponse` format is consistent across all models
- **Progress Tracking**: `ProgressCallback` system works with any FAL.ai model
- **Download System**: Video download logic is model-agnostic

### ✅ **Safe Implementation Pattern**
The codebase follows a safe pattern for adding new models:

```typescript
// Safe: Additive endpoint mapping
const modelEndpoints: { [key: string]: string } = {
  // Existing models remain unchanged...
  "kling_v2": "fal-ai/kling-video/v2.1/master",
  "wan_turbo": "fal-ai/wan/v2.2-a14b/text-to-video/turbo",
  // New models added safely without conflicts
  "kling_v2_5_turbo": "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
  "wan_25_preview": "fal-ai/wan-25-preview/text-to-video",
};

// Safe: Conditional parameter handling
if (request.model === "kling_v2_5_turbo") {
  // New model logic - doesn't affect existing models
} else if (request.model === "wan_25_preview") {
  // New model logic - doesn't affect existing models
} else if (request.model === "wan_turbo") {
  // Existing logic remains unchanged
}
```

## Implementation Steps

### Task 1: ✅ Research new model specifications
**Status**: COMPLETED - API docs analyzed, parameters identified
**Duration**: < 10 minutes

### Task 2: Update model endpoints (15-20 minutes)
**File**: `qcut/apps/web/src/lib/ai-video-client.ts`
**Duration**: 15-20 minutes - Breaking into subtasks:

#### Subtask 2.1: Add new model endpoints to modelEndpoints object (5 minutes)
- **File**: `qcut/apps/web/src/lib/ai-video-client.ts:107-116`
- **Action**: Add Kling v2.5 Turbo Pro and WAN 2.5 Preview endpoint mappings
- **Code location**: Lines 107-116 in `modelEndpoints` object

#### Subtask 2.2: Add parameter handling for Kling v2.5 Turbo Pro (5 minutes)
- **File**: `qcut/apps/web/src/lib/ai-video-client.ts:131-163`
- **Action**: Add conditional block for `kling_v2_5_turbo` model
- **Code location**: Lines 131-163 in `generateVideo()` function

#### Subtask 2.3: Add parameter handling for WAN 2.5 Preview (5 minutes)
- **File**: `qcut/apps/web/src/lib/ai-video-client.ts:131-163`
- **Action**: Add conditional block for `wan_25_preview` model
- **Code location**: Lines 131-163 in `generateVideo()` function

### Task 3: Add model definitions (5 minutes)
**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
**Duration**: 5 minutes
- **Action**: Add new models to `AI_MODELS` array
- **Code location**: Lines 26-83 in `AI_MODELS` array

### Task 4: Update image-to-video support (15-20 minutes)
**File**: `qcut/apps/web/src/lib/ai-video-client.ts`
**Duration**: 15-20 minutes - Breaking into subtasks:

#### Subtask 4.1: Add Kling v2.5 Turbo Pro image-to-video endpoint (5 minutes)
- **File**: `qcut/apps/web/src/lib/ai-video-client.ts:661-669`
- **Action**: Add conditional block for `kling_v2_5_turbo` in `generateVideoFromImage()`
- **Code location**: Lines 661-669 in `generateVideoFromImage()` function

#### Subtask 4.2: Add WAN 2.5 Preview image-to-video endpoint (5 minutes)
- **File**: `qcut/apps/web/src/lib/ai-video-client.ts:670-683`
- **Action**: Add conditional block for `wan_25_preview` in `generateVideoFromImage()`
- **Code location**: Lines 670-683 in `generateVideoFromImage()` function

#### Subtask 4.3: Update cost estimation for new models (5 minutes)
- **File**: `qcut/apps/web/src/lib/ai-video-client.ts:852-862`
- **Action**: Add cost entries for new models in `estimateCost()` function
- **Code location**: Lines 852-862 in `modelCosts` object

### Task 5: Test thoroughly (25-30 minutes)
**Duration**: 25-30 minutes - Breaking into subtasks:

#### Subtask 5.1: Create integration tests for new models (10 minutes)
- **File**: `qcut/apps/web/src/test/integration/new-video-models.test.ts` (CREATE)
- **Action**: Create test file to verify new model functionality
- **Dependencies**: Mock FAL.ai API responses for new models

#### Subtask 5.2: Run existing regression tests (10 minutes)
- **Files**: `qcut/apps/web/src/test/**/*.test.ts`
- **Action**: Execute `bun run test` to ensure no breaking changes
- **Verify**: All existing tests pass

#### Subtask 5.3: Manual testing of new models (10 minutes)
- **Action**: Test text-to-video and image-to-video generation with new models
- **Verify**: Progress tracking, error handling, and video download work

### Task 6: Update hardcoded model list (5 minutes)
**File**: `qcut/apps/web/src/lib/ai-video-client.ts`
**Duration**: 5 minutes
- **Action**: Add new models to `getAvailableModels()` function
- **Code location**: Lines 784-844 in hardcoded models array

### Task 7: Update documentation (5 minutes)
**Files**: Any user-facing documentation
**Duration**: 5 minutes
- **Action**: Update any UI tooltips, help text, or user guides mentioning available models

## Implementation Summary

**Total Estimated Time**: 60-75 minutes
**Files to Modify**: 2 main files + 1 new test file
1. `qcut/apps/web/src/lib/ai-video-client.ts` (Multiple sections)
2. `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts` (AI_MODELS array)
3. `qcut/apps/web/src/test/integration/new-video-models.test.ts` (CREATE NEW)

**Key Safety Measures**:
- All changes are additive (no existing code modification)
- Comprehensive testing strategy to prevent regressions
- Each subtask can be tested independently

## Testing Strategy

### Regression Testing Required
- **Existing Models**: Verify all current models still generate videos correctly
- **Parameter Handling**: Test existing parameter validation and defaults
- **Error Handling**: Ensure error messages remain consistent
- **Progress Updates**: Verify progress tracking works for all models
- **Image-to-Video**: Test existing image-to-video functionality

### New Feature Testing
- **New Models**: Test Kling v2.5 Turbo Pro and WAN 2.5 Preview generation
- **Parameter Validation**: Verify new model-specific parameters work correctly
- **Fallback Behavior**: Test behavior when new models are unavailable
- **UI Integration**: Ensure new models appear correctly in model selector