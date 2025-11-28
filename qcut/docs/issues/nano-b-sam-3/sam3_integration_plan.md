# SAM 3 (Segment Anything Model 3) Integration Plan

> **Priority**: Long-term maintainability > scalability > performance > short-term gains
> **Status**: ✅ Phase 1-4 Complete | Phase 5-6 Pending (Integration & Video UI)

---

## Completed Work

### Phase 1: Core Infrastructure (Complete)
| File | Status | Description |
|------|--------|-------------|
| `src/types/sam3.ts` | ✅ Complete | TypeScript interfaces for SAM-3 image + video API |
| `src/lib/sam3-client.ts` | ✅ Complete | API client with queue polling (image + video) |
| `src/lib/sam3-models.ts` | ✅ Complete | Model catalog/info |

### Phase 2: Video API Extension (Complete)
| File | Status | Description |
|------|--------|-------------|
| `src/types/sam3.ts` | ✅ Complete | Added video types (Sam3VideoInput, Sam3VideoOutput, etc.) |
| `src/lib/sam3-client.ts` | ✅ Complete | Added segmentVideo, segmentVideoWithText methods |
| `src/types/ai-generation.ts` | ✅ Complete | Re-exported video types |

### Phase 3: Segmentation Store (Complete)
| File | Status | Description |
|------|--------|-------------|
| `src/stores/segmentation-store.ts` | ✅ Complete | Zustand store with full state management |

### Phase 4: UI Components (Complete)
| File | Status | Description |
|------|--------|-------------|
| `src/components/editor/segmentation/index.tsx` | ✅ Complete | Main SegmentationPanel container |
| `src/components/editor/segmentation/PromptToolbar.tsx` | ✅ Complete | Mode selection + prompt input |
| `src/components/editor/segmentation/ObjectList.tsx` | ✅ Complete | Sidebar object list with colors |
| `src/components/editor/segmentation/SegmentationCanvas.tsx` | ✅ Complete | Interactive canvas with click/drag |
| `src/components/editor/segmentation/ImageUploader.tsx` | ✅ Complete | Drag-drop image upload |
| `src/components/editor/segmentation/MaskOverlay.tsx` | ✅ Complete | Opacity + bounding box controls |
| `src/components/editor/segmentation/SegmentationControls.tsx` | ✅ Complete | Action buttons (download, reset) |

---

## Remaining Work

### Phase 5: Integration & Navigation (Pending)
- Add SegmentationPanel to editor navigation/routing
- Export from components index

### Phase 6: Video Segmentation UI (Future Enhancement)
- VideoTimeline component
- VideoPreview component

---

## Implementation Details (Reference)

---

## Implementation Subtasks

### Phase 2: Video Segmentation API Extension

#### Subtask 2.1: Extend SAM-3 Types for Video
- **File**: `qcut/apps/web/src/types/sam3.ts`
- **Action**: ADD new interfaces after line 161
- **Estimated Time**: 10 minutes

```typescript
// ============================================
// Video Segmentation Types
// ============================================

/**
 * Point prompt for video segmentation
 * Includes frame_index for specifying which frame the prompt applies to
 */
export interface Sam3VideoPointPrompt extends Sam3PointPrompt {
  /** Frame index to interact with (0-based) */
  frame_index?: number;
}

/**
 * Box prompt for video segmentation
 * Includes frame_index for specifying which frame the prompt applies to
 */
export interface Sam3VideoBoxPrompt extends Sam3BoxPrompt {
  /** Frame index to interact with (0-based) */
  frame_index?: number;
}

/**
 * SAM-3 Video API input parameters
 */
export interface Sam3VideoInput {
  /** URL of video to segment (required) */
  video_url: string;
  /** Text description of object to segment */
  text_prompt?: string;
  /** Point prompts for click-based segmentation with frame indices */
  prompts?: Sam3VideoPointPrompt[];
  /** Box prompts for region-based segmentation with frame indices */
  box_prompts?: Sam3VideoBoxPrompt[];
  /** Apply mask overlay to output video (default: true) */
  apply_mask?: boolean;
  /** Confidence threshold for detection (0.01-1.0, default: 0.5) */
  detection_threshold?: number;
  /** Return per-frame bounding box overlays as zip (default: false) */
  boundingbox_zip?: boolean;
  /** Initial frame index for mask application (default: 0) */
  frame_index?: number;
  /** Initial mask URL for tracking */
  mask_url?: string;
}

/**
 * File output from SAM-3 video
 */
export interface Sam3FileOutput {
  /** URL to download the file */
  url: string;
  /** MIME type (e.g., "video/mp4") */
  content_type?: string;
  /** Generated filename */
  file_name?: string;
  /** File size in bytes */
  file_size?: number;
}

/**
 * SAM-3 Video API response
 */
export interface Sam3VideoOutput {
  /** Segmented output video */
  video: Sam3FileOutput;
  /** Optional zip with per-frame bounding box overlays */
  boundingbox_frames_zip?: Sam3FileOutput;
}

/**
 * Progress callback for video segmentation operations
 */
export type Sam3VideoProgressCallback = (status: {
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  message?: string;
  elapsedTime?: number;
  framesProcessed?: number;
  totalFrames?: number;
}) => void;
```

#### Subtask 2.2: Add Video Segmentation to sam3-client.ts
- **File**: `qcut/apps/web/src/lib/sam3-client.ts`
- **Action**: ADD video endpoint constant and methods
- **Location**: After line 26, add new constant
- **Estimated Time**: 15 minutes

**Step 1: Add video endpoint constant (after line 26)**
```typescript
const SAM3_VIDEO_ENDPOINT = "fal-ai/sam-3/video";
```

**Step 2: Add type imports (modify line 16-22)**
```typescript
import type {
  Sam3Input,
  Sam3Output,
  Sam3PointPrompt,
  Sam3BoxPrompt,
  Sam3ProgressCallback,
  Sam3VideoInput,
  Sam3VideoOutput,
  Sam3VideoProgressCallback,
} from "@/types/sam3";
```

