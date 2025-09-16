import { useCallback, useRef, useEffect } from 'react';
import { DrawingToolConfig } from '@/types/white-draw';

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
}

export const useCanvasDrawing = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: DrawingOptions
) => {
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const animationFrame = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  // Debug logging for tool selection
  useEffect(() => {
    console.log('🎨 Canvas Drawing Hook - Tool changed:', {
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
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || options.disabled) return;

    console.log('🖌️ Drawing line:', { from, to, toolId: options.tool.id, category: options.tool.category });

    // Save context state
    ctx.save();

    // Setup context for current tool
    setupCanvasContext(ctx);

    // Draw based on tool type
    if (options.tool.category === 'brush' || options.tool.id === 'eraser') {
      // Freehand drawing tools
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    // Restore context state
    ctx.restore();
  }, [setupCanvasContext, options.tool.category, options.tool.id, options.disabled]);

  const drawShape = useCallback((start: { x: number; y: number }, end: { x: number; y: number }, isPreview = false) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || options.disabled) return;

    console.log('🔲 Drawing shape:', {
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

    console.log('✏️ Drawing text:', { position, text, fontSize: options.brushSize });

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

    console.log('🖱️ Mouse down:', { pos, toolId: options.tool.id, category: options.tool.category });

    // Handle select tool click
    if (options.tool.category === 'select') {
      if (options.onSelectObject) {
        // Check for Ctrl key for multi-selection
        const isMultiSelect = e.nativeEvent.ctrlKey || e.nativeEvent.metaKey;
        const objectSelected = options.onSelectObject(pos, isMultiSelect);
        if (objectSelected) {
          console.log('🎯 Object selected for moving:', { multiSelect: isMultiSelect });
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
    if (!isDrawing.current || options.disabled) return;

    const currentPos = getCanvasCoordinates(e.nativeEvent);

    // Handle select tool dragging
    if (options.tool.category === 'select' && startPos.current) {
      if (options.onMoveObject) {
        options.onMoveObject(startPos.current, currentPos);
      }
      return;
    }

    // Handle shape tools differently
    if (options.tool.category === 'shape' && startPos.current) {
      console.log('🖱️ Mouse move (shape):', {
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
      console.log('🖱️ Mouse up:', { toolId: options.tool.id, category: options.tool.category });

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

      // For shape tools, draw final shape
      if (options.tool.category === 'shape' && startPos.current) {
        // Get current mouse position from the canvas
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const endPos = lastPos.current || startPos.current;
          console.log('🔲 Finalizing shape:', {
            start: startPos.current,
            end: endPos,
            toolId: options.tool.id
          });
          drawShape(startPos.current, endPos, false);
        }
      }

      isDrawing.current = false;
      lastPos.current = null;
      startPos.current = null;

      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }

      options.onDrawingEnd();
    }
  }, [options.onDrawingEnd, options.tool.category, options.tool.id, options.onEndMove, drawShape]);

  // Touch event handlers with better mobile support
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (options.disabled) return;

    e.preventDefault();
    if (e.touches.length === 1) { // Single touch only
      isDrawing.current = true;
      const pos = getCanvasCoordinates(e.nativeEvent);
      lastPos.current = pos;
      options.onDrawingStart();
      drawLine(pos, pos);
    }
  }, [getCanvasCoordinates, options.onDrawingStart, options.disabled, drawLine]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDrawing.current || !lastPos.current || options.disabled) return;

    e.preventDefault();
    if (e.touches.length === 1) {
      const currentPos = getCanvasCoordinates(e.nativeEvent);
      drawLine(lastPos.current, currentPos);
      lastPos.current = currentPos;
    }
  }, [getCanvasCoordinates, drawLine, options.disabled]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    handleMouseUp();
  }, [handleMouseUp]);

  // Cleanup animation frames on unmount
  useEffect(() => {
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
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