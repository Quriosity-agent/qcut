# FAL AI Client Refactoring Plan

**File**: `qcut/apps/web/src/lib/fal-ai-client.ts`
**Current Size**: 1,806 lines
**Target Size**: ~800 lines (main client) + shared utilities
**Priority**: Medium
**Philosophy**: Long-term maintainability > scalability > performance > short-term gains

---

## Pre-Refactoring: Create Backup

Before starting, create a backup of the original file:

```bash
cp qcut/apps/web/src/lib/fal-ai-client.ts qcut/apps/web/src/lib/fal-ai-client.ts.backup
```

---

## Overview

The `fal-ai-client.ts` file handles all FAL.ai API interactions for image generation, including file uploads, parameter conversion, and multi-model support. This refactoring:

1. **Extracts reusable core utilities** to `lib/ai-video/core/` for sharing across ALL FAL clients
2. **Consolidates validation logic** into `lib/ai-video/validation/` for consistency
3. **Creates model-specific handlers** for better separation of concerns
4. **Eliminates code duplication** between `fal-ai-client.ts`, `image-edit-client.ts`, and `ai-video-client.ts`

---

## Current Structure Analysis (1,806 lines)

| Section | Lines | Content | Reuse Opportunity |
|---------|-------|---------|-------------------|
| Type Definitions | 1-60 | Interfaces, constants | Extract to shared types |
| Validation Helpers | 60-220 | Aspect ratio, format, prompt | **High**: Duplicated in ai-video validators |
| FalAIClient Class Core | 224-330 | Constructor, `makeRequest` | **High**: Duplicated in ai-video/core/fal-request.ts |
| File Upload Methods | 331-520 | `uploadFileToFal`, IPC logic | **High**: Can be shared across all clients |
| Parameter Conversion | 523-767 | Model-specific settings | Medium: Keep in client but modularize |
| Generation Methods | 769-900 | `generateWithModel`, multi-model | Keep in client |
| Veo 3.1 Methods | 1002-1312 | 6 Veo generation methods | Extract to generators/video.ts |
| Reve Methods | 1314-1470 | Text-to-image, Edit | Keep but use shared validation |
| Model Conversion | 1473-1710 | V3, V4, Nano, Flux converters | Extract to model-handlers/ |
| Exports | 1712-1806 | Singleton, helper functions | Simplify |

---

## Proposed Architecture (Code Reuse Focus)

### Phase 1: Consolidate Core FAL Utilities

**Goal**: Single source of truth for FAL API interactions.

#### File: `ai-video/core/fal-request.ts` (EXISTING - Extend)

Add missing functionality from `fal-ai-client.ts`:

```typescript
// Already exists:
export function getFalApiKey(): string | undefined;
export function generateJobId(): string;
export async function makeFalRequest(...): Promise<Response>;
export async function handleFalResponse(...): Promise<void>;

// ADD these from fal-ai-client.ts:
export const FAL_UPLOAD_URL = "https://fal.run/upload";

/**
 * Parse error response from FAL API into user-friendly message.
 * Handles: {error: string}, {detail: string|array}, {message: string}
 */
export function parseFalErrorResponse(errorData: unknown): string;
```

**Why**: `fal-ai-client.ts` has identical error parsing logic (lines 300-320). Consolidate to avoid drift.

---

#### File: `ai-video/core/fal-upload.ts` (NEW - ~200 lines)

Extract file upload logic that's ONLY in `fal-ai-client.ts`:

```typescript
/**
 * Upload a file to FAL.ai storage.
 * Automatically uses Electron IPC if available (CORS bypass).
 *
 * @param file - File to upload
 * @param fileType - Type hint for routing to correct IPC handler
 * @param apiKey - FAL API key
 * @returns URL of uploaded file
 */
export async function uploadFileToFal(
  file: File,
  fileType: "image" | "audio" | "video" | "asset",
  apiKey: string
): Promise<string>;

/**
 * Check if Electron IPC upload is available.
 */
export function isElectronUploadAvailable(fileType: string): boolean;

/**
 * Convenience wrappers with type-specific defaults.
 */
export const uploadImageToFal = (file: File, apiKey: string) =>
  uploadFileToFal(file, "image", apiKey);
export const uploadAudioToFal = (file: File, apiKey: string) =>
  uploadFileToFal(file, "audio", apiKey);
export const uploadVideoToFal = (file: File, apiKey: string) =>
  uploadFileToFal(file, "video", apiKey);
```

