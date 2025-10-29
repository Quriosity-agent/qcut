# Hailuo 2.3 Integration

## Overview
This document describes the integration of MiniMax's Hailuo 2.3 models into QCut. Hailuo 2.3 offers multiple variants optimized for different use cases across both image-to-video and text-to-video generation: Standard (budget-friendly), Fast Pro (balanced), and Pro (premium quality).

## Image-to-Video Models

### 1. Hailuo 2.3 Standard (Image-to-Video)
- **Endpoint**: `fal-ai/minimax/hailuo-2.3/standard/image-to-video`
- **Resolution**: 768p
- **Pricing**:
  - 6-second video: $0.28
  - 10-second video: $0.56
- **Use Case**: Budget-friendly image-to-video generation

### 2. Hailuo 2.3 Fast Pro (Image-to-Video)
- **Endpoint**: `fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video`
- **Resolution**: 1080p
- **Pricing**: $0.33 per video
- **Use Case**: Balanced performance and quality with faster generation times

### 3. Hailuo 2.3 Pro (Image-to-Video)
- **Endpoint**: `fal-ai/minimax/hailuo-2.3/pro/image-to-video`
- **Resolution**: 1080p
- **Pricing**: $0.49 per video
- **Use Case**: Premium quality with highest fidelity

## Text-to-Video Models

### 4. Hailuo 2.3 Standard (Text-to-Video)
- **Endpoint**: `fal-ai/minimax/hailuo-2.3/standard/text-to-video`
- **Resolution**: 768p
- **Pricing**:
  - 6-second video: $0.28
  - 10-second video: $0.56
- **Duration Options**: 6s or 10s
- **Use Case**: Budget-friendly text-to-video generation

### 5. Hailuo 2.3 Pro (Text-to-Video)
- **Endpoint**: `fal-ai/minimax/hailuo-2.3/pro/text-to-video`
- **Resolution**: 1080p
- **Pricing**: $0.49 per video
- **Use Case**: Premium text-to-video with cinematic camera control

---

## Additional Models for Future Integration

### 6. Vidu Q2 Turbo (Image-to-Video)
- **Endpoint**: `fal-ai/vidu/q2/image-to-video/turbo`
- **Resolution**: 720p / 1080p
- **Pricing**:
  - 720p: $0.05 per second (e.g., 4s = $0.20, 8s = $0.40)
  - 1080p: $0.20 base + $0.05 per second (e.g., 4s = $0.40, 8s = $0.60)
- **Duration Options**: 2-8 seconds
- **Special Features**:
  - Movement amplitude control (auto/small/medium/large)
  - Background music (BGM) for 4-second videos only
  - Max prompt: 3000 characters
- **Use Case**: Flexible duration options with fine-grained motion control

### 7. Seedance v1 Pro Fast (Image-to-Video)
- **Endpoint**: `fal-ai/bytedance/seedance/v1/pro/fast/image-to-video`
- **Resolution**: 480p / 720p / 1080p
- **Pricing**:
  - 1080p 5s: ~$0.243
  - Token-based: $1.00 per million tokens
  - Formula: `(height × width × FPS × duration) / 1024`
- **Duration Options**: 2-12 seconds (default: 5s)
- **Special Features**:
  - Camera lock option (`camera_fixed`)
  - Aspect ratio auto-detection or manual selection (21:9, 16:9, 4:3, 1:1, 3:4, 9:16)
  - Safety checker toggle
  - Seed control for reproducibility
- **Use Case**: Long-form image-to-video (up to 12s) with camera control

### 8. Seedance v1 Pro Fast (Text-to-Video)
- **Endpoint**: `fal-ai/bytedance/seedance/v1/pro/fast/text-to-video`
- **Resolution**: 480p / 720p / 1080p
- **Pricing**:
  - 1080p 5s: ~$0.245
  - Token-based: $1.00 per million tokens
  - Formula: `(height × width × FPS × duration) / 1024`
- **Duration Options**: 2-12 seconds (default: 5s)
- **Special Features**:
  - Camera lock option (`camera_fixed`)
  - Aspect ratio selection (21:9, 16:9, 4:3, 1:1, 3:4, 9:16, default: 16:9)
  - Safety checker toggle
  - Seed control for reproducibility
- **Use Case**: Long-form text-to-video (up to 12s) with multi-aspect ratio support

---

## API Parameters

### Image-to-Video Parameters

All three image-to-video models share the same parameter structure:

### Required Parameters
- `prompt` (string, max 2000 characters): Text description of desired video animation
- `image_url` (string): URL of the input image (first frame)

### Optional Parameters
- `prompt_optimizer` (boolean, default: true): Enables automatic prompt enhancement
- `end_image_url` (string): Optional URL for the final frame

### Text-to-Video Parameters

#### Standard Text-to-Video
- `prompt` (required, string, max 1500 characters): Text description for video generation
- `prompt_optimizer` (optional, boolean, default: true): Enables automatic prompt enhancement
- `duration` (optional, enum: "6" or "10"): Video length in seconds (default: 6)

#### Pro Text-to-Video
- `prompt` (required, string, max 2000 characters): Text description for video generation
- `prompt_optimizer` (optional, boolean, default: true): Enables automatic prompt enhancement
- **Camera Control**: Supports cinematic movements via bracketed notation (e.g., `[Pan left]`, `[Zoom in]`, `[Track forward]`)

