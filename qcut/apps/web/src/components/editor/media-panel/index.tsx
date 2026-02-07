"use client";

import { TabBar } from "./tabbar";
import { MediaView } from "./views/media";
import { useMediaPanelStore, Tab } from "./store";
import { TextView } from "./views/text";
import { AudioView } from "./views/audio";
import { Text2ImageView } from "./views/text2image";
import { AdjustmentPanel } from "@/components/editor/adjustment";
import { AiView } from "./views/ai";
import { StickersView } from "./views/stickers";
import { CaptionsView } from "./views/captions";
import { SoundsView } from "./views/sounds";
import NanoEditView from "./views/nano-edit";
import DrawView from "./views/draw";
import VideoEditView from "./views/video-edit";
import { SegmentationPanel } from "@/components/editor/segmentation";
import { RemotionView } from "./views/remotion";
import { PtyTerminalView } from "./views/pty-terminal";
import { WordTimelineView } from "./views/word-timeline-view";
import { ProjectFolderView } from "./views/project-folder";
import { CameraSelectorView } from "./views/camera-selector";
import React from "react";
import { EFFECTS_ENABLED } from "@/config/features";

// Lazy load effects view only when enabled
const EffectsView = React.lazy(() =>
  EFFECTS_ENABLED
    ? import("./views/effects")
    : Promise.resolve({
        default: () => React.createElement("div", null, "Effects disabled"),
      })
);

export function MediaPanel() {
  const { activeTab } = useMediaPanelStore();

  const viewMap: Record<Tab, React.ReactNode> = {
    media: <MediaView />,
    audio: <AudioView />,
    text: <TextView />,
    stickers: <StickersView />,
    "video-edit": <VideoEditView />,
    effects: EFFECTS_ENABLED ? (
      <React.Suspense fallback={<div className="p-4">Loading effects...</div>}>
        <EffectsView />
      </React.Suspense>
    ) : (
      <div className="p-4 text-muted-foreground">
        Effects view coming soon...
      </div>
    ),
    transitions: (
      <div className="p-4 text-muted-foreground">
        Transitions view coming soon...
      </div>
    ),
    captions: <CaptionsView />,
    filters: (
      <div className="p-4 text-muted-foreground">
        Filters view coming soon...
      </div>
    ),
    adjustment: <AdjustmentPanel />,
    text2image: <Text2ImageView />,
    "nano-edit": <NanoEditView />,
    ai: <AiView />,
    sounds: <SoundsView />,
    draw: <DrawView />,
    segmentation: <SegmentationPanel />,
    remotion: <RemotionView />,
    pty: <PtyTerminalView />,
    "word-timeline": <WordTimelineView />,
    "project-folder": <ProjectFolderView />,
    "camera-selector": <CameraSelectorView />,
  };

  return (
    <div
      className="h-full flex flex-col bg-panel rounded-lg overflow-hidden"
      data-testid="media-panel"
    >
      <TabBar />
      <div className="flex-1 overflow-y-auto">{viewMap[activeTab]}</div>
    </div>
  );
}
