import { useCallback, useRef, useEffect } from 'react';
import type { DrawingToolConfig } from '@/types/white-draw';
import type { StrokeObject, ShapeObject, TextObject } from './use-canvas-objects';

// Debug logging function that only logs in development mode when enabled
const debug = (...args: unknown[]) => {
  if (import.meta.env.DEV && import.meta.env.VITE_DEBUG_DRAW === '1') {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};

type StrokeStyle = Pick<StrokeObject, 'strokeStyle' | 'lineWidth' | 'opacity' | 'tool' | 'lineCap' | 'lineJoin' | 'globalCompositeOperation'>;
type ShapeStyle = Pick<ShapeObject, 'strokeStyle' | 'fillStyle' | 'lineWidth' | 'opacity'>;
type TextStyle = Pick<TextObject, 'font' | 'fillStyle' | 'opacity'>;
type StoredShapeType = 'rectangle' | 'circle' | 'line';  // Shape types as stored in objects
type DrawingShapeType = 'rectangle' | 'circle' | 'line' | 'square';  // Shape types during drawing
type ShapeBounds = { x: number; y: number; width: number; height: number };

interface DrawingOptions {
  tool: DrawingToolConfig;
  brushSize: number;
  color: string;
  opacity: number;
  disabled: boolean;
  onDrawingStart: () => void;
  onDrawingEnd: () => void;
  onTextInput?: (position: { x: number; y: number }) => void;
  onSelectObject?: (position: { x: number; y: number }, isMultiSelect?: boolean) => boolean;
  onMoveObject?: (startPos: { x: number; y: number }, currentPos: { x: number; y: number }) => void;
  onEndMove?: () => void;
  // New object-based drawing callbacks with proper types
  onCreateStroke?: (points: { x: number; y: number }[], style: StrokeStyle) => string | null;
  onCreateShape?: (shapeType: StoredShapeType, bounds: ShapeBounds, style: ShapeStyle) => string | null;
  onCreateText?: (text: string, position: { x: number; y: number }, style: TextStyle) => string | null;
}

export const useCanvasDrawing = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: DrawingOptions
) => {
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const animationFrame = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const currentStroke = useRef<{ x: number; y: number }[]>([]);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Debug logging for tool selection
  useEffect(() => {
    debug('🎨 Canvas Drawing Hook - Tool changed:', {
      toolId: options.tool.id,
      toolName: options.tool.name,
      toolCategory: options.tool.category,
      brushSize: options.brushSize,
      color: options.color,
      opacity: options.opacity,
      disabled: options.disabled
    });
  }, [options.tool.id, options.tool.name, options.tool.category, options.brushSize, options.color, options.opacity, options.disabled]);

  const getCanvasCoordinates = useCallback((e: MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY ?? 0 : e.clientY;

    // Scale coordinates to canvas internal dimensions
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }, []);

  const setupCanvasContext = useCallback((ctx: CanvasRenderingContext2D) => {
    // Reset any filters from previous operations to prevent leakage
    ctx.filter = 'none';

    // Set common properties
    ctx.lineWidth = options.brushSize;
    ctx.globalAlpha = options.opacity;

    // Tool-specific context setup
    switch (options.tool.id) {
      case 'brush':
      case 'pencil':
        ctx.strokeStyle = options.color;
        ctx.fillStyle = options.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = 'source-over';
        break;

      case 'eraser':
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        break;

      case 'highlighter':
        ctx.strokeStyle = options.color;
        ctx.fillStyle = options.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = 'multiply';
        break;

      case 'line':
      case 'rectangle':
      case 'circle':
        ctx.strokeStyle = options.color;
        ctx.lineCap = 'round';
        ctx.globalCompositeOperation = 'source-over';
        break;

      case 'text':
        ctx.fillStyle = options.color;
        ctx.font = `${options.brushSize}px Arial, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.globalCompositeOperation = 'source-over';
        break;

      case 'blur':
        ctx.filter = `blur(${Math.max(1, options.brushSize / 10)}px)`;
        ctx.globalCompositeOperation = 'source-over';
        break;

      default:
        ctx.strokeStyle = options.color;
        ctx.fillStyle = options.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = 'source-over';
    }
  }, [options.tool.id, options.brushSize, options.color, options.opacity]);

  const drawLine = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    if (options.disabled) return;

    debug('🖌️ Drawing line:', { from, to, toolId: options.tool.id, category: options.tool.category });

    // For brush/pencil tools, collect points for stroke object
    if (options.tool.category === 'brush' || options.tool.id === 'eraser') {
      // Add points to current stroke
      if (currentStroke.current.length === 0) {
        currentStroke.current.push(from);
      }
      currentStroke.current.push(to);

      // Note: Preview drawing is now handled by the object management system
      // The stroke will be rendered through renderObjects() when finalized
      // This prevents direct canvas manipulation which could interfere with state
    }
  }, [options.tool.category, options.tool.id, options.disabled]);

  const drawShape = useCallback((start: { x: number; y: number }, end: { x: number; y: number }, isPreview = false) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || options.disabled) return;

    debug('🔲 Drawing shape:', {
      toolId: options.tool.id,
      start,
      end,
      isPreview,
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    });

    // Save context state
    ctx.save();

    // Setup context for current tool
    setupCanvasContext(ctx);

    // Calculate dimensions
    const width = end.x - start.x;
    const height = end.y - start.y;

    ctx.beginPath();

    switch (options.tool.id) {
      case 'rectangle':
      case 'square':
        ctx.rect(start.x, start.y, width, height);
        break;

      case 'circle':
        const centerX = start.x + width / 2;
        const centerY = start.y + height / 2;
        const radius = Math.min(Math.abs(width), Math.abs(height)) / 2;
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        break;
    }

    // For preview, use different visual style
    if (isPreview) {
      ctx.setLineDash([5, 5]);
      ctx.globalAlpha = 0.7;
    }

    ctx.stroke();

    // Restore context state
    ctx.restore();
  }, [setupCanvasContext, options.tool.id, options.disabled]);

  const drawText = useCallback((position: { x: number; y: number }, text: string) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || options.disabled) return;

    debug('✏️ Drawing text:', { position, text, fontSize: options.brushSize });

    // Save context state
    ctx.save();

    // Setup context for text
    setupCanvasContext(ctx);

    // Draw text
    ctx.fillText(text, position.x, position.y);

    // Restore context state
    ctx.restore();
  }, [setupCanvasContext, options.disabled, options.brushSize]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (options.disabled) return;

    e.preventDefault();
    isDrawing.current = true;
    const pos = getCanvasCoordinates(e.nativeEvent);
    lastPos.current = pos;
    startPos.current = pos;
    options.onDrawingStart();

    debug('🖱️ Mouse down:', { pos, toolId: options.tool.id, category: options.tool.category });

    // Handle select tool click
    if (options.tool.category === 'select') {
      if (options.onSelectObject) {
        // Check for Ctrl key for multi-selection
        const isMultiSelect = e.nativeEvent.ctrlKey || e.nativeEvent.metaKey;
        const objectSelected = options.onSelectObject(pos, isMultiSelect);
        if (objectSelected) {
          debug('🎯 Object selected for moving:', { multiSelect: isMultiSelect });
          // Object was selected, prepare for potential drag
          isDrawing.current = true; // Use drawing state to track selection drag
          return;
        }
      }
      return;
    }

    // Handle text tool click
    if (options.tool.category === 'text') {
      if (options.onTextInput) {
        options.onTextInput(pos);
      }
      return;
    }

    // For shape tools, don't draw initial point - wait for drag
    if (options.tool.category === 'shape') {
      // Shape tools start drawing on drag
      return;
    }

    // For brush tools, draw initial point
    drawLine(pos, pos);
  }, [getCanvasCoordinates, options.onDrawingStart, options.disabled, drawLine, options.tool.category, options.tool.id]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Log mouse move events for debugging when enabled
    debug('🖱️ MOUSE MOVE EVENT FIRED:', {
      toolCategory: options.tool.category,
      isDrawing: isDrawing.current,
      disabled: options.disabled,
      buttons: e.buttons // This shows which mouse buttons are pressed
    });

    if (options.disabled) return;

    const currentPos = getCanvasCoordinates(e.nativeEvent);

    // Debug: Log mouse move for select tool when debugging is enabled
    if (options.tool.category === 'select') {
      debug('🖱️ Mouse move (select tool debug):', {
        start: startPos.current,
        current: currentPos,
        isDrawing: isDrawing.current,
        hasStartPos: !!startPos.current,
        disabled: options.disabled,
        toolCategory: options.tool.category,
        buttons: e.buttons
      });
    }

    // Handle select tool dragging - Fixed: Don't require buttons to be pressed
    // isDrawing.current is sufficient to track drag state
    if (options.tool.category === 'select' && isDrawing.current && startPos.current) {
      debug('🚀 Calling onMoveObject with positions:', {
        start: startPos.current,
        current: currentPos,
        deltaX: currentPos.x - startPos.current.x,
        deltaY: currentPos.y - startPos.current.y
      });

      if (options.onMoveObject) {
        options.onMoveObject(startPos.current, currentPos);
      }
      return;
    }

    // For other tools, require drawing state
    if (!isDrawing.current) return;

    // Handle shape tools differently
    if (options.tool.category === 'shape' && startPos.current) {
      debug('🖱️ Mouse move (shape):', {
        start: startPos.current,
        current: currentPos,
        toolId: options.tool.id
      });

      // Update last position for shape drawing
      lastPos.current = currentPos;

      // For shape tools, we'll draw the preview shape on mouse up
      // For now, just track the position
      return;
    }

    // Handle brush tools with continuous drawing
    if (!lastPos.current) return;

    // Use requestAnimationFrame for smooth drawing
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
    }

    animationFrame.current = requestAnimationFrame(() => {
      if (lastPos.current) {
        drawLine(lastPos.current, currentPos);
        lastPos.current = currentPos;
      }
    });
  }, [getCanvasCoordinates, drawLine, drawShape, options.disabled, options.tool.category, options.tool.id, options.onMoveObject]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing.current) {
      debug('🖱️ Mouse up:', { toolId: options.tool.id, category: options.tool.category });

      // Handle select tool end movement
      if (options.tool.category === 'select') {
        if (options.onEndMove) {
          options.onEndMove();
        }
        isDrawing.current = false;
        startPos.current = null;
        options.onDrawingEnd();
        return;
      }

      // For shape tools, create shape object
      if (options.tool.category === 'shape' && startPos.current) {
        const endPos = lastPos.current || startPos.current;
        debug('🔲 Finalizing shape:', {
          start: startPos.current,
          end: endPos,
          toolId: options.tool.id
        });

        if (options.onCreateShape) {
          const bounds: ShapeBounds = {
            x: Math.min(startPos.current.x, endPos.x),
            y: Math.min(startPos.current.y, endPos.y),
            width: Math.abs(endPos.x - startPos.current.x),
            height: Math.abs(endPos.y - startPos.current.y)
          };

          const style: ShapeStyle = {
            strokeStyle: options.color,
            fillStyle: undefined,
            lineWidth: options.brushSize,
            opacity: options.opacity
          };

          // Map 'square' to 'rectangle' for storage consistency
          // Square is just a rectangle with equal width and height
          const normalizedShapeType: StoredShapeType =
            options.tool.id === 'square' ? 'rectangle' :
            options.tool.id as StoredShapeType;

          options.onCreateShape(normalizedShapeType, bounds, style);
        }
      }

      // For brush tools, create stroke object
      if ((options.tool.category === 'brush' || options.tool.id === 'eraser') && currentStroke.current.length > 0) {
        debug('🖌️ Finalizing stroke:', {
          pointCount: currentStroke.current.length,
          toolId: options.tool.id
        });

        if (options.onCreateStroke) {
          const style: StrokeStyle = {
            strokeStyle: options.color,
            lineWidth: options.brushSize,
            opacity: options.opacity,
            tool: options.tool.id,
            lineCap: 'round',
            lineJoin: 'round',
            globalCompositeOperation: (options.tool.id === 'eraser' ? 'destination-out' : 'source-over') as GlobalCompositeOperation
          };

          options.onCreateStroke([...currentStroke.current], style);
        }

        // Clear current stroke
        currentStroke.current = [];
      }

      isDrawing.current = false;
      lastPos.current = null;
      startPos.current = null;

      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }

      // Clear any preview drawings
      clearPreview();

      options.onDrawingEnd();
    }
  }, [options.onDrawingEnd, options.tool.category, options.tool.id, options.onEndMove, options.onCreateShape, options.onCreateStroke, options.color, options.brushSize, options.opacity]);

  // Touch event handlers with better mobile support
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (options.disabled) return;

    e.preventDefault();
    if (e.touches.length === 1) { // Single touch only
      isDrawing.current = true;
      const pos = getCanvasCoordinates(e.nativeEvent);
      lastPos.current = pos;
      startPos.current = pos;
      options.onDrawingStart();

      // Handle select tool
      if (options.tool.category === 'select') {
        if (options.onSelectObject) {
          const objectSelected = options.onSelectObject(pos, false);
          if (objectSelected) {
            isDrawing.current = true;
            return;
          }
        }
        return;
      }

      // Handle text tool
      if (options.tool.category === 'text') {
        if (options.onTextInput) {
          options.onTextInput(pos);
        }
        return;
      }

      // For shape tools, don't draw initial point
      if (options.tool.category === 'shape') {
        return;
      }

      // For brush tools, draw initial point
      drawLine(pos, pos);
    }
  }, [getCanvasCoordinates, options.onDrawingStart, options.disabled, drawLine, options.tool.category, options.onSelectObject, options.onTextInput]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (options.disabled) return;

    e.preventDefault();
    if (e.touches.length === 1) {
      const currentPos = getCanvasCoordinates(e.nativeEvent);

      // Handle select tool dragging
      if (options.tool.category === 'select' && isDrawing.current && startPos.current) {
        if (options.onMoveObject) {
          options.onMoveObject(startPos.current, currentPos);
        }
        return;
      }

      // For other tools, require drawing state
      if (!isDrawing.current) return;

      // Handle shape tools
      if (options.tool.category === 'shape' && startPos.current) {
        lastPos.current = currentPos;
        return;
      }

      // Handle brush tools
      if (!lastPos.current) return;
      drawLine(lastPos.current, currentPos);
      lastPos.current = currentPos;
    }
  }, [getCanvasCoordinates, drawLine, options.disabled, options.tool.category, options.onMoveObject]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    handleMouseUp();
  }, [handleMouseUp]);

  // Create preview canvas for temporary strokes
  const getPreviewCanvas = useCallback(() => {
    if (!previewCanvasRef.current && canvasRef.current) {
      // Create overlay canvas for previews
      const canvas = canvasRef.current;
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = canvas.width;
      previewCanvas.height = canvas.height;
      previewCanvas.style.position = 'absolute';
      previewCanvas.style.pointerEvents = 'none';
      previewCanvas.style.zIndex = '3';

      // Insert preview canvas as sibling to main canvas
      canvas.parentElement?.appendChild(previewCanvas);
      previewCanvasRef.current = previewCanvas;
    }
    return previewCanvasRef.current;
  }, []);

  // Clear preview canvas
  const clearPreview = useCallback(() => {
    const previewCanvas = getPreviewCanvas();
    if (previewCanvas) {
      const ctx = previewCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      }
    }
  }, [getPreviewCanvas]);

  // Cleanup animation frames and preview canvas on unmount
  useEffect(() => {
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
      // Clean up preview canvas
      if (previewCanvasRef.current) {
        previewCanvasRef.current.remove();
        previewCanvasRef.current = null;
      }
    };
  }, []);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    drawText
  };
};