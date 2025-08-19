"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PropertyItem,
  PropertyItemLabel,
  PropertyItemValue,
  PropertyGroup,
} from "./property-item";
import { FPS_PRESETS } from "@/constants/timeline-constants";
import { useProjectStore } from "@/stores/project-store";
import { useEditorStore } from "@/stores/editor-store";
import { useAspectRatio } from "@/hooks/use-aspect-ratio";
// import Image from "next/image"; // Not needed in Vite
import { cn } from "@/lib/utils";
import { colors } from "@/data/colors";
import { PipetteIcon } from "lucide-react";
import { useMemo, memo, useCallback } from "react";

export function SettingsView() {
  return <ProjectSettingsTabs />;
}

function ProjectSettingsTabs() {
  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="project-info" className="flex flex-col h-full">
        <div className="px-3 pt-4 pb-0">
          <TabsList>
            <TabsTrigger value="project-info">Project info</TabsTrigger>
            <TabsTrigger value="background">Background</TabsTrigger>
          </TabsList>
        </div>
        <Separator className="my-4" />
        <ScrollArea className="flex-1">
          <TabsContent value="project-info" className="p-5 pt-0 mt-0">
            <ProjectInfoView />
          </TabsContent>
          <TabsContent value="background" className="p-4 pt-0">
            <BackgroundView />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

function ProjectInfoView() {
  const { activeProject, updateProjectFps } = useProjectStore();
  const { canvasSize, canvasPresets, setCanvasSize } = useEditorStore();
  const { getDisplayName, currentPreset } = useAspectRatio();

  const handleAspectRatioChange = useCallback((value: string) => {
    const preset = canvasPresets.find((p) => p.name === value);
    if (preset) {
      setCanvasSize({ width: preset.width, height: preset.height });
    }
  }, [canvasPresets, setCanvasSize]);

  const handleFpsChange = useCallback((value: string) => {
    const fps = parseFloat(value);
    if (!isNaN(fps) && fps > 0) {
      updateProjectFps(fps);
    }
  }, [updateProjectFps]);

  return (
    <div className="flex flex-col gap-4">
      <PropertyItem direction="column">
        <PropertyItemLabel>Name</PropertyItemLabel>
        <PropertyItemValue>
          {activeProject?.name || "Untitled project"}
        </PropertyItemValue>
      </PropertyItem>

      <PropertyItem direction="column">
        <PropertyItemLabel>Aspect ratio</PropertyItemLabel>
        <PropertyItemValue>
          <Select
            value={currentPreset?.name}
            onValueChange={handleAspectRatioChange}
          >
            <SelectTrigger className="bg-panel-accent">
              <SelectValue placeholder={getDisplayName()} />
            </SelectTrigger>
            <SelectContent>
              {canvasPresets.map((preset) => (
                <SelectItem key={preset.name} value={preset.name}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropertyItemValue>
      </PropertyItem>

      <PropertyItem direction="column">
        <PropertyItemLabel>Frame rate</PropertyItemLabel>
        <PropertyItemValue>
          <Select
            value={(activeProject?.fps || 30).toString()}
            onValueChange={handleFpsChange}
          >
            <SelectTrigger className="bg-panel-accent">
              <SelectValue placeholder="Select a frame rate" />
            </SelectTrigger>
            <SelectContent>
              {FPS_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropertyItemValue>
      </PropertyItem>
    </div>
  );
}

const BlurPreview = memo(
  ({
    blur,
    isSelected,
    onSelect,
  }: {
    blur: { label: string; value: number };
    isSelected: boolean;
    onSelect: () => void;
  }) => (
    <button
      type="button"
      className={cn(
        "w-full aspect-square rounded-sm cursor-pointer hover:outline-2 hover:outline-primary relative overflow-hidden focus-visible:outline-2 focus-visible:outline-primary",
        isSelected && "outline-2 outline-primary"
      )}
      onClick={onSelect}
      aria-pressed={isSelected}
      aria-label={`Select ${blur.label.toLowerCase()} blur`}
    >
      <div
        className="absolute inset-0 w-full h-full bg-gradient-to-br from-blue-400 via-purple-500 to-pink-400"
        style={{ filter: `blur(${blur.value}px)` }}
      />
      <div className="absolute bottom-1 left-1 right-1 text-center">
        <span className="text-xs text-foreground bg-background/50 px-1 rounded">
          {blur.label}
        </span>
      </div>
    </button>
  )
);

BlurPreview.displayName = "BlurPreview";

function BackgroundView() {
  const { activeProject, updateBackgroundType } = useProjectStore();

  const blurLevels = useMemo(
    () => [
      { label: "Light", value: 4 },
      { label: "Medium", value: 8 },
      { label: "Heavy", value: 18 },
    ],
    []
  );

  const handleBlurSelect = useCallback(
    async (blurIntensity: number) => {
      await updateBackgroundType("blur", { blurIntensity });
    },
    [updateBackgroundType]
  );

  const handleColorSelect = useCallback(
    async (color: string) => {
      await updateBackgroundType("color", { backgroundColor: color });
    },
    [updateBackgroundType]
  );

  const currentBlurIntensity = activeProject?.blurIntensity || 8;
  const isBlurBackground = activeProject?.backgroundType === "blur";
  const currentBackgroundColor = activeProject?.backgroundColor || "#000000";
  const isColorBackground = activeProject?.backgroundType === "color";

  const blurPreviews = useMemo(
    () =>
      blurLevels.map((blur) => (
        <BlurPreview
          key={blur.value}
          blur={blur}
          isSelected={isBlurBackground && currentBlurIntensity === blur.value}
          onSelect={() => handleBlurSelect(blur.value)}
        />
      )),
    [blurLevels, isBlurBackground, currentBlurIntensity, handleBlurSelect]
  );

  const colorPreviews = useMemo(
    () =>
      colors.map((color) => (
        <button
          type="button"
          key={color}
          className={cn(
            "w-full aspect-square rounded-sm cursor-pointer hover:border-2 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            isColorBackground &&
              color === currentBackgroundColor &&
              "border-2 border-primary"
          )}
          style={{ backgroundColor: color }}
          onClick={() => handleColorSelect(color)}
          aria-pressed={isColorBackground && color === currentBackgroundColor}
          aria-label={`Select color ${color}`}
          title={`Select color ${color}`}
        />
      )),
    [isColorBackground, currentBackgroundColor, handleColorSelect]
  );

  return (
    <div className="flex flex-col gap-5">
      <PropertyGroup title="Blur">
        <div className="grid grid-cols-4 gap-2 w-full">{blurPreviews}</div>
      </PropertyGroup>

      <PropertyGroup title="Color">
        <div className="grid grid-cols-4 gap-2 w-full">
          <button
            type="button"
            className="w-full aspect-square rounded-sm cursor-pointer border border-foreground/15 hover:border-primary flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Pick a custom color"
            title="Pick a custom color"
          >
            <PipetteIcon className="size-4" />
          </button>
          {colorPreviews}
        </div>
      </PropertyGroup>
    </div>
  );
}