**Why**:
- `image-edit-client.ts` doesn't have upload logic - it should use this
- `ai-video-client.ts` doesn't have upload logic - it could use this for I2V
- Centralizes Electron IPC fallback logic in one place

---

### Phase 2: Consolidate Validation

#### File: `ai-video/validation/validators.ts` (EXISTING - Extend)

Add image-specific validators from `fal-ai-client.ts`:

```typescript
// Already exists: video-specific validators

// ADD from fal-ai-client.ts (lines 74-219):
export const VALID_OUTPUT_FORMATS = ["jpeg", "png", "webp"] as const;
export type OutputFormat = typeof VALID_OUTPUT_FORMATS[number];

export const ASPECT_RATIO_MAP: Record<string, string> = {
  square: "1:1",
  square_hd: "1:1",
  portrait_3_4: "3:4",
  // ...
};

/**
 * Normalize aspect ratio string (handles "16:9", "16_9", "landscape_16_9").
 */
export function normalizeAspectRatio(value?: string | null): string | undefined;

/**
 * Convert image size preset to aspect ratio.
 */
export function imageSizeToAspectRatio(imageSize: string | number | undefined): string;

/**
 * Normalize output format with fallback.
 */
export function normalizeOutputFormat(
  format?: string | null,
  fallback?: OutputFormat
): OutputFormat;

/**
 * Reve-specific validators (existing in fal-ai-client.ts lines 141-219).
 */
export function clampReveNumImages(value?: number): number;
export function truncateRevePrompt(prompt: string): string;
export function validateRevePrompt(prompt: string): void;
export function validateReveNumImages(value?: number): void;
```

**Why**: Validators are pure functions, easily testable, and reusable across:
- `fal-ai-client.ts` - image generation
- `image-edit-client.ts` - image editing (currently validates separately)
- Future image clients

---

### Phase 3: Extract Model-Specific Handlers

#### Directory: `lib/fal-ai/model-handlers/` (NEW)

**File: `v3-params.ts` (~50 lines)**
```typescript
export function convertV3Parameters(params: any): Record<string, unknown>;
```

**File: `v4-params.ts` (~80 lines)**
```typescript
export function convertV4Parameters(params: any): Record<string, unknown>;
```

**File: `nano-banana-params.ts` (~60 lines)**
```typescript
export function convertNanoBananaParameters(params: any): Record<string, unknown>;
```

**File: `flux-params.ts` (~70 lines)**
```typescript
export function convertFluxParameters(params: any): Record<string, unknown>;
```

**File: `index.ts` (~30 lines)**
```typescript
export * from './v3-params';
export * from './v4-params';
export * from './nano-banana-params';
export * from './flux-params';

export function convertParametersForModel(modelId: string, params: any) {
  switch (modelId) {
    case "seededit": return convertV3Parameters(params);
    case "seeddream-v4": return convertV4Parameters(params);
    case "nano-banana": return convertNanoBananaParameters(params);
    case "flux-kontext":
    case "flux-kontext-max": return convertFluxParameters(params);
    default: throw new Error(`Unknown model: ${modelId}`);
  }
}

export function detectModelVersion(modelId: string): "v3" | "v4" | "nano-banana" | "flux";
```

**Why**:
- Model parameter conversion is complex and model-specific
- Keeping them in separate files makes it easier to update when FAL changes API
- Can be shared with `image-edit-client.ts` (which currently duplicates some logic)

---

### Phase 4: Refactored Main Client

#### File: `fal-ai-client.ts` (~800 lines after refactoring)