### Additional Models Parameters

#### Vidu Q2 Turbo (Image-to-Video)
**Required:**
- `prompt` (string, max 3000 characters): Text description
- `image_url` (string): Starting frame URL

**Optional:**
- `duration` (number, 2-8): Video duration in seconds (default: 4)
- `resolution` (enum: "720p" | "1080p"): Output quality (default: "720p")
- `movement_amplitude` (enum: "auto" | "small" | "medium" | "large"): Motion intensity (default: "auto")
- `bgm` (boolean): Enable background music (only for 4-second videos)
- `seed` (integer): For reproducible results

#### Seedance v1 Pro Fast (Image-to-Video)
**Required:**
- `prompt` (string): Text description for video animation
- `image_url` (string): Starting frame URL

**Optional:**
- `duration` (number, 2-12): Video length in seconds (default: 5)
- `resolution` (enum: "480p" | "720p" | "1080p"): Output quality (default: "1080p")
- `aspect_ratio` (enum: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "auto"): Video dimensions (default: "auto")
- `camera_fixed` (boolean): Lock camera position (default: false)
- `seed` (integer): For reproducibility (use -1 for random)
- `enable_safety_checker` (boolean): Content moderation (default: true)

#### Seedance v1 Pro Fast (Text-to-Video)
**Required:**
- `prompt` (string): Text description for video generation

