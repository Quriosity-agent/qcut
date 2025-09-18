# Canvas Scroll & Drawing Workflow - UX Improvements

**Created**: 2025-01-18
**Status**: 🎯 IMPLEMENTATION READY
**Priority**: HIGH - Core Drawing Workflow

## 📊 Current Workflow Issues

### ❌ **Current Problems**
1. User uploads image → appears at random position
2. No visual scroll indicators for large canvases
3. Difficult to navigate large drawing areas
4. Workflow interruption when panning manually

## 🔗 **Relevant Source Files**
- **Main Drawing Canvas**: `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx`
- **Canvas Objects Hook**: `apps/web/src/components/editor/draw/hooks/use-canvas-objects.ts`
- **Canvas Drawing Hook**: `apps/web/src/components/editor/draw/hooks/use-canvas-drawing.ts`
- **Canvas Utilities**: `apps/web/src/components/editor/draw/utils/canvas-utils.ts`
- **Canvas Images Hook**: `apps/web/src/components/editor/draw/hooks/use-canvas-images.ts`
- **Image Upload Component**: `apps/web/src/components/editor/adjustment/multi-image-upload.tsx`
- **Media Panel Draw View**: `apps/web/src/components/editor/media-panel/views/draw.tsx`

## ✅ **Solution: Top-Left Image Positioning & Scroll Controls**

### **New Workflow**
1. User uploads image → automatically positioned at **top-left corner** with padding
2. Canvas displays with scroll sliders for navigation
3. User can scroll horizontally and vertically to view/draw on different areas
4. User immediately starts drawing without manual adjustments

## 🎨 **Implementation**

### **Top-Left Image Positioning**
**Target File**: `apps/web/src/components/editor/draw/hooks/use-canvas-images.ts:45-100`
```typescript
function positionImageTopLeft(image: ImageObject, canvas: Canvas) {
  const padding = 20; // 20px padding from edges

  return {
    width: image.width,   // Keep original dimensions
    height: image.height, // Keep original dimensions
    x: padding,          // Top-left positioning
    y: padding           // Top-left positioning
  };
}
```

## 📜 **Canvas Scroll Sliders**

### **Requirements**
- **Vertical Scrollbar**: Positioned on the right side of canvas for vertical scrolling
- **Horizontal Scrollbar**: Positioned at the bottom of canvas for horizontal scrolling
- **Canvas Size**: Support large canvases (e.g., 5000x5000px)
- **Viewport**: Show visible area within the larger canvas
- **Sync**: Scrollbars update when panning with mouse/touch
- **Visual Feedback**: Show current viewport position within the total canvas

### **Integration Plan**

#### **1. New Component Structure**
**Target File**: `apps/web/src/components/editor/draw/components/canvas-scrollbars.tsx` (new file)
```typescript
interface CanvasScrollbarsProps {
  canvasWidth: number;
  canvasHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
  onScrollXChange: (x: number) => void;
  onScrollYChange: (y: number) => void;
}

export const CanvasScrollbars: React.FC<CanvasScrollbarsProps> = ({
  canvasWidth,
  canvasHeight,
  viewportWidth,
  viewportHeight,
  scrollX,
  scrollY,
  onScrollXChange,
  onScrollYChange
}) => {
  // Scrollbar implementation
}
```

#### **2. Canvas State Management**
**Modify**: `apps/web/src/components/editor/draw/hooks/use-canvas-drawing.ts:20-50`
- Add scroll position state management
- Implement viewport calculations
- Handle pan interactions

```typescript
interface CanvasState {
  scrollX: number;      // Horizontal scroll position
  scrollY: number;      // Vertical scroll position
  canvasWidth: number;  // Total canvas width
  canvasHeight: number; // Total canvas height
  viewport: { width: number; height: number };
}
```

#### **3. Drawing Canvas Integration**
**Modify**: `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx:100-200`
- Wrap canvas in scrollable container
- Apply scroll transformations to canvas context
- Position scrollbars appropriately

```typescript
<div className="relative w-full h-full overflow-hidden">
  {/* Canvas Viewport */}
  <div className="relative w-full h-full">
    <canvas
      ref={canvasRef}
      width={canvasWidth}
      height={canvasHeight}
      style={{
        transform: `translate(-${scrollX}px, -${scrollY}px)`,
      }}
    />
  </div>

  {/* Vertical Scrollbar */}
  <div className="absolute right-0 top-0 bottom-4 w-4 bg-gray-100">
    <div
      className="bg-gray-400 rounded cursor-pointer hover:bg-gray-500"
      style={{
        height: `${(viewportHeight / canvasHeight) * 100}%`,
        transform: `translateY(${(scrollY / canvasHeight) * 100}%)`,
      }}
      onMouseDown={handleVerticalScroll}
    />
  </div>

  {/* Horizontal Scrollbar */}
  <div className="absolute bottom-0 left-0 right-4 h-4 bg-gray-100">
    <div
      className="bg-gray-400 rounded cursor-pointer hover:bg-gray-500"
      style={{
        width: `${(viewportWidth / canvasWidth) * 100}%`,
        transform: `translateX(${(scrollX / canvasWidth) * 100}%)`,
      }}
      onMouseDown={handleHorizontalScroll}
    />
  </div>
</div>
```

