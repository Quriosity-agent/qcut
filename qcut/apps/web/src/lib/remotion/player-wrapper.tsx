/**
 * Remotion Player Wrapper Component
 *
 * Wraps @remotion/player to integrate with QCut's timeline and playback system.
 * Provides imperative controls, frame synchronization, and canvas extraction
 * for compositing with native QCut elements.
 *
 * @module lib/remotion/player-wrapper
 */

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { useRemotionStore } from "@/stores/remotion-store";
import type { RemotionComponentDefinition } from "./types";
import { debugLog } from "@/lib/debug-config";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the RemotionPlayerWrapper component
 */
export interface RemotionPlayerWrapperProps {
  /** ID of the timeline element this player belongs to */
  elementId: string;
  /** The Remotion component definition to render */
  component: RemotionComponentDefinition;
  /** Props to pass to the Remotion component */
  inputProps: Record<string, unknown>;
  /** Current frame to display (for seeking) */
  currentFrame?: number;
  /** Whether playback is active */
  isPlaying?: boolean;
  /** Playback rate multiplier */
  playbackRate?: number;
  /** Override width (defaults to component width) */
  width?: number;
  /** Override height (defaults to component height) */
  height?: number;
  /** Override FPS (defaults to component fps) */
  fps?: number;
  /** Override duration (defaults to component durationInFrames) */
  durationInFrames?: number;
  /** Whether to show player controls */
  showControls?: boolean;
  /** Whether the player should loop */
  loop?: boolean;
  /** Callback when frame changes */
  onFrameUpdate?: (frame: number) => void;
  /** Callback when playback ends */
  onEnded?: () => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Callback when player is ready */
  onReady?: () => void;
  /** Additional className for styling */
  className?: string;
  /** Additional style object */
  style?: React.CSSProperties;
}

/**
 * Imperative handle for controlling the player
 */
export interface RemotionPlayerHandle {
  /** Seek to a specific frame */
  seekTo: (frame: number) => void;
  /** Start playback */
  play: () => void;
  /** Pause playback */
  pause: () => void;
  /** Toggle playback */
  toggle: () => void;
  /** Get current frame */
  getCurrentFrame: () => number;
  /** Check if currently playing */
  isPlaying: () => boolean;
  /**
   * Set playback rate (NOT SUPPORTED)
   * @deprecated Remotion Player does not support runtime playback rate changes.
   * This method is a no-op and only logs a warning.
   */
  setPlaybackRate: (rate: number) => void;
  /** Get the underlying PlayerRef */
  getPlayerRef: () => PlayerRef | null;
  /** Extract current frame as ImageBitmap for compositing */
  extractFrame: () => Promise<ImageBitmap | null>;
}

// ============================================================================
// Component
// ============================================================================

/**
 * RemotionPlayerWrapper - Integrates Remotion Player with QCut
 *
 * This component wraps the Remotion Player and provides:
 * - Imperative control API via ref
 * - Frame synchronization with QCut timeline
 * - Instance registration with Remotion store
 * - Frame extraction for compositing
 */
export const RemotionPlayerWrapper = forwardRef<
  RemotionPlayerHandle,
  RemotionPlayerWrapperProps
