import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ERROR_MESSAGES, LTXV2_FAST_CONFIG } from "../constants/ai-constants";
import {
  LTXV2_FAST_FPS_LABELS,
  LTXV2_FAST_RESOLUTION_LABELS,
  LTXV2_FAST_RESOLUTION_PRICE_SUFFIX,
  type LTXV2FastDuration,
  type LTXV2FastFps,
  type LTXV2FastResolution,
} from "../constants/ai-model-options";

export interface AiLtxFastI2VSettingsProps {
  duration: LTXV2FastDuration;
  onDurationChange: (value: LTXV2FastDuration) => void;
  resolution: LTXV2FastResolution;
  onResolutionChange: (value: LTXV2FastResolution) => void;
  fps: LTXV2FastFps;
  onFpsChange: (value: LTXV2FastFps) => void;
  generateAudio: boolean;
  onGenerateAudioChange: (value: boolean) => void;
  isCompact: boolean;
}

export function AiLtxFastI2VSettings({
  duration,
  onDurationChange,
  resolution,
  onResolutionChange,
  fps,
  onFpsChange,
  generateAudio,
  onGenerateAudioChange,
  isCompact,
}: AiLtxFastI2VSettingsProps) {
  void isCompact;

  const ltxv2FastExtendedResolutions = LTXV2_FAST_CONFIG.RESOLUTIONS.EXTENDED;
  const ltxv2FastExtendedFps = LTXV2_FAST_CONFIG.FPS_OPTIONS.EXTENDED;
  const isExtendedDuration =
    duration > LTXV2_FAST_CONFIG.EXTENDED_DURATION_THRESHOLD;

  return (
    <div className="space-y-3 text-left border-t pt-3">
      <Label className="text-sm font-semibold">LTX Video 2.0 Fast Settings</Label>

      <div className="space-y-1">
        <Label htmlFor="ltxv2-image-duration" className="text-xs font-medium">
          Duration
        </Label>
        <Select
          value={duration.toString()}
          onValueChange={(value) =>
            onDurationChange(Number(value) as LTXV2FastDuration)
          }
        >
          <SelectTrigger id="ltxv2-image-duration" className="h-8 text-xs">
            <SelectValue placeholder="Select duration" />
          </SelectTrigger>
          <SelectContent>
            {LTXV2_FAST_CONFIG.DURATIONS.map((durationOption) => (
              <SelectItem key={durationOption} value={durationOption.toString()}>
                {durationOption} seconds
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="ltxv2-image-resolution" className="text-xs font-medium">
          Resolution
        </Label>
        <Select
          value={resolution}
          onValueChange={(value) =>
            onResolutionChange(value as LTXV2FastResolution)
          }
        >
          <SelectTrigger id="ltxv2-image-resolution" className="h-8 text-xs">
            <SelectValue placeholder="Select resolution" />
          </SelectTrigger>
          <SelectContent>
            {LTXV2_FAST_CONFIG.RESOLUTIONS.STANDARD.map((resolutionOption) => {
              const disabled =
                isExtendedDuration &&
                !ltxv2FastExtendedResolutions.includes(
                  resolutionOption as (typeof ltxv2FastExtendedResolutions)[number]
                );

              return (
                <SelectItem
                  key={resolutionOption}
                  value={resolutionOption}
                  disabled={disabled}
                >
                  {LTXV2_FAST_RESOLUTION_LABELS[resolutionOption]}
                  {LTXV2_FAST_RESOLUTION_PRICE_SUFFIX[resolutionOption] ?? ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="ltxv2-image-fps" className="text-xs">
          Frame Rate
        </Label>
        <Select
          value={fps.toString()}
          onValueChange={(value) => onFpsChange(Number(value) as LTXV2FastFps)}
        >
          <SelectTrigger id="ltxv2-image-fps" className="h-8 text-xs">
            <SelectValue placeholder="Select frame rate" />
          </SelectTrigger>
          <SelectContent>
            {LTXV2_FAST_CONFIG.FPS_OPTIONS.STANDARD.map((fpsOption) => {
              const disabled =
                isExtendedDuration &&
                !ltxv2FastExtendedFps.includes(
                  fpsOption as (typeof ltxv2FastExtendedFps)[number]
                );

              return (
                <SelectItem
                  key={fpsOption}
                  value={fpsOption.toString()}
                  disabled={disabled}
                >
                  {LTXV2_FAST_FPS_LABELS[fpsOption]}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="ltxv2-image-audio"
          checked={generateAudio}
          onCheckedChange={(checked) => onGenerateAudioChange(Boolean(checked))}
        />
        <Label htmlFor="ltxv2-image-audio" className="text-xs">
          Generate audio
        </Label>
      </div>

      {isExtendedDuration && (
        <div className="text-xs text-muted-foreground">
          {ERROR_MESSAGES.LTXV2_I2V_EXTENDED_DURATION_CONSTRAINT}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        6-20 second clips with optional audio at up to 4K. Longer clips
        automatically use 1080p at 25 FPS.
      </div>
    </div>
  );
}
