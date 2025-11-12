# Adding Video Upscaling Models to QCut

## Overview
This document describes how to add video upscaling models to QCut's AI video enhancement panel. Video upscaling uses AI to increase video resolution and enhance quality, supporting upscaling from standard definition to 1080p, 2K, or 4K.

## Codebase Reference (Current State - 2025)

This guide uses actual patterns and line numbers from the current codebase. Key files:

| File | Current Line Range | Purpose |
|------|-------------------|---------|
| `ai-constants.ts` | 253-366 | Image-to-video models (reference for upscale models) |
| `ai-constants.ts` | 793-823 | UPLOAD_CONSTANTS (video upload limits) |
| `ai-types.ts` | 134-209 | UseAIGenerationProps interface (add upscale props here) |
| `ai-video-client.ts` | 2040-2176 | generateSeedanceVideo (reference pattern) |
| `use-ai-generation.ts` | 1020-1155 | Image tab handler (reference for upscale handler) |
| `ai.tsx` | 1622-2059 | Image tab UI (reference for upscale UI) |
| `fal-ai-client.ts` | 259-339 | File upload methods (add uploadVideoToFal) |

**Note**: Line numbers are approximate and may shift as code evolves. Use the patterns as reference.

## Model Information

### 1. ByteDance Video Upscaler (fal.ai)

#### Model Details
- **Model ID**: `fal-ai/bytedance-upscaler/upscale/video`
- **Documentation**: https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video/api
- **Description**: AI-powered video upscaling with support for multiple resolution targets
- **Category**: Video Enhancement / Upscaling
- **License**: Commercial use permitted

#### Capabilities
- **Input**: Video URL (MP4, MOV, AVI formats, max 500MB, up to 2 minutes)
- **Target Resolution Options**:
  - 1080p (Full HD)
  - 2K (2560×1440)
  - 4K (3840×2160)
- **Target FPS Options**:
  - 30fps (default)
  - 60fps (doubles processing cost)
- **Processing**: 4x resolution upscaling capability
- **Output**: Enhanced video with improved clarity and detail

#### Pricing
**Per-second billing model:**
- **1080p @ 30fps**: $0.0072/second
- **2K @ 30fps**: $0.0144/second
- **4K @ 30fps**: $0.0288/second
- **60fps**: Doubles the cost for any resolution tier

**Cost Examples:**
- 10s @ 1080p/30fps = $0.072
- 10s @ 2K/30fps = $0.144
- 10s @ 4K/30fps = $0.288
- 10s @ 1080p/60fps = $0.144
- 60s @ 4K/30fps = $1.728
- 120s @ 4K/60fps = $6.912

#### API Endpoint
**POST**: `https://fal.run/fal-ai/bytedance-upscaler/upscale/video`

#### Request Parameters
```typescript
interface ByteDanceUpscaleRequest {
  video_url: string;                    // Required: URL of source video
  target_resolution?: "1080p" | "2k" | "4k";  // Default: "1080p"
  target_fps?: "30fps" | "60fps";       // Default: "30fps"
}
```

#### Response Format
```typescript
interface ByteDanceUpscaleResponse {
  video: {
    url: string;           // URL to upscaled video
    content_type: string;  // "video/mp4"
    file_name: string;
    file_size: number;
  };
  duration: number;        // Duration used for billing (seconds)
}
```

#### Processing Time
- **Queue-based**: Asynchronous processing with webhooks
- **Estimate**: Variable based on resolution and duration
  - 1080p: ~1-2x video duration
  - 4K: ~3-5x video duration

---

### 2. FlashVSR Video Upscaler (fal.ai)

#### Model Details
- **Model ID**: `fal-ai/flashvsr/upscale/video`
- **Documentation**: https://fal.ai/models/fal-ai/flashvsr/upscale/video/api
- **Description**: Fastest video upscaling with VAE decoding pipeline and customizable quality settings
- **Category**: Video Enhancement / High-Speed Upscaling
- **License**: Commercial use permitted

#### Capabilities
- **Input**: Video URL (standard video formats)
- **Upscale Factor**: 1x to 4x (continuous float range)
- **Acceleration Modes**:
  - `regular` - Balanced speed and quality (default)
  - `high` - Faster processing with slight quality trade-off
  - `full` - Maximum speed, more quality reduction
- **Quality Control**: 0-100 tile blending quality (default: 70)
- **Color Correction**: Optional color fix toggle (enabled by default)
- **Audio Preservation**: Optional audio track retention via FFmpeg
- **Output Formats**:
  - X264 (.mp4) - Default
  - VP9 (.webm)
  - ProRes 4444 (.mov) - Professional/lossless
  - GIF (.gif) - Animated
- **Output Quality Levels**: low, medium, high, maximum
- **Write Modes**:
  - `fast` - Faster encoding
  - `balanced` - Default balance (default)
  - `small` - Smaller file size
- **Seed Support**: Reproducible results with seed parameter

#### Pricing
**Megapixel-based billing:**
- **Formula**: $0.0005 per megapixel of video data
- **Calculation**: _output_ width × _output_ height × frames × $0.0005 / 1,000,000 (multiply the original dimensions by the selected upscale factor before computing the area)

**Cost Examples:**
- 1920×1080, 121 frames = 250.88 megapixels = **$0.125**
- 3840×2160 (4K), 121 frames = 1,003.52 megapixels = **$0.502**
- 1280×720, 300 frames = 276.48 megapixels = **$0.138**
- 3840×2160 (4K), 300 frames = 2,488.32 megapixels = **$1.244**

**Cost Comparison by Duration (1080p → 4K upscale):**
- 5s @ 30fps (150 frames): ~$0.622
- 10s @ 30fps (300 frames): ~$1.244
- 30s @ 30fps (900 frames): ~$3.732
- 60s @ 30fps (1800 frames): ~$7.464

#### API Endpoint
**POST**: `https://fal.run/fal-ai/flashvsr/upscale/video`

#### Request Parameters
```typescript
interface FlashVSRUpscaleRequest {
  video_url: string;                    // Required: URL of source video
  upscale_factor?: number;              // Default: 4, Range: 1-4
  acceleration?: "regular" | "high" | "full";  // Default: "regular"
  quality?: number;                     // Default: 70, Range: 0-100
  color_fix?: boolean;                  // Default: true
  preserve_audio?: boolean;             // Default: false
  output_format?: "X264" | "VP9" | "PRORES4444" | "GIF";  // Default: "X264"
  output_quality?: "low" | "medium" | "high" | "maximum";  // Default: "high"
  output_write_mode?: "fast" | "balanced" | "small";      // Default: "balanced"
  seed?: number;                        // Optional: for reproducibility
  sync_mode?: boolean;                  // Default: false
}
```

