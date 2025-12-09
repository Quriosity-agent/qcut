# AI Video Client Refactoring Plan

**File**: `qcut/apps/web/src/lib/ai-video-client.ts`
**Current Size**: 4035 lines
**Goal**: Long-term maintainability over short-term gains

---

## Pre-Implementation Checklist

### Step 0: Create Backup Before Starting
```bash
# Create backup of the original file
cp qcut/apps/web/src/lib/ai-video-client.ts qcut/apps/web/src/lib/ai-video-client.ts.backup

# Also backup the test files
cp qcut/apps/web/src/lib/__tests__/ai-video-client.test.ts qcut/apps/web/src/lib/__tests__/ai-video-client.test.ts.backup
cp qcut/apps/web/src/lib/__tests__/ai-video-client-additional.test.ts qcut/apps/web/src/lib/__tests__/ai-video-client-additional.test.ts.backup
```

---

## Architecture Analysis

### Current Dependencies (Files Importing from ai-video-client.ts)
1. `use-ai-generation.ts` - Main consumer, imports 15+ functions
2. `fal-ai-client.ts` - Imports `VideoGenerationResponse` type only
3. `ai-video-client.test.ts` - Test file
4. `ai-video-client-additional.test.ts` - Additional test file

### Existing Patterns to Follow

The codebase already has well-established patterns for AI functionality:

1. **Types are centralized in `ai/types/ai-types.ts`** (~420 lines)
   - Already contains `AIModel`, `GeneratedVideo`, `ProgressCallback`, etc.
   - We should ADD new types here, not create a separate types file

2. **Constants are centralized in `ai/constants/ai-constants.ts`** (~1000+ lines)
   - Contains `AI_MODELS`, `FAL_API_BASE`, `ERROR_MESSAGES`
   - Already re-exports from other constant files

3. **`fal-ai-client.ts` exists** (~1800 lines)
   - Has established patterns for FAL API calls
   - Contains `FalAIClient` class with `makeRequest`, `uploadFileToFal`
   - We should consider merging common logic here

4. **Hooks are in `ai/hooks/`**
   - `use-ai-generation.ts` is the main consumer
   - Already handles progress, polling, and state management

---

## Long-Term Maintainability Principles

### Principle 1: Align with Existing Architecture
- DO NOT create new type files; extend `ai/types/ai-types.ts`
- DO NOT duplicate FAL API patterns; reuse from `fal-ai-client.ts`
- DO NOT create parallel constant files; extend `ai/constants/ai-constants.ts`

### Principle 2: Single Responsibility
Each module should have ONE reason to change:
- Model-specific logic changes only when that model's API changes
- Validation logic changes only when constraints change
- HTTP layer changes only when FAL API patterns change

### Principle 3: Dependency Inversion
- High-level modules (generators) should not depend on low-level modules (HTTP)
- Both should depend on abstractions (interfaces/types)

### Principle 4: Open/Closed Principle
- Easy to ADD new models without modifying existing code
- Model registration should be declarative, not imperative

---

## Proposed File Structure

```
qcut/apps/web/src/lib/
├── ai-video-client.ts.backup           # Original file backup (keep until migration complete)
├── ai-video/
│   ├── index.ts                        # Barrel file - maintains backward compatibility
│   ├── core/
│   │   ├── fal-request.ts              # FAL API request helpers (extracted from fal-ai-client.ts patterns)
│   │   ├── polling.ts                  # Queue polling logic (~200 lines)
│   │   └── streaming.ts                # Video streaming download (~100 lines)
│   ├── generators/
│   │   ├── base-generator.ts           # Abstract base class with common patterns (~150 lines)
│   │   ├── text-to-video.ts            # Text-to-video generators (~400 lines)
│   │   ├── image-to-video.ts           # Image-to-video generators (~500 lines)
│   │   ├── avatar.ts                   # Avatar generation (~350 lines)
│   │   ├── upscale.ts                  # Video upscaling (~200 lines)
│   │   └── image.ts                    # Seeddream image generation (~150 lines)
│   ├── models/
│   │   └── sora2.ts                    # Sora 2 specific logic (~200 lines)
│   ├── validation/
│   │   └── validators.ts               # All validation functions (~250 lines)
│   └── api.ts                          # High-level API (getAvailableModels, estimateCost) (~100 lines)
```

