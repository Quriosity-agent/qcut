# Sync Lipsync React-1 Integration

## Overview

Integrate FAL.ai's Sync Lipsync React-1 API for emotion-aware lip-syncing with video and audio inputs.

**API Endpoint:** `https://fal.run/fal-ai/sync-lipsync/react-1`

## API Specification

### Endpoint
- **URL:** `fal-ai/sync-lipsync/react-1`
- **Method:** POST
- **Authentication:** FAL_KEY environment variable

### Input Parameters (React1Input)

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `video_url` | string | **Yes** | - | URL to input video (max 15 seconds) |
| `audio_url` | string | **Yes** | - | URL to input audio (max 15 seconds) |
| `emotion` | EmotionEnum | **Yes** | - | One of: `happy`, `angry`, `sad`, `neutral`, `disgusted`, `surprised` |
| `model_mode` | ModelModeEnum | No | `face` | One of: `lips`, `face`, `head` - Controls edit region |
| `lipsync_mode` | LipsyncModeEnum | No | `bounce` | One of: `cut_off`, `loop`, `bounce`, `silence`, `remap` |
| `temperature` | float | No | `0.5` | Range 0-1, controls expressiveness |

### Output Schema (React1Output)

```typescript
interface React1Output {
  video: {
    url: string;          // Download URL for generated video
    width: number;        // Video width
    height: number;       // Video height
    fps: number;          // Frames per second
    duration: number;     // Video length in seconds
    num_frames: number;   // Total frame count
    content_type: string; // "video/mp4"
    file_name: string;    // Output filename
  };
}
```

### Constraints
- Video and audio inputs must be **15 seconds or shorter**
- Requires pre-uploaded URLs (FAL storage or public URLs)
- 5 credits per request

## Implementation Plan

### 1. Add Type Definitions

**File:** `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`

```typescript
/**
 * Emotion options for Sync Lipsync React-1
 */
export type SyncLipsyncEmotion =
  | "happy"
  | "angry"
  | "sad"
  | "neutral"
  | "disgusted"
  | "surprised";

/**
 * Model mode for Sync Lipsync React-1
 * - lips: Only modify lip region
 * - face: Modify full face (default)
 * - head: Include head movement
 */
export type SyncLipsyncModelMode = "lips" | "face" | "head";

/**
 * Sync mode for audio-video duration handling
 * - cut_off: Cut when shorter ends
 * - loop: Loop shorter to match longer
 * - bounce: Bounce shorter back and forth
 * - silence: Pad with silence
 * - remap: Retime to match
 */
export type SyncLipsyncMode =
  | "cut_off"
  | "loop"
  | "bounce"
  | "silence"
  | "remap";

/**
 * Request parameters for Sync Lipsync React-1
 */
export interface SyncLipsyncReact1Request {
  model: string;
  video_url: string;
  audio_url: string;
  emotion: SyncLipsyncEmotion;
  model_mode?: SyncLipsyncModelMode;
  lipsync_mode?: SyncLipsyncMode;
  temperature?: number;
}
```

### 2. Add Model Configuration

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

Add to `AI_MODELS` array:

```typescript
{
  id: "sync_lipsync_react1",
  name: "Sync Lipsync React-1",
  description: "Emotion-aware lip-sync: sync video to audio with expressions (happy, sad, angry, etc.)",
  price: "0.10", // 5 credits per request
  resolution: "Preserves source",
  max_duration: 15, // 15 second limit
  category: "avatar",
  requiredInputs: ["sourceVideo", "audioFile"],
  endpoints: {
    text_to_video: "fal-ai/sync-lipsync/react-1",
  },
  default_params: {
    emotion: "neutral",
    model_mode: "face",
    lipsync_mode: "bounce",
    temperature: 0.5,
  },
  supportedEmotions: ["happy", "angry", "sad", "neutral", "disgusted", "surprised"],
  supportedModelModes: ["lips", "face", "head"],
  supportedLipsyncModes: ["cut_off", "loop", "bounce", "silence", "remap"],
},
```

