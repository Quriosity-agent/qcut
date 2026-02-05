# Kling O3 Video Editing Integration Plan

## Overview

Add FAL.ai Kling O3 video editing models (Pro and Standard tiers) to QCut's AI video generation system. This includes:

- **Image-to-Video**: Animate images with camera/motion control
- **Text-to-Video**: Generate videos from text prompts (Pro only)
- **Reference-to-Video**: Multi-element composition with character consistency
- **Video-to-Video Edit**: Edit existing videos via natural language
- **Video-to-Video Reference**: Style transfer and motion preservation

**Total: 9 new models** (5 Pro + 4 Standard)

---

## API Reference

### Endpoints Summary

| Model | Endpoint | Pricing/sec |
|-------|----------|-------------|
| **Pro I2V** | `fal-ai/kling-video/o3/pro/image-to-video` | $0.224 (off) / $0.28 (audio) |
| **Pro T2V** | `fal-ai/kling-video/o3/pro/text-to-video` | $0.224 (off) / $0.28 (audio) |
| **Pro Ref2V** | `fal-ai/kling-video/o3/pro/reference-to-video` | $0.224 (off) / $0.28 (audio) |
| **Pro V2V Edit** | `fal-ai/kling-video/o3/pro/video-to-video/edit` | $0.336 |
| **Pro V2V Ref** | `fal-ai/kling-video/o3/pro/video-to-video/reference` | $0.336 |
| **Standard I2V** | `fal-ai/kling-video/o3/standard/image-to-video` | $0.168 (off) / $0.224 (audio) |
| **Standard Ref2V** | `fal-ai/kling-video/o3/standard/reference-to-video` | $0.084 (off) / $0.112 (audio) |
| **Standard V2V Edit** | `fal-ai/kling-video/o3/standard/video-to-video/edit` | $0.252 |
| **Standard V2V Ref** | `fal-ai/kling-video/o3/standard/video-to-video/reference` | $0.252 |

---

## Detailed API Specifications

### 1. Pro Tier - Image-to-Video

**Endpoint:** `fal-ai/kling-video/o3/pro/image-to-video`

**Use Case:** "The character walks forward slowly, with the camera following from behind."

```typescript
interface KlingO3ProI2VInput {
  image_url: string;              // Required - start frame image
  prompt: string;                 // Required - motion/camera description
  end_image_url?: string;         // Optional - end frame for transitions
  duration?: 3|4|5|6|7|8|9|10|11|12|13|14|15;  // Default: 5
  generate_audio?: boolean;       // Native audio generation
  multi_prompt?: string[];        // Multi-shot prompts
  aspect_ratio?: "16:9"|"9:16"|"1:1";  // Default: 16:9
  negative_prompt?: string;       // Default: "blur, distort, and low quality"
  cfg_scale?: number;             // Default: 0.5
}
```

**Output:**
```typescript
interface KlingO3Output {
  video: {
    url: string;
    file_name: string;
    content_type: "video/mp4";
    file_size: number;
  }
}
```

---

### 2. Pro Tier - Text-to-Video

**Endpoint:** `fal-ai/kling-video/o3/pro/text-to-video`

**Use Case:** "A mecha lands on the ground to save the city, and says 'I'm here', in anime style"

```typescript
interface KlingO3ProT2VInput {
  prompt: string;                 // Required - video description
  duration?: 3|4|5|6|7|8|9|10|11|12|13|14|15;  // Default: 5
  aspect_ratio?: "16:9"|"9:16"|"1:1";
  generate_audio?: boolean;
  voice_ids?: string[];           // Max 2 voices
  multi_prompt?: string[];        // Sequential shots
  shot_type?: "customize";
}
```

---

### 3. Pro Tier - Reference-to-Video

**Endpoint:** `fal-ai/kling-video/o3/pro/reference-to-video`

**Use Case:** "@Element1 and @Element2 enters the scene from two sides. Elephant starts to play with the ball"

