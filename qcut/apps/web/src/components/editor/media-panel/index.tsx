"use client";

import { useRef, useEffect } from "react";
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

export function MediaPanel() {
  // Debug: Track render count to detect infinite loops
  const componentName = "MediaPanel";
  const renderCount = useRef(0);
  const lastRenderTime = useRef(Date.now());
  
  useEffect(() => {
    renderCount.current++;
    const now = Date.now();
    const timeSince = now - lastRenderTime.current;
    lastRenderTime.current = now;
    
    console.log(`[${componentName}] Render #${renderCount.current} at ${new Date().toISOString()} (${timeSince}ms since last)`);
    
    if (timeSince < 50) {
      console.warn(`[${componentName}] ⚠️ Rapid re-rendering detected! Only ${timeSince}ms between renders`);
    }
    
    if (renderCount.current > 100) {
      console.error(`[${componentName}] ❌ EXCESSIVE RENDERS: ${renderCount.current} renders detected!`);
      if (renderCount.current === 101) {
        console.trace();
      }
    }
  });

  const { activeTab } = useMediaPanelStore();

  const viewMap: Record<Tab, React.ReactNode> = {
    media: <MediaView />,
    audio: <AudioView />,
    text: <TextView />,
    stickers: <StickersView />,
    effects: (
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
