# Refactoring Plan: ai-constants.ts

**File**: `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`
**Current Size**: 1,594 lines
**Target Size**: ~300 lines (main file) + 4 module files
**Priority**: High (largest pending file, configuration-only, low-risk split)

---

## Current Structure Analysis

| Section | Lines | Location | Description |
|---------|-------|----------|-------------|
| FAL API Config | ~30 | 1-28 | API base URL, keys, config |
| **AI_MODELS array** | **~1,130** | 30-1161 | **Bulk of file - 40+ model definitions** |
| UI Constants | ~10 | 1163-1170 | Max chars, sizes, timeouts |
| Upload Constants | ~50 | 1172-1219 | File type/size constraints |
| Progress Constants | ~10 | 1221-1227 | Progress percentages |
| Storage Keys | ~10 | 1229-1234 | localStorage keys |
| Error Messages | ~150 | 1236-1383 | All error strings |
| LTX Config | ~20 | 1385-1404 | LTX-specific settings |
| Status Messages | ~10 | 1406-1414 | Status strings |
| Defaults | ~15 | 1416-1426 | Default values |
| Model Helpers | ~85 | 1428-1510 | Helper functions |
| Reve Constants | ~55 | 1512-1566 | Reve model config |
| Exports | ~30 | 1568-1594 | Re-exports |

**Key Finding**: The `AI_MODELS` array (1,130 lines) represents 71% of the file.

---

## AI_MODELS Breakdown by Category

| Category | Model Count | Lines | Examples |
|----------|-------------|-------|----------|
| Text-to-Video | 16 | ~450 | Sora 2 T2V, Kling, WAN, LTX, Veo 3.1, Hailuo |
| Image-to-Video | 18 | ~500 | Sora 2 I2V, Kling I2V, Seedance, Veo 3.1 I2V |
| Avatar | 12 | ~250 | WAN Animate, Kling Avatar, Sync Lipsync, OmniHuman |
| Upscale | 3 | ~80 | ByteDance, FlashVSR, Topaz |

---

## Proposed File Structure

```
ai/constants/
├── ai-constants.ts          # Main exports (~300 lines)
├── models/
│   ├── index.ts             # Barrel file
│   ├── text-to-video.ts     # T2V models (~450 lines)
│   ├── image-to-video.ts    # I2V models (~500 lines)
│   ├── avatar.ts            # Avatar models (~250 lines)
│   └── upscale.ts           # Upscale models (~80 lines)
└── error-messages.ts        # Error constants (~150 lines)
```

---

## Implementation Steps

### Step 1: Create `models/text-to-video.ts`

Extract these models from `AI_MODELS`:
- `sora2_text_to_video`
- `sora2_text_to_video_pro`
- `kling_v26_pro_t2v`
- `wan_25_preview` (T2V endpoint)
- `wan_26_t2v`
- `ltxv2_pro_t2v`
- `ltxv2_fast_t2v`
- `veo31_fast_text_to_video`
- `veo31_text_to_video`
- `hailuo23_standard_t2v`
- `hailuo23_pro_t2v`
- `seedance`
- `seedance_pro`
- `kling_v2_5_turbo`
- `veo3_fast`
- `veo3`
- `wan_turbo`
- `hailuo`
- `hailuo_pro`
- `kling_v2`

```typescript
// models/text-to-video.ts
import type { AIModel } from "../../types/ai-types";

export const TEXT_TO_VIDEO_MODELS: AIModel[] = [
  // ... extracted models
];
```

### Step 2: Create `models/image-to-video.ts`

Extract these models:
- `sora2_image_to_video`
- `sora2_image_to_video_pro`
- `kling_v26_pro_i2v`
- `ltxv2_i2v`
- `ltxv2_fast_i2v`
- `seedance_pro_fast_i2v`
- `seedance_pro_i2v`
- `kling_v2_5_turbo_i2v`
- `wan_25_preview_i2v`
- `wan_26_i2v`
- `veo31_fast_image_to_video`
- `veo31_fast_frame_to_video`
- `veo31_image_to_video`
- `veo31_frame_to_video`
- `hailuo23_standard`
- `hailuo23_fast_pro`
- `hailuo23_pro`
- `vidu_q2_turbo_i2v`
- `kling_o1_i2v`

```typescript
// models/image-to-video.ts
import type { AIModel } from "../../types/ai-types";

export const IMAGE_TO_VIDEO_MODELS: AIModel[] = [
  // ... extracted models
];
```

### Step 3: Create `models/avatar.ts`

Extract these models:
- `wan_animate_replace`
- `kling_avatar_v2_standard`
- `kling_avatar_v2_pro`
- `sync_lipsync_react1`
- `kling_o1_v2v_reference`
- `kling_o1_v2v_edit`
- `kling_o1_ref2video`
- `bytedance_omnihuman_v1_5`
- `veo31_fast_extend_video`
- `veo31_extend_video`
- `kling_avatar_pro`
- `kling_avatar_standard`
- `sora2_video_to_video_remix`

