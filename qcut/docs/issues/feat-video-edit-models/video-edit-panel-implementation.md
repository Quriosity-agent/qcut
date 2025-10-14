# Video Edit Models Panel - Implementation Plan

## Overview
Add a new "Video Edit" panel after Stickers that provides AI-powered video enhancement capabilities using three fal.ai models:

1. **Kling Video to Audio** - Generate audio from input videos
2. **MMAudio V2** - Generate synchronized audio based on video and text prompts
3. **Topaz Video Upscale** - Professional-grade video upscaling with frame interpolation

## Models Details

### 1. Kling Video to Audio
**API**: `https://fal.ai/models/fal-ai/kling-video/video-to-audio/api`

**Description**: Generate audio from input videos using Kling

**Capabilities**:
- Extract and enhance audio from video files
- Support for videos up to 100MB
- Video duration: 3-20 seconds
- Custom sound effects and background music
- ASMR mode for detailed sound effects

**Input Parameters**:
- `video_url` (required): URL of the video file
- `sound_effect_prompt` (optional): Custom sound effect description
- `background_music_prompt` (optional): Custom background music description
- `asmr_mode` (optional): Enhance detailed sound effects (boolean)

**Output**:
- Original video with dubbed audio
- Extracted/generated audio in MP3 format
- URLs for downloading both files

**Pricing**: TBD (need to check fal.ai pricing)

---

### 2. MMAudio V2
**API**: `https://fal.ai/models/fal-ai/mmaudio-v2`

**Description**: Generate synchronized audio given video and/or text inputs

**Capabilities**:
- Generate audio synchronized with video content
- Text-to-audio generation
- Combine with video models for complete video+audio output

**Input Parameters**:
- `video_url` (required): URL of the video
- `prompt` (required): Text description for audio generation
- `negative_prompt` (optional): What to avoid in audio
- `seed` (optional): For reproducible results
- `num_steps` (optional, default: 25): Number of generation steps
- `duration` (optional, default: 8): Audio duration in seconds
- `cfg_strength` (optional, default: 4.5): Classifier-free guidance strength
- `mask_away_clip` (optional, default: false): Mask away CLIP features

**Output**:
- Video file with synchronized audio
- File details (size, name, content type)
- Download URL

**Pricing**: $0.001 per second of processing

---

### 3. Topaz Video Upscale
**API**: `https://fal.ai/models/fal-ai/topaz/upscale/video/api`

**Description**: Professional-grade video upscaling using Topaz technology

**Capabilities**:
- Upscale videos up to 8x resolution
- Frame interpolation up to 120 FPS
- Uses Proteus v4 for upscaling
- Uses Apollo v8 for frame interpolation
- Supports commercial use

**Input Parameters**:
- `video_url` (required): URL of the video to upscale
- `upscale_factor` (optional, default: 2): Factor to upscale (e.g., 2.0 doubles width/height)
- `target_fps` (optional): Target FPS (enables frame interpolation when set)
- `H264_output` (optional, default: false): Use H264 codec instead of H265

**Output**:
- Upscaled video file
- Video URL in response

**Pricing**: TBD (need to check fal.ai pricing)

---

## Implementation Plan

### Phase 1: Panel Setup

#### 1.1 Add "Video Edit" to Tab Type
**File**: `qcut/apps/web/src/components/editor/media-panel/store.ts`

```typescript
export type Tab =
  | "media"
  | "audio"
  | "text"
  | "stickers"
  | "video-edit"  // ADD THIS
  | "effects"
  // ... rest of tabs
```

#### 1.2 Add Tab Configuration
**File**: `qcut/apps/web/src/components/editor/media-panel/store.ts`

```typescript
import { FilmIcon } from "lucide-react"; // or VideoIcon, WandSparkles, etc.

export const tabs: { [key in Tab]: { icon: LucideIcon; label: string } } = {
  media: { icon: VideoIcon, label: "Media" },
  // ... other tabs
  stickers: { icon: StickerIcon, label: "Stickers" },
  "video-edit": {
    icon: FilmIcon,  // Choose appropriate icon
    label: "Video Edit",
  },
  // ... rest of tabs
};
```

