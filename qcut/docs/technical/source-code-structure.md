# QCut Source Code Structure Documentation

## Overview

This document provides a comprehensive overview of the QCut source code structure, including folder organization and line counts for all TypeScript/JavaScript source files.

**Generated:** 2025-12-16
**Total Source Files:** 568+ files in src/ + 11 in electron/
**Main Source Directory:** `apps/web/src/`

## Project Architecture

QCut is a desktop video editor built with:
- **Frontend Framework:** Vite + TanStack Router + React 18.3.1
- **Desktop Runtime:** Electron (100% TypeScript)
- **Language:** TypeScript
- **State Management:** Zustand
- **Video Processing:** FFmpeg WebAssembly
- **AI Integration:** FAL.ai (40+ models)
- **Styling:** Tailwind CSS
- **Testing:** Vitest 3.2.4 with 200+ tests

## Source Code Structure

### Root Configuration Files
```
apps/web/
├── vite.config.ts                    # Vite configuration
├── tsconfig.json                     # TypeScript configuration
├── tailwind.config.ts                # Tailwind CSS configuration
├── vitest.config.ts                  # Vitest test configuration
├── components.json                   # UI components configuration
└── package.json                      # Dependencies and scripts
```

### Main Source Directory: `apps/web/src/`

#### 📁 **Routes** (`src/routes/`) - 15 files
Main application routing using TanStack Router:
- `__root.tsx` - Root layout component
- `index.tsx` - Home page route
- `editor.$project_id.tsx` - Main editor route
- `editor.$project_id.lazy.tsx` - Lazy-loaded editor components
- `projects.tsx` - Projects list route
- `projects.lazy.tsx` - Lazy-loaded projects components
- `blog.tsx` + `blog.$slug.tsx` - Blog functionality
- `login.tsx` + `signup.tsx` - Authentication routes
- `contributors.tsx` - Contributors page
- `privacy.tsx` + `terms.tsx` - Legal pages
- `roadmap.tsx` - Product roadmap
- `why-not-capcut.tsx` - Comparison page

#### 📁 **Components** (`src/components/`)

##### UI Components (`src/components/ui/`) - 73 files
Base UI components built on Radix UI primitives:

**Core Components:**
- `button.tsx`, `input.tsx`, `textarea.tsx` - Form inputs
- `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx` - Modal interfaces
- `dropdown-menu.tsx`, `context-menu.tsx`, `menubar.tsx` - Menu systems
- `table.tsx`, `tabs.tsx`, `card.tsx` - Layout components
- `toast.tsx`, `toaster.tsx`, `sonner.tsx` - Notification system

**Interactive Components:**
- `accordion.tsx`, `collapsible.tsx` - Expandable content
- `carousel.tsx`, `slider.tsx` - Range/navigation controls
- `checkbox.tsx`, `radio-group.tsx`, `switch.tsx` - Selection inputs
- `select.tsx`, `combobox.tsx` - Dropdown selections
- `calendar.tsx`, `popover.tsx` - Date/overlay components

**Media & Display:**
- `audio-player.tsx`, `video-player.tsx` - Media controls
- `avatar.tsx`, `badge.tsx`, `skeleton.tsx` - Display elements
- `progress.tsx`, `scroll-area.tsx` - Progress/scrolling
- `resizable.tsx`, `draggable-item.tsx` - Interactive layouts

**Specialized Components:**
- `font-picker.tsx`, `phone-input.tsx`, `input-otp.tsx` - Specialized inputs
- `image-timeline-treatment.tsx`, `editable-timecode.tsx` - Video editor UI
- `floating-action-panel.tsx`, `sponsor-button.tsx` - Custom components
- `blob-image.tsx` - Blob URL image display
- `chart.tsx`, `prose.tsx` - Content display

##### Editor Components (`src/components/editor/`)
Core video editor interface:

**Timeline System (`timeline/`) - 8 files:**
- `index.tsx` - Main timeline container
- `timeline-track.tsx` - Individual timeline tracks
- `timeline-element.tsx` - Media elements on timeline
- `timeline-element-drop-zone.tsx` - Drop zones for elements
- `timeline-playhead.tsx` - Current position indicator
- `timeline-cache-indicator.tsx` - Cache status display
- `effects-timeline.tsx` - Effects timeline view
- `keyframe-timeline.tsx` - Keyframe animation timeline

