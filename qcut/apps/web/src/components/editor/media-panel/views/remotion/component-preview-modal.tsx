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

  // Set up Player event listeners for play/pause/frameupdate
  // The Remotion Player uses addEventListener on the ref, not props
  useEffect(() => {
    if (!component || error) return;

    const player = playerRef.current;
    if (!player) {
      // Player not yet mounted, try again after a short delay
      const timer = setTimeout(() => {
        if (playerRef.current) {
          setIsLoading(false);
        }
      }, 100);
      return () => clearTimeout(timer);
    }

    // Player is ready
    setIsLoading(false);

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onFrameUpdate = (e: { detail: { frame: number } }) => {
      setCurrentFrame(e.detail.frame);
    };
    const onError = (e: { detail: { error: Error } }) => {
      setError(e.detail.error.message);
      setIsLoading(false);
    };

    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("ended", onEnded);
    player.addEventListener("frameupdate", onFrameUpdate);
    player.addEventListener("error", onError);

    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("ended", onEnded);
      player.removeEventListener("frameupdate", onFrameUpdate);
      player.removeEventListener("error", onError);
    };
  }, [component, error]);

  // Handle play/pause
  const togglePlay = useCallback(() => {
    if (!playerRef.current) return;

    if (isPlaying) {
      playerRef.current.pause();
    } else {
      playerRef.current.play();
    }
    // Note: isPlaying state is updated via event listeners above
  }, [isPlaying]);

  // Handle restart
  const handleRestart = useCallback(() => {
    if (!playerRef.current) return;
    playerRef.current.seekTo(0);
    playerRef.current.pause();
    // Note: frame and playing state are updated via event listeners
  }, []);

  // Handle seek
  const handleSeek = useCallback((value: number[]) => {
    if (!playerRef.current || !component) return;
    const frame = Math.round(value[0]);
    playerRef.current.seekTo(frame);
    // Note: frame state is updated via frameupdate event listener
  }, [component]);

  // Handle add to timeline
  const handleAdd = useCallback(() => {
    if (!component || !onAdd) return;
    onAdd(component);
    onOpenChange(false);
  }, [component, onAdd, onOpenChange]);

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
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/80 z-10"
              role="status"
              aria-label="Loading preview"
            >
              <Loader2 className="h-8 w-8 animate-spin text-violet-400" aria-hidden="true" />
              <span className="sr-only">Loading preview...</span>
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
              // Events are handled via playerRef.current.addEventListener()
              // in the useEffect above (play, pause, ended, frameupdate, error)
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
              aria-label="Seek position"
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
              type="button"
              onClick={handleRestart}
              disabled={!!error}
              className="gap-1"
              aria-label="Restart"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              type="button"
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
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onAdd && (
            <Button type="button" onClick={handleAdd} className="gap-1">
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