#### 1.3 Register View Component
**File**: `qcut/apps/web/src/components/editor/media-panel/index.tsx`

```typescript
import VideoEditView from "./views/video-edit";

export function MediaPanel() {
  const { activeTab } = useMediaPanelStore();

  const viewMap: Record<Tab, React.ReactNode> = {
    media: <MediaView />,
    // ... other views
    stickers: <StickersView />,
    "video-edit": <VideoEditView />,
    // ... rest of views
  };

  return (
    <div className="h-full flex flex-col bg-panel rounded-sm">
      <TabBar />
      <div className="flex-1 overflow-y-auto">{viewMap[activeTab]}</div>
    </div>
  );
}
```

---

### Phase 2: Create Video Edit View Component

#### 2.1 Create Main Component
**File**: `qcut/apps/web/src/components/editor/media-panel/views/video-edit.tsx`

**Structure** (following AI Video pattern):
```typescript
"use client";

import { useState } from "react";
import { FilmIcon, Upload, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUpload } from "@/components/ui/file-upload";

type VideoEditTab = "audio-gen" | "audio-sync" | "upscale";

export default function VideoEditView() {
  const [activeTab, setActiveTab] = useState<VideoEditTab>("audio-gen");
  const [sourceVideo, setSourceVideo] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center mb-4">
        <FilmIcon className="size-5 text-primary mr-2" />
        <h3 className="text-sm font-medium">Video Edit</h3>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as VideoEditTab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="audio-gen">Audio Gen</TabsTrigger>
          <TabsTrigger value="audio-sync">Audio Sync</TabsTrigger>
          <TabsTrigger value="upscale">Upscale</TabsTrigger>
        </TabsList>

        {/* Kling Video to Audio Tab */}
        <TabsContent value="audio-gen" className="space-y-4">
          {/* Video upload */}
          {/* Sound effect prompt */}
          {/* Background music prompt */}
          {/* ASMR mode toggle */}
          {/* Process button */}
        </TabsContent>

        {/* MMAudio V2 Tab */}
        <TabsContent value="audio-sync" className="space-y-4">
          {/* Video upload */}
          {/* Prompt input */}
          {/* Advanced settings (steps, duration, cfg_strength) */}
          {/* Process button */}
        </TabsContent>

        {/* Topaz Upscale Tab */}
        <TabsContent value="upscale" className="space-y-4">
          {/* Video upload */}
          {/* Upscale factor selector */}
          {/* Target FPS selector */}
          {/* Codec selection */}
          {/* Process button */}
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

---

### Phase 3: Create Supporting Files

#### 3.1 Types Definition
**File**: `qcut/apps/web/src/components/editor/media-panel/views/video-edit-types.ts`

```typescript
export type VideoEditTab = "audio-gen" | "audio-sync" | "upscale";

export interface KlingVideoToAudioParams {
  video_url: string;
  sound_effect_prompt?: string;
  background_music_prompt?: string;
  asmr_mode?: boolean;
}

export interface MMAudioV2Params {
  video_url: string;
  prompt: string;
  negative_prompt?: string;
  seed?: number;
  num_steps?: number;
  duration?: number;
  cfg_strength?: number;
  mask_away_clip?: boolean;
}

export interface TopazUpscaleParams {
  video_url: string;
  upscale_factor?: number;
  target_fps?: number;
  H264_output?: boolean;
}

export interface VideoEditModel {
  id: string;
  name: string;
  description: string;
  price: string;
  category: "audio-gen" | "audio-sync" | "upscale";
}

export interface VideoEditResult {
  modelId: string;
  videoUrl: string;
  audioUrl?: string;
  jobId: string;
}
```

#### 3.2 Constants Definition
**File**: `qcut/apps/web/src/components/editor/media-panel/views/video-edit-constants.ts`

```typescript
import { VideoEditModel } from "./video-edit-types";

export const VIDEO_EDIT_MODELS: VideoEditModel[] = [
  {
    id: "kling_video_to_audio",
    name: "Kling Video to Audio",
    description: "Generate audio from video (3-20s)",
    price: "TBD",
    category: "audio-gen",
  },
  {
    id: "mmaudio_v2",
    name: "MMAudio V2",
    description: "Synchronized audio generation",
    price: "$0.001/sec",
    category: "audio-sync",
  },
  {
    id: "topaz_upscale",
    name: "Topaz Video Upscale",
    description: "Professional upscaling up to 8x",
    price: "TBD",
    category: "upscale",
  },
];

