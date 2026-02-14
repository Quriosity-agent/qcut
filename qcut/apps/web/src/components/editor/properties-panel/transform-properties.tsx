import { useState, useEffect } from "react";
import { TimelineElement } from "@/types/timeline";
import { useTimelineStore } from "@/stores/timeline-store";
import { useEffectsStore } from "@/stores/effects-store";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  PropertyItem,
  PropertyItemLabel,
  PropertyItemValue,
  PropertyGroup,
} from "./property-item";
import { RotateCcw, Move, Maximize2, RotateCw } from "lucide-react";

interface TransformPropertiesProps {
  element: TimelineElement;
  trackId: string;
}

// Type guard to check if element has transform properties
function getTransformProperties(element: TimelineElement) {
  // Text and markdown elements always have these properties
  if (element.type === "text" || element.type === "markdown") {
    return {
      x: element.x,
      y: element.y,
      width: element.width ?? 200,
      height: element.height ?? 100,
      rotation: element.rotation,
    };
  }

  // Other elements may have optional transform properties
  return {
    x: element.x ?? 0,
    y: element.y ?? 0,
    width: element.width ?? 200,
    height: element.height ?? 100,
    rotation: element.rotation ?? 0,
  };
}

export function TransformProperties({
  element,
  trackId,
}: TransformPropertiesProps) {
  const { updateElementTransform } = useTimelineStore();
  const { getElementEffects } = useEffectsStore();

  // Check if element has effects or is a text/markdown element
  const hasEffects = getElementEffects(element.id).length > 0;
  const showTransformControls =
    hasEffects || element.type === "text" || element.type === "markdown";

  // Initialize transform values using type-safe getter
  const [transform, setTransform] = useState(() =>
    getTransformProperties(element)
  );

  // Update local state when element changes
  useEffect(() => {
    setTransform(getTransformProperties(element));
  }, [element]);

  if (!showTransformControls) {
    return null;
  }

  const handleChange = (property: string, value: number) => {
    const newTransform = { ...transform, [property]: value };
    setTransform(newTransform);

    // Update element transform in timeline store
    const transformUpdate = {
      position: { x: newTransform.x, y: newTransform.y },
      size: { width: newTransform.width, height: newTransform.height },
      rotation: newTransform.rotation,
    };

    updateElementTransform(element.id, transformUpdate, { pushHistory: true });
  };

  const handleReset = (property?: string) => {
    const defaults = {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 0,
    };

    if (property) {
      handleChange(property, defaults[property as keyof typeof defaults]);
    } else {
      // Reset all
      Object.entries(defaults).forEach(([key, value]) => {
        handleChange(key, value);
      });
    }
  };

  return (
    <div className="space-y-4">
      <PropertyGroup title="Position" defaultExpanded>
        <PropertyItem>
          <PropertyItemLabel>X Position</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={transform.x}
                onChange={(e) =>
                  handleChange("x", parseInt(e.target.value, 10) || 0)
                }
                className="w-20"
              />
              <Slider
                value={[transform.x]}
                onValueChange={([value]) => handleChange("x", value)}
                min={-500}
                max={500}
                step={1}
                className="flex-1"
              />
              <Button
                variant="text"
                size="icon"
                onClick={() => handleReset("x")}
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
            </div>
          </PropertyItemValue>
        </PropertyItem>

        <PropertyItem>
          <PropertyItemLabel>Y Position</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={transform.y}
                onChange={(e) =>
                  handleChange("y", parseInt(e.target.value, 10) || 0)
                }
                className="w-20"
              />
              <Slider
                value={[transform.y]}
                onValueChange={([value]) => handleChange("y", value)}
                min={-500}
                max={500}
                step={1}
                className="flex-1"
              />
              <Button
                variant="text"
                size="icon"
                onClick={() => handleReset("y")}
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
            </div>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>

      <PropertyGroup title="Size" defaultExpanded>
        <PropertyItem>
          <PropertyItemLabel>Width</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={transform.width}
                onChange={(e) =>
                  handleChange("width", parseInt(e.target.value, 10) || 50)
                }
                className="w-20"
              />
              <Slider
                value={[transform.width]}
                onValueChange={([value]) => handleChange("width", value)}
                min={50}
                max={1920}
                step={1}
                className="flex-1"
              />
              <Button
                variant="text"
                size="icon"
                onClick={() => handleReset("width")}
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
            </div>
          </PropertyItemValue>
        </PropertyItem>

        <PropertyItem>
          <PropertyItemLabel>Height</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={transform.height}
                onChange={(e) =>
                  handleChange("height", parseInt(e.target.value, 10) || 50)
                }
                className="w-20"
              />
              <Slider
                value={[transform.height]}
                onValueChange={([value]) => handleChange("height", value)}
                min={50}
                max={1080}
                step={1}
                className="flex-1"
              />
              <Button
                variant="text"
                size="icon"
                onClick={() => handleReset("height")}
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
            </div>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>

      <PropertyGroup title="Rotation" defaultExpanded>
        <PropertyItem>
          <PropertyItemLabel>Angle (degrees)</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={transform.rotation}
                onChange={(e) =>
                  handleChange("rotation", parseInt(e.target.value, 10) || 0)
                }
                className="w-20"
              />
              <Slider
                value={[transform.rotation]}
                onValueChange={([value]) => handleChange("rotation", value)}
                min={-180}
                max={180}
                step={1}
                className="flex-1"
              />
              <Button
                variant="text"
                size="icon"
                onClick={() => handleReset("rotation")}
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
            </div>
          </PropertyItemValue>
        </PropertyItem>

        <PropertyItem>
          <PropertyItemLabel>Quick Rotate</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  handleChange("rotation", transform.rotation - 90)
                }
              >
                -90°
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  handleChange("rotation", transform.rotation - 45)
                }
              >
                -45°
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleChange("rotation", 0)}
              >
                0°
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  handleChange("rotation", transform.rotation + 45)
                }
              >
                +45°
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  handleChange("rotation", transform.rotation + 90)
                }
              >
                +90°
              </Button>
            </div>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>

      <div className="pt-4 border-t">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => handleReset()}
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Reset All Transforms
        </Button>
      </div>
    </div>
  );
}
