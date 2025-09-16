import React, { useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle, useState } from 'react';
import { useWhiteDrawStore, selectCurrentTool } from "@/stores/white-draw-store";
import { useCanvasDrawing } from "../hooks/use-canvas-drawing";
import { useCanvasObjects } from "../hooks/use-canvas-objects";
import { TextInputModal } from "../components/text-input-modal";
import { cn } from "@/lib/utils";
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";

interface DrawingCanvasProps {
  className?: string;
  onDrawingChange?: (dataUrl: string) => void;
  backgroundImage?: string;
  disabled?: boolean;
}

// Default canvas size matches QCut editor dimensions
const DEFAULT_CANVAS_SIZE = { width: 800, height: 450 }; // 16:9 ratio

export const DrawingCanvas = forwardRef<HTMLCanvasElement, DrawingCanvasProps>(({
  className,
  onDrawingChange,
  backgroundImage,
  disabled = false
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [textInputModal, setTextInputModal] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    canvasPosition: { x: number; y: number };
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    canvasPosition: { x: 0, y: 0 }
  });

  // Use selectors for performance optimization
  const currentTool = useWhiteDrawStore(selectCurrentTool);
  const { brushSize, color, opacity, setDrawing, saveToHistory } = useWhiteDrawStore();

  // Object management hook (replaces image-only management)
  const {
    objects,
    groups,
    selectedObjectIds,
    isDragging,
    addStroke,
    addShape,
    addText,
    addImageObject,
    selectObjects,
    getObjectAtPosition,
    createGroup,
    ungroupObjects,
    startDrag,
    updateDrag,
    endDrag,
    deleteSelectedObjects,
    renderObjects,
    setIsDrawing,
    setIsDragging
  } = useCanvasObjects();

  // Memoize canvas dimensions for performance
  const canvasDimensions = useMemo(() => {
    // Responsive canvas size based on container
    return DEFAULT_CANVAS_SIZE;
  }, []);

  const {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    drawText
  } = useCanvasDrawing(canvasRef, {
    tool: currentTool,
    brushSize,
    color,
    opacity,
    disabled,
    onDrawingStart: useCallback(() => {
      if (disabled) return;
      try {
        setDrawing(true);
        setIsDrawing(true);
        if (canvasRef.current) {
          saveToHistory(canvasRef.current.toDataURL());
        }
      } catch (error) {
        handleError(error, {
          operation: "canvas drawing start",
          category: ErrorCategory.UI,
          severity: ErrorSeverity.MEDIUM
        });
      }
    }, [disabled, setDrawing, setIsDrawing, saveToHistory]),

    onDrawingEnd: useCallback(() => {
      if (disabled) return;
      try {
        setDrawing(false);
        setIsDrawing(false);
        if (canvasRef.current && onDrawingChange) {
          onDrawingChange(canvasRef.current.toDataURL());
        }
      } catch (error) {
        handleError(error, {
          operation: "canvas drawing end",
          category: ErrorCategory.UI,
          severity: ErrorSeverity.MEDIUM
        });
      }
    }, [disabled, setDrawing, setIsDrawing, onDrawingChange]),

    onTextInput: useCallback((canvasPosition: { x: number; y: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const screenPosition = {
        x: rect.left + (canvasPosition.x * rect.width / canvas.width),
        y: rect.top + (canvasPosition.y * rect.height / canvas.height)
      };

      setTextInputModal({
        isOpen: true,
        position: screenPosition,
        canvasPosition
      });
    }, []),

    onSelectObject: useCallback((canvasPosition: { x: number; y: number }, isMultiSelect = false) => {
      // Try to select any object at the position
      const object = getObjectAtPosition(canvasPosition.x, canvasPosition.y);
      if (object) {
        console.log('🎯 Object selected:', {
          objectId: object.id,
          objectType: object.type,
          position: canvasPosition,
          multiSelect: isMultiSelect,
          currentSelection: selectedObjectIds
        });

        selectObjects([object.id], isMultiSelect);

        // Start dragging for the selected object(s)
        startDrag(canvasPosition.x, canvasPosition.y);

        return true; // Object was selected
      } else {
        // Deselect all if clicked on empty space (unless multi-selecting)
        if (!isMultiSelect) {
          selectObjects([]);
        }
        return false; // No object selected
      }
    }, [getObjectAtPosition, selectObjects, selectedObjectIds, startDrag]),

    onMoveObject: useCallback((startPos: { x: number; y: number }, currentPos: { x: number; y: number }) => {
      if (selectedObjectIds.length > 0 && isDragging) {
        console.log('🚀 Moving objects:', {
          selectedIds: selectedObjectIds,
          currentPos
        });
        updateDrag(currentPos.x, currentPos.y);
      }
    }, [selectedObjectIds, isDragging, updateDrag]),

    onEndMove: useCallback(() => {
      console.log('🏁 End move operation');
      endDrag();
    }, [endDrag]),

    // New object creation callbacks
    onCreateStroke: useCallback((points: { x: number; y: number }[], style: any) => {
      console.log('🖌️ Creating stroke object:', { pointCount: points.length, style });
      return addStroke(points, style);
    }, [addStroke]),

    onCreateShape: useCallback((shapeType: string, bounds: any, style: any) => {
      console.log('🔲 Creating shape object:', { shapeType, bounds, style });
      return addShape(shapeType as any, bounds, style);
    }, [addShape]),

    onCreateText: useCallback((text: string, position: { x: number; y: number }, style: any) => {
      console.log('📝 Creating text object:', { text, position, style });
      return addText(text, position, style);
    }, [addText])
  });

  // Initialize canvases with error handling
  useEffect(() => {
    try {
      const canvas = canvasRef.current;
      const bgCanvas = backgroundCanvasRef.current;
      const container = containerRef.current;

      if (!canvas || !bgCanvas || !container) return;

      // Set canvas dimensions
      const { width, height } = canvasDimensions;
      canvas.width = width;
      canvas.height = height;
      bgCanvas.width = width;
      bgCanvas.height = height;

      // Clear both canvases
      const ctx = canvas.getContext('2d');
      const bgCtx = bgCanvas.getContext('2d');

      if (ctx) {
        // Set white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        // Set default canvas properties
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }

      if (bgCtx) {
        // Set white background for background canvas too
        bgCtx.fillStyle = 'white';
        bgCtx.fillRect(0, 0, width, height);

        // Draw background image if provided
        if (backgroundImage) {
          const img = new Image();
          img.crossOrigin = "anonymous"; // Handle CORS
          img.onload = () => {
            try {
              // Scale image to fit canvas while maintaining aspect ratio
              const imgRatio = img.width / img.height;
              const canvasRatio = width / height;

              let drawWidth, drawHeight, drawX, drawY;

              if (imgRatio > canvasRatio) {
                drawWidth = width;
                drawHeight = width / imgRatio;
                drawX = 0;
                drawY = (height - drawHeight) / 2;
              } else {
                drawWidth = height * imgRatio;
                drawHeight = height;
                drawX = (width - drawWidth) / 2;
                drawY = 0;
              }

              bgCtx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
            } catch (error) {
              handleError(error, {
                operation: "background image loading",
                category: ErrorCategory.MEDIA_PROCESSING,
                severity: ErrorSeverity.MEDIUM
              });
            }
          };
          img.onerror = () => {
            handleError(new Error("Failed to load background image"), {
              operation: "background image error",
              category: ErrorCategory.MEDIA_PROCESSING,
              severity: ErrorSeverity.MEDIUM
            });
          };
          img.src = backgroundImage;
        }
      }
    } catch (error) {
      handleError(error, {
        operation: "canvas initialization",
        category: ErrorCategory.UI,
        severity: ErrorSeverity.HIGH
      });
    }
  }, [canvasDimensions, backgroundImage]);

  // Text input handlers
  const handleTextConfirm = useCallback((text: string) => {
    if (textInputModal.canvasPosition && text.trim()) {
      const style = {
        font: `${brushSize}px Arial, sans-serif`,
        fillStyle: color,
        opacity: opacity
      };

      addText(text, textInputModal.canvasPosition, style);

      if (onDrawingChange && canvasRef.current) {
        onDrawingChange(canvasRef.current.toDataURL());
      }
    }
    setTextInputModal(prev => ({ ...prev, isOpen: false }));
  }, [textInputModal.canvasPosition, addText, brushSize, color, opacity, onDrawingChange]);

  const handleTextCancel = useCallback(() => {
    setTextInputModal(prev => ({ ...prev, isOpen: false }));
  }, []);

  // Image upload handler
  const handleImageUpload = useCallback(async (file: File) => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error('Canvas not available');
      }

      // Create image element and load the file
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
      });

      // Calculate initial size (fit to canvas while maintaining aspect ratio)
      const maxWidth = canvas.width * 0.5; // Max 50% of canvas width
      const maxHeight = canvas.height * 0.5; // Max 50% of canvas height

      let width = img.width;
      let height = img.height;

      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width *= ratio;
        height *= ratio;
      }

      // Create image object
      const imageData = {
        id: `image-${Date.now()}`,
        element: img,
        x: (canvas.width - width) / 2, // Center horizontally
        y: (canvas.height - height) / 2, // Center vertically
        width,
        height,
        rotation: 0
      };

      addImageObject(imageData);

      if (onDrawingChange && canvasRef.current) {
        onDrawingChange(canvasRef.current.toDataURL());
      }
    } catch (error) {
      handleError(error, {
        operation: "image upload",
        category: ErrorCategory.MEDIA_PROCESSING,
        severity: ErrorSeverity.MEDIUM
      });
    }
  }, [addImageObject, onDrawingChange]);

  // Re-render canvas when objects change
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    // Clear and redraw with white background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render all objects (strokes, shapes, text, images)
    if (objects.length > 0) {
      renderObjects(ctx);
    }
  }, [objects, renderObjects]);

  // Expose canvas ref and object/group functions to parent
  useImperativeHandle(ref, () => ({
    ...canvasRef.current!,
    handleImageUpload,
    getSelectedCount: () => selectedObjectIds.length,
    getHasGroups: () => groups.length > 0,
    handleCreateGroup: () => {
      const groupId = createGroup();
      if (groupId) {
        console.log('✅ Group created successfully:', { groupId, selectedCount: selectedObjectIds.length });
      } else {
        console.log('❌ Failed to create group - need at least 2 selected objects');
      }
    },
    handleUngroup: () => {
      // Find groups that contain any of the selected objects
      const selectedGroups = groups.filter(group =>
        group.objectIds.some(id => selectedObjectIds.includes(id))
      );

      selectedGroups.forEach(group => {
        ungroupObjects(group.id);
        console.log('✅ Group dissolved:', { groupId: group.id });
      });
    }
  }), [handleImageUpload, selectedObjectIds.length, groups.length, createGroup, ungroupObjects, selectedObjectIds, groups]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative bg-gray-900 rounded-lg overflow-hidden drawing-canvas",
        disabled && "opacity-50 pointer-events-none",
        className
      )}
      style={{
        width: canvasDimensions.width,
        height: canvasDimensions.height
      }}
    >
      {/* Background canvas for images */}
      <canvas
        ref={backgroundCanvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 1 }}
        aria-hidden="true"
      />

      {/* Drawing canvas */}
      <canvas
        ref={canvasRef}
        width={canvasDimensions.width}
        height={canvasDimensions.height}
        className={cn(
          "absolute inset-0 border border-gray-600",
          `cursor-${currentTool.cursor}`,
          !disabled && "hover:border-orange-500 transition-colors"
        )}
        style={{ zIndex: 2 }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp} // Stop drawing when leaving canvas
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        aria-label="Drawing canvas"
        role="img"
      />

      {/* Loading indicator */}
      {disabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="text-white text-sm">Processing...</div>
        </div>
      )}

      {/* Text Input Modal */}
      <TextInputModal
        isOpen={textInputModal.isOpen}
        position={textInputModal.position}
        fontSize={brushSize}
        color={color}
        onConfirm={handleTextConfirm}
        onCancel={handleTextCancel}
      />
    </div>
  );
});

DrawingCanvas.displayName = 'DrawingCanvas';