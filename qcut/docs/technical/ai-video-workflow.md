# AI Video Generation Workflow Documentation

## Overview

QCut includes comprehensive AI-powered video generation capabilities, allowing users to create custom videos from text prompts and images directly within the video editor. This system integrates with multiple leading AI video models via FAL.ai and seamlessly adds generated content to the timeline.

> **⚠️ Desktop App Only**: AI video generation features require the Electron desktop application. These features are not available in web-only mode because they rely on Electron IPC for secure API key storage and management.

## Available AI Video Models

### Text-to-Video Models

#### OpenAI Sora 2
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Sora 2 T2V** | 720p | 12s | $0.10/s | State-of-the-art text-to-video |
| **Sora 2 T2V Pro** | 720p/1080p | 12s | $0.075-0.125/s | High-quality with 1080p support |

#### Google Veo 3.1
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Veo 3.1 Fast** | 720p/1080p | 8s | $0.15/s (~$1.20/8s) | Faster, budget-friendly |
| **Veo 3.1** | 720p/1080p | 8s | $0.40/s (~$3.20/8s) | Premium quality |

#### Google Veo 3 (Legacy)
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Veo3 Fast** | 1080p | 30s | $2.00 | High quality, faster |
| **Veo3** | 1080p | 30s | $3.00 | Highest quality |

#### LTX Video 2.0
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **LTX Video 2.0 Pro** | 1080p-4K | 10s | $0.06/s | Audio generation, up to 4K |
| **LTX Video 2.0 Fast** | 1080p-4K | 20s | $0.04-0.16/s | Extended duration, up to 4K |

#### MiniMax Hailuo
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Hailuo 02** | 768p | 6s | $0.27 | Budget-friendly, realistic physics |
| **Hailuo 02 Pro** | 1080p | 6s | $0.48 | Ultra-realistic physics |
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
| **Kling v2.1 Master** | 1080p | 10s | $0.15 | Unparalleled motion fluidity |
| **Kling v2.5 Turbo Pro** | 1080p | 10s | $0.18 | Enhanced turbo performance |

#### Alibaba WAN
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **WAN v2.5 Preview** | 1080p | 10s | $0.12 | Next-gen quality |
| **WAN v2.2 Turbo** | 720p | 5s | $0.10 | High-speed photorealistic |

### Image-to-Video Models

#### OpenAI Sora 2
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Sora 2 I2V** | 720p | 12s | $0.10/s | Image animation |
| **Sora 2 I2V Pro** | 720p/1080p | 12s | $0.075-0.125/s | High-quality animation |

#### Google Veo 3.1
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Veo 3.1 Fast I2V** | 720p/1080p | 8s | $0.15/s | Fast image animation |
| **Veo 3.1 Fast Frame-to-Video** | 720p/1080p | 8s | $0.15/s | First/last frame animation |
| **Veo 3.1 I2V** | 720p/1080p | 8s | $0.40/s | Premium image animation |
| **Veo 3.1 Frame-to-Video** | 720p/1080p | 8s | $0.40/s | Premium frame animation |

#### LTX Video 2.0
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **LTX Video 2.0 I2V** | 1080p-4K | 10s | $0.06/s | Audio + image animation |
| **LTX Video 2.0 Fast I2V** | 1080p-4K | 20s | $0.04-0.16/s | Extended I2V |

#### ByteDance Seedance
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Seedance v1 Pro Fast I2V** | 480p-1080p | 12s | $0.24 | Fast, balanced quality |
| **Seedance v1 Pro I2V** | 480p-1080p | 12s | $0.62 | Premium quality |

#### Kuaishou Kling
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Kling v2.5 Turbo Pro I2V** | 1080p | 10s | $0.35 | Cinematic motion |

#### MiniMax Hailuo
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Hailuo 2.3 Standard** | 768p | 10s | $0.28-0.56 | Budget I2V |
| **Hailuo 2.3 Fast Pro** | 1080p | 10s | $0.33 | Faster 1080p |
| **Hailuo 2.3 Pro** | 1080p | 10s | $0.49 | Highest fidelity |

#### Alibaba WAN
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **WAN v2.5 Preview I2V** | 480p-1080p | 10s | $0.05-0.15/s | Music + prompt expansion |

#### Vidu
| Model | Resolution | Max Duration | Price | Best For |
|-------|------------|--------------|-------|----------|
| **Vidu Q2 Turbo I2V** | 720p | 8s | $0.05/s | Motion control |

### Avatar Models

