# Canvas Zoom & Drawing Workflow - UX Improvements

**Created**: 2025-01-18
**Status**: 🎯 IMPLEMENTATION READY
**Priority**: HIGH - Core Drawing Workflow

## 📊 Current Workflow Issues

### ❌ **Current Problems**
1. User uploads image → appears too large
2. Must press `Ctrl -` multiple times to zoom out
3. Can't see full image for drawing
4. Workflow interruption

## ✅ **Solution: Simple Auto-Fit**

### **New Workflow**
1. User uploads image
3. Image positioned at **top-left corner** with padding
4. User immediately starts drawing

## 🎨 **Implementation**

### **Auto-Fit Logic (Top-Left Positioning)**
```typescript
function autoFitImageToCanvas(image: ImageObject, canvas: Canvas) {
  const canvasViewport = getVisibleCanvasArea();
  const imageAspectRatio = image.width / image.height;
  const canvasAspectRatio = canvasViewport.width / canvasViewport.height;

  // Fit to 80% of viewport for optimal drawing space
  const targetFillRatio = 0.8;
  const padding = 20; // 20px padding from edges

  if (imageAspectRatio > canvasAspectRatio) {
    // Wide image: fit to viewport width
    const targetWidth = canvasViewport.width * targetFillRatio;
    return {
      width: targetWidth,
      height: targetWidth / imageAspectRatio,
      x: padding, // Top-left positioning
      y: padding  // Top-left positioning
    };
  } else {
    // Tall image: fit to viewport height
    const targetHeight = canvasViewport.height * targetFillRatio;
    return {
      width: targetHeight * imageAspectRatio,
      height: targetHeight,
      x: padding, // Top-left positioning
      y: padding  // Top-left positioning
    };
  }
}
