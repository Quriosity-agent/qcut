"use client";

import { useMemo } from "react";
import { useTimelineStore } from "@/stores/timeline-store";
import { cn } from "@/lib/utils";

interface AutoSaveIndicatorProps {
  className?: string;
}

export function AutoSaveIndicator({ className }: AutoSaveIndicatorProps) {
  const autoSaveStatus = useTimelineStore((state) => state.autoSaveStatus);
  const isAutoSaving = useTimelineStore((state) => state.isAutoSaving);
  const lastAutoSaveAt = useTimelineStore((state) => state.lastAutoSaveAt);

  const message = useMemo(() => {
    if (isAutoSaving) {
      return "Auto-saving...";
    }

    if (autoSaveStatus === "Auto-saved" && lastAutoSaveAt) {
      // Keep message concise while still updating timestamp for debugging
      return "Auto-saved";
    }

    return autoSaveStatus || "Auto-save idle";
  }, [autoSaveStatus, isAutoSaving, lastAutoSaveAt]);

  return (
    <span
      data-testid="auto-save-indicator"
      className={cn("text-xs text-muted-foreground", className)}
      aria-live="polite"
    >
      {message}
    </span>
  );
}
