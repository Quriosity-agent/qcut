# Large Files Analysis and Refactoring Recommendations

This document identifies the top 10 source code files exceeding 800 lines and provides recommendations for splitting them into smaller, more maintainable modules.

---

## Summary Table

| # | File | Lines | Recommendation | Status |
|---|------|-------|----------------|--------|
| 1 | `apps/web/src/components/editor/media-panel/views/ai.tsx` | 4246 | Split into 4-5 files | Pending |
| 2 | `apps/web/src/lib/ai-video-client.ts` | 4008 | Split into 3-4 files | Pending |
| 3 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | ~~2616~~ 1756 | ~~Split into 3 files~~ | ✅ **REFACTORED** |
| 4 | `electron/ffmpeg-handler.ts` | 2210 | Split into 3 files | Pending |
| 5 | `apps/web/src/stores/timeline-store.ts` | 2194 | Split into 3 files | Pending |
| 6 | `apps/web/src/lib/fal-ai-client.ts` | 1786 | Split into 3 files | Pending |
| 7 | `apps/web/src/lib/export-engine-cli.ts` | 1689 | Split into 3 files | Pending |
| 8 | `apps/web/src/components/editor/timeline/index.tsx` | 1538 | Split into 3-4 files | Pending |
| 9 | `apps/web/src/components/editor/media-panel/views/ai-constants.ts` | 1410 | Split into 2-3 files | Pending |
| 10 | `apps/web/src/lib/export-engine.ts` | 1365 | Split into 2-3 files | Pending |

---

## 1. ai.tsx (4246 lines)

**Path**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

### Main Functions/Sections

1. **Imports & Type Definitions** (Lines 1-150)
   - 40+ import statements
   - Type aliases for model configurations (ReveAspectRatioOption, LTXV2FastDuration, etc.)
   - Duration/resolution option arrays (SEEDANCE_DURATION_OPTIONS, KLING_ASPECT_RATIOS, etc.)

2. **State Management - Model Options** (Lines 157-400)
   - 60+ `useState` hooks for various model options
   - Frame-to-Video state (firstFrame, lastFrame)
   - Video-to-Video state for Kling models
   - Avatar-specific state (avatarImage, audioFile, referenceImages)
   - Upscale tab state (sourceVideoFile, bytedanceTargetResolution, flashvsrSettings)

3. **Text-to-Video Settings** (Lines 271-380)
   - Unified T2V settings (t2vAspectRatio, t2vResolution, t2vDuration)
   - Model-specific settings (LTXV2, Seedance, Kling, Wan25)
   - Settings expansion state

4. **Computed Values & Effects** (Lines 400-500)
   - `combinedCapabilities` - memoized capabilities calculation
   - Settings clamping effects when models change
   - `getActiveSettingsCount()` helper

5. **Event Handlers** (Lines 472-800)
   - `handleUpscaleVideoChange` - file metadata extraction
   - `handleUpscaleVideoUrlBlur` - URL validation
   - Upload handlers for various media types

6. **UI Components - Main Render** (Lines 800-4246)
   - Tab navigation (Text, Image, Avatar, Upscale)
   - Model selection dropdowns
   - Per-model settings panels
   - Generation controls and results display
   - History panel integration

### Recommended Split

#### File 1: `ai-state.ts` (~400 lines)
- Custom hook `useAIViewState()` with all state management
- All model-specific state variables
- State initialization and reset functions

#### File 2: `ai-handlers.ts` (~300 lines)
- All event handlers
- Video/image upload handlers
- Form submission logic
- Validation functions

#### File 3: `ai-text-tab.tsx` (~800 lines)
- Text-to-Video tab UI
- Model selection for T2V
- T2V settings panel

#### File 4: `ai-image-tab.tsx` (~800 lines)
- Image-to-Video tab UI
- Frame upload sections
- I2V model settings

#### File 5: `ai.tsx` (~1900 lines) - Main component
- Tab router structure
- Avatar tab (smaller)
- Upscale tab (smaller)
- Compose all tabs together

---

## 2. ai-video-client.ts (4008 lines)

**Path**: `qcut/apps/web/src/lib/ai-video-client.ts`

### Main Functions/Sections

