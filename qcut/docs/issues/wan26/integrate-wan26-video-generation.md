# WAN v2.6 Video Generation Integration

## Overview

This document outlines the integration plan for WAN v2.6 video generation models into QCut's AI panel.

**Priority:** Long-term maintainability > scalability > performance > short-term gains

**Models to integrate:**
- Text-to-Video: `fal-ai/wan/v2.6/text-to-video`
- Image-to-Video: `fal-ai/wan/v2.6/image-to-video`

---

## API Reference

### Text-to-Video API

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Max 800 characters, supports Chinese/English |
| `aspect_ratio` | enum | No | "16:9" | 16:9, 9:16, 1:1, 4:3, 3:4 |
| `resolution` | enum | No | "1080p" | 720p, 1080p |
| `duration` | enum | No | "5" | 5, 10, 15 seconds |
| `negative_prompt` | string | No | "" | Max 500 characters |
| `enable_prompt_expansion` | boolean | No | true | LLM-based prompt rewriting |
| `multi_shots` | boolean | No | true | Intelligent scene segmentation |
| `seed` | integer | No | null | Random seed |
| `enable_safety_checker` | boolean | No | true | Content safety filtering |
| `audio_url` | string | No | null | Background music (WAV/MP3, 3-30s, max 15MB) |

### Image-to-Video API

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Max 800 characters |
| `image_url` | string | Yes | — | First frame image URL |
| `resolution` | enum | No | "1080p" | 480p, 720p, 1080p |
| `duration` | enum | No | "5" | 5, 10, 15 seconds |
| `negative_prompt` | string | No | "" | Max 500 characters |
| `enable_prompt_expansion` | boolean | No | true | LLM prompt rewriting |
| `multi_shots` | boolean | No | false | Scene segmentation |
| `seed` | integer | No | null | Random seed |
| `enable_safety_checker` | boolean | No | true | Safety filtering |
| `audio_url` | string | No | null | Background music |

### Pricing
- **720p:** $0.10/second
- **1080p:** $0.15/second

| Duration | 720p | 1080p |
|----------|------|-------|
| 5s | $0.50 | $0.75 |
| 10s | $1.00 | $1.50 |
| 15s | $1.50 | $2.25 |

---

## Implementation Subtasks

### Subtask 1: Add Type Definitions (~10 min)
**File:** `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts`

**ADD** after line 58 (after existing type definitions):
```typescript
// WAN v2.6 Types
type WAN26Duration = 5 | 10 | 15;
type WAN26Resolution = "480p" | "720p" | "1080p";
type WAN26T2VResolution = "720p" | "1080p"; // T2V doesn't support 480p
type WAN26AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
```

**ADD** to `ImageToVideoSettings` interface (around line 145):
```typescript
  // WAN v2.6 I2V settings
  wan26Duration: number;
  wan26Resolution: string;
  wan26NegativePrompt: string;
  wan26EnablePromptExpansion: boolean;
  wan26MultiShots: boolean;
  wan26AudioUrl: string | null;
  wan26AudioFile: File | null;
```

**ADD** to `TextToVideoSettings` interface (around line 100):
```typescript
  // WAN v2.6 T2V settings
  wan26T2VDuration: number;
  wan26T2VResolution: string;
  wan26T2VAspectRatio: string;
  wan26T2VNegativePrompt: string;
  wan26T2VEnablePromptExpansion: boolean;
  wan26T2VMultiShots: boolean;
```

---

### Subtask 2: Add Model Constants (~15 min)
**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`

**ADD** after the `wan_25_preview` model definition (around line 107):
```typescript
  // WAN v2.6 Text-to-Video
  {
    id: "wan_26_t2v",
    name: "WAN v2.6 T2V",
    description: "High-quality text-to-video with multi-shot support and audio",
    price: "0.10-0.15/s",
    resolution: "1080p",
    max_duration: 15,
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/wan/v2.6/text-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
      aspect_ratio: "16:9",
      enable_prompt_expansion: true,
      multi_shots: true,
    },
    supportedResolutions: ["720p", "1080p"],
    supportedDurations: [5, 10, 15],
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  },
  // WAN v2.6 Image-to-Video
  {
    id: "wan_26_i2v",
    name: "WAN v2.6 I2V",
    description: "Image-to-video with motion control and multi-shot support",
    price: "0.10-0.15/s",
    resolution: "1080p",
    max_duration: 15,
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/wan/v2.6/image-to-video",
    },
    default_params: {
      duration: 5,
      resolution: "1080p",
      enable_prompt_expansion: true,
      multi_shots: false,
    },
    supportedResolutions: ["480p", "720p", "1080p"],
    supportedDurations: [5, 10, 15],
  },