```typescript
interface KlingO3ProRef2VInput {
  prompt: string;                 // Required - use @Element# syntax
  start_image_url: string;        // Required - initial frame
  end_image_url?: string;         // Optional - final frame
  image_urls?: string[];          // Style reference images
  elements?: Array<{
    frontal_image_url?: string;   // Primary appearance
    reference_image_urls?: string[];  // Style references
    video_url?: string;           // Motion reference
  }>;
  duration?: number;              // 3-15s
  aspect_ratio?: string;
  generate_audio?: boolean;
}
```

---

### 4. Pro Tier - Video-to-Video Edit

**Endpoint:** `fal-ai/kling-video/o3/pro/video-to-video/edit`

**Use Case:** "Change environment to be fully snow as @Image1. Replace animal with @Element1"

```typescript
interface KlingO3ProV2VEditInput {
  prompt: string;                 // Required - @Video1, @Image#, @Element# refs
  video_url: string;              // Required - source video (mp4, mov, webm)
  image_urls?: string[];          // Reference images for style
  elements?: Array<{
    frontal_image_url: string;
    reference_image_urls?: string[];
  }>;
}
```

---

### 5. Pro Tier - Video-to-Video Reference

**Endpoint:** `fal-ai/kling-video/o3/pro/video-to-video/reference`

**Use Case:** "Integrate @Element1 in the scene. Style video should be following watercolor style of @Image1"

```typescript
interface KlingO3ProV2VRefInput {
  prompt: string;                 // Required - @Video1, @Image#, @Element# refs
  video_url: string;              // Required - reference video
  image_urls?: string[];          // Up to 4 style reference images
  elements?: Array<{
    frontal_image_url?: string;
    reference_image_urls?: string[];
  }>;
  duration?: string;              // Video length
  aspect_ratio?: string;
}
```

---

### 6. Standard Tier - Image-to-Video

**Endpoint:** `fal-ai/kling-video/o3/standard/image-to-video`

**Use Case:** "The character walks forward slowly, with the camera following from behind."

```typescript
interface KlingO3StandardI2VInput {
  prompt: string;                 // Required
  image_url: string;              // Required - start frame
  end_image_url?: string;         // Optional - end frame
  duration?: number;              // Default: 10
  generate_audio?: boolean;       // Default: false
  multi_prompt?: string[];
}
```

---

### 7. Standard Tier - Reference-to-Video

**Endpoint:** `fal-ai/kling-video/o3/standard/reference-to-video`

**Use Case:** "@Element1 and @Element2 is having dinner at this table on @Image1"

```typescript
interface KlingO3StandardRef2VInput {
  prompt: string;                 // Required - @Element#, @Image# syntax
  image_urls?: string[];          // Background/scene images
  start_image_url?: string;       // Initial frame
  end_image_url?: string;         // Final frame
  elements?: Array<{
    frontal_image_url: string;
    reference_image_urls?: string[];
    video_url?: string;
  }>;
  duration?: number;              // Default: 8
  generate_audio?: boolean;
}
```

---

### 8. Standard Tier - Video-to-Video Edit

**Endpoint:** `fal-ai/kling-video/o3/standard/video-to-video/edit`

**Use Case:** "Change the main character to be Popeye from @Element1, dark lighting and rain, 3d character"

```typescript
interface KlingO3StandardV2VEditInput {
  prompt: string;                 // Required - @Element#, @Video1, @Image# refs
  video_url: string;              // Required - source video
  image_urls?: string[];          // Reference images
  elements?: Array<{
    frontal_image_url: string;
    reference_image_urls?: string[];
  }>;
}
```

---

### 9. Standard Tier - Video-to-Video Reference

**Endpoint:** `fal-ai/kling-video/o3/standard/video-to-video/reference`

```typescript
interface KlingO3StandardV2VRefInput {
  prompt: string;                 // Required - @Video1, @Element#, @Image# refs
  video_url: string;              // Required - 3-10s, 720-2160px, max 200MB
  image_urls?: string[];          // Up to 4 style images
  elements?: Array<{...}>;
  keep_audio?: boolean;           // Default: true
  aspect_ratio?: "auto"|"16:9"|"9:16"|"1:1";
  duration?: 3-15;                // Default: 5
  shot_type?: "customize";
}
```

---

## Existing Infrastructure

