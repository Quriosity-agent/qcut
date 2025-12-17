# Refactoring Plan: ai-constants.ts

**File**: `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`
**Current Size**: 1,594 lines
**Target Size**: ~300 lines (main file) + modular files
**Priority**: High (largest pending file, configuration-only, low-risk split)

---

## Existing Patterns Analysis

Before splitting, review existing patterns in the codebase for consistency:

### Pattern 1: `text2image-models.ts` (1,417 lines)
```typescript
// Uses Record<string, Model> with typed IDs
export const TEXT2IMAGE_MODELS: Record<string, Text2ImageModel> = { ... };

// Priority order array for UI rendering
export const TEXT2IMAGE_MODEL_ORDER = ["model-a", "model-b"] as const;
export type Text2ImageModelId = (typeof TEXT2IMAGE_MODEL_ORDER)[number];

// Helper functions
export function getModelById(id: string): Text2ImageModel | undefined;
export function getModelsByProvider(provider: string): Text2ImageModel[];
export function getText2ImageModelEntriesInPriorityOrder();

// Category groupings
export const MODEL_CATEGORIES = {
  PHOTOREALISTIC: ["model-a", "model-b"],
  ARTISTIC: ["model-c"],
} as const;
```

### Pattern 2: `upscale-models.ts` (383 lines)
```typescript
// Typed ID with priority order
export const UPSCALE_MODEL_ORDER = ["crystal-upscaler", "seedvr-upscale", "topaz-upscale"] as const;
export type UpscaleModelId = (typeof UPSCALE_MODEL_ORDER)[number];

// Endpoint mapping (separate from model definitions)
export const UPSCALE_MODEL_ENDPOINTS: Record<UpscaleModelId, string> = { ... };

// Record with typed ID key
export const UPSCALE_MODELS: Record<UpscaleModelId, UpscaleModel> = { ... };
```

### Pattern 3: `text2video-models-config.ts` (352 lines)
```typescript
// Capability-based configuration (separate from model definitions)
export type T2VModelId = "sora2_text_to_video" | "wan_26_t2v" | ...;

// ID aliases for backward compatibility
export const T2V_MODEL_ID_ALIASES: Record<string, T2VModelId> = { ... };

// Capabilities per model (UI-driven config)
export const T2V_MODEL_CAPABILITIES: Record<T2VModelId, T2VModelCapabilities> = { ... };

// Helper to compute combined capabilities
export function getCombinedCapabilities(selectedModelIds: T2VModelId[]): T2VModelCapabilities;
```

### Pattern 4: `ai-video/` directory structure
```
ai-video/
├── index.ts              # Barrel file
├── core/                 # Core utilities (fal-request, polling, streaming)
├── generators/           # Generation logic (text-to-video, image-to-video, avatar, upscale)
├── models/               # Model-specific converters (sora2.ts)
└── validation/           # Input validators
```

---

## Recommended Refactoring Strategy

### Option A: Consolidate with Existing Files (Preferred)

Rather than creating new files, **extend existing patterns**:

1. **Merge video model definitions into `text2video-models-config.ts`**
   - Add `T2V_MODELS: Record<T2VModelId, AIModel>`
   - Reuse existing `T2V_MODEL_CAPABILITIES` structure
   - Follows DRY principle

2. **Create `image2video-models-config.ts`** (new, mirrors T2V pattern)
   - Add `I2V_MODELS`, `I2V_MODEL_ORDER`, `I2V_MODEL_CAPABILITIES`

3. **Create `avatar-models-config.ts`** (new, mirrors T2V pattern)
   - Add `AVATAR_MODELS`, `AVATAR_MODEL_ORDER`

4. **Keep existing `upscale-models.ts`** as-is
   - Already well-structured with endpoint mapping

5. **Reduce `ai-constants.ts`** to:
   - API config, UI constants, upload constants
   - Error messages (or extract to `error-messages.ts`)
   - Re-exports from model config files

---

## Proposed File Structure

