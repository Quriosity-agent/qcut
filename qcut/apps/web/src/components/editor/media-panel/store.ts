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
  FolderOpenIcon,
  WrenchIcon,
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

// --- Tab Groups ---

export type TabGroup = "media" | "ai-create" | "agents" | "edit" | "effects";

export const tabGroups: {
  [key in TabGroup]: { icon: LucideIcon; label: string; tabs: Tab[] };
} = {
  media: {
    icon: FolderOpenIcon,
    label: "Media",
    tabs: ["media", "project-folder"],
  },
  "ai-create": {
    icon: SparklesIcon,
    label: "AI Create",
    tabs: [
      "ai",
      "text2image",
      "adjustment",
      "nano-edit",
      "camera-selector",
      "segmentation",
      "sounds",
      "audio",
    ],
  },
  agents: {
    icon: WrenchIcon,
    label: "Agents",
    tabs: ["pty", "remotion"],
  },
  edit: {
    icon: ScissorsIcon,
    label: "Edit",
    tabs: [
      "word-timeline",
      "video-edit",
      "draw",
      "captions",
    ],
  },
  effects: {
    icon: BlendIcon,
    label: "Manual Edit",
    tabs: ["text", "stickers", "effects", "filters", "transitions"],
  },
};

/** Reverse lookup: given a tab, return which group it belongs to. */
export function getGroupForTab(tab: Tab): TabGroup {
  for (const [groupKey, group] of Object.entries(tabGroups)) {
    if (group.tabs.includes(tab)) {
      return groupKey as TabGroup;
    }
  }
  return "media";
}

// --- Store ---

interface MediaPanelStore {
  activeGroup: TabGroup;
  setActiveGroup: (group: TabGroup) => void;

  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;

  lastTabPerGroup: Record<TabGroup, Tab>;

  // AI-specific state
  aiActiveTab: "text" | "image" | "avatar" | "upscale" | "angles";
  setAiActiveTab: (
    tab: "text" | "image" | "avatar" | "upscale" | "angles"
  ) => void;
}

const defaultLastTabPerGroup: Record<TabGroup, Tab> = {
  media: "media",
  "ai-create": "ai",
  agents: "pty",
  edit: "text",
  effects: "filters",
};

export const useMediaPanelStore = create<MediaPanelStore>((set) => ({
  activeGroup: "media",
  setActiveGroup: (group) =>
    set((state) => ({
      activeGroup: group,
      activeTab: state.lastTabPerGroup[group],
    })),

  activeTab: "media",
  setActiveTab: (tab) =>
    set((state) => {
      const group = getGroupForTab(tab);
      return {
        activeTab: tab,
        activeGroup: group,
        lastTabPerGroup: { ...state.lastTabPerGroup, [group]: tab },
      };
    }),

  lastTabPerGroup: { ...defaultLastTabPerGroup },

  // AI-specific state defaults
  aiActiveTab: "text",
  setAiActiveTab: (tab) => set({ aiActiveTab: tab }),
}));