```

---

### Subtask 3: Add T2V Model Capabilities (~10 min)
**File:** `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts`

**MODIFY** `T2VModelId` type (around line 6) - ADD:
```typescript
  | "wan_26_t2v";
```

**ADD** to `T2V_MODEL_ID_ALIASES` (around line 23):
```typescript
  wan_26: "wan_26_t2v",
  wan26: "wan_26_t2v",
  wan_v26: "wan_26_t2v",
```

**ADD** to `T2V_MODEL_CAPABILITIES` object (after `wan_25_preview` around line 99):
```typescript
    wan_26_t2v: {
      supportsAspectRatio: true,
      supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
      supportsResolution: true,
      supportedResolutions: ["720p", "1080p"],
      supportsDuration: true,
      supportedDurations: [5, 10, 15],
      supportsNegativePrompt: true,
      supportsPromptExpansion: true,
      supportsSeed: true,
      supportsSafetyChecker: true,
      defaultAspectRatio: "16:9",
      defaultResolution: "1080p",
      defaultDuration: 5,
    },
```

---

### Subtask 4: Add Cost Calculator (~10 min)
**File:** `apps/web/src/components/editor/media-panel/views/ai/utils/ai-cost-calculators.ts`

**ADD** at end of file (after `calculateVeo31ExtendCost`):
```typescript
/**
 * Calculate WAN v2.6 cost based on resolution and duration
 * Pricing: $0.10/s for 720p, $0.15/s for 1080p
 * Note: 480p uses same price as 720p (I2V only)
 * @param resolution - 480p, 720p, or 1080p
 * @param duration - Duration in seconds (5, 10, or 15)
 * @returns Estimated cost in dollars
 */
export function calculateWan26Cost(
  resolution: string,
  duration: number
): number {
  const perSecondPricing: Record<string, number> = {
    "480p": 0.10,
    "720p": 0.10,
    "1080p": 0.15,
  };

  const perSecondRate = perSecondPricing[resolution] ?? 0.15;
  return duration * perSecondRate;
}
```

---

### Subtask 5: Add FAL Client Methods (~15 min)
**File:** `apps/web/src/lib/fal-ai-client.ts`

**ADD** type imports at top of file (around line 19):
```typescript
import type {
  Wan26TextToVideoInput,
  Wan26ImageToVideoInput,
  Wan26Response,
} from "@/types/ai-generation";
```

**ADD** methods to `FalAIClient` class (before the closing brace):
```typescript
  /**
   * Generate video from text using WAN v2.6
   */
  async generateWan26TextToVideo(
    input: Wan26TextToVideoInput,
    onProgress?: (progress: number, message?: string) => void
  ): Promise<Wan26Response> {
    const endpoint = "fal-ai/wan/v2.6/text-to-video";

    debugLogger.log(FAL_LOG_COMPONENT, "WAN v2.6 T2V request", {
      prompt: input.prompt.substring(0, 50) + "...",
      resolution: input.resolution,
      duration: input.duration,
      aspect_ratio: input.aspect_ratio,
    });

    try {
      const response = await this.submitAndPoll<Wan26Response>(
        endpoint,
        {
          prompt: input.prompt,
          resolution: input.resolution ?? "1080p",
          duration: String(input.duration ?? 5),
          aspect_ratio: input.aspect_ratio ?? "16:9",
          negative_prompt: input.negative_prompt ?? "",
          enable_prompt_expansion: input.enable_prompt_expansion ?? true,
          multi_shots: input.multi_shots ?? true,
          seed: input.seed,
          enable_safety_checker: input.enable_safety_checker ?? true,
          ...(input.audio_url && { audio_url: input.audio_url }),
        },
        onProgress
      );

      return response;
    } catch (error) {
      handleAIServiceError(error, "WAN v2.6 T2V generation", { endpoint });
      throw error;
    }
  }

  /**
   * Generate video from image using WAN v2.6
   */
  async generateWan26ImageToVideo(
    input: Wan26ImageToVideoInput,
    onProgress?: (progress: number, message?: string) => void
  ): Promise<Wan26Response> {
    const endpoint = "fal-ai/wan/v2.6/image-to-video";

    debugLogger.log(FAL_LOG_COMPONENT, "WAN v2.6 I2V request", {
      prompt: input.prompt.substring(0, 50) + "...",
      resolution: input.resolution,
      duration: input.duration,
      hasImage: !!input.image_url,
    });

    try {
      const response = await this.submitAndPoll<Wan26Response>(
        endpoint,
        {
          prompt: input.prompt,
          image_url: input.image_url,
          resolution: input.resolution ?? "1080p",
          duration: String(input.duration ?? 5),
          negative_prompt: input.negative_prompt ?? "",
          enable_prompt_expansion: input.enable_prompt_expansion ?? true,
          multi_shots: input.multi_shots ?? false,
          seed: input.seed,
          enable_safety_checker: input.enable_safety_checker ?? true,
          ...(input.audio_url && { audio_url: input.audio_url }),
        },
        onProgress
      );

      return response;
    } catch (error) {
      handleAIServiceError(error, "WAN v2.6 I2V generation", { endpoint });
      throw error;
    }
  }
