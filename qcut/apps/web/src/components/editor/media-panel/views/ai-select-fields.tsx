/**
 * Reusable AI Select Field Components
 *
 * Standardized select components for common AI model settings like
 * duration, resolution, aspect ratio, and FPS. These reduce code duplication
 * across multiple model configurations.
 *
 * @see ai-tsx-refactoring.md - Subtask 3.2
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

// ============================================
// Types
// ============================================

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
  priceSuffix?: string;
}

export interface BaseSelectProps<T extends string | number> {
  /** Current selected value */
  value: T;
  /** Callback when value changes */
  onChange: (value: T) => void;
  /** Whether the select is disabled */
  disabled?: boolean;
  /** Optional ID for the select element */
  id?: string;
  /** Additional CSS classes */
  className?: string;
}

// ============================================
// Duration Select
// ============================================

export interface DurationSelectProps extends BaseSelectProps<number> {
  /** Available duration options in seconds */
  options: number[];
  /** Optional price per second for cost display */
  pricePerSecond?: number;
  /** Label text (default: "Duration") */
  label?: string;
  /** Whether to show the label */
  showLabel?: boolean;
}

/**
 * Duration selector used by multiple AI models.
 *
 * @example
 * ```tsx
 * <DurationSelect
 *   value={seedanceDuration}
 *   onChange={setSeedanceDuration}
 *   options={[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
 * />
 * ```
 */
