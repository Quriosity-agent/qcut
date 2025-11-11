# Adding Video Upscaling Models to QCut

## Overview
This document describes how to add video upscaling models to QCut's AI video enhancement panel. Video upscaling uses AI to increase video resolution and enhance quality, supporting upscaling from standard definition to 1080p, 2K, or 4K.

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

### 2. Topaz Video Upscale

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
- **Target FPS Control**: Optional frame interpolation
- **H.264 Output Toggle**: Compatibility vs file size trade-off
- **Cost Estimator**: Real-time display ($0.50 shown)
- **Processing Time Estimate**: 30-60 seconds preview

---

## Implementation Plan

### Step 1: Add Video Upscale Category to Constants

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Action**: Add a new category for video upscaling models

```typescript
// ByteDance Video Upscaler
{
  id: "bytedance_video_upscaler",
  name: "ByteDance Video Upscaler",
  description: "AI-powered video upscaling to 1080p, 2K, or 4K with optional 60fps",
  price: "0.072", // Base price per 10s @ 1080p
  perSecondPricing: {
    "1080p_30fps": 0.0072,
    "2k_30fps": 0.0144,
    "4k_30fps": 0.0288,
    "1080p_60fps": 0.0144,
    "2k_60fps": 0.0288,
    "4k_60fps": 0.0576
  },
  resolution: "1080p / 2K / 4K",
  supportedResolutions: ["1080p", "2k", "4k"],
  supportedFPS: ["30fps", "60fps"],
  max_duration: 120, // 2 minutes max
  category: "upscale", // New category for video enhancement
  endpoints: {
    upscale_video: "fal-ai/bytedance-upscaler/upscale/video",
  },
  default_params: {
    target_resolution: "1080p",
    target_fps: "30fps",
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

**Action**: Add upscaling-specific types

```typescript
// ByteDance Upscaler options
bytedanceTargetResolution?: "1080p" | "2k" | "4k";
bytedanceTargetFPS?: "30fps" | "60fps";

// Topaz Upscaler options
topazUpscaleFactor?: number; // 2.0 to 8.0
topazTargetFPS?: "original" | "interpolated";
topazH264Output?: boolean;

