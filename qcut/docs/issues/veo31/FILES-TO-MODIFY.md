# Veo 3.1 Integration - Detailed Code Modifications

**Quick Reference with Actual Code Examples**
**Last Updated:** 2025-10-20

This document provides detailed code snippets for all modifications needed to integrate **6 Veo 3.1 models** (3 Fast + 3 Standard). Each section shows EXACTLY what to add, modify, or delete based on the existing codebase patterns.

## Model Variants

**Fast Models** (50% cheaper, faster processing):
- `veo31_fast_text_to_video`: $0.10/s (no audio), $0.15/s (with audio)
- `veo31_fast_image_to_video`: $0.10/s (no audio), $0.15/s (with audio)
- `veo31_fast_frame_to_video`: $0.10/s (no audio), $0.15/s (with audio)

**Standard Models** (premium quality):
- `veo31_text_to_video`: $0.20/s (no audio), $0.40/s (with audio)
- `veo31_image_to_video`: $0.20/s (no audio), $0.40/s (with audio)
- `veo31_frame_to_video`: $0.20/s (no audio), $0.40/s (with audio)

---

## 📂 File 1: ai-constants.ts

**Path:** `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

### Task 1.1: Add Veo 3.1 Model Definitions (6 Models Total)

**Location:** Add after line 336 (after the last Sora 2 model, before the closing `];`)

**Code to ADD:**

```typescript
  // Veo 3.1 Models - Fast Variants (50% cheaper, faster processing)
  {
    id: "veo31_fast_text_to_video",
    name: "Veo 3.1 Fast Text-to-Video",
    description: "Google's Veo 3.1 Fast - Generate videos from text prompts (faster, budget-friendly)",
    price: "1.20", // 8s @ $0.15/s with audio (default)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"],
    max_duration: 8, // 4s, 6s, or 8s
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/veo3.1/fast",
    },
    default_params: {
      duration: "8s",
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: true,
      enhance_prompt: true,
      auto_fix: true,
    },
  },
  {
    id: "veo31_fast_image_to_video",
    name: "Veo 3.1 Fast Image-to-Video",
    description: "Google's Veo 3.1 Fast - Animate static images with motion (faster, budget-friendly)",
    price: "1.20", // 8s @ $0.15/s with audio (default)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"],
    max_duration: 8, // Currently only 8s supported
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/veo3.1/fast/image-to-video",
    },
    default_params: {
      duration: "8s",
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: true,
    },
  },
  {
    id: "veo31_fast_frame_to_video",
    name: "Veo 3.1 Fast Frame-to-Video",
    description: "Google's Veo 3.1 Fast - Animate between first and last frames (faster, budget-friendly)",
    price: "1.20", // 8s @ $0.15/s with audio (default)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"],
    max_duration: 8, // Currently only 8s supported
    category: "image", // Uses image tab (requires frame uploads)
    requiredInputs: ["firstFrame", "lastFrame"],
    endpoints: {
      text_to_video: "fal-ai/veo3.1/fast/first-last-frame-to-video",
    },
    default_params: {
      duration: "8s",
      resolution: "720p",
      aspect_ratio: "auto",
      generate_audio: true,
    },
  },

  // Veo 3.1 Models - Standard Variants (premium quality)
  {
    id: "veo31_text_to_video",
    name: "Veo 3.1 Text-to-Video",
    description: "Google's Veo 3.1 - Premium quality video generation from text prompts",
    price: "3.20", // 8s @ $0.40/s with audio (default)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"],
    max_duration: 8, // 4s, 6s, or 8s
    category: "text",
    endpoints: {
      text_to_video: "fal-ai/veo3.1", // No /fast suffix
    },
    default_params: {
      duration: "8s",
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: true,
      enhance_prompt: true,
      auto_fix: true,
    },
  },
  {
    id: "veo31_image_to_video",
    name: "Veo 3.1 Image-to-Video",
    description: "Google's Veo 3.1 - Premium quality image animation with motion",
    price: "3.20", // 8s @ $0.40/s with audio (default)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"],
    max_duration: 8, // Currently only 8s supported
    category: "image",
    endpoints: {
      image_to_video: "fal-ai/veo3.1/image-to-video", // No /fast
    },
    default_params: {
      duration: "8s",
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: true,
    },
  },
  {
    id: "veo31_frame_to_video",
    name: "Veo 3.1 Frame-to-Video",
    description: "Google's Veo 3.1 - Premium quality animation between first and last frames",
    price: "3.20", // 8s @ $0.40/s with audio (default)
    resolution: "720p / 1080p",
    supportedResolutions: ["720p", "1080p"],
    max_duration: 8, // Currently only 8s supported
    category: "image", // Uses image tab (requires frame uploads)
    requiredInputs: ["firstFrame", "lastFrame"],
    endpoints: {
      text_to_video: "fal-ai/veo3.1/first-last-frame-to-video", // No /fast
    },
    default_params: {
      duration: "8s",
      resolution: "720p",
      aspect_ratio: "auto",
      generate_audio: true,
    },
  },