1. **Type Definitions & Imports** (Lines 1-140)
   - Sora2 payload types (discriminated union)
   - Request/Response interfaces
   - Helper type definitions

2. **Sora2 Model Handling** (Lines 59-298)
   - `isSora2Model()`, `getSora2ModelType()` - model detection
   - `convertSora2Parameters()` - parameter conversion with exhaustiveness check
   - `parseSora2Response()` - response parsing with metadata extraction

3. **Core Generation Functions** (Lines 442-1500)
   - `generateVideo()` - main text-to-video function with progress callbacks
   - Model-specific payload builders for each AI model
   - Polling and status handling

4. **Image-to-Video Generation** (Lines 1500-2500)
   - `generateImageToVideo()` - image animation
   - Frame-to-video handling (Veo 3.1)
   - Seedance, Kling, LTXV2 I2V handlers

5. **Avatar Generation** (Lines 2500-3200)
   - `generateAvatarVideo()` - avatar video creation
   - Kling Avatar v2 handling
   - OmniHuman model support

6. **Utility Functions** (Lines 3200-4008)
   - `uploadFileToFal()` - file upload to FAL storage
   - `generateJobId()` - unique ID generation
   - Progress callback handling
   - Error handling and retry logic

### Recommended Split

#### File 1: `ai-video-types.ts` (~200 lines)
- All type definitions
- Request/Response interfaces
- Sora2 payload types

#### File 2: `ai-video-sora2.ts` (~300 lines)
- All Sora2-specific functions
- Model detection and parameter conversion
- Response parsing

#### File 3: `ai-video-generators.ts` (~1500 lines)
- `generateVideo()` - text-to-video
- `generateImageToVideo()` - image animation
- `generateAvatarVideo()` - avatar generation

#### File 4: `ai-video-client.ts` (~2000 lines) - Main client
- Model-specific payload builders
- Utility functions
- File upload helpers
- Import and re-export from other modules

---

## 3. use-ai-generation.ts ✅ REFACTORED (Dec 2025)

**Path**: `qcut/apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts`

### Refactoring Complete

**Original Size**: 2,659 lines → **Current Size**: 1,756 lines (~34% reduction)

### New File Structure

| File | Lines | Purpose |
|------|-------|---------|
| `use-ai-generation.ts` | 1,756 | Main hook (orchestration + state) |
| `generation/media-integration.ts` | 316 | Download + save + media store integration |
| `generation/model-handlers.ts` | 1,257 | Model-specific handlers + router functions |
| `generation/index.ts` | 30 | Barrel file |

### What Was Extracted

1. **Media Integration** (`generation/media-integration.ts`)
   - `integrateVideoToMediaStore()` - adds generated video to media store
   - `updateVideoWithLocalPaths()` - updates video with local file paths
   - `canIntegrateMedia()` - checks if media can be integrated
   - Download and streaming utilities

2. **Model Handlers** (`generation/model-handlers.ts`)
   - Type-safe handler functions for all 40+ AI models
   - Router functions: `routeTextToVideoHandler()`, `routeImageToVideoHandler()`, `routeUpscaleHandler()`, `routeAvatarHandler()`
   - Type aliases for strict literal types (duration, resolution, FPS)
   - Settings interfaces: `TextToVideoSettings`, `ImageToVideoSettings`, `AvatarSettings`, `UpscaleSettings`

### Benefits Achieved

- ✅ Reduced main hook by ~900 lines
- ✅ Model-specific logic isolated in dedicated handlers
- ✅ Type-safe router pattern for generation dispatch
- ✅ All 34 AI video tests pass
- ✅ Clean separation of concerns

### Documentation

See `docs/issues/large-files-refactoring/USE-AI-GENERATION-REFACTORING-PLAN.md` for detailed implementation notes.

---

## 4. ffmpeg-handler.ts (2210 lines)

**Path**: `qcut/electron/ffmpeg-handler.ts`

### Main Functions/Sections

1. **FFmpeg Setup & Configuration** (Lines 1-200)
   - FFmpeg binary path resolution
   - Configuration constants
   - Platform-specific setup (Windows/macOS/Linux)

