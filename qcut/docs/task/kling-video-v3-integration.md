# Kling Video v3 Integration Plan

**Status: COMPLETED** (2026-02-06)

## Overview

Add FAL.ai Kling Video v3 models (Pro and Standard tiers) to QCut's AI video generation system:
- **Text-to-Video**: Generate videos from text prompts
- **Image-to-Video**: Animate images into videos with motion

This builds on existing Kling v2.6 integration patterns already in QCut.

## API Reference

### Endpoints Summary

| Model | Endpoint | Pricing (per second) |
|-------|----------|---------------------|
| **Pro T2V** | `fal-ai/kling-video/v3/pro/text-to-video` | $0.224 (audio off), $0.336 (audio on) |
| **Pro I2V** | `fal-ai/kling-video/v3/pro/image-to-video` | $0.224 (audio off), $0.336 (audio on) |
| **Standard T2V** | `fal-ai/kling-video/v3/standard/text-to-video` | $0.168 (audio off), $0.252 (audio on) |
| **Standard I2V** | `fal-ai/kling-video/v3/standard/image-to-video` | $0.168 (audio off), $0.252 (audio on) |

### Pro Tier - Text-to-Video

**Endpoint:** `fal-ai/kling-video/v3/pro/text-to-video`

**Input Parameters:**
```typescript
interface KlingV3ProT2VInput {
  prompt: string;                    // Required - video description
  duration?: number;                 // Default: 5 (seconds)
  generate_audio?: boolean;          // Enable native audio generation
  voice_ids?: string[];              // Custom voice identifiers
  multi_prompt?: string[];           // Additional prompts for sequences
  shot_type?: string;                // Camera movement specifications
  aspect_ratio?: string;             // e.g., "16:9", "9:16", "1:1"
}
```

**Output:**
```typescript
interface KlingV3Output {
  video_url: string;                 // MP4 video file URL
  duration: number;                  // Generated video length
  audio_included: boolean;           // Whether audio was generated
}
```

### Pro Tier - Image-to-Video

**Endpoint:** `fal-ai/kling-video/v3/pro/image-to-video`

**Input Parameters:**
```typescript
interface KlingV3ProI2VInput {
  prompt: string;                    // Required - motion/style description
  start_image_url: string;           // Required - initial frame (jpg, png, webp, gif, avif)
  duration?: number;                 // Default: 12 (seconds)
  generate_audio?: boolean;          // Enable native audio generation
  end_image_url?: string;            // Final frame for transition
  voice_ids?: string[];              // Custom voice selections
  elements?: Array<{                 // Up to 2 custom character/object definitions
    frontal_image_url?: string;
    reference_image_urls?: string[];
    video_url?: string;
  }>;
}
```

### Standard Tier - Text-to-Video

**Endpoint:** `fal-ai/kling-video/v3/standard/text-to-video`

**Input Parameters:**
```typescript
interface KlingV3StandardT2VInput {
  prompt: string;                    // Required - video description
  duration?: number;                 // Default: 5 (3-15 seconds)
  generate_audio?: boolean;          // Enable native audio generation
  voice_ids?: string[];              // Custom voice configuration
  shot_type?: string;                // Camera movement customization
  multi_prompt?: string[];           // Sequential shot descriptions
}
```

### Standard Tier - Image-to-Video

**Endpoint:** `fal-ai/kling-video/v3/standard/image-to-video`

**Input Parameters:**
```typescript
interface KlingV3StandardI2VInput {
  prompt: string;                    // Required - motion description
  start_image_url: string;           // Required - initial frame
  duration?: number;                 // Default: 12 (seconds)
  generate_audio?: boolean;          // Default: true
  end_image_url?: string;            // Final frame for motion guidance
  multi_prompt?: string[];           // Multiple prompts for complex scenes
  aspect_ratio?: string;             // Default: "16:9"
  negative_prompt?: string;          // Elements to avoid
  cfg_scale?: number;                // Prompt adherence intensity
  voice_ids?: string[];              // Custom voice selections
  elements?: Array<{...}>;           // Character/object definitions
}
```

---

## Existing Infrastructure