| Model | Resolution | Max Duration | Price | Required Inputs |
|-------|------------|--------------|-------|-----------------|
| **Kling Avatar Pro** | 1080p | 10s | $0.25 | Image + Audio |
| **Kling Avatar Standard** | 720p | 10s | $0.15 | Image + Audio |
| **ByteDance OmniHuman v1.5** | 1080p | 30s | $0.20 | Image + Audio |
| **WAN Animate/Replace** | 480p-720p | 30s | $0.075 | Image + Video |
| **Sora 2 Video Remix** | Preserves source | 12s | Dynamic | Sora video ID |

### Video Upscale Models

| Model | Output | Max Duration | Price | Best For |
|-------|--------|--------------|-------|----------|
| **ByteDance Upscaler** | 1080p/2K/4K | 2 min | $0.007-0.058/s | AI upscaling, optional 60fps |
| **FlashVSR Upscaler** | 1x-4x | 2 min | $0.0005/megapixel | Fastest, customizable |
| **Topaz Upscale** | Up to 8x | 2 min | $0.50+ | Professional quality |

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
- Audio file (MP3, WAV, AAC - max 50MB)
- Optional: Source video for WAN Animate/Replace

## AI Video Workflow Steps

### Step 1: Access AI Video Generation
1. Navigate to **Media Panel → AI tab**
2. Choose generation mode:
   - **Text to Video**: Generate from text descriptions
   - **Image to Video**: Animate existing images
   - **Avatar**: Create talking head videos

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
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   User Input    │───▶│  AI Video Client │───▶│   FAL AI APIs   │
│ (Text/Image)    │    │  (Multi-model)   │    │   (40+ models)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Media Store   │◀───│  Video Download  │◀───│   Video URLs    │
│   (Timeline)    │    │   & Processing   │    │   (fal.media)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │
         ▼
┌─────────────────┐    ┌──────────────────┐
│ Storage Service │───▶│   Project DB     │
│  (Persistence)  │    │ (IndexedDB/OPFS) │
└─────────────────┘    └──────────────────┘
```

### Key Components

#### 1. **AI Constants** (`components/editor/media-panel/views/ai-constants.ts`)
- Centralized model configuration with endpoints, pricing, capabilities
- 40+ AI models with full parameter specifications
- Model helper functions for filtering and selection

#### 2. **AI Video Client** (`lib/ai-video-client.ts`)
- Direct integration with FAL AI APIs
- Handles text-to-video, image-to-video, and avatar generation
- Multi-model support with sequential processing
- Progress tracking and status polling
- Error handling and retry logic

#### 3. **FAL AI Client** (`lib/fal-ai-client.ts`)
- Low-level FAL API integration
- Veo 3.1 specific implementations
- Request/response handling

#### 4. **AI View Component** (`components/editor/media-panel/views/ai.tsx`)
- Main UI for AI video generation
- Responsive layout for different panel widths
- Model selection and cost calculation
- Progress visualization and status updates
- Integration with media panel and timeline

#### 5. **Text-to-Video Models Config** (`components/editor/media-panel/views/text2video-models-config.ts`)
- Model capability definitions (aspect ratios, resolutions, durations)
- Combined capability computation for multi-model selection
- Model ID aliasing for compatibility

### Model Endpoints

#### Text-to-Video Endpoints
```typescript
const TEXT_TO_VIDEO_ENDPOINTS = {
  // OpenAI Sora 2
  "sora2": "fal-ai/sora-2/text-to-video",
  "sora2_pro": "fal-ai/sora-2/text-to-video/pro",

  // Google Veo
  "veo31_fast": "fal-ai/veo3.1/fast",
  "veo31": "fal-ai/veo3.1",
  "veo3_fast": "fal-ai/google/veo3/fast",
  "veo3": "fal-ai/google/veo3",

  // LTX Video
  "ltxv2_pro": "fal-ai/ltxv-2/text-to-video",
  "ltxv2_fast": "fal-ai/ltxv-2/text-to-video/fast",

  // Hailuo
  "hailuo_02": "fal-ai/minimax/hailuo-02/standard/text-to-video",
  "hailuo_02_pro": "fal-ai/minimax/hailuo-02/pro/text-to-video",
  "hailuo_23_standard": "fal-ai/minimax/hailuo-2.3/standard/text-to-video",
  "hailuo_23_pro": "fal-ai/minimax/hailuo-2.3/pro/text-to-video",

  // Seedance
  "seedance_lite": "fal-ai/bytedance/seedance/v1/lite/text-to-video",
  "seedance_pro": "fal-ai/bytedance/seedance/v1/pro/text-to-video",

  // Kling
  "kling_v2_1": "fal-ai/kling-video/v2.1/master",
  "kling_v2_5": "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",

  // WAN
  "wan_25": "fal-ai/wan-25-preview/text-to-video",
  "wan_turbo": "fal-ai/wan/v2.2-a14b/text-to-video/turbo",
};
```

#### Image-to-Video Endpoints
```typescript
const IMAGE_TO_VIDEO_ENDPOINTS = {
  // OpenAI Sora 2
  "sora2_i2v": "fal-ai/sora-2/image-to-video",
  "sora2_i2v_pro": "fal-ai/sora-2/image-to-video/pro",

  // Google Veo 3.1
  "veo31_fast_i2v": "fal-ai/veo3.1/fast/image-to-video",
  "veo31_fast_f2v": "fal-ai/veo3.1/fast/first-last-frame-to-video",
  "veo31_i2v": "fal-ai/veo3.1/image-to-video",
  "veo31_f2v": "fal-ai/veo3.1/first-last-frame-to-video",

  // LTX Video
  "ltxv2_i2v": "fal-ai/ltxv-2/image-to-video",
  "ltxv2_fast_i2v": "fal-ai/ltxv-2/image-to-video/fast",

  // Seedance
  "seedance_pro_fast_i2v": "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video",
  "seedance_pro_i2v": "fal-ai/bytedance/seedance/v1/pro/image-to-video",

  // Kling
  "kling_v2_5_i2v": "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",

  // Hailuo
  "hailuo_23_standard": "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
  "hailuo_23_fast_pro": "fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video",
  "hailuo_23_pro": "fal-ai/minimax/hailuo-2.3/pro/image-to-video",

  // WAN
  "wan_25_i2v": "fal-ai/wan-25-preview/image-to-video",

  // Vidu
  "vidu_q2_i2v": "fal-ai/vidu/q2/image-to-video/turbo",
};
```

### Generation Parameters
```typescript
interface VideoGenerationRequest {
  prompt: string;
  model: string;
  resolution?: string;    // "480p", "720p", "1080p", "1440p", "2160p"
  duration?: number;      // Varies by model
  aspect_ratio?: string;  // "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"
  generate_audio?: boolean;
  enhance_prompt?: boolean;
  negative_prompt?: string;
  seed?: number;
}

