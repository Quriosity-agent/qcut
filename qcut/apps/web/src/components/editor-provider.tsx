"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import {
  useKeybindingsListener,
  useKeybindingDisabler,
} from "@/hooks/use-keybindings";
import { useEditorActions } from "@/hooks/use-editor-actions";

interface EditorProviderProps {
  children: React.ReactNode;
}

export function EditorProvider({ children }: EditorProviderProps) {
  // Debug: Track render count to detect infinite loops
  const componentName = "EditorProvider";
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

  const { isInitializing, isPanelsReady, initializeApp } = useEditorStore();
  const { disableKeybindings, enableKeybindings } = useKeybindingDisabler();

  // Set up action handlers
  useEditorActions();

  // Set up keybinding listener
  useKeybindingsListener();

  // Disable keybindings when initializing
  useEffect(() => {
    if (isInitializing || !isPanelsReady) {
      disableKeybindings();
    } else {
      enableKeybindings();
    }
  }, [isInitializing, isPanelsReady, disableKeybindings, enableKeybindings]);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  // Show loading screen while initializing
  if (isInitializing || !isPanelsReady) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading editor...</p>
        </div>
      </div>
    );
  }

  // App is ready, render children
  return <>{children}</>;
}
