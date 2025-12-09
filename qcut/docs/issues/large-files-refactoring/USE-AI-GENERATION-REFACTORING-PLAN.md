# use-ai-generation.ts Refactoring Plan

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts`
**Current Size**: 2659 lines
**Goal**: Long-term maintainability over short-term gains

---

## Pre-Implementation Checklist

### Step 0: Create Backup Before Starting
```bash
# Create backup of the original file
cp qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts \
   qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts.backup
```

---

## Architecture Analysis

### Current Structure (Line-by-Line Breakdown)

| Section | Lines | Description |
|---------|-------|-------------|
| Imports | 1-58 | Module imports |
| Constants | 60-87 | VEO31_FRAME_MODELS, getSafeDuration helper |
| Hook Props Destructuring | 93-177 | ~85 props destructured |
| Core State | 179-264 | 20+ useState calls |
| Effects | 266-332 | Timer, polling cleanup, parent notifications |
| Helper Functions | 334-407 | downloadVideoToMemory, uploadImageToFal, uploadAudioToFal |
| Status Polling | 408-586 | startStatusPolling with media integration |
| Mock Generation | 588-759 | handleMockGenerate for testing |
| Main Generation | 761-2382 | handleGenerate - THE MONSTER FUNCTION |
| Reset & Setters | 2384-2494 | resetGenerationState, Veo31 setters, Reve Edit handlers |
| Return Object | 2497-2658 | Export all state and actions |

### Critical Issues

1. **handleGenerate is 1600+ lines** - Single function handling all generation logic
2. **Massive code duplication** - Media integration code duplicated 3x (lines 1814-2017, 2044-2255)
3. **85+ props** - Props object is unwieldy
4. **Model-specific branching** - Long if-else chains for each model
5. **Mixed concerns** - Generation, download, media store, disk save all interleaved

### Existing Patterns to Leverage

The codebase already has:
1. **`lib/ai-video/`** - Modular generators we just refactored
2. **`lib/ai-video/core/streaming.ts`** - Video download utilities
3. **Type definitions in `ai-types.ts`** - Centralized types

---

## Recommended Architecture

### File Structure

```
hooks/
├── use-ai-generation.ts              # Main hook (orchestration only, ~400 lines)
├── use-ai-generation-state.ts        # State management (~200 lines)
├── generation/
│   ├── types.ts                      # Generation-specific types (~50 lines)
│   ├── text-to-video-handler.ts      # T2V generation logic (~300 lines)
│   ├── image-to-video-handler.ts     # I2V generation logic (~400 lines)
│   ├── avatar-handler.ts             # Avatar generation logic (~200 lines)
│   ├── upscale-handler.ts            # Upscale generation logic (~150 lines)
│   └── media-integration.ts          # Download + save + media store (~200 lines)
```

### Key Principles

#### Principle 1: Extract Media Integration (DRY)
The media integration code is duplicated 3 times. Extract to single function:

```typescript
// generation/media-integration.ts
export async function integrateVideoToMediaStore(
  videoUrl: string,
  options: {
    modelId: string;
    prompt: string;
    projectId: string;
    addMediaItem: AddMediaItemFn;
    duration?: number;
  }
): Promise<{ success: boolean; localPath?: string; error?: string }>;
```

#### Principle 2: Handler Functions per Tab
Each tab gets its own handler that returns a standardized response:

```typescript
// generation/text-to-video-handler.ts
export async function handleTextToVideoGeneration(
  modelId: string,
  params: T2VGenerationParams,
  onProgress: ProgressCallback
): Promise<GenerationResult>;
```

#### Principle 3: Unified Params Builder
Extract the repeated params building logic:

```typescript
// generation/params-builder.ts
export function buildUnifiedParams(
  modelId: string,
  settings: T2VSettings,
  capabilities: T2VModelCapabilities
): Record<string, unknown>;
```

#### Principle 4: State as Separate Hook
Extract state management to keep main hook lean:

```typescript
// use-ai-generation-state.ts
export function useAIGenerationState() {
  // All useState calls
  // All derived state
  // Returns state + setters
}
```

---

## Subtasks

### Phase 1: Foundation (No Breaking Changes)

#### Task 1.1: Create Backup
**Priority**: CRITICAL
**Effort**: 5 minutes

```bash
cp qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts \
   qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts.backup
