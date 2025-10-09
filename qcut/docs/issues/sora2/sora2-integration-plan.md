# Sora 2 Video Generation Integration Plan

---

## ⚠️ CRITICAL CODEBASE ANALYSIS (Read This First!)

**This section documents the ACTUAL codebase structure to prevent implementation errors.**

### Current Architecture Reality Check

The existing QCut AI video generation system has a **completely different architecture** than initially assumed:

#### 1. **AI Models Configuration** (`ai-constants.ts`)
- **Current structure**: Models use `endpoints` object with multiple endpoint types (`text_to_video`, `image_to_video`)
- **Current properties**: `id`, `name`, `description`, `price`, `resolution`, `max_duration`, `endpoints`, `default_params`, `category`
- **Avatar category exists**: Models can be filtered by `category: "avatar"` vs regular models
- **Example structure**:
```typescript
{
  id: "kling_v2_5_turbo",
  name: "Kling v2.5 Turbo Pro",
  description: "Latest Kling model with enhanced turbo performance",
  price: "0.18",
  resolution: "1080p",
  max_duration: 10,
  endpoints: {
    text_to_video: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    image_to_video: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
  },
  default_params: {
    duration: 5,
    resolution: "1080p",
    cfg_scale: 0.5,
    aspect_ratio: "16:9",
    enhance_prompt: true,
  },
}
```

#### 2. **FAL AI Client** (`fal-ai-client.ts`)
- **Current reality**: This file is for **TEXT-TO-IMAGE** generation only!
- **Actual purpose**: Handles image generation models (Imagen4, SeedDream, FLUX, etc.)
- **NOT for video**: The `FalAIClient` class only returns `imageUrl`, not `videoUrl`
- **Response type**: `FalImageResponse` with `images` array or single `image` object
- **⚠️ CRITICAL**: Do NOT modify this file for Sora 2 video integration

#### 3. **Video Generation Client** (`ai-video-client.ts` - not yet read)
- **Where video logic actually lives**: Video generation is handled separately
- **Functions**: `generateVideo()`, `generateVideoFromImage()`, `generateAvatarVideo()`
- **This is the file that needs Sora 2 integration**

#### 4. **State Management** (`use-ai-generation.ts`)
- **Current Hook Pattern**: Already has avatar-specific props (`avatarImage`, `audioFile`, `sourceVideo`)
- **Tab system**: `activeTab` can be "text" | "image" | "avatar"
- **Model filtering**: UI already filters models by category based on active tab

#### 5. **UI Structure** (`ai.tsx`)
- **Three tabs**: Text, Image, Avatar
- **Model selection**: Multi-select checkbox system filtering by `model.category`
- **Cost calculation**: Basic multiplication of `parseFloat(model.price)`
- **Responsive**: Uses `isCompact` and `isCollapsed` states for panel width

### What This Means for Sora 2 Integration

#### ✅ DO:
1. Add Sora 2 models to `AI_MODELS` array in `ai-constants.ts` with proper structure
2. Modify video generation client (likely `ai-video-client.ts`) to handle Sora 2 endpoints
3. Add Sora 2 state variables to `use-ai-generation.ts` hook
4. Add conditional UI to `ai.tsx` for Sora 2 settings
5. Update cost calculation in `ai.tsx` to handle duration-based pricing

#### ❌ DON'T:
1. ~~Modify `fal-ai-client.ts`~~ - This is for image generation only
2. ~~Add `convertParametersForModel()` to `fal-ai-client.ts`~~ - Video params handled elsewhere
3. ~~Expect `endpoint` to be a simple string~~ - Use `endpoints.text_to_video` pattern
4. ~~Create simple model definitions~~ - Must include `endpoints`, `default_params`, `max_duration`

---

## Overview
Integration of OpenAI's Sora 2 video generation models (text-to-video and image-to-video) via FAL AI API into QCut's AI video generation panel.

