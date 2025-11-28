/**
 * Model Type Selector Component
 *
 * Provides a segmented control for switching between different AI model workflows:
 * - Generation: Text-to-image creation
 * - Upscale: Image quality enhancement
 *
 * Note: Image editing functionality is available in the separate Adjustment panel.
 *
 * @module ModelTypeSelector
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Available model type options for AI workflows
 */
export type ModelTypeOption = "generation" | "upscale";

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
 * Defines the UI labels and descriptions shown in the selector
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
];

/**
 * Segmented control component for selecting AI model workflow type
 *
 * Displays two options (Generation, Upscale) as buttons with visual
 * feedback for the currently selected option. Uses proper ARIA attributes for
 * accessibility.
 *
 * @param props - Component props
 * @returns A horizontal button group for model type selection
 *
 * @example
 * ```tsx
 * <ModelTypeSelector
 *   selected="generation"
 *   onChange={(type) => console.log(type)}
 * />
 * ```
 */
export function ModelTypeSelector({
  selected,
  onChange,
  className,
}: ModelTypeSelectorProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg bg-muted/40 p-2",
        className
      )}
      data-testid="text2image-model-type-selector"
    >
      {MODEL_TYPE_OPTIONS.map((option) => (
        <Button
          key={option.id}
          type="button"
          size="sm"
          variant={selected === option.id ? "default" : "outline"}
          aria-pressed={selected === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "flex-1 flex-col items-start gap-0.5 px-3 py-1 h-auto",
            selected === option.id
              ? "shadow-sm"
              : "border border-transparent hover:border-border"
          )}
          data-testid={`model-type-${option.id}`}
        >
          <span className="text-sm font-medium">{option.label}</span>
          <span className="text-xs text-muted-foreground">
            {option.description}
          </span>
        </Button>
      ))}
    </div>
  );
}
