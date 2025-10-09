# Sora 2 Video Generation Integration Plan

## Overview
Integration of OpenAI's Sora 2 video generation models (text-to-video and image-to-video) via FAL AI API into QCut's AI video generation panel.

**⚠️ Non-Breaking Integration Strategy**: This integration will be additive only - no existing features will be modified or removed. Sora 2 models will be added as new options alongside existing AI models.

## API Documentation

### Sora 2 Text-to-Video
- **Endpoint**: `https://fal.run/fal-ai/sora-2/text-to-video`
- **Method**: POST
- **Pricing**: $0.1 per second (without OpenAI API key)

#### Parameters
- `prompt` (required, string): Text description (max 5000 characters)
- `resolution` (optional, default "720p"): Video resolution
- `aspect_ratio` (optional, default "16:9"): Options - "9:16", "16:9"
- `duration` (optional, default 4): Options - 4, 8, or 12 seconds
- `api_key` (optional): OpenAI API key for direct billing

#### Response
```json
{
  "video": "https://...",
  "video_id": "unique-id"
}
```

### Sora 2 Image-to-Video (Standard)
- **Endpoint**: `https://fal.run/fal-ai/sora-2/image-to-video`
- **Method**: POST
- **Pricing**: $0.1 per second

#### Parameters
- `prompt` (required, string): Text description (max 5000 characters)
- `image_url` (required, string): URL of the starting image
- `resolution` (optional, default "auto"): Options - "auto", "720p"
- `aspect_ratio` (optional, default "auto"): Options - "auto", "9:16", "16:9"
- `duration` (optional, default 4): Options - 4, 8, or 12 seconds
- `api_key` (optional): OpenAI API key

#### Response
```json
{
  "video": {
    "url": "https://...",
    "content_type": "video/mp4"
  },
  "video_id": "unique-id"
}
```

### Sora 2 Image-to-Video Pro
- **Endpoint**: `https://fal.run/fal-ai/sora-2/image-to-video/pro`
- **Method**: POST
- **Pricing**: $0.30/s for 720p, $0.50/s for 1080p

#### Parameters
- `prompt` (required, string): Text description (max 5000 characters)
- `image_url` (required, string): URL of the starting image
- `resolution` (optional, default "auto"): Options - **"auto", "720p", "1080p"** (⭐ 1080p only in Pro)
- `aspect_ratio` (optional, default "auto"): Options - "auto", "9:16", "16:9"
- `duration` (optional, default 4): Options - 4, 8, or 12 seconds
- `api_key` (optional): OpenAI API key

#### Response
```json
{
  "video": {
    "url": "https://...",
    "content_type": "video/mp4"
  },
  "video_id": "unique-id"
}
```

**Key Differences Pro vs Standard:**
- ✅ Pro supports 1080p resolution (Standard max is 720p)
- 💰 Pro pricing: $0.30-0.50/s vs Standard: $0.10/s
- 🎨 Pro generates higher quality, more detailed videos

## Integration Subtasks

### 1. Add Sora 2 Model Definitions
**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**✅ Non-Breaking**: Append new models to existing `AI_MODELS` array without modifying existing entries.

- [ ] Add Sora 2 text-to-video model to `AI_MODELS` array
  - Model ID: `sora2-text-to-video`
  - Name: "Sora 2 Text-to-Video"
  - Category: Regular (not avatar)
  - Price: Calculate based on duration (e.g., 4s = $0.40, 8s = $0.80, 12s = $1.20)
  - Resolution: "720p"
  - Description: "OpenAI's state-of-the-art text-to-video model"
  - Endpoint: `https://fal.run/fal-ai/sora-2/text-to-video`

- [ ] Add Sora 2 image-to-video (standard) model to `AI_MODELS` array
  - Model ID: `sora2-image-to-video`
  - Name: "Sora 2 Image-to-Video"
  - Category: Regular (not avatar)
  - Price: Calculate based on duration (4s = $0.40, 8s = $0.80, 12s = $1.20)
  - Resolution: "720p"
  - Description: "Convert images to dynamic videos with Sora 2"
  - Endpoint: `https://fal.run/fal-ai/sora-2/image-to-video`

