# LTX Video 2.0 Fast - 20 Second Duration Capability Analysis

## Overview
This document analyzes the FAL AI LTX Video 2.0 Fast model's capability to generate 20-second videos and outlines implementation requirements for QCut.

## API Documentation Summary

### Model Endpoint
- **Base URL**: `https://fal.run/fal-ai/ltxv-2`
- **Endpoint**: `/image-to-video/fast`
- **Method**: POST
- **Authentication**: FAL API Key

## ✅ 20-Second Support Confirmed

The LTX Video 2.0 Fast model **DOES support 20-second video generation**, with specific constraints:

### Duration Options
- **Supported Durations**: 6, 8, 10, 12, 14, 16, 18, 20 seconds
- **Default**: 6 seconds
- **Extended Duration Requirement**: Durations longer than 10 seconds (12-20s) require:
  - **Resolution**: Must be 1080p (1920x1080)
  - **Frame Rate**: Must be 25 FPS

## Current Implementation Issues

### 1. Error Message Updates Needed

Current error message in `ai-constants.ts:757`:
```typescript
LTXV2_I2V_INVALID_DURATION:
  "Duration must be between 2-6 seconds for LTX Video 2.0 Fast I2V generation"
```

**This is INCORRECT**. Should be:
```typescript
LTXV2_I2V_INVALID_DURATION:
  "Duration must be 6, 8, 10, 12, 14, 16, 18, or 20 seconds for LTX Video 2.0 Fast"
```

### 2. Resolution Constraints for Extended Durations

Current error message doesn't mention the 1080p requirement for >10 second videos:
```typescript
LTXV2_I2V_INVALID_RESOLUTION:
  "Resolution must be 1080p (1920x1080), 1440p (2560x1440), or 2160p (3840x2160) for LTX Video 2.0 Fast"
```

Should add context-aware validation:
```typescript
LTXV2_I2V_EXTENDED_DURATION_RESOLUTION:
  "Videos longer than 10 seconds require 1080p resolution and 25 FPS for LTX Video 2.0 Fast"
```

## API Parameter Specifications

### Required Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| `image_url` | string | Public URL or base64 data URI of input image |
| `prompt` | string | Text description for video generation |

### Optional Parameters
| Parameter | Type | Options | Default | Notes |
|-----------|------|---------|---------|-------|
| `duration` | integer | 6, 8, 10, 12, 14, 16, 18, 20 | 6 | >10s requires 1080p + 25fps |
| `resolution` | string | "1080p", "1440p", "2160p" | "1080p" | Only 1080p for >10s videos |
| `fps` | integer | 25, 50 | 25 | Must be 25 for >10s videos |
| `aspect_ratio` | string | "16:9" | "16:9" | Currently locked |
| `generate_audio` | boolean | true/false | false | Audio generation option |

## Pricing Structure

| Resolution | Price per Second | 20-Second Video Cost |
|------------|-----------------|---------------------|
| 1080p | $0.04 | $0.80 |
| 1440p | $0.08 | $1.60* |
| 2160p | $0.16 | $3.20* |

*Note: 1440p and 2160p cannot be used for 20-second videos due to API constraints

## Implementation Requirements for QCut

### 1. Update Duration Validation Logic

```typescript
// Current validation (INCORRECT)
const isValidDuration = duration >= 2 && duration <= 6;

// Correct validation
const validDurations = [6, 8, 10, 12, 14, 16, 18, 20];
const isValidDuration = validDurations.includes(duration);

// Extended duration constraint
if (duration > 10) {
  if (resolution !== "1080p" || fps !== 25) {
    throw new Error(ERROR_MESSAGES.LTXV2_I2V_EXTENDED_DURATION_RESOLUTION);
  }
}
```

### 2. Update UI Duration Selector

The UI should offer discrete duration options:
- 6 seconds (default)
- 8 seconds
- 10 seconds
- 12 seconds (requires 1080p + 25fps)
- 14 seconds (requires 1080p + 25fps)
- 16 seconds (requires 1080p + 25fps)
- 18 seconds (requires 1080p + 25fps)
- 20 seconds (requires 1080p + 25fps)

### 3. Add Conditional Resolution/FPS Locking

When user selects duration > 10 seconds:
1. Automatically set resolution to 1080p
2. Automatically set FPS to 25
3. Disable resolution and FPS selectors
4. Show informational message about the requirement

### 4. Update Constants File

```typescript
export const LTXV2_FAST_CONFIG = {
  DURATIONS: [6, 8, 10, 12, 14, 16, 18, 20],
  RESOLUTIONS: {
    STANDARD: ["1080p", "1440p", "2160p"],
    EXTENDED: ["1080p"] // >10s videos
  },
  FPS_OPTIONS: {
    STANDARD: [25, 50],
    EXTENDED: [25] // >10s videos
  },
  EXTENDED_DURATION_THRESHOLD: 10,
  MAX_IMAGE_SIZE_MB: 7,
  SUPPORTED_FORMATS: ["PNG", "JPEG", "WebP", "AVIF", "HEIF"]
};
```

## Sample API Request for 20-Second Video

```javascript
const response = await fal.subscribe("fal-ai/ltxv-2/image-to-video/fast", {
  input: {
    image_url: "https://example.com/image.jpg",
    prompt: "A serene landscape with gentle camera movement",
    duration: 20,        // 20 seconds
    resolution: "1080p", // Required for 20s
    fps: 25,            // Required for 20s
    aspect_ratio: "16:9",
    generate_audio: false
  }
});
```

## Testing Checklist

- [ ] Verify 6, 8, 10 second videos work with all resolutions
- [ ] Verify 12, 14, 16, 18, 20 second videos work with 1080p + 25fps
- [ ] Verify 12+ second videos fail with 1440p or 2160p
- [ ] Verify 12+ second videos fail with 50fps
- [ ] Test UI properly locks resolution/fps for extended durations
- [ ] Verify error messages are clear and accurate
- [ ] Test cost calculations for different duration/resolution combinations

## Conclusion

**LTX Video 2.0 Fast CAN generate 20-second videos**, but the current QCut implementation incorrectly limits duration to 2-6 seconds. The code needs to be updated to:

1. Support the full range of durations (6-20 seconds)
2. Implement the constraint that >10 second videos require 1080p + 25fps
3. Update error messages to reflect actual capabilities
4. Modify UI to support discrete duration options

## References

- [FAL AI LTX Video 2.0 Fast API](https://fal.ai/models/fal-ai/ltxv-2/image-to-video/fast/api)
- Current Implementation: `apps/web/src/components/editor/media-panel/views/ai-constants.ts`