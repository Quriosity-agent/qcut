# Drawing Canvas Architecture - Sequence Diagram

This document describes the sequence of events in the drawing canvas system from user interaction to visual rendering.

## Overview

The drawing canvas follows a unidirectional data flow pattern where user interactions trigger hook callbacks that create objects in the store, which then trigger re-renders.

## Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant C as Drawing Canvas (UI)
  participant H as use-canvas-drawing (Hook)
  participant CB as Callbacks (onCreate*)
  participant S as Object Store / Model
  participant R as Renderer

  U->>C: Mouse/Touch Down (brush/eraser/shape)
  C->>H: onMouseDown(event)
  H->>H: Init currentStroke / shape bounds
  U->>C: Move / Drag
  C->>H: onMouseMove(points)
  H->>H: Accumulate points (no immediate draw)
  U->>C: Mouse/Touch Up
  C->>H: onMouseUp()
  alt Brush/Eraser
    H->>CB: onCreateStroke(points, style)
  else Shape
    H->>CB: onCreateShape(type, bounds, style)
  end
  CB->>S: Add object (id)
  S->>R: Request render
  R->>C: Re-render canvases
```

## Key Components

### 1. Drawing Canvas (UI)
- **File**: `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx`
- **Role**: Handles DOM events and delegates to drawing hook
- **Responsibilities**:
  - Capture mouse/touch events
  - Manage canvas element references
  - Coordinate between drawing hook and object store

### 2. use-canvas-drawing (Hook)
- **File**: `apps/web/src/components/editor/draw/hooks/use-canvas-drawing.ts`
- **Role**: Core drawing logic and event handling
- **Responsibilities**:
  - Process mouse/touch coordinates
  - Accumulate stroke points during drag
  - Calculate shape bounds
  - Trigger object creation callbacks

### 3. Callbacks (onCreate*)
- **Location**: Drawing canvas component
- **Types**:
  - `onCreateStroke`: For brush/pencil/eraser tools
  - `onCreateShape`: For rectangle/circle/line tools
  - `onCreateText`: For text tool
- **Role**: Bridge between drawing hook and object store

### 4. Object Store / Model
- **File**: `apps/web/src/components/editor/draw/hooks/use-canvas-objects.ts`
- **Role**: Centralized state management for canvas objects
- **Responsibilities**:
  - Store stroke, shape, text, and image objects
  - Manage object selection and manipulation
  - Trigger re-renders when objects change

### 5. Renderer
- **Location**: Drawing canvas useEffect hooks
- **Role**: Render objects to canvas elements
- **Responsibilities**:
  - Clear and redraw canvases
  - Render objects in correct z-order
  - Handle dual-canvas system (background + drawing)

## Flow Details

### Stroke Creation (Brush/Pencil/Eraser)
1. **Mouse Down**: Initialize empty stroke array
2. **Mouse Move**: Continuously collect points (no immediate drawing)
3. **Mouse Up**: Create stroke object with all collected points
4. **Store Update**: Add stroke to objects array
5. **Re-render**: Canvas clears and redraws all objects

### Shape Creation (Rectangle/Circle/Line)
1. **Mouse Down**: Store start position
2. **Mouse Move**: Track current position (no immediate drawing)
3. **Mouse Up**: Calculate final bounds and create shape object
4. **Store Update**: Add shape to objects array
5. **Re-render**: Canvas clears and redraws all objects

## Architecture Benefits

### No Immediate Drawing
- **Problem Solved**: Prevents flickering from immediate strokes being overwritten
- **Benefit**: Consistent rendering through object system

### Point Accumulation
- **Problem Solved**: Smooth strokes with multiple points vs. just start/end
- **Benefit**: Better drawing quality and user experience

### Dual Canvas System
- **Background Canvas**: Images and background elements
- **Drawing Canvas**: Strokes, shapes, and text
- **Benefit**: Proper layering and performance optimization

### Unidirectional Data Flow
- **Pattern**: User → Hook → Callback → Store → Render
- **Benefit**: Predictable state management and easier debugging

## Debugging

The system includes extensive debug logging:
- `🖱️ MOUSE` events
- `🖌️ PENCIL` stroke operations
- `🔲 SHAPE` creation
- `🎨 CANVAS` rendering

Enable with: `VITE_DEBUG_DRAW=1`