**Estimated Total**: ~2,400 lines (40% reduction through consolidation and reuse)

---

## Subtasks

### Phase 1: Foundation (Must be done first)

#### Task 1.1: Create Backup Files
**Priority**: CRITICAL
**Effort**: 5 minutes

```bash
# Run these commands before making ANY changes
cp qcut/apps/web/src/lib/ai-video-client.ts qcut/apps/web/src/lib/ai-video-client.ts.backup
cp qcut/apps/web/src/lib/__tests__/ai-video-client.test.ts qcut/apps/web/src/lib/__tests__/ai-video-client.test.ts.backup
```

---

#### Task 1.2: Extend Existing Types in `ai-types.ts`
**Priority**: HIGH
**Effort**: 30 minutes
**File**: `components/editor/media-panel/views/ai/types/ai-types.ts`

Add types that are currently only in `ai-video-client.ts`:

```typescript
// Add to ai-types.ts (they don't exist there yet)

// Sora 2 Types
export type Sora2ModelType =
  | "text-to-video"
  | "text-to-video-pro"
  | "image-to-video"
  | "image-to-video-pro"
  | "video-to-video-remix";

export type Sora2BasePayload = {
  prompt: string;
  duration: number;
  aspect_ratio: string;
};

export type Sora2Payload =
  | { type: "text-to-video"; /* ... */ }
  | { type: "text-to-video-pro"; /* ... */ }
  // ... rest of discriminated union

// Request Types (move from ai-video-client.ts)
export interface VideoGenerationRequest {
  prompt: string;
  model: string;
  resolution?: string;
  duration?: number;
  aspect_ratio?: string;
}

export interface ImageToVideoRequest {
  image: File;
  model: string;
  prompt?: string;
  resolution?: string;
  duration?: number;
  aspect_ratio?: string;
}

// ... all other request interfaces
```

**Why this approach**:
- Single source of truth for types
- Existing imports in `use-ai-generation.ts` already reference this file
- Reduces circular dependency risk

---

#### Task 1.3: Add Validation Constants to `ai-constants.ts`
**Priority**: HIGH
**Effort**: 20 minutes
**File**: `components/editor/media-panel/views/ai/constants/ai-constants.ts`

Move validation constants:

```typescript
// Add to ai-constants.ts

// LTX Video 2.0 Constraints
export const LTXV2_FAST_CONFIG = {
  DURATIONS: [6, 8, 10, 12, 14, 16, 18, 20] as const,
  RESOLUTIONS: {
    STANDARD: ["1080p", "1440p", "2160p"] as const,
    EXTENDED: ["1080p"] as const, // For >10s videos
  },
  FPS_OPTIONS: {
    STANDARD: [25, 50] as const,
    EXTENDED: [25] as const, // For >10s videos
  },
  EXTENDED_DURATION_THRESHOLD: 10,
} as const;

// (Already exists but verify these are present)
export const LTXV2_STANDARD_T2V_DURATIONS = [6, 8, 10] as const;
export const LTXV2_STANDARD_I2V_DURATIONS = [6, 8, 10] as const;
export const LTXV2_STANDARD_I2V_RESOLUTIONS = ["1080p", "1440p", "2160p"] as const;
```

---

### Phase 2: Core Infrastructure

#### Task 2.1: Create `ai-video/core/fal-request.ts`
**Priority**: HIGH
**Effort**: 1 hour
**Lines**: ~150

Extract and unify FAL API request patterns from both `ai-video-client.ts` and `fal-ai-client.ts`:

```typescript
/**
 * Core FAL API Request Utilities
 *
 * Provides a consistent interface for making FAL AI API requests.
 * Consolidates patterns from ai-video-client.ts and fal-ai-client.ts.
 */

import { handleAIServiceError } from "@/lib/error-handler";

const FAL_API_BASE = "https://fal.run";

/**
 * Retrieves FAL API key from environment.
 * Reads lazily to support test stubs.
 */
export function getFalApiKey(): string | undefined {
  return import.meta.env.VITE_FAL_API_KEY;
}

/**
 * Makes an authenticated request to FAL AI API.
 *
 * @param endpoint - FAL endpoint path (e.g., "fal-ai/kling-video/v2.6/pro/text-to-video")
 * @param payload - Request payload
 * @param options - Optional request configuration
 * @returns Parsed JSON response
 * @throws Error with user-friendly message on failure
 */
export async function makeFalRequest<T = unknown>(
  endpoint: string,
  payload: Record<string, unknown>,
  options?: {
    timeout?: number;
    signal?: AbortSignal;
    queueMode?: boolean;
  }
): Promise<T> {
  const apiKey = getFalApiKey();
  if (!apiKey) {
    throw new Error(
      "FAL API key not configured. Please set VITE_FAL_API_KEY in your environment variables."
    );
  }

  const headers: Record<string, string> = {
    "Authorization": `Key ${apiKey}`,
    "Content-Type": "application/json",
  };

  // Add queue headers if queue mode requested
  if (options?.queueMode) {
    headers["X-Fal-Queue"] = "true";
  }

  const url = endpoint.startsWith("https://")
    ? endpoint
    : `${FAL_API_BASE}/${endpoint}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw createFalError(response, errorData, endpoint);
  }

  return response.json();
}

/**
 * Creates a user-friendly error from FAL API response.
 */
function createFalError(
  response: Response,
  errorData: unknown,
  endpoint: string
): Error {
  // ... error formatting logic from handleQueueError
}

/**
 * Generates a unique job ID for tracking.
 */
