# use-ai-generation.ts Refactoring Plan

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts`
**Original Size**: 2659 lines
**Current Size**: 2355 lines (after Phase 1)
**Goal**: Long-term maintainability over short-term gains

---

## Implementation Progress

### Phase 1: Extract Media Integration ✅ COMPLETED (Dec 2025)

**Reduction**: 303 lines removed from main file

**Changes Made**:
- Created `hooks/generation/media-integration.ts` (316 lines)
- Created `hooks/generation/index.ts` (barrel file)
- Replaced 2 duplicated media integration blocks (~150 lines each) with calls to `integrateVideoToMediaStore()`
- Added helper functions: `updateVideoWithLocalPaths()`, `canIntegrateMedia()`

**Verification**:
- ✅ TypeScript compilation passes
- ✅ All 34 AI video tests pass
- ✅ Backup file preserved

---

## Pre-Implementation Checklist

### Step 0: Create Backup Before Starting ✅ DONE
```bash
# Create backup of the original file
cp qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts \
   qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts.backup
```

---

## Existing Code to Reuse

### Already Refactored Modules

The codebase has already been modularized in these areas:

#### 1. `lib/ai-video/` - Generator Module (Recently Refactored)
```
lib/ai-video/
├── index.ts                    # Barrel file with all exports
├── core/
│   ├── fal-request.ts          # makeFalRequest, handleFalResponse
│   ├── polling.ts              # pollQueueStatus, mapQueueStatusToProgress
│   └── streaming.ts            # streamVideoDownload
├── generators/
│   ├── base-generator.ts       # fileToDataURL, buildVideoResponse, getModelConfig
│   ├── text-to-video.ts        # generateVideo, generateVideoFromText, generateLTXV2Video
│   ├── image-to-video.ts       # generateVideoFromImage, generateViduQ2Video, etc.
│   ├── avatar.ts               # generateAvatarVideo
│   ├── upscale.ts              # upscaleByteDanceVideo, upscaleFlashVSRVideo, etc.
│   └── image.ts                # generateSeeddream45Image
├── models/
│   └── sora2.ts                # Sora 2 parameter conversion
├── validation/
│   └── validators.ts           # All validation functions
└── api.ts                      # getAvailableModels, estimateCost, handleApiError
```

#### 2. Tab State Hooks (Already Exist)
```
hooks/
├── use-ai-tab-state-base.ts    # useFileWithPreview, useAudioFileWithDuration, etc.
├── use-ai-text-tab-state.ts    # T2V settings, Hailuo, LTX settings
├── use-ai-image-tab-state.ts   # I2V settings, frame uploads
├── use-ai-avatar-tab-state.ts  # Avatar-specific settings
├── use-ai-upscale-tab-state.ts # Upscale-specific settings
└── use-ai-history.ts           # Generation history
```

#### 3. Types (Centralized)
- `ai-types.ts` - All interfaces: `UseAIGenerationProps`, `GeneratedVideo`, `VideoGenerationResponse`, etc.

---

## Architecture Analysis

### Current Structure (Line-by-Line Breakdown)

| Section | Lines | Description |
|---------|-------|-------------|
| Imports | 1-58 | Module imports including `lib/ai-video` |
| Constants | 60-87 | VEO31_FRAME_MODELS, getSafeDuration helper |
| Hook Props Destructuring | 93-177 | ~85 props destructured |
| Core State | 179-264 | 20+ useState calls |
| Effects | 266-332 | Timer, polling cleanup, parent notifications |
| Helper Functions | 334-407 | downloadVideoToMemory, uploadImageToFal, uploadAudioToFal |
| Status Polling | 408-586 | startStatusPolling with media integration |
| Mock Generation | 588-759 | handleMockGenerate for testing |
| **handleGenerate** | **761-2382** | **THE MONSTER FUNCTION (1600+ lines)** |
| Reset & Setters | 2384-2494 | resetGenerationState, Veo31 setters |
| Return Object | 2497-2658 | Export all state and actions |

### Critical Issues

1. **handleGenerate is 1600+ lines** - Single function with all generation logic
2. **Media integration duplicated 3x** - Lines ~1814-2017 and ~2044-2255 have same code
3. **Model-specific branching** - Long if-else chains for 40+ models
4. **Doesn't fully leverage lib/ai-video** - Still has inline API calls
5. **Mixed concerns** - FAL upload, generation, download, media store all interleaved

### What's NOT Duplicated (Already Reused)

- `fileToDataURL` - Uses `lib/ai-video/generators/base-generator.ts`
- `generateVideo`, `generateVideoFromText`, etc. - Uses `lib/ai-video/generators/`
- Validation functions - Uses `lib/ai-video/validation/validators.ts`
- Tab-specific state - Uses separate `use-ai-*-tab-state.ts` hooks

---

## Recommended Refactoring

### Phase 1: Extract Media Integration (Highest ROI)

The media integration code is duplicated 3 times. Extract to single function.

#### Task 1.1: Create `generation/media-integration.ts`
**Reduction**: ~400 lines (duplicated code removed)

```typescript
/**
 * Media Integration Utilities
 *
 * Unified flow for:
 * 1. Downloading video from URL
 * 2. Saving to local disk via Electron
 * 3. Adding to media store
 *
 * This was previously duplicated 3x in handleGenerate.
 */

