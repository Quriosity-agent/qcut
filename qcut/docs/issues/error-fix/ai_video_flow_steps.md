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
  - **Remote vs Local note**: Videos stay remote (only `video_url` stored) when we skip download—for example, if `activeProject`/`addMediaItem` are unavailable or in polling mode pre-completion. When both project and media store are present, the flow downloads the blob and saves a local `File` before adding.
  - **Step 6.6 (implemented)**: Generate `localUrl = URL.createObjectURL(file)` and store it as `mediaItem.url` (primary), while keeping `mediaItem.originalUrl = video_url` and `newVideo.videoPath = video_url` for fallback; capture `newVideo.fileSize = file.size` for downstream checks.
  - **Step 6.7 (implemented)**: Media panel consumers should prefer the blob/local URL for playback and download, and fall back to the remote/original URL only if local is missing; download logs include a `source: "blob" | "remote"` flag in `step 8`.
  - **Debug checklist (use `step` logs for consistency)**:
    - `step 6g: media-store addMediaItem` - at store entry, logs projectId/id, hasFile, url, originalUrl (if present), and file size to catch payload issues before persistence.
    - `step 6a: media integration condition check` - log `(activeProject && addMediaItem && response.video_url)` and which piece is missing when false.
    - `step 6: polling mode - deferring download` - emit when `response?.job_id && !response?.video_url` to flag remote-only phase.
    - `step 6d: file creation complete` - include `mediaItem.url` (local object URL once added), `file?.name`, `file?.size` to confirm a local blob exists before `addMediaItem`.
    - `step 6f: addMediaItem completed` - verify the saved media item (state/DB) retains the `File` and not just the URL.

Step 7 - The media store persists the item; generation updates UI progress to 100% and fires onComplete; the UI shows the generated video to the user.
- **Function**: `addMediaItem` (store action), `handleGenerate` (UI update)
- **File**: `qcut/apps/web/src/stores/media-store.ts`, `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Console**: `console.log("step 7: generation flow complete; updating UI and callbacks")`
  - **Step 7.1**: `MediaStore` generates a unique ID and updates local state.
  - **Step 7.2**: `MediaStore` persists the new item to storage (IndexedDB/Cloud).
  - **Step 7.3**: `handleGenerate` updates `generatedVideos` state with the new video.
  - **Step 7.4**: `onComplete` callback is executed.
  - **Step 7.5**: UI updates to show the generated video in the gallery/preview.

All generation-flow console logs now use the unified `step X: ...` format (no remaining `DEBUG STEP` prefixes).

Step 8 - Media panel downloads (AI history/download button)
- **Function**: AI panel download handler (history result download)
- **File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`
- **Console**: `console.log("step 8: media panel download", { jobId, url, source, filename })`
  - **Step 8.1**: User clicks download in the media/AI history panel.
  - **Step 8.2**: Handler now prefers the blob/local URL (`result.video.videoUrl`) and falls back to the remote/original URL (`result.video.videoPath`) if the blob is missing (e.g., after refresh); logs `source: "blob"` vs `source: "remote"` for clarity.
  - **Step 8.3**: File name is inferred from the remote URL when using remote mode; otherwise uses the default `ai-video-${jobId}.mp4`. History panel download follows the same fallback behavior with its own `step 8` log.
- **Download All (ZIP)**: Export-all button for media panel
- **File**: `qcut/apps/web/src/components/editor/media-panel/export-all-button.tsx`
- **Console**: `console.log("step 8: export-all ...", { ... })`
  - Logs on click (`step 8: export-all clicked`), blocked state (empty/already exporting), start zipping (counts local files vs remote URLs), completion, or failure. This covers the Download All UI in the media panel so export issues show up in the unified `step 8` format.
  - ZIP builder now fetches from `originalUrl`/`url` even when only `blob:` or remote links are present (should cover videos that lost their File object); failures log `step 8: export-all zip fetch failed`.

## ZIP Export Issue Analysis (2025-11-19)

### Problem Discovered
- **Symptom**: ZIP file generates with correct size (3.59MB) but cannot be extracted
- **Root Cause**: File objects in Electron environment contain invalid data when created from blob URLs
- **Evidence**:
  - Step 9b shows file added via File object (3.76MB)
  - Step 10a shows ZIP generated (3.59MB)
  - Step 11d shows successful save to disk
  - But Windows cannot extract the ZIP file

