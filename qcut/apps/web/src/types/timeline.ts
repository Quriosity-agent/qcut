import { MediaType } from "@/stores/media-store";
import { generateUUID } from "@/lib/utils";

/** Valid track types in the video editor timeline */
export type TrackType =
  | "media"
  | "text"
  | "audio"
  | "sticker"
  | "captions"
  | "remotion"
  | "markdown";

/**
 * Base interface for all timeline elements
 * Contains common properties shared across all element types
 */
interface BaseTimelineElement {
  /** Unique identifier for the timeline element */
  id: string;
  /** Display name of the element */
  name: string;
  /** Total duration of the element in seconds */
  duration: number;
  /** Start time position on the timeline in seconds */
  startTime: number;
  /** Amount trimmed from the beginning in seconds */
  trimStart: number;
  /** Amount trimmed from the end in seconds */
  trimEnd: number;
  /** Whether the element is hidden from view */
  hidden?: boolean;
  /** Horizontal position relative to canvas center (for effects/transforms) */
  x?: number;
  /** Vertical position relative to canvas center (for effects/transforms) */
  y?: number;
  /** Element width (for effects/transforms) */
  width?: number;
  /** Element height (for effects/transforms) */
  height?: number;
  /** Rotation angle in degrees (for effects/transforms) */
  rotation?: number;
  /** Array of effect IDs applied to this element */
  effectIds?: string[];
}

/**
 * Media element for video, audio, or image content
 * References a media item stored in the MediaStore
 */
export interface MediaElement extends BaseTimelineElement {
  type: "media";
  /** ID of the media item in MediaStore */
  mediaId: string;
  /** Audio volume level (0-1, default 1 = 100%) */
  volume?: number;
}

/**
 * Text element for displaying styled text overlays
 * Contains all text formatting and positioning properties
 */
export interface TextElement extends BaseTimelineElement {
  type: "text";
  /** Text content to display */
  content: string;
  /** Font size in pixels */
  fontSize: number;
  /** Font family name */
  fontFamily: string;
  /** Text color (CSS color value) */
  color: string;
  /** Background color (CSS color value, 'transparent' for none) */
  backgroundColor: string;
  /** Text alignment within the element */
  textAlign: "left" | "center" | "right";
  /** Font weight (normal or bold) */
  fontWeight: "normal" | "bold";
  /** Font style (normal or italic) */
  fontStyle: "normal" | "italic";
  /** Text decoration style */
  textDecoration: "none" | "underline" | "line-through";
  /** Horizontal position relative to canvas center */
  x: number;
  /** Vertical position relative to canvas center */
  y: number;
  /** Rotation angle in degrees */
  rotation: number;
  /** Opacity level (0-1) */
  opacity: number;
}

/**
 * Sticker element for displaying image stickers/overlays
 * References both sticker data and the underlying media item
 */
export interface StickerElement extends BaseTimelineElement {
  type: "sticker";
  /** ID of the sticker in the stickers overlay store */
  stickerId: string;
  /** ID of the media item containing the sticker image */
  mediaId: string;
}

/**
 * Caption element for subtitles and closed captions
 * Can be generated from transcription or manually created
 */
export interface CaptionElement extends BaseTimelineElement {
  type: "captions";
  /** Caption text content */
  text: string;
  /** Language code (e.g., 'en', 'es', 'fr') */
  language: string;
  /** Transcription confidence level (0-1) */
  confidence?: number;
  /** Source of the caption data */
  source: "transcription" | "manual" | "imported";
}

/**
 * Remotion element for animated React compositions
 * References a Remotion component from the component registry
 */
export interface RemotionElement extends BaseTimelineElement {
  type: "remotion";
  /** ID of the Remotion component in the registry */
  componentId: string;
  /** Optional path to the source .tsx file (for imported components) */
  componentPath?: string;
  /** Props to pass to the Remotion component */
  props: Record<string, unknown>;
  /** Rendering mode: 'live' for preview, 'cached' for export */
  renderMode: "live" | "cached";
  /** Opacity level (0-1) */
  opacity?: number;
  /** Scale factor (1 = 100%) */
  scale?: number;
}

/**
 * Markdown element for rich, long-form text overlays
 */
