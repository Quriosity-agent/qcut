"use client";

import { useState, useRef, useCallback } from "react";
import { useEffectsStore } from "@/stores/effects-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { usePlaybackStore } from "@/stores/playback-store";
import { cn } from "@/lib/utils";
import { 
  Diamond, 
  Plus, 
  Trash2, 
  Play, 
  Pause,
  SkipBack,
  SkipForward 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AnimatedParameter, EffectKeyframe, EffectParameters } from "@/types/effects";
import { 
  addKeyframe, 
  removeKeyframe, 
  updateKeyframe,
  createTransition 
} from "@/lib/effects-keyframes";

interface KeyframeTimelineProps {
  elementId: string;
  effectId: string;
  duration: number;
  className?: string;
}

export function KeyframeTimeline({
  elementId,
  effectId,
  duration,
  className,
}: KeyframeTimelineProps) {
  const { getElementEffects, updateEffectAnimations } = useEffectsStore();
  const { currentTime, isPlaying, toggle, setCurrentTime } = usePlaybackStore();
  const timelineRef = useRef<HTMLDivElement>(null);
  
  const [selectedParameter, setSelectedParameter] = useState<keyof EffectParameters>("brightness");
  const [selectedKeyframe, setSelectedKeyframe] = useState<EffectKeyframe | null>(null);
  const [zoom, setZoom] = useState(100);
  const [isDragging, setIsDragging] = useState(false);
  
  const effects = getElementEffects(elementId);
  const effect = effects.find(e => e.id === effectId);
  
  if (!effect) return null;
  
  const animation = effect.animations?.find(a => a.parameter === selectedParameter);
  const pixelsPerSecond = (zoom / 100) * 50;
  const timelineWidth = duration * pixelsPerSecond;
  
  // Add keyframe at current time
  const handleAddKeyframe = useCallback(() => {
    const value = effect.parameters[selectedParameter] || 0;
    
    if (animation) {
      const updatedAnimation = addKeyframe(animation, currentTime, value as number);
      updateEffectAnimations(elementId, effectId, updatedAnimation);
    } else {
      // Create new animation
      const newAnimation: AnimatedParameter = {
        parameter: selectedParameter,
        keyframes: [{ time: currentTime, value: value as number }],
        interpolation: "linear",
      };
      updateEffectAnimations(elementId, effectId, newAnimation);
    }
  }, [animation, currentTime, effect.parameters, selectedParameter, elementId, effectId, updateEffectAnimations]);
  
  // Remove selected keyframe
  const handleRemoveKeyframe = useCallback(() => {
    if (!selectedKeyframe || !animation) return;
    
    const updatedAnimation = removeKeyframe(animation, selectedKeyframe.time);
    if (updatedAnimation.keyframes.length > 0) {
      updateEffectAnimations(elementId, effectId, updatedAnimation);
    } else {
      // Remove animation if no keyframes left
      updateEffectAnimations(elementId, effectId, null);
    }
    setSelectedKeyframe(null);
  }, [selectedKeyframe, animation, elementId, effectId, updateEffectAnimations]);
  
  // Update keyframe value
  const handleUpdateKeyframe = useCallback((value: number) => {
    if (!selectedKeyframe || !animation) return;
    
    const updatedAnimation = updateKeyframe(animation, selectedKeyframe.time, value);
    updateEffectAnimations(elementId, effectId, updatedAnimation);
    setSelectedKeyframe({ ...selectedKeyframe, value });
  }, [selectedKeyframe, animation, elementId, effectId, updateEffectAnimations]);
  
  // Apply preset transition
  const handleApplyTransition = useCallback((type: "fade-in" | "fade-out" | "pulse" | "bounce") => {
    const transition = createTransition(selectedParameter, type, duration);
    updateEffectAnimations(elementId, effectId, transition);
  }, [selectedParameter, duration, elementId, effectId, updateEffectAnimations]);
  
  // Handle keyframe dragging
  const handleKeyframeDrag = useCallback((keyframe: EffectKeyframe, e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setSelectedKeyframe(keyframe);
    
    const startX = e.clientX;
    const startTime = keyframe.time;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!timelineRef.current) return;
      
      const deltaX = moveEvent.clientX - startX;
      const deltaTime = deltaX / pixelsPerSecond;
      const newTime = Math.max(0, Math.min(duration, startTime + deltaTime));
      
      if (animation) {
        // Update keyframe time
        const updatedKeyframes = animation.keyframes.map(kf =>
          kf === keyframe ? { ...kf, time: newTime } : kf
        );
        const updatedAnimation = { ...animation, keyframes: updatedKeyframes };
        updateEffectAnimations(elementId, effectId, updatedAnimation);
      }
    };
    
    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [animation, duration, pixelsPerSecond, elementId, effectId, updateEffectAnimations]);
  
  // Navigate between keyframes
  const navigateToKeyframe = useCallback((direction: "prev" | "next") => {
    if (!animation) return;
    
    const sortedKeyframes = [...animation.keyframes].sort((a, b) => a.time - b.time);
    let targetKeyframe: EffectKeyframe | null = null;
    
    if (direction === "prev") {
      targetKeyframe = sortedKeyframes
        .reverse()
        .find(kf => kf.time < currentTime) || sortedKeyframes[sortedKeyframes.length - 1];
    } else {
      targetKeyframe = sortedKeyframes
        .find(kf => kf.time > currentTime) || sortedKeyframes[0];
    }
    
    if (targetKeyframe) {
      setCurrentTime(targetKeyframe.time);
      setSelectedKeyframe(targetKeyframe);
    }
  }, [animation, currentTime, setCurrentTime]);
  
  return (
    <div className={cn("space-y-4 p-4 bg-background border rounded", className)}>
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {/* Parameter selector */}
          <Select
            value={selectedParameter}
            onValueChange={(value) => setSelectedParameter(value as keyof EffectParameters)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(effect.parameters).map(param => (
                <SelectItem key={param} value={param}>
                  {param.charAt(0).toUpperCase() + param.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {/* Playback controls */}
          <Button size="icon" variant="text" onClick={() => navigateToKeyframe("prev")}>
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="text" onClick={toggle}>
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button size="icon" variant="text" onClick={() => navigateToKeyframe("next")}>
            <SkipForward className="h-4 w-4" />
          </Button>
          
          {/* Keyframe actions */}
          <Button size="sm" variant="outline" onClick={handleAddKeyframe}>
            <Plus className="h-4 w-4 mr-1" />
            Add Keyframe
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleRemoveKeyframe}
            disabled={!selectedKeyframe}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Remove
          </Button>
        </div>
        
        {/* Zoom control */}
        <div className="flex items-center space-x-2">
          <span className="text-sm">Zoom:</span>
          <Slider
            value={[zoom]}
            onValueChange={([value]) => setZoom(value)}
            min={50}
            max={200}
            step={10}
            className="w-32"
          />
          <span className="text-sm">{zoom}%</span>
        </div>
      </div>
      
      {/* Transition presets */}
      <div className="flex space-x-2">
        <span className="text-sm">Quick Transitions:</span>
        <Button size="sm" variant="text" onClick={() => handleApplyTransition("fade-in")}>
          Fade In
        </Button>
        <Button size="sm" variant="text" onClick={() => handleApplyTransition("fade-out")}>
          Fade Out
        </Button>
        <Button size="sm" variant="text" onClick={() => handleApplyTransition("pulse")}>
          Pulse
        </Button>
        <Button size="sm" variant="text" onClick={() => handleApplyTransition("bounce")}>
          Bounce
        </Button>
      </div>
      
      {/* Timeline */}
      <div className="relative overflow-x-auto">
        <div
          ref={timelineRef}
          className="relative h-16 bg-muted rounded"
          style={{ width: `${timelineWidth}px` }}
        >
          {/* Time ruler */}
          <div className="absolute top-0 left-0 right-0 h-4 border-b">
            {Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => (
              <div
                key={i}
                className="absolute top-0 text-xs text-muted-foreground"
                style={{ left: `${i * pixelsPerSecond}px` }}
              >
                {i}s
              </div>
            ))}
          </div>
          
          {/* Keyframes */}
          {animation?.keyframes.map((keyframe, index) => (
            <TooltipProvider key={index}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "absolute top-6 w-4 h-4 -ml-2 cursor-pointer",
                      selectedKeyframe === keyframe && "ring-2 ring-primary"
                    )}
                    style={{ left: `${keyframe.time * pixelsPerSecond}px` }}
                    onMouseDown={(e) => handleKeyframeDrag(keyframe, e)}
                    onClick={() => setSelectedKeyframe(keyframe)}
                  >
                    <Diamond 
                      className={cn(
                        "w-4 h-4",
                        selectedKeyframe === keyframe ? "text-primary fill-primary" : "text-foreground fill-foreground"
                      )}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-xs">
                    <div>Time: {keyframe.time.toFixed(2)}s</div>
                    <div>Value: {keyframe.value}</div>
                    {keyframe.easing && <div>Easing: {keyframe.easing}</div>}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
          
          {/* Playhead */}
          <div
            className="absolute top-4 bottom-0 w-0.5 bg-primary pointer-events-none"
            style={{ left: `${currentTime * pixelsPerSecond}px` }}
          />
        </div>
      </div>
      
      {/* Selected keyframe editor */}
      {selectedKeyframe && (
        <div className="p-3 bg-muted rounded space-y-2">
          <div className="text-sm font-medium">Keyframe at {selectedKeyframe.time.toFixed(2)}s</div>
          <div className="flex items-center space-x-2">
            <span className="text-sm">Value:</span>
            <Slider
              value={[selectedKeyframe.value]}
              onValueChange={([value]) => handleUpdateKeyframe(value)}
              min={-100}
              max={100}
              step={1}
              className="flex-1"
            />
            <span className="text-sm w-12">{selectedKeyframe.value}</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm">Easing:</span>
            <Select
              value={selectedKeyframe.easing || "linear"}
              onValueChange={(value) => {
                const updatedKeyframe = { ...selectedKeyframe, easing: value as EffectKeyframe["easing"] };
                if (animation) {
                  const updatedKeyframes = animation.keyframes.map(kf =>
                    kf === selectedKeyframe ? updatedKeyframe : kf
                  );
                  updateEffectAnimations(elementId, effectId, { ...animation, keyframes: updatedKeyframes });
                }
                setSelectedKeyframe(updatedKeyframe);
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="linear">Linear</SelectItem>
                <SelectItem value="ease-in">Ease In</SelectItem>
                <SelectItem value="ease-out">Ease Out</SelectItem>
                <SelectItem value="ease-in-out">Ease In-Out</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}