2. **Video Export Operations** (Lines 200-800)
   - Main export function with filter chain building
   - Frame extraction and encoding
   - Audio stream handling
   - Video concatenation

3. **Transcoding & Conversion** (Lines 800-1200)
   - Format conversion (MP4, WebM, etc.)
   - Codec selection and configuration
   - Bitrate and quality settings

4. **Utility Operations** (Lines 1200-1700)
   - Video metadata extraction
   - Thumbnail generation
   - Duration detection
   - Codec compatibility checks

5. **IPC Handler Registration** (Lines 1700-2210)
   - All IPC handler registrations
   - Error handling wrappers
   - Progress reporting to renderer
   - Session management

### Recommended Split

#### File 1: `ffmpeg-config.ts` (~200 lines)
- FFmpeg path resolution
- Configuration constants
- Platform-specific setup

#### File 2: `ffmpeg-export.ts` (~600 lines)
- Video export operations
- Filter chain building
- Frame extraction and encoding

#### File 3: `ffmpeg-utils.ts` (~500 lines)
- Metadata extraction
- Thumbnail generation
- Format detection
- Codec utilities

#### File 4: `ffmpeg-handler.ts` (~900 lines) - Main handler
- IPC handler registration
- Transcoding operations
- Import and compose other modules

---

## 5. timeline-store.ts (2194 lines)

**Path**: `qcut/apps/web/src/stores/timeline-store.ts`

### Main Functions/Sections

1. **Interface Definitions** (Lines 1-353)
   - `TimelineStore` interface with 60+ methods and properties
   - Type imports and helper function `getElementNameWithSuffix`

2. **Core Track Operations** (Lines 358-720)
   - `addTrack`, `insertTrackAt`, `removeTrack`
   - `removeTrackWithRipple` - complex ripple editing logic
   - Track ordering helpers: `updateTracks`, `updateTracksAndSave`

3. **Element Operations** (Lines 722-1010)
   - `addElementToTrack`, `removeElementFromTrack`, `moveElementToTrack`
   - Element validation and media handling
   - Ripple editing for elements

4. **Timeline Manipulation** (Lines 1011-1490)
   - `updateElementTrim`, `updateElementDuration`, `updateElementStartTime`
   - Split operations: `splitElement`, `splitAndKeepLeft`, `splitAndKeepRight`
   - Audio separation: `separateAudio`, `getAudioElements`
   - Media replacement: `replaceElementMedia`

5. **Effects & Transform Operations** (Lines 1195-1280)
   - `updateElementTransform`, `updateElementPosition`, `updateElementSize`
   - `updateMediaElement`, `updateTextElement`

6. **Persistence & History** (Lines 1645-1880)
   - `loadProjectTimeline`, `saveProjectTimeline`, `saveImmediate`
   - `undo`, `redo`, `pushHistory`
   - Auto-save logic with debouncing

7. **Effects Management** (Lines 2063-2193)
   - `addEffectToElement`, `removeEffectFromElement`
   - `getElementEffectIds`, `clearElementEffects`

8. **Drag State Management** (Lines 1716-1772)
   - `dragState`, `setDragState`, `startDrag`, `updateDragTime`, `endDrag`

### Recommended Split

#### File 1: `timeline-store-types.ts` (~100 lines)
- `TimelineStore` interface definition
- All type imports
- Helper type utilities

#### File 2: `timeline-store-operations.ts` (~800 lines)
- Track operations (add, remove, insert)
- Element operations (add, remove, move)
- Split operations
- Ripple editing logic

#### File 3: `timeline-store.ts` (~1300 lines) - Main store
- Core store creation with `create<TimelineStore>`
- Persistence methods (load/save)
- History management (undo/redo)
- Effects management
- Auto-save logic
- Import and compose operations from other files

---

## 6. fal-ai-client.ts (1786 lines)

**Path**: `qcut/apps/web/src/lib/fal-ai-client.ts`

### Main Functions/Sections

1. **Type Definitions & Constants** (Lines 1-120)
   - `FalImageResponse`, `GenerationResult` interfaces
   - Upload error types
   - Output format constants (VALID_OUTPUT_FORMATS)
   - Aspect ratio mappings

