# QCut Integration Guide - Text Position and Rotation Feature

## Overview
This guide provides step-by-step integration of text positioning and rotation controls into the QCut video editor, based on OpenCut's implementation. All subtasks are designed to be completed in under 10 minutes each.

## Prerequisites
- QCut development environment set up
- Understanding of the existing QCut codebase structure
- Access to the OpenCut source files in `qcut/docs/task/`

## QCut Architecture Mapping

### Current QCut Structure → Target Changes
- `qcut/apps/web/src/types/timeline.ts` → Add text position/rotation types
- `qcut/apps/web/src/stores/timeline-store.ts` → Add position update methods
- `qcut/apps/web/src/components/editor/preview-panel/preview-panel.tsx` → Add drag functionality
- `qcut/apps/web/src/components/editor/properties-panel/text-properties.tsx` → Add position controls

## Implementation Subtasks (Each ≤ 10 Minutes)

### Subtask 1: Type Definitions Update (8 minutes)
**File**: `qcut/apps/web/src/types/timeline.ts`

**Reference**: Lines 1-50 from `qcut/docs/task/text-properties.tsx`

**Changes**:
```typescript
// Add to TextElement interface
export interface TextElement extends TimelineElement {
  // ... existing properties
  x?: number;        // X position relative to canvas center (-width/2 to width/2)
  y?: number;        // Y position relative to canvas center (-height/2 to height/2)
  rotation?: number; // Rotation in degrees (-180 to 180)
}
```

**Time Estimate**: 8 minutes
- Review existing TextElement interface: 2 min
- Add new position/rotation properties: 3 min
- Update JSDoc comments: 2 min
- Verify type consistency: 1 min

### Subtask 2: Store Methods Enhancement (9 minutes)
**File**: `qcut/apps/web/src/stores/timeline-store.ts`

**Reference**: Lines 24-46 from `qcut/docs/task/text-properties.tsx` (updateTextElement usage)

**Changes**:
```typescript
// Enhance updateTextElement method
updateTextElement: (trackId: string, elementId: string, updates: Partial<TextElement>) => {
  set((state) => {
    // ... existing logic
    
    // Add position/rotation support
    if (updates.x !== undefined) element.x = updates.x;
    if (updates.y !== undefined) element.y = updates.y;
    if (updates.rotation !== undefined) element.rotation = updates.rotation;
    
    // ... rest of update logic
  });
}

// Add default values to createTextElement
const newElement: TextElement = {
  // ... existing defaults
  x: 0,
  y: 0, 
  rotation: 0,
};
```

**Time Estimate**: 9 minutes
- Locate updateTextElement method: 2 min
- Add position/rotation handling: 4 min
- Update createTextElement defaults: 2 min
- Test store methods: 1 min

### Subtask 3: Preview Panel Drag Logic (10 minutes)
**File**: `qcut/apps/web/src/components/editor/preview-panel/preview-panel.tsx`

**Reference**: Lines 200-300 from `qcut/docs/task/preview-panel.tsx` (drag handling)

**Changes**:
```typescript
// Add drag state interface
interface TextElementDragState {
  isDragging: boolean;
  trackId: string | null;
  elementId: string | null;
  currentX: number;
  currentY: number;
}

// Add constraint logic for text positioning
const handleMouseMove = (event: MouseEvent) => {
  if (!dragState.isDragging) return;
  
  const constrainedX = Math.max(-canvasSize.width / 2, Math.min(canvasSize.width / 2, newX));
  const constrainedY = Math.max(-canvasSize.height / 2, Math.min(canvasSize.height / 2, newY));
  
  updateTextElement(dragState.trackId, dragState.elementId, {
    x: constrainedX,
    y: constrainedY,
  });
};
```

**Time Estimate**: 10 minutes
- Review existing preview panel structure: 3 min
- Add drag state management: 4 min
- Implement constraint logic: 3 min

### Subtask 4: Position Input Controls (9 minutes)
**File**: `qcut/apps/web/src/components/editor/properties-panel/text-properties.tsx`

**Reference**: Lines 100-150 from `qcut/docs/task/text-properties.tsx` (validation functions)

