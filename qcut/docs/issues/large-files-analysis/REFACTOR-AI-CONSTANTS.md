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
```text
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
   - **Review:** Keep a single source of truth for model IDs (derive `T2VModelId` from config data), and don't let this file become the next mega-file; split by provider later behind a stable barrel export if it starts creeping back toward 1k+ lines.

2. **Create `image2video-models-config.ts`** (new, mirrors T2V pattern)
   - Add `I2V_MODELS`, `I2V_MODEL_ORDER`, `I2V_MODEL_CAPABILITIES`
   - **Review:** Mirror the T2V structure, but extract shared utilities (ex: `getModelsInOrder({ order, models })`) so T2V/I2V/Avatar don't diverge via copy/paste.

3. **Create `avatar-models-config.ts`** (new, mirrors T2V pattern)
   - Add `AVATAR_MODELS`, `AVATAR_MODEL_ORDER`
   - **Review:** Reuse existing validation/upload constraints (sizes, durations, accepted file types) where possible so UI + validation rules stay consistent across features.

4. **Keep existing `upscale-models.ts`** as-is
   - Already well-structured with endpoint mapping
   - **Review:** Prefer importing/re-exporting from the canonical `lib/upscale-models.ts` and avoid duplicating endpoint maps; watch for circular dependencies if `lib/` ever imports from `ai/constants/`.

5. **Reduce `ai-constants.ts`** to:
   - API config, UI constants, upload constants
   - Error messages (or extract to `error-messages.ts`)
   - Re-exports from model config files
   - **Review:** Treat this file as the stable public facade: minimal logic, stable exports, and prefer explicit re-exports over `export *` if name collisions or import cycles show up.

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

**Review**
- Avoid hand-maintained string unions; derive `*ModelId` from `as const` data (`*_MODELS` keys or an ID list) so adding/removing models is a single edit.
- Keep `ai-types.ts` from becoming a dumping ground; if it grows quickly, consider per-category types colocated with each `*-models-config.ts`.

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

**Review**
- Prefer `const T2V_MODELS = { ... } as const satisfies Record<string, AIModel>` + `export type T2VModelId = keyof typeof T2V_MODELS` to make the config the source of truth and prevent stale ID types.
- Make `T2V_MODEL_ORDER` `as const` and add an invariant (compile-time or runtime) that every `T2V_MODELS` key appears exactly once (prevents silent missing/duplicate models).
- Extract shared helpers (order -> entries, ID -> model lookup) into a tiny utility so every category stays consistent without repetition.

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

**Review**
- Don't redefine `I2VModelId` here if it already lives in `ai-types.ts`; keep one source of truth for IDs to reduce maintenance churn.
- Reuse capability primitives (durations/resolutions/aspect ratios) shared with T2V where possible; only introduce a new interface if I2V genuinely needs different concepts.
- If any IDs have legacy aliases, include an `*_MODEL_ID_ALIASES` map early to keep rename/back-compat decisions localized to the config layer.

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

**Review**
- Keep capability data data-first (const objects) so you can reuse it for UI + validation without duplicating business rules in multiple layers.
- If `supportedEmotions` becomes real, prefer deriving it from an `as const` list (typed union) rather than a free-form `string[]`.

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

**Review**
- If the app has i18n (or will), consider placing these into the existing localization pipeline rather than creating a new constants silo.
- Avoid repeating near-identical strings per model; prefer small formatting helpers for shared patterns (file size limits, aspect ratio constraints) so changes apply everywhere.
- The file-level doc comment is likely unnecessary; keep it lean unless there's genuinely non-obvious context.

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
import { UPSCALE_MODEL_ENDPOINTS as UPSCALE_MODEL_ENDPOINT_MAP, UPSCALE_MODELS } from "@/lib/upscale-models";

// Import model configs (for use in this file and re-export)
import { T2V_MODELS, T2V_MODEL_ORDER, T2V_MODEL_CAPABILITIES } from "./text2video-models-config";
import { I2V_MODELS, I2V_MODEL_ORDER, I2V_MODEL_CAPABILITIES } from "./image2video-models-config";
import { AVATAR_MODELS, AVATAR_MODEL_ORDER, AVATAR_MODEL_CAPABILITIES } from "./avatar-models-config";
import { ERROR_MESSAGES } from "./error-messages";

// Re-export for consumers who need individual model categories
export {
  T2V_MODELS, T2V_MODEL_ORDER, T2V_MODEL_CAPABILITIES,
  I2V_MODELS, I2V_MODEL_ORDER, I2V_MODEL_CAPABILITIES,
  AVATAR_MODELS, AVATAR_MODEL_ORDER, AVATAR_MODEL_CAPABILITIES,
  ERROR_MESSAGES,
  UPSCALE_MODELS,
};

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

**Review**
- Guard env access: exporting a possibly-undefined `FAL_API_KEY` can create late runtime failures; consider an accessor that throws a clear error when a feature is used without configuration.
- Be cautious with `export *` re-exports: they're convenient but can introduce name collisions and circular deps as the module graph grows; explicit exports are more stable long-term.
- For legacy lookups, consider an `AI_MODELS_BY_ID` map (merged records) and build `AI_MODELS` in a stable UI order (from `*_MODEL_ORDER`) rather than relying on `Object.values()` ordering.

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

**Reviewer note:** This overlaps with `## Implementation Steps` above; consider keeping just one (or linking phases -> steps) to avoid drift over time.

