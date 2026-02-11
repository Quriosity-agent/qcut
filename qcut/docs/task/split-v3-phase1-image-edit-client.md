# Phase 1: Split `image-edit-client.ts`

**Source:** `apps/web/src/lib/image-edit-client.ts` (1325 lines → ~450 + 3 extracted files)
**Risk Level:** Low
**Estimated Time:** ~25 min
**Predecessor:** None — can start immediately

---

## Objective

Extract polling logic, model metadata, and shared utilities from `image-edit-client.ts` into focused modules. The main file retains the core edit/upload/upscale API surface.

---

## Subtasks

### 1.1 Create `image-edit-utils.ts` (~65 lines)
**~5 min**

**File:** `apps/web/src/lib/image-edit-utils.ts`

Move from `image-edit-client.ts`:
- `getFalApiKey()` (lines 37–87) — cached API key retrieval with env/Electron fallback
- `generateJobId()` (lines 1047–1051) — UUID-based job ID generator
- Two module-level cache variables (lines 34–35): `cachedApiKey`, `apiKeyPromise`

Exports: `getFalApiKey`, `generateJobId`

**Why separate:** Both `editImage()` and `pollImageEditStatus()` depend on the API key. Extracting prevents circular imports when polling moves out.

### 1.2 Create `image-edit-polling.ts` (~180 lines)
**~8 min**

**File:** `apps/web/src/lib/image-edit-polling.ts`

Move from `image-edit-client.ts`:
- `pollImageEditStatus()` (lines 852–981) — long-poll loop with timeout, retry, and progress callback
- `mapEditStatusToProgress()` (lines 989–1031) — FAL status → user-friendly progress mapping
- `sleep()` (lines 1038–1043) — Promise-based delay utility

Imports: `getFalApiKey` from `./image-edit-utils`

Exports: `pollImageEditStatus`, `mapEditStatusToProgress`, `sleep`

### 1.3 Create `image-edit-models-info.ts` (~270 lines)
**~5 min**

**File:** `apps/web/src/lib/image-edit-models-info.ts`

Move from `image-edit-client.ts`:
- `getImageEditModels()` (lines 1056–1325) — returns array of 10 model definitions with capabilities, constraints, and pricing

Exports: `getImageEditModels`

**Why separate:** Pure data function with zero dependencies on the rest of the client. Used only by UI components for model selection display.

### 1.4 Update `image-edit-client.ts` imports and re-exports
**~5 min**

**File:** `apps/web/src/lib/image-edit-client.ts` (~450 lines remaining)

Changes:
- Add `import { getFalApiKey } from './image-edit-utils'`
- Add `import { pollImageEditStatus } from './image-edit-polling'`
- Add barrel re-exports at bottom:
  ```ts
  export { getFalApiKey, generateJobId } from './image-edit-utils';
  export { pollImageEditStatus, mapEditStatusToProgress, sleep } from './image-edit-polling';
  export { getImageEditModels } from './image-edit-models-info';
  ```
- Remove moved code sections
- Keep: types, `MODEL_ENDPOINTS`, `uploadImageToFAL()`, `uploadImagesToFAL()`, `editImage()`, `upscaleImage()`

### 1.5 Update external consumers
**~2 min**

Search for any direct imports of `getImageEditModels` or `pollImageEditStatus` from other files and verify they still resolve via barrel re-export.

**Files to check:**
- `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-image-tab.tsx`
- Any files importing from `image-edit-client`

---

## Unit Tests

### Existing tests
- `apps/web/src/lib/__tests__/image-edit-multi-image.test.ts` — verify still passes

### New tests to add

**File:** `apps/web/src/lib/__tests__/image-edit-utils.test.ts`

| Test Case | Description |
|-----------|-------------|
| `getFalApiKey returns env var when set` | Mock `import.meta.env.VITE_FAL_API_KEY`, assert returned |
| `generateJobId returns unique strings` | Call twice, assert different results |
| `generateJobId matches UUID format` | Regex check for `edit-{uuid}` pattern |

**File:** `apps/web/src/lib/__tests__/image-edit-polling.test.ts`

| Test Case | Description |
|-----------|-------------|
| `mapEditStatusToProgress maps COMPLETED to 100` | Assert correct progress mapping |
| `mapEditStatusToProgress maps IN_QUEUE to 10` | Assert queue status mapping |
| `sleep resolves after delay` | Mock timers, assert resolution |

**File:** `apps/web/src/lib/__tests__/image-edit-models-info.test.ts`

| Test Case | Description |
|-----------|-------------|
| `getImageEditModels returns array of models` | Assert non-empty array |
| `each model has required fields` | Assert `id`, `name`, `capabilities` exist |
| `no duplicate model IDs` | Assert unique IDs across all models |

---

## Verification Checklist

- [ ] `bun run check-types` — no new type errors
- [ ] `bun lint:clean` — no lint violations
- [ ] `bun run test` — all tests pass (existing + new)
- [ ] Barrel re-exports in `image-edit-client.ts` — external imports unbroken
- [ ] No circular imports between new files
