import { useState, useRef, useCallback, useEffect } from "react";
import { TimelineElement } from "@/types/timeline";
import { useEffectsStore } from "@/stores/effects-store";
import { cn } from "@/lib/utils";
import { RotateCw, Move, Maximize2 } from "lucide-react";

interface InteractiveElementOverlayProps {
  element: TimelineElement;
  isSelected: boolean;
  canvasSize: { width: number; height: number };
  previewDimensions: { width: number; height: number };
  onTransformUpdate: (elementId: string, transform: ElementTransform) => void;
}

export interface ElementTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
}

interface DragState {
  isDragging: boolean;
  dragType: "move" | "resize" | "rotate" | null;
  startX: number;
  startY: number;
  startTransform: ElementTransform;
  resizeHandle?: "nw" | "ne" | "sw" | "se" | "n" | "e" | "s" | "w";
}

export function InteractiveElementOverlay({
  element,
  isSelected,
  canvasSize,
  previewDimensions,
  onTransformUpdate,
}: InteractiveElementOverlayProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const { getElementEffects } = useEffectsStore();
  
  // Check if element has effects
  const hasEffects = getElementEffects(element.id).length > 0;
  
  // Only show interactive overlay for elements with effects or text elements
  if (!hasEffects && element.type !== "text") {
    return null;
  }

  const [transform, setTransform] = useState<ElementTransform>({
    x: (element as any).x || 0,
    y: (element as any).y || 0,
    width: (element as any).width || 200,
    height: (element as any).height || 100,
    rotation: (element as any).rotation || 0,
    scale: (element as any).scale || 1,
  });

  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    dragType: null,
    startX: 0,
    startY: 0,
    startTransform: transform,
  });

  // Calculate scale ratio between canvas and preview
  const scaleX = previewDimensions.width / canvasSize.width;
  const scaleY = previewDimensions.height / canvasSize.height;

  // Handle mouse down for drag start
  const handleMouseDown = useCallback((e: React.MouseEvent, type: "move" | "resize" | "rotate", handle?: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDragState({
      isDragging: true,
      dragType: type,
      startX: e.clientX,
      startY: e.clientY,
      startTransform: { ...transform },
      resizeHandle: handle as any,
    });
  }, [transform]);

  // Handle mouse move for dragging
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.isDragging) return;

    const deltaX = (e.clientX - dragState.startX) / scaleX;
    const deltaY = (e.clientY - dragState.startY) / scaleY;

    let newTransform = { ...transform };

    switch (dragState.dragType) {
      case "move":
        newTransform.x = dragState.startTransform.x + deltaX;
        newTransform.y = dragState.startTransform.y + deltaY;
        break;
      
      case "resize":
        if (dragState.resizeHandle) {
          const handle = dragState.resizeHandle;
          
          // Calculate new dimensions based on handle
          if (handle.includes("e")) {
            newTransform.width = Math.max(50, dragState.startTransform.width + deltaX);
          }
          if (handle.includes("w")) {
            const newWidth = Math.max(50, dragState.startTransform.width - deltaX);
            newTransform.width = newWidth;
            newTransform.x = dragState.startTransform.x + (dragState.startTransform.width - newWidth);
          }
          if (handle.includes("s")) {
            newTransform.height = Math.max(50, dragState.startTransform.height + deltaY);
          }
          if (handle.includes("n")) {
            const newHeight = Math.max(50, dragState.startTransform.height - deltaY);
            newTransform.height = newHeight;
            newTransform.y = dragState.startTransform.y + (dragState.startTransform.height - newHeight);
          }
        }
        break;
      
      case "rotate":
        // Calculate rotation based on mouse position relative to center
        const centerX = transform.x + transform.width / 2;
        const centerY = transform.y + transform.height / 2;
        const mouseX = dragState.startX + deltaX * scaleX;
        const mouseY = dragState.startY + deltaY * scaleY;
        
        const angle = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI);
        newTransform.rotation = Math.round(angle);
        break;
    }

    setTransform(newTransform);
    onTransformUpdate(element.id, newTransform);
  }, [dragState, transform, scaleX, scaleY, element.id, onTransformUpdate]);

  // Handle mouse up for drag end
  const handleMouseUp = useCallback(() => {
    if (dragState.isDragging) {
      // Save the transform via the callback
      onTransformUpdate(element.id, transform);
    }
    
    setDragState({
      isDragging: false,
      dragType: null,
      startX: 0,
      startY: 0,
      startTransform: transform,
    });
  }, [dragState.isDragging, transform, element.id, onTransformUpdate]);

  // Add mouse event listeners
  useEffect(() => {
    if (dragState.isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragState.isDragging, handleMouseMove, handleMouseUp]);

  if (!isSelected) {
    return null;
  }

  const overlayStyle = {
    left: `${transform.x * scaleX}px`,
    top: `${transform.y * scaleY}px`,
    width: `${transform.width * scaleX}px`,
    height: `${transform.height * scaleY}px`,
    transform: `rotate(${transform.rotation}deg) scale(${transform.scale})`,
  };

  return (
    <div
      ref={elementRef}
      className={cn(
        "absolute border-2 border-primary pointer-events-auto",
        dragState.isDragging && "cursor-grabbing"
      )}
      style={overlayStyle}
    >
      {/* Move handle - center of element */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center cursor-move hover:bg-primary/30"
        onMouseDown={(e) => handleMouseDown(e, "move")}
      >
        <Move className="w-4 h-4 text-primary-foreground" />
      </div>

      {/* Resize handles - corners and edges */}
      <div
        className="absolute -top-1 -left-1 w-3 h-3 bg-primary rounded-full cursor-nw-resize"
        onMouseDown={(e) => handleMouseDown(e, "resize", "nw")}
      />
      <div
        className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full cursor-ne-resize"
        onMouseDown={(e) => handleMouseDown(e, "resize", "ne")}
      />
      <div
        className="absolute -bottom-1 -left-1 w-3 h-3 bg-primary rounded-full cursor-sw-resize"
        onMouseDown={(e) => handleMouseDown(e, "resize", "sw")}
      />
      <div
        className="absolute -bottom-1 -right-1 w-3 h-3 bg-primary rounded-full cursor-se-resize"
        onMouseDown={(e) => handleMouseDown(e, "resize", "se")}
      />
      
      {/* Edge resize handles */}
      <div
        className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-primary rounded-full cursor-n-resize"
        onMouseDown={(e) => handleMouseDown(e, "resize", "n")}
      />
      <div
        className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-primary rounded-full cursor-s-resize"
        onMouseDown={(e) => handleMouseDown(e, "resize", "s")}
      />
      <div
        className="absolute top-1/2 -left-1 -translate-y-1/2 w-3 h-3 bg-primary rounded-full cursor-w-resize"
        onMouseDown={(e) => handleMouseDown(e, "resize", "w")}
      />
      <div
        className="absolute top-1/2 -right-1 -translate-y-1/2 w-3 h-3 bg-primary rounded-full cursor-e-resize"
        onMouseDown={(e) => handleMouseDown(e, "resize", "e")}
      />

      {/* Rotation handle - top center */}
      <div
        className="absolute -top-8 left-1/2 -translate-x-1/2 w-6 h-6 bg-primary/80 rounded-full flex items-center justify-center cursor-pointer hover:bg-primary"
        onMouseDown={(e) => handleMouseDown(e, "rotate")}
      >
        <RotateCw className="w-3 h-3 text-primary-foreground" />
      </div>

      {/* Visual feedback for active drag state */}
      {dragState.isDragging && (
        <div className="absolute inset-0 bg-primary/10 pointer-events-none" />
      )}

      {/* Info display */}
      {dragState.isDragging && (
        <div className="absolute -bottom-8 left-0 bg-background/90 text-xs px-2 py-1 rounded">
          {dragState.dragType === "move" && `X: ${Math.round(transform.x)}, Y: ${Math.round(transform.y)}`}
          {dragState.dragType === "resize" && `W: ${Math.round(transform.width)}, H: ${Math.round(transform.height)}`}
          {dragState.dragType === "rotate" && `Rotation: ${transform.rotation}°`}
        </div>
      )}
    </div>
  );
}