```typescript
import {
  getFalApiKey,
  makeFalRequest,
  handleFalResponse,
  parseFalErrorResponse,
} from "./ai-video/core/fal-request";
import {
  uploadFileToFal,
  uploadImageToFal,
  uploadAudioToFal,
  uploadVideoToFal,
} from "./ai-video/core/fal-upload";
import {
  normalizeAspectRatio,
  imageSizeToAspectRatio,
  normalizeOutputFormat,
  validateRevePrompt,
  clampReveNumImages,
  truncateRevePrompt,
} from "./ai-video/validation/validators";
import {
  convertParametersForModel,
  detectModelVersion,
} from "./fal-ai/model-handlers";

// Types (minimal, client-specific only)
interface GenerationResult { ... }
interface GenerationSettings { ... }

// Client class (focused on orchestration, not implementation details)
class FalAIClient {
  private apiKey: string | null = null;

  constructor() { ... }

  // Core HTTP (delegates to shared utility)
  private async makeRequest<T>(endpoint: string, params: Record<string, unknown>): Promise<T> {
    const response = await makeFalRequest(endpoint, params);
    await handleFalResponse(response, "FalAIClient");
    return response.json();
  }

  // Upload methods (delegates to shared utility)
  async uploadImageToFal(file: File): Promise<string> {
    return uploadImageToFal(file, this.getApiKey());
  }

  // Settings conversion (uses shared validators)
  private convertSettingsToParams(model, prompt, settings): Record<string, any> {
    // Uses normalizeAspectRatio, imageSizeToAspectRatio, etc.
  }

  // Generation methods (remain here)
  async generateWithModel(...): Promise<GenerationResult> { ... }
  async generateWithMultipleModels(...): Promise<MultiModelGenerationResult> { ... }

  // Veo methods (remain here, could be extracted later)
  async generateVeo31FastTextToVideo(...): Promise<VideoGenerationResponse> { ... }
  // ... other Veo methods

  // Reve methods (use shared validators)
  async generateReveTextToImage(params: ReveTextToImageInput): Promise<ReveTextToImageOutput> {
    const sanitizedParams = {
      ...params,
      prompt: truncateRevePrompt(params.prompt),
      num_images: clampReveNumImages(params.num_images),
      output_format: normalizeOutputFormat(params.output_format, "png"),
    };
    // ...
  }
}

// Singleton and exports
export const falAIClient = new FalAIClient();
export { generateWithModel, generateWithMultipleModels, ... };
```

---

## Implementation Subtasks

### Subtask 1: Extend Core FAL Request Module (20 min)

1. Add `parseFalErrorResponse()` to `ai-video/core/fal-request.ts`
2. Update `ai-video/core/index.ts` exports
3. Verify: TypeScript compiles

**Risk**: Low (additive change)

---

### Subtask 2: Create FAL Upload Module (30 min)

1. Create `ai-video/core/fal-upload.ts`
2. Move upload logic from `fal-ai-client.ts` lines 331-520
3. Update `ai-video/core/index.ts` exports
4. Update `fal-ai-client.ts` to import from new module
5. Test: File upload in AI panel

**Risk**: Medium (Electron IPC integration)

---

### Subtask 3: Consolidate Validators (20 min)

1. Add image validators to `ai-video/validation/validators.ts`
2. Move: `normalizeAspectRatio`, `imageSizeToAspectRatio`, `normalizeOutputFormat`
3. Move: Reve validators (`clampReveNumImages`, `truncateRevePrompt`, etc.)
4. Update `fal-ai-client.ts` imports
5. Verify: TypeScript compiles

**Risk**: Low (pure functions)

---

### Subtask 4: Extract Model Handlers (25 min)

1. Create `lib/fal-ai/model-handlers/` directory
2. Extract: `convertV3Parameters`, `convertV4Parameters`, etc.
3. Create barrel file
4. Update `fal-ai-client.ts` imports
5. Verify: TypeScript compiles

**Risk**: Low (move only, no logic change)

---

### Subtask 5: Cleanup Main Client (15 min)

1. Remove duplicated code from `fal-ai-client.ts`
2. Update all imports to use shared modules
3. Verify: Full test suite passes
4. Remove backup file

**Risk**: Low (imports only)

---

## File Size Summary

