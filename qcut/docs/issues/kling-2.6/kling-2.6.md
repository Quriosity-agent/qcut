# Kling 2.6 Pro Video Generation Integration

## Overview

Kling 2.6 Pro offers two video generation models via FAL API:
- **Text-to-Video**: Generate videos from text prompts
- **Image-to-Video**: Animate images into videos

Both models support native audio generation (Chinese/English).

---

## API Reference

### Text-to-Video

**Model ID**: `fal-ai/kling-video/v2.6/pro/text-to-video`

**Endpoint**: `POST https://fal.run/fal-ai/kling-video/v2.6/pro/text-to-video`

#### Input Parameters

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| `prompt` | string | — | Yes | Text description of desired video content |
| `duration` | enum | `"5"` | No | Video length in seconds: `"5"` or `"10"` |
| `aspect_ratio` | enum | `"16:9"` | No | Frame dimensions: `"16:9"`, `"9:16"`, or `"1:1"` |
| `negative_prompt` | string | `"blur, distort, and low quality"` | No | Content to avoid in generation |
| `cfg_scale` | float | `0.5` | No | Guidance strength (0-1 range) |
| `generate_audio` | boolean | `true` | No | Whether to generate native audio for the video |

#### Output Schema

```json
{
  "video": {
    "file_size": number,
    "file_name": string,
    "content_type": "video/mp4",
    "url": string
  }
}
```

### Image-to-Video

**Model ID**: `fal-ai/kling-video/v2.6/pro/image-to-video`

**Endpoint**: `POST https://fal.run/fal-ai/kling-video/v2.6/pro/image-to-video`

#### Input Parameters

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| `prompt` | string | — | Yes | Motion and action description |
| `image_url` | string | — | Yes | Starting frame image URL |
| `duration` | enum | `"5"` | No | Video length: `"5"` or `"10"` seconds |
| `negative_prompt` | string | `"blur, distort, and low quality"` | No | Quality exclusions |
| `generate_audio` | boolean | `true` | No | Native audio generation (Chinese/English) |

#### Output Schema

```json
{
  "video": {
    "file_size": number,
    "file_name": string,
    "content_type": "video/mp4",
    "url": string
  }
}
```

---

## Pricing

| Audio | Cost per Second |
|-------|-----------------|
| Off | $0.07 |
| On | $0.14 |

---

## Implementation Tasks

### Task 1: Add Model Definitions to AI Constants

