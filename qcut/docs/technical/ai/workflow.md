# AI Video Generation Workflow Documentation

## Overview

QCut includes comprehensive AI-powered video generation capabilities, allowing users to create custom videos from text prompts and images directly within the video editor. This system integrates with multiple leading AI video models via FAL.ai and seamlessly adds generated content to the timeline.

> **Warning: Desktop App Only**: AI video generation features require the Electron desktop application. These features are not available in web-only mode because they rely on Electron IPC for secure API key storage and management.


sequenceDiagram
    actor User
    participant UI as AI Panel UI
    participant Model as Model Selection
    participant Capabilities as Capability System
    participant Generation as useAIGeneration
    participant API as FAL API
    participant MediaStore as Media Store

    User->>UI: Select T2V models
    UI->>Model: Update selectedModels
    Model->>Capabilities: getCombinedCapabilities(selectedModels)
    Capabilities-->>UI: Return intersected capabilities
    UI->>UI: Render clamped T2V settings<br/>(aspect_ratio, duration, resolution)

    User->>UI: Enter prompt + adjust settings
    User->>UI: Click Generate
    UI->>Generation: Call generateVideo with t2v*Props

    Generation->>Generation: Validate duration vs. capabilities<br/>(getSafeDuration clamping)
    Generation->>Generation: Build unifiedParams<br/>(sanitize to capability ranges)
    Generation->>API: Send request with unifiedParams
    API-->>Generation: Return video_url + metadata

    Generation->>MediaStore: Download + create media item
    Generation->>MediaStore: addMediaItem with unified metadata
    MediaStore-->>Generation: Persist to storage
    Generation->>UI: Update progress to 100% + onComplete
    UI-->>User: Display generated video


## Available AI Video Models

### Text-to-Video Models

#### OpenAI Sora 2
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Sora 2 T2V** | 720p | 12s | $0.10/s | State-of-the-art text-to-video |
| **Sora 2 T2V Pro** | 720p/1080p | 12s | $0.30-0.50 | High-quality with 1080p support |

#### Google Veo 3.1
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Veo 3.1 Fast** | 720p/1080p | 8s | $1.20 | Faster, budget-friendly |
| **Veo 3.1** | 720p/1080p | 8s | $3.20 | Premium quality |

#### LTX Video 2.0
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **LTX Video 2.0 Pro** | 1080p-4K | 10s | $0.06 | Audio generation, up to 4K |
| **LTX Video 2.0 Fast** | 1080p-4K | 20s | $0.04-0.16 | Extended duration, up to 4K |

#### MiniMax Hailuo
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Hailuo 2.3 Standard** | 768p | 10s | $0.28-0.56 | Budget text-to-video |
| **Hailuo 2.3 Pro** | 1080p | 10s | $0.49 | Cinematic camera control |

#### ByteDance Seedance
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Seedance v1 Lite** | 720p | 10s | $0.18 | Fast and efficient |
| **Seedance v1 Pro** | 1080p | 10s | $0.62 | High quality 1080p |

#### Kuaishou Kling
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Kling v3 Pro** | 1080p | 15s | $0.336 | Latest flagship with audio generation |
| **Kling v3 Standard** | 1080p | 15s | $0.252 | Cost-effective v3 with audio |
| **Kling v2.6 Pro** | 1080p | 10s | $0.70 | Cinematic visuals with audio |
| **Kling v2.5 Turbo Pro** | 1080p | 10s | $0.18 | Enhanced turbo performance |
| **Kling v2.5 Turbo Standard** | 720p | 10s | $0.10 | Efficient text-to-video |

#### Vidu
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Vidu Q3 T2V** | 360p-1080p | 16s | $0.07-0.154/s | Flexible duration, seed support |

#### Alibaba WAN
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **WAN v2.6 T2V** | 720p/1080p | 15s | $0.10-0.15/s | Multi-shot support, audio sync |
| **WAN v2.5 Preview** | 1080p | 10s | $0.12 | Next-gen quality |

### Image-to-Video Models

#### OpenAI Sora 2
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Sora 2 I2V** | 720p | 12s | $0.10/s | Image animation |
| **Sora 2 I2V Pro** | 720p/1080p | 12s | $0.30-0.50 | High-quality animation |

#### Google Veo 3.1
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Veo 3.1 Fast I2V** | 720p/1080p | 8s | $1.20 | Fast image animation |
| **Veo 3.1 Fast Frame-to-Video** | 720p/1080p | 8s | $1.20 | First/last frame animation |
| **Veo 3.1 I2V** | 720p/1080p | 8s | $3.20 | Premium image animation |
| **Veo 3.1 Frame-to-Video** | 720p/1080p | 8s | $3.20 | Premium frame animation |

#### LTX Video 2.0
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **LTX Video 2.0 I2V** | 1080p-4K | 10s | $0.36 | Audio + image animation |
| **LTX Video 2.0 Fast I2V** | 1080p-4K | 20s | $0.04-0.16 | Extended I2V |

#### ByteDance Seedance
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Seedance v1 Pro Fast I2V** | 480p-1080p | 12s | $0.24 | Fast, balanced quality |
| **Seedance v1 Pro I2V** | 480p-1080p | 12s | $0.62 | Premium quality |

#### Kuaishou Kling
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Kling v3 Pro I2V** | 1080p | 12s | $0.336 | Latest flagship I2V with audio |
| **Kling v3 Standard I2V** | 1080p | 12s | $0.252 | Cost-effective v3 I2V with audio |
| **Kling v2.6 Pro I2V** | 1080p | 10s | $0.70 | Cinematic visuals with audio |
| **Kling v2.5 Turbo Pro I2V** | 1080p | 10s | $0.35 | Cinematic motion |
| **Kling O1 I2V** | 1080p | 10s | $0.112 | Start/end frame transitions |

#### MiniMax Hailuo
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Hailuo 2.3 Standard** | 768p | 10s | $0.28-0.56 | Budget I2V |
| **Hailuo 2.3 Fast Pro** | 1080p | 10s | $0.33 | Faster 1080p |
| **Hailuo 2.3 Pro** | 1080p | 10s | $0.49 | Highest fidelity |

#### Alibaba WAN
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **WAN v2.6 I2V** | 720p/1080p | 15s | $0.10-0.15/s | Multi-shot, audio sync |
| **WAN v2.5 Preview I2V** | 480p-1080p | 10s | $0.05-0.15/s | Music + prompt expansion |