```typescript
// models/avatar.ts
import type { AIModel } from "../../types/ai-types";

export const AVATAR_MODELS: AIModel[] = [
  // ... extracted models
];
```

### Step 4: Create `models/upscale.ts`

Extract these models:
- `bytedance_video_upscaler`
- `flashvsr_video_upscaler`
- `topaz_video_upscale`

```typescript
// models/upscale.ts
import type { AIModel } from "../../types/ai-types";

export const UPSCALE_MODELS: AIModel[] = [
  // ... extracted models
];
```

### Step 5: Create `models/index.ts`

```typescript
// models/index.ts
export { TEXT_TO_VIDEO_MODELS } from "./text-to-video";
export { IMAGE_TO_VIDEO_MODELS } from "./image-to-video";
export { AVATAR_MODELS } from "./avatar";
export { UPSCALE_MODELS } from "./upscale";

import { TEXT_TO_VIDEO_MODELS } from "./text-to-video";
import { IMAGE_TO_VIDEO_MODELS } from "./image-to-video";
import { AVATAR_MODELS } from "./avatar";
import { UPSCALE_MODELS } from "./upscale";

// Combined array for backward compatibility
export const AI_MODELS = [
  ...TEXT_TO_VIDEO_MODELS,
  ...IMAGE_TO_VIDEO_MODELS,
  ...AVATAR_MODELS,
  ...UPSCALE_MODELS,
];
```

### Step 6: Create `error-messages.ts`

Extract `ERROR_MESSAGES` object (~150 lines):

```typescript
// error-messages.ts
export const ERROR_MESSAGES = {
  // ... all error messages
} as const;
```

### Step 7: Update `ai-constants.ts`

```typescript
// ai-constants.ts (~300 lines)
import type { APIConfiguration } from "../types/ai-types";
import { UPSCALE_MODEL_ENDPOINTS as UPSCALE_MODEL_ENDPOINT_MAP } from "@/lib/upscale-models";

// Re-export models
export { AI_MODELS, TEXT_TO_VIDEO_MODELS, IMAGE_TO_VIDEO_MODELS, AVATAR_MODELS, UPSCALE_MODELS } from "./models";
export { ERROR_MESSAGES } from "./error-messages";

// FAL API Configuration
export const FAL_API_KEY = import.meta.env.VITE_FAL_API_KEY;
export const FAL_API_BASE = "https://fal.run";
export const UPSCALE_MODEL_ENDPOINTS = UPSCALE_MODEL_ENDPOINT_MAP;

export const API_CONFIG: APIConfiguration = { ... };

// UI, Upload, Progress, Storage, Status constants (keep inline - small)
export const UI_CONSTANTS = { ... };
export const UPLOAD_CONSTANTS = { ... };
export const PROGRESS_CONSTANTS = { ... };
export const STORAGE_KEYS = { ... };
export const LTXV2_FAST_CONFIG = { ... };
export const STATUS_MESSAGES = { ... };
export const DEFAULTS = { ... };
export const MODEL_HELPERS = { ... };
export const REVE_TEXT_TO_IMAGE_MODEL = { ... };
export const REVE_EDIT_MODEL = { ... };

// Main config export
export const AI_CONFIG = { ... };
export default AI_CONFIG;
```

---

## Final File Sizes (Estimated)

| File | Lines | Change |
|------|-------|--------|
| `ai-constants.ts` | ~300 | -1,294 |
| `models/text-to-video.ts` | ~450 | New |
| `models/image-to-video.ts` | ~500 | New |
| `models/avatar.ts` | ~250 | New |
| `models/upscale.ts` | ~80 | New |
| `models/index.ts` | ~25 | New |
| `error-messages.ts` | ~150 | New |
| **Total** | ~1,755 | +161 (overhead) |

---

## Benefits

1. **Maintainability**: Each model category is isolated
2. **Code Reviews**: Smaller, focused diffs
3. **Team Collaboration**: Multiple developers can work on different categories
4. **Testing**: Easier to test individual model categories
5. **Discovery**: Clearer file names indicate content

---

## Backward Compatibility

- `AI_MODELS` array remains available via re-export
- All existing imports continue to work
- No breaking changes to consumers

---

## Validation Checklist

- [ ] All imports resolve correctly
- [ ] `AI_MODELS` contains same models in same order
- [ ] Type checking passes (`bun run check-types`)
- [ ] Lint passes (`bun lint:clean`)
- [ ] UI displays all models correctly
- [ ] Generation works for all model categories

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Import path issues | Low | Medium | Barrel file with re-exports |
| Model order changes | Low | Low | Preserve original order in combined array |
| Missing models | Low | High | Count models before/after split |
| Type errors | Low | Low | TypeScript will catch at compile time |

---

*Document created: 2025-12-17*
*Target: Reduce ai-constants.ts from 1,594 to ~300 lines*
