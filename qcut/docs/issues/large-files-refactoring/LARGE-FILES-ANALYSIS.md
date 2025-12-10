# Large Files Analysis and Refactoring Recommendations

This document identifies the top 10 source code files exceeding 800 lines and provides recommendations for splitting them into smaller, more maintainable modules.

---

## Summary Table

| # | File | Lines | Recommendation | Status |
|---|------|-------|----------------|--------|
| 1 | `apps/web/src/components/editor/media-panel/views/ai/index.tsx` | ~~4246~~ 1168 | ~~Split into 4-5 files~~ | ✅ **REFACTORED** |
| 2 | `apps/web/src/lib/ai-video-client.ts` | ~~4008~~ 48 | ~~Split into 3-4 files~~ | ✅ **REFACTORED** |
| 3 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | ~~2616~~ 1756 | ~~Split into 3 files~~ | ✅ **REFACTORED** |
| 4 | `electron/ffmpeg-handler.ts` | ~~2210~~ 1194 | ~~Split into 3 files~~ | ✅ **REFACTORED** |
| 5 | `apps/web/src/stores/timeline-store.ts` | 2194 | Split into 3 files | Pending |
| 6 | `apps/web/src/lib/fal-ai-client.ts` | ~~1806~~ 1304 | ~~Split into 3 files~~ | ✅ **REFACTORED** |
| 7 | `apps/web/src/lib/export-engine-cli.ts` | 1689 | Split into 3 files | Pending |
| 8 | `apps/web/src/components/editor/timeline/index.tsx` | 1538 | Split into 3-4 files | Pending |
| 9 | `apps/web/src/components/editor/media-panel/views/ai-constants.ts` | 1410 | Split into 2-3 files | Pending |
| 10 | `apps/web/src/lib/export-engine.ts` | 1365 | Split into 2-3 files | Pending |

---

## 1. ai/index.tsx ✅ REFACTORED (Dec 2025)

**Path**: `qcut/apps/web/src/components/editor/media-panel/views/ai/index.tsx`

### Refactoring Complete

**Original Size**: 4,246 lines → **Current Size**: 1,168 lines (~72% reduction)

### New File Structure

| File | Lines | Purpose |
|------|-------|---------|
| `ai/index.tsx` | 1,168 | Main component (orchestration + tabs) |
| `ai/components/ai-history-panel.tsx` | - | History panel component |
| `ai/components/ai-image-upload.tsx` | - | Image upload component |
| `ai/components/ai-select-fields.tsx` | - | Select field components |
| `ai/components/ai-settings-panel.tsx` | - | Settings panel component |
| `ai/tabs/ai-text-tab.tsx` | - | Text-to-video tab |
| `ai/tabs/ai-image-tab.tsx` | - | Image-to-video tab |
| `ai/tabs/ai-avatar-tab.tsx` | - | Avatar generation tab |
| `ai/tabs/ai-upscale-tab.tsx` | - | Video upscale tab |
| `ai/settings/ai-sora-settings.tsx` | - | Sora model settings |
| `ai/settings/ai-reve-settings.tsx` | - | Reve model settings |
| `ai/settings/ai-veo-settings.tsx` | - | Veo model settings |

### What Was Extracted

1. **Tab Components** (`ai/tabs/`)
   - Separate components for Text, Image, Avatar, and Upscale tabs
   - Each tab handles its own UI and model-specific settings

2. **Settings Components** (`ai/settings/`)
   - Model-specific settings panels extracted to dedicated components
   - Clean separation of configuration UI

3. **Shared Components** (`ai/components/`)
   - Reusable components: history panel, image upload, select fields, settings panel
   - Reduces duplication across tabs

### Benefits Achieved

- ✅ Reduced main component by ~3,000 lines
- ✅ Clean tab-based architecture
- ✅ Reusable settings components
- ✅ Better separation of concerns

---

## 2. ai-video-client.ts ✅ REFACTORED (Dec 2025)

**Path**: `qcut/apps/web/src/lib/ai-video-client.ts`

### Refactoring Complete

**Original Size**: 4,008 lines → **Current Size**: 48 lines (~99% reduction)

### New File Structure