**Step 3: Add segmentVideo method to Sam3Client class (after segmentWithBox method, around line 310)**
```typescript
  /**
   * Segment video with SAM-3
   *
   * @param input - SAM-3 video input parameters
   * @param onProgress - Optional progress callback
   * @returns Video segmentation output
   */
  async segmentVideo(
    input: Sam3VideoInput,
    onProgress?: Sam3VideoProgressCallback
  ): Promise<Sam3VideoOutput> {
    await this.ensureApiKey();

    const startTime = Date.now();

    debugLogger.log(SAM3_LOG_COMPONENT, "VIDEO_SEGMENT_START", {
      hasTextPrompt: !!input.text_prompt,
      pointCount: input.prompts?.length || 0,
      boxCount: input.box_prompts?.length || 0,
      detectionThreshold: input.detection_threshold,
    });

    if (onProgress) {
      onProgress({
        status: "queued",
        progress: 0,
        message: "Submitting video to SAM-3...",
        elapsedTime: 0,
      });
    }

    try {
      const response = await fetch(`${FAL_API_BASE}/${SAM3_VIDEO_ENDPOINT}`, {
        method: "POST",
        headers: {
          Authorization: `Key ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-Fal-Queue": "true",
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        handleAIServiceError(
          new Error(`SAM-3 Video API Error: ${response.status}`),
          "SAM-3 video segmentation request",
          { status: response.status, errorData }
        );
        throw new Error(
          `API error: ${response.status} - ${errorData.detail || response.statusText}`
        );
      }

      const result = await response.json();

      // Handle queue mode (video always uses queue)
      if (result.request_id) {
        return await this.pollForVideoResult(
          result.request_id,
          startTime,
          onProgress
        );
      }

      // Direct result (unlikely for video)
      if (onProgress) {
        onProgress({
          status: "completed",
          progress: 100,
          message: "Video segmentation complete",
          elapsedTime: Math.floor((Date.now() - startTime) / 1000),
        });
      }

      return result as Sam3VideoOutput;
    } catch (error) {
      handleAIServiceError(error, "SAM-3 video segmentation", {
        operation: "segmentVideo",
      });
      throw error;
    }
  }

  /**
   * Poll for queued video job result
   */
  private async pollForVideoResult(
    requestId: string,
    startTime: number,
    onProgress?: Sam3VideoProgressCallback
  ): Promise<Sam3VideoOutput> {
    const maxAttempts = 120; // 10 minutes max for video
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      const elapsedTime = Math.floor((Date.now() - startTime) / 1000);

      try {
        const statusResponse = await fetch(
          `${FAL_API_BASE}/queue/requests/${requestId}/status`,
          {
            headers: { Authorization: `Key ${this.apiKey}` },
          }
        );

        if (!statusResponse.ok) {
          await this.sleep(5000);
          continue;
        }

        const status = await statusResponse.json();

        if (onProgress) {
          onProgress({
            status: status.status === "IN_PROGRESS" ? "processing" : "queued",
            progress: Math.min(90, 10 + attempts * 1.5),
            message:
              status.status === "IN_PROGRESS"
                ? "Processing video frames..."
                : `Queued (position: ${status.queue_position || "unknown"})`,
            elapsedTime,
          });
        }

        if (status.status === "COMPLETED") {
          const resultResponse = await fetch(
            `${FAL_API_BASE}/queue/requests/${requestId}`,
            {
              headers: { Authorization: `Key ${this.apiKey}` },
            }
          );

          if (resultResponse.ok) {
            const result = await resultResponse.json();

            if (onProgress) {
              onProgress({
                status: "completed",
                progress: 100,
                message: "Video segmentation complete",
                elapsedTime,
              });
            }

            return result as Sam3VideoOutput;
          }
        }

        if (status.status === "FAILED") {
          throw new Error(status.error || "Video segmentation failed");
        }

        await this.sleep(5000);
      } catch (error) {
        if (attempts >= maxAttempts) {
          throw new Error(
            "Video segmentation timeout - maximum polling attempts reached"
          );
        }
        await this.sleep(5000);
      }
    }

    throw new Error("Maximum polling attempts reached");
  }

  /**
   * Convenience: Segment video with text prompt
   */
  async segmentVideoWithText(
    videoUrl: string,
    textPrompt: string,
    options?: Partial<Omit<Sam3VideoInput, "video_url" | "text_prompt">>
  ): Promise<Sam3VideoOutput> {
    return this.segmentVideo({
      video_url: videoUrl,
      text_prompt: textPrompt,
      ...options,
    });
  }
```

**Step 4: Add exported convenience functions (at end of file)**
```typescript
/**
 * Segment a video using SAM-3 with full parameter control
 */
export async function segmentVideo(
  input: Sam3VideoInput,
  onProgress?: Sam3VideoProgressCallback
): Promise<Sam3VideoOutput> {
  return sam3Client.segmentVideo(input, onProgress);
}

/**
 * Segment a video using a text prompt
 */
export async function segmentVideoWithText(
  videoUrl: string,
  textPrompt: string,
  options?: Partial<Omit<Sam3VideoInput, "video_url" | "text_prompt">>
): Promise<Sam3VideoOutput> {
  return sam3Client.segmentVideoWithText(videoUrl, textPrompt, options);
}
```

#### Subtask 2.3: Update Type Exports in ai-generation.ts
- **File**: `qcut/apps/web/src/types/ai-generation.ts`
- **Action**: MODIFY existing SAM-3 re-exports to include video types
- **Location**: Find existing SAM-3 re-exports section
- **Estimated Time**: 5 minutes

```typescript
// ============================================
// SAM-3 Segmentation Types (re-export)
// ============================================
export type {
  Sam3Input,
  Sam3Output,
  Sam3PointPrompt,
  Sam3BoxPrompt,
  Sam3ImageOutput,
  Sam3MaskMetadata,
  Sam3SegmentationMode,
  Sam3SegmentationResult,
  Sam3ProgressCallback,
  // Video types
  Sam3VideoInput,
  Sam3VideoOutput,
  Sam3VideoPointPrompt,
  Sam3VideoBoxPrompt,
  Sam3FileOutput,
  Sam3VideoProgressCallback,
} from "./sam3";
```

---

### Phase 3: Segmentation Store (Zustand)

#### Subtask 3.1: Create Segmentation Store
- **File**: `qcut/apps/web/src/stores/segmentation-store.ts`
- **Action**: CREATE new file
- **Pattern**: Follow `adjustment-store.ts` and `nano-edit-store.ts`
- **Estimated Time**: 20 minutes

```typescript
/**
 * Segmentation Store
 *
 * Manages state for SAM-3 image and video segmentation.
 * Follows pattern from adjustment-store.ts.
 *
 * @module SegmentationStore
 */

import { create } from "zustand";
import { devtools, subscribeWithSelector } from "zustand/middleware";
import type {
  Sam3PointPrompt,
  Sam3BoxPrompt,
  Sam3ImageOutput,
  Sam3SegmentationMode,
} from "@/types/sam3";

// ============================================
// Object Colors for Multi-Object Segmentation
// ============================================