- [ ] Add Sora 2 image-to-video Pro model to `AI_MODELS` array
  - Model ID: `sora2-image-to-video-pro`
  - Name: "Sora 2 Image-to-Video Pro"
  - Category: Regular (not avatar)
  - Price: Calculate based on duration and resolution:
    - 720p: 4s = $1.20, 8s = $2.40, 12s = $3.60
    - 1080p: 4s = $2.00, 8s = $4.00, 12s = $6.00
  - Resolution: "720p / 1080p"
  - Description: "High-quality image-to-video with 1080p support"
  - Endpoint: `https://fal.run/fal-ai/sora-2/image-to-video/pro`

### 2. Extend FAL AI Client
**File**: `qcut/apps/web/src/lib/fal-ai-client.ts`

**✅ Non-Breaking**: Add new functions without modifying existing `makeRequest()`, `generateWithModel()`, or `convertParametersForModel()` logic.

- [ ] Add new Sora 2 detection helper function (additive)
  ```typescript
  function isSora2Model(modelId: string): boolean {
    return modelId.startsWith('sora2-');
  }

  function getSora2ModelType(modelId: string): 'text-to-video' | 'image-to-video' | 'image-to-video-pro' | null {
    if (modelId === 'sora2-text-to-video') return 'text-to-video';
    if (modelId === 'sora2-image-to-video') return 'image-to-video';
    if (modelId === 'sora2-image-to-video-pro') return 'image-to-video-pro';
    return null;
  }
  ```