**Properties Panel (`properties-panel/`) - 12 files:**
- `index.tsx` - Properties container
- `media-properties.tsx` - Media element properties
- `text-properties.tsx` - Text element properties
- `audio-properties.tsx` - Audio element properties
- `effects-properties.tsx` - Effects configuration
- `transform-properties.tsx` - Transform controls
- `volume-control.tsx` - Volume adjustment
- `effect-management.tsx` - Effect management UI
- `export-panel-content.tsx` - Export settings
- `settings-view.tsx` - Settings panel
- `panel-tabs.tsx` - Tab navigation
- `property-item.tsx` - Reusable property item

**Media Panel (`media-panel/`) - Main container + views:**
- `index.tsx` - Media library container

**Media Panel Views (`media-panel/views/`) - 25+ files:**

*Core Views:*
- `media.tsx` - Media file browser
- `text.tsx` - Text creation tools
- `audio.tsx` - Audio library and tools
- `sounds.tsx` - Sound effects library
- `captions.tsx` - Caption generation and editing
- `stickers.tsx` - Sticker library with search
- `draw.tsx` - Drawing tools
- `effects.tsx` - Effects browser
- `effects-gallery.tsx` - Effects gallery view
- `effects-search.tsx` - Effects search interface
- `nano-edit.tsx` - Nano edit interface

*AI Generation Views (`ai/` subdirectory):*
- Modular AI generation interface with components, hooks, settings, tabs

*Text-to-Image & Video:*
- `text2image.tsx` - Text to image generation
- `model-type-selector.tsx` - AI model selection

*Video Editing:*
- `video-edit.tsx` - Video editing tools
- `video-edit-audio-gen.tsx` - Audio generation
- `video-edit-audio-sync.tsx` - Audio synchronization
- `video-edit-upscale.tsx` - Video upscaling
- `video-edit-constants.ts` - Video edit constants
- `video-edit-types.ts` - Type definitions
- `video-edit-exports.ts` - Export utilities
- `use-video-edit-processing.ts` - Processing hook

*Upscale:*
- `upscale-settings.tsx` - Upscale configuration
- `use-upscale-generation.ts` - Upscale generation hook

**Adjustment Panel (`adjustment/`):**
- `index.tsx` - Image adjustment interface
- `edit-history.tsx` - Edit history management
- `parameter-controls.tsx` - Adjustment controls
- `preview-panel.tsx` - Adjustment preview
- `image-uploader.tsx` - Image upload interface
- `model-selector.tsx` - AI model selection

**Preview Panel:**
- `preview-panel.tsx` - Video preview window
- `preview-panel-components.tsx` - Preview sub-components
- `preview-panel/` - Additional preview components subdirectory

**Effects System:**
- `effect-chain-manager.tsx` - Effect chain management
- `effect-templates-panel.tsx` - Effect templates UI
- `interactive-element-overlay.tsx` - Interactive overlays

**Segmentation (`segmentation/`):**
- AI-powered video segmentation tools (SAM3 integration)

**Drawing Tools (`draw/`):**
- Drawing and annotation tools

**Nano Edit (`nano-edit/`):**
- Quick edit functionality

**Scenes (`scenes-view.tsx`):**
- Scene management interface

**Stickers Overlay System (`stickers-overlay/`):**
- `index.ts` - Sticker overlay management
- `StickerCanvas.tsx` - Canvas for sticker rendering
- `StickerElement.tsx` - Individual sticker elements
- `StickerControls.tsx` - Sticker manipulation controls
- `ResizeHandles.tsx` - Resize handles for stickers
- `AutoSave.tsx` - Auto-save functionality
- `hooks/useStickerDrag.ts` - Drag handling hook

**Captions Components (`captions/`):**
- `captions-display.tsx` - Caption display interface
- `language-select.tsx` - Language selection
- `upload-progress.tsx` - Upload progress indicator

**Other Editor Components:**
- `audio-waveform.tsx` - Audio visualization
- `snap-indicator.tsx` - Snapping visual feedback
- `selection-box.tsx` - Multi-selection tool
- `speed-control.tsx` - Playback speed controls
- `panel-layouts.tsx` - Panel layout management
- `auto-save-indicator.tsx` - Auto-save status