| Component | Location | Status |
|-----------|----------|--------|
| T2V model config | `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts` | ✅ Ready |
| I2V model config | `apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts` | ✅ Ready |
| T2V generator | `apps/web/src/lib/ai-video/generators/text-to-video.ts` | ✅ Ready |
| I2V generator | `apps/web/src/lib/ai-video/generators/image-to-video.ts` | ✅ Ready |
| Model handlers | `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts` | ✅ Ready |
| FAL request util | `apps/web/src/lib/ai-video/core/fal-request.ts` | ✅ Ready |
| Kling v2.6 Pro | Already integrated | ✅ Reference pattern |

---

## Implementation Tasks

### Task 1: Add T2V Model Configurations

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts`

Add the following model definitions to `T2V_MODELS`:

```typescript
// Kling v3 Pro - Text to Video
kling_v3_pro_t2v: {
  id: "kling_v3_pro_t2v",
  name: "Kling v3 Pro T2V",
  description: "Top-tier text-to-video with cinematic visuals, fluid motion, and native audio generation with multi-shot support",
  price: "0.336",  // per second with audio
  resolution: "1080p",
  max_duration: 15,
  category: "text",
  endpoints: {
    text_to_video: "fal-ai/kling-video/v3/pro/text-to-video"
  },
  default_params: {
    duration: 5,
    generate_audio: true,
  },
  supportedDurations: [5, 10, 15],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportsAudio: true,
  supportsNegativePrompt: false,
},

// Kling v3 Standard - Text to Video
kling_v3_standard_t2v: {
  id: "kling_v3_standard_t2v",
  name: "Kling v3 Standard T2V",
  description: "High-quality text-to-video with cinematic visuals and native audio generation, cost-effective option",
  price: "0.252",  // per second with audio
  resolution: "1080p",
  max_duration: 15,
  category: "text",
  endpoints: {
    text_to_video: "fal-ai/kling-video/v3/standard/text-to-video"
  },
  default_params: {
    duration: 5,
    generate_audio: true,
  },
  supportedDurations: [3, 5, 10, 15],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportsAudio: true,
  supportsNegativePrompt: false,
},
```

**Update `T2V_MODEL_ORDER` array to include new models in priority order.**

---

### Task 2: Add I2V Model Configurations

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts`

Add the following model definitions to `I2V_MODELS`:

```typescript
// Kling v3 Pro - Image to Video
kling_v3_pro_i2v: {
  id: "kling_v3_pro_i2v",
  name: "Kling v3 Pro I2V",
  description: "Professional image-to-video with cinematic visuals, fluid motion, native audio, and custom element support",
  price: "0.336",  // per second with audio
  resolution: "1080p",
  max_duration: 12,
  category: "image",
  endpoints: {
    image_to_video: "fal-ai/kling-video/v3/pro/image-to-video"
  },
  default_params: {
    duration: 5,
    generate_audio: true,
  },
  supportedDurations: [5, 10, 12],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportsAudio: true,
  supportsNegativePrompt: false,
  supportsEndFrame: true,
  supportsElements: true,
},

// Kling v3 Standard - Image to Video
kling_v3_standard_i2v: {
  id: "kling_v3_standard_i2v",
  name: "Kling v3 Standard I2V",
  description: "Quality image-to-video with cinematic motion and native audio, cost-effective option",
  price: "0.252",  // per second with audio
  resolution: "1080p",
  max_duration: 12,
  category: "image",
  endpoints: {
    image_to_video: "fal-ai/kling-video/v3/standard/image-to-video"
  },
  default_params: {
    duration: 5,
    generate_audio: true,
  },
  supportedDurations: [5, 10, 12],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportsAudio: true,
  supportsNegativePrompt: true,
  supportsEndFrame: true,
  supportsCfgScale: true,
  supportsElements: true,
},
```

**Update `I2V_MODEL_ORDER` array to include new models in priority order.**

---

### Task 3: Update Model Type Definitions

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts`

Ensure `T2VModelId` type automatically includes new models via `keyof typeof T2V_MODELS`.

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts`

Ensure `I2VModelId` type automatically includes new models via `keyof typeof I2V_MODELS`.

---

### Task 4: Update Model Capabilities Configuration

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts`

Add to `T2V_MODEL_CAPABILITIES`:

```typescript
kling_v3_pro_t2v: {
  duration: true,
  aspectRatio: true,
  audio: true,
  negativePrompt: false,
  seed: false,
},
kling_v3_standard_t2v: {
  duration: true,
  aspectRatio: true,
  audio: true,
  negativePrompt: false,
  seed: false,
},
```

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts`