#### Vidu
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Vidu Q3 I2V** | 360p-1080p | 16s | $0.07-0.154/s | Flexible duration, audio generation |
| **Vidu Q2 Turbo I2V** | 720p | 8s | $0.05 | Motion control |

### Avatar & Video Transformation Models

| Model | Resolution | Max Duration | Price | Required Inputs |
|-------|------------|--------------|-------|-----------------|
| **Kling Avatar v2 Pro** | 1080p | 60s | $0.115/s | Image + Audio |
| **Kling Avatar v2 Standard** | 1080p | 60s | $0.0562/s | Image + Audio |
| **Kling Avatar Pro** | 1080p | 10s | $0.25 | Image + Audio |
| **Kling Avatar Standard** | 720p | 10s | $0.15 | Image + Audio |
| **ByteDance OmniHuman v1.5** | 1080p | 30s | $0.20 | Image + Audio |
| **Sync Lipsync React-1** | Preserves source | 15s | $0.10 | Video + Audio |
| **WAN v2.6 Ref2V** | 720p/1080p | 15s | $0.10-0.15/s | Reference Video |
| **WAN Animate/Replace** | 480p-720p | 30s | $0.075 | Image + Video |
| **Kling O1 Video Reference** | 1080p | 10s | $0.112 | Source Video |
| **Kling O1 Video Edit** | 1080p | 10s | $0.168 | Source Video |
| **Kling O1 Reference-to-Video** | 1080p | 10s | $0.112 | Reference Images |
| **Veo 3.1 Fast Extend** | 720p | 7s | $0.15/s | Source Video |
| **Veo 3.1 Extend** | 720p | 7s | $0.40/s | Source Video |
| **Sora 2 Video Remix** | Preserves source | 12s | Dynamic | Sora video ID |

### Cinematic Angles (SHOTS)

| Model | Resolution | Price | Best For |
|-------|------------|-------|----------|
| **SHOTS Cinematic Angles** | 1080p | $0.40 | 9 camera angles from a single image |

Generates 9 cinematic camera perspectives (Front, Front-Left 45, Left 90, Back-Left 135, Back 180, Back-Right 225, Right 270, Front-Right 315, Top-Down) using Seeddream v4.5. Angles are processed in batches of 3 for FAL rate limit compliance.

### Image Upscale Models

| Model | Max Scale | Price | Best For |
|-------|-----------|-------|----------|
| **Crystal Upscaler** | 10x | $0.02/image | Budget-friendly, fast, social media |
| **SeedVR Upscale** | 16x | mid-tier | Creative upscaling with detail synthesis |
| **Topaz Upscale** | 8x+ | $0.50+ | Professional quality, tile overlap |

### Video Upscale Models

| Model | Output | Max Duration | Price | Best For |
|-------|--------|--------------|-------|----------|
| **ByteDance Upscaler** | 1080p/2K/4K | 2 min | $0.05 | AI upscaling, optional 60fps |
| **FlashVSR** | Up to 4x | 2 min | $0.03 | Fastest, customizable |
| **Topaz Video AI** | Up to 8x | 2 min | $0.50+ | Professional quality |

## Generation Modes

### Text-to-Video
Generate videos from descriptive text prompts.

**Input Requirements**:
- Text prompt (up to 500 characters default, varies by model)
- At least one selected AI model
- Optional: duration, resolution, aspect ratio settings

**Best Practices**:
- Be specific about scenes, actions, and style
- Include camera movements and lighting descriptions
- Describe the desired mood and atmosphere
- Mention specific objects, people, or environments
- Use camera control keywords for supported models (e.g., `[Pan left]`, `[Zoom in]` for Hailuo 2.3 Pro)

### Image-to-Video
Animate existing images with AI-generated motion.

**Input Requirements**:
- Image file (JPG, PNG, WEBP, GIF - max 10MB, 8MB for Veo 3.1)
- At least one selected AI model
- Optional: motion prompt, duration settings

**Best Practices**:
- Use high-quality reference images
- Describe desired motion in the prompt
- Consider the image composition for animation
- Specify camera movements and effects
- For Veo 3.1: Use 16:9 or 9:16 aspect ratio images

### Frame-to-Video (Veo 3.1)
Animate between a first and last frame image.

**Input Requirements**:
- First frame image (max 8MB)
- Last frame image (max 8MB, matching aspect ratio)
- Both images must be 16:9 or 9:16 aspect ratio

### Avatar Generation
Create talking head videos from images and audio.

**Input Requirements**:
- Character image (JPG, PNG, WebP)
- Audio file (MP3, WAV, AAC - max 50MB; max 5MB for Kling Avatar v2)
- Optional: Source video for WAN Animate/Replace, Sync Lipsync, or Kling O1 models

### Cinematic Angles (SHOTS)
Generate 9 camera perspectives from a single image.

**Input Requirements**:
- Source image (single reference image)
- Each angle appends a camera perspective suffix to the prompt
- Uses Seeddream v4.5 backend for image generation

## AI Video Workflow Steps

### Step 1: Access AI Video Generation
1. Navigate to **Media Panel -> AI tab**
2. Choose generation mode:
   - **Text to Video**: Generate from text descriptions
   - **Image to Video**: Animate existing images
   - **Avatar**: Create talking head videos, video transformations, lip-sync
   - **Angles**: Generate cinematic camera angles
   - **Upscale**: Upscale images or videos

### Step 2: Configure Generation Settings

#### For Text-to-Video:
1. **Enter Prompt**: Describe your video in detail
2. **Select Models**: Choose one or multiple AI models for comparison
3. **Configure Options**: Set duration, resolution, aspect ratio (where supported)
4. **Review Cost**: Total cost displays based on selected models

#### For Image-to-Video:
1. **Upload Image**: Click to select image file
2. **Add Motion Prompt**: Describe how the image should animate (optional)
3. **Select Models**: Choose AI models for generation
4. **Review Cost**: Total cost calculation

#### For Frame-to-Video (Veo 3.1):
1. **Upload First Frame**: Starting image
2. **Upload Last Frame**: Ending image (must match aspect ratio)
3. **Add Prompt**: Describe the transition (optional)
4. **Review Cost**: $1.20-3.20 per 8s video

### Step 3: Multi-Model Generation
1. **Generate**: Click "Generate Video" to start the process
2. **Sequential Processing**: Models generate videos one by one to avoid rate limits
3. **Progress Tracking**: Real-time progress updates with:
   - Current model being processed
   - Generation percentage
   - Elapsed time and estimated remaining time
   - Detailed logs (expandable)

