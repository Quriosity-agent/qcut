# Remotion Sequence Visualization

Technical documentation for visualizing Remotion `<Sequence>` and `<TransitionSeries>` elements within QCut's timeline.

## Overview

QCut can display the internal sequence structure of Remotion compositions on the timeline, showing individual sequences, transitions, and overlap regions.

## Key Concepts

### Duration Calculation

Transitions overlap with adjacent sequences:

```
Total Duration = Sum of sequences - Sum of transitions
```

**Example**: Sequences (60f + 80f + 90f) with transitions (15f + 20f) = **195 frames**

```
Without transitions:        With transitions:
┌────────┬────────────┐    ┌────────┬────────────┐
│   A    │     B      │    │   A  ▓▓▓▓  B        │  ← overlap region
└────────┴────────────┘    └────────┴────────────┘
0       40           100   0      40  70        (shorter total)
```

### Visualization Priority

1. **Author metadata** (preferred) - `sequenceStructure` in component definition
2. **Parsed analysis** (fallback) - AST extraction from source code

## Core Types

```typescript
interface SequenceMetadata {
  name: string;
  from: number;
  durationInFrames: number;
  color?: string;
  description?: string;
}

interface TransitionMetadata {
  afterSequenceIndex: number;
  durationInFrames: number;
  presentation?: "fade" | "slide" | "wipe" | "zoom" | "custom";
}

interface SequenceStructure {
  sequences: SequenceMetadata[];
  transitions?: TransitionMetadata[];
  calculatedDuration?: number;
}
```

## Key Files

| File | Purpose |
|------|---------|
| `lib/remotion/types.ts` | Type definitions (sequence, component, instance, cache, sync, export) |
| `lib/remotion/index.ts` | Barrel re-exports for the entire remotion module |
| `lib/remotion/duration-calculator.ts` | Duration/position calculations with overlap handling |
| `lib/remotion/sequence-parser.ts` | AST extraction of sequences/transitions from source |
| `lib/remotion/sequence-analysis-service.ts` | LRU caching service for parsed analysis |
| `lib/remotion/component-loader.ts` | Barrel re-export for `component-loader/` subdirectory |
| `lib/remotion/component-loader/loader.ts` | Core component loading from code/file/IndexedDB |
| `lib/remotion/component-loader/folder-import.ts` | Folder-based Remotion project import |
| `lib/remotion/component-loader/indexeddb.ts` | IndexedDB persistence for imported components |
| `lib/remotion/component-loader/types.ts` | Types for load results, stored components, folder imports |
| `lib/remotion/component-loader/constants.ts` | DB name, version, store name constants |
| `lib/remotion/component-loader/index.ts` | Barrel re-exports for the subdirectory |
| `lib/remotion/component-validator.ts` | Security and correctness validation for component code |
| `lib/remotion/compositor.ts` | Frame compositing: merges QCut canvas with Remotion frames |
| `lib/remotion/dynamic-loader.ts` | Runtime loading of bundled components via blob URLs |
| `lib/remotion/export-engine-remotion.ts` | Export engine for pre-rendering and encoding Remotion elements |
| `lib/remotion/folder-validator.ts` | Client-side validation for Remotion folder imports |
| `lib/remotion/keyframe-converter.ts` | Converts QCut keyframes to Remotion `interpolate()` calls |
| `lib/remotion/player-wrapper.tsx` | Wraps `@remotion/player` for timeline/playback integration |
| `lib/remotion/pre-renderer.ts` | Renders Remotion elements to frame sequences before export |
| `lib/remotion/schema-parser.ts` | Parses Zod schemas to generate dynamic prop editor fields |
| `lib/remotion/sync-manager.ts` | Frame synchronization between QCut timeline and Remotion players |
| `components/editor/timeline/remotion-sequences.tsx` | Author metadata visualization |
| `components/editor/timeline/parsed-sequence-overlay.tsx` | Parsed analysis visualization |
| `components/editor/timeline/remotion-element.tsx` | Integration point |

## Data Flow

```
Component Import
       │
       ├─► component-loader/ (validation, persistence, folder import)
       │        ├── loader.ts → loadComponentFromCode / loadComponentFromFile
       │        ├── folder-import.ts → importFromFolder
       │        └── indexeddb.ts → IndexedDB storage
       │
       └─► sequence-analysis-service.ts
                    │
                    ▼
           sequence-parser.ts (AST extraction)
                    │
                    ▼
           remotion-store.ts
           ├── registeredComponents: Map<id, Definition>
           └── analyzedSequences: Map<id, AnalysisResult>
                    │
                    ▼
           remotion-element.tsx
           ├── if (hasAuthorMetadata) → <RemotionSequences />
           └── else if (hasParsedAnalysis) → <ParsedSequenceOverlay />
```

## Usage

### Adding Metadata to Components

```typescript
const myComponent: RemotionComponentDefinition = {
  id: "my-component",
  // ... other fields
  sequenceStructure: {
    sequences: [
      { name: "Intro", from: 0, durationInFrames: 90, color: "#8B5CF6" },
      { name: "Main", from: 90, durationInFrames: 180, color: "#3B82F6" },
    ],
    transitions: [
      { afterSequenceIndex: 0, durationInFrames: 15, presentation: "fade" },
    ],
  },
};
```

### Dynamic Values

AST parsing marks computed values (e.g., `from={index * 30}`) as `"dynamic"` and displays a `~dynamic` badge on the timeline.

## Utility Functions

```typescript
// Calculate total duration with overlaps
calculateTotalDuration(structure: SequenceStructure): number

// Get frame positions for each sequence
calculateSequencePositions(structure: SequenceStructure): SequencePosition[]

// Find sequence indices at a specific frame
getOverlappingSequences(positions: SequencePosition[], frame: number): number[]

// Find transition and overlap region at a given frame
findTransitionAtFrame(structure: SequenceStructure, positions: SequencePosition[], frame: number):
  { transition: TransitionMetadata; overlapStart: number; overlapEnd: number } | null

// Validate internal consistency of a sequence structure
validateSequenceStructure(structure: SequenceStructure): string[]

// Check for dynamic values
hasDynamicValues(parsed: ParsedStructure): boolean
```

## Tests

- `duration-calculator.test.ts` - 24 tests
- `sequence-parser.test.ts` - 26 tests
- `sequence-analysis-service.test.ts` - 17 tests
- `remotion-sequences.test.tsx` - 14 tests
- `component-loader.test.ts` - 36 tests
- `component-loader-analysis.test.ts` - 6 tests
- `component-validator.test.ts` - 59 tests
- `compositor.test.ts` - 24 tests
- `dynamic-loader.test.ts` - 11 tests
- `export-engine-remotion.test.ts` - 16 tests
- `keyframe-converter.test.ts` - 50 tests
- `player-wrapper-trim.test.ts` - 8 tests
- `pre-renderer.test.ts` - 24 tests
- `schema-parser.test.ts` - 32 tests
- `sync-manager.test.ts` - 24 tests
- `types.test.ts` - 20 tests

## Related Docs

- [Remotion Sequence](https://www.remotion.dev/docs/sequence)
- [Remotion TransitionSeries](https://www.remotion.dev/docs/transitions/transitionseries)
