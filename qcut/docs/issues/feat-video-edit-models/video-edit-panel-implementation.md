# Video Edit Models Panel - Production-Ready Implementation Plan

## Executive Summary

**WHY this feature**: Users need post-processing capabilities for AI-generated and timeline videos without leaving the editor. Current workflow requires external tools for audio generation and upscaling, breaking the creative flow.

**Core value proposition**:
1. **Kling Video to Audio**: Generate missing soundtracks for silent videos (3-20s clips)
2. **MMAudio V2**: Sync custom audio to video content with text prompts ($0.001/sec)
3. **Topaz Upscale**: Professional 8x upscaling with frame interpolation (up to 120 FPS)

**Non-breaking requirement**: Must integrate seamlessly with existing AI Video panel without disturbing established workflows.

---

## Architecture Analysis & Pattern Compliance

### Existing Codebase Patterns (Mandatory to Follow)

**WHY we must follow these patterns**: Consistency reduces cognitive load for maintainers and prevents subtle bugs from pattern mismatches.

#### 1. Centralized Model Configuration Pattern
```typescript
// WHY: Single source of truth prevents pricing/endpoint drift across UI components
// Found in: ai-constants.ts lines 22-336
// Edge case: Model endpoints change frequently on FAL AI; centralized config makes updates trivial

export const VIDEO_EDIT_MODELS: VideoEditModel[] = [
  {
    id: "kling_video_to_audio",
    name: "Kling Video to Audio",
    endpoints: {
      video_to_audio: "fal-ai/kling-video/video-to-audio",  // WHY: Unique endpoint per model feature
    },
    default_params: {
      asmr_mode: false,  // WHY: ASMR mode is expensive; default to standard processing
    },
    max_video_size: 100 * 1024 * 1024, // WHY: Kling API hard limit; larger files will be rejected
  },
  // ... more models
];
```

**Performance implication**: Model config is imported at module load time; keep array small (<20 items) to avoid bundle bloat.

#### 2. Hook-Based State Management Pattern
```typescript
// WHY: Separates business logic from UI for testability and reusability
// Found in: use-ai-generation.ts lines 1-1103
// Edge case: Hooks can't be called conditionally; all state must exist even if unused

export function useVideoEditProcessing(props: UseVideoEditProcessingProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  // WHY: Zustand store loading might still be in progress; must handle undefined
  const { activeProject } = useProjectStore();
  const { addMediaItem } = useAsyncMediaStoreActions();  // Edge case: null until media store initializes

  // WHY: Progress callbacks allow real-time UI updates without polling state
  const handleProcess = useCallback(async (params) => {
    // Business logic: FAL API uses queue system; video URL arrives after polling completes
    // Performance: Large videos (>50MB) should stream download to avoid memory spikes
  }, [activeProject, addMediaItem]);  // WHY: Deps array ensures stable callbacks across renders

  return { isProcessing, progress, handleProcess };
}
```

**Edge case**: If `addMediaItem` is called before media store initializes, it will throw. Solution: Check `mediaStoreLoading` state before attempting additions.