#### Response Format
```typescript
interface FlashVSRUpscaleResponse {
  seed: number;           // Random seed used for processing
  video: {
    url: string;          // URL to upscaled video
    content_type: string; // "video/mp4", "video/webm", etc.
    file_name: string;
    file_size: number;
  };
}
```

#### Processing Time
- **Queue-based**: Asynchronous processing with webhooks recommended
- **Speed**: Advertised as "fastest speeds" among upscaling models
- **Acceleration Impact**:
  - `regular` - Standard processing time
  - `high` - ~30-40% faster
  - `full` - ~50-60% faster

#### Key Features
- **Flexible Upscaling**: Continuous scale factor (1x-4x) instead of fixed presets
- **Speed Control**: Three acceleration modes for time-critical workflows
- **Format Flexibility**: Multiple output codecs including professional ProRes
- **Audio Options**: Preserve or strip audio tracks
- **File Size Control**: Write mode optimization for bandwidth/storage needs
- **Quality Tuning**: Granular quality control (0-100 range)

---

### 3. Topaz Video Upscale

#### Model Details
- **Name**: Topaz Video Upscale
- **Description**: Professional upscaling up to 8x with AI enhancement
- **Pricing**: $0.50 - $5.00 (varies by upscale factor)
- **Category**: Video Enhancement / Professional Upscaling

#### Capabilities (from screenshot)
- **Source Video**: Up to 2 minutes
- **Formats**: MP4, MOV, AVI (max 500MB)
- **Upscale Factor**: 2.0x (adjustable, up to 8x available)
- **Target FPS**: Optional frame interpolation
  - Original FPS (default)
  - Frame interpolation for smoother motion
- **Output Quality**: H.264 encoding
  - Better compatibility but larger file size
- **Processing Time**: 30-60 seconds (for typical videos)

#### Pricing Tiers
- **2x upscale**: ~$0.50
- **4x upscale**: ~$2.00
- **8x upscale**: ~$5.00
- Higher factor = better quality but longer processing

#### UI Features (from screenshot)
- **Upscale Factor Slider**: 2.0x with visual resolution indicator (1440p shown)
- **Discrete Steps**: Slider jumps between 2x, 3x, 4x, 6x, and 8x to match pricing tiers
- **Target FPS Control**: Optional frame interpolation
- **H.264 Output Toggle**: Compatibility vs file size trade-off
- **Cost Estimator**: Real-time display ($0.50 shown)
- **Processing Time Estimate**: 30-60 seconds preview

---

## Implementation Plan

**Total Estimated Time**: ~95 minutes (1.5 hours)

This implementation has been broken down into **5 subtasks** of 15-25 minutes each for better manageability:

| Subtask | Duration | Focus | Status |
|---------|----------|-------|--------|
| 1. Core Infrastructure | 20 min | Constants, types, video upload | ⏸️ Not Started |
| 2. ByteDance Upscaler | 20 min | API client, handler, UI, costs | ⏸️ Not Started |
| 3. FlashVSR Upscaler | 25 min | API client, handler, UI, costs | ⏸️ Not Started |
| 4. Topaz Upscaler Stub | 10 min | Stubs for future implementation | ⏸️ Not Started |
| 5. Testing & Integration | 20 min | End-to-end testing, validation | ⏸️ Not Started |

### Subtask Breakdown

#### Subtask 1: Core Infrastructure Setup (20 minutes)
- Add model entries to `ai-constants.ts` for all three upscalers
- Add type definitions in `ai-types.ts`
- Add `uploadVideoToFal()` helper in `fal-ai-client.ts`
- Add "upscale" tab to UI navigation

**Deliverable**: Models appear in UI dropdown, video upload infrastructure ready

#### Subtask 2: ByteDance Upscaler Implementation (20 minutes)
- Add `upscaleByteDanceVideo()` API client function
- Add ByteDance generation handler in `use-ai-generation.ts`
- Add ByteDance UI controls (resolution/FPS selectors)
- Add ByteDance cost calculation helper

**Deliverable**: Fully functional ByteDance upscaler with UI controls

#### Subtask 3: FlashVSR Upscaler Implementation (25 minutes)
- Add `upscaleFlashVSRVideo()` API client function
- Add FlashVSR generation handler in `use-ai-generation.ts`
- Add FlashVSR UI controls (upscale factor, acceleration, quality, formats)
- Add FlashVSR cost calculation helper

**Deliverable**: Fully functional FlashVSR upscaler with advanced controls

#### Subtask 4: Topaz Upscaler Stub (10 minutes)
- Add `upscaleTopazVideo()` API client stub
- Add Topaz generation handler stub
- Add Topaz UI controls (upscale factor, frame interpolation)
- Add Topaz cost calculation helper

**Deliverable**: Topaz upscaler UI ready, awaiting API endpoint

#### Subtask 5: Testing & Integration (20 minutes)
- Test ByteDance upscaler end-to-end
- Test FlashVSR upscaler end-to-end
- Verify all UI controls function correctly
- Test cost calculations accuracy
- Handle edge cases and errors

**Deliverable**: Production-ready upscaling feature

---

### Step 1: Add Video Upscale Category to Constants

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Action**: Add new upscaling models to the `AI_MODELS` array (around line 253+)

**Pattern Reference**: Follow the structure used by existing models like `seedance_pro_fast_i2v` (lines 254-285)

