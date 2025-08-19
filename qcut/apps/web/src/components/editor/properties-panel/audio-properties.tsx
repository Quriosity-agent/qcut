import { MediaElement } from "@/types/timeline";
import { PropertyGroup, PropertyItem, PropertyItemLabel, PropertyItemValue } from "./property-item";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useTimelineStore } from "@/stores/timeline-store";

export function AudioProperties({ element, trackId }: { element: MediaElement; trackId: string }) {
  const { updateMediaElement } = useTimelineStore();
  const [volumeInput, setVolumeInput] = useState(
    Math.round((element.volume || 1) * 100).toString()
  );
  
  const parseAndValidateNumber = (
    value: string,
    min: number,
    max: number,
    fallback: number
  ): number => {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  };

  const handleVolumeChange = (value: string) => {
    setVolumeInput(value);
    
    if (value.trim() !== "") {
      const volumePercent = parseAndValidateNumber(value, 0, 100, Math.round((element.volume || 1) * 100));
      updateMediaElement(trackId, element.id, { volume: volumePercent / 100 });
    }
  };

  const handleVolumeBlur = () => {
    const volumePercent = parseAndValidateNumber(
      volumeInput,
      0,
      100,
      Math.round((element.volume || 1) * 100)
    );
    setVolumeInput(volumePercent.toString());
    updateMediaElement(trackId, element.id, { volume: volumePercent / 100 });
  };
  
  return (
    <div className="space-y-4 p-5">
      <PropertyGroup title="Audio Controls" defaultExpanded={true}>
        <PropertyItem direction="column">
          <PropertyItemLabel>Volume</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                value={[(element.volume || 1) * 100]}
                min={0}
                max={100}
                step={1}
                onValueChange={([value]) => {
                  updateMediaElement(trackId, element.id, { volume: value / 100 });
                  setVolumeInput(value.toString());
                }}
                className="w-full"
              />
              <Input
                type="number"
                value={volumeInput}
                min={0}
                max={100}
                onChange={(e) => handleVolumeChange(e.target.value)}
                onBlur={handleVolumeBlur}
                className="w-12 !text-xs h-7 rounded-sm text-center
                 [appearance:textfield]
                 [&::-webkit-outer-spin-button]:appearance-none
                 [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>
    </div>
  );
}