##### Application Components (`src/components/`) - 20+ files
- `header-base.tsx`, `header.tsx` - Application headers
- `editor-header.tsx` - Editor-specific header
- `editor-provider.tsx` - Editor context provider
- `storage-provider.tsx` - Storage abstraction context
- `background-settings.tsx` - Project settings
- `delete-project-dialog.tsx`, `rename-project-dialog.tsx` - Project management
- `export-dialog.tsx`, `export-canvas.tsx` - Export functionality
- `export-icons.tsx` - Export-related icons
- `keyboard-shortcuts-help.tsx` - Help system
- `onboarding.tsx` - User onboarding
- `panel-preset-selector.tsx` - Panel layout presets
- `icons.tsx` - Icon definitions
- `footer.tsx` - Application footer
- `landing/hero.tsx`, `landing/handlebars.tsx` - Landing page components
- `test-sounds-store.tsx` - Testing component for sounds store

#### 📁 **Stores** (`src/stores/`) - 31 files
Zustand state management:

**Core Stores:**
- `timeline-store.ts` - Timeline operations and state management (59KB - largest store)
- `project-store.ts` - Project persistence and management
- `media-store.ts` - Media file handling and organization
- `editor-store.ts` - Main editor state and settings
- `playback-store.ts` - Video playback controls and state

**Timeline Store Modules (`timeline/`) - 7 files:**
- `index.ts` - Timeline store barrel export
- `types.ts` - Timeline type definitions
- `utils.ts` - Timeline utilities
- `element-operations.ts` - Element manipulation
- `track-operations.ts` - Track management
- `split-operations.ts` - Split functionality
- `persistence.ts` - Timeline persistence

**Feature-Specific Stores:**
- `export-store.ts` - Video export functionality
- `text2image-store.ts` - AI image generation
- `adjustment-store.ts` - Image adjustment tools
- `keybindings-store.ts` - Keyboard shortcut management
- `panel-store.ts` - UI panel visibility and layout
- `captions-store.ts` - Caption management and state
- `sounds-store.ts` - Sound effects library state
- `stickers-store.ts` - Sticker library and state
- `stickers-overlay-store.ts` - Sticker overlay management
- `effects-store.ts` - Effects system state (23KB)
- `scene-store.ts` - Scene management
- `segmentation-store.ts` - AI segmentation state
- `nano-edit-store.ts` - Nano edit state
- `white-draw-store.ts` - Drawing tool state

**Supporting Files:**
- `media-store-types.ts` - Media type definitions
- `media-store-loader.ts` - Media loading utilities

#### 📁 **Library** (`src/lib/`) - 65+ root files + subdirectories
Core functionality and utilities:

**AI Video System (`ai-video/`) - Modular Architecture:**

*Core (`ai-video/core/`):**
- `fal-request.ts` - FAL API request utilities
- `fal-upload.ts` - File upload handling
- `polling.ts` - Queue polling with progress updates
- `streaming.ts` - Video streaming download

*Generators (`ai-video/generators/`):**
- `base-generator.ts` - Base generator class
- `text-to-video.ts` - T2V generators (Sora 2, Veo, Kling, etc.)
- `image-to-video.ts` - I2V generators
- `avatar.ts` - Avatar/talking head generation
- `image.ts` - Image generation
- `upscale.ts` - Video upscaling

*Models (`ai-video/models/`):**
- Model-specific parameter conversion

*Validation (`ai-video/validation/`):**
- Input validation utilities

**FAL AI Integration (`fal-ai/`):**
- Extended FAL.ai client utilities

**Export System:**
- `export-engine.ts` - Main export engine (46KB)
- `export-engine-optimized.ts` - Performance-optimized export
- `export-engine-factory.ts` - Export strategy factory
- `export-engine-cli.ts` - Command-line export interface
- `export-cli/` - CLI export utilities
- `webcodecs-export-engine.ts` - Modern WebCodecs export
- `export-analysis.ts` - Export analysis utilities
- `export-errors.ts` - Export error handling

**Video Processing:**
- `ffmpeg-utils.ts` - FFmpeg WebAssembly integration (27KB)
- `ffmpeg-utils-encode.ts` - Video encoding utilities
- `ffmpeg-utils-loader.ts` - Dynamic FFmpeg loading
- `ffmpeg-loader.ts` - FFmpeg initialization
- `ffmpeg-video-recorder.ts` - Screen recording functionality
- `ffmpeg-filter-chain.ts` - FFmpeg filter chain building
- `media-processing.ts` - General media processing
- `webcodecs-detector.ts` - WebCodecs capability detection