export function DurationSelect({
  value,
  onChange,
  options,
  pricePerSecond,
  disabled = false,
  id,
  label = "Duration",
  showLabel = true,
  className = "",
}: DurationSelectProps) {
  return (
    <div className={`space-y-1 ${className}`}>
      {showLabel && (
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
      )}
      <Select
        value={value.toString()}
        onValueChange={(v) => onChange(Number(v))}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-8 text-xs">
          <SelectValue placeholder="Select duration" />
        </SelectTrigger>
        <SelectContent>
          {options.map((dur) => (
            <SelectItem key={dur} value={dur.toString()}>
              {dur} seconds
              {pricePerSecond !== undefined && (
                <span className="text-muted-foreground ml-1">
                  (${(dur * pricePerSecond).toFixed(2)})
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// Resolution Select
// ============================================

export interface ResolutionSelectProps extends BaseSelectProps<string> {
  /** Available resolution options */
  options: string[];
  /** Optional labels for resolutions (e.g., "1080p" -> "1080p (Full HD)") */
  labels?: Record<string, string>;
  /** Optional price suffix for each resolution */
  priceSuffix?: Record<string, string>;
  /** Options to disable based on external conditions */
  disabledOptions?: string[];
  /** Label text (default: "Resolution") */
  label?: string;
  /** Whether to show the label */
  showLabel?: boolean;
}

/**
 * Resolution selector used by multiple AI models.
 *
 * @example
 * ```tsx
 * <ResolutionSelect
 *   value={ltxv2Resolution}
 *   onChange={setLTXV2Resolution}
 *   options={["1080p", "1440p", "2160p"]}
 *   labels={{ "1080p": "1080p (Full HD)", "2160p": "2160p (4K)" }}
 *   priceSuffix={{ "1080p": " ($0.04/sec)", "2160p": " ($0.16/sec)" }}
 * />
 * ```
 */
export function ResolutionSelect({
  value,
  onChange,
  options,
  labels = {},
  priceSuffix = {},
  disabledOptions = [],
  disabled = false,
  id,
  label = "Resolution",
  showLabel = true,
  className = "",
}: ResolutionSelectProps) {
  return (
    <div className={`space-y-1 ${className}`}>
      {showLabel && (
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
      )}
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="h-8 text-xs">
          <SelectValue placeholder="Select resolution" />
        </SelectTrigger>
        <SelectContent>
          {options.map((res) => (
            <SelectItem
              key={res}
              value={res}
              disabled={disabledOptions.includes(res)}
            >
              {labels[res] ?? res}
              {priceSuffix[res] ?? ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// Aspect Ratio Select
// ============================================

export interface AspectRatioSelectProps extends BaseSelectProps<string> {
  /** Available aspect ratio options */
  options: string[];
  /** Label text (default: "Aspect Ratio") */
  label?: string;
  /** Whether to show the label */
  showLabel?: boolean;
}

/**
 * Aspect ratio selector used by multiple AI models.
 *
 * @example
 * ```tsx
 * <AspectRatioSelect
 *   value={klingAspectRatio}
 *   onChange={setKlingAspectRatio}
 *   options={["16:9", "9:16", "1:1", "4:3", "3:4"]}
 * />
 * ```
 */
export function AspectRatioSelect({
  value,
  onChange,
  options,
  disabled = false,
  id,
  label = "Aspect Ratio",
  showLabel = true,
  className = "",
}: AspectRatioSelectProps) {
  return (
    <div className={`space-y-1 ${className}`}>
      {showLabel && (
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
      )}
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="h-8 text-xs">
          <SelectValue placeholder="Select aspect ratio" />
        </SelectTrigger>
        <SelectContent>
          {options.map((ratio) => (
            <SelectItem key={ratio} value={ratio}>
              {ratio}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// FPS Select
// ============================================

export interface FPSSelectProps extends BaseSelectProps<number> {
  /** Available FPS options */
  options: number[];
  /** Optional labels for FPS values */
  labels?: Record<number, string>;
  /** Options to disable based on external conditions */
  disabledOptions?: number[];
  /** Label text (default: "Frame Rate") */
  label?: string;
  /** Whether to show the label */
  showLabel?: boolean;
}

/**
 * FPS (Frame Rate) selector used by video generation models.
 *
 * @example
 * ```tsx
 * <FPSSelect
 *   value={ltxv2FPS}
 *   onChange={setLTXV2FPS}
 *   options={[25, 50]}
 *   labels={{ 25: "25 FPS (Standard)", 50: "50 FPS (High)" }}
 * />
 * ```
 */
export function FPSSelect({
  value,
  onChange,
  options,
  labels = {},
  disabledOptions = [],
  disabled = false,
  id,
  label = "Frame Rate",
  showLabel = true,
  className = "",
}: FPSSelectProps) {
  return (
    <div className={`space-y-1 ${className}`}>
      {showLabel && (
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
      )}
      <Select
        value={value.toString()}
        onValueChange={(v) => onChange(Number(v))}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-8 text-xs">
          <SelectValue placeholder="Select frame rate" />
        </SelectTrigger>
        <SelectContent>
          {options.map((fps) => (
            <SelectItem
              key={fps}
              value={fps.toString()}
              disabled={disabledOptions.includes(fps)}
            >
              {labels[fps] ?? `${fps} FPS`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// Generic Select with Custom Options
// ============================================

export interface GenericSelectProps<T extends string>
  extends BaseSelectProps<T> {
  /** Available options with labels */
  options: SelectOption<T>[];
  /** Label text */
  label: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether to show the label */
  showLabel?: boolean;
  /** Helper text shown below the select */
  helperText?: string;
}

/**
 * Generic select component for custom option types.
 *
 * @example
 * ```tsx
 * <GenericSelect
 *   value={flashvsrAcceleration}
 *   onChange={setFlashvsrAcceleration}
 *   label="Acceleration Mode"
 *   options={[
 *     { value: "regular", label: "Regular" },
 *     { value: "high", label: "High" },
 *     { value: "full", label: "Full" },
 *   ]}
 * />
 * ```
 */
export function GenericSelect<T extends string>({
  value,
  onChange,
  options,
  label,
  placeholder = "Select option",
  disabled = false,
  id,
  showLabel = true,
  helperText,
  className = "",
}: GenericSelectProps<T>) {
  return (
    <div className={`space-y-1 ${className}`}>
      {showLabel && (
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
      )}
      <Select
        value={value}
        onValueChange={(v) => onChange(v as T)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-8 text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              disabled={opt.disabled}
            >
              {opt.label}
              {opt.priceSuffix && (
                <span className="text-muted-foreground">{opt.priceSuffix}</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {helperText && (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      )}
    </div>
  );
}

// ============================================
// Upscale Factor Select
// ============================================

export interface UpscaleFactorSelectProps extends BaseSelectProps<number> {
  /** Available upscale factor options */
  options: number[];
  /** Label text (default: "Upscale Factor") */
  label?: string;
  /** Whether to show the label */
  showLabel?: boolean;
}

/**
 * Upscale factor selector for video upscaling models.
 *
 * @example
 * ```tsx
 * <UpscaleFactorSelect
 *   value={flashvsrUpscaleFactor}
 *   onChange={setFlashvsrUpscaleFactor}
 *   options={[2, 4]}
 * />
 * ```
 */
export function UpscaleFactorSelect({
  value,
  onChange,
  options,
  disabled = false,
  id,
  label = "Upscale Factor",
  showLabel = true,
  className = "",
}: UpscaleFactorSelectProps) {
  return (
    <div className={`space-y-1 ${className}`}>
      {showLabel && (
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
      )}
      <Select
        value={value.toString()}
        onValueChange={(v) => onChange(Number(v))}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-8 text-xs">
          <SelectValue placeholder="Select upscale factor" />
        </SelectTrigger>
        <SelectContent>
          {options.map((factor) => (
            <SelectItem key={factor} value={factor.toString()}>
              {factor}x
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ============================================
// Movement Amplitude Select (Vidu Q2 specific)
// ============================================

export type MovementAmplitude = "auto" | "small" | "medium" | "large";

export interface MovementAmplitudeSelectProps
  extends BaseSelectProps<MovementAmplitude> {
  /** Label text (default: "Movement Amplitude") */
  label?: string;
  /** Whether to show the label */
  showLabel?: boolean;
}

/**
 * Movement amplitude selector for Vidu Q2 model.
 */
export function MovementAmplitudeSelect({
  value,
  onChange,
  disabled = false,
  id,
  label = "Movement Amplitude",
  showLabel = true,
  className = "",
}: MovementAmplitudeSelectProps) {
  const options: SelectOption<MovementAmplitude>[] = [
    { value: "auto", label: "Auto" },
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
  ];

  return (
    <div className={`space-y-1 ${className}`}>
      {showLabel && (
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
      )}
      <Select
        value={value}
        onValueChange={(v) => onChange(v as MovementAmplitude)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-8 text-xs">
          <SelectValue placeholder="Select movement" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
