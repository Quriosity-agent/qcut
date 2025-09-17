# Pencil Drawing Disappears Issue

## Problem Description

When using the pencil tool to draw on the white board canvas, the drawing appears briefly during the drawing action but then disappears after the mouse is released or the drawing is completed.

## Status
🟡 **DEBUGGING IN PROGRESS** - Comprehensive debug logging added to identify root cause

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

### Root Cause Investigation
The issue appears to be in the drawing system where:
- Immediate canvas drawing works (visual feedback during drawing)
- Stroke object creation may be failing
- Canvas re-rendering might be clearing immediate drawings before stroke objects are properly created

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

### Console Logging
Added debug logging to track the drawing flow:

1. **Drawing Events**: Log when drawing starts/ends
2. **Stroke Collection**: Log points being collected
3. **Object Creation**: Log when stroke objects are created
4. **Canvas Rendering**: Log when canvas is re-rendered

### Debug Environment Variables
Enable debug logging with:
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

- [ ] Verify stroke points are being collected correctly
- [ ] Verify onCreateStroke callback is being triggered
- [ ] Verify addStroke function creates stroke object successfully
- [ ] Verify stroke object is added to objects array
- [ ] Verify canvas re-rendering preserves stroke objects
- [ ] Check if history save/restore is interfering with stroke persistence
- [ ] Check if canvas clearing is happening at wrong time
- [ ] Verify stroke object bounds calculation is correct
- [ ] Check if stroke object rendering logic works correctly

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

## Next Steps

1. Enable debug logging with `VITE_DEBUG_DRAW=1`
2. Reproduce the issue and collect console logs
3. Identify where in the flow the stroke persistence is failing
4. Implement targeted fix based on findings

## Related Issues

- Canvas drawing system architecture
- Object-based drawing vs direct canvas manipulation
- History save/restore system interaction with drawing objects

---

**Last Updated**: 2025-09-17
**Assigned To**: Development Team
**Priority**: High (Core functionality broken)