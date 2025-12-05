# Kling AI Avatar v2 Integration

## Status: IMPLEMENTED

This document describes the integration of Kling AI Avatar v2 (Standard and Pro) models into the OpenCut codebase. The implementation is complete.

### Model Specifications

| Model | Endpoint | Cost | Quality |
|-------|----------|------|---------|
| Kling Avatar v2 Standard | `fal-ai/kling-video/ai-avatar/v2/standard` | $0.0562/sec | Standard quality |
| Kling Avatar v2 Pro | `fal-ai/kling-video/ai-avatar/v2/pro` | $0.115/sec | Premium quality |

### Input Requirements

- **Image**: JPG, JPEG, PNG, WebP formats
- **Audio**: MP3, WAV, AAC formats (max 5MB, 2-60 seconds duration)
- **Prompt** (optional): Text refinement for animation guidance

### Output

- MP4 video with duration matching audio length
- Audio-synchronized lip movements and facial animations

---

## Implementation Summary

### Files Modified

| File Path | Changes |
|-----------|---------|
| `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts` | Added 2 model definitions (lines 788-840), moved v1 models to end (lines 936-968), added 5 error messages |
| `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts` | Added `audioConstraints` to AIModel interface (lines 114-119), added `klingAvatarV2Prompt` and `audioDuration` to UseAIGenerationProps (lines 242-246) |
| `qcut/apps/web/src/lib/ai-video-client.ts` | Added `audioDuration` to AvatarVideoRequest (line 362), added `validateKlingAvatarV2Audio` function (lines 3035-3057), added v2 routing branch in generateAvatarVideo (lines 3137-3168), improved error message parsing (lines 3261-3281) |
| `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` | Added `klingAvatarV2Prompt` and `audioDuration` props (lines 161-163), updated generateAvatarVideo call to pass v2 prompt (lines 1659-1672), added to dependency array (lines 2271-2272) |
| `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` | Added state variables (lines 374-376), added model selection check (lines 650-652), added reset effect (lines 847-852), added audio duration extraction effect (lines 854-870), added props to hook (lines 570-572), added UI controls (lines 2872-2915) |

---

## Key Implementation Details

### 1. Model Constants (`ai-constants.ts`)

```typescript
// Kling Avatar v2 Standard - line 789
{
  id: "kling_avatar_v2_standard",
  name: "Kling Avatar v2 Standard",
  price: "0.0562",
  category: "avatar",
  requiredInputs: ["characterImage", "audioFile"],
  endpoints: { text_to_video: "fal-ai/kling-video/ai-avatar/v2/standard" },
  audioConstraints: { minDurationSec: 2, maxDurationSec: 60, maxFileSizeBytes: 5242880 },
  perSecondPricing: { "1080p": 0.0562 },
}

// Kling Avatar v2 Pro - line 815
{
  id: "kling_avatar_v2_pro",
  name: "Kling Avatar v2 Pro",
  price: "0.115",
  // ... same structure as Standard with different pricing
}
```

### 2. Audio Validation (`ai-video-client.ts`)

```typescript
// validateKlingAvatarV2Audio - line 3035
function validateKlingAvatarV2Audio(audioFile: File, audioDuration?: number): string | null {
  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
  const MIN_DURATION_SEC = 2;
  const MAX_DURATION_SEC = 60;

  if (audioFile.size > MAX_SIZE_BYTES) {
    return ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LARGE;
  }
  if (audioDuration !== undefined) {
    if (audioDuration < MIN_DURATION_SEC) return ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_SHORT;
    if (audioDuration > MAX_DURATION_SEC) return ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LONG;
  }
  return null;
}
```

### 3. Model Routing (`ai-video-client.ts`)

```typescript
// In generateAvatarVideo - line 3137
} else if (
  request.model === "kling_avatar_v2_standard" ||
  request.model === "kling_avatar_v2_pro"
) {
  if (!request.audioFile) {
    throw new Error(ERROR_MESSAGES.KLING_AVATAR_V2_MISSING_AUDIO);
  }
  const audioValidationError = validateKlingAvatarV2Audio(request.audioFile, request.audioDuration);
  if (audioValidationError) throw new Error(audioValidationError);

  const audioUrl = await fileToDataURL(request.audioFile);
  endpoint = modelConfig.endpoints.text_to_video || "";
  payload = {
    ...(modelConfig.default_params || {}),
    image_url: characterImageUrl,
    audio_url: audioUrl,
    ...(request.prompt && { prompt: request.prompt }),
  };
}
```

