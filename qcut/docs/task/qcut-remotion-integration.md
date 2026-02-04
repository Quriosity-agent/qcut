# QCut Remotion Integration

**Created**: 2026-02-04

This document describes how QCut integrates with Remotion for programmatic video composition.

---

## Overview

QCut allows users to import custom Remotion compositions, preview them in the timeline, edit their props, and export them alongside native QCut elements (video, audio, images, text).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      QCut Editor                             │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │ Timeline       │  │ Preview Panel  │  │ Properties    │  │
│  │ RemotionElement│  │ RemotionPreview│  │ RemotionProps │  │
│  └────────────────┘  └────────────────┘  └───────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │    REMOTION STORE       │
              │  (Zustand - centralized)│
              │  • Component Registry   │
              │  • Player Instances     │
              │  • Sync State           │
              │  • Render Queue         │
              └────────────┬────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
│ @remotion/player│ │ IndexedDB   │ │ Electron IPC    │
│ (Preview)       │ │ (Storage)   │ │ (Import/Export) │
└─────────────────┘ └─────────────┘ └─────────────────┘
```

---

## Key Files

### Frontend Components
| File | Purpose |
|------|---------|
| `src/components/editor/preview-panel/remotion-preview.tsx` | Remotion composition preview |
| `src/components/editor/timeline/remotion-element.tsx` | Timeline element representation |
| `src/components/editor/timeline/remotion-sequences.tsx` | Sequence visualization |
| `src/components/editor/properties-panel/remotion-properties.tsx` | Props editor with Zod schema UI |
| `src/components/export/remotion-export-progress.tsx` | Export progress display |

### Core Library (`src/lib/remotion/`)
| File | Purpose |
|------|---------|
| `remotion-store.ts` | Zustand store for all Remotion state |
| `component-loader.ts` | Load components from TS files/folders |
| `component-validator.ts` | Security validation and sandboxing |
| `schema-parser.ts` | Parse Zod schemas for dynamic UI |
| `dynamic-loader.ts` | Runtime component loading |
| `player-wrapper.ts` | Wraps @remotion/player |
| `sync-manager.ts` | Frame sync between timeline and player |
| `export-engine-remotion.ts` | 5-phase export pipeline |
| `pre-renderer.ts` | Render to frame sequences |
| `compositor.ts` | Composite Remotion + QCut frames |
| `keyframe-converter.ts` | Convert keyframes to interpolate() |
| `duration-calculator.ts` | Calculate composition durations |

### Electron Backend (`electron/`)
| File | Purpose |
|------|---------|
| `remotion-folder-handler.ts` | IPC for folder import/scan/bundle |
| `remotion-composition-parser.ts` | Parse Root.tsx for compositions |
| `remotion-bundler.ts` | Bundle with esbuild |

---

## Import Pipeline

```
1. User clicks "Import Remotion Folder"
           ↓
2. [IPC: remotion-folder:select]
   Open dialog, validate is Remotion project
           ↓
3. [IPC: remotion-folder:scan]
   Parse Root.tsx, extract <Composition> metadata:
   • id, component, width, height, fps, durationInFrames
           ↓
4. [IPC: remotion-folder:bundle]
   esbuild bundles each composition entry
           ↓
5. Component registered in Remotion Store
   Stored in IndexedDB for persistence
           ↓
6. Available in Media Panel component browser
```

---

## Remotion Store

**Location**: `src/lib/remotion/remotion-store.ts`

### State Structure
```typescript
interface RemotionStore {
  // Registry
  registeredComponents: Map<string, RemotionComponentDefinition>

  // Instances (active players)
  instances: Map<string, RemotionInstance>

  // Playback sync
  syncState: {
    globalFrame: number
    isPlaying: boolean
    activeElements: string[]
  }

  // Export
  renderQueue: RenderJob[]

  // Import tracking
  importedFolders: Map<string, ImportedFolderInfo>