| File | Before | After |
|------|--------|-------|
| `fal-ai-client.ts` | 1,806 | ~800 |
| `ai-video/core/fal-request.ts` | 163 | ~200 |
| `ai-video/core/fal-upload.ts` (NEW) | - | ~200 |
| `ai-video/validation/validators.ts` | 346 | ~450 |
| `fal-ai/model-handlers/index.ts` (NEW) | - | ~30 |
| `fal-ai/model-handlers/v3-params.ts` (NEW) | - | ~50 |
| `fal-ai/model-handlers/v4-params.ts` (NEW) | - | ~80 |
| `fal-ai/model-handlers/nano-banana-params.ts` (NEW) | - | ~60 |
| `fal-ai/model-handlers/flux-params.ts` (NEW) | - | ~70 |
| **Total** | 2,315 | ~1,940 |

**Net change**: -375 lines through deduplication
**Main file reduction**: 1,006 lines (56%)

---

## Code Reuse Benefits

### Immediate Reuse Opportunities

| Shared Module | Used By |
|---------------|---------|
| `ai-video/core/fal-request.ts` | `fal-ai-client.ts`, `ai-video-client.ts`, `image-edit-client.ts` |
| `ai-video/core/fal-upload.ts` | `fal-ai-client.ts`, future image-edit upload |
| `ai-video/validation/validators.ts` | All FAL clients |
| `fal-ai/model-handlers/` | `fal-ai-client.ts`, `image-edit-client.ts` |

### Future Consolidation (Out of Scope)

After this refactoring, consider:

1. **Unify `image-edit-client.ts`** to use shared modules (separate task)
2. **Create `FalBaseClient` class** that all FAL clients extend
3. **Consolidate model endpoints** into single source of truth

---

## Testing Checklist

### After Subtask 1 (Core Request)
- [ ] `bun run check-types` passes
- [ ] Existing ai-video tests pass

### After Subtask 2 (Upload)
- [ ] Image upload works in AI panel
- [ ] Audio upload works for avatar generation
- [ ] Electron IPC fallback works

### After Subtask 3 (Validators)
- [ ] Aspect ratio normalization works
- [ ] Output format validation works
- [ ] Reve validation works

### After Subtask 4 (Model Handlers)
- [ ] Image edit with SeedEdit v3 works
- [ ] Image edit with SeedDream v4 works
- [ ] Image edit with Nano Banana works

### Full Integration
- [ ] Generate image with Imagen 4
- [ ] Generate image with FLUX
- [ ] Generate multiple images (parallel)
- [ ] Reve text-to-image
- [ ] Veo 3.1 video generation
- [ ] App builds successfully

---

## Backward Compatibility

All existing imports continue to work:

```typescript
// Before and after - unchanged
import { FalAIClient, generateWithModel } from '@/lib/fal-ai-client';
import { convertParametersForModel } from '@/lib/fal-ai-client';
```

New modular imports available:

```typescript
// New option for shared utilities
import { uploadFileToFal } from '@/lib/ai-video/core/fal-upload';
import { normalizeAspectRatio } from '@/lib/ai-video/validation/validators';
import { convertV4Parameters } from '@/lib/fal-ai/model-handlers';
```

---

## Rollback Plan

```bash
# Remove new files
rm -rf qcut/apps/web/src/lib/fal-ai/

# Restore validators (git checkout if needed)
git checkout qcut/apps/web/src/lib/ai-video/validation/validators.ts
git checkout qcut/apps/web/src/lib/ai-video/core/fal-request.ts

# Restore original
mv qcut/apps/web/src/lib/fal-ai-client.ts.backup qcut/apps/web/src/lib/fal-ai-client.ts
```

---

## Long-Term Benefits

1. **Single Source of Truth**: FAL API interaction logic lives in one place
2. **Reduced Duplication**: Validators and converters shared across 3+ files
3. **Easier Testing**: Pure validation functions can be unit tested
4. **Maintainability**: Model-specific logic isolated for easy updates
5. **Onboarding**: New developers can understand structure more easily
6. **Future-Proof**: Adding new models only requires new handler file

---

*Document created: 2025-12-10*
*Updated: 2025-12-10 (focus on code reuse and long-term maintainability)*
*Author: Claude Code*