### 4. UI Components (`ai.tsx`)

- **State variables**: `klingAvatarV2Prompt`, `audioDuration`
- **Model selection check**: `klingAvatarV2Selected`
- **Reset effect**: Clears prompt when v2 models are deselected
- **Audio duration extraction**: Automatically extracts duration when audio file is uploaded
- **UI controls**: Optional animation prompt textarea with estimated cost display

---

## Bug Fixes

### Issue 1: FAL API Error Message Display (`[object Object]`)

**Problem**: When FAL API returned a 422 validation error, the error message displayed as `Avatar generation failed: [object Object]` instead of the actual error details.

**Root Cause**: FAL API returns validation errors as an array of objects in `errorData.detail`, but the code was treating it as a string.

**Error Log**:
```
standard:1 Failed to load resource: the server responded with a status of 422 ()
❌ FAL AI API error: {detail: Array(1)}
Original Error: Error: Avatar generation failed: [object Object]
```

**Solution** (`ai-video-client.ts` lines 3261-3281):
```typescript
if (!response.ok) {
  const errorData = await response.json().catch(() => ({}));
  console.error("❌ FAL AI API error:", errorData);
  // Handle FAL API error format - detail can be string or array of validation errors
  let errorMessage = response.statusText;
  if (errorData.detail) {
    if (typeof errorData.detail === "string") {
      errorMessage = errorData.detail;
    } else if (Array.isArray(errorData.detail)) {
      // FAL validation errors come as array of {loc, msg, type} objects
      errorMessage = errorData.detail
        .map((e: { msg?: string; loc?: string[] }) =>
          e.msg || JSON.stringify(e)
        )
        .join("; ");
    } else {
      errorMessage = JSON.stringify(errorData.detail);
    }
  }
  throw new Error(`Avatar generation failed: ${errorMessage}`);
}
```

**Result**: Error messages now display properly, e.g., `Avatar generation failed: value is not a valid url`

---

## Testing Checklist

### Unit Tests Required

```typescript
describe("generateAvatarVideo - Kling Avatar v2", () => {
  it("should route kling_avatar_v2_standard to correct endpoint");
  it("should route kling_avatar_v2_pro to correct endpoint");
  it("should fail without audioFile with KLING_AVATAR_V2_MISSING_AUDIO");
  it("should fail when audio exceeds 5MB");
  it("should fail when audio duration < 2 seconds");
  it("should fail when audio duration > 60 seconds");
  it("should include optional prompt when provided");
  it("should properly parse FAL API validation errors");
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

## Model Order

The avatar models are ordered as follows (v1 legacy models moved to end):

1. WAN Animate/Replace
2. **Kling Avatar v2 Standard** (NEW)
3. **Kling Avatar v2 Pro** (NEW)
4. Kling O1 Video Reference
5. Kling O1 Video Edit
6. Kling O1 Reference-to-Video
7. Kling O1 Image-to-Video
8. ByteDance OmniHuman v1.5
9. Kling Avatar Pro (Legacy v1)
10. Kling Avatar Standard (Legacy v1)

---

## Backward Compatibility

The existing Kling Avatar v1 models remain active:
- `kling_avatar_standard` (endpoint: `fal-ai/kling-video/v1/standard/ai-avatar`)
- `kling_avatar_pro` (endpoint: `fal-ai/kling-video/v1/pro/ai-avatar`)

v2 models are additive - users can choose between v1 and v2 based on their needs.

---

## Rollback Plan

### Immediate (UI Hide)
Comment out or delete the two model definitions in `AI_MODELS` array in `ai-constants.ts` (lines 788-840).

### Short-term (Code Revert)
```bash
git revert <commit-hash>
```

---

## References

- [Kling Avatar v2 Standard API](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard)
- [Kling Avatar v2 Pro API](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro/api)
- [FAL AI Client Documentation](https://fal.ai/docs)