```typescript
// Add these after the existing image-to-video models (around line 366)

// ByteDance Video Upscaler
{
  id: "bytedance_video_upscaler",
  name: "ByteDance Video Upscaler",
  description: "AI-powered video upscaling to 1080p, 2K, or 4K with optional 60fps",
  price: "0.072", // Base price per 10s @ 1080p
  resolution: "1080p / 2K / 4K",
  max_duration: 120, // 2 minutes max
  category: "upscale", // New category for video enhancement
  endpoints: {
    upscale_video: "fal-ai/bytedance-upscaler/upscale/video",
  },
  default_params: {
    target_resolution: "1080p",
    target_fps: "30fps",
  },
  supportedResolutions: ["1080p", "2k", "4k"],
  supportedFPS: ["30fps", "60fps"],
  perSecondPricing: {
    "1080p_30fps": 0.0072,
    "2k_30fps": 0.0144,
    "4k_30fps": 0.0288,
    "1080p_60fps": 0.0144,
    "2k_60fps": 0.0288,
    "4k_60fps": 0.0576,
  },
},

// FlashVSR Video Upscaler
{
  id: "flashvsr_video_upscaler",
  name: "FlashVSR Video Upscaler",
  description: "Fastest video upscaling (1-4x) with customizable quality and format options",
  price: "0.125", // Base estimate for ~121 frames @ 1080p
  pricingModel: "megapixel", // $0.0005 per megapixel
  resolution: "1x to 4x upscaling",
  supportedUpscaleFactors: { min: 1, max: 4, step: 0.1 }, // Continuous range
  supportedAcceleration: ["regular", "high", "full"],
  supportedOutputFormats: ["X264", "VP9", "PRORES4444", "GIF"],
  supportedOutputQuality: ["low", "medium", "high", "maximum"],
  supportedWriteModes: ["fast", "balanced", "small"],
  category: "upscale",
  endpoints: {
    upscale_video: "fal-ai/flashvsr/upscale/video",
  },
  default_params: {
    upscale_factor: 4,
    acceleration: "regular",
    quality: 70,
    color_fix: true,
    preserve_audio: false,
    output_format: "X264",
    output_quality: "high",
    output_write_mode: "balanced",
  },
},

// Topaz Video Upscale
{
  id: "topaz_video_upscale",
  name: "Topaz Video Upscale",
  description: "Professional upscaling up to 8x with AI enhancement",
  price: "0.50", // Base price for 2x upscale
  resolution: "Up to 8x upscaling",
  supportedUpscaleFactors: [2.0, 3.0, 4.0, 6.0, 8.0],
  max_duration: 120, // 2 minutes max
  category: "upscale",
  endpoints: {
    upscale_video: "topaz/video-upscale", // Placeholder - needs actual endpoint
  },
  default_params: {
    upscale_factor: 2.0,
    target_fps: "original",
    h264_output: false,
  },
},
```

### Step 2: Add Type Definitions

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`

**Action**: Add upscaling-specific types to `UseAIGenerationProps` interface (around line 134)

**Pattern Reference**: Follow the structure of existing props like `seedanceDuration`, `klingCfgScale` (lines 175-209)

```typescript
// Add these to the UseAIGenerationProps interface (around line 209)

// ByteDance Upscaler options
bytedanceTargetResolution?: "1080p" | "2k" | "4k";
bytedanceTargetFPS?: "30fps" | "60fps";

// FlashVSR Upscaler options
flashvsrUpscaleFactor?: number; // 1.0 to 4.0
flashvsrAcceleration?: "regular" | "high" | "full";
flashvsrQuality?: number; // 0 to 100
flashvsrColorFix?: boolean;
flashvsrPreserveAudio?: boolean;
flashvsrOutputFormat?: "X264" | "VP9" | "PRORES4444" | "GIF";
flashvsrOutputQuality?: "low" | "medium" | "high" | "maximum";
flashvsrOutputWriteMode?: "fast" | "balanced" | "small";
flashvsrSeed?: number;

// Topaz Upscaler options
topazUpscaleFactor?: number; // 2.0 to 8.0
topazTargetFPS?: "original" | "interpolated";
topazH264Output?: boolean;

// Shared upscaling options
sourceVideoFile?: File | null;
sourceVideoUrl?: string;
```

**Also update**: `activeTab` type to include "upscale":
```typescript
activeTab: "text" | "image" | "avatar" | "upscale"; // Line 138
```

### Step 3: Add API Client Function

**File**: `qcut/apps/web/src/lib/ai-video-client.ts`

**Action**: Add upscaler functions after existing generation functions (around line 2425+)

**Pattern Reference**: Follow the structure of `generateSeedanceVideo` (lines 2058-2176)

```typescript
/**
 * ByteDance Video Upscaler Request Interface
 */
export interface ByteDanceUpscaleRequest {
  video_url: string;
  target_resolution?: "1080p" | "2k" | "4k";
  target_fps?: "30fps" | "60fps";
}

/**
 * Upscale video using ByteDance Video Upscaler
 */
export async function upscaleByteDanceVideo(
  request: ByteDanceUpscaleRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    if (!request.video_url) {
      throw new Error("Video URL is required for upscaling");
    }

    const modelConfig = getModelConfig("bytedance_video_upscaler");
    if (!modelConfig) {
      throw new Error("ByteDance upscaler model not found");
    }

    const endpoint = modelConfig.endpoints.upscale_video;
    if (!endpoint) {
      throw new Error("ByteDance upscaler endpoint not configured");
    }

    const targetResolution = request.target_resolution ?? "1080p";
    const targetFPS = request.target_fps ?? "30fps";

    const payload: Record<string, unknown> = {
      video_url: request.video_url,
      target_resolution: targetResolution,
      target_fps: targetFPS,
    };

    const jobId = generateJobId();
    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error(
          "Invalid FAL.ai API key. Please check your API key configuration."
        );
      }

      if (response.status === 429) {
        throw new Error(
          "Rate limit exceeded. Please wait a moment before trying again."
        );
      }

      throw new Error(
        `FAL API error: ${errorData.detail || response.statusText}`
      );
    }

    const result = await response.json();
    return {
      job_id: jobId,
      status: "completed",
      message: `Video upscaled to ${targetResolution} @ ${targetFPS}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video || result.url,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Upscale video with ByteDance", {
      operation: "upscaleByteDanceVideo",
    });
    throw error;
  }
}

/**
 * FlashVSR Video Upscaler Request Interface
 */
export interface FlashVSRUpscaleRequest {
  video_url: string;
  upscale_factor?: number; // 1.0 to 4.0
  acceleration?: "regular" | "high" | "full";
  quality?: number; // 0 to 100
  color_fix?: boolean;
  preserve_audio?: boolean;
  output_format?: "X264" | "VP9" | "PRORES4444" | "GIF";
  output_quality?: "low" | "medium" | "high" | "maximum";
  output_write_mode?: "fast" | "balanced" | "small";
  seed?: number;
}

/**
 * Upscale video using FlashVSR Video Upscaler
 *
 * @param request - Video URL and upscaling parameters
 */
export async function upscaleFlashVSRVideo(
  request: FlashVSRUpscaleRequest
): Promise<VideoGenerationResponse> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    if (!request.video_url) {
      throw new Error("Video URL is required for upscaling");
    }

    // Validate upscale factor
    const upscaleFactor = request.upscale_factor ?? 4;
    if (upscaleFactor < 1 || upscaleFactor > 4) {
      throw new Error("Upscale factor must be between 1 and 4");
    }

    // Validate quality
    const quality = request.quality ?? 70;
    if (quality < 0 || quality > 100) {
      throw new Error("Quality must be between 0 and 100");
    }

    const payload: Record<string, unknown> = {
      video_url: request.video_url,
      upscale_factor: upscaleFactor,
      acceleration: request.acceleration ?? "regular",
      quality,
      color_fix: request.color_fix ?? true,
      preserve_audio: request.preserve_audio ?? false,
      output_format: request.output_format ?? "X264",
      output_quality: request.output_quality ?? "high",
      output_write_mode: request.output_write_mode ?? "balanced",
    };

    // Add optional seed
    if (request.seed !== undefined) {
      payload.seed = request.seed;
    }

    const jobId = `flashvsr-upscale-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const response = await fetch(
      `${FAL_API_BASE}/fal-ai/flashvsr/upscale/video`,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${falApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error("Invalid FAL.ai API key. Please check your API key configuration.");
      }

      if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please wait a moment before trying again.");
      }

      throw new Error(`FAL API error: ${errorData.detail || response.statusText}`);
    }

    const result = await response.json();
    return {
      job_id: jobId,
      status: "completed",
      message: `Video upscaled with FlashVSR (${upscaleFactor}x)`,
      estimated_time: 0,
      video_url: result.video?.url || result.video || result.url,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Upscale video with FlashVSR", {
      operation: "upscaleFlashVSRVideo",
    });
    throw error;
  }
}