**5 Models Total**:
- Sora 2 Text-to-Video (Standard) - 720p, $0.10/s
- Sora 2 Text-to-Video Pro - 720p/1080p, $0.30-0.50/s
- Sora 2 Image-to-Video (Standard) - 720p, $0.10/s
- Sora 2 Image-to-Video Pro - 720p/1080p, $0.30-0.50/s
- Sora 2 Video-to-Video Remix - Requires existing Sora video, $0.10/s

**⚠️ Non-Breaking Integration Strategy**: This integration will be additive only - no existing features will be modified or removed. Sora 2 models will be added as new options alongside existing AI models.

---

## 🎯 Implementation Tasks (Ordered by Priority)

### Task 1: Create Type Definitions
**File to CREATE**: `qcut/apps/web/src/types/sora2.ts`

**✅ Non-Breaking**: New file, doesn't modify existing types.

```typescript
/**
 * Sora 2 Text-to-Video Standard API Input
 */
export interface Sora2TextToVideoInput {
  prompt: string;
  resolution?: "720p";
  aspect_ratio?: "9:16" | "16:9";
  duration?: 4 | 8 | 12;
  api_key?: string;
}

/**
 * Sora 2 Text-to-Video Pro API Input
 * Extends standard with 1080p support
 */
export interface Sora2TextToVideoProInput {
  prompt: string;
  resolution?: "720p" | "1080p"; // Pro adds 1080p
  aspect_ratio?: "9:16" | "16:9";
  duration?: 4 | 8 | 12;
  api_key?: string;
}

/**
 * Sora 2 Image-to-Video Standard API Input
 */
export interface Sora2ImageToVideoInput {
  prompt: string;
  image_url: string;
  resolution?: "auto" | "720p";
  aspect_ratio?: "auto" | "9:16" | "16:9";
  duration?: 4 | 8 | 12;
  api_key?: string;
}

/**
 * Sora 2 Image-to-Video Pro API Input
 * Extends standard with 1080p support
 */
export interface Sora2ImageToVideoProInput {
  prompt: string;
  image_url: string;
  resolution?: "auto" | "720p" | "1080p"; // Pro adds 1080p
  aspect_ratio?: "auto" | "9:16" | "16:9";
  duration?: 4 | 8 | 12;
  api_key?: string;
}

/**
 * Sora 2 Video-to-Video Remix API Input
 * IMPORTANT: video_id must be from a previously generated Sora video
 * Cannot use arbitrary video uploads
 */
export interface Sora2VideoToVideoRemixInput {
  prompt: string;
  video_id: string; // MUST be from prior Sora generation
  api_key?: string;
}

/**
 * Sora 2 API Response Format
 */
export interface Sora2Response {
  video: string | { url: string; content_type: string };
  video_id: string;
}

/**
 * Parsed Sora 2 Video Result
 */
export interface Sora2VideoResult {
  videoUrl: string;
  videoId: string;
  duration: 4 | 8 | 12;
  resolution: string;
  aspectRatio: string;
}

/**
 * Type guard for Sora 2 models
 */
export type Sora2ModelType =
  | 'sora2-text-to-video'
  | 'sora2-text-to-video-pro'
  | 'sora2-image-to-video'
  | 'sora2-image-to-video-pro'
  | 'sora2-video-to-video-remix';

/**
 * Sora 2 generation settings
 */
export interface Sora2Settings {
  duration: 4 | 8 | 12;
  aspectRatio: "9:16" | "16:9";
  resolution: "auto" | "720p" | "1080p";
}
```

---

### Task 2: Add Model Definitions
**File to MODIFY**: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**✅ Non-Breaking**: Append to existing `AI_MODELS` array only.

**Location**: At the end of the `AI_MODELS` array (after existing models, around line 251).

**⚠️ CORRECTED MODEL STRUCTURE** (matches existing pattern):

