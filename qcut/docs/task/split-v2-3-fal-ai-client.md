# Subtask V2-3: Split `fal-ai-client.ts` (1512 → ~500 core + 3 method files)

**Parent Plan:** [split-top5-large-files-plan-v2.md](./split-top5-large-files-plan-v2.md)
**Phase:** 3
**Estimated Effort:** 30-40 minutes
**Risk Level:** Medium-High — extraction touches core request path, proxy singleton behavior, and exported wrapper compatibility

---

## Goal

Extract model-specific methods from the `FalAIClient` class into standalone function files. The class delegates to these functions, keeping its public API shape identical. The proxy-based singleton (`falAIClient`) and named wrapper exports (for dynamic imports) continue to work unchanged.

## Implementation Update (2026-02-11)

- Status: Completed
- Added compatibility coverage in `apps/web/src/lib/__tests__/fal-ai-client-split.test.ts`.
- Verified split architecture is in place:
  - `apps/web/src/lib/fal-ai-client-generation.ts`
  - `apps/web/src/lib/fal-ai-client-veo31.ts`
  - `apps/web/src/lib/fal-ai-client-reve.ts`
  - `apps/web/src/lib/fal-ai-client-internal-types.ts`
  - `apps/web/src/lib/fal-ai-client.ts` delegates to extracted modules with bound `makeRequest`.

### Verification Notes

- `bun run check-types`: no tasks executed in this workspace (Turbo reported `0 total`).
- `bun x vitest run apps/web/src/lib/__tests__/fal-ai-client-split.test.ts`: blocked in sandbox with `spawn EPERM`.
- `bun x tsc --noEmit -p apps/web/tsconfig.json`: blocked by existing parse error at `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts:409`.

---

## Files Involved

| File | Action |
|------|--------|
| `apps/web/src/lib/fal-ai-client.ts` | **Edit** — keep core class + delegations |
| `apps/web/src/lib/fal-ai-client-internal-types.ts` | **Create** — internal delegate contracts and shared generation types |
| `apps/web/src/lib/fal-ai-client-veo31.ts` | **Create** — Veo 3.1 methods |
| `apps/web/src/lib/fal-ai-client-generation.ts` | **Create** — generation + conversion methods |
| `apps/web/src/lib/fal-ai-client-reve.ts` | **Create** — Reve methods |

### Consumer Files (no changes needed)

| File | Import |
|------|--------|
| `.../hooks/use-ai-generation.ts:20` | `import { falAIClient } from "@/lib/fal-ai-client"` |
| `.../hooks/use-ai-generation-helpers.ts:10` | `import { falAIClient } from "@/lib/fal-ai-client"` |
| `.../generation/model-handler-implementations.ts:8` | `import { falAIClient } from "@/lib/fal-ai-client"` (or split handler files after V2-2) |
| `apps/web/src/stores/text2image-store.ts:380` | dynamic import of `generateWithMultipleModels` from `@/lib/fal-ai-client` |

---

## Subtask Breakdown

### Subtask 3a: Extract Veo 3.1 Methods (~15 min)

**New file:** `apps/web/src/lib/fal-ai-client-veo31.ts` (~405 lines)

Extract 8 methods as standalone functions:

| Method | Original Lines | Standalone Function |
|--------|---------------|---------------------|
| `generateVeo31FastTextToVideo` | 804-844 | `veo31FastTextToVideo(delegate, params)` |
| `generateVeo31FastImageToVideo` | 851-891 | `veo31FastImageToVideo(delegate, params)` |
| `generateVeo31FastFrameToVideo` | 898-939 | `veo31FastFrameToVideo(delegate, params)` |
| `generateVeo31FastExtendVideo` | 1116-1154 | `veo31FastExtendVideo(delegate, params)` |
| `generateVeo31TextToVideo` | 950-994 | `veo31TextToVideo(delegate, params)` |
| `generateVeo31ImageToVideo` | 1001-1049 | `veo31ImageToVideo(delegate, params)` |
| `generateVeo31FrameToVideo` | 1056-1105 | `veo31FrameToVideo(delegate, params)` |
| `generateVeo31ExtendVideo` | 1161-1205 | `veo31ExtendVideo(delegate, params)` |

