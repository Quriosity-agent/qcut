# AI Video Flow (Steps)

This document describes the step-by-step flow of AI video generation in QCut, with console log references for debugging.

## Generation Flow (Steps 1-7)

### Step 1 - Model Selection
User selects T2V models in the AI Panel UI; the UI updates the selected models and queries the capability system.
- **Function**: `AiView` (React Component)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
- **Console**: `step 1: selectedModels updated -> ...`
  - **Step 1.1**: User interacts with model selection UI.
  - **Step 1.2**: `selectedModels` state is updated.
  - **Step 1.3**: `useMemo` hook triggers `getCombinedCapabilities`.

### Step 2 - Capability Computation
The capability system returns intersected capabilities and the UI renders clamped T2V settings (aspect_ratio, duration, resolution) based on them.
- **Function**: `getCombinedCapabilities`
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/text2video-models-config.ts`
- **Console**: `step 2: combinedCapabilities updated`
  - **Step 2.1**: `getCombinedCapabilities` computes intersection of supported features.
  - **Step 2.2**: `AiView` receives updated `combinedCapabilities`.
  - **Step 2.3**: UI re-renders settings inputs (e.g., Duration slider) clamped to new limits.

### Step 3 - Generation Invoked
The user enters a prompt, adjusts settings, and clicks Generate; the UI invokes generateVideo with the T2V properties.
- **Function**: `handleGenerate`
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console Logs**:
  - `step 3: handleGenerate invoked (AI video flow)`
  - `step 3a: pre-generation state check`
- **Sub-steps**:
  - **Step 3.1**: User inputs prompt and adjusts generation settings.
  - **Step 3.2**: User clicks "Generate" button.
  - **Step 3.3**: `handleGenerate` function is called.
  - **Step 3.4**: Initial validation checks (prompt existence, model selection, active project).

### Step 4 - Parameter Sanitization
Generation validates the requested duration against capabilities (getSafeDuration clamping) and builds unifiedParams sanitized to capability ranges.
- **Function**: `handleGenerate` (calls `getSafeDuration`)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `step 4: sanitized params for ${modelId}`
- **Sub-steps**:
  - **Step 4.1**: Iterate through `selectedModels`.
  - **Step 4.2**: Retrieve capabilities for the current model.
  - **Step 4.3**: Call `getSafeDuration` to clamp requested duration to supported values.
  - **Step 4.4**: Construct `unifiedParams` object with sanitized parameters.

### Step 5 - API Request
Generation sends the request to the FAL API with unifiedParams and receives a video_url plus metadata.
- **Function**: Request dispatch in `handleGenerate` (model-specific helpers like `generateLTXV2Video`)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `step 5a: post-API response analysis`
- **Sub-steps**:
  - **Step 5.1**: Identify specific API function based on model ID.
  - **Step 5.2**: API client prepares payload and headers.
  - **Step 5.3**: Send POST request to FAL.ai endpoint.
  - **Step 5.4**: Receive response containing `video_url` (Direct) or `job_id` (Polling).

### Step 6 - Media Integration
Generation downloads the video, creates a media item, and adds it to the media store with unified metadata.
- **Function**: `handleGenerate` (inside success block), `addMediaItem` (store action)
- **Files**:
  - `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
  - `qcut/apps/web/src/stores/media-store.ts`
- **Console Logs** (in order):
  - `step 6a: media integration condition check`
  - `step 6b: executing media integration block`
  - `step 6c: video download progress`
  - `step 6d: file creation complete`
  - `step 6d details: {...}`
  - `step 6e: MANDATORY save to local disk starting`
  - `step 6e: about to call addMediaItem`
  - `step 6f: addMediaItem completed`
  - `step 6g: media-store addMediaItem` (from media-store.ts)
  - `step 6: polling mode - deferring download` (when using polling)
- **Sub-steps**:
  - **Step 6.1**: Check if response contains `video_url` (Direct mode) or wait for polling to complete.
  - **Step 6.2**: Fetch video content from `video_url`.
  - **Step 6.3**: Create `File` object from the downloaded Blob.
  - **Step 6.4**: Construct `mediaItem` object with metadata (name, duration, dimensions).
  - **Step 6.5**: Call `addMediaItem` to add to the project.
  - **Step 6.6**: Generate `localUrl = URL.createObjectURL(file)` and store as `mediaItem.url` (primary), keep `mediaItem.originalUrl` for fallback.
  - **Step 6.7**: Capture `fileSize` for downstream checks.
- **Remote vs Local note**: Videos stay remote (only `video_url` stored) when we skip download—for example, if `activeProject`/`addMediaItem` are unavailable or in polling mode pre-completion. When both project and media store are present, the flow downloads the blob and saves a local `File` before adding.

