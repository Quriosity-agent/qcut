/**
 * Color Prop Editor
 *
 * Input component for color properties with color picker and hex input.
 *
 * @module components/editor/properties-panel/prop-editors/color-prop
 */

import React, { useCallback, useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { BasePropEditorProps } from "./index";

export interface ColorPropProps extends BasePropEditorProps<string> {
  /** Preset colors to show in picker */
  presets?: string[];
  /** Whether to allow alpha/transparency */
  allowAlpha?: boolean;
}

// Default color presets
const DEFAULT_PRESETS = [
  "#ffffff",
  "#000000",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#6b7280",
];

/**
 * Validate and normalize a color string
 */
function normalizeColor(color: string): string {
  // Handle empty or invalid
  if (!color) return "#000000";

  // Already a hex color
  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color)) {
    // Expand 3-char hex to 6-char
    if (color.length === 4) {
      return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }
    return color.toLowerCase();
  }

  // Try to parse rgb/rgba
  const rgbMatch = color.match(
    /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i
  );
  if (rgbMatch) {
    const r = Math.min(255, parseInt(rgbMatch[1], 10));
    const g = Math.min(255, parseInt(rgbMatch[2], 10));
    const b = Math.min(255, parseInt(rgbMatch[3], 10));
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    return hex.toLowerCase();
  }

  return color;
}

export function ColorProp({
  name,
  label,
  value,
  onChange,
  description,
  error,
  disabled,
  presets = DEFAULT_PRESETS,
  allowAlpha = false,
}: ColorPropProps) {
  const [localValue, setLocalValue] = useState(normalizeColor(value));
  const [isOpen, setIsOpen] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Sync local state with external value
  useEffect(() => {
    setLocalValue(normalizeColor(value));
  }, [value]);

  const handleColorPickerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newColor = e.target.value;
      setLocalValue(newColor);
      onChange(newColor);
    },
    [onChange]
  );

  const handleTextInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      let inputValue = e.target.value;

      // Add # if not present
      if (inputValue && !inputValue.startsWith("#")) {
        inputValue = "#" + inputValue;
      }

      setLocalValue(inputValue);

      // Only update if it's a valid hex color
      if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(inputValue)) {
        onChange(normalizeColor(inputValue));
      }
    },
    [onChange]
  );

  const handleTextInputBlur = useCallback(() => {
    // Normalize on blur
    const normalized = normalizeColor(localValue);
    setLocalValue(normalized);
    onChange(normalized);
  }, [localValue, onChange]);

  const handlePresetClick = useCallback(
    (preset: string) => {
      const normalized = normalizeColor(preset);
      setLocalValue(normalized);
      onChange(normalized);
    },
    [onChange]
  );

  const handleSwatchClick = useCallback(() => {
    colorInputRef.current?.click();
  }, []);

  // Get display color (for 6-char hex input type="color" requires)
  const displayColor = localValue.substring(0, 7);

  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={name}
        className={cn("text-xs", error && "text-red-500")}
      >
        {label}
      </Label>

      <div className="flex items-center gap-2">
        {/* Color swatch with native picker */}
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="h-8 w-8 p-0 border-2"
              style={{ backgroundColor: localValue }}
              aria-label={`Color: ${localValue}`}
            >
              <span className="sr-only">Pick color</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="start">
            <div className="space-y-3">
              {/* Native color picker */}
              <div className="flex items-center gap-2">
                <input
                  ref={colorInputRef}
                  type="color"
                  value={displayColor}
                  onChange={handleColorPickerChange}
                  className="w-12 h-12 cursor-pointer rounded border-0 p-0"
                />
                <div className="text-sm">
                  <div className="font-medium">Custom Color</div>
                  <div className="text-muted-foreground text-xs">
                    Click to pick
                  </div>
                </div>
              </div>

              {/* Preset colors */}
              {presets.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1.5">
                    Presets
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {presets.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={cn(
                          "w-6 h-6 rounded border-2 cursor-pointer transition-transform hover:scale-110",
                          localValue.toLowerCase() === preset.toLowerCase()
                            ? "border-primary ring-1 ring-primary"
                            : "border-transparent"
                        )}
                        style={{ backgroundColor: preset }}
                        onClick={() => handlePresetClick(preset)}
                        aria-label={`Select color ${preset}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Hex input */}
        <Input
          id={name}
          name={name}
          type="text"
          value={localValue}
          onChange={handleTextInputChange}
          onBlur={handleTextInputBlur}
          disabled={disabled}
          placeholder="#000000"
          maxLength={allowAlpha ? 9 : 7}
          className={cn(
            "h-8 text-sm font-mono flex-1",
            error && "border-red-500 focus-visible:ring-red-500"
          )}
        />
      </div>

      {description && !error && (
        <p className="text-[10px] text-muted-foreground">{description}</p>
      )}

      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}
