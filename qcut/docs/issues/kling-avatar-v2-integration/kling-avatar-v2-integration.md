# Kling AI Avatar v2 Integration

## Overview

This document outlines the integration plan for Kling AI Avatar v2 (Standard and Pro) models into the OpenCut codebase. These models transform static images into talking avatar videos synchronized to audio input.

### Model Specifications

| Model | Endpoint | Cost | Quality |
|-------|----------|------|---------|
| Kling Avatar v2 Standard | `fal-ai/kling-video/ai-avatar/v2/standard` | $0.0562/sec | Standard quality |
| Kling Avatar v2 Pro | `fal-ai/kling-video/ai-avatar/v2/pro` | $0.115/sec | Premium quality |

### Input Requirements

- **Image**: JPG, JPEG, PNG, WebP, GIF, AVIF formats
- **Audio**: MP3, OGG, WAV, M4A, AAC formats (max 5MB, 2-60 seconds duration)
- **Prompt** (optional): Text refinement for animation guidance

### Output

- MP4 video with duration matching audio length
- Audio-synchronized lip movements and facial animations

---

## Architecture Overview

This integration follows the established patterns in the codebase:

1. **Centralized Model Configuration** (`ai-constants.ts`) - Single source of truth for model definitions
2. **Type Safety** (`ai-types.ts`) - TypeScript interfaces for all props and state
3. **API Client** (`ai-video-client.ts`) - FAL AI integration with error handling
4. **Generation Hook** (`use-ai-generation.ts`) - React hook orchestrating generation flow
5. **UI Component** (`ai.tsx`) - User-facing controls and state management

---

## Implementation Plan

### Phase 1: Model Constants Definition

#### File: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Location**: Add to `AI_MODELS` array after existing Kling avatar models (around line 820, after `kling_avatar_standard`)

```typescript
// Kling Avatar v2 Standard
{
  id: "kling_avatar_v2_standard",
  name: "Kling Avatar v2 Standard",
  description: "Create talking avatar videos with realistic humans, animals, cartoons, or stylized characters. Audio-synchronized lip-sync.",
  price: "0.0562",
  resolution: "1080p",
  max_duration: 60,
  category: "avatar",
  requiredInputs: ["characterImage", "audioFile"],
  endpoints: {
    text_to_video: "fal-ai/kling-video/ai-avatar/v2/standard",
  },
  default_params: {
    prompt: "",
    resolution: "1080p",
  },
  perSecondPricing: {
    "1080p": 0.0562,
  },
  // Audio constraints for validation
  audioConstraints: {
    minDurationSec: 2,
    maxDurationSec: 60,
    maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
  },
},

// Kling Avatar v2 Pro
{
  id: "kling_avatar_v2_pro",
  name: "Kling Avatar v2 Pro",
  description: "Premium avatar video generation with enhanced quality and realism. Ideal for professional productions.",
  price: "0.115",
  resolution: "1080p",
  max_duration: 60,
  category: "avatar",
  requiredInputs: ["characterImage", "audioFile"],
  endpoints: {
    text_to_video: "fal-ai/kling-video/ai-avatar/v2/pro",
  },
  default_params: {
    prompt: "",
    resolution: "1080p",
  },
  perSecondPricing: {
    "1080p": 0.115,
  },
  // Audio constraints for validation
  audioConstraints: {
    minDurationSec: 2,
    maxDurationSec: 60,
    maxFileSizeBytes: 5 * 1024 * 1024, // 5MB
  },
},
```

**Location**: Add to `ERROR_MESSAGES` object (around line 1046)

```typescript
// Kling Avatar v2 specific errors
KLING_AVATAR_V2_MISSING_IMAGE: "Character image is required for Kling Avatar v2",
KLING_AVATAR_V2_MISSING_AUDIO: "Audio file is required for Kling Avatar v2",
KLING_AVATAR_V2_AUDIO_TOO_SHORT: "Audio must be at least 2 seconds for Kling Avatar v2",
KLING_AVATAR_V2_AUDIO_TOO_LONG: "Audio must be under 60 seconds for Kling Avatar v2",
KLING_AVATAR_V2_AUDIO_TOO_LARGE: "Audio file must be under 5MB for Kling Avatar v2",
```