2. **Validation Helpers** (Lines 120-220)
   - `normalizeAspectRatio()` - aspect ratio normalization
   - `imageSizeToAspectRatio()` - size conversion
   - `normalizeOutputFormat()` - format validation
   - Reve-specific validators (prompt, numImages)

3. **FalAIClient Class** (Lines 224-500)
   - Constructor with API key initialization
   - `makeRequest<T>()` - generic HTTP request handler
   - Error response parsing

4. **File Upload Methods** (Lines 331-500)
   - `uploadFileToFal()` - generic file upload with IPC fallback
   - `uploadImageToFal()`, `uploadAudioToFal()`, `uploadVideoToFal()`
   - Electron IPC integration for CORS bypass

5. **Model-Specific Parameter Conversion** (Lines 503-900)
   - `convertSettingsToParams()` - settings to API params
   - Model-specific handling (Imagen4, SeedDream, WAN, FLUX, Qwen)
   - Image size and aspect ratio mapping

6. **Generation Methods** (Lines 900-1786)
   - `generateImage()` - single model image generation
   - `generateMultipleImages()` - multi-model parallel generation
   - Reve text-to-image and edit methods
   - Veo 3.1 video generation methods

### Recommended Split

#### File 1: `fal-ai-types.ts` (~150 lines)
- All type definitions
- Response interfaces
- Validation constants

#### File 2: `fal-ai-upload.ts` (~350 lines)
- File upload methods
- Electron IPC integration
- Upload error handling

#### File 3: `fal-ai-client.ts` (~1300 lines) - Main client
- FalAIClient class
- Generation methods
- Parameter conversion
- Import upload methods

---

## 7. export-engine-cli.ts (1689 lines)

**Path**: `qcut/apps/web/src/lib/export-engine-cli.ts`

### Main Functions/Sections

1. **Types & Imports** (Lines 1-60)
   - `VideoSourceInput`, `AudioFileInput` interfaces
   - `StickerSourceForFilter` interface
   - Progress callback type

2. **CLIExportEngine Class Setup** (Lines 58-140)
   - Constructor with Electron environment check
   - Session and frame directory management
   - Effects store integration

3. **FFmpeg Text Escaping** (Lines 93-140)
   - `escapeTextForFFmpeg()` - special character escaping
   - `escapePathForFFmpeg()` - path escaping for filters

4. **Font Resolution** (Lines 140-270)
   - `resolveFontPath()` - cross-platform font handling
   - Windows font file mapping
   - Linux/macOS fontconfig support

5. **Text Overlay Filters** (Lines 270-490)
   - `convertTextElementToDrawtext()` - text to FFmpeg filter
   - `buildTextOverlayFilters()` - filter chain building
   - Color conversion, timing, positioning

6. **Video Source Extraction** (Lines 490-700)
   - `extractVideoSources()` - video path extraction
   - `extractVideoInputPath()` - Mode 2 optimization
   - Temp file creation for blob sources

7. **Sticker Overlay System** (Lines 700-1000)
   - `extractStickerSources()` - sticker path extraction
   - `buildStickerOverlayFilters()` - overlay filter building
   - SVG to PNG conversion handling

8. **Main Export Methods** (Lines 1000-1689)
   - `exportVideo()` - main export orchestration
   - Mode selection (Mode 2 vs fallback)
   - Progress reporting and cleanup

### Recommended Split

#### File 1: `export-cli-types.ts` (~100 lines)
- All type definitions
- Input interfaces
- Progress callback types

#### File 2: `export-cli-filters.ts` (~500 lines)
- Text escaping utilities
- Font resolution
- Text overlay filter building
- Sticker overlay filter building

#### File 3: `export-cli-sources.ts` (~400 lines)
- Video source extraction
- Sticker source extraction
- Temp file management

#### File 4: `export-engine-cli.ts` (~700 lines) - Main engine
- CLIExportEngine class
- Main export methods
- Mode selection logic
- Import and compose other modules

---

## 8. timeline/index.tsx (1538 lines)

**Path**: `qcut/apps/web/src/components/editor/timeline/index.tsx`

### Main Functions/Sections

1. **Imports & Setup** (Lines 1-80)
   - UI component imports (ScrollArea, Button, Tooltip, etc.)
   - Store hooks (timeline, media, playback, project)
   - Custom hooks (zoom, frame cache, selection box)