**Changes**:
```typescript
// Add state for position inputs
const [xInput, setXInput] = useState((element.x || 0).toString());
const [yInput, setYInput] = useState((element.y || 0).toString());

// Add validation function
const parseAndValidatePosition = (
  value: string,
  min: number,
  max: number,
  fallback: number
): number => {
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

// Add position handlers
const handleXChange = (value: string) => {
  setXInput(value);
  if (value.trim() !== "") {
    const x = parseAndValidatePosition(value, -canvasSize.width/2, canvasSize.width/2, element.x || 0);
    updateTextElement(trackId, element.id, { x });
  }
};
```

**Time Estimate**: 9 minutes
- Add input state variables: 2 min
- Create validation function: 3 min
- Implement position handlers: 4 min

### Subtask 5: Position UI Components (8 minutes)
**File**: `qcut/apps/web/src/components/editor/properties-panel/text-properties.tsx`

**Reference**: Lines 200-250 from `qcut/docs/task/text-properties.tsx` (UI components)

**Changes**:
```jsx
// Add Position Controls Group after existing PropertyGroups
<PropertyGroup title="Position" defaultExpanded={true}>
  <PropertyItem direction="column">
    <PropertyItemLabel>X Position</PropertyItemLabel>
    <PropertyItemValue>
      <div className="flex items-center gap-2">
        <Slider
          aria-label="X Position"
          value={[element.x || 0]}
          min={-canvasSize.width / 2}
          max={canvasSize.width / 2}
          step={1}
          onValueChange={([value]) => {
            updateTextElement(trackId, element.id, { x: value });
            setXInput(value.toString());
          }}
        />
        <Input
          type="number"
          value={xInput}
          onChange={(e) => handleXChange(e.target.value)}
          className="w-16 text-xs h-7"
        />
      </div>
    </PropertyItemValue>
  </PropertyItem>
  
  {/* Similar structure for Y Position */}
</PropertyGroup>
```

**Time Estimate**: 8 minutes
- Design position controls layout: 3 min
- Implement X position slider/input: 3 min
- Implement Y position slider/input: 2 min

### Subtask 6: Rotation Controls (7 minutes)
**File**: `qcut/apps/web/src/components/editor/properties-panel/text-properties.tsx`

**Reference**: Lines 250-304 from `qcut/docs/task/text-properties.tsx` (rotation implementation)

**Changes**:
```typescript
// Add rotation state and validation
const [rotationInput, setRotationInput] = useState((element.rotation || 0).toString());

const parseAndValidateRotation = (value: string, fallback: number): number => {
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return fallback;
  return Math.max(-180, Math.min(180, parsed));
};

// Add rotation handler
const handleRotationChange = (value: string) => {
  setRotationInput(value);
  if (value.trim() !== "") {
    const rotation = parseAndValidateRotation(value, element.rotation || 0);
    updateTextElement(trackId, element.id, { rotation });
  }
};
```

**Time Estimate**: 7 minutes
- Add rotation state management: 2 min
- Create rotation validation: 2 min
- Implement rotation handler: 2 min
- Add rotation UI component: 1 min

### Subtask 7: Canvas Rendering Updates (9 minutes)
**File**: `qcut/apps/web/src/components/editor/preview-panel/preview-panel.tsx`

**Reference**: Lines 400-500 from `qcut/docs/task/preview-panel.tsx` (text rendering)

**Changes**:
```typescript
// Update text element rendering with transform
const renderTextElement = (element: TextElement) => {
  const transform = `translate(${element.x || 0}px, ${element.y || 0}px) rotate(${element.rotation || 0}deg)`;
  
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform,
        transformOrigin: 'center',
        // ... existing styles
      }}
      onMouseDown={(e) => handleTextMouseDown(e, element)}
    >
      {element.content}
    </div>
  );
};
```

**Time Estimate**: 9 minutes
- Locate text rendering function: 2 min
- Add transform calculations: 3 min
- Update element positioning: 3 min
- Test rendering changes: 1 min

### Subtask 8: Canvas Constraints Integration (6 minutes)
**File**: `qcut/apps/web/src/stores/editor-store.ts`

**Reference**: Lines 50-100 from `qcut/docs/task/preview-panel.tsx` (canvas size integration)

