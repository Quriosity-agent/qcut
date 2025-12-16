# Veo 3.1 Extend-Video Integration Plan

**Created:** 2025-12-16
**Priority:** Medium
**Estimated Time:** 2-3 hours
**Panel Location:** Avatar Tab (uses existing Source Video upload)

## Overview

Integrate Google's Veo 3.1 extend-video API to allow users to extend existing videos up to 30 seconds total length. This feature takes an existing video (up to 8 seconds) and extends it by 7 seconds based on a text prompt.

The models will be added to the **Avatar panel** alongside other video-based models like "Kling O1 Video Reference" and "Kling O1 Video Edit", reusing the existing "Source Video" upload component.

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
Add after `Veo31FrameToVideoInput` interface (~line 48):

```typescript
/**
 * Veo 3.1 Extend-Video Input Parameters
 */
export interface Veo31ExtendVideoInput {
  prompt: string;                          // Required: How video should continue
  video_url: string;                       // Required: Video to extend (720p+, 16:9/9:16)
  aspect_ratio?: "auto" | "16:9" | "9:16"; // Default: "auto"
  duration?: "7s";                         // Currently only "7s"
  resolution?: "720p";                     // Currently only "720p"
  generate_audio?: boolean;                // Default: true
  auto_fix?: boolean;                      // Default: false
}
```

---

### Subtask 2: Add Model Definitions to AI Constants (20 min)