export interface MarkdownElement extends BaseTimelineElement {
  type: "markdown";
  /** Raw markdown content */
  markdownContent: string;
  /** Visual theme preset */
  theme: "light" | "dark" | "transparent";
  /** Base font size in pixels */
  fontSize: number;
  /** Font family */
  fontFamily: string;
  /** Inner padding in pixels */
  padding: number;
  /** Background color as CSS color string */
  backgroundColor: string;
  /** Foreground text color as CSS color string */
  textColor: string;
  /** Scroll behavior for long content */
  scrollMode: "static" | "auto-scroll";
  /** Scroll speed in pixels/second (auto-scroll only) */
  scrollSpeed: number;
  /** Horizontal position relative to canvas center */
  x: number;
  /** Vertical position relative to canvas center */
  y: number;
  /** Element width */
  width: number;
  /** Element height */
  height: number;
  /** Rotation angle in degrees */
  rotation: number;
  /** Opacity level (0-1) */
  opacity: number;
}

// Typed timeline elements
export type TimelineElement =
  | MediaElement
  | TextElement
  | StickerElement
  | CaptionElement
  | RemotionElement
  | MarkdownElement;

// Creation types (without id, for addElementToTrack)
export type CreateMediaElement = Omit<MediaElement, "id">;
export type CreateTextElement = Omit<TextElement, "id">;
export type CreateStickerElement = Omit<StickerElement, "id">;
export type CreateCaptionElement = Omit<CaptionElement, "id">;
export type CreateRemotionElement = Omit<RemotionElement, "id">;
export type CreateMarkdownElement = Omit<MarkdownElement, "id">;
export type CreateTimelineElement =
  | CreateMediaElement
  | CreateTextElement
  | CreateStickerElement
  | CreateCaptionElement
  | CreateRemotionElement
  | CreateMarkdownElement;

export interface TimelineElementProps {
  element: TimelineElement;
  track: TimelineTrack;
  zoomLevel: number;
  isSelected: boolean;
  onElementMouseDown: (e: React.MouseEvent, element: TimelineElement) => void;
  onElementClick: (e: React.MouseEvent, element: TimelineElement) => void;
}

export interface ResizeState {
  elementId: string;
  side: "left" | "right";
  startX: number;
  initialTrimStart: number;
  initialTrimEnd: number;
}

// Drag data types for type-safe drag and drop
export interface MediaItemDragData {
  id: string;
  type: MediaType;
  name: string;
}

export interface TextItemDragData {
  id: string;
  type: "text";
  name: string;
  content: string;
}

export interface StickerItemDragData {
  id: string;
  type: "sticker";
  name: string;
  iconName: string;
}

export interface RemotionItemDragData {
  id: string;
  type: "remotion";
  name: string;
  componentId: string;
  /** Default duration in frames */
  durationInFrames: number;
  /** Frames per second */
  fps: number;
}

export interface MarkdownItemDragData {
  id: string;
  type: "markdown";
  name: string;
  markdownContent: string;
}

export type DragData =
  | MediaItemDragData
  | TextItemDragData
  | StickerItemDragData
  | RemotionItemDragData
  | MarkdownItemDragData;

export interface TimelineTrack {
  id: string;
  name: string;
  type: TrackType;
  elements: TimelineElement[];
  muted?: boolean;
  isMain?: boolean;
}

export function sortTracksByOrder(tracks: TimelineTrack[]): TimelineTrack[] {
  // Define track type priority (lower = higher in the UI)
  const trackPriority: Record<TrackType, number> = {
    text: 1, // Text on top
    captions: 2, // Captions below text
    markdown: 2.5, // Markdown overlays between captions and remotion
    remotion: 3, // Remotion below captions (overlay layer)
    sticker: 4, // Stickers below remotion
    media: 5, // Media tracks
    audio: 6, // Audio at bottom
  };

  return [...tracks].sort((a, b) => {
    const priorityA = trackPriority[a.type];
    const priorityB = trackPriority[b.type];

    // Sort by track type priority first
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    // Within same type, main track goes first
    if (a.isMain && !b.isMain) return -1;
    if (b.isMain && !a.isMain) return 1;

    // Within same category, maintain creation order
    return 0;
  });
}

