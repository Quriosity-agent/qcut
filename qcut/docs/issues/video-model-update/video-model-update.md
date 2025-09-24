# Video Model Update Documentation

This document tracks video model updates for QCut's AI video generation system.

## New Model URLs to Integrate

- https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/text-to-video/api
- https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video
- https://fal.ai/models/fal-ai/wan-25-preview/text-to-video/api
- https://fal.ai/models/fal-ai/wan-25-preview/image-to-video

## Current Video Generation Implementation

### AI Video Client API (`ai-video-client.ts`)

```typescript
// Model Endpoints Configuration
const modelEndpoints: { [key: string]: string } = {
  "seedance": "fal-ai/bytedance/seedance/v1/lite/text-to-video",
  "seedance_pro": "fal-ai/bytedance/seedance/v1/pro/text-to-video",
  "veo3": "fal-ai/google/veo3",
  "veo3_fast": "fal-ai/google/veo3/fast",
  "hailuo": "fal-ai/minimax/hailuo-02/standard/text-to-video",
  "hailuo_pro": "fal-ai/minimax/hailuo-02/pro/text-to-video",
  "kling_v2": "fal-ai/kling-video/v2.1/master",
  "wan_turbo": "fal-ai/wan/v2.2-a14b/text-to-video/turbo",
};

// Core Generation Function
export async function generateVideo(
  request: VideoGenerationRequest,
  onProgress?: ProgressCallback,
  downloadOptions?: {
    downloadToMemory?: boolean;
    onDataReceived?: (data: Uint8Array) => void;
    onComplete?: (totalData: Uint8Array) => void;
  }
): Promise<VideoGenerationResponse>
```

### Model Configuration (`ai-constants.ts`)

```typescript
export const AI_MODELS: AIModel[] = [
  {
    id: "kling_v2",
    name: "Kling v2.1",
    description: "Premium model with unparalleled motion fluidity",
    price: "0.15",
    resolution: "1080p",
  },
  {
    id: "wan_turbo",
    name: "WAN v2.2 Turbo",
    description: "High-speed photorealistic video generation",
    price: "0.10",
    resolution: "720p",
  },
  // ... other models
];
```

## Integration Plan for New Models

### 1. Add New Model Endpoints

Update `modelEndpoints` in `ai-video-client.ts`:

```typescript
const modelEndpoints: { [key: string]: string } = {
  // Existing models...
  "kling_v2_5_turbo": "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
  "kling_v2_5_turbo_image": "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  "wan_25_preview": "fal-ai/wan-25-preview/text-to-video",
  "wan_25_preview_image": "fal-ai/wan-25-preview/image-to-video",
};
```

### 2. Update Model Configuration

Add to `AI_MODELS` array in `ai-constants.ts`:

```typescript
{
  id: "kling_v2_5_turbo",
  name: "Kling v2.5 Turbo Pro",
  description: "Latest Kling model with enhanced turbo performance",
  price: "0.18", // Estimate - verify actual pricing
  resolution: "1080p",
},
{
  id: "wan_25_preview",
  name: "WAN v2.5 Preview",
  description: "Next-generation WAN model with improved quality",
  price: "0.12", // Estimate - verify actual pricing
  resolution: "1080p",
}
```

### 3. Model-Specific Parameter Handling

Update parameter handling in `generateVideo()` function:

```typescript
// Model-specific parameter requirements
if (request.model === "kling_v2_5_turbo") {
  payload = {
    prompt: request.prompt,
    duration: request.duration || 5,
    resolution: request.resolution || "1080p",
    cfg_scale: 0.5,
    // Add any v2.5 turbo specific parameters
  };
} else if (request.model === "wan_25_preview") {
  payload = {
    prompt: request.prompt,
    duration: request.duration || 5,
    resolution: request.resolution || "1080p",
    // Add any WAN 2.5 specific parameters
  };
}
```

### 4. Image-to-Video Support

Update `generateVideoFromImage()` function:

```typescript
if (request.model === "kling_v2_5_turbo") {
  endpoint = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
  payload = {
    prompt: request.prompt || "Create a cinematic video from this image",
    image_url: imageUrl,
    duration: request.duration || 5,
    cfg_scale: 0.5,
  };
} else if (request.model === "wan_25_preview") {
  endpoint = "fal-ai/wan-25-preview/image-to-video";
  payload = {
    prompt: request.prompt || "Create a cinematic video from this image",
    image_url: imageUrl,
    duration: request.duration || 5,
    resolution: request.resolution || "1080p",
  };
}
```

## File Locations to Update

1. **`apps/web/src/lib/ai-video-client.ts`**
   - Add new model endpoints
   - Update parameter handling
   - Update image-to-video generation

2. **`apps/web/src/components/editor/media-panel/views/ai-constants.ts`**
   - Add new model configurations
   - Update pricing information
   - Add model-specific constants

3. **`apps/web/src/services/ai/fal-ai-service.ts`** (if needed)
   - May need updates for consistency

## Testing Requirements

- Test text-to-video generation with new models
- Test image-to-video generation with new models
- Verify pricing and parameter handling
- Test error handling and edge cases
- Validate progress tracking and status updates

## API Key Configuration

The system uses `VITE_FAL_API_KEY` environment variable for authentication:

```typescript
const FAL_API_KEY = import.meta.env.VITE_FAL_API_KEY;
const FAL_API_BASE = "https://fal.run";
```

## Error Handling

Current implementation includes comprehensive error handling:

```typescript
function handleQueueError(response: Response, errorData: any, endpoint: string): string {
  // Handle specific FAL.ai error patterns
  if (response.status === 422) {
    return `Invalid request parameters: ${JSON.stringify(errorData)}`;
  } else if (response.status === 401) {
    return "Invalid FAL API key. Please check your VITE_FAL_API_KEY environment variable.";
  } else if (response.status === 429) {
    return "Rate limit exceeded. Please wait a moment before trying again.";
  }
  // ... more error handling
}
```

## Progress Tracking

The system supports real-time progress updates:

```typescript
export type ProgressCallback = (status: {
  status: "queued" | "processing" | "completed" | "failed";
  progress?: number;
  message?: string;
  elapsedTime?: number;
  estimatedTime?: number;
  logs?: string[];
}) => void;
```

## Implementation Steps

1. **Research new model specifications** - Check API docs for exact parameters
2. **Update model endpoints** - Add new endpoint configurations
3. **Add model definitions** - Update AI_MODELS array with new models
4. **Implement parameter handling** - Add model-specific parameter logic
5. **Update image-to-video support** - Add new image-to-video endpoints
6. **Test thoroughly** - Verify all functionality works correctly
7. **Update documentation** - Update any relevant user-facing docs