export const VIDEO_EDIT_UPLOAD_CONSTANTS = {
  MAX_VIDEO_SIZE_BYTES: 100 * 1024 * 1024, // 100MB for Kling
  MAX_VIDEO_SIZE_LABEL: "100MB",
  ALLOWED_VIDEO_TYPES: ["video/mp4", "video/quicktime", "video/x-msvideo"],
  VIDEO_FORMATS_LABEL: "MP4, MOV, AVI",
};

export const ERROR_MESSAGES = {
  NO_VIDEO: "Please upload a video file",
  NO_PROMPT: "Please enter a prompt",
  INVALID_VIDEO_TYPE: "Please upload a valid video file (MP4, MOV, AVI)",
  VIDEO_TOO_LARGE: "Video file is too large (max 100MB)",
  GENERATION_FAILED: "Video processing failed. Please try again.",
};
```

#### 3.3 Processing Hook
**File**: `qcut/apps/web/src/components/editor/media-panel/views/use-video-edit-processing.ts`

```typescript
import { useState } from "react";
import { useTimelineStore } from "@/stores/timeline-store";
import { useProjectStore } from "@/stores/project-store";
import type {
  KlingVideoToAudioParams,
  MMAudioV2Params,
  TopazUpscaleParams,
  VideoEditResult,
} from "./video-edit-types";

export function useVideoEditProcessing() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [result, setResult] = useState<VideoEditResult | null>(null);

  const { activeProject } = useProjectStore();
  const { addMediaElement } = useTimelineStore();

  const processKlingVideoToAudio = async (params: KlingVideoToAudioParams) => {
    // TODO: Implement fal.ai API call
  };

  const processMMAudioV2 = async (params: MMAudioV2Params) => {
    // TODO: Implement fal.ai API call
  };

  const processTopazUpscale = async (params: TopazUpscaleParams) => {
    // TODO: Implement fal.ai API call
  };

  return {
    isProcessing,
    progress,
    statusMessage,
    result,
    processKlingVideoToAudio,
    processMMAudioV2,
    processTopazUpscale,
  };
}
```

---

### Phase 4: API Integration

#### 4.1 Create Video Edit API Client
**File**: `qcut/apps/web/src/lib/video-edit-client.ts`

```typescript
import * as fal from "@fal-ai/serverless-client";

export class VideoEditClient {
  constructor() {
    // Initialize fal.ai client with API key from Electron
    this.initializeFalClient();
  }

  private async initializeFalClient() {
    const apiKey = await window.electronAPI?.apiKeys?.get("fal");
    if (apiKey?.value) {
      fal.config({ credentials: apiKey.value });
    }
  }

  async generateKlingAudio(params: {
    video_url: string;
    sound_effect_prompt?: string;
    background_music_prompt?: string;
    asmr_mode?: boolean;
  }) {
    const result = await fal.subscribe("fal-ai/kling-video/video-to-audio", {
      input: params,
      logs: true,
      onQueueUpdate: (update) => {
        // Handle progress updates
      },
    });
    return result;
  }

  async generateMMAudio(params: {
    video_url: string;
    prompt: string;
    negative_prompt?: string;
    num_steps?: number;
    duration?: number;
    cfg_strength?: number;
  }) {
    const result = await fal.subscribe("fal-ai/mmaudio-v2", {
      input: params,
      logs: true,
      onQueueUpdate: (update) => {
        // Handle progress updates
      },
    });
    return result;
  }

  async upscaleVideoTopaz(params: {
    video_url: string;
    upscale_factor?: number;
    target_fps?: number;
    H264_output?: boolean;
  }) {
    const result = await fal.subscribe("fal-ai/topaz/upscale/video", {
      input: params,
      logs: true,
      onQueueUpdate: (update) => {
        // Handle progress updates
      },
    });
    return result;
  }
}