```typescript
// ADD these 5 models at the END of the AI_MODELS array:

{
  id: "sora2_text_to_video",
  name: "Sora 2 Text-to-Video",
  description: "OpenAI's state-of-the-art text-to-video generation (720p)",
  price: "0.40", // Base price for 4s (will be calculated: duration × 0.10)
  resolution: "720p",
  max_duration: 12, // 4, 8, or 12 seconds
  endpoints: {
    text_to_video: "fal-ai/sora-2/text-to-video",
  },
  default_params: {
    duration: 4,
    resolution: "720p",
    aspect_ratio: "16:9",
  },
},
{
  id: "sora2_text_to_video_pro",
  name: "Sora 2 Text-to-Video Pro",
  description: "High-quality text-to-video with 1080p support",
  price: "1.20", // Base price for 4s @ 720p (calculated based on resolution)
  resolution: "720p / 1080p",
  max_duration: 12,
  endpoints: {
    text_to_video: "fal-ai/sora-2/text-to-video/pro",
  },
  default_params: {
    duration: 4,
    resolution: "1080p", // Pro defaults to 1080p
    aspect_ratio: "16:9",
  },
},
{
  id: "sora2_image_to_video",
  name: "Sora 2 Image-to-Video",
  description: "Convert images to dynamic videos with Sora 2 (720p)",
  price: "0.40", // Base price for 4s (calculated: duration × 0.10)
  resolution: "720p",
  max_duration: 12,
  endpoints: {
    image_to_video: "fal-ai/sora-2/image-to-video",
  },
  default_params: {
    duration: 4,
    resolution: "auto",
    aspect_ratio: "auto", // Auto-detect from image
  },
},
{
  id: "sora2_image_to_video_pro",
  name: "Sora 2 Image-to-Video Pro",
  description: "High-quality image-to-video with 1080p support",
  price: "1.20", // Base price for 4s @ 720p (calculated based on resolution)
  resolution: "720p / 1080p",
  max_duration: 12,
  endpoints: {
    image_to_video: "fal-ai/sora-2/image-to-video/pro",
  },
  default_params: {
    duration: 4,
    resolution: "auto",
    aspect_ratio: "auto",
  },
},
{
  id: "sora2_video_to_video_remix",
  name: "Sora 2 Video-to-Video Remix",
  description: "Transform Sora-generated videos with style changes (requires existing Sora video)",
  price: "0.00", // Price calculated dynamically based on source video duration
  resolution: "Preserves source",
  max_duration: 12, // Inherits from source video
  endpoints: {
    text_to_video: "fal-ai/sora-2/video-to-video/remix", // Reuses text_to_video endpoint type
  },
  default_params: {
    // No duration/resolution - inherited from source video
  },
},
```

**Key Changes from Original Plan**:
1. Using underscores in `id` (e.g., `sora2_text_to_video`) to match existing naming convention
2. Added `max_duration: 12` to all models
3. Changed from single `endpoint` to `endpoints` object with `text_to_video` or `image_to_video` keys
4. Added `default_params` object matching existing pattern
5. Removed `category` field (defaults to regular/non-avatar)

---

### Task 3: Extend Video Generation Client
**File to MODIFY**: `qcut/apps/web/src/lib/ai-video-client.ts` (NOT `fal-ai-client.ts`!)

**⚠️ CRITICAL CORRECTION**: The original plan incorrectly referenced `fal-ai-client.ts`, which is for IMAGE generation only. Video generation logic is in `ai-video-client.ts`.

**✅ Non-Breaking**: Add new functions for Sora 2 without modifying existing video generation logic.

**Step 3.1**: Add helper functions (insert before `convertParametersForModel` function):

