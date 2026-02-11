# Subtask V2-1: Split `text2image-models.ts` (1422 → ~100 registry + 4 provider files)

**Parent Plan:** [split-top5-large-files-plan-v2.md](./split-top5-large-files-plan-v2.md)
**Phase:** 1 (execute first)
**Estimated Effort:** 15-20 minutes
**Risk Level:** Low — pure configuration data, zero logic, zero state

---

## Goal

Split the monolithic model config file into provider-grouped files with a barrel `index.ts`. All existing imports (`@/lib/text2image-models`) continue to work unchanged.

---

## Files Involved

| File | Action |
|------|--------|
| `apps/web/src/lib/text2image-models.ts` | **Delete** after migration |
| `apps/web/src/lib/text2image-models/index.ts` | **Create** — interface, registry, helpers, categories |
| `apps/web/src/lib/text2image-models/google-models.ts` | **Create** — Google provider models |
| `apps/web/src/lib/text2image-models/bytedance-models.ts` | **Create** — ByteDance provider models |
| `apps/web/src/lib/text2image-models/flux-models.ts` | **Create** — Flux provider models |
| `apps/web/src/lib/text2image-models/other-models.ts` | **Create** — Remaining providers |

### Consumer Files (import path unchanged)

| File | Current Import |
|------|---------------|
| `apps/web/src/lib/fal-ai-client.ts:11` | `import { TEXT2IMAGE_MODELS, type Text2ImageModel } from "./text2image-models"` |
| `apps/web/src/stores/text2image-store.ts:4` | `import { TEXT2IMAGE_MODEL_ORDER } from "@/lib/text2image-models"` |
| `apps/web/src/components/editor/media-panel/views/text2image.tsx:30-33` | `import { TEXT2IMAGE_MODELS, TEXT2IMAGE_MODEL_ORDER } from "@/lib/text2image-models"` |

All 3 consumers use `@/lib/text2image-models` which resolves to the barrel `index.ts` — no import changes needed.

---

## Implementation Steps

### Step 1: Create directory and `index.ts` (~100 lines)

```
apps/web/src/lib/text2image-models/index.ts
```

Contents:
- `Text2ImageModel` interface (lines 5-40 of original)
- `Text2ImageModelId` type (line 1313)
- Import and aggregate models from provider files into `TEXT2IMAGE_MODELS`
- `TEXT2IMAGE_MODEL_ORDER` (lines 1297-1311)
- Helper functions (lines 1315-1377):
  - `getText2ImageModelEntriesInPriorityOrder()`
  - `getModelById(id)`
  - `getModelsByProvider(provider)`
  - `getModelsByQuality(minRating)`
  - `getModelsBySpeed(minRating)`
  - `getCostRange()`
  - `recommendModelsForPrompt(prompt)`
- `MODEL_CATEGORIES` (lines 1379-1422)

### Step 2: Create `google-models.ts` (~250 lines)

```
apps/web/src/lib/text2image-models/google-models.ts
```

Move these model configs:
| Model ID | Original Lines |
|----------|---------------|
| `imagen4-ultra` | 43-105 |
| `nano-banana` | 852-927 |
| `gemini-3-pro` | 1102-1205 |

```typescript
import type { Text2ImageModel } from "./index";

export const GOOGLE_MODELS: Record<string, Text2ImageModel> = {
  "imagen4-ultra": { ... },
  "nano-banana": { ... },
  "gemini-3-pro": { ... },
};
```

### Step 3: Create `bytedance-models.ts` (~470 lines)

```
apps/web/src/lib/text2image-models/bytedance-models.ts
```

Move these model configs:
| Model ID | Original Lines |
|----------|---------------|
| `seeddream-v3` | 107-192 |
| `seeddream-v4` | 577-676 |
| `seeddream-v4-5` | 681-767 |
| `seeddream-v4-5-edit` | 770-849 |

### Step 4: Create `flux-models.ts` (~180 lines)

```
apps/web/src/lib/text2image-models/flux-models.ts
```

Move these model configs:
| Model ID | Original Lines |
|----------|---------------|
| `flux-pro-v11-ultra` | 194-281 |
| `flux-2-flex` | 283-374 |

### Step 5: Create `other-models.ts` (~420 lines)

```
apps/web/src/lib/text2image-models/other-models.ts
```

Move these model configs:
| Model ID | Original Lines |
|----------|---------------|
| `wan-v2-2` | 376-462 |
| `qwen-image` | 464-574 |
| `reve-text-to-image` | 929-1000 |
| `z-image-turbo` | 1002-1100 |
| `gpt-image-1-5` | 1207-1292 |

### Step 6: Wire the barrel

In `index.ts`:
```typescript
import { GOOGLE_MODELS } from "./google-models";
import { BYTEDANCE_MODELS } from "./bytedance-models";
import { FLUX_MODELS } from "./flux-models";
import { OTHER_MODELS } from "./other-models";

export const TEXT2IMAGE_MODELS: Record<string, Text2ImageModel> = {
  ...GOOGLE_MODELS,
  ...BYTEDANCE_MODELS,
  ...FLUX_MODELS,
  ...OTHER_MODELS,
};
```

### Step 7: Delete original file

Delete `apps/web/src/lib/text2image-models.ts`.

### Step 8: Fix `fal-ai-client.ts` relative import

`fal-ai-client.ts:11` uses `"./text2image-models"` (relative). This resolves to the directory barrel — verify it works. If not, update to `"./text2image-models/index"`.

---

## Verification

```bash
# Type check
bun run check-types

# Lint
bun lint:clean

# Smoke test: open text2image panel, verify all 14 models appear
bun run electron:dev
```

---

## Unit Tests

Create `apps/web/src/lib/text2image-models/__tests__/text2image-models.test.ts`:

| Test Case | What It Validates |
|-----------|-------------------|
| `TEXT2IMAGE_MODELS has exactly 14 models` | No models lost during split |
| `Every model in TEXT2IMAGE_MODEL_ORDER exists in TEXT2IMAGE_MODELS` | Order array integrity |
| `Every model has required fields (id, name, endpoint, provider)` | Interface compliance |
| `getModelById returns correct model for known ID` | Helper function |
| `getModelsByProvider("Google") returns google models` | Provider grouping |
| `MODEL_CATEGORIES.PHOTOREALISTIC contains only valid model IDs` | Category integrity |
| `getText2ImageModelEntriesInPriorityOrder returns correct length` | Priority helper |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Barrel `index.ts` not resolved | Verify TypeScript `moduleResolution` supports directory imports; add explicit `/index` if needed |
| Model order changes | `TEXT2IMAGE_MODEL_ORDER` stays in `index.ts` as source of truth |
| Relative import in `fal-ai-client.ts` breaks | Test relative `"./text2image-models"` path; adjust if needed |
| New models added to wrong file | Provider grouping is clear; document in each file header |