**Location**: Add to `AIModel` interface in `ai-types.ts` (to support audioConstraints)

```typescript
// Add to AIModel interface
audioConstraints?: {
  minDurationSec: number;
  maxDurationSec: number;
  maxFileSizeBytes: number;
};
```

---

### Phase 2: Type Definitions

#### File: `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`

**Location**: Add to `UseAIGenerationProps` interface (around line 279, after other model-specific props)

```typescript
// Kling Avatar v2 specific props
klingAvatarV2Prompt?: string;
```

**Location**: Add to `AvatarUploadState` interface (around line 313) to track audio duration

```typescript
// Add to AvatarUploadState interface
audioDuration: number | null;
```

> **Note**: The existing `AvatarUploadState` interface already supports `characterImage`, `characterImagePreview`, `audioFile`, and `audioPreview`. Adding `audioDuration` enables accurate cost calculation.

---

### Phase 3: API Client Implementation

#### File: `qcut/apps/web/src/lib/ai-video-client.ts`

**Location**: Add validation helper function (before `generateAvatarVideo`, around line 3030)

```typescript
/**
 * Validates audio file against Kling Avatar v2 constraints
 *
 * @param audioFile - Audio file to validate
 * @param audioDuration - Duration in seconds (from audio element or metadata)
 * @returns Error message if validation fails, null if valid
 */
function validateKlingAvatarV2Audio(
  audioFile: File,
  audioDuration?: number
): string | null {
  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
  const MIN_DURATION_SEC = 2;
  const MAX_DURATION_SEC = 60;

  if (audioFile.size > MAX_SIZE_BYTES) {
    return ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LARGE;
  }

  if (audioDuration !== undefined) {
    if (audioDuration < MIN_DURATION_SEC) {
      return ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_SHORT;
    }
    if (audioDuration > MAX_DURATION_SEC) {
      return ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LONG;
    }
  }

  return null;
}
```

**Location**: Add to `generateAvatarVideo` function (around line 3083, within the model routing `if-else` chain)

```typescript
} else if (
  request.model === "kling_avatar_v2_standard" ||
  request.model === "kling_avatar_v2_pro"
) {
  // Kling Avatar v2 models
  if (!request.audioFile) {
    throw new Error(ERROR_MESSAGES.KLING_AVATAR_V2_MISSING_AUDIO);
  }

  // Validate audio constraints
  const audioValidationError = validateKlingAvatarV2Audio(
    request.audioFile,
    request.audioDuration
  );
  if (audioValidationError) {
    throw new Error(audioValidationError);
  }

  // Convert audio to data URL
  const audioUrl = await fileToDataURL(request.audioFile);
  endpoint = modelConfig.endpoints.text_to_video || "";
  if (!endpoint) {
    throw new Error(
      `Model ${request.model} does not have a valid endpoint`
    );
  }
  payload = {
    ...(modelConfig.default_params || {}),
    image_url: characterImageUrl,
    audio_url: audioUrl,
    ...(request.prompt && { prompt: request.prompt }),
  };
```

**Location**: Update `AvatarVideoRequest` interface (around line 354)

```typescript
export interface AvatarVideoRequest {
  model: string;
  characterImage: File;
  audioFile?: File;
  sourceVideo?: File;
  prompt?: string;
  resolution?: string;
  duration?: number;
  audioDuration?: number; // Add: duration of audio file in seconds
}
```

---

### Phase 4: Generation Hook Integration

#### File: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**Location 1**: Add to destructured props (around line 174, after existing model-specific props)

```typescript
// Kling Avatar v2 props
klingAvatarV2Prompt = "",
// Audio duration for cost calculation and validation
audioDuration = null,
```