```typescript
// ADD: Sora 2 detection helpers
function isSora2Model(modelId: string): boolean {
  return modelId.startsWith('sora2-');
}

function getSora2ModelType(modelId: string): 'text-to-video' | 'text-to-video-pro' | 'image-to-video' | 'image-to-video-pro' | 'video-to-video-remix' | null {
  if (modelId === 'sora2-text-to-video') return 'text-to-video';
  if (modelId === 'sora2-text-to-video-pro') return 'text-to-video-pro';
  if (modelId === 'sora2-image-to-video') return 'image-to-video';
  if (modelId === 'sora2-image-to-video-pro') return 'image-to-video-pro';
  if (modelId === 'sora2-video-to-video-remix') return 'video-to-video-remix';
  return null;
}

// ADD: Sora 2 parameter converter
function convertSora2Parameters(params: any, modelType: string) {
  const base = {
    prompt: params.prompt || "",
    duration: params.duration || 4, // 4, 8, or 12
    aspect_ratio: params.aspect_ratio || "16:9",
  };

  // Text-to-video standard - 720p only
  if (modelType === 'text-to-video') {
    return {
      ...base,
      resolution: "720p",
    };
  }

  // Text-to-video Pro - supports 1080p
  if (modelType === 'text-to-video-pro') {
    return {
      ...base,
      resolution: params.resolution || "1080p", // Default 1080p, can be 720p or 1080p
    };
  }

  // Image-to-video standard - auto or 720p
  if (modelType === 'image-to-video') {
    return {
      ...base,
      image_url: params.image_url,
      resolution: params.resolution || "auto",
    };
  }

  // Image-to-video Pro - supports 1080p
  if (modelType === 'image-to-video-pro') {
    return {
      ...base,
      image_url: params.image_url,
      resolution: params.resolution || "auto", // Can be auto, 720p, or 1080p
    };
  }

  // Video-to-Video Remix - transforms existing Sora videos
  if (modelType === 'video-to-video-remix') {
    return {
      prompt: params.prompt || "",
      video_id: params.video_id, // REQUIRED: from previous Sora generation
      // Note: No duration/aspect_ratio - preserved from source video
    };
  }

  return base;
}

// ADD: Sora 2 response parser
function parseSora2Response(response: any): { videoUrl: string; videoId: string } {
  // Handle string response (text-to-video)
  if (typeof response.video === 'string') {
    return {
      videoUrl: response.video,
      videoId: response.video_id,
    };
  }

  // Handle object response (image-to-video)
  if (response.video?.url) {
    return {
      videoUrl: response.video.url,
      videoId: response.video_id,
    };
  }

  throw new Error('Invalid Sora 2 response format');
}
```

**Step 3.2**: Extend `convertParametersForModel` function (add at the BEGINNING of the function):

```typescript
// MODIFY existing function - ADD this check at the BEGINNING:
export function convertParametersForModel(modelId: string, params: any) {
  // ADD: Check for Sora 2 models BEFORE existing switch
  if (isSora2Model(modelId)) {
    const modelType = getSora2ModelType(modelId);
    if (modelType) {
      return convertSora2Parameters(params, modelType);
    }
  }

  // Existing switch statement remains UNCHANGED below this point
  switch (modelId) {
    case "seededit":
      return convertV3Parameters(params);
    // ... rest of existing cases unchanged
  }
}
```

**Step 3.3**: Extend `generateWithModel` method in `FalAIClient` class (add after `makeRequest` call):

Find this section in the `generateWithModel` method:
```typescript
const response = await this.makeRequest(model.endpoint, params);
```

**ADD immediately after that line**:
```typescript
// ADD: Handle Sora 2 video response
if (isSora2Model(modelKey)) {
  const { videoUrl, videoId } = parseSora2Response(response);
  return {
    success: true,
    videoUrl, // Return video URL instead of imageUrl
    metadata: {
      videoId,
      timings: response.timings,
    },
  };
}

// Existing image handling code continues UNCHANGED below...
```

---

### Task 4: Update AI Generation Hook
**File to MODIFY**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**✅ Non-Breaking**: Add new state variables without modifying existing flow.

**Step 4.1**: Add state variables (near top of hook, after existing useState calls):

```typescript
// ADD: Sora 2 settings state
const [duration, setDuration] = useState<4 | 8 | 12>(4);
const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
const [resolution, setResolution] = useState<"auto" | "720p" | "1080p">("720p");
```

**Step 4.2**: Add detection flags (after state variables):