| Component | Location | Status |
|-----------|----------|--------|
| I2V model config | `apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts` | ✅ Ready |
| T2V model config | `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts` | ✅ Ready |
| Avatar/V2V config | `apps/web/src/components/editor/media-panel/views/ai/constants/avatar-models-config.ts` | ✅ Ready |
| Kling O1 V2V models | Already integrated | ✅ Reference pattern |
| Elements support | Partial (Kling O1) | ⚠️ Needs expansion |
| FAL request util | `apps/web/src/lib/ai-video/core/fal-request.ts` | ✅ Ready |

---

## Implementation Tasks

### Task 1: Add Pro I2V Model Configuration

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts`

```typescript
kling_o3_pro_i2v: {
  id: "kling_o3_pro_i2v",
  name: "Kling O3 Pro I2V",
  description: "Professional image-to-video with cinematic visuals, native audio, and camera control",
  price: "0.28/s",
  resolution: "1080p",
  max_duration: 15,
  category: "image",
  endpoints: {
    image_to_video: "fal-ai/kling-video/o3/pro/image-to-video",
  },
  default_params: {
    duration: 5,
    aspect_ratio: "16:9",
    cfg_scale: 0.5,
    generate_audio: true,
    negative_prompt: "blur, distort, and low quality",
  },
  supportedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportsEndFrame: true,
  supportsNegativePrompt: true,
  supportsCfgScale: true,
  supportsAudio: true,
  supportsMultiPrompt: true,
},
```

---

### Task 2: Add Standard I2V Model Configuration

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts`

```typescript
kling_o3_standard_i2v: {
  id: "kling_o3_standard_i2v",
  name: "Kling O3 Standard I2V",
  description: "Quality image-to-video with extended duration support and native audio",
  price: "0.224/s",
  resolution: "1080p",
  max_duration: 15,
  category: "image",
  endpoints: {
    image_to_video: "fal-ai/kling-video/o3/standard/image-to-video",
  },
  default_params: {
    duration: 10,
    generate_audio: false,
  },
  supportedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  supportsEndFrame: true,
  supportsAudio: true,
  supportsMultiPrompt: true,
},
```

---

### Task 3: Add Pro T2V Model Configuration

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts`

```typescript
kling_o3_pro_t2v: {
  id: "kling_o3_pro_t2v",
  name: "Kling O3 Pro T2V",
  description: "Top-tier text-to-video with cinematic visuals, voice support, and multi-shot capabilities",
  price: "0.28/s",
  resolution: "1080p",
  max_duration: 15,
  category: "text",
  endpoints: {
    text_to_video: "fal-ai/kling-video/o3/pro/text-to-video",
  },
  default_params: {
    duration: 5,
    aspect_ratio: "16:9",
    generate_audio: true,
  },
  supportedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportsAudio: true,
  supportsVoice: true,
  supportsMultiPrompt: true,
},
```

---

### Task 4: Add Reference-to-Video Models (Avatar Config)

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/avatar-models-config.ts`

```typescript
// Pro Reference-to-Video
kling_o3_pro_ref2v: {
  id: "kling_o3_pro_ref2v",
  name: "Kling O3 Pro Ref2V",
  description: "Multi-element video composition with character consistency and style transfer",
  price: "0.28/s",
  resolution: "1080p",
  max_duration: 15,
  category: "avatar",
  requiredInputs: ["referenceImages"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o3/pro/reference-to-video",
  },
  default_params: {
    duration: 5,
    aspect_ratio: "16:9",
    generate_audio: true,
  },
  supportedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportsElements: true,
  maxElements: 2,
  supportsEndFrame: true,
  supportsAudio: true,
},

// Standard Reference-to-Video
kling_o3_standard_ref2v: {
  id: "kling_o3_standard_ref2v",
  name: "Kling O3 Standard Ref2V",
  description: "Multi-element video generation with character consistency - cost-effective option",
  price: "0.112/s",
  resolution: "1080p",
  max_duration: 15,
  category: "avatar",
  requiredInputs: ["referenceImages"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o3/standard/reference-to-video",
  },
  default_params: {
    duration: 8,
    generate_audio: true,
  },
  supportedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  supportsElements: true,
  maxElements: 2,
  supportsEndFrame: true,
  supportsAudio: true,
},
```

