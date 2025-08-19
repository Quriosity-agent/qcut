import { MediaElement } from "@/types/timeline";
import { PropertyGroup, PropertyItem, PropertyItemLabel, PropertyItemValue } from "./property-item";
import { Slider } from "@/components/ui/slider";
import { useState } from "react";

export function MediaProperties({ element }: { element: MediaElement }) {
  const [opacity, setOpacity] = useState(100);
  const [scale, setScale] = useState(100);
  const [rotation, setRotation] = useState(0);
  
  return (
    <div className="space-y-4 p-5">
      <PropertyGroup title="Transform" defaultExpanded={true}>
        <PropertyItem direction="column">
          <PropertyItemLabel>Scale</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                value={[scale]}
                min={10}
                max={200}
                step={1}
                onValueChange={([value]) => setScale(value)}
                className="w-full"
              />
              <span className="text-xs w-12">{scale}%</span>
            </div>
          </PropertyItemValue>
        </PropertyItem>
        
        <PropertyItem direction="column">
          <PropertyItemLabel>Rotation</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                value={[rotation]}
                min={-180}
                max={180}
                step={1}
                onValueChange={([value]) => setRotation(value)}
                className="w-full"
              />
              <span className="text-xs w-12">{rotation}°</span>
            </div>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>
      
      <PropertyGroup title="Effects" defaultExpanded={false}>
        <PropertyItem direction="column">
          <PropertyItemLabel>Opacity</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                value={[opacity]}
                min={0}
                max={100}
                step={1}
                onValueChange={([value]) => setOpacity(value)}
                className="w-full"
              />
              <span className="text-xs w-12">{opacity}%</span>
            </div>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>
      
      <PropertyGroup title="Media Info" defaultExpanded={false}>
        <PropertyItem direction="column">
          <PropertyItemLabel>Element Name</PropertyItemLabel>
          <PropertyItemValue>
            <span className="text-xs">{element.name}</span>
          </PropertyItemValue>
        </PropertyItem>
        <PropertyItem direction="column">
          <PropertyItemLabel>Duration</PropertyItemLabel>
          <PropertyItemValue>
            <span className="text-xs">{(element.duration / 1000).toFixed(2)}s</span>
          </PropertyItemValue>
        </PropertyItem>
        <PropertyItem direction="column">
          <PropertyItemLabel>Start Time</PropertyItemLabel>
          <PropertyItemValue>
            <span className="text-xs">{(element.startTime / 1000).toFixed(2)}s</span>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>
    </div>
  );
}