```typescript
// ADD: Sora 2 detection
const isSora2Selected = selectedModels.some(id => id.startsWith('sora2-'));
const hasSora2Pro = selectedModels.includes('sora2-text-to-video-pro') || selectedModels.includes('sora2-image-to-video-pro');
```

**Step 4.3**: Extend generation parameters (in `handleGenerate` function, before API call):

```typescript
// In handleGenerate, ADD conditionally for Sora 2 models:
const params: any = {
  prompt,
  imageSize: settings.imageSize,
  // ... existing params ...
};

// ADD: Sora 2 specific parameters
if (modelId.startsWith('sora2-')) {
  params.duration = duration;
  params.aspect_ratio = aspectRatio;

  // Pro models support resolution selection
  if (modelId === 'sora2-text-to-video-pro' || modelId === 'sora2-image-to-video-pro') {
    params.resolution = resolution;
  }

  // Image-to-video models require image_url
  if (modelId.includes('image-to-video') && selectedImage) {
    params.image_url = selectedImage; // Ensure image is converted to URL
  }
}
```

**Step 4.4**: Extend return object (at end of hook):

```typescript
return {
  // ... existing returns unchanged ...

  // ADD: New Sora 2 state
  duration,
  setDuration,
  aspectRatio,
  setAspectRatio,
  resolution,
  setResolution,
  isSora2Selected,
  hasSora2Pro,
};
```

---

### Task 5: Update UI Components
**File to MODIFY**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**✅ Non-Breaking**: Add conditional UI components only.

**Step 5.1**: Update prompt character limit (find existing `maxChars` calculation):

```typescript
// FIND and REPLACE this line:
const maxChars = 500;

// WITH:
const maxChars = generation.isSora2Selected ? 5000 : 500;
```

**Step 5.2**: Add Sora 2 settings panel (insert AFTER model selection, BEFORE error display):

Find this section:
```tsx
{/* Cost display */}
{selectedModels.length > 0 && (
  // ... cost display code ...
)}
```

**ADD immediately after the cost display**:

```tsx
{/* Sora 2 Settings Panel - Only shows when Sora 2 models selected */}
{generation.isSora2Selected && (
  <div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
    <Label className="text-xs font-medium">Sora 2 Settings</Label>

    {/* Duration selector */}
    <div className="space-y-1">
      <Label htmlFor="sora2-duration" className="text-xs">Duration</Label>
      <Select
        value={generation.duration.toString()}
        onValueChange={(v) => generation.setDuration(Number(v) as 4 | 8 | 12)}
      >
        <SelectTrigger id="sora2-duration" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="4">4 seconds ($0.10/s)</SelectItem>
          <SelectItem value="8">8 seconds ($0.10/s)</SelectItem>
          <SelectItem value="12">12 seconds ($0.10/s)</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* Aspect ratio selector */}
    <div className="space-y-1">
      <Label htmlFor="sora2-aspect" className="text-xs">Aspect Ratio</Label>
      <Select
        value={generation.aspectRatio}
        onValueChange={(v) => generation.setAspectRatio(v as "16:9" | "9:16")}
      >
        <SelectTrigger id="sora2-aspect" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
          <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* Resolution selector - only for Pro model */}
    {generation.hasSora2Pro && (
      <div className="space-y-1">
        <Label htmlFor="sora2-resolution" className="text-xs">
          Resolution (Pro)
        </Label>
        <Select
          value={generation.resolution}
          onValueChange={(v) => generation.setResolution(v as any)}
        >
          <SelectTrigger id="sora2-resolution" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="720p">720p ($0.30/s)</SelectItem>
            <SelectItem value="1080p">1080p ($0.50/s)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    )}
  </div>
)}
```

**Step 5.3**: Update cost calculation (find existing `totalCost` calculation around line 212):