| File | Lines | Purpose |
|------|-------|---------|
| `ai-video-client.ts` | 48 | Barrel file (re-exports) |
| `ai-video/index.ts` | - | Main barrel file |
| `ai-video/core/fal-request.ts` | - | FAL API request utilities |
| `ai-video/core/polling.ts` | - | Queue polling with progress |
| `ai-video/core/streaming.ts` | - | Video streaming download |
| `ai-video/generators/text-to-video.ts` | - | T2V generators |
| `ai-video/generators/image-to-video.ts` | - | I2V generators |
| `ai-video/generators/avatar.ts` | - | Avatar/talking head generation |
| `ai-video/generators/upscale.ts` | - | Video upscaling |
| `ai-video/validation/validators.ts` | - | Input validation |
| `ai-video/models/sora2.ts` | - | Sora 2 parameter conversion |

### What Was Extracted

1. **Core Utilities** (`ai-video/core/`)
   - FAL API request handling
   - Queue polling with progress updates
   - Video streaming download

2. **Generators** (`ai-video/generators/`)
   - Text-to-video: Sora 2, Veo, Kling, LTX, Seedance, etc.
   - Image-to-video: Frame animation, I2V models
   - Avatar: Talking head generation
   - Upscale: Video enhancement

3. **Model-Specific Logic** (`ai-video/models/`)
   - Sora 2 parameter conversion and response parsing
   - Model detection utilities

4. **Validation** (`ai-video/validation/`)
   - Input validation for all generators
   - Type guards and checks

### Benefits Achieved

- ✅ Reduced main file by ~4,000 lines
- ✅ Modular architecture for 40+ AI models
- ✅ Clear separation by generator type
- ✅ Reusable core utilities
- ✅ Backward-compatible exports via barrel file

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

## 4. ffmpeg-handler.ts ✅ REFACTORED (Dec 2025)

**Path**: `qcut/electron/ffmpeg-handler.ts`

### Refactoring Complete

**Original Size**: 2,210 lines → **Current Size**: 1,194 lines (~46% reduction)

### New File Structure

| File | Lines | Purpose |
|------|-------|---------|
| `ffmpeg-handler.ts` | 1,194 | Main IPC handler (registration + argument building) |
| `ffmpeg/types.ts` | 256 | All TypeScript interfaces |
| `ffmpeg/utils.ts` | 571 | Reusable utilities (path resolution, probing, normalization) |
| `ffmpeg/index.ts` | 46 | Barrel exports |

### What Was Extracted

1. **Type Definitions** (`ffmpeg/types.ts`)
   - 15+ interfaces: `AudioFile`, `VideoSource`, `StickerSource`, `ExportOptions`, etc.
   - Quality settings and progress types
   - IPC handler type map

2. **Utility Functions** (`ffmpeg/utils.ts`)
   - `getFFmpegPath()`, `getFFprobePath()` - path resolution
   - `probeVideoFile()` - video codec validation
   - `normalizeVideo()` - Mode 1.5 normalization (~320 lines)
   - `parseProgress()` - progress parsing
   - Debug logging utilities
   - Quality and duration constants

### What Stayed in Handler

- `setupFFmpegIPC()` - 10 IPC handler registrations
- `buildFFmpegArgs()` - FFmpeg argument construction (~260 lines)
- Mode 1.5 execution logic - tightly coupled to IPC events

### Benefits Achieved

- ✅ Main handler reduced by 46% (2,210 → 1,194 lines)
- ✅ Types extracted for reuse across modules
- ✅ Utilities extracted for independent testing
- ✅ New `getFFprobePath()` helper for cleaner code
- ✅ Backward compatibility preserved (`main.ts` still works)

### Documentation

See `docs/issues/large-files-refactoring/FFMPEG-HANDLER-REFACTORING-PLAN.md` for detailed implementation notes.

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

## 6. fal-ai-client.ts ✅ REFACTORED (Dec 2025)

**Path**: `qcut/apps/web/src/lib/fal-ai-client.ts`

### Refactoring Complete

**Original Size**: 1,806 lines → **Current Size**: 1,304 lines (~28% reduction)

### New File Structure