export const videoEditClient = new VideoEditClient();
```

---

### Phase 5: UI Components

#### 5.1 Video Upload Component
Reuse existing `FileUpload` component from AI Video implementation

#### 5.2 Settings Components
- Slider for upscale factor (1x - 8x)
- Dropdown for FPS selection (24, 30, 60, 120)
- Checkbox for ASMR mode
- Number input for steps, duration, cfg_strength

#### 5.3 Results Display
Show processed video with:
- Preview player
- Download button
- Add to timeline button
- Cost information

---

## File Structure

```
qcut/apps/web/src/components/editor/media-panel/views/
├── video-edit.tsx                      # Main component
├── video-edit-types.ts                 # Type definitions
├── video-edit-constants.ts             # Constants and models config
├── use-video-edit-processing.ts        # Processing hook
└── video-edit-history-panel.tsx        # History panel (optional)

qcut/apps/web/src/lib/
└── video-edit-client.ts                # fal.ai API client
```

---

## Implementation Checklist

### Phase 1: Setup
- [ ] Add "video-edit" to Tab type in store.ts
- [ ] Add tab configuration with icon and label
- [ ] Register VideoEditView in MediaPanel index.tsx
- [ ] Update panel order (after Stickers)

### Phase 2: Core UI
- [ ] Create video-edit.tsx with tab layout
- [ ] Implement Kling Audio Gen tab UI
- [ ] Implement MMAudio V2 tab UI
- [ ] Implement Topaz Upscale tab UI
- [ ] Add file upload components
- [ ] Add settings controls

### Phase 3: Types & Constants
- [ ] Create video-edit-types.ts
- [ ] Create video-edit-constants.ts
- [ ] Define all TypeScript interfaces
- [ ] Add error messages

### Phase 4: Processing Logic
- [ ] Create use-video-edit-processing.ts hook
- [ ] Implement state management
- [ ] Add progress tracking
- [ ] Handle results

### Phase 5: API Integration
- [ ] Create video-edit-client.ts
- [ ] Implement Kling API call
- [ ] Implement MMAudio V2 API call
- [ ] Implement Topaz Upscale API call
- [ ] Add error handling
- [ ] Test all three endpoints

### Phase 6: Polish
- [ ] Add loading states
- [ ] Add error handling UI
- [ ] Add success messages
- [ ] Add cost display
- [ ] Add history panel (optional)
- [ ] Add tooltips and help text
- [ ] Test responsive layout

### Phase 7: Integration
- [ ] Test with timeline store
- [ ] Test adding processed videos to timeline
- [ ] Test file uploads
- [ ] Test all three models end-to-end
- [ ] Add analytics tracking

---

## Design Considerations

### 1. Video Upload
- Support drag-and-drop
- Show video preview
- Display file size and duration
- Validate file format and size

### 2. Processing States
- Uploading → Queued → Processing → Complete
- Show progress percentage
- Estimated time remaining
- Cancel button

### 3. Cost Display
- Show estimated cost before processing
- Display actual cost after completion
- Track total spending (optional)

### 4. Results Management
- Auto-add to timeline option
- Download processed file
- Re-process with different settings
- Save to history

### 5. Error Handling
- Network errors
- API errors
- File format errors
- Size limit errors
- Clear error messages with retry option

---

## Testing Plan

1. **Unit Tests**
   - API client methods
   - Processing hook logic
   - File validation

2. **Integration Tests**
   - Upload → Process → Timeline flow
   - All three models
   - Error scenarios

3. **E2E Tests**
   - Complete workflow for each model
   - Multi-step processing
   - History management

---

## Future Enhancements

1. **Batch Processing**
   - Process multiple videos
   - Queue management

2. **Presets**
   - Save common settings
   - Quick apply presets

3. **Advanced Settings**
   - More granular control
   - Expert mode

4. **History Panel**
   - Browse processed videos
   - Re-use settings
   - Compare results

5. **Integration**
   - Direct upload from timeline
   - Process in-place
   - Non-destructive editing

---

## Notes

- Follow the exact pattern from AI Video Avatar implementation (ai.tsx)
- Reuse FileUpload component
- Use same state management approach
- Maintain consistent UI/UX
- Keep responsive design
- Add proper TypeScript types
- Include comprehensive error handling
- Add debug logging
- Follow accessibility guidelines from CLAUDE.md