### Step 7 - UI Completion
The media store persists the item; generation updates UI progress to 100% and fires onComplete; the UI shows the generated video to the user.
- **Function**: `addMediaItem` (store action), `handleGenerate` (UI update)
- **Files**:
  - `qcut/apps/web/src/stores/media-store.ts`
  - `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `step 7: generation flow complete; updating UI and callbacks`
- **Sub-steps**:
  - **Step 7.1**: `MediaStore` generates a unique ID and updates local state.
  - **Step 7.2**: `MediaStore` persists the new item to storage (IndexedDB/Cloud).
  - **Step 7.3**: `handleGenerate` updates `generatedVideos` state with the new video.
  - **Step 7.4**: `onComplete` callback is executed.
  - **Step 7.5**: UI updates to show the generated video in the gallery/preview.

---

## Download & Export Flow (Steps 8-11)

### Step 8 - Media Panel Downloads
Individual download and export-all ZIP functionality from the media panel.
- **Files**:
  - `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
  - `qcut/apps/web/src/components/editor/media-panel/views/ai-history-panel.tsx`
  - `qcut/apps/web/src/components/editor/media-panel/export-all-button.tsx`
  - `qcut/apps/web/src/hooks/use-zip-export.ts`

#### Individual Download
- **Console**: `step 8: media panel download` / `step 8: history panel download`
- **Sub-steps**:
  - **Step 8.1**: User clicks download in the media/AI history panel.
  - **Step 8.2**: Handler prefers blob/local URL and falls back to remote URL if missing.
  - **Step 8.3**: File name inferred from remote URL or uses default `ai-video-${jobId}.mp4`.

#### Export All (ZIP)
- **Console Logs**:
  - `step 8: export-all clicked`
  - `step 8: export-all start zipping`
  - `step 8: export-all zip completed`
- **use-zip-export.ts Console Logs** (detailed):
  - `step 8a: use-zip-export exportToZip called`
  - `step 8b: no items to export`
  - `step 8c: creating ZipManager instance`
  - `step 8d: starting addMediaItems`
  - `step 8e: addMediaItems progress`
  - `step 8f: addMediaItems complete`
  - `step 8g: starting compression`
  - `step 8h: compression complete`
  - `step 8i: starting download`
  - `step 8j: calling downloadZipSafely`
  - `step 8k: downloadZipSafely complete`
  - `step 8l: export complete, updating state`

### Step 9 - ZIP Item Processing
Processing individual media items for ZIP inclusion.
- **File**: `qcut/apps/web/src/lib/zip-manager.ts`
- **Console Logs**:
  - `step 9: zip-manager starting addMediaItems`
  - `step 9a: processing item`
  - `step 9a-extension-fix` - Extension inference for videos without extension
  - `step 9a-filename` - Sanitized filename for ZIP entry
  - `step 9a-ai-check: AI detection`
  - `step 9b-ai: AI video detected, prioritizing localPath read`
  - `step 9b-ai-read: readFile returned for AI video`
  - `step 9b-ai-buffer` - Buffer analysis for AI videos
  - `step 9b-ai-success: AI video added from localPath`
  - `step 9b-ai-fail: Failed to read AI video from localPath`
  - `step 9b-ai-error: Error reading AI video from localPath`
  - `step 9b: adding file directly to ZIP`
  - `step 9c: file added successfully via File object`
  - `step 9d: attempting to read local file`
  - `step 9e: readFile returned`
  - `step 9f` - Buffer conversion details
  - `step 9j: local file added successfully to ZIP`
  - `step 9k: readFile returned null/undefined`
  - `step 9l: error reading local file`
  - `step 9m: item processing complete`
  - `step 9n: Failed to add ${item.name} to ZIP`
  - `step 9o: all items processed`

### Step 10 - ZIP Generation
Generating the final ZIP blob from processed items.
- **File**: `qcut/apps/web/src/lib/zip-manager.ts`
- **Console Logs**:
  - `step 10: generating ZIP blob`
  - `step 10a: ZIP blob generated`

### Step 11 - ZIP Download
Saving the ZIP file to disk via Electron or browser fallback.
- **File**: `qcut/apps/web/src/lib/zip-manager.ts`
- **Console Logs**:
  - `step 11: downloadZipSafely called`
  - `step 11a: converting blob to array buffer`
  - `step 11b: arrayBuffer created`
  - `step 11c: calling electronAPI.saveBlob`
  - `step 11d: saveBlob returned`
  - `step 11e: Electron save failed`
  - `step 11f: Electron API not available, using browser methods`

---

## Timeline Playback Steps (Separate Flow)

These step logs are for timeline playback, not AI generation:
- **File**: `qcut/apps/web/src/hooks/use-timeline-playhead.ts`
- **Console Logs**:
  - `step 6: timeline playhead updated` - Playhead position updates
  - `step 7: user initiated seek` - User seeks to new position