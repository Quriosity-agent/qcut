# FAL AI Client Refactoring Plan

**File**: `qcut/apps/web/src/lib/fal-ai-client.ts`
**Current Size**: 1,786 lines
**Target Size**: ~1,300 lines (main client) + modular utilities
**Priority**: Medium

---

## Pre-Refactoring: Create Backup

Before starting, create a backup of the original file:

```bash
cp qcut/apps/web/src/lib/fal-ai-client.ts qcut/apps/web/src/lib/fal-ai-client.ts.backup
```

---

## Overview

The `fal-ai-client.ts` file handles all FAL.ai API interactions for image generation, including file uploads, parameter conversion, and multi-model support. This refactoring extracts types and upload logic into separate modules.

---

## Current Structure (1,786 lines)

| Section | Lines | Content |
|---------|-------|---------|
| Type Definitions & Constants | 1-120 | Interfaces, error types, format constants |
| Validation Helpers | 120-220 | Aspect ratio, format, prompt validators |
| FalAIClient Class | 224-500 | Constructor, makeRequest, error parsing |
| File Upload Methods | 331-500 | uploadFileToFal, IPC fallback logic |
| Parameter Conversion | 503-900 | Model-specific settings conversion |
| Generation Methods | 900-1786 | generateImage, generateMultipleImages, Reve, Veo |

---

## Proposed Structure (3 files)

### File 1: `fal-ai/types.ts` (~150 lines)

All TypeScript interfaces and constants extracted for reuse.

```typescript
// Response types
export interface FalImageResponse {
  images: Array<{ url: string; content_type?: string }>;
  seed?: number;
  timings?: Record<string, number>;
}

export interface GenerationResult {
  success: boolean;
  imageUrl?: string;
  seed?: number;
  error?: string;
  model?: string;
}

// Upload error types
export class FalUploadError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'FalUploadError';
  }
}

// Constants
export const VALID_OUTPUT_FORMATS = ['jpeg', 'png', 'webp'] as const;
export type OutputFormat = typeof VALID_OUTPUT_FORMATS[number];

// Aspect ratio mappings
export const ASPECT_RATIO_MAP: Record<string, string> = {
  '1:1': 'square',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_9_16',
  // ... other mappings
};
```

**Why extract**: Types are referenced by UI components and can improve IntelliSense across the codebase.

---

### File 2: `fal-ai/upload.ts` (~350 lines)

File upload utilities with Electron IPC fallback.

```typescript
import { FalUploadError } from './types';

/**
 * Upload a file to FAL.ai storage with automatic CORS handling.
 * Uses Electron IPC as fallback when browser fetch fails.
 */
export async function uploadFileToFal(
  file: File | Blob,
  apiKey: string,
  options?: { contentType?: string }
): Promise<string> { ... }

/**
 * Upload an image file to FAL.ai storage.
 */
export async function uploadImageToFal(
  imageFile: File | Blob,
  apiKey: string
): Promise<string> { ... }

/**
 * Upload an audio file to FAL.ai storage.
 */
export async function uploadAudioToFal(
  audioFile: File | Blob,
  apiKey: string
): Promise<string> { ... }

/**
 * Upload a video file to FAL.ai storage.
 */
export async function uploadVideoToFal(
  videoFile: File | Blob,
  apiKey: string
): Promise<string> { ... }

/**
 * Check if Electron IPC is available for CORS bypass.
 */
function isElectronIPCAvailable(): boolean { ... }

/**
 * Upload via Electron IPC (bypasses CORS).
 */
async function uploadViaElectronIPC(
  file: File | Blob,
  apiKey: string
): Promise<string> { ... }
```

**Why extract**: Upload logic is self-contained and can be tested independently. Also reusable by other AI clients.

---

### File 3: `fal-ai/validation.ts` (~100 lines)

Validation helpers for API parameters.

```typescript
import { VALID_OUTPUT_FORMATS, ASPECT_RATIO_MAP } from './types';

/**
 * Normalize aspect ratio string to FAL.ai format.
 */
export function normalizeAspectRatio(ratio: string): string { ... }

/**
 * Convert image size dimensions to aspect ratio.
 */
export function imageSizeToAspectRatio(width: number, height: number): string { ... }

/**
 * Normalize output format to valid FAL.ai format.
 */
export function normalizeOutputFormat(format: string): string { ... }

/**
 * Validate Reve prompt (max 1500 chars).
 */
export function validateRevePrompt(prompt: string): boolean { ... }

/**
 * Validate number of images for Reve (1-4).
 */
export function validateReveNumImages(num: number): number { ... }
```

**Why extract**: Validation functions are pure and easily testable.

---

### File 4: `fal-ai/index.ts` (~30 lines)

Barrel file for clean imports.

```typescript
// Types
export * from './types';

// Upload utilities
export {
  uploadFileToFal,
  uploadImageToFal,
  uploadAudioToFal,
  uploadVideoToFal,
} from './upload';

// Validation
export {
  normalizeAspectRatio,
  imageSizeToAspectRatio,
  normalizeOutputFormat,
  validateRevePrompt,
  validateReveNumImages,
} from './validation';

// Main client (re-export)
export { FalAIClient } from './client';
```