### Step 4: Video Processing & Integration
1. **Download Management**: Videos are streamed and cached locally
2. **Media Panel Integration**: Generated videos automatically appear in media library
3. **Timeline Ready**: Videos can be immediately dragged to timeline tracks
4. **Naming Convention**: `AI (ModelName): prompt...`

### Step 5: History & Management
1. **Generation History**: Last 10 generations saved locally
2. **Download Options**: Individual or batch download of generated videos
3. **Regeneration**: Option to generate again with same or modified settings

## Technical Implementation

### Architecture Overview
```
AI Video Generation Flow:
+-----------------+    +------------------+    +-----------------+
|   User Input    |--->|  AI Video Module  |--->|   FAL AI APIs   |
| (Text/Image)    |    |  (Modular)       |    |   (50+ models)  |
+-----------------+    +------------------+    +-----------------+
                                |
                                v
+-----------------+    +------------------+    +-----------------+
|   Media Store   |<---|  Video Download  |<---|   Video URLs    |
|   (Timeline)    |    |   & Processing   |    |   (fal.media)   |
+-----------------+    +------------------+    +-----------------+
         |
         v
+-----------------+    +------------------+
| Storage Service |--->|   Project DB     |
|  (Persistence)  |    | (IndexedDB/OPFS) |
+-----------------+    +------------------+
```

### Key Components

#### 1. **AI Constants** (`components/editor/media-panel/views/ai/constants/`)
Organized by model category for maintainability:

```
constants/
├── ai-constants.ts              # Consolidated re-exports, API config, UI constants
├── ai-model-options.ts          # Model option enums and defaults
├── angles-config.ts             # SHOTS cinematic angles (9 perspectives)
├── avatar-models-config.ts      # Avatar/talking-head model definitions
├── error-messages.ts            # Centralized error message strings
├── image2video-models-config.ts # I2V model definitions
├── model-config-validation.ts   # Model ID uniqueness and order validation
├── model-provider-logos.ts      # Provider logo mappings
├── text2video-models-config/    # T2V capability definitions (refactored)
│   ├── index.ts                 # Barrel exports
│   ├── models.ts                # T2V model definitions
│   ├── capabilities.ts          # Per-model capability maps
│   ├── helpers.ts               # getCombinedCapabilities, getT2VModelsInOrder
│   └── order.ts                 # Display order and ID aliases
└── __tests__/
    ├── kling-v3-models.test.ts
    └── model-provider-logos.test.ts
```

#### 2. **AI Video Module** (`lib/ai-video/`)
Modular architecture for AI video generation:

```
lib/ai-video/
├── index.ts                    # Barrel file - backward compatible exports
├── api.ts                      # High-level API (getAvailableModels, estimateCost)
├── core/
│   ├── fal-request.ts          # FAL API request utilities
│   ├── fal-upload.ts           # FAL file upload utilities
│   ├── polling.ts              # Queue polling with progress updates
│   └── streaming.ts            # Video streaming download
├── generators/
│   ├── angles.ts               # Cinematic angles generation
│   ├── avatar.ts               # Avatar/talking head generation
│   ├── base-generator.ts       # Common utilities (fileToDataURL, response building)
│   ├── image-to-video.ts       # I2V generators
│   ├── image.ts                # Seeddream image generation
│   ├── kling-generators.ts     # Kling-specific generation logic
│   ├── misc-generators.ts      # Miscellaneous model generators
│   ├── text-to-video.ts        # Legacy T2V entry point
│   ├── text-to-video/          # Refactored T2V subdirectory
│   │   ├── index.ts            # Barrel exports
│   │   ├── generate-video.ts   # Main T2V generation orchestrator
│   │   ├── shared.ts           # Shared T2V utilities
│   │   ├── hailuo-generator.ts # Hailuo-specific T2V logic
│   │   ├── ltxv2-generator.ts  # LTX Video 2.0 T2V logic
│   │   ├── vidu-generator.ts   # Vidu-specific T2V logic
│   │   └── wan26-generator.ts  # WAN v2.6 T2V logic
│   ├── upscale.ts              # Video upscaling (ByteDance, FlashVSR, Topaz)
│   ├── vidu-generators.ts      # Vidu-specific generation logic
│   └── wan-generators.ts       # WAN-specific generation logic
├── models/
│   └── sora2.ts                # Sora 2 specific parameter conversion
└── validation/
    ├── validators.ts           # Top-level validation entry point
    └── validators/             # Per-model validators
        ├── index.ts            # Barrel exports
        ├── hailuo-validators.ts
        ├── kling-validators.ts
        ├── lipsync-validators.ts
        ├── ltxv2-validators.ts
        ├── reve-validators.ts
        ├── vidu-validators.ts
        └── wan-validators.ts
```

- Direct integration with FAL AI APIs
- Handles text-to-video, image-to-video, avatar, angles, and upscale generation
- Multi-model support with sequential processing
- Progress tracking and status polling
- Centralized error handling and per-model validation

#### 3. **FAL AI Clients** (`lib/ai-clients/`)
Split into focused modules:

```
lib/ai-clients/
├── fal-ai-client.ts              # Core FAL API integration
├── fal-ai-client-generation.ts   # Generation-specific FAL logic
├── fal-ai-client-internal-types.ts # Internal type definitions
├── fal-ai-client-reve.ts         # Reve text-to-image FAL integration
├── fal-ai-client-veo31.ts        # Veo 3.1 specific implementations
├── ai-video-client.ts            # High-level video generation client
├── ai-video-output.ts            # Video output processing
├── image-edit-capabilities.ts    # Image editing capability definitions
├── image-edit-client.ts          # Image editing API client
├── image-edit-models-info.ts     # Image editing model info
├── image-edit-polling.ts         # Image editing polling logic
├── image-edit-types.ts           # Image editing types
├── image-edit-utils.ts           # Image editing utilities
├── sam3-client.ts                # SAM3 segmentation client
├── sam3-models.ts                # SAM3 model definitions
└── video-edit-client.ts          # Video editing API client
```

#### 4. **AI Models Library** (`lib/ai-models/`)
Shared model definitions and utilities:

```
lib/ai-models/
├── index.ts                    # Barrel exports
├── camera-prompt-builder.ts    # Camera prompt construction
├── image-validation.ts         # Image upload validation
├── model-utils.ts              # Model utility functions
├── text2image-models.ts        # Text-to-image model definitions
└── upscale-models.ts           # Image upscale model catalog
```