**AI Integration:**
- `ai-video-client.ts` - AI video processing client
- `fal-ai-client.ts` - FAL AI service integration (39KB)
- `image-edit-client.ts` - AI image editing (31KB)
- `text2image-models.ts` - Text-to-image AI models (32KB)
- `ai-video-output.ts` - AI processing output handling
- `sam3-client.ts` - SAM3 segmentation client
- `sam3-models.ts` - SAM3 model definitions
- `video-edit-client.ts` - Video editing AI client
- `upscale-models.ts` - Upscale model definitions
- `model-utils.ts` - Model utility functions

**Effects System:**
- `effects-utils.ts` - Effects utilities
- `effects-canvas-advanced.ts` - Advanced canvas effects
- `effects-chaining.ts` - Effect chaining logic
- `effects-keyframes.ts` - Keyframe animation
- `effects-templates.ts` - Effect templates

**Storage System (`storage/`) - 7 files:**
- `storage-service.ts` - Storage abstraction layer
- `indexeddb-adapter.ts` - IndexedDB implementation
- `localstorage-adapter.ts` - LocalStorage fallback
- `opfs-adapter.ts` - Origin Private File System
- `electron-adapter.ts` - Electron file system
- `r2-client.ts` - R2 cloud storage client
- `types.ts` - Storage interface definitions

**Error Handling:**
- `error-handler.ts` - Global error handling
- `error-context.ts` - Error context utilities

**Media & Image:**
- `image-utils.ts` - Image processing helpers
- `image-validation.ts` - Image validation
- `blob-manager.ts` - Blob URL management
- `blob-url-debug.ts` - Blob debugging utilities
- `media-source.ts` - Media source utilities
- `video-metadata.ts` - Video metadata extraction
- `canvas-utils.ts` - Canvas utilities
- `audio-mixer.ts` - Audio mixing
- `audio-export-config.ts` - Audio export configuration

**Utilities & Services:**
- `time.ts` - Time formatting and parsing
- `timeline.ts` - Timeline calculation utilities
- `utils.ts` - General utility functions
- `asset-path.ts` - Asset path resolution helper
- `memory-utils.ts` - Memory management utilities
- `zip-manager.ts` - ZIP file handling
- `font-config.ts` - Font configuration
- `debug-logger.ts` - Debug logging system
- `debug-config.ts` - Debug configuration
- `blog-query.ts` - Blog content queries
- `waitlist.ts` - Waitlist management
- `rate-limit.ts` - API rate limiting
- `fetch-github-stars.ts` - GitHub integration
- `iconify-api.ts` - Iconify icon service
- `sticker-downloader.ts` - Sticker download utility
- `feature-flags.ts` - Feature flag management
- `api-adapter.ts` - API adapter utilities
- `dev-memory-profiler.ts` - Development memory profiling

**Gemini Integration (`gemini/`):**
- Gemini AI integration utilities

**Caption Processing (`captions/`):**
- `caption-export.ts` - Caption export functionality

**Stickers Support (`stickers/`):**
- `sticker-export-helper.ts` - Sticker export utilities

**Other Utilities (`utils/`):**
- Additional utility functions

#### 📁 **Hooks** (`src/hooks/`) - 41 files
Custom React hooks:

**Timeline & Editor Hooks:**
- `use-timeline-zoom.ts` - Timeline zoom controls
- `use-timeline-snapping.ts` - Element snapping logic
- `use-timeline-element-resize.ts` - Element resizing
- `use-timeline-playhead.ts` - Playhead positioning
- `use-selection-box.ts` - Multi-selection functionality
- `use-editor-actions.ts` - Core editor operations
- `use-drag-drop.ts` - Drag and drop interactions
- `use-effect-keyboard-shortcuts.ts` - Effect keyboard shortcuts

**Playback & Media Hooks:**
- `use-playback-controls.ts` - Video playback controls
- `use-async-ffmpeg.ts` - Asynchronous FFmpeg operations
- `use-async-media-store.ts` - Media loading and caching
- `use-async-module-loading.tsx` - Dynamic module loading
- `use-blob-image.ts` - Blob URL image handling
- `use-aspect-ratio.ts` - Aspect ratio calculations
- `use-sound-search.ts` - Sound search functionality
- `use-infinite-scroll.ts` - Infinite scrolling support
- `use-frame-cache.ts` - Frame caching

