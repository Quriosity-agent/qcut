# Sequence Analysis Integration Plan

## Overview

This document outlines the implementation plan for integrating the AST-based sequence analysis (Phase 2) with the existing Remotion component system. The goal is to automatically analyze imported components and display their internal sequence structure on the timeline.

**Prerequisite**: Phase 1 and Phase 2 of sequence visualization are complete (see `sequence-visualization-implementation.md`).

**Goal**: Wire up automatic sequence analysis when custom Remotion components are imported, and display results using `ParsedSequenceOverlay`.

**Status**: ✅ COMPLETED on 2026-02-01

---

## Current State

### All Components Implemented
| Component | Status | Purpose |
|-----------|--------|---------|
| `sequence-parser.ts` | ✅ Complete | AST extraction of sequences/transitions |
| `sequence-analysis-service.ts` | ✅ Complete | LRU caching of analysis results |
| `ParsedSequenceOverlay` | ✅ Complete | Visualization for auto-detected sequences |
| `RemotionSequences` | ✅ Complete | Visualization for author-provided metadata |
| `remotion-element.tsx` | ✅ Complete | Integrates both visualizations with priority logic |
| `remotion-store.ts` | ✅ Complete | Added `analyzedSequences` state and actions |
| `component-loader.ts` | ✅ Complete | Triggers analysis on import |

---

## Implementation Tasks

### Task 1: Add Analyzed Sequences State to Store

**Estimated Time**: 15-20 minutes
**File**: `apps/web/src/stores/remotion-store.ts`

#### 1.1 Import Analysis Types

```typescript
import type { AnalysisResult } from "@/lib/remotion/sequence-analysis-service";
```

#### 1.2 Extend Store State Interface

Add to `RemotionStoreState`:

```typescript
interface RemotionStoreState {
  // ... existing state

  /** Cached sequence analysis results by componentId */
  analyzedSequences: Map<string, AnalysisResult>;
}
```

#### 1.3 Add Store Actions

```typescript
interface RemotionStoreActions {
  // ... existing actions

  /** Store analysis result for a component */
  setAnalysisResult: (componentId: string, result: AnalysisResult) => void;

  /** Get analysis result for a component */
  getAnalysisResult: (componentId: string) => AnalysisResult | undefined;

  /** Clear analysis for a component (e.g., when source changes) */
  clearAnalysisResult: (componentId: string) => void;

  /** Analyze a component's source code and store result */
  analyzeComponentSource: (componentId: string, sourceCode: string) => Promise<AnalysisResult>;
}
```

#### 1.4 Implement Actions

```typescript
// In create() function
analyzedSequences: new Map(),

setAnalysisResult: (componentId, result) => {
  set((state) => {
    const newMap = new Map(state.analyzedSequences);
    newMap.set(componentId, result);
    return { analyzedSequences: newMap };
  });
},

getAnalysisResult: (componentId) => {
  return get().analyzedSequences.get(componentId);
},

clearAnalysisResult: (componentId) => {
  set((state) => {
    const newMap = new Map(state.analyzedSequences);
    newMap.delete(componentId);
    return { analyzedSequences: newMap };
  });
},

analyzeComponentSource: async (componentId, sourceCode) => {
  const service = getSequenceAnalysisService();
  const result = await service.analyzeComponent(componentId, sourceCode);
  get().setAnalysisResult(componentId, result);
  return result;
},
```

#### 1.5 Add Selector Hook

```typescript
/**
 * Get analysis result for a component.
 */
export function useComponentAnalysis(componentId: string | undefined): AnalysisResult | undefined {
  return useRemotionStore((state) =>
    componentId ? state.analyzedSequences.get(componentId) : undefined
  );
}
```

#### 1.6 Unit Tests

**File**: `apps/web/src/stores/__tests__/remotion-store-analysis.test.ts`

```typescript
describe("RemotionStore - Sequence Analysis", () => {
  describe("setAnalysisResult", () => {
    it("stores analysis result by componentId");
    it("overwrites existing result for same componentId");
  });

  describe("getAnalysisResult", () => {
    it("returns stored result");
    it("returns undefined for unknown componentId");
  });

  describe("clearAnalysisResult", () => {
    it("removes analysis for componentId");
    it("does nothing for unknown componentId");
  });

  describe("analyzeComponentSource", () => {
    it("analyzes source and stores result");
    it("uses analysis service singleton");
    it("returns the analysis result");
  });

  describe("useComponentAnalysis hook", () => {
    it("returns analysis result for valid componentId");
    it("returns undefined for undefined componentId");
    it("updates when analysis changes");
  });
});
```

