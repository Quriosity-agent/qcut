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
import { handleError, ErrorCategory, ErrorSeverity } from "@/lib/error-handler";
import { useEditorStore } from "@/stores/editor-store";
import { useAspectRatio } from "@/hooks/use-aspect-ratio";
// import Image from "next/image"; // Not needed in Vite
import { cn } from "@/lib/utils";
import { colors } from "@/data/colors";
import { PipetteIcon, KeyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useMemo, memo, useCallback, useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
            <TabsTrigger value="api-keys">API Keys</TabsTrigger>
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
          <TabsContent value="api-keys" className="p-5 pt-0 mt-0">
            <ApiKeysView />
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

  const handleAspectRatioChange = useCallback(
    (value: string) => {
      const preset = canvasPresets.find((p) => p.name === value);
      if (preset) {
        setCanvasSize({ width: preset.width, height: preset.height });
      }
    },
    [canvasPresets, setCanvasSize]
  );

  const handleFpsChange = useCallback(
    (value: string) => {
      const fps = parseFloat(value);
      if (!isNaN(fps) && fps > 0) {
        updateProjectFps(fps);
      }
    },
    [updateProjectFps]
  );

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

function ApiKeysView() {
  const [falApiKey, setFalApiKey] = useState("");
  const [freesoundApiKey, setFreesoundApiKey] = useState("");
  const [showFalKey, setShowFalKey] = useState(false);
  const [showFreesoundKey, setShowFreesoundKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isTestingFreesound, setIsTestingFreesound] = useState(false);
  const [freesoundTestResult, setFreesoundTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [isTestingFal, setIsTestingFal] = useState(false);
  const [falTestResult, setFalTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Load API keys on component mount
  const loadApiKeys = useCallback(async () => {
    try {
      if (window.electronAPI?.apiKeys) {
        const keys = await window.electronAPI.apiKeys.get();
        if (keys) {
          setFalApiKey(keys.falApiKey || "");
          setFreesoundApiKey(keys.freesoundApiKey || "");
        }
      }
    } catch (error) {
      handleError(error, {
        operation: "Load API Keys",
        category: ErrorCategory.STORAGE,
        severity: ErrorSeverity.LOW,
        showToast: false,
        metadata: {
          operation: "load-api-keys",
        },
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save API keys
  const saveApiKeys = useCallback(async () => {
    try {
      if (window.electronAPI?.invoke) {
        await window.electronAPI.apiKeys.set({
          falApiKey: falApiKey.trim(),
          freesoundApiKey: freesoundApiKey.trim(),
        });
        console.log("✅ API keys saved successfully");
        // Clear test results after saving
        setFreesoundTestResult(null);
        setFalTestResult(null);
      }
    } catch (error) {
      handleError(error, {
        operation: "Save API Keys",
        category: ErrorCategory.STORAGE,
        severity: ErrorSeverity.MEDIUM,
        metadata: {
          operation: "save-api-keys",
        },
      });
    }
  }, [falApiKey, freesoundApiKey]);

  // Test Freesound API key
  const testFreesoundKey = useCallback(async () => {
    setIsTestingFreesound(true);
    setFreesoundTestResult(null);
    try {
      if (window.electronAPI?.sounds) {
        const result = await window.electronAPI.sounds.search({
          q: "test",
        });
        setFreesoundTestResult({
          success: result.success,
          message: result.message || "Test completed",
        });
      }
    } catch (error) {
      setFreesoundTestResult({ success: false, message: "Test failed" });
    } finally {
      setIsTestingFreesound(false);
    }
  }, [freesoundApiKey]);

  // Load keys on mount
  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-sm text-muted-foreground">Loading API keys...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-sm text-muted-foreground">
        Configure API keys for enhanced features like AI image generation and
        sound effects.
      </div>

      {/* FAL API Key */}
      <PropertyGroup title="FAL AI API Key">
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">
            For AI image generation. Get your key at{" "}
            <span className="font-mono">fal.ai</span>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                type={showFalKey ? "text" : "password"}
                placeholder="Enter your FAL API key"
                value={falApiKey}
                onChange={(e) => setFalApiKey(e.target.value)}
                className="bg-panel-accent pr-10"
              />
              <Button
                type="button"
                variant="text"
                size="sm"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowFalKey(!showFalKey)}
              >
                {showFalKey ? (
                  <EyeOffIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </PropertyGroup>

      {/* Freesound API Key */}
      <PropertyGroup title="Freesound API Key">
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">
            For sound effects library. Get your key at{" "}
            <span className="font-mono">freesound.org/help/developers</span>
          </div>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                type={showFreesoundKey ? "text" : "password"}
                placeholder="Enter your Freesound API key"
                value={freesoundApiKey}
                onChange={(e) => {
                  setFreesoundApiKey(e.target.value);
                  setFreesoundTestResult(null); // Clear test result on change
                }}
                className="bg-panel-accent pr-10"
              />
              <Button
                type="button"
                variant="text"
                size="sm"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowFreesoundKey(!showFreesoundKey)}
              >
                {showFreesoundKey ? (
                  <EyeOffIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Button
              onClick={testFreesoundKey}
              disabled={!freesoundApiKey || isTestingFreesound}
              variant="outline"
              size="sm"
            >
              {isTestingFreesound ? "Testing..." : "Test"}
            </Button>
          </div>
          {freesoundTestResult && (
            <div
              className={`text-xs ${freesoundTestResult.success ? "text-green-600" : "text-red-600"}`}
            >
              {freesoundTestResult.message}
            </div>
          )}
        </div>
      </PropertyGroup>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={saveApiKeys} className="gap-2">
          <KeyIcon className="h-4 w-4" />
          Save API Keys
        </Button>
      </div>

      <div className="text-xs text-muted-foreground border-t pt-4">
        <strong>Note:</strong> API keys are stored securely on your device and
        never shared. Restart the application after saving for changes to take
        effect.
      </div>
    </div>
  );
}
