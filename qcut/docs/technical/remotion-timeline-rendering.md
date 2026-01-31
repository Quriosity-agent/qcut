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
| Browse built-in components | ✅ Supported |
| Search by name/tags | ✅ Supported |
| Preview before adding | ✅ Supported |
| Import custom `.tsx` files | ✅ Supported |
| Category organization | ✅ Supported |

**Built-in Components:**
- **Text Animations**: FadeInText, SlideText, BounceText, Typewriter, ScaleText
- **Transitions**: Dissolve, Slide, Wipe, Zoom
- **Templates**: IntroScene, OutroScene, LowerThird, TitleCard, SkillsDemo

### 2. Timeline Integration

Remotion components can be placed on a dedicated `"remotion"` track type:

```typescript
// Timeline element type for Remotion
interface RemotionElement {
  type: "remotion";
  componentId: string;
  props: Record<string, unknown>;
  trimStart: number;
  trimEnd: number;
  // ... standard timeline element properties
}
```

**Supported Operations:**
- ✅ Add to timeline
- ✅ Move/reposition
- ✅ Trim start/end
- ✅ Adjust duration
- ✅ Apply transforms (position, scale, rotation)
- ✅ Opacity control
- ✅ Layer ordering

### 3. Live Preview

The `RemotionPlayerWrapper` integrates `@remotion/player` for real-time preview:

- Frame synchronization with QCut's playhead
- Play/pause/seek controls
- Preview in editor panel

### 4. Export Pipeline

The `RemotionExportEngine` handles full export with these phases:

```
┌─────────────┐    ┌───────────────┐    ┌─────────────┐    ┌──────────┐    ┌─────────┐
│  Analyzing  │ -> │ Pre-rendering │ -> │ Compositing │ -> │ Encoding │ -> │ Cleanup │
└─────────────┘    └───────────────┘    └─────────────┘    └──────────┘    └─────────┘
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
| No auto-generated prop UI | Props edited manually in properties panel | Future: Zod schema-based UI generation |
| Sequential element rendering | Not parallelized between elements | Future optimization |

---

## File Structure

```
apps/web/src/
├── lib/remotion/
│   ├── types.ts                    # Type definitions
│   ├── player-wrapper.tsx          # @remotion/player integration
│   ├── export-engine-remotion.ts   # Export pipeline
│   ├── pre-renderer.ts             # Frame rendering
│   ├── compositor.ts               # Frame compositing
│   ├── sync-manager.ts             # Timeline sync
│   └── built-in/                   # Built-in components
│       ├── templates/
│       ├── text/
│       └── transitions/
├── components/editor/
│   ├── media-panel/views/remotion/ # Component browser UI
│   └── properties-panel/
│       └── remotion-properties.tsx # Props editor
├── stores/
│   └── remotion-store.ts           # Zustand state management
└── types/
    └── timeline.ts                 # RemotionElement type
```

---

## Usage Example

### Adding a Remotion Component to Timeline

1. Open **Media Panel** → **Remotion** tab
2. Browse or search for a component
3. Click to preview, then **Add to Timeline**
4. Adjust position, duration, and props in **Properties Panel**
5. Export via **File → Export** (Remotion elements automatically pre-rendered)

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

### Current Limitation: No Sequence Editing in QCut

| Feature | Supported? |
|---------|-----------|
| Import composition with sequences | ✅ Yes |
| Render sequences correctly | ✅ Yes |
| View internal sequences in QCut | ❌ No |
| Edit individual sequences in QCut | ❌ No |
| Modify transition timing in QCut | ❌ No |

**To edit sequences:** Use Remotion Studio, then reimport the component into QCut.

### Future Possibility: Sequence Visualization

A future enhancement could add:
- Parse component AST to detect `<Sequence>` elements
- Display nested sequences in QCut's timeline
- Allow timing adjustments via props

---

## Future Enhancements

- [ ] Parallel element rendering for faster exports
- [ ] Complete frame caching system
- [ ] Auto-generated UI from Zod schemas
- [ ] NPM package imports for components
- [ ] Real-time parameter animation keyframes

---

## Conclusion

QCut's timeline **fully supports rendering Remotion compositions**. The integration includes:

- ✅ Component browsing and import
- ✅ Timeline placement with standard operations
- ✅ Live preview with frame sync
- ✅ Full export pipeline with pre-rendering and compositing

This makes QCut a powerful tool for combining traditional video editing with Remotion's programmatic animations.