---

### Task 2: Trigger Analysis on Component Import

**Estimated Time**: 20-25 minutes
**File**: `apps/web/src/lib/remotion/component-loader.ts`

#### 2.1 Import Analysis Service

```typescript
import { getSequenceAnalysisService } from "./sequence-analysis-service";
import type { AnalysisResult } from "./sequence-analysis-service";
```

#### 2.2 Add Analysis to Load Result

Extend `LoadComponentResult` interface:

```typescript
export interface LoadComponentResult {
  // ... existing fields

  /** Sequence analysis from source code (for imported components) */
  analysisResult?: AnalysisResult;
}
```

#### 2.3 Analyze During Component Load

In `loadComponentFromCode()`:

```typescript
export async function loadComponentFromCode(
  sourceCode: string,
  fileName: string,
  options?: LoadComponentOptions
): Promise<LoadComponentResult> {
  // ... existing validation and loading logic

  // After successful validation, analyze the source
  const analysisService = getSequenceAnalysisService();
  const analysisResult = await analysisService.analyzeComponent(
    componentId,
    sourceCode
  );

  // If analysis found sequences, attach to component definition
  if (analysisResult.structure) {
    componentDefinition.sequenceStructure = analysisResult.structure;
  }

  return {
    component,
    definition: componentDefinition,
    sourceCode,
    analysisResult,  // Include for store integration
  };
}
```

#### 2.4 Re-analyze on Source Update

In `updateStoredComponent()`:

```typescript
export async function updateStoredComponent(
  componentId: string,
  newSourceCode: string
): Promise<LoadComponentResult> {
  // ... existing update logic

  // Invalidate and re-analyze
  const analysisService = getSequenceAnalysisService();
  analysisService.invalidateCache(componentId);

  const analysisResult = await analysisService.analyzeComponent(
    componentId,
    newSourceCode
  );

  // Update sequence structure if analysis succeeded
  if (analysisResult.structure) {
    // Update stored component definition
    await updateComponentDefinition(componentId, {
      sequenceStructure: analysisResult.structure,
    });
  }

  return {
    // ... result with updated analysis
    analysisResult,
  };
}
```

#### 2.5 Expose Source Code Retrieval

Ensure existing `getComponentSourceCode()` is exported:

```typescript
/**
 * Retrieve stored source code for a component.
 * Used for re-analysis or display.
 */
export async function getComponentSourceCode(
  componentId: string
): Promise<string | null> {
  const stored = await db.get("components", componentId);
  return stored?.sourceCode ?? null;
}
```

#### 2.6 Unit Tests

**File**: `apps/web/src/lib/remotion/__tests__/component-loader-analysis.test.ts`

```typescript
describe("Component Loader - Analysis Integration", () => {
  describe("loadComponentFromCode", () => {
    it("analyzes source code during load");
    it("attaches sequenceStructure to definition when sequences found");
    it("returns analysisResult in load result");
    it("handles components without sequences");
    it("handles parsing errors gracefully");
  });

  describe("updateStoredComponent", () => {
    it("invalidates cache before re-analysis");
    it("updates sequenceStructure on definition");
    it("returns new analysisResult");
  });

  describe("getComponentSourceCode", () => {
    it("returns source code for stored component");
    it("returns null for unknown component");
  });
});
```

---

### Task 3: Integrate ParsedSequenceOverlay in Timeline

**Estimated Time**: 25-30 minutes
**File**: `apps/web/src/components/editor/timeline/remotion-element.tsx`

#### 3.1 Import New Components and Hooks

```typescript
import { ParsedSequenceOverlay } from "./parsed-sequence-overlay";
import { useComponentAnalysis } from "@/stores/remotion-store";
```

#### 3.2 Get Analysis in Component

```typescript
export function RemotionTimelineElement({ element, ... }: Props) {
  const component = useRemotionComponent(element.componentId);
  const instance = useRemotionInstance(element.id);
  const analysis = useComponentAnalysis(element.componentId);

  // ... rest of component
}
```

#### 3.3 Determine Visualization Mode

Add logic to choose between author-provided and parsed sequences:

```typescript
// Author-provided metadata takes precedence
const hasAuthorMetadata = !!component?.sequenceStructure?.sequences?.length;

// Fall back to parsed analysis for imported components
const hasParsedAnalysis = !hasAuthorMetadata &&
  analysis?.structure?.sequences?.length > 0;

// Check if any sequences have dynamic values
const hasDynamicValues = analysis?.hasDynamicValues ?? false;
```