#### 5. **AI View Component** (`components/editor/media-panel/views/ai/`)
Modular UI architecture for AI video generation:

```
views/ai/
├── index.tsx                   # Main AI panel component
├── __tests__/                  # Unit tests
│   ├── ai-constants.test.ts
│   ├── angles-config.test.ts
│   └── extend-video.test.ts
├── components/                 # Reusable UI components
│   ├── ai-generation-feedback.tsx  # Generation progress/feedback UI
│   ├── ai-history-panel.tsx    # Generation history panel
│   ├── ai-image-upload.tsx     # Image upload component
│   ├── ai-kling-v25-settings.tsx   # Kling v2.5 model settings
│   ├── ai-kling-v26-settings.tsx   # Kling v2.6 model settings
│   ├── ai-ltx-fast-i2v-settings.tsx # LTX Fast I2V settings
│   ├── ai-ltx-i2v-settings.tsx # LTX I2V settings
│   ├── ai-model-selection-grid.tsx # Model selection grid UI
│   ├── ai-seedance-settings.tsx    # Seedance model settings
│   ├── ai-select-fields.tsx    # Dropdown select fields
│   ├── ai-settings-panel.tsx   # Settings panel wrapper
│   ├── ai-validation-messages.tsx  # Validation error display
│   ├── ai-vidu-q2-settings.tsx # Vidu Q2 model settings
│   ├── ai-wan25-settings.tsx   # WAN v2.5 model settings
│   └── __tests__/
│       ├── ai-model-settings.test.tsx
│       └── phase3-components.test.ts
├── constants/                  # (see section 1 above)
├── hooks/                      # React hooks
│   ├── generation/             # Generation-specific hooks
│   │   ├── index.ts            # Barrel exports
│   │   ├── media-integration.ts        # Media store integration
│   │   ├── model-handlers.ts           # Model routing logic
│   │   ├── model-handler-implementations.ts # Handler implementations
│   │   ├── model-handler-types.ts      # Handler type definitions
│   │   ├── handlers/                   # Per-category handlers
│   │   │   ├── avatar-handlers.ts      # Avatar generation handlers
│   │   │   ├── image-to-video-handlers.ts  # I2V generation handlers
│   │   │   ├── text-to-video-handlers.ts   # T2V generation handlers
│   │   │   ├── upscale-handlers.ts     # Upscale handlers
│   │   │   └── __tests__/
│   │   │       └── handler-exports.test.ts
│   │   └── __tests__/
│   │       └── model-handlers-routing.test.ts
│   ├── use-ai-angles-tab-state.ts  # Angles tab state management
│   ├── use-ai-avatar-tab-state.ts  # Avatar tab state management
│   ├── use-ai-generation.ts        # Main generation hook (orchestrator, ~200 lines)
│   ├── use-ai-generation-can-generate.ts # Validation logic
│   ├── use-ai-generation-core.ts   # Core generation callback
│   ├── use-ai-generation-helpers.ts # Generation helper utilities
│   ├── use-ai-generation-state.ts  # State declarations and effects
│   ├── use-ai-history.ts           # History management
│   ├── use-ai-image-tab-state.ts   # Image tab state management
│   ├── use-ai-mock-generation.ts   # Mock generation for testing
│   ├── use-ai-panel-effects.ts     # Panel-level side effects
│   ├── use-ai-polling.ts           # FAL polling logic
│   ├── use-ai-tab-state-base.ts    # Shared tab state logic
│   ├── use-ai-text-tab-state.ts    # Text tab state management
│   ├── use-ai-upscale-tab-state.ts # Upscale tab state management
│   ├── use-cost-calculation.ts     # Cost calculation hook
│   ├── use-reve-edit-state.ts      # Reve edit state management
│   ├── use-veo31-state.ts          # Veo 3.1 state management
│   └── __tests__/
│       ├── use-ai-generation-contract.test.ts
│       ├── use-ai-generation-helpers.test.ts
│       ├── use-ai-mock-generation.test.ts
│       ├── use-ai-panel-effects.test.ts
│       ├── use-ai-polling.test.ts
│       ├── use-cost-calculation.test.ts
│       ├── use-reve-edit-state.test.ts
│       └── use-veo31-state.test.ts
├── settings/                   # Model-specific settings components
│   ├── ai-reve-settings.tsx    # Reve text-to-image settings
│   ├── ai-sora-settings.tsx    # Sora 2 settings
│   └── ai-veo-settings.tsx     # Veo 3.1 settings
├── tabs/                       # Tab content components
│   ├── ai-angles-tab.tsx       # Cinematic angles tab
│   ├── ai-avatar-tab.tsx       # Avatar generation tab
│   ├── ai-image-tab.tsx        # Image-to-video tab
│   ├── ai-text-tab.tsx         # Text-to-video tab
│   └── ai-upscale-tab.tsx      # Video/image upscale tab
├── types/                      # TypeScript type definitions
│   ├── ai-types.ts             # Legacy barrel (re-exports from ai-types/)
│   └── ai-types/               # Refactored type modules
│       ├── index.ts            # Barrel exports
│       ├── generation.ts       # Generation-related types
│       ├── hook-props.ts       # Hook prop interfaces
│       ├── lipsync-types.ts    # Lip-sync specific types
│       ├── model-config.ts     # Model configuration types
│       ├── request-types.ts    # API request types
│       ├── seeddream-types.ts  # Seeddream/angles types
│       └── sora2-types.ts      # Sora 2 specific types
└── utils/                      # Utility functions
    └── ai-cost-calculators.ts  # Cost calculation utilities
```

- Responsive layout for different panel widths
- Model selection and real-time cost calculation
- Progress visualization and status updates
- Integration with media panel and timeline

### Model Endpoints

