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
  ArrowUpFromLineIcon,
  ApertureIcon,
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
  | "camera-selector"
  | "upscale"
  | "angles";

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
  upscale: {
    icon: ArrowUpFromLineIcon,
    label: "Upscale",
  },
  angles: {
    icon: ApertureIcon,
    label: "Angles",
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

export type TabGroup = "media" | "ai-create" | "agents" | "edit";

export type EditSubgroup = "ai-edit" | "manual-edit";

export interface Subgroup {
  label: string;
  tabs: Tab[];
}

export interface TabGroupDef {
  icon: LucideIcon;
  label: string;
  tabs: Tab[];
  subgroups?: Record<EditSubgroup, Subgroup>;
}

const editSubgroups: Record<EditSubgroup, Subgroup> = {
  "ai-edit": {
    label: "AI Assist",
    tabs: ["word-timeline", "video-edit", "draw", "captions", "upscale"],
  },
  "manual-edit": {
    label: "Manual Edit",
    tabs: ["text", "stickers", "effects", "filters", "transitions"],
  },
};

export const tabGroups: { [key in TabGroup]: TabGroupDef } = {
  "ai-create": {
    icon: SparklesIcon,
    label: "Create",
    tabs: [
      "ai",
      "text2image",
      "angles",
      "adjustment",
      "nano-edit",
      "camera-selector",
      "segmentation",
      "sounds",
      "audio",
    ],
  },
  edit: {
    icon: ScissorsIcon,
    label: "Edit",
    tabs: [
      ...editSubgroups["ai-edit"].tabs,
      ...editSubgroups["manual-edit"].tabs,
    ],
    subgroups: editSubgroups,
  },
  media: {
    icon: FolderOpenIcon,
    label: "Library",
    tabs: ["media", "project-folder"],
  },
  agents: {
    icon: WrenchIcon,
    label: "Agents",
    tabs: ["pty", "remotion"],
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

  activeEditSubgroup: EditSubgroup;
  setActiveEditSubgroup: (subgroup: EditSubgroup) => void;

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
  edit: "word-timeline",
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

  activeEditSubgroup: "ai-edit",
  setActiveEditSubgroup: (subgroup) =>
    set((state) => {
      const firstTab = editSubgroups[subgroup].tabs[0];
      return {
        activeEditSubgroup: subgroup,
        activeTab: firstTab,
        lastTabPerGroup: { ...state.lastTabPerGroup, edit: firstTab },
      };
    }),

  lastTabPerGroup: { ...defaultLastTabPerGroup },

  // AI-specific state defaults
  aiActiveTab: "text",
  setAiActiveTab: (tab) => set({ aiActiveTab: tab }),
}));