**UI & Interaction Hooks:**
- `use-keybindings.ts` - Keyboard shortcut handling
- `use-keybinding-conflicts.ts` - Shortcut conflict detection
- `use-keyboard-shortcuts-help.ts` - Help system integration
- `use-mobile.tsx` - Mobile device detection
- `use-toast.ts` - Toast notification system
- `use-debounce.ts` - Debounce functionality

**Export Hooks:**
- `use-export-presets.ts` - Export preset management
- `use-export-progress.ts` - Export progress tracking
- `use-export-settings.ts` - Export settings management
- `use-export-validation.ts` - Export validation logic
- `use-zip-export.ts` - Project export to ZIP

**Error & Monitoring Hooks:**
- `use-error-reporter.ts` - Error reporting
- `use-memory-monitor.ts` - Memory monitoring

**Persistence Hooks:**
- `use-save-on-visibility-change.ts` - Auto-save on visibility change

**Utility Hooks:**
- `useElectron.ts` - Electron integration

**Authentication Hooks (`auth/`):**
- `useLogin.ts` - User login functionality
- `useSignUp.ts` - User registration

#### 📁 **Types** (`src/types/`) - 19 files
TypeScript type definitions:
- `timeline.ts` - Timeline data structures and interfaces
- `editor.ts` - Editor state and component interfaces
- `project.ts` - Project data models and schemas
- `playback.ts` - Video playback state types
- `keybinding.ts` - Keyboard shortcut definitions
- `export.ts` - Export configuration types
- `post.ts` - Blog post data structures
- `captions.ts` - Caption data structures
- `sounds.ts` - Sound effect type definitions
- `sticker-overlay.ts` - Sticker overlay types
- `panel.ts` - Panel layout type definitions
- `electron.d.ts` - Electron API type extensions
- `ai-generation.ts` - AI generation types
- `effects.ts` - Effects type definitions
- `nano-edit.ts` - Nano edit types
- `sam3.ts` - SAM3 segmentation types
- `sora2.ts` - Sora 2 AI types
- `white-draw.ts` - Drawing tool types

#### 📁 **Constants** (`src/constants/`) - 5 files
Application constants:
- `timeline-constants.ts` - Timeline configuration and defaults
- `font-constants.ts` - Available font definitions
- `actions.ts` - Editor action types and definitions
- `site.ts` - Site metadata and configuration
- `effect-parameter-ranges.ts` - Effect parameter ranges

#### 📁 **Config** (`src/config/`) - 1 file
Configuration:
- `features.ts` - Feature flags configuration

#### 📁 **Services** (`src/services/`)
Service layer:
- `ai/` - AI service integrations

#### 📁 **Data** (`src/data/`) - 1 file
Static data:
- `colors.ts` - Application color palette definitions

#### 📁 **Utilities** (`src/utils/`) - 1 file
- `lazy-stores.ts` - Lazy loading for stores

#### 📁 **Test** (`src/test/`)
Test utilities and setup files for Vitest

#### 📁 **Main Source Files** - 6 files
Core application bootstrap files:
- `routeTree.gen.ts` - Generated TanStack Router tree
- `App.tsx` - Main application component
- `globals.css` - Global CSS styles
- `env.ts` - Environment configuration
- `env.client.ts` - Client-side environment
- `main.tsx` - Application entry point

### Electron Integration

#### Main Process (`electron/`) - 11 TypeScript files
All Electron code is 100% TypeScript:
- `main.ts` - Electron main process and window management
- `preload.ts` - Preload script for secure IPC communication
- `ffmpeg-handler.ts` - FFmpeg CLI integration and processing (37KB)
- `temp-manager.ts` - Temporary file management
- `sound-handler.ts` - Sound effects handling
- `theme-handler.ts` - Theme management
- `api-key-handler.ts` - Secure API key management
- `ai-video-save-handler.ts` - AI video save functionality
- `gemini-transcribe-handler.ts` - Gemini transcription
- `audio-temp-handler.ts` - Audio temporary files
- `video-temp-handler.ts` - Video temporary files

#### Subdirectories:
- `config/` - Electron configuration
- `ffmpeg/` - FFmpeg utilities

