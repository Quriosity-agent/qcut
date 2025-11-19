# AI Video Flow (Steps)

Step 1 - User selects T2V models in the AI Panel UI; the UI updates the selected models and queries the capability system.
- **Function**: `AiView` (React Component)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
- **Console**: No specific log for selection.

Step 2 - The capability system returns intersected capabilities and the UI renders clamped T2V settings (aspect_ratio, duration, resolution) based on them.
- **Function**: `getCombinedCapabilities`
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/text2video-models-config.ts`
- **Console**: None.

Step 3 - The user enters a prompt, adjusts settings, and clicks Generate; the UI invokes generateVideo with the T2V properties.
- **Function**: `handleGenerate`
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `console.log("=== handleGenerate CALLED ===")`

Step 4 - Generation validates the requested duration against capabilities (getSafeDuration clamping) and builds unifiedParams sanitized to capability ranges.
- **Function**: `handleGenerate` (calls `getSafeDuration`)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `debugLogger.log("AIGeneration", "T2V_DURATION_SANITIZED", ...)`

Step 5 - Generation sends the request to the FAL API with unifiedParams and receives a video_url plus metadata.
- **Function**: `generateLTXV2Video` (or similar model-specific functions)
- **File**: `qcut/apps/web/src/lib/ai-video-client.ts`
- **Console**: `console.log("🎬 Starting LTX Video 2.0 generation with FAL AI")`

Step 6 - Generation downloads the video, creates a media item, and adds it to the media store with unified metadata.
- **Function**: `handleGenerate` (inside success block)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `console.log("📥 Downloading video from URL:", ...)`

Step 7 - The media store persists the item; generation updates UI progress to 100% and fires onComplete; the UI shows the generated video to the user.
- **Function**: `addMediaItem` (store action), `handleGenerate` (UI update)
- **File**: `qcut/apps/web/src/stores/media-store.ts`, `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `console.log("[MediaStore.addMediaItem] Saving media item", ...)`
