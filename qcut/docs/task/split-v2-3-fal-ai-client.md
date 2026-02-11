# Subtask V2-3: Split `fal-ai-client.ts` (1512 → ~500 core + 3 method files)

**Parent Plan:** [split-top5-large-files-plan-v2.md](./split-top5-large-files-plan-v2.md)
**Phase:** 3
**Estimated Effort:** 30-40 minutes
**Risk Level:** Medium — class method extraction requires careful `this` binding and proxy-based singleton preservation

---

## Goal

Extract model-specific methods from the `FalAIClient` class into standalone function files. The class delegates to these functions, keeping its public API shape identical. The proxy-based singleton (`falAIClient`) continues to work unchanged for all 3 consumers.

---

## Files Involved

| File | Action |
|------|--------|
| `apps/web/src/lib/fal-ai-client.ts` | **Edit** — keep core class + delegations |
| `apps/web/src/lib/fal-ai-client-veo31.ts` | **Create** — Veo 3.1 methods |
| `apps/web/src/lib/fal-ai-client-generation.ts` | **Create** — generation + conversion methods |
| `apps/web/src/lib/fal-ai-client-reve.ts` | **Create** — Reve methods |

### Consumer Files (no changes needed)

| File | Import |
|------|--------|
| `.../hooks/use-ai-generation.ts:20` | `import { falAIClient } from "@/lib/fal-ai-client"` |
| `.../hooks/use-ai-generation-helpers.ts:10` | `import { falAIClient } from "@/lib/fal-ai-client"` |
| `.../generation/model-handler-implementations.ts:8` | `import { falAIClient } from "@/lib/fal-ai-client"` |

---

## Subtask Breakdown

### Subtask 3a: Extract Veo 3.1 Methods (~15 min)

**New file:** `apps/web/src/lib/fal-ai-client-veo31.ts` (~405 lines)

Extract 8 methods as standalone functions:

| Method | Original Lines | Standalone Function |
|--------|---------------|---------------------|
| `generateVeo31FastTextToVideo` | 804-844 | `veo31FastTextToVideo(client, params)` |
| `generateVeo31FastImageToVideo` | 851-891 | `veo31FastImageToVideo(client, params)` |
| `generateVeo31FastFrameToVideo` | 898-939 | `veo31FastFrameToVideo(client, params)` |
| `generateVeo31FastExtendVideo` | 1116-1154 | `veo31FastExtendVideo(client, params)` |
| `generateVeo31TextToVideo` | 950-994 | `veo31TextToVideo(client, params)` |
| `generateVeo31ImageToVideo` | 1001-1049 | `veo31ImageToVideo(client, params)` |
| `generateVeo31FrameToVideo` | 1056-1105 | `veo31FrameToVideo(client, params)` |
| `generateVeo31ExtendVideo` | 1161-1205 | `veo31ExtendVideo(client, params)` |

**Pattern:**
```typescript
// fal-ai-client-veo31.ts
import type { FalAIClient } from "./fal-ai-client";
import type { Veo31TextToVideoInput, VideoGenerationResponse } from "@/types/ai-generation";

export async function veo31FastTextToVideo(
  client: FalAIClient,
  params: Veo31TextToVideoInput
): Promise<VideoGenerationResponse> {
  // Exact same body, but uses client.makeRequest() instead of this.makeRequest()
}
```

**In `fal-ai-client.ts`, replace method body with delegation:**
```typescript
async generateVeo31FastTextToVideo(params: Veo31TextToVideoInput) {
  return veo31FastTextToVideo(this, params);
}
```

**Challenge:** `makeRequest` is currently `private`. Must change to `public` or add a package-internal accessor.

**Solution:** Export a type `FalAIClientCore` with `makeRequest` visible:
```typescript
// In fal-ai-client.ts
export interface FalAIClientCore {
  makeRequest<T>(endpoint: string, params: Record<string, unknown>): Promise<T>;
  ensureApiKey(): Promise<string | null>;
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

**Dependencies:** `convertSettingsToParams` depends on `TEXT2IMAGE_MODELS` and model-specific logic. It uses `this.makeRequest` and `this.ensureApiKey`.

```typescript
// fal-ai-client-generation.ts
import type { FalAIClientCore } from "./fal-ai-client";
import { TEXT2IMAGE_MODELS, type Text2ImageModel } from "./text2image-models";
import type { GenerationSettings, GenerationResult, MultiModelGenerationResult } from "./fal-ai-client";