import { debugLogger } from "@/lib/debug-logger";

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
  width?: number;
  height?: number;
  onError?: (error: string) => void;
}

/**
 * Downloads video, saves to disk, and adds to media store.
 */
export async function integrateVideoToMediaStore(
  options: MediaIntegrationOptions
): Promise<MediaIntegrationResult> {
  const {
    videoUrl,
    modelId,
    prompt,
    projectId,
    addMediaItem,
    duration = 5,
    width = 1920,
    height = 1080,
    onError,
  } = options;

  try {
    // Step 1: Download video
    console.log("📥 Downloading video from URL:", videoUrl);
    const videoResponse = await fetch(videoUrl);

    if (!videoResponse.ok) {
      throw new Error(
        `Failed to download video: ${videoResponse.status} ${videoResponse.statusText}`
      );
    }

    const blob = await videoResponse.blob();
    console.log("✅ Downloaded video blob, size:", blob.size);

    const filename = `AI-Video-${modelId}-${Date.now()}.mp4`;
    const file = new File([blob], filename, { type: "video/mp4" });

    // Step 2: Save to local disk (MANDATORY)
    if (!window.electronAPI?.video?.saveToDisk) {
      const error = "Electron API not available - cannot save video to disk";
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
      metadata: { width, height, duration, fps: 25 },
    });

    if (!saveResult.success) {
      const error = saveResult.error || "Unknown error saving video to disk";
      console.error("🚨 Save to disk FAILED:", error);
      onError?.("Failed to save video to disk: " + error);
      return { success: false, error };
    }

    console.log("✅ Video saved to disk:", saveResult.localPath);

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
      duration,
      width,
      height,
      metadata: {
        source: "ai-generation",
        model: modelId,
        prompt,
        generatedAt: new Date().toISOString(),
      },
    };

    const newItemId = await addMediaItem(projectId, mediaItem);
    console.log("✅ Video added to media store:", newItemId);

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

### Phase 2: Extract Handler Functions ✅ COMPLETED (Dec 2025)

**Reduction**: New file created with ~1000 lines of extracted handler logic

**What Was Done**:
- Created `hooks/generation/model-handlers.ts` (1000+ lines)
- Contains handler functions for all 40+ models: T2V, I2V, Avatar, Upscale
- Router functions for each tab: `routeTextToVideoHandler()`, etc.
- Comprehensive type interfaces for settings
- Added type aliases and type assertions to handle loose-to-strict type coercion

**Type Solution Used**: Option A - Type Assertions
- Created type aliases for all literal types (e.g., `type HailuoDuration = 6 | 10`)
- Added `as` assertions at call sites (e.g., `duration: settings.hailuoT2VDuration as HailuoDuration`)
- Maintains backward compatibility with hook state

**Files Created**:
- `model-handlers.ts` - Fully typed and exported
- Updated `index.ts` barrel file with exports

**Verification**:
- ✅ TypeScript compilation passes
- ✅ All 34 AI video tests pass

#### Task 2.1: Create `generation/handlers.ts`
**Reduction**: ~800 lines from handleGenerate (PENDING)

Create unified handler that routes to `lib/ai-video/generators/`:

```typescript
/**
 * Generation Handlers
 *
 * Routes to appropriate lib/ai-video generators based on model and tab.
 * Reduces branching in main hook.
 */

import {
  generateVideo,
  generateVideoFromText,
  generateLTXV2Video,
  generateVideoFromImage,
  generateViduQ2Video,
  generateLTXV2ImageVideo,
  generateSeedanceVideo,
  generateKlingImageVideo,
  generateKling26ImageVideo,
  generateKlingO1Video,
  generateKlingO1RefVideo,
  generateWAN25ImageVideo,
  generateAvatarVideo,
  upscaleByteDanceVideo,
  upscaleFlashVSRVideo,
  upscaleTopazVideo,
} from "@/lib/ai-video";
import type { ProgressCallback, VideoGenerationResponse } from "@/lib/ai-video";

export type GenerationTab = "text" | "image" | "avatar" | "upscale";

export interface GenerationParams {
  modelId: string;
  prompt: string;
  tab: GenerationTab;
  // Common params
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  // Image tab params
  imageFile?: File;
  imageUrl?: string;
  firstFrame?: File;
  lastFrame?: File;
  // Avatar tab params
  avatarImage?: File;
  audioFile?: File;
  sourceVideo?: File;
  // Upscale tab params
  sourceVideoFile?: File;
  sourceVideoUrl?: string;
  // Model-specific params (passed through)
  modelParams?: Record<string, unknown>;
}

/**
 * Routes generation to appropriate handler based on tab and model.
 */
export async function executeGeneration(
  params: GenerationParams,
  onProgress?: ProgressCallback
): Promise<VideoGenerationResponse> {
  const { tab, modelId, prompt } = params;

  switch (tab) {
    case "text":
      return executeTextGeneration(params, onProgress);
    case "image":
      return executeImageGeneration(params, onProgress);
    case "avatar":
      return executeAvatarGeneration(params);
    case "upscale":
      return executeUpscaleGeneration(params);
    default:
      throw new Error(`Unknown tab: ${tab}`);
  }
}

async function executeTextGeneration(
  params: GenerationParams,
  onProgress?: ProgressCallback
): Promise<VideoGenerationResponse> {
  const { modelId, prompt, duration, resolution, aspectRatio, modelParams } = params;

  // Hailuo 2.3 models
  if (modelId === "hailuo23_standard_t2v" || modelId === "hailuo23_pro_t2v") {
    return generateVideoFromText({
      model: modelId,
      prompt,
      duration: modelParams?.hailuoT2VDuration as 6 | 10,
    });
  }

  // LTX Video 2.0 models
  if (modelId === "ltxv2_pro_t2v" || modelId === "ltxv2_fast_t2v") {
    return generateLTXV2Video({
      model: modelId,
      prompt,
      duration: modelParams?.ltxv2Duration as number,
      resolution: modelParams?.ltxv2Resolution as string,
      fps: modelParams?.ltxv2FPS as number,
      generate_audio: modelParams?.ltxv2GenerateAudio as boolean,
    });
  }

  // Default: use generateVideo with progress callback
  return generateVideo(
    { prompt, model: modelId, duration, resolution, aspect_ratio: aspectRatio },
    onProgress
  );
}

async function executeImageGeneration(
  params: GenerationParams,
  onProgress?: ProgressCallback
): Promise<VideoGenerationResponse> {
  // ... route to appropriate I2V generator
}

async function executeAvatarGeneration(
  params: GenerationParams
): Promise<VideoGenerationResponse> {
  // ... route to generateAvatarVideo
}

async function executeUpscaleGeneration(
  params: GenerationParams
): Promise<VideoGenerationResponse> {
  // ... route to appropriate upscale function
}
```

---

### Phase 3: Simplify Main Hook

#### Task 3.1: Refactor handleGenerate
**Target**: ~300 lines (down from 1600+)

```typescript
const handleGenerate = useCallback(async () => {
  // Validation (keep existing)
  if (!validateGenerationRequest()) return;

  setIsGenerating(true);
  setGenerationStartTime(Date.now());

  try {
    const generations: GeneratedVideoResult[] = [];

    for (let i = 0; i < selectedModels.length; i++) {
      const modelId = selectedModels[i];
      setCurrentModelIndex(i);

      // Build params from props and tab state
      const params = buildGenerationParams(modelId, activeTab, props);

      // Execute generation using unified handler
      const result = await executeGeneration(params, handleProgressUpdate);

      if (result.video_url) {
        const video: GeneratedVideo = {
          jobId: result.job_id,
          videoUrl: result.video_url,
          prompt: prompt.trim(),
          model: modelId,
          duration: result.estimated_time,
        };

        generations.push({ modelId, video });

        // Media integration using extracted function
        if (activeProject && addMediaItem) {
          await integrateVideoToMediaStore({
            videoUrl: result.video_url,
            modelId,
            prompt: prompt.trim(),
            projectId: activeProject.id,
            addMediaItem,
            duration: video.duration,
          });
        }
      }
    }

    setGeneratedVideos(generations);
    onComplete?.(generations);
  } catch (error) {
    const errorMessage = handleApiError(error);
    onError?.(errorMessage);
  } finally {
    setIsGenerating(false);
  }
}, [/* deps */]);
```

---