**Pattern:**
```typescript
// fal-ai-client-veo31.ts
import type { FalAIClientRequestDelegate } from "./fal-ai-client-internal-types";
import type { Veo31TextToVideoInput, VideoGenerationResponse } from "@/types/ai-generation";

export async function veo31FastTextToVideo(
  delegate: FalAIClientRequestDelegate,
  params: Veo31TextToVideoInput
): Promise<VideoGenerationResponse> {
  // Exact same body, but uses delegate.makeRequest() instead of this.makeRequest()
}
```

**In `fal-ai-client.ts`, replace method body with delegation:**
```typescript
async generateVeo31FastTextToVideo(params: Veo31TextToVideoInput) {
  return veo31FastTextToVideo({ makeRequest: this.makeRequest.bind(this) }, params);
}
```

**Challenge:** `makeRequest` is currently `private`. Avoid widening class API for refactor convenience.

**Solution:** Use delegate injection + internal contract file instead of changing visibility:
```typescript
// In fal-ai-client-internal-types.ts
export interface FalAIClientRequestDelegate {
  makeRequest<T>(endpoint: string, params: Record<string, unknown>): Promise<T>;
}
```

### Subtask 3b: Extract Generation Methods (~15 min)

**New file:** `apps/web/src/lib/fal-ai-client-generation.ts` (~375 lines)

Extract methods:

| Method | Original Lines | Description |
|--------|---------------|-------------|
| `convertSettingsToParams` (private) | 310-554 | Convert generic settings → model-specific params |
| `generateWithModel` | 556-620 | Single-model generation |
| `generateWithMultipleModels` | 622-685 | Multi-model parallel generation |

**Dependencies:** `convertSettingsToParams` depends on `TEXT2IMAGE_MODELS` and model-specific logic. `generateWithModel`/`generateWithMultipleModels` use delegated `makeRequest`.

```typescript
// fal-ai-client-generation.ts
import type {
  FalAIClientRequestDelegate,
  GenerationSettings,
  GenerationResult,
  MultiModelGenerationResult,
} from "./fal-ai-client-internal-types";
import { TEXT2IMAGE_MODELS, type Text2ImageModel } from "./text2image-models";

export function convertSettingsToParams(
  model: Text2ImageModel,
  prompt: string,
  settings: GenerationSettings
): Record<string, any> { ... }

export async function generateWithModel(
  delegate: FalAIClientRequestDelegate,
  modelKey: string,
  prompt: string,
  settings: GenerationSettings
): Promise<GenerationResult> { ... }

export async function generateWithMultipleModels(
  delegate: FalAIClientRequestDelegate,
  modelKeys: string[],
  prompt: string,
  settings: GenerationSettings
): Promise<MultiModelGenerationResult> { ... }
```

### Subtask 3c: Extract Reve Methods (~10 min)

**New file:** `apps/web/src/lib/fal-ai-client-reve.ts` (~155 lines)

Extract methods:

| Method | Original Lines | Description |
|--------|---------------|-------------|
| `generateReveTextToImage` | 1221-1278 | Reve T2I generation |
| `generateReveEdit` | 1293-1363 | Reve image editing |

**Dependencies:** Uses validators from `@/lib/ai-video/validation/validators`, types from `@/types/ai-generation`, and `TEXT2IMAGE_MODELS` for endpoint lookup.

```typescript
// fal-ai-client-reve.ts
import type { FalAIClientRequestDelegate } from "./fal-ai-client-internal-types";
import type { ReveTextToImageInput, ReveTextToImageOutput, ReveEditInput, ReveEditOutput } from "@/types/ai-generation";

export async function reveTextToImage(
  delegate: FalAIClientRequestDelegate,
  params: ReveTextToImageInput
): Promise<ReveTextToImageOutput> { ... }

export async function reveEdit(
  delegate: FalAIClientRequestDelegate,
  params: ReveEditInput
): Promise<ReveEditOutput> { ... }
```

---

## What Stays in `fal-ai-client.ts` (~500 lines)