export const OBJECT_COLORS = [
  { name: "Cyan", hex: "#00CED1", rgb: "0, 206, 209" },
  { name: "Pink", hex: "#FF69B4", rgb: "255, 105, 180" },
  { name: "Blue", hex: "#4169E1", rgb: "65, 105, 225" },
  { name: "Orange", hex: "#FFA500", rgb: "255, 165, 0" },
  { name: "Green", hex: "#32CD32", rgb: "50, 205, 50" },
  { name: "Purple", hex: "#9370DB", rgb: "147, 112, 219" },
  { name: "Yellow", hex: "#FFD700", rgb: "255, 215, 0" },
  { name: "Lime", hex: "#7FFF00", rgb: "127, 255, 0" },
  { name: "Red", hex: "#FF6347", rgb: "255, 99, 71" },
] as const;

// ============================================
// Types
// ============================================

export interface SegmentedObject {
  /** Unique object ID */
  id: string;
  /** Display name (e.g., "Object 1", "Dog") */
  name: string;
  /** Color index from OBJECT_COLORS */
  colorIndex: number;
  /** Mask image URL */
  maskUrl?: string;
  /** Thumbnail crop URL */
  thumbnailUrl?: string;
  /** Confidence score (0-1) */
  score?: number;
  /** Bounding box [cx, cy, w, h] normalized */
  boundingBox?: number[];
  /** Point prompts used to define this object */
  pointPrompts: Sam3PointPrompt[];
  /** Box prompts used to define this object */
  boxPrompts: Sam3BoxPrompt[];
  /** Text prompt used to detect this object */
  textPrompt?: string;
}

export interface SegmentationState {
  // Mode
  mode: "image" | "video";
  promptMode: Sam3SegmentationMode;

  // Source media
  sourceImageUrl: string | null;
  sourceImageFile: File | null;
  sourceVideoUrl: string | null;
  sourceVideoFile: File | null;

  // Image dimensions (for coordinate mapping)
  imageWidth: number;
  imageHeight: number;

  // Segmented objects
  objects: SegmentedObject[];
  selectedObjectId: string | null;
  nextObjectId: number;

  // Current prompts (before submission)
  currentPointPrompts: Sam3PointPrompt[];
  currentBoxPrompts: Sam3BoxPrompt[];
  currentTextPrompt: string;

  // Composite result
  compositeImageUrl: string | null;
  masks: Sam3ImageOutput[];

  // Processing state
  isProcessing: boolean;
  progress: number;
  statusMessage: string;
  elapsedTime: number;

  // UI state
  showObjectList: boolean;
  maskOpacity: number;
  showBoundingBoxes: boolean;

  // Video-specific state
  currentFrame: number;
  totalFrames: number;
  segmentedVideoUrl: string | null;
}

export interface SegmentationActions {
  // Mode
  setMode: (mode: "image" | "video") => void;
  setPromptMode: (mode: Sam3SegmentationMode) => void;

  // Source media
  setSourceImage: (file: File, url: string) => void;
  setSourceVideo: (file: File, url: string) => void;
  clearSource: () => void;
  setImageDimensions: (width: number, height: number) => void;

  // Object management
  addObject: (object: Omit<SegmentedObject, "id" | "colorIndex">) => string;
  updateObject: (id: string, updates: Partial<SegmentedObject>) => void;
  removeObject: (id: string) => void;
  selectObject: (id: string | null) => void;
  renameObject: (id: string, name: string) => void;
  clearObjects: () => void;

  // Prompt management
  addPointPrompt: (prompt: Sam3PointPrompt) => void;
  removePointPrompt: (index: number) => void;
  addBoxPrompt: (prompt: Sam3BoxPrompt) => void;
  removeBoxPrompt: (index: number) => void;
  setTextPrompt: (prompt: string) => void;
  clearCurrentPrompts: () => void;

  // Results
  setCompositeImage: (url: string) => void;
  setMasks: (masks: Sam3ImageOutput[]) => void;
  setSegmentedVideo: (url: string) => void;

  // Processing state
  setProcessingState: (state: {
    isProcessing: boolean;
    progress?: number;
    statusMessage?: string;
    elapsedTime?: number;
  }) => void;

  // UI state
  toggleObjectList: () => void;
  setMaskOpacity: (opacity: number) => void;
  toggleBoundingBoxes: () => void;

  // Video controls
  setCurrentFrame: (frame: number) => void;
  setTotalFrames: (frames: number) => void;

  // Reset
  resetStore: () => void;
}

type SegmentationStore = SegmentationState & SegmentationActions;

// ============================================
// Initial State
// ============================================

const initialState: SegmentationState = {
  mode: "image",
  promptMode: "text",

  sourceImageUrl: null,
  sourceImageFile: null,
  sourceVideoUrl: null,
  sourceVideoFile: null,

  imageWidth: 0,
  imageHeight: 0,

  objects: [],
  selectedObjectId: null,
  nextObjectId: 1,

  currentPointPrompts: [],
  currentBoxPrompts: [],
  currentTextPrompt: "",

  compositeImageUrl: null,
  masks: [],

  isProcessing: false,
  progress: 0,
  statusMessage: "",
  elapsedTime: 0,

  showObjectList: true,
  maskOpacity: 0.5,
  showBoundingBoxes: false,

  currentFrame: 0,
  totalFrames: 0,
  segmentedVideoUrl: null,
};

// ============================================
// Store
// ============================================

