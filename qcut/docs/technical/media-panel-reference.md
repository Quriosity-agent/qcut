# QCut Media Panel Reference

This document provides a comprehensive overview of all 21 panels available in the QCut video editor's media panel sidebar.

> **Note:** All file paths in this document are relative to the `qcut/` project root directory.

## Table of Contents

1. [Media](#1-media)
2. [AI Images](#2-ai-images)
3. [Adjustment](#3-adjustment)
4. [AI Video](#4-ai-video)
5. [Camera](#5-camera)
6. [Nano Edit](#6-nano-edit)
7. [Draw](#7-draw)
8. [Text](#8-text)
9. [Stickers](#9-stickers)
10. [Video Edit](#10-video-edit)
11. [Remotion](#11-remotion)
12. [Terminal](#12-terminal)
13. [Transcribe](#13-transcribe)
14. [Project](#14-project)
15. [Filters (WIP)](#15-filters-wip)
16. [Segment (WIP)](#16-segment-wip)
17. [Sounds (WIP)](#17-sounds-wip)
18. [Effects (WIP)](#18-effects-wip)
19. [Transitions (WIP)](#19-transitions-wip)
20. [Audio (WIP)](#20-audio-wip)
21. [Captions (WIP)](#21-captions-wip)

---

## 1. Media

**Icon:** `VideoIcon`
**File:** `apps/web/src/components/editor/media-panel/views/media.tsx`

### Summary
The central hub for managing all media assets in your project.

### Features
- **Import media:** Upload videos, images, and audio files via drag-and-drop or file picker
- **Media library:** Browse all imported media with thumbnails and metadata
- **Search & filter:** Find media by name or type (video/image/audio)
- **Drag to timeline:** Add media to the timeline by dragging items
- **Context menu:** Right-click for options like duplicate, open folder, export
- **Sorting:** Sort by name, date, type, or duration

### File Path
`apps/web/src/components/editor/media-panel/views/media.tsx`

---

## 2. AI Images

**Icon:** `WandIcon`
**File:** `apps/web/src/components/editor/media-panel/views/text2image.tsx`

### Summary
Generate images from text prompts using AI models.

### Features
- **Text-to-image generation:** Create images from text descriptions
- **Multiple AI models:** 13 text-to-image models from Google, OpenAI, ByteDance, Black Forest Labs, Alibaba, fal.ai, and Tongyi-MAI
- **Upscaling:** Enhance image resolution with AI upscaling
- **Style presets:** Quick access to different art styles
- **Generation history:** View and reuse previous generations
- **Add to media:** Generated images automatically added to media library

### Supported Models
- Gemini 3 Pro, GPT Image 1.5, Nano Banana
- SeedDream v3/v4/v4.5, FLUX Pro v1.1 Ultra, FLUX 2 Flex
- Imagen4 Ultra, WAN v2.2, Qwen Image, Z-Image Turbo, Reve

### File Path
`apps/web/src/components/editor/media-panel/views/text2image.tsx`

---

## 3. Adjustment

**Icon:** `SlidersHorizontalIcon`
**File:** `apps/web/src/components/editor/adjustment/index.tsx`

### Summary
AI-powered image editing and manipulation panel.

### Features
- **Image editing:** Transform images using AI with text prompts
- **Multiple model support:** Choose from various image editing models
- **Parameter controls:** Fine-tune generation settings (strength, guidance, etc.)
- **Edit history:** Track and revert changes
- **Multi-image support:** Some models support multiple input images
- **Preview panel:** Compare before/after results

### Use Cases
- Background replacement
- Object removal/addition
- Style transfer
- Color adjustments

### File Path
`apps/web/src/components/editor/adjustment/index.tsx`

---

## 4. AI Video

**Icon:** `BotIcon`
**File:** `apps/web/src/components/editor/media-panel/views/ai/index.tsx`

### Summary
Generate videos using AI from text, images, or existing videos.

### Features
- **Text-to-video:** Generate video clips from text descriptions
- **Image-to-video:** Animate static images
- **Avatar generation:** Create AI talking head videos
- **Video upscaling:** Enhance video resolution
- **Multiple AI providers:** Support for Sora, Veo, LTX Video, Kling, etc.
- **Generation history:** Track all AI video generations

### Tabs
- **Text:** Text-to-video generation
- **Image:** Image-to-video animation
- **Avatar:** AI avatar/talking head creation
- **Upscale:** Video resolution enhancement

### File Path
`apps/web/src/components/editor/media-panel/views/ai/index.tsx`

---

## 5. Camera

**Icon:** `CameraIcon`
**Tab key:** `camera-selector`
**File:** `apps/web/src/components/editor/media-panel/views/camera-selector/camera-selector-view.tsx`

### Summary
Virtual cinema camera configurator for AI video workflows. Lets users select camera body, lens, focal length, and aperture.

### Features
- **Camera body selection:** 6 cameras (Red V-Raptor, Sony Venice, IMAX Film Camera, Arri Alexa 35, Arriflex 16SR, Panavision DXL2)
- **Lens selection:** 11 lenses across spherical, anamorphic, and special types
- **Focal length:** 4 options (8mm, 14mm, 35mm, 50mm)
- **Aperture:** 3 options (f/1.4, f/4, f/11)
- **Current setup display:** Shows selected camera thumbnail and focal length
- **Horizontal scroll tracks:** Snap-scrolling with mouse wheel support

### Components
- `CameraSelectorView` — Main panel component
- `ScrollTrack` — Reusable horizontal scroll track with snap scrolling

### Store
- `useCameraSelectorStore` — `apps/web/src/stores/editor/camera-selector-store.ts`

### File Path
`apps/web/src/components/editor/media-panel/views/camera-selector/`

---

## 6. Nano Edit

**Icon:** `PaletteIcon`
**File:** `apps/web/src/components/editor/media-panel/views/nano-edit.tsx`

### Summary
AI-powered quick image and video enhancements.

### Features
- **Image assets management:** View and manage project images
- **Quick AI enhancements:** One-click image improvements
- **Batch processing:** Apply edits to multiple images

### File Path
`apps/web/src/components/editor/media-panel/views/nano-edit.tsx`

---

## 7. Draw

**Icon:** `PenTool`
**File:** `apps/web/src/components/editor/media-panel/views/draw.tsx`

### Summary
Freehand drawing and annotation canvas.

### Features
- **Drawing tools:** Pencil, brush, shapes, and more
- **Color picker:** Choose colors for drawing
- **Canvas toolbar:** Undo, redo, clear, save operations
- **Tool selector:** Switch between different drawing tools
- **Saved drawings:** Load and manage saved drawings
- **Image upload:** Import images to draw over
- **Selection tools:** Select, group, and manipulate objects

### Use Cases
- Create custom graphics
- Annotate video frames
- Design overlays and stickers

### File Path
`apps/web/src/components/editor/media-panel/views/draw.tsx`

---

## 8. Text

**Icon:** `TypeIcon`
**File:** `apps/web/src/components/editor/media-panel/views/text.tsx`

### Summary
Add text overlays to your video timeline.

### Features
- **Default text template:** Quick-add text with default styling
- **Drag to timeline:** Position text at specific timestamps
- **Click to add:** Add text at current playhead position
- **Customization:** Style text after adding to timeline (font, size, color, etc.)

### File Path
`apps/web/src/components/editor/media-panel/views/text.tsx`

---

## 9. Stickers

**Icon:** `StickerIcon`
**File:** `apps/web/src/components/editor/media-panel/views/stickers/stickers-view.tsx`

### Summary
Browse and add stickers/icons to your video as overlays.

### Features
- **Icon search:** Search thousands of icons via Iconify API
- **Collections:** Browse curated icon collections
- **Recent stickers:** Quick access to recently used stickers
- **Drag to canvas:** Add stickers directly to the video preview
- **Categories:** Browse by icon collection/category
- **SVG support:** High-quality scalable vector graphics

### Popular Collections
- Material Design Icons
- Font Awesome
- Heroicons
- Tabler Icons

### File Path
`apps/web/src/components/editor/media-panel/views/stickers/stickers-view.tsx`

---

## 10. Video Edit

**Icon:** `Wand2Icon`
**File:** `apps/web/src/components/editor/media-panel/views/video-edit.tsx`

### Summary
AI-powered video enhancement and audio tools.

### Features

#### Audio Gen Tab
- Generate audio/sound effects for video using AI
- Kling Video-to-Audio model

#### Audio Sync Tab
- Sync generated audio to video content
- MMAudio V2 model support

#### Upscale Tab
- Enhance video resolution
- Topaz-style upscaling

### File Path
`apps/web/src/components/editor/media-panel/views/video-edit.tsx`

---

## 11. Remotion

**Icon:** `Layers`
**File:** `apps/web/src/components/editor/media-panel/views/remotion/index.tsx`

### Summary
Browse and add Remotion components to the timeline.

### Features
- **Component library:** Browse pre-built Remotion components
- **Category filtering:** Filter by animation, scene, effect, template, etc.
- **Search:** Find components by name
- **Preview modal:** Preview components before adding
- **Import dialog:** Import custom Remotion components
- **Folder import:** Import entire component folders
- **Add to timeline:** Drag components to timeline

### Categories
- Templates
- Text animations
- Transitions
- Scenes
- Effects
- Intros/Outros
- Social media formats
- Custom imports

### File Path
`apps/web/src/components/editor/media-panel/views/remotion/index.tsx`

---

## 12. Terminal

**Icon:** `SquareTerminalIcon`
**File:** `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx`

### Summary
Integrated terminal with AI CLI assistant support.

### Features
- **PTY terminal:** Full pseudo-terminal emulator
- **AI CLI providers:** Integration with Claude Code, Aider, OpenRouter
- **Model selection:** Choose AI model for assistance
- **Session management:** Connect, disconnect, reset sessions
- **Skill context:** Context-aware AI assistance

### Supported CLI Providers
- Claude Code
- Aider
- OpenRouter (various models)

### File Path
`apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx`

---

## 13. Transcribe

**Icon:** `TextSelect`
**File:** `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx`

### Summary
Word-level transcription and timeline editing.

### Features
- **Drag & drop import:** Import JSON transcription files
- **Media transcription:** Transcribe video/audio using ElevenLabs Scribe v2 or Gemini 2.5 Pro
- **Word-level timestamps:** Click any word to seek to that position
- **Word deletion:** Mark words for removal (strikethrough)
- **Timing tooltips:** Hover to see word timing info
- **Supported formats:** MP4, MOV, AVI, MKV, WebM, WAV, MP3, M4A, AAC

### Use Cases
- Create subtitles/captions
- Remove filler words ("um", "uh")
- Navigate video by spoken content
- Edit transcript for export

### File Path
`apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx`

---

## 14. Project

**Icon:** `FolderSync`
**File:** `apps/web/src/components/editor/media-panel/views/project-folder.tsx`

### Summary
Browse and import files from the project folder structure.

### Features
- **Folder navigation:** Browse project directory tree
- **File type icons:** Visual indicators for video, audio, image files
- **Bulk import:** Select multiple files to import
- **File info:** View file size and type
- **Breadcrumb navigation:** Easy folder traversal
- **Refresh:** Rescan folder for new files
- **Checkbox selection:** Select/deselect files for import

### File Path
`apps/web/src/components/editor/media-panel/views/project-folder.tsx`

---

## 15. Filters (WIP)

**Icon:** `BlendIcon`
**File:** `apps/web/src/components/editor/media-panel/index.tsx` (placeholder)

### Summary
Apply visual filters to video clips.

### Status
**Work in progress** - Placeholder view currently displayed.

### Planned Features
- Color grading presets
- Film grain effects
- Vignette and blur filters
- Custom LUT support

---

## 16. Segment (WIP)

**Icon:** `ScissorsIcon`
**File:** `apps/web/src/components/editor/segmentation/index.tsx`

### Summary
AI-powered image and video segmentation using SAM-3.

### Features
- **Text prompts:** Describe what to segment in natural language
- **Point prompts:** Click on objects to segment
- **Box prompts:** Draw bounding boxes around objects
- **Object list:** Manage multiple segmented objects
- **Mask overlay:** Visualize segmentation masks
- **Image/Video modes:** Segment still images or video frames

### Use Cases
- Background removal
- Object isolation
- Subject extraction
- Green screen replacement

### Status
Work in progress - core functionality implemented.

### File Path
`apps/web/src/components/editor/segmentation/index.tsx`

---

## 17. Sounds (WIP)

**Icon:** `VolumeXIcon`
**File:** `apps/web/src/components/editor/media-panel/views/sounds.tsx`

### Summary
Browse and add sound effects and music to your project.

### Features
- **Sound effects library:** Search and browse sound effects
- **Songs library:** Browse music tracks
- **Saved sounds:** Quick access to favorited sounds
- **Preview playback:** Listen before adding
- **Favorites:** Save frequently used sounds
- **Filter options:** Filter by category/type
- **Infinite scroll:** Load more results as you browse

### Status
Work in progress - basic functionality available.

### File Path
`apps/web/src/components/editor/media-panel/views/sounds.tsx`

---

## 18. Effects (WIP)

**Icon:** `SparklesIcon`
**File:** `apps/web/src/components/editor/media-panel/views/effects.tsx`

### Summary
Apply visual effects to timeline elements.

### Features
- **Effect presets:** Browse pre-configured effects
- **Categories:** Basic, color, artistic, vintage, cinematic, distortion
- **Search:** Find effects by name or description
- **Apply to selection:** Apply effects to selected timeline elements
- **Drag & drop:** Drag effects onto timeline elements
- **Effects track:** Auto-show effects track when applied

### Effect Categories
- Basic transformations
- Color adjustments
- Artistic styles
- Vintage/retro looks
- Cinematic effects
- Distortion effects

### Status
Work in progress - requires feature flag to enable.

### File Path
`apps/web/src/components/editor/media-panel/views/effects.tsx`

---

## 19. Transitions (WIP)

**Icon:** `ArrowLeftRightIcon`
**File:** `apps/web/src/components/editor/media-panel/index.tsx` (placeholder)

### Summary
Add transitions between clips on the timeline.

### Status
**Coming soon** - Placeholder view currently displayed.

### Planned Features
- Fade in/out
- Cross dissolve
- Wipe transitions
- Zoom transitions
- Custom transition timing

---

## 20. Audio (WIP)

**Icon:** `MusicIcon`
**File:** `apps/web/src/components/editor/media-panel/views/audio.tsx`

### Summary
Search and add music/audio tracks to your project.

### Features
- **Search:** Search for songs and artists
- **Music library:** Browse available tracks

### Status
Work in progress - basic search UI implemented.

### File Path
`apps/web/src/components/editor/media-panel/views/audio.tsx`

---

## 21. Captions (WIP)

**Icon:** `CaptionsIcon`
**File:** `apps/web/src/components/editor/media-panel/views/captions.tsx`

### Summary
Generate and manage video captions using AI transcription.

### Features
- **File upload:** Upload video/audio for transcription
- **Gemini integration:** AI-powered transcription
- **Language selection:** Choose transcription language
- **Progress tracking:** View transcription progress
- **Segment editing:** Edit individual caption segments
- **Timeline integration:** Add captions to timeline
- **Export options:** Export captions in various formats

### Supported File Types
- Video: MP4, MOV, AVI, MKV, WebM
- Audio: WAV, MP3, M4A, AAC

### Status
Work in progress - migrating from Modal Whisper to Gemini.

### File Path
`apps/web/src/components/editor/media-panel/views/captions.tsx`

---

## Architecture Overview

### Store Files
Each panel typically has an associated Zustand store for state management:

| Panel | Store File |
|-------|------------|
| Media | `stores/media-store.ts` |
| AI Video | `stores/ai-generation-store.ts` |
| Adjustment | `stores/adjustment-store.ts` |
| Stickers | `stores/stickers-store.ts` |
| Draw | `stores/white-draw-store.ts` |
| Segmentation | `stores/segmentation-store.ts` |
| Sounds | `stores/sounds-store.ts` |
| Captions | `stores/captions-store.ts` |
| Text2Image | `stores/text2image-store.ts` |
| Effects | `stores/effects-store.ts` |
| Terminal | `stores/pty-terminal-store.ts` |
| Remotion | `stores/remotion-store.ts` |
| Transcribe | `stores/word-timeline-store.ts` |

### Tab Configuration
Panel tabs are configured in:
- **Tab definitions:** `apps/web/src/components/editor/media-panel/store.ts`
- **Tab bar rendering:** `apps/web/src/components/editor/media-panel/tabbar.tsx`
- **View mapping:** `apps/web/src/components/editor/media-panel/index.tsx`

---

*Last updated: February 2026*
