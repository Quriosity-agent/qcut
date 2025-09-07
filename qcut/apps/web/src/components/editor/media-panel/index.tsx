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
import React from "react";

// Feature flag for effects - disabled by default for safety
const EFFECTS_ENABLED = false;

// Lazy load effects view only when enabled
const EffectsView = React.lazy(() =>
  EFFECTS_ENABLED
    ? import("./views/effects")
    : Promise.resolve({ default: () => null })
);

export function MediaPanel() {
  const { activeTab } = useMediaPanelStore();

  const viewMap: Record<Tab, React.ReactNode> = {
    media: <MediaView />,
    audio: <AudioView />,
    text: <TextView />,
    stickers: <StickersView />,
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
    ai: <AiView />,
    sounds: <SoundsView />,
  };

  return (
    <div className="h-full flex flex-col bg-panel rounded-sm">
      <TabBar />
      <div className="flex-1 overflow-y-auto">{viewMap[activeTab]}</div>
    </div>
  );
}