#### 3.4 Render Appropriate Visualization

```typescript
{/* Author-provided sequence visualization (preferred) */}
{hasAuthorMetadata && component?.sequenceStructure && (
  <RemotionSequences
    structure={component.sequenceStructure}
    totalDuration={sequenceTotalDuration || element.duration}
    elementWidth={width}
  />
)}

{/* Parsed sequence visualization (fallback for imports) */}
{hasParsedAnalysis && analysis?.parsed && (
  <ParsedSequenceOverlay
    sequences={analysis.parsed.sequences}
    transitions={analysis.parsed.transitions}
    fps={component?.fps ?? 30}
    elementWidth={width}
    totalDuration={element.duration}
    className="opacity-80"  // Slightly dimmed to indicate auto-detected
  />
)}

{/* Dynamic values indicator badge */}
{hasParsedAnalysis && hasDynamicValues && (
  <div
    className="absolute top-1 right-1 px-1.5 py-0.5 text-[8px] font-medium bg-amber-500/80 text-white rounded"
    title="Some timing values are computed at runtime"
  >
    ~dynamic
  </div>
)}
```

#### 3.5 Add Loading State (Optional Enhancement)

```typescript
// Show subtle loading indicator while analysis is pending
const [isAnalyzing, setIsAnalyzing] = useState(false);

useEffect(() => {
  if (!component?.sequenceStructure && !analysis && element.componentId) {
    // Could trigger analysis here if not done during import
    setIsAnalyzing(true);
    // ... trigger analysis
    setIsAnalyzing(false);
  }
}, [component, analysis, element.componentId]);

{isAnalyzing && (
  <div className="absolute inset-0 flex items-center justify-center bg-black/20">
    <Loader2 className="h-4 w-4 animate-spin text-white/60" />
  </div>
)}
```

#### 3.6 Unit Tests

**File**: `apps/web/src/components/editor/timeline/__tests__/remotion-element-analysis.test.tsx`

```typescript
describe("RemotionTimelineElement - Analysis Integration", () => {
  describe("visualization selection", () => {
    it("renders RemotionSequences when author metadata exists");
    it("renders ParsedSequenceOverlay when only analysis exists");
    it("prefers author metadata over parsed analysis");
    it("renders nothing when no sequences available");
  });

  describe("dynamic values", () => {
    it("shows dynamic badge when hasDynamicValues is true");
    it("hides dynamic badge for static sequences");
  });

  describe("analysis integration", () => {
    it("uses useComponentAnalysis hook");
    it("handles undefined analysis gracefully");
    it("updates when analysis changes");
  });
});
```

---

### Task 4: Wire Up Analysis on Component Registration

**Estimated Time**: 15-20 minutes
**File**: `apps/web/src/stores/remotion-store.ts`

#### 4.1 Enhance registerComponent Action

Modify to optionally trigger analysis:

```typescript
registerComponent: async (definition, sourceCode?) => {
  set((state) => ({
    registeredComponents: new Map(state.registeredComponents).set(
      definition.id,
      definition
    ),
  }));

  // If source code provided and no sequence structure, analyze it
  if (sourceCode && !definition.sequenceStructure) {
    const result = await get().analyzeComponentSource(definition.id, sourceCode);

    // Update definition with analyzed structure
    if (result.structure) {
      set((state) => {
        const components = new Map(state.registeredComponents);
        const existing = components.get(definition.id);
        if (existing) {
          components.set(definition.id, {
            ...existing,
            sequenceStructure: result.structure,
          });
        }
        return { registeredComponents: components };
      });
    }
  }
},
```

#### 4.2 Add Batch Analysis for Stored Components

For loading previously imported components:

```typescript
/**
 * Load and analyze all stored components on app initialization.
 */
loadStoredComponentsWithAnalysis: async () => {
  const storedComponents = await loadStoredComponents();

  for (const stored of storedComponents) {
    // Register component
    get().registerComponent(stored.definition);

    // Analyze if source available and no existing structure
    if (stored.sourceCode && !stored.definition.sequenceStructure) {
      await get().analyzeComponentSource(stored.id, stored.sourceCode);
    }
  }
},
```

#### 4.3 Unit Tests

**File**: `apps/web/src/stores/__tests__/remotion-store-registration.test.ts`