```

---

### Subtask 6: Add Type Definitions for API (~10 min)
**File:** `apps/web/src/types/ai-generation.ts`

**ADD** at end of file:
```typescript
// ============================================
// WAN v2.6 Types
// ============================================

export interface Wan26TextToVideoInput {
  prompt: string;
  aspect_ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  resolution?: "720p" | "1080p";
  duration?: 5 | 10 | 15;
  negative_prompt?: string;
  enable_prompt_expansion?: boolean;
  multi_shots?: boolean;
  seed?: number;
  enable_safety_checker?: boolean;
  audio_url?: string;
}

export interface Wan26ImageToVideoInput {
  prompt: string;
  image_url: string;
  resolution?: "480p" | "720p" | "1080p";
  duration?: 5 | 10 | 15;
  negative_prompt?: string;
  enable_prompt_expansion?: boolean;
  multi_shots?: boolean;
  seed?: number;
  enable_safety_checker?: boolean;
  audio_url?: string;
}

export interface Wan26Response {
  video: {
    url: string;
    content_type: string;
    file_name?: string;
    file_size?: number;
    width: number;
    height: number;
    fps: number;
    duration: number;
    num_frames: number;
  };
  seed: number;
  actual_prompt?: string;
}
```

---

### Subtask 7: Add Generation Handler (~20 min)
**File:** `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts`

**ADD** import at top:
```typescript
import { falAIClient } from "@/lib/fal-ai-client";
```

**ADD** handler function (at end of file before closing):
```typescript
/**
 * Handle WAN v2.6 Text-to-Video generation
 */
export async function handleWan26T2VGeneration(
  context: ModelHandlerContext,
  settings: TextToVideoSettings
): Promise<{ videoUrl: string; seed?: number }> {
  const {
    wan26T2VDuration,
    wan26T2VResolution,
    wan26T2VAspectRatio,
    wan26T2VNegativePrompt,
    wan26T2VEnablePromptExpansion,
    wan26T2VMultiShots,
  } = settings;

  const response = await falAIClient.generateWan26TextToVideo(
    {
      prompt: context.prompt,
      duration: wan26T2VDuration as 5 | 10 | 15,
      resolution: wan26T2VResolution as "720p" | "1080p",
      aspect_ratio: wan26T2VAspectRatio as "16:9" | "9:16" | "1:1" | "4:3" | "3:4",
      negative_prompt: wan26T2VNegativePrompt,
      enable_prompt_expansion: wan26T2VEnablePromptExpansion,
      multi_shots: wan26T2VMultiShots,
    },
    (progress, message) => {
      context.progressCallback(progress, message);
    }
  );

  return {
    videoUrl: response.video.url,
    seed: response.seed,
  };
}

/**
 * Handle WAN v2.6 Image-to-Video generation
 */
