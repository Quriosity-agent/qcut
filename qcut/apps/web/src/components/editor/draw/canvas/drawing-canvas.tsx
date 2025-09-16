import React, { useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle, useState } from 'react';
import { useWhiteDrawStore, selectCurrentTool } from "@/stores/white-draw-store";
import { useCanvasDrawing } from "../hooks/use-canvas-drawing";
import { useCanvasImages } from "../hooks/use-canvas-images";
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

  // Image management hook
  const {
    images,
    groups,
    selectedImageIds,
    isDragging,
    addImage,
    removeImage,
    selectImage,
    selectImages,
    getImageAtPosition,
    startDrag,
    updateDrag,
    endDrag,
    renderImages,
    createGroup,
    ungroupObjects,
    selectGroup
  } = useCanvasImages(canvasRef);

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
    }, [disabled, setDrawing, saveToHistory]),

    onDrawingEnd: useCallback(() => {
      if (disabled) return;
      try {
        setDrawing(false);
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
    }, [disabled, setDrawing, onDrawingChange]),

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
      // Try to select an image at the position
      const image = getImageAtPosition(canvasPosition.x, canvasPosition.y);
      if (image) {
        console.log('🎯 Image selected:', {
          imageId: image.id,
          position: canvasPosition,
          multiSelect: isMultiSelect,
          currentSelection: selectedImageIds
        });

        selectImage(image.id, isMultiSelect);
        startDrag(image.id, canvasPosition.x, canvasPosition.y);
        return true; // Object was selected
      } else {
        // Deselect all if clicked on empty space (unless multi-selecting)
        if (!isMultiSelect) {
          selectImage(null);
        }
        return false; // No object selected
      }
    }, [getImageAtPosition, selectImage, startDrag, selectedImageIds]),

    onMoveObject: useCallback((startPos: { x: number; y: number }, currentPos: { x: number; y: number }) => {
      if (selectedImageIds.length > 0 && isDragging) {
        console.log('🚀 Moving objects:', {
          selectedIds: selectedImageIds,
          startPos,
          currentPos,
          deltaX: currentPos.x - startPos.x,
          deltaY: currentPos.y - startPos.y
        });
        updateDrag(currentPos.x, currentPos.y);
      }
    }, [selectedImageIds, isDragging, updateDrag]),

    onEndMove: useCallback(() => {
      console.log('🏁 End move operation');
      endDrag();
    }, [endDrag])
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
    if (textInputModal.canvasPosition && drawText) {
      drawText(textInputModal.canvasPosition, text);
      if (onDrawingChange && canvasRef.current) {
        onDrawingChange(canvasRef.current.toDataURL());
      }
    }
    setTextInputModal(prev => ({ ...prev, isOpen: false }));
  }, [textInputModal.canvasPosition, drawText, onDrawingChange]);

  const handleTextCancel = useCallback(() => {
    setTextInputModal(prev => ({ ...prev, isOpen: false }));
  }, []);

  // Image upload handler
  const handleImageUpload = useCallback(async (file: File) => {
    try {
      await addImage(file);
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
  }, [addImage, onDrawingChange]);

  // Re-render canvas when images change
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    // Only re-render if there are images to show
    if (images.length > 0) {
      // Clear and redraw with white background
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Render all images
      renderImages(ctx);
    }
  }, [images, renderImages]);

  // Expose canvas ref and image/group functions to parent
  useImperativeHandle(ref, () => ({
    ...canvasRef.current!,
    handleImageUpload,
    getSelectedCount: () => selectedImageIds.length,
    getHasGroups: () => groups.length > 0,
    handleCreateGroup: () => {
      const groupId = createGroup();
      if (groupId) {
        console.log('✅ Group created successfully:', { groupId, selectedCount: selectedImageIds.length });
      } else {
        console.log('❌ Failed to create group - need at least 2 selected objects');
      }
    },
    handleUngroup: () => {
      // Find groups that contain any of the selected images
      const selectedGroups = groups.filter(group =>
        group.objectIds.some(id => selectedImageIds.includes(id))
      );

      selectedGroups.forEach(group => {
        ungroupObjects(group.id);
        console.log('✅ Group dissolved:', { groupId: group.id });
      });
    }
  }), [handleImageUpload, selectedImageIds.length, groups.length, createGroup, ungroupObjects, selectedImageIds, groups]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative bg-gray-900 rounded-lg overflow-hidden",
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