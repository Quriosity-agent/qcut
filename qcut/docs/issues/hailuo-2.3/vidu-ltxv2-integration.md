# Vidu Q2 & LTX Video 2.0 Integration

Documentation for integrating two additional AI video models into QCut:
1. **Vidu Q2 Image-to-Video Turbo** - High-quality I2V with motion control
2. **LTX Video 2.0 Pro** - Text-to-video with audio generation

---

## Implementation Subtasks

### Subtask 1: Add Model Configurations (5-10 minutes)
**Current Status:** ✅ Implemented
**Location:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

Add two new model configurations to the `AI_MODELS` array:

```typescript
// Vidu Q2 Image-to-Video Turbo
{
  id: "vidu_q2_turbo_i2v",
  name: "Vidu Q2 Turbo I2V",
  description: "High-quality image-to-video with motion control (2-8s)",
  price: "0.05", // $0.05/second for 720p
  resolution: "720p",
  max_duration: 8,
  category: "image",
  endpoints: {
    image_to_video: "fal-ai/vidu/q2/image-to-video/turbo",
  },
  default_params: {
    duration: 4,
    resolution: "720p",
    movement_amplitude: "auto",
  },
},

// LTX Video 2.0 Pro Text-to-Video
{
  id: "ltxv2_pro_t2v",
  name: "LTX Video 2.0 Pro T2V",
  description: "Text-to-video with audio generation (6-10s, up to 4K)",
  price: "0.06", // $0.06/second for 1080p
  resolution: "1080p",
  max_duration: 10,
  category: "text",
  endpoints: {
    text_to_video: "fal-ai/ltxv-2/text-to-video",
  },
  default_params: {
    duration: 6,
    resolution: "1080p",
    aspect_ratio: "16:9",
    fps: 25,
    generate_audio: true,
  },
},

// LTX Video 2.0 Fast Image-to-Video
{
  id: "ltxv2_fast_i2v",
  name: "LTX Video 2.0 Fast I2V",
  description: "Image-to-video with audio generation (2-6s, up to 1080p)",
  price: "0.05", // $0.05/second for 1080p
  resolution: "1080p",
  max_duration: 6,
  category: "image",
  endpoints: {
    image_to_video: "fal-ai/ltxv-2/image-to-video/fast",
  },
  default_params: {
    duration: 4,
    resolution: "1080p",
    aspect_ratio: "16:9",
    fps: 25,
    generate_audio: true,
  },
  supportedResolutions: ["720p", "1080p"],
},
```

**Add error messages** (in `ERROR_MESSAGES` object):

```typescript
// Vidu Q2 errors
VIDU_Q2_PROMPT_TOO_LONG: "Prompt exceeds 3000 character limit for Vidu Q2",
VIDU_Q2_INVALID_DURATION: "Duration must be between 2 and 8 seconds for Vidu Q2",
VIDU_Q2_MISSING_IMAGE: "Image is required for Vidu Q2 image-to-video generation",

// LTX Video 2.0 errors
LTXV2_INVALID_DURATION: "Duration must be 6, 8, or 10 seconds for LTX Video 2.0",
LTXV2_INVALID_RESOLUTION: "Resolution must be 1080p, 1440p, or 2160p for LTX Video 2.0",
LTXV2_EMPTY_PROMPT: "Please enter a text prompt for LTX Video 2.0",
LTXV2_I2V_INVALID_DURATION: "Duration must be between 2 and 6 seconds for LTX Video 2.0 Fast",
LTXV2_I2V_INVALID_RESOLUTION: "Resolution must be 720p or 1080p for LTX Video 2.0 Fast",
LTXV2_I2V_MISSING_IMAGE: "Image is required for LTX Video 2.0 Fast image-to-video generation",
```

#### Review & Comments
- `AI_MODELS` now includes `vidu_q2_turbo_i2v`, `ltxv2_pro_t2v`, and `ltxv2_fast_i2v` after the Hailuo entries (`ai-constants.ts:135`), keeping category filters intact.
- The matching Vidu/LTX validation messages were appended to the shared `ERROR_MESSAGES` map (`ai-constants.ts:688`), so UI surfaces model-specific guidance.
- `supportedResolutions` on the LTX entries advertise the available tiers; update when Fal publishes pricing changes.

---

### Subtask 2: Implement Client Functions (20-30 minutes)
**Current Status:** ✅ Implemented
**Location:** `qcut/apps/web/src/lib/ai-video-client.ts`

#### A) Add TypeScript Interfaces

Add after the existing `TextToVideoRequest` interface (around line 310):

```typescript
// Vidu Q2 Image-to-Video Request
export interface ViduQ2I2VRequest {
  model: string;
  prompt: string;
  image_url: string;
  duration?: 2 | 3 | 4 | 5 | 6 | 7 | 8;
  resolution?: "720p" | "1080p";
  movement_amplitude?: "auto" | "small" | "medium" | "large";
  bgm?: boolean;
  seed?: number;
}

// LTX Video 2.0 Text-to-Video Request
export interface LTXV2T2VRequest {
  model: string;
  prompt: string;
  duration?: 6 | 8 | 10;
  resolution?: "1080p" | "1440p" | "2160p";
  aspect_ratio?: "16:9";
  fps?: 25 | 50;
  generate_audio?: boolean;
}
```

