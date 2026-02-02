/**
 * Prop Editor Factory
 *
 * Renders the appropriate prop editor component based on field type.
 *
 * @module components/editor/properties-panel/prop-editors/prop-editor-factory
 */

import React, { useCallback } from "react";
import { TextProp } from "./text-prop";
import { NumberProp } from "./number-prop";
import { ColorProp } from "./color-prop";
import { SelectProp } from "./select-prop";
import { BooleanProp } from "./boolean-prop";
import type { ParsedField } from "@/lib/remotion/schema-parser";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface PropEditorFactoryProps {
  /** Parsed field information */
  field: ParsedField;
  /** Current value */
  value: unknown;
  /** Change handler */
  onChange: (value: unknown) => void;
  /** Validation error */
  error?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Path prefix for nested fields */
  pathPrefix?: string;
}

interface ObjectEditorProps {
  field: ParsedField;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  pathPrefix?: string;
}

// ============================================================================
// Object Editor (for nested objects)
// ============================================================================

function ObjectEditor({
  field,
  value,
  onChange,
  errors = {},
  disabled,
  pathPrefix = "",
}: ObjectEditorProps) {
  const [isExpanded, setIsExpanded] = React.useState(true);

  const handleFieldChange = useCallback(
    (fieldName: string, fieldValue: unknown) => {
      onChange({
        ...value,
        [fieldName]: fieldValue,
      });
    },
    [value, onChange]
  );

  if (!field.children || field.children.length === 0) {
    return null;
  }

  const fullPath = pathPrefix ? `${pathPrefix}.${field.name}` : field.name;

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="flex items-center gap-1 text-xs font-medium w-full text-left hover:bg-accent/50 rounded px-1 py-0.5 -mx-1"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        {field.label}
      </button>

      {isExpanded && (
        <div className="pl-3 border-l border-border space-y-3">
          {field.children.map((childField) => {
            const childPath = `${fullPath}.${childField.name}`;
            return (
              <PropEditorFactory
                key={childField.name}
                field={childField}
                value={value?.[childField.name]}
                onChange={(newValue) =>
                  handleFieldChange(childField.name, newValue)
                }
                error={errors[childPath]}
                disabled={disabled}
                pathPrefix={fullPath}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Array Editor (placeholder for array types)
// ============================================================================

interface ArrayEditorProps {
  field: ParsedField;
  value: unknown[];
  onChange: (value: unknown[]) => void;
  disabled?: boolean;
}

function ArrayEditor({
  field,
  value = [],
  onChange,
  disabled,
}: ArrayEditorProps) {
  // Basic array display - full implementation would include add/remove items
  return (
    <div className="space-y-2">
      <Label className="text-xs">{field.label}</Label>
      <div className="text-xs text-muted-foreground p-2 border rounded bg-muted/30">
        Array with {value.length} item(s)
        {field.description && <p className="mt-1">{field.description}</p>}
      </div>
    </div>
  );
}

// ============================================================================
// Main Factory Component
// ============================================================================

export function PropEditorFactory({
  field,
  value,
  onChange,
  error,
  disabled,
  pathPrefix = "",
}: PropEditorFactoryProps) {
  const handleChange = useCallback(
    (newValue: unknown) => {
      onChange(newValue);
    },
    [onChange]
  );

  switch (field.type) {
    case "string":
      return (
        <TextProp
          name={field.name}
          label={field.label}
          value={(value as string) ?? (field.defaultValue as string) ?? ""}
          onChange={handleChange as (v: string) => void}
          description={field.description}
          error={error}
          disabled={disabled}
          minLength={field.validation.minLength}
          maxLength={field.validation.maxLength}
          multiline={
            field.validation.maxLength !== undefined &&
            field.validation.maxLength > 100
          }
        />
      );

    case "number":
      return (
        <NumberProp
          name={field.name}
          label={field.label}
          value={(value as number) ?? (field.defaultValue as number) ?? 0}
          onChange={handleChange as (v: number) => void}
          description={field.description}
          error={error}
          disabled={disabled}
          min={field.validation.min}
          max={field.validation.max}
          step={field.validation.step}
          showSlider={
            field.validation.min !== undefined &&
            field.validation.max !== undefined
          }
        />
      );

    case "boolean":
      return (
        <BooleanProp
          name={field.name}
          label={field.label}
          value={(value as boolean) ?? (field.defaultValue as boolean) ?? false}
          onChange={handleChange as (v: boolean) => void}
          description={field.description}
          error={error}
          disabled={disabled}
        />
      );

    case "color":
      return (
        <ColorProp
          name={field.name}
          label={field.label}
          value={
            (value as string) ?? (field.defaultValue as string) ?? "#000000"
          }
          onChange={handleChange as (v: string) => void}
          description={field.description}
          error={error}
          disabled={disabled}
        />
      );

    case "select":
      return (
        <SelectProp
          name={field.name}
          label={field.label}
          value={value ?? field.defaultValue}
          onChange={handleChange}
          description={field.description}
          error={error}
          disabled={disabled}
          options={field.validation.options || []}
        />
      );

    case "object":
      return (
        <ObjectEditor
          field={field}
          value={(value as Record<string, unknown>) ?? {}}
          onChange={handleChange as (v: Record<string, unknown>) => void}
          disabled={disabled}
          pathPrefix={pathPrefix}
        />
      );

    case "array":
      return (
        <ArrayEditor
          field={field}
          value={(value as unknown[]) ?? []}
          onChange={handleChange as (v: unknown[]) => void}
          disabled={disabled}
        />
      );

    default:
      return (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{field.label}</Label>
          <div className="text-xs text-muted-foreground p-2 border rounded bg-muted/30">
            Unsupported field type: {field.type}
          </div>
        </div>
      );
  }
}