export async function handleWan26I2VGeneration(
  context: ModelHandlerContext,
  settings: ImageToVideoSettings,
  imageUrl: string
): Promise<{ videoUrl: string; seed?: number }> {
  const {
    wan26Duration,
    wan26Resolution,
    wan26NegativePrompt,
    wan26EnablePromptExpansion,
    wan26MultiShots,
    wan26AudioUrl,
  } = settings;

  const response = await falAIClient.generateWan26ImageToVideo(
    {
      prompt: context.prompt,
      image_url: imageUrl,
      duration: wan26Duration as 5 | 10 | 15,
      resolution: wan26Resolution as "480p" | "720p" | "1080p",
      negative_prompt: wan26NegativePrompt,
      enable_prompt_expansion: wan26EnablePromptExpansion,
      multi_shots: wan26MultiShots,
      audio_url: wan26AudioUrl ?? undefined,
    },
    (progress, message) => {
      context.progressCallback(progress, message);
    }
  );

  return {
    videoUrl: response.video.url,
    seed: response.seed,
  };
}
```

---

### Subtask 8: Add Unit Tests (~15 min)
**File:** `apps/web/src/components/editor/media-panel/views/ai/__tests__/wan26.test.ts` (NEW FILE)

**CREATE** new file:
```typescript
/**
 * WAN v2.6 Video Generation Tests
 */
import { describe, it, expect } from "vitest";
import { calculateWan26Cost } from "../utils/ai-cost-calculators";

describe("WAN v2.6 Cost Calculator", () => {
  describe("calculateWan26Cost", () => {
    it("should calculate 720p cost correctly", () => {
      expect(calculateWan26Cost("720p", 5)).toBe(0.5);
      expect(calculateWan26Cost("720p", 10)).toBe(1.0);
      expect(calculateWan26Cost("720p", 15)).toBe(1.5);
    });

    it("should calculate 1080p cost correctly", () => {
      expect(calculateWan26Cost("1080p", 5)).toBe(0.75);
      expect(calculateWan26Cost("1080p", 10)).toBe(1.5);
      expect(calculateWan26Cost("1080p", 15)).toBe(2.25);
    });

    it("should calculate 480p cost same as 720p (I2V)", () => {
      expect(calculateWan26Cost("480p", 5)).toBe(0.5);
      expect(calculateWan26Cost("480p", 10)).toBe(1.0);
    });

    it("should default to 1080p pricing for unknown resolution", () => {
      expect(calculateWan26Cost("unknown", 5)).toBe(0.75);
    });
  });
});