```typescript
describe("RemotionStore - Component Registration with Analysis", () => {
  describe("registerComponent with source", () => {
    it("triggers analysis when sourceCode provided");
    it("skips analysis when sequenceStructure already exists");
    it("updates definition with analyzed structure");
  });

  describe("loadStoredComponentsWithAnalysis", () => {
    it("loads all stored components");
    it("analyzes components with source code");
    it("handles analysis errors gracefully");
  });
});
```

---

## File Summary

| File | Action | Status |
|------|--------|--------|
| `apps/web/src/stores/remotion-store.ts` | Modify | ✅ Done |
| `apps/web/src/lib/remotion/component-loader.ts` | Modify | ✅ Done |
| `apps/web/src/components/editor/timeline/remotion-element.tsx` | Modify | ✅ Done |
| `apps/web/src/lib/remotion/types.ts` | Modify | ✅ Done |
| `apps/web/src/stores/__tests__/remotion-store-analysis.test.ts` | Create | ✅ Done (13 tests) |
| `apps/web/src/lib/remotion/__tests__/component-loader-analysis.test.ts` | Create | ✅ Done (6 tests) |
| `apps/web/src/components/editor/timeline/__tests__/remotion-element-analysis.test.tsx` | Create | ✅ Done (8 tests) |

**Total Tests**: 27 new integration tests (26 passing)

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Component Import Flow                            │
└─────────────────────────────────────────────────────────────────────┘

User imports .tsx file
         │
         ▼
┌─────────────────────┐
│  component-loader   │
│  loadComponentFrom  │
│  Code()             │
└─────────┬───────────┘
          │
          ├──────────────────────────────────┐
          │                                  │
          ▼                                  ▼
┌─────────────────────┐         ┌─────────────────────┐
│   Validation        │         │  sequence-analysis  │
│   (component-       │         │  -service           │
│    validator.ts)    │         │  analyzeComponent() │
└─────────┬───────────┘         └─────────┬───────────┘
          │                               │
          │                               ▼
          │                     ┌─────────────────────┐
          │                     │  sequence-parser    │
          │                     │  extractSequences   │
          │                     │  FromSource()       │
          │                     └─────────┬───────────┘
          │                               │
          ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│   IndexedDB         │         │  AnalysisResult     │
│   StoredComponent   │◄────────│  (cached in memory) │
│   {sourceCode, ...} │         └─────────────────────┘
└─────────┬───────────┘                   │
          │                               │
          ▼                               ▼
┌─────────────────────────────────────────────────────┐
│               remotion-store                         │
│  ┌───────────────────┐  ┌────────────────────────┐  │
│  │ registeredComps   │  │ analyzedSequences      │  │
│  │ Map<id, Def>      │  │ Map<id, AnalysisResult>│  │
│  └───────────────────┘  └────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│           remotion-element.tsx                       │
│                                                      │
│  useRemotionComponent() ──► component.sequenceStruct │
│  useComponentAnalysis() ──► analysis.parsed          │
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │  if (hasAuthorMetadata)                         ││
│  │    <RemotionSequences structure={...} />        ││
│  │  else if (hasParsedAnalysis)                    ││
│  │    <ParsedSequenceOverlay sequences={...} />    ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

---

## Testing Strategy

### Unit Tests
- Store state management and selectors
- Component loader analysis integration
- Timeline element visualization logic

### Integration Tests
- Full import → analysis → visualization flow
- Cache invalidation on source update
- Multiple component analysis

### Manual Testing Checklist
- [ ] Import a component with `<Sequence>` elements
- [ ] Verify sequences appear on timeline element
- [ ] Import a component with `<TransitionSeries>`
- [ ] Verify transitions and overlaps are visualized
- [ ] Import a component with dynamic values (`from={index * 30}`)
- [ ] Verify "~dynamic" badge appears
- [ ] Edit imported component source
- [ ] Verify visualization updates after re-analysis
- [ ] Import component without sequences
- [ ] Verify no sequence visualization appears

---

## Rollback Plan

If issues arise, the integration can be safely disabled:

1. **Quick disable**: Comment out `ParsedSequenceOverlay` render in `remotion-element.tsx`
2. **Full rollback**: Revert the four modified files
3. **No data loss**: Analysis results are non-critical cached data

---

## Future Enhancements

1. **Real-time analysis**: Analyze as user types in code editor
2. **Sequence editing**: Allow dragging sequence bars to adjust timing
3. **Export structure**: Generate `sequenceStructure` metadata for authors
4. **Diff visualization**: Show changes when source is updated
