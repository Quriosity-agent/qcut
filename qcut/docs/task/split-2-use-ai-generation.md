# Subtask 2: Split `use-ai-generation.ts` (1876 → ~1050 + ~826)

**Parent Plan:** [split-top5-large-files-plan.md](./split-top5-large-files-plan.md)
**Estimated Effort:** 25-35 minutes
**Risk Level:** Medium — core generation hook, many callback dependencies

---

## Goal

Extract pure/helper logic from `use-ai-generation.ts` into `use-ai-generation-helpers.ts`. The hook's public return contract (60+ exports) must remain identical.

---

## Files Involved

| File | Action |
|------|--------|
| `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | Edit — keep hook shell |
| `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation-helpers.ts` | **Create** — pure helpers |

---

## What Moves to `use-ai-generation-helpers.ts` (~826 lines)

### Group 1: Pure Utility Functions

| Function | Lines (current) | Why Extractable |
|----------|-----------------|-----------------|
| `getSafeDuration()` | 64-86 | Pure function, no dependencies |
| `downloadVideoToMemory()` | 358-402 | Pure async, no closures |
| `uploadImageToFal()` | 405-416 | Pure async, uses service param |
| `uploadAudioToFal()` | 419-430 | Pure async, uses service param |

### Group 2: Validation Logic (extract from `handleGenerate`)

| Function to Create | Source Lines | Description |
|--------------------|-------------|-------------|
| `validateTextTab(prompt, selectedModels)` | 819-824 | Returns error string or null |
| `validateImageTab(selectedModels, selectedImage, ...)` | 825-844 | Image tab validation |
| `validateAvatarTab(selectedModels, ...)` | 845-908 | Complex avatar model checks |
| `validateGenerationInputs(activeTab, ...)` | 817-908 | Orchestrator calling above 3 |

### Group 3: Settings Builders (extract from `handleGenerate`)

| Function to Create | Source Lines | Description |
|--------------------|-------------|-------------|
| `buildUnifiedParams(...)` | 950-1009 | Aspect ratio, resolution, duration, negative prompt |
| `buildTextToVideoSettings(params, ...)` | 1055-1087 | T2V settings object |
| `buildImageToVideoSettings(params, ...)` | 1088-1155 | I2V settings object |
| `buildUpscaleSettings(params, ...)` | 1156-1182 | Upscale settings object |
| `buildAvatarSettings(params, ...)` | 1184-1212 | Avatar settings object |

### Group 4: Response Handlers (extract from `handleGenerate`)

| Function to Create | Source Lines | Description |
|--------------------|-------------|-------------|
| `handleDirectWithJobResponse(result, ...)` | 1241-1332 | job_id + video_url path |
| `handleJobIdOnlyResponse(result, ...)` | 1333-1358 | Deferred polling path |
| `handleDirectVideoResponse(result, ...)` | 1359-1435 | video_url only path |
| `classifyResponse(result)` | 1215-1440 | Route to correct handler |

---

## What Stays in `use-ai-generation.ts` (~1050 lines)

| Section | Description |
|---------|-------------|
| Hook signature & props destructuring | Lines 92-200 |
| State declarations (useState) | Lines 202-280 |
| Store hooks | Lines 282-287 |
| Effects (5 useEffects) | Lines 290-355 |
| `startStatusPolling` | Lines 431-609 (uses state setters) |
| `handleMockGenerate` | Lines 612-782 (uses state setters) |
| `handleGenerate` (orchestrator only) | Lines 785-1583 (calls extracted helpers) |
| `resetGenerationState` | Lines 1586-1616 |
| Veo 3.1 setters | Lines 1619-1644 |
| Reve Edit functions | Lines 1649-1696 |
| Return object | Lines 1699-1876 |

---

## Implementation Steps

### Step 1: Create helpers file with pure utilities

```typescript
// use-ai-generation-helpers.ts

export function getSafeDuration(
  requestedDuration: number,
  capabilities?: T2VModelCapabilities
): number | undefined { ... }

export async function downloadVideoToMemory(url: string): Promise<Uint8Array> { ... }

