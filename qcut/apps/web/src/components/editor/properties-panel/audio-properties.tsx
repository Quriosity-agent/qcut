import { MediaElement } from "@/types/timeline";
import { PropertyGroup, PropertyItem, PropertyItemLabel, PropertyItemValue } from "./property-item";
import { Slider } from "@/components/ui/slider";
import { useState } from "react";

export function AudioProperties({ element }: { element: MediaElement }) {
  const [volume, setVolume] = useState(100);
  
  return (
    <div className="space-y-4 p-5">
      <PropertyGroup title="Audio Controls" defaultExpanded={true}>
        <PropertyItem direction="column">
          <PropertyItemLabel>Volume</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                value={[volume]}
                min={0}
                max={100}
                step={1}
                onValueChange={([value]) => setVolume(value)}
                className="w-full"
              />
              <span className="text-xs w-12">{volume}%</span>
            </div>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>
      
      <PropertyGroup title="Audio Info" defaultExpanded={false}>
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
      </PropertyGroup>
    </div>
  );
}