**Files to modify:**
- `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Changes:**
1. Add `kling_v26_pro_t2v` entry to `AI_MODELS` array after existing Kling models (~line 604)
2. Add `kling_v26_pro_i2v` entry to `AI_MODELS` array in the image category section (~line 339)

**Text-to-Video model entry:**
```typescript
{
  id: "kling_v26_pro_t2v",
  name: "Kling v2.6 Pro T2V",
  description: "Top-tier text-to-video with cinematic visuals and native audio generation",
  price: "0.35", // 5s @ $0.07/s without audio
  resolution: "1080p",
  max_duration: 10,
  category: "text",
  endpoints: {
    text_to_video: "fal-ai/kling-video/v2.6/pro/text-to-video",
  },
  default_params: {
    duration: 5,
    aspect_ratio: "16:9",
    cfg_scale: 0.5,
    generate_audio: true,
    negative_prompt: "blur, distort, and low quality",
  },
  supportedDurations: [5, 10],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
},
```

**Image-to-Video model entry:**
```typescript
{
  id: "kling_v26_pro_i2v",
  name: "Kling v2.6 Pro I2V",
  description: "Top-tier image-to-video with cinematic visuals and native audio generation",
  price: "0.35", // 5s @ $0.07/s without audio
  resolution: "1080p",
  max_duration: 10,
  category: "image",
  endpoints: {
    image_to_video: "fal-ai/kling-video/v2.6/pro/image-to-video",
  },
  default_params: {
    duration: 5,
    aspect_ratio: "16:9",
    cfg_scale: 0.5,
    generate_audio: true,
    negative_prompt: "blur, distort, and low quality",
  },
  supportedDurations: [5, 10],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
},
```

**Review Checklist:**
- [ ] IDs use underscore format: `kling_v26_pro_t2v`, `kling_v26_pro_i2v` (matches `kling_v2_5_turbo` pattern)
- [ ] Endpoint paths use hyphen format: `v2.6` (not `v26`)
- [ ] Price string `"0.35"` reflects 5s baseline at $0.07/s without audio
- [ ] `category` is `"text"` for T2V and `"image"` for I2V
- [ ] `supportedAspectRatios` limited to `["16:9", "9:16", "1:1"]` (v2.6 has fewer than v2.5)
- [ ] `generate_audio: true` included in `default_params` (new for v2.6)

---

### Task 2: Add Type Definitions for Kling 2.6 Options

**Files to modify:**
- `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`

**Changes:**
Add to `UseAIGenerationProps` interface (~line 216, after existing Kling v2.5 props):

```typescript
// Kling v2.6 Pro options
kling26Duration?: 5 | 10;
kling26AspectRatio?: "16:9" | "9:16" | "1:1";
kling26CfgScale?: number;
kling26GenerateAudio?: boolean;
kling26NegativePrompt?: string;
```

**Existing Kling v2.5 props for reference (lines 216-221):**
```typescript
klingDuration?: 5 | 10;
klingCfgScale?: number;
klingAspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
klingEnhancePrompt?: boolean;
klingNegativePrompt?: string;
```

**Review Checklist:**
- [ ] New props prefixed with `kling26` to avoid conflict with existing `kling` props (v2.5)
- [ ] `kling26AspectRatio` type limited to 3 options (v2.6 only supports 16:9, 9:16, 1:1)
- [ ] `kling26GenerateAudio` is new boolean prop (v2.5 doesn't have audio generation)
- [ ] No `kling26EnhancePrompt` - v2.6 doesn't expose enhance_prompt parameter

---

### Task 3: Add T2V Model Capabilities Configuration

**Files to modify:**
- `qcut/apps/web/src/components/editor/media-panel/views/text2video-models-config.ts`

**Changes:**

1. Add to `T2VModelId` type union (~line 17):
```typescript
| "kling_v26_pro_t2v"
```

2. Add alias in `T2V_MODEL_ID_ALIASES` (~line 32):
```typescript
kling_v26_pro: "kling_v26_pro_t2v",
```

3. Add capability entry in `T2V_MODEL_CAPABILITIES` (~line 225):
```typescript
kling_v26_pro_t2v: {
  supportsAspectRatio: true,
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportsResolution: false,
  supportsDuration: true,
  supportedDurations: [5, 10],
  supportsNegativePrompt: true,
  supportsPromptExpansion: false,
  supportsSeed: false,
  supportsSafetyChecker: false,
  defaultAspectRatio: "16:9",
  defaultDuration: 5,
},
```

**Review Checklist:**
- [ ] Canonical ID is `kling_v26_pro_t2v` in type union
- [ ] Alias maps `kling_v26_pro` → `kling_v26_pro_t2v` for UI shorthand
- [ ] `supportsResolution: false` (v2.6 doesn't expose resolution control)
- [ ] `supportedAspectRatios` has only 3 options (vs v2.5's 5)
- [ ] `supportsPromptExpansion: false` (no enhance_prompt in v2.6)
- [ ] `supportsSeed: false` (v2.6 doesn't expose seed parameter)

---

### Task 4: Implement API Client Handler for Kling 2.6

**Files to modify:**
- `qcut/apps/web/src/lib/ai-video-client.ts`

**Changes:**

1. Add request interface (~line 2188, after `KlingI2VRequest`):
```typescript
interface Kling26I2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 5 | 10;
  cfg_scale?: number;
  aspect_ratio?: "16:9" | "9:16" | "1:1";
  generate_audio?: boolean;
  negative_prompt?: string;
}
```

2. Add generation function (~line 2325, after `generateKlingImageVideo`):
```typescript
export async function generateKling26ImageVideo(
  request: Kling26I2VRequest
): Promise<VideoGenerationResponse> {
  // Implementation following generateKlingImageVideo pattern
  // Key difference: include generate_audio in payload
}
```

3. For T2V, extend `generateVideo` function to handle `kling_v26_pro_t2v` model:
   - Detect model with `modelId.startsWith("kling_v26_")`
   - Build payload with `generate_audio` parameter
   - Route to correct endpoint

**Existing pattern reference (`generateKlingImageVideo` at line 2220):**
- Validates FAL API key
- Validates prompt (max 2500 chars)
- Validates image_url presence
- Gets model config and endpoint
- Builds payload with cfg_scale clamped to 0-1
- Handles FAL API response

**Review Checklist:**
- [ ] `isKling26Model` helper catches both `kling_v26_pro_t2v` and `kling_v26_pro_i2v`
- [ ] Payload includes `generate_audio` boolean (new for v2.6)
- [ ] `cfg_scale` clamped to 0-1 range (same as v2.5)
- [ ] Error handling follows existing pattern in `generateKlingImageVideo`
- [ ] No regression to `generateKlingImageVideo` (v2.5) - use prefix check

---

### Task 5: Add UI Controls for Kling 2.6 Models

**Files to modify:**
- `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Changes:**