**Changes**:
```typescript
// Ensure canvasSize is accessible for position constraints
export const useCanvasConstraints = () => {
  const { canvasSize } = useEditorStore();
  
  return {
    maxX: canvasSize.width / 2,
    minX: -canvasSize.width / 2,
    maxY: canvasSize.height / 2, 
    minY: -canvasSize.height / 2,
  };
};
```

**Time Estimate**: 6 minutes
- Review canvas size management: 2 min
- Create constraints helper: 2 min
- Integrate with components: 2 min

### Subtask 9: Testing and Validation (10 minutes)
**Files**: All modified files

**Test Checklist**:
- [ ] Position sliders update text location
- [ ] Numeric inputs validate ranges
- [ ] Drag updates input values
- [ ] Rotation works correctly
- [ ] Canvas constraints prevent overflow
- [ ] Undo/redo works with position changes

**Time Estimate**: 10 minutes
- Component integration testing: 4 min
- Position/rotation validation: 3 min  
- Edge case testing: 2 min
- Performance verification: 1 min

## File Path Reference

### QCut Files to Modify:
1. `qcut/apps/web/src/types/timeline.ts` - Type definitions
2. `qcut/apps/web/src/stores/timeline-store.ts` - Store methods
3. `qcut/apps/web/src/stores/editor-store.ts` - Canvas constraints
4. `qcut/apps/web/src/components/editor/preview-panel/preview-panel.tsx` - Drag logic
5. `qcut/apps/web/src/components/editor/properties-panel/text-properties.tsx` - UI controls

### Reference Files:
1. `qcut/docs/task/preview-panel.tsx` - OpenCut implementation reference
2. `qcut/docs/task/text-properties.tsx` - OpenCut properties reference
3. `qcut/docs/task/implementation-guide.md` - Detailed technical guide

## Integration Timeline

| Subtask | Time | File Path | Dependencies |
|---------|------|-----------|-------------|
| 1. Type Definitions | 8 min | `src/types/timeline.ts` | None |
| 2. Store Methods | 9 min | `src/stores/timeline-store.ts` | Subtask 1 |
| 3. Preview Drag Logic | 10 min | `src/components/editor/preview-panel/preview-panel.tsx` | Subtask 1,2 |
| 4. Position Inputs | 9 min | `src/components/editor/properties-panel/text-properties.tsx` | Subtask 1,2 |
| 5. Position UI | 8 min | `src/components/editor/properties-panel/text-properties.tsx` | Subtask 4 |
| 6. Rotation Controls | 7 min | `src/components/editor/properties-panel/text-properties.tsx` | Subtask 4 |
| 7. Canvas Rendering | 9 min | `src/components/editor/preview-panel/preview-panel.tsx` | Subtask 1,2 |
| 8. Canvas Constraints | 6 min | `src/stores/editor-store.ts` | None |
| 9. Testing | 10 min | All files | All previous |
| **Total** | **76 min** | | |

## Adaptation Notes for QCut

### QCut-Specific Considerations:
1. **Hybrid Architecture**: Ensure compatibility with both TanStack Router and legacy Next.js patterns
2. **Electron Integration**: Text positioning must work in both dev and packaged environments
3. **State Management**: Leverage existing Zustand patterns consistently
4. **UI Components**: Use existing Radix UI components and Tailwind classes
5. **Storage**: Position data should persist through IndexedDB/OPFS storage layers

### Key Differences from OpenCut:
- QCut uses `updateTextElement` with optional history parameter
- Canvas sizing may differ due to QCut's project-based approach
- Property panels use QCut's `PropertyGroup`/`PropertyItem` components
- Drag state management should integrate with existing editor state

## Testing Strategy

### Manual Testing Checklist:
1. **Position Controls**: Verify X/Y sliders move text correctly
2. **Rotation**: Test rotation slider and numeric input
3. **Constraints**: Ensure text stays within canvas bounds
4. **Drag Integration**: Confirm dragging updates input fields
5. **State Persistence**: Verify position persists across sessions
6. **Undo/Redo**: Test history integration with position changes

### Performance Validation:
- No lag during real-time position updates
- Smooth drag operations
- Efficient constraint calculations

This integration guide provides a clear path to implement professional text positioning controls in QCut, following the proven patterns from OpenCut while respecting QCut's architectural decisions.