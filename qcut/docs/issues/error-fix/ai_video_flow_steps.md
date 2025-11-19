# AI Video Flow (Steps)

Step 1 - User selects T2V models in the AI Panel UI; the UI updates the selected models and queries the capability system.
- **Function**: `AiView` (React Component)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
- **Console**: `console.log("step 1: selectedModels updated -> ...")`
  - **Step 1.1**: User interacts with model selection UI.
  - **Step 1.2**: `selectedModels` state is updated.
  - **Step 1.3**: `useMemo` hook triggers `getCombinedCapabilities`.

Step 2 - The capability system returns intersected capabilities and the UI renders clamped T2V settings (aspect_ratio, duration, resolution) based on them.
- **Function**: `getCombinedCapabilities`
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/text2video-models-config.ts`
- **Console**: `console.log("step 2: combinedCapabilities updated", { ...caps })` (emitted from `AiView` when memoized capabilities change)
  - **Step 2.1**: `getCombinedCapabilities` computes intersection of supported features.
  - **Step 2.2**: `AiView` receives updated `combinedCapabilities`.
  - **Step 2.3**: UI re-renders settings inputs (e.g., Duration slider) clamped to new limits.

Step 3 - The user enters a prompt, adjusts settings, and clicks Generate; the UI invokes generateVideo with the T2V properties.
- **Function**: `handleGenerate`
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `console.log("step 3: handleGenerate invoked (AI video flow)")`
  - **Step 3.1**: User inputs prompt and adjusts generation settings.
  - **Step 3.2**: User clicks "Generate" button.
  - **Step 3.3**: `handleGenerate` function is called.
  - **Step 3.4**: Initial validation checks (prompt existence, model selection, active project).

Step 4 - Generation validates the requested duration against capabilities (getSafeDuration clamping) and builds unifiedParams sanitized to capability ranges.
- **Function**: `handleGenerate` (calls `getSafeDuration`)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `console.log("step 4: sanitized params for ${modelId}", unifiedParams)` plus `debugLogger.log("AIGeneration", "T2V_DURATION_SANITIZED", ...)`
  - **Step 4.1**: Iterate through `selectedModels`.
  - **Step 4.2**: Retrieve capabilities for the current model.
  - **Step 4.3**: Call `getSafeDuration` to clamp requested duration to supported values.
  - **Step 4.4**: Construct `unifiedParams` object with sanitized parameters.

Step 5 - Generation sends the request to the FAL API with unifiedParams and receives a video_url plus metadata.
- **Function**: Request dispatch in `handleGenerate` (model-specific helpers like `generateLTXV2Video`)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `console.log("step 5: sending generation request for ${modelId} (${activeTab} tab)", unifiedParams)`
  - **Step 5.1**: Identify specific API function based on model ID (e.g., `generateLTXV2Video`).
  - **Step 5.2**: API client prepares payload and headers.
  - **Step 5.3**: Send POST request to FAL.ai endpoint.
  - **Step 5.4**: Receive response containing `video_url` (Direct) or `job_id` (Polling).

Step 6 - Generation downloads the video, creates a media item, and adds it to the media store with unified metadata.
- **Function**: `handleGenerate` (inside success block)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `console.log("step 6: downloading video and adding to media store for ${modelId}")`
  - **Step 6.1**: Check if response contains `video_url` (Direct mode) or wait for polling to complete.
  - **Step 6.2**: Fetch video content from `video_url` (`await fetch(response.video_url)`).
  - **Step 6.3**: Create `File` object from the downloaded Blob.
  - **Step 6.4**: Construct `mediaItem` object with metadata (name, duration, dimensions).
  - **Step 6.5**: Call `addMediaItem` to add to the project.

Step 7 - The media store persists the item; generation updates UI progress to 100% and fires onComplete; the UI shows the generated video to the user.
- **Function**: `addMediaItem` (store action), `handleGenerate` (UI update)
- **File**: `qcut/apps/web/src/stores/media-store.ts`, `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `console.log("step 7: generation flow complete; updating UI and callbacks")`
  - **Step 7.1**: `MediaStore` generates a unique ID and updates local state.
  - **Step 7.2**: `MediaStore` persists the new item to storage (IndexedDB/Cloud).
  - **Step 7.3**: `handleGenerate` updates `generatedVideos` state with the new video.
  - **Step 7.4**: `onComplete` callback is executed.
  - **Step 7.5**: UI updates to show the generated video in the gallery/preview.

Debug messages still using the `DEBUG STEP` format (to convert to `step X: ...`):
- `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts:817` — `🔍 DEBUG STEP 1: Pre-Generation State Check`
- `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts:1536` — `🔍 DEBUG STEP 2: Post-API Response Analysis`
- `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts:1596` and `:1784` — `🔍 DEBUG STEP 3: Media Integration Condition Check`
- `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts:1622` and `:1810` — `🔍 DEBUG STEP 4: ✅ EXECUTING Media Integration Block`
- `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts:1648` and `:1830` — `🔍 DEBUG STEP 5: Video Download Progress`
- `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts:1669` and `:1851` — `🔍 DEBUG STEP 6: File Creation Complete`
- `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts:1688` and `:1870` — `🔍 DEBUG STEP 7: About to Call addMediaItem`
- `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts:1704` and `:1883` — `🔍 DEBUG STEP 8: ✅ addMediaItem COMPLETED`

Next action: replace the above `DEBUG STEP` logs with the unified `step X: ...` format to match the documented flow.