export async function uploadImageToFal(
  client: FalAIClient,
  file: File
): Promise<string> { ... }

export async function uploadAudioToFal(
  client: FalAIClient,
  file: File
): Promise<string> { ... }
```

### Step 2: Extract validation functions

Move validation logic from `handleGenerate` into named functions. Each takes explicit parameters (no closures).

```typescript
export interface ValidationContext {
  prompt: string;
  selectedModels: string[];
  selectedImage: File | null;
  firstFrame: File | null;
  lastFrame: File | null;
  sourceVideo: File | null;
  audioFile: File | null;
  avatarImage: File | null;
  referenceImages: File[];
  // ... other needed props
}

export function validateGenerationInputs(
  activeTab: string,
  ctx: ValidationContext
): string | null { ... }
```

### Step 3: Extract settings builders

Each builder takes explicit params and returns a typed settings object.

```typescript
export interface UnifiedParams {
  aspectRatio: string;
  resolution: string;
  duration: number | undefined;
  negativePrompt: string;
  seed: number | undefined;
  // ... other shared params
}

export function buildUnifiedParams(props: { ... }): UnifiedParams { ... }
export function buildTextToVideoSettings(unified: UnifiedParams, ...): TextToVideoSettings { ... }
export function buildImageToVideoSettings(unified: UnifiedParams, ...): ImageToVideoSettings { ... }
export function buildUpscaleSettings(unified: UnifiedParams, ...): UpscaleSettings { ... }
export function buildAvatarSettings(unified: UnifiedParams, ...): AvatarSettings { ... }
```

### Step 4: Extract response handlers

```typescript
export interface ResponseHandlerContext {
  downloadVideoToMemory: (url: string) => Promise<Uint8Array>;
  addMediaItem: (...) => Promise<void>;
  activeProject: Project;
  outputManager: AIVideoOutputManager;
}

export async function handleDirectWithJobResponse(
  result: ModelHandlerResult,
  ctx: ResponseHandlerContext
): Promise<GeneratedVideo> { ... }
```

### Step 5: Refactor `handleGenerate` to call helpers

Replace inline logic with helper calls:

```typescript
// Before (inline):
if (activeTab === 'text' && !prompt) { ... }

// After (extracted):
const validationError = validateGenerationInputs(activeTab, validationCtx);
if (validationError) { toast.error(validationError); return; }
```

### Step 6: Update imports in hook file

```typescript
import {
  getSafeDuration,
  downloadVideoToMemory,
  uploadImageToFal,
  uploadAudioToFal,
  validateGenerationInputs,
  buildUnifiedParams,
  buildTextToVideoSettings,
  // ...
} from './use-ai-generation-helpers';
```

---

## Verification

```bash
# Type check
bun run check-types

# No existing tests for this file — add new ones (see below)

# Lint
bun lint:clean

# Smoke test: open editor, try AI generation flow
bun run electron:dev
```

---

## Unit Tests to Add

Create `apps/web/src/components/editor/media-panel/views/ai/hooks/__tests__/use-ai-generation-helpers.test.ts`:

| Test Case | What It Validates |
|-----------|-------------------|
| `getSafeDuration clamps to model capabilities` | Duration bounds |
| `getSafeDuration returns undefined for invalid input` | Edge case |
| `validateGenerationInputs returns error for empty prompt on text tab` | Text validation |
| `validateGenerationInputs returns error for missing image on image tab` | Image validation |
| `validateGenerationInputs returns null for valid avatar config` | Avatar happy path |
| `buildUnifiedParams sanitizes duration via getSafeDuration` | Param building |
| `buildTextToVideoSettings includes all T2V fields` | Settings shape |
| `buildImageToVideoSettings includes image URL` | Settings shape |
| `downloadVideoToMemory returns Uint8Array` | Download utility |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking `handleGenerate` dependency chain | Extract one group at a time; type-check after each |
| Response handlers need state setters | Pass callbacks explicitly, don't close over hook state |
| 111-item deps array gets stale | Refactored `handleGenerate` will have fewer deps (helpers are stable) |
| Media integration duplication | Deduplicate into single `integrateVideoToMediaStore` in helpers |