**Optional:**
- `duration` (number, 2-12): Video length in seconds (default: 5)
- `resolution` (enum: "480p" | "720p" | "1080p"): Output quality (default: "1080p")
- `aspect_ratio` (enum: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16"): Video dimensions (default: "16:9")
- `camera_fixed` (boolean): Lock camera position (default: false)
- `seed` (integer): For reproducibility (use -1 for random)
- `enable_safety_checker` (boolean): Content moderation (default: true)

## API Response Format

```json
{
  "video": {
    "url": "https://storage.googleapis.com/falserverless/output.mp4"
  }
}
```

## Relevant File Paths

### Core Files (Already Modified)
- **`qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`**
  - Model definitions and configurations
  - Image-to-video models already added
  - Text-to-video models need to be added

- **`qcut/apps/web/src/lib/ai-video-client.ts`**
  - Client-side API integration with FAL
  - `generateVideoFromImage()` function already supports I2V models
  - Needs new `generateVideoFromText()` function for T2V models

### Supporting Files (May Need Updates)
- **`qcut/apps/web/src/types/ai-video.ts`** (if exists)
  - Type definitions for requests/responses
  - May need `TextToVideoRequest` interface

- **`qcut/apps/web/src/components/editor/media-panel/views/AIVideoPanel.tsx`** (if exists)
  - UI component for AI video generation
  - May need text-to-video input controls

- **`qcut/apps/web/src/components/editor/media-panel/MediaPanel.tsx`** (if exists)
  - Parent component that may route to AI video functionality

### Testing Files
- **`qcut/apps/web/src/__tests__/ai-video-client.test.ts`** (if exists)
  - Unit tests for AI video generation functions

- **`qcut/apps/web/src/__tests__/integration/ai-models.test.ts`** (if exists)
  - Integration tests for AI model configuration

## Integration Points

### 1. Model Configuration (`ai-constants.ts`)
**Status: ✅ Completed for I2V, ⏳ Pending for T2V**

Added three image-to-video models to the `AI_MODELS` array:
- `hailuo23_standard` (Image-to-Video)
- `hailuo23_fast_pro` (Image-to-Video)
- `hailuo23_pro` (Image-to-Video)

**Text-to-Video models pending integration:**
- `hailuo23_standard_t2v` (Text-to-Video, 768p, $0.28/$0.56)
- `hailuo23_pro_t2v` (Text-to-Video, 1080p, $0.49)

### 2. AI Video Client (`ai-video-client.ts`)

#### Image-to-Video
The existing `generateVideoFromImage()` function supports these models without modification:
- Converts image files to base64 data URLs
- Constructs proper API payloads with `prompt` and `image_url`
- Handles FAL API responses with `video.url` extraction

#### Text-to-Video (Pending Implementation)
Text-to-video models will require a new function:
- Direct text prompt without image input
- Support for duration parameter (Standard model)
- Camera control support (Pro model)
- Same FAL API response handling

## Usage Examples

### Image-to-Video Example

```typescript
const request: ImageToVideoRequest = {
  image: userUploadedImageFile,
  model: "hailuo23_pro",
  prompt: "The camera follows the mountain biker as they navigate a technical forest trail at high speed",
  duration: 6, // For standard model: 6s or 10s
};

const response = await generateVideoFromImage(request);
console.log("Video URL:", response.video_url);
```

### Text-to-Video Example (Pending Implementation)

```typescript
// Standard Text-to-Video (with duration control)
const request: TextToVideoRequest = {
  model: "hailuo23_standard_t2v",
  prompt: "A mountain biker navigating a technical forest trail at high speed, with dynamic camera movement following the action",
  duration: 10, // 6 or 10 seconds
  prompt_optimizer: true
};

const response = await generateVideoFromText(request);
console.log("Video URL:", response.video_url);

// Pro Text-to-Video (with camera control)
const requestPro: TextToVideoRequest = {
  model: "hailuo23_pro_t2v",
  prompt: "[Track forward] A serene mountain landscape at sunset with clouds drifting across the sky [Pan right]",
  prompt_optimizer: true
};

const responsePro = await generateVideoFromText(requestPro);
console.log("Video URL:", responsePro.video_url);
```

## ⚠️ Critical Implementation Rules

### 🔒 DO NOT Break Existing Features
This implementation follows an **ADDITIVE-ONLY** approach to ensure zero breaking changes:

1. **✅ DO: Add new models**
   - New model IDs: `hailuo23_standard_t2v`, `hailuo23_pro_t2v`
   - New category type: `"text"` (alongside existing `"image"`)
   - New function: `generateVideoFromText()`

2. **❌ DO NOT: Modify existing implementations**
   - ❌ Do not change existing model configurations (`hailuo23_standard`, `hailuo23_fast_pro`, `hailuo23_pro`)
   - ❌ Do not modify `generateVideoFromImage()` function signature or behavior
   - ❌ Do not change existing TypeScript interfaces or types
   - ❌ Do not alter existing UI components for I2V workflows

3. **✅ DO: Maintain backward compatibility**
   - Existing projects using I2V models must continue to work without changes
   - Existing API calls must produce identical results
   - Existing UI workflows must remain unchanged
   - Existing tests must pass without modification

4. **✅ DO: Use feature detection**
   - Check `model.category` to determine I2V vs T2V workflow
   - Conditionally render UI based on selected model type
   - Gracefully handle models without T2V support

### 📋 Pre-Implementation Checklist
Before making any code changes:
- [ ] Verify all existing I2V models are working correctly
- [ ] Run existing test suite to establish baseline (all tests passing)
- [ ] Create a git branch for T2V implementation
- [ ] Document current I2V workflow behavior for regression testing

### 📋 Post-Implementation Validation
After completing T2V implementation:
- [ ] Run full test suite - all existing tests must still pass
- [ ] Manually test all I2V models - behavior unchanged
- [ ] Verify existing projects load without errors
- [ ] Check that I2V UI flows work exactly as before
- [ ] Confirm no TypeScript errors in existing code

---

## Implementation Subtasks (Text-to-Video)

### Subtask 1: Add T2V Model Configurations (5-10 minutes)
**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Location:** Add to the `AI_MODELS` array after line 134 (after `hailuo23_pro` image-to-video model)

**Code to ADD:**

```typescript
  // Hailuo 2.3 Text-to-Video Models
  {
    id: "hailuo23_standard_t2v",
    name: "Hailuo 2.3 Standard T2V",
    description: "Budget-friendly text-to-video with 768p quality",
    price: "0.28", // 6s: $0.28, 10s: $0.56
    resolution: "768p",
    max_duration: 10,
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/minimax/hailuo-2.3/standard/text-to-video",
    },
    default_params: {
      duration: 6,
      resolution: "768p",
      prompt_optimizer: true,
    },
  },
  {
    id: "hailuo23_pro_t2v",
    name: "Hailuo 2.3 Pro T2V",
    description: "Premium 1080p text-to-video with cinematic camera control (use [Pan left], [Zoom in] in prompts)",
    price: "0.49",
    resolution: "1080p",
    max_duration: 10,
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/minimax/hailuo-2.3/pro/text-to-video",
    },
    default_params: {
      duration: 6,
      resolution: "1080p",
      prompt_optimizer: true,
    },
  },
```

**Tasks:**
- [ ] Open `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`
- [ ] Locate line 134 (end of `hailuo23_pro` image-to-video model)
- [ ] Add a comment: `// Hailuo 2.3 Text-to-Video Models`
- [ ] Paste the two model configurations above
- [ ] Verify no syntax errors (check for trailing commas)
- [ ] Save file

**Backward Compatibility:** ✅ Non-breaking; adds new models without modifying existing ones.

**Validation:**
```bash
# Verify the models are properly added
cd qcut/apps/web
bun run check-types  # Should pass without errors
```

---

### Subtask 2: Implement T2V Client Function (15-20 minutes)
**File:** `qcut/apps/web/src/lib/ai-video-client.ts`

#### Part A: Add TypeScript Interface

**Location:** Add after line 299 (after `ImageToVideoRequest` interface)

**Code to ADD:**

```typescript
export interface TextToVideoRequest {
  model: string;
  prompt: string;
  duration?: 6 | 10; // Only for Standard model
  prompt_optimizer?: boolean;
  resolution?: string;
}
```

**Tasks:**
- [ ] Locate the `ImageToVideoRequest` interface (around line 292-299)
- [ ] Add the `TextToVideoRequest` interface immediately after it
- [ ] Save file

---

#### Part B: Add Main Function

**Location:** Add after line 1213 (after `generateVideoFromImage` function ends)

**Code to ADD:**

```typescript
/**
 * Generates AI video from text prompt using FAL AI's Hailuo 2.3 text-to-video models.
 *
 * WHY: Hailuo 2.3 offers budget-friendly text-to-video generation without requiring image input.
 * Side effect: Sends text prompt directly to FAL API without image conversion overhead.
 * Performance: Faster than image-to-video as no base64 encoding required.
 *
 * Edge cases:
 * - Standard model supports duration of 6s or 10s (different pricing)
 * - Pro model has fixed pricing regardless of duration
 * - Pro model supports camera control via bracketed notation (e.g., [Pan left], [Zoom in])
 *
 * @param request - Text prompt, model ID, and generation parameters
 * @returns VideoGenerationResponse with job_id and final video_url
 * @throws Error if FAL_API_KEY missing or model doesn't support text-to-video
 */
export async function generateVideoFromText(
  request: TextToVideoRequest
): Promise<VideoGenerationResponse> {
  try {
    if (!FAL_API_KEY) {
      throw new Error("FAL API key not configured");
    }

    console.log("🎬 Starting text-to-video generation with FAL AI");
    console.log("📝 Prompt:", request.prompt);
    console.log("🤖 Model:", request.model);

    // Get model configuration from centralized config
    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    // Check if model supports text-to-video
    const endpoint = modelConfig.endpoints.text_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support text-to-video generation`
      );
    }

    // Build request payload for Hailuo 2.3 models
    const payload: Record<string, any> = {
      prompt: request.prompt,
      // Start with default parameters from model config
      ...(modelConfig.default_params || {}),
    };

    // Handle duration parameter (Hailuo 2.3 specific)
    if (request.model === "hailuo23_standard_t2v") {
      // Standard model: 6s or 10s with different pricing
      const requestedDuration = request.duration || 6;
      payload.duration = requestedDuration >= 10 ? "10" : "6";
    } else if (request.model === "hailuo23_pro_t2v") {
      // Pro model: fixed pricing, duration can be 6 or 10
      const requestedDuration = request.duration || 6;
      payload.duration = requestedDuration >= 10 ? "10" : "6";
    }

    // Handle prompt_optimizer (both models support it)
    if (request.prompt_optimizer !== undefined) {
      payload.prompt_optimizer = request.prompt_optimizer;
    }

    const jobId = generateJobId();
    console.log(`🎬 Generating text-to-video with: ${endpoint}`);
    console.log("📝 Payload:", payload);

    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      // Handle specific error cases with user-friendly messages
      if (errorData.detail && errorData.detail.includes("User is locked")) {
        if (errorData.detail.includes("Exhausted balance")) {
          throw new Error(
            "Your FAL.ai account balance has been exhausted. Please top up your balance at fal.ai/dashboard/billing to continue generating videos."
          );
        }
        throw new Error(
          "Your FAL.ai account is temporarily locked. Please check your account status at fal.ai/dashboard."
        );
      }

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
    console.log("✅ FAL API response:", result);

    // Return in our expected format
    return {
      job_id: jobId,
      status: "completed",
      message: `Video generated successfully from text with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate video from text", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100), // Log first 100 chars only
      operation: "generateVideoFromText",
    });
    throw error;
  }
}
```

**Tasks:**
- [ ] Locate line 1213 (end of `generateVideoFromImage` function)
- [ ] Add the new `generateVideoFromText` function
- [ ] Verify proper indentation and formatting
- [ ] Ensure all imports are available (they should be from existing code)
- [ ] Save file

**Backward Compatibility:** ✅ New function; does not modify existing `generateVideoFromImage()` or `generateVideo()`.

**Validation:**
```bash
# Type check the new function
cd qcut/apps/web
bun run check-types  # Should pass without errors
```

---

### Subtask 3: Update UI Components (10-15 minutes)
**Status:** ⏸️ **OPTIONAL** - UI components may not exist yet or may need discovery

**Action Required:** Search for AI video UI components before implementation

**Search Commands:**
```bash
# Find AI video panel components
cd qcut/apps/web/src
find . -name "*AI*Panel*.tsx" -o -name "*ai*panel*.tsx"
find . -name "*AIVideo*.tsx" -o -name "*ai-video*.tsx"

# Search for where models are rendered in UI
grep -r "AI_MODELS" --include="*.tsx" --include="*.ts"
grep -r "selectedModels" --include="*.tsx"
```

**If UI Components Found:**

#### Example: Model Selection Dropdown (hypothetical location)

**Code to MODIFY:** (Example pattern to look for)

```typescript
// BEFORE: Simple model list
{AI_MODELS.map((model) => (
  <option key={model.id} value={model.id}>
    {model.name} - ${model.price}
  </option>
))}

// AFTER: Grouped by category
{/* Image-to-Video Models */}
<optgroup label="Image-to-Video">
  {AI_MODELS.filter(m => m.category === "image").map((model) => (
    <option key={model.id} value={model.id}>
      {model.name} - ${model.price}
    </option>
  ))}
</optgroup>

{/* Text-to-Video Models */}
<optgroup label="Text-to-Video">
  {AI_MODELS.filter(m => m.category === "text").map((model) => (
    <option key={model.id} value={model.id}>
      {model.name} - ${model.price}
    </option>
  ))}
</optgroup>
```

#### Example: Conditional Input Rendering

**Code to ADD:** (If generation form exists)

```typescript
// Check if selected model is text-to-video
const selectedModelConfig = AI_MODELS.find(m => m.id === selectedModel);
const isTextToVideo = selectedModelConfig?.category === "text";
const isImageToVideo = selectedModelConfig?.category === "image";

// Conditional rendering
{isImageToVideo && (
  <ImageUpload onImageSelect={handleImageSelect} />
)}

{isTextToVideo && (
  <div>
    <TextPromptInput value={prompt} onChange={setPrompt} />
    {selectedModel === "hailuo23_pro_t2v" && (
      <div className="text-sm text-gray-500 mt-2">
        💡 Tip: Use camera controls like [Pan left], [Zoom in], [Track forward] in your prompt
      </div>
    )}
    {selectedModel === "hailuo23_standard_t2v" && (
      <DurationSelector
        value={duration}
        onChange={setDuration}
        options={[6, 10]}
        pricingNote="6s: $0.28, 10s: $0.56"
      />
    )}
  </div>
)}
```

**Tasks:**
- [ ] Search for AI video UI components in the codebase
- [ ] If found, implement conditional rendering based on `model.category`
- [ ] Add camera control hints for Pro T2V model
- [ ] Add duration selector for Standard T2V model
- [ ] If NOT found, document that UI integration is pending

**Backward Compatibility:** ✅ UI changes are additive; existing I2V workflows remain unchanged.

**Note:** If no UI components exist, this subtask can be skipped for now. The models will be available via API but not yet exposed in the UI.

---

### Subtask 4: Add Validation & Error Handling (5-10 minutes)
**File:** `qcut/apps/web/src/lib/ai-video-client.ts`

#### Part A: Add Validation Helper Functions

**Location:** Add before the `generateVideoFromText` function (around line 1213)

**Code to ADD:**

```typescript
/**
 * Validates prompt length for Hailuo 2.3 text-to-video models
 *
 * @param prompt - User's text prompt
 * @param modelId - Model identifier
 * @throws Error if prompt exceeds model's character limit
 */
function validateHailuo23Prompt(prompt: string, modelId: string): void {
  const maxLengths: Record<string, number> = {
    hailuo23_standard_t2v: 1500,
    hailuo23_pro_t2v: 2000,
  };

  const maxLength = maxLengths[modelId];
  if (maxLength && prompt.length > maxLength) {
    throw new Error(
      `Prompt too long for ${modelId}. Maximum ${maxLength} characters allowed (current: ${prompt.length})`
    );
  }
}

/**
 * Checks if model is a Hailuo 2.3 text-to-video model
 *
 * @param modelId - Model identifier to check
 * @returns true if model is Hailuo 2.3 T2V
 */
function isHailuo23TextToVideo(modelId: string): boolean {
  return modelId === "hailuo23_standard_t2v" || modelId === "hailuo23_pro_t2v";
}
```

**Tasks:**
- [ ] Add the validation helper functions before `generateVideoFromText`
- [ ] Save file

---

#### Part B: Update `generateVideoFromText` with Validation

**Location:** Inside `generateVideoFromText` function, after getting `modelConfig` (around line 360)

**Code to MODIFY:**

Find this section in `generateVideoFromText`:
```typescript
    // Check if model supports text-to-video
    const endpoint = modelConfig.endpoints.text_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support text-to-video generation`
      );
    }