---

### Task 5: Add Video-to-Video Edit Models (Avatar Config)

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/avatar-models-config.ts`

```typescript
// Pro V2V Edit
kling_o3_pro_v2v_edit: {
  id: "kling_o3_pro_v2v_edit",
  name: "Kling O3 Pro Video Edit",
  description: "Edit videos via natural language - replace characters, change environments, add elements",
  price: "0.336/s",
  resolution: "1080p",
  max_duration: 10,
  category: "avatar",
  requiredInputs: ["sourceVideo"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o3/pro/video-to-video/edit",
  },
  default_params: {},
  supportsElements: true,
  maxElements: 2,
  supportsImageRefs: true,
  maxImageRefs: 4,
},

// Standard V2V Edit
kling_o3_standard_v2v_edit: {
  id: "kling_o3_standard_v2v_edit",
  name: "Kling O3 Standard Video Edit",
  description: "Edit videos with natural language instructions - cost-effective video editing",
  price: "0.252/s",
  resolution: "1080p",
  max_duration: 10,
  category: "avatar",
  requiredInputs: ["sourceVideo"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o3/standard/video-to-video/edit",
  },
  default_params: {},
  supportsElements: true,
  maxElements: 2,
  supportsImageRefs: true,
},
```

---

### Task 6: Add Video-to-Video Reference Models (Avatar Config)

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/avatar-models-config.ts`

```typescript
// Pro V2V Reference
kling_o3_pro_v2v_reference: {
  id: "kling_o3_pro_v2v_reference",
  name: "Kling O3 Pro V2V Reference",
  description: "Generate new shots from reference video - preserves motion, camera, and cinematic style",
  price: "0.336/s",
  resolution: "1080p",
  max_duration: 15,
  category: "avatar",
  requiredInputs: ["sourceVideo"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o3/pro/video-to-video/reference",
  },
  default_params: {
    duration: 5,
    aspect_ratio: "16:9",
  },
  supportedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportsElements: true,
  maxElements: 2,
  supportsImageRefs: true,
  maxImageRefs: 4,
},

// Standard V2V Reference
kling_o3_standard_v2v_reference: {
  id: "kling_o3_standard_v2v_reference",
  name: "Kling O3 Standard V2V Reference",
  description: "Style transfer and motion preservation from reference video - cost-effective option",
  price: "0.252/s",
  resolution: "1080p",
  max_duration: 15,
  category: "avatar",
  requiredInputs: ["sourceVideo"],
  endpoints: {
    image_to_video: "fal-ai/kling-video/o3/standard/video-to-video/reference",
  },
  default_params: {
    duration: 5,
    aspect_ratio: "auto",
    keep_audio: true,
  },
  supportedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  supportedAspectRatios: ["auto", "16:9", "9:16", "1:1"],
  supportsElements: true,
  maxElements: 2,
  supportsImageRefs: true,
  maxImageRefs: 4,
  supportsKeepAudio: true,
},
```

---

### Task 7: Update Model Order Arrays

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts`

Add to `I2V_MODEL_ORDER`:
```typescript
"kling_o3_pro_i2v",
"kling_o3_standard_i2v",
```

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts`

Add to `T2V_MODEL_ORDER`:
```typescript
"kling_o3_pro_t2v",
```

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/avatar-models-config.ts`

Add to `AVATAR_MODEL_ORDER`:
```typescript
"kling_o3_pro_ref2v",
"kling_o3_standard_ref2v",
"kling_o3_pro_v2v_edit",
"kling_o3_standard_v2v_edit",
"kling_o3_pro_v2v_reference",
"kling_o3_standard_v2v_reference",
```

---

### Task 8: Update Model Capabilities

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts`

