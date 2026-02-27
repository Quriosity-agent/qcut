# QCut Timeline: Remotion Rendering Support

## Overview

**Yes, QCut's timeline supports rendering Remotion compositions.**

QCut has a full-featured Remotion integration that allows users to add Remotion components to the timeline and export them as part of the final video.

![Remotion Studio Timeline](../../assets/remotion-timeline-example.png)
*Screenshot shows Remotion's TransitionSeries with multiple TS.Sequence elements*

---

## Current Capabilities

### 1. Component Browser & Import

| Feature | Status |
|---------|--------|
| Browse built-in components | Supported |
| Search by name/tags | Supported |
| Preview before adding | Supported |
| Import custom `.tsx` files | Supported |
| Import from Remotion project folders | Supported |
| Category organization | Supported |
| Persistent storage via IndexedDB | Supported |

**Built-in Components:**
- **Text Animations**: FadeInText, SlideText, BounceText, Typewriter, ScaleText
- **Transitions**: Dissolve, Slide, Wipe, Zoom
- **Templates**: IntroScene, OutroScene, LowerThird, TitleCard, SkillsDemo

### 2. Timeline Integration

Remotion components can be placed on a dedicated `"remotion"` track type:

```typescript
// Timeline element type for Remotion (from types/timeline.ts)
// Inherits from BaseTimelineElement: id, name, duration, startTime,
// trimStart, trimEnd, hidden?, x?, y?, width?, height?, rotation?, effectIds?

interface RemotionElement extends BaseTimelineElement {
  type: "remotion";
  /** ID of the Remotion component in the registry */
  componentId: string;
  /** Optional path to the source .tsx file (for imported components) */
  componentPath?: string;
  /** Props to pass to the Remotion component */
  props: Record<string, unknown>;
  /** Rendering mode: 'live' for preview, 'cached' for export */
  renderMode: "live" | "cached";
  /** Opacity level (0-1) */
  opacity?: number;
  /** Scale factor (1 = 100%) */
  scale?: number;
}
```

**Supported Operations:**
- Add to timeline
- Move/reposition
- Trim start/end (inherited from BaseTimelineElement)
- Adjust duration
- Apply transforms (position, scale, rotation)
- Opacity control
- Layer ordering

### 3. Live Preview

The `RemotionPlayerWrapper` integrates `@remotion/player` for real-time preview:

- Frame synchronization with QCut's playhead
- Play/pause/seek controls
- Preview in editor panel

### 4. Export Pipeline

The `RemotionExportEngine` handles full export with these phases:

```
+-----------+    +---------------+    +-------------+    +----------+    +---------+
| Analyzing | -> | Pre-rendering | -> | Compositing | -> | Encoding | -> | Cleanup |
+-----------+    +---------------+    +-------------+    +----------+    +---------+
```

**Export Modes:**
| Mode | Description | Quality |
|------|-------------|---------|
| Electron IPC | Uses FFmpeg via main process | High (recommended) |
| Canvas Fallback | Captures from browser canvas | Medium |

---

## How Rendering Works

### Pre-rendering Phase

1. Identifies all Remotion elements in timeline
2. Calculates frame requirements per element
3. Renders each component to frame sequences (PNG/JPEG)
4. Stores frames in temp directory

### Compositing Phase

1. `FrameCompositor` layers frames correctly
2. Applies blend modes and transforms
3. Merges with QCut canvas content (video, audio, text, stickers)
4. Respects layer ordering

### Final Encoding

1. FFmpeg encodes composited frames
2. Audio tracks merged
3. Output to final video format

---

## Limitations

| Limitation | Details | Workaround |
|------------|---------|------------|
| No runtime playback rate | Remotion Player doesn't support dynamic rate changes | Rate changes only affect media elements |
| Component import size | Max 500KB for `.tsx` files | Split large components |
| Disk space | Pre-rendering requires temp storage | Ensure sufficient disk space |
| Sequential element rendering | Not parallelized between elements | Future optimization |

---

## File Structure

