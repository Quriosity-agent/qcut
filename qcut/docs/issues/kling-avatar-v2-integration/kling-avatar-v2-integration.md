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
| `qcut/apps/web/src/lib/ai-video-client.ts` | Added `characterImageUrl` and `audioUrl` to AvatarVideoRequest (lines 363-365), added `validateKlingAvatarV2Audio` function (lines 3035-3057), added v2 routing using FAL storage URLs (lines 3140-3184), improved error message parsing (lines 3275-3295) |
| `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` | Added `klingAvatarV2Prompt` and `audioDuration` props, added FAL storage upload for v2 models (lines 1666-1708), added to dependency array |
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

### 3. FAL Storage Upload (`use-ai-generation.ts`)

Kling Avatar v2 requires FAL storage URLs, not base64 data URLs. Files are uploaded to FAL storage before the API call:

```typescript
// In use-ai-generation.ts - lines 1666-1708
if (modelId === "kling_avatar_v2_standard" || modelId === "kling_avatar_v2_pro") {
  console.log("  📤 Uploading files to FAL storage for Kling Avatar v2...");

  // Upload image and audio to FAL storage in parallel
  const [characterImageUrl, audioUrl] = await Promise.all([
    uploadImageToFal(avatarImage),
    audioFile ? uploadAudioToFal(audioFile) : Promise.resolve(""),
  ]);

  if (!audioUrl) {
    throw new Error("Audio file is required for Kling Avatar v2");
  }

  response = await generateAvatarVideo({
    model: modelId,
    characterImage: avatarImage,
    audioFile: audioFile || undefined,
    prompt: avatarPrompt,
    audioDuration: audioDuration ?? undefined,
    characterImageUrl, // FAL storage URL
    audioUrl,          // FAL storage URL
  });
}
```

### 4. Model Routing (`ai-video-client.ts`)

```typescript
// In generateAvatarVideo - lines 3140-3184
} else if (
  request.model === "kling_avatar_v2_standard" ||
  request.model === "kling_avatar_v2_pro"
) {
  // V2 API requires proper FAL storage URLs, not data URLs
  if (!request.characterImageUrl) {
    throw new Error("Kling Avatar v2 requires pre-uploaded image URL");
  }
  if (!request.audioUrl) {
    throw new Error("Kling Avatar v2 requires pre-uploaded audio URL");
  }

  endpoint = modelConfig.endpoints.text_to_video || "";
  payload = {
    ...(modelConfig.default_params || {}),
    image_url: request.characterImageUrl,
    audio_url: request.audioUrl,
    ...(request.prompt && { prompt: request.prompt }),
  };
}
```

### 5. UI Components (`ai.tsx`)

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

**Solution** (`ai-video-client.ts` lines 3275-3295):
```typescript
if (!response.ok) {
  const errorData = await response.json().catch(() => ({}));
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

### Issue 2: FAL API Rejects Base64 Data URLs (`File is not in a valid base64 format`)

**Problem**: FAL API returned a 422 error with message "File is not in a valid base64 format" when sending image/audio as base64 data URLs.

**Error Log**:
```
standard:1 Failed to load resource: the server responded with a status of 422 ()
❌ FAL AI API error: {detail: Array(1)}
Original Error: Error: Avatar generation failed: File is not in a valid base64 format
```

**Root Cause**: Kling Avatar v2 API requires proper FAL storage URLs (HTTPS URLs), not inline base64 data URLs. The v1 API accepted data URLs, but v2 has stricter requirements.

**Solution**:

1. **Added URL parameters to `AvatarVideoRequest`** (`ai-video-client.ts` lines 363-365):
```typescript
export interface AvatarVideoRequest {
  // ... existing fields
  // Pre-uploaded URLs for Kling Avatar v2 (FAL storage URLs, not data URLs)
  characterImageUrl?: string;
  audioUrl?: string;
}
```

2. **Upload files to FAL storage before API call** (`use-ai-generation.ts` lines 1666-1708):
```typescript
// Kling Avatar v2 requires FAL storage URLs (not base64 data URLs)
if (modelId === "kling_avatar_v2_standard" || modelId === "kling_avatar_v2_pro") {
  console.log("  📤 Uploading files to FAL storage for Kling Avatar v2...");

  // Upload image and audio to FAL storage in parallel
  const [characterImageUrl, audioUrl] = await Promise.all([
    uploadImageToFal(avatarImage),
    audioFile ? uploadAudioToFal(audioFile) : Promise.resolve(""),
  ]);

  if (!audioUrl) {
    throw new Error("Audio file is required for Kling Avatar v2");
  }

  response = await generateAvatarVideo({
    model: modelId,
    characterImage: avatarImage,
    audioFile: audioFile || undefined,
    prompt: avatarPrompt,
    audioDuration: audioDuration ?? undefined,
    characterImageUrl,
    audioUrl,
  });
}
```

3. **Updated routing to use FAL storage URLs** (`ai-video-client.ts` lines 3140-3184):
```typescript
} else if (
  request.model === "kling_avatar_v2_standard" ||
  request.model === "kling_avatar_v2_pro"
) {
  // Use pre-uploaded URLs (required for v2 - FAL rejects base64 data URLs)
  if (!request.characterImageUrl) {
    throw new Error("Kling Avatar v2 requires pre-uploaded image URL");
  }
  if (!request.audioUrl) {
    throw new Error("Kling Avatar v2 requires pre-uploaded audio URL");
  }

  payload = {
    ...(modelConfig.default_params || {}),
    image_url: request.characterImageUrl,
    audio_url: request.audioUrl,
    ...(request.prompt && { prompt: request.prompt }),
  };
}
```

**Result**: Files are now uploaded to FAL storage first, and proper HTTPS URLs are sent to the Kling Avatar v2 API.

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
  it("should fail without characterImageUrl for v2 models");
  it("should fail without audioUrl for v2 models");
  it("should include optional prompt when provided");
  it("should properly parse FAL API validation errors");
  it("should use FAL storage URLs instead of data URLs");
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
10. Verify console shows "📤 Uploading files to FAL storage..."
11. Verify video generation completes
12. Verify video plays with synced lip movements
13. Repeat steps 5-12 with "Kling Avatar v2 Pro"
14. Test error cases: audio too short (<2s), too long (>60s), too large (>5MB)

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

**Key Difference**: v1 models use base64 data URLs (inline), v2 models require FAL storage URLs (pre-upload required).

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
- [FAL Storage Upload](https://fal.ai/docs/model-endpoints/uploading-files)