export function getMainTrack(tracks: TimelineTrack[]): TimelineTrack | null {
  return tracks.find((track) => track.isMain) || null;
}

export function ensureMainTrack(tracks: TimelineTrack[]): TimelineTrack[] {
  const hasMainTrack = tracks.some((track) => track.isMain);

  if (!hasMainTrack) {
    // Create main track if it doesn't exist
    const mainTrack: TimelineTrack = {
      id: generateUUID(),
      name: "Main Track",
      type: "media",
      elements: [],
      muted: false,
      isMain: true,
    };
    return [mainTrack, ...tracks];
  }

  return tracks;
}

// Timeline validation utilities
export function canElementGoOnTrack(
  elementType:
    | "text"
    | "media"
    | "sticker"
    | "captions"
    | "remotion"
    | "markdown",
  trackType: TrackType
): boolean {
  if (elementType === "text") {
    return trackType === "text";
  }
  if (elementType === "media") {
    return trackType === "media" || trackType === "audio";
  }
  if (elementType === "sticker") {
    return trackType === "sticker";
  }
  if (elementType === "captions") {
    return trackType === "captions";
  }
  if (elementType === "remotion") {
    return trackType === "remotion";
  }
  if (elementType === "markdown") {
    return trackType === "markdown";
  }
  return false;
}

export function validateElementTrackCompatibility(
  element: {
    type: "text" | "media" | "sticker" | "captions" | "remotion" | "markdown";
  },
  track: { type: TrackType }
): { isValid: boolean; errorMessage?: string } {
  const isValid = canElementGoOnTrack(element.type, track.type);

  if (!isValid) {
    const errorMessage =
      element.type === "text"
        ? "Text elements can only be placed on text tracks"
        : element.type === "sticker"
          ? "Sticker elements can only be placed on sticker tracks"
          : element.type === "captions"
            ? "Caption elements can only be placed on caption tracks"
            : element.type === "remotion"
              ? "Remotion elements can only be placed on Remotion tracks"
              : element.type === "markdown"
                ? "Markdown elements can only be placed on markdown tracks"
              : "Media elements can only be placed on media or audio tracks";

    return { isValid: false, errorMessage };
  }

  return { isValid: true };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if an element is a MediaElement
 */
export function isMediaElement(
  element: TimelineElement
): element is MediaElement {
  return element.type === "media";
}

/**
 * Type guard to check if an element is a TextElement
 */
export function isTextElement(
  element: TimelineElement
): element is TextElement {
  return element.type === "text";
}

/**
 * Type guard to check if an element is a StickerElement
 */
export function isStickerElement(
  element: TimelineElement
): element is StickerElement {
  return element.type === "sticker";
}

/**
 * Type guard to check if an element is a CaptionElement
 */
export function isCaptionElement(
  element: TimelineElement
): element is CaptionElement {
  return element.type === "captions";
}

/**
 * Type guard to check if an element is a RemotionElement
 */
export function isRemotionElement(
  element: TimelineElement
): element is RemotionElement {
  return element.type === "remotion";
}

/**
 * Type guard to check if an element is a MarkdownElement
 */
export function isMarkdownElement(
  element: TimelineElement
): element is MarkdownElement {
  return element.type === "markdown";
}

/**
 * Get all Remotion elements from a list of tracks
 */
export function getRemotionElements(
  tracks: TimelineTrack[]
): RemotionElement[] {
  const remotionElements: RemotionElement[] = [];
  for (const track of tracks) {
    for (const element of track.elements) {
      if (isRemotionElement(element)) {
        remotionElements.push(element);
      }
    }
  }
  return remotionElements;
}

/**
 * Get Remotion elements that are active at a specific time
 */
export function getActiveRemotionElements(
  tracks: TimelineTrack[],
  currentTime: number
): RemotionElement[] {
  return getRemotionElements(tracks).filter((element) => {
    const effectiveStart = element.startTime;
    const effectiveEnd =
      element.startTime +
      (element.duration - element.trimStart - element.trimEnd);
    return currentTime >= effectiveStart && currentTime < effectiveEnd;
  });
}