interface ImageToVideoRequest {
  image: File | string;   // File or URL
  model: string;
  prompt?: string;
  resolution?: string;
  duration?: number;
  aspect_ratio?: string;
}

interface FrameToVideoRequest {
  first_frame: File | string;
  last_frame: File | string;
  model: string;
  prompt?: string;
  duration?: number;
  generate_audio?: boolean;
}
```

### Video Processing Pipeline

#### Download Workflow
```typescript
// 1. Generate video via FAL API
const response = await generateVideo({
  prompt: "A cat playing with yarn",
  model: "kling_v2_1",
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
- **Max Prompt Length**: 500 characters (up to 3000 for some models)
- **Max Image Size**: 10MB (8MB for Veo 3.1)
- **Max Audio Size**: 50MB (for avatar models)
- **Max Video Size**: 100MB (500MB for upscale)
- **History Limit**: 10 most recent generations

### UI Responsive Breakpoints
- **Collapsed**: Width ≤ min width + 2px (icon only)
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
- Cost range: $0.04 - $3.20+ per video
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
| **Quick Prototyping** | Seedance v1 Lite, Hailuo 02, WAN Turbo | Cost-effective, fast |
| **Professional Content** | Kling v2.1, Veo 3.1, Sora 2 Pro | High quality |
| **4K/High Resolution** | LTX Video 2.0 Pro/Fast | Up to 2160p support |
| **Long Duration** | LTX Video 2.0 Fast, Seedance | Up to 20s |
| **With Audio** | LTX Video 2.0, Veo 3.1 | Built-in audio generation |
| **Realistic Physics** | Hailuo 02/Pro, Veo 3.1 | Physics simulation |
| **Fast Turnaround** | Seedance Lite, Veo3 Fast, LTX Fast | Optimized for speed |
| **Budget Projects** | Seedance v1 Lite, WAN Turbo | Lowest cost |
| **Premium Quality** | Veo 3.1, Sora 2 Pro, Kling v2.1 | Highest quality |
| **Talking Heads** | OmniHuman, Kling Avatar | Avatar generation |

## Troubleshooting

### Common Issues

#### 1. **API Key Not Configured**
- **Symptoms**: "FAL API key not configured" error
- **Solution**: Add API key in Settings → API Keys (desktop app)
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
  - Kling v2.1: 2-3 minutes
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
- **WAN Turbo**: 30-60 seconds
- **LTX Video 2.0 Fast**: 30-90 seconds
- **Hailuo 02**: 60-120 seconds
- **Kling v2.1**: 120-180 seconds
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

*Last Updated: November 2025*
*QCut AI Video Models: 40+ models via FAL.ai*
*Price Range: $0.04 - $3.20+ per video*