Add to `I2V_MODEL_CAPABILITIES`:

```typescript
kling_v3_pro_i2v: {
  duration: true,
  aspectRatio: true,
  audio: true,
  negativePrompt: false,
  endFrame: true,
  cfgScale: false,
},
kling_v3_standard_i2v: {
  duration: true,
  aspectRatio: true,
  audio: true,
  negativePrompt: true,
  endFrame: true,
  cfgScale: true,
},
```

---

### Task 5: Update AI Constants

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

The `AI_MODELS` array should automatically include new models if it derives from the model config objects. Verify this is the case, or add entries manually if needed.

---

### Task 6: Verify Generator Functions

**File:** `apps/web/src/lib/ai-video/generators/text-to-video.ts`

The existing generator should work with Kling v3 models since they follow the standard FAL API pattern. Verify the function handles:
- `generate_audio` parameter
- `aspect_ratio` parameter
- `duration` parameter

**File:** `apps/web/src/lib/ai-video/generators/image-to-video.ts`

Verify the function handles:
- `start_image_url` parameter mapping
- `end_image_url` parameter for end frame support
- `generate_audio` parameter
- `negative_prompt` parameter (Standard tier)
- `cfg_scale` parameter (Standard tier)

If these parameters aren't already handled, add conditional parameter mapping:

```typescript
// In image-to-video.ts generation function
const payload: Record<string, unknown> = {
  ...modelConfig.default_params,
  prompt: request.prompt,
  start_image_url: request.imageUrl,
};

if (request.duration) payload.duration = request.duration;
if (request.generateAudio !== undefined) payload.generate_audio = request.generateAudio;
if (request.endImageUrl) payload.end_image_url = request.endImageUrl;
if (request.negativePrompt) payload.negative_prompt = request.negativePrompt;
if (request.cfgScale) payload.cfg_scale = request.cfgScale;
if (request.aspectRatio) payload.aspect_ratio = request.aspectRatio;
```

---

### Task 7: Update Model Handlers

**File:** `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts`

Verify the routing functions handle the new model IDs. If using a switch statement, add cases:

```typescript
case "kling_v3_pro_t2v":
case "kling_v3_standard_t2v":
  return generateTextToVideo(request);

case "kling_v3_pro_i2v":
case "kling_v3_standard_i2v":
  return generateImageToVideo(request);
```

If using dynamic routing based on model config, no changes may be needed.

---

### Task 8: Add Unit Tests

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/__tests__/kling-v3-models.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { T2V_MODELS, T2V_MODEL_CAPABILITIES } from "../text2video-models-config";
import { I2V_MODELS, I2V_MODEL_CAPABILITIES } from "../image2video-models-config";

describe("Kling v3 Model Configurations", () => {
  describe("Text-to-Video Models", () => {
    it("should have kling_v3_pro_t2v configuration", () => {
      expect(T2V_MODELS.kling_v3_pro_t2v).toBeDefined();
      expect(T2V_MODELS.kling_v3_pro_t2v.endpoints.text_to_video).toBe(
        "fal-ai/kling-video/v3/pro/text-to-video"
      );
    });

    it("should have kling_v3_standard_t2v configuration", () => {
      expect(T2V_MODELS.kling_v3_standard_t2v).toBeDefined();
      expect(T2V_MODELS.kling_v3_standard_t2v.endpoints.text_to_video).toBe(
        "fal-ai/kling-video/v3/standard/text-to-video"
      );
    });

    it("should have correct capabilities for kling_v3_pro_t2v", () => {
      expect(T2V_MODEL_CAPABILITIES.kling_v3_pro_t2v).toEqual({
        duration: true,
        aspectRatio: true,
        audio: true,
        negativePrompt: false,
        seed: false,
      });
    });

    it("should support audio generation", () => {
      expect(T2V_MODELS.kling_v3_pro_t2v.supportsAudio).toBe(true);
      expect(T2V_MODELS.kling_v3_standard_t2v.supportsAudio).toBe(true);
    });
  });

  describe("Image-to-Video Models", () => {
    it("should have kling_v3_pro_i2v configuration", () => {
      expect(I2V_MODELS.kling_v3_pro_i2v).toBeDefined();
      expect(I2V_MODELS.kling_v3_pro_i2v.endpoints.image_to_video).toBe(
        "fal-ai/kling-video/v3/pro/image-to-video"
      );
    });

    it("should have kling_v3_standard_i2v configuration", () => {
      expect(I2V_MODELS.kling_v3_standard_i2v).toBeDefined();
      expect(I2V_MODELS.kling_v3_standard_i2v.endpoints.image_to_video).toBe(
        "fal-ai/kling-video/v3/standard/image-to-video"
      );
    });

    it("should support end frame for I2V models", () => {
      expect(I2V_MODELS.kling_v3_pro_i2v.supportsEndFrame).toBe(true);
      expect(I2V_MODELS.kling_v3_standard_i2v.supportsEndFrame).toBe(true);
    });

    it("should support negative prompt only on standard tier", () => {
      expect(I2V_MODELS.kling_v3_pro_i2v.supportsNegativePrompt).toBe(false);
      expect(I2V_MODELS.kling_v3_standard_i2v.supportsNegativePrompt).toBe(true);
    });
  });
});
```

---

### Task 9: Add Integration Tests

**File:** `apps/web/src/test/e2e/kling-v3-integration.e2e.ts`

```typescript
import { describe, it, expect } from "vitest";
import { T2V_MODELS } from "@/components/editor/media-panel/views/ai/constants/text2video-models-config";
import { I2V_MODELS } from "@/components/editor/media-panel/views/ai/constants/image2video-models-config";