// Shared upscaling options
sourceVideoFile?: File | null;
sourceVideoUrl?: string;
```

### Step 3: Add API Client Function

**File**: `qcut/apps/web/src/lib/ai-video-client.ts`

**Action**: Implement ByteDance upscaler function

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
 *
 * @param request - Video URL and upscaling parameters
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

    const targetResolution = request.target_resolution ?? "1080p";
    const targetFPS = request.target_fps ?? "30fps";

    const payload = {
      video_url: request.video_url,
      target_resolution: targetResolution,
      target_fps: targetFPS,
    };

    const jobId = `bytedance-upscale-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const response = await fetch(
      `${FAL_API_BASE}/fal-ai/bytedance-upscaler/upscale/video`,
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

**Action**: Add video upload function (if not already present)

```typescript
/**
 * Upload video file to FAL storage
 */
export async function uploadVideoToFal(file: File): Promise<string> {
  try {
    const falApiKey = getFalApiKey();
    if (!falApiKey) {
      throw new Error("FAL API key not configured");
    }

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("https://fal.run/storage/upload", {
      method: "POST",
      headers: {
        Authorization: `Key ${falApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload video: ${response.statusText}`);
    }

    const result = await response.json();
    return result.url;
  } catch (error) {
    console.error("Error uploading video to FAL:", error);
    throw error;
  }
}
```

### Step 5: Add Generation Handler

**File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**Action**: Add handler for video upscaling

```typescript
// Add new tab handler for upscale category
else if (activeTab === "upscale") {
  // ByteDance Video Upscaler
  if (modelId === "bytedance_video_upscaler") {
    if (!sourceVideoFile && !sourceVideoUrl) {
      console.log("  ⚠️ Skipping model - Video source required");
      continue;
    }

    const videoUrl = sourceVideoFile
      ? await uploadVideoToFal(sourceVideoFile)
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

  // Topaz Video Upscaler
  else if (modelId === "topaz_video_upscale") {
    // TODO: Implement when Topaz API is available
    throw new Error("Topaz Video Upscale not yet implemented");
  }
}
```

### Step 6: Add UI Controls

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Action**: Add upscale tab with UI controls

```typescript
// Add new "Upscale" tab to the tab navigation
<Tab value="upscale">Video Upscale</Tab>

// Add tab panel for upscale models
<TabPanel value="upscale">
  {/* Video Upload Section */}
  <div className="video-upload-section">
    <h3>Upload Video for Upscaling</h3>
    <FileUpload
      accept="video/mp4,video/mov,video/avi"
      maxSize={500 * 1024 * 1024} // 500MB
      onFileSelect={setSourceVideoFile}
    />
    <p className="help-text">
      Or provide video URL:
    </p>
    <Input
      value={sourceVideoUrl}
      onChange={(e) => setSourceVideoUrl(e.target.value)}
      placeholder="https://example.com/video.mp4"
    />
  </div>

  {/* ByteDance Upscaler Settings */}
  {selectedModelId === "bytedance_video_upscaler" && (
    <Card className="model-settings">
      <h4>ByteDance Upscaler Settings</h4>

      {/* Target Resolution */}
      <div className="control-group">
        <Label>Target Resolution</Label>
        <Select
          value={bytedanceTargetResolution}
          onChange={setBytedanceTargetResolution}
        >
          <option value="1080p">1080p (Full HD)</option>
          <option value="2k">2K (2560×1440)</option>
          <option value="4k">4K (3840×2160)</option>
        </Select>
      </div>

      {/* Target FPS */}
      <div className="control-group">
        <Label>Target Frame Rate</Label>
        <Select
          value={bytedanceTargetFPS}
          onChange={setBytedanceTargetFPS}
        >
          <option value="30fps">30 FPS</option>
          <option value="60fps">60 FPS (2x cost)</option>
        </Select>
      </div>

      {/* Cost Estimator */}
      <div className="cost-estimate">
        <Label>Estimated Cost (per 10 seconds):</Label>
        <span className="cost-value">
          {calculateByteDanceUpscaleCost(
            bytedanceTargetResolution,
            bytedanceTargetFPS,
            10 // 10 seconds example
          )}
        </span>
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
</TabPanel>
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
 * Calculate Topaz upscale cost based on upscale factor
 */
function calculateTopazUpscaleCost(factor: number): string {
  const baseCost = 0.50; // $0.50 for 2x
  const cost = baseCost * (factor / 2.0);
  return `$${cost.toFixed(2)}`;
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

### Topaz Video Upscaler
- [ ] Model appears in upscale tab UI (when implemented)
- [ ] Upscale factor slider works (2x to 8x)
- [ ] Frame interpolation toggle works
- [ ] H.264 output toggle works
- [ ] Cost estimator reflects upscale factor
- [ ] Processing time estimate displayed

## Files to Modify Summary

1. **`ai-constants.ts`** - Add ByteDance and Topaz upscaler models with `category: "upscale"`
2. **`ai-types.ts`** - Add upscaling-specific props
3. **`ai-video-client.ts`** - Add `upscaleByteDanceVideo()` and `upscaleTopazVideo()` functions
4. **`fal-ai-client.ts`** - Add `uploadVideoToFal()` helper
5. **`use-ai-generation.ts`** - Add upscale tab handler
6. **`ai.tsx`** - Add upscale tab UI with controls

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

## Use Cases

### ByteDance Upscaler
- **Low-res to HD**: Upscale 480p/720p videos to 1080p
- **HD to 4K**: Convert Full HD content to 4K for modern displays
- **Frame Rate Enhancement**: Convert 30fps to 60fps for smoother playback
- **Archive Enhancement**: Improve quality of older video content
- **Social Media**: Prepare content for high-resolution platforms

### Topaz Video Upscale
- **Professional Enhancement**: 8x upscaling for professional workflows
- **Film Restoration**: Enhance vintage or degraded footage
- **Content Remastering**: Upgrade existing content libraries
- **Motion Smoothing**: Frame interpolation for cinematic feel

## Implementation Notes

1. **Video Upload Size**: ByteDance supports up to 500MB and 2 minutes. Consider adding compression for larger files.

2. **Processing Time**: Upscaling is compute-intensive. Implement proper queue management and status polling.

3. **Cost Management**: 4K/60fps can be expensive. Show clear cost estimates before processing.

4. **Format Support**: Ensure input videos are in supported formats (MP4, MOV, AVI).

5. **Output Quality**: ByteDance uses AI enhancement algorithms that work best on real-world footage (not synthetic/cartoon content).

6. **Topaz Integration**: Topaz API endpoint needs to be confirmed/implemented.

## Related Documentation

### External APIs
- [FAL.ai ByteDance Video Upscaler API](https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video/api)
- [FAL.ai Storage Upload API](https://fal.ai/docs/storage/upload)

### Internal References
- [Image-to-Video Implementation Guide](./add-wan25-image-to-video.md)
- [QCut AI Constants](../../apps/web/src/components/editor/media-panel/views/ai-constants.ts)

## Document Status

- **Created**: 2025-11-11
- **Implementation Status**: Pending
- **Document Type**: Implementation Guide
- **Models Covered**: ByteDance Video Upscaler (fal.ai), Topaz Video Upscale
