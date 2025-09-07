import { useState } from "react";
import { cn } from "@/lib/utils";
import { useEffectsStore } from "@/stores/effects-store";
import { toast } from "sonner";
import { EFFECTS_ENABLED } from "@/config/features";
import type { TimelineElement } from "@/types/timeline";
import type { EffectPreset } from "@/types/effects";

interface TimelineElementDropZoneProps {
  element: TimelineElement;
  children: React.ReactNode;
  className?: string;
}

export function TimelineElementDropZone({ 
  element, 
  children, 
  className 
}: TimelineElementDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const { applyEffect } = useEffectsStore();

  if (!EFFECTS_ENABLED) {
    return <>{children}</>;
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if it's an effect being dragged
    const data = e.dataTransfer.types.includes('application/json');
    if (data) {
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if we're leaving the element entirely
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const parsed = JSON.parse(data);
        
        if (parsed.type === 'effect' && parsed.preset) {
          const preset = parsed.preset as EffectPreset;
          applyEffect(element.id, preset);
          toast.success(`Applied ${preset.name} effect to element`);
        }
      }
    } catch (error) {
      console.error('Failed to handle drop:', error);
      toast.error('Failed to apply effect');
    }
  };

  return (
    <div
      className={cn(
        "relative",
        isDragOver && "ring-2 ring-primary ring-offset-1",
        className
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      
      {/* Drop zone overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-primary/20 pointer-events-none flex items-center justify-center z-10">
          <div className="bg-background/90 rounded-md px-3 py-1 text-xs font-medium">
            Drop to apply effect
          </div>
        </div>
      )}
    </div>
  );
}