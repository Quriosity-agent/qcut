# Top 10 Code Files Longer Than 800 Lines

Current analysis of the largest source code files in the QCut codebase.

**Generated**: 2025-12-17
**Threshold**: 800+ lines

---

## Summary Table

| # | File | Lines | Category | Status |
|---|------|-------|----------|--------|
| 1 | `ai/hooks/use-ai-generation.ts` | 1,860 | React Hook | ✅ Partially Refactored |
| 2 | `stores/timeline-store.ts` | 1,842 | State Management | ✅ Refactored (6 modules) |
| 3 | `ai/constants/ai-constants.ts` | 1,594 | Configuration | Pending |
| 4 | `ai/hooks/generation/model-handlers.ts` | 1,579 | AI Generation | New (extracted) |
| 5 | `timeline/index.tsx` | 1,538 | UI Component | Pending |
| 6 | `lib/text2image-models.ts` | 1,417 | Configuration | Pending |
| 7 | `lib/fal-ai-client.ts` | 1,405 | API Client | ✅ Partially Refactored |
| 8 | `lib/export-engine.ts` | 1,365 | Export Logic | Pending |
| 9 | `ai/tabs/ai-image-tab.tsx` | 1,283 | UI Component | Pending |
| 10 | `electron/main.ts` | 1,282 | Electron Main | Pending |

---

## 1. timeline-store.ts (1,842 lines)

**Path**: `apps/web/src/stores/timeline-store.ts`
**Category**: Zustand State Management

### Status: ✅ REFACTORED

The timeline store has been split into 6 focused modules:

| Module | Lines | Purpose |
|--------|-------|---------|
| `timeline-store.ts` | ~600 | Main store orchestration |
| `timeline/types.ts` | ~150 | Interfaces and constants |
| `timeline/track-operations.ts` | ~200 | Track CRUD + ripple |
| `timeline/element-operations.ts` | ~470 | Element CRUD + move |
| `timeline/split-operations.ts` | ~300 | Split, trim, audio separation |
| `timeline/persistence.ts` | ~300 | Load, save, auto-save |
| `timeline/utils.ts` | ~100 | Pure helper functions |

### Key Functions
- Track operations: `addTrack`, `removeTrack`, `removeTrackWithRipple`
- Element operations: `addElement`, `removeElement`, `moveElement`
- Split operations: `split`, `separateAudio`, `updateTrim`
- Persistence: `loadProjectTimeline`, `saveProjectTimeline`, `autoSave`

---

## 2. use-ai-generation.ts (1,860 lines)

**Path**: `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts`
**Category**: React Hook

### Status: ✅ PARTIALLY REFACTORED

Extracted modules:
- `generation/model-handlers.ts` (1,579 lines) - Model-specific handlers
- `generation/media-integration.ts` (~316 lines) - Download + media store

### Remaining Concerns
- Main hook still large at 1,860 lines
- State management logic could be further extracted
- Progress tracking could be isolated

### Key Functions
- `generateVideo()` - Main generation orchestration
- `routeTextToVideoHandler()` - T2V model routing
- `routeImageToVideoHandler()` - I2V model routing

---

## 3. timeline/index.tsx (1,538 lines)

**Path**: `apps/web/src/components/editor/timeline/index.tsx`
**Category**: React UI Component

### Status: PENDING

### Main Sections
1. **Event Handlers** (~350 lines) - Mouse, drag/drop, keyboard
2. **Scroll Synchronization** (~160 lines) - Ruler/track sync
3. **Toolbar & Controls** (~300 lines) - Playback, zoom, actions
4. **Timeline Content** (~540 lines) - Tracks, elements, ruler

### Recommended Split
- `timeline-handlers.ts` - Event handlers (~300 lines)
- `timeline-toolbar.tsx` - Toolbar UI (~250 lines)
- `timeline-ruler.tsx` - Ruler component (~200 lines)
- `timeline/index.tsx` - Main component (~800 lines)

---

## 4. ai-constants.ts (1,594 lines)

**Path**: `apps/web/src/components/editor/media-panel/views/ai/constants/ai-constants.ts`
**Category**: Configuration

### Status: PENDING

### Main Sections
1. **Sora 2 Models** (~200 lines)
2. **Kling Models** (~170 lines)
3. **LTX Video Models** (~200 lines)
4. **Veo 3.1 Models** (~200 lines)
5. **Other Video Models** (~300 lines)
6. **Avatar & Upscale** (~200 lines)
7. **Helper Constants** (~110 lines)