/**
 * Topaz Video Upscaler Request Interface
 */
export interface TopazUpscaleRequest {
  video_url: string;
  upscale_factor?: number; // 2.0 to 8.0
  target_fps?: "original" | "interpolated";
  h264_output?: boolean;
}

/**
 * Upscale video using Topaz Video Upscaler
 *
 * @param request - Video URL and upscaling parameters
 */
export async function upscaleTopazVideo(
  request: TopazUpscaleRequest
): Promise<VideoGenerationResponse> {
  // TODO: Implement when Topaz API endpoint is available
  throw new Error("Topaz Video Upscale not yet implemented");
}
```

### Step 4: Add Video Upload Helper

**File**: `qcut/apps/web/src/lib/fal-ai-client.ts`

**Action**: Extend the internal upload helper to accept `"video"` and expose a typed wrapper (after line 339).

1. **Widen the `uploadFileToFal` union** so `"video"` is an allowed value:

```typescript
private async uploadFileToFal(
  file: File,
  fileType: "image" | "audio" | "video" | "asset" = "asset"
): Promise<string> {
  // existing logic…
}
```

2. **Add the public convenience method** right after the existing audio helper:

```typescript
/**
 * Uploads an MP4/MOV/AVI asset to FAL storage and returns the URL.
 */
async uploadVideoToFal(file: File): Promise<string> {
  return this.uploadFileToFal(file, "video");
}
```

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Action**: Reuse the existing “Video uploads” block instead of creating a duplicate. Keep the shared keys for WAN (100MB) and append upscale‑specific limits so both features can coexist:

```typescript
  // Video uploads (WAN + Upscale)
  ALLOWED_VIDEO_TYPES: ["video/mp4", "video/quicktime", "video/x-msvideo"],
  MAX_VIDEO_SIZE_BYTES: 100 * 1024 * 1024, // WAN’s existing guardrail
  MAX_VIDEO_SIZE_LABEL: "100MB",
  SUPPORTED_VIDEO_FORMATS: [".mp4", ".mov", ".avi"],
  VIDEO_FORMATS_LABEL: "MP4, MOV, AVI",

  // Upscale overrides (ByteDance/Topaz allow 500MB)
  UPSCALE_MAX_VIDEO_SIZE_BYTES: 500 * 1024 * 1024,
  UPSCALE_MAX_VIDEO_SIZE_LABEL: "500MB",
```

The upscale UI (Step 6) should reference the new `UPSCALE_MAX_VIDEO_SIZE_*` keys so WAN continues to enforce its tighter limit.

### Step 5: Add Generation Handler

**File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**Action**: Add upscale tab handler in the main generation loop (around line 1155+, after image tab handler ends)

**Pattern Reference**: Follow the structure of the image tab handler (lines 1019-1155)

```typescript
// Add after the image tab handler (around line 1155)

// Upscale Tab - Video Enhancement
else if (activeTab === "upscale") {
  // ByteDance Video Upscaler
  if (modelId === "bytedance_video_upscaler") {
    if (!sourceVideoFile && !sourceVideoUrl) {
      console.log("  ⚠️ Skipping model - Video source required");
      continue;
    }

    const videoUrl = sourceVideoFile
      ? await falAIClient.uploadVideoToFal(sourceVideoFile)
      : sourceVideoUrl!;

    const friendlyName = modelName || modelId;
    progressCallback({
      status: "processing",
      progress: 10,
      message: `Uploading video for ${friendlyName}...`,
    });

    progressCallback({
      status: "processing",
      progress: 30,
      message: `Upscaling video to ${bytedanceTargetResolution}...`,
    });

    response = await upscaleByteDanceVideo({
      video_url: videoUrl,
      target_resolution: bytedanceTargetResolution,
      target_fps: bytedanceTargetFPS,
    });

    progressCallback({
      status: "completed",
      progress: 100,
      message: `Video upscaled with ${friendlyName}`,
    });
  }

  // FlashVSR Video Upscaler
  else if (modelId === "flashvsr_video_upscaler") {
    if (!sourceVideoFile && !sourceVideoUrl) {
      console.log("  ⚠️ Skipping model - Video source required");
      continue;
    }

    const videoUrl = sourceVideoFile
      ? await falAIClient.uploadVideoToFal(sourceVideoFile)
      : sourceVideoUrl!;

    const friendlyName = modelName || modelId;
    progressCallback({
      status: "processing",
      progress: 10,
      message: `Uploading video for ${friendlyName}...`,
    });

    progressCallback({
      status: "processing",
      progress: 30,
      message: `Upscaling video with FlashVSR (${flashvsrUpscaleFactor}x)...`,
    });

    response = await upscaleFlashVSRVideo({
      video_url: videoUrl,
      upscale_factor: flashvsrUpscaleFactor,
      acceleration: flashvsrAcceleration,
      quality: flashvsrQuality,
      color_fix: flashvsrColorFix,
      preserve_audio: flashvsrPreserveAudio,
      output_format: flashvsrOutputFormat,
      output_quality: flashvsrOutputQuality,
      output_write_mode: flashvsrOutputWriteMode,
      seed: flashvsrSeed,
    });

    progressCallback({
      status: "completed",
      progress: 100,
      message: `Video upscaled with ${friendlyName}`,
    });
  }

  // Topaz Video Upscaler
  else if (modelId === "topaz_video_upscale") {
    // TODO: Implement when Topaz API is available
    throw new Error("Topaz Video Upscale not yet implemented");
  }
}
```

### Step 6: Add UI Controls

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Action**: Add upscale tab and UI controls

**Pattern Reference**: Follow the UI structure in the image tab (lines 1622-2059)

#### 6a. Add tab to navigation (around line 850)
```tsx
<TabsList>
  <TabsTrigger value="text">Text</TabsTrigger>
  <TabsTrigger value="image">Image</TabsTrigger>
  <TabsTrigger value="avatar">Avatar</TabsTrigger>
  <TabsTrigger value="upscale">Upscale</TabsTrigger> {/* Add this */}