#### Text-to-Video Endpoints
```typescript
const TEXT_TO_VIDEO_ENDPOINTS = {
  // OpenAI Sora 2
  "sora2_text_to_video": "fal-ai/sora-2/text-to-video",
  "sora2_text_to_video_pro": "fal-ai/sora-2/text-to-video/pro",

  // Google Veo 3.1
  "veo31_fast_text_to_video": "fal-ai/veo3.1/fast",
  "veo31_text_to_video": "fal-ai/veo3.1",

  // LTX Video
  "ltxv2_pro_t2v": "fal-ai/ltxv-2/text-to-video",
  "ltxv2_fast_t2v": "fal-ai/ltxv-2/text-to-video/fast",

  // Hailuo
  "hailuo23_standard_t2v": "fal-ai/minimax/hailuo-2.3/standard/text-to-video",
  "hailuo23_pro_t2v": "fal-ai/minimax/hailuo-2.3/pro/text-to-video",

  // Seedance
  "seedance": "fal-ai/bytedance/seedance/v1/lite/text-to-video",
  "seedance_pro": "fal-ai/bytedance/seedance/v1/pro/text-to-video",

  // Kling
  "kling_v3_pro_t2v": "fal-ai/kling-video/v3/pro/text-to-video",
  "kling_v3_standard_t2v": "fal-ai/kling-video/v3/standard/text-to-video",
  "kling_v26_pro_t2v": "fal-ai/kling-video/v2.6/pro/text-to-video",
  "kling_v2_5_turbo": "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
  "kling_v2_5_turbo_standard": "fal-ai/kling-video/v2.5-turbo/standard/text-to-video",

  // WAN (note: no fal-ai/ prefix for WAN endpoints)
  "wan_26_t2v": "wan/v2.6/text-to-video",
  "wan_25_preview": "wan-25-preview/text-to-video",

  // Vidu
  "vidu_q3_t2v": "fal-ai/vidu/q3/text-to-video",
};
```

#### Image-to-Video Endpoints
```typescript
const IMAGE_TO_VIDEO_ENDPOINTS = {
  // OpenAI Sora 2
  "sora2_image_to_video": "fal-ai/sora-2/image-to-video",
  "sora2_image_to_video_pro": "fal-ai/sora-2/image-to-video/pro",

  // Google Veo 3.1
  "veo31_fast_image_to_video": "fal-ai/veo3.1/fast/image-to-video",
  "veo31_fast_frame_to_video": "fal-ai/veo3.1/fast/first-last-frame-to-video",
  "veo31_image_to_video": "fal-ai/veo3.1/image-to-video",
  "veo31_frame_to_video": "fal-ai/veo3.1/first-last-frame-to-video",

  // LTX Video
  "ltxv2_i2v": "fal-ai/ltxv-2/image-to-video",
  "ltxv2_fast_i2v": "fal-ai/ltxv-2/image-to-video/fast",

  // Seedance
  "seedance_pro_fast_i2v": "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video",
  "seedance_pro_i2v": "fal-ai/bytedance/seedance/v1/pro/image-to-video",

  // Kling
  "kling_v3_pro_i2v": "fal-ai/kling-video/v3/pro/image-to-video",
  "kling_v3_standard_i2v": "fal-ai/kling-video/v3/standard/image-to-video",
  "kling_v26_pro_i2v": "fal-ai/kling-video/v2.6/pro/image-to-video",
  "kling_v2_5_turbo_i2v": "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  "kling_o1_i2v": "fal-ai/kling-video/o1/image-to-video",

  // Hailuo
  "hailuo23_standard": "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
  "hailuo23_fast_pro": "fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video",
  "hailuo23_pro": "fal-ai/minimax/hailuo-2.3/pro/image-to-video",

  // WAN (note: no fal-ai/ prefix for WAN endpoints)
  "wan_26_i2v": "wan/v2.6/image-to-video",
  "wan_25_preview_i2v": "wan-25-preview/image-to-video",

  // Vidu
  "vidu_q3_i2v": "fal-ai/vidu/q3/image-to-video",
  "vidu_q2_turbo_i2v": "fal-ai/vidu/q2/image-to-video/turbo",
};
```

#### Avatar & Transformation Endpoints
```typescript
const AVATAR_ENDPOINTS = {
  // Kling Avatar
  "kling_avatar_v2_pro": "fal-ai/kling-video/ai-avatar/v2/pro",
  "kling_avatar_v2_standard": "fal-ai/kling-video/ai-avatar/v2/standard",
  "kling_avatar_pro": "fal-ai/kling-video/v1/pro/ai-avatar",
  "kling_avatar_standard": "fal-ai/kling-video/v1/standard/ai-avatar",

  // ByteDance
  "bytedance_omnihuman_v1_5": "fal-ai/bytedance/omnihuman/v1.5",

  // Sync Lipsync
  "sync_lipsync_react1": "fal-ai/sync-lipsync/react-1",

  // Kling O1 series
  "kling_o1_v2v_reference": "fal-ai/kling-video/o1/video-to-video/reference",
  "kling_o1_v2v_edit": "fal-ai/kling-video/o1/video-to-video/edit",
  "kling_o1_ref2video": "fal-ai/kling-video/o1/reference-to-video",

  // WAN (no fal-ai/ prefix)
  "wan_26_ref2v": "wan/v2.6/reference-to-video",
  "wan_animate_replace": "wan/v2.2-14b/animate/replace",

  // Veo 3.1 Extend
  "veo31_fast_extend_video": "fal-ai/veo3.1/fast/extend-video",
  "veo31_extend_video": "fal-ai/veo3.1/extend-video",

  // Sora 2 Remix
  "sora2_video_to_video_remix": "fal-ai/sora-2/video-to-video/remix",
};
```

### Generation Parameters
```typescript
// Text-to-Video request (lib/ai-video/generators/text-to-video/)
interface VideoGenerationRequest {
  prompt: string;
  model: string;
  resolution?: string;    // "480p", "720p", "1080p", "1440p", "2160p"
  duration?: number;      // Varies by model
  aspect_ratio?: string;  // "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"
}

// Image-to-Video request (lib/ai-video/generators/image-to-video.ts)
interface ImageToVideoRequest {
  image: File;            // File object (not URL)
  model: string;
  prompt?: string;
  resolution?: string;
  duration?: number;
  aspect_ratio?: string;
}

// Veo 3.1 Frame-to-Video request
// Used for first-last-frame-to-video generation
interface Veo31FrameToVideoInput {
  prompt: string;              // Required: Animation description
  first_frame_url: string;     // Required: Opening frame URL
  last_frame_url: string;      // Required: Closing frame URL
  aspect_ratio?: "9:16" | "16:9";  // Default: "16:9"
  duration?: "8s";             // Currently only "8s" supported
  resolution?: "720p" | "1080p";   // Default: "720p"
}
```

> **Note**: Model-specific requests may have additional optional fields. Check the
> individual generator files in `lib/ai-video/generators/` and `lib/ai-clients/fal-ai-client*.ts` for
> complete parameter lists (e.g., `generate_audio`, `enhance_prompt`, `negative_prompt`,
> `seed`, `cfg_scale`, `multi_shots` are available on specific model endpoints).