**Location 2**: Update the avatar generation call to pass the v2 prompt

Find where `generateAvatarVideo` is called for avatar models and update to conditionally use the v2 prompt:

```typescript
// When calling generateAvatarVideo for avatar models, determine which prompt to use
const avatarPrompt =
  (modelId === "kling_avatar_v2_standard" || modelId === "kling_avatar_v2_pro")
    ? klingAvatarV2Prompt
    : prompt; // Use global prompt for other avatar models

response = await generateAvatarVideo({
  model: modelId,
  characterImage: avatarImage!,
  audioFile: audioFile || undefined,
  sourceVideo: sourceVideo || undefined,
  prompt: avatarPrompt,
  resolution: modelConfig?.default_params?.resolution as string,
  audioDuration: audioDuration || undefined,
});
```

**Location 3**: Add to dependency array in useCallback

```typescript
klingAvatarV2Prompt,
audioDuration,
```

---

### Phase 5: UI Component Updates

#### File: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location 1**: Add state variables (near other model-specific state)

```typescript
const [klingAvatarV2Prompt, setKlingAvatarV2Prompt] = useState("");
const [audioDuration, setAudioDuration] = useState<number | null>(null);
```

**Location 2**: Add model selection check (near other selection checks)

```typescript
const klingAvatarV2Selected = selectedModels.includes("kling_avatar_v2_standard") ||
                               selectedModels.includes("kling_avatar_v2_pro");
```

**Location 3**: Add audio duration extraction when file is selected

Find where `audioFile` is set in the file upload handler and add:

```typescript
// After setting audioFile, extract duration
const handleAudioFileChange = async (file: File | null) => {
  setAudioFile(file);

  if (file) {
    // Create audio element to get duration
    const audio = new Audio();
    audio.src = URL.createObjectURL(file);
    audio.onloadedmetadata = () => {
      setAudioDuration(audio.duration);
      URL.revokeObjectURL(audio.src);
    };
    audio.onerror = () => {
      setAudioDuration(null);
      URL.revokeObjectURL(audio.src);
    };
  } else {
    setAudioDuration(null);
  }
};
```

**Location 4**: Reset prompt when v2 models are deselected

```typescript
// Add effect to clear v2 prompt when models are deselected
useEffect(() => {
  if (!klingAvatarV2Selected) {
    setKlingAvatarV2Prompt("");
  }
}, [klingAvatarV2Selected]);
```

**Location 5**: Add UI controls in avatar tab section

```typescript
{klingAvatarV2Selected && (
  <div className="space-y-3">
    <div className="space-y-2">
      <Label htmlFor="kling-avatar-v2-prompt" className="text-sm text-muted-foreground">
        Animation Prompt (Optional)
      </Label>
      <Textarea
        id="kling-avatar-v2-prompt"
        placeholder="Describe animation style, expressions, or movements..."
        value={klingAvatarV2Prompt}
        onChange={(e) => setKlingAvatarV2Prompt(e.target.value)}
        className="min-h-[60px] resize-none"
      />
      <p className="text-xs text-muted-foreground">
        Optional guidance for facial expressions and animation style
      </p>
    </div>
  </div>
)}
```

**Location 6**: Pass props to useAIGeneration hook call

```typescript
klingAvatarV2Prompt,
audioDuration,
```

---

### Phase 6: Cost Calculation Updates

#### File: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: Update cost calculation function

```typescript
// Add handling for v2 avatar models with per-second pricing
if (modelId === "kling_avatar_v2_standard" || modelId === "kling_avatar_v2_pro") {
  const perSecondRate = modelId === "kling_avatar_v2_pro" ? 0.115 : 0.0562;

  // Use actual audio duration if available, otherwise show "varies"
  if (audioDuration !== null && audioDuration > 0) {
    return audioDuration * perSecondRate;
  }

  // Return null to indicate cost varies by audio length
  // UI should display "Cost varies by audio length" instead of a fixed number
  return null;
}
```