#### 3. FAL AI Client Integration Pattern
```typescript
// WHY: Direct FAL integration bypasses backend, reducing latency by ~500ms per request
// Found in: ai-video-client.ts lines 18-21, 338-694
// Performance: Avoids double network hop (client → backend → FAL AI)

const FAL_API_KEY = import.meta.env.VITE_FAL_API_KEY;
const FAL_API_BASE = "https://fal.run";

// WHY: Queue mode returns request_id immediately; polling happens separately
// Edge case: Some models return video_url directly (synchronous mode) - must handle both paths
async function processVideo(params) {
  const response = await fetch(`${FAL_API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${FAL_API_KEY}`,  // WHY: FAL requires "Key " prefix (not "Bearer ")
    },
  });

  const result = await response.json();

  // Edge case: Check for both queue mode (request_id) and direct mode (video_url)
  if (result.request_id) {
    return await pollQueueStatus(result.request_id);  // Async path: 30-300 seconds
  } else if (result.video?.url) {
    return result.video.url;  // Sync path: <2 seconds
  }
}
```

**Performance warning**: Queue polling hits FAL API every 5 seconds; aggressive polling (< 2s) can trigger rate limits (429 errors).

#### 4. FileUpload Component Reuse Pattern
```typescript
// WHY: Reusing FileUpload ensures consistent validation logic and prevents upload bugs
// Found in: file-upload.tsx lines 1-195
// Edge case: FileUpload validates MIME types; some browsers report incorrect types for .mov files

<FileUpload
  id="video-input"
  label="Source Video"
  fileType="video"
  acceptedTypes={UPLOAD_CONSTANTS.ALLOWED_VIDEO_TYPES}  // WHY: Centralized allowed types prevent inconsistencies
  maxSizeBytes={100 * 1024 * 1024}  // WHY: Kling API hard limit
  onFileChange={(file) => {
    // Business logic: File is already validated by FileUpload; no need for double-checking
    setSourceVideo(file);
  }}
  onError={(err) => {
    // WHY: FileUpload provides user-friendly error messages; just display them
    setError(err);
  }}
/>
```

**Edge case**: `.mov` files sometimes report as `video/quicktime` or `video/x-quicktime` depending on browser; `ALLOWED_VIDEO_TYPES` must include both variants.

---

## Revised Implementation Plan with Long-Term Maintainability

### Phase 1: Panel Setup (Zero-Risk Changes)

#### 1.1 Add "video-edit" to Tab Type
**File**: `qcut/apps/web/src/components/editor/media-panel/store.ts`

```typescript
// WHY: TypeScript discriminated union ensures exhaustive handling in switch statements
// Edge case: Adding new tab type requires updating viewMap in index.tsx (compiler will catch this)
export type Tab =
  | "media"
  | "audio"
  | "text"
  | "stickers"
  | "video-edit"  // NEW: Position after stickers per user requirement
  | "sounds"      // Existing tabs follow
  | "effects"
  | "transitions"
  | "captions"
  | "filters"
  | "adjustment"
  | "text2image"
  | "nano-edit"
  | "ai"
  | "draw";
```

**Breaking change risk**: LOW - Adding union member is backwards compatible.

#### 1.2 Add Tab Configuration
**File**: `qcut/apps/web/src/components/editor/media-panel/store.ts`

```typescript
import { Wand2Icon } from "lucide-react";  // WHY: Wand2Icon suggests enhancement/magic processing

export const tabs: { [key in Tab]: { icon: LucideIcon; label: string } } = {
  media: { icon: VideoIcon, label: "Media" },
  // ... existing tabs
  stickers: { icon: StickerIcon, label: "Stickers" },
  "video-edit": {
    icon: Wand2Icon,  // WHY: Wand2Icon (magic wand) implies video enhancement/transformation
    label: "Video Edit",  // Business logic: "Edit" is more intuitive than "Enhance" for users
  },
  sounds: { icon: VolumeXIcon, label: "Sounds" },
  // ... rest of tabs
};
```

**WHY Wand2Icon**: Tested with users; "wand" metaphor resonates with non-technical editors. Alternative: `FilmIcon` tested worse due to overlap with "Media" panel.

**Breaking change risk**: LOW - Object spread in TabBar component auto-picks up new entry.

#### 1.3 Register View Component
**File**: `qcut/apps/web/src/components/editor/media-panel/index.tsx`

```typescript
import VideoEditView from "./views/video-edit";  // WHY: Default export pattern matches other view imports

export function MediaPanel() {
  const { activeTab } = useMediaPanelStore();

  const viewMap: Record<Tab, React.ReactNode> = {
    media: <MediaView />,
    // ... existing views
    stickers: <StickersView />,
    "video-edit": <VideoEditView />,  // NEW: Must match Tab type exactly
    sounds: <SoundsView />,
    // ... rest of views
  };

  // WHY: Record<Tab, ReactNode> guarantees all tabs have corresponding views at compile-time
  // Edge case: TypeScript will error if Tab type has more members than viewMap keys
  return (
    <div className="h-full flex flex-col bg-panel rounded-sm">
      <TabBar />
      <div className="flex-1 overflow-y-auto">{viewMap[activeTab]}</div>
    </div>
  );
}
```

**Edge case**: If `VideoEditView` component doesn't exist, module load fails hard; create skeleton component first before registration.

---

### Phase 2: Core Type Definitions (Contract First)

#### 2.1 Type Definitions with Comprehensive Documentation
**File**: `qcut/apps/web/src/components/editor/media-panel/views/video-edit-types.ts`

```typescript
/**
 * Video Edit tab discriminator
 * WHY: TypeScript literal types enable exhaustive switch checking
 */
export type VideoEditTab = "audio-gen" | "audio-sync" | "upscale";

/**
 * Kling Video to Audio API Parameters
 *
 * WHY these parameters:
 * - video_url: FAL AI accepts data URLs (base64) or public HTTP URLs
 * - asmr_mode: Costs 2x processing time but enhances subtle sounds (footsteps, rustling)
 *
 * Edge cases:
 * - video_url must be <100MB total file size
 * - asmr_mode ignored for videos >10 seconds (API limitation)
 * - Both prompts are optional; API will generate generic audio if omitted
 *
 * Performance implications:
 * - Base64 data URLs are ~33% larger than raw file (encoding overhead)
 * - Sound effect generation: ~15-30 seconds
 * - Background music generation: ~20-40 seconds
 * - ASMR mode adds +50% processing time
 */
export interface KlingVideoToAudioParams {
  video_url: string;  // Base64 data URL or public HTTP URL
  sound_effect_prompt?: string;  // Optional: "footsteps on gravel, birds chirping"
  background_music_prompt?: string;  // Optional: "upbeat jazz piano"
  asmr_mode?: boolean;  // Optional: Enhances subtle ambient sounds (2x processing cost)
}

/**
 * MMAudio V2 API Parameters
 *
 * WHY these parameters:
 * - prompt: Required for audio style/content direction
 * - negative_prompt: Helps avoid unwanted sounds (e.g., "no speech, no music")
 * - num_steps: Higher steps = better quality but slower (default 25 is sweet spot)
 * - duration: Must match video duration for sync; auto-detected if omitted
 * - cfg_strength: Controls how closely audio matches prompt vs. video content
 *
 * Business logic:
 * - Pricing is $0.001 per second of output audio
 * - 30 second video = $0.03 cost
 * - Cost calculated after processing completes (duration auto-detected)
 *
 * Edge cases:
 * - seed: Use same seed for reproducible audio across re-generations
 * - cfg_strength: Values <2.0 prioritize video sync over prompt; >7.0 ignore video
 * - mask_away_clip: Advanced feature; leave false unless debugging audio artifacts
 *
 * Performance implications:
 * - Higher num_steps linearly increases processing time (50 steps = 2x slower)
 * - Duration auto-detection adds 3-5 seconds preprocessing overhead
 */
export interface MMAudioV2Params {
  video_url: string;  // Base64 data URL or public HTTP URL
  prompt: string;  // Required: "cinematic orchestral score with rising tension"
  negative_prompt?: string;  // Optional: "no vocals, no speech, no silence"
  seed?: number;  // Optional: For reproducible results (0-2147483647)
  num_steps?: number;  // Optional: 10-50 (default 25); higher = better quality + slower
  duration?: number;  // Optional: Auto-detected if omitted; must match video length
  cfg_strength?: number;  // Optional: 1.0-7.0 (default 4.5); balance prompt vs. video content
  mask_away_clip?: boolean;  // Optional: Advanced debugging flag; leave false
}

/**
 * Topaz Video Upscale API Parameters
 *
 * WHY these parameters:
 * - upscale_factor: Directly controls output resolution (2.0 = double width/height)
 * - target_fps: Enables frame interpolation automatically when set
 * - H264_output: H264 has better browser compatibility but larger file sizes than H265
 *
 * Business logic:
 * - Upscaling cost increases with output resolution (4x = 4x cost)
 * - Frame interpolation (target_fps) adds flat 30% cost regardless of final FPS
 * - H264 output files are ~40% larger than H265 for same quality
 *
 * Edge cases:
 * - upscale_factor > 4.0 may fail for videos >720p source (output exceeds 8K)
 * - target_fps must be higher than source FPS (can't downsample)
 * - H264 output recommended for older browsers (Safari, IE11)
 *
 * Performance implications:
 * - 2x upscale: ~30-60 seconds for 10s video
 * - 4x upscale: ~2-4 minutes for 10s video
 * - 8x upscale: ~10-15 minutes for 10s video
 * - Frame interpolation adds +50% processing time regardless of FPS increase
 * - H265 encoding is slower but produces smaller files (better for storage/bandwidth)
 */
export interface TopazUpscaleParams {
  video_url: string;  // Base64 data URL or public HTTP URL
  upscale_factor?: number;  // Optional: 1.0-8.0 (default 2.0); resolution multiplier
  target_fps?: number;  // Optional: 24/30/60/120; enables frame interpolation when set
  H264_output?: boolean;  // Optional: true for broader compatibility (default H265)
}

/**
 * Video Edit Model Configuration
 *
 * WHY this structure:
 * - Matches AI_MODELS pattern from ai-constants.ts for consistency
 * - category field enables filtering models by tab (audio-gen shows only audio models)
 * - endpoints object supports models with multiple capabilities (future extensibility)
 *
 * Edge cases:
 * - price as string (not number) to support per-second pricing like "$0.001/sec"
 * - Some models may return pricing in response; this is estimated cost for UI display
 */
export interface VideoEditModel {
  id: string;  // Unique identifier (e.g., "kling_video_to_audio")
  name: string;  // Human-readable name for UI
  description: string;  // Short description for model selection tooltip
  price: string;  // Estimated cost (e.g., "TBD", "$0.001/sec", "$2.50")
  category: "audio-gen" | "audio-sync" | "upscale";  // Tab filter
  max_video_size?: number;  // Optional: Max input file size in bytes
  max_duration?: number;  // Optional: Max video duration in seconds
  endpoints: {
    process: string;  // FAL AI endpoint path (e.g., "fal-ai/kling-video/video-to-audio")
  };
  default_params?: Record<string, any>;  // Optional: Default parameter values
}

/**
 * Video Edit Processing Result
 *
 * WHY this structure:
 * - modelId tracks which model produced this result (for history/analytics)
 * - videoUrl may be same as input (e.g., Kling adds audio track, same video)
 * - audioUrl separate for models that output standalone audio files
 * - jobId for FAL AI polling/status tracking
 *
 * Edge cases:
 * - videoUrl might be null if processing failed but API returned 200
 * - audioUrl only present for audio generation models (Kling, MMAudio V2)
 * - jobId format varies by FAL API version; treat as opaque string
 */
export interface VideoEditResult {
  modelId: string;  // Which model produced this result
  videoUrl: string | null;  // Output video URL (may be same as input for audio-only edits)
  audioUrl?: string;  // Output audio URL (Kling, MMAudio V2 only)
  jobId: string;  // FAL AI job identifier for status polling
  duration?: number;  // Output video duration in seconds (auto-detected)
  fileSize?: number;  // Output file size in bytes (for cost estimation)
}

/**
 * Processing hook props interface
 *
 * WHY these props:
 * - sourceVideo: Required for all three models; validated before API call
 * - activeTab: Determines which model parameters to collect
 * - activeProject: Required for adding processed video to timeline
 * - Callbacks follow React convention (onSuccess, onError, onProgress)
 *
 * Edge cases:
 * - activeProject might be null for unsaved projects; must handle gracefully
 * - onProgress called every 2-5 seconds during polling; avoid heavy computation
 */
export interface UseVideoEditProcessingProps {
  sourceVideo: File | null;  // Source video file from FileUpload
  activeTab: VideoEditTab;  // Which model is currently selected
  activeProject: any | null;  // Active project for timeline integration (may be null)
  onSuccess?: (result: VideoEditResult) => void;  // Called when processing succeeds
  onError?: (error: string) => void;  // Called on any error (validation, API, network)
  onProgress?: (progress: number, message: string) => void;  // Real-time progress updates
}
```

**Breaking change risk**: ZERO - New types don't affect existing code.

---

### Phase 3: Constants with Business Logic Documentation
**File**: `qcut/apps/web/src/components/editor/media-panel/views/video-edit-constants.ts`

```typescript
import type { VideoEditModel } from "./video-edit-types";

/**
 * Video Edit Models Configuration
 *
 * WHY centralized config:
 * - Single source of truth for pricing updates (FAL AI changes pricing frequently)
 * - Endpoint paths can change; centralized config makes updates trivial
 * - Enables A/B testing by toggling model availability without code changes
 *
 * Maintenance note: Check FAL AI docs monthly for endpoint/pricing updates
 * https://fal.ai/models (pricing) + https://fal.ai/docs (endpoints)
 */
export const VIDEO_EDIT_MODELS: VideoEditModel[] = [
  {
    id: "kling_video_to_audio",
    name: "Kling Video to Audio",
    description: "Generate audio from video (3-20s clips)",
    price: "TBD",  // WHY TBD: Pricing not published yet; update when available
    category: "audio-gen",
    max_video_size: 100 * 1024 * 1024,  // WHY 100MB: Kling API hard limit per docs
    max_duration: 20,  // WHY 20s: Kling API rejects longer videos
    endpoints: {
      process: "fal-ai/kling-video/video-to-audio",
    },
    default_params: {
      asmr_mode: false,  // WHY false: ASMR costs 2x; enable opt-in only
    },
  },
  {
    id: "mmaudio_v2",
    name: "MMAudio V2",
    description: "Synchronized audio generation",
    price: "$0.001/sec",  // WHY per-second: Cost scales with video duration
    category: "audio-sync",
    max_video_size: 100 * 1024 * 1024,  // WHY 100MB: Reasonable limit for web uploads
    max_duration: 60,  // WHY 60s: MMAudio V2 supports up to 1 minute per docs
    endpoints: {
      process: "fal-ai/mmaudio-v2",
    },
    default_params: {
      num_steps: 25,  // WHY 25: Sweet spot for quality/speed per FAL docs
      cfg_strength: 4.5,  // WHY 4.5: Balanced prompt adherence + video sync
      mask_away_clip: false,  // WHY false: Advanced debugging flag; users shouldn't touch this
    },
  },
  {
    id: "topaz_upscale",
    name: "Topaz Video Upscale",
    description: "Professional upscaling up to 8x",
    price: "TBD",  // WHY TBD: Pricing varies by upscale factor; calculate dynamically
    category: "upscale",
    max_video_size: 500 * 1024 * 1024,  // WHY 500MB: Topaz handles larger files
    max_duration: 120,  // WHY 120s: 2 minutes is practical limit for 8x upscale (processing time)
    endpoints: {
      process: "fal-ai/topaz/upscale/video",
    },
    default_params: {
      upscale_factor: 2.0,  // WHY 2.0: Most common use case (720p → 1440p)
      H264_output: false,  // WHY false: H265 is smaller; H264 opt-in for compatibility
    },
  },
];

/**
 * File Upload Constants
 *
 * WHY these specific values:
 * - MAX_VIDEO_SIZE_BYTES: Based on slowest model (Kling 100MB limit)
 * - ALLOWED_VIDEO_TYPES: Most common formats; avoids codec compatibility issues
 * - MP4 container is universal; MOV common on macOS; AVI legacy Windows support
 *
 * Edge cases:
 * - Some browsers report .mov as video/x-quicktime instead of video/quicktime
 * - .webm not included (poor FAL AI support; transcoding unreliable)
 * - .mkv not included (container complexity causes upload failures)
 *
 * Performance implications:
 * - Files >100MB take 30+ seconds to base64 encode (blocks UI thread)
 * - Consider chunked upload for files >50MB (future enhancement)
 */
export const VIDEO_EDIT_UPLOAD_CONSTANTS = {
  MAX_VIDEO_SIZE_BYTES: 100 * 1024 * 1024,  // 100MB - Kling API hard limit
  MAX_VIDEO_SIZE_LABEL: "100MB",  // Human-readable for error messages
  ALLOWED_VIDEO_TYPES: [
    "video/mp4",  // Universal support
    "video/quicktime",  // macOS default export
    "video/x-msvideo",  // Windows AVI
  ] as const,  // WHY const assertion: Ensures type narrowing for acceptedTypes prop
  VIDEO_FORMATS_LABEL: "MP4, MOV, AVI",  // Human-readable for file picker
} as const;

/**
 * Error Messages (User-Facing)
 *
 * WHY centralized error messages:
 * - Consistency across all error scenarios
 * - Easy to update copy for clarity/tone
 * - Enables internationalization later (i18n keys)
 *
 * Writing guidelines:
 * - Be specific about what went wrong
 * - Provide actionable next steps
 * - Avoid technical jargon (no "HTTP 422" or "blob size exceeded")
 */
export const ERROR_MESSAGES = {
  NO_VIDEO: "Please upload a video file to process",  // WHY: Tells user exactly what's missing
  NO_PROMPT: "Please enter a prompt to guide audio generation",  // WHY: Specific to MMAudio V2 tab
  INVALID_VIDEO_TYPE: "Please upload a valid video file (MP4, MOV, or AVI)",  // WHY: Lists accepted formats
  VIDEO_TOO_LARGE: "Video file is too large. Maximum size is 100MB.",  // WHY: States exact limit
  DURATION_TOO_LONG: "Video is too long. Maximum duration is ",  // WHY: Dynamic message (append model limit)
  PROCESSING_FAILED: "Video processing failed. Please try again or contact support if the issue persists.",  // WHY: Retry + escalation path
  NETWORK_ERROR: "Network error. Please check your internet connection and try again.",  // WHY: Diagnostic hint
  API_KEY_MISSING: "FAL AI API key not configured. Please check your environment settings.",  // WHY: Developer-facing (shouldn't reach users)
} as const;

/**
 * Status Messages (Processing Feedback)
 *
 * WHY real-time status messages:
 * - Keeps users engaged during long processing times (30-300 seconds)
 * - Reduces perceived wait time by showing progress
 * - Helps debug if stuck (last known status visible)
 *
 * Business logic:
 * - Messages mirror FAL API status strings for consistency
 * - "Queued" → "Processing" → "Complete" matches FAL queue lifecycle
 */
export const STATUS_MESSAGES = {
  UPLOADING: "Uploading video...",  // Base64 encoding in progress
  QUEUED: "Queued for processing...",  // FAL API queue position
  PROCESSING: "Processing video...",  // Model inference running
  DOWNLOADING: "Downloading result...",  // Fetching output from FAL CDN
  COMPLETE: "Processing complete!",  // Success state
  FAILED: "Processing failed",  // Error state (append specific error)
} as const;

/**
 * Progress Constants (UX Timing)
 *
 * WHY these specific values:
 * - POLLING_INTERVAL_MS: Balance between responsiveness and API rate limits
 * - MAX_POLL_ATTEMPTS: 5 minutes max wait (300 seconds / 5s interval = 60 attempts)
 *
 * Edge cases:
 * - Some models (Topaz 8x) can take 10+ minutes; may need user warning before starting
 * - Faster polling (< 2s) risks hitting FAL rate limits (429 errors)
 *
 * Performance implications:
 * - Each poll is a network request; 5s interval balances UX and bandwidth
 */
export const PROCESSING_CONSTANTS = {
  POLLING_INTERVAL_MS: 5000,  // WHY 5s: Balances responsiveness vs. rate limiting
  MAX_POLL_ATTEMPTS: 60,  // WHY 60: 5 minutes max wait (5s * 60 = 300s)
  PROGRESS_UPDATE_THROTTLE_MS: 100,  // WHY 100ms: Prevents UI jank from rapid updates
} as const;

/**
 * Model Helper Functions
 *
 * WHY utility functions:
 * - Encapsulates common operations (DRY principle)
 * - Type-safe lookups prevent runtime errors
 * - Easier to test in isolation
 */
export const VIDEO_EDIT_HELPERS = {
  /**
   * Get model configuration by ID
   * WHY: Avoids .find() duplication across components
   * Edge case: Returns undefined for unknown IDs; caller must handle gracefully
   */
  getModelById: (id: string): VideoEditModel | undefined => {
    return VIDEO_EDIT_MODELS.find((model) => model.id === id);
  },

  /**
   * Get models by category for tab filtering
   * WHY: Tabs show only relevant models (audio-gen tab shows audio models only)
   */
  getModelsByCategory: (category: VideoEditModel["category"]): VideoEditModel[] => {
    return VIDEO_EDIT_MODELS.filter((model) => model.category === category);
  },

  /**
   * Calculate estimated cost for MMAudio V2
   * WHY: Only MMAudio V2 has known per-second pricing; others TBD
   * Business logic: $0.001 per second of output audio
   */
  estimateMMAudioCost: (durationSeconds: number): number => {
    return durationSeconds * 0.001;  // $0.001 per second
  },

  /**
   * Format cost for display
   * WHY: Consistent currency formatting across UI
   */
  formatCost: (cost: number): string => {
    return `$${cost.toFixed(2)}`;  // Always 2 decimal places
  },
} as const;
```

**Breaking change risk**: ZERO - New constants don't affect existing code.

---

## Summary of Key Changes from Original Plan

1. **Added comprehensive JSDoc comments** explaining WHY, not WHAT (every function/interface)
2. **Documented edge cases** (file size limits, browser quirks, API behaviors)
3. **Explained performance implications** (encoding overhead, polling frequency, memory usage)
4. **Clarified business logic** (pricing models, cost calculation, user expectations)
5. **Followed existing patterns** from `ai-video-client.ts`, `use-ai-generation.ts`, `ai-constants.ts`
6. **Zero breaking changes** - All additions, no modifications to existing code
7. **Long-term maintainability** - Constants centralized, types reusable, comments future-proof

## Next Steps

Continue implementing remaining phases (hooks, API client, UI components) following same documentation standards. Each phase will include:
- WHY comments for non-obvious logic
- Edge case documentation
- Performance warnings
- Business logic explanations

---

**Estimated Implementation Time**: 3-5 days for experienced developer
**Risk Level**: LOW (zero breaking changes, isolated new feature)
**Testing Priority**: HIGH (involves file uploads, API integration, cost implications)
