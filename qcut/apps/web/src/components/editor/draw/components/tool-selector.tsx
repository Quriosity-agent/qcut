import React from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useWhiteDrawStore } from "@/stores/white-draw-store";
import { TOOL_CATEGORIES, ALL_DRAWING_TOOLS } from "../constants/drawing-tools";
import { cn } from "@/lib/utils";

interface ToolSelectorProps {
  className?: string;
}

export const ToolSelector: React.FC<ToolSelectorProps> = ({ className }) => {
  const {
    currentTool,
    setTool,
    brushSize,
    setBrushSize,
    color,
    setColor,
    opacity,
    setOpacity
  } = useWhiteDrawStore();

  return (
    <div className={cn("p-4 space-y-6", className)}>
      {/* Tool Categories */}
      {TOOL_CATEGORIES.map((category) => (
        <div key={category.id} className="space-y-3">
          <h3 className="text-sm font-medium text-gray-300">{category.name}</h3>
          <div className="grid grid-cols-2 gap-2">
            {category.tools.map((tool) => (
              <Button
                key={tool.id}
                variant={currentTool.id === tool.id ? "default" : "outline"}
                size="sm"
                onClick={() => setTool(tool)}
                className="flex flex-col items-center gap-1 h-auto py-3 text-xs"
                title={`${tool.name} (${tool.shortcut})\n${tool.description}`}
              >
                <div className="w-4 h-4">
                  {tool.icon}
                </div>
                <span className="text-xs">{tool.name}</span>
              </Button>
            ))}
          </div>
        </div>
      ))}

      {/* Tool Settings */}
      {currentTool.settings && (
        <div className="space-y-4 pt-4 border-t border-gray-700">
          <h3 className="text-sm font-medium text-gray-300">Tool Settings</h3>

          {/* Brush Size */}
          {currentTool.settings.brushSize && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">
                Size: {brushSize}px
              </Label>
              <Slider
                value={[brushSize]}
                onValueChange={(value) => setBrushSize(value[0])}
                min={currentTool.settings.brushSize.min}
                max={currentTool.settings.brushSize.max}
                step={1}
                className="w-full"
              />
            </div>
          )}

          {/* Opacity */}
          {currentTool.settings.opacity && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">
                Opacity: {Math.round(opacity * 100)}%
              </Label>
              <Slider
                value={[opacity]}
                onValueChange={(value) => setOpacity(value[0])}
                min={currentTool.settings.opacity.min}
                max={currentTool.settings.opacity.max}
                step={0.1}
                className="w-full"
              />
            </div>
          )}

          {/* Color Picker */}
          {currentTool.settings.color && (
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-8 h-8 rounded border border-gray-600 bg-transparent cursor-pointer"
                />
                <span className="text-xs text-gray-400 font-mono">{color}</span>
              </div>
              {/* Color Presets */}
              <div className="grid grid-cols-8 gap-1">
                {[
                  '#000000', '#FFFFFF', '#FF0000', '#00FF00',
                  '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
                  '#FF8000', '#8000FF', '#0080FF', '#80FF00',
                  '#FF0080', '#80FF80', '#808080', '#C0C0C0'
                ].map((presetColor) => (
                  <button
                    key={presetColor}
                    onClick={() => setColor(presetColor)}
                    className={cn(
                      "w-6 h-6 rounded border border-gray-600 cursor-pointer transition-transform hover:scale-110",
                      color === presetColor && "ring-2 ring-orange-500"
                    )}
                    style={{ backgroundColor: presetColor }}
                    title={presetColor}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Current Tool Info */}
      <div className="pt-4 border-t border-gray-700">
        <div className="text-xs text-gray-400 space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3">{currentTool.icon}</div>
            <span className="font-medium">{currentTool.name}</span>
            {currentTool.shortcut && (
              <span className="bg-gray-800 px-1.5 py-0.5 rounded text-xs">
                {currentTool.shortcut}
              </span>
            )}
          </div>
          <p className="text-xs">{currentTool.description}</p>
        </div>
      </div>
    </div>
  );
};

export default ToolSelector;