### Recommended Split
- `ai-models-text-to-video.ts` (~400 lines)
- `ai-models-image-to-video.ts` (~400 lines)
- `ai-models-avatar-upscale.ts` (~300 lines)
- `ai-constants.ts` (~300 lines) - Main exports

---

## 5. export-engine.ts (1,365 lines)

**Path**: `apps/web/src/lib/export-engine.ts`
**Category**: Video Export Logic

### Status: PENDING

### Main Sections
1. **Types & Setup** (~130 lines)
2. **Active Elements** (~70 lines)
3. **Frame Rendering** (~180 lines)
4. **Image Rendering** (~110 lines)
5. **Video Rendering** (~220 lines)
6. **Text & Sticker** (~200 lines)
7. **Export Orchestration** (~565 lines)

### Recommended Split
- `export-engine-types.ts` (~100 lines)
- `export-engine-render.ts` (~500 lines)
- `export-engine.ts` (~750 lines)

---

## 6. model-handlers.ts (1,579 lines)

**Path**: `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts`
**Category**: AI Generation

### Status: NEW (Extracted from use-ai-generation.ts)

### Main Sections
- Router functions for 40+ AI models
- Type-safe handler functions
- Settings interfaces

### Note
This file was recently extracted. Consider further splitting by model category if it grows.

---

## 7. text2image-models.ts (1,417 lines)

**Path**: `apps/web/src/lib/text2image-models.ts`
**Category**: Configuration

### Status: PENDING

### Description
Model definitions for text-to-image generation. Contains model configurations, parameters, and endpoint definitions.

### Recommended Split
- Group models by provider (Reve, FLUX, etc.)
- Extract shared parameter types

---

## 8. fal-ai-client.ts (1,405 lines)

**Path**: `apps/web/src/lib/fal-ai-client.ts`
**Category**: API Client

### Status: ✅ PARTIALLY REFACTORED

Previously extracted:
- `ai-video/core/fal-request.ts` - Request utilities
- `ai-video/core/fal-upload.ts` - File upload
- `ai-video/validation/validators.ts` - Validators
- `fal-ai/model-handlers/` - Parameter conversion

### Remaining
Main client class still at 1,405 lines. Consider extracting:
- Image generation methods
- Model-specific logic

---

## 9. ai-image-tab.tsx (1,283 lines)

**Path**: `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-image-tab.tsx`
**Category**: React UI Component

### Status: PENDING

### Description
Image-to-video tab component with model selection, parameter inputs, and generation controls.

### Recommended Split
- Extract model-specific settings components
- Extract image upload/preview components
- Extract generation controls

---

## 10. electron/main.ts (1,282 lines)

**Path**: `electron/main.ts`
**Category**: Electron Main Process

### Status: PENDING

### Main Sections
1. **Window Management** - BrowserWindow creation, lifecycle
2. **IPC Handlers** - 38+ IPC handlers across categories
3. **Protocol Registration** - Custom protocol handling
4. **Auto-updater** - Update logic

### Recommended Split
- `window-manager.ts` - Window lifecycle
- `ipc-registry.ts` - IPC handler registration
- `protocol-handler.ts` - Protocol handling
- `main.ts` - Entry point orchestration

---

## Files Just Under 800 Lines (Watch List)

These files are approaching the threshold:

| File | Lines |
|------|-------|
| `ai/index.tsx` | 1,244 |
| `image-edit-client.ts` | 1,233 |
| `timeline-track.tsx` | 1,226 |
| `ffmpeg-handler.ts` | 1,194 |
| `drawing-canvas.tsx` | 1,132 |
| `preview-panel.tsx` | 1,041 |
| `image-to-video.ts` | 1,019 |
| `ffmpeg-utils.ts` | 903 |
| `export-engine-cli.ts` | 894 |
| `effects-store.ts` | 852 |

---

## Priority Recommendation

| Priority | Files | Rationale |
|----------|-------|-----------|
| ✅ Done | `timeline-store.ts` | Core state, high change frequency |
| High | `timeline/index.tsx` | Core UI, complex interactions |
| High | `electron/main.ts` | Entry point, growing complexity |
| Medium | `ai-constants.ts` | Configuration, easy split |
| Medium | `export-engine.ts` | Export logic, testability |
| Low | `text2image-models.ts` | Config only, stable |
| Low | `ai-image-tab.tsx` | UI component, moderate complexity |

---

*Document generated: 2025-12-17*
*Source: Line count analysis of QCut codebase*
