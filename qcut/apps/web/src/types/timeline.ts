import { MediaType } from "@/stores/media-store";
import { generateUUID } from "@/lib/utils";

/** Valid track types in the video editor timeline */
export type TrackType = "media" | "text" | "audio" | "sticker" | "captions";

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

// Typed timeline elements
export type TimelineElement =
  | MediaElement
  | TextElement
  | StickerElement
  | CaptionElement;

// Creation types (without id, for addElementToTrack)
export type CreateMediaElement = Omit<MediaElement, "id">;
export type CreateTextElement = Omit<TextElement, "id">;
export type CreateStickerElement = Omit<StickerElement, "id">;
export type CreateCaptionElement = Omit<CaptionElement, "id">;
export type CreateTimelineElement =
  | CreateMediaElement
  | CreateTextElement
  | CreateStickerElement
  | CreateCaptionElement;

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

export type DragData =
  | MediaItemDragData
  | TextItemDragData
  | StickerItemDragData;

export interface TimelineTrack {
  id: string;
  name: string;
  type: TrackType;
  elements: TimelineElement[];
  muted?: boolean;
  isMain?: boolean;
}

export function sortTracksByOrder(tracks: TimelineTrack[]): TimelineTrack[] {
  return [...tracks].sort((a, b) => {
    // Text tracks always go to the top
    if (a.type === "text" && b.type !== "text") return -1;
    if (b.type === "text" && a.type !== "text") return 1;

    // Caption tracks go after text, before stickers
    if (a.type === "captions" && b.type !== "captions" && b.type !== "text")
      return -1;
    if (b.type === "captions" && a.type !== "captions" && a.type !== "text")
      return 1;

    // Sticker tracks go after captions, before media
    if (
      a.type === "sticker" &&
      b.type !== "sticker" &&
      b.type !== "text" &&
      b.type !== "captions"
    )
      return -1;
    if (
      b.type === "sticker" &&
      a.type !== "sticker" &&
      a.type !== "text" &&
      a.type !== "captions"
    )
      return 1;

    // Audio tracks always go to bottom
    if (a.type === "audio" && b.type !== "audio") return 1;
    if (b.type === "audio" && a.type !== "audio") return -1;

    // Main track goes above audio but below text, captions, and sticker tracks
    if (
      a.isMain &&
      !b.isMain &&
      b.type !== "audio" &&
      b.type !== "text" &&
      b.type !== "captions" &&
      b.type !== "sticker"
    )
      return 1;
    if (
      b.isMain &&
      !a.isMain &&
      a.type !== "audio" &&
      a.type !== "text" &&
      a.type !== "captions" &&
      a.type !== "sticker"
    )
      return -1;

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
  elementType: "text" | "media" | "sticker" | "captions",
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
  return false;
}

export function validateElementTrackCompatibility(
  element: { type: "text" | "media" | "sticker" | "captions" },
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
            : "Media elements can only be placed on media or audio tracks";

    return { isValid: false, errorMessage };
  }

  return { isValid: true };
}