**Files to Modify:**
- `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

**Changes:**
Add two new model entries in the `AI_MODELS` array in the avatar models section (~line 600+):

```typescript
// Veo 3.1 Extend-Video Models (Avatar tab - uses Source Video)
{
  id: "veo31_fast_extend_video",
  name: "Veo 3.1 Fast Extend",
  description: "Extend videos by 7s with motion continuation (faster)",
  price: "0.15/s",  // $0.15/second with audio, $0.10/s without
  resolution: "720p",
  max_duration: 7,
  category: "avatar",  // Avatar tab has Source Video upload
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
  requiredInputs: ["video"],
  supportedAspectRatios: ["auto", "16:9", "9:16"],
},
{
  id: "veo31_extend_video",
  name: "Veo 3.1 Extend",
  description: "Extend videos by 7s with premium quality continuation",
  price: "0.40/s",  // $0.40/second with audio, $0.20/s without
  resolution: "720p",
  max_duration: 7,
  category: "avatar",
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
  // Validate video input (uses Avatar tab's sourceVideo)
  if (!sourceVideoUrl) {
    throw new Error("Source video is required for Veo 3.1 extend-video");
  }

  const extendParams: Veo31ExtendVideoInput = {
    prompt: prompt,
    video_url: sourceVideoUrl,
    aspect_ratio: extendVideoAspectRatio ?? "auto",
    duration: "7s",
    resolution: "720p",
    generate_audio: extendVideoGenerateAudio ?? true,
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
  - Add video upload flow for extend-video models using existing `sourceVideo` from Avatar state

---

### Subtask 5: Add Extend-Video Settings to Avatar Tab State (20 min)

**Files to Modify:**
- `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-avatar-tab-state.ts`

**Changes:**
Add state for extend-video specific settings:

```typescript
// Add to AvatarTabState interface (~line 32)
// Veo 3.1 Extend-Video settings
extendVideoAspectRatio: "auto" | "16:9" | "9:16";
extendVideoGenerateAudio: boolean;

// Add to AvatarTabSetters interface (~line 67)
setExtendVideoAspectRatio: (value: "auto" | "16:9" | "9:16") => void;
setExtendVideoGenerateAudio: (value: boolean) => void;

// Add state in hook (~line 172)
const [extendVideoAspectRatio, setExtendVideoAspectRatio] =
  useState<"auto" | "16:9" | "9:16">("auto");
const [extendVideoGenerateAudio, setExtendVideoGenerateAudio] = useState(true);

// Add to state return object (~line 209)
extendVideoAspectRatio,
extendVideoGenerateAudio,

// Add to setters return object (~line 231)
setExtendVideoAspectRatio,
setExtendVideoGenerateAudio,

// Add to resetAll function (~line 186)
setExtendVideoAspectRatio("auto");
setExtendVideoGenerateAudio(true);
```

---

### Subtask 6: Update Avatar Tab UI for Extend-Video Settings (25 min)

**Files to Modify:**
- `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-avatar-tab.tsx`

**Changes:**

1. Add new props to `AIAvatarTabProps` interface (~line 52):
```typescript
// Veo 3.1 Extend-Video settings
extendVideoAspectRatio: "auto" | "16:9" | "9:16";
onExtendVideoAspectRatioChange: (value: "auto" | "16:9" | "9:16") => void;
extendVideoGenerateAudio: boolean;
onExtendVideoGenerateAudioChange: (value: boolean) => void;
```

2. Add detection for extend-video models (~line 178):
```typescript
const extendVideoSelected = selectedModels.some(m => m.includes("extend_video"));
```

3. Add Veo 3.1 Extend-Video Options section after Sync Lipsync section (~line 584):
```tsx
{/* Veo 3.1 Extend-Video Options */}
{extendVideoSelected && (
  <div className="space-y-3 text-left border-t pt-3">
    <Label className="text-sm font-semibold">
      Veo 3.1 Extend-Video Options
    </Label>
    <p className="text-xs text-muted-foreground">
      Upload a video (up to 8s, 720p/1080p, 16:9 or 9:16) to extend by 7 seconds
    </p>

    <div className="grid grid-cols-2 gap-3">
      {/* Aspect Ratio */}
      <div className="space-y-2">
        <Label htmlFor="extend-video-aspect-ratio" className="text-xs">
          Aspect Ratio
        </Label>
        <Select
          value={extendVideoAspectRatio}
          onValueChange={onExtendVideoAspectRatioChange}
        >
          <SelectTrigger id="extend-video-aspect-ratio" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto (detect)</SelectItem>
            <SelectItem value="16:9">16:9 Landscape</SelectItem>
            <SelectItem value="9:16">9:16 Portrait</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Generate Audio */}
      <div className="space-y-2">
        <Label className="text-xs">Generate Audio</Label>
        <div className="flex items-center gap-2 h-8">
          <Checkbox
            id="extend-video-audio"
            checked={extendVideoGenerateAudio}
            onCheckedChange={(checked) =>
              onExtendVideoGenerateAudioChange(checked === true)
            }
          />
          <label htmlFor="extend-video-audio" className="text-xs text-muted-foreground cursor-pointer">
            {extendVideoGenerateAudio ? "On ($0.15-0.40/s)" : "Off ($0.10-0.20/s)"}
          </label>
        </div>
      </div>
    </div>

    {/* Cost estimate */}
    <div className="text-xs text-muted-foreground">
      Extends video by 7 seconds · Est. cost: {extendVideoGenerateAudio ? "$1.05-2.80" : "$0.70-1.40"}
    </div>
  </div>
)}
```

4. Add import for Checkbox if not already imported:
```typescript
import { Checkbox } from "@/components/ui/checkbox";
```

---

### Subtask 7: Add Cost Calculator (10 min)

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

### Subtask 8: Update Validation Constants (10 min)

**Files to Modify:**
- `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

**Changes:**
Add to `UPLOAD_CONSTANTS` (~line 1100):

```typescript
// Veo 3.1 extend-video constraints
MAX_EXTEND_VIDEO_DURATION_SECONDS: 8,
EXTEND_VIDEO_SUPPORTED_FORMATS: ["mp4", "mov", "webm", "m4v", "gif"],
EXTEND_VIDEO_SUPPORTED_RESOLUTIONS: ["720p", "1080p"],
EXTEND_VIDEO_SUPPORTED_ASPECT_RATIOS: ["16:9", "9:16"],
```

Add to `ERROR_MESSAGES` (~line 1140):
```typescript
EXTEND_VIDEO_TOO_LONG: "Input video must be 8 seconds or less for extend-video",
EXTEND_VIDEO_INVALID_RESOLUTION: "Video must be 720p or 1080p for extend-video",
EXTEND_VIDEO_INVALID_ASPECT_RATIO: "Video must be 16:9 or 9:16 for extend-video",
EXTEND_VIDEO_MISSING: "Please upload a source video to extend",
```

---

### Subtask 9: Add Tests (20 min)

**Files to Create:**
- `apps/web/src/components/editor/media-panel/views/ai/__tests__/extend-video.test.ts`

**Test Cases:**
1. Test model definition exists with correct category ("avatar")
2. Test cost calculator returns correct values for fast/standard with/without audio
3. Test validation rejects videos longer than 8 seconds
4. Test aspect ratio validation

---

## File Summary

### Files to Modify
| File | Changes |
|------|---------|
| `apps/web/src/types/ai-generation.ts` | Add `Veo31ExtendVideoInput` interface |
| `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts` | Add 2 model definitions (category: "avatar"), validation constants, error messages |
| `apps/web/src/lib/fal-ai-client.ts` | Add 2 client methods for extend-video |
| `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts` | Add handler case for extend-video |
| `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | Add video upload flow for extend-video |
| `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-avatar-tab-state.ts` | Add state for extend-video settings |
| `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-avatar-tab.tsx` | Add UI section for extend-video options |
| `apps/web/src/components/editor/media-panel/views/ai/utils/ai-cost-calculators.ts` | Add cost calculator function |

### Files to Create
| File | Description |
|------|-------------|
| `apps/web/src/components/editor/media-panel/views/ai/__tests__/extend-video.test.ts` | Unit tests |

---

## Reused Components

The Avatar tab already provides:
- **Source Video upload** - Reuse existing `sourceVideo` file state
- **Additional Prompt** - Reuse existing prompt for extension description
- **Audio duration extraction** - Available via `useVideoFileWithDuration` hook

No new upload components needed - just add the model-specific settings panel.

---

## Long-Term Support Considerations

### 1. Extensibility
- Model definition follows existing avatar models pattern
- Type definitions are reusable for future extend-video variants
- Settings integrate with existing Avatar tab state management

### 2. Maintainability
- Code follows existing patterns (Kling Avatar, Sync Lipsync sections)
- Uses established error handling and logging
- Integrates with existing video upload flow

### 3. Testing
- Unit tests for cost calculation
- Integration with existing E2E test patterns
- Validation tests for input constraints

### 4. Future Enhancements
- Support for longer extensions when API allows
- Support for higher resolutions (1080p output) when available
- Chain multiple extensions for videos up to 30s total
- Add video preview before extending

---

## Implementation Order

1. **Phase 1 - Core (Subtasks 1-3):** Types, constants, client methods
2. **Phase 2 - Integration (Subtasks 4-5):** Handlers, Avatar tab state
3. **Phase 3 - UI (Subtask 6):** Avatar tab options section
4. **Phase 4 - Polish (Subtasks 7-9):** Cost calculator, validation, tests

---

*This integration follows the established patterns in the QCut codebase for long-term maintainability. The models are placed in the Avatar panel to leverage the existing Source Video upload component.*

## Review Status (2025-12-16)

- **Subtask 1 — Types:** Not started. `apps/web/src/types/ai-generation.ts` does not define `Veo31ExtendVideoInput` and no new import targets exist for extend-video params.
- **Subtask 2 — AI constants:** Not started. `AI_MODELS` in `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts` has no `veo31_fast_extend_video` or `veo31_extend_video` entries in the avatar section; no extend-video defaults, required inputs, or supported aspect ratios are present.
- **Subtask 3 — FAL client:** Not started. `apps/web/src/lib/fal-ai-client.ts` only imports Veo text/image/frame types and exposes generation methods for those; there are no extend-video endpoints or methods.
- **Subtask 4 — Model handlers:** Not started. `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts` lacks a switch case for extend-video, and `use-ai-generation.ts` has no extend-video flow wired to sourceVideo.
- **Subtask 5 — Avatar tab state:** Not started. `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-avatar-tab-state.ts` contains no `extendVideoAspectRatio` / `extendVideoGenerateAudio` state or setters, and reset logic does not cover them.
- **Subtask 6 — Avatar tab UI:** Not started. `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-avatar-tab.tsx` props omit extend-video fields and the UI has no extend-video options section (aspect ratio/audio toggle).
- **Subtask 7 — Cost calculator:** Not started. `apps/web/src/components/editor/media-panel/views/ai/utils/ai-cost-calculators.ts` has no helper for Veo 3.1 extend-video pricing.
- **Subtask 8 — Validation constants:** Not started. `UPLOAD_CONSTANTS` / `ERROR_MESSAGES` in `ai-constants.ts` lack extend-video duration/format/aspect-ratio rules and related error strings.
- **Subtask 9 — Tests:** Not started. No `extend-video.test.ts` exists under `apps/web/src/components/editor/media-panel/views/ai/__tests__`; only `ai-constants.test.ts` is present.