#### **4. Scroll Utilities**
**Create**: `apps/web/src/components/editor/draw/utils/scroll-utils.ts` (new file)
```typescript
export const clampScroll = (
  scroll: number,
  min: number,
  max: number
): number => {
  return Math.max(min, Math.min(max, scroll));
};

export const calculateScrollRatio = (
  viewportSize: number,
  canvasSize: number
): number => {
  return Math.min(1, viewportSize / canvasSize);
};

export const scrollPositionToPixels = (
  scrollRatio: number,
  canvasSize: number,
  viewportSize: number
): number => {
  return scrollRatio * (canvasSize - viewportSize);
};
```

#### **5. Mouse/Touch Event Handling**
**Modify**: `apps/web/src/components/editor/draw/hooks/use-canvas-drawing.ts:150-250`
- Adjust mouse coordinates based on scroll position
- Handle pan gestures for scrolling
- Implement mouse wheel scrolling

```typescript
const getCanvasCoordinates = (e: MouseEvent): { x: number; y: number } => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) + scrollX,
    y: (e.clientY - rect.top) + scrollY
  };
};

const handlePan = (deltaX: number, deltaY: number) => {
  setScrollX(prev => clampScroll(prev + deltaX, 0, canvasWidth - viewportWidth));
  setScrollY(prev => clampScroll(prev + deltaY, 0, canvasHeight - viewportHeight));
};
```

#### **6. Keyboard Shortcuts**
**Modify**: `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx:300-350`
- Add keyboard shortcuts for scrolling
- Arrow Keys: Scroll in small increments (20px)
- Page Up/Down: Scroll vertically by viewport height
- Home/End: Jump to top/bottom of canvas

#### **7. Store Integration**
**Modify**: `apps/web/src/stores/drawing-store.ts` (if exists) or create new
- Persist scroll positions
- Share scroll state between components
- Handle undo/redo with scroll context

```typescript
interface DrawingStore {
  scrollX: number;
  scrollY: number;
  canvasWidth: number;
  canvasHeight: number;
  setScrollPosition: (x: number, y: number) => void;
  setCanvasSize: (width: number, height: number) => void;
  resetScroll: () => void;
}
```

### **Files to Modify/Create**

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/src/components/editor/draw/components/canvas-scrollbars.tsx` | **CREATE** | Scroll control components |
| `apps/web/src/components/editor/draw/utils/scroll-utils.ts` | **CREATE** | Scroll calculation utilities |
| `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx` | **MODIFY** | Integrate scrollbars & top-left positioning |
| `apps/web/src/components/editor/draw/hooks/use-canvas-drawing.ts` | **MODIFY** | Add scroll state management |
| `apps/web/src/components/editor/draw/hooks/use-canvas-images.ts` | **MODIFY** | Implement top-left image positioning |
| `apps/web/src/components/editor/draw/hooks/use-canvas-objects.ts` | **MODIFY** | Apply scroll offset to object positioning |
| `apps/web/src/stores/drawing-store.ts` | **CREATE/MODIFY** | Persist scroll state |
| `apps/web/src/components/editor/draw/utils/canvas-utils.ts` | **MODIFY** | Update coordinate calculations |

### **UI/UX Considerations**

1. **Scrollbar Design**
   - Semi-transparent background for subtle appearance
   - Show scrollbar thumb size based on viewport ratio
   - Smooth scrolling transitions
   - Auto-hide when not needed (viewport covers entire canvas)

2. **Image Positioning**
   - Always position uploaded images at top-left with 20px padding
   - Maintain original image dimensions (no auto-scaling)
   - Ensure images are visible immediately after upload

3. **Performance**
   - Use `requestAnimationFrame` for smooth scroll transitions
   - Debounce scroll events to prevent excessive re-renders
   - Cache transformed coordinates for better performance

4. **Accessibility**
   - ARIA labels for scrollbars
   - Keyboard navigation support for scrolling
   - Focus indicators for keyboard users

### **Testing Checklist**
- [ ] Images upload and position at top-left corner
- [ ] Vertical scrollbar works correctly for large canvases
- [ ] Horizontal scrollbar works correctly for wide canvases
- [ ] Keyboard shortcuts (arrows, page up/down) work
- [ ] Mouse wheel scrolling functions properly
- [ ] Pan gestures update scrollbar positions
- [ ] Drawing accuracy maintained at all scroll positions
- [ ] Performance remains smooth during scrolling
- [ ] Scroll state persists across sessions
- [ ] Scrollbars hide when viewport covers entire canvas