```
> **Reviewer Comment:** `default_params.duration` should stay numeric (e.g., `8`) to satisfy the existing `AIModelParameters` type and match how Sora 2 models specify duration.

### Task 1.2: Add Veo 3.1 Upload Constants

**Location:** Add to `UPLOAD_CONSTANTS` object (around line 373)

**Code to ADD (inside UPLOAD_CONSTANTS object, after VIDEO_FORMATS_LABEL):**

```typescript
  // Veo 3.1 frame uploads (for frame-to-video model)
  MAX_VEO31_FRAME_SIZE_BYTES: 8 * 1024 * 1024, // 8MB (Veo 3.1 limit)
  MAX_VEO31_FRAME_SIZE_LABEL: "8MB",
  ALLOWED_VEO31_ASPECT_RATIOS: ["16:9", "9:16"],
```
> **Reviewer Comment:** Constants fit the existing upload pattern; no additional gaps spotted.

### Task 1.3: Add Veo 3.1 Error Messages

**Location:** Add to `ERROR_MESSAGES` object (around line 400)

**Code to ADD (inside ERROR_MESSAGES object, before closing}):**

```typescript
  VEO31_IMAGE_TOO_LARGE: "Image must be under 8MB for Veo 3.1",
  VEO31_INVALID_ASPECT_RATIO: "Veo 3.1 requires 16:9 or 9:16 aspect ratio for images",
  VEO31_MISSING_FIRST_FRAME: "First frame is required for Veo 3.1 frame-to-video",
  VEO31_MISSING_LAST_FRAME: "Last frame is required for Veo 3.1 frame-to-video",
  VEO31_FRAME_ASPECT_MISMATCH: "First and last frames must have matching aspect ratios",
```
> **Reviewer Comment:** Messages cover all new validation branches and align with current error wording.

---

## 📂 File 2: ai-generation.ts (NEW FILE)

**Path:** `qcut/apps/web/src/types/ai-generation.ts`

**Action:** CREATE NEW FILE

**Full File Content:**

```typescript
/**
 * Type definitions for AI video generation features
 * Including Veo 3.1 integration
 */

// ============================================
// Veo 3.1 Type Definitions
// ============================================

/**
 * Veo 3.1 Text-to-Video Input Parameters
 */
export interface Veo31TextToVideoInput {
  prompt: string; // Required: Text description for video
  aspect_ratio?: "9:16" | "16:9" | "1:1"; // Default: "16:9"
  duration?: "4s" | "6s" | "8s"; // Default: "8s"
  resolution?: "720p" | "1080p"; // Default: "720p"
  generate_audio?: boolean; // Default: true
  negative_prompt?: string; // Optional: What to avoid
  enhance_prompt?: boolean; // Default: true
  seed?: number; // For reproducibility
  auto_fix?: boolean; // Policy compliance, default: true
}

/**
 * Veo 3.1 Image-to-Video Input Parameters
 */
export interface Veo31ImageToVideoInput {
  prompt: string; // Required: Animation description
  image_url: string; // Required: Input image URL (720p+, 16:9 or 9:16)
  aspect_ratio?: "16:9" | "9:16"; // Default: "16:9"
  duration?: "8s"; // Currently only "8s" supported
  resolution?: "720p" | "1080p"; // Default: "720p"
  generate_audio?: boolean; // Default: true
}

/**
 * Veo 3.1 First-Last-Frame-to-Video Input Parameters
 */
export interface Veo31FrameToVideoInput {
  prompt: string; // Required: Animation description
  first_frame_url: string; // Required: Opening frame URL
  last_frame_url: string; // Required: Closing frame URL
  aspect_ratio?: "auto" | "9:16" | "16:9" | "1:1"; // Default: "auto"
  duration?: "8s"; // Currently only "8s" supported
  resolution?: "720p" | "1080p"; // Default: "720p"
  generate_audio?: boolean; // Default: true
}

/**
 * Veo 3.1 API Response
 */
export interface Veo31Response {
  video: {
    url: string;
    content_type: string;
    file_name: string;
  };
}

/**
 * Veo 3.1 Settings State
 */
export interface Veo31Settings {
  resolution: "720p" | "1080p";
  duration: "4s" | "6s" | "8s";
  aspectRatio: "9:16" | "16:9" | "1:1" | "auto";
  generateAudio: boolean;
  enhancePrompt: boolean;
  autoFix: boolean;
}

// ============================================
// Existing Generation Types (for reference)
// ============================================

export interface GeneratedVideo {
  jobId: string;
  videoUrl: string;
  videoPath?: string;
  fileSize?: number;
  duration?: number;
  prompt: string;
  model: string;
}

