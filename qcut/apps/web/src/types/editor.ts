/** Types of background fill options for video canvas */
export type BackgroundType = "blur" | "mirror" | "color";

/** Canvas dimensions for video projects */
export interface CanvasSize {
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
}

/** Canvas sizing mode determining how dimensions are set */
export type CanvasMode = "preset" | "original" | "custom";

/** Predefined canvas size preset (e.g., 16:9, 9:16, 1:1) */
export interface CanvasPreset {
  /** Display name of the preset (e.g., "16:9", "9:16") */
  name: string;
  /** Preset width in pixels */
  width: number;
  /** Preset height in pixels */
  height: number;
}

/**
 * State interface for text element drag operations in the preview canvas
 * Tracks all necessary coordinates and dimensions during drag interactions
 */
export interface TextElementDragState {
  /** Whether a drag operation is currently active */
  isDragging: boolean;
  /** ID of the element being dragged */
  elementId: string | null;
  /** ID of the track containing the dragged element */
  trackId: string | null;
  /** Initial mouse X position when drag started */
  startX: number;
  /** Initial mouse Y position when drag started */
  startY: number;
  /** Initial element X position when drag started */
  initialElementX: number;
  /** Initial element Y position when drag started */
  initialElementY: number;
  /** Current mouse X position during drag */
  currentX: number;
  /** Current mouse Y position during drag */
  currentY: number;
  /** Width of the element being dragged */
  elementWidth: number;
  /** Height of the element being dragged */
  elementHeight: number;
}