2. **State & Refs** (Lines 82-200)
   - Timeline component state (isDragOver, isProcessing, progress)
   - Multiple refs for scroll synchronization
   - Mouse tracking ref for click vs drag detection

3. **Timeline Calculations** (Lines 130-200)
   - Zoom functionality with `useTimelineZoom`
   - Dynamic timeline width calculation
   - Cache status tracking

4. **Event Handlers - Mouse** (Lines 200-350)
   - `handleTimelineMouseDown()` - mouse tracking
   - `handleTimelineContentClick()` - seek on click
   - Selection box handling

5. **Event Handlers - Drag & Drop** (Lines 358-540)
   - `handleDragEnter()`, `handleDragOver()`, `handleDragLeave()`
   - `handleDrop()` - media/text/sticker drop handling
   - File processing for external drops

6. **Scroll Synchronization** (Lines 540-700)
   - Horizontal sync between ruler and tracks
   - Vertical sync between labels and content
   - Debounced scroll handlers

7. **Render - Toolbar & Controls** (Lines 700-1000)
   - Playback controls (play/pause)
   - Timeline actions (split, delete, zoom)
   - Snapping and ripple edit toggles

8. **Render - Timeline Content** (Lines 1000-1538)
   - Ruler rendering
   - Track labels
   - Track content with elements
   - Effects timeline
   - Selection box and snap indicator

### Recommended Split

#### File 1: `timeline-handlers.ts` (~300 lines)
- Mouse event handlers
- Drag and drop handlers
- Click handling logic

#### File 2: `timeline-toolbar.tsx` (~250 lines)
- Toolbar UI component
- Playback controls
- Action buttons

#### File 3: `timeline-ruler.tsx` (~200 lines)
- Ruler rendering
- Time markers
- Ruler interactions

#### File 4: `timeline/index.tsx` (~800 lines) - Main component
- Core timeline structure
- Scroll synchronization
- Track rendering
- Import and compose other components

---

## 9. ai-constants.ts (1410 lines)

**Path**: `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts`

### Main Functions/Sections

1. **API Configuration** (Lines 1-30)
   - FAL API key and base URL
   - Upscale model endpoints re-export
   - `API_CONFIG` object

2. **Sora 2 Models** (Lines 31-230)
   - Text-to-video models (standard, pro)
   - Image-to-video models
   - Video-to-video remix

3. **Kling Models** (Lines 230-400)
   - Kling v2.6 Pro (T2V, I2V)
   - Kling v2.5 Turbo
   - Kling Avatar models

4. **LTX Video Models** (Lines 400-600)
   - LTXV2 Pro and Fast variants
   - T2V and I2V endpoints
   - Resolution and duration options

5. **Veo 3.1 Models** (Lines 600-800)
   - Fast and standard T2V
   - Image-to-video and frame-to-video
   - Resolution configurations

6. **Other Video Models** (Lines 800-1100)
   - WAN v2.5 Preview
   - Seedance models
   - Hailuo models
   - Vidu Q2 models

7. **Avatar & Upscale Models** (Lines 1100-1300)
   - OmniHuman models
   - Bytedance upscaler
   - FlashVSR, Topaz models

8. **Helper Constants** (Lines 1300-1410)
   - Error messages
   - Upload constants
   - Model configurations (LTXV2_FAST_CONFIG)
   - Reve text-to-image model config

### Recommended Split

#### File 1: `ai-models-text-to-video.ts` (~400 lines)
- Sora 2 T2V models
- Kling T2V models
- LTX Video T2V models
- Veo 3.1 T2V models

#### File 2: `ai-models-image-to-video.ts` (~400 lines)
- All I2V models
- Frame-to-video models
- Seedance, Hailuo, Vidu models

#### File 3: `ai-models-avatar-upscale.ts` (~300 lines)
- Avatar models (Kling, OmniHuman)
- Upscale models (Bytedance, FlashVSR, Topaz)

#### File 4: `ai-constants.ts` (~300 lines) - Main exports
- API configuration
- Error messages and upload constants
- Re-export all models as `AI_MODELS` array
- Helper configurations

---

## 10. export-engine.ts (1365 lines)

