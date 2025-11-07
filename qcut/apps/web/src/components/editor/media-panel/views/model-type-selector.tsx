import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ModelTypeOption = "generation" | "edit" | "upscale";

interface ModelTypeSelectorProps {
  selected: ModelTypeOption;
  onChange: (type: ModelTypeOption) => void;
  className?: string;
}

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
    id: "edit",
    label: "Edit",
    description: "Prompt-guided",
  },
  {
    id: "upscale",
    label: "Upscale",
    description: "Enhance quality",
  },
];

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
            "flex-1 flex-col items-start gap-0.5",
            selected === option.id
              ? "shadow-sm"
              : "border border-transparent hover:border-border"
          )}
          data-testid={`model-type-${option.id}`}
        >
          <span className="text-xs font-medium">{option.label}</span>
          <span className="text-[10px] text-muted-foreground">
            {option.description}
          </span>
        </Button>
      ))}
    </div>
  );
}
