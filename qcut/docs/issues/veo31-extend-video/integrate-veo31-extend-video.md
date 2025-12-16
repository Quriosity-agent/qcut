# Veo 3.1 Extend-Video Integration Plan

**Created:** 2025-12-16
**Priority:** Medium
**Estimated Time:** 3-4 hours
**Panel Location:** Image Tab (Video-to-Video section)

## Overview

Integrate Google's Veo 3.1 extend-video API to allow users to extend existing videos up to 30 seconds total length. This feature takes an existing video (up to 8 seconds) and extends it by 7 seconds based on a text prompt.

## API Details

### Endpoints

| Variant | Endpoint | Price (Audio On) | Price (Audio Off) |
|---------|----------|------------------|-------------------|
| Fast | `fal-ai/veo3.1/fast/extend-video` | $0.15/s | $0.10/s |
| Standard | `fal-ai/veo3.1/extend-video` | $0.40/s | $0.20/s |

### Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | How the video should continue |
| `video_url` | string | Yes | - | URL of video to extend (720p+, 16:9 or 9:16) |
| `aspect_ratio` | enum | No | "auto" | `auto`, `16:9`, `9:16` |
| `duration` | enum | No | "7s" | Currently only `7s` |
| `resolution` | enum | No | "720p" | Currently only `720p` |
| `generate_audio` | boolean | No | true | Enable audio generation |
| `auto_fix` | boolean | No | false | Auto-correct policy violations |

### Input Video Requirements
- Duration: Up to 8 seconds
- Resolution: 720p or 1080p
- Aspect Ratio: 16:9 or 9:16
- Formats: mp4, mov, webm, m4v, gif

### Response Schema
```typescript
{
  video: {
    url: string;
    content_type: string;
    file_name: string;
    file_size: number;
  }
}
```

---

## Subtasks

### Subtask 1: Add Type Definitions (15 min)

**Files to Modify:**
- `apps/web/src/types/ai-generation.ts`

**Changes:**
```typescript
// Add after Veo31FrameToVideoInput interface (~line 48)

/**
 * Veo 3.1 Extend-Video Input Parameters
 */
export interface Veo31ExtendVideoInput {
  prompt: string;                        // Required: How video should continue
  video_url: string;                     // Required: Video to extend (720p+, 16:9/9:16)
  aspect_ratio?: "auto" | "16:9" | "9:16"; // Default: "auto"
  duration?: "7s";                       // Currently only "7s"
  resolution?: "720p";                   // Currently only "720p"
  generate_audio?: boolean;              // Default: true
  auto_fix?: boolean;                    // Default: false
}
```

---

### Subtask 2: Add Model Definitions to AI Constants (20 min)

**Files to Modify:**
- `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

**Changes:**
Add two new model entries in the `AI_MODELS` array after the existing Veo 3.1 image-to-video models (~line 490):

```typescript
// Veo 3.1 Extend-Video Models
{
  id: "veo31_fast_extend_video",
  name: "Veo 3.1 Fast Extend-Video",
  description: "Extend existing videos by 7s with motion continuation (faster, budget-friendly)",
  price: "0.15/s",  // $0.15/second with audio, $0.10/s without
  resolution: "720p",
  max_duration: 7,
  category: "image",  // Use image tab since it handles video input
  endpoints: {
    image_to_video: "fal-ai/veo3.1/fast/extend-video",
  },
  default_params: {
    duration: "7s",
    resolution: "720p",
    aspect_ratio: "auto",
    generate_audio: true,
    auto_fix: false,
  },
  requiredInputs: ["video"],  // Requires video input
  supportedAspectRatios: ["auto", "16:9", "9:16"],
},
{
  id: "veo31_extend_video",
  name: "Veo 3.1 Extend-Video",
  description: "Extend existing videos by 7s with premium motion continuation",
  price: "0.40/s",  // $0.40/second with audio, $0.20/s without
  resolution: "720p",
  max_duration: 7,
  category: "image",
  endpoints: {
    image_to_video: "fal-ai/veo3.1/extend-video",
  },
  default_params: {
    duration: "7s",
    resolution: "720p",
    aspect_ratio: "auto",
    generate_audio: true,
    auto_fix: false,
  },
  requiredInputs: ["video"],
  supportedAspectRatios: ["auto", "16:9", "9:16"],
},
```

---

### Subtask 3: Add FAL AI Client Methods (25 min)

**Files to Modify:**
- `apps/web/src/lib/fal-ai-client.ts`

**Changes:**

1. Add import for the new type at the top (~line 11):
```typescript
import type {
  Veo31TextToVideoInput,
  Veo31ImageToVideoInput,
  Veo31FrameToVideoInput,
  Veo31ExtendVideoInput,  // Add this
  Veo31Response,
  // ... rest
} from "@/types/ai-generation";
```

2. Add two new methods after `generateVeo31FrameToVideo` (~line 1024):

```typescript
// ============================================
// Veo 3.1 Extend-Video Methods
// ============================================