export function convertSettingsToParams(
  model: Text2ImageModel,
  prompt: string,
  settings: GenerationSettings
): Record<string, any> { ... }

export async function generateWithModel(
  client: FalAIClientCore,
  modelKey: string,
  prompt: string,
  settings: GenerationSettings
): Promise<GenerationResult> { ... }

export async function generateWithMultipleModels(
  client: FalAIClientCore,
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
import type { FalAIClientCore } from "./fal-ai-client";
import type { ReveTextToImageInput, ReveTextToImageOutput, ReveEditInput, ReveEditOutput } from "@/types/ai-generation";

export async function reveTextToImage(
  client: FalAIClientCore,
  params: ReveTextToImageInput
): Promise<ReveTextToImageOutput> { ... }

export async function reveEdit(
  client: FalAIClientCore,
  params: ReveEditInput
): Promise<ReveEditOutput> { ... }
```

---

## What Stays in `fal-ai-client.ts` (~500 lines)

| Section | Lines | Description |
|---------|-------|-------------|
| Imports | 11-57 | + new imports from extracted files |
| Types/interfaces | 60-100 | `FalImageResponse`, `GenerationResult`, `GenerationSettings`, `FalAIClientCore` |
| Class: constructor | 113-133 | Initialization |
| Class: `initApiKeyFromElectron` | 139-165 | Electron key loading |
| Class: `ensureApiKey` | 171-177 | Key validation |
| Class: `makeRequest` | 186-269 | Core HTTP (change to `public`) |
| Class: upload methods | 275-308 | `uploadFileToFal`, `uploadImageToFal`, `uploadAudioToFal`, `uploadVideoToFal` |
| Class: API key methods | 688-720 | `setApiKey`, `hasApiKey`, `getApiKeyStatus` |
| Class: utility methods | 723-793 | `testModelAvailability`, `estimateGenerationTime`, `getModelCapabilities` |
| Class: delegation stubs | — | One-liner delegations to extracted functions |
| Singleton + proxy | 1389-1417 | Lazy init + Proxy export |
| Export wrappers | 1420-1512 | `convertParametersForModel`, `batchGenerate`, re-exports |

---

## Implementation Steps

1. **Export `FalAIClientCore` interface** from `fal-ai-client.ts` with `makeRequest` and `ensureApiKey`.
2. **Change `makeRequest` from `private` to `public`** (or use a friend-module pattern).
3. **Create `fal-ai-client-veo31.ts`** — move 8 Veo methods, convert `this.` → `client.`.
4. **Create `fal-ai-client-generation.ts`** — move `convertSettingsToParams`, `generateWithModel`, `generateWithMultipleModels`.
5. **Create `fal-ai-client-reve.ts`** — move 2 Reve methods.
6. **Replace method bodies** in class with one-liner delegations.
7. **Verify proxy singleton still works** — the proxy delegates to instance methods which now delegate to extracted functions.

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
| `FalAIClient class still has all 27 public methods` | API shape preserved |
| `veo31FastTextToVideo is a function` | Veo31 extraction |
| `generateWithModel delegates to extracted function` | Delegation pattern |
| `reveTextToImage validates prompts` | Reve extraction |
| `convertSettingsToParams handles all 14 model types` | Generation extraction |
| `falAIClient proxy resolves methods correctly` | Singleton proxy preserved |
| `batchGenerate export still works` | Re-export preserved |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `this` context lost in extracted functions | Functions take `client: FalAIClientCore` as first param; no `this` usage |
| `makeRequest` was `private` | Change to `public`; it's only used internally + by extracted files |
| Proxy-based singleton stops resolving new methods | Delegations are regular class methods; proxy intercepts them normally |
| Circular import: extracted file imports type from main, main imports function | Types flow from main → extracted (via `FalAIClientCore`); functions flow from extracted → main. No circular dependency — types are import-only |
| `convertSettingsToParams` references `TEXT2IMAGE_MODELS` | Import directly in `fal-ai-client-generation.ts` |
| `generateReveEdit` dynamically imports `image-edit-client` | Keep dynamic import in extracted function; it's self-contained |
