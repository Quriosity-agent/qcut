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

## Implementation Plan

### Phase 1: Constants & Type Definitions

#### File: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Add to `AI_MODELS` array (after existing Kling avatar models ~line 400):**

```typescript
// Kling Avatar v2 Standard
{
  id: "kling_avatar_v2_standard",
  name: "Kling Avatar v2 Standard",
  description: "Create talking avatar videos with realistic humans, animals, cartoons, or stylized characters. Audio-synchronized lip-sync.",
  price: "0.056",
  resolution: "1080p",
  max_duration: 60,
  category: "avatar",
  requiredInputs: ["characterImage", "audioFile"],
  endpoints: {
    text_to_video: "fal-ai/kling-video/ai-avatar/v2/standard",
  },
  default_params: {
    prompt: "",
  },
  perSecondPricing: {
    "1080p": 0.0562,
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
  },
  perSecondPricing: {
    "1080p": 0.115,
  },
},
```

**Add to `AI_ERROR_MESSAGES` object:**

```typescript
KLING_AVATAR_V2_MISSING_IMAGE: "Character image is required for Kling Avatar v2",
KLING_AVATAR_V2_MISSING_AUDIO: "Audio file is required for Kling Avatar v2",
KLING_AVATAR_V2_AUDIO_TOO_LONG: "Audio must be between 2-60 seconds for Kling Avatar v2",
KLING_AVATAR_V2_AUDIO_TOO_LARGE: "Audio file must be under 5MB for Kling Avatar v2",
```

---

#### File: `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`

**Add to `UseAIGenerationProps` interface:**

```typescript
// Kling Avatar v2 specific props
klingAvatarV2Prompt?: string;
```

> Note: The existing `AvatarUploadState` interface already supports `characterImage` and `audioFile` which are sufficient for this model.

---

### Phase 2: API Client Implementation

#### File: `qcut/apps/web/src/lib/ai-video-client.ts`

**Add request interface (after existing Kling interfaces ~line 50):**

```typescript
interface KlingAvatarV2Request {
  model: "kling_avatar_v2_standard" | "kling_avatar_v2_pro";
  image_url: string;
  audio_url: string;
  prompt?: string;
}
```

**Add generation function:**

```typescript
export async function generateKlingAvatarV2Video(
  request: KlingAvatarV2Request
): Promise<VideoGenerationResponse> {
  const { model, image_url, audio_url, prompt } = request;

  // Validate required inputs
  if (!image_url) {
    return {
      job_id: "",
      status: "failed",
      message: AI_ERROR_MESSAGES.KLING_AVATAR_V2_MISSING_IMAGE,
      video_url: "",
    };
  }

  if (!audio_url) {
    return {
      job_id: "",
      status: "failed",
      message: AI_ERROR_MESSAGES.KLING_AVATAR_V2_MISSING_AUDIO,
      video_url: "",
    };
  }

  // Determine endpoint based on model
  const endpoint = model === "kling_avatar_v2_pro"
    ? "fal-ai/kling-video/ai-avatar/v2/pro"
    : "fal-ai/kling-video/ai-avatar/v2/standard";

  const payload: Record<string, unknown> = {
    image_url,
    audio_url,
  };

  // Add optional prompt if provided
  if (prompt && prompt.trim()) {
    payload.prompt = prompt.trim();
  }

  try {
    const result = await fal.subscribe(endpoint, {
      input: payload,
      logs: true,
    });

    return {
      job_id: result.request_id || "",
      status: "completed",
      message: "Avatar video generated successfully",
      video_url: result.video?.url || "",
      video_data: result,
    };
  } catch (error) {
    return {
      job_id: "",
      status: "failed",
      message: error instanceof Error ? error.message : "Unknown error occurred",
      video_url: "",
    };
  }
}
```

**Modify `generateAvatarVideo` function to include v2 routing:**

```typescript
// Add to the model routing logic in generateAvatarVideo function
if (modelId === "kling_avatar_v2_standard" || modelId === "kling_avatar_v2_pro") {
  return generateKlingAvatarV2Video({
    model: modelId,
    image_url: imageUrl,
    audio_url: audioUrl,
    prompt: prompt,
  });
}
```

---

### Phase 3: Generation Hook Integration

#### File: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**Add to destructured props:**

```typescript
klingAvatarV2Prompt = "",
```

**Add to dependency array in useCallback:**

```typescript
klingAvatarV2Prompt,
```

**Add generation branch in handleGenerate function (within avatar category handling):**

```typescript
if (modelId === "kling_avatar_v2_standard" || modelId === "kling_avatar_v2_pro") {
  response = await generateKlingAvatarV2Video({
    model: modelId,
    image_url: characterImageUrl,
    audio_url: audioUrl,
    prompt: klingAvatarV2Prompt,
  });
}
```

---

### Phase 4: UI Component Updates

#### File: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Add state variable:**

```typescript
const [klingAvatarV2Prompt, setKlingAvatarV2Prompt] = useState("");
```