/**
 * Extend a video using Veo 3.1 Fast
 * @param params Veo 3.1 extend-video parameters
 * @returns Video generation response with extended video URL
 */
async generateVeo31FastExtendVideo(
  params: Veo31ExtendVideoInput
): Promise<VideoGenerationResponse> {
  try {
    const endpoint = "https://fal.run/fal-ai/veo3.1/fast/extend-video";

    debugLogger.log(FAL_LOG_COMPONENT, "VEO31_FAST_EXTEND_VIDEO_REQUEST", {
      params,
    });

    const response = await this.makeRequest<Veo31Response>(
      endpoint,
      params as unknown as Record<string, unknown>
    );

    if (!response.video?.url) {
      throw new Error("No video URL in Veo 3.1 Fast extend response");
    }

    return {
      job_id: `veo31_fast_extend_${Date.now()}`,
      status: "completed",
      message: "Video extended successfully",
      video_url: response.video.url,
    };
  } catch (error) {
    handleAIServiceError(error, "Veo 3.1 Fast extend-video generation", {
      operation: "generateVeo31FastExtendVideo",
    });

    const errorMessage =
      error instanceof Error
        ? error.message
        : "Veo 3.1 Fast extend failed";
    return {
      job_id: `veo31_fast_extend_error_${Date.now()}`,
      status: "failed",
      message: errorMessage,
    };
  }
}

/**
 * Extend a video using Veo 3.1 Standard
 * @param params Veo 3.1 extend-video parameters
 * @returns Video generation response with extended video URL
 */