</TabsList>
```

#### 6b. Add state + derived values (around line 220)
```tsx
type VideoMetadata = {
  width: number;
  height: number;
  frames?: number;
  duration?: number;
  fps?: number;
};

// Upscale tab state
const [sourceVideoFile, setSourceVideoFile] = useState<File | null>(null);
const [sourceVideoUrl, setSourceVideoUrl] = useState("");
const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);

const [bytedanceTargetResolution, setBytedanceTargetResolution] =
  useState<"1080p" | "2k" | "4k">("1080p");
const [bytedanceTargetFPS, setBytedanceTargetFPS] =
  useState<"30fps" | "60fps">("30fps");

const [flashvsrUpscaleFactor, setFlashvsrUpscaleFactor] = useState(4);
const [flashvsrAcceleration, setFlashvsrAcceleration] =
  useState<"regular" | "high" | "full">("regular");
const [flashvsrQuality, setFlashvsrQuality] = useState(70);
const [flashvsrColorFix, setFlashvsrColorFix] = useState(true);
const [flashvsrPreserveAudio, setFlashvsrPreserveAudio] = useState(false);
const [flashvsrOutputFormat, setFlashvsrOutputFormat] =
  useState<"X264" | "VP9" | "PRORES4444" | "GIF">("X264");
const [flashvsrOutputQuality, setFlashvsrOutputQuality] =
  useState<"low" | "medium" | "high" | "maximum">("high");
const [flashvsrOutputWriteMode, setFlashvsrOutputWriteMode] =
  useState<"fast" | "balanced" | "small">("balanced");
const [flashvsrSeed, setFlashvsrSeed] = useState<number | undefined>();

const [topazUpscaleFactor, setTopazUpscaleFactor] = useState(2);
const [topazTargetFPS, setTopazTargetFPS] =
  useState<"original" | "interpolated">("original");
const [topazH264Output, setTopazH264Output] = useState(false);

const bytedanceUpscalerSelected =
  selectedModelId === "bytedance_video_upscaler";
const flashvsrUpscalerSelected =
  selectedModelId === "flashvsr_video_upscaler";

const videoDurationSeconds = videoMetadata?.duration ?? 10;

const bytedanceEstimatedCost = useMemo(
  () =>
    calculateByteDanceUpscaleCost(
      bytedanceTargetResolution,
      bytedanceTargetFPS,
      videoDurationSeconds
    ),
  [bytedanceTargetResolution, bytedanceTargetFPS, videoDurationSeconds]
);

const flashvsrEstimatedCost = useMemo(() => {
  if (!videoMetadata) return "$0.000";
  const { width, height, frames, duration, fps } = videoMetadata;
  const frameCount =
    frames ??
    Math.max(1, Math.round((duration ?? 0) * (fps ?? 30)));

  return calculateFlashVSRUpscaleCost(
    width,
    height,
    frameCount,
    flashvsrUpscaleFactor
  );
}, [videoMetadata, flashvsrUpscaleFactor]);
```

#### 6c. Extract video metadata when a source is provided

```tsx
const handleUpscaleVideoChange = async (file: File | null) => {
  setSourceVideoFile(file);

  if (!file) {
    setVideoMetadata(null);
    return;
  }

  setSourceVideoUrl("");
  const metadata = await extractVideoMetadataFromFile(file);
  setVideoMetadata(metadata);
};