| File | Lines | Purpose |
|------|-------|---------|
| `fal-ai-client.ts` | 1,304 | Main client (FalAIClient class + generation methods) |
| `ai-video/core/fal-request.ts` | 237 | FAL API request utilities + error parsing |
| `ai-video/core/fal-upload.ts` | 283 | File upload with Electron IPC fallback |
| `ai-video/validation/validators.ts` | 607 | All validators (video + image) |
| `fal-ai/model-handlers/index.ts` | 78 | Barrel + model detection |
| `fal-ai/model-handlers/v3-params.ts` | 26 | V3/SeedEdit parameter conversion |
| `fal-ai/model-handlers/v4-params.ts` | 112 | V4/SeedDream parameter conversion |
| `fal-ai/model-handlers/nano-banana-params.ts` | 74 | Nano Banana parameter conversion |
| `fal-ai/model-handlers/flux-params.ts` | 81 | FLUX model parameter conversion |

### What Was Extracted

1. **Core FAL Utilities** (`ai-video/core/`)
   - `parseFalErrorResponse()` - error response parsing
   - `FAL_UPLOAD_URL` constant
   - File upload with Electron IPC fallback
   - Upload type definitions (`FalUploadError`, `FalUploadFileType`)

2. **Validators** (`ai-video/validation/validators.ts`)
   - `normalizeAspectRatio()`, `imageSizeToAspectRatio()` - aspect ratio handling
   - `normalizeOutputFormat()` - output format validation
   - Reve validators: `clampReveNumImages()`, `truncateRevePrompt()`, `validateRevePrompt()`, `validateReveNumImages()`
   - Constants: `VALID_OUTPUT_FORMATS`, `DEFAULT_ASPECT_RATIO`, `IMAGE_SIZE_TO_ASPECT_RATIO`

3. **Model Parameter Handlers** (`fal-ai/model-handlers/`)
   - `convertV3Parameters()` - V3/SeedEdit models
   - `convertV4Parameters()` - V4/SeedDream models
   - `convertNanoBananaParameters()` - Nano Banana model
   - `convertFluxParameters()` - FLUX Kontext models
   - `detectModelVersion()` - model version routing

### Code Reuse Benefits

| Shared Module | Reused By |
|---------------|-----------|
| `ai-video/core/fal-request.ts` | fal-ai-client, ai-video-client, image-edit-client |
| `ai-video/core/fal-upload.ts` | fal-ai-client, future clients |
| `ai-video/validation/validators.ts` | All FAL clients (video + image) |
| `fal-ai/model-handlers/` | fal-ai-client, image-edit-client |

### Benefits Achieved

- ✅ Main client reduced by 28% (1,806 → 1,304 lines)
- ✅ Upload logic extracted for reuse across all FAL clients
- ✅ Validators consolidated into single source of truth
- ✅ Model handlers isolated for easy updates when FAL changes API
- ✅ Backward compatible (`detectModelVersion` re-exported)
- ✅ All tests pass (11/11 ai-video-client tests)

### Documentation

See `docs/issues/large-files-refactoring/FAL-AI-CLIENT-REFACTORING-PLAN.md` for detailed implementation notes.

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
| ~~High~~ | ~~`ai.tsx`~~ | ~~Largest file (4246 lines), multiple UI concerns~~ | ✅ **DONE** |
| ~~High~~ | ~~`ai-video-client.ts`~~ | ~~Second largest (4008 lines), API complexity~~ | ✅ **DONE** |
| High | `timeline-store.ts` | Core functionality, high change frequency | Pending |
| ~~Medium~~ | ~~`use-ai-generation.ts`~~ | ~~Complex hook, testability benefits~~ | ✅ **DONE** |
| ~~Medium~~ | ~~`ffmpeg-handler.ts`~~ | ~~Electron-specific, export functionality~~ | ✅ **DONE** |
| ~~Medium~~ | ~~`fal-ai-client.ts`~~ | ~~API client, clear module boundaries~~ | ✅ **DONE** |
| Medium | `export-engine-cli.ts` | Export logic, FFmpeg integration | Pending |
| Low | `timeline/index.tsx` | UI component, moderate complexity | Pending |
| Low | `ai-constants.ts` | Configuration only, less urgent | Pending |
| Low | `export-engine.ts` | Base export class, stable | Pending |

---

*Document generated: 2025-12-08*
*Last updated: 2025-12-10 (ai.tsx, ai-video-client.ts, use-ai-generation.ts, ffmpeg-handler.ts refactoring completed)*
*Analysis based on QCut codebase structure*