describe("WAN v2.6 Model Configuration", () => {
  it("should have correct T2V aspect ratios", () => {
    const expectedAspectRatios = ["16:9", "9:16", "1:1", "4:3", "3:4"];
    // Import and verify T2V_MODEL_CAPABILITIES includes wan_26_t2v
    // with these aspect ratios
    expect(expectedAspectRatios).toHaveLength(5);
  });

  it("should have correct durations", () => {
    const expectedDurations = [5, 10, 15];
    expect(expectedDurations).toContain(5);
    expect(expectedDurations).toContain(10);
    expect(expectedDurations).toContain(15);
  });

  it("should support 480p only for I2V", () => {
    const t2vResolutions = ["720p", "1080p"];
    const i2vResolutions = ["480p", "720p", "1080p"];

    expect(t2vResolutions).not.toContain("480p");
    expect(i2vResolutions).toContain("480p");
  });
});
```

---

## Implementation Checklist

- [x] **Subtask 1:** Add type definitions to model-handlers.ts ✅ COMPLETED
- [x] **Subtask 2:** Add model constants to ai-constants.ts ✅ COMPLETED
- [x] **Subtask 3:** Add T2V capabilities to text2video-models-config.ts ✅ COMPLETED
- [x] **Subtask 4:** Add cost calculator to ai-cost-calculators.ts ✅ COMPLETED
- [x] **Subtask 5:** Add generator functions to ai-video generators ✅ COMPLETED (used existing pattern)
- [x] **Subtask 6:** Add type definitions to ai-types.ts ✅ COMPLETED
- [x] **Subtask 7:** Add generation handlers and routing to model-handlers.ts ✅ COMPLETED
- [x] **Subtask 8:** Wire up use-ai-generation.ts with WAN v2.6 props ✅ COMPLETED
- [ ] **Subtask 9:** Add unit tests (pending)
- [ ] **Subtask 10:** Add UI controls in AI panel (pending)

**Completed:** 2025-12-16

---

## Long-Term Maintainability Considerations

### Code Patterns
- Follow existing naming conventions (e.g., `wan_26_t2v` matches `wan_25_preview`)
- Use typed parameters to prevent runtime errors
- Add JSDoc comments for all public functions
- Keep handlers small and focused on single responsibility

### Testing Strategy
- Unit tests for cost calculations
- Integration tests for API response handling
- Mock FAL API responses for consistent testing

### Future Extensibility
- Model structure supports easy addition of WAN v2.7+ models
- Capability system allows dynamic UI adjustment
- Cost calculator pattern reusable for new pricing models

---

## References

- [WAN v2.6 Text-to-Video API](https://fal.ai/models/wan/v2.6/text-to-video/api)
- [WAN v2.6 Image-to-Video API](https://fal.ai/models/wan/v2.6/image-to-video/api)

---

*Created: 2025-12-16*
*Last Updated: 2025-12-16*
*Status: Backend Implementation Complete - UI Pending*

---

## Implementation Notes (2025-12-16)

### What Was Implemented

1. **Type Definitions** (`model-handlers.ts`):
   - Added `WAN26Duration`, `WAN26Resolution`, `WAN26T2VResolution`, `WAN26AspectRatio` type coercion helpers
   - Added WAN v2.6 settings to `ImageToVideoSettings` and `TextToVideoSettings` interfaces

2. **Model Constants** (`ai-constants.ts`):
   - Added `wan_26_t2v` model definition with T2V endpoint
   - Added `wan_26_i2v` model definition with I2V endpoint
   - Added error messages for WAN v2.6 validation
   - Included `perSecondPricing` and `supportedAspectRatios` for both models

3. **T2V Capabilities** (`text2video-models-config.ts`):
   - Added `wan_26_t2v` to `T2VModelId` type
   - Added `wan_26_t2v` capabilities with aspect ratios, resolutions, durations

4. **Cost Calculator** (`ai-cost-calculators.ts`):
   - Added `calculateWan26Cost()` function with per-second pricing

5. **Validators** (`validators.ts`):
   - Added `validateWAN26Prompt`, `validateWAN26NegativePrompt`
   - Added `validateWAN26Duration`, `validateWAN26Resolution`, `validateWAN26T2VResolution`
   - Added `validateWAN26AspectRatio`, `isWAN26Model`

6. **Generator Functions**:
   - Added `generateWAN26TextVideo()` to `text-to-video.ts`
   - Added `generateWAN26ImageVideo()` to `image-to-video.ts`
   - Exported both from `index.ts`

7. **Request Types** (`ai-types.ts`):
   - Added `WAN26T2VRequest` interface
   - Added `WAN26I2VRequest` interface
   - Added WAN v2.6 props to `UseAIGenerationProps`

8. **Handlers** (`model-handlers.ts`):
   - Added `handleWAN26I2V()` handler for image-to-video
   - Added `handleWAN26T2V()` handler for text-to-video
   - Added routing cases for `wan_26_t2v` and `wan_26_i2v`

9. **Hook Integration** (`use-ai-generation.ts`):
   - Added WAN v2.6 T2V and I2V props with defaults
   - Wired up to T2V and I2V settings objects

### Implementation Approach
- Followed existing WAN 2.5 pattern for consistency
- Used `ai-video` generator pattern (not FalAIClient polling) for long-running jobs
- Added proper validation before API calls
- TypeScript compiles without errors

---

## Review Status (2025-12-16)

Repo scan shows no existing `wan_26*` integration yet. Current WAN support is split between `wan_25_preview` (T2V config/capabilities) and `wan_25_preview_i2v` (I2V UI + handler + generator).

### Subtask 1: Add Type Definitions
- **Status:** Not started.
- **Review:** Adding `WAN26*` coercion types in `model-handlers.ts` matches the existing `WAN25*` pattern, but the plan is missing the companion updates in `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts` and the tab-state hooks (`use-ai-image-tab-state.ts`, potentially `use-ai-text-tab-state.ts`) where the settings are actually stored/typed.
- **Maintainability:** Prefer reusing the existing unified T2V settings (`t2v*` in `use-ai-text-tab-state.ts`) and only introduce new state where WAN v2.6 is truly unique (e.g., `multi_shots`, `audio_url`), rather than adding many `wan26T2V*` fields.

### Subtask 2: Add Model Constants
- **Status:** Not started.
- **Review:** `ai-constants.ts` already contains both `wan_25_preview` (mixed endpoints, no `category`) and `wan_25_preview_i2v` (proper `category: "image"` + `perSecondPricing`). For consistency and UI filtering, ensure `wan_26_t2v` and `wan_26_i2v` both include `category`, `supported*` lists, and (if the UI needs cost display) `perSecondPricing` like WAN 2.5 I2V.
- **Maintainability:** Keep pricing and supported option lists in one place (prefer `AI_MODELS`), and avoid duplicating the same values in separate “capabilities” tables unless they drive different UI behavior.

### Subtask 3: Add T2V Model Capabilities
- **Status:** Not started.
- **Review:** Only add `T2V_MODEL_ID_ALIASES` entries if there is a real ID mismatch; if `AI_MODELS` uses `id: "wan_26_t2v"` then no alias is needed. Also note the current unified param builder in `use-ai-generation.ts` uses `prompt_expansion`, while the WAN v2.6 API expects `enable_prompt_expansion`; you’ll need a mapping step somewhere if you rely on unified params.
- **Maintainability:** If WAN v2.6 needs new toggles (e.g., `multi_shots`), consider extending `T2VModelCapabilities` with explicit fields rather than smuggling them via `Record<string, unknown>`.

### Subtask 4: Add Cost Calculator
- **Status:** Not started.
- **Review:** `calculateWan25Cost` exists but is currently unused in the UI (WAN 2.5 cost is derived from `AI_MODELS[].perSecondPricing`). Before adding `calculateWan26Cost`, decide on a single source of truth (prefer `perSecondPricing` + a shared cost helper).
- **Risk:** The plan assumes 480p pricing equals 720p; that should be confirmed (otherwise omit 480p pricing, or explicitly document the assumption).

### Subtask 5: Add FAL Client Methods
- **Status:** Not started.
- **Review:** The plan references `submitAndPoll`, but `apps/web/src/lib/fal-ai-client.ts` currently uses `makeRequest` and has no polling helper. Also, endpoints must be full URLs or start with `/` (otherwise `baseUrl + endpoint` becomes `https://fal.runfal-ai/...`).
- **Maintainability:** Consider implementing WAN v2.6 via the existing `apps/web/src/lib/ai-video` generator pattern (it already handles long-running FAL jobs + error handling) instead of adding a second, divergent polling pipeline to `FalAIClient`.

