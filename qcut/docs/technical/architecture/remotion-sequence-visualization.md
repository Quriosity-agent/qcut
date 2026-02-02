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
}

interface TransitionMetadata {
  afterSequenceIndex: number;
  durationInFrames: number;
  presentation?: "fade" | "slide" | "wipe" | "zoom";
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
| `lib/remotion/types.ts` | Type definitions |
| `lib/remotion/duration-calculator.ts` | Duration/position calculations |
| `lib/remotion/sequence-parser.ts` | AST extraction from source |
| `lib/remotion/sequence-analysis-service.ts` | LRU caching service |
| `components/editor/timeline/remotion-sequences.tsx` | Author metadata visualization |
| `components/editor/timeline/parsed-sequence-overlay.tsx` | Parsed analysis visualization |
| `components/editor/timeline/remotion-element.tsx` | Integration point |

## Data Flow

```
Component Import
       │
       ├─► component-loader.ts (validation)
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
calculateSequencePositions(structure: SequenceStructure): Array<{from, to}>

// Find sequences at a specific frame
getOverlappingSequences(structure, frame): SequenceMetadata[]

// Check for dynamic values
hasDynamicValues(parsed: ParsedStructure): boolean
```

## Tests

- `duration-calculator.test.ts` - 24 tests
- `remotion-sequences.test.tsx` - 14 tests
- `sequence-parser.test.ts` - 26 tests
- `sequence-analysis-service.test.ts` - 17 tests

## Related Docs

- [Remotion Sequence](https://www.remotion.dev/docs/sequence)
- [Remotion TransitionSeries](https://www.remotion.dev/docs/transitions/transitionseries)