```

**ADD this validation immediately after:**
```typescript
    // Validate prompt length for Hailuo 2.3 models
    if (isHailuo23TextToVideo(request.model)) {
      validateHailuo23Prompt(request.prompt, request.model);
    }

    // Validate required parameters
    if (!request.prompt || request.prompt.trim().length === 0) {
      throw new Error("Text prompt is required for text-to-video generation");
    }
```

**Tasks:**
- [ ] Locate the endpoint validation code in `generateVideoFromText`
- [ ] Add prompt validation immediately after endpoint check
- [ ] Save file

---

#### Part C: Update Error Constants

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

**Location:** In the `ERROR_MESSAGES` object (around line 577-604)

**Code to ADD:**

```typescript
  // Hailuo 2.3 Text-to-Video errors
  HAILUO23_T2V_PROMPT_TOO_LONG_STANDARD:
    "Prompt exceeds 1500 character limit for Hailuo 2.3 Standard",
  HAILUO23_T2V_PROMPT_TOO_LONG_PRO:
    "Prompt exceeds 2000 character limit for Hailuo 2.3 Pro",
  HAILUO23_T2V_EMPTY_PROMPT:
    "Please enter a text prompt for video generation",
  HAILUO23_T2V_INVALID_DURATION:
    "Duration must be either 6 or 10 seconds for Hailuo 2.3 models",