### Phase 1: Extract Error Messages
1. Create `error-messages.ts`
2. Update imports in consumers
3. Verify build passes

**Review**
- Keep the export surface stable (same keys/messages) to minimize churn; defer message wording tweaks to a separate change.
- If there's an existing i18n/storybook snapshot flow, use it here; it's a good low-risk first move that should come with fast validation.

### Phase 2: Enhance T2V Config
1. Add `T2V_MODELS` to existing `text2video-models-config.ts`
2. Add `T2V_MODEL_ORDER` array
3. Update `ai-constants.ts` to import

**Review**
- Preserve backwards-compatible exports (`T2V_MODEL_ID_ALIASES`, capability helpers) and make the new additions additive to avoid breaking existing imports.
- Add an invariant that `T2V_MODEL_ORDER` contains all T2V IDs exactly once so future model additions don't silently disappear from UI.

### Phase 3: Create I2V Config
1. Create `image2video-models-config.ts`
2. Extract I2V models from `ai-constants.ts`
3. Add capabilities interface

**Review**
- Minimize copy/paste: reuse shared model/ordering helpers and shared capability primitives from T2V where possible.
- Keep extraction mechanical first (no renames), then do cleanup once everything compiles and UI parity is confirmed.

### Phase 4: Create Avatar Config
1. Create `avatar-models-config.ts`
2. Extract avatar models
3. Add capabilities for required inputs

**Review**
- Align capability flags with existing UI inputs + validators; avoid creating "config truth" that disagrees with actual generator requirements.
- Reuse shared constraint shapes (file sizes, durations) so the same rule doesn't live in multiple places.

### Phase 5: Finalize Main File
1. Remove model definitions from `ai-constants.ts`
2. Add re-exports
3. Create backward-compatible `AI_MODELS` array

**Review**
- Prefer explicit re-exports (or a dedicated `index.ts` barrel) to keep the public API intentional and avoid accidental export churn.
- Keep `AI_MODELS` construction deterministic (stable order) and add a uniqueness check for model IDs to catch collisions early.

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

**Review**
- Add invariants that scale: no duplicate IDs, `*_MODEL_ORDER` covers `*_MODELS` keys (or document intentional omissions), and alias maps don't point to missing IDs.
- Prefer checks based on ID sets over a fixed `AI_MODELS.length` so routine model additions don't look like refactor regressions.

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing imports | Keep all exports in `ai-constants.ts` |
| Model count mismatch | Assert `AI_MODELS.length === 47` (current count) |
| Missing capabilities | Copy capabilities from `text2video-models-config.ts` pattern |
| Type errors | Use `satisfies AIModel` for compile-time validation |

**Review**
- The length assertion is useful during the refactor, but consider replacing it with "expected IDs present + no duplicates" to reduce maintenance churn when models are added/removed.

---

*Document updated: 2025-12-17*
*Aligned with existing codebase patterns for long-term maintainability*