---

### File 5: `fal-ai-client.ts` (~1,200 lines)

Main client focused on generation logic.

```typescript
import {
  FalImageResponse,
  GenerationResult,
  FalUploadError,
  VALID_OUTPUT_FORMATS,
} from './fal-ai/types';
import {
  uploadFileToFal,
  uploadImageToFal,
  uploadAudioToFal,
  uploadVideoToFal,
} from './fal-ai/upload';
import {
  normalizeAspectRatio,
  normalizeOutputFormat,
  validateRevePrompt,
} from './fal-ai/validation';

export class FalAIClient {
  private apiKey: string;

  constructor(apiKey: string) { ... }

  // HTTP request handler
  private async makeRequest<T>(endpoint: string, payload: unknown): Promise<T> { ... }

  // Parameter conversion (model-specific)
  private convertSettingsToParams(settings: ImageSettings, model: string): Record<string, unknown> { ... }

  // Generation methods
  async generateImage(prompt: string, settings: ImageSettings): Promise<GenerationResult> { ... }
  async generateMultipleImages(prompt: string, settings: ImageSettings, models: string[]): Promise<GenerationResult[]> { ... }

  // Reve-specific methods
  async reveTextToImage(prompt: string, options: ReveOptions): Promise<GenerationResult> { ... }
  async reveEditImage(imageUrl: string, prompt: string, options: ReveEditOptions): Promise<GenerationResult> { ... }

  // Veo 3.1 methods
  async veoGenerateVideo(prompt: string, options: VeoOptions): Promise<VideoGenerationResult> { ... }
}
```

---

## Implementation (3 Subtasks)

### Subtask 1: Extract Types (~10 min)

1. Create `apps/web/src/lib/fal-ai/types.ts`
2. Move all interfaces and constants from lines 1-120
3. Update imports in `fal-ai-client.ts`
4. Verify: `bun run check-types` passes

**Files changed**: 2
**Risk**: Low (no logic changes)

---

### Subtask 2: Extract Upload Logic (~20 min)

1. Create `apps/web/src/lib/fal-ai/upload.ts`
2. Move upload methods from lines 331-500
3. Move Electron IPC fallback logic
4. Update imports in `fal-ai-client.ts`
5. Verify: Test file upload in UI

**Files changed**: 2
**Risk**: Medium (IPC integration)

---

### Subtask 3: Extract Validation (~10 min)

1. Create `apps/web/src/lib/fal-ai/validation.ts`
2. Move validation helpers from lines 120-220
3. Create `apps/web/src/lib/fal-ai/index.ts` barrel
4. Update imports in `fal-ai-client.ts`
5. Verify: `bun run check-types` passes

**Files changed**: 3
**Risk**: Low (pure functions)

---

## Testing Checklist

### After Subtask 1 (Types)
- [ ] `bun run check-types` compiles without errors
- [ ] No runtime errors on app start

### After Subtask 2 (Upload)
- [ ] Image upload works in AI panel
- [ ] Audio upload works for avatar generation
- [ ] Video upload works for video-to-video
- [ ] Electron IPC fallback works (test in packaged app)

### After Subtask 3 (Validation)
- [ ] Aspect ratio normalization works
- [ ] Output format validation works
- [ ] Reve prompt validation works

### Full Integration
- [ ] Generate image with Imagen 4
- [ ] Generate image with FLUX
- [ ] Generate multiple images (parallel)
- [ ] Reve text-to-image
- [ ] Veo 3.1 video generation

---

## File Size Summary

| File | Before | After |
|------|--------|-------|
| `fal-ai-client.ts` | 1,786 | ~1,200 |
| `fal-ai/types.ts` | - | ~150 |
| `fal-ai/upload.ts` | - | ~350 |
| `fal-ai/validation.ts` | - | ~100 |
| `fal-ai/index.ts` | - | ~30 |
| **Total** | 1,786 | ~1,830 |

**Net change**: +44 lines (better organization, no reduction expected)

---

## Backward Compatibility

The main `fal-ai-client.ts` continues to export `FalAIClient` class. Existing imports will work unchanged:

```typescript
// Before and after - both work
import { FalAIClient } from '@/lib/fal-ai-client';
```

New modular imports are also available:

```typescript
// New option for specific utilities
import { uploadImageToFal } from '@/lib/fal-ai/upload';
import { normalizeAspectRatio } from '@/lib/fal-ai/validation';
```

---

## Post-Refactoring: Verification

### Verification Checklist

```bash
# Check TypeScript compilation
bun run check-types

# Run tests
bun run test

# Start dev server and test AI panel
bun run dev
```

### Cleanup

After all tests pass, remove the backup:

```bash
rm qcut/apps/web/src/lib/fal-ai-client.ts.backup
```

### Rollback (if needed)

```bash
# Remove new files
rm -rf qcut/apps/web/src/lib/fal-ai/

# Restore original
mv qcut/apps/web/src/lib/fal-ai-client.ts.backup qcut/apps/web/src/lib/fal-ai-client.ts
```

---

*Document created: 2025-12-10*
*Estimated time: ~40 minutes total*
*Author: Claude Code*