#### Resources (`electron/resources/`)
- `ffmpeg.exe`, `ffplay.exe`, `ffprobe.exe` - FFmpeg binaries
- `avcodec-62.dll`, `avdevice-62.dll`, etc. - FFmpeg dependencies

## Architecture Updates (2025-12-16)

### New Features Added Since Last Documentation (August 2025):

1. **Effects System** - Complete effects pipeline with chaining, keyframes, templates, and canvas rendering
2. **Scene Management** - Scene-based project organization
3. **AI Segmentation** - SAM3 integration for intelligent video segmentation
4. **Nano Edit** - Quick editing interface
5. **Drawing Tools** - Whiteboard and annotation capabilities
6. **Video Editing AI** - Video edit, upscale, audio generation, and audio sync
7. **Enhanced AI Video** - Modular architecture supporting 40+ AI models via FAL.ai
8. **Timeline Modularization** - Timeline store split into focused modules
9. **Gemini Integration** - Google Gemini AI for transcription
10. **Frame Caching** - Improved playback performance with frame caching
11. **Memory Monitoring** - Development memory profiling tools
12. **Error Reporting** - Comprehensive error handling system

### Key Implementation Files:
The codebase contains several substantial files that form the core of the application:

- **Timeline Store** (59KB) - Comprehensive timeline state management
- **Export Engine** (46KB) - Main export implementation
- **FAL AI Client** (39KB) - AI service integration
- **FFmpeg Handler** (37KB) - Video processing backend
- **Text2Image Models** (32KB) - AI model definitions
- **Image Edit Client** (31KB) - AI image editing
- **FFmpeg Utils** (27KB) - FFmpeg WebAssembly utilities

**Architecture Highlights:**
- Modular AI video system with generators, core utilities, and validation
- Comprehensive effects system with keyframes and chaining
- Robust storage abstraction supporting multiple backends
- Extensive timeline management with modular operations
- Enhanced media panel with video editing capabilities
- 100% TypeScript Electron integration with 38 IPC handlers

## Code Organization Principles

### 1. **Separation of Concerns**
- **Components**: Pure UI presentation
- **Stores**: Business logic and state
- **Hooks**: Reusable stateful logic
- **Lib**: Core functionality

### 2. **Feature-Based Structure**
- Editor components grouped by functionality
- Related stores and hooks co-located conceptually
- Clear boundaries between timeline, media, and playback

### 3. **Type Safety**
- Comprehensive TypeScript coverage
- Dedicated types directory (19 files)
- Interface-driven development

### 4. **Scalable Architecture**
- Modular component system
- Plugin-ready hook system
- Extensible storage backends

## Development Guidelines

### File Naming Conventions
- **Components**: `kebab-case.tsx`
- **Hooks**: `use-feature-name.ts`
- **Stores**: `feature-store.ts`
- **Types**: `feature.ts`
- **Utilities**: `feature-name.ts`

### Import Organization
1. React and external libraries
2. Internal components
3. Hooks and stores
4. Types
5. Utilities

### Code Style
- **Linting**: Biome with Ultracite configuration
- **Formatting**: Automatic via Biome
- **Type Checking**: Strict TypeScript mode

## Performance Considerations

### Bundle Optimization
- Code splitting by feature areas
- Dynamic imports for FFmpeg
- Tree shaking enabled
- Asset optimization

### Memory Management
- Proper cleanup of media resources
- Blob URL management via BlobManager
- Event listener cleanup
- WebAssembly memory handling
- Frame caching for playback

## Testing Strategy

**Framework**: Vitest 3.2.4 with JSDOM environment
**Status**: All 200+ tests passing successfully

### Running Tests
```bash
# Run all tests
cd qcut/apps/web && bun run test

# Run tests with UI
bun run test:ui

# Run tests with coverage
bun run test:coverage

# Watch mode during development
bun run test:watch
```

### Test Categories
- **UI Components**: Button, Checkbox, Dialog, Toast, Tabs, Slider, etc.
- **Hooks**: Custom React hooks with comprehensive test coverage
- **Integration**: Store initialization, project creation workflows
- **Utilities**: Helper functions and utility modules

## Future Improvements

1. **Add more integration tests**
2. **Implement performance monitoring**
3. **Enhanced error boundaries**
4. **Better code documentation**
5. **API documentation generation**

---

*This documentation should be updated when significant structural changes are made to the codebase.*
