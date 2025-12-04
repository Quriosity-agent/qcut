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
1. Add `kling_v26_pro_t2v` model entry to `AI_MODELS` array (text-to-video)
2. Add `kling_v26_pro_i2v` model entry to `AI_MODELS` array (image-to-video)

**Model configuration pattern (follow existing Kling models):**
```typescript
{
  id: "kling_v26_pro_t2v",
  name: "Kling v2.6 Pro T2V",
  description: "Top-tier text-to-video with cinematic visuals and native audio",
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
}
```

**Review Checklist:**
- Confirm both `kling_v26_pro_t2v` and `kling_v26_pro_i2v` entries match the ID/endpoint casing and pricing assumptions (5s baseline at $0.07/s without audio).
- Verify defaults mirror API expectations: duration 5, aspect ratio 16:9, cfg_scale 0.5, generate_audio true, and negative prompt preset.
- Ensure supported durations/ratios arrays include only 5/10 seconds and 16:9/9:16/1:1; no extra ratios or resolution controls.
- Check description/category align with existing Kling models to keep UI grouping consistent.

---

### Task 2: Add Type Definitions for Kling 2.6 Options

**Files to modify:**
- `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`

**Changes:**
1. Add Kling 2.6 specific props to `UseAIGenerationProps` interface:
   - `kling26Duration?: 5 | 10`
   - `kling26AspectRatio?: "16:9" | "9:16" | "1:1"`
   - `kling26CfgScale?: number`
   - `kling26GenerateAudio?: boolean`
   - `kling26NegativePrompt?: string`

**Pattern to follow (existing Kling v2.5):**
```typescript
// Kling v2.5 Turbo Pro I2V options
klingDuration?: 5 | 10;
klingCfgScale?: number;
klingAspectRatio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
```

**Review Checklist:**
- Ensure new Kling 2.6 props are optional, typed narrowly (5|10, 16:9|9:16|1:1), and named consistently with UI bindings.
- Verify no overlap/conflict with Kling v2.5 props (distinct keys) and that cfg_scale uses the same numeric expectations (0-1).
- Check negative prompt and generate_audio defaults are handled upstream so undefined values fall back correctly.

---

### Task 3: Add T2V Model Capabilities Configuration

**Files to modify:**
- `qcut/apps/web/src/components/editor/media-panel/views/text2video-models-config.ts`

**Changes:**
1. Add `"kling_v26_pro_t2v"` to `T2VModelId` type union
2. Add capability entry to `T2V_MODEL_CAPABILITIES` record:

```typescript
kling_v26_pro_t2v: {
  supportsAspectRatio: true,
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportsResolution: false, // Kling 2.6 doesn't expose resolution control
  supportsDuration: true,
  supportedDurations: [5, 10],
  supportsNegativePrompt: true,
  supportsPromptExpansion: false,
  supportsSeed: false,
  supportsSafetyChecker: false,
  defaultAspectRatio: "16:9",
  defaultDuration: 5,
}
```

3. Add alias mapping if needed in `T2V_MODEL_ID_ALIASES`

**Review Checklist:**
- Confirm `T2VModelId` union includes `kling_v26_pro_t2v` and aliases map to it if UI uses shorthand.
- Verify capability flags reflect model limits: aspect ratio on, resolution off, duration on (5/10), seed/safety off.
- Double-check defaults (aspect ratio 16:9, duration 5) match the constants and UI defaults to avoid mismatch warnings.

---

### Task 4: Implement API Client Handler for Kling 2.6

**Files to modify:**
- `qcut/apps/web/src/lib/ai-video-client.ts`

**Changes:**
1. Add model detection function `isKling26Model(modelId: string)`
2. Add parameter conversion function `convertKling26Parameters()`
3. Handle Kling 2.6 specific response format in existing API call flow

**Pattern to follow (existing Kling v2.5 handling in ai-video-client.ts):**
- Check for model ID prefix `kling_v26_`
- Map UI parameters to FAL API expected format
- Handle `generate_audio` boolean for pricing display

**Review Checklist:**
- Ensure `isKling26Model` catches both T2V and I2V IDs and routes through the new parameter conversion.
- Validate request payloads send duration as number/string as required by FAL, include aspect_ratio, cfg_scale, negative_prompt, and generate_audio when set.
- Confirm response handling covers video payload shape and audio flag for pricing UI without breaking other model flows.
- Check no regression for other Kling versions; guard the new logic with prefix checks only.

---

### Task 5: Add UI Controls for Kling 2.6 Models

**Files to modify:**
- `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` (or relevant UI component)

**Changes:**
1. Add duration selector (5s / 10s) when Kling 2.6 model selected
2. Add aspect ratio selector (16:9, 9:16, 1:1)
3. Add audio generation toggle
4. Add negative prompt input field
5. Add cfg_scale slider (0-1 range)

**Pattern to follow:**
- Existing Kling v2.5 UI controls
- Seedance duration/aspect ratio selectors

**Review Checklist:**
- Confirm controls render only when a Kling 2.6 model is selected and default values mirror constants (5s, 16:9, audio on, cfg_scale 0.5).
- Validate duration options restricted to 5/10, aspect ratios to 16:9/9:16/1:1, and cfg_scale slider bounded 0-1.
- Ensure negative prompt input and audio toggle wire into state props added in Task 2 and propagate to submission payloads.
- Check layout parity with Kling v2.5 controls to avoid UX drift (labels/help text, disabled states during run).

---

### Task 6: Add Error Messages for Kling 2.6

**Files to modify:**
- `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Changes:**
Add to `ERROR_MESSAGES` constant:
```typescript
// Kling 2.6 specific errors
KLING26_EMPTY_PROMPT: "Please enter a text prompt for Kling 2.6 video generation",
KLING26_INVALID_DURATION: "Duration must be 5 or 10 seconds for Kling 2.6",
KLING26_INVALID_ASPECT_RATIO: "Aspect ratio must be 16:9, 9:16, or 1:1 for Kling 2.6",
KLING26_I2V_MISSING_IMAGE: "Image is required for Kling 2.6 image-to-video generation",
```

**Review Checklist:**
- Verify keys match those referenced in UI/hook validation for Kling 2.6 and do not collide with v2.5 keys.
- Ensure messages enforce 5/10 duration and 16:9/9:16/1:1 ratios, and cover I2V missing image specifically.
- Confirm new errors surface in the correct panel(s) and fallback behaviors remain unchanged for other models.

---

### Task 7: Add Tests for Kling 2.6 Integration

**Files to create/modify:**
- `qcut/apps/web/src/components/editor/media-panel/views/__tests__/kling-26.test.ts` (new)
- `qcut/apps/web/src/lib/__tests__/ai-video-client.test.ts` (if exists, add Kling 2.6 cases)

**Test coverage:**
1. Model definition validation (ID, endpoints, defaults)
2. Parameter conversion correctness
3. Error handling for invalid inputs
4. T2V capability resolution
5. Pricing calculation with audio on/off

**Review Checklist:**
- Cover both T2V and I2V: model config assertions, capability resolution, and parameter conversion including generate_audio flag.
- Add validation tests for invalid duration/aspect ratios and missing image for I2V to exercise new error messages.
- Mock network calls to keep tests deterministic and ensure Kling 2.6 handling does not regress v2.5 test cases.
- Verify pricing/audio toggle scenarios reflect $0.07 vs $0.14 per second assumptions in expectations.

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
      generate_audio: true
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