export interface GeneratedVideoResult {
  modelId: string;
  video: GeneratedVideo;
}
```
> **Reviewer Comment:** This shared Veo31Settings.duration union exposes 4s/6s to flows that only accept 8s, so we end up forcing casts later; let's either narrow it here or split per-mode settings to keep the types sound.

---

## 📂 File 3: fal-ai-client.ts

**Path:** `qcut/apps/web/src/lib/fal-ai-client.ts`

### Task 3.1: Import Veo 3.1 Types

**Location:** Add after line 7 (after existing imports)

**Code to ADD:**

```typescript
import type {
  Veo31TextToVideoInput,
  Veo31ImageToVideoInput,
  Veo31FrameToVideoInput,
  Veo31Response,
} from "@/types/ai-generation";
```
> **Reviewer Comment:** Once we add this import we must actually use `Veo31Response` (e.g. typing the `makeRequest` result), otherwise lint/TS will flag it as unused.

### Task 3.2: Add Veo 3.1 Client Methods (6 Methods Total)

**Location:** Add inside `FalAIClient` class, after line 500 (after `getModelCapabilities` method, before closing `}`)

**Code to ADD:**

```typescript
  // ============================================
  // Veo 3.1 FAST Methods (budget-friendly, faster)
  // ============================================

  /**
   * Generate video from text using Veo 3.1 Fast
   * @param params Veo 3.1 text-to-video parameters
   * @returns Generation result with video URL or error
   */
  async generateVeo31FastTextToVideo(
    params: Veo31TextToVideoInput
  ): Promise<GenerationResult> {
    try {
      const endpoint = "https://fal.run/fal-ai/veo3.1/fast";

      console.log("[Veo 3.1 Fast] Generating text-to-video with params:", params);

      const response = await this.makeRequest(endpoint, params);

      if (!response.video?.url) {
        throw new Error("No video URL in Veo 3.1 Fast response");
      }

      return {
        success: true,
        imageUrl: response.video.url, // Reusing imageUrl field for video URL
        metadata: {
          duration: params.duration || "8s",
          resolution: params.resolution || "720p",
          aspectRatio: params.aspect_ratio || "16:9",
          hasAudio: params.generate_audio !== false,
          variant: "fast",
        },
      };
    } catch (error) {
      handleAIServiceError(error, "Veo 3.1 Fast text-to-video generation", {
        operation: "generateVeo31FastTextToVideo",
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Veo 3.1 Fast generation failed",
      };
    }
  }

  /**
   * Generate video from image using Veo 3.1 Fast
   * @param params Veo 3.1 image-to-video parameters
   * @returns Generation result with video URL or error
   */
  async generateVeo31FastImageToVideo(
    params: Veo31ImageToVideoInput
  ): Promise<GenerationResult> {
    try {
      const endpoint = "https://fal.run/fal-ai/veo3.1/fast/image-to-video";

      console.log("[Veo 3.1 Fast] Generating image-to-video with params:", params);

      const response = await this.makeRequest(endpoint, params);

      if (!response.video?.url) {
        throw new Error("No video URL in Veo 3.1 Fast response");
      }

      return {
        success: true,
        imageUrl: response.video.url,
        metadata: {
          duration: params.duration || "8s",
          resolution: params.resolution || "720p",
          aspectRatio: params.aspect_ratio || "16:9",
          hasAudio: params.generate_audio !== false,
          variant: "fast",
        },
      };
    } catch (error) {
      handleAIServiceError(error, "Veo 3.1 Fast image-to-video generation", {
        operation: "generateVeo31FastImageToVideo",
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Veo 3.1 Fast generation failed",
      };
    }
  }

  /**
   * Generate video from first and last frames using Veo 3.1 Fast
   * @param params Veo 3.1 frame-to-video parameters
   * @returns Generation result with video URL or error
   */
  async generateVeo31FastFrameToVideo(
    params: Veo31FrameToVideoInput
  ): Promise<GenerationResult> {
    try {
      const endpoint = "https://fal.run/fal-ai/veo3.1/fast/first-last-frame-to-video";

      console.log("[Veo 3.1 Fast] Generating frame-to-video with params:", params);

      const response = await this.makeRequest(endpoint, params);

      if (!response.video?.url) {
        throw new Error("No video URL in Veo 3.1 Fast response");
      }

      return {
        success: true,
        imageUrl: response.video.url,
        metadata: {
          duration: params.duration || "8s",
          resolution: params.resolution || "720p",
          aspectRatio: params.aspect_ratio || "auto",
          hasAudio: params.generate_audio !== false,
          variant: "fast",
        },
      };
    } catch (error) {
      handleAIServiceError(error, "Veo 3.1 Fast frame-to-video generation", {
        operation: "generateVeo31FastFrameToVideo",
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Veo 3.1 Fast generation failed",
      };
    }
  }

  // ============================================
  // Veo 3.1 STANDARD Methods (premium quality)
  // ============================================

  /**
   * Generate video from text using Veo 3.1 Standard
   * @param params Veo 3.1 text-to-video parameters
   * @returns Generation result with video URL or error
   */
  async generateVeo31TextToVideo(
    params: Veo31TextToVideoInput
  ): Promise<GenerationResult> {
    try {
      const endpoint = "https://fal.run/fal-ai/veo3.1"; // No /fast suffix

      console.log("[Veo 3.1 Standard] Generating text-to-video with params:", params);

      const response = await this.makeRequest(endpoint, params);

      if (!response.video?.url) {
        throw new Error("No video URL in Veo 3.1 Standard response");
      }

      return {
        success: true,
        imageUrl: response.video.url,
        metadata: {
          duration: params.duration || "8s",
          resolution: params.resolution || "720p",
          aspectRatio: params.aspect_ratio || "16:9",
          hasAudio: params.generate_audio !== false,
          variant: "standard",
        },
      };
    } catch (error) {
      handleAIServiceError(error, "Veo 3.1 Standard text-to-video generation", {
        operation: "generateVeo31TextToVideo",
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Veo 3.1 Standard generation failed",
      };
    }
  }

  /**
   * Generate video from image using Veo 3.1 Standard
   * @param params Veo 3.1 image-to-video parameters
   * @returns Generation result with video URL or error
   */
  async generateVeo31ImageToVideo(
    params: Veo31ImageToVideoInput
  ): Promise<GenerationResult> {
    try {
      const endpoint = "https://fal.run/fal-ai/veo3.1/image-to-video"; // No /fast

      console.log("[Veo 3.1 Standard] Generating image-to-video with params:", params);

      const response = await this.makeRequest(endpoint, params);

      if (!response.video?.url) {
        throw new Error("No video URL in Veo 3.1 Standard response");
      }

      return {
        success: true,
        imageUrl: response.video.url,
        metadata: {
          duration: params.duration || "8s",
          resolution: params.resolution || "720p",
          aspectRatio: params.aspect_ratio || "16:9",
          hasAudio: params.generate_audio !== false,
          variant: "standard",
        },
      };
    } catch (error) {
      handleAIServiceError(error, "Veo 3.1 Standard image-to-video generation", {
        operation: "generateVeo31ImageToVideo",
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Veo 3.1 Standard generation failed",
      };
    }
  }

  /**
   * Generate video from first and last frames using Veo 3.1 Standard
   * @param params Veo 3.1 frame-to-video parameters
   * @returns Generation result with video URL or error
   */
  async generateVeo31FrameToVideo(
    params: Veo31FrameToVideoInput
  ): Promise<GenerationResult> {
    try {
      const endpoint = "https://fal.run/fal-ai/veo3.1/first-last-frame-to-video"; // No /fast

      console.log("[Veo 3.1 Standard] Generating frame-to-video with params:", params);

      const response = await this.makeRequest(endpoint, params);

      if (!response.video?.url) {
        throw new Error("No video URL in Veo 3.1 Standard response");
      }

      return {
        success: true,
        imageUrl: response.video.url,
        metadata: {
          duration: params.duration || "8s",
          resolution: params.resolution || "720p",
          aspectRatio: params.aspect_ratio || "auto",
          hasAudio: params.generate_audio !== false,
          variant: "standard",
        },
      };
    } catch (error) {
      handleAIServiceError(error, "Veo 3.1 Standard frame-to-video generation", {
        operation: "generateVeo31FrameToVideo",
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Veo 3.1 Standard generation failed",
      };
    }
  }
```
> **Reviewer Comment:** `makeRequest` currently returns `FalImageResponse` (no `video` field) and `GenerationResult.metadata` only allows `seed/timings/dimensions`; this code will fail type-checking unless those core types are extended or the responses are cast appropriately.

---

## 📂 File 4: use-ai-generation.ts

**Path:** `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`

### Task 4.1: Add Veo 3.1 State Variables

**Location:** Add after line 97 (after Sora 2 state, before Sora 2 detection flags)

**Code to ADD:**

```typescript
  // Veo 3.1 specific state
  const [veo31Settings, setVeo31Settings] = useState<{
    resolution: "720p" | "1080p";
    duration: "4s" | "6s" | "8s";
    aspectRatio: "9:16" | "16:9" | "1:1" | "auto";
    generateAudio: boolean;
    enhancePrompt: boolean;
    autoFix: boolean;
  }>({
    resolution: "720p",
    duration: "8s",
    aspectRatio: "16:9",
    generateAudio: true,
    enhancePrompt: true,
    autoFix: true,
  });

  // Veo 3.1 frame state (for frame-to-video model)
  const [firstFrame, setFirstFrame] = useState<File | null>(null);
  const [lastFrame, setLastFrame] = useState<File | null>(null);
```

### Task 4.2: Add Veo 3.1 Detection Flags

**Location:** Add after line 101 (after Sora 2 detection flags)

**Code to ADD:**

```typescript
  // Veo 3.1 detection flags
  const isVeo31Selected = selectedModels.some(id => id.startsWith('veo31_'));
  const hasVeo31FrameToVideo = selectedModels.includes('veo31_frame_to_video');
```

### Task 4.3: Add Veo 3.1 Setter Functions

**Location:** Add new functions after line 1100 (before the return statement)

**Code to ADD (create new section before return):**

```typescript
  // Veo 3.1 setter functions
  const setVeo31Resolution = useCallback((resolution: "720p" | "1080p") => {
    setVeo31Settings(prev => ({ ...prev, resolution }));
  }, []);

  const setVeo31Duration = useCallback((duration: "4s" | "6s" | "8s") => {
    setVeo31Settings(prev => ({ ...prev, duration }));
  }, []);

  const setVeo31AspectRatio = useCallback((aspectRatio: "9:16" | "16:9" | "1:1" | "auto") => {
    setVeo31Settings(prev => ({ ...prev, aspectRatio }));
  }, []);

  const setVeo31GenerateAudio = useCallback((generateAudio: boolean) => {
    setVeo31Settings(prev => ({ ...prev, generateAudio }));
  }, []);
```

### Task 4.4: Extend handleGenerate with Veo 3.1 Logic

**Location:** Modify the `handleGenerate` function (around line 543)

**Find this code block:**

```typescript
        if (activeTab === "text") {
          console.log(`  📝 Calling generateVideo for ${modelId}...`);
          response = await generateVideo(
            {
              prompt: prompt.trim(),
              model: modelId,
              // Add Sora 2 specific parameters if Sora 2 model
              ...(modelId.startsWith('sora2_') && {
                duration,
                aspect_ratio: aspectRatio,
                resolution,
              }),
            },
            progressCallback
          );
          console.log("  ✅ generateVideo returned:", response);
        }
```

**REPLACE with:**

```typescript
        if (activeTab === "text") {
          console.log(`  📝 Calling generateVideo for ${modelId}...`);

          // Veo 3.1 Fast text-to-video
          if (modelId === 'veo31_fast_text_to_video') {
            response = await falAIClient.generateVeo31FastTextToVideo({
              prompt: prompt.trim(),
              aspect_ratio: veo31Settings.aspectRatio === "auto" ? undefined : veo31Settings.aspectRatio as any,
              duration: veo31Settings.duration,
              resolution: veo31Settings.resolution,
              generate_audio: veo31Settings.generateAudio,
              enhance_prompt: veo31Settings.enhancePrompt,
              auto_fix: veo31Settings.autoFix,
            });
          }
          // Veo 3.1 Standard text-to-video
          else if (modelId === 'veo31_text_to_video') {
            response = await falAIClient.generateVeo31TextToVideo({
              prompt: prompt.trim(),
              aspect_ratio: veo31Settings.aspectRatio === "auto" ? undefined : veo31Settings.aspectRatio as any,
              duration: veo31Settings.duration,
              resolution: veo31Settings.resolution,
              generate_audio: veo31Settings.generateAudio,
              enhance_prompt: veo31Settings.enhancePrompt,
              auto_fix: veo31Settings.autoFix,
            });
          }
          // Regular text-to-video generation
          else {
            response = await generateVideo(
              {
                prompt: prompt.trim(),
                model: modelId,
                // Add Sora 2 specific parameters if Sora 2 model
                ...(modelId.startsWith('sora2_') && {
                  duration,
                  aspect_ratio: aspectRatio,
                  resolution,
                }),
              },
              progressCallback
            );
          }
          console.log("  ✅ generateVideo returned:", response);
        }
```

**And add this code block after the existing image-to-video logic (around line 556):**

```typescript
        } else if (activeTab === "image" && selectedImage) {
          console.log(`  🖼️ Calling generateVideoFromImage for ${modelId}...`);

          // Veo 3.1 Fast image-to-video
          if (modelId === 'veo31_fast_image_to_video') {
            // Upload image to get URL first
            const imageUrl = await uploadImageToFal(selectedImage);

            response = await falAIClient.generateVeo31FastImageToVideo({
              prompt: prompt.trim(),
              image_url: imageUrl,
              aspect_ratio: veo31Settings.aspectRatio as "16:9" | "9:16",
              duration: veo31Settings.duration as "8s",
              resolution: veo31Settings.resolution,
              generate_audio: veo31Settings.generateAudio,
            });
          }
          // Veo 3.1 Standard image-to-video
          else if (modelId === 'veo31_image_to_video') {
            // Upload image to get URL first
            const imageUrl = await uploadImageToFal(selectedImage);

            response = await falAIClient.generateVeo31ImageToVideo({
              prompt: prompt.trim(),
              image_url: imageUrl,
              aspect_ratio: veo31Settings.aspectRatio as "16:9" | "9:16",
              duration: veo31Settings.duration as "8s",
              resolution: veo31Settings.resolution,
              generate_audio: veo31Settings.generateAudio,
            });
          }
          // Veo 3.1 Fast frame-to-video
          else if (modelId === 'veo31_fast_frame_to_video' && firstFrame && lastFrame) {
            // Upload both frames to get URLs
            const firstFrameUrl = await uploadImageToFal(firstFrame);
            const lastFrameUrl = await uploadImageToFal(lastFrame);

            response = await falAIClient.generateVeo31FastFrameToVideo({
              prompt: prompt.trim(),
              first_frame_url: firstFrameUrl,
              last_frame_url: lastFrameUrl,
              aspect_ratio: veo31Settings.aspectRatio as any,
              duration: veo31Settings.duration as "8s",
              resolution: veo31Settings.resolution,
              generate_audio: veo31Settings.generateAudio,
            });
          }
          // Veo 3.1 Standard frame-to-video
          else if (modelId === 'veo31_frame_to_video' && firstFrame && lastFrame) {
            // Upload both frames to get URLs
            const firstFrameUrl = await uploadImageToFal(firstFrame);
            const lastFrameUrl = await uploadImageToFal(lastFrame);

            response = await falAIClient.generateVeo31FrameToVideo({
              prompt: prompt.trim(),
              first_frame_url: firstFrameUrl,
              last_frame_url: lastFrameUrl,
              aspect_ratio: veo31Settings.aspectRatio as any,
              duration: veo31Settings.duration as "8s",
              resolution: veo31Settings.resolution,
              generate_audio: veo31Settings.generateAudio,
            });
          }
          // Regular image-to-video generation
          else {
            response = await generateVideoFromImage({
              image: selectedImage,
              prompt: prompt.trim(),
              model: modelId,
              // Add Sora 2 specific parameters if Sora 2 model
              ...(modelId.startsWith('sora2_') && {
                duration,
                aspect_ratio: aspectRatio,
                resolution,
              }),
            });
          }
          console.log("  ✅ generateVideoFromImage returned:", response);
        }
```

### Task 4.5: Add Veo 3.1 to Return Statement

**Location:** Modify the return statement (around line 1022)

**Find the return statement and ADD these properties:**

```typescript
  return {
    // ... existing properties ...

    // Veo 3.1 state (ADD THIS SECTION)
    veo31Settings,
    setVeo31Settings,
    setVeo31Resolution,
    setVeo31Duration,
    setVeo31AspectRatio,
    setVeo31GenerateAudio,
    isVeo31Selected,
    hasVeo31FrameToVideo,
    firstFrame,
    setFirstFrame,
    lastFrame,
    setLastFrame,
  };
```

---

## 📂 File 5: ai.tsx

**Path:** `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

### Task 5.1: Add Frame Upload State

**Location:** Add after line 63 (after sourceVideo state)

**Code to ADD:**

```typescript
  // Veo 3.1 frame upload state
  const [firstFrame, setFirstFrame] = useState<File | null>(null);
  const [firstFramePreview, setFirstFramePreview] = useState<string | null>(null);
  const [lastFrame, setLastFrame] = useState<File | null>(null);
  const [lastFramePreview, setLastFramePreview] = useState<string | null>(null);
```

### Task 5.2: Update Cost Calculation

**Location:** Modify the `totalCost` calculation (around line 212)

**Find this code block:**

```typescript
  const totalCost = selectedModels.reduce((total, modelId) => {
    const model = AI_MODELS.find((m) => m.id === modelId);
    let modelCost = model ? parseFloat(model.price) : 0;

    // Adjust for Sora 2 duration and resolution
    if (modelId.startsWith('sora2_')) {
      // ... existing Sora 2 logic ...
    }

    return total + modelCost;
  }, 0);
```

**MODIFY to ADD Veo 3.1 logic:**

```typescript
  const totalCost = selectedModels.reduce((total, modelId) => {
    const model = AI_MODELS.find((m) => m.id === modelId);
    let modelCost = model ? parseFloat(model.price) : 0;

    // Adjust for Sora 2 duration and resolution
    if (modelId.startsWith('sora2_')) {
      // ... existing Sora 2 logic (keep as is) ...
    }

    // ADD: Veo 3.1 pricing calculation
    else if (modelId.startsWith('veo31_')) {
      const durationSeconds = parseInt(generation.veo31Settings.duration); // "4s" -> 4

      // Determine if this is a fast or standard model
      const isFastModel = modelId.includes('_fast_');

      // Fast models: $0.10/s (no audio) or $0.15/s (with audio)
      // Standard models: $0.20/s (no audio) or $0.40/s (with audio)
      const pricePerSecond = isFastModel
        ? (generation.veo31Settings.generateAudio ? 0.15 : 0.10)
        : (generation.veo31Settings.generateAudio ? 0.40 : 0.20);

      modelCost = durationSeconds * pricePerSecond;
    }

    return total + modelCost;
  }, 0);
```

### Task 5.3: Add Veo 3.1 Settings Panel

**Location:** Add after line 709 (after Sora 2 settings panel, before error display)

**Code to ADD:**

```typescript
          {/* Veo 3.1 Settings Panel - Only shows when Veo 3.1 models selected */}
          {generation.isVeo31Selected && (
            <div className="space-y-3 p-3 bg-muted/30 rounded-md border border-muted">
              <Label className="text-xs font-medium">Veo 3.1 Settings</Label>

              {/* Resolution selector */}
              <div className="space-y-1">
                <Label htmlFor="veo31-resolution" className="text-xs">Resolution</Label>
                <Select
                  value={generation.veo31Settings.resolution}
                  onValueChange={(v) => generation.setVeo31Resolution(v as "720p" | "1080p")}
                >
                  <SelectTrigger id="veo31-resolution" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="720p">720p</SelectItem>
                    <SelectItem value="1080p">1080p</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Duration selector with pricing display */}
              <div className="space-y-1">
                <Label htmlFor="veo31-duration" className="text-xs">Duration</Label>
                <Select
                  value={generation.veo31Settings.duration}
                  onValueChange={(v) => generation.setVeo31Duration(v as "4s" | "6s" | "8s")}
                >
                  <SelectTrigger id="veo31-duration" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(() => {
                      // Check if fast or standard models are selected
                      const hasFastModel = selectedModels.some(id => id.includes('veo31_fast_'));
                      const hasStandardModel = selectedModels.some(id => id.startsWith('veo31_') && !id.includes('_fast_'));
                      const hasAudio = generation.veo31Settings.generateAudio;

                      // Calculate pricing for each duration
                      const getPricing = (seconds: number) => {
                        if (hasFastModel && !hasStandardModel) {
                          // Fast only
                          return hasAudio ? `$${(seconds * 0.15).toFixed(2)}` : `$${(seconds * 0.10).toFixed(2)}`;
                        } else if (hasStandardModel && !hasFastModel) {
                          // Standard only
                          return hasAudio ? `$${(seconds * 0.40).toFixed(2)}` : `$${(seconds * 0.20).toFixed(2)}`;
                        } else {
                          // Both - show range
                          const fastPrice = hasAudio ? seconds * 0.15 : seconds * 0.10;
                          const stdPrice = hasAudio ? seconds * 0.40 : seconds * 0.20;
                          return `$${fastPrice.toFixed(2)}-$${stdPrice.toFixed(2)}`;
                        }
                      };

                      return (
                        <>
                          <SelectItem value="4s">
                            4 seconds ({getPricing(4)})
                          </SelectItem>
                          <SelectItem value="6s">
                            6 seconds ({getPricing(6)})
                          </SelectItem>
                          <SelectItem value="8s">
                            8 seconds ({getPricing(8)})
                          </SelectItem>
                        </>
                      );
                    })()}
                  </SelectContent>
                </Select>
              </div>

              {/* Aspect ratio selector */}
              <div className="space-y-1">
                <Label htmlFor="veo31-aspect" className="text-xs">Aspect Ratio</Label>
                <Select
                  value={generation.veo31Settings.aspectRatio}
                  onValueChange={(v) => generation.setVeo31AspectRatio(v as any)}
                >
                  <SelectTrigger id="veo31-aspect" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {generation.hasVeo31FrameToVideo && (
                      <SelectItem value="auto">Auto (from frames)</SelectItem>
                    )}
                    <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                    <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                    <SelectItem value="1:1">1:1 (Square)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Audio toggle */}
              <div className="flex items-center justify-between">
                <Label htmlFor="veo31-audio" className="text-xs">Generate Audio</Label>
                <input
                  id="veo31-audio"
                  type="checkbox"
                  checked={generation.veo31Settings.generateAudio}
                  onChange={(e) => generation.setVeo31GenerateAudio(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
              </div>

              {/* Audio pricing note with fast/standard differentiation */}
              <div className="text-xs text-muted-foreground">
                {(() => {
                  // Check if any selected model is fast or standard
                  const hasFastModel = selectedModels.some(id => id.includes('veo31_fast_'));
                  const hasStandardModel = selectedModels.some(id => id.startsWith('veo31_') && !id.includes('_fast_'));

                  // Show pricing based on selected models
                  if (hasFastModel && !hasStandardModel) {
                    return generation.veo31Settings.generateAudio
                      ? "Fast: $0.15/second with audio"
                      : "Fast: $0.10/second without audio";
                  } else if (hasStandardModel && !hasFastModel) {
                    return generation.veo31Settings.generateAudio
                      ? "Standard: $0.40/second with audio"
                      : "Standard: $0.20/second without audio";
                  } else {
                    // Both fast and standard selected
                    return generation.veo31Settings.generateAudio
                      ? "Fast: $0.15/s | Standard: $0.40/s (with audio)"
                      : "Fast: $0.10/s | Standard: $0.20/s (no audio)";
                  }
                })()}
              </div>
            </div>
          )}
```

### Task 5.4: Add Frame Upload UI (for frame-to-video)

**Location:** Add after line 458 (inside the "image" TabsContent, after existing image upload section)

**Code to ADD:**

```typescript
                {/* Veo 3.1 Frame-to-Video: First & Last Frame Uploads */}
                {generation.hasVeo31FrameToVideo && (
                  <div className="space-y-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-900">
                    <Label className="text-xs font-medium text-blue-700 dark:text-blue-300">
                      Veo 3.1 Frame-to-Video Mode
                    </Label>

                    {/* First Frame Upload */}
                    <FileUpload
                      id="veo31-first-frame"
                      label="First Frame"
                      helperText="Opening frame (max 8MB)"
                      fileType="image"
                      acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_IMAGE_TYPES}
                      maxSizeBytes={UPLOAD_CONSTANTS.MAX_VEO31_FRAME_SIZE_BYTES}
                      maxSizeLabel={UPLOAD_CONSTANTS.MAX_VEO31_FRAME_SIZE_LABEL}
                      formatsLabel={UPLOAD_CONSTANTS.IMAGE_FORMATS_LABEL}
                      file={firstFrame}
                      preview={firstFramePreview}
                      onFileChange={(file, preview) => {
                        setFirstFrame(file);
                        setFirstFramePreview(preview || null);
                        generation.setFirstFrame(file);
                        if (file) setError(null);
                      }}
                      onError={setError}
                      isCompact={isCompact}
                    />

                    {/* Last Frame Upload */}
                    <FileUpload
                      id="veo31-last-frame"
                      label="Last Frame"
                      helperText="Closing frame (max 8MB)"
                      fileType="image"
                      acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_IMAGE_TYPES}
                      maxSizeBytes={UPLOAD_CONSTANTS.MAX_VEO31_FRAME_SIZE_BYTES}
                      maxSizeLabel={UPLOAD_CONSTANTS.MAX_VEO31_FRAME_SIZE_LABEL}
                      formatsLabel={UPLOAD_CONSTANTS.IMAGE_FORMATS_LABEL}
                      file={lastFrame}
                      preview={lastFramePreview}
                      onFileChange={(file, preview) => {
                        setLastFrame(file);
                        setLastFramePreview(preview || null);
                        generation.setLastFrame(file);
                        if (file) setError(null);
                      }}
                      onError={setError}
                      isCompact={isCompact}
                    />

                    <div className="text-xs text-muted-foreground">
                      Veo 3.1 will animate smoothly between these two frames
                    </div>
                  </div>
                )}
```

---

## 📊 Summary of Changes

### Files Modified (4)

| File | Lines Added | Changes Type |
|------|-------------|--------------|
| `ai-constants.ts` | ~230 | Add 6 models (3 fast + 3 standard) + constants + errors |
| `fal-ai-client.ts` | ~290 | Add 6 API client methods (fast + standard variants) + types import |
| `use-ai-generation.ts` | ~180 | Add state, setters, detection, generation logic for all variants |
| `ai.tsx` | ~200 | Add settings panel + frame uploads + dynamic pricing display |

### Files Created (1)

| File | Lines | Purpose |
|------|-------|---------|
| `ai-generation.ts` | ~90 | TypeScript type definitions (shared by fast and standard) |

### Total Impact

- **~990 lines of code** added
- **0 lines deleted** (non-breaking)
- **~50 lines modified** (cost calc with fast/standard differentiation, generation logic)

### Model Breakdown

**Fast Models (3):**
- `veo31_fast_text_to_video`: Text → Video (fast, budget-friendly)
- `veo31_fast_image_to_video`: Image → Video (fast, budget-friendly)
- `veo31_fast_frame_to_video`: Frames → Video (fast, budget-friendly)

**Standard Models (3):**
- `veo31_text_to_video`: Text → Video (premium quality)
- `veo31_image_to_video`: Image → Video (premium quality)
- `veo31_frame_to_video`: Frames → Video (premium quality)

---

## ✅ Validation Checklist

After making changes, verify:

### Type Safety
- [ ] `bun x tsc --noEmit` passes without errors
- [ ] All imports resolve correctly
- [ ] No `any` types introduced

### Code Quality
- [ ] `bun run lint:clean` passes
- [ ] Code follows existing patterns (Sora 2 as reference)
- [ ] All functions have proper JSDoc comments

### Functionality
- [ ] All 6 Veo 3.1 models appear in AI panel (3 fast + 3 standard)
- [ ] Settings panel shows when any Veo 3.1 model selected
- [ ] Cost calculation correctly differentiates fast ($0.10-0.15/s) vs standard ($0.20-0.40/s)
- [ ] Duration pricing updates dynamically based on audio toggle
- [ ] Frame uploads work for both fast and standard frame-to-video
- [ ] No console errors

### Integration
- [ ] Existing Sora 2/Kling/WAN models still work
- [ ] No regressions in other features
- [ ] Tab switching works correctly
- [ ] Multi-model selection includes both fast and standard Veo 3.1 models
- [ ] Pricing displays correctly when mixing fast and standard models

---

## 🔧 Helper Utilities Needed

You'll need to create one helper function for image uploads:

**Add to `fal-ai-client.ts` or create `upload-utils.ts`:**

```typescript
/**
 * Upload image to fal.ai and get URL
 * Required for Veo 3.1 image/frame inputs
 */
async function uploadImageToFal(file: File): Promise<string> {
  // Create form data
  const formData = new FormData();
  formData.append("file", file);

  // Upload to fal.ai (they provide an upload endpoint)
  const response = await fetch("https://fal.run/upload", {
    method: "POST",
    headers: {
      "Authorization": `Key ${this.apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload image: ${response.status}`);
  }

  const data = await response.json();
  return data.url; // Return the uploaded image URL
}
```

---

## 🚀 Quick Implementation Guide

### Step 1: Types (5 min)
1. Create `qcut/apps/web/src/types/ai-generation.ts`
2. Copy the full type definitions from Task 2 above
3. Note: Types are shared between fast and standard models

### Step 2: Constants (15 min)
1. Open `ai-constants.ts`
2. Add 6 model definitions after line 336 (3 fast + 3 standard)
3. Add upload constants to UPLOAD_CONSTANTS
4. Add error messages to ERROR_MESSAGES

### Step 3: Client (35 min)
1. Open `fal-ai-client.ts`
2. Add type imports at top
3. Add 6 methods inside FalAIClient class (3 fast + 3 standard variants)
4. Add uploadImageToFal helper (if not exists)

### Step 4: Hook (45 min)
1. Open `use-ai-generation.ts`
2. Add state variables after Sora 2 state
3. Add detection flags after Sora 2 flags
4. Add setter functions before return
5. Modify handleGenerate with Veo 3.1 logic (handle both fast and standard)
6. Add Veo 3.1 fields to return statement

### Step 5: UI (60 min)
1. Open `ai.tsx`
2. Add frame upload state after line 63
3. Modify cost calculation with fast/standard differentiation
4. Add settings panel with dynamic pricing display
5. Add frame upload UI after line 458
6. Test pricing display for various model combinations

### Step 6: Test (30 min)
1. Run `bun x tsc --noEmit`
2. Run `bun run lint:clean`
3. Run `bun run dev`
4. Test all 6 Veo 3.1 model selections
5. Verify settings panel appears with correct pricing
6. Test fast + standard model mixing
7. Verify cost calculation accuracy

**Total Time: ~3.5 hours** (increased from 2.5 hours due to 2x model count)

---

## 📝 Notes

- All code examples are based on existing patterns in the codebase
- Veo 3.1 follows the same pattern as Sora 2 (good reference)
- Frame-to-video uses the FileUpload component (same as avatar)
- Cost calculation reuses existing logic structure with fast/standard differentiation
- No breaking changes - all modifications are additive
- **Fast vs Standard**: Fast models use `/fast` in endpoint URLs and cost 50% less ($0.10-0.15/s vs $0.20-0.40/s)
- TypeScript interfaces are shared between fast and standard variants (same parameters)
- UI dynamically displays pricing based on selected model mix (fast only, standard only, or both)

---

**Next:** Start with Phase 1 (Types + Constants) and test incrementally!
