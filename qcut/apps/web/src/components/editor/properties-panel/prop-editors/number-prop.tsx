/**
 * Number Prop Editor
 *
 * Input component for numeric properties with slider and direct input.
 *
 * @module components/editor/properties-panel/prop-editors/number-prop
 */

import React, { useCallback, useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { BasePropEditorProps } from "./index";

export interface NumberPropProps extends BasePropEditorProps<number> {
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Unit suffix (e.g., "px", "%", "deg") */
  unit?: string;
  /** Whether to show the slider */
  showSlider?: boolean;
}

export function NumberProp({
  name,
  label,
  value,
  onChange,
  description,
  error,
  disabled,
  min,
  max,
  step = 1,
  unit,
  showSlider = true,
}: NumberPropProps) {
  const [localValue, setLocalValue] = useState<string>(String(value ?? 0));
  const [isFocused, setIsFocused] = useState(false);

  // Determine if we can show slider (need min/max)
  const canShowSlider = showSlider && min !== undefined && max !== undefined;

  // Sync local state with external value (when not focused)
  useEffect(() => {
    if (!isFocused) {
      setLocalValue(String(value ?? 0));
    }
  }, [value, isFocused]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputValue = e.target.value;
      setLocalValue(inputValue);

      // Try to parse and update immediately for valid numbers
      const parsed = parseFloat(inputValue);
      if (!isNaN(parsed)) {
        let clampedValue = parsed;
        if (min !== undefined) clampedValue = Math.max(min, clampedValue);
        if (max !== undefined) clampedValue = Math.min(max, clampedValue);
        onChange(clampedValue);
      }
    },
    [onChange, min, max]
  );

  const handleInputBlur = useCallback(() => {
    setIsFocused(false);
    const parsed = parseFloat(localValue);
    if (isNaN(parsed)) {
      setLocalValue(String(value ?? 0));
    } else {
      let clampedValue = parsed;
      if (min !== undefined) clampedValue = Math.max(min, clampedValue);
      if (max !== undefined) clampedValue = Math.min(max, clampedValue);
      setLocalValue(String(clampedValue));
      onChange(clampedValue);
    }
  }, [localValue, value, min, max, onChange]);

  const handleSliderChange = useCallback(
    (values: number[]) => {
      const newValue = values[0];
      setLocalValue(String(newValue));
      onChange(newValue);
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const currentValue = parseFloat(localValue) || 0;
        const delta = e.key === "ArrowUp" ? step : -step;
        let newValue = currentValue + delta;
        if (min !== undefined) newValue = Math.max(min, newValue);
        if (max !== undefined) newValue = Math.min(max, newValue);
        setLocalValue(String(newValue));
        onChange(newValue);
      }
    },
    [localValue, step, min, max, onChange]
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label
          htmlFor={name}
          className={cn("text-xs", error && "text-red-500")}
        >
          {label}
        </Label>
        {min !== undefined && max !== undefined && (
          <span className="text-[10px] text-muted-foreground">
            {min} - {max}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {canShowSlider && (
          <Slider
            value={[parseFloat(localValue) || 0]}
            onValueChange={handleSliderChange}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            className="flex-1"
          />
        )}

        <div className="relative">
          <Input
            id={name}
            name={name}
            type="number"
            value={localValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onFocus={() => setIsFocused(true)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            min={min}
            max={max}
            step={step}
            className={cn(
              "h-8 text-sm w-20",
              unit && "pr-6",
              error && "border-red-500 focus-visible:ring-red-500"
            )}
          />
          {unit && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {unit}
            </span>
          )}
        </div>
      </div>

      {description && !error && (
        <p className="text-[10px] text-muted-foreground">{description}</p>
      )}

      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}
