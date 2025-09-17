# Pencil Drawing Disappears Issue

## Problem Description

When using the pencil tool to draw on the white board canvas, the drawing appears briefly during the drawing action but then disappears after the mouse is released or the drawing is completed.

## Status
🔴 **ROOT CAUSE IDENTIFIED** - Stroke objects are created successfully but immediately cleared from objects array

## Observed Behavior

1. User selects pencil tool
2. User draws on canvas - drawing appears in real-time
3. When mouse is released, the drawing disappears
4. No stroke object is persisted in the canvas objects array

## Expected Behavior

1. User selects pencil tool
2. User draws on canvas - drawing appears in real-time
3. When mouse is released, the drawing should persist on canvas
4. Stroke object should be created and stored in objects array

## Technical Analysis

### Root Cause Investigation - FINDINGS UPDATE

**✅ CONFIRMED WORKING:**
- Mouse events are captured correctly
- Drawing line segments work (immediate visual feedback)
- Stroke points are collected properly
- onCreateStroke callback is triggered
- addStroke function creates stroke objects successfully
- Stroke objects are added to objects array
- Canvas re-render is triggered
- Stroke rendering logic executes successfully

**❌ IDENTIFIED PROBLEM:**
From console logs, the sequence shows:
1. ✅ Stroke rendered successfully
2. ✅ Objects rendering completed
3. 🔄 Canvas re-render effect triggered (again)
4. 🧹 Canvas cleared and background redrawn
5. ⚠️ No objects to render (objects array is empty!)

**The issue is that the objects array is being cleared/reset AFTER successful stroke creation, causing the re-render to have no objects to display.**

### Files Involved
- `qcut/apps/web/src/components/editor/draw/hooks/use-canvas-drawing.ts`
- `qcut/apps/web/src/components/editor/draw/hooks/use-canvas-objects.ts`
- `qcut/apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx`

### Previous Fix Attempts

#### Attempt 1: Restore Immediate Canvas Drawing
**Date**: 2025-09-17
**File**: `use-canvas-drawing.ts:161-190`
**Change**: Added immediate canvas drawing for visual feedback in `drawLine` function
**Result**: ❌ Issue persists

```typescript
// Added immediate drawing to canvas during stroke collection
const canvas = canvasRef.current;
const ctx = canvas?.getContext('2d');
if (ctx) {
  ctx.save();
  setupCanvasContext(ctx);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}
```

## Debug Steps Added

### Comprehensive Console Logging
Added extensive debug logging throughout the drawing pipeline with "PENCIL DEBUG" prefix for easy identification:

1. **Drawing Events**: Log when drawing starts/ends
2. **Stroke Collection**: Log points being collected during drawing
3. **Object Creation**: Log when stroke objects are created
4. **Canvas Rendering**: Log when canvas is re-rendered
5. **Callback Flow**: Track all callback invocations

### Console Messages Added
**Note**: These debug messages will appear in the browser console regardless of `VITE_DEBUG_DRAW` setting.

#### `use-canvas-drawing.ts`
- `🖱️ PENCIL DEBUG - Mouse down:` - When drawing starts
- `🖌️ PENCIL DEBUG - Drawing line:` - Each line segment drawn
- `🖌️ PENCIL DEBUG - Added first point:` - First point in stroke
- `🖌️ PENCIL DEBUG - Added point, total points:` - Points collected
- `🖌️ PENCIL DEBUG - Drew line segment to canvas` - Immediate drawing
- `🖌️ PENCIL DEBUG - Finalizing stroke:` - When creating stroke object
- `🖌️ PENCIL DEBUG - Calling onCreateStroke with style:` - Callback invocation
- `🖌️ PENCIL DEBUG - onCreateStroke returned:` - Callback result

#### `use-canvas-objects.ts`
- `🏗️ PENCIL DEBUG - addStroke called:` - When addStroke is invoked
- `🏗️ PENCIL DEBUG - Calculated bounds:` - Stroke bounding box
- `🏗️ PENCIL DEBUG - Created stroke object:` - Stroke object details
- `🏗️ PENCIL DEBUG - Updated objects array, new length:` - Array updates
- `🎨 PENCIL DEBUG - renderObjects called:` - When rendering starts
- `🎨 PENCIL DEBUG - Rendering stroke:` - Individual stroke rendering

#### `drawing-canvas.tsx`
- `🎯 PENCIL DEBUG - onCreateStroke callback triggered:` - Callback received
- `🎯 PENCIL DEBUG - addStroke returned objectId:` - Object creation result
- `🔄 PENCIL DEBUG - Canvas re-render effect triggered:` - Re-render events
- `🔄 PENCIL DEBUG - Clearing canvas and redrawing background` - Canvas clearing

### Debug Environment Variables
Optional enhanced debugging with:
```bash
VITE_DEBUG_DRAW=1
```

## Debugging Console Messages

The following console messages have been added to help identify the issue:

### In `use-canvas-drawing.ts`
- `🖌️ Drawing line:` - When drawLine is called
- `🖱️ Mouse down:` - When drawing starts
- `🖱️ Mouse up:` - When drawing ends
- `🖌️ Finalizing stroke:` - When stroke object should be created

### In `use-canvas-objects.ts`
- `✏️ Stroke object created:` - When addStroke is successful
- `🧹 Canvas cleared` - When canvas is cleared

### In `drawing-canvas.tsx`
- `🖌️ Creating stroke object:` - When onCreateStroke callback is triggered
- `💾 Canvas state saved to history` - When state is saved to history

## Investigation Checklist

- [x] Verify stroke points are being collected correctly ✅ **WORKING**
- [x] Verify onCreateStroke callback is being triggered ✅ **WORKING**
- [x] Verify addStroke function creates stroke object successfully ✅ **WORKING**
- [x] Verify stroke object is added to objects array ✅ **WORKING**
- [x] Verify canvas re-rendering preserves stroke objects ❌ **FAILING**
- [x] Check if history save/restore is interfering with stroke persistence ❌ **LIKELY CAUSE**
- [x] Check if canvas clearing is happening at wrong time ✅ **CONFIRMED ISSUE**
- [x] Verify stroke object bounds calculation is correct ✅ **WORKING**
- [x] Verify stroke object rendering logic works correctly ✅ **WORKING**

## NEW INVESTIGATION PRIORITIES

- [ ] **CRITICAL**: Identify what is clearing the objects array between renders
- [ ] **CRITICAL**: Check if history save/restore is resetting the objects array
- [ ] **CRITICAL**: Find the code that triggers the second re-render with empty objects
- [ ] Check if `clearAll()` or `setObjects([])` is being called inappropriately
- [ ] Investigate `loadDrawingFromDataUrl` being called after stroke creation

## Reproduction Steps

1. Open QCut application
2. Navigate to white board/drawing canvas
3. Select pencil tool
4. Draw a simple line or shape
5. Observe that drawing appears during drawing but disappears when complete

## Environment

- **OS**: Windows
- **Browser**: Electron/Chromium
- **QCut Version**: Current development version
- **Node Version**: [Check with `node --version`]
- **Bun Version**: [Check with `bun --version`]

## Instructions for Testing & Debugging

### How to Reproduce and Debug

1. **Open Browser Console**: Press F12 and go to Console tab
2. **Navigate to White Board**: Go to QCut drawing canvas
3. **Select Pencil Tool**: Choose the pencil/brush tool
4. **Draw a Simple Line**: Make a short stroke
5. **Watch Console Output**: Look for "PENCIL DEBUG" messages
6. **Analyze the Flow**: Check where the process fails

### Expected Console Flow
When working correctly, you should see this sequence:
```
🖱️ PENCIL DEBUG - Mouse down: {...}
🖌️ PENCIL DEBUG - Drawing line: {...}
🖌️ PENCIL DEBUG - Added first point: {...}
🖌️ PENCIL DEBUG - Added point, total points: 2
🖌️ PENCIL DEBUG - Drew line segment to canvas
... (more drawing lines) ...
🖌️ PENCIL DEBUG - Finalizing stroke: {...}
🖌️ PENCIL DEBUG - Calling onCreateStroke with style: {...}
🎯 PENCIL DEBUG - onCreateStroke callback triggered: {...}
🏗️ PENCIL DEBUG - addStroke called: {...}
🏗️ PENCIL DEBUG - Calculated bounds: {...}
🏗️ PENCIL DEBUG - Created stroke object: {...}
🏗️ PENCIL DEBUG - Updated objects array, new length: 1
🎯 PENCIL DEBUG - addStroke returned objectId: "uuid..."
🔄 PENCIL DEBUG - Canvas re-render effect triggered: {...}
🎨 PENCIL DEBUG - renderObjects called: {...}
🎨 PENCIL DEBUG - Rendering stroke: {...}
```

### Common Failure Points to Check

1. **No stroke finalization**: Missing "Finalizing stroke" message
2. **Callback not triggered**: Missing "onCreateStroke callback triggered"
3. **Object not created**: Missing "addStroke called" or "Created stroke object"
4. **Array not updated**: Objects array length doesn't increase
5. **Re-render not triggered**: Missing "Canvas re-render effect triggered"
6. **Stroke not rendered**: Missing "Rendering stroke" message

### Next Steps

1. **Reproduce the issue** and collect console logs
2. **Identify the exact failure point** in the debug flow
3. **Compare working vs non-working scenarios**
4. **Implement targeted fix** based on findings

## Related Issues

- Canvas drawing system architecture
- Object-based drawing vs direct canvas manipulation
- History save/restore system interaction with drawing objects

---

## Console Print Messages Added

The following comprehensive console logging has been implemented throughout the drawing pipeline to help debug the pencil drawing disappearance issue:

### Drawing Event Console Messages
```javascript
console.log('🖱️ PENCIL DEBUG - Mouse down:', { x: mouseX, y: mouseY, tool: currentTool });
console.log('🖱️ PENCIL DEBUG - Mouse move:', { x: mouseX, y: mouseY, isDrawing: true });
console.log('🖱️ PENCIL DEBUG - Mouse up:', { x: mouseX, y: mouseY, strokePoints: currentStroke.length });
```

### Stroke Collection Console Messages
```javascript
console.log('🖌️ PENCIL DEBUG - Drawing line:', { from: { x, y }, to: { x2, y2 } });
console.log('🖌️ PENCIL DEBUG - Added first point:', { point: { x, y }, strokeId: newStrokeId });
console.log('🖌️ PENCIL DEBUG - Added point, total points:', currentStroke.length);
console.log('🖌️ PENCIL DEBUG - Drew line segment to canvas');
```

### Object Creation Console Messages
```javascript
console.log('🖌️ PENCIL DEBUG - Finalizing stroke:', {
  points: strokePoints.length,
  style: currentStyle,
  bounds: calculatedBounds
});
console.log('🖌️ PENCIL DEBUG - Calling onCreateStroke with style:', strokeStyle);
console.log('🖌️ PENCIL DEBUG - onCreateStroke returned:', { objectId, success: true });
```

### Canvas Object Management Console Messages
```javascript
console.log('🏗️ PENCIL DEBUG - addStroke called:', {
  pointsCount: stroke.points.length,
  style: stroke.style
});
console.log('🏗️ PENCIL DEBUG - Calculated bounds:', {
  minX, minY, maxX, maxY, width, height
});
console.log('🏗️ PENCIL DEBUG - Created stroke object:', {
  id: strokeObject.id,
  type: strokeObject.type,
  pointsCount: strokeObject.stroke.points.length
});
console.log('🏗️ PENCIL DEBUG - Updated objects array, new length:', objects.length);
```

### Canvas Rendering Console Messages
```javascript
console.log('🎨 PENCIL DEBUG - renderObjects called:', {
  objectCount: objects.length,
  canvasSize: { width: canvas.width, height: canvas.height }
});
console.log('🎨 PENCIL DEBUG - Rendering stroke:', {
  strokeId: object.id,
  pointsCount: object.stroke.points.length,
  style: object.stroke.style
});
console.log('🔄 PENCIL DEBUG - Canvas re-render effect triggered:', {
  reason: 'objects array updated',
  objectCount: objects.length
});
console.log('🔄 PENCIL DEBUG - Clearing canvas and redrawing background');
```

### Drawing Canvas Component Console Messages
```javascript
console.log('🎯 PENCIL DEBUG - onCreateStroke callback triggered:', {
  stroke: strokeData,
  timestamp: Date.now()
});
console.log('🎯 PENCIL DEBUG - addStroke returned objectId:', objectId);
console.log('💾 PENCIL DEBUG - Canvas state saved to history:', {
  historyLength: history.length,
  objectCount: objects.length
});
```

### Error Handling Console Messages
```javascript
console.error('❌ PENCIL DEBUG - Failed to create stroke object:', error);
console.error('❌ PENCIL DEBUG - Canvas context not available:', { canvas: canvasRef.current });
console.error('❌ PENCIL DEBUG - Invalid stroke data:', { stroke, reason: 'insufficient points' });
```

### Debug Flow Verification Messages
```javascript
console.log('✅ PENCIL DEBUG - Stroke creation pipeline completed successfully');
console.log('⚠️ PENCIL DEBUG - Stroke creation pipeline interrupted at:', currentStep);
console.log('🔍 PENCIL DEBUG - Objects array state:', objects.map(obj => ({
  id: obj.id,
  type: obj.type,
  visible: obj.visible
})));
```

## DEBUG FINDINGS FROM CONSOLE LOGS

**Observed Console Pattern (The Problem):**
```
✅ PENCIL DEBUG - Stroke rendered successfully: Object
✅ PENCIL DEBUG - Objects rendering completed
🔄 PENCIL DEBUG - Canvas re-render effect triggered: Object  ← SECOND RE-RENDER
🧹 PENCIL DEBUG - Clearing canvas and redrawing background: Object
⚠️ PENCIL DEBUG - No objects to render: Object  ← OBJECTS ARRAY IS EMPTY!
```

**Analysis:**
The stroke creation pipeline works perfectly. The issue is that **something is clearing the objects array AFTER successful stroke creation**, causing a second re-render with an empty objects array.

**Likely Suspects:**
1. **History System**: `saveCanvasToHistory()` → `loadDrawingFromDataUrl()` → `clearAll()`
2. **State Reset**: Some effect or callback is calling `setObjects([])`
3. **Component Unmount/Remount**: Component lifecycle issue
4. **Concurrent State Updates**: Race condition in state updates

**Next Steps:**
We need to add debug logging to track:
- All calls to `setObjects`
- All calls to `clearAll`
- History save/restore operations
- Component lifecycle events

**Last Updated**: 2025-09-17
**Assigned To**: Development Team
**Priority**: High (Core functionality broken)