describe("Kling v3 Integration", () => {
  it("should have valid FAL endpoint format for all Kling v3 models", () => {
    const klingV3Models = [
      T2V_MODELS.kling_v3_pro_t2v,
      T2V_MODELS.kling_v3_standard_t2v,
      I2V_MODELS.kling_v3_pro_i2v,
      I2V_MODELS.kling_v3_standard_i2v,
    ];

    for (const model of klingV3Models) {
      const endpoint = model.endpoints.text_to_video || model.endpoints.image_to_video;
      expect(endpoint).toMatch(/^fal-ai\/kling-video\/v3\/(pro|standard)\/(text|image)-to-video$/);
    }
  });

  it("should have consistent pricing structure", () => {
    // Pro tier should be more expensive than Standard
    const proT2VPrice = parseFloat(T2V_MODELS.kling_v3_pro_t2v.price);
    const standardT2VPrice = parseFloat(T2V_MODELS.kling_v3_standard_t2v.price);
    expect(proT2VPrice).toBeGreaterThan(standardT2VPrice);

    const proI2VPrice = parseFloat(I2V_MODELS.kling_v3_pro_i2v.price);
    const standardI2VPrice = parseFloat(I2V_MODELS.kling_v3_standard_i2v.price);
    expect(proI2VPrice).toBeGreaterThan(standardI2VPrice);
  });
});
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts` | Modify | Add 2 T2V model configs + capabilities |
| `apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts` | Modify | Add 2 I2V model configs + capabilities |
| `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts` | Verify | Ensure models are included in AI_MODELS |
| `apps/web/src/lib/ai-video/generators/text-to-video.ts` | Verify/Modify | Ensure audio param support |
| `apps/web/src/lib/ai-video/generators/image-to-video.ts` | Verify/Modify | Ensure all params supported |
| `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts` | Verify/Modify | Ensure routing handles new IDs |
| `apps/web/src/components/editor/media-panel/views/ai/constants/__tests__/kling-v3-models.test.ts` | **Create** | Unit tests for model configs |
| `apps/web/src/test/e2e/kling-v3-integration.e2e.ts` | **Create** | Integration tests |

---

## Implementation Subtasks Summary

| # | Subtask | Status | Files |
|---|---------|--------|-------|
| 1 | Add T2V model configurations | ✅ DONE | `text2video-models-config.ts` |
| 2 | Add I2V model configurations | ✅ DONE | `image2video-models-config.ts` |
| 3 | Update model type definitions | ✅ DONE | Automatic via `keyof typeof` |
| 4 | Update model capabilities | ✅ DONE | `text2video-models-config.ts` |
| 5 | Update AI constants | ✅ DONE | Automatic via `Object.values` |
| 6 | Verify generator functions | ✅ DONE | Generic handlers work |
| 7 | Update model handlers | ✅ DONE | Generic routing works |
| 8 | Add unit tests | ✅ DONE | `__tests__/kling-v3-models.test.ts` (21 tests) |
| 9 | Add integration tests | ✅ DONE | Tests included in unit test file |

**Implementation completed in commit:** `a4d4ea40`

---

## Data Flow Diagram

```text
┌─────────────────────────────────────────────────────────────┐
│                    User Interface                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  AI Panel → Text Tab / Image Tab                     │    │
│  │  Select: "Kling v3 Pro T2V" or "Kling v3 Standard"  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  model-handlers.ts            │
              │  Route to correct generator   │
              └───────────────┬───────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
    ┌───────────────────┐           ┌───────────────────┐
    │  text-to-video.ts │           │  image-to-video.ts│
    │  Build payload    │           │  Build payload    │
    └─────────┬─────────┘           └─────────┬─────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │  fal-request.ts               │
              │  POST to FAL endpoint         │
              │  e.g., fal-ai/kling-video/    │
              │       v3/pro/text-to-video    │
              └───────────────┬───────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  polling.ts                   │
              │  Poll job status until done   │
              └───────────────┬───────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Return video_url             │
              │  Add to media store           │
              └───────────────────────────────┘
