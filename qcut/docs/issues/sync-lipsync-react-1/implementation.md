# Sync Lipsync React-1 Integration

## Overview

Integrate FAL.ai's Sync Lipsync React-1 API for emotion-aware lip-syncing with video and audio inputs.

**API Endpoint:** `fal-ai/sync-lipsync/react-1`

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
- 5 credits per request (~$0.10)

---

## Implementation Plan

### 1. Add Type Definitions

**File:** `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`

Following the existing pattern used for `Sora2ModelType`, `SyncLipsyncMode`, etc.:

```typescript
// ============================================
// Sync Lipsync React-1 Types
// ============================================

/**
 * Emotion options for Sync Lipsync React-1
 * Controls the emotional expression applied during lip-sync
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
 * Controls which region is modified during generation
 */
export type SyncLipsyncModelMode = "lips" | "face" | "head";

/**
 * Sync mode for audio-video duration mismatch handling
 * Reuses same concept as base sync-lipsync API
 */
export type SyncLipsyncSyncMode =
  | "cut_off"
  | "loop"
  | "bounce"
  | "silence"
  | "remap";

/**
 * Request parameters for Sync Lipsync React-1 generation
 */
export interface SyncLipsyncReact1Request {
  model: string;
  /** Pre-uploaded video URL (FAL storage) */
  videoUrl: string;
  /** Pre-uploaded audio URL (FAL storage) */
  audioUrl: string;
  /** Required emotion for expression control */
  emotion: SyncLipsyncEmotion;
  /** Optional model mode (default: face) */
  modelMode?: SyncLipsyncModelMode;
  /** Optional sync mode (default: bounce) */
  lipsyncMode?: SyncLipsyncSyncMode;
  /** Optional temperature 0-1 (default: 0.5) */
  temperature?: number;
}
```

**Extend `AvatarVideoRequest`** (existing interface):

```typescript
export interface AvatarVideoRequest {
  // ... existing fields ...

  // Sync Lipsync React-1 specific fields
  /** Pre-uploaded video URL for lipsync models */
  videoUrl?: string;
  /** Emotion for Sync Lipsync React-1 */
  emotion?: SyncLipsyncEmotion;
  /** Model mode for Sync Lipsync React-1 */
  modelMode?: SyncLipsyncModelMode;
  /** Lipsync mode for Sync Lipsync React-1 */
  lipsyncMode?: SyncLipsyncSyncMode;
  /** Temperature for Sync Lipsync React-1 (0-1) */
  temperature?: number;
}
```

**Extend `UseAIGenerationProps`** (existing interface):

```typescript
export interface UseAIGenerationProps {
  // ... existing fields ...

  // Sync Lipsync React-1 options
  /** Emotion for Sync Lipsync React-1 */
  syncLipsyncEmotion?: SyncLipsyncEmotion;
  /** Model mode: lips, face, or head */
  syncLipsyncModelMode?: SyncLipsyncModelMode;
  /** Sync mode: cut_off, loop, bounce, silence, remap */
  syncLipsyncLipsyncMode?: SyncLipsyncSyncMode;
  /** Temperature 0-1 for expressiveness */
  syncLipsyncTemperature?: number;
  /** Video duration for validation */
  videoDuration?: number | null;
}
```

---

### 2. Add Model Configuration

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

Add to `AI_MODELS` array following the Kling Avatar v2 pattern (which also requires pre-uploaded URLs):

```typescript
// Sync Lipsync React-1 - Emotion-aware lip-sync
{
  id: "sync_lipsync_react1",
  name: "Sync Lipsync React-1",
  description: "Emotion-aware lip-sync: sync video to audio with expressions (happy, sad, angry, etc.)",
  price: "0.10", // 5 credits per request
  resolution: "Preserves source",
  max_duration: 15, // 15 second limit for both inputs
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
  // Model-specific supported values
  supportedEmotions: ["happy", "angry", "sad", "neutral", "disgusted", "surprised"],
  supportedModelModes: ["lips", "face", "head"],
  supportedLipsyncModes: ["cut_off", "loop", "bounce", "silence", "remap"],
},
```