Add to `I2V_MODEL_CAPABILITIES`:
```typescript
kling_o3_pro_i2v: {
  duration: true,
  aspectRatio: true,
  audio: true,
  negativePrompt: true,
  endFrame: true,
  cfgScale: true,
},
kling_o3_standard_i2v: {
  duration: true,
  aspectRatio: false,
  audio: true,
  negativePrompt: false,
  endFrame: true,
  cfgScale: false,
},
```

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts`

Add to `T2V_MODEL_CAPABILITIES`:
```typescript
kling_o3_pro_t2v: {
  duration: true,
  aspectRatio: true,
  audio: true,
  negativePrompt: false,
  seed: false,
  voice: true,
  multiPrompt: true,
},
```

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/avatar-models-config.ts`

Add to `AVATAR_MODEL_CAPABILITIES`:
```typescript
kling_o3_pro_ref2v: {
  duration: true,
  aspectRatio: true,
  audio: true,
  elements: true,
  endFrame: true,
},
kling_o3_standard_ref2v: {
  duration: true,
  aspectRatio: false,
  audio: true,
  elements: true,
  endFrame: true,
},
kling_o3_pro_v2v_edit: {
  duration: false,
  elements: true,
  imageRefs: true,
},
kling_o3_standard_v2v_edit: {
  duration: false,
  elements: true,
  imageRefs: true,
},
kling_o3_pro_v2v_reference: {
  duration: true,
  aspectRatio: true,
  elements: true,
  imageRefs: true,
},
kling_o3_standard_v2v_reference: {
  duration: true,
  aspectRatio: true,
  elements: true,
  imageRefs: true,
  keepAudio: true,
},
```

---

### Task 9: Add Elements Interface Types

**File:** `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`

```typescript
interface KlingElement {
  frontal_image_url?: string;
  reference_image_urls?: string[];
  video_url?: string;
}

interface KlingO3VideoRequest extends BaseVideoRequest {
  elements?: KlingElement[];
  image_urls?: string[];
  video_url?: string;
  keep_audio?: boolean;
}
```

---

### Task 10: Update Generator Functions

**File:** `apps/web/src/lib/ai-video/generators/image-to-video.ts`

Ensure the generator handles Kling O3 specific parameters:

```typescript
// Add Kling O3 specific parameter handling
if (modelId.includes("kling_o3")) {
  if (request.elements?.length) {
    payload.elements = request.elements;
  }
  if (request.imageUrls?.length) {
    payload.image_urls = request.imageUrls;
  }
  if (request.endImageUrl) {
    payload.end_image_url = request.endImageUrl;
  }
  if (request.multiPrompt?.length) {
    payload.multi_prompt = request.multiPrompt;
  }
}

// V2V specific handling
if (modelId.includes("v2v") && request.videoUrl) {
  payload.video_url = request.videoUrl;
}
if (request.keepAudio !== undefined) {
  payload.keep_audio = request.keepAudio;
}
```

---

### Task 11: Update Model Handlers

**File:** `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts`

Add routing for new models:

```typescript
// Kling O3 I2V models
case "kling_o3_pro_i2v":
case "kling_o3_standard_i2v":
  return generateImageToVideo(request);

// Kling O3 T2V
case "kling_o3_pro_t2v":
  return generateTextToVideo(request);

// Kling O3 Ref2V and V2V models (avatar category)
case "kling_o3_pro_ref2v":
case "kling_o3_standard_ref2v":
case "kling_o3_pro_v2v_edit":
case "kling_o3_standard_v2v_edit":
case "kling_o3_pro_v2v_reference":
case "kling_o3_standard_v2v_reference":
  return generateAvatarVideo(request);
```

---

### Task 12: Add Unit Tests

**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/__tests__/kling-o3-models.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { T2V_MODELS } from "../text2video-models-config";
import { I2V_MODELS } from "../image2video-models-config";
import { AVATAR_MODELS } from "../avatar-models-config";

