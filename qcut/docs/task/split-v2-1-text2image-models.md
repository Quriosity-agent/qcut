# Subtask V2-1: Split `text2image-models.ts` (1422 → ~100 registry + 4 provider files)

**Parent Plan:** [split-top5-large-files-plan-v2.md](./split-top5-large-files-plan-v2.md)
**Phase:** 1 (execute first)
**Estimated Effort:** 15-20 minutes
**Risk Level:** Medium — mostly configuration data, but exported helpers/types and module resolution behavior are runtime-sensitive

---

## Goal

Split the monolithic model config file into provider-grouped files with a barrel `index.ts`. All existing imports (`@/lib/text2image-models`) continue to work unchanged.

---

## Files Involved

| File | Action |
|------|--------|
| `apps/web/src/lib/text2image-models.ts` | **Keep** as compatibility shim re-export |
| `apps/web/src/lib/text2image-models/index.ts` | **Create** — interface, registry, helpers, categories |
| `apps/web/src/lib/text2image-models/types.ts` | **Create** — shared `Text2ImageModel` type |
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

### Step 7: Keep compatibility shim (applied)

Keep `apps/web/src/lib/text2image-models.ts` as:
```typescript
export * from "./text2image-models/index";
export type * from "./text2image-models/index";
```

### Step 8: Fix `fal-ai-client.ts` relative import

`fal-ai-client.ts:11` uses `"./text2image-models"` (relative). This resolves to the directory barrel — verify it works. If not, update to `"./text2image-models/index"`.

---

## Verification

```bash
# Type check
bun run check-types

# Lint
bun lint:clean

# Smoke test: open text2image panel, verify 13 generation models appear in picker
# and full registry remains 14 (includes edit-only model)
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

---

## Review Comments (LTS + No-Breaking-Change Focus)

1. Keep backward compatibility shim instead of deleting immediately  
Replace Step 7 with: keep `apps/web/src/lib/text2image-models.ts` as a compatibility re-export (`export * from "./text2image-models/index"` and `export type * from "./text2image-models/index"`).  
Rationale: all current imports continue to work regardless of directory-index resolution differences; this is safer for long-term support.

2. Avoid type-only circular dependency between `index.ts` and provider files  
Do not import `Text2ImageModel` from `./index` inside provider files.  
Create `apps/web/src/lib/text2image-models/types.ts` for shared types and import from there.

3. Preserve current behavior: registry has 14 models, selector order has 13  
Current UI model picker iterates `TEXT2IMAGE_MODEL_ORDER`, not `TEXT2IMAGE_MODELS`, so `seeddream-v4-5-edit` is intentionally not in the picker.  
Update smoke test wording from “all 14 models appear” to “13 generation models appear in picker; full registry remains 14 including edit-only model.”

4. Add integrity checks that prevent silent drift  
In tests, add:
- every `TEXT2IMAGE_MODEL_ORDER` id exists in `TEXT2IMAGE_MODELS`
- every id in `MODEL_CATEGORIES` exists in `TEXT2IMAGE_MODELS`
- `seeddream-v4-5-edit` exists in `TEXT2IMAGE_MODELS` and is not in `TEXT2IMAGE_MODEL_ORDER` (intentional behavior)

5. Update command examples to match repository scripts  
Use root-level commands consistently:
- `bun run check-types`
- `bun run lint:clean`
- `bun run test` (or targeted vitest command for the new test file)

---

## Implementation Update (2026-02-11)

### Completed

- Created split model modules:
  - `apps/web/src/lib/text2image-models/index.ts`
  - `apps/web/src/lib/text2image-models/types.ts`
  - `apps/web/src/lib/text2image-models/google-models.ts`
  - `apps/web/src/lib/text2image-models/bytedance-models.ts`
  - `apps/web/src/lib/text2image-models/flux-models.ts`
  - `apps/web/src/lib/text2image-models/other-models.ts`
- Replaced monolith with compatibility shim in:
  - `apps/web/src/lib/text2image-models.ts`
- Preserved existing consumer imports (no import path changes needed).
- Added integrity/unit tests:
  - `apps/web/src/lib/text2image-models/__tests__/text2image-models.test.ts`

### Behavior Checks

- Registry count remains `14`.
- `TEXT2IMAGE_MODEL_ORDER` remains `13`.
- `seeddream-v4-5-edit` exists in registry and is intentionally excluded from picker order.

### Validation Run

- `bun x tsc --noEmit -p apps/web/tsconfig.json` passed.
- `bun run lint:clean` passed.
- `bun x vitest run src/lib/text2image-models/__tests__/text2image-models.test.ts` passed (`8` tests).
- `bun run check-types` executed but reported no package tasks in this workspace setup.

---

## Code Review (2026-02-11)

**Reviewer:** Claude Opus 4.6
**Verdict:** APPROVED with minor findings

### Verification Results

| Check | Result |
|-------|--------|
| `tsc --noEmit` (apps/web) | Pass — zero errors |
| `vitest run` (8 tests) | Pass — all green (must run from `apps/web/`, not repo root) |
| Model count (registry) | 14 — correct |
| Model count (picker order) | 13 — correct (`seeddream-v4-5-edit` excluded) |
| All files under 800 lines | Pass — largest is `other-models.ts` at 462 lines |
| Consumer imports unchanged | Pass — 3 consumers verified, all use `@/lib/text2image-models` |
| Compatibility shim present | Pass — `text2image-models.ts` re-exports from `./text2image-models/index` |

### What Was Done Well

1. **Clean separation by provider.** Google (3 models / 249 lines), ByteDance (4 / 361), Flux (2 / 185), Other (5 / 462) — logical grouping that matches how new models are added.
2. **Circular dependency avoided.** `types.ts` holds the `Text2ImageModel` interface; all provider files import from `./types`, not `./index`. This follows the review comment #2 exactly.
3. **Backward-compatible shim.** The original `text2image-models.ts` file re-exports both values and types, so `fal-ai-client.ts` (which uses a relative `"./text2image-models"` import) continues to resolve correctly.
4. **Good test coverage.** 8 tests cover registry count, order integrity, required fields, helper functions, category validity, and the edit-only model exclusion — all the integrity checks recommended in review comment #4.
5. **`TEXT2IMAGE_MODEL_ORDER` stays in `index.ts`** as the single source of truth for picker ordering, not split across provider files.

### Issues Found

#### Issue 1 (Low): Test runner must be invoked from `apps/web/`

The validation section says `bun x vitest run src/lib/text2image-models/__tests__/text2image-models.test.ts` — this fails when run from the repo root (`c:\...\qcut\qcut`) because the `@/` alias is only configured in `apps/web/vitest.config.ts`. The test only passes when run from `apps/web/`:

```bash
# Fails from repo root:
bun x vitest run src/lib/text2image-models/__tests__/text2image-models.test.ts