#### B) Add Validation Helpers

Add before the main functions (around line 1220):

```typescript
// Vidu Q2 validation
function validateViduQ2Prompt(prompt: string): void {
  if (prompt.length > 3000) {
    throw new Error(
      `Prompt too long for Vidu Q2. Maximum 3000 characters allowed (current: ${prompt.length})`
    );
  }
}

function isViduQ2Model(modelId: string): boolean {
  return modelId === "vidu_q2_turbo_i2v";
}

// LTX Video 2.0 validation
function validateLTXV2Duration(duration: number): void {
  if (![6, 8, 10].includes(duration)) {
    throw new Error("Duration must be 6, 8, or 10 seconds for LTX Video 2.0");
  }
}

function validateLTXV2Resolution(resolution: string): void {
  if (!["1080p", "1440p", "2160p"].includes(resolution)) {
    throw new Error("Resolution must be 1080p, 1440p, or 2160p for LTX Video 2.0");
  }
}

function isLTXV2Model(modelId: string): boolean {
  return modelId === "ltxv2_pro_t2v";
}
```

#### C) Implement Vidu Q2 I2V Function

Add after `generateVideoFromImage` function:

```typescript
/**
 * Generate video from image using Vidu Q2 Turbo
 */
export async function generateViduQ2Video(
  request: ViduQ2I2VRequest
): Promise<VideoGenerationResponse> {
  try {
    if (!FAL_API_KEY) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt.trim();

    // Get model configuration
    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    // Validate inputs
    if (!trimmedPrompt) {
      throw new Error("Text prompt is required for Vidu Q2 video generation");
    }

    if (!request.image_url) {
      throw new Error("Image URL is required for Vidu Q2 image-to-video generation");
    }

    validateViduQ2Prompt(trimmedPrompt);

    if (request.duration !== undefined && (request.duration < 2 || request.duration > 8)) {
      throw new Error("Duration must be between 2 and 8 seconds for Vidu Q2");
    }

    // Build payload
    const payload: Record<string, any> = {
      prompt: trimmedPrompt,
      image_url: request.image_url,
      duration: request.duration ?? 4,
      resolution: request.resolution ?? "720p",
      movement_amplitude: request.movement_amplitude ?? "auto",
    };

    // Only add bgm for 4-second videos
    if (request.bgm !== undefined && request.duration === 4) {
      payload.bgm = request.bgm;
    }

    if (request.seed !== undefined) {
      payload.seed = request.seed;
    }

    // Make API call to FAL
    const endpoint = modelConfig.endpoints.image_to_video;
    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // Error handling
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error("Invalid FAL.ai API key. Please check your API key configuration.");
      }

      if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }

      throw new Error(`FAL API error: ${errorData.detail || response.statusText}`);
    }

    const result = await response.json();
    return {
      job_id: generateJobId(),
      status: "completed",
      message: `Video generated successfully with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.video,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate Vidu Q2 video", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateViduQ2Video",
    });
    throw error;
  }
}
```

#### D) Implement LTX Video 2.0 T2V Function

Add after the Vidu Q2 function:

```typescript
/**
 * Generate video with audio from text using LTX Video 2.0 Pro
 */
export async function generateLTXV2Video(
  request: LTXV2T2VRequest
): Promise<VideoGenerationResponse> {
  try {
    if (!FAL_API_KEY) {
      throw new Error("FAL API key not configured");
    }

    const trimmedPrompt = request.prompt.trim();

    // Get model configuration
    const modelConfig = getModelConfig(request.model);
    if (!modelConfig) {
      throw new Error(`Unknown model: ${request.model}`);
    }

    // Check text-to-video support
    const endpoint = modelConfig.endpoints.text_to_video;
    if (!endpoint) {
      throw new Error(
        `Model ${request.model} does not support text-to-video generation`
      );
    }

    // Validate prompt
    if (!trimmedPrompt) {
      throw new Error("Text prompt is required for LTX Video 2.0");
    }

    // Validate duration and resolution
    if (request.duration !== undefined) {
      validateLTXV2Duration(request.duration);
    }

    if (request.resolution !== undefined) {
      validateLTXV2Resolution(request.resolution);
    }

    // Build payload
    const payload: Record<string, any> = {
      prompt: trimmedPrompt,
      duration: request.duration ?? 6,
      resolution: request.resolution ?? "1080p",
      aspect_ratio: request.aspect_ratio ?? "16:9",
      fps: request.fps ?? 25,
      generate_audio: request.generate_audio ?? true,
    };

    // Make API call to FAL
    const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // Error handling
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      if (response.status === 401) {
        throw new Error("Invalid FAL.ai API key. Please check your API key configuration.");
      }

      if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }

      throw new Error(`FAL API error: ${errorData.detail || response.statusText}`);
    }

    const result = await response.json();
    return {
      job_id: generateJobId(),
      status: "completed",
      message: `Video with audio generated successfully with ${request.model}`,
      estimated_time: 0,
      video_url: result.video?.url || result.url,
      video_data: result,
    };
  } catch (error) {
    handleAIServiceError(error, "Generate LTX Video 2.0", {
      model: request.model,
      prompt: request.prompt?.substring(0, 100),
      operation: "generateLTXV2Video",
    });
    throw error;
  }
}
```

#### Review & Comments
- `ViduQ2I2VRequest` and `LTXV2T2VRequest` ship alongside the existing request interfaces (`ai-video-client.ts:301`), so downstream imports can stay centralised.
- `generateViduQ2Video`/`generateLTXV2Video` now bridge the gap between the Hailuo text handler and avatar flow (`ai-video-client.ts:1348`), reusing `generateJobId` plus `handleAIServiceError` for consistent logging.
- Validation helpers guard prompt length, duration windows, resolution bands, and align with the new `ERROR_MESSAGES`; extend them if future variants arrive.

---

### Subtask 3: Update UI Components (15-20 minutes)
**Current Status:** ✅ Implemented

#### A) Add Type Definitions

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai-types.ts`

