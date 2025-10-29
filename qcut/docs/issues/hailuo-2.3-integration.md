# Hailuo 2.3 Integration

## Overview
This document describes the integration of MiniMax's Hailuo 2.3 image-to-video models into QCut. Hailuo 2.3 offers three variants optimized for different use cases: Standard (budget-friendly), Fast Pro (balanced), and Pro (premium quality).

## Models

### 1. Hailuo 2.3 Standard
- **Endpoint**: `fal-ai/minimax/hailuo-2.3/standard/image-to-video`
- **Resolution**: 768p
- **Pricing**:
  - 6-second video: $0.28
  - 10-second video: $0.56
- **Use Case**: Budget-friendly image-to-video generation

### 2. Hailuo 2.3 Fast Pro
- **Endpoint**: `fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video`
- **Resolution**: 1080p
- **Pricing**: $0.33 per video
- **Use Case**: Balanced performance and quality with faster generation times

### 3. Hailuo 2.3 Pro
- **Endpoint**: `fal-ai/minimax/hailuo-2.3/pro/image-to-video`
- **Resolution**: 1080p
- **Pricing**: $0.49 per video
- **Use Case**: Premium quality with highest fidelity

## API Parameters

All three models share the same parameter structure:

### Required Parameters
- `prompt` (string, max 2000 characters): Text description of desired video animation
- `image_url` (string): URL of the input image (first frame)

### Optional Parameters
- `prompt_optimizer` (boolean, default: true): Enables automatic prompt enhancement
- `end_image_url` (string): Optional URL for the final frame

## API Response Format

```json
{
  "video": {
    "url": "https://storage.googleapis.com/falserverless/output.mp4"
  }
}
```

## Integration Points

### 1. Model Configuration (`ai-constants.ts`)
Added three new models to the `AI_MODELS` array:
- `hailuo23_standard`
- `hailuo23_fast_pro`
- `hailuo23_pro`

### 2. AI Video Client (`ai-video-client.ts`)
The existing `generateVideoFromImage()` function supports these models without modification:
- Converts image files to base64 data URLs
- Constructs proper API payloads with `prompt` and `image_url`
- Handles FAL API responses with `video.url` extraction

## Usage Example

```typescript
const request: ImageToVideoRequest = {
  image: userUploadedImageFile,
  model: "hailuo23_pro",
  prompt: "The camera follows the mountain biker as they navigate a technical forest trail at high speed",
  duration: 6, // For standard model: 6s or 10s
};

const response = await generateVideoFromImage(request);
console.log("Video URL:", response.video_url);
```

## Technical Notes

### Differences from Hailuo 02
1. **Version Naming**: Hailuo 2.3 uses numeric version (2.3) vs. Hailuo 02's zero-padded naming
2. **Image-to-Video Only**: Hailuo 2.3 models are exclusively image-to-video (no text-to-video endpoint)
3. **Duration Handling**: Standard model supports 6s or 10s; Fast Pro and Pro have fixed pricing regardless of duration
4. **Resolution**: Standard uses 768p, while both Pro variants offer 1080p

### Special Handling Requirements
The models do NOT require special parameter conversion (unlike Sora 2 models). They use the standard FAL API payload structure:

```typescript
{
  prompt: string,
  image_url: string, // Base64 data URL from uploaded image
  prompt_optimizer: boolean (optional),
  end_image_url: string (optional)
}
```

## Testing Checklist

- [ ] Test image upload and base64 conversion
- [ ] Verify prompt character limit enforcement (max 2000 chars)
- [ ] Test Standard model with 6s duration
- [ ] Test Standard model with 10s duration
- [ ] Verify Fast Pro model generation
- [ ] Verify Pro model generation
- [ ] Test prompt optimizer toggle
- [ ] Validate FAL API response parsing
- [ ] Ensure video downloads correctly to timeline
- [ ] Test error handling for invalid images
- [ ] Verify pricing calculations in UI

## References

- [Hailuo 2.3 Pro Model](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/pro/image-to-video)
- [Hailuo 2.3 Fast Pro Model](https://fal.ai/models/fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video)
- [Hailuo 2.3 Standard Model](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/image-to-video)
- [FAL AI API Documentation](https://fal.ai/docs)

## Implementation Date
2025-10-29

## Status
✅ Integrated - All three models added to AI_MODELS configuration