async generateVeo31ExtendVideo(
  params: Veo31ExtendVideoInput
): Promise<VideoGenerationResponse> {
  try {
    const endpoint = "https://fal.run/fal-ai/veo3.1/extend-video";

    debugLogger.log(FAL_LOG_COMPONENT, "VEO31_STANDARD_EXTEND_VIDEO_REQUEST", {
      params,
    });

    const response = await this.makeRequest<Veo31Response>(
      endpoint,
      params as unknown as Record<string, unknown>
    );

    if (!response.video?.url) {
      throw new Error("No video URL in Veo 3.1 Standard extend response");
    }

    return {
      job_id: `veo31_std_extend_${Date.now()}`,
      status: "completed",
      message: "Video extended successfully",
      video_url: response.video.url,
    };
  } catch (error) {
    handleAIServiceError(error, "Veo 3.1 Standard extend-video generation", {
      operation: "generateVeo31ExtendVideo",
    });

    const errorMessage =
      error instanceof Error
        ? error.message
        : "Veo 3.1 Standard extend failed";
    return {
      job_id: `veo31_std_extend_error_${Date.now()}`,
      status: "failed",
      message: errorMessage,
    };
  }
}
```

---

### Subtask 4: Add Model Handler in Generation Hooks (30 min)

**Files to Modify:**
- `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts`

**Changes:**
Add handler case for the new extend-video models in the model handler switch statement:

```typescript
case "veo31_fast_extend_video":
case "veo31_extend_video": {
  // Validate video input
  if (!sourceVideoUrl) {
    throw new Error("Video is required for Veo 3.1 extend-video");
  }

  const extendParams: Veo31ExtendVideoInput = {
    prompt: prompt,
    video_url: sourceVideoUrl,
    aspect_ratio: aspectRatio === "auto" ? "auto" : aspectRatio as "16:9" | "9:16",
    duration: "7s",
    resolution: "720p",
    generate_audio: generateAudio ?? true,
    auto_fix: false,
  };

  const extendResult = modelId === "veo31_fast_extend_video"
    ? await falAIClient.generateVeo31FastExtendVideo(extendParams)
    : await falAIClient.generateVeo31ExtendVideo(extendParams);

  return {
    success: extendResult.status === "completed",
    videoUrl: extendResult.video_url,
    error: extendResult.status === "failed" ? extendResult.message : undefined,
  };
}
```

**Also modify:**
- `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts`
  - Add the new model IDs to the model ID type union if needed
  - Ensure the handler routing includes the new models

---

### Subtask 5: Update Image Tab UI for Extend-Video Section (40 min)

**Files to Modify:**
- `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-image-tab.tsx`

**Changes:**

1. Add a new section for "Extend Video" after the Frame Upload section:

```tsx
{/* Extend Video Section - Show when extend-video models are selected */}
{selectedModels.some(m => m.includes("extend_video")) && (
  <div className="space-y-3">
    <Label className="text-xs font-medium">Source Video</Label>
    <div className="text-xs text-muted-foreground mb-2">
      Upload a video (up to 8s, 720p/1080p, 16:9 or 9:16) to extend by 7 seconds
    </div>
    <FileUpload
      accept="video/mp4,video/quicktime,video/webm,video/x-m4v,image/gif"
      maxSize={UPLOAD_CONSTANTS.MAX_VIDEO_SIZE_BYTES}
      value={imageTabSourceVideo}
      onChange={onSourceVideoChange}
      placeholder="Upload video to extend"
      className="w-full"
    />
    {imageTabSourceVideo && (
      <div className="text-xs text-muted-foreground">
        {imageTabSourceVideo.name} ({(imageTabSourceVideo.size / (1024 * 1024)).toFixed(2)} MB)
      </div>
    )}

    {/* Extend Video Settings */}
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label className="text-xs">Aspect Ratio</Label>
        <Select
          value={extendVideoAspectRatio}
          onValueChange={onExtendVideoAspectRatioChange}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto (detect)</SelectItem>
            <SelectItem value="16:9">16:9 Landscape</SelectItem>
            <SelectItem value="9:16">9:16 Portrait</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Generate Audio</Label>
        <div className="flex items-center gap-2 mt-1">
          <Checkbox
            checked={extendVideoGenerateAudio}
            onCheckedChange={onExtendVideoGenerateAudioChange}
          />
          <span className="text-xs text-muted-foreground">
            {extendVideoGenerateAudio ? "$0.15-0.40/s" : "$0.10-0.20/s"}
          </span>
        </div>
      </div>
    </div>
  </div>
)}
```

2. Add new props to `AIImageTabProps` interface:
```typescript
// Extend Video settings
extendVideoAspectRatio: "auto" | "16:9" | "9:16";
onExtendVideoAspectRatioChange: (value: "auto" | "16:9" | "9:16") => void;
extendVideoGenerateAudio: boolean;
onExtendVideoGenerateAudioChange: (value: boolean) => void;
```

---

### Subtask 6: Add State Management for Extend-Video (25 min)

**Files to Modify:**
- `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-image-tab-state.ts`

**Changes:**
Add state and handlers for extend-video settings:

```typescript
// Add to state
const [extendVideoAspectRatio, setExtendVideoAspectRatio] = useState<"auto" | "16:9" | "9:16">("auto");
const [extendVideoGenerateAudio, setExtendVideoGenerateAudio] = useState(true);

// Add to return object
extendVideoAspectRatio,
setExtendVideoAspectRatio,
extendVideoGenerateAudio,
setExtendVideoGenerateAudio,
```

---

### Subtask 7: Add Video Upload Handler (20 min)

**Files to Modify:**
- `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts`

**Changes:**
Add video upload logic in the generation flow:

```typescript
// Before calling the extend-video model handler
if (modelId.includes("extend_video") && sourceVideo) {
  // Upload video to FAL storage
  const videoUrl = await falAIClient.uploadVideoToFal(sourceVideo);
  sourceVideoUrl = videoUrl;
}
```

---

### Subtask 8: Add Cost Calculator (10 min)

**Files to Modify:**
- `apps/web/src/components/editor/media-panel/views/ai/utils/ai-cost-calculators.ts`

**Changes:**
```typescript
/**
 * Calculate cost for Veo 3.1 extend-video
 * @param variant "fast" | "standard"
 * @param generateAudio Whether audio is generated
 * @returns Cost per 7-second extension
 */