1. Add type alias (~line 90, after `KlingAspectRatio`):
```typescript
type Kling26AspectRatio = "16:9" | "9:16" | "1:1";
```

2. Add state variables (~line 349, after existing Kling state):
```typescript
const [kling26Duration, setKling26Duration] = useState<5 | 10>(5);
const [kling26CfgScale, setKling26CfgScale] = useState(0.5);
const [kling26AspectRatio, setKling26AspectRatio] = useState<Kling26AspectRatio>("16:9");
const [kling26GenerateAudio, setKling26GenerateAudio] = useState(true);
const [kling26NegativePrompt, setKling26NegativePrompt] = useState("");
```

3. Add selection check (~line 628, after `klingI2VSelected`):
```typescript
const kling26T2VSelected = selectedModels.includes("kling_v26_pro_t2v");
const kling26I2VSelected = selectedModels.includes("kling_v26_pro_i2v");
const kling26Selected = kling26T2VSelected || kling26I2VSelected;
```

4. Add cost calculation helper:
```typescript
const calculateKling26Cost = (duration: number, generateAudio: boolean): number => {
  const perSecondRate = generateAudio ? 0.14 : 0.07;
  return duration * perSecondRate;
};
const kling26EstimatedCost = calculateKling26Cost(kling26Duration, kling26GenerateAudio);
```

5. Add props to `useAIGeneration` hook call (~line 541):
```typescript
kling26Duration,
kling26CfgScale,
kling26AspectRatio,
kling26GenerateAudio,
kling26NegativePrompt: kling26NegativePrompt.trim() || undefined,
```

6. Add UI controls section (~line 2360, after Kling v2.5 controls):
```tsx
{kling26Selected && (
  <div className="space-y-3 text-left border-t pt-3">
    <Label className="text-sm font-semibold">
      Kling v2.6 Pro Settings
    </Label>
    {/* Duration, Aspect Ratio, CFG Scale, Audio Toggle, Negative Prompt */}
    {/* Follow klingI2VSelected block pattern (lines 2261-2370) */}
  </div>
)}
```

**Existing Kling v2.5 UI reference (lines 2261-2370):**
- Duration selector with price labels
- Aspect ratio dropdown
- CFG scale slider (0-1)
- Enhance prompt toggle
- Negative prompt input
- Estimated cost display

