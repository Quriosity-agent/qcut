/**
 * Model Type Selector Component
 *
 * Scrollable pill bar for switching between AI model workflows.
 * Descriptions appear as tooltips on hover.
 *
 * @module ModelTypeSelector
 */

import { cn } from "@/lib/utils";

/**
 * Available model type options for AI workflows
 */
export type ModelTypeOption = "generation" | "upscale" | "angles";

/**
 * Props for the ModelTypeSelector component
 */
interface ModelTypeSelectorProps {
  /** Currently selected model type */
  selected: ModelTypeOption;
  /** Callback fired when selection changes */
  onChange: (type: ModelTypeOption) => void;
  /** Optional CSS class names */
  className?: string;
}

/**
 * Configuration for each model type option
 */
const MODEL_TYPE_OPTIONS: Array<{
  id: ModelTypeOption;
  label: string;
  description: string;
}> = [
  {
    id: "generation",
    label: "Generation",
    description: "Text → Image",
  },
  {
    id: "upscale",
    label: "Upscale",
    description: "Enhance quality",
  },
  {
    id: "angles",
    label: "Angles",
    description: "Multi-angle shots",
  },
];

/**
 * Scrollable pill bar for selecting AI model workflow type.
 * Scales to many options via horizontal scroll.
 */
export function ModelTypeSelector({
  selected,
  onChange,
  className,
}: ModelTypeSelectorProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 overflow-x-auto scrollbar-x-hidden rounded-lg bg-muted/40 p-1.5",
        className
      )}
      data-testid="text2image-model-type-selector"
    >
      {MODEL_TYPE_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          title={option.description}
          aria-pressed={selected === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors shrink-0",
            selected === option.id
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
          )}
          data-testid={`model-type-${option.id}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