export function calculateVeo31ExtendCost(
  variant: "fast" | "standard",
  generateAudio: boolean = true
): string {
  const duration = 7; // Always 7 seconds

  const pricePerSecond = variant === "fast"
    ? (generateAudio ? 0.15 : 0.10)
    : (generateAudio ? 0.40 : 0.20);

  const cost = duration * pricePerSecond;
  return `$${cost.toFixed(2)}`;
}
```

---

### Subtask 9: Update Validation Constants (10 min)

**Files to Modify:**
- `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

**Changes:**
Add constants for extend-video validation (~line 1100 in UPLOAD_CONSTANTS):

```typescript
// Veo 3.1 extend-video constraints
MAX_EXTEND_VIDEO_DURATION_SECONDS: 8,  // Max input video duration
MAX_EXTEND_VIDEO_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
EXTEND_VIDEO_SUPPORTED_FORMATS: ["mp4", "mov", "webm", "m4v", "gif"],
EXTEND_VIDEO_SUPPORTED_RESOLUTIONS: ["720p", "1080p"],
EXTEND_VIDEO_SUPPORTED_ASPECT_RATIOS: ["16:9", "9:16"],
```

Add error messages (~line 1140 in ERROR_MESSAGES):
```typescript
EXTEND_VIDEO_TOO_LONG: "Input video must be 8 seconds or less for extend-video",
EXTEND_VIDEO_INVALID_RESOLUTION: "Video must be 720p or 1080p for extend-video",
EXTEND_VIDEO_INVALID_ASPECT_RATIO: "Video must be 16:9 or 9:16 for extend-video",
```

---

### Subtask 10: Add Tests (30 min)

**Files to Create:**
- `apps/web/src/components/editor/media-panel/views/ai/__tests__/extend-video.test.ts`

**Test Cases:**
1. Test model definition exists and has correct properties
2. Test cost calculator returns correct values
3. Test validation rejects videos longer than 8 seconds
4. Test aspect ratio validation

---

## File Summary

### Files to Modify
| File | Changes |
|------|---------|
| `apps/web/src/types/ai-generation.ts` | Add `Veo31ExtendVideoInput` interface |
| `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts` | Add 2 model definitions, validation constants, error messages |
| `apps/web/src/lib/fal-ai-client.ts` | Add 2 client methods for extend-video |
| `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts` | Add handler case for extend-video |
| `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | Add video upload flow |
| `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-image-tab-state.ts` | Add state for extend-video settings |
| `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-image-tab.tsx` | Add UI section for extend-video |
| `apps/web/src/components/editor/media-panel/views/ai/utils/ai-cost-calculators.ts` | Add cost calculator function |

### Files to Create
| File | Description |
|------|-------------|
| `apps/web/src/components/editor/media-panel/views/ai/__tests__/extend-video.test.ts` | Unit tests |

---

## Long-Term Support Considerations

### 1. Extensibility
- Model definition follows existing pattern for easy addition of future extend-video variants
- Type definitions are reusable for other video extension APIs
- Cost calculator pattern matches existing calculators

### 2. Maintainability
- Code follows existing patterns in the codebase
- Uses established error handling and logging
- Integrates with existing state management

### 3. Testing
- Unit tests for cost calculation
- Integration with existing E2E test patterns
- Validation tests for input constraints

### 4. Future Enhancements
- Support for longer extensions when API allows
- Support for higher resolutions when available
- Chain multiple extensions for videos up to 30s total
- Add preview of source video before extending

---

## Implementation Order

1. **Phase 1 - Core (Subtasks 1-3):** Types, constants, client methods
2. **Phase 2 - Integration (Subtasks 4, 6-7):** Handlers, state, upload flow
3. **Phase 3 - UI (Subtask 5):** Image tab UI updates
4. **Phase 4 - Polish (Subtasks 8-10):** Cost calculator, validation, tests

---

*This integration follows the established patterns in the QCut codebase for long-term maintainability.*
