import React, { useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle, useState } from 'react';
import { useWhiteDrawStore, selectCurrentTool } from "@/stores/white-draw-store";
import { DEFAULT_CANVAS_SIZE } from "@/stores/project-store";
import { useCanvasDrawing } from "../hooks/use-canvas-drawing";
import type { StrokeStyle, ShapeStyle, TextStyle } from '../hooks/use-canvas-drawing';
import { useCanvasObjects } from "../hooks/use-canvas-objects";
import { TextInputModal } from "../components/text-input-modal";
import { cn } from "@/lib/utils";
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";

// Debug logging function that only logs in development mode when enabled
const debug = (...args: unknown[]) => {
  if (import.meta.env.DEV && import.meta.env.VITE_DEBUG_DRAW === '1') {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};

interface DrawingCanvasProps {
  className?: string;
  onDrawingChange?: (dataUrl: string) => void;
  backgroundImage?: string;
  disabled?: boolean;
}

// Export the type for the canvas handle that includes both HTMLCanvasElement methods and custom methods
export interface DrawingCanvasHandle extends HTMLCanvasElement {
  handleImageUpload: (file: File) => Promise<void>;
  loadDrawingFromDataUrl: (dataUrl: string) => Promise<void>;
  getSelectedCount: () => number;
  getHasGroups: () => boolean;
  getCanvasDataUrl: () => string | null;
  handleCreateGroup: () => void;
  handleUngroup: () => void;
  clearAll: () => void;
}


export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(({
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
  const { brushSize, color, opacity, setDrawing, saveToHistory, historyIndex, getCurrentHistoryState } = useWhiteDrawStore();

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
    setIsDragging,
    clearAll
  } = useCanvasObjects();

  // Memoize canvas dimensions for performance
  const canvasDimensions = useMemo(() => {
    // Responsive canvas size based on container
    return DEFAULT_CANVAS_SIZE;
  }, []);

  // Export canvas contents to data URL without mutating the visible canvas
  const getCanvasDataUrl = useCallback(() => {
    const canvas = canvasRef.current;
    const backgroundCanvas = backgroundCanvasRef.current;
    if (!canvas) {
      debug('❌ Canvas not available for download');
      return null;
    }

    debug('🖼️ Preparing offscreen canvas for download:', {
      objectCount: objects.length,
      canvasSize: { width: canvas.width, height: canvas.height }
    });

    // Create offscreen canvas for export
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext('2d');

    if (!exportCtx) {
      debug('❌ Failed to get export canvas context');
      return null;
    }

    // Set white background
    exportCtx.fillStyle = 'white';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Composite background layer if available
    if (backgroundCanvas) {
      exportCtx.drawImage(backgroundCanvas, 0, 0);
      debug('🖼️ Background layer composited');
    }

    // Render all objects to the offscreen canvas
    if (objects.length > 0) {
      renderObjects(exportCtx);
      debug('✅ Objects rendered for download');
    } else {
      debug('⚠️ No objects to render');
    }

    // Get the data URL
    const dataUrl = exportCanvas.toDataURL('image/png');
    debug('📸 Canvas data URL generated:', {
      dataUrlLength: dataUrl.length,
      isValid: dataUrl.startsWith('data:image/png;base64,')
    });

    return dataUrl;
  }, [objects, renderObjects]);

  // Save current canvas state to history
  const saveCanvasToHistory = useCallback(() => {
    const saveSnapshot = () => {
      const dataUrl = getCanvasDataUrl();
      if (dataUrl) {
        saveToHistory(dataUrl);
        debug('💾 Canvas state saved to history');
      }
    };

    if (typeof window !== 'undefined') {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(saveSnapshot));
      } else {
        setTimeout(saveSnapshot, 0);
      }
    } else {
      saveSnapshot();
    }
  }, [getCanvasDataUrl, saveToHistory]);
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
        debug('🎯 Object selected:', {
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
      if (selectedObjectIds.length > 0) {
        debug('🚀 Moving objects:', {
          selectedIds: selectedObjectIds,
          startPos,
          currentPos,
          isDragState: isDragging
        });
        updateDrag(currentPos.x, currentPos.y);
      } else {
        debug('❌ No objects selected for movement:', {
          selectedCount: selectedObjectIds.length,
          isDragState: isDragging
        });
      }
    }, [selectedObjectIds, isDragging, updateDrag]),

    onEndMove: useCallback(() => {
      debug('🏁 End move operation');
      endDrag();
      // Save final positions to history so undo/redo works for moves
      saveCanvasToHistory();
    }, [endDrag, saveCanvasToHistory]),

    // New object creation callbacks with immediate history saving
    onCreateStroke: useCallback((points: { x: number; y: number }[], style: StrokeStyle) => {
      console.log('🎯 PENCIL DEBUG - onCreateStroke callback triggered:', {
        pointCount: points.length,
        points: points,
        style: style
      });
      const objectId = addStroke(points, style);
      console.log('🎯 PENCIL DEBUG - addStroke returned objectId:', objectId);
      // Save state to history immediately after object creation
      saveCanvasToHistory();
      console.log('🎯 PENCIL DEBUG - History saved after stroke creation');
      return objectId;
    }, [addStroke, saveCanvasToHistory]),

    onCreateShape: useCallback((shapeType: 'rectangle' | 'circle' | 'line', bounds: { x: number; y: number; width: number; height: number }, style: ShapeStyle) => {
      debug('🔲 Creating shape object:', { shapeType, bounds, style });
      const objectId = addShape(shapeType, bounds, style);
      // Save state to history immediately after object creation
      saveCanvasToHistory();
      return objectId;
    }, [addShape, saveCanvasToHistory]),

    onCreateText: useCallback((text: string, position: { x: number; y: number }, style: TextStyle) => {
      debug('📝 Creating text object:', { text, position, style });
      const objectId = addText(text, position, style);
      // Save state to history immediately after object creation
      saveCanvasToHistory();
      return objectId;
    }, [addText, saveCanvasToHistory])
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

  // Load drawing from data URL (for saved drawings)
  const loadDrawingFromDataUrl = useCallback(async (dataUrl: string) => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error('Canvas not available');
      }

      // Clear existing objects
      clearAll();

      // Create image element and load the data URL
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load drawing'));
        img.src = dataUrl;
      });

      // Add the loaded drawing as a full-canvas image object
      addImageObject({
        id: `image-${Date.now()}`,
        element: img,
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height,
        rotation: 0,
      });

      if (onDrawingChange) {
        onDrawingChange(dataUrl);
      }
    } catch (error) {
      handleError(error, {
        operation: "load drawing",
        category: ErrorCategory.MEDIA_PROCESSING,
        severity: ErrorSeverity.MEDIUM
      });
    }
  }, [addImageObject, clearAll, onDrawingChange]);

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

  // Handle undo/redo by restoring canvas state from history
  useEffect(() => {
    const historyState = getCurrentHistoryState();
    if (historyState && historyState !== getCanvasDataUrl()) {
      debug('🔄 Restoring canvas from history:', { historyIndex, hasState: !!historyState });
      // Load the history state back into the canvas
      loadDrawingFromDataUrl(historyState);
    }
  }, [historyIndex, getCurrentHistoryState, getCanvasDataUrl, loadDrawingFromDataUrl]);

  // Re-render canvas when objects change
  useEffect(() => {
    console.log('🔄 PENCIL DEBUG - Canvas re-render effect triggered:', {
      objectCount: objects.length,
      objects: objects.map(obj => ({ id: obj.id, type: obj.type }))
    });

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) {
      console.error('❌ PENCIL DEBUG - No canvas or context for re-render');
      return;
    }

    // Clear and redraw with white background
    console.log('🔄 PENCIL DEBUG - Clearing canvas and redrawing background');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render all objects (strokes, shapes, text, images)
    if (objects.length > 0) {
      console.log('🔄 PENCIL DEBUG - Rendering objects to canvas');
      renderObjects(ctx);
    } else {
      console.log('⚠️ PENCIL DEBUG - No objects to render');
    }
  }, [objects, renderObjects]);

  // Expose canvas ref and object/group functions to parent
  useImperativeHandle(ref, () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      // Return a proper object that satisfies the interface instead of null
      return {
        // Our custom methods
        handleImageUpload: async () => { throw new Error('Canvas not available'); },
        loadDrawingFromDataUrl: async () => { throw new Error('Canvas not available'); },
        getSelectedCount: () => 0,
        getHasGroups: () => false,
        getCanvasDataUrl: () => null,
        clearAll: () => { throw new Error('Canvas not available'); },
        handleCreateGroup: () => { throw new Error('Canvas not available'); },
        handleUngroup: () => { throw new Error('Canvas not available'); },
      } as unknown as DrawingCanvasHandle;
    }

    // Create a proxy that delegates canvas methods to the actual canvas
    // This avoids direct DOM mutation while maintaining functionality
    const canvasProxy = new Proxy(canvas, {
      get(target, prop) {
        // Override specific methods with our custom implementations
        switch (prop) {
          case 'handleImageUpload':
            return handleImageUpload;
          case 'loadDrawingFromDataUrl':
            return loadDrawingFromDataUrl;
          case 'getSelectedCount':
            return () => selectedObjectIds.length;
          case 'getHasGroups':
            return () => groups.length > 0;
          case 'getCanvasDataUrl':
            return getCanvasDataUrl;
          case 'clearAll':
            return clearAll;
          case 'handleCreateGroup':
            return () => {
              const groupId = createGroup();
              if (groupId) {
                debug('✅ Group created successfully:', { groupId, selectedCount: selectedObjectIds.length });
              } else {
                debug('❌ Failed to create group - need at least 2 selected objects');
              }
            };
          case 'handleUngroup':
            return () => {
              // Find groups that contain any of the selected objects
              const selectedGroups = groups.filter(group =>
                group.objectIds.some(id => selectedObjectIds.includes(id))
              );

              selectedGroups.forEach(group => {
                ungroupObjects(group.id);
                debug('✅ Group dissolved:', { groupId: group.id });
              });
            };
          default:
            // Delegate to the actual canvas element
            const value = target[prop as keyof HTMLCanvasElement];
            return typeof value === 'function' ? value.bind(target) : value;
        }
      }
    }) as DrawingCanvasHandle;

    return canvasProxy;
  }, [handleImageUpload, loadDrawingFromDataUrl, createGroup, ungroupObjects, selectedObjectIds, groups, getCanvasDataUrl, clearAll]);

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
          !disabled && "hover:border-orange-500 transition-colors"
        )}
        style={{ zIndex: 2, cursor: currentTool.cursor }}
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