```
ai/constants/
├── ai-constants.ts              # Main config (~300 lines)
│   ├── FAL_API_KEY, FAL_API_BASE, API_CONFIG
│   ├── UI_CONSTANTS, UPLOAD_CONSTANTS, PROGRESS_CONSTANTS
│   ├── STORAGE_KEYS, STATUS_MESSAGES, DEFAULTS
│   ├── REVE_TEXT_TO_IMAGE_MODEL, REVE_EDIT_MODEL
│   └── Re-exports from model files
│
├── text2video-models-config.ts  # Existing + enhanced (~450 lines)
│   ├── T2V_MODEL_ORDER (typed array)
│   ├── T2V_MODELS: Record<T2VModelId, AIModel>
│   ├── T2V_MODEL_CAPABILITIES (existing)
│   └── Helper functions
│
├── image2video-models-config.ts # New (~500 lines)
│   ├── I2V_MODEL_ORDER (typed array)
│   ├── I2V_MODELS: Record<I2VModelId, AIModel>
│   ├── I2V_MODEL_CAPABILITIES
│   └── Helper functions
│
├── avatar-models-config.ts      # New (~300 lines)
│   ├── AVATAR_MODEL_ORDER (typed array)
│   ├── AVATAR_MODELS: Record<AvatarModelId, AIModel>
│   └── Helper functions
│
├── error-messages.ts            # New (~150 lines)
│   └── ERROR_MESSAGES object
│
└── ai-model-options.ts          # Existing (keep as-is)

lib/
├── upscale-models.ts            # Existing (keep as-is, ~383 lines)
└── text2image-models.ts         # Existing (keep as-is, ~1,417 lines)
```

---

## Implementation Steps

### Step 1: Create Type Definitions

Add typed model IDs to `ai-types.ts`:

```typescript
// Text-to-Video model IDs
export type T2VModelId =
  | "sora2_text_to_video"
  | "sora2_text_to_video_pro"
  | "kling_v26_pro_t2v"
  | "wan_26_t2v"
  | "ltxv2_pro_t2v"
  | "ltxv2_fast_t2v"
  | "veo31_fast_text_to_video"
  | "veo31_text_to_video"
  // ... etc

// Image-to-Video model IDs
export type I2VModelId =
  | "sora2_image_to_video"
  | "sora2_image_to_video_pro"
  | "kling_v26_pro_i2v"
  // ... etc

// Avatar model IDs
export type AvatarModelId =
  | "wan_animate_replace"
  | "kling_avatar_v2_standard"
  | "kling_avatar_v2_pro"
  // ... etc
```

### Step 2: Enhance `text2video-models-config.ts`

Add model definitions alongside existing capabilities:

```typescript
// Existing T2V_MODEL_CAPABILITIES stays as-is

// Add full model definitions
export const T2V_MODELS: Record<T2VModelId, AIModel> = {
  sora2_text_to_video: {
    id: "sora2_text_to_video",
    name: "Sora 2 Text-to-Video",
    description: "OpenAI's state-of-the-art text-to-video generation (720p)",
    price: "0.10/s",
    resolution: "720p",
    max_duration: 12,
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/sora-2/text-to-video",
    },
    default_params: {
      duration: 4,
      resolution: "720p",
      aspect_ratio: "16:9",
    },
  },
  // ... more T2V models
};

// Priority order for UI
export const T2V_MODEL_ORDER: T2VModelId[] = [
  "kling_v26_pro_t2v",  // Best quality first
  "sora2_text_to_video_pro",
  "veo31_text_to_video",
  // ... sorted by quality/price
];

// Helper to get models in order
export function getT2VModelsInOrder(): [T2VModelId, AIModel][] {
  return T2V_MODEL_ORDER.map(id => [id, T2V_MODELS[id]]);
}
```

### Step 3: Create `image2video-models-config.ts`

Follow the same pattern as T2V:

```typescript
import type { AIModel } from "../types/ai-types";

export type I2VModelId =
  | "sora2_image_to_video"
  | "sora2_image_to_video_pro"
  | "kling_v26_pro_i2v"
  | "ltxv2_i2v"
  | "ltxv2_fast_i2v"
  // ... etc

export const I2V_MODEL_ORDER: I2VModelId[] = [
  "kling_v26_pro_i2v",
  "sora2_image_to_video_pro",
  // ... sorted by quality
];

export const I2V_MODELS: Record<I2VModelId, AIModel> = {
  sora2_image_to_video: { ... },
  // ... models extracted from ai-constants.ts
};

export interface I2VModelCapabilities {
  supportsFirstFrame: boolean;
  supportsLastFrame: boolean;
  supportsEndFrame: boolean;
  supportedResolutions: string[];
  supportedDurations: number[];
  // ... specific to I2V models
}

export const I2V_MODEL_CAPABILITIES: Record<I2VModelId, I2VModelCapabilities> = { ... };

export function getI2VModelsInOrder(): [I2VModelId, AIModel][] {
  return I2V_MODEL_ORDER.map(id => [id, I2V_MODELS[id]]);
}
```

### Step 4: Create `avatar-models-config.ts`

```typescript
import type { AIModel } from "../types/ai-types";

export type AvatarModelId =
  | "wan_animate_replace"
  | "kling_avatar_v2_standard"
  | "kling_avatar_v2_pro"
  | "sync_lipsync_react1"
  | "bytedance_omnihuman_v1_5"
  // ... etc

export const AVATAR_MODEL_ORDER: AvatarModelId[] = [ ... ];

export const AVATAR_MODELS: Record<AvatarModelId, AIModel> = { ... };

export interface AvatarModelCapabilities {
  requiresCharacterImage: boolean;
  requiresAudioFile: boolean;
  requiresSourceVideo: boolean;
  supportsEmotion: boolean;
  supportedEmotions?: string[];
  audioConstraints?: { minDurationSec: number; maxDurationSec: number; maxFileSizeBytes: number };
}

export const AVATAR_MODEL_CAPABILITIES: Record<AvatarModelId, AvatarModelCapabilities> = { ... };
```

### Step 5: Create `error-messages.ts`

Extract error messages for maintainability:

```typescript
/**
 * Centralized error messages for AI video generation.
 * Organized by model/feature for easy maintenance.
 */
export const ERROR_MESSAGES = {
  // Common errors
  INVALID_FILE_TYPE: "Please select a valid image file",
  FILE_TOO_LARGE: "Image file too large (max 10MB)",
  NO_MODELS_SELECTED: "Please select at least one AI model",
  EMPTY_PROMPT: "Please enter a prompt for video generation",
  GENERATION_FAILED: "Video generation failed. Please try again.",

  // Veo 3.1 specific
  VEO31_IMAGE_TOO_LARGE: "Image must be under 8MB for Veo 3.1",
  VEO31_INVALID_ASPECT_RATIO: "Veo 3.1 requires 16:9 or 9:16 aspect ratio for images",
  // ... etc
} as const;

export type ErrorMessageKey = keyof typeof ERROR_MESSAGES;
```

### Step 6: Update `ai-constants.ts`

Slim down to essential config and re-exports:

```typescript
/**
 * AI Configuration Constants
 *
 * Main entry point for AI video generation configuration.
 * Model definitions are split into category-specific files for maintainability.
 */
import type { APIConfiguration } from "../types/ai-types";
import { UPSCALE_MODEL_ENDPOINTS as UPSCALE_MODEL_ENDPOINT_MAP } from "@/lib/upscale-models";

// Re-export model configs
export * from "./text2video-models-config";
export * from "./image2video-models-config";
export * from "./avatar-models-config";
export * from "./error-messages";

// FAL API Configuration
export const FAL_API_KEY = import.meta.env.VITE_FAL_API_KEY;
export const FAL_API_BASE = "https://fal.run";
export const UPSCALE_MODEL_ENDPOINTS = UPSCALE_MODEL_ENDPOINT_MAP;

export const API_CONFIG: APIConfiguration = {
  falApiKey: FAL_API_KEY,
  falApiBase: FAL_API_BASE,
  maxRetries: 3,
  timeoutMs: 30_000,
};

// UI Constants (~10 lines)
export const UI_CONSTANTS = { ... } as const;

// Upload Constants (~50 lines)
export const UPLOAD_CONSTANTS = { ... } as const;

// Progress, Storage, Status, Defaults (~50 lines total)
export const PROGRESS_CONSTANTS = { ... } as const;
export const STORAGE_KEYS = { ... } as const;
export const STATUS_MESSAGES = { ... } as const;
export const DEFAULTS = { ... } as const;

// LTX Config (~20 lines)
export const LTXV2_FAST_CONFIG = { ... } as const;

// Reve Model Constants (~50 lines)
export const REVE_TEXT_TO_IMAGE_MODEL = { ... } as const;
export const REVE_EDIT_MODEL = { ... } as const;

// Backward compatibility: Combined AI_MODELS array
import { T2V_MODELS } from "./text2video-models-config";
import { I2V_MODELS } from "./image2video-models-config";
import { AVATAR_MODELS } from "./avatar-models-config";
import { UPSCALE_MODELS } from "@/lib/upscale-models";

export const AI_MODELS: AIModel[] = [
  ...Object.values(T2V_MODELS),
  ...Object.values(I2V_MODELS),
  ...Object.values(AVATAR_MODELS),
  ...Object.values(UPSCALE_MODELS),
];

// Legacy helper (deprecated, use category-specific helpers)
export const MODEL_HELPERS = {
  getModelById: (id: string) => AI_MODELS.find(m => m.id === id),
  // ... other helpers
};
```