const handleUpscaleVideoUrlBlur = async () => {
  if (!sourceVideoUrl) {
    setVideoMetadata(null);
    return;
  }

  try {
    const metadata = await extractVideoMetadataFromUrl(sourceVideoUrl);
    setVideoMetadata(metadata);
  } catch (error) {
    console.error("Failed to read video metadata", error);
    setVideoMetadata(null);
  }
};
```

> `extractVideoMetadataFromFile` / `extractVideoMetadataFromUrl` can live in a small utility (e.g., `video-metadata.ts`) that loads the asset into a hidden `<video>` element, listens for `loadedmetadata`, and then resolves `{ width, height, duration, fps, frames }`. Knowing the exact dimensions lets the cost estimators stay accurate.

#### 6d. Add tab content (after line 2059)
```tsx
<TabsContent value="upscale" className="space-y-4">
  {/* Video Upload Section */}
  <div className="space-y-3 text-left">
    <Label className="text-sm font-semibold">
      Upload Video for Upscaling
    </Label>
    <FileUpload
      id="upscale-video-upload"
      label="Upload Source Video"
      helperText={`MP4, MOV, or AVI up to ${UPLOAD_CONSTANTS.UPSCALE_MAX_VIDEO_SIZE_LABEL}, max 2 minutes`}
      fileType="video"
      acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_VIDEO_TYPES}
      maxSizeBytes={UPLOAD_CONSTANTS.UPSCALE_MAX_VIDEO_SIZE_BYTES}
      maxSizeLabel={UPLOAD_CONSTANTS.UPSCALE_MAX_VIDEO_SIZE_LABEL}
      formatsLabel={UPLOAD_CONSTANTS.VIDEO_FORMATS_LABEL}
      file={sourceVideoFile}
      preview={null}
      onFileChange={(file) => {
        void handleUpscaleVideoChange(file);
      }}
      onError={setError}
      isCompact={isCompact}
    />
    <div className="text-xs text-muted-foreground">
      Or provide video URL:
    </div>
    <Input
      type="url"
      value={sourceVideoUrl}
      onChange={(e) => {
        setSourceVideoUrl(e.target.value);
        if (e.target.value) setSourceVideoFile(null);
        if (!e.target.value) {
          setVideoMetadata(null);
        }
      }}
      onBlur={handleUpscaleVideoUrlBlur}
      placeholder="https://example.com/video.mp4"
      className="h-8 text-xs"
    />
  </div>

  {/* ByteDance Upscaler Settings */}
  {bytedanceUpscalerSelected && (
    <div className="space-y-3 text-left border-t pt-3">
      <Label className="text-sm font-semibold">
        ByteDance Upscaler Settings
      </Label>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Target Resolution */}
        <div className="space-y-1">
          <Label htmlFor="bytedance-resolution" className="text-xs">
            Target Resolution
          </Label>
          <Select
            value={bytedanceTargetResolution}
            onValueChange={(value) =>
              setBytedanceTargetResolution(value as "1080p" | "2k" | "4k")
            }
          >
            <SelectTrigger
              id="bytedance-resolution"
              className="h-8 text-xs"
            >
              <SelectValue placeholder="Select resolution" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1080p">1080p (Full HD)</SelectItem>
              <SelectItem value="2k">2K (2560×1440)</SelectItem>
              <SelectItem value="4k">4K (3840×2160)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Target FPS */}
        <div className="space-y-1">
          <Label htmlFor="bytedance-fps" className="text-xs">
            Target Frame Rate
          </Label>
          <Select
            value={bytedanceTargetFPS}
            onValueChange={(value) =>
              setBytedanceTargetFPS(value as "30fps" | "60fps")
            }
          >
            <SelectTrigger
              id="bytedance-fps"
              className="h-8 text-xs"
            >
              <SelectValue placeholder="Select FPS" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30fps">30 FPS</SelectItem>
              <SelectItem value="60fps">60 FPS (2x cost)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Cost Estimator */}
      <div className="text-xs text-muted-foreground">
        Estimated cost (per clip): {bytedanceEstimatedCost}
      </div>
      <div className="text-xs text-muted-foreground">
        AI-powered upscaling to 1080p, 2K, or 4K with optional 60fps enhancement.
      </div>
    </div>
  )}

  {/* FlashVSR Upscaler Settings */}
  {flashvsrUpscalerSelected && (
    <Card className="model-settings">
      <h4>FlashVSR Upscaler Settings</h4>

      {/* Upscale Factor Slider */}
      <div className="control-group">
        <Label>Upscale Factor: {flashvsrUpscaleFactor}x</Label>
        <Slider
          min={1.0}
          max={4.0}
          step={0.1}
          value={flashvsrUpscaleFactor}
          onChange={setFlashvsrUpscaleFactor}
        />
        <p className="help-text">
          Continuous scale from 1x (no upscaling) to 4x maximum
        </p>
      </div>

      {/* Acceleration Mode */}
      <div className="control-group">
        <Label>Acceleration Mode</Label>
        <Select
          value={flashvsrAcceleration}
          onValueChange={(value) =>
            setFlashvsrAcceleration(value as "regular" | "high" | "full")
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select acceleration" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="regular">Regular (Best Quality)</SelectItem>
            <SelectItem value="high">High (30-40% faster)</SelectItem>
            <SelectItem value="full">Full (50-60% faster)</SelectItem>
          </SelectContent>
        </Select>
        <p className="help-text">
          Higher acceleration = faster processing with slight quality trade-off
        </p>
      </div>

      {/* Quality Slider */}
      <div className="control-group">
        <Label>Quality: {flashvsrQuality}</Label>
        <Slider
          min={0}
          max={100}
          step={5}
          value={flashvsrQuality}
          onChange={setFlashvsrQuality}
        />
        <p className="help-text">
          Tile blending quality (0-100)
        </p>
      </div>

      {/* Output Format */}
      <div className="control-group">
        <Label>Output Format</Label>
        <Select
          value={flashvsrOutputFormat}
          onValueChange={(value) =>
            setFlashvsrOutputFormat(
              value as "X264" | "VP9" | "PRORES4444" | "GIF"
            )
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="X264">X264 (.mp4) - Standard</SelectItem>
            <SelectItem value="VP9">VP9 (.webm) - Modern codec</SelectItem>
            <SelectItem value="PRORES4444">
              ProRes 4444 (.mov) - Professional
            </SelectItem>
            <SelectItem value="GIF">GIF (.gif) - Animated</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Output Quality */}
      <div className="control-group">
        <Label>Output Quality</Label>
        <Select
          value={flashvsrOutputQuality}
          onValueChange={(value) =>
            setFlashvsrOutputQuality(
              value as "low" | "medium" | "high" | "maximum"
            )
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select quality" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="maximum">Maximum</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Write Mode */}
      <div className="control-group">
        <Label>Encoding Mode</Label>
        <Select
          value={flashvsrOutputWriteMode}
          onValueChange={(value) =>
            setFlashvsrOutputWriteMode(value as "fast" | "balanced" | "small")
          }
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select encoding profile" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fast">Fast (Faster encoding)</SelectItem>
            <SelectItem value="balanced">Balanced (Default)</SelectItem>
            <SelectItem value="small">Small (Smaller file size)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Toggles */}
      <div className="control-group">
        <Checkbox
          checked={flashvsrColorFix}
          onChange={setFlashvsrColorFix}
        >
          Apply Color Correction
        </Checkbox>
      </div>

      <div className="control-group">
        <Checkbox
          checked={flashvsrPreserveAudio}
          onChange={setFlashvsrPreserveAudio}
        >
          Preserve Audio Track
        </Checkbox>
      </div>

      {/* Seed Input */}
      <div className="control-group">
        <Label>Seed (Optional)</Label>
        <Input
          type="number"
          value={flashvsrSeed ?? ""}
          onChange={(e) => setFlashvsrSeed(e.target.value ? parseInt(e.target.value) : undefined)}
          placeholder="Random seed for reproducibility"
        />
      </div>

      {/* Cost Estimator */}
      <div className="cost-estimate">
        <Label>Estimated Cost:</Label>
        <span className="cost-value">{flashvsrEstimatedCost}</span>
        <p className="help-text">
          Based on output megapixels: (width × upscale factor) × (height ×
          upscale factor) × frames × $0.0005 / 1,000,000.
        </p>
      </div>
    </Card>
  )}

  {/* Topaz Upscaler Settings */}
  {selectedModelId === "topaz_video_upscale" && (
    <Card className="model-settings">
      <h4>Topaz Video Upscale Settings</h4>

      {/* Upscale Factor Slider */}
      <div className="control-group">
        <Label>Upscale Factor: {topazUpscaleFactor}x</Label>
        <Slider
          min={2.0}
          max={8.0}
          step={0.5}
          value={topazUpscaleFactor}
          onChange={setTopazUpscaleFactor}
        />
        <p className="help-text">
          Higher factor = better quality but longer processing
        </p>
      </div>

      {/* Target FPS */}
      <div className="control-group">
        <Label>Frame Interpolation</Label>
        <Checkbox
          checked={topazTargetFPS === "interpolated"}
          onChange={(checked) =>
            setTopazTargetFPS(checked ? "interpolated" : "original")
          }
        >
          Create smoother motion
        </Checkbox>
      </div>

      {/* H.264 Output */}
      <div className="control-group">
        <Label>H.264 Output</Label>
        <Checkbox
          checked={topazH264Output}
          onChange={setTopazH264Output}
        >
          Better compatibility but larger file size
        </Checkbox>
      </div>

      {/* Cost Estimator */}
      <div className="cost-estimate">
        <Label>Estimated Cost:</Label>
        <span className="cost-value">
          {calculateTopazUpscaleCost(topazUpscaleFactor)}
        </span>
      </div>

      {/* Processing Time */}
      <div className="processing-estimate">
        <Label>Processing Time:</Label>
        <span>30-60 seconds</span>
      </div>
    </Card>
  )}
</TabsContent>
```

### Step 7: Add Cost Calculation Helpers

```typescript
/**
 * Calculate ByteDance upscale cost based on resolution, FPS, and duration
 */
function calculateByteDanceUpscaleCost(
  resolution: string,
  fps: string,
  durationSeconds: number
): string {
  const rateKey = `${resolution}_${fps}`;
  const rates = {
    "1080p_30fps": 0.0072,
    "2k_30fps": 0.0144,
    "4k_30fps": 0.0288,
    "1080p_60fps": 0.0144,
    "2k_60fps": 0.0288,
    "4k_60fps": 0.0576,
  };

  const rate = rates[rateKey] || 0.0072;
  const totalCost = rate * durationSeconds;

  return `$${totalCost.toFixed(3)}`;
}

/**
 * Calculate FlashVSR upscale cost based on megapixels
 */
function calculateFlashVSRUpscaleCost(
  width: number,
  height: number,
  frames: number,
  upscaleFactor: number
): string {
  // FlashVSR bills on *output* megapixels, so scale width/height by the factor first.
  const outputWidth = width * upscaleFactor;
  const outputHeight = height * upscaleFactor;
  const megapixels = (outputWidth * outputHeight * frames) / 1_000_000;
  const costPerMegapixel = 0.0005;
  const totalCost = megapixels * costPerMegapixel;

  return `$${totalCost.toFixed(3)}`;
}

/**
 * Calculate Topaz upscale cost based on upscale factor
 */
function calculateTopazUpscaleCost(factor: number): string {
  const TOPAZ_COST_TABLE: Record<number, number> = {
    2: 0.5,
    3: 1.0,
    4: 2.0,
    6: 3.5,
    8: 5.0,
  };

  const supportedFactors = Object.keys(TOPAZ_COST_TABLE).map(Number);
  const closestFactor = supportedFactors.reduce((closest, current) =>
    Math.abs(current - factor) < Math.abs(closest - factor) ? current : closest
  );

  return `$${TOPAZ_COST_TABLE[closestFactor].toFixed(2)}`;
}
```

## Testing Checklist

### ByteDance Video Upscaler
- [ ] Model appears in upscale tab UI
- [ ] Video upload works (local file)
- [ ] Video URL input works (remote URL)
- [ ] Resolution selector displays all options (1080p, 2K, 4K)
- [ ] FPS selector displays 30fps and 60fps options
- [ ] Cost estimator updates based on resolution and FPS selection
- [ ] Video uploads successfully to FAL storage
- [ ] Upscaling request completes successfully
- [ ] Upscaled video downloads correctly
- [ ] Output video matches selected resolution
- [ ] Error handling works (invalid video, API errors)
- [ ] File size limit enforced (500MB max)
- [ ] Duration limit enforced (2 minutes max)

### FlashVSR Video Upscaler
- [ ] Model appears in upscale tab UI
- [ ] Video upload works (local file)
- [ ] Video URL input works (remote URL)
- [ ] Upscale factor slider works (1x to 4x, continuous)
- [ ] Acceleration mode selector displays all options (regular/high/full)
- [ ] Quality slider works (0-100)
- [ ] Output format selector works (X264/VP9/ProRes/GIF)
- [ ] Output quality selector works (low/medium/high/maximum)
- [ ] Write mode selector works (fast/balanced/small)
- [ ] Color fix toggle works
- [ ] Preserve audio toggle works
- [ ] Seed input accepts and uses custom seeds
- [ ] Cost estimator calculates based on megapixels (width × height × frames)
- [ ] Video uploads successfully to FAL storage
- [ ] Upscaling request completes successfully
- [ ] Upscaled video downloads correctly
- [ ] Output video matches selected upscale factor
- [ ] Output format matches selection (MP4, WebM, MOV, GIF)
- [ ] Audio preservation works when enabled
- [ ] Error handling works (invalid video, API errors)
- [ ] Acceleration modes impact processing speed as expected

### Topaz Video Upscaler
- [ ] Model appears in upscale tab UI (when implemented)
- [ ] Upscale factor slider works (2x to 8x)
- [ ] Frame interpolation toggle works
- [ ] H.264 output toggle works
- [ ] Cost estimator reflects upscale factor
- [ ] Processing time estimate displayed

## Files to Modify Summary

1. **`ai-constants.ts`** - Add ByteDance, FlashVSR, and Topaz upscaler models with `category: "upscale"`
2. **`ai-types.ts`** - Add upscaling-specific props for all three models
3. **`ai-video-client.ts`** - Add `upscaleByteDanceVideo()`, `upscaleFlashVSRVideo()`, and `upscaleTopazVideo()` functions
4. **`fal-ai-client.ts`** - Add `uploadVideoToFal()` helper
5. **`use-ai-generation.ts`** - Add upscale tab handlers for all three models
6. **`ai.tsx`** - Add upscale tab UI with model-specific controls

## API Examples

### ByteDance Video Upscaler

**JavaScript Client:**
```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe(
  "fal-ai/bytedance-upscaler/upscale/video",
  {
    input: {
      video_url: "https://example.com/video.mp4",
      target_resolution: "4k",
      target_fps: "60fps"
    },
    logs: true,
    onQueueUpdate: (update) => {
      console.log("Progress:", update.status);
    }
  }
);

console.log("Upscaled video URL:", result.video.url);
console.log("Duration (for billing):", result.duration, "seconds");
```

**cURL Example:**
```bash
curl -X POST https://fal.run/fal-ai/bytedance-upscaler/upscale/video \
  -H "Authorization: Key YOUR_FAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "video_url": "https://example.com/video.mp4",
    "target_resolution": "2k",
    "target_fps": "30fps"
  }'
