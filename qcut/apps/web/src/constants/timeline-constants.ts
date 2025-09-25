import type { TrackType } from "@/types/timeline";

// Track color definitions
export const TRACK_COLORS: Record<
  TrackType,
  { solid: string; background: string; border: string }
> = {
  media: {
    solid: "bg-blue-500",
    background: "bg-blue-500/20",
    border: "border-white/80",
  },
  text: {
    solid: "bg-[#9C4937]",
    background: "bg-[#9C4937]",
    border: "border-white/80",
  },
  audio: {
    solid: "bg-green-500",
    background: "bg-green-500/20",
    border: "border-white/80",
  },
  sticker: {
    solid: "bg-purple-500",
    background: "bg-purple-500/20",
    border: "border-white/80",
  },
  captions: {
    solid: "bg-yellow-500",
    background: "bg-yellow-500/20",
    border: "border-white/80",
  },
} as const;

// Utility functions
/**
 * Centralized color theming to ensure visual consistency across track types.
 * Each track type has distinct colors to help users quickly identify content types
 * when working with complex timelines containing multiple media elements.
 */
export function getTrackColors(type: TrackType) {
  return TRACK_COLORS[type];
}

/**
 * Pre-computed class combinations for performance - avoids string concatenation
 * in render loops. The background/border combination creates the visual "lane"
 * effect that users expect from professional video editing software.
 */
export function getTrackElementClasses(type: TrackType) {
  const colors = getTrackColors(type);
  return `${colors.background} ${colors.border}`;
}

// Track height definitions
export const TRACK_HEIGHTS: Record<TrackType, number> = {
  media: 65,
  text: 25,
  audio: 50,
  sticker: 40,
  captions: 30,
} as const;

/**
 * Gets the height in pixels for a specific track type
 * @param type - The track type to get height for
 * @returns Height in pixels
 */
export function getTrackHeight(type: TrackType): number {
  return TRACK_HEIGHTS[type];
}

/**
 * Calculates cumulative height up to (but not including) a specific track index
 * @param tracks - Array of track objects with type property
 * @param trackIndex - Index of the track to calculate height before
 * @returns Total height in pixels before the specified track index
 */
export function getCumulativeHeightBefore(
  tracks: Array<{ type: TrackType }>,
  trackIndex: number
): number {
  const GAP = 4; // 4px gap between tracks (equivalent to Tailwind's gap-1)
  return tracks
    .slice(0, trackIndex)
    .reduce((sum, track) => sum + getTrackHeight(track.type) + GAP, 0);
}

/**
 * Calculates the total height of all tracks including gaps
 * @param tracks - Array of track objects with type property
 * @returns Total height in pixels including inter-track gaps
 */
export function getTotalTracksHeight(
  tracks: Array<{ type: TrackType }>
): number {
  const GAP = 4; // 4px gap between tracks (equivalent to Tailwind's gap-1)
  const tracksHeight = tracks.reduce(
    (sum, track) => sum + getTrackHeight(track.type),
    0
  );
  const gapsHeight = Math.max(0, tracks.length - 1) * GAP; // n-1 gaps for n tracks
  return tracksHeight + gapsHeight;
}

// Other timeline constants
export const TIMELINE_CONSTANTS = {
  ELEMENT_MIN_WIDTH: 80,
  PIXELS_PER_SECOND: 50,
  TRACK_HEIGHT: 60, // Default fallback
  DEFAULT_TEXT_DURATION: 5,
  DEFAULT_IMAGE_DURATION: 5,
  DEFAULT_EMPTY_TIMELINE_DURATION: 20, // Default duration for empty timeline
  ZOOM_LEVELS: [0.25, 0.5, 1, 1.5, 2, 3, 4],
} as const;

// FPS presets for project settings
export const FPS_PRESETS = [
  { value: "24", label: "24 fps" },
  { value: "25", label: "25 fps" },
  { value: "30", label: "30 fps" },
  { value: "60", label: "60 fps" },
  { value: "120", label: "120 fps" },
] as const;

// Frame snapping utilities
/**
 * Converts time in seconds to frame number based on FPS
 * @param time - Time in seconds
 * @param fps - Frames per second
 * @returns Frame number (rounded to nearest integer)
 */
export function timeToFrame(time: number, fps: number): number {
  return Math.round(time * fps);
}

/**
 * Converts frame number to time in seconds based on FPS
 * @param frame - Frame number
 * @param fps - Frames per second
 * @returns Time in seconds
 */
export function frameToTime(frame: number, fps: number): number {
  return frame / fps;
}

/**
 * Snaps a time value to the nearest frame boundary
 * @param time - Time in seconds to snap
 * @param fps - Frames per second for snapping precision
 * @returns Time snapped to nearest frame boundary
 */
export function snapTimeToFrame(time: number, fps: number): number {
  if (fps <= 0) return time; // Fallback for invalid FPS
  const frame = timeToFrame(time, fps);
  return frameToTime(frame, fps);
}

/**
 * Calculates the duration of a single frame in seconds
 * @param fps - Frames per second
 * @returns Duration of one frame in seconds
 */
export function getFrameDuration(fps: number): number {
  return 1 / fps;
}

// Timeline duration utility functions
/**
 * Calculates the minimum timeline duration ensuring adequate workspace
 * @param contentDuration - The actual duration of content on timeline
 * @returns Minimum duration (uses default empty timeline duration for short content)
 */
export function calculateMinimumTimelineDuration(contentDuration: number): number {
  // Always return at least default minimum for empty timeline, but don't limit longer content
  return Math.max(contentDuration, TIMELINE_CONSTANTS.DEFAULT_EMPTY_TIMELINE_DURATION);
}

/**
 * Calculates a flexible timeline buffer for smooth editing experience
 * @param duration - The timeline duration to calculate buffer for
 * @returns Buffer duration (5s minimum or 10% of duration, whichever is greater)
 */
export function calculateTimelineBuffer(duration: number): number {
  // Flexible buffer: 5s minimum or 10% of duration, whichever is greater
  return Math.max(5, duration * 0.1);
}

/**
 * Calculates dynamic timeline duration with configurable minimum
 * @param actualContentDuration - The actual duration of timeline content
 * @param minimumDuration - Minimum duration to enforce (defaults to 1s)
 * @returns Timeline duration ensuring minimum is met
 */
export function calculateDynamicTimelineDuration(
  actualContentDuration: number,
  minimumDuration: number = 1
): number {
  // Dynamic duration with configurable minimum (default 1s instead of 10s)
  return Math.max(actualContentDuration, minimumDuration);
}

/**
 * Validates and constrains export duration to safe bounds
 * @param requestedDuration - The requested export duration in seconds
 * @param maxDuration - Maximum allowed duration (defaults to 600s/10min)
 * @returns Validated duration within safe bounds (0.1s minimum, maxDuration maximum)
 */
export function validateExportDuration(
  requestedDuration: number,
  maxDuration: number = 600 // 10 minutes safety limit
): number {
  // Ensure export duration is within safe bounds
  return Math.min(Math.max(requestedDuration, 0.1), maxDuration);
}