### Video Processing Pipeline

#### Download Workflow
```typescript
// 1. Generate video via FAL API
const response = await generateVideo({
  prompt: "A cat playing with yarn",
  model: "kling_v3_pro_t2v",
  resolution: "1080p",
  duration: 5
});

// 2. Stream download video data
const videoData = await downloadVideoToMemory(response.video_url);

// 3. Create File object from downloaded data
const file = await outputManager.createFileFromData(
  videoData,
  `ai-${modelName}-${jobId}.mp4`
);

// 4. Add to media panel
const newMediaItemId = await addMediaItem(projectId, {
  name: `AI (${modelName}): ${prompt}...`,
  type: "video",
  file,
  duration: response.duration,
  width: response.width,
  height: response.height
});
```

## Configuration

### API Key Setup (Desktop App Only)

AI video generation requires a FAL AI API key, which is securely stored via Electron IPC:

1. **Open Settings**: Navigate to Settings in the QCut desktop app
2. **Enter API Key**: Add your FAL AI API key in the API Keys section
3. **Secure Storage**: Keys are stored in the user data directory (`api-keys.json`)

> **Note**: API keys are stored locally on your machine and never transmitted except to the FAL AI service for generation requests.

### Environment Variables (Development)
```bash
VITE_FAL_API_KEY=your_fal_api_key_here
```

### Model Defaults
- **Default Duration**: Varies by model (typically 5-8 seconds)
- **Default Resolution**: 720p-1080p depending on model
- **Max Prompt Length**: Model-specific limits:
  - Hailuo 2.3 Standard: 1500 characters
  - Hailuo 2.3 Pro: 2000 characters
  - Reve: 2560 characters
  - Vidu Q2: 3000 characters
  - SeedDream V4 / FAL AI: 5000 characters
- **Max Image Size**: 10MB (8MB for Veo 3.1)
- **Max Audio Size**: 50MB (for avatar models; 5MB for Kling Avatar v2)
- **Max Video Size**: 100MB (500MB for upscale)
- **History Limit**: 10 most recent generations

### UI Responsive Breakpoints
- **Collapsed**: Width <= min width + 2px (icon only)
- **Compact**: Width < 18% (simplified UI)
- **Expanded**: Width > 25% (full feature set)

## Testing & Development

### Mock Generation Mode
For development and testing, the system includes a mock generation mode:
- Uses sample video URLs instead of API calls
- Simulates generation delays and progress updates
- Allows UI testing without consuming API credits
- Toggle via "Generate Preview" button

### Debug Logging
Comprehensive logging throughout the workflow:
```javascript
debugLogger.log("AIView", "VIDEO_GENERATED", {
  modelName,
  videoUrl,
  projectId,
  downloadSize: videoData.length
});
```

## Cost Management

### Real-time Cost Calculation
- Displays total cost for selected models
- Individual model pricing shown in selection UI
- Cost range: $0.02 - $3.20+ per generation
- Multi-model generation allows cost vs. quality comparison
- Per-second pricing for variable-duration models

### Cost Optimization Strategies
1. **Model Selection**: Choose appropriate quality level for use case
2. **Resolution**: Lower resolution = lower cost for many models
3. **Duration**: Shorter videos cost less (per-second pricing)
4. **Batch Generation**: Generate multiple variations in one session
5. **Preview Mode**: Use mock generation for UI testing

## Quality Guidelines

### Prompt Engineering Best Practices

#### For Text-to-Video:
- **Scene Description**: "A serene lake at sunset with gentle ripples"
- **Action Details**: "A person walking slowly along a forest path"
- **Camera Work**: "Smooth camera pan following the subject"
- **Style Keywords**: "Cinematic, professional lighting, high detail"
- **Atmosphere**: "Warm golden hour lighting, peaceful mood"
- **Camera Controls** (Hailuo 2.3 Pro): `[Pan left]`, `[Zoom in]`, `[Tilt up]`

#### For Image-to-Video:
- **Motion Description**: "Gentle swaying of tree branches in the wind"
- **Camera Movement**: "Slow zoom in on the subject"
- **Effect Specification**: "Subtle parallax effect on background elements"
- **Mood Enhancement**: "Add dynamic lighting changes"

### Model Selection Guide

| Use Case | Recommended Models | Reasoning |
|----------|-------------------|-----------|
| **Quick Prototyping** | Seedance v1 Lite, WAN v2.5 Preview | Cost-effective, fast |
| **Professional Content** | Kling v3 Pro, Veo 3.1, Sora 2 Pro | High quality |
| **4K/High Resolution** | LTX Video 2.0 Pro/Fast | Up to 2160p support |
| **Long Duration** | LTX Video 2.0 Fast, Seedance, WAN v2.6 | Up to 15-20s |
| **With Audio** | LTX Video 2.0, Veo 3.1, Kling v3 | Built-in audio generation |
| **Realistic Physics** | Hailuo 2.3 Pro, Veo 3.1 | Physics simulation |
| **Fast Turnaround** | Seedance Lite, Veo 3.1 Fast, LTX Fast | Optimized for speed |
| **Budget Projects** | Seedance v1 Lite, WAN v2.5 Preview, Kling v2.5 Standard | Lowest cost |
| **Premium Quality** | Veo 3.1, Sora 2 Pro, Kling v3 Pro | Highest quality |
| **Talking Heads** | Kling Avatar v2, OmniHuman, Sync Lipsync | Avatar generation |
| **Video Extension** | Veo 3.1 Extend, Veo 3.1 Fast Extend | Continue existing videos |
| **Cinematic Angles** | SHOTS Cinematic Angles | 9 camera perspectives |

## Troubleshooting

### Common Issues

#### 1. **API Key Not Configured**
- **Symptoms**: "FAL API key not configured" error
- **Solution**: Add API key in Settings -> API Keys (desktop app)
- **Verification**: Check console for key length confirmation

#### 2. **Generation Failed**
- **Symptoms**: Error message during generation
- **Causes**: Rate limits, invalid prompts, API issues
- **Solution**: Wait and retry, check prompt content, verify API status

#### 3. **Video Not Appearing in Media Panel**
- **Symptoms**: Generation completes but video missing
- **Causes**: Download failure, storage issues, project selection
- **Solution**: Check console logs, verify active project, retry generation