| Section | Lines | Description |
|---------|-------|-------------|
| Imports | 11-57 | + new imports from extracted files |
| Types/interfaces | 60-100 | `FalImageResponse` + any stable public types kept in main file |
| Class: constructor | 113-133 | Initialization |
| Class: `initApiKeyFromElectron` | 139-165 | Electron key loading |
| Class: `ensureApiKey` | 171-177 | Key validation |
| Class: `makeRequest` | 186-269 | Core HTTP (**stays private**) |
| Class: upload methods | 275-308 | `uploadFileToFal`, `uploadImageToFal`, `uploadAudioToFal`, `uploadVideoToFal` |
| Class: API key methods | 688-720 | `setApiKey`, `hasApiKey`, `getApiKeyStatus` |
| Class: utility methods | 723-793 | `testModelAvailability`, `estimateGenerationTime`, `getModelCapabilities` |
| Class: delegation stubs | — | One-liner delegations to extracted functions |
| Singleton + proxy | 1389-1417 | Lazy init + Proxy export |
| Export wrappers | 1420-1512 | `convertParametersForModel`, `batchGenerate`, re-exports |

---

## Implementation Steps

1. **Create `fal-ai-client-internal-types.ts`** with delegate contracts used by extracted modules.
2. **Keep `makeRequest` private** and pass bound delegates (`{ makeRequest: this.makeRequest.bind(this) }`) to extracted functions.
3. **Create `fal-ai-client-veo31.ts`** — move 8 Veo methods, convert `this.` → `delegate.`.
4. **Create `fal-ai-client-generation.ts`** — move `convertSettingsToParams`, `generateWithModel`, `generateWithMultipleModels`.
5. **Create `fal-ai-client-reve.ts`** — move 2 Reve methods.
6. **Replace method bodies** in class with one-liner delegations.
7. **Verify proxy singleton and named wrapper exports still work** (`falAIClient`, `generateWithMultipleModels`, etc.).

---

## Verification

```bash
# Type check
bun run check-types

# Lint
bun lint:clean

# Smoke test: test T2I generation, Veo 3.1, and Reve Edit
bun run electron:dev
```

---

## Unit Tests

Create `apps/web/src/lib/__tests__/fal-ai-client-split.test.ts`:

| Test Case | What It Validates |
|-----------|-------------------|
| `fal-ai-client named exports remain available` | wrapper API compatibility preserved |
| `veo31FastTextToVideo is a function` | Veo31 extraction |
| `generateWithModel delegates to extracted function` | Delegation pattern |
| `reveTextToImage validates prompts` | Reve extraction |
| `convertSettingsToParams handles all 14 model types` | Generation extraction |
| `falAIClient proxy resolves methods correctly` | Singleton proxy preserved |
| `batchGenerate export still works` | Re-export preserved |
| `text2image-store dynamic import of generateWithMultipleModels still resolves` | runtime compatibility preserved |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `this` context lost in extracted functions | Functions take `delegate: FalAIClientRequestDelegate`; no direct `this` usage |
| Refactor widens class API surface unintentionally | Keep `makeRequest` private; pass bound delegate object to extracted functions |
| Proxy-based singleton stops resolving new methods | Delegations are regular class methods; proxy intercepts them normally |
| Circular import: extracted file imports type from main, main imports function | Move internal contracts to `fal-ai-client-internal-types.ts` to break potential cycles |
| `convertSettingsToParams` references `TEXT2IMAGE_MODELS` | Import directly in `fal-ai-client-generation.ts` |
| `generateReveEdit` dynamically imports `image-edit-client` | Keep dynamic import in extracted function; it's self-contained |

---

## Review Comments (LTS + No-Breaking-Change Focus)

1. Keep `apps/web/src/lib/fal-ai-client.ts` as the only public entrypoint  
Treat `fal-ai-client-veo31.ts`, `fal-ai-client-generation.ts`, `fal-ai-client-reve.ts`, and `fal-ai-client-internal-types.ts` as internal-only modules. Do not add new app-level imports to those files.

2. Preserve type import compatibility from `fal-ai-client.ts`  
If `GenerationSettings` / `GenerationResult` / `MultiModelGenerationResult` are moved to the internal types file, re-export them from `fal-ai-client.ts` so existing imports remain stable.

3. Preserve existing error handling semantics verbatim  
Keep all existing `try/catch`, `handleAIServiceError`, and `handleError` behavior unchanged during extraction to avoid silent regressions in user-visible failures and logs.

4. Keep Reve dynamic import behavior unchanged  
`generateReveEdit` currently dynamically imports `@/lib/image-edit-client`; keep that lazy boundary to avoid bundle/cycle regressions.