```
apps/web/src/
├── lib/remotion/
│   ├── index.ts                       # Barrel exports for all modules
│   ├── types.ts                       # Type definitions (component, instance, cache, store)
│   ├── player-wrapper.tsx             # @remotion/player integration
│   ├── export-engine-remotion.ts      # Export pipeline
│   ├── pre-renderer.ts               # Frame rendering
│   ├── compositor.ts                  # Frame compositing
│   ├── sync-manager.ts               # Timeline sync
│   ├── component-validator.ts         # Security & correctness validation for imported code
│   ├── duration-calculator.ts         # Duration/position calculations for sequences with overlaps
│   ├── dynamic-loader.ts             # Runtime loading of bundled components via blob URLs
│   ├── folder-validator.ts           # Client-side validation for Remotion folder imports
│   ├── keyframe-converter.ts         # Converts QCut keyframes to Remotion interpolate() calls
│   ├── schema-parser.ts             # Parses Zod schemas to generate dynamic prop editor UI
│   ├── sequence-parser.ts           # AST-based parser to detect <Sequence>/<TransitionSeries>
│   ├── sequence-analysis-service.ts  # Caching layer for parsed sequence structures
│   ├── component-loader.ts           # Barrel re-export for component-loader/ directory
│   ├── component-loader/             # Component loading subsystem
│   │   ├── index.ts                  # Barrel exports
│   │   ├── types.ts                  # LoadResult, StoredComponent, FolderLoadResult, etc.
│   │   ├── constants.ts              # IndexedDB constants (DB name, version, store name)
│   │   ├── loader.ts                 # Core load/store/remove logic for components
│   │   ├── indexeddb.ts              # IndexedDB persistence helpers
│   │   └── folder-import.ts          # Remotion project folder import via Electron IPC
│   ├── built-in/                     # Built-in components
│   │   ├── index.ts                  # Registry: definitions, search, lookup helpers
│   │   ├── templates/                # IntroScene, OutroScene, LowerThird, TitleCard, SkillsDemo
│   │   ├── text/                     # FadeInText, SlideText, BounceText, Typewriter, ScaleText
│   │   └── transitions/              # Dissolve, Slide, Wipe, Zoom
│   └── __tests__/                    # Test files for all modules
├── components/editor/
│   ├── media-panel/views/remotion/   # Component browser UI
│   │   ├── index.tsx                 # Main remotion browser view
│   │   ├── component-card.tsx        # Component card display
│   │   ├── component-preview-modal.tsx # Preview modal
│   │   ├── component-import-dialog.tsx # Single file import dialog
│   │   └── folder-import-dialog.tsx  # Folder import dialog
│   └── properties-panel/
│       └── remotion-properties.tsx   # Props editor
├── stores/
│   └── ai/
│       └── remotion-store.ts         # Zustand state management
└── types/
    └── timeline.ts                   # RemotionElement type definition
```

---

## Key Modules

### component-validator.ts

Validates imported Remotion component source code for security and correctness. Checks for forbidden APIs (fs, child_process, eval, fetch, etc.), verifies React/Remotion patterns, extracts metadata (name, category, dimensions, tags), and enforces file size limits (500KB default).

### dynamic-loader.ts

Loads bundled Remotion components at runtime using blob URLs and dynamic imports. Wraps bundled ESM code to inject React, Remotion, `@remotion/zod-types`, and `@remotion/transitions` from globals. Includes component caching and memory cleanup.

### keyframe-converter.ts

Converts QCut keyframe animations to Remotion `interpolate()` calls. Supports multiple easing types (linear, easeIn, easeOut, easeInOut, spring), numeric and color interpolation, and code generation for export.

### schema-parser.ts

Parses Zod schemas from Remotion components to generate dynamic form fields for prop editing. Supports string, number, boolean, color, select, object, and array field types. Handles nested schemas, default values, and validation constraints. Powers the auto-generated prop UI in the properties panel.

### sequence-parser.ts

AST-based parser (using Babel) that detects `<Sequence>`, `<TransitionSeries>`, `<TS.Sequence>`, and `<TS.Transition>` elements in component source code. Extracts timing props (from, durationInFrames) and transition metadata (timing functions, presentation type). Marks runtime-computed values as `"dynamic"`.

### sequence-analysis-service.ts

Caching service that wraps `sequence-parser.ts`. Provides LRU-cached analysis results keyed by component ID and source hash. Used by the store and component loader to avoid re-parsing unchanged components.

### duration-calculator.ts

Calculates total duration and per-sequence positions accounting for transition overlaps in `TransitionSeries` components. Provides utilities for finding overlapping sequences and transitions at specific frames.

### component-loader/