**Add model selection check:**

```typescript
const klingAvatarV2Selected = selectedModels.includes("kling_avatar_v2_standard") ||
                               selectedModels.includes("kling_avatar_v2_pro");
```

**Add UI controls in avatar tab section (after existing avatar controls):**

```typescript
{klingAvatarV2Selected && (
  <div className="space-y-3">
    <div className="space-y-2">
      <Label htmlFor="kling-avatar-v2-prompt" className="text-sm text-muted-foreground">
        Animation Prompt (Optional)
      </Label>
      <Textarea
        id="kling-avatar-v2-prompt"
        placeholder="Describe animation style or expressions..."
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

**Pass props to useAIGeneration hook:**

```typescript
klingAvatarV2Prompt,
```

---

### Phase 5: Cost Calculation Updates

#### File: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Update cost calculation function to handle per-second avatar pricing:**

```typescript
// In calculateEstimatedCost function, add handling for v2 avatar models
if (modelId === "kling_avatar_v2_standard" || modelId === "kling_avatar_v2_pro") {
  // Cost is based on audio duration, estimate if not available
  const audioDuration = audioFileDuration || 10; // Default estimate
  const perSecondRate = modelId === "kling_avatar_v2_pro" ? 0.115 : 0.0562;
  return audioDuration * perSecondRate;
}
```

---

## Migration from v1 to v2

### Deprecation Strategy

The existing Kling Avatar v1 models should be maintained for backward compatibility:
- `kling_avatar_standard` → Keep active
- `kling_avatar_pro` → Keep active

New v2 models will be added alongside v1, allowing users to choose based on their needs.

### Future Considerations

1. **v1 Sunset Timeline**: Consider deprecating v1 models after 6 months if v2 proves stable
2. **Feature Parity**: Monitor if v2 introduces new parameters (expressions, head movement controls)
3. **Pricing Changes**: Watch for FAL pricing updates and adjust constants accordingly

---

## Testing Checklist

### Unit Tests

Add to existing test suite:

```typescript
// File: qcut/apps/web/src/lib/__tests__/ai-video-client.test.ts

describe("generateKlingAvatarV2Video", () => {
  it("should fail without image_url", async () => {
    const result = await generateKlingAvatarV2Video({
      model: "kling_avatar_v2_standard",
      image_url: "",
      audio_url: "https://example.com/audio.mp3",
    });
    expect(result.status).toBe("failed");
    expect(result.message).toContain("image");
  });

  it("should fail without audio_url", async () => {
    const result = await generateKlingAvatarV2Video({
      model: "kling_avatar_v2_standard",
      image_url: "https://example.com/image.jpg",
      audio_url: "",
    });
    expect(result.status).toBe("failed");
    expect(result.message).toContain("audio");
  });

  it("should use correct endpoint for standard model", async () => {
    // Mock fal.subscribe and verify endpoint
  });

  it("should use correct endpoint for pro model", async () => {
    // Mock fal.subscribe and verify endpoint
  });

  it("should include optional prompt when provided", async () => {
    // Mock and verify prompt is passed
  });
});
```

### Integration Tests

```typescript
// File: qcut/apps/web/src/lib/__tests__/ai-video-client.integration.test.ts

describe("Kling Avatar v2 Integration", () => {
  it("should generate avatar video with standard model", async () => {
    // Test with real API (gated by environment variable)
  });

  it("should generate avatar video with pro model", async () => {
    // Test with real API (gated by environment variable)
  });
});
```

### Manual Testing

1. Upload character image (JPG, PNG, WebP)
2. Upload audio file (MP3, WAV)
3. Optionally enter animation prompt
4. Select Kling Avatar v2 Standard
5. Verify video generation and playback
6. Repeat with Pro model
7. Verify cost calculation displays correctly

---

## Files Summary

| File Path | Action | Description |
|-----------|--------|-------------|
| `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts` | Modify | Add model definitions and error messages |
| `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts` | Modify | Add optional prompt prop |
| `qcut/apps/web/src/lib/ai-video-client.ts` | Modify | Add request interface and generation function |
| `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` | Modify | Add prop destructuring and generation routing |
| `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` | Modify | Add state, UI controls, and hook props |
| `qcut/apps/web/src/lib/__tests__/ai-video-client.test.ts` | Modify | Add unit tests |
| `qcut/apps/web/src/lib/__tests__/ai-video-client.integration.test.ts` | Modify | Add integration tests |

---

## Rollback Plan

If issues arise after deployment:

1. **Immediate**: Remove model entries from `AI_MODELS` array to hide from UI
2. **Short-term**: Revert commits related to v2 integration
3. **Long-term**: Investigate issues and re-deploy with fixes

---

## References

- [Kling Avatar v2 Standard API](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard)
- [Kling Avatar v2 Pro API](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro/api)
- [FAL AI Client Documentation](https://fal.ai/docs)