**Review Checklist:**
- [ ] State variables prefixed with `kling26` to avoid conflict
- [ ] Duration options show pricing: "5 seconds ($0.35)" / "10 seconds ($0.70)" (audio off) or "$0.70" / "$1.40" (audio on)
- [ ] Aspect ratio limited to 3 options (not 5 like v2.5)
- [ ] Audio toggle added (new control, not in v2.5)
- [ ] No enhance prompt toggle (v2.6 doesn't support it)
- [ ] Cost calculation updates dynamically based on audio toggle
- [ ] Controls only render when `kling26Selected` is true

---

### Task 6: Add Error Messages for Kling 2.6

**Files to modify:**
- `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Changes:**
Add to `ERROR_MESSAGES` constant (~line 1037):

```typescript
// Kling 2.6 specific errors
KLING26_EMPTY_PROMPT: "Please enter a prompt for Kling 2.6 video generation",
KLING26_INVALID_DURATION: "Duration must be 5 or 10 seconds for Kling 2.6",
KLING26_INVALID_ASPECT_RATIO: "Aspect ratio must be 16:9, 9:16, or 1:1 for Kling 2.6",
KLING26_I2V_MISSING_IMAGE: "Image is required for Kling 2.6 image-to-video generation",
KLING26_PROMPT_TOO_LONG: "Prompt exceeds maximum length of 2,500 characters for Kling 2.6",
```

**Review Checklist:**
- [ ] Keys prefixed with `KLING26_` to avoid collision with future v2.5 error keys
- [ ] Aspect ratio error specifies only 3 valid options
- [ ] Prompt length matches existing Kling limit (2500 chars per `generateKlingImageVideo`)
- [ ] I2V missing image error is model-specific

---

### Task 7: Wire Kling 2.6 Props in Generation Hook

**Files to modify:**
- `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**Changes:**

1. Destructure new props (~line 144, after existing Kling props):
```typescript
kling26Duration = 5,
kling26CfgScale = 0.5,
kling26AspectRatio = "16:9",
kling26GenerateAudio = true,
kling26NegativePrompt,
```

2. Add to dependency array (~line 2207):
```typescript
kling26Duration,
kling26CfgScale,
kling26AspectRatio,
kling26GenerateAudio,
kling26NegativePrompt,
```

3. Add generation branch for Kling 2.6 I2V (~line 1424, follow Kling v2.5 pattern):
```typescript
} else if (modelId === "kling_v26_pro_i2v") {
  response = await generateKling26ImageVideo({
    model: modelId,
    prompt: prompt.trim(),
    image_url: imageUrl,
    duration: kling26Duration,
    cfg_scale: kling26CfgScale,
    aspect_ratio: kling26AspectRatio,
    generate_audio: kling26GenerateAudio,
    negative_prompt: kling26NegativePrompt,
  });
}
```

**Review Checklist:**
- [ ] Default values match `default_params` in model config
- [ ] All 5 props added to dependency array for proper memoization
- [ ] Generation branch uses `generateKling26ImageVideo` (new function from Task 4)
- [ ] `generate_audio` passed through (new param, not in v2.5 call)

---

### Task 8: Add Tests for Kling 2.6 Integration

**Files to create/modify:**
- `qcut/apps/web/src/test/integration/new-video-models.test.ts` (add new describe block)

**Changes:**
Add test suite following existing Kling v2.5 pattern (lines 24-100):

```typescript
describe("Kling v2.6 Pro", () => {
  it("should generate T2V with correct endpoint and parameters", async () => {
    // Test endpoint: kling-video/v2.6/pro/text-to-video
    // Verify: prompt, duration, aspect_ratio, cfg_scale, generate_audio, negative_prompt
  });

  it("should generate I2V with correct endpoint", async () => {
    // Test endpoint: kling-video/v2.6/pro/image-to-video
    // Verify: image_url, prompt, duration, generate_audio
  });

  it("should calculate correct pricing with audio on/off", async () => {
    // Audio off: $0.07/s → 5s = $0.35, 10s = $0.70
    // Audio on:  $0.14/s → 5s = $0.70, 10s = $1.40
  });

  it("should validate aspect ratio options", async () => {
    // Valid: 16:9, 9:16, 1:1
    // Invalid: 4:3, 3:4, 21:9
  });

  it("should include generate_audio in request payload", async () => {
    // Verify payload contains generate_audio boolean
  });
});
```

**Review Checklist:**
- [ ] Tests cover both T2V and I2V endpoints
- [ ] Pricing tests verify both audio on/off scenarios
- [ ] Aspect ratio validation tests only allow 3 options
- [ ] `generate_audio` parameter verified in request payload
- [ ] Mocks follow existing pattern (lines 16-22)
- [ ] No regression to v2.5 tests

---

## Code Examples

### JavaScript/TypeScript

```javascript
import { fal } from "@fal-ai/client";

// Text-to-Video
const t2vResult = await fal.subscribe(
  "fal-ai/kling-video/v2.6/pro/text-to-video",
  {
    input: {
      prompt: "A majestic eagle soaring over mountain peaks at sunset",
      duration: "5",
      aspect_ratio: "16:9",
      generate_audio: true,
      cfg_scale: 0.5,
      negative_prompt: "blur, distort, low quality"
    }
  }
);

// Image-to-Video
const i2vResult = await fal.subscribe(
  "fal-ai/kling-video/v2.6/pro/image-to-video",
  {
    input: {
      prompt: "The subject slowly turns and smiles at the camera",
      image_url: "https://example.com/portrait.png",
      duration: "5",
      generate_audio: true
    }
  }
);
```

---

## Authentication

Set `FAL_KEY` environment variable or configure via client:

```javascript
fal.config({ credentials: "YOUR_FAL_KEY" });
```

In QCut, use `VITE_FAL_API_KEY` environment variable.

---

## File Handling

- Accepts public URLs or Base64 data URIs
- Supports client-side file auto-upload via `@fal-ai/client`
- Image uploads go through existing FAL upload flow in QCut

---

## Key Differences from Kling v2.5

| Feature | Kling v2.5 | Kling v2.6 |
|---------|------------|------------|
| Audio Generation | Not supported | Supported (`generate_audio`) |
| Aspect Ratios | 5 options (16:9, 9:16, 1:1, 4:3, 3:4) | 3 options (16:9, 9:16, 1:1) |
| Enhance Prompt | Supported | Not supported |
| Pricing (no audio) | $0.07/s | $0.07/s |
| Pricing (with audio) | N/A | $0.14/s |
| Endpoint path | `/v2.5-turbo/pro/` | `/v2.6/pro/` |