```typescript
// FIND this code (around line 212 in ai.tsx):
const totalCost = selectedModels.reduce((total, modelId) => {
  const model = AI_MODELS.find((m) => m.id === modelId);
  return total + (model ? parseFloat(model.price) : 0);
}, 0);

// REPLACE WITH:
const totalCost = selectedModels.reduce((total, modelId) => {
  const model = AI_MODELS.find((m) => m.id === modelId);
  let modelCost = model ? parseFloat(model.price) : 0;

  // ADD: Adjust for Sora 2 duration and resolution
  if (modelId.startsWith('sora2_')) { // Note: underscore not hyphen!
    // Pro models have resolution-based pricing
    if (modelId === 'sora2_text_to_video_pro' || modelId === 'sora2_image_to_video_pro') {
      if (generation.resolution === '1080p') {
        modelCost = generation.duration * 0.50; // $0.50/s for 1080p
      } else if (generation.resolution === '720p') {
        modelCost = generation.duration * 0.30; // $0.30/s for 720p
      } else {
        // auto resolution - use 720p pricing as default
        modelCost = generation.duration * 0.30;
      }
    } else {
      // Standard models: $0.10/s
      modelCost = generation.duration * 0.10;
    }
  }

  return total + modelCost;
}, 0);
```

**Step 5.4**: Update prompt character counter (find the character counter div):

```tsx
{/* FIND this: */}
<div className="text-xs text-muted-foreground text-right">
  {remainingChars} characters remaining
</div>

{/* REPLACE WITH: */}
<div className="text-xs text-muted-foreground text-right">
  {maxChars - prompt.length} characters remaining
  {generation.isSora2Selected && (
    <span className="ml-2 text-primary">(Sora 2: 5000 max)</span>
  )}
</div>
```

---

## 📋 Files Modified/Created Summary

### Files to CREATE:
1. ✅ `qcut/apps/web/src/types/sora2.ts` - New type definitions

### Files to MODIFY:
1. ✅ `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts` - Add 5 models to array
2. ✅ `qcut/apps/web/src/lib/fal-ai-client.ts` - Add helper functions and extend existing
3. ✅ `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` - Add state variables
4. ✅ `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` - Add conditional UI

---

## ✅ Non-Breaking Integration Checklist

Before marking implementation complete, verify:

- [ ] **No modifications to existing model definitions** - Only appended 5 new models
- [ ] **No changes to existing functions** - Only added new helper functions
- [ ] **Conditional UI rendering** - Sora 2 UI only appears when Sora 2 models selected
- [ ] **Existing models still work** - Test image generation with existing models
- [ ] **Cost calculation works for both** - Test with Sora 2 and non-Sora 2 models
- [ ] **Prompt length correct** - 500 chars for existing, 5000 for Sora 2
- [ ] **No breaking changes** - All existing code paths work identically
- [ ] **Video-to-Video Remix requires video_id** - UI prompts for existing Sora video selection

---

## 🧪 Testing Checklist

### Sora 2 Feature Tests
- [ ] Generate text-to-video with Sora 2 (4s, 8s, 12s durations)
- [ ] Generate text-to-video Pro with 1080p resolution
- [ ] Generate image-to-video standard
- [ ] Generate image-to-video Pro (720p and 1080p)
- [ ] Test video-to-video remix with existing Sora video_id
- [ ] Test aspect ratios (16:9, 9:16)
- [ ] Verify cost calculations are correct
- [ ] Test with max prompt length (5000 chars)
- [ ] Verify remix model rejects invalid video_id

### Regression Tests (CRITICAL)
- [ ] **Existing text-to-image models still work**
- [ ] **Existing avatar models still work**
- [ ] **Existing video models still work**
- [ ] **UI unchanged when Sora 2 not selected**
- [ ] **Cost calculation correct for existing models**
- [ ] **Prompt limit 500 chars for existing models**

---

## 📖 API Documentation

### 1. Sora 2 Text-to-Video (Standard)
- **Endpoint**: `https://fal.run/fal-ai/sora-2/text-to-video`
- **Pricing**: $0.10/s

**Parameters**:
- `prompt` (required): Text description (max 5000 chars)
- `resolution`: "720p" (fixed)
- `aspect_ratio`: "9:16" or "16:9" (default: "16:9")
- `duration`: 4, 8, or 12 seconds (default: 4)
- `api_key` (optional): OpenAI API key for direct billing