```

---

### FlashVSR Video Upscaler

**JavaScript Client:**
```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe(
  "fal-ai/flashvsr/upscale/video",
  {
    input: {
      video_url: "https://example.com/video.mp4",
      upscale_factor: 4,
      acceleration: "high",
      quality: 80,
      color_fix: true,
      preserve_audio: true,
      output_format: "X264",
      output_quality: "high",
      output_write_mode: "balanced",
      seed: 42
    },
    logs: true,
    onQueueUpdate: (update) => {
      console.log("Progress:", update.status);
    }
  }
);

console.log("Upscaled video URL:", result.video.url);
console.log("Seed used:", result.seed);
console.log("File size:", result.video.file_size);
```

**cURL Example:**
```bash
curl -X POST https://fal.run/fal-ai/flashvsr/upscale/video \
  -H "Authorization: Key YOUR_FAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "video_url": "https://example.com/video.mp4",
    "upscale_factor": 3.5,
    "acceleration": "regular",
    "quality": 70,
    "color_fix": true,
    "preserve_audio": false,
    "output_format": "VP9",
    "output_quality": "maximum"
  }'
```

**ProRes Professional Example:**
```javascript
// For professional workflows requiring lossless quality
const result = await fal.subscribe(
  "fal-ai/flashvsr/upscale/video",
  {
    input: {
      video_url: "https://example.com/source.mp4",
      upscale_factor: 2.0,
      acceleration: "regular",  // Best quality
      quality: 100,             // Maximum tile blending
      color_fix: true,
      preserve_audio: true,
      output_format: "PRORES4444",  // Professional codec
      output_quality: "maximum",
      output_write_mode: "balanced"
    }
  }
);

