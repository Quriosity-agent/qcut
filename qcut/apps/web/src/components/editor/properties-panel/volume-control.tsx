import { MediaElement } from "@/types/timeline";
import { PropertyGroup, PropertyItem, PropertyItemLabel, PropertyItemValue } from "./property-item";
import { Slider } from "@/components/ui/slider";
import { useState, useCallback, useEffect } from "react";
import { useTimelineStore } from "@/stores/timeline-store";

interface VolumeControlProps {
  element: MediaElement;
  trackId: string;
}

export function VolumeControl({ element, trackId }: VolumeControlProps) {
  const { updateMediaElement } = useTimelineStore();
  const [volume, setVolume] = useState(
    element.volume !== undefined ? Math.round(element.volume * 100) : 100
  );

  useEffect(() => {
    setVolume(element.volume !== undefined ? Math.round(element.volume * 100) : 100);
  }, [element.volume]);

  const handleVolumeChange = useCallback((newVolume: number) => {
    setVolume(newVolume);
    updateMediaElement(trackId, element.id, { volume: newVolume / 100 });
  }, [updateMediaElement, trackId, element.id]);

  return (
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
              onValueChange={([value]) => handleVolumeChange(value)}
              className="w-full"
            />
            <span className="text-xs w-12">{volume}%</span>
          </div>
        </PropertyItemValue>
      </PropertyItem>
    </PropertyGroup>
  );
}