### Subtask 6: Add Type Definitions for API
- **Status:** Not started.
- **Review:** Adding WAN v2.6 types to `apps/web/src/types/ai-generation.ts` matches how `FalAIClient` imports Veo/Reve types today, but video-generation request/response types are also centralized in `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts`. Duplicating model types across both files will be hard to maintain.
- **Maintainability:** Pick one “source of truth” for video model request/response typing (prefer the `ai/types/ai-types.ts` side if the implementation lives in `ai-video`).

### Subtask 7: Add Generation Handler
- **Status:** Not started.
- **Review:** The proposed handler code does not match current `model-handlers.ts` conventions:
  - `falAIClient` is already imported (don’t re-add it).
  - `ModelHandlerContext.progressCallback` expects a `ProgressUpdate` object, not `(progress, message)`.
  - Handlers return `ModelHandlerResult` with a `response` (see `handleVeo31*` / `handleWAN25I2V`), not `{ videoUrl, seed }`.
  - I2V should mirror `handleWAN25I2V`: read `settings.selectedImage`, upload via `uploadImageToFal`, and handle `wan26AudioFile` upload via `uploadAudioToFal` if supported.
  - The plan is missing the switch/dispatch wiring that routes `modelId === "wan_26_t2v"` / `modelId === "wan_26_i2v"` to the new handlers.

### Subtask 8: Add Unit Tests
- **Status:** Not started.
- **Review:** The proposed tests contain placeholders that don’t validate real behavior. Follow existing patterns in `apps/web/src/components/editor/media-panel/views/ai/__tests__/extend-video.test.ts`:
  - Assert `AI_MODELS` contains the new model IDs with correct endpoints and supported options.
  - If cost is derived from `perSecondPricing`, test that instead of introducing a new unused calculator.
  - Prefer at least one behavioral test that validates payload normalization/parameter mapping (e.g., prompt expansion key name), not just static arrays.

### Missing From Plan (Recommended)
- Add UI + state work: `use-ai-image-tab-state.ts` (new WAN26 settings), `ai-image-tab.tsx` (controls + cost display), and potentially `use-ai-text-tab-state.ts` if exposing `multi_shots`/`audio_url` for T2V.
- Add validation parity with WAN 2.5 generator (prompt/negative prompt limits) if the API has strict limits.
- Update integration coverage in `apps/web/src/test/integration/new-video-models.test.ts` once models are added.