```

---

#### Task 1.2: Extract Media Integration Function
**Priority**: HIGH
**Effort**: 1 hour
**Reduction**: ~400 lines (duplicated code removed)

Create `generation/media-integration.ts`:

```typescript
/**
 * Media Integration Utilities
 *
 * Handles the complete flow of:
 * 1. Downloading video from URL
 * 2. Saving to local disk via Electron
 * 3. Adding to media store
 */

import { debugLogger } from "@/lib/debug-logger";
import type { GeneratedVideo } from "../../types/ai-types";

export interface MediaIntegrationResult {
  success: boolean;
  localPath?: string;
  localUrl?: string;
  fileSize?: number;
  error?: string;
}

export interface MediaIntegrationOptions {
  videoUrl: string;
  modelId: string;
  prompt: string;
  projectId: string;
  addMediaItem: (projectId: string, item: MediaItem) => Promise<string>;
  duration?: number;
  onError?: (error: string) => void;
}

/**
 * Downloads video, saves to disk, and adds to media store.
 *
 * This is the unified implementation of the media integration flow
 * that was previously duplicated 3x in handleGenerate.
 */
export async function integrateVideoToMediaStore(
  options: MediaIntegrationOptions
): Promise<MediaIntegrationResult> {
  const { videoUrl, modelId, prompt, projectId, addMediaItem, duration, onError } = options;

  console.log("step 6a: media integration condition check");
  console.log("   - videoUrl:", !!videoUrl);
  console.log("   - projectId:", projectId);

  try {
    // Step 1: Download video
    console.log("step 6b: executing media integration block");
    console.log("📥 Downloading video from URL:", videoUrl);

    const videoResponse = await fetch(videoUrl);
    console.log("step 6c: video download progress");
    console.log("   - videoResponse.ok:", videoResponse.ok);
    console.log("   - videoResponse.status:", videoResponse.status);

    if (!videoResponse.ok) {
      throw new Error(
        `Failed to download video: ${videoResponse.status} ${videoResponse.statusText}`
      );
    }

    const blob = await videoResponse.blob();
    console.log("✅ Downloaded video blob, size:", blob.size);

    const filename = `AI-Video-${modelId}-${Date.now()}.mp4`;
    const file = new File([blob], filename, { type: "video/mp4" });

    console.log("step 6d: file creation complete");
    console.log("   - blob.size:", blob.size, "bytes");
    console.log("   - file.name:", file.name);

    // Step 2: Save to local disk (MANDATORY)
    console.log("step 6e: MANDATORY save to local disk starting");

    if (!window.electronAPI?.video?.saveToDisk) {
      const error = "CRITICAL ERROR: Electron API not available - cannot save video to disk";
      console.error("🚨", error);
      onError?.("Failed to save video: " + error);
      return { success: false, error };
    }

    const arrayBuffer = await blob.arrayBuffer();
    const saveResult = await window.electronAPI.video.saveToDisk({
      fileName: filename,
      fileData: arrayBuffer,
      projectId,
      modelId,
      metadata: {
        width: 1920,
        height: 1080,
        duration: duration || 5,
        fps: 25,
      },
    });

    if (!saveResult.success) {
      const error = saveResult.error || "Unknown error saving video to disk";
      console.error("🚨 step 6e: CRITICAL - Save to disk FAILED:", error);
      onError?.("Failed to save video to disk: " + error);
      return { success: false, error };
    }

    console.log("✅ step 6e: video saved to disk successfully", {
      localPath: saveResult.localPath,
      fileName: saveResult.fileName,
      fileSize: saveResult.fileSize,
    });

    // Step 3: Add to media store
    const localUrl = URL.createObjectURL(file);

    const mediaItem = {
      name: `AI: ${prompt.substring(0, 30)}...`,
      type: "video" as const,
      file,
      url: localUrl,
      originalUrl: videoUrl,
      localPath: saveResult.localPath,
      isLocalFile: true,
      duration: duration || 5,
      width: 1920,
      height: 1080,
      metadata: {
        source: "ai-generation",
        model: modelId,
        prompt,
        generatedAt: new Date().toISOString(),
      },
    };

    console.log("step 6e: about to call addMediaItem");
    const newItemId = await addMediaItem(projectId, mediaItem);

    console.log("step 6f: addMediaItem completed", { newItemId });
    console.log("✅ VIDEO SUCCESSFULLY ADDED TO MEDIA STORE!");

    debugLogger.log("AIGeneration", "VIDEO_ADDED_TO_MEDIA", {
      itemId: newItemId,
      model: modelId,
      videoUrl,
      projectId,
    });

    return {
      success: true,
      localPath: saveResult.localPath,
      localUrl,
      fileSize: file.size,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Media integration failed:", error);
    debugLogger.log("AIGeneration", "MEDIA_INTEGRATION_FAILED", {
      error: errorMessage,
      model: modelId,
      videoUrl,
    });
    return { success: false, error: errorMessage };
  }
}
```

---

#### Task 1.3: Extract Generation Types
**Priority**: HIGH
**Effort**: 30 minutes

Create `generation/types.ts`:

```typescript
/**
 * Generation-specific types
 */

import type { GeneratedVideo, GeneratedVideoResult } from "../../types/ai-types";

export interface GenerationResult {
  success: boolean;
  video?: GeneratedVideo;
  error?: string;
  needsPolling?: boolean;
  jobId?: string;
}

export interface T2VGenerationParams {
  prompt: string;
  modelId: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  negativePrompt?: string;
  promptExpansion?: boolean;
  seed?: number;
  safetyChecker?: boolean;
  // Model-specific params
  veo31Settings?: Veo31Settings;
  hailuoT2VDuration?: number;
  ltxv2Duration?: number;
  ltxv2Resolution?: string;
  ltxv2FPS?: number;
  ltxv2GenerateAudio?: boolean;
}

export interface I2VGenerationParams {
  prompt: string;
  modelId: string;
  image?: File;
  firstFrame?: File;
  lastFrame?: File;
  // Model-specific params...
}

export interface AvatarGenerationParams {
  modelId: string;
  prompt?: string;
  avatarImage?: File;
  audioFile?: File;
  sourceVideo?: File;
  referenceImages?: (File | null)[];
  // Model-specific params...
}

export interface UpscaleGenerationParams {
  modelId: string;
  sourceVideoFile?: File;
  sourceVideoUrl?: string;
  // Model-specific params...
}

export interface Veo31Settings {
  resolution: "720p" | "1080p";
  duration: "4s" | "6s" | "8s";
  aspectRatio: "9:16" | "16:9" | "1:1" | "auto";
  generateAudio: boolean;
  enhancePrompt: boolean;
  autoFix: boolean;
}
```

---

### Phase 2: Handler Extraction

#### Task 2.1: Extract Text-to-Video Handler
**Priority**: HIGH
**Effort**: 2 hours
**Reduction**: ~400 lines from main function

Create `generation/text-to-video-handler.ts`:

```typescript
/**
 * Text-to-Video Generation Handler
 *
 * Handles all T2V model generations with model-specific logic.
 */

import {
  generateVideo,
  generateVideoFromText,
  generateLTXV2Video,
} from "@/lib/ai-video-client";
import { falAIClient } from "@/lib/fal-ai-client";
import type { T2VGenerationParams, GenerationResult } from "./types";
import type { ProgressCallback } from "@/lib/ai-video-client";

/**
 * Routes to appropriate T2V generator based on model ID.
 */
export async function handleTextToVideoGeneration(
  params: T2VGenerationParams,
  onProgress: ProgressCallback
): Promise<GenerationResult> {
  const { modelId, prompt } = params;

  console.log(`📝 Processing text-to-video model ${modelId}...`);

  // Veo 3.1 Fast text-to-video
  if (modelId === "veo31_fast_text_to_video") {
    return handleVeo31FastT2V(params, onProgress);
  }

  // Veo 3.1 Standard text-to-video
  if (modelId === "veo31_text_to_video") {
    return handleVeo31T2V(params, onProgress);
  }

  // Hailuo 2.3 text-to-video models
  if (modelId === "hailuo23_standard_t2v" || modelId === "hailuo23_pro_t2v") {
    return handleHailuo23T2V(params, onProgress);
  }

  // LTX Video 2.0 text-to-video
  if (modelId === "ltxv2_pro_t2v" || modelId === "ltxv2_fast_t2v") {
    return handleLTXV2T2V(params, onProgress);
  }

  // Default: use generateVideo
  return handleDefaultT2V(params, onProgress);
}

// Private handler implementations...
async function handleVeo31FastT2V(
  params: T2VGenerationParams,
  onProgress: ProgressCallback
): Promise<GenerationResult> {
  // ... implementation
}

// ... other private handlers
```

---

#### Task 2.2: Extract Image-to-Video Handler
**Priority**: HIGH
**Effort**: 2 hours
**Reduction**: ~500 lines from main function

Create `generation/image-to-video-handler.ts` with similar structure.

---

#### Task 2.3: Extract Avatar Handler
**Priority**: MEDIUM
**Effort**: 1 hour
**Reduction**: ~150 lines from main function

Create `generation/avatar-handler.ts`.

---

#### Task 2.4: Extract Upscale Handler
**Priority**: MEDIUM
**Effort**: 45 minutes
**Reduction**: ~100 lines from main function

Create `generation/upscale-handler.ts`.

---

### Phase 3: State Extraction

#### Task 3.1: Extract State Management Hook
**Priority**: HIGH
**Effort**: 1 hour
**Reduction**: ~300 lines from main hook

Create `use-ai-generation-state.ts`:

```typescript
/**
 * AI Generation State Management
 *
 * Extracts all state management from useAIGeneration.
 */

import { useState, useEffect, useCallback } from "react";
import type { GeneratedVideo, GeneratedVideoResult } from "../types/ai-types";
import type { Veo31Settings } from "./generation/types";

export interface AIGenerationStateReturn {
  // Core state
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;
  generationProgress: number;
  setGenerationProgress: (v: number) => void;
  statusMessage: string;
  setStatusMessage: (v: string) => void;
  elapsedTime: number;
  setElapsedTime: (v: number) => void;
  estimatedTime: number | undefined;
  setEstimatedTime: (v: number | undefined) => void;
  currentModelIndex: number;
  setCurrentModelIndex: (v: number) => void;
  progressLogs: string[];
  setProgressLogs: React.Dispatch<React.SetStateAction<string[]>>;
  generationStartTime: number | null;
  setGenerationStartTime: (v: number | null) => void;

  // Job state
  jobId: string | null;
  setJobId: (v: string | null) => void;
  generatedVideo: GeneratedVideo | null;
  setGeneratedVideo: (v: GeneratedVideo | null) => void;
  generatedVideos: GeneratedVideoResult[];
  setGeneratedVideos: React.Dispatch<React.SetStateAction<GeneratedVideoResult[]>>;

  // Polling
  pollingInterval: NodeJS.Timeout | null;
  setPollingInterval: React.Dispatch<React.SetStateAction<NodeJS.Timeout | null>>;

  // Sora 2 state
  duration: 4 | 8 | 12;
  setDuration: (v: 4 | 8 | 12) => void;
  aspectRatio: "16:9" | "9:16";
  setAspectRatio: (v: "16:9" | "9:16") => void;
  resolution: "auto" | "720p" | "1080p";
  setResolution: (v: "auto" | "720p" | "1080p") => void;

  // Veo 3.1 state
  veo31Settings: Veo31Settings;
  setVeo31Settings: React.Dispatch<React.SetStateAction<Veo31Settings>>;
  firstFrame: File | null;
  setFirstFrame: (v: File | null) => void;
  lastFrame: File | null;
  setLastFrame: (v: File | null) => void;

  // Reve Edit state
  uploadedImageForEdit: File | null;
  setUploadedImageForEdit: (v: File | null) => void;
  uploadedImagePreview: string | null;
  setUploadedImagePreview: (v: string | null) => void;
  uploadedImageUrl: string | null;
  setUploadedImageUrl: (v: string | null) => void;

  // Actions
  resetGenerationState: () => void;
}

export function useAIGenerationState(): AIGenerationStateReturn {
  // All useState calls here...

  // Reset function
  const resetGenerationState = useCallback(() => {
    // Reset all state...
  }, []);

  return {
    // All state and setters...
  };
}
```

---

### Phase 4: Main Hook Simplification

#### Task 4.1: Refactor Main Hook to Orchestration
**Priority**: HIGH
**Effort**: 2 hours
**Target Size**: ~400 lines

The main hook becomes an orchestrator:

```typescript
/**
 * AI Generation Hook
 *
 * Orchestrates AI video generation across all tabs.
 * Delegates to specialized handlers for each generation type.
 */

export function useAIGeneration(props: UseAIGenerationProps) {
  // Use extracted state hook
  const state = useAIGenerationState();

  // Use media store hook
  const { addMediaItem, loading, error } = useAsyncMediaStoreActions();

  // Computed values
  const canGenerate = computeCanGenerate(props, state);

  // Main generation handler - now just routes to appropriate handler
  const handleGenerate = useCallback(async () => {
    const { activeTab, selectedModels, prompt } = props;

    // Validation
    const validationError = validateGenerationRequest(props, state);
    if (validationError) {
      console.error("❌ Validation failed:", validationError);
      return;
    }

    // Start generation
    state.setIsGenerating(true);
    state.setGenerationStartTime(Date.now());

    try {
      const generations: GeneratedVideoResult[] = [];

      for (let i = 0; i < selectedModels.length; i++) {
        const modelId = selectedModels[i];
        let result: GenerationResult;

        // Route to appropriate handler
        switch (activeTab) {
          case "text":
            result = await handleTextToVideoGeneration(
              buildT2VParams(modelId, props, state),
              createProgressCallback(modelId, state)
            );
            break;
          case "image":
            result = await handleImageToVideoGeneration(/* ... */);
            break;
          case "avatar":
            result = await handleAvatarGeneration(/* ... */);
            break;
          case "upscale":
            result = await handleUpscaleGeneration(/* ... */);
            break;
        }

        // Handle result
        if (result.success && result.video) {
          generations.push({ modelId, video: result.video });

          // Integrate with media store if we have a video URL
          if (result.video.videoUrl && activeProject && addMediaItem) {
            await integrateVideoToMediaStore({
              videoUrl: result.video.videoUrl,
              modelId,
              prompt: prompt.trim(),
              projectId: activeProject.id,
              addMediaItem,
              duration: result.video.duration,
            });
          }
        }
      }

      state.setGeneratedVideos(generations);
      props.onComplete?.(generations);

    } catch (error) {
      const errorMessage = handleApiError(error);
      props.onError?.(errorMessage);
    } finally {
      state.setIsGenerating(false);
    }
  }, [props, state, addMediaItem]);

  return {
    ...state,
    handleGenerate,
    canGenerate,
    // ... other returns
  };
}
```

---

### Phase 5: Testing & Cleanup

#### Task 5.1: Update Tests
**Priority**: HIGH
**Effort**: 2 hours

Update existing tests to work with refactored structure.

---

#### Task 5.2: Remove Backup
**Priority**: FINAL
**Effort**: 10 minutes

```bash
# After full verification
bun run test
bun run lint:clean

# If all pass, remove backup
rm qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts.backup
```

---

## Estimated Final Line Counts

| File | Lines | Purpose |
|------|-------|---------|
| `use-ai-generation.ts` | ~400 | Main orchestration hook |
| `use-ai-generation-state.ts` | ~200 | State management |
| `generation/types.ts` | ~80 | Type definitions |
| `generation/media-integration.ts` | ~200 | Download + save + media store |
| `generation/text-to-video-handler.ts` | ~350 | T2V generation |
| `generation/image-to-video-handler.ts` | ~400 | I2V generation |
| `generation/avatar-handler.ts` | ~200 | Avatar generation |
| `generation/upscale-handler.ts` | ~150 | Upscale generation |
| **Total** | **~1,980** | **~25% reduction** |

---

## Code Reuse Summary

### Pattern 1: Unified Media Integration
**Before**: Same 100+ line block duplicated 3x
**After**: Single `integrateVideoToMediaStore()` function
**Savings**: ~200 lines

### Pattern 2: Handler Functions
**Before**: 1600+ line handleGenerate with if-else chains
**After**: Small handlers per model category
**Benefit**: Each handler testable in isolation

### Pattern 3: State Extraction
**Before**: 20+ useState calls cluttering main hook
**After**: Separate state hook
**Benefit**: Cleaner separation of concerns

### Pattern 4: Type-Safe Params
**Before**: `Record<string, unknown>` params built inline
**After**: Typed interfaces for each generation type
**Benefit**: Better IntelliSense, catch errors at compile time

---

## Success Criteria

- [ ] All existing tests pass
- [ ] No new TypeScript errors
- [ ] Main hook under 500 lines
- [ ] No duplicated media integration code
- [ ] Each handler file under 400 lines
- [ ] Backup removed after verification

---

## Rollback Plan

If issues are discovered after deployment:

```bash
# Restore from backup
cp qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts.backup \
   qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts

# Remove new files
rm -rf qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/generation/
rm qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation-state.ts
```

---

*Created: December 2025*
*Status: Planning*
