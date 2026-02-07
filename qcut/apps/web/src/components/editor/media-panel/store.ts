import {
  CaptionsIcon,
  ArrowLeftRightIcon,
  SparklesIcon,
  StickerIcon,
  MusicIcon,
  VideoIcon,
  BlendIcon,
  SlidersHorizontalIcon,
  LucideIcon,
  TypeIcon,
  WandIcon,
  BotIcon,
  VolumeXIcon,
  PaletteIcon,
  PenTool,
  Wand2Icon,
  ScissorsIcon,
  Layers,
  SquareTerminalIcon,
  TextSelect,
  FolderSync,
  CameraIcon,
} from "lucide-react";
import { create } from "zustand";

export type Tab =
  | "media"
  | "audio"
  | "text"
  | "stickers"
  | "video-edit"
  | "effects"
  | "transitions"
  | "captions"
  | "filters"
  | "adjustment"
  | "text2image"
  | "nano-edit"
  | "ai"
  | "sounds"
  | "draw"
  | "segmentation"
  | "remotion"
  | "pty"
  | "word-timeline"
  | "project-folder"
  | "camera-selector";

export const tabs: { [key in Tab]: { icon: LucideIcon; label: string } } = {
  media: {
    icon: VideoIcon,
    label: "Media",
  },
  text2image: {
    icon: WandIcon,
    label: "AI Images",
  },
  adjustment: {
    icon: SlidersHorizontalIcon,
    label: "Adjustment",
  },
  ai: {
    icon: BotIcon,
    label: "AI Video",
  },
  "camera-selector": {
    icon: CameraIcon,
    label: "Camera",
  },
  "nano-edit": {
    icon: PaletteIcon,
    label: "Nano Edit",
  },
  draw: {
    icon: PenTool,
    label: "Draw",
  },
  text: {
    icon: TypeIcon,
    label: "Text",
  },
  stickers: {
    icon: StickerIcon,
    label: "Stickers",
  },
  "video-edit": {
    icon: Wand2Icon,
    label: "Video Edit",
  },
  remotion: {
    icon: Layers,
    label: "Remotion",
  },
  pty: {
    icon: SquareTerminalIcon,
    label: "Terminal",
  },
  "word-timeline": {
    icon: TextSelect,
    label: "Transcribe",
  },
  "project-folder": {
    icon: FolderSync,
    label: "Project",
  },
  // WIP panels below
  filters: {
    icon: BlendIcon,
    label: "Filters (WIP)",
  },
  segmentation: {
    icon: ScissorsIcon,
    label: "Segment (WIP)",
  },
  sounds: {
    icon: VolumeXIcon,
    label: "Sounds (WIP)",
  },
  effects: {
    icon: SparklesIcon,
    label: "Effects (WIP)",
  },
  transitions: {
    icon: ArrowLeftRightIcon,
    label: "Transitions (WIP)",
  },
  audio: {
    icon: MusicIcon,
    label: "Audio (WIP)",
  },
  captions: {
    icon: CaptionsIcon,
    label: "Captions (WIP)",
  },
};

interface MediaPanelStore {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;

  // AI-specific state
  aiActiveTab: "text" | "image" | "avatar" | "upscale";
  setAiActiveTab: (tab: "text" | "image" | "avatar" | "upscale") => void;
}

export const useMediaPanelStore = create<MediaPanelStore>((set) => ({
  activeTab: "media",
  setActiveTab: (tab) => set({ activeTab: tab }),

  // AI-specific state defaults
  aiActiveTab: "text",
  setAiActiveTab: (tab) => set({ aiActiveTab: tab }),
}));
