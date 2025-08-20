# QCut Source Code Structure Documentation

## Overview

This document provides a comprehensive overview of the QCut source code structure, including folder organization and line counts for all TypeScript/JavaScript source files.

**Generated:** 2025-08-20  
**Total Source Files:** 280+ files (270+ in src/ + 6 in electron/)  
**Main Source Directory:** `apps/web/src/`

## Project Architecture

QCut is a desktop video editor built with:
- **Frontend Framework:** Vite 7.0.6 + TanStack Router + React 19
- **Desktop Runtime:** Electron 37.2.5
- **Language:** TypeScript
- **State Management:** Zustand
- **Video Processing:** FFmpeg WebAssembly
- **Styling:** Tailwind CSS

## Source Code Structure

### Root Configuration Files
```
apps/web/
├── vite.config.ts                    # Vite configuration
├── tsconfig.json                     # TypeScript configuration  
├── tailwind.config.ts                # Tailwind CSS configuration
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

##### UI Components (`src/components/ui/`) - 65+ files
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

**Timeline System:**
- `timeline/index.tsx` - Main timeline container  
- `timeline/timeline-track.tsx` - Individual timeline tracks
- `timeline/timeline-element.tsx` - Media elements on timeline
- `timeline/timeline-playhead.tsx` - Current position indicator

**Properties Panel:**
- `properties-panel/index.tsx` - Properties container
- `properties-panel/media-properties.tsx` - Media element properties
- `properties-panel/text-properties.tsx` - Text element properties
- `properties-panel/audio-properties.tsx` - Audio element properties

**Media Panel:**
- `media-panel/index.tsx` - Media library container
- `media-panel/views/media.tsx` - Media file browser
- `media-panel/views/text.tsx` - Text creation tools
- `media-panel/views/ai.tsx` - AI generation tools
- `media-panel/views/audio.tsx` - Audio library and tools
- `media-panel/views/sounds.tsx` - Sound effects library
- `media-panel/views/captions.tsx` - Caption generation and editing
- `media-panel/views/stickers.tsx` - Sticker library with search
- `media-panel/views/text2image.tsx` - Text to image generation

**Adjustment Panel (1,104 lines):**
- `adjustment/index.tsx` - Image adjustment interface (338 lines)
- `adjustment/edit-history.tsx` - Edit history management (211 lines)
- `adjustment/parameter-controls.tsx` - Adjustment controls (182 lines)
- `adjustment/preview-panel.tsx` - Adjustment preview (175 lines)
- `adjustment/image-uploader.tsx` - Image upload interface (135 lines)
- `adjustment/model-selector.tsx` - AI model selection (63 lines)

**Other Editor Components:**
- `preview-panel.tsx` - Video preview window
- `preview-panel-components.tsx` - Preview sub-components
- `audio-waveform.tsx` - Audio visualization
- `snap-indicator.tsx` - Snapping visual feedback
- `selection-box.tsx` - Multi-selection tool
- `speed-control.tsx` - Playback speed controls
- `panel-layouts.tsx` - Panel layout management

**Stickers Overlay System:**
- `stickers-overlay/index.ts` - Sticker overlay management
- `stickers-overlay/StickerCanvas.tsx` - Canvas for sticker rendering
- `stickers-overlay/StickerElement.tsx` - Individual sticker elements
- `stickers-overlay/StickerControls.tsx` - Sticker manipulation controls
- `stickers-overlay/ResizeHandles.tsx` - Resize handles for stickers
- `stickers-overlay/AutoSave.tsx` - Auto-save functionality
- `stickers-overlay/hooks/useStickerDrag.ts` - Drag handling hook

**Captions Components:**
- `captions/captions-display.tsx` - Caption display interface
- `captions/language-select.tsx` - Language selection
- `captions/upload-progress.tsx` - Upload progress indicator

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

#### 📁 **Stores** (`src/stores/`) - 16 files
Zustand state management:

**Core Stores:**
- `timeline-store.ts` - Timeline operations and state management
- `project-store.ts` - Project persistence and management
- `media-store.ts` - Media file handling and organization
- `editor-store.ts` - Main editor state and settings
- `playback-store.ts` - Video playback controls and state

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

**Supporting Files:**
- `media-store-types.ts` - Media type definitions
- `media-store-loader.ts` - Media loading utilities

#### 📁 **Library** (`src/lib/`) - 30+ files
Core functionality and utilities:

**Export Engines:**
- `export-engine.ts` - Main export engine
- `export-engine-optimized.ts` - Performance-optimized export
- `export-engine-factory.ts` - Export strategy factory
- `export-engine-cli.ts` - Command-line export interface
- `export-engine-ffmpeg.ts` - FFmpeg-based export
- `webcodecs-export-engine.ts` - Modern WebCodecs export

**Video Processing:**
- `ffmpeg-utils.ts` - FFmpeg WebAssembly integration
- `ffmpeg-utils-encode.ts` - Video encoding utilities
- `ffmpeg-utils-loader.ts` - Dynamic FFmpeg loading
- `ffmpeg-loader.ts` - FFmpeg initialization
- `ffmpeg-service.ts` - FFmpeg service wrapper
- `ffmpeg-video-recorder.ts` - Screen recording functionality
- `media-processing.ts` - General media processing
- `webcodecs-detector.ts` - WebCodecs capability detection

**AI Integration:**
- `ai-video-client.ts` - AI video processing client
- `fal-ai-client.ts` - FAL AI service integration
- `image-edit-client.ts` - AI image editing
- `text2image-models.ts` - Text-to-image AI models
- `ai-video-output.ts` - AI processing output handling

**Storage System:**
- `storage/storage-service.ts` - Storage abstraction layer
- `storage/indexeddb-adapter.ts` - IndexedDB implementation
- `storage/localstorage-adapter.ts` - LocalStorage fallback
- `storage/opfs-adapter.ts` - Origin Private File System
- `storage/electron-adapter.ts` - Electron file system
- `storage/types.ts` - Storage interface definitions

**Utilities & Services:**
- `time.ts` - Time formatting and parsing
- `timeline.ts` - Timeline calculation utilities
- `utils.ts` - General utility functions
- `asset-path.ts` - Asset path resolution helper
- `image-utils.ts` - Image processing helpers
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

**Caption Processing:**
- `captions/caption-export.ts` - Caption export functionality

**Transcription System:**
- `transcription/transcription-utils.ts` - Transcription utilities
- `transcription/zk-encryption.ts` - Zero-knowledge encryption

**Stickers Support:**
- `stickers/sticker-export-helper.ts` - Sticker export utilities

#### 📁 **Hooks** (`src/hooks/`) - 30+ files
Custom React hooks:

**Timeline & Editor Hooks:**
- `use-timeline-zoom.ts` - Timeline zoom controls
- `use-timeline-snapping.ts` - Element snapping logic
- `use-timeline-element-resize.ts` - Element resizing
- `use-timeline-playhead.ts` - Playhead positioning
- `use-selection-box.ts` - Multi-selection functionality
- `use-editor-actions.ts` - Core editor operations
- `use-drag-drop.ts` - Drag and drop interactions

**Playback & Media Hooks:**
- `use-playback-controls.ts` - Video playback controls
- `use-async-ffmpeg.ts` - Asynchronous FFmpeg operations
- `use-async-media-store.ts` - Media loading and caching
- `use-async-module-loading.tsx` - Dynamic module loading
- `use-blob-image.ts` - Blob URL image handling
- `use-aspect-ratio.ts` - Aspect ratio calculations
- `use-sound-search.ts` - Sound search functionality
- `use-infinite-scroll.ts` - Infinite scrolling support

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

**Utility Hooks:**
- `useElectron.ts` - Electron integration

**Authentication Hooks:**
- `auth/useLogin.ts` - User login functionality
- `auth/useSignUp.ts` - User registration

#### 📁 **Types** (`src/types/`) - 11 files
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

#### 📁 **Constants** (`src/constants/`) - 4 files
Application constants:
- `timeline-constants.ts` - Timeline configuration and defaults
- `font-constants.ts` - Available font definitions
- `actions.ts` - Editor action types and definitions
- `site.ts` - Site metadata and configuration

#### 📁 **Data** (`src/data/`) - 1 file, 244 lines
Static data:
- `colors.ts` - Application color palette definitions (244 lines)

#### 📁 **Utilities** (`src/utils/`) - 1 file
- `lazy-stores.ts` - Lazy loading for stores

#### 📁 **Main Source Files** - 6 files
Core application bootstrap files:
- `routeTree.gen.ts` - Generated TanStack Router tree
- `App.tsx` - Main application component
- `middleware.ts` - Application middleware
- `env.ts` - Environment configuration
- `env.client.ts` - Client-side environment
- `main.tsx` - Application entry point

### Electron Integration

#### Main Process (`electron/`) - 6 files
- `main.js` - Electron main process and window management
- `preload.js` - Preload script for secure IPC communication
- `ffmpeg-handler.js` - FFmpeg CLI integration and processing
- `temp-manager.js` - Temporary file management
- `sound-handler.js` - Sound effects handling
- `theme-handler.js` - Theme management

#### Resources (`electron/resources/`)
- `ffmpeg.exe`, `ffplay.exe`, `ffprobe.exe` - FFmpeg binaries
- `avcodec-62.dll`, `avdevice-62.dll`, etc. - FFmpeg dependencies
- `ffmpeg/` - FFmpeg WebAssembly files

## Architecture Updates (2025-08-20)

### New Features Added Since Last Documentation:
1. **Stickers System** - Complete sticker library with search, overlay management, and export
2. **Captions Support** - Caption generation, editing, and export functionality
3. **Sounds Library** - Sound effects integration with search and preview
4. **Enhanced Export** - Export presets, progress tracking, and validation
5. **Panel Layouts** - Flexible panel management with preset configurations
6. **Asset Path Helper** - Improved asset resolution for Electron compatibility
7. **Transcription System** - Audio transcription with encryption support

### Key Implementation Files:
The codebase contains several substantial files that form the core of the application:

- **Timeline Store** - Comprehensive timeline state management
- **Export Engines** - Multiple export strategies and optimizations
- **AI Integration** - Video and image AI processing clients
- **Media Processing** - FFmpeg integration and utilities
- **Storage System** - Multi-adapter storage abstraction
- **Electron Main Process** - Desktop application lifecycle
- **Stickers Overlay** - Advanced sticker manipulation system
- **Captions Processing** - Multi-language caption support

**Architecture Highlights:**
- Modular export system with multiple engine implementations
- Comprehensive AI integration for video and image processing
- Robust storage abstraction supporting multiple backends
- Extensive timeline management with complex state handling
- New media panel views for stickers, sounds, and captions
- Enhanced Electron integration with dedicated handlers

### Medium Files (100-299 lines)
- Timeline components and hooks
- UI components with complex logic
- Type definitions
- Storage adapters

### Small Files (<100 lines)
- Simple UI components
- Utility functions
- Constants and configuration
- Type-only files

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
- Dedicated types directory
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
- Blob URL management
- Event listener cleanup
- WebAssembly memory handling

## Testing Strategy

⚠️ **Note**: No testing framework currently configured - this is a known gap that should be addressed.

## Future Improvements

1. **Add comprehensive test suite**
2. **Implement performance monitoring**
3. **Enhanced error boundaries**
4. **Better code documentation**
5. **API documentation generation**

---

*This documentation is automatically maintained and should be updated when significant structural changes are made to the codebase.*