### 3. Add Error Messages

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

Add to `ERROR_MESSAGES`:

```typescript
// Sync Lipsync React-1 errors
SYNC_LIPSYNC_MISSING_VIDEO: "Video is required for Sync Lipsync",
SYNC_LIPSYNC_MISSING_AUDIO: "Audio is required for Sync Lipsync",
SYNC_LIPSYNC_VIDEO_TOO_LONG: "Video must be 15 seconds or shorter for Sync Lipsync",
SYNC_LIPSYNC_AUDIO_TOO_LONG: "Audio must be 15 seconds or shorter for Sync Lipsync",
SYNC_LIPSYNC_MISSING_EMOTION: "Emotion is required for Sync Lipsync React-1",
SYNC_LIPSYNC_INVALID_TEMPERATURE: "Temperature must be between 0 and 1",
```

### 4. Add Generator Function

**File:** `apps/web/src/lib/ai-video/generators/avatar.ts`

Add new generator for Sync Lipsync React-1:

```typescript
/**
 * Generate lip-synced video using Sync Lipsync React-1
 *
 * Syncs video to audio with emotion-aware facial expressions.
 * Both inputs must be 15 seconds or shorter.
 *
 * @param request - Request with video URL, audio URL, and emotion
 * @returns VideoGenerationResponse with synced video
 */
export async function generateSyncLipsyncReact1(
  request: {
    videoUrl: string;
    audioUrl: string;
    emotion: SyncLipsyncEmotion;
    modelMode?: SyncLipsyncModelMode;
    lipsyncMode?: SyncLipsyncMode;
    temperature?: number;
  }
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate sync lipsync react-1",
    { operation: "generateSyncLipsyncReact1" },
    async () => {
      const falApiKey = getFalApiKey();
      if (!falApiKey) {
        throw new Error("FAL API key not configured");
      }

      const endpoint = "fal-ai/sync-lipsync/react-1";
      const payload = {
        video_url: request.videoUrl,
        audio_url: request.audioUrl,
        emotion: request.emotion,
        model_mode: request.modelMode ?? "face",
        lipsync_mode: request.lipsyncMode ?? "bounce",
        temperature: request.temperature ?? 0.5,
      };

      const jobId = generateJobId();

      // 6 minute timeout for lipsync generation
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 360_000);

      try {
        const response = await makeFalRequest(endpoint, payload, {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          await handleFalResponse(response, "Generate sync lipsync react-1");
        }

        const result = await response.json();

        return {
          job_id: jobId,
          status: "completed",
          message: "Sync lipsync video generated successfully",
          estimated_time: 0,
          video_url: result.video?.url,
          video_data: result,
        };
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(
            "Sync lipsync generation timed out (6 minutes). Please try again."
          );
        }
        throw error;
      }
    }
  );
}
```

### 5. Update AvatarVideoRequest Type

**File:** `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`

Extend `AvatarVideoRequest`:

```typescript
export interface AvatarVideoRequest {
  model: string;
  characterImage: File;
  audioFile?: File;
  sourceVideo?: File;
  prompt?: string;
  resolution?: string;
  duration?: number;
  audioDuration?: number;
  characterImageUrl?: string;
  audioUrl?: string;
  // Sync Lipsync React-1 specific
  videoUrl?: string;
  emotion?: SyncLipsyncEmotion;
  modelMode?: SyncLipsyncModelMode;
  lipsyncMode?: SyncLipsyncMode;
  temperature?: number;
}
```

### 6. Update UseAIGenerationProps

**File:** `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`

Add to `UseAIGenerationProps`:

```typescript
// Sync Lipsync React-1 options
syncLipsyncEmotion?: SyncLipsyncEmotion;
syncLipsyncModelMode?: SyncLipsyncModelMode;
syncLipsyncLipsyncMode?: SyncLipsyncMode;
syncLipsyncTemperature?: number;
```