**Path**: `qcut/apps/web/src/lib/export-engine.ts`

### Main Functions/Sections

1. **Types & Imports** (Lines 1-50)
   - `ActiveElement` interface
   - `AdvancedProgressInfo` interface
   - Progress callback type

2. **ExportEngine Class Setup** (Lines 52-130)
   - Constructor with canvas setup
   - MediaRecorder and FFmpeg recorder properties
   - Video cache initialization
   - Canvas quality settings based on purpose

3. **Active Elements** (Lines 130-200)
   - `calculateTotalFrames()` - frame count calculation
   - `getActiveElements()` - elements at specific time
   - Element sorting by track type

4. **Frame Rendering** (Lines 200-380)
   - `renderFrame()` - main frame render
   - `renderElement()` - element dispatch
   - `renderMediaElement()` - media handling

5. **Image Rendering** (Lines 270-380)
   - `renderImage()` - image element rendering
   - Effects application to images
   - Error handling and fallbacks

6. **Video Rendering** (Lines 380-600)
   - `renderVideo()` - video frame rendering with retry
   - `renderVideoAttempt()` - single attempt with seek
   - Video caching and effects

7. **Text & Sticker Rendering** (Lines 600-800)
   - `renderTextElement()` - text rendering
   - `renderOverlayStickers()` - sticker compositing
   - Font and style handling

8. **Export Orchestration** (Lines 800-1365)
   - `export()` - main export method
   - MediaRecorder vs FFmpeg selection
   - Progress reporting
   - Cleanup and resource management

### Recommended Split

#### File 1: `export-engine-types.ts` (~100 lines)
- All type definitions
- Interface definitions
- Callback types

#### File 2: `export-engine-render.ts` (~500 lines)
- `renderFrame()` method
- `renderImage()`, `renderVideo()` methods
- `renderTextElement()`, `renderOverlayStickers()`
- Effects application

#### File 3: `export-engine.ts` (~750 lines) - Main engine
- ExportEngine class
- Constructor and setup
- Export orchestration
- Progress reporting
- Import render methods

---

## General Refactoring Guidelines

### Benefits of Splitting

1. **Improved Maintainability**: Smaller files are easier to understand and modify
2. **Better Testing**: Isolated modules can be unit tested independently
3. **Reduced Merge Conflicts**: Multiple developers can work on different aspects
4. **Faster IDE Performance**: Smaller files load and parse faster
5. **Clearer Dependencies**: Module boundaries make dependencies explicit

### Implementation Strategy

1. **Phase 1**: Extract type definitions first (lowest risk)
2. **Phase 2**: Extract pure utility functions (no side effects)
3. **Phase 3**: Extract handlers/operations with clear interfaces
4. **Phase 4**: Update imports in dependent files
5. **Phase 5**: Add barrel exports if needed for backward compatibility

### Testing Considerations

- Run existing tests after each extraction
- Add unit tests for newly extracted modules
- Ensure no circular dependencies are introduced
- Verify all exports are properly re-exported if needed

---

## Priority Recommendation

| Priority | File | Reason | Status |
|----------|------|--------|--------|
| High | `ai.tsx` | Largest file (4246 lines), multiple UI concerns | Pending |
| High | `ai-video-client.ts` | Second largest (4008 lines), API complexity | Pending |
| High | `timeline-store.ts` | Core functionality, high change frequency | Pending |
| ~~Medium~~ | ~~`use-ai-generation.ts`~~ | ~~Complex hook, testability benefits~~ | ✅ **DONE** |
| Medium | `ffmpeg-handler.ts` | Electron-specific, export functionality | Pending |
| Medium | `fal-ai-client.ts` | API client, clear module boundaries | Pending |
| Medium | `export-engine-cli.ts` | Export logic, FFmpeg integration | Pending |
| Low | `timeline/index.tsx` | UI component, moderate complexity | Pending |
| Low | `ai-constants.ts` | Configuration only, less urgent | Pending |
| Low | `export-engine.ts` | Base export class, stable | Pending |

---

*Document generated: 2025-12-08*
*Last updated: 2025-12-09 (use-ai-generation.ts refactoring completed)*
*Analysis based on QCut codebase structure*