describe("Kling O3 Model Configurations", () => {
  describe("Image-to-Video Models", () => {
    it("should have kling_o3_pro_i2v configuration", () => {
      expect(I2V_MODELS.kling_o3_pro_i2v).toBeDefined();
      expect(I2V_MODELS.kling_o3_pro_i2v.endpoints.image_to_video).toBe(
        "fal-ai/kling-video/o3/pro/image-to-video"
      );
    });

    it("should have kling_o3_standard_i2v configuration", () => {
      expect(I2V_MODELS.kling_o3_standard_i2v).toBeDefined();
      expect(I2V_MODELS.kling_o3_standard_i2v.endpoints.image_to_video).toBe(
        "fal-ai/kling-video/o3/standard/image-to-video"
      );
    });

    it("should support extended duration range (3-15s)", () => {
      expect(I2V_MODELS.kling_o3_pro_i2v.supportedDurations).toContain(3);
      expect(I2V_MODELS.kling_o3_pro_i2v.supportedDurations).toContain(15);
    });
  });

  describe("Text-to-Video Models", () => {
    it("should have kling_o3_pro_t2v configuration", () => {
      expect(T2V_MODELS.kling_o3_pro_t2v).toBeDefined();
      expect(T2V_MODELS.kling_o3_pro_t2v.endpoints.text_to_video).toBe(
        "fal-ai/kling-video/o3/pro/text-to-video"
      );
    });

    it("should support voice and multi-prompt", () => {
      expect(T2V_MODELS.kling_o3_pro_t2v.supportsVoice).toBe(true);
      expect(T2V_MODELS.kling_o3_pro_t2v.supportsMultiPrompt).toBe(true);
    });
  });

  describe("Reference-to-Video Models", () => {
    it("should have pro and standard ref2v configurations", () => {
      expect(AVATAR_MODELS.kling_o3_pro_ref2v).toBeDefined();
      expect(AVATAR_MODELS.kling_o3_standard_ref2v).toBeDefined();
    });

    it("should support elements for character consistency", () => {
      expect(AVATAR_MODELS.kling_o3_pro_ref2v.supportsElements).toBe(true);
      expect(AVATAR_MODELS.kling_o3_pro_ref2v.maxElements).toBe(2);
    });
  });

  describe("Video-to-Video Edit Models", () => {
    it("should have pro and standard v2v edit configurations", () => {
      expect(AVATAR_MODELS.kling_o3_pro_v2v_edit).toBeDefined();
      expect(AVATAR_MODELS.kling_o3_standard_v2v_edit).toBeDefined();
    });

    it("should require source video input", () => {
      expect(AVATAR_MODELS.kling_o3_pro_v2v_edit.requiredInputs).toContain("sourceVideo");
    });
  });

  describe("Video-to-Video Reference Models", () => {
    it("should have pro and standard v2v reference configurations", () => {
      expect(AVATAR_MODELS.kling_o3_pro_v2v_reference).toBeDefined();
      expect(AVATAR_MODELS.kling_o3_standard_v2v_reference).toBeDefined();
    });

    it("should support keep_audio on standard tier", () => {
      expect(AVATAR_MODELS.kling_o3_standard_v2v_reference.supportsKeepAudio).toBe(true);
    });
  });

  describe("Pricing Structure", () => {
    it("should have pro tier more expensive than standard", () => {
      const proI2VPrice = parseFloat(I2V_MODELS.kling_o3_pro_i2v.price);
      const stdI2VPrice = parseFloat(I2V_MODELS.kling_o3_standard_i2v.price);
      expect(proI2VPrice).toBeGreaterThan(stdI2VPrice);
    });
  });
});
```

---

### Task 13: Add Integration Tests

**File:** `apps/web/src/test/e2e/kling-o3-integration.e2e.ts`

```typescript
import { describe, it, expect } from "vitest";
import { T2V_MODELS } from "@/components/editor/media-panel/views/ai/constants/text2video-models-config";
import { I2V_MODELS } from "@/components/editor/media-panel/views/ai/constants/image2video-models-config";
import { AVATAR_MODELS } from "@/components/editor/media-panel/views/ai/constants/avatar-models-config";