### 7. Add Validation

**File:** `apps/web/src/lib/ai-video/validation/validators.ts`

```typescript
/**
 * Validate Sync Lipsync React-1 inputs
 */
export function validateSyncLipsyncReact1(
  videoFile: File | null,
  audioFile: File | null,
  videoDuration: number | null,
  audioDuration: number | null,
  emotion: SyncLipsyncEmotion | null
): void {
  if (!videoFile) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_MISSING_VIDEO);
  }
  if (!audioFile) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_MISSING_AUDIO);
  }
  if (videoDuration && videoDuration > 15) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_VIDEO_TOO_LONG);
  }
  if (audioDuration && audioDuration > 15) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_AUDIO_TOO_LONG);
  }
  if (!emotion) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_MISSING_EMOTION);
  }
}
```

### 8. Update Avatar Generator Handler

**File:** `apps/web/src/lib/ai-video/generators/avatar.ts`

Add case in `generateAvatarVideo`:

```typescript
} else if (request.model === "sync_lipsync_react1") {
  // Sync Lipsync React-1 requires pre-uploaded URLs
  if (!request.videoUrl) {
    throw new Error("Sync Lipsync React-1 requires pre-uploaded video URL");
  }
  if (!request.audioUrl) {
    throw new Error("Sync Lipsync React-1 requires pre-uploaded audio URL");
  }
  if (!request.emotion) {
    throw new Error("Sync Lipsync React-1 requires emotion parameter");
  }

  endpoint = modelConfig.endpoints.text_to_video || "";
  if (!endpoint) {
    throw new Error(`Model ${request.model} does not have a valid endpoint`);
  }

  payload = {
    video_url: request.videoUrl,
    audio_url: request.audioUrl,
    emotion: request.emotion,
    model_mode: request.modelMode ?? "face",
    lipsync_mode: request.lipsyncMode ?? "bounce",
    temperature: request.temperature ?? 0.5,
  };
```

## UI Components Needed

### Emotion Selector

Add a dropdown/radio group for emotion selection:
- happy
- angry
- sad
- neutral (default)
- disgusted
- surprised

### Model Mode Selector

Add a dropdown for model mode:
- lips - Only lip region
- face - Full face (default)
- head - Include head movement

### Lipsync Mode Selector

Add a dropdown for sync mode:
- bounce (default)
- cut_off
- loop
- silence
- remap

### Temperature Slider

Add a slider for temperature (0-1):
- Default: 0.5
- Lower = more conservative
- Higher = more expressive

## Testing Checklist

- [ ] Model appears in Avatar tab
- [ ] Video upload works (max 15s validation)
- [ ] Audio upload works (max 15s validation)
- [ ] Emotion selector displays all 6 options
- [ ] Model mode selector works
- [ ] Lipsync mode selector works
- [ ] Temperature slider works (0-1 range)
- [ ] API call succeeds with valid inputs
- [ ] Error messages display for invalid inputs
- [ ] Generated video plays correctly
- [ ] Video can be added to timeline

## Code Example

```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/sync-lipsync/react-1", {
  input: {
    video_url: "https://storage.googleapis.com/falserverless/example_inputs/react_1/input.mp4",
    audio_url: "https://storage.googleapis.com/falserverless/example_inputs/react_1/input.mp3",
    emotion: "neutral",
    model_mode: "face",
    lipsync_mode: "bounce",
    temperature: 0.5
  }
});

console.log(result.data);
// Output: { video: { url: "...", width: 1920, height: 1080, ... } }
```

## Pricing

- 5 credits per request (~$0.10)
- Input constraints: 15 seconds max for both video and audio

## Related Files

- `apps/web/src/lib/ai-video/generators/avatar.ts` - Avatar generator
- `apps/web/src/lib/ai-video/core/fal-request.ts` - FAL API utilities
- `apps/web/src/lib/ai-video/core/fal-upload.ts` - File upload utilities
- `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts` - Type definitions
- `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts` - Model configs