```

---

## Verification Checklist

### Manual Testing

1. **Text-to-Video Generation**
   - [ ] Select "Kling v3 Pro T2V" from model dropdown
   - [ ] Enter prompt, set duration to 5s
   - [ ] Enable audio generation
   - [ ] Click Generate → Verify video generates successfully
   - [ ] Repeat for "Kling v3 Standard T2V"

2. **Image-to-Video Generation**
   - [ ] Upload start image
   - [ ] Select "Kling v3 Pro I2V" from model dropdown
   - [ ] Enter motion prompt
   - [ ] Enable audio, set duration
   - [ ] Click Generate → Verify video generates
   - [ ] Repeat for "Kling v3 Standard I2V"

3. **Standard Tier Features**
   - [ ] Verify negative prompt field appears for Standard models
   - [ ] Verify cfg_scale slider appears for Standard I2V

4. **Pricing Display**
   - [ ] Verify correct pricing shown in model info
   - [ ] Pro tier shows $0.336/s (audio on)
   - [ ] Standard tier shows $0.252/s (audio on)

### Automated Tests

```bash
# Run unit tests
bun run test --filter="kling-v3"

# Run integration tests
bun run test:e2e --filter="kling-v3"
```

---

## Cost Estimates

| Model | Duration | Audio | Total Cost |
|-------|----------|-------|------------|
| Pro T2V | 5s | On | $1.68 |
| Pro T2V | 10s | On | $3.36 |
| Pro I2V | 5s | On | $1.68 |
| Pro I2V | 12s | On | $4.03 |
| Standard T2V | 5s | On | $1.26 |
| Standard T2V | 10s | On | $2.52 |
| Standard I2V | 5s | On | $1.26 |
| Standard I2V | 12s | On | $3.02 |

---

## Long-term Maintainability Considerations

### Architecture Alignment

1. **Follow Existing Patterns**
   - New models use same config structure as Kling v2.6
   - Generators reused via endpoint configuration
   - Type safety maintained via `keyof typeof` pattern

2. **Backward Compatibility**
   - Kling v2.6 models remain available
   - Users can choose between v2.6 and v3
   - No breaking changes to existing projects

3. **Extensibility**
   - Easy to add v3.1, v4 in future
   - Capability flags control UI features
   - Pricing stored in config for easy updates

### Future Enhancements (Out of Scope)

| Enhancement | Complexity | Notes |
|-------------|------------|-------|
| Elements/character support UI | High | Needs new upload components |
| Multi-prompt sequences | Medium | Needs timeline-style prompt editor |
| Voice selection UI | Medium | Needs voice library integration |
| End frame upload for I2V | Low | Add optional second upload field |

---

## References

- [FAL.ai Kling v3 Pro T2V](https://fal.ai/models/fal-ai/kling-video/v3/pro/text-to-video)
- [FAL.ai Kling v3 Pro I2V](https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video)
- [FAL.ai Kling v3 Standard T2V](https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video)
- [FAL.ai Kling v3 Standard I2V](https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video)
- Existing Kling v2.6 integration in `text2video-models-config.ts`