- [ ] Add Sora 2 parameter conversion function (new, doesn't modify existing converters)
  ```typescript
  function convertSora2Parameters(params: any, modelType: string) {
    const base = {
      prompt: params.prompt || "",
      duration: params.duration || 4, // 4, 8, or 12
      aspect_ratio: params.aspect_ratio || "16:9",
    };

    // Text-to-video only has basic resolution
    if (modelType === 'text-to-video') {
      return {
        ...base,
        resolution: "720p",
      };
    }

    // Image-to-video models require image_url
    if (modelType === 'image-to-video') {
      return {
        ...base,
        image_url: params.image_url,
        resolution: params.resolution || "auto",
      };
    }

    // Pro model supports 1080p
    if (modelType === 'image-to-video-pro') {
      return {
        ...base,
        image_url: params.image_url,
        resolution: params.resolution || "720p", // Can be auto, 720p, or 1080p
      };
    }

    return base;
  }
  ```

- [ ] Extend existing `convertParametersForModel()` function (add new case, don't modify existing)
  ```typescript
  // In existing convertParametersForModel() function, ADD this case:
  export function convertParametersForModel(modelId: string, params: any) {
    // Add before the default case
    if (isSora2Model(modelId)) {
      const modelType = getSora2ModelType(modelId);
      if (modelType) {
        return convertSora2Parameters(params, modelType);
      }
    }

    // Existing switch statement remains unchanged
    switch (modelId) {
      case "seededit":
        return convertV3Parameters(params);
      // ... rest of existing cases unchanged
    }
  }
  ```

- [ ] Add Sora 2 response parser (new helper function)
  ```typescript
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

- [ ] Update `generateWithModel()` to handle video responses (extend existing, don't replace)
  ```typescript
  // In existing generateWithModel(), add Sora 2 handling:
  async generateWithModel(modelKey: string, prompt: string, settings: GenerationSettings) {
    // ... existing code ...

    const response = await this.makeRequest(model.endpoint, params);

    // ADD: Check if this is a Sora 2 model
    if (isSora2Model(modelKey)) {
      const { videoUrl, videoId } = parseSora2Response(response);
      return {
        success: true,
        videoUrl, // NEW: return video URL instead of imageUrl
        metadata: {
          videoId,
          // ... other metadata
        },
      };
    }

    // Existing image handling code remains unchanged
    let image: { url: string; width: number; height: number };
    // ... existing code continues ...
  }
  ```

### 3. Update AI Generation Hook
**File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

**✅ Non-Breaking**: Add new state variables and logic paths without modifying existing generation flow for other models.

- [ ] Add new state variables for Sora 2 settings (doesn't affect existing state)
  ```typescript
  const [duration, setDuration] = useState<4 | 8 | 12>(4);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [resolution, setResolution] = useState<"auto" | "720p" | "1080p">("720p");
  ```

- [ ] Add Sora 2 model detection (new helper, doesn't modify existing logic)
  ```typescript
  const isSora2Selected = selectedModels.some(id => id.startsWith('sora2-'));
  const hasSora2Pro = selectedModels.includes('sora2-image-to-video-pro');
  ```

- [ ] Extend generation parameters conditionally (add to existing params object)
  ```typescript
  // In handleGenerate(), ADD these parameters conditionally:
  if (isSora2Model(modelId)) {
    params.duration = duration;
    params.aspect_ratio = aspectRatio;
    if (modelId === 'sora2-image-to-video-pro') {
      params.resolution = resolution;
    }
  }
  // Existing parameter logic remains unchanged for other models
  ```

- [ ] Return new state variables and setters (extend existing return object)
  ```typescript
  return {
    // ... existing returns unchanged ...
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

### 4. Update UI Components
**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**✅ Non-Breaking**: Add new UI components conditionally - only show when Sora 2 models are selected. Existing UI remains unchanged for other models.

- [ ] Add Sora 2 settings panel (conditionally rendered, doesn't affect existing UI)
  ```tsx
  {/* ADD: Only render when Sora 2 models are selected */}
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
            <SelectItem value="4">4 seconds</SelectItem>
            <SelectItem value="8">8 seconds</SelectItem>
            <SelectItem value="12">12 seconds</SelectItem>
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

- [ ] Update cost calculation to include Sora 2 pricing (extend existing calculation)
  ```typescript
  // In existing totalCost calculation, ADD Sora 2 logic:
  const totalCost = selectedModels.reduce((total, modelId) => {
    const model = AI_MODELS.find((m) => m.id === modelId);
    let modelCost = model ? parseFloat(model.price) : 0;

    // ADD: Adjust for Sora 2 duration and resolution
    if (modelId.startsWith('sora2-')) {
      const durationMultiplier = generation.duration / 4;
      modelCost *= durationMultiplier;

      // Pro model has resolution-based pricing
      if (modelId === 'sora2-image-to-video-pro') {
        if (generation.resolution === '1080p') {
          modelCost = (generation.duration * 0.50); // $0.50/s for 1080p
        } else if (generation.resolution === '720p') {
          modelCost = (generation.duration * 0.30); // $0.30/s for 720p
        }
      }
    }

    return total + modelCost;
  }, 0);
  ```

- [ ] Update prompt character limit for Sora 2 models (conditional max length)
  ```tsx
  {/* MODIFY: Make maxChars dynamic based on model selection */}
  const maxChars = generation.isSora2Selected ? 5000 : 500;

  <Textarea
    // ... existing props ...
    maxLength={maxChars}
  />
  <div className="text-xs text-muted-foreground text-right">
    {maxChars - prompt.length} characters remaining
    {generation.isSora2Selected && (
      <span className="ml-2 text-primary">(Sora 2: 5000 max)</span>
    )}
  </div>
  ```

**Position in UI**: Insert Sora 2 settings panel after model selection, before error/progress displays. This keeps existing layout intact.

### 5. Add Type Definitions
**File**: Create new `qcut/apps/web/src/types/sora2.ts`

**✅ Non-Breaking**: Create new type definition file without modifying existing type files.

- [ ] Create new type definition file for Sora 2 (new file, doesn't modify existing types)
  ```typescript
  // qcut/apps/web/src/types/sora2.ts

  /**
   * Sora 2 Text-to-Video API Input
   */
  export interface Sora2TextToVideoInput {
    prompt: string;
    resolution?: "720p";
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
    | 'sora2-image-to-video'
    | 'sora2-image-to-video-pro';

  /**
   * Sora 2 generation settings
   */
  export interface Sora2Settings {
    duration: 4 | 8 | 12;
    aspectRatio: "9:16" | "16:9";
    resolution: "auto" | "720p" | "1080p";
  }
  ```

- [ ] Export new types from main types index (if exists)
  ```typescript
  // In qcut/apps/web/src/types/index.ts (if it exists), ADD:
  export * from './sora2';
  ```

### 6. Testing & Validation

**✅ Non-Breaking**: Test new Sora 2 features in isolation. Verify existing models still work correctly.

#### Sora 2 Feature Tests
- [ ] **Text-to-video generation**
  - [ ] Test with various prompt lengths (short, medium, max 5000 chars)
  - [ ] Test all duration options (4s, 8s, 12s)
  - [ ] Test both aspect ratios (16:9, 9:16)
  - [ ] Verify video URL is returned correctly
  - [ ] Verify video plays in timeline

- [ ] **Image-to-video (standard) generation**
  - [ ] Test with different image formats (JPG, PNG, WebP)
  - [ ] Test with various image sizes
  - [ ] Test with/without optional prompt
  - [ ] Test auto resolution vs 720p
  - [ ] Verify image URL upload works

- [ ] **Image-to-video Pro generation**
  - [ ] Test 720p resolution
  - [ ] Test 1080p resolution
  - [ ] Test auto resolution
  - [ ] Verify pricing calculation for different resolutions
  - [ ] Verify higher quality output vs standard

#### Cost Calculation Tests
- [ ] Verify base pricing: $0.10/s (standard), $0.30/s (720p Pro), $0.50/s (1080p Pro)
- [ ] Test duration multiplier (4s, 8s, 12s)
- [ ] Test multi-model cost calculation with Sora 2 + existing models
- [ ] Verify UI displays correct total cost

#### Error Handling Tests
- [ ] Invalid prompts (> 5000 chars) - should show error
- [ ] Missing image URL for image-to-video models
- [ ] Invalid duration values (not 4, 8, or 12)
- [ ] API key issues
- [ ] Network errors / timeout handling
- [ ] Invalid response format handling

#### Integration Tests
- [ ] Video download and storage in project
- [ ] Video appears in timeline after generation
- [ ] Video playback in preview
- [ ] Video export in final output
- [ ] History panel shows Sora 2 videos correctly
- [ ] Multi-model generation with mixed Sora 2 + existing models

#### Regression Tests (Existing Features)
- [ ] **CRITICAL**: Verify existing text-to-image models still work
- [ ] **CRITICAL**: Verify existing avatar models still work
- [ ] **CRITICAL**: Verify existing image-to-video models (non-Sora) still work
- [ ] Verify UI for non-Sora models unchanged
- [ ] Verify cost calculation for existing models unchanged
- [ ] Verify generation flow for existing models unchanged

### 7. Documentation
- [ ] Add usage examples to this document
- [ ] Update AI panel documentation
- [ ] Add troubleshooting section
- [ ] Document pricing model

## Relevant Files

### Core Integration Files
- `qcut/apps/web/src/lib/fal-ai-client.ts:51` - FAL AI client base implementation
- `qcut/apps/web/src/services/ai/fal-ai-service.ts:1` - FAL AI service wrapper
- `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx:1` - Main AI panel UI
- `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts` - Model definitions
- `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` - Generation hook

### Type Definitions
- `qcut/apps/web/src/types/nano-edit.ts` - Existing FAL AI types
- `qcut/apps/web/src/types/electron.d.ts:39` - Electron API types

### Reference Implementations
- Text-to-image models in `fal-ai-client.ts:279-337` - `generateWithModel()`
- Image-to-video upload in `ai.tsx:145-191` - Image upload handler
- Multi-model generation in `fal-ai-client.ts:339-402` - Parallel generation

## Implementation Priority

### Phase 1: Core Integration (Non-Breaking)
**Goal**: Add Sora 2 models without affecting existing features

1. ✅ **Type Definitions** (safest, no breaking changes)
   - Create `src/types/sora2.ts`
   - Define all Sora 2 interfaces

2. ✅ **Model Definitions** (append to array)
   - Add 3 Sora 2 models to `AI_MODELS` array in `ai-constants.ts`
   - Use new model IDs with `sora2-` prefix

3. ✅ **Client Functions** (new functions only)
   - Add Sora 2 detection helpers
   - Add Sora 2 parameter converter
   - Add Sora 2 response parser
   - Extend `convertParametersForModel()` with new case

4. ✅ **Hook State** (new state variables)
   - Add duration, aspectRatio, resolution state
   - Add Sora 2 detection flags
   - Return new state in hook

### Phase 2: UI Integration (Conditional Rendering)
**Goal**: Add Sora 2 UI controls without modifying existing UI

5. ✅ **Conditional UI Components**
   - Add Sora 2 settings panel (only shows when Sora 2 selected)
   - Update prompt max length conditionally
   - Update cost calculation with Sora 2 logic

6. ✅ **Generation Logic** (extend existing)
   - Add Sora 2 parameter handling in generation hook
   - Add video response handling in `generateWithModel()`

### Phase 3: Testing & Validation
**Goal**: Ensure no regressions

7. 🧪 **Test Sora 2 Features**
   - Test all 3 models independently
   - Test duration/resolution/aspect ratio settings
   - Test cost calculations

8. 🧪 **Regression Testing** (CRITICAL)
   - Verify all existing models still work
   - Verify existing UI unchanged for non-Sora models
   - Test mixed model generations

### Phase 4: Documentation & Optimization
9. 📚 **Documentation**
   - Usage examples
   - Troubleshooting guide
   - Pricing guide

10. ⚡ **Optimization** (optional)
   - OpenAI API key integration
   - Advanced error handling
   - Retry logic

## Non-Breaking Integration Checklist

Before marking any subtask as complete, verify:

- ✅ **No modifications to existing functions** - Only add new functions or extend with conditional logic
- ✅ **No changes to existing model definitions** - Only append new models
- ✅ **No changes to existing UI for non-Sora models** - Use conditional rendering
- ✅ **No changes to existing state management** - Add new state variables only
- ✅ **No changes to existing type definitions** - Create new type file
- ✅ **Backwards compatible** - Existing code paths must work identically
- ✅ **Regression tests pass** - All existing features verified working

## Technical Notes

### Response Format Differences
- **Existing models**: Return `{ images: [{ url, width, height }] }`
- **Sora 2**: Returns `{ video: "url" }` or `{ video: { url, content_type } }`
- **Solution**: Add conditional parsing in `generateWithModel()` based on model type

### Pricing Calculation
- **Existing models**: Fixed price per generation
- **Sora 2**: Variable price based on duration and resolution
  - Standard: $0.10/s × duration
  - Pro 720p: $0.30/s × duration
  - Pro 1080p: $0.50/s × duration
- **Solution**: Add conditional pricing logic in cost calculation

### Prompt Length
- **Existing models**: 500 character limit (UI constraint)
- **Sora 2**: 5000 character limit (API limit)
- **Solution**: Dynamic `maxChars` based on selected models

### UI State Management
- **Existing models**: No additional settings needed
- **Sora 2**: Requires duration, aspect ratio, resolution selectors
- **Solution**: Conditionally render settings panel only when Sora 2 models selected

## Risk Mitigation

### High Risk Areas
1. **Response parsing** - Different format could break existing logic
   - ✅ Mitigation: Add model type check before parsing

2. **Cost calculation** - Complex pricing could break display
   - ✅ Mitigation: Extend existing calculation with additive logic

3. **Parameter conversion** - Wrong parameters could break API calls
   - ✅ Mitigation: Add new converter function, test thoroughly

### Testing Strategy
1. Test Sora 2 in isolation first
2. Test existing models to ensure no regression
3. Test mixed model selections
4. Test edge cases (empty prompt, max length, etc.)