Subsystem for loading, validating, and persisting Remotion components:
- **loader.ts**: Core logic to load from source code or file, validate, analyze sequences, and store in IndexedDB
- **indexeddb.ts**: IndexedDB persistence for imported components
- **folder-import.ts**: Import from Remotion project folders via Electron IPC (scan, bundle, load)
- **constants.ts**: Database name (`qcut-remotion-components`), version, store name

### folder-validator.ts

Client-side validation and structured error handling for Remotion folder imports. Provides error factories for common failure modes (not a Remotion project, no compositions found, parse/bundle/load errors, permission denied) with recovery suggestions.

---

## Usage Example

### Adding a Remotion Component to Timeline

1. Open **Media Panel** -> **Remotion** tab
2. Browse or search for a component
3. Click to preview, then **Add to Timeline**
4. Adjust position, duration, and props in **Properties Panel**
5. Export via **File -> Export** (Remotion elements automatically pre-rendered)

### Export with Remotion Elements

```typescript
// Internally, QCut calls:
const engine = new RemotionExportEngine(config);
await engine.exportWithRemotion({
  timeline: currentTimeline,
  outputPath: "output.mp4",
  format: "mp4",
  quality: 90,
});
```

---

---

## About Sequences (TransitionSeries, Sequence)

### What You See in Remotion Studio

The screenshot shows Remotion Studio's internal timeline visualization:

```
<TransitionSeries>          ─────────────────────────────
  <TS.Sequence>             ████████
  <TS.Sequence>                     ████████
  <TS.Sequence>                              ████████████
  <TS.Sequence>                                          ████████
  <TS.Sequence>                                                   ████
</TransitionSeries>
```

These are **Remotion's internal sequencing primitives** (`<Sequence>`, `<TransitionSeries>`, etc.) - they define timing within a single composition.

### How QCut Handles This

**QCut treats each Remotion component as a black box:**

| Aspect | QCut's View | Remotion's Internal View |
|--------|-------------|-------------------------|
| Structure | Single element | Multiple sequences |
| Duration | `durationInFrames: 195` | Sum of sequences minus overlaps |
| Timeline | One track item | Nested sequences with transitions |
| Props | Flat prop object | Per-sequence props |

```typescript
// QCut sees this:
{
  type: "remotion",
  componentId: "my-composition",
  durationInFrames: 195,
  props: { title: "Hello" }
}

// Remotion internally handles:
<TransitionSeries>
  <TS.Sequence durationInFrames={60}>...</TS.Sequence>
  <TS.Transition ... />
  <TS.Sequence durationInFrames={80}>...</TS.Sequence>
  ...
</TransitionSeries>
```

### Why This Works

1. **Remotion Player handles sequencing** - QCut uses `@remotion/player` which internally processes all `<Sequence>` and `<TransitionSeries>` elements
2. **Frame-accurate rendering** - When QCut seeks to frame 100, Remotion knows which internal sequence is active
3. **Export pre-rendering** - Each frame is rendered by Remotion's internal logic, respecting all transitions

### Sequence Visualization (Partial)

QCut now has partial support for detecting and visualizing internal sequences:

| Feature | Status |
|---------|--------|
| Import composition with sequences | Supported |
| Render sequences correctly | Supported |
| Parse internal sequences from source (AST) | Supported (`sequence-parser.ts`) |
| Calculate positions with transition overlaps | Supported (`duration-calculator.ts`) |
| Cache analysis results | Supported (`sequence-analysis-service.ts`) |
| Display nested sequences in QCut timeline | Not yet implemented |
| Edit individual sequences in QCut | Not yet implemented |
| Modify transition timing in QCut | Not yet implemented |

**To edit sequences:** Use Remotion Studio, then reimport the component into QCut.

---

## Future Enhancements

- [ ] Parallel element rendering for faster exports
- [ ] Complete frame caching system
- [ ] NPM package imports for components
- [ ] Real-time parameter animation keyframes
- [ ] Display parsed sequence structure in QCut's timeline UI
- [ ] Edit individual sequences and transition timing in QCut

---

## Conclusion

QCut's timeline **fully supports rendering Remotion compositions**. The integration includes:

- Component browsing, import (single file and folder), and persistent storage
- Timeline placement with standard operations
- Live preview with frame sync
- Full export pipeline with pre-rendering and compositing
- Security validation for imported components
- Auto-generated prop editor UI from Zod schemas
- AST-based sequence parsing with cached analysis

This makes QCut a powerful tool for combining traditional video editing with Remotion's programmatic animations.