describe("Kling O3 Integration", () => {
  const klingO3Models = [
    // I2V
    I2V_MODELS.kling_o3_pro_i2v,
    I2V_MODELS.kling_o3_standard_i2v,
    // T2V
    T2V_MODELS.kling_o3_pro_t2v,
    // Avatar/V2V
    AVATAR_MODELS.kling_o3_pro_ref2v,
    AVATAR_MODELS.kling_o3_standard_ref2v,
    AVATAR_MODELS.kling_o3_pro_v2v_edit,
    AVATAR_MODELS.kling_o3_standard_v2v_edit,
    AVATAR_MODELS.kling_o3_pro_v2v_reference,
    AVATAR_MODELS.kling_o3_standard_v2v_reference,
  ];

  it("should have valid FAL endpoint format for all Kling O3 models", () => {
    for (const model of klingO3Models) {
      const endpoint = model.endpoints.text_to_video || model.endpoints.image_to_video;
      expect(endpoint).toMatch(/^fal-ai\/kling-video\/o3\/(pro|standard)\//);
    }
  });

  it("should have all 9 Kling O3 models configured", () => {
    expect(klingO3Models).toHaveLength(9);
  });
});
```

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `apps/web/src/components/editor/media-panel/views/ai/constants/image2video-models-config.ts` | Modify | Add 2 I2V model configs + capabilities |
| `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts` | Modify | Add 1 T2V model config + capabilities |
| `apps/web/src/components/editor/media-panel/views/ai/constants/avatar-models-config.ts` | Modify | Add 6 avatar/V2V model configs + capabilities |
| `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts` | Modify | Add element and V2V interfaces |
| `apps/web/src/lib/ai-video/generators/image-to-video.ts` | Modify | Add O3-specific parameter handling |
| `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts` | Modify | Add routing for 9 new models |
| `apps/web/src/components/editor/media-panel/views/ai/constants/__tests__/kling-o3-models.test.ts` | **Create** | Unit tests |
| `apps/web/src/test/e2e/kling-o3-integration.e2e.ts` | **Create** | Integration tests |

---

## Implementation Subtasks Summary

| # | Subtask | Est. Time | Priority | Files |
|---|---------|-----------|----------|-------|
| 1 | Add Pro I2V model config | 10 min | P0 | 1 modify |
| 2 | Add Standard I2V model config | 10 min | P0 | 1 modify |
| 3 | Add Pro T2V model config | 10 min | P0 | 1 modify |
| 4 | Add Ref2V models (Pro + Standard) | 15 min | P0 | 1 modify |
| 5 | Add V2V Edit models (Pro + Standard) | 15 min | P0 | 1 modify |
| 6 | Add V2V Reference models (Pro + Standard) | 15 min | P0 | 1 modify |
| 7 | Update model order arrays | 10 min | P0 | 3 modify |
| 8 | Update model capabilities | 15 min | P0 | 3 modify |
| 9 | Add element interface types | 10 min | P1 | 1 modify |
| 10 | Update generator functions | 20 min | P0 | 1 modify |
| 11 | Update model handlers | 10 min | P0 | 1 modify |
| 12 | Add unit tests | 25 min | P1 | 1 create |
| 13 | Add integration tests | 15 min | P2 | 1 create |

**Total Estimated Time:** ~3 hours

---

## Data Flow Diagram

```text
┌─────────────────────────────────────────────────────────────┐
│                    User Interface                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  AI Panel → Text / Image / Avatar Tab                │    │
│  │  ┌─────────────────────────────────────────────────┐│    │
│  │  │ Model: "Kling O3 Pro V2V Edit"                  ││    │
│  │  │ Prompt: "Replace animal with @Element1"          ││    │
│  │  │ Video: [Upload]  Elements: [Upload x2]           ││    │
│  │  └─────────────────────────────────────────────────┘│    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  model-handlers.ts            │
              │  Route based on model ID      │
              └───────────────┬───────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    ┌───────────────────┐           ┌───────────────────┐
    │  I2V / T2V        │           │  Avatar Generator │
    │  Generator        │           │  (V2V, Ref2V)     │
    └─────────┬─────────┘           └─────────┬─────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │  Build Payload with:          │
              │  - prompt                     │
              │  - video_url (V2V)           │
              │  - image_url / image_urls     │
              │  - elements[]                 │
              │  - duration, aspect_ratio     │
              └───────────────┬───────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  fal-request.ts               │
              │  POST to FAL endpoint         │
              │  e.g., fal-ai/kling-video/    │
              │       o3/pro/video-to-video/  │
              │       edit                    │
              └───────────────┬───────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  polling.ts → video.url       │
              │  Add to media store           │
              └───────────────────────────────┘
```

---

## Verification Checklist

### Manual Testing

1. **Image-to-Video Generation**
   - [ ] Pro I2V: Upload image, add prompt, generate 5s video
   - [ ] Standard I2V: Upload image, test 10s duration
   - [ ] Test end frame feature (both tiers)

2. **Text-to-Video Generation**
   - [ ] Pro T2V: Generate anime-style video with voice
   - [ ] Test multi-prompt for sequential shots

3. **Reference-to-Video Generation**
   - [ ] Pro Ref2V: Upload 2 character images, use @Element1/@Element2
   - [ ] Standard Ref2V: Test with background image @Image1

4. **Video-to-Video Edit**
   - [ ] Pro V2V Edit: Upload video, replace character with @Element1
   - [ ] Standard V2V Edit: Change lighting, style modifications

5. **Video-to-Video Reference**
   - [ ] Pro V2V Ref: Style transfer with @Image1 watercolor style
   - [ ] Standard V2V Ref: Test keep_audio option

### Automated Tests

```bash
# Run unit tests
bun run test --filter="kling-o3"

# Run integration tests
bun run test:e2e --filter="kling-o3"
```

---

## Cost Estimates

| Model | Duration | Total Cost |
|-------|----------|------------|
| Pro I2V (audio) | 5s | $1.40 |
| Pro T2V (audio) | 5s | $1.40 |
| Pro Ref2V (audio) | 5s | $1.40 |
| Pro V2V Edit | 5s | $1.68 |
| Pro V2V Reference | 5s | $1.68 |
| Standard I2V (audio) | 5s | $1.12 |
| Standard Ref2V (audio) | 5s | $0.56 |
| Standard V2V Edit | 5s | $1.26 |
| Standard V2V Reference | 5s | $1.26 |

---

## Long-term Maintainability Considerations

### Architecture Alignment

1. **Follow Existing Patterns**
   - Kling O1 V2V models already in avatar-models-config.ts
   - Elements support pattern established
   - Standard FAL request flow maintained

2. **Backward Compatibility**
   - Kling O1 models remain available
   - Kling v2.6 models unaffected
   - Gradual migration path for users

3. **Extensibility**
   - Elements interface supports future expansion
   - maxElements/maxImageRefs configurable per model
   - Easy to add O4 when released

### Future Enhancements (Out of Scope)

| Enhancement | Complexity | Notes |
|-------------|------------|-------|
| Elements upload UI | High | Multi-image upload with preview |
| @Element# syntax highlighting | Medium | Prompt editor enhancement |
| V2V timeline integration | High | Source video selection from timeline |
| Batch V2V processing | Medium | Queue multiple edit operations |
| Style library presets | Low | Pre-defined @Image# styles |

---

## References

- [FAL.ai Kling O3 Pro I2V](https://fal.ai/models/fal-ai/kling-video/o3/pro/image-to-video)
- [FAL.ai Kling O3 Pro T2V](https://fal.ai/models/fal-ai/kling-video/o3/pro/text-to-video)
- [FAL.ai Kling O3 Pro Ref2V](https://fal.ai/models/fal-ai/kling-video/o3/pro/reference-to-video)
- [FAL.ai Kling O3 Pro V2V Edit](https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/edit)
- [FAL.ai Kling O3 Pro V2V Ref](https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/reference)
- [FAL.ai Kling O3 Standard I2V](https://fal.ai/models/fal-ai/kling-video/o3/standard/image-to-video)
- [FAL.ai Kling O3 Standard Ref2V](https://fal.ai/models/fal-ai/kling-video/o3/standard/reference-to-video)
- [FAL.ai Kling O3 Standard V2V Edit](https://fal.ai/models/fal-ai/kling-video/o3/standard/video-to-video/edit)
- [FAL.ai Kling O3 Standard V2V Ref](https://fal.ai/models/fal-ai/kling-video/o3/standard/video-to-video/reference)
- Existing Kling O1 V2V integration in `avatar-models-config.ts`