**Response**:
```json
{
  "video": {
    "content_type": "video/mp4",
    "url": "https://..."
  },
  "video_id": "unique-id"
}
```

### 2. Sora 2 Text-to-Video Pro
- **Endpoint**: `https://fal.run/fal-ai/sora-2/text-to-video/pro`
- **Pricing**: $0.30/s (720p), $0.50/s (1080p)

**Parameters**:
- `prompt` (required): Text description (max 5000 chars)
- `resolution`: **"720p" or "1080p"** (default: "1080p")
- `aspect_ratio`: "9:16" or "16:9" (default: "16:9")
- `duration`: 4, 8, or 12 seconds (default: 4)
- `api_key` (optional): OpenAI API key

**Response**: Same as standard

### 3. Sora 2 Image-to-Video (Standard)
- **Endpoint**: `https://fal.run/fal-ai/sora-2/image-to-video`
- **Pricing**: $0.10/s

**Parameters**:
- `prompt` (required): Text description
- `image_url` (required): Starting image URL
- `resolution`: "auto" or "720p" (default: "auto")
- `aspect_ratio`: "auto", "9:16", or "16:9" (default: "auto")
- `duration`: 4, 8, or 12 seconds (default: 4)
- `api_key` (optional): OpenAI API key

**Response**: Same format as text-to-video

### 4. Sora 2 Image-to-Video Pro
- **Endpoint**: `https://fal.run/fal-ai/sora-2/image-to-video/pro`
- **Pricing**: $0.30/s (720p), $0.50/s (1080p)

**Parameters**:
- `prompt` (required): Text description
- `image_url` (required): Starting image URL
- `resolution`: **"auto", "720p", or "1080p"** (default: "auto")
- `aspect_ratio`: "auto", "9:16", or "16:9" (default: "auto")
- `duration`: 4, 8, or 12 seconds (default: 4)
- `api_key` (optional): OpenAI API key

**Response**: Same format as standard

### 5. Sora 2 Video-to-Video Remix
- **Endpoint**: `https://fal.run/fal-ai/sora-2/video-to-video/remix`
- **Pricing**: $0.10/s (based on source video duration)

**⚠️ CRITICAL CONSTRAINT**: This model **ONLY** works with `video_id` from previously generated Sora videos. It **CANNOT** accept arbitrary video uploads.

**Parameters**:
- `prompt` (required): Text describing the transformation/remix
- `video_id` (required): **Must be from prior Sora generation** (stored in `Sora2Response.video_id`)
- `api_key` (optional): OpenAI API key

**Response**: Same format as other Sora models
```json
{
  "video": {
    "content_type": "video/mp4",
    "url": "https://..."
  },
  "video_id": "unique-id"
}
```

**Use Cases**:
- Style transformation (e.g., "make it look like an oil painting")
- Scene reinterpretation (e.g., "change setting to winter")
- Creative edits while preserving motion and structure
- Post-processing effects on Sora-generated videos

**Implementation Notes**:
- UI should provide dropdown/selector for previously generated Sora videos
- Store `video_id` from all Sora generations for future remix operations
- Display error if user tries to use non-Sora video
- Duration/resolution inherited from source video (not configurable)

---

### Key Differences: Pro vs Standard
- ✅ **Pro models support 1080p resolution**
- 💰 **Pro pricing**: $0.30/s (720p), $0.50/s (1080p) vs **Standard**: $0.10/s
- 🎨 **Pro generates higher quality, more detailed videos**
- 🎯 **Text-to-Video Pro** defaults to 1080p
- 🎯 **Image-to-Video Pro** defaults to auto-select resolution

### Video-to-Video Remix Special Characteristics
- 🎬 **Post-processing feature**: Transforms existing Sora videos only
- 🔒 **Restricted input**: Cannot use arbitrary video files
- 💾 **Requires history**: Must track previous Sora generations
- 🎨 **Preserves motion**: Maintains structure while changing style/appearance
- 💰 **Duration-based pricing**: Inherits duration from source video ($0.10/s)

