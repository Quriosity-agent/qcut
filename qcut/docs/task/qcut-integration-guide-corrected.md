# QCut Integration Guide - Text Position and Rotation Feature (CORRECTED)

## ⚠️ IMPORTANT: Current State Analysis

After reviewing the actual QCut source files, I've discovered that **most of the foundation for text positioning is already implemented**:

### ✅ Already Implemented in QCut:
1. **Type Definitions**: `x`, `y`, `rotation` properties exist in `TextElement` (lines 36-38 in `timeline.ts`)
2. **Store Support**: `updateTextElement` already supports `x`, `y`, `rotation` updates (timeline-store.ts)
3. **Drag Functionality**: Preview panel has complete text drag implementation with constraints
4. **Canvas Rendering**: Text elements already render with position and rotation transforms

### 🚫 What's Missing (Actual Integration Needed):
- **UI Controls**: Position and rotation sliders/inputs in text-properties.tsx
- **Input State Management**: Local state for position/rotation inputs
- **Canvas Size Integration**: Dynamic constraint calculations based on canvas size

## Corrected Implementation Plan

### ❌ SKIP THESE SUBTASKS (Already Implemented):
- ~~Subtask 1: Type Definitions~~ ✅ Already done
- ~~Subtask 2: Store Methods~~ ✅ Already done  
- ~~Subtask 3: Preview Panel Drag~~ ✅ Already done
- ~~Subtask 7: Canvas Rendering~~ ✅ Already done
- ~~Subtask 8: Canvas Constraints~~ ✅ Already done

### ✅ ONLY THESE SUBTASKS ARE NEEDED:

## Subtask 1: Add Position Input Controls (9 minutes)
**File**: `qcut/apps/web/src/components/editor/properties-panel/text-properties.tsx`

**Issue Found**: The integration guide assumed we need to add position properties to types and stores, but they already exist and are fully functional.

**Actual Changes Needed**:
```typescript
// Add after existing state variables (around line 32)
const [xInput, setXInput] = useState((element.x || 0).toString());
const [yInput, setYInput] = useState((element.y || 0).toString());
const [rotationInput, setRotationInput] = useState((element.rotation || 0).toString());

// Add position validation function (after parseAndValidateNumber)
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

// Add position change handlers
const handleXChange = (value: string) => {
  setXInput(value);
  if (value.trim() !== "") {
    const x = parseAndValidatePosition(value, -canvasSize.width/2, canvasSize.width/2, element.x || 0);
    updateTextElement(trackId, element.id, { x });
  }
};

const handleXBlur = () => {
  const x = parseAndValidatePosition(xInput, -canvasSize.width/2, canvasSize.width/2, element.x || 0);
  setXInput(x.toString());
  updateTextElement(trackId, element.id, { x });
};

// Similar handlers for Y position and rotation...
```

## Subtask 2: Add Position UI Components (8 minutes)
**File**: `qcut/apps/web/src/components/editor/properties-panel/text-properties.tsx`

**Need**: Import `useEditorStore` to get `canvasSize` for constraints

```typescript
// Add import at top
import { useEditorStore } from "@/stores/editor-store";

// Add in component
const { canvasSize } = useEditorStore();

// Add Position PropertyGroup after existing groups
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
  
  {/* Similar for Y Position */}
</PropertyGroup>
```

## Subtask 3: Add Rotation Controls (7 minutes)
**File**: `qcut/apps/web/src/components/editor/properties-panel/text-properties.tsx`

```typescript
// Add rotation handlers
const parseAndValidateRotation = (value: string, fallback: number): number => {
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return fallback;
  return Math.max(-180, Math.min(180, parsed));
};

const handleRotationChange = (value: string) => {
  setRotationInput(value);
  if (value.trim() !== "") {
    const rotation = parseAndValidateRotation(value, element.rotation || 0);
    updateTextElement(trackId, element.id, { rotation });
  }
};

// Add Rotation PropertyGroup
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

## Subtask 4: Testing and Integration (10 minutes)

**Test Checklist**:
- [ ] Position sliders update text location in preview
- [ ] Numeric inputs validate and constrain to canvas bounds  
- [ ] Dragging text in preview updates the input fields
- [ ] Rotation slider rotates text correctly
- [ ] Values persist and sync between drag and input controls

## Corrected Timeline

| Task | Time | What's Actually Needed |
|------|------|----------------------|
| 1. Position Input Controls | 9 min | Add input state and handlers |
| 2. Position UI Components | 8 min | Add sliders and inputs to UI |  
| 3. Rotation Controls | 7 min | Add rotation slider and input |
| 4. Testing | 10 min | Verify integration works |
| **Total** | **34 min** | **Only UI controls needed** |

## Key Corrections Made

### ❌ Original Guide Issues:
1. **Assumed missing types** - They already exist
2. **Assumed missing store methods** - They're already implemented  
3. **Assumed missing drag logic** - It's already working
4. **Assumed missing canvas rendering** - It's already implemented
5. **Total time was 76 minutes** - Most work was already done

### ✅ Corrected Understanding:
1. **Types are complete** - x, y, rotation in TextElement ✅
2. **Store is ready** - updateTextElement supports position/rotation ✅
3. **Drag works perfectly** - Text elements can be dragged with constraints ✅
4. **Rendering works** - Position and rotation are already applied ✅
5. **Only UI controls needed** - Just need sliders and inputs in properties panel

## Integration Safety

### ✅ No Breaking Changes:
- Existing text functionality remains unchanged
- Drag behavior is already implemented and working
- Store methods already handle position/rotation updates
- Type definitions are already in place

### ✅ Safe Implementation:
- Only adding UI controls to existing, working system
- All new code is additive, not modifying existing functionality
- Validation functions prevent invalid values
- Integration leverages existing patterns and components

## Testing Strategy

Since the core functionality already exists, testing focuses on:

1. **UI Controls**: Verify sliders and inputs work correctly
2. **State Sync**: Ensure drag updates reflect in input fields
3. **Validation**: Test constraint and bounds checking
4. **Integration**: Verify no conflicts with existing text features

## Conclusion

The original integration guide was based on incomplete knowledge of QCut's current state. **QCut already has a sophisticated text positioning system** - we only need to add the user interface controls to expose this existing functionality.

This reduces implementation time from **76 minutes to 34 minutes** and eliminates all risk of breaking existing features since we're only adding UI controls to an already-working system.