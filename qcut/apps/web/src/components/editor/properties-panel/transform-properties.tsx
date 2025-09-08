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

export function TransformProperties({ element, trackId }: TransformPropertiesProps) {
  const { updateTextElement } = useTimelineStore();
  const { getElementEffects } = useEffectsStore();
  
  // Check if element has effects or is a text element
  const hasEffects = getElementEffects(element.id).length > 0;
  const showTransformControls = hasEffects || element.type === "text";
  
  if (!showTransformControls) {
    return null;
  }

  // Initialize transform values
  const [transform, setTransform] = useState({
    x: (element as any).x || 0,
    y: (element as any).y || 0,
    width: (element as any).width || 200,
    height: (element as any).height || 100,
    rotation: (element as any).rotation || 0,
    scale: (element as any).scale || 100,
  });

  // Update local state when element changes
  useEffect(() => {
    setTransform({
      x: (element as any).x || 0,
      y: (element as any).y || 0,
      width: (element as any).width || 200,
      height: (element as any).height || 100,
      rotation: (element as any).rotation || 0,
      scale: (element as any).scale || 100,
    });
  }, [element]);

  const handleChange = (property: string, value: number) => {
    const newTransform = { ...transform, [property]: value };
    setTransform(newTransform);
    
    // Update element in timeline store
    updateTextElement(trackId, element.id, {
      ...newTransform,
      scale: newTransform.scale / 100, // Convert percentage to decimal
    } as any);
  };

  const handleReset = (property?: string) => {
    const defaults = {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 0,
      scale: 100,
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
                onChange={(e) => handleChange("x", parseInt(e.target.value) || 0)}
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
                onChange={(e) => handleChange("y", parseInt(e.target.value) || 0)}
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
                onChange={(e) => handleChange("width", parseInt(e.target.value) || 50)}
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
                onChange={(e) => handleChange("height", parseInt(e.target.value) || 50)}
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

        <PropertyItem>
          <PropertyItemLabel>Scale (%)</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={transform.scale}
                onChange={(e) => handleChange("scale", parseInt(e.target.value) || 100)}
                className="w-20"
              />
              <Slider
                value={[transform.scale]}
                onValueChange={([value]) => handleChange("scale", value)}
                min={10}
                max={200}
                step={1}
                className="flex-1"
              />
              <Button
                variant="text"
                size="icon"
                onClick={() => handleReset("scale")}
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
                onChange={(e) => handleChange("rotation", parseInt(e.target.value) || 0)}
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
                variant="outline"
                size="sm"
                onClick={() => handleChange("rotation", transform.rotation - 90)}
              >
                -90°
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleChange("rotation", transform.rotation - 45)}
              >
                -45°
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleChange("rotation", 0)}
              >
                0°
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleChange("rotation", transform.rotation + 45)}
              >
                +45°
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleChange("rotation", transform.rotation + 90)}
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