#### 4. **Slow Generation**
- **Symptoms**: Long wait times, no progress updates
- **Causes**: Model-specific processing times, queue delays
- **Expected Times**:
  - Veo 3.1: 5-10 minutes
  - Sora 2: 2-5 minutes
  - Kling v3: 2-3 minutes
  - Seedance: 30-60 seconds
  - LTX Fast: 30-60 seconds

#### 5. **Image Upload Issues**
- **Symptoms**: Upload fails or image not recognized
- **Solutions**:
  - Check file size (max 10MB, 8MB for Veo 3.1)
  - Verify format (JPG, PNG, WEBP, GIF)
  - Check aspect ratio (16:9 or 9:16 for Veo 3.1)

#### 6. **Veo 3.1 Frame-to-Video Issues**
- **Symptoms**: "Aspect ratio mismatch" error
- **Solution**: Ensure both frames have identical aspect ratios (16:9 or 9:16)

### Debug Information
Enable detailed logging in browser console:
- Generation status and progress
- Model selection and processing
- Download progress and completion
- Media panel integration status
- Error details and stack traces

## Performance Considerations

### Generation Times (Approximate)
- **Seedance v1 Lite**: 30-60 seconds
- **WAN v2.5 Preview**: 30-60 seconds
- **LTX Video 2.0 Fast**: 30-90 seconds
- **Hailuo 2.3**: 60-120 seconds
- **Kling v3**: 120-180 seconds
- **Sora 2**: 120-300 seconds
- **Veo 3.1 Fast**: 180-360 seconds
- **Veo 3.1**: 300-600 seconds

### Resource Usage
- **Memory**: ~50-100MB per video during download
- **Storage**: Videos stored as File objects in IndexedDB/OPFS
- **Network**: Streaming download minimizes memory usage
- **UI Responsiveness**: Non-blocking generation with progress updates

### Optimization Features
- **Sequential Generation**: Prevents API rate limiting
- **Progress Streaming**: Real-time status updates
- **Memory Management**: Efficient video data handling
- **Local Caching**: Downloaded videos persist across sessions

## Integration Points

### Timeline Integration
- Generated videos appear immediately in media panel
- Drag-and-drop to timeline tracks
- Standard editing operations (trim, split, effects)
- Thumbnail generation for timeline preview

### Export Compatibility
- MP4 format compatible with all export engines
- Standard video codecs ensure broad compatibility
- Metadata preservation for tracking generation details

### Project Management
- Videos associated with specific projects
- Persistent storage across application sessions
- History tracking per project workspace

---

*Last Updated: 2026-02-28*
*QCut AI Video Models: 50+ models via FAL.ai*
*Price Range: $0.02 - $3.20+ per generation*


# AI Video Flow (Steps)

This document describes the step-by-step flow of AI video generation in QCut, with console log references for debugging.

## Generation Flow (Steps 1-7)

### Step 1 - Model Selection
User selects T2V models in the AI Panel UI; the UI updates the selected models and queries the capability system.
- **Function**: `AiView` (React Component)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai/index.tsx`
- **Console**: `step 1: selectedModels updated -> ...`
  - **Step 1.1**: User interacts with model selection UI.
  - **Step 1.2**: `selectedModels` state is updated.
  - **Step 1.3**: `useMemo` hook triggers `getCombinedCapabilities`.

### Step 2 - Capability Computation
The capability system returns intersected capabilities and the UI renders clamped T2V settings (aspect_ratio, duration, resolution) based on them.
- **Function**: `getCombinedCapabilities`
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config/helpers.ts`
- **Console**: `step 2: combinedCapabilities updated`
  - **Step 2.1**: `getCombinedCapabilities` computes intersection of supported features.
  - **Step 2.2**: `AiView` receives updated `combinedCapabilities`.
  - **Step 2.3**: UI re-renders settings inputs (e.g., Duration slider) clamped to new limits.

### Step 3 - Generation Invoked
The user enters a prompt, adjusts settings, and clicks Generate; the UI invokes generateVideo with the T2V properties.
- **Function**: `handleGenerate` (via `useHandleGenerate`)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation-core.ts`
- **Console Logs**:
  - `step 3: handleGenerate invoked (AI video flow)`
  - `step 3a: pre-generation state check`
- **Sub-steps**:
  - **Step 3.1**: User inputs prompt and adjusts generation settings.
  - **Step 3.2**: User clicks "Generate" button.
  - **Step 3.3**: `handleGenerate` function is called.
  - **Step 3.4**: Initial validation checks (prompt existence, model selection, active project).

### Step 4 - Parameter Sanitization
Generation validates the requested duration against capabilities (getSafeDuration clamping) and builds unifiedParams sanitized to capability ranges.
- **Function**: `handleGenerate` (calls `getSafeDuration`)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation-core.ts`
- **Console**: `step 4: sanitized params for ${modelId}`
- **Sub-steps**:
  - **Step 4.1**: Iterate through `selectedModels`.
  - **Step 4.2**: Retrieve capabilities for the current model.
  - **Step 4.3**: Call `getSafeDuration` to clamp requested duration to supported values.
  - **Step 4.4**: Construct `unifiedParams` object with sanitized parameters.

### Step 5 - API Request
Generation sends the request to the FAL API with unifiedParams and receives a video_url plus metadata. Model-specific handlers are routed via the `handlers/` directory.
- **Function**: Request dispatch via `routeTextToVideoHandler` / `routeImageToVideoHandler` / `routeAvatarHandler` / `routeUpscaleHandler`
- **Files**:
  - `qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts`
  - `qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers/text-to-video-handlers.ts`
  - `qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers/image-to-video-handlers.ts`
  - `qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers/avatar-handlers.ts`
  - `qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers/upscale-handlers.ts`
- **Console**: `step 5a: post-API response analysis`
- **Sub-steps**:
  - **Step 5.1**: Identify specific API function based on model ID.
  - **Step 5.2**: API client prepares payload and headers.
  - **Step 5.3**: Send POST request to FAL.ai endpoint.
  - **Step 5.4**: Receive response containing `video_url` (Direct) or `job_id` (Polling).

### Step 6 - Media Integration
Generation downloads the video, creates a media item, and adds it to the media store with unified metadata.
- **Function**: `integrateVideoToMediaStore` (generation/media-integration.ts), `addMediaItem` (store action)
- **Files**:
  - `qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/generation/media-integration.ts`
  - `qcut/apps/web/src/stores/media/media-store.ts`
