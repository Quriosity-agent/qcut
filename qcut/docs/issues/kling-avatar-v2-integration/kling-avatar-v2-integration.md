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

**Location**: Add to `ERROR_MESSAGES` object (around line 1046)

```typescript
// Kling Avatar v2 specific errors
KLING_AVATAR_V2_MISSING_IMAGE: "Character image is required for Kling Avatar v2",
KLING_AVATAR_V2_MISSING_AUDIO: "Audio file is required for Kling Avatar v2",
KLING_AVATAR_V2_AUDIO_TOO_LONG: "Audio must be between 2-60 seconds for Kling Avatar v2",
KLING_AVATAR_V2_AUDIO_TOO_LARGE: "Audio file must be under 5MB for Kling Avatar v2",
```

---

### Phase 2: Type Definitions

#### File: `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`

**Location**: Add to `UseAIGenerationProps` interface (around line 279, after other model-specific props)

```typescript
// Kling Avatar v2 specific props
klingAvatarV2Prompt?: string;
```

> **Note**: The existing `AvatarUploadState` interface (line 313-320) already supports `characterImage`, `characterImagePreview`, `audioFile`, and `audioPreview` which are sufficient for this model. No changes needed there.

---

### Phase 3: API Client Implementation

#### File: `qcut/apps/web/src/lib/ai-video-client.ts`

**Location**: Add to `generateAvatarVideo` function (around line 3083, within the model routing `if-else` chain)

The existing `generateAvatarVideo` function handles avatar models via a routing pattern. Add new branch after the existing `kling_avatar_standard` handling:

```typescript
} else if (
  request.model === "kling_avatar_v2_standard" ||
  request.model === "kling_avatar_v2_pro"
) {
  // Kling Avatar v2 models
  if (!request.audioFile) {
    throw new Error(`${request.model} requires an audio file`);
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
    ...(modelConfig.default_params || {}), // Defaults first
    image_url: characterImageUrl,
    audio_url: audioUrl,
    ...(request.prompt && { prompt: request.prompt }), // Optional prompt for animation guidance
  };
```

**Pattern Reference**: This follows the exact same pattern as the existing `kling_avatar_pro` / `kling_avatar_standard` handling (lines 3083-3104), ensuring consistency with the established codebase conventions.

---

### Phase 4: Generation Hook Integration

#### File: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**Location 1**: Add to destructured props (around line 174, after existing model-specific props)

```typescript
// Kling Avatar v2 props
klingAvatarV2Prompt = "",
```

**Location 2**: The avatar generation is already handled by calling `generateAvatarVideo` which routes based on model ID. Since we're extending the existing `generateAvatarVideo` function (Phase 3), no additional routing logic is needed in the hook.

The hook already passes `avatarImage`, `audioFile`, and `prompt` to `generateAvatarVideo` for avatar models - the routing happens inside the API client based on model ID.

---

### Phase 5: UI Component Updates

#### File: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location 1**: Add state variable (near other model-specific state, search for existing pattern like `klingNegativePrompt`)

```typescript
const [klingAvatarV2Prompt, setKlingAvatarV2Prompt] = useState("");
```

**Location 2**: Add model selection check (near other selection checks)

```typescript
const klingAvatarV2Selected = selectedModels.includes("kling_avatar_v2_standard") ||
                               selectedModels.includes("kling_avatar_v2_pro");
```

**Location 3**: Add UI controls in avatar tab section (after existing avatar controls, look for the avatar tab content area)

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

**Location 4**: Pass props to useAIGeneration hook call

```typescript
klingAvatarV2Prompt,
```

---

### Phase 6: Cost Calculation Updates

#### File: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Location**: Update cost calculation function (search for `calculateEstimatedCost` or similar cost logic)

```typescript
// Add handling for v2 avatar models with per-second pricing
if (modelId === "kling_avatar_v2_standard" || modelId === "kling_avatar_v2_pro") {
  // Cost is based on audio duration
  const audioDuration = audioFileDuration || 10; // Default estimate if not available
  const perSecondRate = modelId === "kling_avatar_v2_pro" ? 0.115 : 0.0562;
  return audioDuration * perSecondRate;
}
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

  it("should fail without audioFile", async () => {
    // Verify error message matches KLING_AVATAR_V2_MISSING_AUDIO
  });

  it("should include optional prompt when provided", async () => {
    // Mock fetch and verify prompt is in payload
  });

  it("should convert image and audio to base64 data URLs", async () => {
    // Verify fileToDataURL is called for both files
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
5. Select "Kling Avatar v2 Standard"
6. Optionally enter animation prompt
7. Verify cost estimate displays correctly
8. Click Generate
9. Verify video generation completes
10. Verify video plays with synced lip movements
11. Repeat steps 5-10 with "Kling Avatar v2 Pro"

---

## Files Summary

| File Path | Action | Lines to Modify |
|-----------|--------|-----------------|
| `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts` | Modify | ~820 (AI_MODELS), ~1046 (ERROR_MESSAGES) |
| `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts` | Modify | ~279 (UseAIGenerationProps) |
| `qcut/apps/web/src/lib/ai-video-client.ts` | Modify | ~3083 (generateAvatarVideo routing) |
| `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` | Modify | ~174 (prop destructuring) |
| `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` | Modify | State, selection check, UI controls, hook props |
| `qcut/apps/web/src/lib/__tests__/ai-video-client.test.ts` | Modify | Add unit tests |
| `qcut/apps/web/src/lib/__tests__/ai-video-client.integration.test.ts` | Modify | Add integration tests |

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