**Location**: Update cost display component to handle null (varies) case

```typescript
// In cost display JSX
{estimatedCost === null ? (
  <span className="text-muted-foreground text-sm">
    Cost varies by audio length
  </span>
) : (
  <span>${estimatedCost.toFixed(2)}</span>
)}
```

---

## Long-Term Maintenance Considerations

### Backward Compatibility

The existing Kling Avatar v1 models must remain active:
- `kling_avatar_standard` (endpoint: `fal-ai/kling-video/v1/standard/ai-avatar`)
- `kling_avatar_pro` (endpoint: `fal-ai/kling-video/v1/pro/ai-avatar`)

v2 models are additive - users can choose between v1 and v2 based on their needs.

### Model Configuration Centralization

All model-specific parameters are defined in `AI_MODELS` array in `ai-constants.ts`. This ensures:
- Single source of truth for pricing, endpoints, and capabilities
- Easy updates when FAL API changes
- Consistent behavior across generation, UI, and cost calculation
- Audio constraints encoded in config for validation

### Error Handling Pattern

Follow the existing `handleAIServiceError` pattern from `ai-video-client.ts` for consistent error reporting:

```typescript
handleAIServiceError(error, "Generate Kling Avatar v2 video", {
  model: request.model,
  operation: "generateAvatarVideo",
});
```

### Future API Changes

Monitor FAL AI for:
1. **New Parameters**: v2 may introduce expression controls, head movement options
2. **Pricing Updates**: `perSecondPricing` in model config makes updates easy
3. **Audio Constraints**: Track changes to duration/size limits
4. **Output Formats**: May expand beyond MP4

### Deprecation Strategy

When deprecating v1 models in the future:
1. Add `deprecated: true` flag to model config
2. Show UI warning for deprecated model selection
3. After 6 months, remove from `AI_MODELS` array
4. Keep endpoint routing for 3 additional months for in-flight jobs

---

## Testing Checklist

### Unit Tests

#### File: `qcut/apps/web/src/lib/__tests__/ai-video-client.test.ts`

```typescript
describe("generateAvatarVideo - Kling Avatar v2", () => {
  it("should route kling_avatar_v2_standard to correct endpoint", async () => {
    // Mock fetch and verify endpoint is "fal-ai/kling-video/ai-avatar/v2/standard"
  });

  it("should route kling_avatar_v2_pro to correct endpoint", async () => {
    // Mock fetch and verify endpoint is "fal-ai/kling-video/ai-avatar/v2/pro"
  });

  it("should fail without audioFile with KLING_AVATAR_V2_MISSING_AUDIO", async () => {
    const result = await generateAvatarVideo({
      model: "kling_avatar_v2_standard",
      characterImage: mockImageFile,
      // audioFile omitted
    });
    expect(result).rejects.toThrow(ERROR_MESSAGES.KLING_AVATAR_V2_MISSING_AUDIO);
  });

  it("should fail when audio exceeds 5MB", async () => {
    const largeAudioFile = new File([new ArrayBuffer(6 * 1024 * 1024)], "large.mp3");
    await expect(generateAvatarVideo({
      model: "kling_avatar_v2_standard",
      characterImage: mockImageFile,
      audioFile: largeAudioFile,
    })).rejects.toThrow(ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LARGE);
  });

  it("should fail when audio duration < 2 seconds", async () => {
    await expect(generateAvatarVideo({
      model: "kling_avatar_v2_standard",
      characterImage: mockImageFile,
      audioFile: mockAudioFile,
      audioDuration: 1.5,
    })).rejects.toThrow(ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_SHORT);
  });

  it("should fail when audio duration > 60 seconds", async () => {
    await expect(generateAvatarVideo({
      model: "kling_avatar_v2_standard",
      characterImage: mockImageFile,
      audioFile: mockAudioFile,
      audioDuration: 65,
    })).rejects.toThrow(ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LONG);
  });

  it("should include optional prompt when provided", async () => {
    // Mock fetch and verify prompt is in payload
  });

  it("should convert image and audio to base64 data URLs", async () => {
    // Verify fileToDataURL is called for both files
  });
});

describe("validateKlingAvatarV2Audio", () => {
  it("should return null for valid audio", () => {
    const result = validateKlingAvatarV2Audio(mockAudioFile, 30);
    expect(result).toBeNull();
  });

  it("should return error for oversized file", () => {
    const largeFile = new File([new ArrayBuffer(6 * 1024 * 1024)], "large.mp3");
    const result = validateKlingAvatarV2Audio(largeFile, 30);
    expect(result).toBe(ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LARGE);
  });
});
```