## Subtask Summary

| Task | Description | Lines Saved | Priority | Status |
|------|-------------|-------------|----------|--------|
| 1.1 | Extract `media-integration.ts` | 303 | HIGH | ✅ DONE |
| 2.1 | Extract `generation/model-handlers.ts` | ~1000 (new file) | HIGH | ✅ DONE |
| 3.1 | Simplify handleGenerate (use routers) | ~700 | MEDIUM | PENDING |
| 4.1 | Update tests | - | HIGH | ✅ DONE |
| 5.1 | Remove backup | - | FINAL | PENDING |

---

## Current Line Counts (After Phase 2)

| File | Lines | Purpose |
|------|-------|---------|
| `use-ai-generation.ts` | 2355 | Main hook (reduced from 2659) |
| `generation/media-integration.ts` | 316 | Download + save + media store |
| `generation/model-handlers.ts` | ~1000 | Model-specific handlers + routers |
| `generation/index.ts` | 30 | Barrel file |
| **Main Hook Reduction** | **303 lines** | (still pending Phase 3 for ~700 more) |

## Estimated Final Line Counts (After All Phases)

| File | Lines | Purpose |
|------|-------|---------|
| `use-ai-generation.ts` | ~600 | Main hook (orchestration + state) |
| `generation/media-integration.ts` | 316 | Download + save + media store |
| `generation/handlers.ts` | ~400 | Route to lib/ai-video generators |
| **Total New Files** | **~700** | |
| **Main Hook Reduction** | **~2000** | (from 2659 to ~600) |

---

## Code Reuse Summary

### Already Reused (No Changes Needed)
- `lib/ai-video/generators/*` - All generation functions
- `lib/ai-video/validation/validators.ts` - All validation
- `lib/ai-video/core/*` - FAL request, polling, streaming
- `use-ai-*-tab-state.ts` - Tab-specific state hooks

### Extractions Completed
- ✅ `integrateVideoToMediaStore()` - Removes 2x duplication
- ✅ `updateVideoWithLocalPaths()` - Helper for path updates
- ✅ `canIntegrateMedia()` - Validation helper

### Pending Extractions
- `executeGeneration()` - Unified routing to generators

### Pattern Consistency
The new `generation/` folder mirrors the existing `lib/ai-video/generators/` pattern, maintaining consistency across the codebase.

---

## Success Criteria

- [x] All existing tests pass (34/34 AI video tests)
- [x] No new TypeScript errors
- [ ] Main hook under 700 lines (currently 2355)
- [x] No duplicated media integration code
- [ ] Handlers properly route to lib/ai-video generators
- [ ] Backup removed after verification

---

## Rollback Plan

```bash
# Restore from backup
cp qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts.backup \
   qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts

# Remove new files
rm -rf qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/generation/
```

---

## Next Steps: Phase 3 - Simplify handleGenerate

To complete Phase 3, replace the ~700 lines of model branching in `handleGenerate` with router calls:

### Current Pattern (to be replaced):
```typescript
if (activeTab === "text") {
  if (modelId === "veo31_fast_text_to_video") {
    response = await falAIClient.generateVeo31FastTextToVideo({...});
  } else if (modelId === "hailuo23_standard_t2v") {
    // ... 30+ lines
  }
  // ... 500+ more lines of if-else
}
```

### Target Pattern:
```typescript
const ctx: ModelHandlerContext = {
  prompt: prompt.trim(),
  modelId,
  modelName: modelName || modelId,
  progressCallback,
};

let result: ModelHandlerResult;

if (activeTab === "text") {
  const settings: TextToVideoSettings = { /* build from hook state */ };
  result = await routeTextToVideoHandler(ctx, settings);
} else if (activeTab === "image") {
  const settings: ImageToVideoSettings = { /* build from hook state */ };
  result = await routeImageToVideoHandler(ctx, settings);
} else if (activeTab === "upscale") {
  const settings: UpscaleSettings = { /* build from hook state */ };
  result = await routeUpscaleHandler(ctx, settings);
} else if (activeTab === "avatar") {
  const settings: AvatarSettings = { /* build from hook state */ };
  result = await routeAvatarHandler(ctx, settings);
}

if (result.shouldSkip) {
  console.log(`⚠️ Skipping model - ${result.skipReason}`);
  continue;
}

response = result.response;
```

**Estimated Savings**: ~700 lines from main hook

---

*Created: December 2025*
*Status: Phase 1 ✅ Complete, Phase 2 ✅ Complete, Phase 3 Pending*
*Leverages: lib/ai-video/ (recently refactored), existing tab state hooks*
