# Implementation Guide - Text Position and Rotation Feature

## Overview
This guide provides step-by-step instructions for implementing text position and rotation controls based on OpenCut PR #555.

## Prerequisites
- Understanding of React hooks and state management
- Familiarity with Zustand store patterns
- Knowledge of TypeScript and form validation
- Experience with Radix UI components

## Implementation Phases

### Phase 1: Text Element Type Updates (5 minutes)

#### Update Text Element Interface
```typescript
// In types/timeline.ts
export interface TextElement extends TimelineElement {
  // ... existing properties
  x?: number;        // X position relative to canvas center
  y?: number;        // Y position relative to canvas center  
  rotation?: number; // Rotation in degrees (-180 to 180)
}
```

#### Update Default Values
```typescript
// In stores/timeline-store.ts - createTextElement function
const defaultTextElement: TextElement = {
  // ... existing defaults
  x: 0,
  y: 0,
  rotation: 0,
};
```

### Phase 2: Preview Panel Drag Enhancement (10 minutes)

#### Update Constraint Logic
```typescript
// In preview-panel.tsx - handleMouseMove function
const handleMouseMove = (event: MouseEvent) => {
  if (!dragState.isDragging) return;
  
  const rect = canvasRef.current?.getBoundingClientRect();
  if (!rect) return;
  
  const newX = (event.clientX - rect.left - rect.width / 2) * (canvasSize.width / rect.width);
  const newY = (event.clientY - rect.top - rect.height / 2) * (canvasSize.height / rect.height);
  
  // Apply constraints
  const constrainedX = Math.max(-canvasSize.width / 2, Math.min(canvasSize.width / 2, newX));
  const constrainedY = Math.max(-canvasSize.height / 2, Math.min(canvasSize.height / 2, newY));
  
  setDragState((prev) => ({
    ...prev,
    currentX: constrainedX,
    currentY: constrainedY,
  }));
  
  // Update element immediately for live feedback
  if (dragState.trackId && dragState.elementId) {
    updateTextElement(dragState.trackId, dragState.elementId, {
      x: constrainedX,
      y: constrainedY,
    });
  }
};
```

#### Simplify Mouse Up Handler
```typescript
// In preview-panel.tsx - handleMouseUp function
const handleMouseUp = () => {
  setDragState((prev) => ({ ...prev, isDragging: false }));
};
```

### Phase 3: Store Updates (5 minutes)

#### Add Position/Rotation Support
```typescript
// In timeline-store.ts - updateTextElement function
updateTextElement: (trackId: string, elementId: string, updates: Partial<TextElement>) => {
  set((state) => {
    // ... existing logic
    
    // Handle position updates
    if (updates.x !== undefined) {
      element.x = updates.x;
    }
    if (updates.y !== undefined) {
      element.y = updates.y;
    }
    if (updates.rotation !== undefined) {
      element.rotation = updates.rotation;
    }
    
    // ... rest of update logic
  });
}
```

### Phase 4: Text Properties UI - Position Controls (15 minutes)

#### Add State Variables
```typescript
// In text-properties.tsx - component state
const [xInput, setXInput] = useState((element.x || 0).toString());
const [yInput, setYInput] = useState((element.y || 0).toString());
const [rotationInput, setRotationInput] = useState((element.rotation || 0).toString());
```

#### Create Validation Functions
```typescript
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

const parseAndValidateRotation = (value: string, fallback: number): number => {
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return fallback;
  return Math.max(-180, Math.min(180, parsed));
};
```

#### Add Position Handlers
```typescript
const handleXChange = (value: string) => {
  setXInput(value);
  if (value.trim() !== "") {
    const x = parseAndValidatePosition(
      value,
      -canvasSize.width / 2,
      canvasSize.width / 2,
      element.x || 0
    );
    updateTextElement(trackId, element.id, { x });
  }
};

const handleXBlur = () => {
  const x = parseAndValidatePosition(
    xInput,
    -canvasSize.width / 2,
    canvasSize.width / 2,
    element.x || 0
  );
  setXInput(x.toString());
  updateTextElement(trackId, element.id, { x });
};

// Similar handlers for Y position
```

### Phase 5: Text Properties UI - Position Components (10 minutes)

#### Add Position Controls Group
```tsx
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
          className="w-full"
        />
        <Input
          type="number"
          aria-label="X Position (number)"
          value={xInput}
          onChange={(e) => handleXChange(e.target.value)}
          onBlur={handleXBlur}
          className="w-16 !text-xs h-7 rounded-sm text-center"
        />
      </div>
    </PropertyItemValue>
  </PropertyItem>
  
  <PropertyItem direction="column">
    <PropertyItemLabel>Y Position</PropertyItemLabel>
    <PropertyItemValue>
      <div className="flex items-center gap-2">
        <Slider
          aria-label="Y Position"
          value={[element.y || 0]}
          min={-canvasSize.height / 2}
          max={canvasSize.height / 2}
          step={1}
          onValueChange={([value]) => {
            updateTextElement(trackId, element.id, { y: value });
            setYInput(value.toString());
          }}
          className="w-full"
        />
        <Input
          type="number"
          aria-label="Y Position (number)"
          value={yInput}
          onChange={(e) => handleYChange(e.target.value)}
          onBlur={handleYBlur}
          className="w-16 !text-xs h-7 rounded-sm text-center"
        />
      </div>
    </PropertyItemValue>
  </PropertyItem>
</PropertyGroup>
```

