/**
 * Component Preview Modal
 *
 * Modal dialog for previewing Remotion components before adding to timeline.
 * Shows a live preview of the component with its default props.
 *
 * @module components/editor/media-panel/views/remotion/component-preview-modal
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import {
  AlertCircle,
  Layers,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { RemotionComponentDefinition } from "@/lib/remotion/types";

// ============================================================================
// Types
// ============================================================================

export interface ComponentPreviewModalProps {
  /** The component to preview */
  component: RemotionComponentDefinition | null;
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal is closed */
  onOpenChange: (open: boolean) => void;
  /** Callback when user wants to add the component to timeline */
  onAdd?: (component: RemotionComponentDefinition) => void;
}

// ============================================================================
// Component Preview Modal
// ============================================================================

export function ComponentPreviewModal({
  component,
  open,
  onOpenChange,
  onAdd,
}: ComponentPreviewModalProps) {
  const playerRef = useRef<PlayerRef>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset state when component changes
  useEffect(() => {
    if (component) {
      setCurrentFrame(0);
      setIsPlaying(false);
      setIsLoading(true);
      setError(null);
    }
  }, [component?.id]);

  // Handle play/pause
  const togglePlay = useCallback(() => {
    if (!playerRef.current) return;

    if (isPlaying) {
      playerRef.current.pause();
    } else {
      playerRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  // Handle restart
  const handleRestart = useCallback(() => {
    if (!playerRef.current) return;
    playerRef.current.seekTo(0);
    setCurrentFrame(0);
    setIsPlaying(false);
    playerRef.current.pause();
  }, []);

  // Handle seek
  const handleSeek = useCallback((value: number[]) => {
    if (!playerRef.current || !component) return;
    const frame = Math.round(value[0]);
    playerRef.current.seekTo(frame);
    setCurrentFrame(frame);
  }, [component]);

  // Handle add to timeline
  const handleAdd = useCallback(() => {
    if (!component || !onAdd) return;
    onAdd(component);
    onOpenChange(false);
  }, [component, onAdd, onOpenChange]);

  // Handle player ready
  const handlePlayerReady = useCallback(() => {
    setIsLoading(false);
  }, []);

  // Handle player error
  const handlePlayerError = useCallback((err: Error) => {
    setError(err.message);
    setIsLoading(false);
  }, []);

  // Handle frame change
  const handleFrameChange = useCallback((frame: number) => {
    setCurrentFrame(frame);
  }, []);

  if (!component) return null;

  const durationSeconds = (component.durationInFrames / component.fps).toFixed(2);
  const currentSeconds = (currentFrame / component.fps).toFixed(2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-violet-400" />
            {component.name}
          </DialogTitle>
          <DialogDescription>
            {component.description || "Preview this Remotion component before adding to your timeline."}
          </DialogDescription>
        </DialogHeader>

        {/* Preview Player */}
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 text-center p-4">
              <AlertCircle className="h-8 w-8 text-red-400 mb-2" />
              <p className="text-sm text-red-400">Failed to load preview</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
            </div>
          )}

          {!error && (
            <Player
              ref={playerRef}
              component={component.component}
              inputProps={component.defaultProps}
              durationInFrames={component.durationInFrames}
              compositionWidth={component.width}
              compositionHeight={component.height}
              fps={component.fps}
              style={{
                width: "100%",
                height: "100%",
              }}
              controls={false}
              loop
              autoPlay={false}
              // Note: These events may not be available in all versions
              // onPlay={() => setIsPlaying(true)}
              // onPause={() => setIsPlaying(false)}
              // onEnded={() => setIsPlaying(false)}
            />
          )}
        </div>

        {/* Playback Controls */}
        <div className="space-y-3">
          {/* Progress Bar */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-12">
              {currentSeconds}s
            </span>
            <Slider
              value={[currentFrame]}
              min={0}
              max={component.durationInFrames - 1}
              step={1}
              onValueChange={handleSeek}
              className="flex-1"
              disabled={!!error}
            />
            <span className="text-xs text-muted-foreground w-12 text-right">
              {durationSeconds}s
            </span>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRestart}
              disabled={!!error}
              className="gap-1"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={togglePlay}
              disabled={!!error}
              className="gap-1 min-w-[80px]"
            >
              {isPlaying ? (
                <>
                  <Pause className="h-4 w-4" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Play
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Component Info */}
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary" className="gap-1">
            {component.width}×{component.height}
          </Badge>
          <Badge variant="secondary" className="gap-1">
            {component.fps} fps
          </Badge>
          <Badge variant="secondary" className="gap-1">
            {component.durationInFrames} frames
          </Badge>
          <Badge variant="secondary" className="gap-1 capitalize">
            {component.category}
          </Badge>
          {component.source && (
            <Badge variant="outline" className="gap-1 capitalize">
              {component.source}
            </Badge>
          )}
        </div>

        {/* Tags */}
        {component.tags && component.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {component.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onAdd && (
            <Button onClick={handleAdd} className="gap-1">
              <Plus className="h-4 w-4" />
              Add to Timeline
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ComponentPreviewModal;
