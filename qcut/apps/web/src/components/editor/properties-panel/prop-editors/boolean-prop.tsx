/**
 * Boolean Prop Editor
 *
 * Toggle switch component for boolean properties.
 *
 * @module components/editor/properties-panel/prop-editors/boolean-prop
 */

import React, { useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { BasePropEditorProps } from "./index";

export interface BooleanPropProps extends BasePropEditorProps<boolean> {
  /** Label shown when true */
  trueLabel?: string;
  /** Label shown when false */
  falseLabel?: string;
}

export function BooleanProp({
  name,
  label,
  value,
  onChange,
  description,
  error,
  disabled,
  trueLabel,
  falseLabel,
}: BooleanPropProps) {
  const handleChange = useCallback(
    (checked: boolean) => {
      onChange(checked);
    },
    [onChange]
  );

  const stateLabel = value
    ? trueLabel || "On"
    : falseLabel || "Off";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label
          htmlFor={name}
          className={cn("text-xs", error && "text-red-500")}
        >
          {label}
        </Label>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {stateLabel}
          </span>
          <Switch
            id={name}
            checked={value}
            onCheckedChange={handleChange}
            disabled={disabled}
            className={cn(error && "data-[state=unchecked]:bg-red-200")}
          />
        </div>
      </div>

      {description && !error && (
        <p className="text-[10px] text-muted-foreground">{description}</p>
      )}

      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}