- **Console Logs** (in order):
  - `step 6a: media integration condition check`
  - `step 6b: executing media integration block`
  - `step 6c: video download progress`
  - `step 6d: file creation complete`
  - `step 6d details: {...}`
  - `step 6e: MANDATORY save to local disk starting`
  - `step 6e: about to call addMediaItem`
  - `step 6f: addMediaItem completed`
  - `step 6g: media-store addMediaItem` (from media-store.ts)
  - `step 6: polling mode - deferring download` (when using polling)
- **Sub-steps**:
  - **Step 6.1**: Check if response contains `video_url` (Direct mode) or wait for polling to complete.
  - **Step 6.2**: Fetch video content from `video_url`.
  - **Step 6.3**: Create `File` object from the downloaded Blob.
  - **Step 6.4**: Construct `mediaItem` object with metadata (name, duration, dimensions).
  - **Step 6.5**: Call `addMediaItem` to add to the project.
  - **Step 6.6**: Generate `localUrl = URL.createObjectURL(file)` and store as `mediaItem.url` (primary), keep `mediaItem.originalUrl` for fallback.
  - **Step 6.7**: Capture `fileSize` for downstream checks.
- **Remote vs Local note**: Videos stay remote (only `video_url` stored) when we skip download -- for example, if `activeProject`/`addMediaItem` are unavailable or in polling mode pre-completion. When both project and media store are present, the flow downloads the blob and saves a local `File` before adding.

### Step 7 - UI Completion
The media store persists the item; generation updates UI progress to 100% and fires onComplete; the UI shows the generated video to the user.
- **Function**: `addMediaItem` (store action), `handleGenerate` (UI update)
- **Files**:
  - `qcut/apps/web/src/stores/media/media-store.ts`
  - `qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation-core.ts`
- **Console**: `step 7: generation flow complete; updating UI and callbacks`
- **Sub-steps**:
  - **Step 7.1**: `MediaStore` generates a unique ID and updates local state.
  - **Step 7.2**: `MediaStore` persists the new item to storage (IndexedDB/Cloud).
  - **Step 7.3**: `handleGenerate` updates `generatedVideos` state with the new video.
  - **Step 7.4**: `onComplete` callback is executed.
  - **Step 7.5**: UI updates to show the generated video in the gallery/preview.

---

## Download & Export Flow (Steps 8-11)

### Step 8 - Media Panel Downloads
Individual download and export-all ZIP functionality from the media panel.
- **Files**:
  - `qcut/apps/web/src/components/editor/media-panel/views/ai/index.tsx`
  - `qcut/apps/web/src/components/editor/media-panel/views/ai/components/ai-history-panel.tsx`
  - `qcut/apps/web/src/components/editor/media-panel/export-all-button.tsx`
  - `qcut/apps/web/src/hooks/export/use-zip-export.ts`

#### Individual Download
- **Console**: `step 8: media panel download` / `step 8: history panel download`
- **Sub-steps**:
  - **Step 8.1**: User clicks download in the media/AI history panel.
  - **Step 8.2**: Handler prefers blob/local URL and falls back to remote URL if missing.
  - **Step 8.3**: File name inferred from remote URL or uses default `ai-video-${jobId}.mp4`.

#### Export All (ZIP)
- **Console Logs**:
  - `step 8: export-all clicked`
  - `step 8: export-all start zipping`
  - `step 8: export-all zip completed`
- **use-zip-export.ts Console Logs** (detailed):
  - `step 8a: use-zip-export exportToZip called`
  - `step 8b: no items to export`
  - `step 8c: creating ZipManager instance`
  - `step 8d: starting addMediaItems`
  - `step 8e: addMediaItems progress`
  - `step 8f: addMediaItems complete`
  - `step 8g: starting compression`
  - `step 8h: compression complete`
  - `step 8i: starting download`
  - `step 8j: calling downloadZipSafely`
  - `step 8k: downloadZipSafely complete`
  - `step 8l: export complete, updating state`

### Step 9 - ZIP Item Processing
Processing individual media items for ZIP inclusion.
- **File**: `qcut/apps/web/src/lib/project/zip-manager.ts`
- **Console Logs**:
  - `step 9: zip-manager starting addMediaItems`
  - `step 9a: processing item`
  - `step 9a-extension-fix` - Extension inference for videos without extension
  - `step 9a-filename` - Sanitized filename for ZIP entry
  - `step 9a-ai-check: AI detection`
  - `step 9b-ai: AI video detected, prioritizing localPath read`
  - `step 9b-ai-read: readFile returned for AI video`
  - `step 9b-ai-buffer` - Buffer analysis for AI videos
  - `step 9b-ai-success: AI video added from localPath`
  - `step 9b-ai-fail: Failed to read AI video from localPath`
  - `step 9b-ai-error: Error reading AI video from localPath`
  - `step 9b: adding file directly to ZIP`
  - `step 9c: file added successfully via File object`
  - `step 9d: attempting to read local file`
  - `step 9e: readFile returned`
  - `step 9f` - Buffer conversion details
  - `step 9j: local file added successfully to ZIP`
  - `step 9k: readFile returned null/undefined`
  - `step 9l: error reading local file`
  - `step 9m: item processing complete`
  - `step 9n: Failed to add ${item.name} to ZIP`
  - `step 9o: all items processed`

### Step 10 - ZIP Generation
Generating the final ZIP blob from processed items.
- **File**: `qcut/apps/web/src/lib/project/zip-manager.ts`
- **Console Logs**:
  - `step 10: generating ZIP blob`
  - `step 10a: ZIP blob generated`

### Step 11 - ZIP Download
Saving the ZIP file to disk via Electron or browser fallback.
- **File**: `qcut/apps/web/src/lib/project/zip-manager.ts`
- **Console Logs**:
  - `step 11: downloadZipSafely called`
  - `step 11a: converting blob to array buffer`
  - `step 11b: arrayBuffer created`
  - `step 11c: calling electronAPI.saveBlob`
  - `step 11d: saveBlob returned`
  - `step 11e: Electron save failed`
  - `step 11f: Electron API not available, using browser methods`

---

## Timeline Playback Steps (Separate Flow)

These step logs are for timeline playback, not AI generation:
- **File**: `qcut/apps/web/src/hooks/timeline/use-timeline-playhead.ts`
- **Console Logs**:
  - `step 6: timeline playhead updated` - Playhead position updates
  - `step 7: user initiated seek` - User seeks to new position
