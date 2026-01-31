# QCut Remotion Sequence Visualization Implementation Plan

## Overview

This document outlines the implementation plan for visualizing Remotion `<Sequence>` and `<TransitionSeries>` elements within QCut's timeline. Currently, QCut treats Remotion compositions as "black boxes" - the internal sequence structure is not visible or editable.

**Goal**: Enable users to see and understand the internal timing of sequences within Remotion compositions.

**References**:
- [Remotion Sequence Documentation](https://www.remotion.dev/docs/sequence)
- [Remotion TransitionSeries](https://www.remotion.dev/docs/transitions/transitionseries)
- [Remotion Composition](https://www.remotion.dev/docs/composition)

---

## Background: How Remotion Sequences Work

### Composition Structure

A `<Composition>` represents the video to create, containing clips (like `<Sequence>`) that play sequentially. Key props:
- `id` - Unique identifier
- `fps` - Frame rate
- `durationInFrames` - Total length in frames
- `width` / `height` - Dimensions
- `component` - The React component to render

### Sequence Props

| Prop | Type | Description |
|------|------|-------------|
| `from` | `number` | Frame at which sequence starts (default: 0) |
| `durationInFrames` | `number` | Duration in frames (optional, defaults to remaining) |
| `name` | `string` | Identifier shown in React DevTools & Remotion Studio |
| `layout` | `"absolute-fill" \| "none"` | CSS positioning behavior |
| `premountFor` | `number` | Frames to render before becoming visible |
| `postmountFor` | `number` | Frames to keep rendering after becoming invisible |

### TransitionSeries Component

`<TransitionSeries>` enables transition effects between sequences. Each transition has:
1. **Presentation**: Visual effect (`fade()`, `slide()`, `wipe()`)
2. **Timing**: Duration control (`springTiming()`, `linearTiming()`)

#### TransitionSeries.Sequence Props
Inherits from `<Sequence>`: `durationInFrames`, `name`, `className`, `style`, `premountFor`, `postmountFor`, `layout`

#### TransitionSeries.Transition Props
- `timing` (required): `TransitionTiming` object
- `presentation` (optional): Defaults to `slide()`

### Duration Calculation Formula

**Critical for visualization**: Transitions overlap with adjacent sequences.

```
Total Duration = Sum of all sequences - Sum of all transitions
```

**Examples**:
- Sequence A (40 frames) + Transition (30 frames) + Sequence B (60 frames) = **70 frames** (40+60-30)
- Three sequences (40, 60, 90 frames) with transitions (30, 45 frames) = **115 frames** (190-30-45)

### Visualization Implication

```
Without transitions:        With 30-frame transition:
┌────────┬────────────┐    ┌────────┬────────────┐
│   A    │     B      │    │   A  ▓▓▓▓  B        │  <- overlap region
└────────┴────────────┘    └────────┴────────────┘
0       40           100   0      40  70        (shorter total)
                                  ↑
                           Both render simultaneously
```

### Key Insight

The `name` prop is specifically designed for visualization:
> "The name prop is useful for debugging and is shown in React DevTools and Remotion Studio's timeline."

This means well-authored components already have human-readable sequence names we can extract.

---

## Implementation Phases

### Phase 1: Easy - Component Metadata Approach ✅ COMPLETED

**Estimated Effort**: 4-6 hours
**Complexity**: Low
**Risk**: Low
**Status**: ✅ Implemented on 2026-02-01

#### Concept

Add optional metadata to `RemotionComponentDefinition` that component authors can provide to describe their internal sequence structure.

#### Subtasks

##### 1.1 Extend Type Definitions
**File**: `apps/web/src/lib/remotion/types.ts`

Add sequence and transition metadata to the component definition:

```typescript
export interface SequenceMetadata {
  name: string;
  from: number;
  durationInFrames: number;
  color?: string;  // For timeline visualization
  description?: string;
}

export interface TransitionMetadata {
  afterSequenceIndex: number;  // Which sequence this transition follows
  durationInFrames: number;
  presentation?: "fade" | "slide" | "wipe" | "zoom" | "custom";
}

export interface SequenceStructure {
  sequences: SequenceMetadata[];
  transitions?: TransitionMetadata[];
  // Calculated total (sequences - transitions overlap)
  calculatedDuration?: number;
}

export interface RemotionComponentDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  component: React.ComponentType<any>;
  defaultProps: Record<string, unknown>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  // NEW: Optional sequence structure metadata
  sequenceStructure?: SequenceStructure;
}
```

##### 1.1b Add Duration Calculator Utility
**File**: `apps/web/src/lib/remotion/duration-calculator.ts`

```typescript
import type { SequenceStructure } from "./types";

/**
 * Calculate total duration accounting for transition overlaps.
 * Formula: Sum of sequences - Sum of transitions
 */
export function calculateTotalDuration(structure: SequenceStructure): number {
  const sequenceTotal = structure.sequences.reduce(
    (sum, seq) => sum + seq.durationInFrames,
    0
  );

  const transitionTotal = (structure.transitions || []).reduce(
    (sum, trans) => sum + trans.durationInFrames,
    0
  );

  return sequenceTotal - transitionTotal;
}

/**
 * Calculate actual start frame for each sequence considering overlaps.
 */
export function calculateSequencePositions(
  structure: SequenceStructure
): Array<{ from: number; to: number }> {
  const positions: Array<{ from: number; to: number }> = [];
  let currentFrame = 0;

  for (let i = 0; i < structure.sequences.length; i++) {
    const seq = structure.sequences[i];
    const prevTransition = structure.transitions?.find(
      (t) => t.afterSequenceIndex === i - 1
    );

    // Adjust start if there's an overlap from previous transition
    if (prevTransition) {
      currentFrame -= prevTransition.durationInFrames;
    }

    positions.push({
      from: Math.max(0, currentFrame),
      to: currentFrame + seq.durationInFrames,
    });

    currentFrame += seq.durationInFrames;
  }

  return positions;
}
```

##### 1.2 Update Built-in Components with Metadata
**Files**:
- `apps/web/src/lib/remotion/built-in/templates/*.tsx`
- `apps/web/src/lib/remotion/built-in/text/*.tsx`
- `apps/web/src/lib/remotion/built-in/transitions/*.tsx`

Add `sequenceStructure` metadata to existing built-in components.

**Example without transitions (Series):**
```typescript
export const skillsDemoDefinition: RemotionComponentDefinition = {
  id: "skills-demo",
  name: "Skills Demo",
  // ... existing props
  sequenceStructure: {
    sequences: [
      { name: "Intro", from: 0, durationInFrames: 90, color: "#8B5CF6" },
      { name: "Typewriter", from: 90, durationInFrames: 180, color: "#3B82F6" },
      { name: "Features", from: 270, durationInFrames: 150, color: "#10B981" },
      { name: "Outro", from: 420, durationInFrames: 120, color: "#F59E0B" },
    ],
    // No transitions - sequences play back-to-back
  },
};
```

**Example with transitions (TransitionSeries):**
```typescript
export const introOutroDefinition: RemotionComponentDefinition = {
  id: "intro-outro",
  name: "Intro with Outro",
  durationInFrames: 195, // 60 + 80 + 90 - 15 - 20 = 195
  // ... existing props
  sequenceStructure: {
    sequences: [
      { name: "Title", from: 0, durationInFrames: 60, color: "#8B5CF6" },
      { name: "Content", from: 45, durationInFrames: 80, color: "#3B82F6" },
      { name: "CTA", from: 105, durationInFrames: 90, color: "#10B981" },
    ],
    transitions: [
      { afterSequenceIndex: 0, durationInFrames: 15, presentation: "fade" },
      { afterSequenceIndex: 1, durationInFrames: 20, presentation: "slide" },
    ],
    calculatedDuration: 195,
  },
};
```

##### 1.3 Create Sequence Visualization Component
**File**: `apps/web/src/components/editor/timeline/remotion-sequences.tsx`

Create a component that renders nested sequence bars within a Remotion timeline element:

```typescript
import type { SequenceStructure } from "@/lib/remotion/types";
import { calculateSequencePositions } from "@/lib/remotion/duration-calculator";

interface RemotionSequencesProps {
  structure: SequenceStructure;
  totalDuration: number;
  elementWidth: number;
}

export const RemotionSequences: React.FC<RemotionSequencesProps> = ({
  structure,
  totalDuration,
  elementWidth,
}) => {
  const positions = calculateSequencePositions(structure);
  const pixelsPerFrame = elementWidth / totalDuration;

  return (
    <div className="absolute bottom-1 left-1 right-1 h-4 flex">
      {structure.sequences.map((seq, i) => {
        const pos = positions[i];
        const width = (pos.to - pos.from) * pixelsPerFrame;
        const left = pos.from * pixelsPerFrame;

        // Check if this sequence overlaps with previous (transition)
        const hasOverlap = i > 0 && pos.from < positions[i - 1].to;

        return (
          <div
            key={i}
            className="absolute h-full rounded-sm flex items-center px-1 text-[9px] text-white truncate"
            style={{
              left,
              width,
              backgroundColor: seq.color || "#666",
              // Show overlap region with gradient
              background: hasOverlap
                ? `linear-gradient(90deg, transparent 0%, ${seq.color} 20%)`
                : seq.color,
            }}
            title={`${seq.name}: ${seq.durationInFrames} frames`}
          >
            {seq.name}
          </div>
        );
      })}

      {/* Render transition indicators */}
      {structure.transitions?.map((trans, i) => {
        const afterSeq = positions[trans.afterSequenceIndex];
        const nextSeq = positions[trans.afterSequenceIndex + 1];
        if (!afterSeq || !nextSeq) return null;

        const overlapStart = nextSeq.from;
        const overlapEnd = afterSeq.to;
        const left = overlapStart * pixelsPerFrame;
        const width = (overlapEnd - overlapStart) * pixelsPerFrame;

        return (
          <div
            key={`trans-${i}`}
            className="absolute h-full border-2 border-dashed border-white/50 pointer-events-none"
            style={{ left, width }}
            title={`${trans.presentation || "slide"} transition: ${trans.durationInFrames}f`}
          />
        );
      })}
    </div>
  );
};
```

##### 1.4 Integrate with Timeline Element Rendering
**File**: `apps/web/src/components/editor/timeline/timeline-element.tsx`

Conditionally render sequence visualization when a Remotion element has sequence metadata:

```typescript
// Inside TimelineElement component for type === "remotion"
{element.type === "remotion" && componentDefinition?.sequences && (
  <RemotionSequences
    sequences={componentDefinition.sequences}
    totalDuration={element.durationInFrames}
    elementWidth={calculatedWidth}
  />
)}
```

##### 1.5 Unit Tests
**File**: `apps/web/src/components/editor/timeline/__tests__/remotion-sequences.test.tsx`

```typescript
describe("RemotionSequences", () => {
  it("renders sequence bars proportionally to duration");
  it("applies correct colors from metadata");
  it("handles sequences with gaps");
  it("handles overlapping sequences (TransitionSeries)");
  it("renders transition indicators with dashed borders");
  it("renders nothing when sequences is empty");
  it("shows tooltips with sequence name and duration");
});
```

**File**: `apps/web/src/lib/remotion/__tests__/duration-calculator.test.ts`

```typescript
describe("calculateTotalDuration", () => {
  it("returns sum of sequences when no transitions");
  it("subtracts transition durations from total");
  it("handles multiple transitions");
  it("returns 0 for empty sequences");
});

describe("calculateSequencePositions", () => {
  it("returns sequential positions without transitions");
  it("calculates overlap positions with transitions");
  it("handles first sequence starting at 0");
  it("prevents negative start positions");
});
```

**File**: `apps/web/src/lib/remotion/__tests__/types.test.ts`

```typescript
describe("SequenceMetadata", () => {
  it("validates required fields");
  it("accepts optional color and description");
});

describe("TransitionMetadata", () => {
  it("validates afterSequenceIndex is valid");
  it("validates durationInFrames is positive");
  it("accepts optional presentation type");
});
```

---

### Phase 2: Medium - AST Parsing Approach ✅ COMPLETED

**Estimated Effort**: 12-16 hours
**Complexity**: Medium
**Risk**: Medium (depends on component complexity)
**Status**: ✅ Implemented on 2026-02-01

#### Concept

Parse the component source code to automatically detect `<Sequence>` and `<TransitionSeries>` elements and extract their props.

#### Subtasks

##### 2.1 Add TypeScript/Babel Parser Dependencies
**File**: `apps/web/package.json`

```json
{
  "dependencies": {
    "@babel/parser": "^7.x",
    "@babel/traverse": "^7.x",
    "@babel/types": "^7.x"
  }
}
```

##### 2.2 Create AST Sequence Extractor
**File**: `apps/web/src/lib/remotion/sequence-parser.ts`

```typescript
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

interface ParsedSequence {
  name: string | null;
  from: number | "dynamic";
  durationInFrames: number | "dynamic";
  line: number;
  isTransitionSequence: boolean;
}

interface ParsedTransition {
  durationInFrames: number | "dynamic";
  presentation: string | null;
  afterSequenceIndex: number;
  line: number;
}

interface ParsedStructure {
  sequences: ParsedSequence[];
  transitions: ParsedTransition[];
  usesTransitionSeries: boolean;
}

export function extractSequencesFromSource(sourceCode: string): ParsedStructure {
  const ast = parse(sourceCode, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });

  const result: ParsedStructure = {
    sequences: [],
    transitions: [],
    usesTransitionSeries: false,
  };

  let sequenceIndex = 0;

  traverse(ast, {
    JSXElement(path) {
      const elementName = getElementName(path.node.openingElement.name);

      // Detect TransitionSeries container
      if (elementName === "TransitionSeries") {
        result.usesTransitionSeries = true;
      }

      // Detect sequences
      if (isSequenceElement(elementName)) {
        result.sequences.push({
          ...extractSequenceProps(path.node),
          isTransitionSequence: elementName.includes("TransitionSeries") ||
                                elementName.startsWith("TS."),
        });
        sequenceIndex++;
      }

      // Detect transitions
      if (isTransitionElement(elementName)) {
        result.transitions.push({
          ...extractTransitionProps(path.node),
          afterSequenceIndex: sequenceIndex - 1,
        });
      }
    },
  });

  return result;
}

function getElementName(name: any): string {
  if (t.isJSXIdentifier(name)) {
    return name.name;
  }
  if (t.isJSXMemberExpression(name)) {
    // Handle: TransitionSeries.Sequence, TS.Sequence
    const object = t.isJSXIdentifier(name.object) ? name.object.name : "";
    const property = t.isJSXIdentifier(name.property) ? name.property.name : "";
    return `${object}.${property}`;
  }
  return "";
}

function isSequenceElement(name: string): boolean {
  return [
    "Sequence",
    "TransitionSeries.Sequence",
    "TS.Sequence",
  ].includes(name);
}

function isTransitionElement(name: string): boolean {
  return [
    "TransitionSeries.Transition",
    "TS.Transition",
  ].includes(name);
}

function extractSequenceProps(node: any): Omit<ParsedSequence, "isTransitionSequence"> {
  const props = extractJSXProps(node.openingElement.attributes);
  return {
    name: props.name ?? null,
    from: props.from ?? 0,
    durationInFrames: props.durationInFrames ?? "dynamic",
    line: node.loc?.start.line ?? 0,
  };
}

function extractTransitionProps(node: any): Omit<ParsedTransition, "afterSequenceIndex"> {
  const props = extractJSXProps(node.openingElement.attributes);
  return {
    durationInFrames: extractTimingDuration(props.timing) ?? "dynamic",
    presentation: extractPresentationName(props.presentation),
    line: node.loc?.start.line ?? 0,
  };
}

function extractJSXProps(attributes: any[]): Record<string, any> {
  const props: Record<string, any> = {};
  for (const attr of attributes) {
    if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
      const name = attr.name.name;
      const value = attr.value;

      if (t.isStringLiteral(value)) {
        props[name] = value.value;
      } else if (t.isJSXExpressionContainer(value)) {
        const expr = value.expression;
        if (t.isNumericLiteral(expr)) {
          props[name] = expr.value;
        } else {
          props[name] = "dynamic";
        }
      }
    }
  }
  return props;
}

function extractTimingDuration(timing: any): number | null {
  // Best-effort extraction from timing function calls
  // e.g., springTiming({ durationInFrames: 30 })
  // Returns null if dynamic
  return null;
}

function extractPresentationName(presentation: any): string | null {
  // Extract from: fade(), slide(), wipe(), etc.
  return null;
}
```

##### 2.3 Handle Dynamic Values
**File**: `apps/web/src/lib/remotion/sequence-parser.ts`

Some sequence props are computed at runtime:
```tsx
<Sequence from={index * 30} durationInFrames={duration}>
```

Strategy:
- Mark dynamic values as `"dynamic"`
- Provide best-effort extraction for literal values
- Show "computed" indicator in UI for dynamic sequences

##### 2.4 Create Parsing Service
**File**: `apps/web/src/lib/remotion/sequence-analysis-service.ts`

```typescript
export class SequenceAnalysisService {
  private cache: Map<string, ParsedSequence[]> = new Map();

  async analyzeComponent(
    componentId: string,
    sourceCode: string
  ): Promise<ParsedSequence[]> {
    if (this.cache.has(componentId)) {
      return this.cache.get(componentId)!;
    }

    const sequences = extractSequencesFromSource(sourceCode);
    this.cache.set(componentId, sequences);
    return sequences;
  }

  invalidateCache(componentId: string): void {
    this.cache.delete(componentId);
  }
}
```

##### 2.5 Add Source Code Storage for Custom Components
**File**: `apps/web/src/lib/remotion/component-loader.ts`

When importing custom `.tsx` files, store the source code for later analysis:

```typescript
export async function loadCustomComponent(file: File): Promise<{
  component: React.ComponentType<any>;
  sourceCode: string;
  definition: RemotionComponentDefinition;
}> {
  const sourceCode = await file.text();
  // ... existing component loading logic
  return { component, sourceCode, definition };
}
```

##### 2.6 Integrate Parsed Sequences with Timeline
**File**: `apps/web/src/stores/remotion-store.ts`

Add state for storing analyzed sequences:

```typescript
interface RemotionStore {
  // ... existing state
  analyzedSequences: Map<string, ParsedSequence[]>;
  analyzeComponent: (id: string, source: string) => Promise<void>;
}
```

##### 2.7 Create Dynamic Sequence Visualization
**File**: `apps/web/src/components/editor/timeline/parsed-sequence-overlay.tsx`

Render parsed sequences with indicators for dynamic vs static values:

```typescript
interface ParsedSequenceOverlayProps {
  sequences: ParsedSequence[];
  fps: number;
  elementWidth: number;
}

export const ParsedSequenceOverlay: React.FC<ParsedSequenceOverlayProps> = ({
  sequences,
  fps,
  elementWidth,
}) => {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {sequences.map((seq, i) => (
        <SequenceBar
          key={i}
          sequence={seq}
          isDynamic={seq.from === "dynamic" || seq.durationInFrames === "dynamic"}
        />
      ))}
    </div>
  );
};
```

##### 2.8 Unit Tests
**File**: `apps/web/src/lib/remotion/__tests__/sequence-parser.test.ts`

```typescript
describe("extractSequencesFromSource", () => {
  describe("Sequence detection", () => {
    it("extracts basic <Sequence> elements");
    it("extracts <TransitionSeries.Sequence> elements");
    it("extracts <TS.Sequence> shorthand");
    it("handles literal number props (from, durationInFrames)");
    it("marks expression props as 'dynamic'");
    it("extracts name prop when present");
    it("handles nested sequences");
    it("handles sequences in .map() loops");
    it("returns empty array for components without sequences");
  });

  describe("Transition detection", () => {
    it("extracts <TransitionSeries.Transition> elements");
    it("extracts <TS.Transition> shorthand");
    it("associates transitions with correct sequence index");
    it("detects presentation type (fade, slide, wipe)");
    it("marks timing duration as dynamic when using springTiming()");
    it("extracts literal durationInFrames from linearTiming()");
  });

  describe("TransitionSeries detection", () => {
    it("sets usesTransitionSeries=true when container found");
    it("correctly orders sequences and transitions");
  });
});
```

**File**: `apps/web/src/lib/remotion/__tests__/sequence-analysis-service.test.ts`

```typescript
describe("SequenceAnalysisService", () => {
  it("caches analysis results by componentId");
  it("returns cached result on subsequent calls");
  it("invalidates cache on request");
  it("handles parsing errors gracefully");
  it("handles empty source code");
  it("handles malformed JSX");
});
```

---

## UI/UX Considerations

### Sequence Visualization Display

**Series (no transitions):**
```
┌─────────────────────────────────────────────────────────┐
│ SkillsDemo                                              │
│ ┌─────────┬──────────────┬───────────┬────────────┐    │
│ │  Intro  │  Typewriter  │ Features  │   Outro    │    │
│ │  90f    │    180f      │   150f    │    120f    │    │
│ └─────────┴──────────────┴───────────┴────────────┘    │
└─────────────────────────────────────────────────────────┘
Total: 540 frames (90+180+150+120)
```

**TransitionSeries (with overlaps):**
```
┌─────────────────────────────────────────────────────────┐
│ IntroOutro (uses TransitionSeries)                      │
│                                                         │
│ ┌────────┐                                              │
│ │ Title  ├──┐   ┌─────────┐                            │
│ │  60f   │▒▒├───┤ Content ├──┐   ┌──────────┐         │
│ └────────┴──┘   │   80f   │▒▒├───┤   CTA    │         │
│            ↑    └─────────┴──┘   │   90f    │         │
│         15f fade           ↑     └──────────┘         │
│                        20f slide                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
Total: 195 frames (60+80+90-15-20)

▒▒ = Overlap region where both sequences render
```

### Visual Indicators

| Element | Style | Description |
|---------|-------|-------------|
| Sequence bar | Solid color | Normal sequence with fixed timing |
| Dynamic sequence | Dashed border | `from` or `durationInFrames` is computed |
| Transition overlap | Gradient + dashed outline | Where two sequences overlap |
| Transition badge | Small icon (fade/slide/wipe) | Shows transition type |

### Interaction Features
- **Hover**: Show tooltip with sequence name, duration, and frame range
- **Click**: Jump playhead to sequence start
- **Transition hover**: Show transition type and duration
- **Expand/collapse**: Toggle sequence bar visibility

---

## File Summary

### Phase 1 Files (Easy) - ✅ COMPLETED
| File | Action | Status | Purpose |
|------|--------|--------|---------|
| `apps/web/src/lib/remotion/types.ts` | Modify | ✅ Done | Add SequenceMetadata, TransitionMetadata, SequenceStructure types |
| `apps/web/src/lib/remotion/duration-calculator.ts` | Create | ✅ Done | Duration calculation with transition overlap handling |
| `apps/web/src/lib/remotion/built-in/**/*.tsx` | Modify | ⏳ Pending | Add sequenceStructure metadata to built-in components |
| `apps/web/src/components/editor/timeline/remotion-sequences.tsx` | Create | ✅ Done | Sequence bar visualization component |
| `apps/web/src/components/editor/timeline/remotion-element.tsx` | Modify | ✅ Done | Integrate RemotionSequences for remotion elements |
| `apps/web/src/components/editor/timeline/__tests__/remotion-sequences.test.tsx` | Create | ✅ Done (14 tests) | Component tests |
| `apps/web/src/lib/remotion/__tests__/duration-calculator.test.ts` | Create | ✅ Done (24 tests) | Duration calculation tests |
| `apps/web/src/lib/remotion/__tests__/types.test.ts` | Existing | N/A | Type validation tests (already existed) |

### Phase 2 Files (Medium) - ✅ COMPLETED
| File | Action | Status | Purpose |
|------|--------|--------|---------|
| `apps/web/package.json` | Modify | ✅ Done | Add @babel/parser, @babel/traverse, @babel/types |
| `apps/web/src/lib/remotion/sequence-parser.ts` | Create | ✅ Done | AST-based sequence/transition extraction |
| `apps/web/src/lib/remotion/sequence-analysis-service.ts` | Create | ✅ Done | Caching service for parsed results |
| `apps/web/src/lib/remotion/component-loader.ts` | Modify | ⏳ Pending | Store source code for custom components |
| `apps/web/src/stores/remotion-store.ts` | Modify | ⏳ Pending | Add analyzedSequences state |
| `apps/web/src/components/editor/timeline/parsed-sequence-overlay.tsx` | Create | ✅ Done | Render parsed sequences with dynamic indicators |
| `apps/web/src/lib/remotion/__tests__/sequence-parser.test.ts` | Create | ✅ Done (26 tests) | Comprehensive AST parsing tests |
| `apps/web/src/lib/remotion/__tests__/sequence-analysis-service.test.ts` | Create | ✅ Done (17 tests) | Service caching tests |

---

## Long-term Maintainability

### Phase 1 Advantages
- **Simple**: No external dependencies for parsing
- **Reliable**: Author-provided metadata is always accurate
- **Fast**: No runtime parsing overhead
- **Backwards compatible**: Works without breaking existing components

### Phase 2 Advantages
- **Automatic**: No manual metadata maintenance
- **Works with any component**: Including third-party and user imports
- **Keeps in sync**: Always reflects actual component structure

### Recommended Approach

1. **Start with Phase 1** - provides immediate value with low risk
2. **Add Phase 2 as enhancement** - auto-detection for components without metadata
3. **Prefer metadata when available** - author-provided metadata takes precedence over parsed

### Future Considerations

- **Phase 3 (Hard)**: Runtime introspection using React DevTools protocol
- **Sequence editing**: Allow users to adjust timing from QCut (requires component regeneration)
- **Visual diff**: Show changes when component source is updated

---

## Related Documentation

### Remotion Official Docs
- [Remotion Sequence](https://www.remotion.dev/docs/sequence) - Core sequence component
- [Remotion TransitionSeries](https://www.remotion.dev/docs/transitions/transitionseries) - Transition container
- [Remotion Composition](https://www.remotion.dev/docs/composition) - Composition structure
- [Spring Timing](https://www.remotion.dev/docs/transitions/timings/springtiming) - Spring-based transitions
- [Presentations](https://www.remotion.dev/docs/transitions/presentations) - Visual effects (fade, slide, wipe)

### QCut Internal Docs
- [QCut Remotion Timeline Rendering](../technical/remotion-timeline-rendering.md) - Current integration status
- [QCut Architecture](../../CLAUDE.md) - Project structure and patterns

---

## Implementation Notes (Phase 1)

### Completed: 2026-02-01

#### Files Created
1. **`apps/web/src/lib/remotion/duration-calculator.ts`**
   - `calculateTotalDuration()` - Calculates total duration with transition overlap
   - `calculateSequencePositions()` - Returns frame positions for each sequence
   - `getOverlappingSequences()` - Finds sequences at a given frame
   - `findTransitionAtFrame()` - Finds transition at a given frame
   - `validateSequenceStructure()` - Validates structure consistency

2. **`apps/web/src/components/editor/timeline/remotion-sequences.tsx`**
   - `RemotionSequences` - Main visualization component
   - `SequenceBar` - Individual sequence bar with color and name
   - `TransitionIndicator` - Dashed border for transition overlaps
   - Default color palette for sequences without explicit colors

3. **`apps/web/src/lib/remotion/__tests__/duration-calculator.test.ts`** (24 tests)
   - Tests for all duration calculation functions
   - Edge cases: empty sequences, negative positions, validation

4. **`apps/web/src/components/editor/timeline/__tests__/remotion-sequences.test.tsx`** (14 tests)
   - Component rendering tests
   - Transition overlay tests
   - Edge cases: narrow widths, many sequences

#### Files Modified
1. **`apps/web/src/lib/remotion/types.ts`**
   - Added `SequenceMetadata` interface
   - Added `TransitionMetadata` interface
   - Added `SequenceStructure` interface
   - Extended `RemotionComponentDefinition` with `sequenceStructure` field

2. **`apps/web/src/components/editor/timeline/remotion-element.tsx`**
   - Imported `RemotionSequences` component
   - Imported `calculateTotalDuration` utility
   - Added `hasSequenceStructure` check
   - Renders `RemotionSequences` when metadata is available

#### Usage
To enable sequence visualization for a Remotion component, add `sequenceStructure` to its definition:

```typescript
const myComponent: RemotionComponentDefinition = {
  id: "my-component",
  // ... other fields
  sequenceStructure: {
    sequences: [
      { name: "Intro", from: 0, durationInFrames: 90, color: "#8B5CF6" },
      { name: "Main", from: 90, durationInFrames: 180, color: "#3B82F6" },
    ],
    // Optional: for TransitionSeries
    transitions: [
      { afterSequenceIndex: 0, durationInFrames: 15, presentation: "fade" },
    ],
  },
};
```

#### Next Steps
1. Add `sequenceStructure` metadata to built-in components
2. ~~Consider Phase 2 (AST parsing) for automatic sequence detection~~ ✅ Done

---

## Implementation Notes (Phase 2)

### Completed: 2026-02-01

#### Files Created
1. **`apps/web/src/lib/remotion/sequence-parser.ts`**
   - `extractSequencesFromSource()` - Main AST parsing function
   - `toSequenceStructure()` - Converts parsed structure to visualization format
   - `hasDynamicValues()` - Checks if any values are computed at runtime
   - Handles `<Sequence>`, `<TransitionSeries.Sequence>`, `<TS.Sequence>` patterns
   - Detects transitions: `<TransitionSeries.Transition>`, `<TS.Transition>`
   - Extracts `linearTiming()` duration and presentation names (fade, slide, wipe)
   - Marks dynamic values (variables, expressions) as `"dynamic"`

2. **`apps/web/src/lib/remotion/sequence-analysis-service.ts`**
   - `SequenceAnalysisService` class with LRU caching
   - `analyzeComponent()` - Analyzes source code and caches result
   - `getCached()` - Returns cached result if available
   - `invalidateCache()` - Invalidates cache for a component
   - `clearCache()` - Clears entire cache
   - `getCacheStats()` - Returns cache statistics
   - Singleton instance via `getSequenceAnalysisService()`

3. **`apps/web/src/components/editor/timeline/parsed-sequence-overlay.tsx`**
   - `ParsedSequenceOverlay` - Visualizes auto-detected sequences
   - `SequenceBar` - Individual sequence bar with dynamic indicator
   - `DynamicBadge` - Shows tilde (~) for components with dynamic values
   - Dashed borders for sequences with dynamic timing
   - Default color palette for sequence visualization

4. **`apps/web/src/lib/remotion/__tests__/sequence-parser.test.ts`** (26 tests)
   - Sequence detection tests (9 tests)
   - Transition detection tests (6 tests)
   - TransitionSeries detection tests (2 tests)
   - Error handling tests (3 tests)
   - `toSequenceStructure` tests (3 tests)
   - `hasDynamicValues` tests (3 tests)

5. **`apps/web/src/lib/remotion/__tests__/sequence-analysis-service.test.ts`** (17 tests)
   - analyzeComponent tests (3 tests)
   - Caching tests (4 tests)
   - Cache management tests (3 tests)
   - Error handling tests (3 tests)
   - hasAnalysis tests (2 tests)
   - Singleton instance tests (2 tests)

#### Dependencies Added
- `@babel/parser` - JavaScript/TypeScript AST parser
- `@babel/traverse` - AST traversal utilities
- `@babel/types` - AST node type definitions

#### Key Features
- **AST-based extraction**: Uses Babel to parse JSX and extract sequence props
- **Dynamic value detection**: Marks computed values as `"dynamic"`
- **TransitionSeries support**: Handles both `TransitionSeries.Sequence` and `TS.Sequence`
- **Timing extraction**: Extracts `durationInFrames` from `linearTiming()` calls
- **Presentation detection**: Identifies `fade()`, `slide()`, `wipe()` transitions
- **LRU caching**: Prevents re-parsing with source hash validation
- **Error recovery**: Handles malformed JSX gracefully

#### Usage Example
```typescript
import { extractSequencesFromSource, toSequenceStructure } from "@/lib/remotion/sequence-parser";
import { getSequenceAnalysisService } from "@/lib/remotion/sequence-analysis-service";

// Direct parsing
const source = `
  <TransitionSeries>
    <TS.Sequence durationInFrames={60} name="Intro">
      <IntroScene />
    </TS.Sequence>
    <TS.Transition timing={linearTiming({ durationInFrames: 15 })} presentation={fade()} />
    <TS.Sequence durationInFrames={90} name="Main">
      <MainScene />
    </TS.Sequence>
  </TransitionSeries>
`;

const parsed = extractSequencesFromSource(source);
// parsed.sequences = [{ name: "Intro", durationInFrames: 60, ... }, { name: "Main", durationInFrames: 90, ... }]
// parsed.transitions = [{ durationInFrames: 15, presentation: "fade", afterSequenceIndex: 0 }]
// parsed.usesTransitionSeries = true

// Using the service (with caching)
const service = getSequenceAnalysisService();
const result = await service.analyzeComponent("my-component", source);
// result.structure contains the visualization-ready format
```

#### Remaining Integration Steps
1. Integrate `ParsedSequenceOverlay` into `remotion-element.tsx`
2. Add source code storage in `component-loader.ts`
3. Add `analyzedSequences` state to `remotion-store.ts`
4. Wire up analysis when custom components are imported