export const useSegmentationStore = create<SegmentationStore>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      ...initialState,

      // Mode
      setMode: (mode) => set({ mode }, false, "segmentation/setMode"),
      setPromptMode: (promptMode) =>
        set({ promptMode }, false, "segmentation/setPromptMode"),

      // Source media
      setSourceImage: (file, url) =>
        set(
          {
            sourceImageFile: file,
            sourceImageUrl: url,
            sourceVideoFile: null,
            sourceVideoUrl: null,
            mode: "image",
          },
          false,
          "segmentation/setSourceImage"
        ),

      setSourceVideo: (file, url) =>
        set(
          {
            sourceVideoFile: file,
            sourceVideoUrl: url,
            sourceImageFile: null,
            sourceImageUrl: null,
            mode: "video",
          },
          false,
          "segmentation/setSourceVideo"
        ),

      clearSource: () =>
        set(
          {
            sourceImageFile: null,
            sourceImageUrl: null,
            sourceVideoFile: null,
            sourceVideoUrl: null,
            objects: [],
            masks: [],
            compositeImageUrl: null,
            segmentedVideoUrl: null,
          },
          false,
          "segmentation/clearSource"
        ),

      setImageDimensions: (width, height) =>
        set({ imageWidth: width, imageHeight: height }, false, "segmentation/setImageDimensions"),

      // Object management
      addObject: (objectData) => {
        const state = get();
        const id = `obj-${state.nextObjectId}`;
        const colorIndex = state.objects.length % OBJECT_COLORS.length;

        const newObject: SegmentedObject = {
          ...objectData,
          id,
          colorIndex,
          name: objectData.name || `Object ${state.nextObjectId}`,
          pointPrompts: objectData.pointPrompts || [],
          boxPrompts: objectData.boxPrompts || [],
        };

        set(
          {
            objects: [...state.objects, newObject],
            nextObjectId: state.nextObjectId + 1,
            selectedObjectId: id,
          },
          false,
          "segmentation/addObject"
        );

        return id;
      },

      updateObject: (id, updates) =>
        set(
          (state) => ({
            objects: state.objects.map((obj) =>
              obj.id === id ? { ...obj, ...updates } : obj
            ),
          }),
          false,
          "segmentation/updateObject"
        ),

      removeObject: (id) =>
        set(
          (state) => ({
            objects: state.objects.filter((obj) => obj.id !== id),
            selectedObjectId:
              state.selectedObjectId === id ? null : state.selectedObjectId,
          }),
          false,
          "segmentation/removeObject"
        ),

      selectObject: (id) =>
        set({ selectedObjectId: id }, false, "segmentation/selectObject"),

      renameObject: (id, name) =>
        set(
          (state) => ({
            objects: state.objects.map((obj) =>
              obj.id === id ? { ...obj, name } : obj
            ),
          }),
          false,
          "segmentation/renameObject"
        ),

      clearObjects: () =>
        set(
          { objects: [], selectedObjectId: null, nextObjectId: 1 },
          false,
          "segmentation/clearObjects"
        ),

      // Prompt management
      addPointPrompt: (prompt) =>
        set(
          (state) => ({
            currentPointPrompts: [...state.currentPointPrompts, prompt],
          }),
          false,
          "segmentation/addPointPrompt"
        ),

      removePointPrompt: (index) =>
        set(
          (state) => ({
            currentPointPrompts: state.currentPointPrompts.filter(
              (_, i) => i !== index
            ),
          }),
          false,
          "segmentation/removePointPrompt"
        ),

      addBoxPrompt: (prompt) =>
        set(
          (state) => ({
            currentBoxPrompts: [...state.currentBoxPrompts, prompt],
          }),
          false,
          "segmentation/addBoxPrompt"
        ),

      removeBoxPrompt: (index) =>
        set(
          (state) => ({
            currentBoxPrompts: state.currentBoxPrompts.filter(
              (_, i) => i !== index
            ),
          }),
          false,
          "segmentation/removeBoxPrompt"
        ),

      setTextPrompt: (prompt) =>
        set({ currentTextPrompt: prompt }, false, "segmentation/setTextPrompt"),

      clearCurrentPrompts: () =>
        set(
          {
            currentPointPrompts: [],
            currentBoxPrompts: [],
            currentTextPrompt: "",
          },
          false,
          "segmentation/clearCurrentPrompts"
        ),

      // Results
      setCompositeImage: (url) =>
        set({ compositeImageUrl: url }, false, "segmentation/setCompositeImage"),

      setMasks: (masks) => set({ masks }, false, "segmentation/setMasks"),

      setSegmentedVideo: (url) =>
        set({ segmentedVideoUrl: url }, false, "segmentation/setSegmentedVideo"),

      // Processing state
      setProcessingState: ({ isProcessing, progress, statusMessage, elapsedTime }) =>
        set(
          {
            isProcessing,
            ...(progress !== undefined && { progress }),
            ...(statusMessage !== undefined && { statusMessage }),
            ...(elapsedTime !== undefined && { elapsedTime }),
          },
          false,
          "segmentation/setProcessingState"
        ),

      // UI state
      toggleObjectList: () =>
        set(
          (state) => ({ showObjectList: !state.showObjectList }),
          false,
          "segmentation/toggleObjectList"
        ),

      setMaskOpacity: (opacity) =>
        set({ maskOpacity: opacity }, false, "segmentation/setMaskOpacity"),

      toggleBoundingBoxes: () =>
        set(
          (state) => ({ showBoundingBoxes: !state.showBoundingBoxes }),
          false,
          "segmentation/toggleBoundingBoxes"
        ),

      // Video controls
      setCurrentFrame: (frame) =>
        set({ currentFrame: frame }, false, "segmentation/setCurrentFrame"),

      setTotalFrames: (frames) =>
        set({ totalFrames: frames }, false, "segmentation/setTotalFrames"),

      // Reset
      resetStore: () => set(initialState, false, "segmentation/reset"),
    })),
    { name: "segmentation-store" }
  )
);

// ============================================
// Selectors
// ============================================

export const selectObjects = (state: SegmentationStore) => state.objects;
export const selectSelectedObject = (state: SegmentationStore) =>
  state.objects.find((obj) => obj.id === state.selectedObjectId);
export const selectIsProcessing = (state: SegmentationStore) => state.isProcessing;
export const selectSourceUrl = (state: SegmentationStore) =>
  state.mode === "image" ? state.sourceImageUrl : state.sourceVideoUrl;
export const selectHasSource = (state: SegmentationStore) =>
  state.sourceImageUrl !== null || state.sourceVideoUrl !== null;
```

---

### Phase 4: Segmentation Panel UI (Image Mode)

#### Subtask 4.1: Create Panel Directory Structure
- **Action**: CREATE directories
- **Estimated Time**: 2 minutes

```
qcut/apps/web/src/components/editor/segmentation/
├── index.tsx                    # Main panel container
├── SegmentationCanvas.tsx       # Canvas with click/drag handlers
├── ObjectList.tsx               # Sidebar object list
├── PromptToolbar.tsx            # Point/Box/Text mode toggles
├── MaskOverlay.tsx              # Color-coded mask rendering
├── ImageUploader.tsx            # Image upload component
└── SegmentationControls.tsx     # Action buttons
```

#### Subtask 4.2: Create SegmentationPanel (Main Container)
- **File**: `qcut/apps/web/src/components/editor/segmentation/index.tsx`
- **Action**: CREATE new file
- **Pattern**: Follow `adjustment/index.tsx`
- **Estimated Time**: 20 minutes

```typescript
"use client";

import React from "react";
import { useSegmentationStore } from "@/stores/segmentation-store";
import { useAsyncMediaStoreActions } from "@/hooks/use-async-media-store";
import { useParams } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Wand2, Loader2, ImagePlus, Video } from "lucide-react";
import { segmentWithText, uploadImageToFAL } from "@/lib/sam3-client";
import { debugLog } from "@/lib/debug-config";
import { createObjectURL } from "@/lib/blob-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Export individual components
export { ObjectList } from "./ObjectList";
export { PromptToolbar } from "./PromptToolbar";
export { SegmentationCanvas } from "./SegmentationCanvas";
export { MaskOverlay } from "./MaskOverlay";
export { ImageUploader } from "./ImageUploader";
export { SegmentationControls } from "./SegmentationControls";