# Works:
cd apps/web && npx vitest run src/lib/text2image-models/__tests__/text2image-models.test.ts
```

The standard `bun run test` (which uses the workspace config) should work correctly, so this is a documentation accuracy issue only.

**Recommendation:** Update the validation command in the doc to clarify the working directory, or use `bun run test -- --run src/lib/text2image-models` from the root.

#### Issue 2 (Informational): `any` types in `Text2ImageModel` interface

`types.ts` uses `Record<string, any>` for `defaultParams` and `any` for `availableParams[].default`. This is inherited from the original monolith, not introduced by the split. Flagging for future improvement only — no action required for this task.

#### Issue 3 (Informational): `types.ts` not listed in plan Step 1

The plan's Step 1 says `index.ts` will contain the `Text2ImageModel` interface, but the implementation correctly moved it to `types.ts` per review comment #2. The plan doc wasn't retroactively updated to reflect this change, but the "Files Involved" table at the top does list `types.ts`, so the discrepancy is minor.

### Model Audit

All 14 models verified present with correct provider grouping:

| File | Models | Count |
|------|--------|-------|
| `google-models.ts` | imagen4-ultra, nano-banana, gemini-3-pro | 3 |
| `bytedance-models.ts` | seeddream-v3, seeddream-v4, seeddream-v4-5, seeddream-v4-5-edit | 4 |
| `flux-models.ts` | flux-pro-v11-ultra, flux-2-flex | 2 |
| `other-models.ts` | wan-v2-2, qwen-image, reve-text-to-image, z-image-turbo, gpt-image-1-5 | 5 |
| **Total** | | **14** |

All 13 entries in `TEXT2IMAGE_MODEL_ORDER` map to valid keys. All category IDs in `MODEL_CATEGORIES` map to valid keys. `seeddream-v4-5-edit` is in registry but not in order array (intentional).

### Summary

The split is clean, well-tested, and follows all 5 review comments from the plan. No breaking changes, no missing models, no circular dependencies. The only actionable item is the test runner documentation (Issue 1), which is cosmetic.