// Result will be .mov file with ProRes 4444 codec
```

---

## Use Cases

### ByteDance Upscaler
- **Low-res to HD**: Upscale 480p/720p videos to 1080p
- **HD to 4K**: Convert Full HD content to 4K for modern displays
- **Frame Rate Enhancement**: Convert 30fps to 60fps for smoother playback
- **Archive Enhancement**: Improve quality of older video content
- **Social Media**: Prepare content for high-resolution platforms

### FlashVSR Upscaler
- **Speed-Critical Workflows**: Fastest upscaling when time is essential
- **Flexible Scaling**: Precise upscale factors (e.g., 2.3x, 3.7x) for exact target resolutions
- **Professional Outputs**: ProRes 4444 support for broadcast/film workflows
- **Web Optimization**: VP9/WebM output for modern web delivery
- **Animation/GIF Creation**: Built-in GIF output for social media
- **Audio Preservation**: Maintain original audio tracks during upscaling
- **Batch Processing**: Fast/full acceleration modes for large-scale jobs
- **Cost-Effective**: Megapixel-based pricing can be economical for shorter clips

### Topaz Video Upscale
- **Professional Enhancement**: 8x upscaling for professional workflows
- **Film Restoration**: Enhance vintage or degraded footage
- **Content Remastering**: Upgrade existing content libraries
- **Motion Smoothing**: Frame interpolation for cinematic feel

## Implementation Notes

1. **Video Upload Size**: ByteDance supports up to 500MB and 2 minutes. FlashVSR file size limits should be confirmed. Consider adding compression for larger files.

2. **Processing Time**: Upscaling is compute-intensive. Implement proper queue management and status polling. FlashVSR offers acceleration modes to optimize speed vs quality trade-offs.

3. **Cost Management**:
   - ByteDance: 4K/60fps can be expensive. Show clear cost estimates before processing.
   - FlashVSR: Megapixel-based pricing means longer videos cost more. Calculate costs based on: `(width × height × frames × upscale_factor²) × $0.0005 / 1,000,000`
   - Display real-time cost estimates as users adjust upscale factors.

4. **Format Support**:
   - ByteDance: MP4, MOV, AVI
   - FlashVSR: Standard video formats, with multiple output options (X264, VP9, ProRes, GIF)
   - Ensure input videos are in supported formats.

5. **Output Quality**:
   - ByteDance uses AI enhancement algorithms that work best on real-world footage (not synthetic/cartoon content).
   - FlashVSR offers granular quality control (0-100) and multiple acceleration modes for different use cases.

6. **Audio Handling**: FlashVSR's `preserve_audio` option requires FFmpeg processing. Make this clear in the UI and handle any audio encoding errors gracefully.

7. **Professional Workflows**: FlashVSR's ProRes 4444 output can produce very large files (suitable for professional editing but not web delivery). Warn users about file sizes when this format is selected.

8. **Acceleration Trade-offs**: Document that FlashVSR's acceleration modes impact quality:
   - `regular`: Best quality, standard speed
   - `high`: 30-40% faster, minimal quality loss
   - `full`: 50-60% faster, noticeable quality reduction

9. **Topaz Integration**: Topaz API endpoint needs to be confirmed/implemented.

## Related Documentation

### External APIs
- [FAL.ai ByteDance Video Upscaler API](https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video/api)
- [FAL.ai FlashVSR Video Upscaler API](https://fal.ai/models/fal-ai/flashvsr/upscale/video/api)
- [FAL.ai Storage Upload API](https://fal.ai/docs/storage/upload)

### Internal References
- [Image-to-Video Implementation Guide](./add-wan25-image-to-video.md)
- [QCut AI Constants](../../apps/web/src/components/editor/media-panel/views/ai-constants.ts)

## Document Status

- **Created**: 2025-11-11
- **Last Updated**: 2025-11-12
- **Implementation Status**: Completed – Upscale tab, handlers, and cost estimators merged
- **Document Type**: Implementation Guide
- **Models Covered**:
  1. ByteDance Video Upscaler (fal.ai) - Resolution-based upscaling with FPS options
  2. FlashVSR Video Upscaler (fal.ai) - Fastest upscaling with flexible scaling and format options
  3. Topaz Video Upscale - Professional upscaling up to 8x (API TBD)

## Model Comparison Summary

| Feature | ByteDance | FlashVSR | Topaz |
|---------|-----------|----------|-------|
| **Max Upscale** | 4K resolution | 4x factor | 8x factor |
| **Speed** | Standard | Fastest (3 modes) | Standard |
| **Pricing** | Per-second | Per-megapixel | Per-factor |
| **Output Formats** | MP4 | MP4, WebM, ProRes, GIF | MP4 |
| **FPS Control** | 30/60fps | Original (preserve) | Original/Interpolated |
| **Audio** | Included | Optional preserve | Included |
| **Quality Control** | Resolution tiers | 0-100 scale + acceleration | H.264 toggle |
| **Best For** | Fixed resolution targets | Flexible scaling, speed | Maximum quality |
| **Unique Features** | FPS doubling | ProRes output, GIF export | 8x upscaling |