### Phase 6: Text Properties UI - Rotation Controls (10 minutes)

#### Add Rotation Handlers
```typescript
const handleRotationChange = (value: string) => {
  setRotationInput(value);
  if (value.trim() !== "") {
    const rotation = parseAndValidateRotation(value, element.rotation || 0);
    updateTextElement(trackId, element.id, { rotation });
  }
};

const handleRotationBlur = () => {
  const rotation = parseAndValidateRotation(rotationInput, element.rotation || 0);
  setRotationInput(rotation.toString());
  updateTextElement(trackId, element.id, { rotation });
};
```

#### Add Rotation Control Group
```tsx
<PropertyGroup title="Transform" defaultExpanded={true}>
  <PropertyItem direction="column">
    <PropertyItemLabel>Rotation</PropertyItemLabel>
    <PropertyItemValue>
      <div className="flex items-center gap-2">
        <Slider
          aria-label="Rotation"
          value={[element.rotation || 0]}
          min={-180}
          max={180}
          step={1}
          onValueChange={([value]) => {
            updateTextElement(trackId, element.id, { rotation: value });
            setRotationInput(value.toString());
          }}
          className="w-full"
        />
        <Input
          type="number"
          aria-label="Rotation (degrees)"
          value={rotationInput}
          onChange={(e) => handleRotationChange(e.target.value)}
          onBlur={handleRotationBlur}
          className="w-16 !text-xs h-7 rounded-sm text-center"
        />
        <span className="text-xs text-muted-foreground">°</span>
      </div>
    </PropertyItemValue>
  </PropertyItem>
</PropertyGroup>
```

### Phase 7: Canvas Rendering Updates (10 minutes)

#### Update Text Rendering Logic
```typescript
// In preview-panel.tsx - text element rendering
const renderTextElement = (element: TextElement) => {
  const transform = `translate(${element.x || 0}px, ${element.y || 0}px) rotate(${element.rotation || 0}deg)`;
  
  return (
    <div
      key={element.id}
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform,
        transformOrigin: 'center',
        fontSize: `${element.fontSize}px`,
        fontFamily: element.fontFamily,
        fontWeight: element.fontWeight,
        fontStyle: element.fontStyle,
        textDecoration: element.textDecoration,
        color: element.color,
        backgroundColor: element.backgroundColor,
        opacity: element.opacity,
        cursor: 'move',
      }}
      onMouseDown={(e) => handleTextMouseDown(e, element)}
    >
      {element.content}
    </div>
  );
};
```

### Phase 8: Testing and Validation (10 minutes)

#### Test Checklist
1. **Position Controls**:
   - [ ] X/Y sliders move text correctly
   - [ ] Numeric inputs update position
   - [ ] Values stay within canvas bounds
   - [ ] Drag updates input values

2. **Rotation Controls**:
   - [ ] Rotation slider rotates text
   - [ ] Numeric input updates rotation
   - [ ] Values constrained to -180° to 180°
   - [ ] Rotation center point is correct

3. **Integration Tests**:
   - [ ] Undo/redo works with position changes
   - [ ] State persists across component re-renders
   - [ ] Multiple text elements work independently
   - [ ] Canvas resize updates constraints

4. **Performance Tests**:
   - [ ] Smooth dragging performance
   - [ ] No lag with real-time updates
   - [ ] Efficient state updates

## Common Issues and Solutions

### Issue 1: Text Position Offset
**Problem**: Text appears offset from expected position
**Solution**: Ensure transform origin is set to 'center' and position calculations use canvas center as origin

### Issue 2: Constraint Validation
**Problem**: Text can be positioned outside canvas
**Solution**: Verify constraint calculations use correct canvas dimensions and account for text size

### Issue 3: State Sync Issues
**Problem**: Input fields and sliders get out of sync
**Solution**: Update both state variables simultaneously in event handlers

### Issue 4: Performance Degradation
**Problem**: Lag during real-time updates
**Solution**: Debounce updates or use requestAnimationFrame for smooth updates

## Integration Notes

1. **Canvas System**: Ensure coordinate system consistency between preview and properties
2. **State Management**: All updates should go through timeline store for proper history tracking
3. **Accessibility**: Include proper ARIA labels and keyboard support
4. **Responsive Design**: Controls should work across different canvas aspect ratios

## Enhancements for Future

1. **Snap to Grid**: Add optional grid alignment
2. **Multi-Select**: Position multiple text elements together
3. **Animation**: Add keyframe animation for position/rotation
4. **Presets**: Quick positioning presets (center, corners, etc.)
5. **Alignment Tools**: Relative alignment between multiple elements

This implementation provides professional-grade text positioning tools while maintaining the clean architecture and user experience standards of the QCut application.