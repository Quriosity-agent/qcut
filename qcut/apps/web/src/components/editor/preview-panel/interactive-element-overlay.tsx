"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { TimelineElement } from "@/types/timeline";
import { useTimelineStore } from "@/stores/timeline-store";
import { useEffectsStore } from "@/stores/effects-store";
import { cn } from "@/lib/utils";
import { Move, Maximize2, RotateCw } from "lucide-react";

interface InteractiveElementOverlayProps {
  element: TimelineElement;
  previewScale: number;
  containerRef: React.RefObject<HTMLDivElement>;
  isActive: boolean;
  effectsEnabled?: boolean;
}

interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
}

interface ResizeState {
  isResizing: boolean;
  handle: ResizeHandle;
  startX: number;
  startY: number;
  initialWidth: number;
  initialHeight: number;
  initialX: number;
  initialY: number;
}

interface RotateState {
  isRotating: boolean;
  startAngle: number;
  initialRotation: number;
}

type ResizeHandle = 
  | "top-left" 
  | "top-right" 
  | "bottom-left" 
  | "bottom-right"
  | "top"
  | "bottom"
  | "left"
  | "right";

export function InteractiveElementOverlay({
  element,
  previewScale,
  containerRef,
  isActive,
  effectsEnabled = false,
}: InteractiveElementOverlayProps) {
  const { updateElementPosition, updateElementSize, updateElementRotation } = useTimelineStore();
  const { getElementEffects } = useEffectsStore();
  const overlayRef = useRef<HTMLDivElement>(null);
  
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialX: element.x || 0,
    initialY: element.y || 0,
  });
  
  const [resizeState, setResizeState] = useState<ResizeState>({
    isResizing: false,
    handle: "bottom-right",
    startX: 0,
    startY: 0,
    initialWidth: element.width || 100,
    initialHeight: element.height || 100,
    initialX: element.x || 0,
    initialY: element.y || 0,
  });
  
  const [rotateState, setRotateState] = useState<RotateState>({
    isRotating: false,
    startAngle: 0,
    initialRotation: element.rotation || 0,
  });

  // Check if element has effects
  const hasEffects = effectsEnabled && getElementEffects(element.id).length > 0;
  
  // Only show interactive overlay if element has effects or is selected
  if (!hasEffects && !isActive) {
    return null;
  }

  // Handle drag start
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDragState({
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      initialX: element.x || 0,
      initialY: element.y || 0,
    });
  }, [element.x, element.y]);

  // Handle resize start
  const handleResizeStart = useCallback((e: React.MouseEvent, handle: ResizeHandle) => {
    e.preventDefault();
    e.stopPropagation();
    
    setResizeState({
      isResizing: true,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      initialWidth: element.width || 100,
      initialHeight: element.height || 100,
      initialX: element.x || 0,
      initialY: element.y || 0,
    });
  }, [element]);

  // Handle rotation start
  const handleRotateStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!containerRef.current || !overlayRef.current) return;
    
    const rect = overlayRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const startAngle = Math.atan2(
      e.clientY - centerY,
      e.clientX - centerX
    ) * (180 / Math.PI);
    
    setRotateState({
      isRotating: true,
      startAngle,
      initialRotation: element.rotation || 0,
    });
  }, [element.rotation, containerRef]);

  // Handle mouse move for drag, resize, and rotate
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragState.isDragging) {
        const deltaX = (e.clientX - dragState.startX) / previewScale;
        const deltaY = (e.clientY - dragState.startY) / previewScale;
        
        updateElementPosition(element.id, {
          x: dragState.initialX + deltaX,
          y: dragState.initialY + deltaY,
        });
      }
      
      if (resizeState.isResizing) {
        const deltaX = (e.clientX - resizeState.startX) / previewScale;
        const deltaY = (e.clientY - resizeState.startY) / previewScale;
        
        let newWidth = resizeState.initialWidth;
        let newHeight = resizeState.initialHeight;
        let newX = resizeState.initialX;
        let newY = resizeState.initialY;
        
        switch (resizeState.handle) {
          case "bottom-right":
            newWidth = Math.max(20, resizeState.initialWidth + deltaX);
            newHeight = Math.max(20, resizeState.initialHeight + deltaY);
            break;
          case "bottom-left":
            newWidth = Math.max(20, resizeState.initialWidth - deltaX);
            newHeight = Math.max(20, resizeState.initialHeight + deltaY);
            newX = resizeState.initialX + deltaX;
            break;
          case "top-right":
            newWidth = Math.max(20, resizeState.initialWidth + deltaX);
            newHeight = Math.max(20, resizeState.initialHeight - deltaY);
            newY = resizeState.initialY + deltaY;
            break;
          case "top-left":
            newWidth = Math.max(20, resizeState.initialWidth - deltaX);
            newHeight = Math.max(20, resizeState.initialHeight - deltaY);
            newX = resizeState.initialX + deltaX;
            newY = resizeState.initialY + deltaY;
            break;
          case "right":
            newWidth = Math.max(20, resizeState.initialWidth + deltaX);
            break;
          case "left":
            newWidth = Math.max(20, resizeState.initialWidth - deltaX);
            newX = resizeState.initialX + deltaX;
            break;
          case "bottom":
            newHeight = Math.max(20, resizeState.initialHeight + deltaY);
            break;
          case "top":
            newHeight = Math.max(20, resizeState.initialHeight - deltaY);
            newY = resizeState.initialY + deltaY;
            break;
        }
        
        updateElementSize(element.id, {
          width: newWidth,
          height: newHeight,
          x: newX,
          y: newY,
        });
      }
      
      if (rotateState.isRotating && overlayRef.current) {
        const rect = overlayRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const currentAngle = Math.atan2(
          e.clientY - centerY,
          e.clientX - centerX
        ) * (180 / Math.PI);
        
        const deltaAngle = currentAngle - rotateState.startAngle;
        const newRotation = rotateState.initialRotation + deltaAngle;
        
        updateElementRotation(element.id, newRotation);
      }
    };
    
    const handleMouseUp = () => {
      setDragState(prev => ({ ...prev, isDragging: false }));
      setResizeState(prev => ({ ...prev, isResizing: false }));
      setRotateState(prev => ({ ...prev, isRotating: false }));
    };
    
    if (dragState.isDragging || resizeState.isResizing || rotateState.isRotating) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = dragState.isDragging ? "move" : 
                                   resizeState.isResizing ? "nwse-resize" : 
                                   "grabbing";
      
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
      };
    }
  }, [
    dragState,
    resizeState,
    rotateState,
    previewScale,
    element.id,
    updateElementPosition,
    updateElementSize,
    updateElementRotation,
  ]);

  const elementStyle = {
    left: `${(element.x || 0) * previewScale}px`,
    top: `${(element.y || 0) * previewScale}px`,
    width: `${(element.width || 100) * previewScale}px`,
    height: `${(element.height || 100) * previewScale}px`,
    transform: `rotate(${element.rotation || 0}deg)`,
  };

  return (
    <div
      ref={overlayRef}
      className={cn(
        "absolute pointer-events-auto",
        "border-2 border-primary/50",
        hasEffects && "border-purple-500/50",
        isActive && "border-primary"
      )}
      style={elementStyle}
    >
      {/* Drag handle - center */}
      <div
        className="absolute inset-0 cursor-move"
        onMouseDown={handleDragStart}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 hover:opacity-100 transition-opacity">
          <Move className="w-6 h-6 text-primary" />
        </div>
      </div>
      
      {/* Resize handles */}
      <div
        className="absolute -top-1 -left-1 w-3 h-3 bg-primary cursor-nw-resize"
        onMouseDown={(e) => handleResizeStart(e, "top-left")}
      />
      <div
        className="absolute -top-1 -right-1 w-3 h-3 bg-primary cursor-ne-resize"
        onMouseDown={(e) => handleResizeStart(e, "top-right")}
      />
      <div
        className="absolute -bottom-1 -left-1 w-3 h-3 bg-primary cursor-sw-resize"
        onMouseDown={(e) => handleResizeStart(e, "bottom-left")}
      />
      <div
        className="absolute -bottom-1 -right-1 w-3 h-3 bg-primary cursor-se-resize"
        onMouseDown={(e) => handleResizeStart(e, "bottom-right")}
      />
      
      {/* Edge resize handles */}
      <div
        className="absolute top-1/2 -left-1 w-3 h-6 -translate-y-1/2 bg-primary cursor-ew-resize"
        onMouseDown={(e) => handleResizeStart(e, "left")}
      />
      <div
        className="absolute top-1/2 -right-1 w-3 h-6 -translate-y-1/2 bg-primary cursor-ew-resize"
        onMouseDown={(e) => handleResizeStart(e, "right")}
      />
      <div
        className="absolute -top-1 left-1/2 w-6 h-3 -translate-x-1/2 bg-primary cursor-ns-resize"
        onMouseDown={(e) => handleResizeStart(e, "top")}
      />
      <div
        className="absolute -bottom-1 left-1/2 w-6 h-3 -translate-x-1/2 bg-primary cursor-ns-resize"
        onMouseDown={(e) => handleResizeStart(e, "bottom")}
      />
      
      {/* Rotation handle */}
      <div
        className="absolute -top-8 left-1/2 -translate-x-1/2 w-6 h-6 bg-primary rounded-full cursor-grab hover:cursor-grabbing flex items-center justify-center"
        onMouseDown={handleRotateStart}
      >
        <RotateCw className="w-4 h-4 text-primary-foreground" />
      </div>
      
      {/* Effect indicator */}
      {hasEffects && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-purple-500/20 rounded text-xs text-purple-300">
          ✨ Effects Applied
        </div>
      )}
    </div>
  );
}