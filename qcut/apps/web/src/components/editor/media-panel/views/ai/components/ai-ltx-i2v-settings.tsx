import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { calculateLTXV2Cost } from "../utils/ai-cost-calculators";

export interface AiLtxI2VSettingsProps {
  duration: 6 | 8 | 10;
  onDurationChange: (value: 6 | 8 | 10) => void;
  resolution: "1080p" | "1440p" | "2160p";
  onResolutionChange: (value: "1080p" | "1440p" | "2160p") => void;
  fps: 25 | 50;
  onFpsChange: (value: 25 | 50) => void;
  generateAudio: boolean;
  onGenerateAudioChange: (value: boolean) => void;
  isCompact: boolean;
}

export function AiLtxI2VSettings({
  duration,
  onDurationChange,
  resolution,
  onResolutionChange,
  fps,
  onFpsChange,
  generateAudio,
  onGenerateAudioChange,
  isCompact,
}: AiLtxI2VSettingsProps) {
  void isCompact;

  const estimatedCost = calculateLTXV2Cost(resolution, duration, "pro");

  return (
    <div className="space-y-3 text-left border-t pt-3">
      <Label className="text-sm font-semibold">LTX Video 2.0 Settings</Label>

      <div className="space-y-1">
        <Label htmlFor="ltxv2-i2v-duration" className="text-xs font-medium">
          Duration
        </Label>
        <Select
          value={duration.toString()}
          onValueChange={(value) => onDurationChange(Number(value) as 6 | 8 | 10)}
        >
          <SelectTrigger id="ltxv2-i2v-duration" className="h-8 text-xs">
            <SelectValue placeholder="Select duration" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="6">6 seconds</SelectItem>
            <SelectItem value="8">8 seconds</SelectItem>
            <SelectItem value="10">10 seconds</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="ltxv2-i2v-resolution" className="text-xs font-medium">
          Resolution
        </Label>
        <Select
          value={resolution}
          onValueChange={(value) =>
            onResolutionChange(value as "1080p" | "1440p" | "2160p")
          }
        >
          <SelectTrigger id="ltxv2-i2v-resolution" className="h-8 text-xs">
            <SelectValue placeholder="Select resolution" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1080p">1080p ($0.06/sec)</SelectItem>
            <SelectItem value="1440p">1440p ($0.12/sec)</SelectItem>
            <SelectItem value="2160p">4K ($0.24/sec)</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">
          Estimated cost: ${estimatedCost.toFixed(2)}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="ltxv2-i2v-fps" className="text-xs font-medium">
          Frame Rate
        </Label>
        <Select
          value={fps.toString()}
          onValueChange={(value) => onFpsChange(Number(value) as 25 | 50)}
        >
          <SelectTrigger id="ltxv2-i2v-fps" className="h-8 text-xs">
            <SelectValue placeholder="Select frame rate" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="25">25 FPS (Standard)</SelectItem>
            <SelectItem value="50">50 FPS (High)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="ltxv2-i2v-audio"
          checked={generateAudio}
          onCheckedChange={(checked) => onGenerateAudioChange(Boolean(checked))}
        />
        <Label htmlFor="ltxv2-i2v-audio" className="text-xs">
          Generate synchronized audio
        </Label>
      </div>

      <div className="text-xs text-muted-foreground">
        Transforms your image into a high-quality video with matching audio.
      </div>
    </div>
  );
}
