import { MediaElement } from "@/types/timeline";
import { PropertyGroup, PropertyItem, PropertyItemLabel, PropertyItemValue } from "./property-item";
import { Slider } from "@/components/ui/slider";
import { useState } from "react";
import { useTimelineStore } from "@/stores/timeline-store";

export function AudioProperties({ 
  element, 
  trackId 
}: { 
  element: MediaElement; 
  trackId: string;
}) {
  const { updateMediaElement } = useTimelineStore();
  // Initialize volume from element or default to 100%
  const [volume, setVolume] = useState(
    element.volume !== undefined ? Math.round(element.volume * 100) : 100
  );
  
  return (
    <div className="space-y-4 p-5">
      <PropertyGroup title="Audio Controls" defaultExpanded={true}>
        <PropertyItem direction="column">
          <PropertyItemLabel>Volume</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                aria-label="Volume"
                value={[volume]}
                min={0}
                max={100}
                step={1}
                onValueChange={([value]) => {
                  setVolume(value);
                  updateMediaElement(trackId, element.id, { volume: value / 100 });
                }}
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