```

**Tasks:**
- [ ] Open `ai-constants.ts`
- [ ] Locate the `ERROR_MESSAGES` object
- [ ] Add Hailuo 2.3 error messages
- [ ] Save file

**Backward Compatibility:** ✅ Validation-only changes; does not modify existing behavior.

**Validation:**
```bash
# Test that validation catches errors
cd qcut/apps/web
bun run check-types  # Should pass without errors
```

---

### Subtask 5: Write Tests (15-20 minutes)
**File:** `qcut/apps/web/src/__tests__/ai-video-client.test.ts` (create if doesn't exist)

**Location:** Create new test file or add to existing test suite

**Code to ADD:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateVideoFromText } from '@/lib/ai-video-client';
import type { TextToVideoRequest } from '@/lib/ai-video-client';

describe('generateVideoFromText - Hailuo 2.3 Text-to-Video', () => {
  beforeEach(() => {
    // Mock FAL_API_KEY
    vi.stubEnv('VITE_FAL_API_KEY', 'test-api-key');
  });

  describe('Prompt Validation', () => {
    it('should reject prompts exceeding 1500 chars for Standard model', async () => {
      const longPrompt = 'A'.repeat(1501);
      const request: TextToVideoRequest = {
        model: 'hailuo23_standard_t2v',
        prompt: longPrompt,
        duration: 6,
      };

      await expect(generateVideoFromText(request)).rejects.toThrow(
        /Prompt too long.*Maximum 1500 characters/
      );
    });

    it('should reject prompts exceeding 2000 chars for Pro model', async () => {
      const longPrompt = 'A'.repeat(2001);
      const request: TextToVideoRequest = {
        model: 'hailuo23_pro_t2v',
        prompt: longPrompt,
        duration: 6,
      };

      await expect(generateVideoFromText(request)).rejects.toThrow(
        /Prompt too long.*Maximum 2000 characters/
      );
    });

    it('should accept prompts within limit for Standard model', async () => {
      const validPrompt = 'A'.repeat(1500);
      const request: TextToVideoRequest = {
        model: 'hailuo23_standard_t2v',
        prompt: validPrompt,
        duration: 6,
      };

      // Mock fetch to return success
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: 'https://example.com/video.mp4' } }),
      });

      const result = await generateVideoFromText(request);
      expect(result.status).toBe('completed');
      expect(result.video_url).toBeTruthy();
    });

    it('should reject empty prompts', async () => {
      const request: TextToVideoRequest = {
        model: 'hailuo23_standard_t2v',
        prompt: '',
        duration: 6,
      };

      await expect(generateVideoFromText(request)).rejects.toThrow(
        /Text prompt is required/
      );
    });
  });

  describe('Duration Handling', () => {
    it('should use "6" string for 6-second duration on Standard model', async () => {
      const request: TextToVideoRequest = {
        model: 'hailuo23_standard_t2v',
        prompt: 'A mountain biker on a forest trail',
        duration: 6,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: 'https://example.com/video.mp4' } }),
      });
      global.fetch = mockFetch;

      await generateVideoFromText(request);

      const callPayload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callPayload.duration).toBe('6');
    });

    it('should use "10" string for 10-second duration on Standard model', async () => {
      const request: TextToVideoRequest = {
        model: 'hailuo23_standard_t2v',
        prompt: 'A mountain biker on a forest trail',
        duration: 10,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: 'https://example.com/video.mp4' } }),
      });
      global.fetch = mockFetch;

      await generateVideoFromText(request);

      const callPayload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callPayload.duration).toBe('10');
    });
  });

  describe('Model Configuration', () => {
    it('should use correct endpoint for Standard T2V model', async () => {
      const request: TextToVideoRequest = {
        model: 'hailuo23_standard_t2v',
        prompt: 'A serene landscape at sunset',
        duration: 6,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: 'https://example.com/video.mp4' } }),
      });
      global.fetch = mockFetch;

      await generateVideoFromText(request);

      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('fal-ai/minimax/hailuo-2.3/standard/text-to-video');
    });

    it('should use correct endpoint for Pro T2V model', async () => {
      const request: TextToVideoRequest = {
        model: 'hailuo23_pro_t2v',
        prompt: '[Pan left] A serene landscape at sunset [Zoom in]',
        duration: 6,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: 'https://example.com/video.mp4' } }),
      });
      global.fetch = mockFetch;

      await generateVideoFromText(request);

      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('fal-ai/minimax/hailuo-2.3/pro/text-to-video');
    });

    it('should include prompt_optimizer in payload when specified', async () => {
      const request: TextToVideoRequest = {
        model: 'hailuo23_pro_t2v',
        prompt: 'A mountain scene',
        prompt_optimizer: false,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video: { url: 'https://example.com/video.mp4' } }),
      });
      global.fetch = mockFetch;

      await generateVideoFromText(request);

      const callPayload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callPayload.prompt_optimizer).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when FAL API returns 401', async () => {
      const request: TextToVideoRequest = {
        model: 'hailuo23_standard_t2v',
        prompt: 'Test prompt',
        duration: 6,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ detail: 'Invalid API key' }),
      });

      await expect(generateVideoFromText(request)).rejects.toThrow(
        /Invalid FAL.ai API key/
      );
    });

    it('should throw error when model does not support text-to-video', async () => {
      const request: TextToVideoRequest = {
        model: 'hailuo23_standard', // This is image-to-video model
        prompt: 'Test prompt',
        duration: 6,
      };

      await expect(generateVideoFromText(request)).rejects.toThrow(
        /does not support text-to-video generation/
      );
    });
  });
});
```