### Technical Analysis

#### Current Flow (Problematic)
1. AI video downloaded → Blob created → File object created from Blob
2. File saved to disk via `window.electronAPI.video.saveToDisk` → localPath stored
3. Blob URL created via `URL.createObjectURL(file)` → stored as primary URL
4. When exporting ZIP:
   - Code checks `if (item.file)` first (TRUE - uses File object) ❌
   - Never reaches `else if (item.localPath)` branch
   - File object in Electron may not contain valid data due to blob URL lifecycle

#### Electron-Specific Issues
- **Blob URL Lifecycle**: In Electron, blob URLs (`blob:app://...`) have limited lifetime
- **File Object Reference**: File objects created from blobs may only hold references, not actual data
- **JSZip Compatibility**: JSZip may not correctly read Electron's blob-backed File objects

### Proposed Solutions

#### Solution 1: Prioritize localPath for AI Videos (Recommended)
**Implementation**: Modify `zip-manager.ts` to check localPath before File object for AI-generated content

```javascript
// Check for AI video with localPath first
if (item.localPath && item.metadata?.source === 'ai-generated' && window.electronAPI?.readFile) {
  // Read from disk
} else if (item.file) {
  // Use File object for other media
}
```

**Pros**:
- Guaranteed valid data from disk
- Works with Electron's file system
- Maintains File object support for user uploads

**Cons**:
- Requires metadata to identify AI videos
- Slightly slower (disk read vs memory)

#### Solution 2: Force All Items to Use localPath When Available
**Implementation**: Always prefer localPath over File object

```javascript
if (item.localPath && window.electronAPI?.readFile) {
  // Always read from disk when available
} else if (item.file) {
  // Fallback to File object
}
```

**Pros**:
- Simple logic
- Works for all saved media

**Cons**:
- May be inefficient for user-uploaded files already in memory
- Changes existing behavior

#### Solution 3: Re-read File Data Before ZIP Export
**Implementation**: Convert File objects back to Blobs with validation

```javascript
if (item.file) {
  const blob = await item.file.arrayBuffer();
  // Validate blob data is not empty/corrupted
  if (isValidVideoData(blob)) {
    // Add to ZIP
  } else if (item.localPath) {
    // Fallback to disk read
  }
}
```

**Pros**:
- Validates data before adding to ZIP
- Maintains current flow with safety check

**Cons**:
- More complex implementation
- Performance overhead for validation

### Testing Requirements

#### Step 9 Enhanced Logging
Add validation checks at each stage:
- `step 9b-validate`: Check File object is valid video
- `step 9e-validate`: Verify buffer content after read
- `step 10a-validate`: Confirm ZIP internal structure

#### Test Cases
1. Fresh AI video generation → immediate export
2. AI video generation → app restart → export (tests persistence)
3. Mixed media (AI video + user upload) → export
4. Large AI video (>10MB) → export

### Recommended Implementation Order
1. **Immediate Fix**: Implement Solution 1 (prioritize localPath for AI videos)
2. **Add Validation**: Log first 20 bytes of file data at step 9 to verify content
3. **Test**: Verify ZIP extracts correctly
4. **Long-term**: Consider Solution 3 for robust validation

### Debug Commands for Console
```javascript
// Check media item structure
const store = JSON.parse(localStorage.getItem('media-8ee6a680-1bb3-4c4a-906e-9b6c7271e97a'));
console.log('Items:', store.items.map(i => ({
  name: i.name,
  hasFile: !!i.file,
  hasLocalPath: !!i.localPath,
  localPath: i.localPath,
  metadata: i.metadata
})));

// Verify file can be read from disk
if(store.items[0]?.localPath) {
  window.electronAPI.readFile(store.items[0].localPath)
    .then(buffer => console.log('File readable:', !!buffer, 'Size:', buffer?.length))
    .catch(err => console.error('Read failed:', err));
}

// Check blob URL validity
if(store.items[0]?.url) {
  fetch(store.items[0].url)
    .then(r => r.blob())
    .then(b => console.log('Blob valid:', b.size > 0, 'Size:', b.size))
    .catch(err => console.error('Blob invalid:', err));
}
```
