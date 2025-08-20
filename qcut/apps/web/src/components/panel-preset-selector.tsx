"use client";

import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ChevronDown, LayoutPanelTop } from "lucide-react";
import { usePanelStore, type PanelPreset } from "@/stores/panel-store";

const PRESET_LABELS: Record<PanelPreset, string> = {
  default: "Default",
  media: "Media",
  inspector: "Inspector",
  "vertical-preview": "Vertical Preview",
};

const PRESET_DESCRIPTIONS: Record<PanelPreset, string> = {
  default: "Media, preview, and inspector on top row, timeline on bottom",
  media: "Full height media on left, preview and inspector on top row",
  inspector: "Full height inspector on right, media and preview on top row",
  "vertical-preview": "Full height preview on right for vertical videos",
};

export function PanelPresetSelector() {
  const { activePreset, setActivePreset } = usePanelStore();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="h-8 px-2 text-xs">
          <LayoutPanelTop className="h-4 w-4 mr-1" />
          {PRESET_LABELS[activePreset]}
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {(Object.keys(PRESET_LABELS) as PanelPreset[]).map((preset) => (
          <DropdownMenuItem
            key={preset}
            onClick={() => setActivePreset(preset)}
            className="flex flex-col items-start py-2"
          >
            <div className="font-medium">{PRESET_LABELS[preset]}</div>
            <div className="text-xs text-muted-foreground">
              {PRESET_DESCRIPTIONS[preset]}
            </div>
            {activePreset === preset && " ✓"}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}