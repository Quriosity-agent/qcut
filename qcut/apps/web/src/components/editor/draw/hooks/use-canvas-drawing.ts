import { useCallback, useRef, useEffect, useMemo } from 'react';
import { DrawingTool } from '@/types/white-draw';

interface DrawingOptions {
  tool: DrawingTool;
  brushSize: number;
  color: string;
  opacity: number;
  disabled: boolean;
  onDrawingStart: () => void;
  onDrawingEnd: () => void;
}

export const useCanvasDrawing = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  options: DrawingOptions
) => {
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const animationFrame = useRef<number | null>(null);

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

  const drawLine = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || options.disabled) return;

    // Save context state
    ctx.save();

    // Set drawing properties
    ctx.lineWidth = options.brushSize;
    ctx.strokeStyle = options.color;
    ctx.globalAlpha = options.opacity;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Handle different tool types
    switch (options.tool.id) {
      case 'eraser':
        ctx.globalCompositeOperation = 'destination-out';
        break;
      case 'blur':
        ctx.filter = 'blur(2px)';
        ctx.globalCompositeOperation = 'source-over';
        break;
      default:
        ctx.globalCompositeOperation = 'source-over';
    }

    // Draw line
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // Restore context state
    ctx.restore();
  }, [options.brushSize, options.color, options.opacity, options.tool.id, options.disabled]);

  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (options.disabled) return;

    e.preventDefault();
    isDrawing.current = true;
    const pos = getCanvasCoordinates(e.nativeEvent);
    lastPos.current = pos;
    options.onDrawingStart();

    // Draw initial point
    drawLine(pos, pos);
  }, [getCanvasCoordinates, options.onDrawingStart, options.disabled, drawLine]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing.current || !lastPos.current || options.disabled) return;

    const currentPos = getCanvasCoordinates(e.nativeEvent);

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
  }, [getCanvasCoordinates, drawLine, options.disabled]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing.current) {
      isDrawing.current = false;
      lastPos.current = null;

      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }

      options.onDrawingEnd();
    }
  }, [options.onDrawingEnd]);

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
    handleTouchEnd
  };
};