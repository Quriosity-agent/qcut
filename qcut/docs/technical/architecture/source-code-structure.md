# QCut Source Code Structure Documentation

## Overview

This document provides a comprehensive overview of the QCut source code structure, including folder organization and line counts for all TypeScript/JavaScript source files.

**Generated:** 2026-02-23
**Total Source Files:** 600+ files in src/ + 60+ in electron/
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
- **Testing:** Vitest 3.2.4 with 145 test files

## Source Code Structure

### Root Configuration Files
```text
apps/web/
├── vite.config.ts                    # Vite configuration
├── tsconfig.json                     # TypeScript configuration
├── tailwind.config.ts                # Tailwind CSS configuration
├── vitest.config.ts                  # Vitest test configuration
├── components.json                   # UI components configuration
└── package.json                      # Dependencies and scripts
```

### Main Source Directory: `apps/web/src/`

#### 📁 **Routes** (`src/routes/`) - 16 files
Main application routing using TanStack Router:
- `__root.tsx` - Root layout component
- `index.tsx` - Home page route
- `editor.$project_id.tsx` - Main editor route
- `editor.$project_id.lazy.tsx` - Lazy-loaded editor components
- `projects.tsx` - Projects list route
- `projects.lazy.tsx` - Lazy-loaded projects components
- `blog.tsx` + `blog.$slug.tsx` - Blog functionality
- `login.tsx` + `signup.tsx` - Authentication routes
- `changelog.tsx` - Version changelog
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
- `text2image.tsx` - Text-to-image generation
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

#### 📁 **Stores** (`src/stores/`) - 37 files
Zustand state management, organized into domain subdirectories:

**`stores/timeline/`** — Timeline state (4 stores + 7 modules):
- `timeline-store.ts` - Timeline operations and state management
- `timeline-store-operations.ts` - Extended timeline operations
- `word-timeline-store.ts` - Word-level timeline editing
- `scene-store.ts` - Scene management
- `index.ts`, `types.ts`, `utils.ts` - Barrel export and shared types
- `element-operations.ts`, `track-operations.ts`, `split-operations.ts`, `persistence.ts` - Modular operations

**`stores/media/`** — Media management (4 files):
- `media-store.ts` - Media file handling and organization
- `media-store-types.ts` - Media type definitions
- `media-store-loader.ts` - Media loading utilities
- `sounds-store.ts` - Sound effects library state

**`stores/moyin/`** — Moyin workflow (7 files):
- `moyin-store.ts`, `moyin-generation.ts`, `moyin-calibration.ts`
- `moyin-shot-generation.ts`, `moyin-persistence.ts`
- `moyin-gen-config.ts`, `moyin-undo.ts`

**`stores/editor/`** — Editor UI state (7 files):
- `editor-store.ts` - Main editor state and settings
- `panel-store.ts` - UI panel visibility and layout
- `keybindings-store.ts` - Keyboard shortcut management
- `playback-store.ts` - Video playback controls and state
- `camera-selector-store.ts`, `white-draw-store.ts`, `nano-edit-store.ts`

**`stores/ai/`** — AI feature stores (5 files):
- `text2image-store.ts` - AI image generation
- `remotion-store.ts` - Remotion integration
- `segmentation-store.ts` - AI segmentation state
- `adjustment-store.ts` - Image adjustment tools
- `effects-store.ts` - Effects system state

**`stores/` (root)** — Shared stores (10 files):
- `project-store.ts` - Project persistence and management
- `export-store.ts`, `folder-store.ts`, `captions-store.ts`
- `stickers-store.ts`, `stickers-overlay-store.ts`
- `pty-terminal-store.ts`, `gemini-terminal-store.ts`
- `skills-store.ts`, `mcp-app-store.ts`

#### 📁 **Library** (`src/lib/`) - 89 root files organized into domain subdirectories
Core functionality and utilities:

**`lib/export/`** — Export engine and related (15 files):
- `export-engine.ts` - Main export engine
- `export-engine-optimized.ts` - Performance-optimized export
- `export-engine-factory.ts` - Export strategy factory
- `export-engine-cli.ts` - Command-line export interface
- `export-engine-cli-audio.ts`, `export-engine-cli-utils.ts` - CLI helpers
- `export-engine-debug.ts`, `export-engine-recorder.ts`, `export-engine-renderer.ts`, `export-engine-utils.ts`
- `export-analysis.ts`, `export-errors.ts` - Analysis and errors
- `webcodecs-export-engine.ts`, `webcodecs-detector.ts` - WebCodecs support
- `audio-export-config.ts` - Audio export configuration

**`lib/ffmpeg/`** — FFmpeg utilities (8 files):
- `ffmpeg-utils.ts` - FFmpeg WebAssembly integration
- `ffmpeg-utils-encode.ts`, `ffmpeg-utils-loader.ts`, `ffmpeg-loader.ts`
- `ffmpeg-filter-chain.ts`, `ffmpeg-video-recorder.ts`
- `audio-mixer.ts`, `memory-utils.ts`

**`lib/ai-clients/`** — AI service clients (15 files):
- `fal-ai-client.ts` - FAL AI service integration
- `fal-ai-client-generation.ts`, `fal-ai-client-reve.ts`, `fal-ai-client-veo31.ts`
- `fal-ai-client-internal-types.ts`
- `image-edit-client.ts`, `image-edit-models-info.ts`, `image-edit-polling.ts`
- `image-edit-capabilities.ts`, `image-edit-utils.ts`
- `video-edit-client.ts`, `sam3-client.ts`, `sam3-models.ts`
- `ai-video-client.ts`, `ai-video-output.ts`