---

## Final File Sizes (Estimated)

| File | Lines | Status |
|------|-------|--------|
| `ai-constants.ts` | ~300 | Reduced from 1,594 |
| `text2video-models-config.ts` | ~500 | Enhanced from 352 |
| `image2video-models-config.ts` | ~500 | New |
| `avatar-models-config.ts` | ~300 | New |
| `error-messages.ts` | ~150 | New |
| **Total** | ~1,750 | +156 overhead |

---

## Benefits of This Approach

### 1. Consistency with Existing Patterns
- Follows `upscale-models.ts` and `text2image-models.ts` conventions
- Uses established `Record<ModelId, Model>` pattern
- Maintains type safety with `as const` arrays

### 2. Long-term Maintainability
- Adding new models = add to one focused file
- Capabilities separate from definitions (like `text2video-models-config.ts`)
- Each category file is <500 lines

### 3. Code Reuse
- Existing `T2V_MODEL_CAPABILITIES` stays intact
- `UPSCALE_MODELS` from `lib/upscale-models.ts` integrated via import
- Helper functions shared across categories

### 4. Backward Compatibility
- `AI_MODELS` array still available via computed export
- `MODEL_HELPERS` preserved for existing code
- All current imports continue to work

### 5. Improved Developer Experience
- Find models by category instead of scrolling 1,500 lines
- Type-safe model IDs prevent typos
- IntelliSense works with `Record<ModelId, Model>`

---

## Migration Path

### Phase 1: Extract Error Messages
1. Create `error-messages.ts`
2. Update imports in consumers
3. Verify build passes

### Phase 2: Enhance T2V Config
1. Add `T2V_MODELS` to existing `text2video-models-config.ts`
2. Add `T2V_MODEL_ORDER` array
3. Update `ai-constants.ts` to import

### Phase 3: Create I2V Config
1. Create `image2video-models-config.ts`
2. Extract I2V models from `ai-constants.ts`
3. Add capabilities interface

### Phase 4: Create Avatar Config
1. Create `avatar-models-config.ts`
2. Extract avatar models
3. Add capabilities for required inputs

### Phase 5: Finalize Main File
1. Remove model definitions from `ai-constants.ts`
2. Add re-exports
3. Create backward-compatible `AI_MODELS` array

---

## Validation Checklist

- [ ] All model IDs preserved exactly
- [ ] Endpoint paths unchanged
- [ ] Default params unchanged
- [ ] TypeScript compiles (`bun run check-types`)
- [ ] Lint passes (`bun lint:clean`)
- [ ] Tests pass (`bun run test`)
- [ ] UI shows all models correctly
- [ ] Generation works for each category

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing imports | Keep all exports in `ai-constants.ts` |
| Model count mismatch | Assert `AI_MODELS.length === 47` (current count) |
| Missing capabilities | Copy capabilities from `text2video-models-config.ts` pattern |
| Type errors | Use `satisfies AIModel` for compile-time validation |

---

*Document updated: 2025-12-17*
*Aligned with existing codebase patterns for long-term maintainability*