**Note:** Using `category: "avatar"` and `requiredInputs: ["sourceVideo", "audioFile"]` to reuse existing avatar tab UI patterns.

---

### 3. Add Error Messages

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

Add to `ERROR_MESSAGES` following existing naming conventions:

```typescript
// Sync Lipsync React-1 errors
SYNC_LIPSYNC_REACT1_MISSING_VIDEO: "Video is required for Sync Lipsync React-1",
SYNC_LIPSYNC_REACT1_MISSING_AUDIO: "Audio is required for Sync Lipsync React-1",
SYNC_LIPSYNC_REACT1_VIDEO_TOO_LONG: "Video must be 15 seconds or shorter for Sync Lipsync React-1",
SYNC_LIPSYNC_REACT1_AUDIO_TOO_LONG: "Audio must be 15 seconds or shorter for Sync Lipsync React-1",
SYNC_LIPSYNC_REACT1_MISSING_EMOTION: "Emotion is required for Sync Lipsync React-1",
SYNC_LIPSYNC_REACT1_INVALID_TEMPERATURE: "Temperature must be between 0 and 1 for Sync Lipsync React-1",
```

---

### 4. Add Validation Functions

**File:** `apps/web/src/lib/ai-video/validation/validators.ts`

Following the pattern of `validateKlingAvatarV2Audio`:

```typescript
// ============================================
// Sync Lipsync React-1 Validators
// ============================================

/** Max duration in seconds for Sync Lipsync React-1 inputs */
export const SYNC_LIPSYNC_REACT1_MAX_DURATION = 15;

/** Valid emotions for Sync Lipsync React-1 */
export const SYNC_LIPSYNC_REACT1_EMOTIONS = [
  "happy",
  "angry",
  "sad",
  "neutral",
  "disgusted",
  "surprised",
] as const;

/** Valid model modes for Sync Lipsync React-1 */
export const SYNC_LIPSYNC_REACT1_MODEL_MODES = ["lips", "face", "head"] as const;

/** Valid lipsync modes for Sync Lipsync React-1 */
export const SYNC_LIPSYNC_REACT1_SYNC_MODES = [
  "cut_off",
  "loop",
  "bounce",
  "silence",
  "remap",
] as const;

/**
 * Validates video duration for Sync Lipsync React-1
 *
 * @param duration - Video duration in seconds
 * @throws Error if duration exceeds 15 seconds
 */
export function validateSyncLipsyncReact1VideoDuration(
  duration: number | null | undefined
): void {
  if (duration !== null && duration !== undefined && duration > SYNC_LIPSYNC_REACT1_MAX_DURATION) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_VIDEO_TOO_LONG);
  }
}

/**
 * Validates audio duration for Sync Lipsync React-1
 *
 * @param duration - Audio duration in seconds
 * @throws Error if duration exceeds 15 seconds
 */
export function validateSyncLipsyncReact1AudioDuration(
  duration: number | null | undefined
): void {
  if (duration !== null && duration !== undefined && duration > SYNC_LIPSYNC_REACT1_MAX_DURATION) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_AUDIO_TOO_LONG);
  }
}

/**
 * Validates emotion parameter for Sync Lipsync React-1
 *
 * @param emotion - Emotion string to validate
 * @throws Error if emotion is missing or invalid
 */
export function validateSyncLipsyncReact1Emotion(
  emotion: string | null | undefined
): void {
  if (!emotion) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_MISSING_EMOTION);
  }
  if (!SYNC_LIPSYNC_REACT1_EMOTIONS.includes(emotion as typeof SYNC_LIPSYNC_REACT1_EMOTIONS[number])) {
    throw new Error(`Invalid emotion: ${emotion}. Must be one of: ${SYNC_LIPSYNC_REACT1_EMOTIONS.join(", ")}`);
  }
}

/**
 * Validates temperature parameter for Sync Lipsync React-1
 *
 * @param temperature - Temperature value (0-1)
 * @throws Error if temperature is outside valid range
 */
export function validateSyncLipsyncReact1Temperature(
  temperature: number | undefined
): void {
  if (temperature !== undefined && (temperature < 0 || temperature > 1)) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_INVALID_TEMPERATURE);
  }
}

/**
 * Validates all Sync Lipsync React-1 inputs
 *
 * @param params - Validation parameters
 * @throws Error if any validation fails
 */
export function validateSyncLipsyncReact1Inputs(params: {
  videoUrl?: string;
  audioUrl?: string;
  videoDuration?: number | null;
  audioDuration?: number | null;
  emotion?: string | null;
  temperature?: number;
}): void {
  if (!params.videoUrl) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_MISSING_VIDEO);
  }
  if (!params.audioUrl) {
    throw new Error(ERROR_MESSAGES.SYNC_LIPSYNC_REACT1_MISSING_AUDIO);
  }

  validateSyncLipsyncReact1VideoDuration(params.videoDuration);
  validateSyncLipsyncReact1AudioDuration(params.audioDuration);
  validateSyncLipsyncReact1Emotion(params.emotion);
  validateSyncLipsyncReact1Temperature(params.temperature);
}
```