export function generateJobId(): string {
  return `job_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
}
```

**Why this approach**:
- Eliminates duplicated fetch logic across generators
- Centralizes error handling
- Makes it easy to add features like retry, caching, or logging

---

#### Task 2.2: Create `ai-video/core/polling.ts`
**Priority**: HIGH
**Effort**: 45 minutes
**Lines**: ~200

Extract polling logic:

```typescript
/**
 * FAL Queue Polling Utilities
 *
 * Handles long-running FAL AI job status polling with progress updates.
 */

import { makeFalRequest, getFalApiKey, generateJobId } from "./fal-request";
import type { VideoGenerationResponse, ProgressCallback } from "@/components/editor/media-panel/views/ai/types/ai-types";

const FAL_API_BASE = "https://fal.run";

interface QueueStatus {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  queue_position?: number;
  estimated_time?: number;
  error?: string;
  logs?: string[];
}

/**
 * Polls FAL queue until job completes or fails.
 *
 * @param requestId - FAL request ID from queue submission
 * @param options - Polling configuration
 * @returns Final generation result
 */
export async function pollQueueStatus(
  requestId: string,
  options: {
    endpoint: string;
    startTime: number;
    onProgress?: ProgressCallback;
    jobId?: string;
    modelName?: string;
    maxAttempts?: number;
    pollIntervalMs?: number;
  }
): Promise<VideoGenerationResponse> {
  const {
    endpoint,
    startTime,
    onProgress,
    jobId = generateJobId(),
    modelName = "AI Model",
    maxAttempts = 60,
    pollIntervalMs = 5000,
  } = options;

  // ... polling implementation
}

/**
 * Maps FAL queue status to user-friendly progress format.
 */
export function mapQueueStatusToProgress(
  status: QueueStatus,
  elapsedTime: number
): {
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  message?: string;
  elapsedTime?: number;
  estimatedTime?: number;
  logs?: string[];
} {
  // ... existing implementation
}
```

---

#### Task 2.3: Create `ai-video/core/streaming.ts`
**Priority**: MEDIUM
**Effort**: 30 minutes
**Lines**: ~100

Extract video streaming:

```typescript
/**
 * Video Streaming Download Utilities
 *
 * Handles large video downloads without memory spikes.
 */

export interface StreamOptions {
  downloadToMemory?: boolean;
  onDataReceived?: (data: Uint8Array) => void;
  onComplete?: (totalData: Uint8Array) => void;
}

/**
 * Downloads video using streaming API.
 *
 * @param videoUrl - URL to download from
 * @param options - Download callbacks
 * @returns Complete video as Uint8Array
 */
export async function streamVideoDownload(
  videoUrl: string,
  options: StreamOptions
): Promise<Uint8Array> {
  // ... existing implementation
}
```

---

### Phase 3: Validation Layer

#### Task 3.1: Create `ai-video/validation/validators.ts`
**Priority**: HIGH
**Effort**: 1 hour
**Lines**: ~250

Consolidate all validation functions:

```typescript
/**
 * AI Video Generation Validators
 *
 * Centralized validation for all AI video parameters.
 * Each validator throws descriptive errors on failure.
 */

import {
  ERROR_MESSAGES,
  LTXV2_FAST_CONFIG,
  LTXV2_STANDARD_T2V_DURATIONS,
} from "@/components/editor/media-panel/views/ai/constants/ai-constants";

// ================================
// Hailuo 2.3 Validators
// ================================

export function validateHailuo23Prompt(prompt: string, modelId: string): void {
  const maxLengths: Record<string, number> = {
    hailuo23_standard_t2v: 1500,
    hailuo23_pro_t2v: 2000,
  };

  const maxLength = maxLengths[modelId];
  if (maxLength && prompt.length > maxLength) {
    throw new Error(
      `Prompt too long for ${modelId}. Maximum ${maxLength} characters allowed (current: ${prompt.length})`
    );
  }
}

export function isHailuo23TextToVideo(modelId: string): boolean {
  return modelId === "hailuo23_standard_t2v" || modelId === "hailuo23_pro_t2v";
}

// ================================
// Vidu Q2 Validators
// ================================

export function validateViduQ2Prompt(prompt: string): void {
  if (prompt.length > 3000) {
    throw new Error(
      `Prompt too long for Vidu Q2. Maximum 3000 characters allowed (current: ${prompt.length})`
    );
  }
}

export function validateViduQ2Duration(duration: number): void {
  if (duration < 2 || duration > 8) {
    throw new Error(ERROR_MESSAGES.VIDU_Q2_INVALID_DURATION);
  }
}

// ================================
// LTX Video 2.0 Validators
// ================================

export function validateLTXV2Resolution(resolution: string): void {
  if (!["1080p", "1440p", "2160p"].includes(resolution)) {
    throw new Error(ERROR_MESSAGES.LTXV2_INVALID_RESOLUTION);
  }
}

// ... rest of validators

// ================================
// Kling Avatar v2 Validators
// ================================

export function validateKlingAvatarV2Audio(
  audioFile: File,
  audioDuration?: number
): string | null {
  const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
  const MIN_DURATION_SEC = 2;
  const MAX_DURATION_SEC = 60;

  if (audioFile.size > MAX_SIZE_BYTES) {
    return ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LARGE;
  }

  if (audioDuration !== undefined) {
    if (audioDuration < MIN_DURATION_SEC) {
      return ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_SHORT;
    }
    if (audioDuration > MAX_DURATION_SEC) {
      return ERROR_MESSAGES.KLING_AVATAR_V2_AUDIO_TOO_LONG;
    }
  }

  return null;
}
```

**Why separate validation**:
- Easy to unit test validation rules independently
- Validators can be reused in UI for client-side validation
- Single place to update when API constraints change

---

### Phase 4: Model-Specific Logic

#### Task 4.1: Create `ai-video/models/sora2.ts`
**Priority**: MEDIUM
**Effort**: 45 minutes
**Lines**: ~200

Extract Sora 2 specific logic:

```typescript
/**
 * Sora 2 Model Utilities
 *
 * Handles Sora 2 specific parameter conversion and response parsing.
 */

import type { Sora2ModelType, Sora2Payload, Sora2Duration } from "@/components/editor/media-panel/views/ai/types/ai-types";

/**
 * Checks if a model ID is a Sora 2 model.
 */
export function isSora2Model(modelId: string): boolean {
  return modelId.startsWith("sora2_");
}

/**
 * Gets the specific Sora 2 model type from model ID.
 */
export function getSora2ModelType(modelId: string): Sora2ModelType | null {
  const typeMap: Record<string, Sora2ModelType> = {
    sora2_text_to_video: "text-to-video",
    sora2_text_to_video_pro: "text-to-video-pro",
    sora2_image_to_video: "image-to-video",
    sora2_image_to_video_pro: "image-to-video-pro",
    sora2_video_to_video_remix: "video-to-video-remix",
  };
  return typeMap[modelId] ?? null;
}

/**
 * Converts parameters for Sora 2 models.
 * Uses exhaustive type checking to ensure all model types are handled.
 */
export function convertSora2Parameters(
  params: Sora2InputParams,
  modelType: Sora2ModelType
): Sora2Payload {
  // ... existing implementation with exhaustiveness check
}

/**
 * Parses Sora 2 API response format.
 */
export function parseSora2Response(
  response: unknown,
  requestedDuration: Sora2Duration,
  requestedResolution?: string,
  requestedAspectRatio?: string
): {
  videoUrl: string;
  videoId: string;
  duration: Sora2Duration;
  resolution: string;
  aspectRatio: string;
} {
  // ... existing implementation
}
```

---

### Phase 5: Generator Modules

#### Task 5.1: Create `ai-video/generators/base-generator.ts`
**Priority**: HIGH
**Effort**: 1 hour
**Lines**: ~150

Create abstract base with common patterns:

```typescript
/**
 * Base Video Generator
 *
 * Provides common functionality for all video generators.
 * Extend this class to create new generator types.
 */

import { makeFalRequest, generateJobId, getFalApiKey } from "../core/fal-request";
import { handleAIServiceError } from "@/lib/error-handler";
import { AI_MODELS } from "@/components/editor/media-panel/views/ai/constants/ai-constants";
import type { AIModel, VideoGenerationResponse } from "@/components/editor/media-panel/views/ai/types/ai-types";

/**
 * Gets model configuration from centralized registry.
 */
export function getModelConfig(modelId: string): AIModel | undefined {
  return AI_MODELS.find((m) => m.id === modelId);
}

/**
 * Converts a File to base64 data URL.
 */
export async function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Builds a standard video generation response.
 */
export function buildVideoResponse(
  jobId: string,
  modelId: string,
  result: { video?: { url?: string }; video_url?: string; url?: string },
  elapsedTime?: number
): VideoGenerationResponse {
  return {
    job_id: jobId,
    status: "completed",
    message: `Video generated successfully with ${modelId}`,
    estimated_time: elapsedTime ?? 0,
    video_url: result.video?.url ?? result.video_url ?? result.url,
    video_data: result,
  };
}

/**
 * Wraps generator execution with error handling.
 */
export async function withErrorHandling<T>(
  operation: string,
  metadata: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    handleAIServiceError(error, operation, metadata);
    throw error;
  }
}
```

---

#### Task 5.2: Create `ai-video/generators/text-to-video.ts`
**Priority**: HIGH
**Effort**: 2 hours
**Lines**: ~400

```typescript
/**
 * Text-to-Video Generators
 *
 * Functions for generating videos from text prompts.
 */

import { makeFalRequest, generateJobId } from "../core/fal-request";
import { pollQueueStatus } from "../core/polling";
import { streamVideoDownload, type StreamOptions } from "../core/streaming";
import { getModelConfig, fileToDataURL, buildVideoResponse, withErrorHandling } from "./base-generator";
import { isSora2Model, getSora2ModelType, convertSora2Parameters, parseSora2Response } from "../models/sora2";
import { validateHailuo23Prompt, isHailuo23TextToVideo, validateLTXV2T2VDuration } from "../validation/validators";
import type {
  VideoGenerationRequest,
  VideoGenerationResponse,
  ProgressCallback,
  LTXV2T2VRequest,
  TextToVideoRequest,
} from "@/components/editor/media-panel/views/ai/types/ai-types";

/**
 * Generates AI video from text prompt.
 *
 * Supports queue mode for long-running jobs with progress callbacks.
 * Handles model-specific parameter conversion automatically.
 */
export async function generateVideo(
  request: VideoGenerationRequest,
  onProgress?: ProgressCallback,
  downloadOptions?: StreamOptions
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "AI Video Generation",
    { operation: "generateVideo", model: request.model },
    async () => {
      const modelConfig = getModelConfig(request.model);
      if (!modelConfig) {
        throw new Error(`Unknown model: ${request.model}`);
      }

      const endpoint = modelConfig.endpoints.text_to_video;
      if (!endpoint) {
        throw new Error(`Model ${request.model} does not support text-to-video generation`);
      }

      // Build payload with model-specific handling
      const payload = buildTextToVideoPayload(request, modelConfig);

      // ... rest of implementation (queue submission, polling, etc.)
    }
  );
}

/**
 * Generates video using Hailuo 2.3 text-to-video models.
 */
export async function generateVideoFromText(
  request: TextToVideoRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate video from text",
    { operation: "generateVideoFromText", model: request.model },
    async () => {
      // ... implementation
    }
  );
}

/**
 * Generates video with LTX Video 2.0.
 */
export async function generateLTXV2Video(
  request: LTXV2T2VRequest
): Promise<VideoGenerationResponse> {
  return withErrorHandling(
    "Generate LTX Video 2.0 video",
    { operation: "generateLTXV2Video", model: request.model },
    async () => {
      // ... implementation
    }
  );
}

// Private helpers

function buildTextToVideoPayload(
  request: VideoGenerationRequest,
  modelConfig: AIModel
): Record<string, unknown> {
  // Handle Sora 2 models
  if (isSora2Model(request.model)) {
    const modelType = getSora2ModelType(request.model);
    if (modelType) {
      const sora2Payload = convertSora2Parameters(/* ... */);
      const { type, ...apiPayload } = sora2Payload;
      return apiPayload;
    }
  }

  // Standard payload building
  const payload: Record<string, unknown> = {
    prompt: request.prompt,
    ...modelConfig.default_params,
    ...(request.duration && { duration: request.duration }),
    ...(request.resolution && { resolution: request.resolution }),
  };

  // Model-specific adjustments
  applyModelSpecificAdjustments(payload, request.model, modelConfig);

  return payload;
}

function applyModelSpecificAdjustments(
  payload: Record<string, unknown>,
  modelId: string,
  modelConfig: AIModel
): void {
  // Hailuo duration format
  if (modelId === "hailuo" || modelId === "hailuo_pro") {
    const duration = (payload.duration as number) || 6;
    payload.duration = duration >= 10 ? "10" : "6";
    payload.resolution = undefined;
  }

  // WAN resolution validation
  if (modelId === "wan_turbo") {
    const validResolutions = ["480p", "580p", "720p"];
    if (!validResolutions.includes(payload.resolution as string)) {
      payload.resolution = "720p";
    }
  }

  // ... other model-specific logic
}
```

---

#### Task 5.3-5.6: Create Remaining Generator Files
**Priority**: MEDIUM
**Effort**: 4 hours total

Following the same pattern as text-to-video:

- `image-to-video.ts` (~500 lines) - All I2V generators
- `avatar.ts` (~350 lines) - Avatar generation
- `upscale.ts` (~200 lines) - Video upscaling
- `image.ts` (~150 lines) - Seeddream image generation

---

### Phase 6: API Layer

#### Task 6.1: Create `ai-video/api.ts`
**Priority**: LOW
**Effort**: 30 minutes
**Lines**: ~100

```typescript
/**
 * High-Level AI Video API
 *
 * Provides utility functions for model discovery and cost estimation.
 */

import { AI_MODELS } from "@/components/editor/media-panel/views/ai/constants/ai-constants";
import { getFalApiKey } from "./core/fal-request";
import { getModelConfig } from "./generators/base-generator";
import type {
  ModelsResponse,
  CostEstimate,
  VideoGenerationRequest,
  GenerationStatus,
} from "@/components/editor/media-panel/views/ai/types/ai-types";

/**
 * Checks if FAL API key is configured.
 */
export async function isApiAvailable(): Promise<boolean> {
  return !!getFalApiKey();
}

/**
 * Returns all available AI models with formatted pricing.
 */
export async function getAvailableModels(): Promise<ModelsResponse> {
  return {
    models: AI_MODELS.map((model) => ({
      ...model,
      price: `$${model.price}`,
    })),
  };
}

/**
 * Estimates cost for video generation.
 */
export async function estimateCost(
  request: VideoGenerationRequest
): Promise<CostEstimate> {
  const modelConfig = getModelConfig(request.model);
  const modelInfo = modelConfig
    ? { base_cost: parseFloat(modelConfig.price), max_duration: modelConfig.max_duration }
    : { base_cost: 1.0, max_duration: 30 };

  const actualDuration = Math.min(request.duration || 5, modelInfo.max_duration);
  const durationMultiplier = Math.max(1, actualDuration / 5);

  return {
    model: request.model,
    duration: actualDuration,
    base_cost: modelInfo.base_cost,
    estimated_cost: modelInfo.base_cost * durationMultiplier,
    currency: "USD",
  };
}

/**
 * Gets generation status (mock for backward compatibility).
 * @deprecated Use FAL SDK's built-in polling instead
 */
export async function getGenerationStatus(jobId: string): Promise<GenerationStatus> {
  return {
    job_id: jobId,
    status: "completed",
    progress: 100,
    video_url: undefined,
    error: undefined,
  };
}

/**
 * Converts API errors to user-friendly messages.
 */
export function handleApiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "An unknown error occurred";
}
```

---

### Phase 7: Barrel File

#### Task 7.1: Create `ai-video/index.ts`
**Priority**: CRITICAL (for backward compatibility)
**Effort**: 30 minutes
**Lines**: ~50

```typescript
/**
 * AI Video Client
 *
 * Barrel file maintaining backward compatibility with original ai-video-client.ts.
 * All imports from "@/lib/ai-video-client" should continue to work.
 */

// Re-export types (now from centralized location)
export type {
  VideoGenerationRequest,
  ImageToVideoRequest,
  TextToVideoRequest,
  ViduQ2I2VRequest,
  LTXV2T2VRequest,
  LTXV2I2VRequest,
  AvatarVideoRequest,
  VideoGenerationResponse,
  GenerationStatus,
  ModelsResponse,
  CostEstimate,
  ProgressCallback,
  SeedanceI2VRequest,
  KlingI2VRequest,
  Kling26I2VRequest,
  KlingO1V2VRequest,
  KlingO1Ref2VideoRequest,
  WAN25I2VRequest,
  ByteDanceUpscaleRequest,
  FlashVSRUpscaleRequest,
  TopazUpscaleRequest,
} from "@/components/editor/media-panel/views/ai/types/ai-types";

// Text-to-Video Generators
export {
  generateVideo,
  generateVideoFromText,
  generateLTXV2Video,
} from "./generators/text-to-video";

// Image-to-Video Generators
export {
  generateVideoFromImage,
  generateViduQ2Video,
  generateLTXV2ImageVideo,
  generateSeedanceVideo,
  generateKlingImageVideo,
  generateKling26ImageVideo,
  generateKlingO1Video,
  generateKlingO1RefVideo,
  generateWAN25ImageVideo,
} from "./generators/image-to-video";

// Avatar Generators
export { generateAvatarVideo } from "./generators/avatar";

// Upscalers
export {
  upscaleByteDanceVideo,
  upscaleFlashVSRVideo,
  upscaleTopazVideo,
} from "./generators/upscale";

// Image Generators (Seeddream)
export {
  generateSeeddream45Image,
  editSeeddream45Image,
  uploadImageForSeeddream45Edit,
} from "./generators/image";

// API Utilities
export {
  isApiAvailable,
  getAvailableModels,
  estimateCost,
  getGenerationStatus,
  handleApiError,
} from "./api";
```

---

### Phase 8: Migration

#### Task 8.1: Update Import Paths
**Priority**: HIGH
**Effort**: 30 minutes

Update consuming files to use new barrel file:

```typescript
// Before (in use-ai-generation.ts)
import { generateVideo, ... } from "@/lib/ai-video-client";

// After (same import path if we create alias, OR)
import { generateVideo, ... } from "@/lib/ai-video";
```

**Option A**: Create `ai-video-client.ts` as a re-export
```typescript
// ai-video-client.ts (new content)
export * from "./ai-video";
```

**Option B**: Update all imports (4 files to update)

---

#### Task 8.2: Update Tests
**Priority**: HIGH
**Effort**: 1 hour

Update test imports and add new tests for extracted modules.

---

#### Task 8.3: Verify and Delete Backup
**Priority**: FINAL
**Effort**: 30 minutes

```bash
# After full verification
bun run test
bun run lint:clean
bun run check-types

# If all pass, remove backups
rm qcut/apps/web/src/lib/ai-video-client.ts.backup
rm qcut/apps/web/src/lib/__tests__/ai-video-client.test.ts.backup
```

---

## Code Reuse Summary

### Pattern 1: Unified FAL Request Handler
**Before**: Each generator had its own fetch logic (~50 lines × 15 generators = 750 lines)
**After**: Single `makeFalRequest()` function (~50 lines, reused everywhere)
**Savings**: ~700 lines

### Pattern 2: Common Error Handling
**Before**: Error handling duplicated in each generator (~20 lines × 15 = 300 lines)
**After**: `withErrorHandling()` wrapper (~15 lines, reused everywhere)
**Savings**: ~285 lines

### Pattern 3: Validation Functions
**Before**: Inline validation scattered across generators
**After**: Centralized validators that can be reused in UI and API layers

### Pattern 4: Response Building
**Before**: Response object built manually in each function
**After**: `buildVideoResponse()` helper
**Savings**: ~100 lines

---

## Estimated Final Line Counts

| File | Lines | Purpose |
|------|-------|---------|
| `core/fal-request.ts` | ~150 | FAL API utilities |
| `core/polling.ts` | ~200 | Queue polling |
| `core/streaming.ts` | ~100 | Video streaming |
| `generators/base-generator.ts` | ~150 | Common patterns |
| `generators/text-to-video.ts` | ~400 | T2V generators |
| `generators/image-to-video.ts` | ~500 | I2V generators |
| `generators/avatar.ts` | ~350 | Avatar generation |
| `generators/upscale.ts` | ~200 | Video upscaling |
| `generators/image.ts` | ~150 | Image generation |
| `models/sora2.ts` | ~200 | Sora 2 logic |
| `validation/validators.ts` | ~250 | Validation functions |
| `api.ts` | ~100 | High-level API |
| `index.ts` | ~50 | Barrel file |
| **Total** | **~2,800** | **30% reduction** |

Plus updates to existing files:
- `ai-types.ts`: +100 lines (new types)
- `ai-constants.ts`: +50 lines (new constants)

---

## Implementation Status

**✅ COMPLETED** - December 9, 2025

All tasks have been successfully implemented and verified.

### Completed Tasks

| Phase | Task | Status |
|-------|------|--------|
| 1.1 | Create backup files | ✅ Completed |
| 1.2 | Extend existing types in ai-types.ts | ✅ Completed |
| 1.3 | Add validation constants to ai-constants.ts | ✅ Completed (already existed) |
| 2.1 | Create ai-video/core/fal-request.ts | ✅ Completed |
| 2.2 | Create ai-video/core/polling.ts | ✅ Completed |
| 2.3 | Create ai-video/core/streaming.ts | ✅ Completed |
| 3.1 | Create ai-video/validation/validators.ts | ✅ Completed |
| 4.1 | Create ai-video/models/sora2.ts | ✅ Completed |
| 5.1 | Create ai-video/generators/base-generator.ts | ✅ Completed |
| 5.2 | Create ai-video/generators/text-to-video.ts | ✅ Completed |
| 5.3 | Create ai-video/generators/image-to-video.ts | ✅ Completed |
| 5.4 | Create ai-video/generators/avatar.ts | ✅ Completed |
| 5.5 | Create ai-video/generators/upscale.ts | ✅ Completed |
| 5.6 | Create ai-video/generators/image.ts | ✅ Completed |
| 6.1 | Create ai-video/api.ts | ✅ Completed |
| 7.1 | Create ai-video/index.ts barrel file | ✅ Completed |
| 8.1 | Update import paths (backward compatibility) | ✅ Completed |
| 8.2 | Run tests and verify | ✅ Completed (34/34 tests passing) |

### Verification Results

- **TypeScript**: 0 new errors from refactoring (1 pre-existing error unrelated to this work)
- **AI Video Tests**: 34/34 tests passing
- **Backward Compatibility**: All imports from `@/lib/ai-video-client` continue to work
- **File Structure**: New modular structure under `ai-video/` directory

---

## Success Criteria

- [x] All 200+ existing tests pass
- [x] No new TypeScript errors from refactoring
- [x] `use-ai-generation.ts` works without changes (uses barrel file)
- [x] `fal-ai-client.ts` can import types from centralized location
- [x] Each new file under 500 lines
- [ ] Bundle size unchanged or reduced (to be verified in production build)
- [x] No circular dependencies
- [ ] Backup files removed after verification (kept for safety)

---

## Rollback Plan

If issues are discovered after deployment:

```bash
# Restore from backup
cp qcut/apps/web/src/lib/ai-video-client.ts.backup qcut/apps/web/src/lib/ai-video-client.ts
rm -rf qcut/apps/web/src/lib/ai-video/

# Revert import changes in consuming files (if changed)
git checkout -- qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts
```
