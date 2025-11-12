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
  | "draw";

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
  "nano-edit": {
    icon: PaletteIcon,
    label: "Nano Edit",
  },
  draw: {
    icon: PenTool,
    label: "Draw",
  },
  captions: {
    icon: CaptionsIcon,
    label: "Captions",
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
  sounds: {
    icon: VolumeXIcon,
    label: "Sounds",
  },
  effects: {
    icon: SparklesIcon,
    label: "Effects",
  },
  transitions: {
    icon: ArrowLeftRightIcon,
    label: "Transitions",
  },
  filters: {
    icon: BlendIcon,
    label: "Filters",
  },
  audio: {
    icon: MusicIcon,
    label: "Audio",
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