---

### 5. Add Generator Case to Avatar Generator

**File:** `apps/web/src/lib/ai-video/generators/avatar.ts`

Add case in `generateAvatarVideo` following the Kling Avatar V2 pattern (both require pre-uploaded URLs):

```typescript
} else if (request.model === "sync_lipsync_react1") {
  // Sync Lipsync React-1 requires pre-uploaded URLs (like Kling Avatar V2)
  // Validate inputs
  validateSyncLipsyncReact1Inputs({
    videoUrl: request.videoUrl,
    audioUrl: request.audioUrl,
    videoDuration: request.videoDuration,
    audioDuration: request.audioDuration,
    emotion: request.emotion,
    temperature: request.temperature,
  });

  endpoint = modelConfig.endpoints.text_to_video || "";
  if (!endpoint) {
    throw new Error(`Model ${request.model} does not have a valid endpoint`);
  }

  payload = {
    video_url: request.videoUrl,
    audio_url: request.audioUrl,
    emotion: request.emotion,
    model_mode: request.modelMode ?? modelConfig.default_params?.model_mode ?? "face",
    lipsync_mode: request.lipsyncMode ?? modelConfig.default_params?.lipsync_mode ?? "bounce",
    temperature: request.temperature ?? modelConfig.default_params?.temperature ?? 0.5,
  };
```

**Required imports** (add to top of file):

```typescript
import { validateSyncLipsyncReact1Inputs } from "../validation/validators";
```

---

### 6. Export New Validators

**File:** `apps/web/src/lib/ai-video/index.ts`

Add to validation exports:

```typescript
export {
  // ... existing exports ...

  // Sync Lipsync React-1 validators
  validateSyncLipsyncReact1Inputs,
  validateSyncLipsyncReact1VideoDuration,
  validateSyncLipsyncReact1AudioDuration,
  validateSyncLipsyncReact1Emotion,
  validateSyncLipsyncReact1Temperature,
  SYNC_LIPSYNC_REACT1_MAX_DURATION,
  SYNC_LIPSYNC_REACT1_EMOTIONS,
  SYNC_LIPSYNC_REACT1_MODEL_MODES,
  SYNC_LIPSYNC_REACT1_SYNC_MODES,
} from "./validation/validators";
```

---

### 7. Extend AIModel Interface (if needed)

**File:** `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`

If supporting model-specific dropdowns, extend `AIModel`:

```typescript
export interface AIModel {
  // ... existing fields ...

  /** Supported emotions for lipsync models */
  supportedEmotions?: string[];
  /** Supported model modes for lipsync models */
  supportedModelModes?: string[];
  /** Supported lipsync modes for lipsync models */
  supportedLipsyncModes?: string[];
}
```

---

## Code Reuse Summary

| Component | Reused Pattern | Source |
|-----------|----------------|--------|
| Type definitions | Discriminated unions | `Sora2ModelType`, `SyncLipsyncMode` |
| Model config | `AI_MODELS` array structure | `kling_avatar_v2_standard` |
| Error messages | `ERROR_MESSAGES` constants | Existing error naming |
| Validators | Function signature pattern | `validateKlingAvatarV2Audio` |
| Generator case | Pre-uploaded URL pattern | Kling Avatar V2 case |
| File upload | `uploadVideoToFal`, `uploadAudioToFal` | `core/fal-upload.ts` |
| Request handling | `makeFalRequest`, `handleFalResponse` | `core/fal-request.ts` |
| Error handling | `withErrorHandling` wrapper | `base-generator.ts` |

---

## UI Components Needed

### Emotion Selector

Dropdown with 6 emotion options:
- `neutral` (default)
- `happy`
- `sad`
- `angry`
- `disgusted`
- `surprised`

### Model Mode Selector (optional advanced setting)

- `face` (default) - Full face modification
- `lips` - Only lip region
- `head` - Include head movement

### Lipsync Mode Selector (optional advanced setting)

- `bounce` (default) - Bounce shorter track
- `cut_off` - Cut when shorter ends
- `loop` - Loop shorter track
- `silence` - Pad with silence
- `remap` - Retime to match

### Temperature Slider (optional advanced setting)

- Range: 0 to 1
- Default: 0.5
- Step: 0.1

---

## Testing Checklist

- [ ] Model appears in Avatar tab with correct metadata
- [ ] Video upload works and validates 15s limit
- [ ] Audio upload works and validates 15s limit
- [ ] Files upload to FAL storage via `uploadVideoToFal`/`uploadAudioToFal`
- [ ] Emotion selector displays all 6 options
- [ ] Generation succeeds with required inputs only
- [ ] Optional parameters (model_mode, lipsync_mode, temperature) work
- [ ] Error messages display for validation failures
- [ ] Generated video URL extracts correctly from response
- [ ] Video plays in preview panel
- [ ] Video can be added to timeline

---

## Files to Modify

| File | Changes |
|------|---------|
| `types/ai-types.ts` | Add types, extend `AvatarVideoRequest`, extend `UseAIGenerationProps` |
| `constants/ai-constants.ts` | Add model config, add error messages |
| `validation/validators.ts` | Add validation functions and constants |
| `generators/avatar.ts` | Add model case, import validators |
| `index.ts` | Export new validators |

---

## Pricing

- 5 credits per request (~$0.10)
- Input constraints: 15 seconds max for both video and audio

---

## Implementation Status

### Completed Steps

#### Step 1: Type Definitions (ai-types.ts)
**Status:** ✅ Completed

Added to `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`:
- `SyncLipsyncEmotion` type (happy, angry, sad, neutral, disgusted, surprised)
- `SyncLipsyncModelMode` type (lips, face, head)
- `SyncLipsyncSyncMode` type (cut_off, loop, bounce, silence, remap)
- `SyncLipsyncReact1Request` interface
- Extended `AvatarVideoRequest` with lipsync fields (videoUrl, videoDuration, emotion, modelMode, lipsyncMode, temperature)
- Extended `AIModel` interface with supportedEmotions, supportedModelModes, supportedLipsyncModes
- Extended `UseAIGenerationProps` with sync lipsync options

#### Step 2: Model Configuration (ai-constants.ts)
**Status:** ✅ Completed