  // Errors (max 20)
  recentErrors: RemotionError[]
}
```

### Key Hooks
```typescript
useRemotionStore()           // Full store access
useRemotionComponent(id)     // Get component by ID
useRemotionInstance(id)      // Get player instance
useSyncState()               // Subscribe to sync state
useImportedFolders()         // List imported folders
```

---

## Timeline Integration

### RemotionElement Type
```typescript
interface RemotionElement extends BaseTimelineElement {
  type: "remotion"
  componentId: string              // Reference to registered component
  props: Record<string, unknown>   // Component props
  trimStart: number                // Trim start (seconds)
  trimEnd: number                  // Trim end (seconds)
}
```

### Frame Synchronization
The `sync-manager.ts` handles translation between global timeline and local component frames:

```typescript
// Global timeline frame → component local frame
globalToLocalFrame(globalFrame, element, fps) → localFrame

// Component local frame → global timeline frame
localToGlobalFrame(localFrame, element, fps) → globalFrame

// Get active Remotion elements at current time
getActiveRemotionElements(tracks, currentTime) → RemotionElement[]
```

---

## Export Pipeline

**Location**: `src/lib/remotion/export-engine-remotion.ts`

### 5-Phase Process

| Phase | Weight | Description |
|-------|--------|-------------|
| **Analyzing** | 5% | Collect Remotion elements, calculate frames |
| **Pre-rendering** | 40% | Render each element to PNG/JPEG frames |
| **Compositing** | 35% | Combine Remotion frames with QCut canvas |
| **Encoding** | 15% | FFmpeg encode to MP4/WebM |
| **Cleanup** | 5% | Delete temp files |

### Pre-rendering Modes
| Mode | Method | Quality |
|------|--------|---------|
| Electron IPC | Main process FFmpeg | High |
| Canvas | Browser canvas capture | Medium (fallback) |

---

## Electron IPC Channels

**Handler**: `electron/remotion-folder-handler.ts`

| Channel | Purpose |
|---------|---------|
| `remotion-folder:select` | Open folder dialog, validate project |
| `remotion-folder:scan` | Parse compositions from Root.tsx |
| `remotion-folder:bundle` | esbuild bundle entry points |
| `remotion-folder:import` | Full pipeline (scan + bundle) |
| `remotion-folder:validate` | Validate folder path |
| `remotion-folder:check-bundler` | Check esbuild availability |

### Frontend Access
```typescript
const api = window.electronAPI.remotionFolder;

// Open dialog and select folder
const result = await api.select();

// Scan folder for compositions
const compositions = await api.scan(folderPath);

// Full import pipeline
const imported = await api.import(folderPath);
```

---

## Built-in Components

**Location**: `src/lib/remotion/built-in/`

### Text Animations (5)
- `Typewriter` - Character-by-character typing
- `FadeInText` - Fade in animation
- `BounceText` - Bouncing entrance
- `SlideText` - Slide from direction
- `ScaleText` - Scale animation

### Transitions (4)
- `Dissolve` - Cross-fade transition
- `Slide` - Slide transition
- `Wipe` - Wipe effect
- `Zoom` - Zoom transition

### Templates (4)
- `IntroScene` - Opening scene template
- `OutroScene` - Closing scene template
- `LowerThird` - Lower third graphic
- `TitleCard` - Title card template

---

## Preview System

### RemotionPreview Component
```tsx
<RemotionPreview
  componentId="my-composition"
  props={{ title: "Hello" }}
  frame={currentFrame}
  isPlaying={isPlaying}
/>
```

### Player Wrapper
The `player-wrapper.ts` wraps `@remotion/player`:
- Seek to frame
- Play/pause control
- Playback rate adjustment
- Frame-perfect synchronization

---

## Security

### Component Validation
`component-validator.ts` ensures:
- No file system access
- No network requests
- Sandboxed execution
- Validated props against Zod schemas

### Import Validation
- Checks for `package.json` with Remotion dependency
- Validates `Root.tsx` structure
- Scans for `<Composition>` elements only

---

## Error Handling

The store maintains up to 20 recent errors with:
- Error type and message
- Component/element context
- Timestamp
- Recovery suggestions

Fallback behavior:
- Electron pre-render fails → Canvas fallback
- Component load fails → Graceful degradation
- Export fails → Partial export with error report