// Import components for main panel
import { ObjectList } from "./ObjectList";
import { PromptToolbar } from "./PromptToolbar";
import { SegmentationCanvas } from "./SegmentationCanvas";
import { ImageUploader } from "./ImageUploader";
import { SegmentationControls } from "./SegmentationControls";

/**
 * SegmentationPanel
 *
 * Main panel for SAM-3 image and video segmentation.
 * Provides text, point, and box prompt interfaces.
 */
export function SegmentationPanel() {
  const params = useParams({ from: "/editor/$project_id" });
  const projectId = params.project_id;

  const {
    mode,
    setMode,
    sourceImageUrl,
    sourceImageFile,
    setSourceImage,
    objects,
    currentTextPrompt,
    setTextPrompt,
    isProcessing,
    setProcessingState,
    addObject,
    setCompositeImage,
    setMasks,
    clearCurrentPrompts,
    showObjectList,
  } = useSegmentationStore();

  const {
    addMediaItem,
    loading: mediaStoreLoading,
    error: mediaStoreError,
  } = useAsyncMediaStoreActions();

  const handleImageSelect = (file: File) => {
    const url = createObjectURL(file, "segmentation-image-select");
    setSourceImage(file, url);
  };

  const handleSegment = async () => {
    if (!currentTextPrompt.trim()) {
      alert("Please enter a text prompt describing what to segment.");
      return;
    }

    if (!sourceImageFile || !sourceImageUrl) {
      alert("Please upload an image first.");
      return;
    }

    try {
      const startTime = Date.now();

      setProcessingState({
        isProcessing: true,
        progress: 0,
        statusMessage: "Uploading image...",
        elapsedTime: 0,
      });

      // Upload image to FAL
      debugLog("🔄 Uploading image to FAL for segmentation...");
      const { uploadImageToFAL } = await import("@/lib/image-edit-client");
      const uploadedImageUrl = await uploadImageToFAL(sourceImageFile);

      setProcessingState({
        isProcessing: true,
        progress: 25,
        statusMessage: "Detecting objects...",
        elapsedTime: (Date.now() - startTime) / 1000,
      });

      // Call SAM-3 API
      const result = await segmentWithText(
        uploadedImageUrl,
        currentTextPrompt.trim(),
        {
          return_multiple_masks: true,
          max_masks: 10,
          include_scores: true,
          include_boxes: true,
          apply_mask: true,
        }
      );

      // Process results
      if (result.image?.url) {
        setCompositeImage(result.image.url);
      }

      if (result.masks) {
        setMasks(result.masks);

        // Create objects for each mask
        result.masks.forEach((mask, index) => {
          addObject({
            name: `${currentTextPrompt} ${index + 1}`,
            maskUrl: mask.url,
            score: result.scores?.[index]?.[0],
            boundingBox: result.boxes?.[index]?.[0],
            pointPrompts: [],
            boxPrompts: [],
            textPrompt: currentTextPrompt,
          });
        });
      }

      const totalTime = (Date.now() - startTime) / 1000;

      setProcessingState({
        isProcessing: false,
        progress: 100,
        statusMessage: `Found ${result.masks?.length || 0} objects`,
        elapsedTime: totalTime,
      });

      clearCurrentPrompts();

    } catch (error) {
      console.error("❌ Segmentation failed:", error);

      setProcessingState({
        isProcessing: false,
        progress: 0,
        statusMessage: "Segmentation failed",
        elapsedTime: 0,
      });

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      alert(`Segmentation failed: ${errorMessage}`);
    }
  };

  const canSegment = sourceImageUrl && currentTextPrompt.trim() && !isProcessing;

  // Handle media store loading/error states
  if (mediaStoreError) {
    return (
      <div className="h-full flex flex-col gap-4 p-4">
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <div className="text-red-500 mb-2">Failed to load media store</div>
            <div className="text-sm text-muted-foreground">
              {mediaStoreError.message}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mediaStoreLoading) {
    return (
      <div className="h-full flex flex-col gap-4 p-4">
        <div className="flex items-center justify-center flex-1">
          <div className="flex items-center space-x-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading segmentation panel...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      {/* Mode Tabs */}
      <Tabs value={mode} onValueChange={(v) => setMode(v as "image" | "video")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="image" className="flex items-center gap-2">
            <ImagePlus className="w-4 h-4" />
            Image
          </TabsTrigger>
          <TabsTrigger value="video" className="flex items-center gap-2">
            <Video className="w-4 h-4" />
            Video
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Segment Button */}
      <div className="flex-shrink-0">
        <Button
          onClick={handleSegment}
          disabled={!canSegment}
          className="w-full"
          size="lg"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Segmenting...
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4 mr-2" />
              Segment Objects
            </>
          )}
        </Button>
      </div>

      {/* Prompt Toolbar */}
      <div className="flex-shrink-0">
        <PromptToolbar />
      </div>

      {/* Image Upload Section */}
      <div className="flex-shrink-0">
        <ImageUploader onImageSelect={handleImageSelect} />
      </div>

      {/* Main Content Area */}
      {sourceImageUrl ? (
        <div className="flex-1 flex gap-4 min-h-0">
          {/* Canvas */}
          <div className="flex-1 min-w-0">
            <SegmentationCanvas />
          </div>

          {/* Object List Sidebar */}
          {showObjectList && objects.length > 0 && (
            <div className="w-64 flex-shrink-0">
              <ObjectList />
            </div>
          )}
        </div>
      ) : (
        /* Empty state */
        <div className="flex-1 flex items-center justify-center text-center text-muted-foreground">
          <div>
            <div className="text-6xl mb-4">✂️</div>
            <h3 className="text-lg font-medium mb-2">AI Object Segmentation</h3>
            <p className="text-sm">
              Upload an image and describe what to segment
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
```

#### Subtask 4.3: Create PromptToolbar Component
- **File**: `qcut/apps/web/src/components/editor/segmentation/PromptToolbar.tsx`
- **Action**: CREATE new file
- **Estimated Time**: 15 minutes

```typescript
"use client";

import React from "react";
import { useSegmentationStore } from "@/stores/segmentation-store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Type, MousePointer, Square, Sparkles } from "lucide-react";
import type { Sam3SegmentationMode } from "@/types/sam3";

/**
 * PromptToolbar
 *
 * Toolbar for selecting prompt mode and entering prompts.
 * Supports text, point, box, and auto modes.
 */
export function PromptToolbar() {
  const {
    promptMode,
    setPromptMode,
    currentTextPrompt,
    setTextPrompt,
    currentPointPrompts,
    currentBoxPrompts,
  } = useSegmentationStore();

  const handleModeChange = (value: string) => {
    if (value) {
      setPromptMode(value as Sam3SegmentationMode);
    }
  };

  return (
    <div className="space-y-3">
      {/* Mode Toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Mode:</span>
        <ToggleGroup
          type="single"
          value={promptMode}
          onValueChange={handleModeChange}
          className="justify-start"
        >
          <ToggleGroupItem value="text" aria-label="Text prompt mode">
            <Type className="w-4 h-4 mr-1" />
            Text
          </ToggleGroupItem>
          <ToggleGroupItem value="point" aria-label="Point prompt mode">
            <MousePointer className="w-4 h-4 mr-1" />
            Click
          </ToggleGroupItem>
          <ToggleGroupItem value="box" aria-label="Box prompt mode">
            <Square className="w-4 h-4 mr-1" />
            Box
          </ToggleGroupItem>
          <ToggleGroupItem value="auto" aria-label="Auto detect mode">
            <Sparkles className="w-4 h-4 mr-1" />
            Auto
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Text Prompt Input (shown in text and auto modes) */}
      {(promptMode === "text" || promptMode === "auto") && (
        <div className="space-y-1">
          <Input
            placeholder="Describe what to segment (e.g., 'person', 'car', 'dog')"
            value={currentTextPrompt}
            onChange={(e) => setTextPrompt(e.target.value)}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Enter a description of the objects you want to segment
          </p>
        </div>
      )}

      {/* Point/Box mode instructions */}
      {promptMode === "point" && (
        <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-2">
          <p className="font-medium mb-1">Click Mode</p>
          <p className="text-xs">
            • Left-click to mark foreground (include)
            <br />
            • Right-click to mark background (exclude)
          </p>
          {currentPointPrompts.length > 0 && (
            <p className="mt-2 text-xs">
              {currentPointPrompts.length} point(s) selected
            </p>
          )}
        </div>
      )}

      {promptMode === "box" && (
        <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-2">
          <p className="font-medium mb-1">Box Mode</p>
          <p className="text-xs">
            Click and drag to draw a box around the object
          </p>
          {currentBoxPrompts.length > 0 && (
            <p className="mt-2 text-xs">
              {currentBoxPrompts.length} box(es) drawn
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

#### Subtask 4.4: Create ObjectList Component
- **File**: `qcut/apps/web/src/components/editor/segmentation/ObjectList.tsx`
- **Action**: CREATE new file
- **Estimated Time**: 15 minutes

```typescript
"use client";

import React from "react";
import {
  useSegmentationStore,
  OBJECT_COLORS,
  type SegmentedObject,
} from "@/stores/segmentation-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Eye, EyeOff, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ObjectListItem
 *
 * Individual object item in the list.
 */
function ObjectListItem({ object }: { object: SegmentedObject }) {
  const { selectedObjectId, selectObject, removeObject, renameObject } =
    useSegmentationStore();

  const isSelected = selectedObjectId === object.id;
  const color = OBJECT_COLORS[object.colorIndex];

  const [isEditing, setIsEditing] = React.useState(false);
  const [editName, setEditName] = React.useState(object.name);

  const handleNameSubmit = () => {
    if (editName.trim()) {
      renameObject(object.id, editName.trim());
    }
    setIsEditing(false);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors",
        isSelected
          ? "bg-accent border border-accent-foreground/20"
          : "hover:bg-accent/50"
      )}
      onClick={() => selectObject(object.id)}
    >
      {/* Color indicator */}
      <div
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: color.hex }}
      />

      {/* Thumbnail or placeholder */}
      <div className="w-10 h-10 rounded bg-muted flex-shrink-0 overflow-hidden">
        {object.thumbnailUrl ? (
          <img
            src={object.thumbnailUrl}
            alt={object.name}
            className="w-full h-full object-cover"
          />
        ) : object.maskUrl ? (
          <img
            src={object.maskUrl}
            alt={object.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            ?
          </div>
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNameSubmit();
              if (e.key === "Escape") setIsEditing(false);
            }}
            className="h-6 text-sm"
            autoFocus
          />
        ) : (
          <span
            className="text-sm truncate block"
            onDoubleClick={() => {
              setEditName(object.name);
              setIsEditing(true);
            }}
          >
            {object.name}
          </span>
        )}
        {object.score !== undefined && (
          <span className="text-xs text-muted-foreground">
            {Math.round(object.score * 100)}% confident
          </span>
        )}
      </div>

      {/* Delete button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          removeObject(object.id);
        }}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

/**
 * ObjectList
 *
 * Sidebar showing all segmented objects with color coding.
 */
export function ObjectList() {
  const { objects, clearObjects } = useSegmentationStore();

  if (objects.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">Objects</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-center text-muted-foreground text-sm">
          <p>No objects detected yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Objects ({objects.length})</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearObjects}
          className="h-6 text-xs"
        >
          Clear all
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-1 pr-2">
          {objects.map((object) => (
            <ObjectListItem key={object.id} object={object} />
          ))}
        </div>
      </ScrollArea>

      {/* Action buttons */}
      <div className="mt-3 pt-3 border-t">
        <Button variant="outline" size="sm" className="w-full">
          <Plus className="w-4 h-4 mr-2" />
          Add Object
        </Button>
      </div>
    </div>
  );
}
```

#### Subtask 4.5: Create SegmentationCanvas Component
- **File**: `qcut/apps/web/src/components/editor/segmentation/SegmentationCanvas.tsx`
- **Action**: CREATE new file
- **Estimated Time**: 20 minutes

```typescript
"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  useSegmentationStore,
  OBJECT_COLORS,
} from "@/stores/segmentation-store";
import type { Sam3PointPrompt, Sam3BoxPrompt } from "@/types/sam3";

/**
 * SegmentationCanvas
 *
 * Interactive canvas for displaying image and handling click/drag interactions.
 * Renders mask overlays and point/box prompts.
 */
export function SegmentationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<Sam3BoxPrompt | null>(null);

  const {
    sourceImageUrl,
    promptMode,
    currentPointPrompts,
    currentBoxPrompts,
    addPointPrompt,
    addBoxPrompt,
    objects,
    compositeImageUrl,
    maskOpacity,
    showBoundingBoxes,
    setImageDimensions,
    imageWidth,
    imageHeight,
  } = useSegmentationStore();

  // Load and display image
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !sourceImageUrl) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      // Calculate fit dimensions
      const containerRect = container.getBoundingClientRect();
      const scale = Math.min(
        containerRect.width / img.width,
        containerRect.height / img.height
      );

      const displayWidth = img.width * scale;
      const displayHeight = img.height * scale;

      canvas.width = displayWidth;
      canvas.height = displayHeight;

      setImageDimensions(img.width, img.height);

      // Draw image
      ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

      // Draw mask overlay if available
      if (compositeImageUrl) {
        const maskImg = new Image();
        maskImg.crossOrigin = "anonymous";
        maskImg.onload = () => {
          ctx.globalAlpha = maskOpacity;
          ctx.drawImage(maskImg, 0, 0, displayWidth, displayHeight);
          ctx.globalAlpha = 1.0;

          // Draw point prompts
          drawPointPrompts(ctx, currentPointPrompts, scale);

          // Draw box prompts
          drawBoxPrompts(ctx, currentBoxPrompts, scale);

          // Draw bounding boxes if enabled
          if (showBoundingBoxes) {
            drawBoundingBoxes(ctx, objects, displayWidth, displayHeight);
          }
        };
        maskImg.src = compositeImageUrl;
      } else {
        // Just draw prompts on original image
        drawPointPrompts(ctx, currentPointPrompts, scale);
        drawBoxPrompts(ctx, currentBoxPrompts, scale);
      }
    };

    img.src = sourceImageUrl;
  }, [
    sourceImageUrl,
    compositeImageUrl,
    currentPointPrompts,
    currentBoxPrompts,
    objects,
    maskOpacity,
    showBoundingBoxes,
  ]);

  const drawPointPrompts = (
    ctx: CanvasRenderingContext2D,
    points: Sam3PointPrompt[],
    scale: number
  ) => {
    points.forEach((point) => {
      const x = point.x * scale;
      const y = point.y * scale;
      const color = point.label === 1 ? "#00FF00" : "#FF0000";

      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw + or - symbol
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(point.label === 1 ? "+" : "-", x, y);
    });
  };

  const drawBoxPrompts = (
    ctx: CanvasRenderingContext2D,
    boxes: Sam3BoxPrompt[],
    scale: number
  ) => {
    boxes.forEach((box) => {
      const x = box.x_min * scale;
      const y = box.y_min * scale;
      const width = (box.x_max - box.x_min) * scale;
      const height = (box.y_max - box.y_min) * scale;

      ctx.strokeStyle = "#00CED1";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);
    });
  };

  const drawBoundingBoxes = (
    ctx: CanvasRenderingContext2D,
    objects: typeof useSegmentationStore.getState().objects,
    width: number,
    height: number
  ) => {
    objects.forEach((obj) => {
      if (!obj.boundingBox) return;

      const [cx, cy, w, h] = obj.boundingBox;
      const color = OBJECT_COLORS[obj.colorIndex];

      const x = (cx - w / 2) * width;
      const y = (cy - h / 2) * height;
      const boxWidth = w * width;
      const boxHeight = h * height;

      ctx.strokeStyle = color.hex;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, boxWidth, boxHeight);
    });
  };

  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !imageWidth || !imageHeight) return null;

      const rect = canvas.getBoundingClientRect();
      const scaleX = imageWidth / canvas.width;
      const scaleY = imageHeight / canvas.height;

      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      return { x: Math.round(x), y: Math.round(y) };
    },
    [imageWidth, imageHeight]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (promptMode !== "point") return;

      const coords = getCanvasCoordinates(e);
      if (!coords) return;

      // Left click = foreground (1), Right click = background (0)
      const label = e.button === 2 ? 0 : 1;

      addPointPrompt({
        x: coords.x,
        y: coords.y,
        label: label as 0 | 1,
      });
    },
    [promptMode, getCanvasCoordinates, addPointPrompt]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (promptMode === "point") {
        handleCanvasClick(e);
        return;
      }

      if (promptMode !== "box") return;

      const coords = getCanvasCoordinates(e);
      if (!coords) return;

      setIsDrawingBox(true);
      setBoxStart(coords);
    },
    [promptMode, getCanvasCoordinates, handleCanvasClick]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawingBox || !boxStart) return;

      const coords = getCanvasCoordinates(e);
      if (!coords) return;

      setCurrentBox({
        x_min: Math.min(boxStart.x, coords.x),
        y_min: Math.min(boxStart.y, coords.y),
        x_max: Math.max(boxStart.x, coords.x),
        y_max: Math.max(boxStart.y, coords.y),
      });
    },
    [isDrawingBox, boxStart, getCanvasCoordinates]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawingBox || !currentBox) return;

    // Only add box if it has some size
    const width = currentBox.x_max - currentBox.x_min;
    const height = currentBox.y_max - currentBox.y_min;

    if (width > 10 && height > 10) {
      addBoxPrompt(currentBox);
    }

    setIsDrawingBox(false);
    setBoxStart(null);
    setCurrentBox(null);
  }, [isDrawingBox, currentBox, addBoxPrompt]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (promptMode === "point") {
        handleCanvasClick(e);
      }
    },
    [promptMode, handleCanvasClick]
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center bg-muted/30 rounded-lg overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
}
```

#### Subtask 4.6: Create ImageUploader Component
- **File**: `qcut/apps/web/src/components/editor/segmentation/ImageUploader.tsx`
- **Action**: CREATE new file
- **Pattern**: Follow `adjustment/image-uploader.tsx`
- **Estimated Time**: 10 minutes

```typescript
"use client";

import React, { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageUploaderProps {
  onImageSelect: (file: File) => void;
  disabled?: boolean;
}

/**
 * ImageUploader
 *
 * Drag-and-drop image upload component for segmentation.
 */
export function ImageUploader({ onImageSelect, disabled }: ImageUploaderProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file) {
        onImageSelect(file);
      }
    },
    [onImageSelect]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif"],
    },
    maxFiles: 1,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
        isDragActive
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-2">
        {isDragActive ? (
          <>
            <Upload className="w-8 h-8 text-primary" />
            <p className="text-sm text-primary">Drop image here</p>
          </>
        ) : (
          <>
            <ImageIcon className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Drag & drop an image, or click to select
            </p>
            <p className="text-xs text-muted-foreground/70">
              Supports PNG, JPG, WebP, GIF
            </p>
          </>
        )}
      </div>
    </div>
  );
}
```

#### Subtask 4.7: Create MaskOverlay Component
- **File**: `qcut/apps/web/src/components/editor/segmentation/MaskOverlay.tsx`
- **Action**: CREATE new file
- **Estimated Time**: 10 minutes

```typescript
"use client";

import React from "react";
import { useSegmentationStore, OBJECT_COLORS } from "@/stores/segmentation-store";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * MaskOverlay
 *
 * Controls for mask overlay opacity and bounding box visibility.
 */
export function MaskOverlay() {
  const {
    maskOpacity,
    setMaskOpacity,
    showBoundingBoxes,
    toggleBoundingBoxes,
    objects,
  } = useSegmentationStore();

  if (objects.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 p-3 bg-muted/30 rounded-lg">
      <h4 className="text-sm font-medium">Overlay Settings</h4>

      {/* Mask Opacity */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Mask Opacity</Label>
          <span className="text-xs text-muted-foreground">
            {Math.round(maskOpacity * 100)}%
          </span>
        </div>
        <Slider
          value={[maskOpacity]}
          onValueChange={([value]) => setMaskOpacity(value)}
          min={0}
          max={1}
          step={0.05}
          className="w-full"
        />
      </div>

      {/* Show Bounding Boxes */}
      <div className="flex items-center justify-between">
        <Label className="text-xs">Show Bounding Boxes</Label>
        <Switch
          checked={showBoundingBoxes}
          onCheckedChange={toggleBoundingBoxes}
        />
      </div>

      {/* Color Legend */}
      <div className="space-y-1">
        <Label className="text-xs">Object Colors</Label>
        <div className="flex flex-wrap gap-1">
          {objects.map((obj) => (
            <div
              key={obj.id}
              className="flex items-center gap-1 text-xs bg-background/50 rounded px-1.5 py-0.5"
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: OBJECT_COLORS[obj.colorIndex].hex }}
              />
              <span className="truncate max-w-[60px]">{obj.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

#### Subtask 4.8: Create SegmentationControls Component
- **File**: `qcut/apps/web/src/components/editor/segmentation/SegmentationControls.tsx`
- **Action**: CREATE new file
- **Estimated Time**: 10 minutes

```typescript
"use client";

import React from "react";
import { useSegmentationStore } from "@/stores/segmentation-store";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw, Trash2 } from "lucide-react";

/**
 * SegmentationControls
 *
 * Action buttons for segmentation operations.
 */
export function SegmentationControls() {
  const {
    objects,
    compositeImageUrl,
    masks,
    clearObjects,
    clearSource,
    clearCurrentPrompts,
  } = useSegmentationStore();

  const handleDownloadMasks = async () => {
    if (masks.length === 0) return;

    // Download each mask
    for (let i = 0; i < masks.length; i++) {
      const mask = masks[i];
      if (!mask.url) continue;

      try {
        const response = await fetch(mask.url);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = `mask_${i + 1}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
      } catch (error) {
        console.error(`Failed to download mask ${i + 1}:`, error);
      }
    }
  };

  const handleReset = () => {
    clearObjects();
    clearCurrentPrompts();
  };

  const handleClearAll = () => {
    clearSource();
    clearObjects();
    clearCurrentPrompts();
  };

  return (
    <div className="flex items-center gap-2">
      {/* Download Masks */}
      {masks.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownloadMasks}
          className="flex items-center gap-1"
        >
          <Download className="w-4 h-4" />
          Download Masks
        </Button>
      )}

      {/* Reset Objects */}
      {objects.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          className="flex items-center gap-1"
        >
          <RefreshCw className="w-4 h-4" />
          Reset
        </Button>
      )}

      {/* Clear All */}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleClearAll}
        className="flex items-center gap-1 text-destructive hover:text-destructive"
      >
        <Trash2 className="w-4 h-4" />
        Clear All
      </Button>
    </div>
  );
}
```

---

### Phase 5: Integration & Navigation

#### Subtask 5.1: Add Segmentation Panel to Navigation
- **File**: Locate and modify navigation/routing configuration
- **Action**: MODIFY - Add segmentation panel route
- **Estimated Time**: 15 minutes

**Note**: Specific file path depends on project routing structure. Look for:
- Router configuration files
- Panel/tab registration
- Navigation menu components

Add segmentation panel alongside existing panels (adjustment, text2image, etc.)

#### Subtask 5.2: Export from Components Index
- **File**: `qcut/apps/web/src/components/editor/index.ts` (if exists) or create
- **Action**: ADD export
- **Estimated Time**: 5 minutes

```typescript
export { SegmentationPanel } from "./segmentation";
```

---

### Phase 6: Video Segmentation UI (Future Enhancement)

#### Subtask 6.1: Create VideoTimeline Component
- **File**: `qcut/apps/web/src/components/editor/segmentation/VideoTimeline.tsx`
- **Action**: CREATE new file
- **Estimated Time**: 20 minutes
- **Status**: Pending (Phase 5 completion)

#### Subtask 6.2: Create VideoPreview Component
- **File**: `qcut/apps/web/src/components/editor/segmentation/VideoPreview.tsx`
- **Action**: CREATE new file
- **Estimated Time**: 20 minutes
- **Status**: Pending (Phase 5 completion)

---

## Summary

### Files to CREATE (Phase 2-4)

| File | Purpose | Est. Time |
|------|---------|-----------|
| `src/stores/segmentation-store.ts` | Zustand store for segmentation state | 20 min |
| `src/components/editor/segmentation/index.tsx` | Main panel container | 20 min |
| `src/components/editor/segmentation/PromptToolbar.tsx` | Mode selection and prompt input | 15 min |
| `src/components/editor/segmentation/ObjectList.tsx` | Sidebar object list | 15 min |
| `src/components/editor/segmentation/SegmentationCanvas.tsx` | Interactive canvas | 20 min |
| `src/components/editor/segmentation/ImageUploader.tsx` | Image upload dropzone | 10 min |
| `src/components/editor/segmentation/MaskOverlay.tsx` | Overlay controls | 10 min |
| `src/components/editor/segmentation/SegmentationControls.tsx` | Action buttons | 10 min |

### Files to MODIFY

| File | Changes | Est. Time |
|------|---------|-----------|
| `src/types/sam3.ts` | Add video types | 10 min |
| `src/lib/sam3-client.ts` | Add video methods | 15 min |
| `src/types/ai-generation.ts` | Add video type exports | 5 min |
| Navigation/routing files | Add panel route | 15 min |

### Total Estimated Time: ~165 minutes (~2.75 hours)

---

## Implementation Order

1. **Phase 2**: Video API Extension (30 min) - Optional, can defer
2. **Phase 3**: Segmentation Store (20 min) - Required first
3. **Phase 4**: UI Components (100 min) - Main work
4. **Phase 5**: Integration (20 min) - Final wiring
5. **Phase 6**: Video UI (40 min) - Future enhancement

---

## Testing Checklist

### Image Segmentation
- [ ] Image upload works (drag-drop and click)
- [ ] Text prompt triggers SAM-3 API
- [ ] Masks display on canvas
- [ ] Objects appear in sidebar list
- [ ] Point prompts work (left/right click)
- [ ] Box prompts work (drag to draw)
- [ ] Object selection highlights correctly
- [ ] Mask opacity slider works
- [ ] Download masks works
- [ ] Clear/reset works

### Video Segmentation (Phase 6)
- [ ] Video upload works
- [ ] Text prompt triggers video API
- [ ] Timeline scrubbing works
- [ ] Frame preview works
- [ ] Segmented video displays
- [ ] Download segmented video works