Added `sync_lipsync_react1` model to `AI_MODELS` array at line 841-870:
- id: "sync_lipsync_react1"
- category: "avatar"
- requiredInputs: ["sourceVideo", "audioFile"]
- endpoint: "fal-ai/sync-lipsync/react-1"
- default_params: emotion="neutral", model_mode="face", lipsync_mode="bounce", temperature=0.5
- All supported options arrays

#### Step 3: Error Messages (ai-constants.ts)
**Status:** ✅ Completed

Added to `ERROR_MESSAGES` at lines 1232-1244:
- SYNC_LIPSYNC_REACT1_MISSING_VIDEO
- SYNC_LIPSYNC_REACT1_MISSING_AUDIO
- SYNC_LIPSYNC_REACT1_VIDEO_TOO_LONG
- SYNC_LIPSYNC_REACT1_AUDIO_TOO_LONG
- SYNC_LIPSYNC_REACT1_MISSING_EMOTION
- SYNC_LIPSYNC_REACT1_INVALID_TEMPERATURE

#### Step 4: Validation Functions (validators.ts)
**Status:** ✅ Completed

Added to `apps/web/src/lib/ai-video/validation/validators.ts` at lines 609-739:
- `SYNC_LIPSYNC_REACT1_MAX_DURATION` constant (15)
- `SYNC_LIPSYNC_REACT1_EMOTIONS` array constant
- `SYNC_LIPSYNC_REACT1_MODEL_MODES` array constant
- `SYNC_LIPSYNC_REACT1_SYNC_MODES` array constant
- `validateSyncLipsyncReact1VideoDuration()` function
- `validateSyncLipsyncReact1AudioDuration()` function
- `validateSyncLipsyncReact1Emotion()` function
- `validateSyncLipsyncReact1Temperature()` function
- `validateSyncLipsyncReact1Inputs()` composite validator

#### Step 5: Generator Case (avatar.ts)
**Status:** ✅ Completed

Added to `apps/web/src/lib/ai-video/generators/avatar.ts` at lines 185-220:
- Import for `validateSyncLipsyncReact1Inputs`
- New case for `sync_lipsync_react1` model
- Validates inputs using composite validator
- Builds payload with video_url, audio_url, emotion, model_mode, lipsync_mode, temperature

#### Step 6: Export Validators (index.ts)
**Status:** ✅ Completed

Added exports to `apps/web/src/lib/ai-video/index.ts` at lines 66-75:
- validateSyncLipsyncReact1Inputs
- validateSyncLipsyncReact1VideoDuration
- validateSyncLipsyncReact1AudioDuration
- validateSyncLipsyncReact1Emotion
- validateSyncLipsyncReact1Temperature
- SYNC_LIPSYNC_REACT1_MAX_DURATION
- SYNC_LIPSYNC_REACT1_EMOTIONS
- SYNC_LIPSYNC_REACT1_MODEL_MODES
- SYNC_LIPSYNC_REACT1_SYNC_MODES

---

### Remaining Work (UI Layer)

The backend/generator layer is complete. The following UI work remains:

1. **Model Handler** (`model-handlers.ts`): Add routing for `sync_lipsync_react1` to upload video/audio to FAL storage and call `generateAvatarVideo`

2. **Avatar Tab UI**: Surface emotion selector, model mode selector, lipsync mode selector, and temperature slider for this model

3. **File Upload Integration**: Wire up `uploadVideoToFal` and `uploadAudioToFal` before calling the generator

---

### Files Modified

| File | Line Numbers | Changes |
|------|--------------|---------|
| `types/ai-types.ts` | 120-125, 254-264, 512-536, 680-721 | Types, interfaces |
| `constants/ai-constants.ts` | 841-870, 1232-1244 | Model config, errors |
| `validation/validators.ts` | 609-739 | Validators, constants |
| `generators/avatar.ts` | 24-27, 185-220 | Import, case |
| `index.ts` | 66-75 | Exports |