Add new props after existing Hailuo props:

```typescript
export interface UseAIGenerationProps {
  // ... existing props ...

  // Vidu Q2 options
  viduQ2Duration?: 2 | 3 | 4 | 5 | 6 | 7 | 8;
  viduQ2Resolution?: "720p" | "1080p";
  viduQ2MovementAmplitude?: "auto" | "small" | "medium" | "large";
  viduQ2EnableBGM?: boolean;

  // LTX Video 2.0 options
  ltxv2Duration?: 6 | 8 | 10;
  ltxv2Resolution?: "1080p" | "1440p" | "2160p";
  ltxv2FPS?: 25 | 50;
  ltxv2GenerateAudio?: boolean;
}
```

#### B) Update Hook Logic

**File:** `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

Add imports:

```typescript
import {
  generateVideo,
  generateVideoFromImage,
  generateVideoFromText,
  generateViduQ2Video,     // NEW
  generateLTXV2Video,       // NEW
  generateAvatarVideo,
} from "@/lib/ai-video-client";
```

Add default values in hook:

```typescript
export function useAIGeneration(props: UseAIGenerationProps) {
  const {
    // ... existing props ...
    viduQ2Duration = 4,
    viduQ2Resolution = "720p",
    viduQ2MovementAmplitude = "auto",
    viduQ2EnableBGM = false,
    ltxv2Duration = 6,
    ltxv2Resolution = "1080p",
    ltxv2FPS = 25,
    ltxv2GenerateAudio = true,
  } = props;
```

Add Vidu Q2 logic in the image-to-video section:

```typescript
// In the image-to-video section, add before existing models:
if (modelId === "vidu_q2_turbo_i2v") {
  const friendlyName = modelName || modelId;
  progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${friendlyName} request...`,
  });

  const viduRequest = {
    model: modelId,
    prompt: prompt.trim(),
    image_url: mediaUrl,
    duration: viduQ2Duration,
    resolution: viduQ2Resolution,
    movement_amplitude: viduQ2MovementAmplitude,
    bgm: viduQ2Duration === 4 ? viduQ2EnableBGM : undefined,
  };

  response = await generateViduQ2Video(viduRequest);

  progressCallback({
    status: "completed",
    progress: 100,
    message: `Video generated with ${friendlyName}`,
  });
}
```

Add LTX Video 2.0 logic in the text-to-video section:

```typescript
// In the text-to-video section, add after Hailuo models:
else if (modelId === "ltxv2_pro_t2v") {
  const friendlyName = modelName || modelId;
  progressCallback({
    status: "processing",
    progress: 10,
    message: `Submitting ${friendlyName} request...`,
  });

  const ltxRequest = {
    model: modelId,
    prompt: prompt.trim(),
    duration: ltxv2Duration,
    resolution: ltxv2Resolution,
    fps: ltxv2FPS,
    generate_audio: ltxv2GenerateAudio,
  };

  response = await generateLTXV2Video(ltxRequest);

  progressCallback({
    status: "completed",
    progress: 100,
    message: `Video with audio generated using ${friendlyName}`,
  });
}
```

#### C) Add UI Controls

**File:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

Add state management:

```typescript
export function AiView() {
  // ... existing state ...

  // Vidu Q2 state
  const [viduQ2Duration, setViduQ2Duration] = useState<2 | 3 | 4 | 5 | 6 | 7 | 8>(4);
  const [viduQ2Resolution, setViduQ2Resolution] = useState<"720p" | "1080p">("720p");
  const [viduQ2MovementAmplitude, setViduQ2MovementAmplitude] = useState<"auto" | "small" | "medium" | "large">("auto");
  const [viduQ2EnableBGM, setViduQ2EnableBGM] = useState(false);

  // LTX Video 2.0 state
  const [ltxv2Duration, setLTXV2Duration] = useState<6 | 8 | 10>(6);
  const [ltxv2Resolution, setLTXV2Resolution] = useState<"1080p" | "1440p" | "2160p">("1080p");
  const [ltxv2FPS, setLTXV2FPS] = useState<25 | 50>(25);
  const [ltxv2GenerateAudio, setLTXV2GenerateAudio] = useState(true);

  // Model selection helpers
  const viduQ2Selected = selectedModels.includes("vidu_q2_turbo_i2v");
  const ltxv2Selected = selectedModels.includes("ltxv2_pro_t2v");

  // Pass to hook
  const { isGenerating, /* ... */ } = useAIGeneration({
    // ... existing props ...
    viduQ2Duration,
    viduQ2Resolution,
    viduQ2MovementAmplitude,
    viduQ2EnableBGM,
    ltxv2Duration,
    ltxv2Resolution,
    ltxv2FPS,
    ltxv2GenerateAudio,
  });
```

Add UI controls for Vidu Q2 (in the render section):

```tsx
{viduQ2Selected && (
  <div className="space-y-3 text-left border-t pt-3">
    <Label className="text-sm font-semibold">Vidu Q2 Turbo Settings</Label>

    {/* Duration selector */}
    <div className="space-y-1">
      <Label htmlFor="vidu-duration" className="text-xs font-medium">
        Duration
      </Label>
      <Select
        value={viduQ2Duration.toString()}
        onValueChange={(value) => setViduQ2Duration(Number(value) as 2 | 3 | 4 | 5 | 6 | 7 | 8)}
      >
        <SelectTrigger id="vidu-duration" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="2">2 seconds</SelectItem>
          <SelectItem value="3">3 seconds</SelectItem>
          <SelectItem value="4">4 seconds</SelectItem>
          <SelectItem value="5">5 seconds</SelectItem>
          <SelectItem value="6">6 seconds</SelectItem>
          <SelectItem value="7">7 seconds</SelectItem>
          <SelectItem value="8">8 seconds</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* Resolution selector */}
    <div className="space-y-1">
      <Label htmlFor="vidu-resolution" className="text-xs font-medium">
        Resolution
      </Label>
      <Select
        value={viduQ2Resolution}
        onValueChange={(value) => setViduQ2Resolution(value as "720p" | "1080p")}
      >
        <SelectTrigger id="vidu-resolution" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="720p">720p ($0.05/sec)</SelectItem>
          <SelectItem value="1080p">1080p ($0.20 + $0.05/sec)</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* Movement amplitude */}
    <div className="space-y-1">
      <Label htmlFor="vidu-movement" className="text-xs font-medium">
        Movement Amplitude
      </Label>
      <Select
        value={viduQ2MovementAmplitude}
        onValueChange={(value) => setViduQ2MovementAmplitude(value as "auto" | "small" | "medium" | "large")}
      >
        <SelectTrigger id="vidu-movement" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Auto</SelectItem>
          <SelectItem value="small">Small</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="large">Large</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* BGM option (only for 4-second videos) */}
    {viduQ2Duration === 4 && (
      <div className="flex items-center space-x-2">
        <Checkbox
          id="vidu-bgm"
          checked={viduQ2EnableBGM}
          onCheckedChange={(checked) => setViduQ2EnableBGM(checked as boolean)}
        />
        <Label htmlFor="vidu-bgm" className="text-xs cursor-pointer">
          Add background music
        </Label>
      </div>
    )}
  </div>
)}
```

Add UI controls for LTX Video 2.0:

```tsx
{ltxv2Selected && (
  <div className="space-y-3 text-left border-t pt-3">
    <Label className="text-sm font-semibold">LTX Video 2.0 Pro Settings</Label>

    {/* Duration selector */}
    <div className="space-y-1">
      <Label htmlFor="ltxv2-duration" className="text-xs font-medium">
        Duration
      </Label>
      <Select
        value={ltxv2Duration.toString()}
        onValueChange={(value) => setLTXV2Duration(Number(value) as 6 | 8 | 10)}
      >
        <SelectTrigger id="ltxv2-duration" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="6">6 seconds</SelectItem>
          <SelectItem value="8">8 seconds</SelectItem>
          <SelectItem value="10">10 seconds</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* Resolution selector */}
    <div className="space-y-1">
      <Label htmlFor="ltxv2-resolution" className="text-xs font-medium">
        Resolution
      </Label>
      <Select
        value={ltxv2Resolution}
        onValueChange={(value) => setLTXV2Resolution(value as "1080p" | "1440p" | "2160p")}
      >
        <SelectTrigger id="ltxv2-resolution" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1080p">1080p ($0.06/sec)</SelectItem>
          <SelectItem value="1440p">1440p ($0.12/sec)</SelectItem>
          <SelectItem value="2160p">4K ($0.24/sec)</SelectItem>
        </SelectContent>
      </Select>
      <div className="text-xs text-muted-foreground">
        Cost: ${(ltxv2Duration * (ltxv2Resolution === "1080p" ? 0.06 : ltxv2Resolution === "1440p" ? 0.12 : 0.24)).toFixed(2)}
      </div>
    </div>

    {/* Frame rate selector */}
    <div className="space-y-1">
      <Label htmlFor="ltxv2-fps" className="text-xs font-medium">
        Frame Rate
      </Label>
      <Select
        value={ltxv2FPS.toString()}
        onValueChange={(value) => setLTXV2FPS(Number(value) as 25 | 50)}
      >
        <SelectTrigger id="ltxv2-fps" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="25">25 FPS</SelectItem>
          <SelectItem value="50">50 FPS</SelectItem>
        </SelectContent>
      </Select>
    </div>

    {/* Audio generation toggle */}
    <div className="flex items-center space-x-2">
      <Checkbox
        id="ltxv2-audio"
        checked={ltxv2GenerateAudio}
        onCheckedChange={(checked) => setLTXV2GenerateAudio(checked as boolean)}
      />
      <Label htmlFor="ltxv2-audio" className="text-xs cursor-pointer">
        Generate audio
      </Label>
    </div>

    <div className="text-xs text-muted-foreground">
      LTX Video 2.0 generates videos with synchronized audio from text prompts.
    </div>
  </div>
)}
```

#### Review & Comments
- `UseAIGenerationProps` now carries the Vidu/LTX knobs (`ai-types.ts:78`), and the hook forwards their defaults into the new client calls.
- `use-ai-generation.ts` imports the fresh helpers and routes Vidu/LTX requests with custom progress feedback (`use-ai-generation.ts:612`), while keeping the legacy fallback intact.
- `ai.tsx` exposes state + UI controls for both models (duration, resolution, motion, audio) so the new options appear alongside the existing panels without disturbing Sora/Veo layouts.

---

### Subtask 4: Write Tests (20-25 minutes)
**Current Status:** ✅ Implemented
**Location:** Create new file `qcut/apps/web/src/lib/__tests__/ai-video-client-additional.test.ts`

Create comprehensive test suite:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateViduQ2Video, generateLTXV2Video } from "@/lib/ai-video-client";
import type { ViduQ2I2VRequest, LTXV2T2VRequest } from "@/lib/ai-video-client";

const originalFetch = globalThis.fetch;

describe("Additional AI Video Models", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_FAL_API_KEY", "test-api-key");
    globalThis.fetch = originalFetch as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch as typeof globalThis.fetch;
  });

  describe("Vidu Q2 Turbo I2V", () => {
    describe("Prompt Validation", () => {
      it("should reject prompts exceeding 3000 characters", async () => {
        const longPrompt = "A".repeat(3001);
        const request: ViduQ2I2VRequest = {
          model: "vidu_q2_turbo_i2v",
          prompt: longPrompt,
          image_url: "https://example.com/image.jpg",
          duration: 4,
        };

        await expect(generateViduQ2Video(request)).rejects.toThrow(
          /Prompt too long.*Maximum 3000 characters/
        );
      });

      it("should accept prompts within 3000 character limit", async () => {
        const validPrompt = "A".repeat(3000);
        const request: ViduQ2I2VRequest = {
          model: "vidu_q2_turbo_i2v",
          prompt: validPrompt,
          image_url: "https://example.com/image.jpg",
          duration: 4,
        };

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
        });
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        const result = await generateViduQ2Video(request);
        expect(result.status).toBe("completed");
        expect(result.video_url).toBeTruthy();
      });

      it("should reject empty prompts", async () => {
        const request: ViduQ2I2VRequest = {
          model: "vidu_q2_turbo_i2v",
          prompt: "",
          image_url: "https://example.com/image.jpg",
          duration: 4,
        };

        await expect(generateViduQ2Video(request)).rejects.toThrow(
          /Text prompt is required/
        );
      });

      it("should reject missing image URL", async () => {
        const request: ViduQ2I2VRequest = {
          model: "vidu_q2_turbo_i2v",
          prompt: "A peaceful scene",
          image_url: "",
          duration: 4,
        };

        await expect(generateViduQ2Video(request)).rejects.toThrow(
          /Image URL is required/
        );
      });
    });

    describe("Duration Handling", () => {
      it("should accept durations from 2 to 8 seconds", async () => {
        const durations = [2, 3, 4, 5, 6, 7, 8] as const;

        for (const duration of durations) {
          const request: ViduQ2I2VRequest = {
            model: "vidu_q2_turbo_i2v",
            prompt: "Test prompt",
            image_url: "https://example.com/image.jpg",
            duration,
          };

          const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
          });
          globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

          const result = await generateViduQ2Video(request);
          expect(result.status).toBe("completed");

          const [, options] = fetchMock.mock.calls[0];
          const payload = JSON.parse((options as Record<string, unknown>).body as string);
          expect(payload.duration).toBe(duration);
        }
      });

      it("should reject duration less than 2 seconds", async () => {
        const request: ViduQ2I2VRequest = {
          model: "vidu_q2_turbo_i2v",
          prompt: "Test prompt",
          image_url: "https://example.com/image.jpg",
          duration: 1 as any,
        };

        await expect(generateViduQ2Video(request)).rejects.toThrow(
          /Duration must be between 2 and 8 seconds/
        );
      });

      it("should reject duration greater than 8 seconds", async () => {
        const request: ViduQ2I2VRequest = {
          model: "vidu_q2_turbo_i2v",
          prompt: "Test prompt",
          image_url: "https://example.com/image.jpg",
          duration: 9 as any,
        };

        await expect(generateViduQ2Video(request)).rejects.toThrow(
          /Duration must be between 2 and 8 seconds/
        );
      });
    });

    describe("Resolution and Movement", () => {
      it("should include resolution in payload", async () => {
        const request: ViduQ2I2VRequest = {
          model: "vidu_q2_turbo_i2v",
          prompt: "Test prompt",
          image_url: "https://example.com/image.jpg",
          resolution: "1080p",
        };

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
        });
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        await generateViduQ2Video(request);

        const [, options] = fetchMock.mock.calls[0];
        const payload = JSON.parse((options as Record<string, unknown>).body as string);
        expect(payload.resolution).toBe("1080p");
      });

      it("should include movement_amplitude in payload", async () => {
        const request: ViduQ2I2VRequest = {
          model: "vidu_q2_turbo_i2v",
          prompt: "Test prompt",
          image_url: "https://example.com/image.jpg",
          movement_amplitude: "large",
        };

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
        });
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        await generateViduQ2Video(request);

        const [, options] = fetchMock.mock.calls[0];
        const payload = JSON.parse((options as Record<string, unknown>).body as string);
        expect(payload.movement_amplitude).toBe("large");
      });
    });

    describe("BGM Handling", () => {
      it("should include bgm option for 4-second videos", async () => {
        const request: ViduQ2I2VRequest = {
          model: "vidu_q2_turbo_i2v",
          prompt: "Test prompt",
          image_url: "https://example.com/image.jpg",
          duration: 4,
          bgm: true,
        };

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
        });
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        await generateViduQ2Video(request);

        const [, options] = fetchMock.mock.calls[0];
        const payload = JSON.parse((options as Record<string, unknown>).body as string);
        expect(payload.bgm).toBe(true);
      });

      it("should not include bgm for non-4-second videos", async () => {
        const request: ViduQ2I2VRequest = {
          model: "vidu_q2_turbo_i2v",
          prompt: "Test prompt",
          image_url: "https://example.com/image.jpg",
          duration: 5,
          bgm: true,
        };

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
        });
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        await generateViduQ2Video(request);

        const [, options] = fetchMock.mock.calls[0];
        const payload = JSON.parse((options as Record<string, unknown>).body as string);
        expect(payload.bgm).toBeUndefined();
      });
    });

    describe("Endpoint", () => {
      it("should use correct endpoint for Vidu Q2 Turbo", async () => {
        const request: ViduQ2I2VRequest = {
          model: "vidu_q2_turbo_i2v",
          prompt: "Test prompt",
          image_url: "https://example.com/image.jpg",
        };

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
        });
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        await generateViduQ2Video(request);

        const [callUrl] = fetchMock.mock.calls[0];
        expect(callUrl).toContain("fal-ai/vidu/q2/image-to-video/turbo");
      });
    });
  });

  describe("LTX Video 2.0 Pro T2V", () => {
    describe("Prompt Validation", () => {
      it("should reject empty prompts", async () => {
        const request: LTXV2T2VRequest = {
          model: "ltxv2_pro_t2v",
          prompt: "",
          duration: 6,
        };

        await expect(generateLTXV2Video(request)).rejects.toThrow(
          /Text prompt is required/
        );
      });

      it("should accept valid prompts", async () => {
        const request: LTXV2T2VRequest = {
          model: "ltxv2_pro_t2v",
          prompt: "A cowboy walking through a dusty town",
          duration: 6,
        };

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
        });
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        const result = await generateLTXV2Video(request);
        expect(result.status).toBe("completed");
        expect(result.video_url).toBeTruthy();
      });
    });

    describe("Duration Validation", () => {
      it("should accept valid durations (6, 8, 10)", async () => {
        const durations = [6, 8, 10] as const;

        for (const duration of durations) {
          const request: LTXV2T2VRequest = {
            model: "ltxv2_pro_t2v",
            prompt: "Test prompt",
            duration,
          };

          const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
          });
          globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

          const result = await generateLTXV2Video(request);
          expect(result.status).toBe("completed");

          const [, options] = fetchMock.mock.calls[0];
          const payload = JSON.parse((options as Record<string, unknown>).body as string);
          expect(payload.duration).toBe(duration);
        }
      });

      it("should reject invalid durations", async () => {
        const request: LTXV2T2VRequest = {
          model: "ltxv2_pro_t2v",
          prompt: "Test prompt",
          duration: 5 as any,
        };

        await expect(generateLTXV2Video(request)).rejects.toThrow(
          /Duration must be 6, 8, or 10 seconds/
        );
      });
    });

    describe("Resolution Validation", () => {
      it("should accept valid resolutions (1080p, 1440p, 2160p)", async () => {
        const resolutions = ["1080p", "1440p", "2160p"] as const;

        for (const resolution of resolutions) {
          const request: LTXV2T2VRequest = {
            model: "ltxv2_pro_t2v",
            prompt: "Test prompt",
            resolution,
          };

          const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
          });
          globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

          const result = await generateLTXV2Video(request);
          expect(result.status).toBe("completed");

          const [, options] = fetchMock.mock.calls[0];
          const payload = JSON.parse((options as Record<string, unknown>).body as string);
          expect(payload.resolution).toBe(resolution);
        }
      });

      it("should reject invalid resolutions", async () => {
        const request: LTXV2T2VRequest = {
          model: "ltxv2_pro_t2v",
          prompt: "Test prompt",
          resolution: "720p" as any,
        };

        await expect(generateLTXV2Video(request)).rejects.toThrow(
          /Resolution must be 1080p, 1440p, or 2160p/
        );
      });
    });

    describe("FPS and Audio Generation", () => {
      it("should include fps in payload", async () => {
        const request: LTXV2T2VRequest = {
          model: "ltxv2_pro_t2v",
          prompt: "Test prompt",
          fps: 50,
        };

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
        });
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        await generateLTXV2Video(request);

        const [, options] = fetchMock.mock.calls[0];
        const payload = JSON.parse((options as Record<string, unknown>).body as string);
        expect(payload.fps).toBe(50);
      });

      it("should include generate_audio option", async () => {
        const request: LTXV2T2VRequest = {
          model: "ltxv2_pro_t2v",
          prompt: "Test prompt",
          generate_audio: false,
        };

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
        });
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        await generateLTXV2Video(request);

        const [, options] = fetchMock.mock.calls[0];
        const payload = JSON.parse((options as Record<string, unknown>).body as string);
        expect(payload.generate_audio).toBe(false);
      });
    });

    describe("Endpoint", () => {
      it("should use correct endpoint for LTX Video 2.0", async () => {
        const request: LTXV2T2VRequest = {
          model: "ltxv2_pro_t2v",
          prompt: "Test prompt",
        };

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ video: { url: "https://example.com/video.mp4" } }),
        });
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        await generateLTXV2Video(request);

        const [callUrl] = fetchMock.mock.calls[0];
        expect(callUrl).toContain("fal-ai/ltxv-2/text-to-video");
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle 401 errors for Vidu Q2", async () => {
      const request: ViduQ2I2VRequest = {
        model: "vidu_q2_turbo_i2v",
        prompt: "Test prompt",
        image_url: "https://example.com/image.jpg",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ detail: "Invalid API key" }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await expect(generateViduQ2Video(request)).rejects.toThrow(
        /Invalid FAL.ai API key/
      );
    });

    it("should handle 401 errors for LTX Video 2.0", async () => {
      const request: LTXV2T2VRequest = {
        model: "ltxv2_pro_t2v",
        prompt: "Test prompt",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ detail: "Invalid API key" }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await expect(generateLTXV2Video(request)).rejects.toThrow(
        /Invalid FAL.ai API key/
      );
    });
  });
});
```

#### Review & Comments
- `ai-video-client-additional.test.ts` now lives in `qcut/apps/web/src/lib/__tests__`, covering prompt validation, payload shaping, and BGM/audio handling for Vidu Q2 plus the new LTX V2 fast image-to-video helper.
- Tests stub `VITE_FAL_API_KEY` plus `global.fetch`, matching the existing suite conventions so no shared harness changes were required.
- Local `bun` binary is missing (`bun run check-types` failed); re-run `bun run test ai-video-client-additional.test.ts` once the CLI is available.

---

## Model Specifications

### 1. Vidu Q2 Image-to-Video Turbo

**Model ID:** `fal-ai/vidu/q2/image-to-video/turbo`

**Description:**
High-quality image-to-video generation with motion control. The Q2 variant offers much better quality and control over video generation.

**Category:** Image-to-Video

**API Parameters:**

| Parameter | Type | Required | Options | Default | Description |
|-----------|------|----------|---------|---------|-------------|
| `prompt` | string | Yes | Max 3000 chars | - | Text description guiding video generation |
| `image_url` | string | Yes | Valid URL | - | Starting frame image URL |
| `duration` | integer | No | 2-8 seconds | 4 | Video length in seconds |
| `resolution` | string | No | 720p, 1080p | 720p | Output quality |
| `movement_amplitude` | string | No | auto, small, medium, large | auto | Motion intensity control |
| `bgm` | boolean | No | true/false | false | Background music (4-sec videos only) |
| `seed` | integer | No | Any integer | - | Random seed for reproducibility |

**Output Format:**
```typescript
{
  video: {
    url: string  // Direct download link to MP4
  }
}
```

**Pricing:**
- **720p:** $0.05 per second
- **1080p:** $0.20 base + $0.05 per second

**Examples:**
- 4-second 720p video: $0.20
- 8-second 720p video: $0.40
- 4-second 1080p video: $0.40
- 8-second 1080p video: $0.60

**Constraints:**
- Prompt: Max 3000 characters
- Duration: 2-8 seconds only
- BGM: Only available for 4-second videos
- Resolution: Max 1080p

---

### 2. LTX Video 2.0 Pro (Text-to-Video)

**Model ID:** `fal-ai/ltxv-2/text-to-video`

**Description:**
Create high-fidelity videos with synchronized audio from text prompts. Supports up to 4K resolution and generates matching background audio.

**Category:** Text-to-Video

**API Parameters:**

| Parameter | Type | Required | Options | Default | Description |
|-----------|------|----------|---------|---------|-------------|
| `prompt` | string | Yes | Any text | - | Text description of the video to generate |
| `duration` | integer | No | 6, 8, 10 seconds | 6 | Video length in seconds |
| `resolution` | string | No | 1080p, 1440p, 2160p | 1080p | Output quality (4K = 2160p) |
| `aspect_ratio` | string | No | 16:9 only | 16:9 | Video aspect ratio |
| `fps` | integer | No | 25, 50 | 25 | Frames per second |
| `generate_audio` | boolean | No | true/false | true | Generate synchronized audio |

**Output Format:**
```typescript
{
  video: {
    url: string           // Download URL
    file_name: string     // Generated filename
    content_type: string  // "video/mp4"
    width: number         // Video width in pixels
    height: number        // Video height in pixels
    duration: number      // Length in seconds
    fps: number           // Frames per second
    num_frames: number    // Total frame count
  }
}
```

**Pricing:**
- **1080p:** $0.06 per second
- **1440p:** $0.12 per second
- **2160p (4K):** $0.24 per second

**Examples:**
- 6-second 1080p: $0.36
- 8-second 1440p: $0.96
- 10-second 4K: $2.40

**Constraints:**
- Duration: Only 6, 8, or 10 seconds
- Aspect ratio: Only 16:9 supported
- FPS: Only 25 or 50
- Resolution: 1080p, 1440p, or 2160p only

**Features:**
- Audio generation synchronized with video content
- Up to 4K (2160p) resolution
- High frame rate option (50 FPS)
- Commercial use license

---

## Implementation Notes

### ADDITIVE-ONLY Approach
- No modifications to existing code
- All new functions and configurations
- Maintains backward compatibility
- Existing tests continue to pass

### File Organization
Follow the existing pattern established in the Hailuo 2.3 implementation:
1. Model configs in `ai-constants.ts`
2. Client functions in `ai-video-client.ts`
3. Type definitions in `ai-types.ts`
4. Hook logic in `use-ai-generation.ts`
5. UI components in `ai.tsx`
6. Tests in `__tests__/` directory

### Testing Strategy
- Comprehensive unit tests for both models
- Test all validation logic (prompts, duration, resolution)
- Test API parameter passing
- Test error handling (401, 429, etc.)
- Mock FAL API responses appropriately

### UI/UX Considerations
- **Vidu Q2:**
  - Show BGM option only when 4-second duration is selected
  - Display cost calculation based on resolution
  - Provide clear guidance on movement amplitude options

- **LTX Video 2.0:**
  - Display dynamic cost calculation (duration × resolution pricing)
  - Show audio generation toggle prominently
  - Clarify that higher resolution = higher cost
  - Explain FPS impact on quality vs. cost

---

## Cost Comparison

| Model | Duration | Resolution | Cost | Audio |
|-------|----------|-----------|------|-------|
| **Vidu Q2** | 4s | 720p | $0.20 | BGM only |
| **Vidu Q2** | 4s | 1080p | $0.40 | BGM only |
| **Vidu Q2** | 8s | 720p | $0.40 | No |
| **Vidu Q2** | 8s | 1080p | $0.60 | No |
| **LTX Video 2.0** | 6s | 1080p | $0.36 | Yes |
| **LTX Video 2.0** | 6s | 1440p | $0.72 | Yes |
| **LTX Video 2.0** | 6s | 2160p (4K) | $1.44 | Yes |
| **LTX Video 2.0** | 10s | 2160p (4K) | $2.40 | Yes |

---

## Future Enhancements

### Potential Features
1. **Vidu Q2:**
   - Extend BGM support beyond 4-second videos
   - Add more resolution options
   - Support custom seed presets for consistent style

2. **LTX Video 2.0:**
   - Support additional aspect ratios
   - Allow custom audio upload instead of generation
   - Add style presets for different video genres
   - Support longer durations (12s, 15s)

### Performance Optimizations
- Implement request queuing for multiple videos
- Add progress tracking for long generations
- Cache model configurations for faster lookups
- Batch similar requests when possible

---

## References

- [Vidu Q2 I2V Turbo API Documentation](https://fal.ai/models/fal-ai/vidu/q2/image-to-video/turbo/api)
- [LTX Video 2.0 Text-to-Video API Documentation](https://fal.ai/models/fal-ai/ltxv-2/text-to-video/api)
- [FAL.ai Client Library](https://github.com/fal-ai/fal-js)
- [Existing Hailuo 2.3 Integration](./hailuo-2.3-integration.md)
