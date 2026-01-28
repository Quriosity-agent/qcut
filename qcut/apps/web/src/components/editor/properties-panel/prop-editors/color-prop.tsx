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
 * @param color - Color string to normalize
 * @param preserveAlpha - Whether to preserve alpha channel (converts to 8-digit hex)
 */
function normalizeColor(color: string, preserveAlpha = false): string {
  // Handle empty or invalid
  if (!color) return "#000000";

  // Already a hex color
  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color)) {
    // Expand 3-char hex to 6-char
    if (color.length === 4) {
      return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }
    // Expand 4-char hex (#RGBA) to 8-char (#RRGGBBAA)
    if (color.length === 5) {
      const expanded = `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}${color[4]}${color[4]}`;
      if (!preserveAlpha) {
        return expanded.slice(0, 7).toLowerCase();
      }
      return expanded.toLowerCase();
    }
    // Strip alpha if not preserving
    if (!preserveAlpha && color.length === 9) {
      return color.slice(0, 7).toLowerCase();
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
    const rHex = r.toString(16).padStart(2, "0");
    const gHex = g.toString(16).padStart(2, "0");
    const bHex = b.toString(16).padStart(2, "0");

    // Handle alpha channel if present and preserving
    if (preserveAlpha && rgbMatch[4] !== undefined) {
      const alpha = Math.min(1, Math.max(0, parseFloat(rgbMatch[4])));
      const aHex = Math.round(alpha * 255)
        .toString(16)
        .padStart(2, "0");
      return `#${rHex}${gHex}${bHex}${aHex}`.toLowerCase();
    }

    return `#${rHex}${gHex}${bHex}`.toLowerCase();
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
  const [localValue, setLocalValue] = useState(normalizeColor(value, allowAlpha));
  const [isOpen, setIsOpen] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Sync local state with external value
  useEffect(() => {
    setLocalValue(normalizeColor(value, allowAlpha));
  }, [value, allowAlpha]);

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

      // Only update if it's a valid hex color (3, 4, 6, or 8 chars)
      if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(inputValue)) {
        onChange(normalizeColor(inputValue, allowAlpha));
      }
    },
    [onChange, allowAlpha]
  );

  const handleTextInputBlur = useCallback(() => {
    // Normalize on blur
    const normalized = normalizeColor(localValue, allowAlpha);
    setLocalValue(normalized);
    onChange(normalized);
  }, [localValue, onChange, allowAlpha]);

  const handlePresetClick = useCallback(
    (preset: string) => {
      const normalized = normalizeColor(preset, allowAlpha);
      setLocalValue(normalized);
      onChange(normalized);
    },
    [onChange, allowAlpha]
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