>(function RemotionPlayerWrapper(
  {
    elementId,
    component,
    inputProps,
    currentFrame,
    isPlaying = false,
    playbackRate = 1,
    width,
    height,
    fps,
    durationInFrames,
    showControls = false,
    loop = false,
    onFrameUpdate,
    onEnded,
    onError,
    onReady,
    className,
    style,
  },
  ref
) {
  // Refs
  const playerRef = useRef<PlayerRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastFrameRef = useRef<number>(0);

  // Track when player is mounted (for triggering ready callback)
  const [isPlayerMounted, setIsPlayerMounted] = useState(false);

  // Debug: Log on mount
  useEffect(() => {
    debugLog("[REMOTION] PlayerWrapper mounted", {
      elementId,
      componentId: component?.id,
      componentType: typeof component?.component,
      dimensions: { width: component?.width, height: component?.height },
    });
  }, [
    elementId,
    component?.id,
    component?.component,
    component?.width,
    component?.height,
  ]);

  // Store actions
  const setInstancePlayerRef = useRemotionStore(
    (state) => state.setInstancePlayerRef
  );
  const createInstance = useRemotionStore((state) => state.createInstance);
  const destroyInstance = useRemotionStore((state) => state.destroyInstance);
  const updateInstanceProps = useRemotionStore(
    (state) => state.updateInstanceProps
  );

  // Computed values
  // IMPORTANT: compositionWidth/Height must be the component's native dimensions
  // for positioning/scaling to work correctly. The display size is controlled
  // by the container and style props.
  const compositionWidth = component.width;
  const compositionHeight = component.height;
  // Display dimensions - what size to render at
  const displayWidth = width ?? component.width;
  const displayHeight = height ?? component.height;
  const effectiveFps = fps ?? component.fps;
  const effectiveDuration = durationInFrames ?? component.durationInFrames;

  // ========================================================================
  // Instance Lifecycle
  // ========================================================================

  useEffect(() => {
    // Create instance when component mounts
    createInstance(elementId, component.id, inputProps);

    return () => {
      // Destroy instance when component unmounts
      destroyInstance(elementId);
    };
  }, [elementId, component.id, createInstance, destroyInstance, inputProps]);

  // Register player ref with store
  useEffect(() => {
    setInstancePlayerRef(elementId, playerRef.current);
  }, [elementId, setInstancePlayerRef]);

  // Update props in store when they change
  useEffect(() => {
    updateInstanceProps(elementId, inputProps);
  }, [elementId, inputProps, updateInstanceProps]);

  // ========================================================================
  // Playback Control
  // ========================================================================

  // Handle external frame seeking
  useEffect(() => {
    if (currentFrame !== undefined && playerRef.current) {
      playerRef.current.seekTo(currentFrame);
    }
  }, [currentFrame]);

  // Handle external play state
  useEffect(() => {
    if (playerRef.current) {
      if (isPlaying) {
        playerRef.current.play();
      } else {
        playerRef.current.pause();
      }
    }
  }, [isPlaying]);

  // ========================================================================
  // Event Handlers
  // ========================================================================

  const handleFrameChange = useCallback(
    (e: { detail: { frame: number } }) => {
      const frame = e.detail.frame;
      if (frame !== lastFrameRef.current) {
        lastFrameRef.current = frame;
        onFrameUpdate?.(frame);
      }
    },
    [onFrameUpdate]
  );

  const handleEnded = useCallback(() => {
    onEnded?.();
  }, [onEnded]);

  const handleError = useCallback(
    (e: { detail: { error: Error } }) => {
      onError?.(e.detail.error);
    },
    [onError]
  );

  // Detect when player ref becomes available
  useEffect(() => {
    // Use a small delay to ensure the Player has mounted and set its ref
    const checkRef = () => {
      debugLog("[REMOTION] Checking playerRef", {
        hasRef: !!playerRef.current,
        isPlayerMounted,
      });

      if (playerRef.current && !isPlayerMounted) {
        debugLog("[REMOTION] Player mounted");
        setIsPlayerMounted(true);
      }
    };

    // Check immediately
    checkRef();

    // Also check after a short delay (Player might set ref async)
    const timer = setTimeout(checkRef, 50);

    return () => clearTimeout(timer);
  }, [isPlayerMounted]);

  // Subscribe to player events once mounted
  useEffect(() => {
    if (!isPlayerMounted) {
      debugLog("[REMOTION] Waiting for player mount...");
      return;
    }

    const player = playerRef.current;
    if (!player) {
      debugLog("[REMOTION] Player ref still null after mount flag");
      return;
    }

    debugLog("[REMOTION] Setting up event listeners");

    // Listen for frame updates - use Remotion's callback listener types
    const frameListener = (data: { detail: { frame: number } }) => {
      handleFrameChange(data);
    };

    const endedListener = () => {
      handleEnded();
    };

    const errorListener = (data: { detail: { error: Error } }) => {
      handleError(data);
    };

    // Remotion's PlayerRef uses its own event system with typed callbacks
    // Cast to any to work around strict type checking
    const p = player as unknown as {
      addEventListener: (event: string, cb: (data: unknown) => void) => void;
      removeEventListener: (event: string, cb: (data: unknown) => void) => void;
    };

    p.addEventListener("frameupdate", frameListener as (data: unknown) => void);
    p.addEventListener("ended", endedListener);
    p.addEventListener("error", errorListener as (data: unknown) => void);

    // Notify ready
    debugLog("[REMOTION] Calling onReady callback");
    onReady?.();

    return () => {
      p.removeEventListener(
        "frameupdate",
        frameListener as (data: unknown) => void
      );
      p.removeEventListener("ended", endedListener);
      p.removeEventListener("error", errorListener as (data: unknown) => void);
    };
  }, [isPlayerMounted, handleFrameChange, handleEnded, handleError, onReady]);

  // ========================================================================
  // Imperative Handle
  // ========================================================================

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (frame: number) => {
        playerRef.current?.seekTo(frame);
      },

      play: () => {
        playerRef.current?.play();
      },

      pause: () => {
        playerRef.current?.pause();
      },

      toggle: () => {
        playerRef.current?.toggle();
      },

      getCurrentFrame: () => {
        return lastFrameRef.current;
      },

      isPlaying: () => {
        return playerRef.current?.isPlaying() ?? false;
      },

      setPlaybackRate: (_rate: number) => {
        // Remotion Player does not support runtime playback rate changes.
        // The playbackRate prop only exists on media components (<Video>, <Audio>)
        // to control media speed within the composition, not on the Player itself.
        console.warn(
          "[RemotionPlayerWrapper] setPlaybackRate is not supported. " +
            "Remotion Player does not have a playbackRate prop."
        );
      },

      getPlayerRef: () => {
        return playerRef.current;
      },

      extractFrame: async () => {
        // Extract the current frame as an ImageBitmap
        // This is used for compositing Remotion content with QCut canvas
        const container = containerRef.current;
        if (!container) return null;

        try {
          // Find the canvas element within the player
          const canvas = container.querySelector("canvas");
          if (!canvas) {
            // If no canvas, try to capture the container as an image
            // This is a fallback for DOM-based Remotion components
            return null;
          }

          // Create ImageBitmap from the canvas
          const bitmap = await createImageBitmap(canvas);
          return bitmap;
        } catch (error) {
          console.error("Failed to extract frame:", error);
          return null;
        }
      },
    }),
    []
  );

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: displayWidth,
        height: displayHeight,
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      <Player
        ref={playerRef}
        component={component.component}
        inputProps={inputProps}
        durationInFrames={effectiveDuration}
        fps={effectiveFps}
        compositionWidth={compositionWidth}
        compositionHeight={compositionHeight}
        controls={showControls}
        loop={loop}
        playbackRate={playbackRate}
        initialFrame={currentFrame ?? 0}
        acknowledgeRemotionLicense
        style={{
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
});

// ============================================================================
// Utility Components
// ============================================================================

/**
 * Loading placeholder shown while component loads
 */
export function RemotionPlayerLoading({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#1a1a2e",
        color: "#8b8ba7",
        fontSize: 14,
      }}
    >
      Loading Remotion component...
    </div>
  );
}

/**
 * Error placeholder shown when component fails to load
 */
export function RemotionPlayerError({
  width,
  height,
  error,
  onRetry,
}: {
  width: number;
  height: number;
  error: Error;
  onRetry?: () => void;
}) {
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#2d1b1b",
        color: "#ff6b6b",
        fontSize: 14,
        padding: 16,
        textAlign: "center",
      }}
    >
      <div style={{ marginBottom: 8 }}>Failed to load Remotion component</div>
      <div style={{ fontSize: 12, color: "#ff9999", marginBottom: 16 }}>
        {error.message}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: "8px 16px",
            backgroundColor: "#4a3030",
            border: "1px solid #ff6b6b",
            borderRadius: 4,
            color: "#ff6b6b",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

export default RemotionPlayerWrapper;