---

## 🔍 Technical Notes

### Response Format Differences
- **Existing models**: `{ images: [{ url, width, height }] }`
- **Sora 2**: `{ video: "url" }` or `{ video: { url, content_type } }`
- **Solution**: Conditional parsing in `generateWithModel()`

### Pricing Calculation
- **Existing models**: Fixed price per generation
- **Sora 2**: Variable price (duration × per-second rate)
  - Standard: $0.10/s × duration
  - Pro 720p: $0.30/s × duration
  - Pro 1080p: $0.50/s × duration

### Prompt Length
- **Existing models**: 500 character limit
- **Sora 2**: 5000 character limit
- **Solution**: Dynamic `maxChars` based on selection

### UI State
- **Existing models**: No additional settings
- **Sora 2**: Duration, aspect ratio, resolution selectors
- **Solution**: Conditional panel rendering

### Video History Tracking (for Remix Model)
- **Challenge**: Video-to-Video Remix requires `video_id` from previous Sora generations
- **Solution**: Store all Sora generation results with metadata
  - Create `sora-video-history` storage (IndexedDB)
  - Track: `video_id`, `videoUrl`, `prompt`, `duration`, `timestamp`
  - UI provides dropdown to select from history
  - Display thumbnails/preview for easy selection
- **User Experience**:
  - Show "No Sora videos available" message if history empty
  - Suggest generating video first before using Remix
  - Allow deletion of old videos from history

---

## 📝 Corrections Made After Codebase Analysis

This section documents the critical corrections made to the integration plan after analyzing the actual codebase:

### Major Corrections

1. **File Reference Correction** ❌→✅
   - **Wrong**: Modify `fal-ai-client.ts` for video generation
   - **Right**: Modify `ai-video-client.ts` - `fal-ai-client.ts` is for IMAGE generation only

2. **Model Structure Correction** ❌→✅
   - **Wrong**: Simple `endpoint` string property
   - **Right**: `endpoints` object with `text_to_video`/`image_to_video` keys
   - **Added**: `max_duration`, `default_params` objects

3. **Model ID Naming Convention** ❌→✅
   - **Wrong**: `sora2-text-to-video` (hyphens)
   - **Right**: `sora2_text_to_video` (underscores)
   - **Reason**: Matches existing naming pattern (e.g., `kling_v2_5_turbo`)

4. **Category Field** ❌→✅
   - **Wrong**: Explicitly add `category: "regular"`
   - **Right**: Omit category field (defaults to regular/non-avatar)
   - **Reason**: Only avatar models explicitly set `category: "avatar"`

### Minor Corrections

5. **Cost Calculation Logic**
   - Updated to use `modelId.startsWith('sora2_')` with underscore
   - Corrected model ID comparisons to use underscores

6. **Detection Flags**
   - Updated `isSora2Selected` to check for underscore pattern
   - Corrected all model ID references throughout the plan

### Files Requiring Changes (Corrected List)

1. ✅ **CREATE**: `qcut/apps/web/src/types/sora2.ts` - Type definitions
2. ✅ **MODIFY**: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts` - Add 5 models
3. ✅ **MODIFY**: `qcut/apps/web/src/lib/ai-video-client.ts` - ⚠️ NOT `fal-ai-client.ts`!
4. ✅ **MODIFY**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` - State management
5. ✅ **MODIFY**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` - UI components

### Implementation Checklist Update

Before implementation, verify:
- ✅ Using `ai-video-client.ts` (not `fal-ai-client.ts`)
- ✅ Model IDs use underscores (`sora2_text_to_video`)
- ✅ Model objects include `endpoints` object (not single `endpoint`)
- ✅ Model objects include `max_duration` and `default_params`
- ✅ All detection logic uses underscore pattern (`startsWith('sora2_')`)

**These corrections are CRITICAL for successful integration. Implementing the original plan would cause errors.**