**Tasks:**
- [ ] Create test file at `qcut/apps/web/src/__tests__/ai-video-client.test.ts` (if doesn't exist)
- [ ] Add the test suite above
- [ ] Run tests to ensure they pass: `bun run test`
- [ ] Adjust mocks if needed based on your test setup

**Validation:**
```bash
# Run the new tests
cd qcut/apps/web
bun run test ai-video-client.test.ts

# Run all tests to ensure nothing broke
bun run test
```

**Backward Compatibility:** ✅ New tests; existing tests remain valid and passing.

---

**Total Estimated Time:** 50-75 minutes (across 5 subtasks)

---

## Implementation Summary

### Files Modified (with exact code locations)

1. **`qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`**
   - **Line 134**: Add 2 new text-to-video model configurations
   - **Line 577-604**: Add 4 new error message constants

2. **`qcut/apps/web/src/lib/ai-video-client.ts`**
   - **Line 299**: Add `TextToVideoRequest` interface
   - **Line 1213**: Add validation helper functions (2 functions)
   - **Line 1213**: Add `generateVideoFromText()` main function (~130 lines)

3. **`qcut/apps/web/src/__tests__/ai-video-client.test.ts`** (new file)
   - Complete test suite with 10 test cases

### Code Statistics

**Total Lines Added:** ~250 lines
- Model configurations: ~40 lines
- Client function + validation: ~160 lines
- Tests: ~200 lines
- Error messages: ~10 lines

**Total Lines Modified:** 0 (all additive changes)

**Total Lines Deleted:** 0 (backward compatible)

### Verification Checklist

After completing all subtasks, run these commands:

```bash
# 1. Type checking
cd qcut/apps/web
bun run check-types  # Should pass with no errors

# 2. Run tests
bun run test  # All tests should pass

# 3. Build project
bun run build  # Should compile successfully

# 4. Lint code
bun run lint:clean  # Should pass with no new errors
```

### Quick Reference: What Changed

**NEW Models Available:**
- `hailuo23_standard_t2v` - 768p text-to-video ($0.28/6s, $0.56/10s)
- `hailuo23_pro_t2v` - 1080p text-to-video with camera control ($0.49)

**NEW API Function:**
- `generateVideoFromText(request: TextToVideoRequest)` - Direct text-to-video generation

**NEW Validation:**
- Prompt length limits (1500 chars for Standard, 2000 for Pro)
- Empty prompt detection
- Model capability validation

**UNCHANGED:**
- All existing image-to-video models work exactly as before
- `generateVideoFromImage()` function unchanged
- `generateVideo()` function unchanged
- All existing tests remain valid

---

## Long-Term Support Considerations

### 1. API Versioning Strategy
**Risk:** FAL may update or deprecate Hailuo 2.3 endpoints in the future.

**Mitigation:**
- Store API version in model configuration (`api_version: "2.3"`)
- Implement version fallback logic in `ai-video-client.ts`
- Monitor FAL changelog for deprecation notices
- Add migration path documentation when new versions are released

### 2. Pricing Volatility
**Risk:** FAL may change pricing for Hailuo models, making hardcoded prices inaccurate.

**Mitigation:**
- Consider fetching pricing from FAL API dynamically (if supported)
- Add `last_price_update` timestamp to model configurations
- Document pricing in comments as "as of [date]"
- Implement pricing override system in user settings

### 3. Model Performance Degradation
**Risk:** AI model quality may degrade over time as FAL updates backend infrastructure.

**Mitigation:**
- Maintain version pinning for production deployments
- Document known quality issues in this file
- Provide user option to report quality issues
- Keep historical examples for regression testing

### 4. Backward Compatibility with Existing Projects
**Risk:** Users with existing I2V workflows may experience issues when T2V models are added.

**Mitigation:**
- ✅ **DO NOT modify existing model IDs or configurations**
- ✅ **Add T2V models as new entries, not replacements**
- ✅ **Maintain separate `category` field to distinguish model types**
- ✅ **Preserve existing function signatures for `generateVideoFromImage()`**
- ✅ **Add new `generateVideoFromText()` function instead of modifying existing one**

### 5. UI/UX Consistency
**Risk:** Adding T2V models may complicate the user interface and confuse existing users.

**Mitigation:**
- Group models by category in dropdowns (I2V vs T2V)
- Add clear visual indicators for model type
- Provide contextual help text explaining differences
- Consider adding a "mode switcher" between I2V and T2V workflows

### 6. Testing & QA Burden
**Risk:** More models = more test cases = higher maintenance cost.

**Mitigation:**
- Create shared test utilities for common FAL API behaviors
- Use parameterized tests to cover multiple models with single test case
- Implement smoke tests that run against all models
- Document test coverage expectations in this file

### 7. Cost Management
**Risk:** Users may accidentally generate expensive videos (especially 10s Standard model).

**Mitigation:**
- Add cost calculator preview before generation
- Implement usage tracking and budget alerts
- Provide cost comparison between models in UI
- Add confirmation dialog for high-cost operations (>$0.50)

### 8. Documentation Maintenance
**Risk:** This documentation may become outdated as implementation evolves.

**Mitigation:**
- ✅ **Update this file with each implementation change**
- Add "Last Updated" timestamp to each section
- Link to relevant code sections with file paths and line numbers
- Create automated documentation tests that validate code examples

## Technical Notes

### Differences from Hailuo 02
1. **Version Naming**: Hailuo 2.3 uses numeric version (2.3) vs. Hailuo 02's zero-padded naming
2. **Dual Modality**: Hailuo 2.3 offers both image-to-video AND text-to-video endpoints
3. **Duration Handling**: Standard models support 6s or 10s with tiered pricing; Fast Pro and Pro have fixed pricing
4. **Resolution**: Standard uses 768p, while Pro variants offer 1080p
5. **Camera Control**: Text-to-video Pro model supports cinematic camera movements via bracketed notation

### Special Handling Requirements
The models do NOT require special parameter conversion (unlike Sora 2 models). They use the standard FAL API payload structure:

**Image-to-Video:**
```typescript
{
  prompt: string,
  image_url: string, // Base64 data URL from uploaded image
  prompt_optimizer: boolean (optional),
  end_image_url: string (optional)
}
```

**Text-to-Video:**
```typescript
{
  prompt: string,
  prompt_optimizer: boolean (optional),
  duration: "6" | "10" (optional, Standard model only)
}
```

## Testing Checklist

### Image-to-Video Tests
- [ ] Test image upload and base64 conversion
- [ ] Verify prompt character limit enforcement (max 2000 chars)
- [ ] Test I2V Standard model with 6s duration
- [ ] Test I2V Standard model with 10s duration
- [ ] Verify I2V Fast Pro model generation
- [ ] Verify I2V Pro model generation
- [ ] Test prompt optimizer toggle
- [ ] Validate FAL API response parsing
- [ ] Ensure video downloads correctly to timeline
- [ ] Test error handling for invalid images
- [ ] Verify pricing calculations in UI

### Text-to-Video Tests (Pending Implementation)
- [ ] Test T2V Standard model with 6s duration
- [ ] Test T2V Standard model with 10s duration
- [ ] Verify T2V Pro model generation
- [ ] Test camera control bracketed notation (Pro model)
- [ ] Verify prompt character limits (1500 for Standard, 2000 for Pro)
- [ ] Test prompt optimizer toggle
- [ ] Validate API response parsing
- [ ] Ensure video downloads correctly to timeline
- [ ] Test error handling for invalid prompts
- [ ] Verify pricing calculations in UI

## References

### Image-to-Video Models
- [Hailuo 2.3 Pro I2V](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/pro/image-to-video)
- [Hailuo 2.3 Fast Pro I2V](https://fal.ai/models/fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video)
- [Hailuo 2.3 Standard I2V](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/image-to-video)

### Text-to-Video Models
- [Hailuo 2.3 Pro T2V](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/pro/text-to-video)
- [Hailuo 2.3 Standard T2V](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/text-to-video)

### Additional Models (Future Integration)
- [Vidu Q2 Turbo I2V](https://fal.ai/models/fal-ai/vidu/q2/image-to-video/turbo/api)
- [Seedance v1 Pro Fast I2V](https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/fast/image-to-video/api)
- [Seedance v1 Pro Fast T2V](https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/fast/text-to-video/api)

### Documentation
- [FAL AI API Documentation](https://fal.ai/docs)

## Implementation Date
- **Initial Documentation**: 2025-10-29
- **Last Updated**: 2025-01-29 (Added 3 additional models for future integration)

## Status

### Hailuo 2.3 Image-to-Video Models
✅ **COMPLETED** - All three I2V models fully integrated
- ✅ Model configurations added to `ai-constants.ts`
- ✅ Client function `generateVideoFromImage()` supports all models
- ✅ FAL API integration working
- ✅ Pricing configured correctly

### Hailuo 2.3 Text-to-Video Models
⏳ **DOCUMENTED** - Implementation pending

**Documentation Status:**
- ✅ API endpoints researched and documented
- ✅ Pricing structure documented
- ✅ Parameter requirements documented
- ✅ File paths identified
- ✅ Implementation subtasks defined (5 subtasks, 50-75 min total)
- ✅ Long-term support considerations documented
- ✅ Backward compatibility rules established

**Implementation Status:**
- ⏳ Model configurations not yet added to `ai-constants.ts`
- ⏳ `generateVideoFromText()` function not yet implemented
- ⏳ UI components not yet updated
- ⏳ Tests not yet written

### Additional Models (Future Integration)
📋 **DOCUMENTED** - Ready for future implementation

**Models Added:**
1. **Vidu Q2 Turbo** (Image-to-Video)
   - Resolution: 720p/1080p
   - Duration: 2-8 seconds
   - Pricing: $0.05/s (720p), $0.20 base + $0.05/s (1080p)
   - Special: Movement amplitude control, BGM support

2. **Seedance v1 Pro Fast** (Image-to-Video)
   - Resolution: 480p/720p/1080p
   - Duration: 2-12 seconds
   - Pricing: ~$0.243 (1080p 5s), token-based
   - Special: Camera lock, aspect ratio control, up to 12s duration

3. **Seedance v1 Pro Fast** (Text-to-Video)
   - Resolution: 480p/720p/1080p
   - Duration: 2-12 seconds
   - Pricing: ~$0.245 (1080p 5s), token-based
   - Special: Camera lock, aspect ratio control, up to 12s duration

**Documentation Status:**
- ✅ API endpoints documented
- ✅ Pricing structure documented
- ✅ Parameter specifications documented
- ✅ Special features identified
- ✅ FAL API references added

**Implementation Status:**
- ⏳ Not yet added to codebase
- ⏳ Awaiting prioritization for implementation
- ⏳ Can be implemented using same patterns as Hailuo 2.3 models

### Next Steps
1. Review and approve this documentation
2. Create feature branch for T2V implementation
3. Execute Subtask 1: Add model configurations (5-10 min)
4. Execute Subtask 2: Implement client function (15-20 min)
5. Execute Subtask 3: Update UI components (10-15 min)
6. Execute Subtask 4: Add validation (5-10 min)
7. Execute Subtask 5: Write tests (15-20 min)
8. Run post-implementation validation checklist
9. Create pull request with all changes