### Integration Tests

#### File: `qcut/apps/web/src/lib/__tests__/ai-video-client.integration.test.ts`

```typescript
describe("Kling Avatar v2 Integration", () => {
  // Gate with VITE_FAL_API_KEY presence
  const shouldRun = !!import.meta.env.VITE_FAL_API_KEY;

  it.skipIf(!shouldRun)("should generate avatar video with standard model", async () => {
    // Real API test with test image and audio
  });

  it.skipIf(!shouldRun)("should generate avatar video with pro model", async () => {
    // Real API test with test image and audio
  });
});
```

### Manual Testing Procedure

1. Navigate to AI Generation panel
2. Select "Avatar" tab
3. Upload character image (JPG, PNG, or WebP)
4. Upload audio file (MP3 or WAV, 5-30 seconds)
5. Verify audio duration is displayed
6. Select "Kling Avatar v2 Standard"
7. Optionally enter animation prompt
8. Verify cost estimate displays correctly (based on audio duration)
9. Click Generate
10. Verify video generation completes
11. Verify video plays with synced lip movements
12. Repeat steps 5-11 with "Kling Avatar v2 Pro"
13. Test error cases: audio too short (<2s), too long (>60s), too large (>5MB)

---

## Files Summary

| File Path | Action | Changes |
|-----------|--------|---------|
| `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts` | Modify | Add 2 model definitions to AI_MODELS (~line 820), add 5 error messages (~line 1046) |
| `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts` | Modify | Add `klingAvatarV2Prompt` to UseAIGenerationProps (~line 279), add `audioDuration` to AvatarUploadState (~line 313), add `audioConstraints` to AIModel interface |
| `qcut/apps/web/src/lib/ai-video-client.ts` | Modify | Add `validateKlingAvatarV2Audio` function (~line 3030), add v2 routing branch in generateAvatarVideo (~line 3083), add `audioDuration` to AvatarVideoRequest interface (~line 354) |
| `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` | Modify | Destructure `klingAvatarV2Prompt` and `audioDuration` (~line 174), pass to generateAvatarVideo, add to dependency array |
| `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` | Modify | Add state variables, selection check, audio duration extraction, reset effect, UI controls, cost calculation with null handling |
| `qcut/apps/web/src/lib/__tests__/ai-video-client.test.ts` | Modify | Add unit tests for v2 routing, validation, error messages |
| `qcut/apps/web/src/lib/__tests__/ai-video-client.integration.test.ts` | Modify | Add integration tests for v2 models |

---

## Rollback Plan

### Immediate (UI Hide)
Remove model entries from `AI_MODELS` array to hide from UI. No code removal needed - just comment out or delete the two model objects.

### Short-term (Code Revert)
```bash
git revert <commit-hash>
```

### Long-term (Investigation)
1. Check FAL AI status page for API issues
2. Review error logs for specific failure patterns
3. Test with different image/audio formats
4. Verify API key permissions

---

## References

- [Kling Avatar v2 Standard API](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard)
- [Kling Avatar v2 Pro API](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro/api)
- [FAL AI Client Documentation](https://fal.ai/docs)
- [Existing Kling Avatar v1 Integration](../../../apps/web/src/lib/ai-video-client.ts) - lines 3083-3104