**`lib/ai-models/`** — Model definitions (5 files):
- `model-utils.ts`, `upscale-models.ts`, `text2image-models.ts`
- `camera-prompt-builder.ts`, `image-validation.ts`

**`lib/effects/`** — Visual effects system (5 files):
- `effects-utils.ts`, `effects-chaining.ts`, `effects-keyframes.ts`
- `effects-canvas-advanced.ts`, `canvas-utils.ts`

**`lib/stickers/`** — Sticker system (8 files):
- `sticker-downloader.ts`, `sticker-persistence-debug.ts`
- `sticker-test-helper.ts`, `sticker-timeline-query.ts`
- `timeline-sticker-integration.ts`, `debug-sticker-overlay.ts`
- `iconify-api.ts`, `sticker-export-helper.ts`

**`lib/claude-bridge/`** — Claude ↔ renderer bridge (4 files):
- `claude-timeline-bridge.ts`, `claude-timeline-bridge-helpers.ts`
- `claude-bridge-lifecycle.ts`, `project-skills-sync.ts`

**`lib/media/`** — Media processing and metadata (7 files):
- `media-processing.ts`, `media-source.ts`, `video-metadata.ts`
- `image-utils.ts`, `blob-manager.ts`, `blob-url-debug.ts`, `bulk-import.ts`

**`lib/project/`** — Project management (4 files):
- `project-folder-sync.ts`, `zip-manager.ts`
- `screen-recording-controller.ts`, `release-notes.ts`

**`lib/debug/`** — Debug and error utilities (6 files):
- `debug-config.ts`, `debug-logger.ts`, `dev-memory-profiler.ts`
- `error-handler.ts`, `error-context.ts`, `pty-session-cleanup.ts`

**`lib/` (root)** — Core utilities (13 files):
- `utils.ts`, `time.ts`, `timeline.ts`, `markdown.ts`
- `font-config.ts`, `feature-flags.ts`, `rate-limit.ts`, `asset-path.ts`
- `api-adapter.ts`, `blog-query.ts`, `fetch-github-stars.ts`, `waitlist.ts`
- `index.ts`

**Pre-existing subdirectories:**
- `ai-video/` - Modular AI video system (core, generators, models, validation)
- `fal-ai/` - Extended FAL.ai model handlers
- `export-cli/` - CLI export filters and sources
- `effects-templates/` - Effect template data
- `storage/` - Storage abstraction (IndexedDB, localStorage, OPFS, Electron, R2)
- `text2image-models/` - Text-to-image model definitions
- `remotion/` - Remotion integration
- `moyin/` - Moyin workflow (character, presets, script, storyboard)
- `captions/` - Caption export
- `gemini/` - Gemini AI utilities
- `transcription/` - Transcription segment calculator

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

#### Main Process (`electron/`) - 34+ TypeScript files
All Electron code is 100% TypeScript:

**Core:**
- `main.ts` - Electron main process and window management
- `main-ipc.ts` - IPC channel registration
- `preload.ts` - Preload script for secure IPC communication

**Media & Processing Handlers:**
- `ffmpeg-handler.ts` - FFmpeg CLI integration and processing (37KB)
- `ffmpeg-concat-handler.ts` - Video concatenation
- `ffmpeg-scene-detect-handler.ts` - Scene detection
- `ffmpeg-subtitle-handler.ts` - Subtitle processing
- `ffmpeg-waveform-handler.ts` - Audio waveform generation
- `sound-handler.ts` - Sound effects handling
- `audio-temp-handler.ts` - Audio temporary files
- `video-temp-handler.ts` - Video temporary files
- `ai-video-save-handler.ts` - AI video save functionality
- `temp-manager.ts` - Temporary file management

**AI & Transcription:**
- `gemini-transcribe-handler.ts` - Gemini transcription
- `ai-pipeline-handler.ts` - AI content pipeline
- `ai-pipeline-ipc.ts` - AI pipeline IPC channels
- `ai-pipeline-output.ts` - AI pipeline output handling

**Configuration & Security:**
- `api-key-handler.ts` - Secure API key management
- `theme-handler.ts` - Theme management

**Terminal & Skills:**
- `pty-handler.ts` - PTY terminal session management
- `skills-handler.ts` - AI skills file operations
- `skills-sync-handler.ts` - Skills synchronization

**Claude Integration (`electron/claude/`):**
- `index.ts` - Claude integration barrel export
- `claude-http-server.ts` - Claude HTTP API server
- `claude-diagnostics-handler.ts` - Diagnostics
- `claude-export-handler.ts` - Export operations
- `claude-media-handler.ts` - Media operations
- `claude-project-handler.ts` - Project operations
- `claude-timeline-handler.ts` - Timeline operations

#### Subdirectories:
- `config/` - Electron configuration
- `ffmpeg/` - FFmpeg utilities
- `claude/` - Claude Code integration handlers
- `claude/utils/` - Claude utility functions

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
- 100% TypeScript Electron integration with 50+ IPC handlers

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
**Status**: 145 test files passing successfully

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
